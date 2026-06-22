/**
 * ecommerce/vtex/orders.js
 * Operações de pedidos na VTEX (OMS) — FLUXO REVERSO (Suri → VTEX)
 */

import * as client from "./client.js";

export function normalizeOrder(payload) {
  const order = payload.order || payload;
  const items = (order.items || []).map(i => ({
    productId: String(i.productId || ""),
    sku: String(i.id || i.sku || ""),
    name: i.name || "Produto",
    quantity: parseInt(i.quantity || 1),
    unitPrice: parseFloat((i.sellingPrice || i.price || 0) / 100),
    discount: 0,
    sellerId: i.seller || "all",
  }));

  return {
    orderId: String(order.orderId || order.id || ""),
    paymentTracking: order.paymentData?.transactions?.[0]?.transactionId || "",
    logisticStatus: order.status || "pending",
    totalAmount: parseFloat((order.value || 0) / 100),
    items,
    shipping: {
      provider: order.shippingData?.logisticsInfo?.[0]?.selectedSla || "Entrega",
      type: 1,
      price: parseFloat((order.shippingData?.logisticsInfo?.[0]?.price || 0) / 100),
      estimative: "5 dias úteis",
    },
  };
}

/**
 * Cancela um pedido na VTEX (cenário order.cancelled da Suri).
 */
export async function cancelOrder(config, payload) {
  const { account_name, app_key, app_token } = config;
  const orderId = payload.orderId || payload.order_id;
  if (!orderId) throw new Error("orderId obrigatório para order.cancelled");

  await client.cancelOrder(account_name, app_key, app_token, orderId);
  return { action: "order_cancelled", vtexOrderId: orderId };
}

/**
 * Fatura/envia o pedido na VTEX (cenário order.shipped da Suri).
 * A VTEX usa o fluxo de invoice para indicar envio.
 */
export async function fulfillOrder(config, payload) {
  const { account_name, app_key, app_token } = config;
  const orderId = payload.orderId || payload.order_id;
  if (!orderId) throw new Error("orderId obrigatório para order.shipped");

  const order = await client.getOrder(account_name, app_key, app_token, orderId);
  const items = (order.items || []).map((i, idx) => ({
    id: i.id,
    price: i.sellingPrice,
    quantity: i.quantity,
  }));

  const invoiceData = {
    type: "Output",
    invoiceNumber: payload.invoice_number || `CR-${Date.now()}`,
    invoiceValue: order.value,
    issuanceDate: new Date().toISOString(),
    items,
  };

  const result = await client.invoiceOrder(account_name, app_key, app_token, orderId, invoiceData);

  if (payload.tracking_number && result?.invoiceNumber) {
    await client.addOrderTracking(account_name, app_key, app_token, orderId, result.invoiceNumber, {
      trackingNumber: payload.tracking_number,
      trackingUrl: payload.tracking_url || "",
      courier: payload.shipping_company || "",
    }).catch(() => {});
  }

  return { action: "order_fulfilled", vtexOrderId: orderId };
}
