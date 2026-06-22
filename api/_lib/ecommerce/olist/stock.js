/**
 * ecommerce/olist/stock.js
 * Baixa de estoque na Olist a partir dos itens de um pedido da Suri.
 *
 * FLUXO:
 *   Pedido pago na Suri (OrdersPaid)
 *   → buscamos o pedido via GET /api/shop/orders/:id na Suri
 *   → para cada item, localizamos a variante na Olist pelo SKU
 *   → subtraímos a quantidade vendida do estoque via POST /variants/{sku}/quantity
 */

import * as client from "./client.js";

/**
 * Localiza a variante na Olist pelo SKU.
 * Usa GET /api/v2/variants/{sku} diretamente.
 *
 * @returns {{ sku, currentStock } | null}
 */
async function findVariantBySku(storeUrl, accessToken, sku) {
  if (!sku) return null;

  try {
    const variant = await client.getVariantBySku(storeUrl, accessToken, sku);
    if (!variant || !variant.sku) return null;
    return {
      sku:          String(variant.sku),
      currentStock: parseInt(variant.quantity ?? variant.stock ?? 0, 10),
    };
  } catch {
    return null;
  }
}

/**
 * Subtrai o estoque de uma variante na Olist.
 * A API recebe o valor ABSOLUTO do novo estoque.
 *
 * @param {object} config  - { store_url, access_token }
 * @param {string} sku     - SKU da variante
 * @param {number} qty     - Quantidade vendida
 */
export async function deductVariantStock(config, sku, qty) {
  const { store_url, access_token } = config;
  const quantity = parseInt(qty, 10) || 1;

  const found = await findVariantBySku(store_url, access_token, sku);
  if (!found) {
    return {
      success: false,
      sku,
      reason: `Variante com SKU "${sku}" não encontrada na Olist`,
    };
  }

  const { currentStock } = found;
  const newStock = Math.max(0, currentStock - quantity);

  await client.updateVariantStock(store_url, access_token, sku, newStock);

  return {
    success: true,
    sku,
    previousStock: currentStock,
    soldQuantity:  quantity,
    newStock,
  };
}

/**
 * Processa a baixa de estoque para todos os itens de um pedido.
 *
 * @param {object} config  - { store_url, access_token }
 * @param {Array}  items   - [{ sku, quantity, name? }, ...]
 */
export async function deductStockForOrderItems(config, items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { processed: 0, results: [] };
  }

  const results = [];

  for (const item of items) {
    const sku = String(item.sku || item.Sku || "");
    const qty = parseInt(item.quantity || item.paidQuantity || 1, 10);

    if (!sku) {
      results.push({ success: false, sku: "(vazio)", reason: "SKU não informado no item" });
      continue;
    }

    try {
      const result = await deductVariantStock(config, sku, qty);
      results.push({ ...result, itemName: item.name || item.Name || "" });
    } catch (err) {
      results.push({
        success:  false,
        sku,
        itemName: item.name || item.Name || "",
        reason:   err.message,
      });
    }
  }

  return {
    processed: results.length,
    succeeded: results.filter(r => r.success).length,
    failed:    results.filter(r => !r.success).length,
    results,
  };
}
