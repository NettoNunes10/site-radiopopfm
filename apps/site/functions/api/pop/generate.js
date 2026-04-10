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

    const [libRaw, rulesRaw, jabasRaw, templateLib, templateMapping, materialRules] = await Promise.all([
      kv.get("pop_library_index", "json"),
      kv.get("pop_rules", "json"),
      kv.get("pop_jabas", "json"),
      kv.get("pop_templates_library", "json"),
      kv.get("pop_templates_mapping", "json"),
      kv.get("pop_material_rules", "json")
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
        
        // --- IDENTIFICAÇÃO DE CATEGORIA (.apm) ---
        if (line.toLowerCase().includes('.apm')) {
          const isMusicSlot = line.includes('/m:3000');
          
          // Extrai o nome do arquivo .apm (ex: SERTANEJO B.apm) - Agora aceita espaços
          const apmMatch = line.match(/^(.+?\.apm)/i);
          if (!apmMatch) {
            finalLines.push(line);
            continue;
          }
          
          const fullApmName = apmMatch[1]; // SERTANEJO B.apm
          const category = fullApmName.split('.apm')[0].trim(); // SERTANEJO B

          // --- LÓGICA DE SUBSTITUIÇÃO (PAGAS) ---
          if (pendingPaidSongs.length > 0 && rules.substitutionMode && isMusicSlot) {
            const paidFile = pendingPaidSongs.shift();
            log(`♻️  SUBSTITUIÇÃO: '${category}' removido -> Entrou JABÁ: ${paidFile.path}`);
            
            // Substitui o placeholder e injeta tempo na linha original
            let newLine = line.replace(fullApmName, paidFile.path.replace(/\//g, '\\'));
            const duration = paidFile.duration || 180000;
            newLine = newLine.replace('/t:0', `/t:${duration}`).replace('/f:0', `/f:${duration}`);
            finalLines.push(newLine);
            continue;
          }

          // Tenta selecionar áudio da biblioteca
          const selection = selectAudioPop(category, libRaw, favoriteArtists, historyArtists, historySongs, maxHistArtists, maxHistSongs, isMusicSlot, materialRules || {}, log);
          
          if (selection) {
            // Sucesso! Substitui na linha original mantendo metadados técnicos
            let newLine = line.replace(fullApmName, selection.FullPath.replace(/\//g, '\\'));
            const duration = selection.DurationMs || 0;
            if (duration > 0) {
                // Injeta tempo real se disponível
                newLine = newLine.replace('/t:0', `/t:${duration}`).replace('/f:0', `/f:${duration}`);
            }
            finalLines.push(newLine);
            continue;
          } else {
            log(`⚠️  AVISO: Nenhuma opção na biblioteca para '${category}'. Mantendo slot original.`);
            finalLines.push(line);
            continue;
          }
        }

        finalLines.push(line);
      }

      const generatedContent = finalLines.join('\r\n');
      const filename = `${dateLabel}.bil`; // Estritamente yyyyMMdd.bil

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
function selectAudioPop(category, library, favorites, histArtists, histSongs, maxA, maxS, isMusicSlot, mappingRules, log) {
  // 1. Surpresa Sertanejo C (0.5% chance)
  if (category === 'SERTANEJO B' && Math.random() < 0.005) {
    category = 'SERTANEJO C';
    log(`🎲 SURPRESA! Slot SERTANEJO B trocado por SERTANEJO C`);
  }

  // 2. Localização da Pasta na Biblioteca
  let folderKey = null;

  // A) Tenta Mapeamento Manual (Override)
  // Normaliza a busca para ignorar extensões nas chaves do mapeamento também
  let mappingKey = Object.keys(mappingRules).find(k => k.split('.apm')[0].trim() === category);
  if (mappingKey) {
    folderKey = mappingRules[mappingKey];
    
    // Se for um caminho completo, extrai a pasta final
    if (folderKey.includes('\\')) folderKey = folderKey.split('\\').pop();
    else if (folderKey.includes('/')) folderKey = folderKey.split('/').pop();

    if (!library[folderKey]) {
        log(`⚠️  ALERTA: Mapeamento para '${category}' aponta para '${folderKey}', mas não achei essa pasta na biblioteca.`);
        folderKey = null;
    } else {
        log(`✅ [MAPEADO] Usando regra manual para '${category}' -> pasta '${folderKey}'`);
    }
  }

  const normCategory = normalizeKey(category);
  const keys = Object.keys(library);
  
  // B) Tenta Match Exato (Normalizado) se não houver override
  if (!folderKey) {
    folderKey = keys.find(key => normalizeKey(key) === normCategory);
  }
  
  // Tenta Match Tolerante (Se contém o nome da pasta ou vice-versa)
  if (!folderKey && normCategory.length > 3) {
    folderKey = keys.find(key => {
      const normKey = normalizeKey(key);
      return normKey.includes(normCategory) || normCategory.includes(normKey);
    });
  }

  if (!folderKey) {
    const nearMatches = keys.filter(k => normalizeKey(k).includes(normCategory.substring(0, 4))).slice(0, 3).join(', ');
    if (nearMatches) log(`📌 Dica: Não achei '${category}', mas vi pastas como: ${nearMatches}`);
    return null;
  }

  const files = library[folderKey] || [];
  if (files.length === 0) return null;

  // 3. Loop de Sorteio (50 tentativas para bater o histórico)
  for (let i = 0; i < 50; i++) {
    const f = files[Math.floor(Math.random() * files.length)];
    const title = (f.Name || f.Title || "").toUpperCase();
    const artistRaw = (f.Artist || "").toUpperCase();

    // Parsing de Artistas (Separa duplas/parcerias)
    const currentArtists = artistRaw.split(/ PART\. | & | E /).map(a => a.trim());

    if (isMusicSlot) {
      if (histSongs.includes(title)) continue;
      if (currentArtists.some(a => histArtists.includes(a))) continue;

      // Peso para Favoritos (70% de chance de pular se NÃO for favorito)
      const isFav = currentArtists.some(a => favorites.has(a));
      if (!isFav && Math.random() < 0.7) continue;

      // Sucesso!
      updateHistoryPop(currentArtists, title, histArtists, histSongs, maxA, maxS);
      return f;
    } else {
      // Materiais (Sweepers, Intercom, etc): Sorteio simples sem histórico rígido
      return f;
    }
  }

  // Fallback: Pega qualquer um se o histórico estiver muito apertado
  const fallback = files[Math.floor(Math.random() * files.length)];
  if (isMusicSlot) {
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

/**
 * Utilitário de Normalização: Remove acentos, símbolos e trata o ?? da codificação corrompida
 */
function normalizeKey(str) {
  if (!str) return "";
  return str.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove acentos
    .replace(/\?\?/g, "")            // Remove lixo de codificação (??)
    .replace(/[^a-zA-Z0-9]/g, "")    // Remove tudo que não for alfanumérico
    .toUpperCase()
    .trim();
}
