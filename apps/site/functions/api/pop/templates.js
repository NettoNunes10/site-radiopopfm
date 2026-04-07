export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.NEWSMAKER_KV;
  const { method } = request;

  // 1. Auth (Bearer Token)
  const authHeader = request.headers.get("Authorization");
  const password = env.NEWSMAKER_PASSWORD;
  if (!authHeader || authHeader !== `Bearer ${password}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { 
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  // 2. GET (Fetch Library & Mapping)
  if (method === "GET") {
    const [library, mapping] = await Promise.all([
      kv.get("pop_templates_library", "json"),
      kv.get("pop_templates_mapping", "json")
    ]);

    return new Response(JSON.stringify({ 
      library: library || {}, 
      mapping: mapping || [null, null, null, null, null, null, null] 
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // 3. POST (Save/Update)
  if (method === "POST") {
    try {
      const { type, data, name } = await request.json();

      if (type === "upload") {
        // Add or update a template in the library
        let library = await kv.get("pop_templates_library", "json") || {};
        library[name] = data;
        await kv.put("pop_templates_library", JSON.stringify(library));
        return new Response(JSON.stringify({ success: true }));
      }

      if (type === "delete") {
        // Remove a template from library
        let library = await kv.get("pop_templates_library", "json") || {};
        delete library[name];
        await kv.put("pop_templates_library", JSON.stringify(library));
        return new Response(JSON.stringify({ success: true }));
      }

      if (type === "mapping") {
        // Update the 7-day schedule
        await kv.put("pop_templates_mapping", JSON.stringify(data));
        return new Response(JSON.stringify({ success: true }));
      }

    } catch (e) {
      return new Response(JSON.stringify({ error: "Operation failed", detail: e.message }), { status: 400 });
    }
  }

  return new Response("Method not allowed", { status: 405 });
}
