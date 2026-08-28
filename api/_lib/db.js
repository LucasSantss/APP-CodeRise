import mysql from "mysql2/promise";

function parseConnectionString(connectionString) {
  if (!connectionString) return null;
  const url = new URL(connectionString);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    ssl: url.searchParams.get("ssl-mode") === "REQUIRED" ? {} : undefined,
  };
}

function toMysqlQuery(text, values = []) {
  const parameters = [];
  const sql = text
    .replace(/::jsonb/g, "")
    .replace(/\bJSONB\b/gi, "JSON")
    .replace(/\$(\d+)/g, (_match, index) => {
      parameters.push(values[Number(index) - 1]);
      return "?";
    });
  return { sql, parameters };
}

function createPool(connectionString) {
  const config = parseConnectionString(connectionString);
  const p = mysql.createPool({
    ...config,
    waitForConnections: true,
    connectionLimit: 10,
    idleTimeout: 30000,
    connectTimeout: 8000,
    enableKeepAlive: true,
    // Sem isso, um UPDATE que casa a linha mas não muda nenhum valor reporta
    // affectedRows=0 — quebraria os handlers que tratam "0 linhas afetadas"
    // como "não encontrado" (equivalente ao RETURNING vazio do Postgres).
    flags: ["+FOUND_ROWS"],
  });
  p.on("error", (err) => {
    console.error("[db] Erro inesperado no pool:", err.message);
  });
  function toResult(result) {
    const rows = Array.isArray(result) ? result : [];
    return {
      rows,
      rowCount: Array.isArray(result) ? result.length : result.affectedRows,
      insertId: Array.isArray(result) ? undefined : result.insertId,
    };
  }
  return {
    async query(text, values = []) {
      const { sql, parameters } = toMysqlQuery(text, values);
      const [result] = await p.query(sql, parameters);
      return toResult(result);
    },
    async connect() {
      const connection = await p.getConnection();
      return {
        query: async (text, values = []) => {
          const { sql, parameters } = toMysqlQuery(text, values);
          const [result] = await connection.query(sql, parameters);
          return toResult(result);
        },
        release: () => connection.release(),
      };
    },
  };
}

// Node/Vercel: process.env já vem populado de forma síncrona no load do módulo,
// então o pool pode ser criado de imediato — comportamento idêntico ao de sempre.
let pool = null;
if (typeof process !== "undefined" && process.env) {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error("[db] ERRO CRÍTICO: A variável de ambiente DATABASE_URL não está definida.");
    console.error("[db] Configure DATABASE_URL nas variáveis de ambiente do Vercel (dashboard → Settings → Environment Variables).");
  } else {
    pool = createPool(DATABASE_URL);
  }
}

export function initPool(env) {
  if (pool) return pool;
  const connectionString = env?.DATABASE_URL;
  pool = createPool(connectionString);
  return pool;
}

const DB_NOT_CONFIGURED_MESSAGE =
  "Banco de dados não configurado: configure DATABASE_URL com a URL MySQL " +
  "da Hostinger no ambiente do app Node.js e REINICIE o app — variáveis de " +
  "ambiente só são lidas quando o processo inicia.";

export async function checkDb() {
  if (!pool) throw new Error(DB_NOT_CONFIGURED_MESSAGE);
}

const poolProxy = new Proxy({}, {
  get(_target, prop) {
    if (!pool) throw new Error(DB_NOT_CONFIGURED_MESSAGE);
    const value = pool[prop];
    return typeof value === "function" ? value.bind(pool) : value;
  },
});

export default poolProxy;
