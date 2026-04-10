/**
 * Cloudflare Pages Function - Processamento Automático de Playlists (.bil)
 * Agora 100% unificado usando o MusicEngine centralizado.
 */
import { MusicEngine } from "../../admin/roteiro.js";

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 
      'Content-Type': 'application/json', 
      'Cache-Control': 'no-store',
      ...CORS_HEADERS 
    },
  });
}

function authorize(request, env) {
  const authHeader = (request.headers.get('authorization') || request.headers.get('Authorization') || '').trim();
  const expectedPassword = env.NEWSMAKER_PASSWORD;
  if (!expectedPassword || expectedPassword.trim() === '') return false;
  return authHeader === `Bearer ${expectedPassword}`;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!authorize(request, env)) return jsonResponse({ error: 'Unauthorized' }, 401);

  const kv = env.NEWSMAKER_KV;
  if (!kv) return jsonResponse({ error: 'KV namespace not configured.' }, 500);

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const fileName = formData.get('fileName') || (file instanceof File ? file.name : 'playlist.bil');

    if (!file) return jsonResponse({ error: 'No file provided.' }, 400);

    // Extrair Data YYYYMMDD do nome do arquivo
    const dateMatch = fileName.match(/(\d{8})/);
    if (!dateMatch) return jsonResponse({ error: 'Date (YYYYMMDD) not found in filename.' }, 400);
    const dateStr = dateMatch[1];
    const date = new Date(`${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}T12:00:00`);

    // Busca configurações no KV
    const fetchConfig = async (key) => {
      const val = await kv.get(key);
      try { return val ? JSON.parse(val) : null; } catch { return null; }
    };

    const [rules, jabasRaw, prefixes, vignetts, promosRaw] = await Promise.all([
      fetchConfig('config_music_rules'),
      fetchConfig('config_music_jabas'),
      fetchConfig('config_music_prefixes'),
      fetchConfig('config_music_substitutions'),
      fetchConfig('config_music_promos')
    ]);

    const musicRules = rules || { janelas_permitidas: {}, remover_blocos: {}, renomear_blocos: {} };
    const musicJabas = (jabasRaw && (jabasRaw.configuracao_jabas || jabasRaw.jabas)) || [];
    const musicPrefixes = prefixes || { options_by_day: {} };
    const musicSubst = vignetts || { substituicoes: [] };
    const musicPromos = promosRaw || [];

    // Processar conteúdo do arquivo (Windows-1252)
    const arrayBuffer = await file.arrayBuffer();
    const decoder = new TextDecoder('windows-1252');
    const content = decoder.decode(arrayBuffer);

    // EXECUÇÃO DO MOTOR UNIFICADO
    const result = MusicEngine.process(content, musicRules, musicJabas, musicPrefixes, musicSubst, date, musicPromos);

    // Salva no KV para ambas as cidades
    const saveToKV = async (city, processedContent) => {
      const cityKey = city.toLowerCase();
      const payload = {
        city: cityKey,
        date: dateStr,
        filename: fileName,
        content: processedContent,
        dispatched_at: new Date().toISOString(),
        automated: true
      };
      
      await kv.put(`playlist:${cityKey}:${dateStr}`, JSON.stringify(payload), { expirationTtl: 86400 * 7 });

      const indexKey = `playlist:pending:${cityKey}`;
      const existingRaw = await kv.get(indexKey);
      let pendingDates = existingRaw ? JSON.parse(existingRaw) : [];
      if (!pendingDates.includes(dateStr)) {
        pendingDates.push(dateStr);
        pendingDates.sort();
        await kv.put(indexKey, JSON.stringify(pendingDates), { expirationTtl: 86400 * 7 });
      }
    };

    await Promise.all([
      saveToKV('itapeva', result.itapeva),
      saveToKV('itapetininga', result.itapetininga)
    ]);

    return jsonResponse({
      success: true,
      fileName,
      date: dateStr,
      logs: result.logs
    });

  } catch (error) {
    return jsonResponse({ error: `Processing failed: ${error.message}` }, 500);
  }
}
