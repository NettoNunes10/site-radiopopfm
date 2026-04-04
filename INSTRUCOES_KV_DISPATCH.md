# Instruções: Enviar Notícias para os Estúdios (KV Dispatch)

Este guia explica como o NewsMaker Web envia as notícias para o Cloudflare KV, e como o app desktop (NewsMaker Sync) as recebe.

---

## Fluxo Completo

```
Site (NewsMaker) ──POST──► Cloudflare KV ◄──GET── App Desktop (NewsMaker Sync)
```

1. O jornalista gera os boletins no site.
2. Clica em **"📡 Enviar para Estúdios"**.
3. O site envia um `POST /api/dispatch` com os textos.
4. O Cloudflare KV armazena os dados por 48h.
5. O app desktop consulta a cada 60s e gera os RTFs localmente.

---

## API: `/api/dispatch`

### Salvar no KV (POST) — chamado pelo site

**Endpoint:** `POST /api/dispatch`

**Headers:**
```
Content-Type: application/json
Authorization: Bearer SUA_SENHA_DO_NEWSMAKER
```

**Body (JSON):**
```json
{
  "date": "2026-04-04",
  "notes": {
    "nacional": [
      { "title": "NACIONAL 1", "text": "Texto da notícia nacional 1...", "word_count": 95 },
      { "title": "NACIONAL 2", "text": "Texto da notícia nacional 2...", "word_count": 92 },
      { "title": "NACIONAL 3", "text": "Texto da notícia nacional 3...", "word_count": 98 }
    ],
    "itapeva": [
      { "title": "ITAPEVA 1", "text": "Texto da notícia de Itapeva 1...", "word_count": 90 },
      { "title": "ITAPEVA 2", "text": "Texto da notícia de Itapeva 2...", "word_count": 94 },
      { "title": "ITAPEVA 3", "text": "Texto da notícia de Itapeva 3...", "word_count": 97 }
    ],
    "itapetininga": [
      { "title": "ITAPETININGA 1", "text": "Texto da notícia de Itapetininga 1...", "word_count": 91 },
      { "title": "ITAPETININGA 2", "text": "Texto da notícia de Itapetininga 2...", "word_count": 96 },
      { "title": "ITAPETININGA 3", "text": "Texto da notícia de Itapetininga 3...", "word_count": 93 }
    ]
  }
}
```

**Resposta de sucesso (200):**
```json
{
  "success": true,
  "version": "1775258400000_a1b2c3",
  "date": "2026-04-04"
}
```

> **Importante:** O campo `notes` deve ter exatamente a mesma estrutura retornada pelo endpoint `POST /api/generate` (o Gemini). O site já faz isso automaticamente ao clicar no botão "Enviar para Estúdios" — ele usa o `window.lastGenerationData.notes`.

---

### Buscar do KV (GET) — chamado pelo app desktop

**Endpoint:** `GET /api/dispatch?city=itapeva`

**Headers:**
```
Authorization: Bearer SUA_SENHA_DO_NEWSMAKER
```

**Query params:**
| Param   | Obrigatório | Descrição |
|---------|-------------|-----------|
| `city`  | Sim | Cidade do estúdio (`itapeva` ou `itapetininga`) |
| `version` | Não | Versão atual do app. Se igual à do KV, retorna `304 Not Modified` |

**Respostas possíveis:**

| Status | Significado |
|--------|-------------|
| `200`  | Há notícias novas — o JSON vem no body |
| `204`  | Nenhum boletim foi enviado ainda |
| `304`  | O app já tem a versão mais recente |
| `401`  | Senha incorreta |
| `404`  | Cidade não encontrada no dispatch |

**Resposta 200 (com notícias):**
```json
{
  "date": "2026-04-04",
  "version": "1775258400000_a1b2c3",
  "dispatched_at": "2026-04-03T23:00:00.000Z",
  "notes": {
    "nacional": [
      { "title": "NACIONAL 1", "text": "Texto...", "word_count": 95 },
      { "title": "NACIONAL 2", "text": "Texto...", "word_count": 92 },
      { "title": "NACIONAL 3", "text": "Texto...", "word_count": 98 }
    ],
    "itapeva": [
      { "title": "ITAPEVA 1", "text": "Texto...", "word_count": 90 },
      { "title": "ITAPEVA 2", "text": "Texto...", "word_count": 94 },
      { "title": "ITAPEVA 3", "text": "Texto...", "word_count": 97 }
    ]
  }
}
```

> O GET filtra automaticamente: retorna apenas `nacional` + a cidade pedida.

---

## Como o KV Armazena

O `dispatch.js` salva duas chaves no KV:

| Chave KV | Conteúdo | TTL |
|----------|----------|-----|
| `dispatch:latest` | Sempre o último envio (usada pelo GET) | 48h |
| `dispatch:2026-04-04` | Cópia por data (histórico) | 48h |

Ambas contêm o mesmo JSON:
```json
{
  "date": "2026-04-04",
  "version": "1775258400000_a1b2c3",
  "notes": { ... },
  "dispatched_at": "2026-04-03T23:00:00.000Z"
}
```

---

## Código JS do Botão no Site

O botão "📡 Enviar para Estúdios" no `news-maker/index.html` executa:

```javascript
async function dispatchToStudios() {
  const response = await fetch('/api/dispatch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${password}`,
    },
    body: JSON.stringify({
      date: window.lastGenerationData.date,
      notes: window.lastGenerationData.notes,
    }),
  });
}
```

Ele simplesmente pega o resultado já gerado pelo Gemini (`lastGenerationData`) e envia para o KV.

---

## Configuração Obrigatória no Cloudflare

Para que o `/api/dispatch` funcione, é **obrigatório** vincular o KV namespace:

1. Painel do Cloudflare → **Workers & Pages** → seu projeto
2. **Settings** → **Functions** → **KV namespace bindings**
3. Adicione:
   - **Variable name:** `NEWSMAKER_KV`
   - **KV namespace:** selecione o namespace que você criou

Sem esse binding, o endpoint retorna erro `500: KV namespace not configured`.
