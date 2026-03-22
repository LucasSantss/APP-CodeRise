/**
 * ecommerce/nuvemshop/products.js
 * Busca o produto completo via API da Nuvemshop pelo ID recebido no webhook,
 * e normaliza para o formato interno do CodeRise.
 *
 * FLUXO CORRETO:
 * Webhook traz ID → buscamos o produto completo na API → normalizamos → enviamos à Suri
 */

import * as client from "./client.js";

/**
 * Busca o produto completo na API da Nuvemshop e normaliza.
 * Garante dados sempre atualizados, independente do que veio no webhook.
 */
export async function fetchAndNormalizeProduct(config, productId) {
  const { store_id, access_token } = config;

  // Busca o produto completo via API
  const p = await client.getProduct(store_id, access_token, productId);

  return normalizeProduct(p);
}

/**
 * Normaliza um produto já carregado da API da Nuvemshop
 * para o formato interno do CodeRise.
 */
export function normalizeProduct(p) {
  const variants = (p.variants || []).map(v => ({
    sku: String(v.sku || p.id),
    price: parseFloat(v.price || p.price || 0),
    promotionalPrice: parseFloat(v.promotional_price || p.promotional_price || 0),
    weightInGrams: parseFloat(v.weight || 0) * 1000,
    dimensions: {
      heightInCm: parseFloat(v.height || 0),
      widthInCm: parseFloat(v.width || 0),
      lengthInCm: parseFloat(v.depth || 0),
    },
    stock: parseInt(v.stock || 0),
    attributes: Object.entries(v.values || {}).map(([name, value]) => ({
      name,
      value: String(value),
    })),
    imageUrl: v.image?.src || null,
  }));

  const firstVariant = variants[0] || {};

  return {
    id: String(p.id),
    sku: String(p.variants?.[0]?.sku || p.id),
    name: p.name?.pt || p.name?.es || Object.values(p.name || {})[0] || "",
    description: (p.description?.pt || p.description?.es || "").replace(/<[^>]+>/g, ""),
    categoryId: String(p.categories?.[0]?.id || ""),
    brand: p.brand || null,
    isActive: !!p.published_at,
    price: firstVariant.price || 0,
    promotionalPrice: firstVariant.promotionalPrice || 0,
    url: p.canonical_url || null,
    images: (p.images || []).map(i => ({ url: i.src, description: i.alt || null })),
    weightInGrams: firstVariant.weightInGrams || 0,
    dimensions: firstVariant.dimensions || { heightInCm: 0, widthInCm: 0, lengthInCm: 0 },
    stock: firstVariant.stock || 0,
    variants,
  };
}

/**
 * Normaliza o payload bruto do webhook de produto da Nuvemshop.
 * Usa o produto embutido no webhook se disponível,
 * caso contrário retorna apenas o ID para busca posterior via API.
 */
export function normalizeWebhookProduct(payload) {
  const p = payload.product || payload;
  // Se o webhook trouxe o produto completo, normaliza direto
  if (p.variants && p.name) return { fromWebhook: true, product: normalizeProduct(p) };
  // Caso contrário, retorna só o ID para busca via API
  return { fromWebhook: false, productId: String(p.id || payload.id || "") };
}
