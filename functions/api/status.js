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
    const city = url.searchParams.get('city');

    if (!city) {
      return jsonResponse({ error: 'Missing "city" query parameter.' }, 400);
    }

    const key = `status_${city.toLowerCase()}`;
    const raw = await kv.get(key);

    if (!raw) {
      return jsonResponse({ online: false, message: 'Status unknown' });
    }

    const data = JSON.parse(raw);
    const lastSeen = data.lastSeen || 0;
    const isOnline = (Date.now() - lastSeen) < 120000; // 2 minutes threshold

    return jsonResponse({
      online: isOnline,
      ...data
    });

  } catch (error) {
    return jsonResponse({ error: `Status check failed: ${error.message}` }, 500);
  }
}
