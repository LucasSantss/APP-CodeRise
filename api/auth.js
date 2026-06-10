import pool from "./db.js";
import crypto from "crypto";

export async function handleAuth(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { action } = req.query;
  try {
    if (action === "login") {
      const { email, password } = req.body || {};
      if (!email || !password) return res.status(400).json({ success: false, message: "email e password obrigatórios" });
      const r = await pool.query("SELECT id, name, email, role, active, password, token FROM users WHERE email = $1", [email]);
      const user = r.rows[0];
      if (!user || user.password !== password) return res.status(401).json({ success: false, message: "Credenciais inválidas" });
      if (!user.active) return res.status(403).json({ success: false, message: "Conta desativada" });
      return res.status(200).json({ success: true, token: user.token, user: { id: user.id, name: user.name, email: user.email, role: user.role, active: user.active } });
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
      const r = await pool.query("UPDATE users SET token = $1, updated_at = NOW() WHERE token = $2 AND active = true RETURNING id, name, email, role", [newToken, token]);
      if (!r.rows[0]) return res.status(401).json({ success: false, message: "Token inválido" });
      return res.status(200).json({ success: true, token: newToken, user: r.rows[0] });
    }
    return res.status(400).json({ success: false, message: "action inválido. Use: login | logout | refresh" });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
}
