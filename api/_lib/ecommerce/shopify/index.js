/**
 * ecommerce/shopify/index.js
 * Normaliza webhooks da Shopify para o formato interno do CodeRise.
 *
 * Shopify envia o topic no header X-Shopify-Topic, não no corpo.
 * O webhook-receiver.js deve repassar esse header como payload.topic
 * (ou o consumidor desta função deve extrair de req.headers).
 */

const TOPIC_MAP = {
  "orders/create":     "order.created",
  "orders/paid":       "order.created",
  "orders/fulfilled":  "order.shipped",
  "orders/cancelled":  "order.cancelled",
  "orders/delete":     "order.cancelled",
  "products/create":   "product.sync",
  "products/update":   "product.sync",
  "products/delete":   "product.deleted",
  "collections/create": "category.sync",
  "collections/update": "category.sync",
  "collections/delete": "category.deleted",
};

export function normalizeWebhook(payload, topicHeader) {
  const topic = topicHeader || payload.topic || "";
  const eventType = TOPIC_MAP[topic] || topic;

  if (eventType === "category.deleted") {
    return { eventType, categoryId: String(payload.id || ""), needsApiFetch: false };
  }
  if (eventType === "category.sync") {
    return { eventType, categoryId: String(payload.id || ""), needsApiFetch: true };
  }
  if (eventType === "product.deleted") {
    return { eventType, productId: String(payload.id || ""), needsApiFetch: false };
  }
  if (eventType === "product.sync") {
    // Shopify já envia o produto completo no corpo do webhook
    return { eventType, productId: String(payload.id || ""), needsApiFetch: false, product: payload };
  }

  // Pedidos — Shopify envia o pedido completo
  const order = payload;
  const items = (order.line_items || []).map(i => ({
    productId: String(i.product_id || ""),
    variantId: String(i.variant_id || ""),
    sku: String(i.sku || ""),
    name: i.name || i.title || "Produto",
    quantity: parseInt(i.quantity || 1),
    unitPrice: parseFloat(i.price || 0),
    discount: parseFloat(i.total_discount || 0),
    sellerId: "all",
  }));

  return {
    eventType,
    needsApiFetch: false,
    orderId: String(order.id || order.order_number || ""),
    paymentTracking: order.gateway || "",
    logisticStatus: order.fulfillment_status || "pending",
    totalAmount: parseFloat(order.total_price || 0),
    items,
    shipping: {
      provider: order.shipping_lines?.[0]?.title || "Entrega",
      type: 1,
      price: parseFloat(order.total_shipping_price_set?.shop_money?.amount || 0),
      estimative: "5 dias úteis",
    },
  };
}

/**
 * Registra os webhooks necessários na Shopify via Admin API.
 */
export async function registerWebhooks(config, webhookUrl) {
  const client = await import("./client.js");
  const { store_url, api_token, api_version } = config;

  const topics = [
    "orders/create", "orders/fulfilled", "orders/cancelled",
    "products/create", "products/update", "products/delete",
  ];

  const existing = await client.listWebhooks(store_url, api_token, api_version).catch(() => []);
  const results = [];

  for (const topic of topics) {
    const already = existing.find(w => w.topic === topic && w.address === webhookUrl);
    if (already) { results.push({ topic, status: "already_registered" }); continue; }
    try {
      await client.createWebhook(store_url, api_token, topic, webhookUrl, api_version);
      results.push({ topic, status: "registered" });
    } catch (err) {
      results.push({ topic, status: "error", detail: err.message });
    }
  }

  return { success: true, details: results };
}
