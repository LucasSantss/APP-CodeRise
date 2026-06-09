/**
 * ecommerce/vtex/products.js
 * Busca e normalização de produtos da VTEX.
 */

export async function fetchAndNormalizeProduct(config, productId) {
  const { account_name, app_key, app_token } = config;
  const base = `https://${account_name}.vtexcommercestable.com.br/api`;
  const headers = { "X-VTEX-API-AppKey": app_key, "X-VTEX-API-AppToken": app_token };

  const res = await fetch(`${base}/catalog/pvt/product/${productId}`, {
    headers,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`VTEX GET product ${productId} → HTTP ${res.status}`);
  const p = await res.json();

  return {
    id: String(p.Id || p.id),
    sku: String(p.RefId || p.id),
    name: p.ProductName || p.name,
    description: (p.Description || p.description || "").replace(/<[^>]+>/g, ""),
    categoryId: String(p.CategoryId || ""),
    brand: p.BrandName || null,
    isActive: p.IsActive ?? true,
    price: p.Price || 0,
    promotionalPrice: p.ListPrice || 0,
    url: p.DetailUrl || null,
    images: (p.Images || []).map(i => ({ url: i.ImageUrl || i.url, description: i.ImageLabel || null })),
    weightInGrams: p.WeightKg ? p.WeightKg * 1000 : 0,
    dimensions: { heightInCm: p.Height || 0, widthInCm: p.Width || 0, lengthInCm: p.Length || 0 },
    stock: p.AvailableQuantity || 0,
    variants: [],
  };
}
