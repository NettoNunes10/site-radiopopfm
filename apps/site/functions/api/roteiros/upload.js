const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const MAX_BIL_BYTES = 1024 * 1024;
const MANIFEST_LIMIT = 200;
const ROTEIRO_TTL_SECONDS = 30 * 24 * 60 * 60;

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

function normalizeDate(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return "";
}

function sanitizeFilename(value) {
  return String(value || "")
    .replace(/[\\/]/g, "")
    .replace(/[^\w .-]+/g, "_")
    .trim();
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function pruneManifestFiles(kv, files) {
  const checked = await Promise.all(
    files.map(async (item) => {
      if (!item?.meta_key) return null;
      const exists = await kv.get(item.meta_key);
      return exists ? item : null;
    })
  );
  return checked.filter(Boolean);
}

async function readManifest(kv, station) {
  const raw = await kv.get(`manifest:${station}`);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const files = Array.isArray(parsed.files) ? parsed.files : [];
    return pruneManifestFiles(kv, files);
  } catch {
    return [];
  }
}

async function writeManifest(kv, station, files) {
  const payload = {
    station,
    updated_at: new Date().toISOString(),
    files: files.slice(0, MANIFEST_LIMIT),
  };
  await kv.put(`manifest:${station}`, JSON.stringify(payload));
  return payload;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost({ request, env }) {
  if (!authorize(request, env)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const kv = env.ROTEIROS_KV;
  if (!kv) {
    return jsonResponse({ error: "ROTEIROS_KV binding is not configured." }, 500);
  }

  try {
    const form = await request.formData();
    const station = normalizeStation(form.get("station"));
    const date = normalizeDate(form.get("date"));
    const file = form.get("file");

    if (!station) return jsonResponse({ error: "Missing station." }, 400);
    if (!date) return jsonResponse({ error: "Invalid or missing date. Use YYYY-MM-DD." }, 400);
    if (!(file instanceof File)) return jsonResponse({ error: "Missing file." }, 400);

    const filename = sanitizeFilename(file.name);
    if (!filename.toLowerCase().endsWith(".bil")) {
      return jsonResponse({ error: "Only .bil files are accepted." }, 400);
    }
    if (file.size <= 0) return jsonResponse({ error: "Empty file." }, 400);
    if (file.size > MAX_BIL_BYTES) {
      return jsonResponse({ error: `File too large. Max ${MAX_BIL_BYTES} bytes.` }, 413);
    }

    const content = await file.arrayBuffer();
    const sha256 = await sha256Hex(content);
    const id = `${date.replace(/-/g, "")}-${sha256.slice(0, 12)}`;
    const fileKey = `roteiro:${station}:${date}:${id}:file`;
    const metaKey = `roteiro:${station}:${date}:${id}:meta`;
    const idKey = `roteiro:id:${id}`;
    const uploadedAt = new Date().toISOString();

    const meta = {
      id,
      station,
      date,
      filename,
      sha256,
      size: file.size,
      uploaded_at: uploadedAt,
      expires_at: new Date(Date.now() + ROTEIRO_TTL_SECONDS * 1000).toISOString(),
      ttl_seconds: ROTEIRO_TTL_SECONDS,
      file_key: fileKey,
      meta_key: metaKey,
    };

    await kv.put(fileKey, content, {
      expirationTtl: ROTEIRO_TTL_SECONDS,
      metadata: {
        station,
        date,
        filename,
        sha256,
        content_type: "application/octet-stream",
      },
    });
    await kv.put(metaKey, JSON.stringify(meta), { expirationTtl: ROTEIRO_TTL_SECONDS });
    await kv.put(idKey, JSON.stringify(meta), { expirationTtl: ROTEIRO_TTL_SECONDS });

    const existing = await readManifest(kv, station);
    const withoutDuplicate = existing.filter((item) => item.id !== id);
    const manifest = await writeManifest(kv, station, [meta, ...withoutDuplicate]);

    return jsonResponse({ success: true, file: meta, manifest_count: manifest.files.length });
  } catch (error) {
    return jsonResponse({ error: `Upload failed: ${error.message}` }, 500);
  }
}
