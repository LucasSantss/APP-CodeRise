/**
 * chatbot/suri/orders.js
 * Operações de pedidos na Suri — FLUXO DIRETO (Nuvemshop → Suri)
 *
 * Cenário 5  — orders/created  → createOrder (cria orçamento + paga)
 * Cenário 6  — orders/paid     → createOrder (mesmo fluxo)
 * Cenário 7  — orders/fulfilled         → shipOrder (logística 3)
 * Cenário 8  — orders/partially_fulfilled → partiallyShipOrder (logística 3)
 * Cenário 9  — orders/cancelled         → cancelOrder
 */

import * as client from "./client.js";

const STATUS_MAP = {
  "ready-for-handling": 1, "processing": 1, "order_paid": 1, "unpacked": 1,
  "handling": 2, "preparing": 2,
  "invoiced": 3, "shipped": 3, "fulfilled": 3, "order_shipped": 3, "partially_shipped": 3,
  "delivered": 4, "order_delivered": 4, "completed": 4,
  "canceled": 5, "cancelled": 5, "refunded": 5,
};

function mapLogisticStatus(status) {
  return STATUS_MAP[status] ?? 1;
}

/**
 * Busca pedido na Suri pelo ProviderOrderId (ID da Nuvemshop).
 * Tenta múltiplos campos de resposta para compatibilidade.
 */
export async function findOrder(endpoint, token, orderId) {
  if (!orderId) return null;
  try {
    const data = await client.searchOrders(endpoint, token, orderId);
    const list = data?.orders || data?.data || data?.items || [];
    const arr = Array.isArray(list) ? list : Array.isArray(data) ? data : [];
    return arr[0] || null;
  } catch {
    return null;
  }
}

/**
 * Cenários 5 e 6: orders/created e orders/paid
 * Cria orçamento na Suri e marca como pago.
 * Se o pedido já existe, apenas marca como pago.
 */
export async function createOrder(endpoint, token, normalized) {
  const existing = await findOrder(endpoint, token, normalized.orderId);
  if (existing) {
    const suriId = existing.id || existing.orderId;
    await client.markOrderPaid(endpoint, token, suriId, normalized.paymentTracking || "");
    return { action: "marked_paid", suriOrderId: suriId };
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
      Name: i.name || "Produto",
      quantity: i.quantity || 1,
      unitPrice: i.unitPrice || 0,
      discountAmount: i.discount || 0,
    })),
    errorMessages: [],
  };

  const created = await client.createOrderBudget(endpoint, token, budget);
  const suriOrderId = created?.id || created?.orderId;

  if (suriOrderId) {
    await client.markOrderPaid(endpoint, token, suriOrderId, normalized.paymentTracking || "");
    // Baixa de estoque na Suri (silencioso se endpoint não disponível)
    for (const item of (normalized.items || [])) {
      try {
        await client.deductStock(endpoint, token, item.productId, item.sku, item.quantity);
      } catch {}
    }
  }

  return { action: "created_and_paid", suriOrderId };
}

/**
 * Cenário 7: orders/fulfilled
 * Atualiza logística para enviado (status 3).
 */
export async function shipOrder(endpoint, token, normalized) {
  const order = await findOrder(endpoint, token, normalized.orderId);
  if (!order) throw new Error(`Pedido ${normalized.orderId} não encontrado na Suri`);
  const suriId = order.id || order.orderId;
  const status = mapLogisticStatus(normalized.logisticStatus || "shipped");
  await client.updateOrderLogistic(endpoint, token, suriId, status);
  return { action: "logistic_updated", suriOrderId: suriId, status };
}

/**
 * Cenário 8: orders/partially_fulfilled
 * Atualiza logística para parcialmente enviado (status 3).
 */
export async function partiallyShipOrder(endpoint, token, normalized) {
  const order = await findOrder(endpoint, token, normalized.orderId);
  if (!order) throw new Error(`Pedido ${normalized.orderId} não encontrado na Suri`);
  const suriId = order.id || order.orderId;
  await client.updateOrderLogistic(endpoint, token, suriId, 3);
  return { action: "logistic_partial_updated", suriOrderId: suriId, status: 3 };
}

/**
 * Cenário 9: orders/cancelled
 * Cancela pedido na Suri.
 */
export async function cancelOrder(endpoint, token, normalized) {
  const order = await findOrder(endpoint, token, normalized.orderId);
  if (!order) throw new Error(`Pedido ${normalized.orderId} não encontrado na Suri`);
  const suriId = order.id || order.orderId;
  await client.cancelOrder(endpoint, token, suriId);
  return { action: "cancelled", suriOrderId: suriId };
}
