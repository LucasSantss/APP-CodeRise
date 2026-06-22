/**
 * ecommerce/tray/orders.js
 * Operações de pedidos na Tray — FLUXO REVERSO (Suri → Tray)
 *
 * A Tray controla o andamento do pedido por situation_id (status numérico
 * customizável por loja). Por isso buscamos os status disponíveis e
 * tentamos casar pelo nome ("Enviado", "Cancelado") antes de atualizar.
 */

import * as client from "./client.js";

export function normalizeOrder(payload) {
  const order = payload.Order || payload.order || payload;
  const items = (order.Products || order.products || []).map(i => {
    const item = i.Product || i;
    return {
      productId: String(item.id || item.product_id || ""),
      sku: String(item.reference || item.sku || ""),
      name: item.name || "Produto",
      quantity: parseInt(item.quantity || 1),
      unitPrice: parseFloat(item.price || 0),
      discount: parseFloat(item.discount || 0),
      sellerId: "all",
    };
  });

  return {
    orderId: String(order.id || order.Id || ""),
    paymentTracking: order.payment_method || "",
    logisticStatus: order.situation || order.status || "pending",
    totalAmount: parseFloat(order.total || order.Total || 0),
    items,
    shipping: {
      provider: order.shipment_type || "Entrega",
      type: 1,
      price: parseFloat(order.shipment_value || 0),
      estimative: "5 dias úteis",
    },
  };
}

async function findStatusIdByKeyword(apiAddress, accessToken, keywords) {
  const statuses = await client.getOrderStatuses(apiAddress, accessToken).catch(() => []);
  for (const kw of keywords) {
    const found = statuses.find(s => {
      const name = (s.name || s.Name || "").toLowerCase();
      return name.includes(kw);
    });
    if (found) return found.id || found.Id;
  }
  return null;
}

/**
 * Marca o pedido como enviado na Tray (cenário order.shipped da Suri).
 */
export async function fulfillOrder(config, payload) {
  const { api_address, access_token } = config;
  const orderId = payload.orderId || payload.order_id;
  if (!orderId) throw new Error("orderId obrigatório para order.shipped");

  const statusId = await findStatusIdByKeyword(api_address, access_token, ["enviado", "expedido", "shipped"]);
  if (!statusId) throw new Error("Status 'Enviado' não encontrado na lista de situações da Tray");

  await client.updateOrderStatus(api_address, access_token, orderId, statusId);

  if (payload.tracking_number) {
    await client.addTracking(api_address, access_token, orderId, {
      code: payload.tracking_number,
      url: payload.tracking_url || null,
    }).catch(() => {});
  }

  return { action: "order_fulfilled", trayOrderId: orderId, statusId };
}

/**
 * Cancela um pedido na Tray (cenário order.cancelled da Suri).
 */
export async function cancelOrder(config, payload) {
  const { api_address, access_token } = config;
  const orderId = payload.orderId || payload.order_id;
  if (!orderId) throw new Error("orderId obrigatório para order.cancelled");

  const statusId = await findStatusIdByKeyword(api_address, access_token, ["cancelado", "cancelled"]);
  if (!statusId) throw new Error("Status 'Cancelado' não encontrado na lista de situações da Tray");

  await client.updateOrderStatus(api_address, access_token, orderId, statusId);
  return { action: "order_cancelled", trayOrderId: orderId, statusId };
}
