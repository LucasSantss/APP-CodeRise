/**
 * api/_lib/test-logistics.js
 * Testa a conexão com a transportadora de logística configurada pelo usuário
 * (hoje: Correios — gera o token via usuário/senha/cartão de postagem).
 */
import pool from "./db.js";
import { setCors } from "../_cors.js";
import { requireAuth } from "../_auth.js";
import { getCorreiosToken } from "./carriers/correios.js";
import { notifyAdminIntegrationError } from "./error-webhook.js";

export default async function handler(req, res) {
  if (setCors(req, res)) return;
  if (req.method !== "POST") { res.setHeader("Allow", ["POST"]); return res.status(405).end(); }

  const caller = await requireAuth(req, res);
  if (!caller) return;

  const { platform, config } = req.body || {};
  if (!platform || !config) return res.status(400).json({ success: false, message: "platform e config são obrigatórios." });

  if (platform !== "correios") {
    return res.status(200).json({ success: false, message: `Teste automático não disponível para "${platform}".` });
  }

  const notifyAdminError = async (errorMsg) => {
    try {
      const errorTime = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const uRow = await pool.query("SELECT name FROM users WHERE id = $1", [caller.id]);
      const userName = uRow.rows[0]?.name || `ID ${caller.id}`;
      await notifyAdminIntegrationError(
        `Falha no teste de conexão — Correios`,
        `Perfil: ${userName}\nPlataforma: Correios (Logística)\nHorário: ${errorTime}\n\nDetalhe: ${errorMsg}`,
      );
    } catch { /* silencioso */ }
  };

  try {
    const { expiraEm } = await getCorreiosToken(config, { force: true });
    const ambienteLabel = config.ambiente === "producao" ? "Produção" : "Homologação";
    return res.status(200).json({
      success: true,
      message: `Conexão com os Correios (${ambienteLabel}) realizada com sucesso!`,
      expiraEm,
    });
  } catch (err) {
    const msg = err.name === "TimeoutError" ? "Timeout: os Correios não responderam em 10 segundos." : err.message;
    await notifyAdminError(msg);
    return res.status(200).json({ success: false, message: msg });
  }
}
