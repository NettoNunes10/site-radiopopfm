const PROGRAMAS = [
  { num: '01', img: 'public/programas/universo-caipira.webp', nome: 'Universo Caipira', desc: 'O melhor do sertanejo raiz para começar o dia com a alma no interior.', dias: 'SEG – SEX', hor: '06h às 08h', rot: -1.4 },
  { num: '02', img: 'public/programas/manha-da-pop.webp', nome: 'Manhã da Pop', desc: 'Hits, notícias e bom humor para dar o play na sua manhã.', dias: 'SEG – SÁB', hor: '08h às 12h', rot: 1.2 },
  { num: '03', img: 'public/programas/pop-news.webp', nome: 'Pop News', desc: 'O resumo do que importa no Brasil e no mundo, direto ao ponto.', dias: 'SEG – SEX', hor: '12h às 13h', rot: -0.8 },
  { num: '04', img: 'public/programas/interligado.webp', nome: 'Interligado', desc: 'A tarde inteira conectada com música, participação e entretenimento.', dias: 'SEG – SÁB', hor: '13h às 17h', rot: 1.6 },
  { num: '05', img: 'public/programas/arena-show.webp', nome: 'Arena Show', desc: 'O melhor do country e do sertanejo no clima de rodeio para fechar a tarde.', dias: 'SEG – SEX', hor: '17h às 19h', rot: -1.2 },
  { num: '06', img: 'public/programas/voz-do-brasil.webp', nome: 'Voz do Brasil', desc: 'Transmissão oficial com as principais informações dos três poderes.', dias: 'SEG – SEX', hor: '21h às 22h', rot: 0.9 },
  { num: '07', img: 'public/programas/1-hora-sem-intervalo.webp', nome: '1 Hora Sem Intervalo', desc: 'Sessenta minutos de música direto, sem pausa e sem enrolação.', dias: 'SÁBADO', hor: '12h às 13h', rot: -1.6 },
];

const GRADE_UTIL = [
  { n: 'Universo Caipira', h: '06h – 08h', ini: 6, fim: 8 },
  { n: 'Manhã da Pop', h: '08h – 12h', ini: 8, fim: 12 },
  { n: 'Pop News', h: '12h – 13h', ini: 12, fim: 13 },
  { n: 'Interligado', h: '13h – 17h', ini: 13, fim: 17 },
  { n: 'Arena Show', h: '17h – 19h', ini: 17, fim: 19 },
  { n: 'Voz do Brasil', h: '21h – 22h', ini: 21, fim: 22 },
];

const GRADE_SABADO = [
  { n: 'Manhã da Pop', h: '08h – 12h', ini: 8, fim: 12 },
  { n: '1 Hora Sem Intervalo', h: '12h – 13h', ini: 12, fim: 13 },
  { n: 'Interligado', h: '13h – 17h', ini: 13, fim: 17 },
];

const GRADE_DOMINGO = [
  { n: 'Programação musical', h: '00h – 24h', ini: 0, fim: 24 },
];

const STREAM_URL = 'https://sonicpanel.oficialserver.com:8134/stream';
const SUPABASE_URL = 'https://uvesuhizitwlkbizjxlc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2ZXN1aGl6aXR3bGtiaXpqeGxjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwOTAwNzksImV4cCI6MjA5MDY2NjA3OX0.MPmV_TuX3z_i0_91VNRUwSMVeGBqDzGXNwMMeFOhF9w';
const CAPA_PADRAO = 'public/capa-padrao.jpg';
const CAPA_API = '/api/capa';
const NOW_PLAYING_INTERVALO = 10000;

const NOMES_DIAS =['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0];

const RING_TARGET_DEG = 324; // 90% de 360°
const RING_TRACK = 'rgba(246,243,236,.12)';
const COUNT_DURATION = 1400;
const GRADE_STEP = 350;
const REVEAL_SHIFT = '30px';
const VOLUME_PADRAO = 72;

const reduzirMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function gradeFixa(d) {
  return d === 0 ? GRADE_DOMINGO : d === 6 ? GRADE_SABADO : GRADE_UTIL;
}

function supabase(caminho) {
  return fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    cache: 'no-store',
  }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));
}

const horaDecimal = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h + m / 60;
};

const nomePrograma = (nome) => nome.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

// Converte as linhas da tabela "schedule" (painel) em uma grade por dia da semana.
// Dias sem nenhum programa cadastrado (ex.: domingo) ficam com a programação musical.
function gradeDoSupabase(linhas) {
  return (d) => {
    const doDia = linhas
      .filter((p) => p.active_days && p.active_days.includes(d))
      .sort((a, b) => a.start_time.localeCompare(b.start_time))
      .map((p) => {
        const ini = horaDecimal(p.start_time);
        const fim = horaDecimal(p.end_time) || 24;
        return {
          n: nomePrograma(p.program_name),
          h: `${p.start_time.slice(0, 2)}h – ${p.end_time.slice(0, 2)}h`,
          ini,
          fim,
        };
      });
    return doDia.length ? doDia : GRADE_DOMINGO;
  };
}

function montarSemana(gradeDoDia = gradeFixa) {
  const agora = new Date();
  const hojeIdx = agora.getDay();
  const hora = agora.getHours() + agora.getMinutes() / 60;

  return ORDEM_DIAS.map((d) => {
    const base = gradeDoDia(d);
    return {
      nome: NOMES_DIAS[d],
      hoje: d === hojeIdx,
      grade: base.map((p) => ({
        n: p.n,
        h: p.h,
        live: d === hojeIdx && hora >= p.ini && hora < p.fim,
      })),
    };
  });
}

function criarSlot(programa) {
  const slot = document.createElement('div');
  slot.className = 'slot';

  const head = document.createElement('div');
  head.className = 'slot__head';

  const nome = document.createElement('span');
  nome.className = 'slot__nome';
  nome.textContent = programa.n;
  head.append(nome);

  if (programa.live) {
    const live = document.createElement('span');
    live.className = 'slot__live';
    live.textContent = 'NO AR';
    head.append(live);
  }

  const hora = document.createElement('span');
  hora.className = 'slot__hora';
  hora.textContent = programa.h;

  slot.append(head, hora);
  return slot;
}

function criarCardDia(dia) {
  const card = document.createElement('div');
  card.className = 'dia';

  const head = document.createElement('div');
  head.className = 'dia__head';

  const nome = document.createElement('div');
  nome.className = 'dia__nome';
  nome.textContent = dia.nome;
  head.append(nome);

  if (dia.hoje) {
    const hoje = document.createElement('span');
    hoje.className = 'dia__hoje';
    hoje.textContent = 'HOJE';
    head.append(hoje);
  }

  const grade = document.createElement('div');
  grade.className = 'dia__grade';
  dia.grade.forEach((p) => grade.append(criarSlot(p)));

  card.append(head, grade);
  return card;
}

function criarCardPrograma(prog) {
  const card = document.createElement('div');
  card.className = 'programa';
  card.dataset.reveal = '';
  card.style.setProperty('--rot', `${prog.rot}deg`);

  const num = document.createElement('span');
  num.className = 'programa__num';
  num.textContent = prog.num;

  const img = document.createElement('div');
  img.className = 'programa__img';
  const foto = document.createElement('img');
  foto.src = prog.img;
  foto.alt = `Arte do programa ${prog.nome}`;
  foto.width = 800;
  foto.height = 448;
  foto.loading = 'lazy';
  foto.decoding = 'async';
  img.append(foto);

  const texto = document.createElement('div');
  const nome = document.createElement('div');
  nome.className = 'programa__nome';
  nome.textContent = prog.nome;
  const desc = document.createElement('p');
  desc.className = 'programa__desc';
  desc.textContent = prog.desc;
  texto.append(nome, desc);

  const tags = document.createElement('div');
  tags.className = 'programa__tags';
  tags.append(criarChip(prog.dias, 'purple'), criarChip(prog.hor, 'yellow'));

  card.append(num, img, texto, tags);
  return card;
}

function criarChip(texto, cor) {
  const chip = document.createElement('span');
  chip.className = 'chip';
  const dot = document.createElement('span');
  dot.className = `chip__dot chip__dot--${cor}`;
  chip.append(dot, document.createTextNode(texto));
  return chip;
}

function renderizarGrade(gradeDoDia) {
  const alvo = document.querySelector('[data-grade]');
  alvo.replaceChildren(...montarSemana(gradeDoDia).map(criarCardDia));
}

// A grade fixa aparece na hora; se o Supabase responder, ela é trocada pela grade do painel.
function carregarGrade() {
  renderizarGrade();
  supabase('schedule?order=ordem.asc')
    .then((linhas) => {
      if (Array.isArray(linhas) && linhas.length) renderizarGrade(gradeDoSupabase(linhas));
    })
    .catch((e) => console.error('Erro ao buscar a grade:', e));
}

function renderizarProgramas() {
  const alvo = document.querySelector('[data-programas]');
  PROGRAMAS.forEach((prog) => alvo.append(criarCardPrograma(prog)));
}

function animarContador(el) {
  const alvo = parseFloat(el.dataset.count);
  const inicio = performance.now();
  const passo = (t) => {
    const p = Math.min(1, (t - inicio) / COUNT_DURATION);
    const ease = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(alvo * ease);
    if (p < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

function pintarAnel(ring, graus) {
  ring.style.background = `conic-gradient(var(--purple) ${graus}deg, ${RING_TRACK} ${graus}deg)`;
}

function animarAnel(ring) {
  const inicio = performance.now();
  const passo = (t) => {
    const p = Math.min(1, (t - inicio) / COUNT_DURATION);
    const ease = 1 - Math.pow(1 - p, 3);
    pintarAnel(ring, RING_TARGET_DEG * ease);
    if (p < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

function preencherBarra(el) {
  el.style.height = `${el.dataset.bar}%`;
}

function aplicarEstadoFinal(el) {
  el.querySelectorAll('[data-count]').forEach((c) => { c.textContent = c.dataset.count; });
  el.querySelectorAll('[data-bar]').forEach(preencherBarra);
  const ring = el.querySelector('#ring-confianca');
  if (ring) pintarAnel(ring, RING_TARGET_DEG);
}

function initReveal() {
  const alvos = document.querySelectorAll('[data-reveal]');

  if (reduzirMovimento) {
    alvos.forEach(aplicarEstadoFinal);
    return;
  }

  const io = new IntersectionObserver((entradas) => {
    entradas.forEach((e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      e.target.style.opacity = '1';
      e.target.style.translate = '0 0';
      e.target.querySelectorAll('[data-count]').forEach(animarContador);
      e.target.querySelectorAll('[data-bar]').forEach(preencherBarra);
      const ring = e.target.querySelector('#ring-confianca');
      if (ring) animarAnel(ring);
    });
  }, { threshold: 0.18 });

  // O estado inicial é aplicado por JS (e não no CSS) para que a página continue
  // legível caso o script não carregue.
  alvos.forEach((el) => {
    if (el.dataset.delay) el.style.setProperty('--reveal-delay', `${el.dataset.delay}ms`);
    el.style.opacity = '0';
    el.style.translate = `0 ${REVEAL_SHIFT}`;
    io.observe(el);
  });
}

// O player abre mudo: tanto o play quanto o botão de volume são o gesto que libera o som.
function initPlayer() {
  const play = document.querySelector('[data-play]');
  const playIcon = document.querySelector('[data-play-icon]');
  const volBtn = document.querySelector('[data-vol-btn]');
  const volIcon = document.querySelector('[data-vol-icon]');
  const pop = document.querySelector('[data-vol-pop]');
  const range = document.querySelector('[data-vol-range]');

  const audio = new Audio();
  audio.preload = 'none';
  let tocando = false;

  const aplicarVolume = (v) => {
    range.value = v;
    range.style.setProperty('--pos', `${v}%`);
    audio.volume = v / 100;
    volIcon.setAttribute('href', v > 0 ? '#i-volume' : '#i-volume-off');
    volBtn.setAttribute('aria-label', v > 0 ? 'Ajustar volume' : 'Ativar som');
  };

  const definirTocando = (estado) => {
    tocando = estado;
    playIcon.setAttribute('href', estado ? '#i-pause' : '#i-play');
    play.setAttribute('aria-label', estado ? 'Pausar' : 'Tocar');
  };

  const definirCarregando = (estado) => play.classList.toggle('player__play--carregando', estado);

  // Ao pausar, o stream é desconectado; ao voltar, reconecta no ao vivo em vez de tocar o atraso do buffer.
  const tocar = () => {
    audio.src = STREAM_URL;
    definirTocando(true);
    definirCarregando(true);
    audio.play().catch((e) => {
      console.error('Erro ao iniciar o áudio:', e);
      definirTocando(false);
      definirCarregando(false);
    });
  };

  const parar = () => {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    definirTocando(false);
    definirCarregando(false);
  };

  audio.addEventListener('playing', () => definirCarregando(false));
  audio.addEventListener('waiting', () => { if (tocando) definirCarregando(true); });
  audio.addEventListener('error', () => { if (tocando && audio.src) parar(); });

  const abrirVolume = (aberto) => {
    pop.classList.toggle('volume-pop--aberto', aberto);
    volBtn.setAttribute('aria-expanded', String(aberto));
  };

  const ligarSom = () => {
    if (Number(range.value) === 0) aplicarVolume(VOLUME_PADRAO);
    if (!tocando) tocar();
  };

  play.addEventListener('click', () => {
    if (tocando) parar();
    else ligarSom();
  });

  // "Ouvir ao vivo" do menu leva ao player e já começa a tocar.
  document.querySelectorAll('.nav__live').forEach((link) => link.addEventListener('click', ligarSom));

  volBtn.addEventListener('click', () => {
    ligarSom();
    abrirVolume(!pop.classList.contains('volume-pop--aberto'));
  });

  range.addEventListener('input', () => aplicarVolume(Number(range.value)));

  document.addEventListener('click', (e) => {
    if (!volBtn.contains(e.target) && !pop.contains(e.target)) abrirVolume(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') abrirVolume(false);
  });
}

function initTocandoAgora() {
  const faixa = document.querySelector('[data-track]');
  const artista = document.querySelector('[data-artist]');
  const capa = document.querySelector('[data-cover]');

  capa.addEventListener('error', () => {
    capaBuscada = null;
    if (!capa.src.endsWith(CAPA_PADRAO)) capa.src = CAPA_PADRAO;
  });

  const trocarCapa = (novaCapa) => {
    if (capa.getAttribute('src') !== novaCapa) capa.src = novaCapa;
  };

  // Guarda a última música consultada para buscar a capa só quando ela muda
  let ultimaMusica = '';
  let capaBuscada = null;

  const atualizar = () => supabase('now_playing?select=*&order=created_at.desc&limit=1')
    .then(([atual]) => {
      faixa.textContent = atual?.music || 'Rádio Pop FM';
      artista.textContent = atual?.artist || 'A melhor programação';

      if (atual?.cover || !atual?.music || !atual?.artist) {
        trocarCapa(atual?.cover || CAPA_PADRAO);
        return;
      }

      const chave = `${atual.artist}|${atual.music}`;
      if (chave === ultimaMusica) {
        trocarCapa(capaBuscada || CAPA_PADRAO);
        return;
      }
      ultimaMusica = chave;
      capaBuscada = null;
      trocarCapa(CAPA_PADRAO);

      const params = new URLSearchParams({ artist: atual.artist, music: atual.music });
      return fetch(`${CAPA_API}?${params}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((dados) => {
          if (chave !== ultimaMusica || !dados?.cover) return;
          capaBuscada = dados.cover;
          trocarCapa(capaBuscada);
        });
    })
    .catch((e) => console.error('Erro ao buscar a música atual:', e));

  atualizar();
  setInterval(atualizar, NOW_PLAYING_INTERVALO);
}

function initMenuMobile() {
  const burger = document.querySelector('[data-burger]');
  const menu = document.querySelector('[data-nav-menu]');
  const nav = burger.closest('.nav');

  const abrirMenu = (aberto) => {
    menu.classList.toggle('nav__menu--aberto', aberto);
    burger.classList.toggle('nav__burger--aberto', aberto);
    burger.setAttribute('aria-expanded', String(aberto));
    burger.setAttribute('aria-label', aberto ? 'Fechar menu' : 'Abrir menu');
  };

  burger.addEventListener('click', () => abrirMenu(!menu.classList.contains('nav__menu--aberto')));
  menu.addEventListener('click', (e) => {
    if (e.target.closest('a')) abrirMenu(false);
  });

  document.addEventListener('click', (e) => {
    if (!nav.contains(e.target)) abrirMenu(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') abrirMenu(false);
  });
}

function initControlesGrade() {
  const grade = document.querySelector('[data-grade]');
  const rolar = (delta) => grade.scrollBy({ left: delta, behavior: reduzirMovimento ? 'auto' : 'smooth' });
  document.querySelector('[data-grade-prev]').addEventListener('click', () => rolar(-GRADE_STEP));
  document.querySelector('[data-grade-next]').addEventListener('click', () => rolar(GRADE_STEP));
}

carregarGrade();
renderizarProgramas();
initControlesGrade();
initMenuMobile();
initPlayer();
initTocandoAgora();
initReveal();
