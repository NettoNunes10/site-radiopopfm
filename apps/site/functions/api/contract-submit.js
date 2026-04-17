export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.NEWSMAKER_KV;
  const { method } = request;

  if (method === "POST") {
    try {
      const authHeader = request.headers.get("Authorization");
      if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

      const { cnpj, companyName } = await request.json();
      const timestamp = new Date().getTime();
      const key = `contract:${timestamp}`;
      
      await kv.put(key, JSON.stringify({ 
        cnpj, 
        companyName, 
        submittedAt: new Date().toISOString(),
        // Extra meta can be added here
      }));

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: "Internal Error" }), { status: 500 });
    }
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
}
