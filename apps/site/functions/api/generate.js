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
Margem estrita: nunca menos de 80 palavras e nunca mais de 110 palavras (exceto quando a entrada for um marcador de sem noticia).

3. TOTAL INDEPENDENCIA:
As notas nao serao necessariamente lidas em sequencia.
Portanto, NUNCA use frases de transicao entre noticias.

4. RITMO DE LOCUCAO:
Texto pensado para radio.
Use ordem direta nas frases.
Evite frases longas.
Transforme numeros exatos em aproximacoes amigaveis para radio quando fizer sentido editorial, mas sempre mantendo numerais.

5. NUMEROS:
Use algarismos para numeros simples, nunca por extenso.
Isso vale para quantidades, idades, datas, horarios, valores, percentuais, medidas, rankings e aproximacoes.
Para numeros grandes, use forma mista e natural para radio, com algarismo + unidade por extenso.
Exemplos corretos: "2 pessoas", "1 crianca", "10 anos", "cerca de 3 mil", "10 milhoes", "2,5 bilhoes", "mais de 20%", "as 19h", "dia 24".
Exemplos proibidos: "duas pessoas", "uma crianca", "dez anos", "tres mil", "vinte por cento", "sete horas".

6. TEMPORALIDADE E DATAS:
A data escolhida no painel e a DATA DE EXIBICAO/LOCUCAO do boletim.
Use essa data como unica referencia para palavras como "hoje", "ontem", "amanha", "nesta quarta", "na ultima segunda" e semelhantes.
So use "hoje" se o fato aconteceu exatamente na DATA DE EXIBICAO.
So use "ontem" se o fato aconteceu exatamente no dia anterior a DATA DE EXIBICAO.
Nao transforme datas explicitas do texto original em relativos se elas nao baterem com a DATA DE EXIBICAO.
Leia todas as datas no corpo da noticia e compare com a DATA DE EXIBICAO antes de adaptar qualquer linguagem temporal.
Se a noticia trouxer uma frase antiga como "acontecera hoje" ou "acontece hoje", reescreva para passado, presente ou futuro conforme a DATA DE EXIBICAO.
Use dia da semana apenas quando a data for recente e isso ajudar a compreensao: "ontem", "nesta terca", "na ultima quarta, dia 20".
Para datas mais distantes, evite dia da semana. Prefira "no dia 24 do mes passado", "dia 24 de abril" ou "em 24 de abril", conforme soar mais natural.
Nao escreva "quarta-feira, dia 24 de abril" quando a data nao for recente. O dia da semana so deve aparecer quando houver proximidade temporal ou relevancia editorial clara.
Quando houver data explicita ou risco de ambiguidade em data recente, prefira: "na terca-feira, dia 19", "na quarta-feira, dia 20", "na segunda-feira, dia 18".
Evite expressoes como "ultima segunda-feira" quando o texto traz o dia do mes e a data nao for recente.
Ignore marcadores relativos do site, como "atualizado ha 8 horas", se eles conflitarem com a DATA DE EXIBICAO.

7. FORMATO DE SAIDA OBRIGATORIO:
Retorne APENAS JSON valido no formato:
{
  "NACIONAL": { "1": "Noticia 1", "2": "Noticia 2", "3": "Noticia 3" },
  "ITAPEVA": { "1": "Noticia 1", "2": "Noticia 2", "3": "Noticia 3" },
  "ITAPETININGA": { "1": "Noticia 1", "2": "Noticia 2", "3": "Noticia 3" }
}

8. LOCALIZACAO:
Matérias que mencionem locais, quando o local for "interior de São Paulo", cite o nome do local no lugar de "interior de São Paulo" e não adicione menção ao interior de São Paulo.
Exemplo: no lugar de "isso aconteceu em Tiete, interior de São Paulo", coloque apenas: "isso aconteceu em Tiete".

9. MARCADORES DE SEM NOTÍCIA:
Se a entrada de qualquer notícia for apenas um marcador como "SEM NOTICIA", "SEM NOTÍCIA", "N/A" ou texto equivalente indicando falta de matéria, retorne exatamente "SEM NOTÍCIA" para aquele item, sem inventar fatos fictícios e sem aplicar a meta de 95 palavras.

Mantenha fidelidade aos fatos.
Nao invente dados e nao adicione contexto externo nao presente na entrada.`;

    const model = getGeminiModel(env);
    const notesBySection = await generateNotes(sections, apiKey, instructions, date, model);

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

function getGeminiModel(env) {
  const model = String(env.GEMINI_MODEL || '').trim();
  return model || 'gemini-2.5-flash-lite';
}

async function generateNotes(sections, apiKey, instructions, targetDate, model) {
  const maxAttempts = 2;
  const expectedCount = 3;

  let retryInstruction = '';
  let lastErrorMessage = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const parsed = await callGeminiWithFallback(apiKey, model, instructions, buildUserPrompt(sections, targetDate, retryInstruction));
      return parseStructuredResponse(parsed, expectedCount);
    } catch (exc) {
      lastErrorMessage = exc.message;
      retryInstruction = 'Sua resposta anterior nao seguiu o JSON/schema exigido. Corrija para objeto JSON com chaves NACIONAL, ITAPEVA e ITAPETININGA, cada qual contendo chaves "1", "2", "3".';
    }
  }

  throw new Error(`Nao foi possivel obter resposta valida do Gemini. Detalhe: ${lastErrorMessage}`);
}

function parseDateOnly(dateStr) {
  const match = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || !month || !day) return null;

  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function formatDateBR(date) {
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function addDaysUTC(date, days) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function buildTemporalContext(targetDate) {
  const date = parseDateOnly(targetDate);
  if (!date) {
    return `DATA DE EXIBICAO/LOCUCAO: nao informada.
Evite usar "hoje", "ontem" ou "amanha" quando a data do fato nao estiver absolutamente clara.`;
  }

  const weekdays = ['domingo', 'segunda-feira', 'terca-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sabado'];
  const weekday = weekdays[date.getUTCDay()];
  const yesterday = addDaysUTC(date, -1);
  const tomorrow = addDaysUTC(date, 1);

  return `DATA DE EXIBICAO/LOCUCAO: ${weekday}, ${formatDateBR(date)}.
Nesta geracao, "hoje" significa somente ${formatDateBR(date)}.
Nesta geracao, "ontem" significa somente ${formatDateBR(yesterday)}.
Nesta geracao, "amanha" significa somente ${formatDateBR(tomorrow)}.
Se o texto original citar outra data, escreva a data absoluta com dia da semana quando possivel.`;
}

function buildUserPrompt(parsedInputs, targetDate, retryInstruction = '') {
  const inputPayload = {};
  for (const [sectionKey, sectionName] of Object.entries(SECTION_LABELS)) {
    const sectionObj = {};
    parsedInputs[sectionKey].forEach((rawItem, index) => {
      sectionObj[String(index + 1)] = rawItem.trim();
    });
    inputPayload[sectionName] = sectionObj;
  }

  const retryBlock = retryInstruction ? `\nAJUSTE:\n${retryInstruction}\n` : '';
  const temporalContext = buildTemporalContext(targetDate);
  return `${retryBlock}\n${temporalContext}\n\nANTES DE RESPONDER: revise cada uso de "hoje", "ontem", "amanha", "nesta", "ultima" e similares contra a DATA DE EXIBICAO.\n\nENTRADAS JSON:\n${JSON.stringify(inputPayload, null, 2)}\n\nRETORNE APENAS JSON.`;
}

async function callGeminiWithFallback(apiKey, preferredModel, systemPrompt, userPrompt) {
  const candidateModels = [
    preferredModel,
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-1.5-flash'
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  let lastError = null;

  for (const model of candidateModels) {
    try {
      return await callGeminiSingle(apiKey, model, systemPrompt, userPrompt);
    } catch (err) {
      lastError = err;
      const isRecoverable = err.message.includes('(404)') || 
                            err.message.includes('(400)') || 
                            err.message.includes('(503)') || 
                            err.message.includes('not found') ||
                            err.message.includes('unsupported');
      if (isRecoverable) {
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('Nenhum modelo Gemini respondeu.');
}

async function callGeminiSingle(apiKey, model, systemPrompt, userPrompt) {
  const encodedModel = encodeURIComponent(model);
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodedModel + ':generateContent?key=' + apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userPrompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            NACIONAL: {
              type: 'OBJECT',
              properties: {
                '1': { type: 'STRING' },
                '2': { type: 'STRING' },
                '3': { type: 'STRING' }
              },
              required: ['1', '2', '3']
            },
            ITAPEVA: {
              type: 'OBJECT',
              properties: {
                '1': { type: 'STRING' },
                '2': { type: 'STRING' },
                '3': { type: 'STRING' }
              },
              required: ['1', '2', '3']
            },
            ITAPETININGA: {
              type: 'OBJECT',
              properties: {
                '1': { type: 'STRING' },
                '2': { type: 'STRING' },
                '3': { type: 'STRING' }
              },
              required: ['1', '2', '3']
            }
          },
          required: ['NACIONAL', 'ITAPEVA', 'ITAPETININGA']
        },
        temperature: 0.4,
        topP: 0.95,
        maxOutputTokens: 8192
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error [${model}] (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  
  // Extrai as partes que contêm o texto da resposta (filtrando pensamentos/raciocínio interno em modelos com thinking)
  const nonThoughtParts = parts.filter(p => !p.thought && typeof p.text === 'string');
  let text = nonThoughtParts.map(p => p.text).join('').trim();

  if (!text) {
    text = parts.map(p => p.text || '').join('').trim();
  }

  const reason = candidate?.finishReason || candidate?.finish_reason;
  if (!text) throw new Error(`Resposta vazia do Gemini. Motivo da parada: ${reason || 'desconhecido'}`);

  function parseRobustJSON(str) {
    let cleaned = str.trim()
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\r/g, "");

    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

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
        const escaped = cleaned.replace(/(?<!\\)\n/g, '\\n');
        return JSON.parse(escaped);
      } catch (e2) {
        throw new Error(`JSON malformado do Gemini. Detalhe: ${e.message}. Texto retornado: ${cleaned.slice(0, 300)}`);
      }
    }
  }

  return parseRobustJSON(text);
}

function getCaseInsensitiveKey(obj, targetKey) {
  if (!obj || typeof obj !== 'object') return null;
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
    let sectionObj = getCaseInsensitiveKey(payload, sectionName);
    if (!sectionObj) {
      sectionObj = payload[sectionKey] || payload[sectionKey.toLowerCase()];
    }

    if (!sectionObj || typeof sectionObj !== 'object') {
      throw new Error(`Secao ${sectionName} ausente ou invalida no retorno do Gemini.`);
    }

    const notes = [];
    for (let index = 1; index <= expectedCount; index++) {
      let value;
      if (Array.isArray(sectionObj)) {
        value = sectionObj[index - 1];
      } else {
        value = sectionObj[String(index)] ?? sectionObj[index];
      }

      if (typeof value === 'object' && value !== null) {
        value = value.text || value.noticia || value.conteudo || value.nota || JSON.stringify(value);
      }

      if (typeof value !== 'string') {
        throw new Error(`Secao ${sectionName} item ${index} ausente ou invalido.`);
      }

      notes.push({
        title: `${sectionName} ${index}`,
        text: value.trim(),
        word_count: countWords(value)
      });
    }
    parsed[sectionKey] = notes;
  }
  return parsed;
}
