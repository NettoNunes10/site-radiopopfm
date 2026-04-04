// Cloudflare Pages Function - Dispatch de Playlists (.bil) para Estúdios
// Respondendo em: /api/playlist

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

  if (!authorize(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const kv = env.NEWSMAKER_KV;
  if (!kv) {
    return jsonResponse({ error: 'KV namespace not configured on server.' }, 500);
  }

  try {
    const body = await request.json();
    const { city, date, content, filename } = body;

    if (!city || !date || !content) {
      return jsonResponse({ error: 'Missing city, date or content in payload.' }, 400);
    }

    const cityKey = city.toLowerCase();
    const version = Date.now().toString();

    const payload = {
      city: cityKey,
      date,
      filename,
      content, // O conteúdo já vem em base64 ou string (o roteiro é texto)
      version,
      dispatched_at: new Date().toISOString()
    };

    // Armazena a versão mais recente para a cidade
    await kv.put(`playlist:latest:${cityKey}`, JSON.stringify(payload), { expirationTtl: 86400 * 7 }); // 1 semana

    // Armazena por data para backup/histórico
    await kv.put(`playlist:${cityKey}:${date}`, JSON.stringify(payload), { expirationTtl: 86400 * 7 });

    return jsonResponse({ success: true, version, city: cityKey });

  } catch (error) {
    return jsonResponse({ error: `Upload failed: ${error.message}` }, 500);
  }
}

// GET /api/playlist - Receptor Python/Sync busca a playlist (polling)
// Query params: city (obrigatório), version (opcional)
export async function onRequestGet(context) {
  const { request, env } = context;

  if (!authorize(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const kv = env.NEWSMAKER_KV;
  if (!kv) {
    return jsonResponse({ error: 'KV namespace not configured on server.' }, 500);
  }

  try {
    const url = new URL(request.url);
    const city = url.searchParams.get('city');
    const clientVersion = url.searchParams.get('version');

    if (!city) {
      return jsonResponse({ error: 'Missing "city" query parameter.' }, 400);
    }

    const cityKey = city.toLowerCase();

    // --- HEARTBEAT LOGIC --- (Opcional, mas útil para o dashboard)
    const host = request.headers.get("X-Sync-Host") || "Desconhecido";
    await kv.put(`status_playlist_${cityKey}`, JSON.stringify({
      host: host,
      lastSeen: Date.now(),
      type: 'music_sync'
    }), { expirationTtl: 3600 });
    // --- END HEARTBEAT ---

    const raw = await kv.get(`playlist:latest:${cityKey}`);
    if (!raw) {
      return jsonResponse({ message: 'No playlist available.' }, 204);
    }

    const data = JSON.parse(raw);

    // Se o cliente já tem essa versão, retorna 304
    if (clientVersion && clientVersion === data.version) {
      return new Response(null, { status: 304, headers: CORS_HEADERS });
    }

    return jsonResponse({
      city: data.city,
      date: data.date,
      filename: data.filename,
      version: data.version,
      content: data.content, // O .bil em texto
      dispatched_at: data.dispatched_at
    });

  } catch (error) {
    return jsonResponse({ error: `Fetch failed: ${error.message}` }, 500);
  }
}
