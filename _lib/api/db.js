/**
 * api/db.js — Conexão com Neon PostgreSQL
 *
 * Usa @neondatabase/serverless quando disponível (HTTP pooling, zero conexões
 * persistentes — ideal para Vercel serverless). Cai para pg Pool como fallback.
 *
 * Para ativar o driver Neon:
 *   cd api && npm install @neondatabase/serverless
 *   No Vercel, use a URL pooled (com -pooler no hostname do Neon).
 */

let pool;

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

const DATABASE_URL = sanitizeConnectionString(process.env.DATABASE_URL);

if (!DATABASE_URL) {
  console.error("[db] ERRO CRÍTICO: DATABASE_URL não definida.");
}

// ── Tenta usar @neondatabase/serverless (HTTP pooling) ─────────────────────
let useNeonDriver = false;
try {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(DATABASE_URL);

  // Wrapper para compatibilidade com a interface do pg.Pool
  pool = {
    query: async (text, params) => {
      // neon() retorna rows diretamente
      const rows = await sql(text, params || []);
      return { rows, rowCount: rows.length };
    },
    // pg_notify não funciona via HTTP — silenciar sem erro
    end: async () => {},
  };
  useNeonDriver = true;
  console.log("[db] Usando @neondatabase/serverless (HTTP pooling)");
} catch {
  // Fallback: pg Pool clássico
  const { default: pkg } = await import("pg");
  const { Pool } = pkg;

  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,                      // Reduzido de 15 → evita saturar o Neon
    min: 0,                      // Zero mínimo em serverless
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 8000,
    allowExitOnIdle: true,
  });

  pool.on("error", (err) => {
    console.error("[db] Erro inesperado no pool:", err.message);
  });

  console.log("[db] Usando pg Pool (fallback)");
}

export async function checkDb() {
  if (!DATABASE_URL) {
    throw new Error(
      "Banco de dados não configurado. " +
      "Acesse Vercel → Settings → Environment Variables e adicione DATABASE_URL " +
      "(URL pooled do Neon, com -pooler no hostname)."
    );
  }
}

export { useNeonDriver };
export default pool;
