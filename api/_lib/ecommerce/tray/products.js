/**
 * ecommerce/tray/products.js
 * Busca o produto completo via API da Tray e normaliza.
 */

import * as client from "./client.js";

export async function fetchAndNormalizeProduct(config, productId) {
  const { api_address, access_token } = config;

  const [p, variants] = await Promise.all([
    client.getProduct(api_address, access_token, productId),
    client.getProductVariants(api_address, access_token, productId).catch(() => []),
  ]);

  if (Array.isArray(variants) && variants.length) p.Variants = variants;
  return normalizeProduct(p);
}

export function normalizeProduct(p) {
  const rawVariants = p.Variants || p.variants || [];
  const variants = rawVariants.map(item => {
    const v = item.Variant || item;
    return {
      sku: String(v.reference || v.sku || v.id),
      price: parseFloat(v.price || p.price || 0),
      promotionalPrice: parseFloat(v.promotional_price || p.promotional_price || 0),
      weightInGrams: parseFloat(v.weight || p.weight || 0) * 1000,
      stock: parseInt(v.stock || 0),
      dimensions: {
        heightInCm: parseFloat(v.height || p.height || 0),
        widthInCm: parseFloat(v.width || p.width || 0),
        lengthInCm: parseFloat(v.length || p.length || 0),
      },
      attributes: (v.attributes || []).map(a => ({ name: a.name || "", value: a.value || "" })),
    };
  });

  const firstVariant = variants[0] || {};

  return {
    id: String(p.id || p.Id),
    sku: String(p.reference || p.Reference || firstVariant.sku || p.id),
    name: p.name || p.Name || "",
    description: (p.description || p.Description || "").replace(/<[^>]+>/g, ""),
    categoryId: String(p.category_id || p.CategoryId || ""),
    brand: p.brand || p.Brand || null,
    isActive: p.available === "1" || p.available === true || p.Active === true,
    price: variants.length ? firstVariant.price : parseFloat(p.price || p.Price || 0),
    promotionalPrice: variants.length ? firstVariant.promotionalPrice : parseFloat(p.promotional_price || p.PromotionalPrice || 0),
    url: p.link || p.Url || null,
    images: (p.images || p.Images || p.ProductImage || []).map(i => ({
      url: i.link || i.Url || i.url || i.https || i.http || "",
      description: i.alt || null,
    })),
    weightInGrams: variants.length ? firstVariant.weightInGrams : parseFloat(p.weight || p.Weight || 0) * 1000,
    dimensions: variants.length ? firstVariant.dimensions : {
      heightInCm: parseFloat(p.height || p.Height || 0),
      widthInCm: parseFloat(p.width || p.Width || 0),
      lengthInCm: parseFloat(p.length || p.Length || 0),
    },
    stock: variants.length ? firstVariant.stock : parseInt(p.stock || p.Estoque || 0),
    variants,
  };
}
