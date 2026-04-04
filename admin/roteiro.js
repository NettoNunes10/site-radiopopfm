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

function applyJabas(blocks, jabasConfig) {
  const usedBlocks = new Set();
  
  jabasConfig.forEach(jaba => {
    (jaba.programacao || []).forEach(prog => {
      const eligible = blocks.filter(b => 
        isTimeAllowed(b.time, prog.janelas_de_horario) && !usedBlocks.has(b.time)
      );
      
      if (eligible.length === 0) return;
      
      const count = Math.min(prog.quantidade_necessaria, eligible.length);
      // Random sample (Fisher-Yates style)
      const shuffled = [...eligible].sort(() => 0.5 - Math.random());
      const selected = shuffled.slice(0, count);
      
      selected.forEach(block => {
        // Encontrar ponto de inserção (antes da primeira música Sertão)
        let insertIdx = block.items.length;
        for (let i = 0; i < block.items.length; i++) {
          if (block.items[i].toUpperCase().includes("M:\\SERTAO\\") || block.items[i].toUpperCase().includes("M:\\SERTÃO\\")) {
            insertIdx = i;
            break;
          }
        }
        block.items.splice(insertIdx, 0, buildJabaLine(jaba));
        usedBlocks.add(block.time);
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
  process(fileContent, rules, jabas, prefixes, date) {
    const dayType = getDayType(date);
    const { prelude, blocks: sourceBlocks } = parseBlocks(fileContent);
    
    // Process Itapeva
    const itapevaBlocks = transformForCity(sourceBlocks, rules, 'ITAPEVA', dayType);
    applyPrefixes(itapevaBlocks, dayType, prefixes);
    applyJabas(itapevaBlocks, jabas);
    const itapevaOut = buildOutput(prelude, itapevaBlocks);
    
    // Process Itapetininga
    const itapetiningaBlocks = transformForCity(sourceBlocks, rules, 'ITAPETININGA', dayType);
    applyPrefixes(itapetiningaBlocks, dayType, prefixes);
    applyJabas(itapetiningaBlocks, jabas);
    const itapetiningaOut = buildOutput(prelude, itapetiningaBlocks);
    
    return {
      itapeva: itapevaOut,
      itapetininga: itapetiningaOut
    };
  },
  
  // Helper to download as CP1252
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
