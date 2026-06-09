import pool from "./db.js";
import { setCors } from "./_cors.js";
import { requireAdmin } from "./_auth.js";

const MAX_CONCURRENCY = 10;
const MAX_RETRIES     = 3;

export async function enqueueJob(userId, jobType, payload, priority = 0) {
  try {
    await pool.query(
      `INSERT INTO processing_queue (user_id, job_type, payload, priority, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [userId, jobType, JSON.stringify(payload), priority]
    );
  } catch (err) { console.error("[queue] Erro ao enfileirar:", err.message); }
}

async function processOneJob(job) {
  const lock = await pool.query(
    `UPDATE processing_queue SET status='processing', started_at=NOW(), worker_id=$1
     WHERE id=$2 AND status='pending' RETURNING id`,
    [process.env.VERCEL_REGION || "local", job.id]
  );
  if (!lock.rows[0]) return { skipped: true, jobId: job.id };

  try {
    const payload = typeof job.payload === "string" ? JSON.parse(job.payload) : job.payload;
    let result;
    switch (job.job_type) {
      case "webhook.process": {
        const { processWebhookJob } = await import("./webhook-receiver.js");
        result = await processWebhookJob(job.user_id, payload);
        break;
      }
      case "catalog.sync": {
        const { processCatalogSyncJob } = await import("./sync-catalog.js");
        result = await processCatalogSyncJob(job.user_id, payload);
        break;
      }
      default: throw new Error(`Tipo de job desconhecido: ${job.job_type}`);
    }
    await pool.query(
      `UPDATE processing_queue SET status='done', finished_at=NOW(), result=$1, error=NULL WHERE id=$2`,
      [JSON.stringify(result), job.id]
    );
    return { success: true, jobId: job.id };
  } catch (err) {
    const newRetries   = (job.retries || 0) + 1;
    const nextStatus   = newRetries >= MAX_RETRIES ? "failed" : "pending";
    const backoffSecs  = [30, 120, 600][newRetries - 1] || 600;
    await pool.query(
      `UPDATE processing_queue SET status=$1, retries=$2, error=$3,
         finished_at=CASE WHEN $1='failed' THEN NOW() ELSE NULL END,
         started_at=CASE WHEN $1='pending' THEN NOW()+($4||' seconds')::interval ELSE started_at END
       WHERE id=$5`,
      [nextStatus, newRetries, err.message, backoffSecs, job.id]
    );
    return { error: err.message, jobId: job.id };
  }
}

async function processJobsBatch(jobs) {
  const results = [];
  for (let i = 0; i < jobs.length; i += MAX_CONCURRENCY) {
    const chunk   = jobs.slice(i, i + MAX_CONCURRENCY);
    const settled = await Promise.allSettled(chunk.map(processOneJob));
    results.push(...settled);
  }
  return results;
}

export async function handleQueue(req, res) {
  if (setCors(req, res)) return;

  if (req.method === "GET" && (req.url || "").includes("/queue/process")) {
    const secret = req.headers["x-vercel-cron-secret"] || req.headers["authorization"]?.replace("Bearer ", "");
    if (secret !== process.env.CRON_SECRET) {
      const caller = await requireAdmin(req, res); if (!caller) return;
    }
    const limit = Math.min(parseInt(req.query.limit || "50"), 200);
    const jobs  = await pool.query(
      `SELECT id, user_id, job_type, payload, retries, priority FROM processing_queue
       WHERE status='pending' AND (started_at IS NULL OR started_at <= NOW())
       ORDER BY priority DESC, created_at ASC LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit]
    );
    if (!jobs.rows.length) return res.status(200).json({ success: true, message: "Nenhum job pendente", processed: 0 });
    const results   = await processJobsBatch(jobs.rows);
    const done      = results.filter(r => r.status === "fulfilled" && r.value?.success).length;
    const errors    = results.filter(r => r.status === "rejected"  || r.value?.error).length;
    return res.status(200).json({ success: true, total: jobs.rows.length, done, errors });
  }

  if (req.method === "GET") {
    const caller = await requireAdmin(req, res); if (!caller) return;
    const stats  = await pool.query(
      `SELECT status, COUNT(*) AS count, AVG(EXTRACT(EPOCH FROM (finished_at - started_at))) AS avg_duration_s
       FROM processing_queue WHERE created_at > NOW() - INTERVAL '24 hours' GROUP BY status`
    );
    const oldest = await pool.query(
      `SELECT id, user_id, job_type, created_at, retries, error FROM processing_queue
       WHERE status IN ('pending','failed') ORDER BY created_at ASC LIMIT 10`
    );
    return res.status(200).json({ success: true, stats: stats.rows, oldest_pending: oldest.rows });
  }

  if (req.method === "DELETE") {
    const caller = await requireAdmin(req, res); if (!caller) return;
    const days = parseInt(req.query.days || "7");
    const r = await pool.query(
      "DELETE FROM processing_queue WHERE status IN ('done','failed') AND finished_at < NOW() - ($1||' days')::interval RETURNING id",
      [days]
    );
    return res.status(200).json({ success: true, message: `${r.rowCount} jobs removidos` });
  }

  res.setHeader("Allow", ["GET", "DELETE"]);
  return res.status(405).end();
}
