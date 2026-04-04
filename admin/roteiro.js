/**
 * Auto-Musical Web Engine
 * Rigorously ported from Python to JavaScript
 */

// --- UTILS ---
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function normalizeHHMM(hhmm) {
  const total = toMinutes(hhmm);
  return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
}

function inWindow(timeMin, window) {
  const start = toMinutes(window.inicio);
  const end = toMinutes(window.fim);
  if (start <= end) return timeMin >= start && timeMin <= end;
  return timeMin >= start || timeMin <= end;
}

function isTimeAllowed(hhmm, windows) {
  const minutes = toMinutes(hhmm);
  return windows.some(w => inWindow(minutes, w));
}

function getDayType(date) {
  const day = date.getDay(); // 0=Sun, 6=Sat
  if (day === 0) return 'domingo';
  if (day === 6) return 'sabado';
  return 'dia_semana';
}

// --- ANSI ENCODING (CP1252) ---
function stringToCP1252(str) {
  const buf = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    const charCode = str.charCodeAt(i);
    if (charCode < 128) {
      buf[i] = charCode;
    } else {
      // Common Portuguese CP1252 mappings
      const map = {
        0xc0: 0xc0, 0xc1: 0xc1, 0xc2: 0xc2, 0xc3: 0xc3, 0xc7: 0xc7,
        0xc8: 0xc8, 0xc9: 0xc9, 0xca: 0xca, 0xcd: 0xcd, 0xd2: 0xd2,
        0xd3: 0xd3, 0xd4: 0xd4, 0xd5: 0xd5, 0xda: 0xda, 0xe0: 0xe0,
        0xe1: 0xe1, 0xe2: 0xe2, 0xe3: 0xe3, 0xe7: 0xe7, 0xe8: 0xe8,
        0xe9: 0xe9, 0xea: 0xea, 0xed: 0xed, 0xf2: 0xf2, 0xf3: 0xf3,
        0xf4: 0xf4, 0xf5: 0xf5, 0xfa: 0xfa
      };
      buf[i] = map[charCode] || 63; // '?'
    }
  }
  return buf;
}

// --- PARSER ---
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

// --- TRANSFORMS ---
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

function transformForCity(blocks, rules, city, dayType) {
  const removeSet = new Set(rules.remove_blocks_by_day[dayType] || []);
  const renameMap = (rules.rename_by_city_by_day[dayType] || {})[city] || {};
  const includeWindows = rules.include_windows_by_day[dayType] || [];

  return blocks
    .filter(b => !removeSet.has(b.time))
    .map(b => {
      let time = b.time;
      let header = b.header;
      if (renameMap[time]) {
        const newTime = renameMap[time];
        header = header.replace(time, newTime);
        time = newTime;
      }
      
      let items = [...b.items];
      if (!isTimeAllowed(time, includeWindows)) {
        const res = keepOnlyCommercials(items);
        items = res.items;
      }
      return new Block(time, header, items);
    });
}

function applyPrefixes(blocks, dayType, config) {
  const options = config.options_by_day[dayType] || config.options_by_day['dia_semana'] || [];
  if (options.length === 0) return;
  
  let idx = 0;
  blocks.forEach(b => {
    b.items.forEach((line, i) => {
      const match = line.match(HOUR_PREFIX_RE);
      if (match) {
        const selected = options[idx % options.length];
        idx++;
        b.items[i] = line.replace(match[2], selected);
      }
    });
  });
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
  
  const state = {}; // To track cycle indices
  
  blocks.forEach(block => {
    block.items.forEach((line, i) => {
      config.substituicoes.forEach(rule => {
        const findList = rule.buscar || [];
        const replaceList = rule.substituir_por || [];
        if (findList.length === 0 || replaceList.length === 0) return;
        
        // Check if any "find" matches
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
          
          // Perform the replacement on the filename part (assumes it's a file path)
          // We look for the part of the line that matches one of the 'buscar' items
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
  const dayOfWeek = date.getDay(); // 0-6
  const usedBlocks = new Set();
  
  // Filtrar apenas jabas que rodam hoje
  const activeJabas = jabasConfig.filter(j => 
    !j.dias_semana || j.dias_semana.includes(dayOfWeek)
  );
  
  activeJabas.forEach(jaba => {
    (jaba.programacao || []).forEach(prog => {
      const eligible = blocks.filter(b => 
        isTimeAllowed(b.time, prog.janelas_de_horario) && !usedBlocks.has(b.time)
      );
      
      if (eligible.length === 0) return;
      
      const count = Math.min(prog.quantidade_necessaria, eligible.length);
      // Random sample (Fisher-Yates style)
      const selected = [...eligible].sort(() => 0.5 - Math.random()).slice(0, count);
      
      selected.forEach(block => {
        // Encontrar ponto de inserção (antes da primeira música Sertão)
        let insertIdx = block.items.length;
        for (let i = 0; i < block.items.length; i++) {
          const line = block.items[i].toUpperCase();
          if (line.includes("M:\\SERTAO\\") || line.includes("M:\\SERTÃO\\")) {
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

// --- MAIN EXPORT ---
window.MusicEngine = {
  process(fileContent, rules, jabas, prefixes, substitutions, date) {
    const logs = [];
    const log = (msg) => logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    
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
              b.items[i] = line.replace(match[2], selected);
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
      logs: logs
    };
  },
  
  download(filename, text) {
    const bytes = stringToCP1252(text);
    const blob = new Blob([bytes], { type: 'text/plain; charset=windows-1252' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
};
