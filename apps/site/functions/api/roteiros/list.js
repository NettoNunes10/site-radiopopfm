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

function normalizeStation(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function pruneManifest(kv, station, manifest) {
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const checked = await Promise.all(
    files.map(async (item) => {
      if (!item?.meta_key) return null;
      const exists = await kv.get(item.meta_key);
      return exists ? item : null;
    })
  );
  const activeFiles = keepLatestPerDate(checked.filter(Boolean));
  if (activeFiles.length !== files.length) {
    await kv.put(`manifest:${station}`, JSON.stringify({
      station,
      updated_at: new Date().toISOString(),
      files: activeFiles,
    }));
  }
  return {
    ...manifest,
    station,
    files: activeFiles,
  };
}

function keepLatestPerDate(files) {
  const byDate = new Map();
  for (const item of files) {
    if (!item?.date) continue;
    const previous = byDate.get(item.date);
    const currentTime = Date.parse(item.uploaded_at || "") || 0;
    const previousTime = Date.parse(previous?.uploaded_at || "") || 0;
    if (!previous || currentTime >= previousTime) {
      byDate.set(item.date, item);
    }
  }
  return Array.from(byDate.values()).sort((a, b) => {
    const dateCompare = String(b.date || "").localeCompare(String(a.date || ""));
    if (dateCompare !== 0) return dateCompare;
    return (Date.parse(b.uploaded_at || "") || 0) - (Date.parse(a.uploaded_at || "") || 0);
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet({ request, env }) {
  if (!authorize(request, env)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const kv = env.ROTEIROS_KV;
  if (!kv) {
    return jsonResponse({ error: "ROTEIROS_KV binding is not configured." }, 500);
  }

  const url = new URL(request.url);
  const station = normalizeStation(url.searchParams.get("station"));
  if (!station) return jsonResponse({ error: "Missing station." }, 400);

  const raw = await kv.get(`manifest:${station}`);
  if (!raw) {
    return jsonResponse({ station, updated_at: null, files: [] });
  }

  try {
    const manifest = JSON.parse(raw);
    return jsonResponse(await pruneManifest(kv, station, manifest));
  } catch {
    return jsonResponse({ error: "Manifest is corrupted." }, 500);
  }
}
