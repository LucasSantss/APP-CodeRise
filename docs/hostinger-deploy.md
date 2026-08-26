# Deploy na Hostinger (via GitHub — painel "Implantações")

Pelos prints que você mandou, o produto que você está usando não é o hPanel
clássico de upload manual + "Configurar App Node.js" — é o deploy **integrado
ao GitHub** (tela "Implantações", com "Reimplantar", detecção automática de
framework, etc.). Esse guia foi reescrito pra esse fluxo.

## O que causou a falha do print

1. **Nome do arquivo de entrada**: o diagnóstico do próprio Hostinger apontou
   que ele espera um `server.js` na raiz. Eu tinha criado como `app.js` — já
   renomeei para [server.js](../server.js).
2. **O deploy rodou sem nenhuma das nossas mudanças**: o card mostrava
   `Filial: LucasSantss`, commit `0498a43a` — a branch e o commit originais,
   de antes de qualquer alteração. Nada disso foi enviado ao GitHub ainda
   (as mudanças estão só localmente). **Esse é o motivo real da falha**: não
   existia `server.js`/`express` nenhum no repositório que o Hostinger leu.

## O que precisa acontecer pra funcionar

1. As mudanças (server.js, api/**, package.json) precisam ser commitadas e
   enviadas (`git push`) para o GitHub, na branch que o Hostinger está
   configurado pra observar (hoje: `LucasSantss`, conforme o print).
2. Clicar em **"Reimplantar"** depois do push.

### Sobre a pasta `dist/` (build do front-end)

Não deu pra confirmar se o pipeline de deploy da Hostinger roda `npm run
build` automaticamente (o painel mostra "Configurações de compilação e
saída: Padrão", mas não é visível de fora se isso inclui um passo de build
do Vite, nem se o `npm install` deles inclui `devDependencies` — o Vite é
uma delas). Pra não depender disso, a pasta `dist/` já vem **commitada
direto no repositório** (normalmente ela fica no `.gitignore`, mas nesse
caso específico foi adicionada de propósito com `git add -f dist`).

**Toda vez que atualizar o front-end**, antes de dar `git push`:
```bash
npm run build
git add -f dist
git commit -m "atualiza build do front-end"
git push origin LucasSantss
```
Sem isso, o `server.js` não encontra `dist/index.html` pra servir e a
página fica em branco/"Not Found".

## Variáveis de ambiente

Na aba "Variáveis de ambiente" do mesmo painel (visível na barra lateral do
print), configure as três que o `api/` usa hoje:
- `DATABASE_URL` — connection string do **MySQL** da Hostinger (banco criado
  em "Bancos de dados" → "Gerenciamento"), no formato
  `mysql://usuario:senha@host:3306/nome_do_banco`. Host, usuário e nome do
  banco aparecem naquela tela ("u500692157_APPCodeRise" etc.); a senha é a
  que você definiu ao criar o banco.
- `ADMIN_SECRET`
- `CRON_SECRET` (opcional — só se quiser manter também um gatilho HTTP
  externo pra `/cron-sync-stores`, além da sincronização interna do processo)

`PORT` é definida automaticamente pela Hostinger — não precisa configurar.

## Banco de dados: migração de Postgres (Neon) para MySQL

O app foi migrado de PostgreSQL pra MySQL na branch `mysql-migration` (ver
commit `2ea771a`). Passo a passo pra ativar:

1. **Deploy do código da branch `mysql-migration`** (ainda não foi pra
   `LucasSantss`/produção — só depois de validar).
2. Configurar `DATABASE_URL` (acima) apontando pro MySQL novo e reiniciar o app.
3. Criar o schema: acessar `GET /setup?secret=<ADMIN_SECRET>` uma vez —
   cria as tabelas vazias no MySQL.
4. **Migrar os dados que já existem no Neon**: rodar localmente (nunca com
   senha colada em chat)
   ```bash
   npm install pg --no-save
   NEON_DATABASE_URL="<a mesma DATABASE_URL do Neon que já está no .env>" \
   MYSQL_DATABASE_URL="mysql://usuario:senha@host:3306/nome_do_banco" \
   node scripts/migrate-neon-to-mysql.mjs
   ```
   Precisa liberar acesso remoto ao MySQL pro seu IP em "Bancos de dados" →
   "MySQL remoto". O script aborta sem escrever nada se as tabelas do MySQL
   já tiverem dado (evita duplicar rodando duas vezes), e preserva os IDs
   originais pra não quebrar as referências entre tabelas.
5. Testar tudo (checklist abaixo) com os dados reais já migrados, antes de
   apontar produção (`LucasSantss`) pra essa branch.

## O que o server.js faz

Roda a API e o front-end no mesmo processo Node.js persistente (diferente do
modelo por-requisição do Vercel/Cloudflare), reaproveitando os handlers de
`api/**` sem alteração de lógica, e dispara a sincronização automática de
catálogo a cada 5 minutos direto no processo — sem depender de cron externo.

## Depois do deploy funcionar

1. Acessar o domínio e conferir se a tela de login carrega.
2. Testar login (rota `/auth`, confirma que o banco conectou).
3. Cadastrar uma integração de teste e ver o painel de Webhooks atualizando.
4. Checar nos logs de execução se a sincronização automática
   (`[cron interno]`) roda sem erro, pra quem tiver agendamento ativo.
