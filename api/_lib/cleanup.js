import pool from "./db.js";
import { isAdminSecret } from "./_auth.js";
import { setCors } from "./_cors.js";

export async function handleCleanup(req, res) {
  if (setCors(req, res)) return;
  const cronSecret = req.headers["x-vercel-cron-secret"] || req.headers["authorization"]?.replace("Bearer ", "");
  if (cronSecret !== process.env.CRON_SECRET && !isAdminSecret(req))
    return res.status(401).json({ success: false, message: "Não autorizado" });

  const webhookDays = parseInt(req.query.webhook_days || "90");
  const queueDays   = parseInt(req.query.queue_days   || "7");

  try {
    const [wh, q] = await Promise.all([
      pool.query(
        `DELETE FROM user_webhooks WHERE received_at < NOW() - ($1||' days')::interval RETURNING id`,
        [webhookDays]
      ),
      pool.query(
        `DELETE FROM processing_queue WHERE status IN ('done','failed') AND finished_at < NOW() - ($1||' days')::interval RETURNING id`,
        [queueDays]
      ).catch(() => ({ rowCount: 0 })),
    ]);
    const summary = { webhooks_deleted: wh.rowCount, queue_deleted: q.rowCount, ran_at: new Date().toISOString() };
    console.log("[cleanup]", summary);
    return res.status(200).json({ success: true, ...summary });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}
