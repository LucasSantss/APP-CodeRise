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

  // Busca produto e variantes em paralelo.
  // GET /products/{id}/variants retorna estoque real e atualizado;
  // o campo variants embutido em /products/{id} pode estar em cache.
  const [p, variantsFromApi] = await Promise.all([
    client.getProduct(store_id, access_token, productId),
    client.getProductVariants(store_id, access_token, productId).catch(() => null),
  ]);

  // Injeta variantes atualizadas antes de normalizar
  if (Array.isArray(variantsFromApi) && variantsFromApi.length > 0) {
    p.variants = variantsFromApi;
  }

  return normalizeProduct(p);
}

/**
 * Normaliza um produto já carregado da API da Nuvemshop
 * para o formato interno do CodeRise.
 */
export function normalizeProduct(p) {
  // p.attributes é [{ "pt": "Cor" }, { "pt": "Tamanho" }]
  // v.values    é [{ "pt": "Branco" }, { "pt": "P" }]
  // Precisamos cruzar pelo índice para montar { name: "Cor", value: "Branco" }
  const productAttributes = p.attributes || [];

  /** Extrai a string de um campo multilíngue da Nuvemshop ({ pt, es, en, ... }) */
  function i18n(field) {
    if (!field || typeof field === "string") return field || "";
    return field.pt || field.es || field.en || Object.values(field)[0] || "";
  }

  const variants = (p.variants || []).map(v => {
    const rawSku = v.sku != null ? String(v.sku).trim() : "";
    const safeSku = rawSku && rawSku !== "null" && rawSku !== "undefined" ? rawSku : String(p.id);
    return {
      sku: safeSku,
      price: parseFloat(v.price || p.price || 0),
      promotionalPrice: parseFloat(v.promotional_price || p.promotional_price || 0),
      weightInGrams: parseFloat(v.weight || 0) * 1000,
      dimensions: {
        heightInCm: parseFloat(v.height || 0),
        widthInCm: parseFloat(v.width || 0),
        lengthInCm: parseFloat(v.depth || 0),
      },
      stock: parseInt(v.stock || 0),
      // v.values é um array paralelo a p.attributes — cruzamos pelo índice
      attributes: (v.values || []).map((val, idx) => ({
        name: i18n(productAttributes[idx]) || String(idx),
        value: i18n(val),
      })),
      imageUrl: v.image?.src || null,
    };
  });

  const firstVariant = variants[0] || {};

  return {
    id: String(p.id),
    sku: firstVariant.sku || String(p.id),
    name: p.name?.pt || p.name?.es || Object.values(p.name || {})[0] || "",
    description: (p.description?.pt || p.description?.es || "").replace(/<[^>]+>/g, ""),
    categoryId: String(p.categories?.[0]?.id || ""),
    brand: p.brand || null,
    isActive: !!(p.published ?? p.published_at),
    price: firstVariant.price || 0,
    promotionalPrice: firstVariant.promotionalPrice || 0,
    url: p.canonical_url || null,
    images: (p.images || []).map(i => ({ url: i.src, description: Array.isArray(i.alt) ? (i.alt[0] || null) : (i.alt || null) })),
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