// Cloudflare Pages Function para o Gerador de Boletins (NewsMaker)
// Respondendo em: /api/generate

export async function onRequestGet(context) {
  const { request, env } = context;
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  const expectedPassword = env.NEWSMAKER_PASSWORD;

  // Se a senha esperada não estiver configurada no Cloudflare, bloqueia por padrão
  if (!expectedPassword || expectedPassword.trim() === '') {
    return new Response(JSON.stringify({ error: 'System error: password not configured in Cloudflare' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }

  if (authHeader === `Bearer ${expectedPassword}`) {
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }

  // Senha incorreta ou ausente
  return new Response(JSON.stringify({ error: 'Unauthorized: senha incorreta' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  return handleGenerate(request, env);
}

async function handleGenerate(request, env) {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  const expectedPassword = env.NEWSMAKER_PASSWORD;

  if (!expectedPassword || expectedPassword.trim() === '' || authHeader !== `Bearer ${expectedPassword}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized: senha incorreta' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'SUA_CHAVE_AQUI') {
    return new Response(JSON.stringify({ error: 'API key nao configurada no servidor' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const body = await request.json();
    const { nacional = [], itapeva = [], itapetininga = [], date } = body;

    const expectedCount = 3;
    const sections = { nacional, itapeva, itapetininga };

    for (const [key, items] of Object.entries(sections)) {
      const validItems = items.filter(item => item && item.trim());
      if (validItems.length !== expectedCount) {
        return new Response(JSON.stringify({ error: `Secao ${key} precisa de ${expectedCount} noticias.` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      sections[key] = validItems;
    }

    const instructions = `Voce e um experiente redator e editor de jornalismo para radio, focado em criar boletins informativos dinamicos e diretos.

Sua tarefa e receber noticias em formato de texto bruto e transforma-las em notas curtas, limpas e prontas para locucao.

REGRAS OBRIGATORIAS:
1. ENTRADA DE DADOS:
Receba o texto da noticia e reescreva para radio.

2. TAMANHO E METRICA:
O texto final de cada noticia deve ter meta de 95 palavras.
Margem estrita: nunca menos de 80 palavras e nunca mais de 110 palavras.

3. TOTAL INDEPENDENCIA:
As notas nao serao necessariamente lidas em sequencia.
Portanto, NUNCA use frases de transicao entre noticias.

4. RITMO DE LOCUCAO:
Texto pensado para radio.
Use ordem direta nas frases.
Evite frases longas.
Transforme numeros exatos em aproximacoes amigaveis para radio quando fizer sentido editorial.

5. FORMATO DE SAIDA OBRIGATORIO:
Retorne APENAS JSON valido, sem markdown e sem texto extra, no formato:
{
  "NACIONAL": { "1": "Noticia 1", "2": "Noticia 2", "3": "Noticia 3" },
  "ITAPEVA": { "1": "Noticia 1", "2": "Noticia 2", "3": "Noticia 3" },
  "ITAPETININGA": { "1": "Noticia 1", "2": "Noticia 2", "3": "Noticia 3" }
}

6. LOCALIZACAO:
Matérias que mencionem locais, quando o local for 'interior de São Paulo', cite o nome do local no lugar de 'interior de São Paulo'. 

Mantenha fidelidade aos fatos.
Nao invente dados e nao adicione contexto externo nao presente na entrada.`;

    const notesBySection = await generateNotes(sections, apiKey, instructions);

    const result = {
      date,
      notes: notesBySection,
      success: true,
    };

    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// ===== Funções do Gemini (adaptadas para Cloudflare Workers) =====

const SECTION_LABELS = {
  nacional: 'NACIONAL',
  itapeva: 'ITAPEVA',
  itapetininga: 'ITAPETININGA',
};

const WORD_LIMITS = { min: 80, max: 110, target: 95 };

function countWords(text) {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}


async function generateNotes(sections, apiKey, instructions) {
  const maxAttempts = 2;
  const expectedCount = 3;

  let retryInstruction = '';
  let lastErrorMessage = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const parsed = await callGemini(apiKey, instructions, buildUserPrompt(sections, retryInstruction));
      return parseStructuredResponse(parsed, expectedCount);
    } catch (exc) {
      lastErrorMessage = exc.message;
      retryInstruction = 'Sua resposta anterior nao seguiu o JSON/schema exigido. Corrija para objeto com NACIONAL, ITAPEVA e ITAPETININGA.';
    }
  }

  throw new Error(`Nao foi possivel obter resposta valida do Gemini. Detalhe: ${lastErrorMessage}`);
}

function buildUserPrompt(parsedInputs, retryInstruction = '') {
  const inputPayload = {};
  for (const [sectionKey, sectionName] of Object.entries(SECTION_LABELS)) {
    const sectionObj = {};
    parsedInputs[sectionKey].forEach((rawItem, index) => {
      sectionObj[String(index + 1)] = rawItem.trim();
    });
    inputPayload[sectionName] = sectionObj;
  }

  const retryBlock = retryInstruction ? `\nAJUSTE:\n${retryInstruction}\n` : '';
  return `${retryBlock}\nENTRADAS JSON:\n${JSON.stringify(inputPayload, null, 2)}\n\nRETORNE APENAS JSON.`;
}

async function callGemini(apiKey, systemPrompt, userPrompt) {
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userPrompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.4,
        topP: 0.95,
        maxOutputTokens: 8192, // Aumentado significativamente
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  let text = candidate?.content?.parts?.[0]?.text;
  const reason = candidate?.finish_reason;

  if (!text) throw new Error(`Resposta vazia. Motivo da parada: ${reason}`);

  function parseRobustJSON(str) {
    // Normalização de caracteres
    let cleaned = str.trim()
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\r/g, "");

    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');

    if (start !== -1 && end !== -1 && end > start) {
      cleaned = cleaned.substring(start, end + 1);
    }

    cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');

    try {
      return JSON.parse(cleaned);
    } catch (e) {
      try {
        const escaped = cleaned.replace(/\n/g, "\\n");
        return JSON.parse(escaped);
      } catch (e2) {
        throw new Error(`JSON incompleto ou malformado. Motivo parada: ${reason}. Detalhe: ${e.message}. Texto: ${cleaned}`);
      }
    }
  }

  try {
    return parseRobustJSON(text);
  } catch (err) {
    throw new Error(`Falha no processamento. ${err.message}`);
  }
}

function getCaseInsensitiveKey(obj, targetKey) {
  const target = targetKey.toUpperCase();
  for (const [key, value] of Object.entries(obj)) {
    if (key.toUpperCase() === target) return value;
  }
  return null;
}

function parseStructuredResponse(payload, expectedCount = 3) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Resposta do Gemini nao veio como objeto JSON.');
  }

  const parsed = {};
  for (const [sectionKey, sectionName] of Object.entries(SECTION_LABELS)) {
    const sectionObj = getCaseInsensitiveKey(payload, sectionName);
    if (!sectionObj || typeof sectionObj !== 'object') {
      throw new Error(`Secao ${sectionName} ausente ou invalida.`);
    }

    const notes = [];
    for (let index = 1; index <= expectedCount; index++) {
      const value = sectionObj[String(index)] || sectionObj[index];
      if (typeof value !== 'string') {
        throw new Error(`Secao ${sectionName} item ${index} ausente ou invalido.`);
      }
      notes.push({ title: `${sectionName} ${index}`, text: value, word_count: countWords(value) });
    }
    parsed[sectionKey] = notes;
  }
  return parsed;
}
