/**
 * ecommerce/shopify/stock.js
 * Baixa de estoque na Shopify a partir dos itens de um pedido da Suri.
 *
 * A Shopify gerencia estoque por inventory_item_id + location_id.
 * Por isso, antes de ajustar, é preciso resolver SKU → variant → inventory_item_id,
 * e descobrir o location_id padrão da loja.
 */

import * as client from "./client.js";

let _cachedLocationId = null;

async function getDefaultLocationId(storeUrl, apiToken, apiVersion) {
  if (_cachedLocationId) return _cachedLocationId;
  const locations = await client.listLocations(storeUrl, apiToken, apiVersion);
  const primary = locations.find(l => l.active !== false) || locations[0];
  if (!primary) throw new Error("Nenhum location ativo encontrado na Shopify");
  _cachedLocationId = primary.id;
  return primary.id;
}

/**
 * Localiza a variante pelo SKU (busca em produtos — Shopify não tem endpoint direto por SKU).
 */
async function findVariantBySku(storeUrl, apiToken, sku, apiVersion) {
  if (!sku) return null;
  // Shopify não permite filtrar produtos por SKU diretamente via REST;
  // Estratégia: usar GraphQL seria ideal, mas para manter REST simples,
  // assumimos que o item do pedido da Suri já carrega productId/variantId quando disponível.
  return null;
}

/**
 * Ajusta estoque de uma variante via inventory_item_id direto (preferencial).
 */
export async function deductVariantStock(config, inventoryItemId, qty) {
  const { store_url, api_token, api_version } = config;
  const quantity = parseInt(qty, 10) || 1;

  const locationId = await getDefaultLocationId(store_url, api_token, api_version);
  await client.adjustInventoryLevel(store_url, api_token, locationId, inventoryItemId, -quantity, api_version);

  return { success: true, inventoryItemId, deducted: quantity, locationId };
}

export async function returnVariantStock(config, inventoryItemId, qty) {
  const { store_url, api_token, api_version } = config;
  const quantity = parseInt(qty, 10) || 1;

  const locationId = await getDefaultLocationId(store_url, api_token, api_version);
  await client.adjustInventoryLevel(store_url, api_token, locationId, inventoryItemId, quantity, api_version);

  return { success: true, inventoryItemId, returned: quantity, locationId };
}

/**
 * Processa a baixa de estoque para todos os itens de um pedido.
 * Cada item precisa trazer inventoryItemId (resolvido previamente via fetchAndNormalizeProduct).
 */
export async function deductStockForOrderItems(config, items) {
  if (!Array.isArray(items) || items.length === 0) return { processed: 0, results: [] };

  const results = [];
  for (const item of items) {
    const inventoryItemId = item.inventoryItemId || item.inventory_item_id;
    const qty = parseInt(item.quantity || 1, 10);

    if (!inventoryItemId) {
      results.push({ success: false, sku: item.sku || "(desconhecido)", reason: "inventory_item_id não encontrado — produto precisa ser sincronizado primeiro" });
      continue;
    }

    try {
      const result = await deductVariantStock(config, inventoryItemId, qty);
      results.push({ ...result, sku: item.sku || "", itemName: item.name || "" });
    } catch (err) {
      results.push({ success: false, sku: item.sku || "", itemName: item.name || "", reason: err.message });
    }
  }

  return {
    processed: results.length,
    succeeded: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results,
  };
}
