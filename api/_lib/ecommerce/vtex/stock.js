/**
 * ecommerce/vtex/stock.js
 * Baixa de estoque na VTEX a partir dos itens de um pedido da Suri.
 *
 * Na VTEX, o SKU É identificado diretamente pelo seu ID numérico — não
 * há busca por SKU textual nativa na Logistics API. Por isso, o "sku"
 * usado aqui deve ser o RefId ou o próprio Id do SKU, conforme cadastrado.
 * Assume-se que o item da Suri carrega o ID do SKU da VTEX como "sku".
 */

import * as client from "./client.js";

let _cachedWarehouseId = null;

async function getDefaultWarehouseId(accountName, appKey, appToken) {
  if (_cachedWarehouseId) return _cachedWarehouseId;
  const result = await client.listWarehouses(accountName, appKey, appToken);
  const list = result?.items || result || [];
  const primary = list.find(w => w.isActive !== false) || list[0];
  if (!primary) throw new Error("Nenhum warehouse ativo encontrado na VTEX");
  _cachedWarehouseId = primary.id || primary.warehouseId;
  return _cachedWarehouseId;
}

const _stockLocks = new Map();
async function withStockLock(skuId, fn) {
  const key = String(skuId);
  while (_stockLocks.get(key)) {
    await new Promise(r => setTimeout(r, 50));
  }
  _stockLocks.set(key, true);
  try { return await fn(); } finally { _stockLocks.delete(key); }
}

export async function deductVariantStock(config, skuId, qty) {
  const { account_name, app_key, app_token } = config;
  const quantity = parseInt(qty, 10) || 1;

  const warehouseId = await getDefaultWarehouseId(account_name, app_key, app_token);
  const inventory = await client.getInventoryBySku(account_name, app_key, app_token, skuId);
  const balance = (inventory.balance || []).find(b => b.warehouseId === warehouseId) || inventory.balance?.[0];
  if (!balance) return { success: false, sku: skuId, reason: `SKU "${skuId}" sem saldo cadastrado em nenhum warehouse na VTEX` };

  const currentStock = parseInt(balance.totalQuantity || 0);
  const newStock = Math.max(0, currentStock - quantity);

  await client.updateInventory(account_name, app_key, app_token, skuId, balance.warehouseId, newStock);

  return { success: true, sku: skuId, previousStock: currentStock, deducted: quantity, newStock };
}

export async function returnVariantStock(config, skuId, qty) {
  const { account_name, app_key, app_token } = config;
  const quantity = parseInt(qty, 10) || 1;

  const warehouseId = await getDefaultWarehouseId(account_name, app_key, app_token);
  const inventory = await client.getInventoryBySku(account_name, app_key, app_token, skuId);
  const balance = (inventory.balance || []).find(b => b.warehouseId === warehouseId) || inventory.balance?.[0];
  if (!balance) return { success: false, sku: skuId, reason: `SKU "${skuId}" sem saldo cadastrado em nenhum warehouse na VTEX` };

  const currentStock = parseInt(balance.totalQuantity || 0);
  const newStock = currentStock + quantity;

  await client.updateInventory(account_name, app_key, app_token, skuId, balance.warehouseId, newStock);

  return { success: true, sku: skuId, previousStock: currentStock, returned: quantity, newStock };
}

export async function deductStockForOrderItems(config, items) {
  if (!Array.isArray(items) || items.length === 0) return { processed: 0, results: [] };

  const results = [];
  for (const item of items) {
    const skuId = String(item.sku || "");
    const qty = parseInt(item.quantity || 1, 10);

    if (!skuId) { results.push({ success: false, sku: "(vazio)", reason: "SKU ID não informado" }); continue; }

    try {
      const result = await withStockLock(skuId, () => deductVariantStock(config, skuId, qty));
      results.push({ ...result, itemName: item.name || "" });
    } catch (err) {
      results.push({ success: false, sku: skuId, itemName: item.name || "", reason: err.message });
    }
  }

  return {
    processed: results.length,
    succeeded: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results,
  };
}
