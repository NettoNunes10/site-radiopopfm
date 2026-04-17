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

  // 2. GET: List all contracts (active by default, or archived)
  if (method === "GET") {
    const status = url.searchParams.get("status") || "active";
    const prefix = status === "archived" ? "archived:" : "contract:";
    
    const list = await kv.list({ prefix });
    const contracts = [];
    
    for (const key of list.keys) {
      const data = await kv.get(key.name, "json");
      if (data) {
        contracts.push({ id: key.name, ...data });
      }
    }
    
    // Sort by submission date (newest first)
    contracts.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

    return new Response(JSON.stringify(contracts), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // 3. POST: Archive or Restore
  if (method === "POST") {
    try {
      const { action, id } = await request.json();
      if (!action || !id) return new Response(JSON.stringify({ error: "Action and ID required" }), { status: 400 });

      const data = await kv.get(id, "json");
      if (!data) return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });

      let newKey;
      if (action === "archive") {
        newKey = id.replace("contract:", "archived:");
      } else if (action === "restore") {
        newKey = id.replace("archived:", "contract:");
      } else {
        return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400 });
      }

      await kv.put(newKey, JSON.stringify(data));
      await kv.delete(id);

      return new Response(JSON.stringify({ success: true, newKey }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: "Process error" }), { status: 500 });
    }
  }

  // 4. DELETE: Permanently Remove
  if (method === "DELETE") {
    const id = url.searchParams.get("id");
    if (!id) return new Response(JSON.stringify({ error: "Missing id" }), { status: 400 });
    await kv.delete(id);
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
}
