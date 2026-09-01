/**
 * api/_lib/logistics-quote.js
 *
 * Endpoint PÚBLICO (autenticado via ?token=, igual ao /webhook) que a
 * integração "Integração via API" de Logística da Suri chama:
 *
 *   GET  /logistics-quote?token=xxx  → valida o endpoint (200 OK)
 *   POST /logistics-quote?token=xxx  → recebe { Items, Address } e devolve
 *        um array de opções de entrega (ShopLogistic[]), calculado com a
 *        transportadora configurada pelo cliente (hoje: Correios).
 *
 * Ver documentacao_api_logistica.pdf para o contrato completo.
 */
import pool from "./db.js";
import { getShippingOptions } from "./carriers/correios.js";

export async function handleLogisticsQuote(req, res) {
  const token = req.query?.token;
  if (!token) return res.status(401).json({ error: "MissingToken", message: "Token de logística ausente." });

  const r = await pool.query(
    "SELECT logistics_platform, logistics_config, logistics_active FROM user_integrations WHERE logistics_token = $1",
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
    try {
      if (platform !== "correios") {
        // Provedor ainda não implementado (ex.: Smart Envios) → sem opções,
        // sem quebrar o checkout do cliente.
        return res.status(200).json([]);
      }
      const options = await getShippingOptions(config, req.body || {});
      return res.status(200).json(options);
    } catch (err) {
      console.error("[logistics-quote]", err);
      return res.status(400).json({ error: "QuoteFailed", message: err.message });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end();
}
