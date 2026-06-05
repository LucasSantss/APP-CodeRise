/**
 * api/middleware.js — Middleware de roteamento por subdomínio
 *
 * Resolve o tenant (cliente) a partir de:
 *   1. Subdomínio: cliente1.coderise.app  → slug = "cliente1"
 *   2. Header X-Tenant-Slug (fallback para dev/Vercel Preview)
 *   3. Query param ?tenant=cliente1 (fallback para webhooks externos)
 *
 * Uso:
 *   const tenant = await resolveTenant(req);
 *   if (!tenant) return res.status(404).json({ error: "Tenant não encontrado" });
 */

import pool from "./db.js";

// Cache em memória simples (TTL 60s) para evitar consultas repetidas ao banco
const tenantCache = new Map(); // slug → { tenant, expiresAt }
const CACHE_TTL_MS = 60_000;

function getCached(slug) {
  const entry = tenantCache.get(slug);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { tenantCache.delete(slug); return null; }
  return entry.tenant;
}

function setCache(slug, tenant) {
  tenantCache.set(slug, { tenant, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Extrai o slug do tenant da requisição.
 * Ordem de prioridade: subdomínio > header X-Tenant-Slug > query param tenant
 */
export function extractTenantSlug(req) {
  const host = req.headers.host || "";

  // Detecta subdomínios: cliente1.coderise.app ou cliente1.localhost:3000
  const domainParts = host.split(".");
  const knownApexDomains = ["coderise", "vercel", "localhost"];
  if (domainParts.length >= 2) {
    const apex = domainParts[domainParts.length - (host.includes("localhost") ? 1 : 2)];
    if (knownApexDomains.some(d => apex.startsWith(d))) {
      const sub = domainParts[0];
      // Ignora "www", "api", o próprio apex e previews da Vercel
      if (sub && !["www", "api", "app", "coderise"].includes(sub) && !sub.includes("vercel")) {
        return sub;
      }
    }
  }

  // Fallback: header customizado (útil em Vercel Preview / dev)
  const headerSlug = req.headers["x-tenant-slug"];
  if (headerSlug) return String(headerSlug).toLowerCase().trim();

  // Fallback: query param (útil para webhooks de plataformas externas)
  const qSlug = (req.url || "").match(/[?&]tenant=([^&]+)/)?.[1];
  if (qSlug) return decodeURIComponent(qSlug).toLowerCase().trim();

  return null;
}

/**
 * Resolve o tenant completo (usuário + integração) pelo slug.
 * Retorna null se não encontrado ou inativo.
 */
export async function resolveTenant(req) {
  const slug = extractTenantSlug(req);
  if (!slug) return null;

  const cached = getCached(slug);
  if (cached) return cached;

  try {
    const result = await pool.query(
      `SELECT
         u.id         AS user_id,
         u.name       AS user_name,
         u.email      AS user_email,
         u.role       AS user_role,
         u.active     AS user_active,
         ui.id        AS integration_id,
         ui.webhook_token,
         ui.chatbot_token,
         ui.ecommerce_platform,
         ui.ecommerce_config,
         ui.ecommerce_active,
         ui.suri_endpoint,
         ui.suri_token,
         ui.suri_active,
         ui.chatbot_platform,
         ui.chatbot_config,
         ui.chatbot_active,
         ts.slug,
         ts.custom_domain
       FROM tenant_slugs ts
       JOIN users u ON u.id = ts.user_id
       LEFT JOIN user_integrations ui ON ui.user_id = u.id
       WHERE ts.slug = $1 AND u.active = true`,
      [slug]
    );

    if (!result.rows[0]) {
      setCache(slug, null); // Cacheia miss para evitar flood no banco
      return null;
    }

    const tenant = result.rows[0];
    setCache(slug, tenant);
    return tenant;
  } catch (err) {
    console.error("[middleware] Erro ao resolver tenant:", err.message);
    return null;
  }
}

/**
 * Invalida o cache de um slug (chamar após atualizar configurações do tenant)
 */
export function invalidateTenantCache(slug) {
  if (slug) tenantCache.delete(slug);
}

/**
 * Middleware de CORS dinâmico para subdomínios
 * Libera o domínio apex, todos os subdomínios e os custom_domains configurados
 */
export function setTenantCors(req, res) {
  const origin = req.headers.origin || "";
  const isAllowed =
    !origin ||
    /^https?:\/\/([\w-]+\.)?coderise\.app(:\d+)?$/.test(origin) ||
    /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
    /^https?:\/\/[\w-]+-[\w-]+\.vercel\.app$/.test(origin);

  res.setHeader("Access-Control-Allow-Origin", isAllowed ? origin : "");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-secret, x-tenant-slug");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}
