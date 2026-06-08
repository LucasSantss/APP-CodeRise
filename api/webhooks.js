import pool from "./db.js";
import { requireAuth } from "./_auth.js";

export async function handleWebhooks(req, res) {
  try {
    switch (req.method) {
      case "GET": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const { id, event_type, status, limit, since, after_id, source } = req.query;
        const where = [], values = []; let idx = 1;
        if (caller.role !== "admin") { where.push(`uw.user_id = $${idx++}`); values.push(caller.id); }
        else if (req.query.user_id) { where.push(`uw.user_id = $${idx++}`); values.push(req.query.user_id); }
        if (id)         { where.push(`uw.id = $${idx++}`);          values.push(id); }
        if (event_type) { where.push(`uw.event_type = $${idx++}`);  values.push(event_type); }
        if (status)     { where.push(`uw.status = $${idx++}`);      values.push(status); }
        if (source)     { where.push(`uw.source = $${idx++}`);      values.push(source); }
        if (since)      { where.push(`uw.received_at > $${idx++}`); values.push(since); }
        if (after_id)   { where.push(`uw.id > $${idx++}`);          values.push(after_id); }
        const whereStr = where.length ? `WHERE ${where.join(" AND ")}` : "";
        let maxRows = 500;
        if (limit) { const p = parseInt(limit, 10); if (!isNaN(p) && p > 0) maxRows = Math.min(p, 500); }
        const r = await pool.query(`SELECT uw.id, uw.user_id, u.name AS user_name, u.email AS user_email, uw.event_type, uw.payload, uw.status, uw.error_message, uw.source, uw.received_at FROM user_webhooks uw JOIN users u ON u.id = uw.user_id ${whereStr} ORDER BY uw.received_at DESC LIMIT $${idx}`, [...values, maxRows]);
        if (id) { if (!r.rows[0]) return res.status(404).json({ success: false, message: "Evento não encontrado" }); return res.status(200).json({ success: true, webhook: r.rows[0] }); }
        return res.status(200).json({ success: true, webhooks: r.rows, total: r.rowCount, server_time: new Date().toISOString() });
      }
      case "PATCH": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const { id } = req.query; if (!id) return res.status(400).json({ success: false, message: "id obrigatório" });
        const { status, error_message } = req.body || {};
        if (!["received","processed","error"].includes(status)) return res.status(400).json({ success: false, message: "status inválido" });
        const ownerFilter = caller.role === "admin" ? "" : ` AND user_id = ${caller.id}`;
        const r = await pool.query(`UPDATE user_webhooks SET status=$1, error_message=$2 WHERE id=$3${ownerFilter} RETURNING id, status, error_message`, [status, error_message || null, id]);
        if (!r.rows[0]) return res.status(404).json({ success: false, message: "Evento não encontrado" });
        try { await pool.query("NOTIFY webhooks_changed, $1", [JSON.stringify({ id: r.rows[0].id, status: r.rows[0].status })]); } catch {}
        return res.status(200).json({ success: true, message: "Status atualizado", webhook: r.rows[0] });
      }
      case "DELETE": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const { id } = req.query;
        if (id) {
          const ownerFilter = caller.role === "admin" ? "" : ` AND user_id = ${caller.id}`;
          const r = await pool.query(`DELETE FROM user_webhooks WHERE id=$1${ownerFilter} RETURNING id`, [id]);
          if (!r.rows[0]) return res.status(404).json({ success: false, message: "Evento não encontrado" });
          try { await pool.query("NOTIFY webhooks_changed, $1", [JSON.stringify({ id: r.rows[0].id, action: "deleted" })]); } catch {}
          return res.status(200).json({ success: true, message: "Evento apagado" });
        }
        if (caller.role === "admin" && req.query.user_id) { await pool.query("DELETE FROM user_webhooks WHERE user_id=$1", [req.query.user_id]); }
        else if (caller.role === "admin") { await pool.query("DELETE FROM user_webhooks"); }
        else { await pool.query("DELETE FROM user_webhooks WHERE user_id=$1", [caller.id]); }
        try { await pool.query("NOTIFY webhooks_changed, $1", [JSON.stringify({ action: "deleted_bulk" })]); } catch {}
        return res.status(200).json({ success: true, message: "Eventos apagados" });
      }
      default: res.setHeader("Allow", ["GET","PATCH","DELETE"]); return res.status(405).end();
    }
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
}

export async function handleWebhooksPoll(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow", ["GET"]); return res.status(405).end(); }
  const caller = await requireAuth(req, res); if (!caller) return;

  const afterId = req.query.after_id ? parseInt(req.query.after_id, 10) : null;
  const timeout = 20000;

  const buildQuery = () => {
    const where = [], values = []; let idx = 1;
    if (caller.role !== "admin") { where.push(`uw.user_id = $${idx++}`); values.push(caller.id); }
    else if (req.query.user_id) { where.push(`uw.user_id = $${idx++}`); values.push(req.query.user_id); }
    if (req.query.status)     { where.push(`uw.status = $${idx++}`);     values.push(req.query.status); }
    if (req.query.event_type) { where.push(`uw.event_type = $${idx++}`); values.push(req.query.event_type); }
    if (afterId !== null)     { where.push(`uw.id > $${idx++}`);         values.push(afterId); }
    const whereStr = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return { sql: `SELECT uw.id, uw.user_id, u.name AS user_name, u.email AS user_email, uw.event_type, uw.payload, uw.status, uw.error_message, uw.source, uw.received_at FROM user_webhooks uw JOIN users u ON u.id = uw.user_id ${whereStr} ORDER BY uw.received_at DESC LIMIT 100`, values };
  };

  const { sql, values } = buildQuery();
  const immediate = await pool.query(sql, values).catch(() => ({ rows: [] }));
  if (immediate.rows.length > 0) {
    return res.status(200).json({ success: true, webhooks: immediate.rows, has_new: true, server_time: new Date().toISOString() });
  }

  let client;
  let resolved = false;
  const respond = (webhooks) => {
    if (resolved) return;
    resolved = true;
    res.status(200).json({ success: true, webhooks, has_new: webhooks.length > 0, server_time: new Date().toISOString() });
  };

  try {
    client = await pool.connect();
    await client.query(`CREATE OR REPLACE FUNCTION notify_webhook_change() RETURNS trigger AS $$ BEGIN PERFORM pg_notify('webhooks_changed', NEW.id::text); RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await client.query(`DROP TRIGGER IF EXISTS webhook_insert_notify ON user_webhooks; CREATE TRIGGER webhook_insert_notify AFTER INSERT OR UPDATE ON user_webhooks FOR EACH ROW EXECUTE FUNCTION notify_webhook_change()`);
    await client.query("LISTEN webhooks_changed");

    const timer = setTimeout(async () => {
      try { await client.query("UNLISTEN webhooks_changed"); client.release(); } catch {}
      respond([]);
    }, timeout);

    client.on("notification", async () => {
      clearTimeout(timer);
      try { await client.query("UNLISTEN webhooks_changed"); client.release(); } catch {}
      const { sql: s2, values: v2 } = buildQuery();
      const fresh = await pool.query(s2, v2).catch(() => ({ rows: [] }));
      respond(fresh.rows);
    });

    req.on("close", () => {
      clearTimeout(timer);
      resolved = true;
      try { client.query("UNLISTEN webhooks_changed").then(() => client.release()).catch(() => {}); } catch {}
    });
  } catch (err) {
    if (client) { try { client.release(); } catch {} }
    if (!resolved) res.status(200).json({ success: true, webhooks: [], has_new: false, server_time: new Date().toISOString() });
  }
}
