import pool, { checkDb } from "./db.js";
import { setCors } from "./_cors.js";
import { requireAuth, requireAdmin } from "./_auth.js";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { normalizeTenantSlug } from "./_tenant.js";

const SALT_ROUNDS = 10;
const PUBLIC_COLUMNS = "id, name, email, role, active, tenant_slug, tenant_domain, created_at, updated_at";

export default async function handler(req, res) {
  if (setCors(req, res)) return;
  try {
    await checkDb();
  } catch (dbErr) {
    return res.status(500).json({ success: false, message: dbErr.message });
  }

  try {
    switch (req.method) {
      case "GET": {
        const caller = await requireAuth(req, res);
        if (!caller) return;
        const { id } = req.query;

        if (caller.role === "admin") {
          if (id) {
            const r = await pool.query(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`, [id]);
            if (!r.rows[0]) return res.status(404).json({ success: false, message: "Usuario nao encontrado" });
            return res.status(200).json({ success: true, user: r.rows[0] });
          }
          const r = await pool.query(`SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY created_at DESC`);
          return res.status(200).json({ success: true, users: r.rows, total: r.rowCount });
        }

        const r = await pool.query(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`, [caller.id]);
        return res.status(200).json({ success: true, user: r.rows[0] });
      }

      case "POST": {
        const caller = await requireAdmin(req, res);
        if (!caller) return;
        const { name, email, password, role = "user", tenant_slug, tenant_domain } = req.body || {};
        if (!name || !email || !password) {
          return res.status(400).json({ success: false, message: "name, email e password obrigatorios" });
        }

        const token = crypto.randomBytes(32).toString("hex");
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        const slug = normalizeTenantSlug(tenant_slug || (role === "user" ? name : ""));
        const r = await pool.query(
          `INSERT INTO users (name, email, password, role, token, tenant_slug, tenant_domain)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, name, email, role, active, token, tenant_slug, tenant_domain, created_at`,
          [name, email, hashedPassword, role, token, slug || null, tenant_domain || null]
        );

        const webhookToken = crypto.randomBytes(32).toString("hex");
        await pool.query(
          "INSERT INTO user_integrations (user_id, webhook_token) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING",
          [r.rows[0].id, webhookToken]
        );
        return res.status(201).json({ success: true, message: "Usuario criado", user: r.rows[0] });
      }

      case "PUT": {
        const caller = await requireAuth(req, res);
        if (!caller) return;
        const { id } = req.query;
        if (!id) return res.status(400).json({ success: false, message: "id obrigatorio" });
        if (caller.role !== "admin" && String(caller.id) !== String(id)) {
          return res.status(403).json({ success: false, message: "Sem permissao" });
        }

        const { name, email, password, tenant_slug, tenant_domain } = req.body || {};
        const fields = [];
        const values = [];
        let idx = 1;

        if (name) {
          fields.push(`name = $${idx++}`);
          values.push(name);
        }
        if (email) {
          fields.push(`email = $${idx++}`);
          values.push(email);
        }
        if (password) {
          fields.push(`password = $${idx++}`);
          values.push(await bcrypt.hash(password, SALT_ROUNDS));
        }
        if (caller.role === "admin" && tenant_slug !== undefined) {
          fields.push(`tenant_slug = $${idx++}`);
          values.push(normalizeTenantSlug(tenant_slug) || null);
        }
        if (caller.role === "admin" && tenant_domain !== undefined) {
          fields.push(`tenant_domain = $${idx++}`);
          values.push(tenant_domain || null);
        }

        if (!fields.length) return res.status(400).json({ success: false, message: "Nenhum campo informado" });
        fields.push("updated_at = NOW()");
        values.push(id);

        const r = await pool.query(
          `UPDATE users SET ${fields.join(", ")} WHERE id = $${idx} RETURNING ${PUBLIC_COLUMNS}`,
          values
        );
        if (!r.rows[0]) return res.status(404).json({ success: false, message: "Usuario nao encontrado" });
        if (active === false) {
          try {
            const u = r.rows[0];
            await pool.query(
              `INSERT INTO notifications (type, title, message, target_role, target_user_id)
               VALUES ('status_change', 'Conta desativada', $1, 'user', $2)`,
              ["Sua conta foi desativada pelo administrador. Entre em contato com o suporte para mais informacoes.", u.id]
            );
            await pool.query(
              `INSERT INTO notifications (type, title, message, target_role)
               VALUES ('integration_error', 'Usuario desativado', $1, 'admin')`,
              [`O usuario ${u.name} (${u.email}) foi desativado.`]
            );
          } catch {}
        }
        return res.status(200).json({ success: true, message: "Usuario atualizado", user: r.rows[0] });
      }

      case "PATCH": {
        const caller = await requireAdmin(req, res);
        if (!caller) return;
        const { id } = req.query;
        if (!id) return res.status(400).json({ success: false, message: "id obrigatorio" });
        const { active, role } = req.body || {};
        const fields = [];
        const values = [];
        let idx = 1;

        if (active !== undefined) {
          fields.push(`active = $${idx++}`);
          values.push(active);
        }
        if (role) {
          fields.push(`role = $${idx++}`);
          values.push(role);
        }
        if (!fields.length) return res.status(400).json({ success: false, message: "Informe active e/ou role" });
        fields.push("updated_at = NOW()");
        values.push(id);

        const r = await pool.query(
          `UPDATE users SET ${fields.join(", ")} WHERE id = $${idx} RETURNING ${PUBLIC_COLUMNS}`,
          values
        );
        if (!r.rows[0]) return res.status(404).json({ success: false, message: "Usuario nao encontrado" });
        return res.status(200).json({ success: true, message: "Usuario atualizado", user: r.rows[0] });
      }

      case "DELETE": {
        const caller = await requireAdmin(req, res);
        if (!caller) return;
        const { id } = req.query;
        if (!id) return res.status(400).json({ success: false, message: "id obrigatorio" });
        const r = await pool.query("DELETE FROM users WHERE id = $1 RETURNING id, name, email", [id]);
        if (!r.rows[0]) return res.status(404).json({ success: false, message: "Usuario nao encontrado" });
        return res.status(200).json({ success: true, message: "Usuario excluido", user: r.rows[0] });
      }

      default:
        res.setHeader("Allow", ["GET", "POST", "PUT", "PATCH", "DELETE"]);
        return res.status(405).end();
    }
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ success: false, message: "E-mail, slug ou dominio ja cadastrado" });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
}
