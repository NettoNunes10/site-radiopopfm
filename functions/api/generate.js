import { GoogleGenerativeAI } from '@google/generative-ai';

const SECTION_LABELS = {
  nacional: 'NACIONAL',
  itapeva: 'ITAPEVA',
  itapetininga: 'ITAPETININGA',
};

const INSTRUCTIONS = `Voce e um experiente redator e editor de jornalismo para radio, focado em criar boletins informativos dinamicos e diretos.

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
Ignore creditos de portal, assinaturas, horarios de atualizacao, legendas de fotos e chamadas para redes sociais.

5. FORMATO DE SAIDA OBRIGATORIO:
Retorne APENAS JSON valido, sem markdown e sem texto extra, no formato:
{
  "NACIONAL": {
    "1": "Noticia 1",
    "2": "Noticia 2",
    "3": "Noticia 3"
  },
  "ITAPEVA": {
    "1": "Noticia 1",
    "2": "Noticia 2",
    "3": "Noticia 3"
  },
  "ITAPETININGA": {
    "1": "Noticia 1",
    "2": "Noticia 2",
    "3": "Noticia 3"
  }
}

Mantenha fidelidade aos fatos.
Nao invente dados e nao adicione contexto externo nao presente na entrada.`;

function countWords(text) {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

function sanitizeSourceItem(text, maxChars = 12000) {
  const normalized = text.trim();
  if (normalized.length <= maxChars) return normalized;
  return normalized.slice(0, maxChars).lastIndexOf(' ') > 0 
    ? normalized.slice(0, normalized.lastIndexOf(' ', maxChars))
    : normalized.slice(0, maxChars);
}

function buildInputPayload(parsedInputs) {
  const payload = {};
  for (const [sectionKey, sectionName] of Object.entries(SECTION_LABELS)) {
    const sectionObj = {};
    parsedInputs[sectionKey].forEach((rawItem, index) => {
      sectionObj[String(index + 1)] = sanitizeSourceItem(rawItem);
    });
    payload[sectionName] = sectionObj;
  }
  return payload;
}

function buildUserPrompt(parsedInputs, retryInstruction = '') {
  const inputPayload = buildInputPayload(parsedInputs);
  const inputJson = JSON.stringify(inputPayload, null, 2);
  
  const retryBlock = retryInstruction 
    ? `\nAJUSTE OBRIGATORIO:\n${retryInstruction}\n` 
    : '';
  
  return `${retryBlock}
ENTRADAS JSON:
${inputJson}

RETORNE APENAS JSON VALIDO no formato esperado.`;
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
      throw new Error(`Secao ${sectionName} ausente ou invalida no JSON de resposta.`);
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

function validateWordCount(notesBySection, minWords, maxWords) {
  const errors = [];
  for (const [sectionKey, notes] of Object.entries(notesBySection)) {
    notes.forEach((note, idx) => {
      if (note.word_count < minWords || note.word_count > maxWords) {
        errors.push(`${sectionKey.toUpperCase()} ${idx + 1}: ${note.word_count} palavras (esperado: ${minWords}-${maxWords})`);
      }
    });
  }
  return errors;
}

async function callGemini(genAI, systemPrompt, userPrompt) {
  const model = genAI.getGenerativeModel({ systemInstruction: systemPrompt });
  
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.4,
      topP: 0.95,
      maxOutputTokens: 3000,
    },
  });
  
  const response = result.response;
  const text = response.text();
  
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Resposta do Gemini nao e JSON valido: ' + text.slice(0, 200));
  }
}

async function generateNotes(parsedInputs, apiKey) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const maxAttempts = 3;
  const minWords = 80;
  const maxWords = 110;
  
  let retryInstruction = '';
  let lastErrorMessage = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const userPrompt = buildUserPrompt(parsedInputs, retryInstruction);
    
    try {
      const rawResponse = await callGemini(genAI, INSTRUCTIONS, userPrompt);
      const notesBySection = parseStructuredResponse(rawResponse, 3);
      
      const invalidNotes = validateWordCount(notesBySection, minWords, maxWords);
      
      if (invalidNotes.length > 0) {
        lastErrorMessage = `Noticias fora do limite (${minWords}-${maxWords}): ${invalidNotes.join(', ')}`;
        retryInstruction = `Atencao: as seguintes noticias estao com numero de palavras fora do limite (${minWords}-${maxWords}): ${invalidNotes.join(', ')}. Reescreva mantendo o limite de palavras.`;
        continue;
      }
      
      return notesBySection;
    } catch (exc) {
      lastErrorMessage = exc.message;
      retryInstruction = 'Sua resposta anterior nao seguiu o JSON/schema exigido. Corrija para objeto com NACIONAL, ITAPEVA e ITAPETININGA, cada um contendo itens 1, 2 e 3 em texto.';
    }
  }

  throw new Error(`Nao foi possivel obter resposta valida do Gemini. Detalhe: ${lastErrorMessage}`);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  const expectedPassword = env.NEWSMAKER_PASSWORD;
  
  if (!expectedPassword || authHeader !== `Bearer ${expectedPassword}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key nao configurada no servidor' }), { status: 500 });
  }

  try {
    const body = await request.json();
    const { nacional = [], itapeva = [], itapetininga = [], date } = body;

    const expectedCount = 3;
    const sections = { nacional, itapeva, itapetininga };

    for (const [key, items] of Object.entries(sections)) {
      const validItems = items.filter(item => item && item.trim());
      if (validItems.length !== expectedCount) {
        return new Response(JSON.stringify({ 
          error: `Secao ${key} precisa de ${expectedCount} noticias. Recebidas: ${validItems.length}` 
        }), { status: 400 });
      }
      sections[key] = validItems;
    }

    const notesBySection = await generateNotes(sections, apiKey);

    const timePairs = [
      ['08H55', '14H55'],
      ['09H55', '15H55'],
      ['10H55', '16H55'],
    ];

    const result = {
      date,
      notes: notesBySection,
      time_pairs: timePairs,
      success: true,
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
