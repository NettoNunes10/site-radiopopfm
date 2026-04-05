// Cloudflare Pages Function - Dispatch de Boletins para Estúdios
// Respondendo em: /api/dispatch

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

async function sendToSlack(webhookUrl, message) {
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message })
    });
  } catch (e) {
    console.error('Slack error:', e);
  }
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

// POST /api/dispatch - Enviar boletins para o KV (chamado pelo site)
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
    const { date, notes } = body;

    if (!date || !notes) {
      return jsonResponse({ error: 'Missing date or notes in payload.' }, 400);
    }

    // Gerar hash de versão único
    const version = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const kvPayload = {
      date,
      version,
      notes,
      dispatched_at: new Date().toISOString(),
    };

    // Armazena no KV com TTL de 48h (172800 segundos)
    // Chave principal: "dispatch:latest" (sempre a mais recente)
    await kv.put('dispatch:latest', JSON.stringify(kvPayload), { expirationTtl: 172800 });

    // Também salva por data para histórico
    await kv.put(`dispatch:${date}`, JSON.stringify(kvPayload), { expirationTtl: 172800 });

    // --- NEW: Enviar para Slack (se configurado) ---
    const slackUrl = env.SLACK_NEWS_WEBHOOK_URL;
    if (slackUrl && slackUrl.startsWith('http')) {
      const cityNames = {
        nacional: 'NACIONAL',
        itapeva: 'ITAPEVA',
        itapetininga: 'ITAPETININGA'
      };

      // Função interna para processar o envio em ordem
      const processSlackQueue = async () => {
        for (const [sectionKey, sectionLabel] of Object.entries(cityNames)) {
          const sectionNotes = notes[sectionKey] || [];
          for (let i = 0; i < sectionNotes.length; i++) {
            const note = sectionNotes[i];
            const slackMsg = `[${sectionLabel} / ${date}] - NOTÍCIA ${i + 1}:\n${note.text}`;
            await sendToSlack(slackUrl, slackMsg);
            // Pequeno delay para garantir ordem de recepção no Slack
            await new Promise(r => setTimeout(r, 200));
          }
        }
      };

      // Usa waitUntil para não atrasar a resposta do Admin
      context.waitUntil(processSlackQueue());
    }

    return jsonResponse({ success: true, version, date, slack: !!slackUrl });

  } catch (error) {
    return jsonResponse({ error: `Dispatch failed: ${error.message}` }, 500);
  }
}

// GET /api/dispatch - Receptor Python busca boletins (polling)
// Query params: city (obrigatório), version (opcional - para check de novidade)
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

    // --- THROTTLED HEARTBEAT LOGIC ---
    // Read status first (1 Read)
    const statusKey = `status_${city.toLowerCase()}`;
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
      // Extract metadata from sync app headers
      const host = request.headers.get("X-Sync-Host") || "Desconhecido";
      const syncAppVersion = request.headers.get("X-Sync-Version") || "2.0";
      
      // Save live status in KV (1 Write - occurs max once every 30 mins)
      await kv.put(statusKey, JSON.stringify({
        host: host,
        lastSeen: now,
        version: syncAppVersion
      }), { expirationTtl: 3600 }); // Status expires in 1 hour if no heartbeat
    }
    // --- END THROTTLED HEARTBEAT LOGIC ---

    const raw = await kv.get('dispatch:latest');
    if (!raw) {
      return jsonResponse({ message: 'No dispatches available.' }, 204);
    }

    const data = JSON.parse(raw);

    // Se o cliente já tem essa versão, retorna 304
    if (clientVersion && clientVersion === data.version) {
      return new Response(null, { status: 304, headers: CORS_HEADERS });
    }

    // Filtra apenas as notas relevantes (nacional + cidade solicitada)
    const filteredNotes = {
      nacional: data.notes.nacional || [],
    };

    const cityKey = city.toLowerCase();
    if (data.notes[cityKey]) {
      filteredNotes[cityKey] = data.notes[cityKey];
    } else {
      return jsonResponse({ error: `City "${city}" not found in dispatch.` }, 404);
    }

    return jsonResponse({
      date: data.date,
      version: data.version,
      dispatched_at: data.dispatched_at,
      notes: filteredNotes,
    });

  } catch (error) {
    return jsonResponse({ error: `Fetch failed: ${error.message}` }, 500);
  }
}
