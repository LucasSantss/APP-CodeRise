/**
 * _cors.js — CORS dinâmico com suporte a subdomínios
 */
export function setCors(req, res) {
  const origin = req.headers.origin || "";

  // Libera: domínio apex, qualquer subdomínio *.coderise.app, previews Vercel e localhost
  const isAllowed =
    !origin ||
    /^https?:\/\/([\w-]+\.)?coderise\.app(:\d+)?$/.test(origin) ||
    /^https?:\/\/[\w-]+-[\w-]+\.vercel\.app$/.test(origin) ||
    /^https?:\/\/localhost(:\d+)?$/.test(origin);

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
