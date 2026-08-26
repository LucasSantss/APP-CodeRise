import mysql from "mysql2/promise";

function createPool(connectionString) {
  const p = mysql.createPool({
    uri: connectionString,
    waitForConnections: true,
    connectionLimit: 15,
    queueLimit: 0,
    connectTimeout: 8000,
  });
  p.on("error", (err) => {
    console.error("[db] Erro inesperado no pool:", err.message);
  });
  return p;
}

// Node/Vercel/Hostinger: process.env já vem populado de forma síncrona no
// load do módulo, então o pool pode ser criado de imediato.
let rawPool = null;
if (typeof process !== "undefined" && process.env) {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error("[db] ERRO CRÍTICO: A variável de ambiente DATABASE_URL não está definida.");
    console.error("[db] Configure DATABASE_URL nas variáveis de ambiente do provedor (ex.: mysql://usuario:senha@host:3306/nome_do_banco).");
  } else {
    rawPool = createPool(DATABASE_URL);
  }
}

// Cloudflare Workers/Pages Functions: process.env não existe do jeito que
// espera; o pool precisa ser inicializado explicitamente antes do primeiro uso.
export function initPool(env) {
  if (rawPool) return rawPool;
  rawPool = createPool(env?.DATABASE_URL);
  return rawPool;
}

const DB_NOT_CONFIGURED_MESSAGE =
  "Banco de dados não configurado: a variável de ambiente DATABASE_URL não " +
  "chegou até o processo (connection string do MySQL, ex.: mysql://usuario:" +
  "senha@host:3306/nome_do_banco). Configure-a no painel do seu provedor de " +
  "hospedagem e REINICIE o app — variáveis de ambiente só são lidas quando " +
  "o processo inicia.";

export async function checkDb() {
  if (!rawPool) throw new Error(DB_NOT_CONFIGURED_MESSAGE);
}

// ─── Adaptador de compatibilidade com a sintaxe Postgres usada em todo o ────
// resto do código (api/**), pra não precisar reescrever ~130 queries.
//
// Cobre:
//   1. Placeholders `$1, $2, ...` → `?` do mysql2 (na ordem em que aparecem,
//      inclusive quando o mesmo `$N` é reaproveitado mais de uma vez).
//   2. `RETURNING <colunas>` (sem equivalente no MySQL):
//      - INSERT ... RETURNING → executa o INSERT, usa `result.insertId` pra
//        buscar a linha com um SELECT.
//      - UPDATE ... RETURNING → executa o UPDATE, depois um SELECT com o
//        MESMO WHERE/params — como o SET já foi aplicado, reflete o estado
//        pós-update, igual ao Postgres.
//      - DELETE ... RETURNING → SELECT com o mesmo WHERE ANTES de apagar
//        (a linha já não existiria pra buscar depois).
//   3. Sempre devolve `{ rows, rowCount }`, o formato que o resto do código
//      já espera (`r.rows[0]`, `r.rowCount`) — zero mudança nos call sites.
//
// O que ISSO NÃO cobre (precisou de edição manual nos arquivos que usam):
// `ON CONFLICT` (virou `ON DUPLICATE KEY UPDATE` / `INSERT IGNORE` direto na
// query) e operadores de JSONB (`->>`, `||`, `::jsonb` — viraram funções
// JSON_* do MySQL direto na query).

export function translatePlaceholders(sql, params) {
  const mysqlParams = [];
  const translatedSql = sql.replace(/\$(\d+)/g, (_match, n) => {
    mysqlParams.push(params[Number(n) - 1]);
    return "?";
  });
  return { sql: translatedSql, params: mysqlParams };
}

export function parseReturning(sql) {
  const match = sql.match(/^\s*(INSERT|UPDATE|DELETE)\b[\s\S]*?\bRETURNING\s+([\s\S]+?)\s*$/i);
  if (!match) return null;
  const [, verb, columns] = match;
  const strippedSql = sql.replace(/\s*RETURNING\s+[\s\S]+?\s*$/i, "");

  let table;
  if (/^insert$/i.test(verb)) table = strippedSql.match(/INSERT\s+INTO\s+["`]?(\w+)["`]?/i)?.[1];
  else if (/^update$/i.test(verb)) table = strippedSql.match(/UPDATE\s+["`]?(\w+)["`]?/i)?.[1];
  else table = strippedSql.match(/DELETE\s+FROM\s+["`]?(\w+)["`]?/i)?.[1];

  const whereMatch = strippedSql.match(/\bWHERE\b[\s\S]+$/i);
  return { verb: verb.toUpperCase(), columns: columns.trim(), strippedSql, table, whereClause: whereMatch ? whereMatch[0] : "" };
}

async function runQuery(pool, sql, params = []) {
  const returning = parseReturning(sql);

  if (!returning) {
    const { sql: mysqlSql, params: mysqlParams } = translatePlaceholders(sql, params);
    const [result] = await pool.query(mysqlSql, mysqlParams);
    if (Array.isArray(result)) return { rows: result, rowCount: result.length };
    return { rows: [], rowCount: result.affectedRows ?? 0 };
  }

  const { verb, columns, strippedSql, table, whereClause } = returning;

  if (verb === "DELETE") {
    const { sql: selSql, params: selParams } = translatePlaceholders(`SELECT ${columns} FROM ${table} ${whereClause}`, params);
    const [rows] = await pool.query(selSql, selParams);
    const { sql: delSql, params: delParams } = translatePlaceholders(strippedSql, params);
    await pool.query(delSql, delParams);
    return { rows, rowCount: rows.length };
  }

  const { sql: mysqlSql, params: mysqlParams } = translatePlaceholders(strippedSql, params);
  const [result] = await pool.query(mysqlSql, mysqlParams);

  if (verb === "INSERT") {
    if (!result.insertId) return { rows: [], rowCount: 0 };
    const [rows] = await pool.query(`SELECT ${columns} FROM ${table} WHERE id = ?`, [result.insertId]);
    return { rows, rowCount: rows.length };
  }

  // UPDATE: o SET já foi aplicado — o SELECT com o mesmo WHERE reflete o pós-update.
  const { sql: selSql, params: selParams } = translatePlaceholders(`SELECT ${columns} FROM ${table} ${whereClause}`, params);
  const [rows] = await pool.query(selSql, selParams);
  return { rows, rowCount: rows.length };
}

// Proxy: expõe `pool.query(sql, params)` passando pelo adaptador acima, e
// encaminha qualquer outro método/propriedade direto pro pool real do
// mysql2 — todo o resto do código continua fazendo
// `import pool from "./db.js"; pool.query(...)` sem nenhuma alteração.
const poolProxy = new Proxy({}, {
  get(_target, prop) {
    if (!rawPool) throw new Error(DB_NOT_CONFIGURED_MESSAGE);
    if (prop === "query") return (sql, params) => runQuery(rawPool, sql, params);
    const value = rawPool[prop];
    return typeof value === "function" ? value.bind(rawPool) : value;
  },
});

export default poolProxy;
