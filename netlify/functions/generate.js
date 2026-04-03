const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const SECTION_LABELS = {
  nacional: 'NACIONAL',
  itapeva: 'ITAPEVA',
  itapetininga: 'ITAPETININGA',
};

const WORD_LIMITS = { min: 80, max: 110, target: 95 };

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

function buildResponseSchema(expectedCount = 3) {
  const itemProperties = {};
  for (let i = 1; i <= expectedCount; i++) {
    itemProperties[String(i)] = { type: 'string' };
  }
  
  const sectionSchema = {
    type: 'object',
    properties: itemProperties,
    required: Object.keys(itemProperties),
  };
  
  return {
    type: 'object',
    properties: {
      NACIONAL: sectionSchema,
      ITAPEVA: sectionSchema,
      ITAPETININGA: sectionSchema,
    },
    required: ['NACIONAL', 'ITAPEVA', 'ITAPETININGA'],
  };
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

async function generateNotes(parsedInputs, apiKey, instructions) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const maxAttempts = 3;
  const minWords = 80;
  const maxWords = 110;
  
  let retryInstruction = '';
  let lastErrorMessage = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const userPrompt = buildUserPrompt(parsedInputs, retryInstruction);
    
    try {
      const rawResponse = await callGemini(genAI, instructions, userPrompt);
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

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization;
  const expectedPassword = config.NEWSMAKER_PASSWORD;
  
  if (!expectedPassword || authHeader !== `Bearer ${expectedPassword}`) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const apiKey = config.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'SUA_CHAVE_AQUI') {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key nao configurada no servidor' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { nacional = [], itapeva = [], itapetininga = [], date } = body;

    const expectedCount = 3;
    const sections = { nacional, itapeva, itapetininga };

    for (const [key, items] of Object.entries(sections)) {
      const validItems = items.filter(item => item && item.trim());
      if (validItems.length !== expectedCount) {
        return { 
          statusCode: 400, 
          body: JSON.stringify({ error: `Secao ${key} precisa de ${expectedCount} noticias. Recebidas: ${validItems.length}` }) 
        };
      }
      sections[key] = validItems;
    }

    const instructionsPath = path.join(__dirname, '..', 'instructions.txt');
    const instructions = fs.readFileSync(instructionsPath, 'utf-8').trim();

    const notesBySection = await generateNotes(sections, apiKey, instructions);

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

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message }),
    };
  }
};