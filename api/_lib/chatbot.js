import pool from "./db.js";
import crypto from "crypto";
import { requireAuth } from "./_auth.js";

async function ensureChatbotRow(userId) {
  const ex = await pool.query("SELECT webhook_token, chatbot_token FROM user_integrations WHERE user_id = $1", [userId]);
  if (!ex.rows[0]) {
    const wt = crypto.randomBytes(32).toString("hex"), ct = crypto.randomBytes(32).toString("hex");
    await pool.query("INSERT INTO user_integrations (user_id, webhook_token, chatbot_token) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING", [userId, wt, ct]);
  } else if (!ex.rows[0].chatbot_token) {
    const ct = crypto.randomBytes(32).toString("hex");
    await pool.query("UPDATE user_integrations SET chatbot_token = $1 WHERE user_id = $2 AND chatbot_token IS NULL", [ct, userId]);
  }
}

export async function handleChatbot(req, res) {
  try {
    switch (req.method) {
      case "GET": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const targetId = (caller.role === "admin" && req.query.user_id) ? req.query.user_id : caller.id;
        await ensureChatbotRow(targetId);
        let r;
        try {
          r = await pool.query("SELECT chatbot_platform, chatbot_config, chatbot_active, chatbot_token, suri_endpoint, suri_token, suri_active, created_at, updated_at FROM user_integrations WHERE user_id = $1", [targetId]);
        } catch {
          r = await pool.query("SELECT chatbot_platform, chatbot_config, chatbot_active, chatbot_token, created_at, updated_at FROM user_integrations WHERE user_id = $1", [targetId]);
        }
        if (!r.rows[0]) return res.status(404).json({ success: false, message: "Integração não encontrada" });
        const row = r.rows[0]; const ccfg = row.chatbot_config || {};
        if (!row.suri_endpoint && ccfg.endpoint) row.suri_endpoint = ccfg.endpoint;
        if (!row.suri_token    && ccfg.token)    row.suri_token    = ccfg.token;
        return res.status(200).json({ success: true, chatbot: row });
      }
      case "PUT": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const targetId = (caller.role === "admin" && req.query.user_id) ? req.query.user_id : caller.id;
        await ensureChatbotRow(targetId);
        const { chatbot_platform, chatbot_config } = req.body || {};
        const fields = [], values = []; let idx = 1;
        if (chatbot_platform !== undefined) { fields.push(`chatbot_platform = $${idx++}`); values.push(chatbot_platform); }
        if (chatbot_config   !== undefined) { fields.push(`chatbot_config = $${idx++}`);   values.push(JSON.stringify(chatbot_config)); }
        if (!fields.length) return res.status(400).json({ success: false, message: "Nenhum campo informado" });
        fields.push("updated_at = NOW()"); values.push(targetId);
        const r = await pool.query(`UPDATE user_integrations SET ${fields.join(", ")} WHERE user_id = $${idx} RETURNING chatbot_platform, chatbot_config, chatbot_active, chatbot_token, updated_at`, values);
        return res.status(200).json({ success: true, message: "Configuração de chatbot salva", chatbot: r.rows[0] });
      }
      case "PATCH": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const targetId = (caller.role === "admin" && req.query.user_id) ? req.query.user_id : caller.id;
        const { chatbot_active } = req.body || {};
        if (chatbot_active === undefined) return res.status(400).json({ success: false, message: "Informe chatbot_active" });
        const r = await pool.query("UPDATE user_integrations SET chatbot_active = $1, updated_at = NOW() WHERE user_id = $2 RETURNING chatbot_platform, chatbot_active, chatbot_token, updated_at", [chatbot_active, targetId]);
        if (!r.rows[0]) return res.status(404).json({ success: false, message: "Integração não encontrada" });
        return res.status(200).json({ success: true, chatbot: r.rows[0] });
      }
      case "POST": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const targetId = (caller.role === "admin" && req.query.user_id) ? req.query.user_id : caller.id;
        if (req.query.action !== "regenerate-token") return res.status(400).json({ success: false, message: "Ação inválida" });
        const newToken = crypto.randomBytes(32).toString("hex");
        const r = await pool.query("UPDATE user_integrations SET chatbot_token = $1, updated_at = NOW() WHERE user_id = $2 RETURNING chatbot_token, updated_at", [newToken, targetId]);
        if (!r.rows[0]) return res.status(404).json({ success: false, message: "Integração não encontrada" });
        return res.status(200).json({ success: true, message: "Token do chatbot regenerado", chatbot_token: r.rows[0].chatbot_token });
      }
      case "DELETE": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const targetId = (caller.role === "admin" && req.query.user_id) ? req.query.user_id : caller.id;
        await pool.query("UPDATE user_integrations SET chatbot_platform = NULL, chatbot_config = NULL, chatbot_active = false, updated_at = NOW() WHERE user_id = $1", [targetId]);
        return res.status(200).json({ success: true, message: "Configuração de chatbot removida" });
      }
      default: res.setHeader("Allow", ["GET","PUT","PATCH","POST","DELETE"]); return res.status(405).end();
    }
  } catch (err) { console.error("[chatbot]", err); return res.status(500).json({ success: false, message: err.message }); }
}
