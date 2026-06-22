/**
 * ecommerce/woocommerce/index.js
 * Normaliza webhooks do WooCommerce para o formato interno do CodeRise.
 *
 * O WooCommerce envia o tópico no header X-WC-Webhook-Topic
 * (formato "resource.event", ex: "order.created").
 */

const TOPIC_MAP = {
  "order.created":    "order.created",
  "order.updated":    "order.created",
  "order.deleted":    "order.cancelled",
  "product.created":  "product.sync",
  "product.updated":  "product.sync",
  "product.deleted":  "product.deleted",
};

export function normalizeWebhook(payload, topicHeader) {
  const topic = topicHeader || payload.topic || "";
  let eventType = TOPIC_MAP[topic] || topic;

  // order.updated pode ser cancelamento ou conclusão — verificar status
  if (topic === "order.updated" && payload.status === "cancelled") {
    eventType = "order.cancelled";
  } else if (topic === "order.updated" && payload.status === "completed") {
    eventType = "order.shipped";
  }

  if (eventType === "product.deleted") {
    return { eventType, productId: String(payload.id || ""), needsApiFetch: false };
  }
  if (eventType === "product.sync") {
    return { eventType, productId: String(payload.id || ""), needsApiFetch: false, product: payload };
  }

  const order = payload;
  const items = (order.line_items || []).map(i => ({
    productId: String(i.product_id || ""),
    variantId: i.variation_id ? String(i.variation_id) : null,
    sku: String(i.sku || ""),
    name: i.name || "Produto",
    quantity: parseInt(i.quantity || 1),
    unitPrice: parseFloat(i.price || 0),
    discount: parseFloat(i.total_tax || 0),
    sellerId: "all",
  }));

  return {
    eventType,
    needsApiFetch: false,
    orderId: String(order.id || order.number || ""),
    paymentTracking: order.payment_method || "",
    logisticStatus: order.status || "pending",
    totalAmount: parseFloat(order.total || 0),
    items,
    shipping: {
      provider: order.shipping_lines?.[0]?.method_title || "Entrega",
      type: 1,
      price: parseFloat(order.shipping_total || 0),
      estimative: "5 dias úteis",
    },
  };
}

/**
 * Registra os webhooks necessários no WooCommerce via REST API.
 */
export async function registerWebhooks(config, webhookUrl) {
  const client = await import("./client.js");
  const { site_url, consumer_key, consumer_secret } = config;

  const topics = ["order.created", "order.updated", "product.created", "product.updated", "product.deleted"];
  const existing = await client.listWebhooks(site_url, consumer_key, consumer_secret, { per_page: 100 }).catch(() => []);
  const results = [];

  for (const topic of topics) {
    const already = existing.find(w => w.topic === topic && w.delivery_url === webhookUrl);
    if (already) { results.push({ topic, status: "already_registered" }); continue; }
    try {
      await client.createWebhook(site_url, consumer_key, consumer_secret, topic, webhookUrl);
      results.push({ topic, status: "registered" });
    } catch (err) {
      results.push({ topic, status: "error", detail: err.message });
    }
  }

  return { success: true, details: results };
}
