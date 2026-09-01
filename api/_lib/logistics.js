import pool from "./db.js";
import crypto from "crypto";
import { requireAuth } from "../_auth.js";

// Migração eager (mesmo padrão do "ALTER TABLE user_webhooks ADD COLUMN IF
// NOT EXISTS source" em index.js/router.js) — roda uma vez ao carregar o
// módulo, antes de qualquer requisição, para que o endpoint público de
// cotação (logistics-quote.js) nunca dispute a criação das colunas com este
// arquivo. Mantém a migração autocontida, sem precisar tocar em setup.js.
for (const sql of [
  `ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS logistics_platform VARCHAR(50)`,
  `ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS logistics_config JSON`,
  `ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS logistics_active BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS logistics_token VARCHAR(64) UNIQUE`,
]) {
  pool.query(sql).catch(() => {});
}

async function ensureLogisticsRow(userId) {
  const ex = await pool.query("SELECT logistics_token FROM user_integrations WHERE user_id = $1", [userId]);
  if (!ex.rows[0]) {
    const wt = crypto.randomBytes(32).toString("hex");
    const lt = crypto.randomBytes(32).toString("hex");
    await pool.query("INSERT IGNORE INTO user_integrations (user_id, webhook_token, logistics_token) VALUES ($1, $2, $3)", [userId, wt, lt]);
  } else if (!ex.rows[0].logistics_token) {
    const lt = crypto.randomBytes(32).toString("hex");
    await pool.query("UPDATE user_integrations SET logistics_token = $1 WHERE user_id = $2 AND logistics_token IS NULL", [lt, userId]);
  }
}

export async function handleLogistics(req, res) {
  try {
    switch (req.method) {
      case "GET": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const targetId = (caller.role === "admin" && req.query.user_id) ? req.query.user_id : caller.id;
        await ensureLogisticsRow(targetId);
        const r = await pool.query(
          "SELECT logistics_platform, logistics_config, logistics_active, logistics_token, created_at, updated_at FROM user_integrations WHERE user_id = $1",
          [targetId]
        );
        if (!r.rows[0]) return res.status(404).json({ success: false, message: "Integração não encontrada" });
        return res.status(200).json({ success: true, logistics: r.rows[0] });
      }
      case "PUT": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const targetId = (caller.role === "admin" && req.query.user_id) ? req.query.user_id : caller.id;
        await ensureLogisticsRow(targetId);
        const { logistics_platform, logistics_config } = req.body || {};
        const fields = [], values = []; let idx = 1;
        if (logistics_platform !== undefined) { fields.push(`logistics_platform = $${idx++}`); values.push(logistics_platform); }
        if (logistics_config !== undefined) { fields.push(`logistics_config = $${idx++}`); values.push(JSON.stringify(logistics_config)); }
        if (!fields.length) return res.status(400).json({ success: false, message: "Nenhum campo informado" });
        fields.push("updated_at = NOW()"); values.push(targetId);
        await pool.query(`UPDATE user_integrations SET ${fields.join(", ")} WHERE user_id = $${idx}`, values);
        const r = await pool.query(
          "SELECT logistics_platform, logistics_config, logistics_active, logistics_token, updated_at FROM user_integrations WHERE user_id = $1",
          [targetId]
        );
        return res.status(200).json({ success: true, message: "Configuração de logística salva", logistics: r.rows[0] });
      }
      case "PATCH": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const targetId = (caller.role === "admin" && req.query.user_id) ? req.query.user_id : caller.id;
        const { logistics_active } = req.body || {};
        if (logistics_active === undefined) return res.status(400).json({ success: false, message: "Informe logistics_active" });
        const upd = await pool.query("UPDATE user_integrations SET logistics_active = $1, updated_at = NOW() WHERE user_id = $2", [logistics_active, targetId]);
        if (!upd.rowCount) return res.status(404).json({ success: false, message: "Integração não encontrada" });
        const r = await pool.query(
          "SELECT logistics_platform, logistics_active, logistics_token, updated_at FROM user_integrations WHERE user_id = $1",
          [targetId]
        );
        return res.status(200).json({ success: true, logistics: r.rows[0] });
      }
      case "POST": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const targetId = (caller.role === "admin" && req.query.user_id) ? req.query.user_id : caller.id;
        if (req.query.action !== "regenerate-token") return res.status(400).json({ success: false, message: "Ação inválida" });
        await ensureLogisticsRow(targetId);
        const newToken = crypto.randomBytes(32).toString("hex");
        const upd = await pool.query("UPDATE user_integrations SET logistics_token = $1, updated_at = NOW() WHERE user_id = $2", [newToken, targetId]);
        if (!upd.rowCount) return res.status(404).json({ success: false, message: "Integração não encontrada" });
        return res.status(200).json({ success: true, message: "Token de logística regenerado", logistics_token: newToken });
      }
      case "DELETE": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const targetId = (caller.role === "admin" && req.query.user_id) ? req.query.user_id : caller.id;
        await pool.query(
          "UPDATE user_integrations SET logistics_platform = NULL, logistics_config = NULL, logistics_active = false, updated_at = NOW() WHERE user_id = $1",
          [targetId]
        );
        return res.status(200).json({ success: true, message: "Configuração de logística removida" });
      }
      default:
        res.setHeader("Allow", ["GET", "PUT", "PATCH", "POST", "DELETE"]);
        return res.status(405).end();
    }
  } catch (err) {
    console.error("[logistics]", err);
    return res.status(500).json({ success: false, message: err.message });
  }
}
