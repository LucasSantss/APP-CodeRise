/**
 * ecommerce/olist/products.js
 * Busca o produto completo via API da Olist pelo ID recebido no webhook,
 * e normaliza para o formato interno do CodeRise.
 *
 * FLUXO CORRETO:
 * Webhook traz ID → buscamos o produto completo na API → normalizamos → enviamos à Suri
 */

import * as client from "./client.js";

/**
 * Busca o produto completo na API da Olist e normaliza.
 * Garante dados sempre atualizados, independente do que veio no webhook.
 */
export async function fetchAndNormalizeProduct(config, productId) {
  const { store_url, access_token } = config;

  // Busca produto e variantes em paralelo para dados atualizados
  const [p, variantsFromApi] = await Promise.all([
    client.getProduct(store_url, access_token, productId),
    client.getProductVariants(store_url, access_token, productId).catch(() => null),
  ]);

  // Injeta variantes atualizadas antes de normalizar
  if (Array.isArray(variantsFromApi) && variantsFromApi.length > 0) {
    p.variants = variantsFromApi;
  }

  return normalizeProduct(p);
}

/**
 * Normaliza um produto da API da Olist para o formato interno do CodeRise.
 *
 * Estrutura típica da Olist:
 *   p.id, p.name, p.description, p.reference (sku do produto pai),
 *   p.available, p.price, p.promotional_price,
 *   p.tags (array de { name, tag_type }),
 *   p.images (array de { url }),
 *   p.variants (array de variantes)
 *
 * Variante:
 *   v.sku, v.price, v.promotional_price, v.quantity (estoque),
 *   v.weight_g, v.height_cm, v.width_cm, v.length_cm,
 *   v.properties (array de { name, value } — atributos da variante)
 */
export function normalizeProduct(p) {
  const variants = (p.variants || []).map(v => {
    const rawSku = v.sku != null ? String(v.sku).trim() : "";
    const safeSku = rawSku && rawSku !== "null" && rawSku !== "undefined"
      ? rawSku
      : String(p.id);

    return {
      sku: safeSku,
      price: parseFloat(v.price || p.price || 0),
      promotionalPrice: parseFloat(v.promotional_price || p.promotional_price || 0),
      weightInGrams: parseFloat(v.weight_g || 0),
      dimensions: {
        heightInCm: parseFloat(v.height_cm || 0),
        widthInCm:  parseFloat(v.width_cm  || 0),
        lengthInCm: parseFloat(v.length_cm || 0),
      },
      stock: parseInt(v.quantity ?? v.stock ?? 0),
      attributes: (v.properties || []).map(prop => ({
        name:  String(prop.name  || ""),
        value: String(prop.value || ""),
      })),
      imageUrl: v.image_url || null,
    };
  });

  const firstVariant = variants[0] || {};

  // Categoria: pega a primeira tag do tipo "Categoria" (ou qualquer tag)
  const categoryTag = (p.tags || []).find(t => t.tag_type === "Categoria") || (p.tags || [])[0];
  const categoryId = categoryTag ? String(categoryTag.name || "") : "";

  return {
    id: String(p.id),
    sku: firstVariant.sku || p.reference || String(p.id),
    name: p.name || "",
    description: (p.description || "").replace(/<[^>]+>/g, ""),
    categoryId,
    brand: p.brand || null,
    isActive: p.available === true || p.available === "true",
    price: firstVariant.price || parseFloat(p.price || 0),
    promotionalPrice: firstVariant.promotionalPrice || parseFloat(p.promotional_price || 0),
    url: p.url || null,
    images: (p.images || []).map(i => ({
      url:         i.url  || i.src || "",
      description: i.alt  || null,
    })),
    weightInGrams: firstVariant.weightInGrams || 0,
    dimensions:    firstVariant.dimensions   || { heightInCm: 0, widthInCm: 0, lengthInCm: 0 },
    stock:         firstVariant.stock        || 0,
    variants,
  };
}

/**
 * Normaliza o payload bruto do webhook de produto da Olist.
 * A Olist envia apenas o ID no webhook; sempre sinaliza needsApiFetch:true.
 */
export function normalizeWebhookProduct(payload) {
  const p = payload.product || payload;
  if (p.variants && p.name) return { fromWebhook: true, product: normalizeProduct(p) };
  return { fromWebhook: false, productId: String(p.id || payload.id || "") };
}
