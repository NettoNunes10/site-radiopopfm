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

  // 2. Heartbeat / Check for Commands
  if (method === "GET") {
    const [forceSync, libraryStatus, dlList] = await Promise.all([
      kv.get("pop_force_sync_requested"),
      kv.get("pop_library_status", "json"),
      kv.list({ prefix: "pop_dl_" })
    ]);

    const downloads = [];
    for (const key of dlList.keys) {
      const item = await kv.get(key.name, "json");
      if (item) downloads.push(item);
    }

    const response = {
      forceSync: forceSync === "true",
      downloads: downloads,
      lastLibraryUpdate: libraryStatus?.lastUpdate
    };

    return new Response(JSON.stringify(response), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // 3. Acknowledge Command (Clear force sync or specific download)
  if (method === "POST") {
    try {
      const { ack, id } = await request.json();
      if (ack === "forceSync") {
        await kv.delete("pop_force_sync_requested");
      }
      if (ack === "download" && id) {
        await kv.delete(id);
      }
      return new Response(JSON.stringify({ success: true }));
    } catch (e) {
      return new Response(JSON.stringify({ error: "Ack failed" }), { status: 400 });
    }
  }

  return new Response("Method not allowed", { status: 405 });
}
