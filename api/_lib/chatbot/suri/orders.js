/**
 * chatbot/suri/orders.js
 * Operações de pedidos na Suri.
 */

import * as client from "./client.js";

const STATUS_MAP = {
  "ready-for-handling": 1, "processing": 1, "order_paid": 1,
  "handling": 2, "preparing": 2,
  "invoiced": 3, "shipped": 3, "fulfilled": 3, "order_shipped": 3,
  "delivered": 4, "order_delivered": 4, "completed": 4,
  "canceled": 5, "cancelled": 5, "refunded": 5,
};

function mapLogisticStatus(status) {
  return STATUS_MAP[status] ?? 1;
}

/**
 * Busca um pedido na Suri pelo ID do pedido no ecommerce.
 */
export async function findOrder(endpoint, token, orderId) {
  try {
    const data = await client.searchOrders(endpoint, token, orderId);
    const list = data?.orders || data?.data || data?.items || data || [];
    return Array.isArray(list) ? (list[0] || null) : null;
  } catch {
    return null;
  }
}

/**
 * Cria um pedido na Suri e o marca como pago.
 */
export async function createOrder(endpoint, token, normalized) {
  const existing = await findOrder(endpoint, token, normalized.orderId);
  if (existing) {
    await client.markOrderPaid(endpoint, token, existing.id || existing.orderId, normalized.paymentTracking);
    return { action: "marked_paid", suriOrderId: existing.id };
  }

  const budget = {
    id: String(normalized.orderId),
    logistic: {
      providerId: "001",
      name: normalized.shipping?.provider || "Entrega",
      description: "Padrão",
      type: normalized.shipping?.type || 1,
      price: normalized.shipping?.price || 0,
      minShippingTimeEstimative: normalized.shipping?.estimative || "3 dias úteis",
      shippingTimeEstimative: normalized.shipping?.estimative || "5 dias úteis",
    },
    items: (normalized.items || []).map(i => ({
      fromSellerId: i.sellerId || "all",
      ProductId: String(i.productId || i.id),
      Sku: String(i.sku || i.productId),
      Name: i.name,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      discountAmount: i.discount || 0,
    })),
    errorMessages: [],
  };

  const created = await client.createOrderBudget(endpoint, token, budget);
  const suriOrderId = created?.id || created?.orderId;

  if (suriOrderId) {
    await client.markOrderPaid(endpoint, token, suriOrderId, normalized.paymentTracking);
    // Tenta baixa de estoque (endpoint pode não existir em todas as versões da Suri)
    if (normalized.items?.length) {
      for (const item of normalized.items) {
        try {
          await client.deductStock(endpoint, token, item.productId, item.sku, item.quantity);
        } catch {} // silencioso — Suri pode gerenciar internamente
      }
    }
  }

  return { action: "created_and_paid", suriOrderId };
}

/**
 * Atualiza o status logístico de um pedido na Suri.
 */
export async function shipOrder(endpoint, token, normalized) {
  const order = await findOrder(endpoint, token, normalized.orderId);
  if (!order) throw new Error(`Pedido ${normalized.orderId} não encontrado na Suri`);
  const status = mapLogisticStatus(normalized.logisticStatus);
  await client.updateOrderLogistic(endpoint, token, order.id || order.orderId, status);
  return { action: "logistic_updated", suriOrderId: order.id, status };
}

/**
 * Atualiza status logístico parcial (orders/partially_fulfilled).
 */
export async function partiallyShipOrder(endpoint, token, normalized) {
  const order = await findOrder(endpoint, token, normalized.orderId);
  if (!order) throw new Error(`Pedido ${normalized.orderId} não encontrado na Suri`);
  await client.updateOrderLogistic(endpoint, token, order.id || order.orderId, 3);
  return { action: "logistic_partial_updated", suriOrderId: order.id };
}

/**
 * Cancela um pedido na Suri.
 */
export async function cancelOrder(endpoint, token, normalized) {
  const order = await findOrder(endpoint, token, normalized.orderId);
  if (!order) throw new Error(`Pedido ${normalized.orderId} não encontrado na Suri`);
  await client.cancelOrder(endpoint, token, order.id || order.orderId);
  return { action: "cancelled", suriOrderId: order.id };
}
