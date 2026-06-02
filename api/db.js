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

const DATABASE_URL = process.env.DATABASE_URL;
const DB_POOL_MAX = Math.max(1, Number(process.env.DB_POOL_MAX || 5));

if (!DATABASE_URL) {
  console.error("[db] ERRO CRÍTICO: A variável de ambiente DATABASE_URL não está definida.");
  console.error("[db] Configure DATABASE_URL nas variáveis de ambiente do Vercel (dashboard → Settings → Environment Variables).");
}

const pool = new Pool({
  connectionString: sanitizeConnectionString(DATABASE_URL),
  ssl: { rejectUnauthorized: false },
  max: DB_POOL_MAX,
  min: 0,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 8000,
  allowExitOnIdle: true,
});

pool.on("error", (err) => {
  console.error("[db] Erro inesperado no pool:", err.message);
});

export async function checkDb() {
  if (!DATABASE_URL) {
    throw new Error(
      "Banco de dados não configurado. " +
      "Acesse o painel do Vercel → Settings → Environment Variables e adicione DATABASE_URL com a URL de conexão do Neon (use a URL pooled, com -pooler no hostname)."
    );
  }
}

export default pool;
