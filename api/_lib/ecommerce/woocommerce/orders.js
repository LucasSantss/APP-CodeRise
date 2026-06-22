/**
 * ecommerce/woocommerce/orders.js
 * Operações de pedidos no WooCommerce — FLUXO REVERSO (Suri → WooCommerce)
 */

import * as client from "./client.js";

export function normalizeOrder(payload) {
  const order = payload.order || payload;
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
 * Cancela um pedido no WooCommerce (cenário order.cancelled da Suri).
 */
export async function cancelOrder(config, payload) {
  const { site_url, consumer_key, consumer_secret } = config;
  const orderId = payload.orderId || payload.order_id;
  if (!orderId) throw new Error("orderId obrigatório para order.cancelled");

  await client.updateOrder(site_url, consumer_key, consumer_secret, orderId, { status: "cancelled" });
  return { action: "order_cancelled", wooOrderId: orderId };
}

/**
 * Marca o pedido como concluído/enviado no WooCommerce (cenário order.shipped da Suri).
 */
export async function fulfillOrder(config, payload) {
  const { site_url, consumer_key, consumer_secret } = config;
  const orderId = payload.orderId || payload.order_id;
  if (!orderId) throw new Error("orderId obrigatório para order.shipped");

  const meta_data = [];
  if (payload.tracking_number) meta_data.push({ key: "_tracking_number", value: payload.tracking_number });
  if (payload.tracking_url) meta_data.push({ key: "_tracking_url", value: payload.tracking_url });

  await client.updateOrder(site_url, consumer_key, consumer_secret, orderId, {
    status: "completed",
    ...(meta_data.length ? { meta_data } : {}),
  });
  return { action: "order_fulfilled", wooOrderId: orderId };
}
