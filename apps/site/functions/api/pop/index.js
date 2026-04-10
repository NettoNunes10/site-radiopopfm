/**
 * Cloudflare Pages Function - Index/Router Pop FM
 * Permite que o agente local aponte apenas para /api/pop
 */

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.NEWSMAKER_KV;
  const { method } = request;

  // 1. Auth Flexível (Aceita 'nn123' ou 'Bearer nn123')
  const authHeader = request.headers.get("Authorization") || "";
  const password = env.NEWSMAKER_PASSWORD;
  const isAuthorized = authHeader === `Bearer ${password}` || authHeader === password;

  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { 
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  // 2. Roteamento Inteligente
  
  // POST -> Trata como sincronia de BIBLIOTECA
  if (method === "POST") {
    try {
      const payload = await request.json();
      
      const status = {
        online: true,
        count: payload.count || 0,
        musicCount: payload.musicCount || 0,
        materialCount: payload.materialCount || 0,
        lastSync: new Date().toISOString(),
        host: payload.host || "Desconhecido"
      };

      await kv.put("pop_library_index", JSON.stringify(payload.library));
      await kv.put("pop_library_status", JSON.stringify(status));

      return new Response(JSON.stringify({ success: true, count: payload.count }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid Payload", detail: e.message }), { status: 400 });
    }
  }

  // GET -> Trata como consulta de STATUS
  if (method === "GET") {
    const url = new URL(request.url);
    const isInspect = url.searchParams.get("inspect") === "1";

    const [data, forceSync, downloads, libraryIndex] = await Promise.all([
      kv.get("pop_library_status", "json"),
      kv.get("pop_force_sync_requested"),
      kv.list({ prefix: 'pop_dl_' }),
      isInspect ? kv.get("pop_library_index", "json") : Promise.resolve(null)
    ]);
    
    const statusJson = data || { online: false, count: 0 };
    statusJson.forceSyncRequested = forceSync === "true";
    statusJson.pendingDownloads = downloads.keys.map(k => k.name);
    
    if (isInspect) statusJson.library = libraryIndex || {};

    return new Response(JSON.stringify(statusJson), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // DELETE -> O Agente confirma recebimento e deleta o item da fila
  if (method === "DELETE") {
    const url = new URL(request.url);
    const key = url.searchParams.get("key");
    if (!key || !key.startsWith("pop_dl_")) {
      return new Response(JSON.stringify({ error: "Invalid Key" }), { status: 400 });
    }
    await kv.delete(key);
    return new Response(JSON.stringify({ success: true }));
  }

  // GET por chave específica (Download do conteúdo)
  if (method === "GET") {
    const url = new URL(request.url);
    const key = url.searchParams.get("download_key");
    if (key) {
      const file = await kv.get(key);
      if (!file) return new Response("Not found", { status: 404 });
      return new Response(file, { headers: { "Content-Type": "application/json" } });
    }
  }

  return new Response("Method not allowed", { status: 405 });
}
