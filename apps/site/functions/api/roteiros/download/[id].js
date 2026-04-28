const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...CORS_HEADERS,
    },
  });
}

function authorize(request, env) {
  const authHeader = (request.headers.get("authorization") || "").trim();
  const expected = env.ROTEIROS_API_KEY;
  return Boolean(expected) && authHeader === `Bearer ${expected}`;
}

function sanitizeId(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_-]+/g, "");
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet({ request, env, params }) {
  if (!authorize(request, env)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const kv = env.ROTEIROS_KV;
  if (!kv) {
    return jsonResponse({ error: "ROTEIROS_KV binding is not configured." }, 500);
  }

  const id = sanitizeId(params.id);
  if (!id) return jsonResponse({ error: "Missing id." }, 400);

  const metaRaw = await kv.get(`roteiro:id:${id}`);
  if (!metaRaw) return jsonResponse({ error: "File not found." }, 404);

  let meta;
  try {
    meta = JSON.parse(metaRaw);
  } catch {
    return jsonResponse({ error: "Metadata is corrupted." }, 500);
  }

  const content = await kv.get(meta.file_key);
  if (content == null) return jsonResponse({ error: "File content not found." }, 404);

  return new Response(content, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=windows-1252",
      "Content-Disposition": `attachment; filename="${meta.filename}"`,
      "Cache-Control": "no-store",
      "X-Roteiro-Id": meta.id,
      "X-Roteiro-Sha256": meta.sha256,
      ...CORS_HEADERS,
    },
  });
}

