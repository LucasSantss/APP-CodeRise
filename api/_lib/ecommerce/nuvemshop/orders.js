/**
 * ecommerce/nuvemshop/orders.js
 * Operações de pedidos na API da Nuvemshop — FLUXO REVERSO (Suri → Nuvemshop)
 *
 * Cenário 10/11 — order.created  → deductStock
 *   1. Consulta estoque atual da variante na Nuvemshop
 *   2. Calcula novo estoque (atual - quantidade comprada)
 *   3. Atualiza estoque na Nuvemshop
 *
 * Cenário 12 — order.shipped    → fulfillOrder (marca enviado + rastreio)
 * Cenário 13 — order.cancelled  → cancelOrder  (cancela pedido)
 */

import * as client from "./client.js";

// ── Mutex por produto: serializa deduções simultâneas do mesmo item ───────────
// Evita race condition quando múltiplos pedidos chegam ao mesmo tempo
// para o mesmo produto — garante que o estoque seja lido e atualizado atomicamente
const _stockLocks = new Map();

async function withStockLock(productId, fn) {
  const key = String(productId);
  while (_stockLocks.get(key)) {
    await new Promise(r => setTimeout(r, 50));
  }
  _stockLocks.set(key, true);
  try {
    return await fn();
  } finally {
    _stockLocks.delete(key);
  }
}

export function normalizeOrder(payload) {
  const order = payload.order || payload;
  return {
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
  };
}

/**
 * Cenários 10 e 11: order.created (Suri → Nuvemshop)
 *
 * Fluxo por item:
 *  1. GET /products/{productId}/variants  → consulta estoque atual
 *  2. Localiza a variante pelo SKU
 *  3. Calcula: novoEstoque = Max(0, estoqueAtual - quantidade)
 *  4. PUT /products/{productId}/variants/{variantId} → atualiza
 */
export async function deductStock(config, items) {
  const { store_id, access_token } = config;
  const results = [];

  for (const item of items) {
    const productId = item.productId || item.product_id || item.ProductId;
    const sku       = item.sku || item.Sku;
    const qty       = parseInt(item.quantity || item.Quantity || 1);

    if (!productId) {
      results.push({ status: "skipped", reason: "productId ausente" });
      continue;
    }

    try {
      // Mutex por produto: serializa deduções simultâneas do mesmo item
      const result = await withStockLock(productId, async () => {
        // PASSO 1 — Consulta estoque atual na Nuvemshop
        const varRes  = await client.getProductVariants(store_id, access_token, productId);
        const variants = Array.isArray(varRes) ? varRes : (varRes.variants || []);

        // PASSO 2 — Localiza a variante pelo SKU (ou pega a primeira se não informado)
        const variant = sku
          ? variants.find(v => String(v.sku) === String(sku))
          : variants[0];

        if (!variant) return { productId, sku, status: "variant_not_found" };

        const currentStock = variant.stock ?? 0;

        // PASSO 3 — Calcula novo estoque (nunca negativo)
        const newStock = Math.max(0, currentStock - qty);

        // PASSO 4 — Atualiza estoque na Nuvemshop
        await client.updateVariantStock(store_id, access_token, productId, variant.id, newStock);

        return {
          productId,
          variantId:    variant.id,
          sku:          variant.sku,
          currentStock,       // estoque antes da dedução
          deducted:     qty,  // quantidade comprada na Suri
          newStock,           // estoque após dedução
          status:       "stock_reduced",
        };
      });
      results.push(result);

    } catch (e) {
      results.push({ productId, sku, status: "error", detail: e.message });
    }
  }

  return { action: "stock_deducted", results };
}

/**
 * Cenário 12: order.shipped (Suri → Nuvemshop)
 * Marca pedido como enviado na Nuvemshop com código de rastreio.
 */
export async function fulfillOrder(config, payload) {
  const { store_id, access_token } = config;
  const orderId = payload.orderId || payload.order_id;
  if (!orderId) throw new Error("orderId obrigatório para order.shipped");

  const searchData = await client.searchOrders(store_id, access_token, orderId);
  const orders = Array.isArray(searchData) ? searchData : (searchData.orders || []);
  const order  = orders[0];
  if (!order) throw new Error(`Pedido ${orderId} não encontrado na Nuvemshop`);

  const body = {
    notify_customer: payload.notify_customer ?? true,
    ...(payload.tracking_number ? { tracking_number: payload.tracking_number } : {}),
    ...(payload.tracking_url   ? { tracking_url:    payload.tracking_url }    : {}),
  };

  await client.fulfillOrder(store_id, access_token, order.id, body);
  return { action: "order_fulfilled", nuvemshopOrderId: order.id };
}

/**
 * Cenário 13: order.cancelled (Suri → Nuvemshop)
 * Cancela pedido na Nuvemshop.
 */
export async function cancelOrder(config, payload) {
  const { store_id, access_token } = config;
  const orderId = payload.orderId || payload.order_id;
  if (!orderId) throw new Error("orderId obrigatório para order.cancelled");

  const searchData = await client.searchOrders(store_id, access_token, orderId);
  const orders = Array.isArray(searchData) ? searchData : (searchData.orders || []);
  const order  = orders[0];
  if (!order) throw new Error(`Pedido ${orderId} não encontrado na Nuvemshop`);

  await client.cancelOrder(store_id, access_token, order.id);
  return { action: "order_cancelled", nuvemshopOrderId: order.id };
}

/**
 * Adiciona nota a um pedido na Nuvemshop.
 */
export async function addOrderNote(config, payload) {
  const { store_id, access_token } = config;
  const orderId = payload.orderId || payload.order_id;
  const note    = payload.note || payload.message || "";
  if (!orderId || !note) throw new Error("orderId e note são obrigatórios");

  const searchData = await client.searchOrders(store_id, access_token, orderId);
  const orders = Array.isArray(searchData) ? searchData : (searchData.orders || []);
  const order  = orders[0];
  if (!order) throw new Error(`Pedido ${orderId} não encontrado na Nuvemshop`);

  await client.updateOrder(store_id, access_token, order.id, { note });
  return { action: "note_updated", nuvemshopOrderId: order.id };
}

/**
 * Atualiza estoque de uma variante específica na Nuvemshop.
 */
export async function updateStock(config, payload) {
  const { store_id, access_token } = config;
  const { productId, sku, stock } = payload;
  if (!productId || stock === undefined) throw new Error("productId e stock são obrigatórios");

  const varRes   = await client.getProductVariants(store_id, access_token, productId);
  const variants = Array.isArray(varRes) ? varRes : (varRes.variants || []);
  const variant  = sku ? variants.find(v => String(v.sku) === String(sku)) : variants[0];
  if (!variant) throw new Error("Variante não encontrada");

  await client.updateVariantStock(store_id, access_token, productId, variant.id, stock);
  return { action: "stock_updated", variantId: variant.id, newStock: stock };
}
