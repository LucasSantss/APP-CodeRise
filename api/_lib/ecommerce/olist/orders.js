/**
 * ecommerce/olist/orders.js
 * Operações de pedidos na API da Olist — FLUXO REVERSO (Suri → Olist)
 *
 * Cenário order.created  → deductStock (deduz estoque quando pedido é criado/pago)
 * Cenário order.shipped  → shipPackage (marca pacote como enviado)
 * Cenário order.cancelled→ cancelOrder + devolve estoque
 */

import * as client from "./client.js";

// ── Mutex por SKU: serializa deduções simultâneas do mesmo item ───────────────
const _stockLocks = new Map();

async function withStockLock(sku, fn) {
  const key = String(sku);
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
  const items = (order.items || order.line_items || []).map(i => ({
    productId: String(i.product_id || i.id || ""),
    sku:       String(i.sku || i.variant_sku || ""),
    name:      i.name || i.product_name || "Produto",
    quantity:  parseInt(i.quantity || 1),
    unitPrice: parseFloat(i.price || i.unit_price || 0),
    discount:  parseFloat(i.discount || 0),
    sellerId:  "all",
  }));

  return {
    orderId:         String(order.code || order.id || ""),
    paymentTracking: order.payment_method || order.payment_type || "",
    logisticStatus:  order.shipping_status || order.status || "shipped",
    totalAmount:     parseFloat(order.total || 0),
    items,
    shipping: {
      provider:   order.shipping_method_name || "Entrega",
      type:       1,
      price:      parseFloat(order.shipping_price || 0),
      estimative: "5 dias úteis",
    },
  };
}

/**
 * Deduz estoque na Olist via SKU para cada item do pedido.
 * Usa POST /api/v2/variants/{sku}/quantity com { quantity: novoEstoque }
 *
 * IMPORTANTE: A API da Olist recebe o estoque ABSOLUTO (não o delta).
 * Por isso primeiro consulta o estoque atual via GET /api/v2/variants/{sku}
 * e então calcula: novoEstoque = Max(0, estoqueAtual - quantidadeVendida)
 */
export async function deductStock(config, items) {
  const { store_url, access_token } = config;
  const results = [];

  for (const item of items) {
    const sku = String(item.sku || item.Sku || "");
    const qty = parseInt(item.quantity || item.Quantity || 1);

    if (!sku) {
      results.push({ status: "skipped", reason: "SKU ausente" });
      continue;
    }

    try {
      const result = await withStockLock(sku, async () => {
        // PASSO 1 — Consulta estoque atual da variante via SKU
        const variant = await client.getVariantBySku(store_url, access_token, sku);
        const currentStock = parseInt(variant.quantity ?? variant.stock ?? 0);

        // PASSO 2 — Calcula novo estoque (nunca negativo)
        const newStock = Math.max(0, currentStock - qty);

        // PASSO 3 — Atualiza estoque na Olist (valor absoluto)
        await client.updateVariantStock(store_url, access_token, sku, newStock);

        return {
          sku,
          currentStock,
          deducted: qty,
          newStock,
          status: "stock_reduced",
        };
      });
      results.push(result);
    } catch (e) {
      results.push({ sku, status: "error", detail: e.message });
    }
  }

  return { action: "stock_deducted", results };
}

/**
 * Devolve estoque na Olist (pedido cancelado).
 * Lógica inversa do deductStock: novoEstoque = estoqueAtual + quantidadeCancelada
 */
export async function returnStock(config, items) {
  const { store_url, access_token } = config;
  const results = [];

  for (const item of items) {
    const sku = String(item.sku || item.Sku || "");
    const qty = parseInt(item.quantity || item.Quantity || 1);

    if (!sku) {
      results.push({ status: "skipped", reason: "SKU ausente" });
      continue;
    }

    try {
      const result = await withStockLock(sku, async () => {
        const variant = await client.getVariantBySku(store_url, access_token, sku);
        const currentStock = parseInt(variant.quantity ?? variant.stock ?? 0);
        const newStock = currentStock + qty;

        await client.updateVariantStock(store_url, access_token, sku, newStock);

        return {
          sku,
          currentStock,
          returned: qty,
          newStock,
          status: "stock_returned",
        };
      });
      results.push(result);
    } catch (e) {
      results.push({ sku, status: "error", detail: e.message });
    }
  }

  return { action: "stock_returned", results };
}

/**
 * Cenário order.shipped (Suri → Olist)
 * Marca o primeiro pacote pendente do pedido como enviado.
 */
export async function fulfillOrder(config, payload) {
  const { store_url, access_token } = config;
  const orderCode = payload.orderId || payload.order_id;
  if (!orderCode) throw new Error("orderId obrigatório para order.shipped");

  // Busca os pacotes do pedido
  const packages = await client.getOrderPackages(store_url, access_token, orderCode);
  const pkgList  = Array.isArray(packages) ? packages : (packages.packages || []);
  const pkg      = pkgList[0];
  if (!pkg) throw new Error(`Pedido ${orderCode} sem pacotes na Olist`);

  // Adiciona tracking se fornecido
  if (payload.tracking_number) {
    await client.addTracking(store_url, access_token, orderCode, pkg.code || pkg.id, {
      code: payload.tracking_number,
      url:  payload.tracking_url || null,
    }).catch(() => {});
  }

  await client.shipPackage(store_url, access_token, orderCode, pkg.code || pkg.id);
  return { action: "order_fulfilled", olistOrderCode: orderCode, packageCode: pkg.code || pkg.id };
}

/**
 * Cenário order.cancelled (Suri → Olist)
 * Cancela o pedido na Olist.
 */
export async function cancelOrder(config, payload) {
  const { store_url, access_token } = config;
  const orderCode = payload.orderId || payload.order_id;
  if (!orderCode) throw new Error("orderId obrigatório para order.cancelled");

  await client.cancelOrder(store_url, access_token, orderCode);
  return { action: "order_cancelled", olistOrderCode: orderCode };
}

/**
 * Atualiza estoque de uma variante específica na Olist.
 */
export async function updateStock(config, payload) {
  const { store_url, access_token } = config;
  const { sku, stock } = payload;
  if (!sku || stock === undefined) throw new Error("sku e stock são obrigatórios");

  await client.updateVariantStock(store_url, access_token, sku, stock);
  return { action: "stock_updated", sku, newStock: stock };
}
