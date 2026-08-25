# Deploy na Cloudflare (Pages + Worker de cron), mantendo o Neon

Este guia cobre só os comandos que precisam ser rodados com a SUA conta
Cloudflare (login, criação de recursos, secrets, deploy). Eu não tenho acesso
à sua conta Cloudflare nem à connection string do Neon, então essa parte
precisa ser feita por você (ou colada localmente no seu terminal — nunca no
chat). O código já está pronto neste branch (`cloudflare-migration`).

O Vercel continua rodando normalmente enquanto isso — nada em `api/` que
afeta o comportamento externo foi removido, e `vercel.json` não foi tocado.

## 0. Pré-requisitos

```bash
npm install -g wrangler   # ou use `npx wrangler`
wrangler login
```

## 1. Criar o Hyperdrive apontando pro Neon

```bash
wrangler hyperdrive create coderise-neon --connection-string="<sua DATABASE_URL pooled do Neon>"
```

Isso devolve um `id`. Cole esse `id` em **dois** arquivos:
- `wrangler.toml` (raiz do projeto — Pages)
- `cron-worker/wrangler.toml` (Worker do cron)

Ambos precisam apontar para o **mesmo** Hyperdrive.

## 2. Criar o projeto Pages e configurar o build

```bash
wrangler pages project create coderise-app
```

Configuração de build (dashboard da Cloudflare Pages, ou via `wrangler.toml`
já criado neste branch):
- Comando de build: `npm run build`
- Diretório de output: `dist`
- Diretório de Functions: `functions` (padrão, já detectado automaticamente)

## 3. Secrets do projeto Pages

Os únicos `process.env.*` usados hoje no `api/` são estes três (confirmei via
grep no código, não há mais nenhum):

```bash
wrangler pages secret put ADMIN_SECRET --project-name=coderise-app
wrangler pages secret put CRON_SECRET  --project-name=coderise-app
```

(`DATABASE_URL` não precisa ser configurada separadamente — o Hyperdrive já
resolve isso via o binding declarado no `wrangler.toml`.)

## 4. Deploy do front-end + API (Pages)

```bash
npm run build
wrangler pages deploy dist --project-name=coderise-app
```

Isso sobe o front-end estático e as Pages Functions (`functions/[[path]].js`)
juntos, no mesmo domínio — é por isso que `VITE_API_URL` pode continuar vazio.

## 5. Deploy do Worker de cron

```bash
cd cron-worker
wrangler secret put CRON_SECRET   # mesmo valor do passo 3, caso algum código compartilhado dependa dele
wrangler deploy
cd ..
```

O Cron Trigger já está declarado em `cron-worker/wrangler.toml`
(`*/15 * * * *` — mesmo intervalo do cron-job.org atual). Depois de confirmar
que está rodando (veja `wrangler tail` no dashboard do Worker), pode desativar
o job no cron-job.org.

## 6. Testar antes de apontar domínio de verdade

```bash
wrangler pages dev -- npm run dev   # ou: wrangler pages dev dist
wrangler dev --test-scheduled       # dentro de cron-worker/, simula o Cron Trigger
```

Roteiro mínimo de teste (local ou no preview `*.pages.dev` gerado pelo passo 4):
1. Login.
2. Cadastrar uma integração de teste (credenciais fictícias/sandbox, não reais).
3. Abrir a tela de Webhooks e confirmar que o long-poll continua respondendo.
4. Disparar um webhook manual: `curl "https://<seu-preview>.pages.dev/webhook?token=<webhook_token de teste>" -X POST -d '{}'` e confirmar que aparece na tela.
5. `wrangler dev --test-scheduled` no `cron-worker/` e conferir no log que `syncCatalogForIntegrationRow` roda sem erro de conexão.

Só depois disso: apontar o domínio definitivo na Cloudflare e, aí sim, cadastrar
a loja real pela tela normal de Integrações — sem precisar de nenhuma
credencial dela fora do app.
