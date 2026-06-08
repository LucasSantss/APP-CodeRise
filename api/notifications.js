import pool, { checkDb } from "./db.js";
import { setCors } from "./_cors.js";
import { requireAuth, getUserByTokenString } from "./_auth.js";

async function getVisibleIds(caller) {
  const now = new Date().toISOString();
  let q;
  if (caller.role === "admin") {
    q = await pool.query(`SELECT id FROM notifications WHERE (type='integration_error' OR (type='broadcast' AND target_role IN ('admin','all'))) AND (scheduled_at IS NULL OR scheduled_at <= $1)`, [now]);
  } else {
    q = await pool.query(`SELECT id FROM notifications WHERE ((type IN ('error','status_change') AND (target_user_id IS NULL OR target_user_id=$2)) OR (type='broadcast' AND target_role IN ('user','all'))) AND (scheduled_at IS NULL OR scheduled_at <= $1)`, [now, caller.id]);
  }
  return q.rows.map(r => r.id);
}

async function fetchNotificationsForCaller(caller, afterId = null) {
  const now = new Date().toISOString();
  let query, params;
  const afterClause = afterId ? ` AND n.id > $3` : "";
  if (caller.role === "admin") {
    query = `SELECT n.*, COALESCE(nr.read_at IS NOT NULL, false) AS read FROM notifications n LEFT JOIN notification_reads nr ON nr.notification_id=n.id AND nr.user_id=$1 WHERE (n.type IN ('integration_error') OR (n.type='broadcast' AND n.target_role IN ('admin','all'))) AND (n.scheduled_at IS NULL OR n.scheduled_at<=$2) AND (nr.hidden IS NULL OR nr.hidden=false)${afterClause} ORDER BY n.created_at DESC LIMIT 30`;
    params = afterId ? [caller.id, now, afterId] : [caller.id, now];
  } else {
    query = `SELECT n.*, COALESCE(nr.read_at IS NOT NULL, false) AS read FROM notifications n LEFT JOIN notification_reads nr ON nr.notification_id=n.id AND nr.user_id=$1 WHERE ((n.type IN ('error','status_change') AND (n.target_user_id IS NULL OR n.target_user_id=$1)) OR (n.type='broadcast' AND n.target_role IN ('user','all'))) AND (n.scheduled_at IS NULL OR n.scheduled_at<=$2) AND (nr.hidden IS NULL OR nr.hidden=false)${afterClause} ORDER BY n.created_at DESC LIMIT 30`;
    params = afterId ? [caller.id, now, afterId] : [caller.id, now];
  }
  const r = await pool.query(query, params);
  return r.rows;
}

export default async function handler(req, res) {
  // ── REST normal ─────────────────────────────────────────────────────────────
  if (setCors(req, res)) return;
  try { await checkDb(); } catch (dbErr) { return res.status(500).json({ success: false, message: dbErr.message }); }
  try {
    switch (req.method) {
      case "GET": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const afterId = req.query?.after_id ? parseInt(req.query.after_id, 10) : null;
        const timeout = 20000;

        // Se não há after_id, retorna tudo imediatamente (carga inicial)
        if (afterId === null) {
          const notifications = await fetchNotificationsForCaller(caller, null);
          return res.status(200).json({ success: true, notifications, has_new: false });
        }

        // Consulta imediata — se já houver novas, retorna agora
        const immediate = await fetchNotificationsForCaller(caller, afterId);
        if (immediate.length > 0) {
          return res.status(200).json({ success: true, notifications: immediate, has_new: true });
        }

        // Aguarda notificação via LISTEN/NOTIFY
        let client;
        let resolved = false;
        const respond = (notifications) => {
          if (resolved) return;
          resolved = true;
          res.status(200).json({ success: true, notifications, has_new: notifications.length > 0 });
        };

        try {
          client = await pool.connect();
          await client.query(`CREATE OR REPLACE FUNCTION notify_notification_change() RETURNS trigger AS $$ BEGIN PERFORM pg_notify('notifications_changed', NEW.id::text); RETURN NEW; END; $$ LANGUAGE plpgsql`);
          await client.query(`DROP TRIGGER IF EXISTS notification_insert_notify ON notifications; CREATE TRIGGER notification_insert_notify AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION notify_notification_change()`);
          await client.query("LISTEN notifications_changed");

          const timer = setTimeout(async () => {
            try { await client.query("UNLISTEN notifications_changed"); client.release(); } catch {}
            respond([]);
          }, timeout);

          client.on("notification", async () => {
            clearTimeout(timer);
            try { await client.query("UNLISTEN notifications_changed"); client.release(); } catch {}
            const fresh = await fetchNotificationsForCaller(caller, afterId);
            respond(fresh);
          });

          req.on("close", () => {
            clearTimeout(timer);
            resolved = true;
            try { client.query("UNLISTEN notifications_changed").then(() => client.release()).catch(() => {}); } catch {}
          });
        } catch (err) {
          if (client) { try { client.release(); } catch {} }
          if (!resolved) respond([]);
        }
        return; // resposta é assíncrona
      }
      case "POST": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const { type, title, message, image_url, target_role, target_user_id, scheduled_at } = req.body || {};
        if (!type || !title || !message) return res.status(400).json({ success: false, message: "type, title e message são obrigatórios" });
        if (type === "broadcast" && caller.role !== "admin") return res.status(403).json({ success: false, message: "Apenas administradores podem criar notificações broadcast" });
        const r = await pool.query(`INSERT INTO notifications (type,title,message,image_url,target_role,target_user_id,scheduled_at,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [type, title, message, image_url || null, target_role || "all", target_user_id || null, scheduled_at || null, caller.id]);
        await pool.query(`DELETE FROM notifications WHERE id IN (SELECT id FROM notifications ORDER BY created_at DESC OFFSET 30)`).catch(() => {});
        return res.status(201).json({ success: true, notification: r.rows[0] });
      }
      case "PATCH": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const { id, mark_all } = req.body || {};
        if (mark_all) {
          const ids = await getVisibleIds(caller);
          for (const nid of ids) { await pool.query(`INSERT INTO notification_reads (notification_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [nid, caller.id]); }
          return res.status(200).json({ success: true, message: "Todas marcadas como lidas" });
        }
        if (!id) return res.status(400).json({ success: false, message: "id ou mark_all obrigatório" });
        await pool.query(`INSERT INTO notification_reads (notification_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, caller.id]);
        return res.status(200).json({ success: true });
      }
      case "DELETE": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const { id } = req.query; if (!id) return res.status(400).json({ success: false, message: "id obrigatório" });
        await pool.query(`INSERT INTO notification_reads (notification_id,user_id,hidden) VALUES ($1,$2,true) ON CONFLICT (notification_id,user_id) DO UPDATE SET hidden=true`, [id, caller.id]);
        return res.status(200).json({ success: true });
      }
      default: res.setHeader("Allow", ["GET","POST","PATCH","DELETE"]); return res.status(405).end();
    }
  } catch (err) { console.error("[notifications]", err); return res.status(500).json({ success: false, message: err.message }); }
}
