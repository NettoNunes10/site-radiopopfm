/**
 * MusicEngine - Motor Centralizado de Processamento de Playlists
 * Versão Unificada (Browser + API/Workers)
 */

// --- UTILS ---
const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const normalizeHHMM = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

const getDayType = (date) => {
  const day = date.getDay(); // 0=Sun, 6=Sat
  if (day === 0) return 'domingo';
  if (day === 6) return 'sabado';
  return 'dia_semana';
};

const stringToCP1252 = (str) => {
  const map = {
    'Á': 0xC1, 'À': 0xC0, 'Â': 0xC2, 'Ã': 0xC3, 'É': 0xC9, 'Ê': 0xCA, 'Í': 0xCD, 'Ó': 0xD3, 'Ô': 0xD4, 'Õ': 0xD5, 'Ú': 0xDA, 'Ç': 0xC7,
    'á': 0xE1, 'à': 0xE0, 'â': 0xE2, 'ã': 0xE3, 'é': 0xE9, 'ê': 0xEA, 'í': 0xED, 'ó': 0xF3, 'ô': 0xF4, 'õ': 0xF5, 'ú': 0xFA, 'ç': 0xE7,
    'º': 0xBA, 'ª': 0xAA
  };
  const buf = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const charCode = str.charCodeAt(i);
    if (map[char]) {
      buf[i] = map[char];
    } else if (charCode < 128) {
      buf[i] = charCode;
    } else {
      buf[i] = 63; // '?'
    }
  }
  return buf;
};

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

const parseBlocks = (text) => {
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
};

const findCommercialBounds = (items) => {
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
};

const keepOnlyCommercials = (items) => {
  const bounds = findCommercialBounds(items);
  if (!bounds) return { items: [...items], hadCommercial: false };
  return { items: items.slice(bounds[0], bounds[1] + 1), hadCommercial: true };
};

const inWindow = (timeMin, window) => {
  const start = toMinutes(window.inicio);
  const end = toMinutes(window.fim);
  if (start <= end) return timeMin >= start && timeMin <= end;
  return timeMin >= start || timeMin <= end;
};

const isTimeAllowed = (hhmm, windows) => {
  if (!windows || windows.length === 0) return true;
  const minutes = toMinutes(hhmm);
  return windows.some(w => inWindow(minutes, w));
};

const buildJabaLine = (jaba) => {
  const duration = jaba.duracao_ms || 0;
  const intro = jaba.cue_intro_ms || 0;
  const segue = jaba.cue_segue_ms || 0;
  const f = duration + segue;
  return `${jaba.caminho_arquivo} /m:3950 /t:${duration} /i:${intro} /s:${segue} /f:${f} /r:0 /d:0 /o:0 /n:1 /x:  /g:0`;
};

const applySubstitutions = (blocks, config, city, log) => {
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
};

const applyJabas = (blocks, jabasConfig, date, city, log) => {
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
};

const applyPromos = (blocks, promosConfig, date, city, log) => {
  if (!promosConfig || promosConfig.length === 0) return;
  const targetDateStr = date.toISOString().split('T')[0];
  let activePromos = promosConfig.filter(p => p.enabled && (!p.data_limite || p.data_limite >= targetDateStr));
  if (activePromos.length === 0) return;

  activePromos.forEach(p => {
    if (p.overlay) {
      let removedCount = 0;
      blocks.forEach(b => {
        const initialCount = b.items.length;
        b.items = b.items.filter(line => !line.toUpperCase().includes(p.caminho_arquivo.toUpperCase()));
        if (b.items.length < initialCount) removedCount += (initialCount - b.items.length);
      });
      if (removedCount > 0) log(`${city}: Overlay ativado para '${p.id}'. Removidas ${removedCount} instâncias prévias.`);
    }
  });

  activePromos = activePromos.filter(p => {
    const alreadyInFile = blocks.some(b => b.items.some(line => line.toUpperCase().includes(p.caminho_arquivo.toUpperCase())));
    if (alreadyInFile) log(`${city}: Promoção '${p.id}' já estava presente no roteiro da rede. Ignorando.`);
    return !alreadyInFile;
  });
  if (activePromos.length === 0) return;

  const dayType = getDayType(date);
  const usedHours = new Set();

  blocks.forEach(block => {
    const hourPrefix = block.time.substring(0, 2);
    if (usedHours.has(hourPrefix)) return;

    const validPromosForHour = activePromos.filter(p => {
      let horas = [];
      if (dayType === 'sabado') horas = p.horas_sabado || p.horas_ativas || [];
      else if (dayType === 'domingo') horas = p.horas_domingo || p.horas_ativas || [];
      else horas = p.horas_dia_semana || p.horas_ativas || [];
      return horas.includes(hourPrefix);
    });

    if (validPromosForHour.length === 0) return;

    for (let i = 0; i < block.items.length; i++) {
      if (COMM_END_RE.test(block.items[i]) || block.items[i].includes('Término do bloco comercial')) {
        let songsFound = 0;
        let insertIdx = i + 1;
        for (let j = i + 1; j < block.items.length; j++) {
          if (block.items[j].toUpperCase().startsWith("M:")) {
            songsFound++;
            if (songsFound === 2) { insertIdx = j + 1; break; }
          }
        }
        const spliceArgs = [insertIdx, 0];
        validPromosForHour.forEach(p => {
          spliceArgs.push(buildJabaLine({
            caminho_arquivo: p.caminho_arquivo,
            duracao_ms: p.duracao_ms || 1500,
            cue_intro_ms: 0,
            cue_segue_ms: 0
          }));
        });
        block.items.splice(...spliceArgs);
        log(`${city}: Promoções (Qtd: ${validPromosForHour.length}) inseridas no bloco ${block.time} (Hora ${hourPrefix}).`);
        usedHours.add(hourPrefix);
        break;
      }
    }
  });
};

const buildOutput = (prelude, blocks) => {
  let out = prelude.join('\r\n') + (prelude.length ? '\r\n' : '');
  blocks.forEach(b => {
    out += b.header + '\r\n';
    out += b.items.join('\r\n') + (b.items.length ? '\r\n' : '');
  });
  return out;
};

// --- ENGINE OBJECT ---
export const MusicEngine = {
  process(fileContent, rules, jabas, prefixes, substitutions, date, promos = []) {
    const logs = [];
    const log = (msg) => logs.push(`[${new Date().toLocaleTimeString('pt-BR')}] ${msg}`);
    const dayType = getDayType(date);
    const { prelude, blocks: sourceBlocks } = parseBlocks(fileContent);

    const processCity = (city) => {
      log(`--- Processando ${city} ---`);
      const removeSet = new Set(rules.remover_blocos?.[dayType] || []);
      const renameMap = (rules.renomear_blocos?.[dayType] || {})[city] || {};
      const includeWindows = rules.janelas_permitidas?.[dayType] || [];

      const cityBlocks = sourceBlocks
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

      applySubstitutions(cityBlocks, substitutions, city, log);

      const prefOptions = prefixes.options_by_day?.[dayType] || prefixes.options_by_day?.['dia_semana'] || [];
      if (prefOptions.length > 0) {
        let idx = 0;
        cityBlocks.forEach(b => {
          b.items.forEach((line, i) => {
            const match = line.match(HOUR_PREFIX_RE);
            if (match) {
              b.items[i] = line.replace(match[1] + match[2], prefOptions[idx % prefOptions.length]);
              idx++;
            }
          });
        });
      }

      applyJabas(cityBlocks, jabas, date, city, log);
      applyPromos(cityBlocks, promos, date, city, log);

      return buildOutput(prelude, cityBlocks);
    };

    return {
      itapeva: processCity('ITAPEVA'),
      itapetininga: processCity('ITAPETININGA'),
      logs
    };
  },

  download(filename, text) {
    if (typeof window === 'undefined') return;
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

// Fallback para Browser (index.html rodando sem type="module")
if (typeof window !== 'undefined') {
  window.MusicEngine = MusicEngine;
  window.normalizeHHMM = normalizeHHMM;
  window.stringToCP1252 = stringToCP1252;
}
