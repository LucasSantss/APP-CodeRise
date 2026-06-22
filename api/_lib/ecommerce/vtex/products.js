/**
 * ecommerce/vtex/products.js
 * Busca o produto completo via API da VTEX e normaliza.
 *
 * VTEX trata produto e SKU como entidades separadas — um produto pode
 * ter vários SKUs (variantes). Por isso buscamos o produto e, em seguida,
 * todos os SKUs vinculados, combinando os dados.
 */

import * as client from "./client.js";

export async function fetchAndNormalizeProduct(config, productId) {
  const { account_name, app_key, app_token } = config;

  const p = await client.getProduct(account_name, app_key, app_token, productId);
  const skuIdsResult = await client.listSkusByProduct(account_name, app_key, app_token, productId).catch(() => null);
  const skuIds = skuIdsResult?.skus || skuIdsResult || [];

  const skuDetails = await Promise.all(
    (Array.isArray(skuIds) ? skuIds : []).slice(0, 50).map(skuId =>
      client.getSkuContext(account_name, app_key, app_token, skuId).catch(() => null)
    )
  );

  return normalizeProduct(p, skuDetails.filter(Boolean));
}

export function normalizeProduct(p, skus = []) {
  const variants = skus.map(sku => ({
    sku: String(sku.Id || sku.RefId || sku.id),
    price: parseFloat(sku.Price || sku.BestPrice || 0) / (sku.Price > 1000 ? 100 : 1) || parseFloat(sku.Price || 0),
    promotionalPrice: parseFloat(sku.ListPrice || 0),
    weightInGrams: sku.WeightKg ? parseFloat(sku.WeightKg) * 1000 : (sku.Dimension?.weight || 0),
    stock: sku.AvailableQuantity ?? 0,
    dimensions: {
      heightInCm: sku.Height || sku.Dimension?.height || 0,
      widthInCm: sku.Width || sku.Dimension?.width || 0,
      lengthInCm: sku.Length || sku.Dimension?.length || 0,
    },
    attributes: (sku.SkuSpecifications || sku.Variations || []).map(v => ({
      name: v.FieldName || v.Name || "",
      value: Array.isArray(v.FieldValues) ? v.FieldValues.join(", ") : (v.Value || ""),
    })),
  }));

  const firstVariant = variants[0] || {};

  return {
    id: String(p.Id || p.id),
    sku: String(p.RefId || firstVariant.sku || p.Id || p.id),
    name: p.Name || p.ProductName || "",
    description: (p.Description || p.DescriptionShort || "").replace(/<[^>]+>/g, ""),
    categoryId: String(p.CategoryId || ""),
    brand: p.BrandName || null,
    isActive: p.IsActive ?? true,
    price: firstVariant.price || p.Price || 0,
    promotionalPrice: firstVariant.promotionalPrice || p.ListPrice || 0,
    url: p.DetailUrl || p.LinkId || null,
    images: (p.Images || []).map(i => ({ url: i.ImageUrl || i.Url || i.url, description: i.ImageLabel || null })),
    weightInGrams: firstVariant.weightInGrams || 0,
    dimensions: firstVariant.dimensions || { heightInCm: 0, widthInCm: 0, lengthInCm: 0 },
    stock: firstVariant.stock || 0,
    variants,
  };
}
