// Cloudflare Pages Function - Dispatch de Boletins Separado por Cidade
// Respondendo em: /api/dispatch

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function authorize(request, env) {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  const expectedPassword = env.NEWSMAKER_PASSWORD;
  if (!expectedPassword || authHeader !== `Bearer ${expectedPassword}`) {
    return false;
  }
  return true;
}

// OPTIONS - CORS preflight
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// POST /api/dispatch - Enviar boletins para o KV (chamado pelo site)
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!authorize(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const kv = env.NEWSMAKER_KV;
  if (!kv) {
    return jsonResponse({ error: 'KV namespace not configured on server (NEWSMAKER_KV).' }, 500);
  }

  try {
    const body = await request.json();
    const { date, notes } = body;

    if (!date || !notes || !notes.nacional) {
      return jsonResponse({ error: 'Missing date or complete notes in payload.' }, 400);
    }

    const version = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const dispatchedAt = new Date().toISOString(); 
    const citiesFound = [];

    // Cidades suportadas conforme o frontend
    const cities = ['itapeva', 'itapetininga'];

    for (const city of cities) {
      if (notes[city]) {
        const cityPayload = {
          date,
          version,
          dispatched_at: dispatchedAt,
          notes: {
            nacional: notes.nacional,
            [city]: notes[city]
          }
        };

        // Salva o "latest" da cidade
        await kv.put(`dispatch:${city}:latest`, JSON.stringify(cityPayload), { expirationTtl: 172800 }); // 48h
        
        // Salva o histórico por data da cidade
        await kv.put(`dispatch:${city}:${date}`, JSON.stringify(cityPayload), { expirationTtl: 172800 });
        
        citiesFound.push(city);
      }
    }

    if (citiesFound.length === 0) {
      return jsonResponse({ error: 'No valid city data (itapeva/itapetininga) found in payload.' }, 400);
    }

    return jsonResponse({ 
      success: true, 
      version, 
      date, 
      dispatched_cities: citiesFound 
    });

  } catch (error) {
    return jsonResponse({ error: `Dispatch failed: ${error.message}` }, 500);
  }
}

// GET /api/dispatch - App local busca boletins (polling)
// Query params: city (obrigatório), version (opcional)
export async function onRequestGet(context) {
  const { request, env } = context;

  if (!authorize(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const kv = env.NEWSMAKER_KV;
  if (!kv) {
    return jsonResponse({ error: 'KV namespace not configured on server (NEWSMAKER_KV).' }, 500);
  }

  try {
    const url = new URL(request.url);
    const city = url.searchParams.get('city')?.toLowerCase();
    const clientVersion = url.searchParams.get('version');

    if (!city) {
      return jsonResponse({ error: 'Missing "city" query parameter (e.g., ?city=itapeva).' }, 400);
    }

    // Busca diretamente na chave específica da cidade
    const raw = await kv.get(`dispatch:${city}:latest`);
    
    if (!raw) {
      return jsonResponse({ message: `No dispatches available for city "${city}".` }, 204);
    }

    const data = JSON.parse(raw);

    // Se o cliente já tem essa versão, retorna 304
    if (clientVersion && clientVersion === data.version) {
      return new Response(null, { status: 304, headers: CORS_HEADERS });
    }

    return jsonResponse(data);

  } catch (error) {
    return jsonResponse({ error: `Fetch failed: ${error.message}` }, 500);
  }
}
