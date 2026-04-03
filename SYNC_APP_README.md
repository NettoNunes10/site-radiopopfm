# NewsMaker Sync - Guia de Integração (API KV)

Este documento contém as especificações técnicas para o desenvolvimento/atualização do aplicativo de sincronia local que roda nos estúdios da Rádio POP FM.

## O que mudou? (Abril/2026)
A API de despacho agora separa automaticamente as notícias por cidade. Cada estúdio (Itapeva ou Itapetininga) recebe apenas os boletins Nacionais + os boletins específicos da sua cidade.

---

## Detalhes da API

### Endpoint de Polling
**URL:** `https://seu-dominio.pages.dev/api/dispatch`  
**Método:** `GET`

### Parâmetros Obrigatórios (Query)
| Param | Valor | Descrição |
|---|---|---|
| `city` | `itapeva` OU `itapetininga` | Identifica qual estúdio está pedindo dados. |
| `version` | (opcional) | O `version` do último JSON recebido. |

### Headers de Autenticação
```http
Authorization: Bearer SUA_SENHA_DO_NEWSMAKER
```

---

## Fluxo de Polling Recomendado (60s)

1. O app local faz um `GET /api/dispatch?city=itapeva&version=1775...`
2. **Resposta 304 Not Modified**: Se não houver notícias novas desde a última versão informada.
3. **Resposta 200 OK**: Se houver novidades, o body conterá o JSON completo.
4. **Resposta 204 No Content**: Nenhuma notícia foi despachada para esta cidade nas últimas 48h.

---

## Estrutura do JSON (Resposta 200)

```json
{
  "date": "2026-04-04",
  "version": "1775258400000_a1b2c3",
  "dispatched_at": "2026-04-03T23:00:00.000Z",
  "notes": {
    "nacional": [
      { "text": "Texto da notícia nacional 1", "word_count": 95 },
      { "text": "Texto da notícia nacional 2", "word_count": 92 },
      { "text": "Texto da notícia nacional 3", "word_count": 98 }
    ],
    "itapeva": [
      { "text": "Texto da cidade 1", "word_count": 90 },
      { "text": "Texto da cidade 2", "word_count": 94 },
      { "text": "Texto da cidade 3", "word_count": 97 }
    ]
  }
}
```

### Notas Importantes sobre o JSON:
- Através da chave `notes`, você encontrará sempre 2 sub-chaves: `nacional` e a `<sua_cidade>`.
- Cada uma sempre terá exatamente **3 itens (0, 1 e 2)**.
- O mapeamento para horários (ex: 3 boletins para 6 faixas horárias) deve seguir a lógica local do app:
  - Par 1: Nacional[0] + Regional[0]
  - Par 2: Nacional[1] + Regional[1]
  - Par 3: Nacional[2] + Regional[2]

---

## Configuração no Cloudflare (Dashboard)
Para que esta API funcione, o ambiente de produção deve ter:
1. Um **KV Namespace** vinculado com o nome `NEWSMAKER_KV`.
2. As variáveis de ambiente `NEWSMAKER_PASSWORD` e `GEMINI_API_KEY` configuradas em *Settings > Functions*.
