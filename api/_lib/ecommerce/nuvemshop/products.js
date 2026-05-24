/**
 * ecommerce/nuvemshop/products.js
 * Busca o produto completo via API da Nuvemshop pelo ID recebido no webhook,
 * e normaliza para o formato interno do CodeRise.
 *
 * FLUXO CORRETO:
 * Webhook traz ID → buscamos produto + variantes (endpoint separado) → normalizamos → Suri
 *
 * POR QUE BUSCAR /variants SEPARADO?
 * O endpoint GET /products/{id} retorna as variantes mas o campo `stock` pode
 * estar desatualizado (cache interno da Nuvemshop). O endpoint dedicado
 * GET /products/{id}/variants sempre retorna o estoque real e atualizado.
 */

import * as client from "./client.js";

/**
 * Busca o produto completo + variantes atualizadas na API da Nuvemshop e normaliza.
 * Garante dados sempre atualizados, independente do que veio no webhook.
 */
export async function fetchAndNormalizeProduct(config, productId) {
  const { store_id, access_token } = config;

  // Busca produto e variantes em paralelo para agilizar
  const [p, variantsFromApi] = await Promise.all([
    client.getProduct(store_id, access_token, productId),
    client.getProductVariants(store_id, access_token, productId).catch(() => null),
  ]);

  // Injeta as variantes atualizadas no objeto do produto antes de normalizar
  // O endpoint /variants retorna estoque real; o embutido em /products pode ser stale
  if (variantsFromApi && Array.isArray(variantsFromApi) && variantsFromApi.length > 0) {
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
  // Cruzamos pelo índice para montar { name: "Cor", value: "Branco" }
  const productAttributes = p.attributes || [];

  /** Extrai a string de um campo multilíngue da Nuvemshop ({ pt, es, en, ... }) */
  function i18n(field) {
    if (!field || typeof field === "string") return field || "";
    return field.pt || field.es || field.en || Object.values(field)[0] || "";
  }

  const variants = (p.variants || []).map(v => {
    const rawSku = v.sku != null ? String(v.sku).trim() : "";
    const safeSku = rawSku && rawSku !== "null" && rawSku !== "undefined" ? rawSku : String(p.id);

    // stock_management: "none" significa produto sem controle de estoque na Nuvemshop.
    // Nesses casos, v.stock é null — enviamos um valor alto (999) para a Suri
    // sinalizar disponibilidade ilimitada, em vez de enviar 0 e parecer esgotado.
    const stockRaw = v.stock_management === "none"
      ? 999
      : parseInt(v.stock ?? 0, 10);

    return {
      id: String(v.id),
      sku: safeSku,
      price: parseFloat(v.price || p.price || 0),
      promotionalPrice: parseFloat(v.promotional_price || p.promotional_price || 0),
      weightInGrams: parseFloat(v.weight || 0) * 1000,
      dimensions: {
        heightInCm: parseFloat(v.height || 0),
        widthInCm:  parseFloat(v.width  || 0),
        lengthInCm: parseFloat(v.depth  || 0),
      },
      stock: stockRaw,
      // v.values é um array paralelo a p.attributes — cruzamos pelo índice
      attributes: (v.values || []).map((val, idx) => ({
        name:  i18n(productAttributes[idx]) || String(idx),
        value: i18n(val),
      })),
      imageUrl: v.image?.src || null,
    };
  });

  // Estoque total = soma de todas as variantes (para o campo raiz `stock`)
  const totalStock = variants.reduce((sum, v) => sum + (v.stock || 0), 0);

  const firstVariant = variants[0] || {};

  return {
    id:               String(p.id),
    sku:              firstVariant.sku || String(p.id),
    name:             p.name?.pt || p.name?.es || Object.values(p.name || {})[0] || "",
    description:      (p.description?.pt || p.description?.es || "").replace(/<[^>]+>/g, ""),
    categoryId:       String(p.categories?.[0]?.id || ""),
    brand:            p.brand || null,
    isActive:         !!(p.published ?? p.published_at),
    price:            firstVariant.price || 0,
    promotionalPrice: firstVariant.promotionalPrice || 0,
    url:              p.canonical_url || null,
    images:           (p.images || []).map(i => ({
      url:         i.src,
      description: Array.isArray(i.alt) ? (i.alt[0] || null) : (i.alt || null),
    })),
    weightInGrams: firstVariant.weightInGrams || 0,
    dimensions:    firstVariant.dimensions || { heightInCm: 0, widthInCm: 0, lengthInCm: 0 },
    stock:         totalStock,
    variants,
  };
}

/**
 * Normaliza o payload bruto do webhook de produto da Nuvemshop.
 * Webhooks NÃO são confiáveis para estoque (podem trazer dados desatualizados).
 * Sempre retorna needsApiFetch: true para forçar busca via API.
 */
export function normalizeWebhookProduct(payload) {
  const p = payload.product || payload;
  const productId = String(p.id || payload.id || "");
  // Força busca via API mesmo que o webhook traga o produto embutido,
  // pois o estoque no payload do webhook pode estar desatualizado.
  return { fromWebhook: false, productId };
}
