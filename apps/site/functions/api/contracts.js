export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.NEWSMAKER_KV;
  const { method } = request;

  // 1. Auth check (Master Password for Admin)
  const authHeader = request.headers.get("Authorization");
  const masterPassword = env.NEWSMAKER_PASSWORD;
  if (!authHeader || authHeader !== `Bearer ${masterPassword}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { 
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  // 2. GET: List all contracts
  if (method === "GET") {
    // List keys with "contract:" prefix
    const list = await kv.list({ prefix: "contract:" });
    const contracts = [];
    
    // Cloudflare KV list is eventually consistent and limited to 1000 keys by default.
    // For this use case, we'll fetch them all.
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

  // 3. DELETE: Remove contract entry
  if (method === "DELETE") {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) return new Response(JSON.stringify({ error: "Missing id" }), { status: 400 });
    await kv.delete(id);
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
}
