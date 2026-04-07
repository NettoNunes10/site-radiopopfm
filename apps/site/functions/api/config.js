export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.NEWSMAKER_KV;
  const { method } = request;
  const url = new URL(request.url);
  const key = url.searchParams.get("key"); // config_music_rules, config_music_jabas, etc.

  // 1. Check Authentication (Same as NewsMaker)
  const authHeader = request.headers.get("Authorization");
  const password = env.NEWSMAKER_PASSWORD;
  if (!authHeader || authHeader !== `Bearer ${password}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { 
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (!key) {
    return new Response(JSON.stringify({ error: "Missing 'key' parameter" }), { 
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  // 2. GET Configuration
  if (method === "GET") {
    const data = await kv.get(key);
    return new Response(data || "{}", {
      headers: { "Content-Type": "application/json" }
    });
  }

  // 3. POST Configuration (Update)
  if (method === "POST") {
    try {
      const data = await request.text();
      // Basic JSON validation before saving
      JSON.parse(data);
      await kv.put(key, data);
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
    }
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
}
