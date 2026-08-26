import pool from "./db.js";
import { requireAuth } from "../_auth.js";

export async function handlePlatformSettings(req, res) {
  const caller = await requireAuth(req, res);
  if (!caller) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      \`key\` VARCHAR(100) PRIMARY KEY,
      value JSON NOT NULL DEFAULT ('true'),
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).catch(() => {});

  // Normaliza linhas do banco: ignora chaves legadas "platform:*", converte para boolean real
  function normalizeRows(rows) {
    const out = {};
    for (const row of rows) {
      if (row.key.startsWith("platform:")) continue; // chaves legadas, ignorar
      out[row.key] = row.value === true || row.value === "true";
    }
    return out;
  }

  if (req.method === "GET") {
    try {
      const r = await pool.query("SELECT `key`, value FROM platform_settings");
      return res.status(200).json({ success: true, platforms: normalizeRows(r.rows) });
    } catch {
      return res.status(200).json({ success: true, platforms: {} });
    }
  }

  if (req.method === "PATCH") {
    if (caller.role !== "admin")
      return res.status(403).json({ success: false, message: "Apenas administradores podem alterar configurações de plataforma." });
    const { platforms } = req.body || {};
    if (!platforms || typeof platforms !== "object")
      return res.status(400).json({ success: false, message: "Campo 'platforms' obrigatório." });
    for (const [key, value] of Object.entries(platforms)) {
      const boolVal = value === true || value === "true";
      await pool.query(
        "INSERT INTO platform_settings (`key`, value, updated_at) VALUES ($1, $2, NOW()) ON DUPLICATE KEY UPDATE value = $2, updated_at = NOW()",
        [key, JSON.stringify(boolVal)]
      );
    }
    const r = await pool.query("SELECT `key`, value FROM platform_settings");
    return res.status(200).json({ success: true, platforms: normalizeRows(r.rows) });
  }

  res.setHeader("Allow", ["GET", "PATCH"]);
  return res.status(405).end();
}
