/**
 * Migração única dos dados existentes: Neon (PostgreSQL) → MySQL (Hostinger).
 *
 * NÃO usa nenhuma credencial embutida — lê tudo de variáveis de ambiente, pra
 * rodar localmente sem colar senha em lugar nenhum:
 *
 *   NEON_DATABASE_URL="postgres://...(a mesma do .env atual)..." \
 *   MYSQL_DATABASE_URL="mysql://usuario:senha@host:3306/nome_do_banco" \
 *   node scripts/migrate-neon-to-mysql.mjs
 *
 * Pré-requisitos:
 *   1. O schema MySQL já precisa existir no banco de destino — acesse
 *      GET /setup?secret=<ADMIN_SECRET> no app já rodando na Hostinger com
 *      DATABASE_URL apontando pro MySQL, ANTES de rodar este script.
 *   2. `npm install pg --no-save` (o driver do Postgres foi removido do
 *      projeto na migração pro MySQL, mas esse script precisa dele só pra
 *      ESTA leitura pontual do Neon — não fica como dependência do app).
 *   3. Acesso remoto ao MySQL da Hostinger liberado pro seu IP (painel
 *      hPanel → Bancos de dados → MySQL remoto).
 *
 * O script aborta (sem escrever nada) se qualquer tabela de destino já tiver
 * linhas — evita duplicar dados por engano rodando duas vezes. Preserva os
 * IDs originais (essencial pra manter as referências entre tabelas) e ajusta
 * o AUTO_INCREMENT de cada tabela ao final.
 */
import pg from "pg";
import mysql from "mysql2/promise";

const NEON_URL = process.env.NEON_DATABASE_URL;
const MYSQL_URL = process.env.MYSQL_DATABASE_URL;

if (!NEON_URL || !MYSQL_URL) {
  console.error("Defina NEON_DATABASE_URL e MYSQL_DATABASE_URL antes de rodar este script.");
  process.exit(1);
}

// Ordem respeita as foreign keys (users primeiro, notification_reads por
// último). `hasId`: false só para notification_reads (chave composta).
const TABLES = [
  { name: "users", hasId: true },
  { name: "user_integrations", hasId: true },
  { name: "sync_rules", hasId: true },
  { name: "user_webhooks", hasId: true },
  { name: "notifications", hasId: true },
  { name: "notification_reads", hasId: false },
  { name: "admin_webhook_settings", hasId: false },
  { name: "platform_settings", hasId: false },
];

function transformValue(v) {
  if (v !== null && typeof v === "object" && !(v instanceof Date)) return JSON.stringify(v);
  return v;
}

async function main() {
  const pgClient = new pg.Client({ connectionString: NEON_URL, ssl: { rejectUnauthorized: false } });
  const mysqlConn = await mysql.createConnection(MYSQL_URL);

  await pgClient.connect();
  console.log("[migrate] Conectado ao Neon (origem) e ao MySQL (destino).");

  // Checagem de segurança: aborta se algum destino já tiver dado.
  for (const { name } of TABLES) {
    try {
      const [rows] = await mysqlConn.query(`SELECT COUNT(*) AS n FROM ${name}`);
      if (rows[0].n > 0) {
        console.error(`[migrate] ABORTADO: a tabela "${name}" no MySQL já tem ${rows[0].n} linha(s). Rode /setup só num banco vazio, ou apague os dados de teste antes de migrar.`);
        process.exit(1);
      }
    } catch (err) {
      console.error(`[migrate] Não consegui checar a tabela "${name}" no MySQL — rode /setup nela primeiro. Detalhe: ${err.message}`);
      process.exit(1);
    }
  }

  await mysqlConn.beginTransaction();
  try {
    await mysqlConn.query("SET FOREIGN_KEY_CHECKS = 0");

    for (const { name, hasId } of TABLES) {
      const { rows } = await pgClient.query(`SELECT * FROM ${name}`);
      console.log(`[migrate] ${name}: ${rows.length} linha(s) no Neon.`);
      if (rows.length === 0) continue;

      let maxId = 0;
      for (const row of rows) {
        const columns = Object.keys(row);
        const values = columns.map((c) => transformValue(row[c]));
        const placeholders = columns.map(() => "?").join(",");
        await mysqlConn.query(`INSERT INTO ${name} (${columns.join(",")}) VALUES (${placeholders})`, values);
        if (hasId && row.id > maxId) maxId = row.id;
      }

      if (hasId) {
        await mysqlConn.query(`ALTER TABLE ${name} AUTO_INCREMENT = ${maxId + 1}`);
        console.log(`[migrate] ${name}: AUTO_INCREMENT ajustado para ${maxId + 1}.`);
      }
    }

    await mysqlConn.query("SET FOREIGN_KEY_CHECKS = 1");
    await mysqlConn.commit();
    console.log("[migrate] Concluído com sucesso — commit aplicado no MySQL.");
  } catch (err) {
    await mysqlConn.rollback();
    console.error("[migrate] Erro durante a migração — rollback aplicado, MySQL continua vazio:", err.message);
    process.exitCode = 1;
  } finally {
    await pgClient.end();
    await mysqlConn.end();
  }
}

main();
