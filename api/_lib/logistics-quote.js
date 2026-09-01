/**
 * api/_lib/logistics-quote.js
 *
 * Endpoint PÚBLICO que a tela "Integração via API" de Logística da Suri
 * chama — no mesmo formato que ela usa para qualquer endpoint (uma API URL
 * fixa + um Header customizado), em vez de token na query string:
 *
 *   GET  /logistics-quote   Authorization: Bearer <TOKEN>  → valida (200 OK)
 *   POST /logistics-quote   Authorization: Bearer <TOKEN>  → recebe
 *        { Items, Address } e devolve um array de opções de entrega
 *        (ShopLogistic[]), calculado com a transportadora configurada pelo
 *        cliente (hoje: Correios).
 *
 * Aceita também ?token= na query string (fallback, útil pra testar via
 * navegador/curl sem montar header).
 *
 * O token é único por usuário (mesmo mecanismo de webhook_token/chatbot_token
 * já usado no resto do projeto) — a busca abaixo sempre filtra por esse
 * token, então uma requisição só pode resolver a configuração/registros do
 * próprio dono do token, nunca de outro usuário.
 *
 * Toda cotação (sucesso ou erro) é registrada em user_webhooks com
 * source='logistics', na mesma tabela/isolamento por usuário que já vale
 * para e-commerce/chatbot — aparece na tela Logs filtrando por "Logística".
 * Erros também disparam notifyAdminIntegrationError (mesmo mecanismo usado
 * no teste de conexão de e-commerce).
 *
 * Ver documentacao_api_logistica.pdf para o contrato completo.
 */
import pool from "./db.js";
import { getShippingOptions } from "./carriers/correios.js";
import { notifyAdminIntegrationError } from "./error-webhook.js";

function extractToken(req) {
  const authHeader = req.headers?.authorization || "";
  if (authHeader.startsWith("Bearer ")) return authHeader.slice(7).trim();
  return req.query?.token || null;
}

async function logEvent(userId, { status, payload, error_message }) {
  try {
    await pool.query(
      "INSERT INTO user_webhooks (user_id, event_type, payload, status, error_message, source) VALUES ($1, $2, $3, $4, $5, 'logistics')",
      [userId, "logistics.quote", JSON.stringify(payload ?? null), status, error_message || null]
    );
  } catch (err) {
    console.error("[logistics-quote] Falha ao gravar log:", err.message);
  }
}

export async function handleLogisticsQuote(req, res) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: "MissingToken", message: "Token de logística ausente. Envie 'Authorization: Bearer <TOKEN>'." });

  const r = await pool.query(
    "SELECT user_id, logistics_platform, logistics_config, logistics_active FROM user_integrations WHERE logistics_token = $1",
    [token]
  );
  const integration = r.rows[0];
  if (!integration) return res.status(404).json({ error: "InvalidToken", message: "Token de logística inválido." });
  if (!integration.logistics_active) return res.status(403).json({ error: "IntegrationDisabled", message: "Integração de logística desativada." });

  if (req.method === "GET") {
    return res.status(200).json({ status: "ok" });
  }

  if (req.method === "POST") {
    const platform = integration.logistics_platform;
    const config = integration.logistics_config || {};
    const body = req.body || {};
    try {
      if (platform !== "correios") {
        // Provedor ainda não implementado (ex.: Smart Envios) → sem opções,
        // sem quebrar o checkout do cliente.
        return res.status(200).json([]);
      }
      const options = await getShippingOptions(config, body);
      await logEvent(integration.user_id, { status: "processed", payload: { request: body, options } });
      return res.status(200).json(options);
    } catch (err) {
      console.error("[logistics-quote]", err);
      await logEvent(integration.user_id, { status: "error", payload: { request: body }, error_message: err.message });
      const uRow = await pool.query("SELECT name FROM users WHERE id = $1", [integration.user_id]).catch(() => ({ rows: [] }));
      const userName = uRow.rows[0]?.name || `ID ${integration.user_id}`;
      await notifyAdminIntegrationError(
        `Falha na cotação de frete — Correios`,
        `Perfil: ${userName}\nPlataforma: Correios (Logística)\n\nDetalhe: ${err.message}`,
      ).catch(() => {});
      return res.status(400).json({ error: "QuoteFailed", message: err.message });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end();
}
