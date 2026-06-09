/**
 * ecommerce/tray/products.js
 * Busca e normalização de produtos da Tray.
 */

export async function fetchAndNormalizeProduct(config, productId) {
  const { api_address, access_token } = config;
  const base = api_address.replace(/\/+$/, "");

  const res = await fetch(`${base}/products/${productId}`, {
    headers: { "Authorization": `Bearer ${access_token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Tray GET product ${productId} → HTTP ${res.status}`);
  const data = await res.json();
  const p = data.Product || data.product || data;

  return {
    id: String(p.id || p.Id),
    sku: String(p.reference || p.sku || p.id),
    name: p.name || p.Name,
    description: (p.description || p.Description || "").replace(/<[^>]+>/g, ""),
    categoryId: String(p.category_id || p.CategoryId || ""),
    brand: p.brand || p.Brand || null,
    isActive: p.available === "1" || p.available === true || p.Active === true,
    price: parseFloat(p.price || p.Price || 0),
    promotionalPrice: parseFloat(p.promotional_price || p.PromotionalPrice || 0),
    url: p.link || p.Url || null,
    images: (p.images || p.Images || []).map(i => ({ url: i.link || i.Url || i.url, description: i.alt || null })),
    weightInGrams: parseFloat(p.weight || p.Weight || 0) * 1000,
    dimensions: {
      heightInCm: parseFloat(p.height || p.Height || 0),
      widthInCm: parseFloat(p.width || p.Width || 0),
      lengthInCm: parseFloat(p.length || p.Length || 0),
    },
    stock: parseInt(p.stock || p.Estoque || 0),
    variants: [],
  };
}
