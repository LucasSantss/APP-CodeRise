const RESERVED_SUBDOMAINS = new Set(["www", "app", "api", "admin", "localhost"]);

function normalizeHost(host = "") {
  return String(host).split(":")[0].trim().toLowerCase();
}

function getRootDomain() {
  return (process.env.TENANT_ROOT_DOMAIN || process.env.VERCEL_PROJECT_PRODUCTION_URL || "")
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .toLowerCase();
}

export function normalizeTenantSlug(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export function getTenantSlugFromRequest(req) {
  const explicit = normalizeTenantSlug(req.headers["x-coderise-tenant"] || req.query?.tenant || "");
  if (explicit && !RESERVED_SUBDOMAINS.has(explicit)) return explicit;

  const host = normalizeHost(req.headers["x-forwarded-host"] || req.headers.host);
  const root = getRootDomain();
  if (!host || !root || host === root || !host.endsWith(`.${root}`)) return null;

  const slug = normalizeTenantSlug(host.slice(0, -(root.length + 1)));
  return slug && !RESERVED_SUBDOMAINS.has(slug) ? slug : null;
}

export async function resolveTenant(pool, req) {
  const slug = getTenantSlugFromRequest(req);
  const host = normalizeHost(req.headers["x-forwarded-host"] || req.headers.host);
  if (!slug && !host) return null;

  try {
    const r = await pool.query(
      `SELECT id, name, email, role, active, tenant_slug, tenant_domain
       FROM users
       WHERE active = true
         AND (
           ($1::text IS NOT NULL AND tenant_slug = $1)
           OR ($2::text IS NOT NULL AND tenant_domain = $2)
         )
       LIMIT 1`,
      [slug, host || null]
    );
    return r.rows[0] || null;
  } catch (err) {
    if (err.code === "42703") return null;
    throw err;
  }
}

export function assertTenantAccess(caller, tenant, res) {
  if (!tenant) return true;
  if (caller.role === "admin") return true;
  if (String(caller.id) === String(tenant.id)) return true;
  res.status(403).json({ success: false, message: "Este subdominio pertence a outro cliente" });
  return false;
}
