/**
 * api/_lib/error-webhook.js
 * Ponto único de criação de notificações de erro para admins (type='integration_error').
 * Além de gravar a notificação, repassa o mesmo evento em JSON para um webhook
 * configurável pelo admin (ex: Slack, Discord, sistema externo de monitoramento).
 */
import pool from "./db.js";
import { requireAuth } from "../_auth.js";

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_webhook_settings (
      id SMALLINT PRIMARY KEY DEFAULT 1,
      webhook_url TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT admin_webhook_settings_single_row CHECK (id = 1)
    )
  `).catch(() => {});
}

export async function getErrorWebhookUrl() {
  await ensureTable();
  const r = await pool.query("SELECT webhook_url FROM admin_webhook_settings WHERE id = 1").catch(() => ({ rows: [] }));
  return r.rows[0]?.webhook_url || null;
}

// Dispara o webhook configurado com o payload da notificação em JSON.
// Nunca lança — uma falha no webhook do admin não pode quebrar o fluxo de notificação.
async function dispatchErrorWebhook(notification) {
  const url = await getErrorWebhookUrl();
  if (!url) return;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        target_role: notification.target_role,
        created_at: notification.created_at,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (err) {
    console.error("[error-webhook] Falha ao disparar webhook:", err.message);
  }
}

/**
 * Cria uma notificação de erro de integração para os admins e, se houver um
 * webhook configurado, repassa o mesmo evento para ele em JSON.
 * Usar sempre este helper (em vez de INSERT direto) para que nenhuma notificação
 * de erro deixe de ser encaminhada ao webhook.
 */
export async function notifyAdminIntegrationError(title, message) {
  try {
    const r = await pool.query(
      "INSERT INTO notifications (type, title, message, target_role) VALUES ('integration_error', $1, $2, 'admin') RETURNING *",
      [title, message]
    );
    await pool.query("SELECT pg_notify('notifications_changed', 'new')").catch(() => {});
    await dispatchErrorWebhook(r.rows[0]);
  } catch (err) {
    console.error("[error-webhook] Falha ao criar notificação de erro:", err.message);
  }
}

export async function handleErrorWebhookSettings(req, res) {
  const caller = await requireAuth(req, res);
  if (!caller) return;
  await ensureTable();

  if (req.method === "GET") {
    const webhook_url = await getErrorWebhookUrl();
    return res.status(200).json({ success: true, webhook_url });
  }

  if (req.method === "PATCH") {
    if (caller.role !== "admin")
      return res.status(403).json({ success: false, message: "Apenas administradores podem alterar esta configuração." });
    const { webhook_url } = req.body || {};
    if (webhook_url) {
      try { new URL(webhook_url); } catch { return res.status(400).json({ success: false, message: "URL de webhook inválida." }); }
    }
    await pool.query(
      "INSERT INTO admin_webhook_settings (id, webhook_url, updated_at) VALUES (1, $1, NOW()) ON CONFLICT (id) DO UPDATE SET webhook_url = $1, updated_at = NOW()",
      [webhook_url || null]
    );
    return res.status(200).json({ success: true, webhook_url: webhook_url || null });
  }

  res.setHeader("Allow", ["GET", "PATCH"]);
  return res.status(405).end();
}
