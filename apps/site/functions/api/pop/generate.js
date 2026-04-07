export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.NEWSMAKER_KV;
  const { method } = request;

  // 1. Auth (Bearer Token)
  const authHeader = request.headers.get("Authorization");
  const password = env.NEWSMAKER_PASSWORD;
  if (!authHeader || authHeader !== `Bearer ${password}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { 
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const { date } = await request.json(); // YYYY-MM-DD
    if (!date) return new Response(JSON.stringify({ error: "Missing date" }), { status: 400 });

    const targetDate = new Date(date + "T12:00:00");
    const dow = targetDate.getDay(); // 0=Sun, 1=Mon... 6=Sat

    // 2. Load Data from KV
    const [libRaw, rulesRaw, templateRaw] = await Promise.all([
      kv.get("pop_library_index", "json"),
      kv.get("pop_rules", "json"),
      getTemplate(kv, dow)
    ]);

    if (!libRaw) return new Response(JSON.stringify({ error: "Library not indexed. Run the C# agent first." }), { status: 400 });
    if (!templateRaw) return new Response(JSON.stringify({ error: "Template not found for this day." }), { status: 500 });

    const library = libRaw; // Dictionary<Category, MusicFile[]>
    const rules = rulesRaw || { favoriteArtists: [] };
    const favoriteArtists = new Set((rules.favoriteArtists || []).map(a => a.toUpperCase()));

    // 3. Generation Logic
    const historyArtists = [];
    const historySongs = [];
    const maxHistArtists = 10;
    const maxHistSongs = 50;

    const lines = templateRaw.split('\n');
    const finalLines = ["# Arquivo de roteiro da beAudio\t1\t550470001"];
    
    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;

      // Keep block headers (HH:MM or HH:MM:SS)
      if (/^\d{2}:\d{2}/.test(line)) {
        finalLines.push(line);
        continue;
      }

      // Keep fixed materials
      if (line.includes('Reserva') || line.includes('Início') || line.includes('Término') || line.includes('PREFIXO')) {
        finalLines.push(line);
        continue;
      }

      // Process Placeholders (.apm)
      if (line.endsWith('.apm')) {
        const category = line.split('.apm')[0];
        const selection = selectMusic(category, library, favoriteArtists, historyArtists, historySongs, maxHistArtists, maxHistSongs);
        
        if (selection) {
          finalLines.push(generateBilLine(selection.FullPath, selection.DurationMs));
        } else {
          // Fallback if no music found for category
          finalLines.push(`# MISSING: ${category}`);
        }
        continue;
      }

      // Default: keep line as is
      finalLines.push(line);
    }

    return new Response(JSON.stringify({ 
      success: true, 
      bil: finalLines.join('\r\n'),
      date: date 
    }), { headers: { "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ error: "Generation failed", detail: e.message }), { status: 500 });
  }
}

async function getTemplate(kv, dow) {
  const [library, mapping] = await Promise.all([
    kv.get("pop_templates_library", "json"),
    kv.get("pop_templates_mapping", "json")
  ]);

  if (!library || !mapping) return null;

  const templateName = mapping[dow];
  if (!templateName || !library[templateName]) return null;

  return library[templateName];
}

function selectMusic(category, library, favorites, histArtists, histSongs, maxA, maxS) {
  const files = library[category] || [];
  if (files.length === 0) return null;

  // Try to find a good candidate (weighted selection)
  for (let i = 0; i < 50; i++) {
    const f = files[Math.floor(Math.random() * files.length)];
    const artist = f.Artist.toUpperCase();
    const title = f.Title.toUpperCase();

    // 1. History Check
    if (histSongs.includes(title)) continue;
    if (histArtists.includes(artist)) continue;

    // 2. Weights (Favorite Artists have priority)
    const isFav = favorites.has(artist);
    if (!isFav && Math.random() < 0.6) continue; // 60% chance skip if not favorite

    updateHistory(artist, title, histArtists, histSongs, maxA, maxS);
    return f;
  }

  // Fallback: Pick any random one that doesn't repeat artists if possible
  const fFallback = files[Math.floor(Math.random() * files.length)];
  updateHistory(fFallback.Artist.toUpperCase(), fFallback.Title.toUpperCase(), histArtists, histSongs, maxA, maxS);
  return fFallback;
}

function updateHistory(artist, title, histArtists, histSongs, maxA, maxS) {
  histArtists.push(artist);
  if (histArtists.length > maxA) histArtists.shift();
  histSongs.push(title);
  if (histSongs.length > maxS) histSongs.shift();
}

function generateBilLine(path, durationMs) {
  // ensure backslashes for beAudio legacy paths if needed, though they come from C#
  const p = path.replace(/\//g, '\\');
  // duration is in ms
  return `${p} /m:3000 /t:${durationMs} /i:0 /s:0 /f:${durationMs} /r:0 /d:0 /o:0 /n:1 /x:  /g:0`;
}
