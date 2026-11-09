// Coletor de ouvintes da Pop FM.
// A cada execucao do cron, le o JSON publico do Shoutcast e grava uma amostra no D1.
// Se o servidor nao responder, grava a amostra com no_ar = 0 e ouvintes = 0,
// para o grafico mostrar a queda em vez de um buraco.

async function coletar(env) {
  // Arredonda para o minuto, assim uma execucao repetida nao duplica a linha.
  const ts = Math.floor(Date.now() / 60000) * 60;
  let linha = { ouvintes: 0, unicos: 0, pico: 0, tempo_medio: 0, no_ar: 0 };

  try {
    const res = await fetch(env.STATS_URL, {
      headers: { 'User-Agent': 'popfm-stats-collector' },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const s = await res.json();
      linha = {
        ouvintes: Number(s.currentlisteners) || 0,
        unicos: Number(s.uniquelisteners) || 0,
        pico: Number(s.peaklisteners) || 0,
        tempo_medio: Number(s.averagetime) || 0,
        no_ar: s.streamstatus === 1 ? 1 : 0,
      };
    }
  } catch (err) {
    console.log('Falha ao ler o Shoutcast:', err.message);
  }

  await env.STATS_DB.prepare(
    `INSERT OR REPLACE INTO amostras (ts, ouvintes, unicos, pico, tempo_medio, no_ar)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(ts, linha.ouvintes, linha.unicos, linha.pico, linha.tempo_medio, linha.no_ar)
    .run();

  return { ts, ...linha };
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(coletar(env));
  },

  // Sem rota publica: o Worker so existe para o cron.
  async fetch() {
    return new Response('Not found', { status: 404 });
  },
};
