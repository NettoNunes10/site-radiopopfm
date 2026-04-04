// Cloudflare Pages Function - Check Studio App Status
// Respondendo em: /api/status

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

// GET /api/status - Consulta status do estúdio (KV)
// Query params: city (obrigatório)
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
    const city = url.searchParams.get('city')?.toLowerCase();

    if (!city) {
      return jsonResponse({ error: 'Missing "city" query parameter.' }, 400);
    }

    // Keys for News and Playlist heartbeats
    const newsKey = `status_${city}`;
    const playlistKey = `status_playlist_${city}`;

    const [newsRaw, playlistRaw] = await Promise.all([
      kv.get(newsKey),
      kv.get(playlistKey)
    ]);

    const now = Date.now();
    const threshold = 120000; // 2 minutes

    const newsStatus = newsRaw ? JSON.parse(newsRaw) : null;
    const playlistStatus = playlistRaw ? JSON.parse(playlistRaw) : null;

    return jsonResponse({
      city,
      news: newsStatus ? {
        online: (now - (newsStatus.lastSeen || 0)) < threshold,
        ...newsStatus
      } : { online: false, message: 'Status unknown' },
      playlist: playlistStatus ? {
        online: (now - (playlistStatus.lastSeen || 0) < threshold),
        ...playlistStatus
      } : { online: false, message: 'Status unknown' },
      // Backward compatibility for old NewsMaker if needed during transition
      online: newsStatus ? (now - (newsStatus.lastSeen || 0)) < threshold : false,
      host: newsStatus?.host || 'Desconhecido',
      lastSeen: newsStatus?.lastSeen || 0
    });

  } catch (error) {
    return jsonResponse({ error: `Status check failed: ${error.message}` }, 500);
  }
}
