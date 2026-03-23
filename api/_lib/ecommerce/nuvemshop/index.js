/**
 * ecommerce/nuvemshop/index.js
 * Normaliza webhooks da Nuvemshop para o formato interno do CodeRise.
 *
 * PRODUTOS: retorna dados completos se vierem no webhook (needsApiFetch: false)
 *           ou sinaliza busca via API (needsApiFetch: true) se só o ID veio
 *
 * PEDIDOS: normaliza direto do webhook — payload já é completo
 */

import * as client from "./client.js";

export function normalizeWebhook(payload) {
  const topic = payload.topic || payload.event || "";

  const topicMap = {
    "orders/created":             "order.created",
    "orders/paid":                "order.created",
    "orders/fulfilled":           "order.shipped",
    "orders/cancelled":           "order.cancelled",
    "orders/partially_fulfilled": "order.partially_shipped",
    "products/created":           "product.sync",
    "products/updated":           "product.sync",
    "products/deleted":           "product.deleted",
  };

  const eventType = topicMap[topic] || topic;

  // ── Produto deletado ──────────────────────────────────────────────────────
  if (eventType === "product.deleted") {
    const p = payload.product || payload;
    return { eventType, productId: String(p.id), needsApiFetch: false };
  }

  // ── Produto criado/atualizado ─────────────────────────────────────────────
  if (eventType === "product.sync") {
    const p = payload.product || payload;
    const hasFullData = p.variants && p.variants.length > 0 && p.name;
    if (hasFullData) {
      const variants = (p.variants || []).map(v => ({
        sku: String(v.sku || p.id),
        price: parseFloat(v.price || 0),
        promotionalPrice: parseFloat(v.promotional_price || 0),
        weightInGrams: parseFloat(v.weight || 0) * 1000,
        dimensions: {
          heightInCm: parseFloat(v.height || 0),
          widthInCm:  parseFloat(v.width  || 0),
          lengthInCm: parseFloat(v.depth  || 0),
        },
        stock: parseInt(v.stock || 0),
        attributes: Object.entries(v.values || {}).map(([name, value]) => ({
          name, value: String(value),
        })),
        imageUrl: v.image?.src || null,
      }));
      const v0 = variants[0] || {};
      return {
        eventType,
        needsApiFetch: false,
        product: {
          id:               String(p.id),
          sku:              String(p.variants?.[0]?.sku || p.id),
          name:             p.name?.pt || p.name?.es || Object.values(p.name || {})[0] || "",
          description:      (p.description?.pt || p.description?.es || "").replace(/<[^>]+>/g, ""),
          categoryId:       String(p.categories?.[0]?.id || ""),
          brand:            p.brand || null,
          isActive:         !!p.published_at,
          price:            v0.price || 0,
          promotionalPrice: v0.promotionalPrice || 0,
          url:              p.canonical_url || null,
          images:           (p.images || []).map(i => ({ url: i.src, description: i.alt || null })),
          weightInGrams:    v0.weightInGrams || 0,
          dimensions:       v0.dimensions || { heightInCm: 0, widthInCm: 0, lengthInCm: 0 },
          stock:            v0.stock || 0,
          variants,
        },
      };
    }
    // Sem dados completos — busca via API
    return { eventType, productId: String(p.id), needsApiFetch: true };
  }

  // ── Pedidos ───────────────────────────────────────────────────────────────
  const order = payload.order || payload;
  return {
    eventType,
    needsApiFetch: false,
    orderId:         String(order.id || order.number || ""),
    paymentTracking: order.payment_details?.method || "",
    logisticStatus:  order.shipping_status || order.status || "shipped",
    totalAmount:     parseFloat(order.total || 0),
    items: (order.products || []).map(i => ({
      productId:  String(i.product_id || i.id),
      sku:        String(i.sku || i.variant_id || ""),
      name:       i.name || "Produto",
      quantity:   parseInt(i.quantity || 1),
      unitPrice:  parseFloat(i.price || 0),
      discount:   parseFloat(i.discount || 0),
      sellerId:   "all",
    })),
    shipping: {
      provider:  order.shipping_pickup_type || "Entrega",
      type:      1,
      price:     parseFloat(order.shipping_cost_owner || 0),
      estimative: "5 dias úteis",
    },
  };
}

/**
 * Registra todos os webhooks necessários na Nuvemshop.
 */
export async function registerWebhooks(config, webhookUrl) {
  const { store_id, access_token } = config;
  const events = [
    "order/created", "order/paid", "order/fulfilled",
    "order/cancelled", "order/partially_fulfilled",
    "product/created", "product/updated", "product/deleted",
  ];
  const results = [];
  for (const event of events) {
    try {
      const data = await client.registerWebhook(store_id, access_token, event, webhookUrl);
      results.push({ event, status: "created", id: data.id });
    } catch (err) {
      results.push({ event, status: "error", detail: err.message });
    }
  }
  return {
    success: true,
    message: `${results.filter(r => r.status === "created").length}/${events.length} webhooks registrados na Nuvemshop`,
    details: results,
  };
}
