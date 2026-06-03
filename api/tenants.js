/**
 * api/tenants.js — CRUD de slugs/subdomínios por cliente
 *
 * Rotas:
 *   GET    /tenants              → lista todos (admin) ou o próprio (user)
 *   POST   /tenants              → cria slug para o caller (ou user_id se admin)
 *   DELETE /tenants?slug=xxx     → remove slug
 */

import pool from "./db.js";
import { setCors } from "./_cors.js";
import { requireAuth, requireAdmin } from "./_auth.js";
import { invalidateTenantCache } from "./middleware.js";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

export async function handleTenants(req, res) {
  if (setCors(req, res)) return;

  try {
    switch (req.method) {

      case "GET": {
        const caller = await requireAuth(req, res); if (!caller) return;

        if (caller.role === "admin") {
          const { user_id } = req.query;
          const q = user_id
            ? await pool.query(
                "SELECT ts.*, u.name AS user_name, u.email FROM tenant_slugs ts JOIN users u ON u.id = ts.user_id WHERE ts.user_id = $1 ORDER BY ts.created_at DESC",
                [user_id]
              )
            : await pool.query(
                "SELECT ts.*, u.name AS user_name, u.email FROM tenant_slugs ts JOIN users u ON u.id = ts.user_id ORDER BY ts.created_at DESC"
              );
          return res.status(200).json({ success: true, tenants: q.rows, total: q.rowCount });
        }

        const q = await pool.query(
          "SELECT id, slug, custom_domain, created_at FROM tenant_slugs WHERE user_id = $1 ORDER BY created_at DESC",
          [caller.id]
        );
        return res.status(200).json({ success: true, tenants: q.rows });
      }

      case "POST": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const targetId = (caller.role === "admin" && req.body?.user_id) ? req.body.user_id : caller.id;
        const { slug, custom_domain } = req.body || {};

        if (!slug) return res.status(400).json({ success: false, message: "slug obrigatório" });
        const cleanSlug = String(slug).toLowerCase().trim();
        if (!SLUG_RE.test(cleanSlug))
          return res.status(400).json({ success: false, message: "Slug inválido. Use apenas letras, números e hífens (mínimo 3 caracteres)." });

        // Limite: 3 slugs por usuário (evitar abuso)
        const count = await pool.query("SELECT COUNT(*) FROM tenant_slugs WHERE user_id = $1", [targetId]);
        if (parseInt(count.rows[0].count) >= 3 && caller.role !== "admin")
          return res.status(429).json({ success: false, message: "Limite de 3 subdomínios por conta atingido." });

        const r = await pool.query(
          "INSERT INTO tenant_slugs (user_id, slug, custom_domain) VALUES ($1, $2, $3) RETURNING *",
          [targetId, cleanSlug, custom_domain || null]
        );
        invalidateTenantCache(cleanSlug);
        return res.status(201).json({ success: true, message: "Subdomínio criado", tenant: r.rows[0] });
      }

      case "PUT": {
        // Atualiza custom_domain de um slug existente
        const caller = await requireAuth(req, res); if (!caller) return;
        const { slug, custom_domain } = req.body || {};
        if (!slug) return res.status(400).json({ success: false, message: "slug obrigatório" });

        const ownerFilter = caller.role === "admin" ? "" : " AND user_id = $2";
        const params = caller.role === "admin" ? [custom_domain || null, slug] : [custom_domain || null, slug, caller.id];
        const q = caller.role === "admin"
          ? "UPDATE tenant_slugs SET custom_domain = $1, updated_at = NOW() WHERE slug = $2 RETURNING *"
          : "UPDATE tenant_slugs SET custom_domain = $1, updated_at = NOW() WHERE slug = $2 AND user_id = $3 RETURNING *";
        const r = await pool.query(q, params);
        if (!r.rows[0]) return res.status(404).json({ success: false, message: "Slug não encontrado" });
        invalidateTenantCache(slug);
        return res.status(200).json({ success: true, message: "Domínio atualizado", tenant: r.rows[0] });
      }

      case "DELETE": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const { slug } = req.query;
        if (!slug) return res.status(400).json({ success: false, message: "slug obrigatório" });

        const ownerClause = caller.role === "admin"
          ? "WHERE slug = $1"
          : "WHERE slug = $1 AND user_id = $2";
        const params = caller.role === "admin" ? [slug] : [slug, caller.id];
        const r = await pool.query(`DELETE FROM tenant_slugs ${ownerClause} RETURNING slug`, params);
        if (!r.rows[0]) return res.status(404).json({ success: false, message: "Slug não encontrado" });
        invalidateTenantCache(slug);
        return res.status(200).json({ success: true, message: "Subdomínio removido" });
      }

      default:
        res.setHeader("Allow", ["GET", "POST", "PUT", "DELETE"]);
        return res.status(405).end();
    }
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ success: false, message: "Este subdomínio já está em uso" });
    return res.status(500).json({ success: false, message: err.message });
  }
}
