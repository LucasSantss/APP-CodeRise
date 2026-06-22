/**
 * ecommerce/tray/index.js
 * Normaliza notificações da Tray para o formato interno do CodeRise.
 *
 * A Tray envia POST com campos: seller_id, scope_id, scope_name, act, app_code.
 * Combinação scope_name + act define o evento, ex: "order"+"insert" = order_insert.
 */

const EVENT_MAP = {
  "order_insert":          "order.created",
  "order_update":          "order.created",
  "product_insert":        "product.sync",
  "product_update":        "product.sync",
  "product_delete":        "product.deleted",
  "variant_stock_update":  "product.sync",
  "variant_update":        "product.sync",
};

export function normalizeWebhook(payload) {
  const scopeName = payload.scope_name || "";
  const act = payload.act || "";
  const key = `${scopeName}_${act}`;
  const eventType = EVENT_MAP[key] || key;

  if (eventType === "product.deleted") {
    return { eventType, productId: String(payload.scope_id || ""), needsApiFetch: false };
  }
  if (eventType === "product.sync") {
    // Tray notifica apenas o ID — sempre buscar via API
    return { eventType, productId: String(payload.scope_id || ""), needsApiFetch: true };
  }
  if (eventType === "order.created") {
    // Tray notifica apenas o ID do pedido — sempre buscar via API
    return { eventType, orderId: String(payload.scope_id || ""), needsApiFetch: true };
  }

  return { eventType, needsApiFetch: true, rawScopeId: String(payload.scope_id || "") };
}

/**
 * A Tray não permite registro de webhooks por tópico via API pública —
 * a URL de notificação do app é configurada uma única vez, durante o
 * processo de homologação do aplicativo, via chamado de suporte.
 */
export async function registerWebhooks(_config, webhookUrl) {
  return {
    success: true,
    manual: true,
    message: `A Tray não permite registro automático de webhooks via API. Informe esta URL durante a homologação do seu app na Tray, via chamado de suporte: ${webhookUrl}`,
    webhook_url: webhookUrl,
    events: ["order_insert", "product_insert", "product_update", "variant_stock_update"],
  };
}
