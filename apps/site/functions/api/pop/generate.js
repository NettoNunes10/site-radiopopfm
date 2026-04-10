/**
 * Cloudflare Pages Function - Gerador Pop FM (Versão Alta Performance)
 * Implementa paridade com a lógica legada Python.
 */

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.NEWSMAKER_KV;
  const { method } = request;

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
    const { date, days = 1 } = await request.json(); // YYYY-MM-DD
    if (!date) return new Response(JSON.stringify({ error: "Missing date" }), { status: 400 });

    // 1. Carregar Configurações GLOBAIS da POP (Isoladas da Massa)
    const [libRaw, rulesRaw, jabasRaw, templateLib, templateMapping] = await Promise.all([
      kv.get("pop_library_index", "json"),
      kv.get("pop_rules", "json"),
      kv.get("pop_jabas", "json"), // Chave exclusiva POP
      kv.get("pop_templates_library", "json"),
      kv.get("pop_templates_mapping", "json")
    ]);

    if (!libRaw) return new Response(JSON.stringify({ error: "Biblioteca Pop não indexada." }), { status: 400 });
    if (!templateLib || !templateMapping) return new Response(JSON.stringify({ error: "Modelos (.blm) não configurados." }), { status: 400 });

    const library = libRaw;
    const rules = rulesRaw || { 
      favoriteArtists: [], 
      artistSeparation: 10, 
      songSeparation: 50, 
      substitutionMode: true 
    };
    
    const favoriteArtists = new Set((rules.favoriteArtists || []).map(a => a.toUpperCase()));
    const results = [];
    const globalLogs = [];

    // 2. Loop de Geração Multi-Dias
    let currentDate = new Date(date + "T12:00:00");

    for (let i = 0; i < days; i++) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const dow = currentDate.getDay(); // 0=Sun, 1=Mon...
      const dateLabel = dateStr.replace(/-/g, '');
      
      const dayLogs = [];
      const log = (msg) => dayLogs.push(`[${dateStr}] ${msg}`);
      
      log(`Iniciando geração para o dia ${dateStr}`);

      // Selecionar Modelo conforme o dia da semana
      const templateName = templateMapping[dow];
      const templateRaw = templateLib[templateName];

      if (!templateRaw) {
        log(`ERRO: Nenhum modelo configurado para o dia da semana ${dow}. Pulando.`);
        currentDate.setDate(currentDate.getDate() + 1);
        continue;
      }

      // 3. Lógica Interna de Geração (Histórico por Dia)
      const historyArtists = [];
      const historySongs = [];
      const maxHistArtists = rules.artistSeparation || 10;
      const maxHistSongs = rules.songSeparation || 50;

      // Fila de Jabás (Músicas Pagas) do dia
      const activeJabas = (jabasRaw || []).filter(j => !j.dias_semana || j.dias_semana.includes(dow));

      const lines = templateRaw.split(/\r?\n/);
      const finalLines = ["# Arquivo de roteiro da beAudio\t1\t550470001"];
      
      let currentHour = "00";
      let pendingJabaForHour = null;

      for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith('#')) continue;

        // Header de Bloco (HH:MM)
        const timeMatch = line.match(/^(\d{2}):\d{2}/);
        if (timeMatch) {
          currentHour = timeMatch[1];
          finalLines.push(line);

          // Verifica se há um Jabá para esta hora específica (agendamento simples)
          pendingJabaForHour = activeJabas.find(j => {
             const prog = j.programacao || [];
             return prog.some(p => (p.janelas_de_horario || []).some(w => w.inicio.startsWith(currentHour)));
          });
          continue;
        }

        // Itens Fixos
        if (line.includes('Reserva') || line.includes('Início') || line.includes('Término') || line.includes('PREFIXO')) {
          finalLines.push(line);
          continue;
        }

        // PROCESSAMENTO DE SLOTS (.apm)
        if (line.endsWith('.apm')) {
          const category = line.split('.apm')[0].toUpperCase();
          
          // --- REGRA DE SUBSTITUIÇÃO (PYTHON STYLE) ---
          if (pendingJabaForHour && rules.substitutionMode) {
             log(`♻️ SUBSTITUIÇÃO: Slot '${category}' removido -> Entrou JABÁ: ${pendingJabaForHour.id}`);
             finalLines.push(generateBilLine(pendingJabaForHour.caminho_arquivo, pendingJabaForHour.duracao_ms || 180000));
             pendingJabaForHour = null; // Usado
             continue;
          }
          
          const selection = selectMusicPop(category, library, favoriteArtists, historyArtists, historySongs, maxHistArtists, maxHistSongs, log);
          
          if (selection) {
            finalLines.push(generateBilLine(selection.FullPath, selection.DurationMs));
          } else {
            finalLines.push(`# MISSING: ${category}`);
          }
          continue;
        }

        finalLines.push(line);
      }

      const generatedContent = finalLines.join('\r\n');
      const filename = `${dateLabel}_POP.bil`;

      // Salvar cada dia individualmente no KV para o Agente baixar
      const dlId = `pop_dl_${dateLabel}_${Date.now()}`;
      await kv.put(dlId, JSON.stringify({
        id: dlId,
        filename: filename,
        content: generatedContent,
        timestamp: new Date().toISOString()
      }), { expirationTtl: 86400 * 2 }); // 2 dias de validade

      results.push({
        date: dateStr,
        filename: filename,
        content: generatedContent
      });

      globalLogs.push(...dayLogs);
      
      // Ir para o próximo dia
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return new Response(JSON.stringify({ 
      success: true, 
      results: results,
      logs: globalLogs
    }), { headers: { "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ error: "Falha na geração", detail: e.message }), { status: 500 });
  }
}

/**
 * Seleção Musical Avançada com Parsing de Artistas
 */
function selectMusicPop(category, library, favorites, histArtists, histSongs, maxA, maxS, log) {
  const files = library[category] || [];
  if (files.length === 0) return null;

  // Tentar encontrar um candidato ideal (50 tentativas)
  for (let i = 0; i < 50; i++) {
    const f = files[Math.floor(Math.random() * files.length)];
    const artistRaw = f.Artist.toUpperCase();
    const title = f.Title.toUpperCase();

    // 1. Quebrar Artistas (Parsing de Parcerias)
    const currentArtists = artistRaw.split(/ PART\. | & | E /).map(a => a.trim());

    // 2. Checagem de Histórico (Música e QUALQUER um dos artistas envolvidos)
    if (histSongs.includes(title)) continue;
    if (currentArtists.some(a => histArtists.includes(a))) continue;

    // 3. Pesos (Favoritos)
    const isFav = currentArtists.some(a => favorites.has(a));
    if (!isFav && Math.random() < 0.7) continue; // 70% de chance de pular se não for favorito

    // Sucesso! Atualizar Histórico
    updateHistory(currentArtists, title, histArtists, histSongs, maxA, maxS);
    return f;
  }

  // Fallback: Pega um aleatório mas tenta não repetir música
  const fFallback = files[Math.floor(Math.random() * files.length)];
  const fallbackArtists = fFallback.Artist.toUpperCase().split(/ PART\. | & | E /).map(a => a.trim());
  updateHistory(fallbackArtists, fFallback.Title.toUpperCase(), histArtists, histSongs, maxA, maxS);
  return fFallback;
}

function updateHistory(artists, title, histArtists, histSongs, maxA, maxS) {
  artists.forEach(a => {
    histArtists.push(a);
    if (histArtists.length > maxA) histArtists.shift();
  });
  
  histSongs.push(title);
  if (histSongs.length > maxS) histSongs.shift();
}

function generateBilLine(path, durationMs) {
  const p = path.replace(/\//g, '\\');
  return `${p} /m:3000 /t:${durationMs} /i:0 /s:0 /f:${durationMs} /r:0 /d:0 /o:0 /n:1 /x:  /g:0`;
}
