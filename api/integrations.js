import pool from "./db.js";
import { setCors } from "./_cors.js";
import { requireAuth } from "./_auth.js";
import crypto from "crypto";

export default async function handler(req, res) {
  if (setCors(req, res)) return;
  try {
    switch (req.method) {

      // ── GET ─────────────────────────────────────────────────────────────
      case "GET": {
        const caller = await requireAuth(req, res); if (!caller) return;
        if (caller.role === "admin") {
          const { user_id } = req.query;
          if (user_id) {
            const r = await pool.query(
              "SELECT ui.*, u.name AS user_name, u.email AS user_email FROM user_integrations ui JOIN users u ON u.id = ui.user_id WHERE ui.user_id = $1",
              [user_id]
            );
            if (!r.rows[0]) return res.status(404).json({ success: false, message: "Integração não encontrada" });
            return res.status(200).json({ success: true, integration: r.rows[0] });
          }
          const r = await pool.query(
            "SELECT ui.*, u.name AS user_name, u.email AS user_email FROM user_integrations ui JOIN users u ON u.id = ui.user_id ORDER BY ui.created_at DESC"
          );
          return res.status(200).json({ success: true, integrations: r.rows, total: r.rowCount });
        }
        // Usuário comum — cria integração se não existir
        let r = await pool.query("SELECT * FROM user_integrations WHERE user_id = $1", [caller.id]);
        if (!r.rows[0]) {
          const wt = crypto.randomBytes(32).toString("hex");
          const ct = crypto.randomBytes(32).toString("hex");
          r = await pool.query(
            "INSERT INTO user_integrations (user_id, webhook_token, chatbot_token) VALUES ($1, $2, $3) RETURNING *",
            [caller.id, wt, ct]
          );
        } else if (!r.rows[0].chatbot_token) {
          const ct = crypto.randomBytes(32).toString("hex");
          r = await pool.query(
            "UPDATE user_integrations SET chatbot_token = $1 WHERE user_id = $2 AND chatbot_token IS NULL RETURNING *",
            [ct, caller.id]
          );
          if (!r.rows[0]) r = await pool.query("SELECT * FROM user_integrations WHERE user_id = $1", [caller.id]);
        }
        return res.status(200).json({ success: true, integration: r.rows[0] });
      }

      // ── PUT — salva plataforma + config ──────────────────────────────────
      case "PUT": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const targetId = (caller.role === "admin" && req.query.user_id) ? req.query.user_id : caller.id;
        const { suri_endpoint, suri_token, ecommerce_platform, ecommerce_config } = req.body || {};
        await pool.query(
          "INSERT INTO user_integrations (user_id, webhook_token) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING",
          [targetId, crypto.randomBytes(32).toString("hex")]
        );
        const fields = [], values = []; let idx = 1;
        if (suri_endpoint      !== undefined) { fields.push(`suri_endpoint = $${idx++}`);      values.push(suri_endpoint); }
        if (suri_token         !== undefined) { fields.push(`suri_token = $${idx++}`);         values.push(suri_token); }
        if (ecommerce_platform !== undefined) {
          fields.push(`ecommerce_platform = $${idx++}`);
          values.push(ecommerce_platform);
          // Resetar status ao trocar plataforma
          fields.push(`ecommerce_connection_status = $${idx++}`);
          values.push("idle");
          fields.push(`ecommerce_connection_msg = $${idx++}`);
          values.push(null);
        }
        if (ecommerce_config   !== undefined) { fields.push(`ecommerce_config = $${idx++}`);   values.push(JSON.stringify(ecommerce_config)); }
        if (!fields.length) return res.status(400).json({ success: false, message: "Nenhum campo informado" });
        fields.push("updated_at = NOW()"); values.push(targetId);
        const r = await pool.query(
          `UPDATE user_integrations SET ${fields.join(", ")} WHERE user_id = $${idx} RETURNING *`,
          values
        );
        return res.status(200).json({ success: true, message: "Integração salva", integration: r.rows[0] });
      }

      // ── PATCH — toggle active / salvar status de conexão ─────────────────
      case "PATCH": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const targetId = (caller.role === "admin" && req.query.user_id) ? req.query.user_id : caller.id;
        const {
          suri_active, ecommerce_active,
          chatbot_active,
          // status de conexão persistido após teste
          chatbot_connection_status,
          ecommerce_connection_status, ecommerce_connection_msg,
        } = req.body || {};

        const fields = [], values = []; let idx = 1;
        if (suri_active                  !== undefined) { fields.push(`suri_active = $${idx++}`);                  values.push(suri_active); }
        if (ecommerce_active             !== undefined) { fields.push(`ecommerce_active = $${idx++}`);             values.push(ecommerce_active); }
        if (chatbot_active               !== undefined) { fields.push(`chatbot_active = $${idx++}`);               values.push(chatbot_active); }
        if (chatbot_connection_status    !== undefined) { fields.push(`chatbot_connection_status = $${idx++}`);    values.push(chatbot_connection_status); }
        if (ecommerce_connection_status  !== undefined) { fields.push(`ecommerce_connection_status = $${idx++}`); values.push(ecommerce_connection_status); }
        if (ecommerce_connection_msg     !== undefined) { fields.push(`ecommerce_connection_msg = $${idx++}`);     values.push(ecommerce_connection_msg); }

        if (!fields.length) return res.status(400).json({ success: false, message: "Nenhum campo informado" });
        fields.push("updated_at = NOW()"); values.push(targetId);
        const r = await pool.query(
          `UPDATE user_integrations SET ${fields.join(", ")} WHERE user_id = $${idx} RETURNING *`,
          values
        );
        if (!r.rows[0]) return res.status(404).json({ success: false, message: "Integração não encontrada" });
        return res.status(200).json({ success: true, message: "Status atualizado", integration: r.rows[0] });
      }

      // ── DELETE — limpa integração ────────────────────────────────────────
      case "DELETE": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const targetId = (caller.role === "admin" && req.query.user_id) ? req.query.user_id : caller.id;
        await pool.query(
          "UPDATE user_integrations SET suri_endpoint=NULL, suri_token=NULL, suri_active=false, ecommerce_platform=NULL, ecommerce_config=NULL, ecommerce_active=false, ecommerce_connection_status='idle', ecommerce_connection_msg=NULL, chatbot_connection_status='idle', updated_at=NOW() WHERE user_id=$1",
          [targetId]
        );
        return res.status(200).json({ success: true, message: "Integração limpa" });
      }

      default:
        res.setHeader("Allow", ["GET", "PUT", "PATCH", "DELETE"]);
        return res.status(405).end();
    }
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}
