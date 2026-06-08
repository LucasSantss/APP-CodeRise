/**
 * ecommerce/nuvemshop/stock.js
 * Baixa de estoque na Nuvemshop a partir dos itens de um pedido da Suri.
 *
 * FLUXO:
 *   Pedido pago na Suri (OrdersPaid)
 *   → buscamos o pedido via GET /api/shop/orders/:id na Suri
 *   → para cada item do pedido, localizamos o produto/variante na Nuvemshop pelo SKU
 *   → subtraímos a quantidade vendida do estoque via PUT /products/:id/variants/:variantId
 */

import * as client from "./client.js";

/**
 * Localiza a variante na Nuvemshop que corresponde ao SKU informado.
 * Estratégia: busca produtos com o SKU (campo `sku`) usando o parâmetro `q` da API,
 * depois varre as variantes para confirmar match exato.
 *
 * @param {string} storeId
 * @param {string} accessToken
 * @param {string} sku
 * @returns {{ productId: string, variantId: string, currentStock: number } | null}
 */
async function findVariantBySku(storeId, accessToken, sku) {
  if (!sku) return null;

  // A API da Nuvemshop aceita `sku` como filtro de listagem de produtos
  let products = [];
  try {
    products = await client.listProducts(storeId, accessToken, { sku });
  } catch {
    // Fallback: listagem genérica (primeiros 50 produtos)
    products = await client.listProducts(storeId, accessToken, { per_page: 50 });
  }

  if (!Array.isArray(products)) products = [products].filter(Boolean);

  for (const product of products) {
    const variants = product.variants || [];
    for (const variant of variants) {
      if (String(variant.sku || "") === String(sku)) {
        return {
          productId: String(product.id),
          variantId: String(variant.id),
          currentStock: parseInt(variant.stock ?? 0, 10),
        };
      }
    }
  }

  return null;
}

/**
 * Subtrai o estoque de uma variante na Nuvemshop.
 * Nunca deixa o estoque negativo (mínimo = 0).
 *
 * @param {object} config  - { store_id, access_token }
 * @param {string} sku     - SKU do item vendido
 * @param {number} qty     - Quantidade vendida
 * @returns {object}       - Resultado da operação
 */
export async function deductVariantStock(config, sku, qty) {
  const { store_id, access_token } = config;
  const quantity = parseInt(qty, 10) || 1;

  const found = await findVariantBySku(store_id, access_token, sku);
  if (!found) {
    return {
      success: false,
      sku,
      reason: `Variante com SKU "${sku}" não encontrada na Nuvemshop`,
    };
  }

  const { productId, variantId, currentStock } = found;
  const newStock = Math.max(0, currentStock - quantity);

  await client.updateVariantStock(store_id, access_token, productId, variantId, newStock);

  return {
    success: true,
    sku,
    productId,
    variantId,
    previousStock: currentStock,
    soldQuantity: quantity,
    newStock,
  };
}

/**
 * Processa a baixa de estoque para todos os itens de um pedido.
 *
 * @param {object} config  - { store_id, access_token }
 * @param {Array}  items   - [{ sku, quantity, name? }, ...]
 * @returns {object}       - Sumário com resultados por item
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
        success: false,
        sku,
        itemName: item.name || item.Name || "",
        reason: err.message,
      });
    }
  }

  return {
    processed: results.length,
    succeeded: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results,
  };
}
