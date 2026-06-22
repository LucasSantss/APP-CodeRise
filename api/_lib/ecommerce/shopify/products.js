/**
 * ecommerce/shopify/products.js
 * Busca o produto completo via Admin API da Shopify e normaliza
 * para o formato interno do CodeRise.
 */

import * as client from "./client.js";

export async function fetchAndNormalizeProduct(config, productId) {
  const { store_url, api_token, api_version } = config;
  const p = await client.getProduct(store_url, api_token, productId, api_version);
  return normalizeProduct(p, store_url);
}

export function normalizeProduct(p, storeUrl) {
  const host = storeUrl ? storeUrl.replace(/^https?:\/\//, "").replace(/\/$/, "") : null;

  const variants = (p.variants || []).map(v => ({
    sku: String(v.sku || v.id),
    price: parseFloat(v.price || 0),
    promotionalPrice: parseFloat(v.compare_at_price || 0),
    weightInGrams: v.grams || 0,
    stock: v.inventory_quantity || 0,
    inventoryItemId: v.inventory_item_id ? String(v.inventory_item_id) : null,
    dimensions: { heightInCm: 0, widthInCm: 0, lengthInCm: 0 },
    attributes: [
      ...(v.option1 ? [{ name: "option1", value: v.option1 }] : []),
      ...(v.option2 ? [{ name: "option2", value: v.option2 }] : []),
      ...(v.option3 ? [{ name: "option3", value: v.option3 }] : []),
    ],
  }));

  const firstVariant = variants[0] || {};

  return {
    id: String(p.id),
    sku: String(p.variants?.[0]?.sku || p.id),
    name: p.title || "",
    description: (p.body_html || "").replace(/<[^>]+>/g, ""),
    categoryId: String(p.product_type || ""),
    brand: p.vendor || null,
    isActive: p.status === "active",
    price: firstVariant.price || 0,
    promotionalPrice: firstVariant.promotionalPrice || 0,
    url: p.handle && host ? `https://${host}/products/${p.handle}` : null,
    images: (p.images || []).map(i => ({ url: i.src, description: i.alt || null })),
    weightInGrams: firstVariant.weightInGrams || 0,
    dimensions: firstVariant.dimensions || { heightInCm: 0, widthInCm: 0, lengthInCm: 0 },
    stock: firstVariant.stock || 0,
    variants,
  };
}

/**
 * Normaliza payload bruto do webhook de produto da Shopify.
 * Webhooks products/create e products/update já trazem o produto completo.
 */
export function normalizeWebhookProduct(payload, storeUrl) {
  if (payload && payload.id && payload.variants) {
    return { fromWebhook: true, product: normalizeProduct(payload, storeUrl) };
  }
  return { fromWebhook: false, productId: String(payload.id || "") };
}
