import pool from "./db.js";
import { setCors } from "./_cors.js";
import { requireAuth } from "./_auth.js";

export default async function handler(req, res) {
  if (setCors(req, res)) return;
  try {
    switch (req.method) {
      case "GET": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const targetId = (caller.role === "admin" && req.query.user_id) ? req.query.user_id : caller.id;
        const r = await pool.query("SELECT * FROM sync_rules WHERE user_id = $1 ORDER BY created_at ASC", [targetId]);
        return res.status(200).json({ success: true, rules: r.rows, total: r.rowCount });
      }
      case "POST": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const targetId = (caller.role === "admin" && req.query.user_id) ? req.query.user_id : caller.id;
        const { event, active = true, message_template, delay_minutes = 0 } = req.body || {};
        if (!event) return res.status(400).json({ success: false, message: "event obrigatório" });
        const r = await pool.query("INSERT INTO sync_rules (user_id, event, active, message_template, delay_minutes) VALUES ($1,$2,$3,$4,$5) RETURNING *", [targetId, event, active, message_template || null, delay_minutes]);
        await pool.query(`DELETE FROM sync_rules WHERE user_id=$1 AND id NOT IN (SELECT id FROM sync_rules WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100)`, [targetId]).catch(() => {});
        return res.status(201).json({ success: true, message: "Regra criada", rule: r.rows[0] });
      }
      case "PUT": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const { id } = req.query; if (!id) return res.status(400).json({ success: false, message: "id obrigatório" });
        const { event, active, message_template, delay_minutes } = req.body || {};
        const fields = [], values = []; let idx = 1;
        if (event            !== undefined) { fields.push(`event = $${idx++}`);            values.push(event); }
        if (active           !== undefined) { fields.push(`active = $${idx++}`);           values.push(active); }
        if (message_template !== undefined) { fields.push(`message_template = $${idx++}`); values.push(message_template); }
        if (delay_minutes    !== undefined) { fields.push(`delay_minutes = $${idx++}`);    values.push(delay_minutes); }
        fields.push("updated_at = NOW()"); values.push(id);
        const ownerFilter = caller.role === "admin" ? "" : ` AND user_id = ${caller.id}`;
        const r = await pool.query(`UPDATE sync_rules SET ${fields.join(", ")} WHERE id = $${idx}${ownerFilter} RETURNING *`, values);
        if (!r.rows[0]) return res.status(404).json({ success: false, message: "Regra não encontrada" });
        return res.status(200).json({ success: true, message: "Regra atualizada", rule: r.rows[0] });
      }
      case "PATCH": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const { id } = req.query; if (!id) return res.status(400).json({ success: false, message: "id obrigatório" });
        const { active } = req.body || {};
        if (active === undefined) return res.status(400).json({ success: false, message: "Informe active" });
        const ownerFilter = caller.role === "admin" ? "" : ` AND user_id = ${caller.id}`;
        const r = await pool.query(`UPDATE sync_rules SET active=$1, updated_at=NOW() WHERE id=$2${ownerFilter} RETURNING *`, [active, id]);
        if (!r.rows[0]) return res.status(404).json({ success: false, message: "Regra não encontrada" });
        return res.status(200).json({ success: true, message: "Regra atualizada", rule: r.rows[0] });
      }
      case "DELETE": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const { id } = req.query; if (!id) return res.status(400).json({ success: false, message: "id obrigatório" });
        const ownerFilter = caller.role === "admin" ? "" : ` AND user_id = ${caller.id}`;
        const r = await pool.query(`DELETE FROM sync_rules WHERE id=$1${ownerFilter} RETURNING id`, [id]);
        if (!r.rows[0]) return res.status(404).json({ success: false, message: "Regra não encontrada" });
        return res.status(200).json({ success: true, message: "Regra removida" });
      }
      default: res.setHeader("Allow", ["GET","POST","PUT","PATCH","DELETE"]); return res.status(405).end();
    }
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
}
