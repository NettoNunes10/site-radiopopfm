export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.NEWSMAKER_KV;
  const { method } = request;

  // 1. Auth (Bearer Token or Raw)
  const authHeader = request.headers.get("Authorization") || "";
  const password = env.NEWSMAKER_PASSWORD;
  const isAuthorized = authHeader === `Bearer ${password}` || authHeader === password;

  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { 
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  // 2. GET (Check Status)
  if (method === "GET") {
    const data = await kv.get("pop_library_status");
    return new Response(data || "{}", {
      headers: { "Content-Type": "application/json" }
    });
  }

  // 3. POST (Sync Library)
  if (method === "POST") {
    try {
      const payload = await request.json();
      
      // We store the full index and also a quick status
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

  return new Response("Method not allowed", { status: 405 });
}
