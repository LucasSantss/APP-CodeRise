/**
 * ecommerce/woocommerce/products.js
 * Busca e normalização de produtos do WooCommerce.
 */

export async function fetchAndNormalizeProduct(config, productId) {
  const { site_url, consumer_key, consumer_secret } = config;
  const base = site_url.replace(/\/+$/, "");
  const auth = Buffer.from(`${consumer_key}:${consumer_secret}`).toString("base64");

  const res = await fetch(`${base}/wp-json/wc/v3/products/${productId}`, {
    headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`WooCommerce GET product ${productId} → HTTP ${res.status}`);
  const p = await res.json();

  return {
    id: String(p.id),
    sku: String(p.sku || p.id),
    name: p.name,
    description: (p.short_description || p.description || "").replace(/<[^>]+>/g, ""),
    categoryId: String(p.categories?.[0]?.id || ""),
    brand: p.brands?.[0]?.name || null,
    isActive: p.status === "publish",
    price: parseFloat(p.price || p.regular_price || 0),
    promotionalPrice: parseFloat(p.sale_price || 0),
    url: p.permalink || null,
    images: (p.images || []).map(i => ({ url: i.src, description: i.alt || null })),
    weightInGrams: p.weight ? parseFloat(p.weight) * 1000 : 0,
    dimensions: {
      heightInCm: parseFloat(p.dimensions?.height || 0),
      widthInCm: parseFloat(p.dimensions?.width || 0),
      lengthInCm: parseFloat(p.dimensions?.length || 0),
    },
    stock: parseInt(p.stock_quantity || 0),
    variants: [],
  };
}
