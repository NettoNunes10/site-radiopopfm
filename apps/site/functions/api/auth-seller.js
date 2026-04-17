export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.NEWSMAKER_KV;
  const { method } = request;

  if (method === "POST") {
    try {
      const { username, password } = await request.json();
      const userData = await kv.get(`user:${username}`, "json");

      if (userData && userData.password === password) {
        // Simple token for demonstration: base64 of username:password
        const token = btoa(`${username}:${password}`);
        return new Response(JSON.stringify({ success: true, token, user: { username, name: userData.name } }), {
          headers: { "Content-Type": "application/json" }
        });
      } else {
        return new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401 });
      }
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid request" }), { status: 400 });
    }
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
}
