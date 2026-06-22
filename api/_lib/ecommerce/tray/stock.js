/**
 * ecommerce/tray/stock.js
 * Baixa de estoque na Tray a partir dos itens de um pedido da Suri.
 *
 * A Tray identifica produtos/variantes por ID interno, não por SKU em
 * endpoint direto. Como a listagem de produtos suporta filtro por
 * "reference" (campo usado como SKU), localizamos o produto por aí.
 */

import * as client from "./client.js";

const _stockLocks = new Map();

async function withStockLock(sku, fn) {
  const key = String(sku);
  while (_stockLocks.get(key)) {
    await new Promise(r => setTimeout(r, 50));
  }
  _stockLocks.set(key, true);
  try { return await fn(); } finally { _stockLocks.delete(key); }
}

async function findProductBySku(apiAddress, accessToken, sku) {
  if (!sku) return null;
  const batch = await client.listProducts(apiAddress, accessToken, { reference: sku, limit: 1 }).catch(() => null);
  const items = batch?.Products || batch?.products || [];
  if (!items.length) return null;
  const p = items[0].Product || items[0];
  return p;
}

export async function deductVariantStock(config, sku, qty) {
  const { api_address, access_token } = config;
  const quantity = parseInt(qty, 10) || 1;

  const product = await findProductBySku(api_address, access_token, sku);
  if (!product) return { success: false, sku, reason: `Produto com referência "${sku}" não encontrado na Tray` };

  const currentStock = parseInt(product.stock || 0);
  const newStock = Math.max(0, currentStock - quantity);

  await client.updateProductStock(api_address, access_token, product.id, newStock);

  return { success: true, sku, previousStock: currentStock, deducted: quantity, newStock, productId: product.id };
}

export async function returnVariantStock(config, sku, qty) {
  const { api_address, access_token } = config;
  const quantity = parseInt(qty, 10) || 1;

  const product = await findProductBySku(api_address, access_token, sku);
  if (!product) return { success: false, sku, reason: `Produto com referência "${sku}" não encontrado na Tray` };

  const currentStock = parseInt(product.stock || 0);
  const newStock = currentStock + quantity;

  await client.updateProductStock(api_address, access_token, product.id, newStock);

  return { success: true, sku, previousStock: currentStock, returned: quantity, newStock, productId: product.id };
}

export async function deductStockForOrderItems(config, items) {
  if (!Array.isArray(items) || items.length === 0) return { processed: 0, results: [] };

  const results = [];
  for (const item of items) {
    const sku = String(item.sku || "");
    const qty = parseInt(item.quantity || 1, 10);

    if (!sku) { results.push({ success: false, sku: "(vazio)", reason: "SKU não informado" }); continue; }

    try {
      const result = await withStockLock(sku, () => deductVariantStock(config, sku, qty));
      results.push({ ...result, itemName: item.name || "" });
    } catch (err) {
      results.push({ success: false, sku, itemName: item.name || "", reason: err.message });
    }
  }

  return {
    processed: results.length,
    succeeded: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results,
  };
}
