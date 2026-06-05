/**
 * api/queue.js — Fila de processamento assíncrono com paralelismo controlado
 *
 * Problema: Serverless functions no Vercel são stateless e têm timeout.
 * Solução: persistir jobs na tabela `processing_queue` e processar em paralelo
 *          usando Promise.allSettled com concorrência limitada.
 *
 * Fluxo:
 *   1. Webhook recebido → salvo em user_webhooks (como antes) + job enfileirado
 *   2. GET /queue/process (chamado por cron ou após enqueue) → processa N jobs em paralelo
 *   3. Cada job chama o handler correto (order.created, product.sync, etc.)
 *   4. Resultado salvo no job (status, error, retries)
 */

import pool from "./db.js";
import { requireAdmin } from "./_auth.js";
import { setCors } from "./_cors.js";

// Número máximo de jobs processados em paralelo por invocação
const MAX_CONCURRENCY = 10;
// Máximo de tentativas por job
const MAX_RETRIES = 3;

// ─── Enfileira um job de processamento ────────────────────────────────────────
export async function enqueueJob(userId, jobType, payload, priority = 0) {
  try {
    await pool.query(
      `INSERT INTO processing_queue (user_id, job_type, payload, priority, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [userId, jobType, JSON.stringify(payload), priority]
    );
  } catch (err) {
    console.error("[queue] Erro ao enfileirar job:", err.message);
  }
}

// ─── Processa jobs pendentes com concorrência controlada ──────────────────────
async function processJobsBatch(jobs) {
  // Divide em chunks de MAX_CONCURRENCY
  const results = [];
  for (let i = 0; i < jobs.length; i += MAX_CONCURRENCY) {
    const chunk = jobs.slice(i, i + MAX_CONCURRENCY);
    const settled = await Promise.allSettled(chunk.map(job => processOneJob(job)));
    results.push(...settled);
  }
  return results;
}

async function processOneJob(job) {
  const startedAt = new Date();

  // Marca como "processing" (lock otimista)
  const lock = await pool.query(
    `UPDATE processing_queue
     SET status = 'processing', started_at = NOW(), worker_id = $1
     WHERE id = $2 AND status = 'pending'
     RETURNING id`,
    [process.env.VERCEL_REGION || "local", job.id]
  );
  if (!lock.rows[0]) return { skipped: true, jobId: job.id }; // Outro worker pegou

  try {
    const payload = typeof job.payload === "string" ? JSON.parse(job.payload) : job.payload;
    let result;

    // Despacha pelo tipo de job
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
      default:
        throw new Error(`Tipo de job desconhecido: ${job.job_type}`);
    }

    await pool.query(
      `UPDATE processing_queue
       SET status = 'done', finished_at = NOW(), result = $1, error = NULL
       WHERE id = $2`,
      [JSON.stringify(result), job.id]
    );
    return { success: true, jobId: job.id, duration: Date.now() - startedAt };

  } catch (err) {
    const newRetries = (job.retries || 0) + 1;
    const nextStatus = newRetries >= MAX_RETRIES ? "failed" : "pending";
    // Back-off exponencial: 30s, 2min, 10min
    const backoffSeconds = [30, 120, 600][newRetries - 1] || 600;

    await pool.query(
      `UPDATE processing_queue
       SET status = $1, retries = $2, error = $3,
           finished_at = CASE WHEN $1 = 'failed' THEN NOW() ELSE NULL END,
           started_at  = CASE WHEN $1 = 'pending' THEN NOW() + ($4 || ' seconds')::interval ELSE started_at END
       WHERE id = $5`,
      [nextStatus, newRetries, err.message, backoffSeconds, job.id]
    );
    return { error: err.message, jobId: job.id, retries: newRetries };
  }
}

// ─── Handler HTTP ──────────────────────────────────────────────────────────────
export async function handleQueue(req, res) {
  if (setCors(req, res)) return;

  // GET /queue/process → processa lote (chamado por cron Vercel ou manualmente)
  if (req.method === "GET" && (req.url || "").includes("/queue/process")) {
    // Aceita admin-secret OU Vercel Cron secret
    const cronSecret = req.headers["x-vercel-cron-secret"] || req.headers["authorization"]?.replace("Bearer ", "");
    const isValidCron = cronSecret === process.env.CRON_SECRET;
    if (!isValidCron) {
      const caller = await requireAdmin(req, res); if (!caller) return;
    }

    const limit = Math.min(parseInt(req.query.limit || "50"), 200);
    const jobs = await pool.query(
      `SELECT id, user_id, job_type, payload, retries, priority
       FROM processing_queue
       WHERE status = 'pending' AND (started_at IS NULL OR started_at <= NOW())
       ORDER BY priority DESC, created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit]
    );

    if (!jobs.rows.length) {
      return res.status(200).json({ success: true, message: "Nenhum job pendente", processed: 0 });
    }

    const results = await processJobsBatch(jobs.rows);
    const done    = results.filter(r => r.status === "fulfilled" && r.value?.success).length;
    const errors  = results.filter(r => r.status === "rejected" || r.value?.error).length;
    const skipped = results.filter(r => r.value?.skipped).length;

    return res.status(200).json({
      success: true, total: jobs.rows.length, done, errors, skipped,
      results: results.map(r => r.value || r.reason),
    });
  }

  // GET /queue → status da fila (admin)
  if (req.method === "GET") {
    const caller = await requireAdmin(req, res); if (!caller) return;
    const stats = await pool.query(
      `SELECT status, COUNT(*) AS count, AVG(EXTRACT(EPOCH FROM (finished_at - started_at))) AS avg_duration_s
       FROM processing_queue
       WHERE created_at > NOW() - INTERVAL '24 hours'
       GROUP BY status`
    );
    const oldest = await pool.query(
      `SELECT id, user_id, job_type, created_at, retries, error
       FROM processing_queue WHERE status IN ('pending','failed') ORDER BY created_at ASC LIMIT 10`
    );
    return res.status(200).json({ success: true, stats: stats.rows, oldest_pending: oldest.rows });
  }

  // DELETE /queue → limpa jobs concluídos antigos (admin)
  if (req.method === "DELETE") {
    const caller = await requireAdmin(req, res); if (!caller) return;
    const days = parseInt(req.query.days || "7");
    const r = await pool.query(
      "DELETE FROM processing_queue WHERE status IN ('done','failed') AND finished_at < NOW() - ($1 || ' days')::interval RETURNING id",
      [days]
    );
    return res.status(200).json({ success: true, message: `${r.rowCount} jobs removidos` });
  }

  res.setHeader("Allow", ["GET", "DELETE"]);
  return res.status(405).end();
}
