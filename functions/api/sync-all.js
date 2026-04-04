// Cloudflare Pages Function - Unified Sync Endpoint
// Respondendo em: /api/sync-all

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Sync-Host, X-Sync-Version',
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
  if (!expectedPassword || expectedPassword.trim() === '') return false;
  return authHeader === `Bearer ${expectedPassword}`;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!authorize(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);

  const kv = env.NEWSMAKER_KV;
  if (!kv) return jsonResponse({ error: 'KV namespace not configured.' }, 500);

  try {
    const url = new URL(request.url);
    const city = url.searchParams.get('city');
    const newsVersion = url.searchParams.get('news_version');
    const playlistDate = url.searchParams.get('playlist_date'); // Last date the client has

    if (!city) return jsonResponse({ error: 'Missing "city" parameter.' }, 400);
    const cityKey = city.toLowerCase();

    // --- CONSOLIDATED THROTTLED HEARTBEAT ---
    const now = Date.now();
    const HEARTBEAT_THROTTLE = 30 * 60 * 1000;
    const host = request.headers.get("X-Sync-Host") || "Desconhecido";
    const syncAppVersion = request.headers.get("X-Sync-Version") || "3.0";

    const updateHeartbeat = async (statusKey) => {
      const existingRaw = await kv.get(statusKey);
      let shouldUpdate = true;
      if (existingRaw) {
        const existing = JSON.parse(existingRaw);
        if (now - (existing.lastSeen || 0) < HEARTBEAT_THROTTLE) shouldUpdate = false;
      }
      if (shouldUpdate) {
        await kv.put(statusKey, JSON.stringify({ host, lastSeen: now, version: syncAppVersion }), { expirationTtl: 3600 });
      }
    };

    // Parallel heartbeat updates (max 2 Reads/Writes)
    await Promise.all([
      updateHeartbeat(`status_${cityKey}`),
      updateHeartbeat(`status_playlist_${cityKey}`)
    ]);

    // --- FETCH NEWS (latest) ---
    let newsResult = { available: false };
    const newsRaw = await kv.get('dispatch:latest');
    if (newsRaw) {
      const newsData = JSON.parse(newsRaw);
      if (newsData.version !== newsVersion) {
        // Filter news for this city
        const filteredNotes = { nacional: newsData.notes.nacional || [] };
        if (newsData.notes[cityKey]) filteredNotes[cityKey] = newsData.notes[cityKey];
        
        newsResult = {
          available: true,
          version: newsData.version,
          date: newsData.date,
          dispatched_at: newsData.dispatched_at,
          notes: filteredNotes
        };
      } else {
        newsResult = { available: false, version: newsData.version, status: 304 };
      }
    }

    // --- FETCH PLAYLIST (oldest pending) ---
    let playlistResult = { available: false };
    const indexRaw = await kv.get(`playlist:pending:${cityKey}`);
    if (indexRaw) {
      const pendingDates = JSON.parse(indexRaw);
      if (pendingDates.length > 0) {
        const oldestDate = pendingDates[0];
        if (oldestDate !== playlistDate) {
          const playlistRaw = await kv.get(`playlist:${cityKey}:${oldestDate}`);
          if (playlistRaw) {
            playlistResult = {
              available: true,
              ...JSON.parse(playlistRaw)
            };
          }
        } else {
          playlistResult = { available: false, date: oldestDate, status: 304 };
        }
      }
    }

    return jsonResponse({
      news: newsResult,
      playlist: playlistResult,
      server_time: now
    });

  } catch (error) {
    return jsonResponse({ error: `Sync failed: ${error.message}` }, 500);
  }
}
