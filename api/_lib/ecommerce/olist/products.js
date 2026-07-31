/**
 * ecommerce/olist/products.js
 * Busca o produto completo via API da Olist pelo ID recebido no webhook,
 * e normaliza para o formato interno do CodeRise.
 *
 * FLUXO CORRETO:
 * Webhook traz ID → buscamos o produto completo na API → normalizamos → enviamos à Suri
 */

import * as client from "./client.js";
import { UNCATEGORIZED_ID } from "./categories.js";

// A Olist retorna image_url como URL protocol-relative (ex: "//cdn.vnda.com.br/...");
// sem o "https:" na frente, alguns consumidores da Suri não resolvem a imagem.
function toAbsoluteUrl(url) {
  if (!url) return null;
  return url.startsWith("//") ? `https:${url}` : url;
}

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
 *   p.category_tags (array de { name, tag_type, title }),
 *   p.images (array de { url }),
 *   p.variants (array de variantes)
 *
 * Variante:
 *   v.sku, v.price, v.sale_price, v.quantity/v.stock (estoque),
 *   v.weight, v.height, v.width, v.length, v.image_url,
 *   v.properties (objeto { property1: { name, value }, property2: {...}, ... } — não é array)
 */
export function normalizeProduct(p) {
  const productImages = p.images || [];

  // GET /products (listagem, usada na sincronização em lote) não retorna o
  // array "images" — só um "image_url" único no nível do produto. GET
  // /products/{id} (detalhe, usado no fluxo de webhook) retorna o array
  // completo. Usamos p.image_url como fallback para não perder a imagem
  // quando o produto vem da listagem.
  const fallbackImageUrl = toAbsoluteUrl(p.image_url);

  const variants = (p.variants || []).map(v => {
    const rawSku = v.sku != null ? String(v.sku).trim() : "";
    const safeSku = rawSku && rawSku !== "null" && rawSku !== "undefined"
      ? rawSku
      : String(p.id);

    // Imagem da variante: usa v.image_url quando presente; senão procura em
    // p.images a imagem cujo variant_ids referencia o id desta variante.
    const linkedImage = productImages.find(img => (img.variant_ids || []).some(id => String(id) === String(v.id)));

    return {
      sku: safeSku,
      price: parseFloat(v.price || p.price || 0),
      promotionalPrice: parseFloat(v.sale_price || v.promotional_price || p.promotional_price || 0),
      weightInGrams: parseFloat(v.weight || v.weight_g || 0),
      dimensions: {
        heightInCm: parseFloat(v.height || v.height_cm || 0),
        widthInCm:  parseFloat(v.width  || v.width_cm  || 0),
        lengthInCm: parseFloat(v.length || v.length_cm || 0),
      },
      // A Olist retorna "properties" como objeto ({ property1: {...}, property2: {...} }),
      // não array — Object.values normaliza ambos os formatos com segurança.
      stock: parseInt(v.quantity ?? v.stock ?? 0),
      attributes: Object.values(v.properties || {}).map(prop => ({
        name:  String(prop.name  || ""),
        value: String(prop.value || ""),
      })),
      imageUrl: toAbsoluteUrl(v.image_url || linkedImage?.url) || fallbackImageUrl,
    };
  });

  const firstVariant = variants[0] || {};

  // Categoria: pega a primeira tag do tipo "categoria". Tags de outros tipos
  // (estampa, coleção, etc.) nunca são sincronizadas como categoria na Suri,
  // então usá-las aqui causaria "Category with id X not found".
  // Sem tag de categoria (ex: Gift Cards) → usa a categoria "Sem categoria".
  const productTags = p.category_tags || p.tags || [];
  const categoryTag = productTags.find(t => String(t.tag_type || "").toLowerCase() === "categoria");
  const categoryId = categoryTag ? String(categoryTag.name || "") : UNCATEGORIZED_ID;

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
    images: productImages.length > 0
      ? productImages.map(i => ({
          url:         toAbsoluteUrl(i.url || i.src) || "",
          description: i.alt  || null,
        }))
      : (fallbackImageUrl ? [{ url: fallbackImageUrl, description: null }] : []),
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
