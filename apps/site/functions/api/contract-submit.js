export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.NEWSMAKER_KV;
  const { method } = request;

  if (method === "POST") {
    try {
      const authHeader = request.headers.get("Authorization");
      if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

      const data = await request.json();
      const { type, document, companyName } = data;
      
      if (!document || !companyName) {
        return new Response(JSON.stringify({ error: "Document and Name are required" }), { status: 400 });
      }

      const timestamp = new Date().getTime();
      const key = `contract:${timestamp}`;
      
      await kv.put(key, JSON.stringify({ 
        ...data,
        submittedAt: new Date().toISOString(),
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
