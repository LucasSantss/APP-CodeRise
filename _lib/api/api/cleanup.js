/**
 * api/cleanup.js — Job de retenção de dados
 *
 * Chamado pelo cron do Vercel (vercel.json → crons).
 * Remove:
 *   - user_webhooks com mais de 90 dias
 *   - processing_queue com status done/failed com mais de 7 dias
 *   - Limpa cache de logins expirados (feito em memória no auth.js)
 */
import pool from "./db.js";
import { isAdminSecret } from "./_auth.js";
import { setCors } from "./_cors.js";

export async function handleCleanup(req, res) {
  if (setCors(req, res)) return;

  // Aceita chamada do cron Vercel OU admin-secret
  const cronSecret = req.headers["x-vercel-cron-secret"] ||
                     req.headers["authorization"]?.replace("Bearer ", "");
  const isValidCron = cronSecret === process.env.CRON_SECRET;
  if (!isValidCron && !isAdminSecret(req)) {
    return res.status(401).json({ success: false, message: "Não autorizado" });
  }

  const webhookDays = parseInt(req.query.webhook_days || "90");
  const queueDays   = parseInt(req.query.queue_days   || "7");

  try {
    const [webhooksResult, queueResult] = await Promise.all([
      pool.query(
        `DELETE FROM user_webhooks
         WHERE received_at < NOW() - ($1 || ' days')::interval
         RETURNING id`,
        [webhookDays]
      ),
      pool.query(
        `DELETE FROM processing_queue
         WHERE status IN ('done','failed')
           AND finished_at < NOW() - ($1 || ' days')::interval
         RETURNING id`,
        [queueDays]
      ),
    ]);

    const summary = {
      webhooks_deleted: webhooksResult.rowCount,
      queue_deleted:    queueResult.rowCount,
      webhook_retention_days: webhookDays,
      queue_retention_days:   queueDays,
      ran_at: new Date().toISOString(),
    };

    console.log("[cleanup]", summary);
    return res.status(200).json({ success: true, ...summary });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}
