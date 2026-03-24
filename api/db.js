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

const pool = new Pool({
  connectionString: sanitizeConnectionString(process.env.DATABASE_URL),
  ssl: { rejectUnauthorized: false },
  max: 15,                    // aumentado de 5 → 15 para suportar picos
  min: 2,                     // mantém conexões mínimas aquecidas
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 8000,
  allowExitOnIdle: true,      // libera conexões quando ocioso
});

pool.on("error", (err) => {
  console.error("[db] Erro inesperado no pool:", err.message);
});

export default pool;
