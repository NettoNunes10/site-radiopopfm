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
        lastUpdate: new Date().toISOString(),
        host: payload.host || "unknown",
        count: payload.count || 0,
        online: true
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
    const [data, forceSync] = await Promise.all([
      kv.get("pop_library_status", "json"),
      kv.get("pop_force_sync_requested")
    ]);

    const statusJson = data || { online: false, count: 0 };
    statusJson.forceSyncRequested = forceSync === "true";

    return new Response(JSON.stringify(statusJson), {
      headers: { "Content-Type": "application/json" }
    });
  }

  return new Response("Method not allowed", { status: 405 });
}
