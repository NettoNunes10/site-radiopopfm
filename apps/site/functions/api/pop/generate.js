/**
 * Cloudflare Pages Function - Gerador Pop FM (Versão Paridade Python)
 * Implementa fielmente a lógica de negócio do sistema legada.
 */

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.NEWSMAKER_KV;
  const { method } = request;

  const authHeader = request.headers.get("Authorization");
  const password = env.NEWSMAKER_PASSWORD;
  const isAuthorized = authHeader === `Bearer ${password}` || authHeader === password;

  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { 
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const { date, days = 1 } = await request.json(); // YYYY-MM-DD
    if (!date) return new Response(JSON.stringify({ error: "Missing date" }), { status: 400 });

    const [libRaw, rulesRaw, jabasRaw, templateLib, templateMapping] = await Promise.all([
      kv.get("pop_library_index", "json"),
      kv.get("pop_rules", "json"),
      kv.get("pop_jabas", "json"),
      kv.get("pop_templates_library", "json"),
      kv.get("pop_templates_mapping", "json")
    ]);

    if (!libRaw) return new Response(JSON.stringify({ error: "Biblioteca Pop não indexada." }), { status: 400 });
    if (!templateLib || !templateMapping) return new Response(JSON.stringify({ error: "Modelos (.blm) não configurados." }), { status: 400 });

    const rules = rulesRaw || { 
      favoriteArtists: [], 
      artistSeparation: 10, 
      songSeparation: 80, 
      substitutionMode: true 
    };
    
    const favoriteArtists = new Set((rules.favoriteArtists || []).map(a => a.toUpperCase()));
    const results = [];
    const globalLogs = [];

    // 1. Loop de Geração Multi-Dias
    let currentDate = new Date(date + "T12:00:00");

    for (let i = 0; i < days; i++) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const dow = currentDate.getDay(); // 0=Sun...
      const dateLabel = dateStr.replace(/-/g, '');
      const dayLogs = [];
      const log = (msg) => dayLogs.push(`[${dateStr}] ${msg}`);
      
      log(`Iniciando geração para o dia ${dateStr}`);

      const templateName = templateMapping[dow];
      const templateRaw = templateLib[templateName];

      if (!templateRaw) {
        log(`ERRO: Nenhum modelo configurado para o dia ${dow}. Pulando.`);
        currentDate.setDate(currentDate.getDate() + 1);
        continue;
      }

      // 2. Scan de Blocos para Agendamento de Jabás
      const validBlocks = scanModelBlocksPop(templateRaw);
      const paidReservations = schedulePaidMusicPop(validBlocks, jabasRaw || [], dow, log);

      // 3. Loop de Processamento Final
      const historyArtists = [];
      const historySongs = [];
      const maxHistArtists = rules.artistSeparation || 10;
      const maxHistSongs = rules.songSeparation || 80;

      const lines = templateRaw.split(/\r?\n/);
      const finalLines = ["# Arquivo de roteiro da beAudio\t1\t550470001"];
      let currentBlockTime = "00:00";
      let pendingPaidSongs = [];

      for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith('#')) continue;

        // Header de Bloco (HH:MM)
        const timeMatch = line.match(/^(\d{2}:\d{2})/);
        if (timeMatch) {
          currentBlockTime = timeMatch[1];
          finalLines.push(line);
          
          // Carrega fila de pagas para este bloco
          pendingPaidSongs = paidReservations[currentBlockTime] ? [...paidReservations[currentBlockTime]] : [];
          continue;
        }

        // Itens Fixos / Vinhetas Fixas / Caminhos Diretos
        if (line.includes('Início do bloco comercial') || line.includes('Término do bloco comercial') || 
            line.includes('PREFIXO') || line.startsWith('U:\\')) {
          finalLines.push(line);
          continue;
        }
        
        // Identificação de Categoria (Ex: SERTANEJO A, VHT - GERAÇÃO)
        const categoryMatch = line.match(/^([A-Z0-9 \-À-ÿ]+)$/i);
        if (categoryMatch) {
          const category = categoryMatch[1].toUpperCase().trim();

          // --- LOGICA DE SUBSTITUIÇÃO (PAGAS) ---
          // Identifica se a categoria é música (para permitir substituição)
          let folderKey = category;
          if (category.includes('VHT')) folderKey = 'VHT';
          else if (category.includes('CHAMADA')) folderKey = 'PROMOS';
          else if (category.includes('INTERCOM')) folderKey = 'INTERCOM';
          else if (category.includes('AMOSTRA')) folderKey = 'SAMPLES';
          const isMusicSlot = !['VHT', 'PROMOS', 'INTERCOM', 'SAMPLES'].includes(folderKey);

          if (pendingPaidSongs.length > 0 && rules.substitutionMode && isMusicSlot) {
            const paidFile = pendingPaidSongs.shift();
            log(`♻️  SUBSTITUIÇÃO: '${category}' removido -> Entrou JABÁ: ${paidFile.path}`);
            finalLines.push(generateBilLine(paidFile.path, paidFile.duration || 180000));
            continue;
          }

          // --- LOGICA DE SELEÇÃO NORMAL ---
          const selection = selectAudioPop(category, libRaw, favoriteArtists, historyArtists, historySongs, maxHistArtists, maxHistSongs, log);
          if (selection) {
            finalLines.push(generateBilLine(selection.FullPath, selection.DurationMs));
          } else {
            log(`⚠️  AVISO: Nenhuma opção para '${category}'. Mantendo slot.`);
            finalLines.push(line); // Mantém .apm como fallback
          }
          continue;
        }

        finalLines.push(line);
      }

      const generatedContent = finalLines.join('\r\n');
      const filename = `${dateLabel}_POP.bil`;

      // Upload Provisório para Download do Agente
      const dlId = `pop_dl_${dateLabel}_${Date.now()}`;
      await kv.put(dlId, JSON.stringify({
        id: dlId,
        filename: filename,
        content: generatedContent,
        timestamp: new Date().toISOString()
      }), { expirationTtl: 86400 * 2 });

      results.push({ date: dateStr, filename: filename, content: generatedContent });
      globalLogs.push(...dayLogs);
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return new Response(JSON.stringify({ success: true, results: results, logs: globalLogs }), { 
      headers: { "Content-Type": "application/json" } 
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: "Falha na geração", detail: e.message }), { status: 500 });
  }
}

/**
 * Escaneia o modelo para encontrar horários de blocos válidos
 */
function scanModelBlocksPop(raw) {
  const blocks = [];
  const lines = raw.split(/\r?\n/);
  for (let line of lines) {
    const m = line.trim().match(/^(\d{2}:\d{2})/);
    if (m) {
      let t = m[1];
      if (t === "24:00") t = "00:00";
      blocks.push(t);
    }
  }
  return blocks;
}

/**
 * Pré-agendamento de músicas pagas nos blocos válidos (Janelas)
 */
function schedulePaidMusicPop(blocks, jabas, dow, log) {
  const reservations = {};
  const freeBlocks = [...blocks];
  
  log(`--- AGENDAMENTO DE MÚSICA PAGA ---`);

  // Filtra jabas ativos para hoje
  const activeJabas = jabas.filter(j => j.enabled !== false && (!j.dias_semana || j.dias_semana.includes(dow)));

  for (const j of activeJabas) {
    const rules = j.programacao || [];
    for (const rule of rules) {
      const qty = rule.quantidade_necessaria || 1;
      const windows = rule.janelas_de_horario || [];
      
      // Encontra blocos que batem com as janelas
      let candidates = freeBlocks.filter(b => {
        const h = parseInt(b.split(':')[0]);
        return windows.some(w => {
          const startH = parseInt(w.inicio.split(':')[0]);
          const endH = parseInt(w.fim.split(':')[0]);
          return h >= startH && h <= endH;
        });
      });

      // Se não houver blocos livres, tenta qualquer bloco
      if (candidates.length === 0) {
        candidates = blocks.filter(b => {
          const h = parseInt(b.split(':')[0]);
          return windows.some(w => h >= parseInt(w.inicio.split(':')[0]) && h <= parseInt(w.fim.split(':')[0]));
        });
      }

      for (let q = 0; q < qty; q++) {
        if (candidates.length === 0) break;
        const idx = Math.floor(Math.random() * candidates.length);
        const chosen = candidates.splice(idx, 1)[0];
        
        if (!reservations[chosen]) reservations[chosen] = [];
        reservations[chosen].push({ id: j.id, path: j.caminho_arquivo, duration: j.duracao_ms });
        
        // Remove do freeBlocks para não encavalar música no mesmo bloco se possível
        const fbIdx = freeBlocks.indexOf(chosen);
        if (fbIdx > -1) freeBlocks.splice(fbIdx, 1);
        
        log(`📅 Agendado: ${j.id} para o bloco das ${chosen}`);
      }
    }
  }
  log(`-----------------------------------`);
  return reservations;
}

/**
 * Seleção de Áudio com Inteligência Artificial e Histórico
 */
function selectAudioPop(category, library, favorites, histArtists, histSongs, maxA, maxS, log) {
  // 1. Surpresa Sertanejo C (0.5% chance)
  if (category === 'SERTANEJO B' && Math.random() < 0.005) {
    category = 'SERTANEJO C';
    log(`🎲 SURPRESA! Slot SERTANEJO B trocado por SERTANEJO C`);
  }

  // 2. Mapeamento de Pastas (Sweepers vs Music)
  let folderKey = category;
  if (category.includes('VHT')) folderKey = 'VHT';
  else if (category.includes('CHAMADA')) folderKey = 'PROMOS';
  else if (category.includes('INTERCOM')) folderKey = 'INTERCOM';
  else if (category.includes('AMOSTRA')) folderKey = 'SAMPLES';

  const files = library[folderKey] || [];
  if (files.length === 0) return null;

  const isMusic = !['VHT', 'PROMOS', 'INTERCOM', 'SAMPLES'].includes(folderKey);

  // 3. Loop de Sorteio (50 tentativas para bater o histórico)
  for (let i = 0; i < 50; i++) {
    const f = files[Math.floor(Math.random() * files.length)];
    const title = (f.Name || f.Title || "").toUpperCase();
    const artistRaw = (f.Artist || "").toUpperCase();

    // Parsing de Artistas (Separa duplas/parcerias)
    const currentArtists = artistRaw.split(/ PART\. | & | E /).map(a => a.trim());

    if (isMusic) {
      if (histSongs.includes(title)) continue;
      if (currentArtists.some(a => histArtists.includes(a))) continue;

      // Peso para Favoritos (70% de chance de pular se NÃO for favorito)
      const isFav = currentArtists.some(a => favorites.has(a));
      if (!isFav && Math.random() < 0.7) continue;

      // Sucesso!
      updateHistoryPop(currentArtists, title, histArtists, histSongs, maxA, maxS);
      return f;
    } else {
      // Sweepers: Apenas sorteio simples (ou ciclo se o agente suportar)
      return f;
    }
  }

  // Fallback: Pega qualquer um se o histórico estiver muito apertado
  const fallback = files[Math.floor(Math.random() * files.length)];
  if (isMusic) {
    const fArtists = (fallback.Artist || "").toUpperCase().split(/ PART\. | & | E /).map(a => a.trim());
    updateHistoryPop(fArtists, (fallback.Name || fallback.Title || "").toUpperCase(), histArtists, histSongs, maxA, maxS);
  }
  return fallback;
}

function updateHistoryPop(artists, title, histArtists, histSongs, maxA, maxS) {
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
