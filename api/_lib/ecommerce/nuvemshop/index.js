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
import { normalizeCategory } from "./categories.js";

export function normalizeWebhook(payload) {
  const topic = payload.topic || payload.event || "";

  const topicMap = {
    // Formato plural (usado em testes e webhooks registrados via API)
    "orders/created": "order.created",
    "orders/paid": "order.created",
    "orders/fulfilled": "order.shipped",
    "orders/cancelled": "order.cancelled",
    "orders/partially_fulfilled": "order.partially_shipped",
    "products/created": "product.sync",
    "products/updated": "product.sync",
    "products/deleted": "product.deleted",
    "categories/created": "category.sync",
    "categories/updated": "category.sync",
    "categories/deleted": "category.deleted",
    // Formato singular (usado nos webhooks reais disparados pela Nuvemshop)
    "order/created": "order.created",
    "order/paid": "order.created",
    "order/fulfilled": "order.shipped",
    "order/cancelled": "order.cancelled",
    "order/partially_fulfilled": "order.partially_shipped",
    "product/created": "product.sync",
    "product/updated": "product.sync",
    "product/deleted": "product.deleted",
    "category/created": "category.sync",
    "category/updated": "category.sync",
    "category/deleted": "category.deleted",
  };

  const eventType = topicMap[topic] || topic;

  // ── Categoria criada/atualizada ───────────────────────────────────────────
  if (eventType === "category.sync") {
    const c = payload.category || payload;
    const categoryId = String(c.id || "");
    // Usa normalizeCategory para tratar corretamente todos os formatos reais da Nuvemshop:
    // name multilíngue { pt, es, en }, parent como 0/número/objeto, etc.
    const normalized = normalizeCategory(c);
    // Se o nome ficou vazio, o payload só tem o ID — força busca via API
    if (!normalized.name) {
      return { eventType, categoryId, needsApiFetch: true };
    }
    return { eventType, needsApiFetch: false, category: normalized };
  }

  // ── Categoria deletada ────────────────────────────────────────────────────
  if (eventType === "category.deleted") {
    const c = payload.category || payload;
    return { eventType, categoryId: String(c.id), needsApiFetch: false };
  }

  // ── Produto deletado ──────────────────────────────────────────────────────
  if (eventType === "product.deleted") {
    const p = payload.product || payload;
    return { eventType, productId: String(p.id), needsApiFetch: false };
  }

  // ── Produto criado/atualizado ─────────────────────────────────────────────
  if (eventType === "product.sync") {
    // SEMPRE busca via API para garantir estoque atualizado.
    // O payload do webhook pode ter stock desatualizado (cache interno da Nuvemshop).
    // fetchAndNormalizeProduct busca GET /products/{id} + GET /products/{id}/variants
    // em paralelo, garantindo os dados mais recentes de todas as variantes.
    const p = payload.product || payload;
    return { eventType, productId: String(p.id || payload.id), needsApiFetch: true };
  }

  // ── Pedidos ───────────────────────────────────────────────────────────────
  const order = payload.order || payload;
  return {
    eventType,
    needsApiFetch: false,
    orderId: String(order.id || order.number || ""),
    paymentTracking: order.payment_details?.method || "",
    logisticStatus: order.shipping_status || order.status || "shipped",
    totalAmount: parseFloat(order.total || 0),
    items: (order.products || []).map(i => ({
      productId: String(i.product_id || i.id),
      sku: String(i.sku || i.variant_id || ""),
      name: i.name || "Produto",
      quantity: parseInt(i.quantity || 1),
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
    "category/created", "category/updated", "category/deleted",
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