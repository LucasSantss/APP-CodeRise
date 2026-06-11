import pool from "./db.js";
import { requireAuth } from "../_auth.js";

export async function handlePlatformSettings(req, res) {
  const caller = await requireAuth(req, res);
  if (!caller) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      key VARCHAR(100) PRIMARY KEY,
      value JSONB NOT NULL DEFAULT 'true',
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});

  if (req.method === "GET") {
    try {
      const r = await pool.query("SELECT key, value FROM platform_settings");
      const platforms = {};
      for (const row of r.rows) platforms[row.key] = row.value;
      return res.status(200).json({ success: true, platforms });
    } catch {
      return res.status(200).json({ success: true, platforms: {} });
    }
  }

  if (req.method === "PATCH") {
    if (!caller.is_admin)
      return res.status(403).json({ success: false, message: "Apenas administradores podem alterar configurações de plataforma." });
    const { platforms } = req.body || {};
    if (!platforms || typeof platforms !== "object")
      return res.status(400).json({ success: false, message: "Campo 'platforms' obrigatório." });
    for (const [key, value] of Object.entries(platforms)) {
      await pool.query(
        "INSERT INTO platform_settings (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()",
        [key, JSON.stringify(value)]
      );
    }
    const r = await pool.query("SELECT key, value FROM platform_settings");
    const updated = {};
    for (const row of r.rows) updated[row.key] = row.value;
    return res.status(200).json({ success: true, platforms: updated });
  }

  res.setHeader("Allow", ["GET", "PATCH"]);
  return res.status(405).end();
}
