// Cloudflare Pages Function - Estatisticas de ouvintes do streaming
// Respondendo em: /api/estatisticas?periodo=24h|7d|30d
// "agora" vem direto do Shoutcast; o historico vem do D1 que o
// Worker apps/stats-collector preenche a cada 5 minutos.

const STATS_URL = 'https://sonicpanel.oficialserver.com:8134/stats?sid=1&json=1';
const FUSO = -3 * 3600; // Horario de Brasilia (sem horario de verao)
const PERIODOS = {
  '24h': { segundos: 24 * 3600, balde: 300 }, // pontos de 5 min
  '7d': { segundos: 7 * 86400, balde: 3600 }, // media por hora
  '30d': { segundos: 30 * 86400, balde: 86400 }, // media por dia
};

function jsonResponse(data, status = 200, maxAge = 60) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${maxAge}`,
      'X-Robots-Tag': 'noindex',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

async function lerAgora() {
  try {
    const res = await fetch(STATS_URL, {
      cf: { cacheTtl: 20 },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const s = await res.json();
    return {
      ouvintes: Number(s.currentlisteners) || 0,
      unicos: Number(s.uniquelisteners) || 0,
      picoServidor: Number(s.peaklisteners) || 0,
      limite: Number(s.maxlisteners) || 0,
      tempoMedio: Number(s.averagetime) || 0,
      noAr: s.streamstatus === 1,
    };
  } catch {
    return null;
  }
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const periodo = PERIODOS[url.searchParams.get('periodo')] ? url.searchParams.get('periodo') : '24h';
  const { segundos, balde } = PERIODOS[periodo];
  const agoraTs = Math.floor(Date.now() / 1000);
  const desde = agoraTs - segundos;
  const desde30d = agoraTs - 30 * 86400;

  const db = env.STATS_DB;
  if (!db) return jsonResponse({ erro: 'Banco de estatisticas nao configurado' }, 500, 0);

  // O D1 recebe numeros do JS como REAL, por isso os CAST: sem eles a divisao nao arredonda.
  // Baldes alinhados ao horario de Brasilia, para "por dia" virar meia-noite local.
  const [agora, serie, porHora, porDiaSemana, resumo, recorde, inicio] = await Promise.all([
    lerAgora(),
    db.prepare(
      `SELECT (CAST((ts + ?1) / ?2 AS INTEGER) * ?2) - ?1 AS t,
              ROUND(AVG(ouvintes), 1) AS media,
              MAX(ouvintes) AS maximo
         FROM amostras WHERE ts >= ?3
        GROUP BY t ORDER BY t`
    ).bind(FUSO, balde, desde).all(),
    db.prepare(
      `SELECT CAST(((ts + ?1) % 86400) / 3600 AS INTEGER) AS hora, ROUND(AVG(ouvintes), 1) AS media
         FROM amostras WHERE ts >= ?2 AND no_ar = 1
        GROUP BY hora ORDER BY hora`
    ).bind(FUSO, desde30d).all(),
    // 01/01/1970 foi quinta-feira: (dias + 4) % 7 da 0 = domingo
    db.prepare(
      `SELECT (CAST((ts + ?1) / 86400 AS INTEGER) + 4) % 7 AS dia, ROUND(AVG(ouvintes), 1) AS media
         FROM amostras WHERE ts >= ?2 AND no_ar = 1
        GROUP BY dia ORDER BY dia`
    ).bind(FUSO, desde30d).all(),
    db.prepare(
      `SELECT ROUND(AVG(ouvintes), 1) AS media,
              ROUND(AVG(tempo_medio)) AS tempoMedio,
              COUNT(*) AS amostras,
              SUM(CASE WHEN no_ar = 0 THEN 1 ELSE 0 END) AS foraDoAr
         FROM amostras WHERE ts >= ?1`
    ).bind(desde).first(),
    db.prepare(
      `SELECT ouvintes, ts FROM amostras WHERE ts >= ?1
        ORDER BY ouvintes DESC, ts DESC LIMIT 1`
    ).bind(desde).first(),
    db.prepare('SELECT MIN(ts) AS ts FROM amostras').first(),
  ]);

  return jsonResponse({
    periodo,
    atualizadoEm: agoraTs,
    agora,
    resumo: { ...resumo, recorde: recorde || null },
    serie: serie.results,
    porHora: porHora.results,
    porDiaSemana: porDiaSemana.results,
    coletaDesde: inicio?.ts || null,
  });
}
