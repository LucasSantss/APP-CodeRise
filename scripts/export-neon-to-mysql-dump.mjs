/**
 * Gera um arquivo .sql (sintaxe MySQL) com os dados atuais do Neon, pra subir
 * na aba "Importar" do phpMyAdmin — não precisa de acesso remoto ao MySQL da
 * Hostinger, só de conexão com o Neon (a mesma que já está no seu .env).
 *
 *   npm install pg --no-save
 *   NEON_DATABASE_URL="<a mesma DATABASE_URL do Neon que já está no .env>" \
 *   node scripts/export-neon-to-mysql-dump.mjs
 *
 * Gera `neon-export.sql` na raiz do projeto. Antes de importar:
 *   1. Rode GET /setup?secret=<ADMIN_SECRET> no app já apontando pro MySQL
 *      novo, pra criar as tabelas vazias.
 *   2. Confirme que as tabelas estão vazias (senão os IDs vão colidir).
 *   3. No phpMyAdmin: aba "Importar" → escolher o arquivo `neon-export.sql`
 *      → Executar.
 */
import pg from "pg";
import mysql from "mysql2/promise";
import { writeFile } from "node:fs/promises";

const NEON_URL = process.env.NEON_DATABASE_URL;
if (!NEON_URL) {
  console.error("Defina NEON_DATABASE_URL antes de rodar este script.");
  process.exit(1);
}

// Mesma ordem de api/_lib/setup.js — respeita as foreign keys.
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

const BATCH_SIZE = 100;

function sqlValue(v) {
  if (v !== null && typeof v === "object" && !(v instanceof Date)) return mysql.escape(JSON.stringify(v));
  return mysql.escape(v);
}

async function main() {
  const pgClient = new pg.Client({ connectionString: NEON_URL, ssl: { rejectUnauthorized: false } });
  await pgClient.connect();
  console.log("[export] Conectado ao Neon.");

  const lines = [
    "-- Gerado automaticamente por scripts/export-neon-to-mysql-dump.mjs",
    "-- Importar via phpMyAdmin -> Importar, num banco MySQL JÁ com as tabelas criadas (GET /setup) e VAZIAS.",
    "SET FOREIGN_KEY_CHECKS = 0;",
    "",
  ];

  for (const { name, hasId } of TABLES) {
    const { rows } = await pgClient.query(`SELECT * FROM ${name}`);
    console.log(`[export] ${name}: ${rows.length} linha(s).`);
    if (rows.length === 0) continue;

    const columns = Object.keys(rows[0]);
    lines.push(`-- ${name} (${rows.length} linha${rows.length === 1 ? "" : "s"})`);

    let maxId = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const tuples = batch.map((row) => `(${columns.map((c) => sqlValue(row[c])).join(",")})`);
      lines.push(`INSERT INTO ${name} (${columns.join(",")}) VALUES\n  ${tuples.join(",\n  ")};`);
      if (hasId) for (const row of batch) if (row.id > maxId) maxId = row.id;
    }

    if (hasId) lines.push(`ALTER TABLE ${name} AUTO_INCREMENT = ${maxId + 1};`);
    lines.push("");
  }

  lines.push("SET FOREIGN_KEY_CHECKS = 1;");

  const outPath = new URL("../neon-export.sql", import.meta.url);
  await writeFile(outPath, lines.join("\n"), "utf8");
  console.log(`[export] Arquivo gerado: ${outPath.pathname.replace(/^\//, "")}`);

  await pgClient.end();
}

main().catch((err) => {
  console.error("[export] Erro:", err.message);
  process.exitCode = 1;
});
