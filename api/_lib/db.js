import pkg from "pg";
const { Pool } = pkg;

function sanitizeConnectionString(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    u.searchParams.delete("channel_binding");
    return u.toString();
  } catch {
    return url;
  }
}

function createPool(connectionString) {
  const p = new Pool({
    connectionString: sanitizeConnectionString(connectionString),
    ssl: { rejectUnauthorized: false },
    max: 15,
    min: connectionString ? 2 : 0,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 8000,
    allowExitOnIdle: true,
  });
  p.on("error", (err) => {
    console.error("[db] Erro inesperado no pool:", err.message);
  });
  return p;
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

// Cloudflare Workers/Pages Functions: process.env.DATABASE_URL não existe (não há
// build-time env), então o pool precisa ser inicializado explicitamente com o
// binding do Hyperdrive antes do primeiro uso — ver functions/[[path]].js.
export function initPool(env) {
  if (pool) return pool;
  const connectionString = env?.HYPERDRIVE?.connectionString || env?.DATABASE_URL;
  pool = createPool(connectionString);
  return pool;
}

export async function checkDb() {
  if (!pool) {
    throw new Error(
      "Banco de dados não configurado. " +
      "No Vercel: Settings → Environment Variables → DATABASE_URL (URL pooled do Neon, com -pooler no hostname). " +
      "Na Cloudflare: configure o binding do Hyperdrive e confirme que initPool(env) é chamado antes do handler."
    );
  }
}

// Proxy: encaminha pool.query()/pool.connect()/etc. para a instância real,
// criada de forma eager (Vercel) ou lazy via initPool() (Cloudflare) — todo o
// resto do código continua fazendo `import pool from "./db.js"; pool.query(...)`
// sem nenhuma alteração, em qualquer um dos dois ambientes.
const poolProxy = new Proxy({}, {
  get(_target, prop) {
    if (!pool) {
      throw new Error("[db] Pool não inicializado. Na Cloudflare, chame initPool(env) antes de usar o banco.");
    }
    const value = pool[prop];
    return typeof value === "function" ? value.bind(pool) : value;
  },
});

export default poolProxy;
