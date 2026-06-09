/**
 * ecommerce/shopify/products.js
 * Busca e normalização de produtos da Shopify.
 */

const API_VERSION = "2024-01";

function headers(apiToken) {
  return { "X-Shopify-Access-Token": apiToken, "Content-Type": "application/json" };
}

export async function fetchAndNormalizeProduct(config, productId) {
  const { store_url, api_token, api_version } = config;
  const host = store_url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const version = api_version || API_VERSION;

  const res = await fetch(`https://${host}/admin/api/${version}/products/${productId}.json`, {
    headers: headers(api_token),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Shopify GET product ${productId} → HTTP ${res.status}`);
  const data = await res.json();
  const p = data.product;

  const variants = (p.variants || []).map(v => ({
    sku: String(v.sku || v.id),
    price: parseFloat(v.price || 0),
    promotionalPrice: parseFloat(v.compare_at_price || 0),
    weightInGrams: v.grams || 0,
    stock: v.inventory_quantity || 0,
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
    name: p.title,
    description: (p.body_html || "").replace(/<[^>]+>/g, ""),
    categoryId: String(p.product_type || ""),
    brand: p.vendor || null,
    isActive: p.status === "active",
    price: firstVariant.price || 0,
    promotionalPrice: firstVariant.promotionalPrice || 0,
    url: p.handle ? `https://${host}/products/${p.handle}` : null,
    images: (p.images || []).map(i => ({ url: i.src, description: i.alt || null })),
    weightInGrams: firstVariant.weightInGrams || 0,
    dimensions: firstVariant.dimensions || { heightInCm: 0, widthInCm: 0, lengthInCm: 0 },
    stock: firstVariant.stock || 0,
    variants,
  };
}
