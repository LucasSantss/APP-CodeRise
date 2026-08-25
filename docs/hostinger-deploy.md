# Deploy na Hostinger (hospedagem compartilhada/Business com Node.js — hPanel)

Este guia cobre os passos que só podem ser feitos por você, direto no hPanel
(criar o app Node.js, variáveis de ambiente, etc.) — eu não tenho acesso à
sua conta Hostinger. O código já está pronto: [app.js](../app.js), na raiz do
projeto, é o novo ponto de entrada.

## O que mudou em relação ao Vercel

Nada na lógica de negócio (rotas, integrações, banco). A única diferença real:
no Vercel/Cloudflare cada rota roda como uma função isolada por requisição;
na Hostinger (Passenger) o app roda como **um processo Node.js único e
persistente**. Por isso criei `app.js`, um servidor Express que:
- registra as mesmas rotas de sempre (`/auth`, `/users`, `/webhooks`, etc.),
  chamando os mesmos arquivos de `api/**` sem nenhuma alteração de lógica;
- serve o front-end (`dist/`) e faz o fallback de SPA;
- roda a sincronização automática de catálogo (`runDueCatalogSyncs`) direto
  no processo, a cada 5 minutos — não precisa mais de cron externo
  (cron-job.org) nem de configurar Cron Job na Hostinger, embora isso também
  funcione se preferir (o endpoint `/cron-sync-stores` continua ativo).

## 1. Build local

```bash
npm install
npm run build     # gera a pasta dist/
```

Faça o build **localmente antes de subir os arquivos** — builds de front-end
(Vite) podem ser pesados para o ambiente de hospedagem compartilhada, então
é mais confiável subir a pasta `dist/` já pronta.

## 2. Subir os arquivos

Envie para a pasta do domínio (via Gerenciador de Arquivos do hPanel ou FTP/SFTP)
todo o projeto **exceto**: `node_modules/`, `.git/`, `.env`. Inclua a pasta
`dist/` gerada no passo 1.

## 3. Criar o app Node.js no hPanel

hPanel → **Avançado → Node.js** (ou "Configurar App Node.js"):
- **Versão do Node.js**: 18 ou superior (o código usa `fetch`/`AbortSignal.timeout`
  nativos, que exigem Node 18+).
- **Diretório da aplicação**: a pasta onde você subiu os arquivos.
- **Arquivo de inicialização (startup file)**: `app.js`
- Depois de criar, use o botão **"Executar NPM Install"** do próprio painel
  para instalar as dependências (`express`, `pg`, `bcryptjs`, etc.).

## 4. Variáveis de ambiente

Na mesma tela do app Node.js, seção de variáveis de ambiente, adicione as
três que o `api/` já usa hoje (confirmei via grep — não há mais nenhuma):

- `DATABASE_URL` — a mesma connection string pooled do Neon que já usam.
- `ADMIN_SECRET`
- `CRON_SECRET` (só é necessário se ainda quiser manter um gatilho HTTP
  externo para `/cron-sync-stores` além do agendamento interno)

`PORT` é definida automaticamente pelo Passenger — não precisa configurar.

## 5. Iniciar/reiniciar o app

Pelo hPanel, clique em **"Reiniciar"** o app Node.js depois de configurar as
variáveis de ambiente. Os logs de inicialização (incluindo o aviso de
`DATABASE_URL` ausente, se esquecer de configurar) aparecem na própria tela
do app.

## 6. Testar

Acesse o domínio configurado e confira, nessa ordem:
1. A tela de login carrega (front-end servido corretamente).
2. Login funciona (rota `/auth` respondendo, banco conectado).
3. Cadastrar uma integração de teste e ver o painel de Webhooks atualizando.
4. Deixar o app rodando por alguns minutos e checar nos logs se a
   sincronização automática (`[cron interno]`) roda sem erro, para quem tiver
   agendamento ativo.

## Observação sobre o long-poll de Webhooks/Notificações

Esses dois endpoints usam um polling curto (a cada ~1,5s, dentro do próprio
request) em vez do `LISTEN`/`NOTIFY` nativo do Postgres — mudança feita
originalmente pensando na Cloudflare, mas que continua funcionando igual
aqui. Como a Hostinger roda um processo persistente, dá pra voltar pro
`LISTEN`/`NOTIFY` (resposta mais instantânea) se quiser — é opcional, não
afeta nenhuma funcionalidade hoje.
