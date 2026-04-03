# Instruções de Deploy: NewsMaker Web (Cloudflare Pages)

Agora que o projeto está pronto e configurado para Cloudflare Pages, siga os passos abaixo para realizar o deploy:

## Passo 1: Subir para o Git
Abra o seu terminal na pasta do projeto e execute:

```bash
git add .
git commit -m "feat: migrate to Cloudflare, add city-separated KV sync and RTF download"
git push origin main
```

---

## Passo 2: Configurar no Painel do Cloudflare
Acesse o seu dashboard na Cloudflare e vá em **Workers & Pages** → Seu projeto.

### 1. Vincular o KV (Extremamente Importante)
Para que a sincronização funcione, o backend precisa acessar o banco de dados KV:
1. Vá em **Settings** → **Functions**.
2. Role até **KV namespace bindings**.
3. Clique em **Add binding**.
4. **Variable name**: `NEWSMAKER_KV` (deve ser exatamente este nome).
5. **KV namespace**: Selecione o namespace que você criou para este projeto.

### 2. Variáveis de Ambiente
Na mesma aba **Settings** → **Functions**, vá em **Environment variables** e adicione:
- `GEMINI_API_KEY`: Sua chave de API do Google Gemini.
- `NEWSMAKER_PASSWORD`: A senha que os jornalistas usarão para entrar no site e autorizar as requisições.

---

## Passo 3: Testar
Após o deploy automático terminar (acompanhe na aba *Deployments*):
1. Acesse o seu domínio `https://seu-portal.pages.dev/news-maker/`.
2. Faça login com a senha configurada.
3. Gere um boletim e verifique se as opções de **Download ZIP** e **Sincronizar KV** funcionam conforme o esperado.
