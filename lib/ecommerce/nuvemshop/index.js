/**
 * ecommerce/nuvemshop/index.js
 * Ponto de entrada do módulo Nuvemshop.
 * Exporta todas as operações e normaliza o payload do webhook.
 */

export * from "./client.js";
export * from "./products.js";
export * from "./categories.js";
export * from "./orders.js";

import * as client from "./client.js";

/**
 * Normaliza qualquer payload de webhook da Nuvemshop para o formato interno.
 * Para produtos: retorna { eventType, productId } para busca via API.
 * Para pedidos: retorna dados do pedido já normalizados do webhook.
 */
export function normalizeWebhook(payload) {
  const topic = payload.topic || payload.event || "";

  const topicMap = {
    "orders/created": "order.created",
    "orders/paid": "order.created",
    "orders/fulfilled": "order.shipped",
    "orders/cancelled": "order.cancelled",
    "orders/partially_fulfilled": "order.partially_shipped",
    "products/created": "product.sync",
    "products/updated": "product.sync",
    "products/deleted": "product.deleted",
  };

  const eventType = topicMap[topic] || topic;

  // Produto deletado — só precisa do ID
  if (eventType === "product.deleted") {
    const p = payload.product || payload;
    return { eventType, productId: String(p.id), needsApiFetch: false };
  }

  // Produto criado/atualizado — retorna ID para busca via API
  if (eventType === "product.sync") {
    const p = payload.product || payload;
    return {
      eventType,
      productId: String(p.id),
      needsApiFetch: true, // sinaliza que deve buscar dados completos via API
    };
  }

  // Pedidos — normaliza direto do webhook (payload já é completo)
  const order = payload.order || payload;
  return {
    eventType,
    orderId: String(order.id || order.number || ""),
    paymentTracking: order.payment_details?.method || "",
    logisticStatus: order.shipping_status || order.status || "shipped",
    totalAmount: parseFloat(order.total || 0),
    items: (order.products || []).map(i => ({
      productId: String(i.product_id || i.id),
      sku: String(i.sku || i.variant_id),
      name: i.name,
      quantity: i.quantity,
      unitPrice: parseFloat(i.price || 0),
      discount: parseFloat(i.discount || 0),
      sellerId: "all",
    })),
    shipping: {
      provider: order.shipping_pickup_type || "Entrega",
      type: 1,
      price: parseFloat(order.shipping_cost_owner || 0),
      estimative: "5 dias úteis",
    },
    needsApiFetch: false,
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
