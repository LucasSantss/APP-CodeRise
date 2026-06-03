import pool from "./db.js";
import crypto from "crypto";
import { isAdminSecret } from "./_auth.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runMigrationFile(filename) {
  const filePath = path.join(__dirname, "migrations", filename);
  if (!fs.existsSync(filePath)) return { file: filename, skipped: true };
  const sql = fs.readFileSync(filePath, "utf8");
  // Executa cada statement separado por ;
  const statements = sql.split(";").map(s => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    await pool.query(stmt).catch(err => {
      if (!err.message.includes("already exists") && !err.message.includes("duplicate")) {
        console.warn(`[setup] Aviso em ${filename}:`, err.message.slice(0, 120));
      }
    });
  }
  return { file: filename, ok: true };
}

export async function handleSetup(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  if (!isAdminSecret(req)) return res.status(401).json({ success:false, message:"Não autorizado" });
  try {
    // ── Tabelas base ─────────────────────────────────────────────────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, email VARCHAR(255) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL, role VARCHAR(20) NOT NULL DEFAULT 'user', active BOOLEAN NOT NULL DEFAULT true, token VARCHAR(64) UNIQUE, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW());`);
    await pool.query(`CREATE TABLE IF NOT EXISTS user_integrations (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, ecommerce_platform VARCHAR(50), ecommerce_config JSONB, ecommerce_active BOOLEAN NOT NULL DEFAULT false, webhook_token VARCHAR(64) UNIQUE NOT NULL, chatbot_platform VARCHAR(50), chatbot_config JSONB, chatbot_active BOOLEAN NOT NULL DEFAULT false, chatbot_token VARCHAR(64) UNIQUE, suri_endpoint TEXT, suri_token TEXT, suri_active BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW(), UNIQUE(user_id));`);
    for (const sql of [
      `ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS chatbot_platform VARCHAR(50)`,
      `ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS chatbot_config JSONB`,
      `ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS chatbot_active BOOLEAN NOT NULL DEFAULT false`,
      `ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS chatbot_token VARCHAR(64) UNIQUE`,
    ]) { await pool.query(sql).catch(()=>{}); }
    const noToken = await pool.query("SELECT user_id FROM user_integrations WHERE chatbot_token IS NULL");
    for (const row of noToken.rows) { await pool.query("UPDATE user_integrations SET chatbot_token=$1 WHERE user_id=$2 AND chatbot_token IS NULL",[crypto.randomBytes(32).toString("hex"),row.user_id]); }
    await pool.query(`CREATE TABLE IF NOT EXISTS sync_rules (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, event VARCHAR(100) NOT NULL, active BOOLEAN NOT NULL DEFAULT true, message_template TEXT, delay_minutes INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW());`);
    await pool.query(`CREATE TABLE IF NOT EXISTS user_webhooks (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, event_type VARCHAR(100), payload JSONB, status VARCHAR(20) DEFAULT 'received', error_message TEXT, source VARCHAR(20) DEFAULT 'ecommerce', received_at TIMESTAMP NOT NULL DEFAULT NOW());`);
    await pool.query(`ALTER TABLE user_webhooks ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'ecommerce'`).catch(()=>{});
    await pool.query(`CREATE TABLE IF NOT EXISTS notifications (id SERIAL PRIMARY KEY, type VARCHAR(30) NOT NULL, title VARCHAR(100) NOT NULL, message TEXT NOT NULL, image_url TEXT, target_role VARCHAR(20) DEFAULT 'all', target_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, scheduled_at TIMESTAMP, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW());`);
    await pool.query(`CREATE TABLE IF NOT EXISTS notification_reads (notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, hidden BOOLEAN NOT NULL DEFAULT false, read_at TIMESTAMP NOT NULL DEFAULT NOW(), PRIMARY KEY (notification_id, user_id));`);

    // ── Migrações por arquivo ─────────────────────────────────────────────────
    const migrations = await Promise.all([
      runMigrationFile("001_performance_indexes.sql"),
      runMigrationFile("002_multitenant_queue.sql"),
    ]);

    // ── Seeds ─────────────────────────────────────────────────────────────────
    const adminToken=crypto.randomBytes(32).toString("hex");
    await pool.query(`INSERT INTO users (name,email,password,role,token) VALUES ('Administrador','admin@plataforma.com','admin123','admin',$1) ON CONFLICT (email) DO NOTHING`,[adminToken]);
    const userToken=crypto.randomBytes(32).toString("hex");
    await pool.query(`INSERT INTO users (name,email,password,role,token) VALUES ('Usuário Teste','teste@plataforma.com','teste123','user',$1) ON CONFLICT (email) DO NOTHING`,[userToken]);
    const testUser=await pool.query("SELECT id FROM users WHERE email='teste@plataforma.com'");
    if (testUser.rows[0]) {
      const wt=crypto.randomBytes(32).toString("hex"),ct=crypto.randomBytes(32).toString("hex");
      await pool.query(`INSERT INTO user_integrations (user_id,webhook_token,chatbot_token) VALUES ($1,$2,$3) ON CONFLICT (user_id) DO NOTHING`,[testUser.rows[0].id,wt,ct]);
      // Cria slug padrão para o usuário de teste
      await pool.query(`INSERT INTO tenant_slugs (user_id, slug) VALUES ($1, 'teste') ON CONFLICT (slug) DO NOTHING`,[testUser.rows[0].id]).catch(()=>{});
    }
    const admin=await pool.query("SELECT id,email,token FROM users WHERE email='admin@plataforma.com'");
    const user=await pool.query("SELECT id,email,token FROM users WHERE email='teste@plataforma.com'");
    const slugs=await pool.query("SELECT * FROM tenant_slugs LIMIT 5");
    return res.status(200).json({
      success:true,
      message:"Tabelas criadas/migradas com sucesso!",
      tables:["users","user_integrations","sync_rules","user_webhooks","notifications","notification_reads","tenant_slugs","processing_queue"],
      migrations,
      seeds:{admin:admin.rows[0], user:user.rows[0]},
      slugs: slugs.rows,
    });
  } catch (err) { return res.status(500).json({success:false,message:err.message}); }
}
