/**
 * ecommerce/olist/index.js
 * Normaliza webhooks da Olist para o formato interno do CodeRise.
 *
 * PRODUTOS: sempre sinaliza needsApiFetch:true para forçar busca atualizada via API.
 * PEDIDOS:  normaliza direto do webhook — payload já é completo.
 */

/**
 * Mapa de eventos da Olist → eventType interno do CodeRise.
 *
 * A Olist envia webhooks com o campo "event" (configurável no painel admin).
 * Eventos comuns: order_paid, order_shipped, order_cancelled,
 *                 product_created, product_updated, product_deleted
 */
const TOPIC_MAP = {
  // Pedidos
  "order_paid":                "order.created",
  "order_created":             "order.created",
  "order_confirmed":           "order.created",
  "order_shipped":             "order.shipped",
  "order_delivered":           "order.shipped",
  "order_cancelled":           "order.cancelled",
  "order_voided":              "order.cancelled",
  "order_refunded":            "order.cancelled",
  // Produtos
  "product_created":           "product.sync",
  "product_updated":           "product.sync",
  "product_deleted":           "product.deleted",
  "product_variant_created":   "product.sync",
  "product_variant_updated":   "product.sync",
  // Categorias (tags)
  "tag_created":               "category.sync",
  "tag_updated":               "category.sync",
  "tag_deleted":               "category.deleted",
};

export function normalizeWebhook(payload) {
  const topic     = payload.event || payload.topic || payload.type || "";
  const eventType = TOPIC_MAP[topic] || topic;

  // ── Categoria deletada ──────────────────────────────────────────────────────
  if (eventType === "category.deleted") {
    const t = payload.tag || payload;
    return { eventType, categoryId: String(t.name || t.id || ""), needsApiFetch: false };
  }

  // ── Categoria criada/atualizada ─────────────────────────────────────────────
  if (eventType === "category.sync") {
    const t = payload.tag || payload;
    return { eventType, categoryId: String(t.name || t.id || ""), needsApiFetch: true };
  }

  // ── Produto deletado ────────────────────────────────────────────────────────
  if (eventType === "product.deleted") {
    const p = payload.product || payload;
    return { eventType, productId: String(p.id || ""), needsApiFetch: false };
  }

  // ── Produto criado/atualizado ───────────────────────────────────────────────
  // SEMPRE busca via API: payload do webhook pode estar desatualizado.
  if (eventType === "product.sync") {
    const p = payload.product || payload;
    return { eventType, productId: String(p.id || payload.id || ""), needsApiFetch: true };
  }

  // ── Pedidos ─────────────────────────────────────────────────────────────────
  const order = payload.order || payload;
  const items = (order.items || order.line_items || []).map(i => ({
    productId: String(i.product_id || i.id || ""),
    sku:       String(i.sku || i.variant_sku || ""),
    name:      i.name || i.product_name || "Produto",
    quantity:  parseInt(i.quantity || 1),
    unitPrice: parseFloat(i.price || i.unit_price || 0),
    discount:  parseFloat(i.discount || 0),
    sellerId:  "all",
  }));

  return {
    eventType,
    needsApiFetch: false,
    orderId:         String(order.code || order.id || ""),
    paymentTracking: order.payment_method || order.payment_type || "",
    logisticStatus:  order.shipping_status || order.status || "shipped",
    totalAmount:     parseFloat(order.total || 0),
    items,
    shipping: {
      provider:   order.shipping_method_name || "Entrega",
      type:       1,
      price:      parseFloat(order.shipping_price || 0),
      estimative: "5 dias úteis",
    },
  };
}

/**
 * Olist não oferece API de registro de webhooks — configuração é feita
 * manualmente no painel admin em Configurações > Integrações > API > Webhooks.
 * Esta função retorna uma mensagem orientando o usuário.
 */
export async function registerWebhooks(_config, webhookUrl) {
  return {
    success: true,
    manual:  true,
    message: "A Olist não suporta registro automático de webhooks via API. Configure manualmente no painel admin da Olist em: Configurações → Integrações → API → Webhooks",
    webhook_url: webhookUrl,
    events: [
      "order_paid", "order_shipped", "order_cancelled",
      "product_created", "product_updated", "product_deleted",
    ],
  };
}
