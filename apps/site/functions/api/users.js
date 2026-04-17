export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.NEWSMAKER_KV;
  const { method } = request;
  const url = new URL(request.url);

  // 1. Auth check (Master Password for Admin)
  const authHeader = request.headers.get("Authorization");
  const masterPassword = env.NEWSMAKER_PASSWORD;
  if (!authHeader || authHeader !== `Bearer ${masterPassword}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { 
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  // 2. GET: List all sellers
  if (method === "GET") {
    // List keys with "user:" prefix
    const list = await kv.list({ prefix: "user:" });
    const users = [];
    for (const key of list.keys) {
      const userData = await kv.get(key.name, "json");
      if (userData) {
        // Don't leak password in list if possible, but for management we might need it
        // Or at least just the metadata
        users.push({ username: key.name.replace("user:", ""), ...userData });
      }
    }
    return new Response(JSON.stringify(users), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // 3. POST: Create/Update user
  if (method === "POST") {
    try {
      const { username, password, name } = await request.json();
      if (!username || !password) {
        return new Response(JSON.stringify({ error: "Username and Password required" }), { status: 400 });
      }
      const key = `user:${username}`;
      await kv.put(key, JSON.stringify({ password, name: name || username, active: true }));
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
    }
  }

  // 4. DELETE: Remove user
  if (method === "DELETE") {
    const username = url.searchParams.get("username");
    if (!username) return new Response(JSON.stringify({ error: "Missing username" }), { status: 400 });
    await kv.delete(`user:${username}`);
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
}
