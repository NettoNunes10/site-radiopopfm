// Cloudflare Pages Function - Dispatch de Playlists (.bil) para Estúdios
// Respondendo em: /api/playlist

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data, status = 200) {
  const isNoBody = status === 204 || status === 304;
  return new Response(isNoBody ? null : JSON.stringify(data), {
    status,
    headers: { 
      'Content-Type': isNoBody ? null : 'application/json', 
      'Cache-Control': 'no-store',
      ...CORS_HEADERS 
    },
  });
}

function authorize(request, env) {
  const authHeader = (request.headers.get('authorization') || request.headers.get('Authorization') || '').trim();
  const expectedPassword = env.NEWSMAKER_PASSWORD;
  
  if (!expectedPassword || expectedPassword.trim() === '') {
    return false;
  }
  
  return authHeader === `Bearer ${expectedPassword}`;
}

// OPTIONS - CORS preflight
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// POST /api/playlist - Enviar .bil para o KV (chamado pelo site)
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!authorize(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);

  const kv = env.NEWSMAKER_KV;
  if (!kv) return jsonResponse({ error: 'KV namespace not configured.' }, 500);

  try {
    const body = await request.json();
    const { city, date, content, filename } = body;

    if (!city || !date || !content) {
      return jsonResponse({ error: 'Missing city, date or content in payload.' }, 400);
    }

    const cityKey = city.toLowerCase();
    const payload = {
      city: cityKey,
      date,
      filename,
      content,
      dispatched_at: new Date().toISOString()
    };

    // Armazena por data para sincronização (chave primária)
    await kv.put(`playlist:${cityKey}:${date}`, JSON.stringify(payload), { expirationTtl: 86400 * 7 });

    return jsonResponse({ success: true, city: cityKey, date });

  } catch (error) {
    return jsonResponse({ error: `Upload failed: ${error.message}` }, 500);
  }
}

// GET /api/playlist - Receptor busca a playlist por data
export async function onRequestGet(context) {
  const { request, env } = context;
  if (!authorize(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);

  const kv = env.NEWSMAKER_KV;
  if (!kv) return jsonResponse({ error: 'KV namespace not configured.' }, 500);

  try {
    const url = new URL(request.url);
    const city = url.searchParams.get('city');
    let date = url.searchParams.get('date');

    if (!city) return jsonResponse({ error: 'Missing "city" parameter.' }, 400);
    const cityKey = city.toLowerCase();

    // Se não informou data, devolve a MAIS ANTIGA disponível (Opção A)
    if (!date) {
      // Lista as chaves filtradas por cidade. A ordenação do KV é lexicográfica, 
      // então 'playlist:city:20240401' virá antes de 'playlist:city:20240402'.
      const list = await kv.list({ prefix: `playlist:${cityKey}:`, limit: 1 });
      
      if (list.keys.length === 0) {
        return jsonResponse({ message: 'No playlists pending.' }, 204);
      }

      // Pega o conteúdo da chave mais antiga encontrada
      const raw = await kv.get(list.keys[0].name);
      return new Response(raw, { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
    }

    const raw = await kv.get(`playlist:${cityKey}:${date}`);
    if (!raw) return jsonResponse({ message: 'Playlist not found for date.' }, 204);

    return new Response(raw, { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });

  } catch (error) {
    return jsonResponse({ error: `Fetch failed: ${error.message}` }, 500);
  }
}

// DELETE /api/playlist - Apaga a playlist do KV após download
export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!authorize(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);

  const kv = env.NEWSMAKER_KV;
  if (!kv) return jsonResponse({ error: 'KV namespace not configured.' }, 500);

  try {
    const url = new URL(request.url);
    const city = url.searchParams.get('city');
    const date = url.searchParams.get('date');

    if (!city || !date) {
      return jsonResponse({ error: 'Missing "city" or "date" parameters.' }, 400);
    }

    const cityKey = city.toLowerCase();
    await kv.delete(`playlist:${cityKey}:${date}`);

    return jsonResponse({ success: true, message: `Playlist ${date} removida.` });

  } catch (error) {
    return jsonResponse({ error: `Delete failed: ${error.message}` }, 500);
  }
}
