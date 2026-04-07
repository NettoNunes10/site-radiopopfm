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

  // 2. GET (Check Status)
  const [data, forceSync] = await Promise.all([
    kv.get("pop_library_status", "json"),
    kv.get("pop_force_sync_requested")
  ]);

  const statusJson = data || { online: false, count: 0 };
  statusJson.forceSyncRequested = forceSync === "true";

  // Heatmap check: if lastUpdate is older than 5 minutes, set online to false
  if (statusJson.lastUpdate) {
    const last = new Date(statusJson.lastUpdate);
    const now = new Date();
    if (now - last > 5 * 60 * 1000) {
      statusJson.online = false;
    }
  }

  return new Response(JSON.stringify(statusJson), {
    headers: { "Content-Type": "application/json" }
  });
}
