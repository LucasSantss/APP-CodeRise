/**
 * ecommerce/woocommerce/stock.js
 * Baixa de estoque no WooCommerce a partir dos itens de um pedido da Suri.
 *
 * O WooCommerce identifica produto/variação por ID numérico, não por SKU
 * diretamente em update. Por isso buscamos o produto pelo SKU via filtro
 * antes de atualizar o estoque.
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

/**
 * Localiza um produto (ou variação) pelo SKU usando o filtro ?sku= da listagem.
 */
async function findProductBySku(siteUrl, consumerKey, consumerSecret, sku) {
  if (!sku) return null;
  const results = await client.listProducts(siteUrl, consumerKey, consumerSecret, { sku, per_page: 1 }).catch(() => []);
  if (results && results.length) return { ...results[0], isVariation: false };
  return null;
}

/**
 * Deduz estoque de um produto simples (não variável) pelo SKU.
 */
export async function deductVariantStock(config, sku, qty) {
  const { site_url, consumer_key, consumer_secret } = config;
  const quantity = parseInt(qty, 10) || 1;

  const product = await findProductBySku(site_url, consumer_key, consumer_secret, sku);
  if (!product) return { success: false, sku, reason: `Produto com SKU "${sku}" não encontrado no WooCommerce` };

  const currentStock = parseInt(product.stock_quantity ?? 0);
  const newStock = Math.max(0, currentStock - quantity);

  await client.updateProduct(site_url, consumer_key, consumer_secret, product.id, { stock_quantity: newStock, manage_stock: true });

  return { success: true, sku, previousStock: currentStock, deducted: quantity, newStock, productId: product.id };
}

export async function returnVariantStock(config, sku, qty) {
  const { site_url, consumer_key, consumer_secret } = config;
  const quantity = parseInt(qty, 10) || 1;

  const product = await findProductBySku(site_url, consumer_key, consumer_secret, sku);
  if (!product) return { success: false, sku, reason: `Produto com SKU "${sku}" não encontrado no WooCommerce` };

  const currentStock = parseInt(product.stock_quantity ?? 0);
  const newStock = currentStock + quantity;

  await client.updateProduct(site_url, consumer_key, consumer_secret, product.id, { stock_quantity: newStock, manage_stock: true });

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
