# Guia de Integração - Massa Sync (Musical)

Este documento descreve as especificações técnicas para que o servidor entregue roteiros musicais (.bil) ao aplicativo local Massa Sync.

## 🔗 Endpoint e Autenticação
- **URL**: `{SERVER_URL}/api/playlist`
- **Método**: `GET`
- **Autenticação**: O app envia o cabeçalho `Authorization: Bearer {SENHA}`.

## 📡 Parâmetros de Consulta (Query Params)
1. `city`: Nome da cidade configurada no app (Ex: `itapeva` ou `itapetininga`).
2. `version`: (Opcional) A versão do último roteiro que o app baixou. Use para controle de cache.

## 📤 Cabeçalhos Enviados pelo App (Headers)
O servidor pode usar estes cabeçalhos para telemetria ou logs:
- `X-Sync-Host`: Nome do computador onde o app está rodando.
- `X-Sync-Version`: Versão do app (Ex: `2.2-MassaSync`).

## 📥 Formato de Resposta Esperado (JSON)
O servidor **DEVE** retornar um JSON com a seguinte estrutura quando houver um novo arquivo:

```json
{
  "version": "v20260404_123", 
  "filename": "20260404.bil",
  "content": "CONTEÚDO_BRUTO_DO_ARQUIVO_TEXTO"
}
```

### Detalhes dos Campos:
- **`version`**: Uma string única (timestamp ou hash) que identifica esta versão do roteiro. Se for igual à enviada pelo app, o servidor deve retornar HTTP 304.
- **`filename`**: O nome exato do arquivo que será salvo na rádio (Ex: `20260404.bil`). **O app irá sobrescrever arquivos locais com o mesmo nome.**
- **`content`**: O texto completo do roteiro musical. O Massa Sync local cuidará de converter este texto para a codificação **Windows-1252 (ANSI)** antes de salvar.

---

## 🚦 Códigos de Status HTTP Recomendados

- **`200 OK`**: Novo roteiro disponível (enviar JSON acima).
- **`304 Not Modified`**: O roteiro no servidor é o mesmo que o app já possui (economiza banda).
- **`401 Unauthorized`**: Senha/Token inválido.
