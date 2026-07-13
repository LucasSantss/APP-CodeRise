import pool from "./db.js";
import crypto from "crypto";
import { verifyPassword } from "./_auth.js";

// Rate limiting em memória: máx 5 tentativas por e-mail em 15 min
const _attempts = new Map();
const RATE_MAX = 5;
const RATE_WINDOW = 15 * 60 * 1000;
function _checkRate(email) {
  const now = Date.now();
  const e = _attempts.get(email);
  if (!e || now > e.reset) { _attempts.set(email, { count: 1, reset: now + RATE_WINDOW }); return false; }
  if (e.count >= RATE_MAX) return true;
  e.count++;
  return false;
}
function _clearRate(email) { _attempts.delete(email); }

export async function handleAuth(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { action } = req.query;
  try {
    if (action === "login") {
      const { email, password } = req.body || {};
      if (!email || !password) return res.status(400).json({ success: false, message: "email e password obrigatórios" });
      if (_checkRate(email)) return res.status(429).json({ success: false, message: "Muitas tentativas. Aguarde 15 minutos antes de tentar novamente." });
      const r = await pool.query("SELECT id, name, email, role, active, password, token FROM users WHERE email = $1 AND active = true", [email]);
      const user = r.rows[0];
      if (!user || !(await verifyPassword(password, user.password))) return res.status(401).json({ success: false, message: "Credenciais inválidas" });
      _clearRate(email);
      // Renova token e define expiração de 30 dias
      const newToken = crypto.randomBytes(32).toString("hex");
      const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await pool.query("UPDATE users SET token = $1, token_expires_at = $2, updated_at = NOW() WHERE id = $3", [newToken, expires, user.id]).catch(() => {});
      return res.status(200).json({ success: true, token: newToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, active: user.active } });
    }
    if (action === "logout") {
      const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
      if (!token) return res.status(400).json({ success: false, message: "Token não informado" });
      const newToken = crypto.randomBytes(32).toString("hex");
      await pool.query("UPDATE users SET token = $1, updated_at = NOW() WHERE token = $2", [newToken, token]);
      return res.status(200).json({ success: true, message: "Logout realizado" });
    }
    if (action === "refresh") {
      const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
      const newToken = crypto.randomBytes(32).toString("hex");
      const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const r = await pool.query(
        "UPDATE users SET token = $1, token_expires_at = $2, updated_at = NOW() WHERE token = $3 AND active = true AND (token_expires_at IS NULL OR token_expires_at > NOW()) RETURNING id, name, email, role",
        [newToken, expires, token]
      );
      if (!r.rows[0]) return res.status(401).json({ success: false, message: "Token inválido ou expirado" });
      return res.status(200).json({ success: true, token: newToken, user: r.rows[0] });
    }
    return res.status(400).json({ success: false, message: "action inválido. Use: login | logout | refresh" });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
}
