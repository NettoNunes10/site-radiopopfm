/**
 * Cloudflare Pages Function - Processamento Automático de Playlists (.bil)
 * Rigorously ported from admin/roteiro.js for server-side execution.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 
      'Content-Type': 'application/json', 
      'Cache-Control': 'no-store',
      ...CORS_HEADERS 
    },
  });
}

function authorize(request, env) {
  const authHeader = (request.headers.get('authorization') || request.headers.get('Authorization') || '').trim();
  const expectedPassword = env.NEWSMAKER_PASSWORD;
  if (!expectedPassword || expectedPassword.trim() === '') return false;
  return authHeader === `Bearer ${expectedPassword}`;
}

// --- MUSIC ENGINE PORTED LOGIC ---

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function getDayType(date) {
  const day = date.getDay(); // 0=Sun, 6=Sat
  if (day === 0) return 'domingo';
  if (day === 6) return 'sabado';
  return 'dia_semana';
}

const HEADER_RE = /^([0-2][0-9]:[0-5][0-9])\s+\/m:/;
const COMM_START_RE = /\/o:3\b/;
const COMM_END_RE = /\/o:4\b/;
const HOUR_PREFIX_RE = /(ABERTURA HORA CHEIA - )(.+?)(\.(?:wav|mp3))/i;

class Block {
  constructor(time, header, items = []) {
    this.time = time;
    this.header = header;
    this.items = items;
  }
}

function parseBlocks(text) {
  const lines = text.split(/\r?\n/);
  const prelude = [];
  const blocks = [];
  let currentBlock = null;

  for (const line of lines) {
    const match = line.match(HEADER_RE);
    if (match) {
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = new Block(match[1], line, []);
    } else if (!currentBlock) {
      prelude.push(line);
    } else {
      currentBlock.items.push(line);
    }
  }
  if (currentBlock) blocks.push(currentBlock);
  return { prelude, blocks };
}

function findCommercialBounds(items) {
  let start = -1, end = -1;
  for (let i = 0; i < items.length; i++) {
    if (COMM_START_RE.test(items[i])) { start = i; break; }
  }
  if (start === -1) return null;
  for (let i = start + 1; i < items.length; i++) {
    if (COMM_END_RE.test(items[i])) { end = i; break; }
  }
  if (end === -1) return null;
  return [start, end];
}

function keepOnlyCommercials(items) {
  const bounds = findCommercialBounds(items);
  if (!bounds) return { items: [...items], hadCommercial: false };
  return { items: items.slice(bounds[0], bounds[1] + 1), hadCommercial: true };
}

function inWindow(timeMin, window) {
  const start = toMinutes(window.inicio);
  const end = toMinutes(window.fim);
  if (start <= end) return timeMin >= start && timeMin <= end;
  return timeMin >= start || timeMin <= end;
}

function isTimeAllowed(hhmm, windows) {
  if (!windows || windows.length === 0) return true;
  const minutes = toMinutes(hhmm);
  return windows.some(w => inWindow(minutes, w));
}

function buildJabaLine(jaba) {
  const duration = jaba.duracao_ms || 0;
  const intro = jaba.cue_intro_ms || 0;
  const segue = jaba.cue_segue_ms || 0;
  const f = duration + segue;
  return `${jaba.caminho_arquivo} /m:3950 /t:${duration} /i:${intro} /s:${segue} /f:${f} /r:0 /d:0 /o:0 /n:1 /x:  /g:0`;
}

function applySubstitutions(blocks, config, city, log) {
  if (!config || !config.substituicoes || config.substituicoes.length === 0) return;
  const state = {};
  blocks.forEach(block => {
    block.items.forEach((line, i) => {
      config.substituicoes.forEach(rule => {
        const findList = rule.buscar || [];
        const replaceList = rule.substituir_por || [];
        if (findList.length === 0 || replaceList.length === 0) return;
        const matches = findList.some(f => line.toUpperCase().includes(f.toUpperCase()));
        if (matches) {
          let selected = "";
          if (rule.modo === 'ciclo') {
            state[rule.descricao] = (state[rule.descricao] || 0) % replaceList.length;
            selected = replaceList[state[rule.descricao]];
            state[rule.descricao]++;
          } else {
            selected = replaceList[Math.floor(Math.random() * replaceList.length)];
          }
          findList.forEach(f => {
            if (line.toUpperCase().includes(f.toUpperCase())) {
              const regex = new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
              if (regex.test(block.items[i])) {
                block.items[i] = block.items[i].replace(regex, selected);
                log(`${city}: Substituição aplicada "${rule.descricao}": ${f} -> ${selected}`);
              }
            }
          });
        }
      });
    });
  });
}

function applyJabas(blocks, jabasConfig, date, city, log) {
  const dayOfWeek = date.getDay();
  const usedBlocks = new Set();
  const activeJabas = jabasConfig.filter(j => !j.dias_semana || j.dias_semana.includes(dayOfWeek));
  activeJabas.forEach(jaba => {
    (jaba.programacao || []).forEach(prog => {
      const eligible = blocks.filter(b => isTimeAllowed(b.time, prog.janelas_de_horario) && !usedBlocks.has(b.time));
      if (eligible.length === 0) return;
      const count = Math.min(prog.quantidade_necessaria, eligible.length);
      const selected = [...eligible].sort(() => 0.5 - Math.random()).slice(0, count);
      selected.forEach(block => {
        let insertIdx = block.items.length;
        for (let i = 0; i < block.items.length; i++) {
          const line = block.items[i].toUpperCase();
          if (line.startsWith("M:\\SERTAO\\") || line.startsWith("M:\\SERTÃO\\")) {
            insertIdx = i;
            break;
          }
        }
        block.items.splice(insertIdx, 0, buildJabaLine(jaba));
        usedBlocks.add(block.time);
        log(`${city}: Jabá ${jaba.id} inserido no bloco ${block.time}`);
      });
    });
  });
}

function buildOutput(prelude, blocks) {
  let out = prelude.join('\r\n') + (prelude.length ? '\r\n' : '');
  blocks.forEach(b => {
    out += b.header + '\r\n';
    out += b.items.join('\r\n') + (b.items.length ? '\r\n' : '');
  });
  return out;
}

function processMusic(fileContent, rules, jabas, prefixes, substitutions, date) {
  const logs = [];
  const log = (msg) => logs.push(`[${new Date().toLocaleTimeString('pt-BR')}] ${msg}`);
  
  const dayType = getDayType(date);
  log(`Iniciando processamento para ${date.toLocaleDateString('pt-BR')} (Tipo: ${dayType})`);
  
  const { prelude, blocks: sourceBlocks } = parseBlocks(fileContent);
  log(`Arquivo base carregado: ${sourceBlocks.length} blocos detectados.`);

  const processCity = (city) => {
    log(`--- Processando ${city} ---`);
    const removeSet = new Set(rules.remover_blocos?.[dayType] || []);
    const renameMap = (rules.renomear_blocos?.[dayType] || {})[city] || {};
    const includeWindows = rules.janelas_permitidas?.[dayType] || [];
    
    const cityBlocks = sourceBlocks
      .filter(b => {
        if (removeSet.has(b.time)) {
          log(`${city}: Bloco ${b.time} removido (Regra de exclusão)`);
          return false;
        }
        return true;
      })
      .map(b => {
        let time = b.time;
        let header = b.header;
        if (renameMap[time]) {
          const newTime = renameMap[time];
          log(`${city}: Bloco ${time} renomeado para ${newTime}`);
          header = header.replace(time, newTime);
          time = newTime;
        }
        
        let items = [...b.items];
        if (!isTimeAllowed(time, includeWindows)) {
          const res = keepOnlyCommercials(items);
          if (res.hadCommercial) {
            log(`${city}: Bloco ${time} fora da janela de rede. Mantendo apenas comerciais.`);
          }
          items = res.items;
        }
        return new Block(time, header, items);
      });

    // Substitutions
    applySubstitutions(cityBlocks, substitutions, city, log);

    // Prefixes
    const prefOptions = prefixes.options_by_day?.[dayType] || prefixes.options_by_day?.['dia_semana'] || [];
    if (prefOptions.length > 0) {
      let idx = 0;
      cityBlocks.forEach(b => {
        b.items.forEach((line, i) => {
          const match = line.match(HOUR_PREFIX_RE);
          if (match) {
            const selected = prefOptions[idx % prefOptions.length];
            log(`${city}: Prefixo aplicado no bloco ${b.time} -> ${selected}`);
            idx++;
            b.items[i] = line.replace(match[1] + match[2], selected);
          }
        });
      });
    }

    // Jabas
    applyJabas(cityBlocks, jabas, date, city, log);

    return buildOutput(prelude, cityBlocks);
  };

  const itapevaOut = processCity('ITAPEVA');
  const itapetiningaOut = processCity('ITAPETININGA');
  
  log("Processamento concluído com sucesso.");
  
  return {
    itapeva: itapevaOut,
    itapetininga: itapetiningaOut,
    logs
  };
}

// --- API HANDLERS ---

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!authorize(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);

  const kv = env.NEWSMAKER_KV;
  if (!kv) return jsonResponse({ error: 'KV namespace not configured.' }, 500);

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const fileName = formData.get('fileName') || (file instanceof File ? file.name : 'playlist.bil');

    if (!file) return jsonResponse({ error: 'No file provided.' }, 400);

    // Extract Date YYYYMMDD
    const dateMatch = fileName.match(/(\d{8})/);
    if (!dateMatch) return jsonResponse({ error: 'Date (YYYYMMDD) not found in filename.' }, 400);
    const dateStr = dateMatch[1];
    const date = new Date(`${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}T12:00:00`);

    // Fetch configs from KV
    const fetchConfig = async (key) => {
      const val = await kv.get(key);
      try { return val ? JSON.parse(val) : null; } catch { return null; }
    };

    const [rules, jabasRaw, prefixes, vignetts] = await Promise.all([
      fetchConfig('config_music_rules'),
      fetchConfig('config_music_jabas'),
      fetchConfig('config_music_prefixes'),
      fetchConfig('config_music_substitutions')
    ]);

    const musicRules = rules || { janelas_permitidas: {}, remover_blocos: {}, renomear_blocos: {} };
    const musicJabas = (jabasRaw && (jabasRaw.configuracao_jabas || jabasRaw.jabas)) || [];
    const musicPrefixes = prefixes || { options_by_day: {} };
    const musicSubst = vignetts || { substituicoes: [] };

    // Process file content (Windows-1252)
    const arrayBuffer = await file.arrayBuffer();
    const decoder = new TextDecoder('windows-1252');
    const content = decoder.decode(arrayBuffer);

    const result = processMusic(content, musicRules, musicJabas, musicPrefixes, musicSubst, date);

    // Save to KV for both cities
    const saveToKV = async (city, processedContent) => {
      const cityKey = city.toLowerCase();
      const payload = {
        city: cityKey,
        date: dateStr,
        filename: fileName,
        content: processedContent,
        dispatched_at: new Date().toISOString(),
        automated: true
      };
      await kv.put(`playlist:${cityKey}:${dateStr}`, JSON.stringify(payload), { expirationTtl: 86400 * 7 });
    };

    await Promise.all([
      saveToKV('itapeva', result.itapeva),
      saveToKV('itapetininga', result.itapetininga)
    ]);

    return jsonResponse({
      success: true,
      fileName,
      date: dateStr,
      logs: result.logs
    });

  } catch (error) {
    return jsonResponse({ error: `Processing failed: ${error.message}` }, 500);
  }
}
