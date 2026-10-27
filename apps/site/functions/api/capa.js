// Cloudflare Pages Function - Busca a capa da música que está tocando
// Respondendo em: /api/capa?artist=...&music=...
// Consulta a iTunes Search API e guarda o resultado no KV para não repetir a busca.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const TTL_ENCONTRADA = 60 * 60 * 24 * 30; // 30 dias
const TTL_NAO_ENCONTRADA = 60 * 60 * 24; // 1 dia, para tentar de novo depois
const TAMANHO_CAPA = '600x600';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
      ...CORS_HEADERS,
    },
  });
}

// Remove acentos, pontuação e caixa para comparar nomes
function normalizar(texto) {
  return (texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Palavras de ligação ignoradas ao comparar artistas ("Henrique e Juliano" = "Henrique & Juliano")
const CONECTORES = new Set(['e', 'x', 'and', 'the']);

function palavras(texto) {
  return normalizar(texto).split(' ').filter((p) => p && !CONECTORES.has(p));
}

function mesmoArtista(nomeItunes, alvo) {
  const doItunes = new Set(palavras(nomeItunes));
  const procuradas = palavras(alvo);
  return procuradas.length > 0 && procuradas.every((p) => doItunes.has(p));
}

// "GUSTAVO MIOTO PART. MURILO HUFF" -> "GUSTAVO MIOTO"
function artistaPrincipal(artista) {
  return artista.split(/\s+(?:part\.?|feat\.?|ft\.?|participa[cç][aã]o)\s+|,/i)[0].trim();
}

// Tira trechos como "(Ao Vivo)" ou "- Acústico" que atrapalham a busca
function limparTitulo(titulo) {
  return titulo.replace(/\s*[([].*?[)\]]\s*/g, ' ').split(/\s+-\s+/)[0].trim();
}

async function buscarNoItunes(artista, musica) {
  const principal = artistaPrincipal(artista);
  const termo = `${principal} ${limparTitulo(musica)}`;
  const url = `https://itunes.apple.com/search?media=music&entity=song&country=BR&limit=10&term=${encodeURIComponent(termo)}`;

  const r = await fetch(url, { headers: { 'User-Agent': 'RadioPopFM/1.0' } });
  if (!r.ok) throw new Error(`iTunes HTTP ${r.status}`);
  const { results = [] } = await r.json();

  const alvoMusica = normalizar(limparTitulo(musica));
  const doArtista = results.filter((m) => mesmoArtista(m.artistName, principal));
  const escolhida = doArtista.find((m) => normalizar(m.trackName).startsWith(alvoMusica)) || doArtista[0];

  return escolhida?.artworkUrl100?.replace('100x100bb', `${TAMANHO_CAPA}bb`) || null;
}

// OPTIONS - CORS preflight
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// GET /api/capa - Retorna { cover: url | null }
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const artista = (url.searchParams.get('artist') || '').trim();
  const musica = (url.searchParams.get('music') || '').trim();

  if (!artista || !musica) {
    return jsonResponse({ error: "Parâmetros 'artist' e 'music' são obrigatórios" }, 400);
  }

  const kv = env.NEWSMAKER_KV;
  const chave = `capa:${normalizar(artista)}|${normalizar(musica)}`;

  if (kv) {
    const salva = await kv.get(chave);
    if (salva !== null) return jsonResponse({ cover: salva || null });
  }

  try {
    const capa = await buscarNoItunes(artista, musica);
    if (kv) {
      await kv.put(chave, capa || '', { expirationTtl: capa ? TTL_ENCONTRADA : TTL_NAO_ENCONTRADA });
    }
    return jsonResponse({ cover: capa });
  } catch (e) {
    console.error('Erro ao buscar capa:', e);
    return jsonResponse({ cover: null }, 502);
  }
}
