import pool from "./db.js";
import bcrypt from "bcryptjs";
import { assertTenantAccess, resolveTenant } from "./_tenant.js";

export async function verifyPassword(plain, hash) {
  if (!hash || !hash.startsWith("$2")) return plain === hash;
  return bcrypt.compare(plain, hash);
}

export async function getUserByToken(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.replace("Bearer ", "").trim();
  const result = await pool.query(
    "SELECT id, name, email, role, active FROM users WHERE token = $1",
    [token]
  );
  return result.rows[0] || null;
}

export async function getUserByTokenString(token) {
  if (!token) return null;
  const result = await pool.query(
    "SELECT id, name, email, role, active FROM users WHERE token = $1 AND active = true",
    [token]
  );
  return result.rows[0] || null;
}

export function isAdminSecret(req) {
  return (req.headers["x-admin-secret"] || "") === process.env.ADMIN_SECRET;
}

export async function requireAdmin(req, res) {
  if (isAdminSecret(req)) return { id: "system", role: "admin" };
  const user = await getUserByToken(req);
  if (!user) {
    res.status(401).json({ success: false, message: "Nao autorizado" });
    return null;
  }
  if (user.role !== "admin") {
    res.status(403).json({ success: false, message: "Acesso restrito a administradores" });
    return null;
  }
  if (!user.active) {
    res.status(403).json({ success: false, message: "Conta desativada" });
    return null;
  }
  return user;
}

export async function requireAuth(req, res) {
  const user = await getUserByToken(req);
  if (!user) {
    res.status(401).json({ success: false, message: "Nao autorizado" });
    return null;
  }
  if (!user.active) {
    res.status(403).json({ success: false, message: "Conta desativada" });
    return null;
  }
  const tenant = await resolveTenant(pool, req);
  if (!assertTenantAccess(user, tenant, res)) return null;
  if (tenant) user.tenant = tenant;
  return user;
}
