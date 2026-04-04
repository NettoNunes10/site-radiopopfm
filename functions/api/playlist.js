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

    // Armazena por data para sincronização (chave primária) (1 Write)
    await kv.put(`playlist:${cityKey}:${date}`, JSON.stringify(payload), { expirationTtl: 86400 * 7 });

    // Atualiza o índice de pendentes (1 Read + 1 Write)
    const indexKey = `playlist:pending:${cityKey}`;
    const existingRaw = await kv.get(indexKey);
    let pendingDates = existingRaw ? JSON.parse(existingRaw) : [];
    if (!pendingDates.includes(date)) {
      pendingDates.push(date);
      pendingDates.sort();
      await kv.put(indexKey, JSON.stringify(pendingDates), { expirationTtl: 86400 * 7 });
    }

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

    // --- THROTTLED HEARTBEAT LOGIC ---
    const statusKey = `status_playlist_${cityKey}`;
    const existingStatusRaw = await kv.get(statusKey);
    const now = Date.now();
    const HEARTBEAT_THROTTLE = 30 * 60 * 1000; // 30 minutes

    let shouldUpdate = true;
    if (existingStatusRaw) {
      const existingStatus = JSON.parse(existingStatusRaw);
      if (now - (existingStatus.lastSeen || 0) < HEARTBEAT_THROTTLE) {
        shouldUpdate = false;
      }
    }

    if (shouldUpdate) {
      const host = request.headers.get("X-Sync-Host") || "Desconhecido";
      const syncAppVersion = request.headers.get("X-Sync-Version") || "2.1";
      await kv.put(statusKey, JSON.stringify({
        host,
        lastSeen: now,
        version: syncAppVersion
      }), { expirationTtl: 3600 });
    }
    // --- END THROTTLED HEARTBEAT LOGIC ---

    // Se não informou data, devolve a MAIS ANTIGA disponível usando o ÍNDICE (Read em vez de List)
    if (!date) {
      const indexKey = `playlist:pending:${cityKey}`;
      const indexRaw = await kv.get(indexKey);
      
      if (!indexRaw) {
        return jsonResponse({ message: 'No playlists pending (no index).' }, 204);
      }

      const pendingDates = JSON.parse(indexRaw);
      if (pendingDates.length === 0) {
        return jsonResponse({ message: 'No playlists pending.' }, 204);
      }

      // Pega a data mais antiga (primeira do array ordenado)
      const oldestDate = pendingDates[0];
      const raw = await kv.get(`playlist:${cityKey}:${oldestDate}`);
      
      if (!raw) {
        // Se o arquivo sumiu por algum motivo, limpa o índice e retorna 204
        const updatedPending = pendingDates.filter(d => d !== oldestDate);
        await kv.put(indexKey, JSON.stringify(updatedPending), { expirationTtl: 86400 * 7 });
        return jsonResponse({ message: 'Playlist record missing, index updated.' }, 204);
      }

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
    
    // 1. Apaga o arquivo
    await kv.delete(`playlist:${cityKey}:${date}`);

    // 2. Remove do índice de pendentes
    const indexKey = `playlist:pending:${cityKey}`;
    const existingRaw = await kv.get(indexKey);
    if (existingRaw) {
      let pendingDates = JSON.parse(existingRaw);
      const newPending = pendingDates.filter(d => d !== date);
      if (newPending.length !== pendingDates.length) {
        await kv.put(indexKey, JSON.stringify(newPending), { expirationTtl: 86400 * 7 });
      }
    }

    return jsonResponse({ success: true, message: `Playlist ${date} removida.` });

  } catch (error) {
    return jsonResponse({ error: `Delete failed: ${error.message}` }, 500);
  }
}
