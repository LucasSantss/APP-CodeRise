/**
 * ecommerce/shopify/orders.js
 * Operações de pedidos na Shopify — FLUXO REVERSO (Suri → Shopify)
 */

import * as client from "./client.js";

export function normalizeOrder(payload) {
  const order = payload.order || payload;
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
 * Cancela um pedido na Shopify (cenário order.cancelled da Suri).
 */
export async function cancelOrder(config, payload) {
  const { store_url, api_token, api_version } = config;
  const orderId = payload.orderId || payload.order_id;
  if (!orderId) throw new Error("orderId obrigatório para order.cancelled");

  await client.cancelOrder(store_url, api_token, orderId, api_version);
  return { action: "order_cancelled", shopifyOrderId: orderId };
}

/**
 * Marca o pedido como enviado na Shopify (cenário order.shipped da Suri).
 */
export async function fulfillOrder(config, payload) {
  const { store_url, api_token, api_version } = config;
  const orderId = payload.orderId || payload.order_id;
  if (!orderId) throw new Error("orderId obrigatório para order.shipped");

  const fulfillmentOrders = await client.listFulfillmentOrders(store_url, api_token, orderId, api_version);
  const fo = fulfillmentOrders.find(f => f.status === "open" || f.status === "in_progress");
  if (!fo) throw new Error(`Pedido ${orderId} sem fulfillment order pendente na Shopify`);

  const trackingInfo = payload.tracking_number
    ? { number: payload.tracking_number, url: payload.tracking_url || undefined, company: payload.shipping_company || undefined }
    : undefined;

  await client.createFulfillment(store_url, api_token, fo.id, trackingInfo, api_version);
  return { action: "order_fulfilled", shopifyOrderId: orderId, fulfillmentOrderId: fo.id };
}
