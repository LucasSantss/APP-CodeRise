import pkg from "pg";
const { Pool } = pkg;

function sanitizeConnectionString(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    u.searchParams.delete("channel_binding");
    return u.toString();
  } catch { return url; }
}

const DATABASE_URL = sanitizeConnectionString(process.env.DATABASE_URL);

if (!DATABASE_URL) {
  console.error("[db] ERRO CRÍTICO: DATABASE_URL não definida.");
}

let pool;

// Tenta usar @neondatabase/serverless (HTTP pooling — zero conexões persistentes)
try {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(DATABASE_URL);
  pool = {
    query: async (text, params) => {
      const rows = await sql(text, params || []);
      return { rows, rowCount: rows.length };
    },
    end: async () => {},
  };
  console.log("[db] Usando @neondatabase/serverless (HTTP pooling)");
} catch {
  // Fallback: pg Pool clássico com pool mínimo para serverless
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
    min: 0,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 8000,
    allowExitOnIdle: true,
  });
  pool.on("error", (err) => console.error("[db] Erro no pool:", err.message));
  console.log("[db] Usando pg Pool (fallback)");
}

export async function checkDb() {
  if (!DATABASE_URL) throw new Error(
    "DATABASE_URL não configurada. Acesse Vercel → Settings → Environment Variables."
  );
}

export default pool;
