# NewsMaker Sync: Guia Técnico de Integração

Este guia descreve como o aplicativo desktop (**NewsMaker Sync**) deve consumir os boletins informativos gerados pelo site da Rádio POP FM via Cloudflare KV.

---

## 1. Endpoints de API

O aplicativo Sync deve realizar requisições **GET** para buscar os boletins filtrados por cidade.

### URL de Consulta
`https://site-radiopopfm.pages.dev/api/dispatch?city={city_name}`

- `{city_name}`: Deve ser `itapeva` ou `itapetininga`.
- O servidor enviará apenas as notícias da seção `nacional` + as notícias da `cidade` solicitada.

### Cabeçalhos (Headers) Obrigatórios
```http
Authorization: Bearer SUA_SENHA_AQUI
Content-Type: application/json
```

---

## 2. Fluxo de Atualização (Polling)

Para evitar reprocessar arquivos desnecessariamente e economizar recursos, o Sync deve implementar o controle de **versão**.

### Ciclo de Execução (Sugerido: 60 segundos):
1.  **Primeira Execução**: O Sync chama a API sem o parâmetro de versão.
2.  **Resposta 200 OK**: O servidor retorna o JSON completo + um campo `"version"`.
    - O Sync gera os arquivos `.rtf`.
    - O Sync **armazena localmente** a `"version"` recebida (ex: em um arquivo `.txt` ou `.json`).
3.  **Próximas Execuções**: O Sync chama a API passando a versão salva:
    `GET /api/dispatch?city=itapeva&version={ULTIMA_VERSAO_SALVA}`
4.  **Resposta 304 Not Modified**: Se nada mudou no servidor, a API retorna `304`. O Sync não faz nada e aguarda o próximo ciclo.
5.  **Resposta 200 OK**: Se houver atualização, a API envia os novos dados. O Sync repete o passo 2.

---

## 3. Esquema do JSON (Model)

Exemplo de corpo de resposta quando há notícias novas:

```json
{
  "date": "2026-04-03",
  "version": "1775258400000_a1b2c3",
  "dispatched_at": "2026-04-04T00:00:00.000Z",
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

---

## 4. Geração de Arquivos Locais (.rtf)

O Sync deve gerar os arquivos utilizando a estrutura exata esperada pelo sistema de plástica da rádio. Abaixo estão os parâmetros técnicos e a estrutura do documento.

### Parâmetros de Layout (Twips)
| Propriedade | Valor Padrão | Descrição |
|-------------|--------------|-----------|
| `paperw` | 12240 | Largura da folha |
| `paperh` | 15840 | Altura da folha |
| `margl` / `margr` | 1800 | Margens laterais |
| `margt` / `margb` | 1440 | Margens superior/inferior |
| `fs` (Header) | 44 | Tamanho da fonte do cabeçalho (half-points) |
| `fs` (Body) | 44 | Tamanho da fonte do corpo (half-points) |

### Variáveis do Cabeçalho
O cabeçalho deve ser gerado usando o template: `NOTICIAS DA MASSA - NACIONAL - {weekday} {day_month}`
- `{weekday}`: Nome do dia da semana em português (ex: SEGUNDA-FEIRA).
- `{day_month}`: Dia e mês (ex: 04.04).

### Estrutura do Documento RTF
O arquivo final deve seguir esta ordem de blocos RTF:

1.  **Header**: `\pard\qc\b\f{id}\fs{size} {header_text}\par` (Centralizado)
2.  **Linha em branco**: `\pard\ql\fi708\tx8128\b\f{id}\fs{size} \tab \par`
3.  **Horário**: `\pard\qc\sb100\sa100\b\f{id}\fs{size} {time_label}\par` (Ex: 08h55)
4.  **Regional**: `\pard\qj\b0\f{id}\fs{size} {regional_text}\par` (Justificado)
5.  **Separador**: `\pard\qc\f{id}\fs{size} ...\par` (Centralizado)
6.  **Nacional**: `\pard\qj\f{id}\fs{size} {national_text}\par` (Justificado)

### Escrita dos Arquivos
O Sync deve percorrer os arrays `national` e o array da `cidade` no JSON. Para cada par de notícias (ex: Notícia 1 de Nacional + Notícia 1 da Cidade), ele deve gerar os arquivos para todos os slots de horário configurados (ex: `08h55.rtf`, `14h55.rtf`).

---

## 5. Tratamento de Erros e Status

| Código HTTP | Significado | Ação do Sync |
|-------------|-------------|--------------|
| **200 OK** | Sucesso | Processar dados e atualizar versão local. |
| **204 No Content** | Sem Dados | Nenhuma notícia enviada ainda hoje. Aguardar. |
| **304 Not Modified** | Sem Mudança | Manter arquivos atuais. Aguardar. |
| **401 Unauthorized** | Senha Errada | Registrar erro no log e alertar usuário. |
| **404 Not Found** | Cidade Errada | Verificar configuração de cidade no app. |

---

## 6. Exemplo de Código Python (Snippet)

```python
import requests
import time

API_URL = "https://site-radiopopfm.pages.dev/api/generate"
PASSWORD = "SUA_SENHA_AQUI"
CITY = "itapeva"
current_version = None

def check_updates():
    global current_version
    params = {"city": CITY}
    if current_version:
        params["version"] = current_version
        
    headers = {"Authorization": f"Bearer {PASSWORD}"}
    
    response = requests.get(API_URL, params=params, headers=headers)
    
    if response.status_code == 200:
        data = response.json()
        current_version = data["version"]
        process_rtfs(data)
    elif response.status_code == 304:
        print("Sem novas notícias.")
    else:
        print(f"Erro na API: {response.status_code}")
```
