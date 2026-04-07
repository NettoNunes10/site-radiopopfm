export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.NEWSMAKER_KV;

  // 1. Auth (Bearer Token)
  const authHeader = request.headers.get("Authorization");
  const password = env.NEWSMAKER_PASSWORD;
  if (!authHeader || authHeader !== `Bearer ${password}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { 
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  // 2. Set Force Sync Flag
  await kv.put("pop_force_sync_requested", "true");

  return new Response(JSON.stringify({ success: true, message: "Sync request sent to local agent" }), {
    headers: { "Content-Type": "application/json" }
  });
}
