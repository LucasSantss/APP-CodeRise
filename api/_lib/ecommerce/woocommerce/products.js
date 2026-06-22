/**
 * ecommerce/woocommerce/products.js
 * Busca o produto completo via REST API do WooCommerce e normaliza.
 */

import * as client from "./client.js";

export async function fetchAndNormalizeProduct(config, productId) {
  const { site_url, consumer_key, consumer_secret } = config;
  const p = await client.getProduct(site_url, consumer_key, consumer_secret, productId);

  let variants = [];
  if (p.type === "variable") {
    const vars = await client.getProductVariations(site_url, consumer_key, consumer_secret, productId, { per_page: 100 }).catch(() => []);
    variants = (vars || []).map(v => normalizeVariant(v, p));
  }

  return normalizeProduct(p, variants);
}

function normalizeVariant(v, parent) {
  return {
    sku: String(v.sku || v.id),
    price: parseFloat(v.price || v.regular_price || 0),
    promotionalPrice: parseFloat(v.sale_price || 0),
    weightInGrams: v.weight ? parseFloat(v.weight) * 1000 : 0,
    stock: parseInt(v.stock_quantity ?? 0),
    dimensions: {
      heightInCm: parseFloat(v.dimensions?.height || 0),
      widthInCm: parseFloat(v.dimensions?.width || 0),
      lengthInCm: parseFloat(v.dimensions?.length || 0),
    },
    attributes: (v.attributes || []).map(a => ({ name: a.name || "", value: a.option || "" })),
  };
}

export function normalizeProduct(p, variants = []) {
  const firstVariant = variants[0] || {};

  return {
    id: String(p.id),
    sku: String(p.sku || p.id),
    name: p.name || "",
    description: (p.short_description || p.description || "").replace(/<[^>]+>/g, ""),
    categoryId: String(p.categories?.[0]?.id || ""),
    brand: p.brands?.[0]?.name || null,
    isActive: p.status === "publish",
    price: variants.length ? (firstVariant.price || 0) : parseFloat(p.price || p.regular_price || 0),
    promotionalPrice: variants.length ? (firstVariant.promotionalPrice || 0) : parseFloat(p.sale_price || 0),
    url: p.permalink || null,
    images: (p.images || []).map(i => ({ url: i.src, description: i.alt || null })),
    weightInGrams: variants.length ? firstVariant.weightInGrams : (p.weight ? parseFloat(p.weight) * 1000 : 0),
    dimensions: variants.length ? firstVariant.dimensions : {
      heightInCm: parseFloat(p.dimensions?.height || 0),
      widthInCm: parseFloat(p.dimensions?.width || 0),
      lengthInCm: parseFloat(p.dimensions?.length || 0),
    },
    stock: variants.length ? firstVariant.stock : parseInt(p.stock_quantity || 0),
    variants,
  };
}

/**
 * Normaliza payload bruto do webhook de produto do WooCommerce.
 * Webhooks product.created/product.updated já trazem o produto completo.
 */
export function normalizeWebhookProduct(payload) {
  if (payload && payload.id && payload.name) {
    return { fromWebhook: true, product: normalizeProduct(payload) };
  }
  return { fromWebhook: false, productId: String(payload.id || "") };
}
