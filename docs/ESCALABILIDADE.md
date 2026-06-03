# Guia de Escalabilidade — CodeRise

## Novas variáveis de ambiente (Vercel Dashboard → Settings → Environment Variables)

| Variável         | Descrição                                                                 | Exemplo                          |
|------------------|---------------------------------------------------------------------------|----------------------------------|
| `DATABASE_URL`   | URL pooled do Neon (com `-pooler` no hostname)                            | `postgresql://user:pass@ep-...`  |
| `ADMIN_SECRET`   | Chave de admin para chamadas internas                                     | `minha-chave-secreta-forte`      |
| `CRON_SECRET`    | Chave para autenticar os crons do Vercel (`/queue/process`, `/cleanup`)   | `outro-segredo-forte`            |
| `JWT_SECRET`     | (futuro) Caso migre para JWT                                              | —                                |

## Configurar CRON_SECRET no Vercel

No Vercel, vá em **Settings → Cron Jobs** e adicione a variável `CRON_SECRET`. O mesmo valor deve estar em **Environment Variables** para que o handler `/queue/process` aceite as chamadas do cron.

## Trocar para o driver HTTP do Neon (recomendado)

```bash
cd api
npm install @neondatabase/serverless
```

Use a **URL pooled** (endpoint com `-pooler`), que aparece no painel do Neon como:
```
postgresql://user:password@ep-xxx-yyy-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
```

Com esse driver, cada invocação da serverless function usa uma única requisição HTTP ao Neon em vez de manter uma conexão TCP persistente. Isso elimina o problema de saturação do pool.

## Crons configurados (vercel.json)

| Rota              | Schedule     | O que faz                                               |
|-------------------|--------------|---------------------------------------------------------|
| `/queue/process`  | `* * * * *`  | Processa até 50 jobs pendentes por minuto (paralelismo) |
| `/cleanup`        | `0 3 * * *`  | Apaga webhooks > 90 dias e jobs > 7 dias às 3h          |

## Webhook Secret (HMAC) por plataforma

Para ativar a validação de assinatura HMAC, adicione o campo **Webhook Secret (HMAC)** ao configurar a plataforma de e-commerce:

- **Shopify:** `Configurações → Notificações → Webhooks → Segredo`
- **WooCommerce:** `WooCommerce → Configurações → Avançado → Webhooks → Segredo`
- **Nuvemshop:** `Painel → Aplicativos → Webhooks → Token de Segurança`

O valor deve ser **idêntico** ao que você cola no campo da CodeRise.

## Rate limiting de login

O sistema limita **5 tentativas por IP em 15 minutos**. Em produção, o rate limiting é em memória por instância. Para rate limiting distribuído real (multi-instância), instale Upstash Redis:

```bash
npm install @upstash/ratelimit @upstash/redis
```

E adicione as variáveis:
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

## Arquitetura de processamento assíncrono

```
E-commerce → POST /webhook?token=xxx
                 ↓ (responde 200 em <100ms)
          [user_webhooks] ← salva evento
                 ↓
          [processing_queue] ← enfileira job
                 ↓
         Cron a cada 1min
                 ↓ (até 50 jobs em paralelo)
          processWebhookJob()
                 ↓
            Suri API (com retry 3x)
                 ↓
        status = 'processed' | 'error'
```
