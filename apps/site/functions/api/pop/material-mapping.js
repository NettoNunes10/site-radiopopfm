export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.NEWSMAKER_KV;
  const { method } = request;

  // 1. Auth (Bearer Token)
  const authHeader = request.headers.get("Authorization");
  const password = env.NEWSMAKER_PASSWORD;
  if (!authHeader || (authHeader !== `Bearer ${password}` && authHeader !== password)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { 
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  // 2. GET (Fetch Mapping)
  if (method === "GET") {
    const mapping = await kv.get("pop_material_rules", "json");
    return new Response(JSON.stringify(mapping || {}), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // 3. POST (Save Mapping)
  if (method === "POST") {
    try {
      const data = await request.json();
      await kv.put("pop_material_rules", JSON.stringify(data));
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: "Save failed", detail: e.message }), { status: 400 });
    }
  }

  return new Response("Method not allowed", { status: 405 });
}
