import pool from "./db.js";
import crypto from "crypto";
import { verifyPassword } from "./_auth.js";

// ─── Rate limiting em memória (sem Redis) ─────────────────────────────────────
// Map: ip → { count, resetAt }
const loginAttempts = new Map();
const MAX_ATTEMPTS  = 5;
const WINDOW_MS     = 15 * 60 * 1000; // 15 minutos

function getClientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { blocked: false, remaining: MAX_ATTEMPTS - 1 };
  }
  if (entry.count >= MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { blocked: true, retryAfter };
  }
  entry.count++;
  return { blocked: false, remaining: MAX_ATTEMPTS - entry.count };
}

function resetRateLimit(ip) {
  loginAttempts.delete(ip);
}

// Limpeza periódica para não vazar memória
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts.entries()) {
    if (now > entry.resetAt) loginAttempts.delete(ip);
  }
}, 5 * 60 * 1000);

export async function handleAuth(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { action } = req.query;

  try {
    // ── Login ────────────────────────────────────────────────────────────────
    if (action === "login") {
      const ip = getClientIp(req);
      const rate = checkRateLimit(ip);

      if (rate.blocked) {
        return res.status(429).json({
          success: false,
          message: `Muitas tentativas. Tente novamente em ${rate.retryAfter}s.`,
          retry_after: rate.retryAfter,
        });
      }

      const { email, password } = req.body || {};
      if (!email || !password)
        return res.status(400).json({ success: false, message: "email e password obrigatórios" });

      const r = await pool.query(
        "SELECT id, name, email, role, active, password, token FROM users WHERE email = $1",
        [email]
      );
      const user = r.rows[0];

      // Comparação com bcrypt (retrocompatível com texto puro via verifyPassword)
      const valid = user && await verifyPassword(password, user.password);
      if (!valid) {
        return res.status(401).json({
          success: false,
          message: "Credenciais inválidas",
          attempts_remaining: rate.remaining - 1,
        });
      }

      if (!user.active)
        return res.status(403).json({ success: false, message: "Conta desativada" });

      // Login bem-sucedido: zera rate limit
      resetRateLimit(ip);

      // Renova a expiração do token (sliding window 30 dias)
      await pool.query(
        "UPDATE users SET token_expires_at = NOW() + INTERVAL '30 days' WHERE id = $1",
        [user.id]
      );

      return res.status(200).json({
        success: true,
        token: user.token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role, active: user.active },
      });
    }

    // ── Logout ───────────────────────────────────────────────────────────────
    if (action === "logout") {
      const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
      if (!token)
        return res.status(400).json({ success: false, message: "Token não informado" });
      const newToken = crypto.randomBytes(32).toString("hex");
      await pool.query(
        "UPDATE users SET token = $1, updated_at = NOW() WHERE token = $2",
        [newToken, token]
      );
      return res.status(200).json({ success: true, message: "Logout realizado" });
    }

    // ── Refresh ──────────────────────────────────────────────────────────────
    if (action === "refresh") {
      const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
      const newToken = crypto.randomBytes(32).toString("hex");
      const r = await pool.query(
        `UPDATE users
         SET token = $1, updated_at = NOW(),
             token_expires_at = NOW() + INTERVAL '30 days'
         WHERE token = $2 AND active = true
           AND (token_expires_at IS NULL OR token_expires_at > NOW())
         RETURNING id, name, email, role`,
        [newToken, token]
      );
      if (!r.rows[0])
        return res.status(401).json({ success: false, message: "Token inválido" });
      return res.status(200).json({ success: true, token: newToken, user: r.rows[0] });
    }

    return res.status(400).json({
      success: false,
      message: "action inválido. Use: login | logout | refresh",
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}
