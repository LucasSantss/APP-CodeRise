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
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT admin_webhook_settings_single_row CHECK (id = 1)
    )
  `).catch(() => {});
}

export async function getErrorWebhookUrl() {
  await ensureTable();
  const r = await pool.query("SELECT webhook_url FROM admin_webhook_settings WHERE id = 1").catch(() => ({ rows: [] }));
  return r.rows[0]?.webhook_url || null;
}

// Cache em memória da URL configurada — evita consultar o banco a cada erro.
// Invalidado imediatamente quando o admin salva uma nova URL (handleErrorWebhookSettings).
let cachedWebhookUrl;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 60_000;

async function getCachedErrorWebhookUrl() {
  if (cachedWebhookUrl !== undefined && Date.now() < cacheExpiresAt) return cachedWebhookUrl;
  cachedWebhookUrl = await getErrorWebhookUrl();
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return cachedWebhookUrl;
}

// Dispara o webhook configurado com o payload em JSON. Roda em paralelo com a
// gravação no banco (Promise.all em notifyAdminIntegrationError), mas PRECISA
// ser aguardado até o fim pelo chamador — em ambiente serverless (Vercel), uma
// promise não aguardada pode ser interrompida assim que a função retorna a
// resposta, então "fire-and-forget" de fato perdia o disparo do webhook.
async function dispatchErrorWebhook(payload) {
  try {
    const url = await getCachedErrorWebhookUrl();
    if (!url) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.error("[error-webhook] Falha ao disparar webhook:", err.message);
  }
}

/**
 * Cria uma notificação de erro de integração para os admins e repassa o mesmo
 * evento para o webhook configurado em JSON. Usar sempre este helper (em vez
 * de INSERT direto) para que nenhuma notificação de erro deixe de ser
 * encaminhada ao webhook.
 */
export async function notifyAdminIntegrationError(title, message, extra = {}) {
  // "extra" carrega dados estruturados (ex: resumo da sincronização) além do
  // texto, pra quem consome o webhook (Slack, monitoramento externo) não
  // precisar reparsear a mensagem.
  const webhookPromise = dispatchErrorWebhook({
    type: "integration_error",
    title,
    message,
    target_role: "admin",
    created_at: new Date().toISOString(),
    ...extra,
  });

  const dbPromise = (async () => {
    await pool.query(
      "INSERT INTO notifications (type, title, message, target_role) VALUES ('integration_error', $1, $2, 'admin')",
      [title, message]
    );
  })();

  try {
    await Promise.all([webhookPromise, dbPromise]);
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
      "INSERT INTO admin_webhook_settings (id, webhook_url, updated_at) VALUES (1, $1, NOW()) ON DUPLICATE KEY UPDATE webhook_url = $1, updated_at = NOW()",
      [webhook_url || null]
    );
    cachedWebhookUrl = webhook_url || null;
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
    return res.status(200).json({ success: true, webhook_url: webhook_url || null });
  }

  res.setHeader("Allow", ["GET", "PATCH"]);
  return res.status(405).end();
}
