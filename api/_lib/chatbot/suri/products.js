/**
 * chatbot/suri/products.js
 * Criação e atualização de produtos na Suri.
 *
 * storeId agora vem resolvido via store mapping (passado pelo caller).
 * Fallback para getFirstStoreId apenas quando não há mapeamento configurado.
 */

import * as client from "./client.js";
import { getFirstStoreId, buildStocks } from "./stores.js";

function toSuriFormat(product, storeId) {
  // Monta as variações (campo `dimensions` na Suri).
  // Cada variação recebe: sku, preço, estoque, medidas, imagem própria e atributos (Cor, Tamanho, etc.)

  // Helper: retorna um SKU válido.
  // String(null) = "null" e String(undefined) = "undefined" — ambos rejeitados pela Suri.
  // Usa o ID do produto como fallback seguro.
  function buildSku(skuValue, fallbackId) {
    const s = skuValue != null ? String(skuValue).trim() : "";
    return s && s !== "null" && s !== "undefined" ? s : String(fallbackId);
  }

  // Helper: retorna o objeto image apenas quando há URL válida.
  // A Suri usa { url } para imagens — nunca enviar url nula (causa HTTP 400).
  function buildImage(variantImageUrl) {
    const url = variantImageUrl || product.images?.[0]?.url || "";
    if (!url || url === "null" || url === "undefined") return undefined;
    return { url };
  }

  const dimensions = (product.variants && product.variants.length > 0)
    ? product.variants.map(v => {
      const variantObj = {
        sku: buildSku(v.sku || product.sku, product.id),
        dimensions: Object.fromEntries(
          (v.attributes || []).map(a => [String(a.name), String(a.value)])
        ),
        price: v.price ?? product.price,
        promotionalPrice: v.promotionalPrice ?? product.promotionalPrice ?? 0,
        priceTables: {},
        stocks: buildStocks(storeId, v.stock ?? product.stock ?? 0),
        measurements: {
          weightInGrams: v.weightInGrams || product.weightInGrams || 0,
          heightInCm: v.dimensions?.heightInCm || product.dimensions?.heightInCm || 0,
          widthInCm: v.dimensions?.widthInCm || product.dimensions?.widthInCm || 0,
          lengthInCm: v.dimensions?.lengthInCm || product.dimensions?.lengthInCm || 0,
          unitsPerPackage: 1,
        },
        // Atributos da variação (ex: [{ name: "Cor", value: "Azul" }, { name: "Tamanho", value: "M" }])
        attributes: (v.attributes || []).map(a => ({
          name: String(a.name || ""),
          value: String(a.value || ""),
        })),
      };
      const img = buildImage(v.imageUrl);
      if (img) variantObj.image = img;
      return variantObj;
    })
    : [{
      sku: buildSku(product.sku, product.id),
      dimensions: {},
      ...(buildImage(null) ? { image: buildImage(null) } : {}),
      price: product.price,
      promotionalPrice: product.promotionalPrice ?? 0,
      priceTables: {},
      stocks: buildStocks(storeId, product.stock ?? 0),
      measurements: {
        weightInGrams: product.weightInGrams || 0,
        heightInCm: product.dimensions?.heightInCm || 0,
        widthInCm: product.dimensions?.widthInCm || 0,
        lengthInCm: product.dimensions?.lengthInCm || 0,
        unitsPerPackage: 1,
      },
      attributes: [],
    }];

  return {
    id: product.id,
    sku: buildSku(product.sku, product.id),
    categoryId: product.categoryId || null,
    subcategoryId: null,
    // A Suri espera um objeto ShopBrand, não uma string simples.
    // Enviar o nome como string causa HTTP 400 — campo mantido como null.
    brand: null,
    sellerId: "all",
    sellerName: null,
    isActive: product.isActive,
    name: product.name,
    description: product.description || "",
    url: product.url || null,
    price: product.price,
    promotionalPrice: product.promotionalPrice || 0,
    hasShippingRestriction: false,
    // Omite o campo `images` quando vazio — a Suri rejeita arrays vazios.
    // Filtra entradas com url nula/vazia antes de enviar (causa HTTP 400 na Suri).
    images: (() => {
      const imgs = (product.images || [])
        .filter(i => i && i.url && i.url !== "null" && i.url !== "undefined")
        .map(i => ({ url: i.url, description: i.description || null }));
      return imgs.length > 0 ? imgs : undefined;
    })(),
    attributes: (() => {
      // Agrega atributos das variações no formato que a Suri espera:
      // [{ name: "Cor", options: [{ name: "Azul" }, { name: "Vermelho" }] }]
      const attrMap = new Map();
      for (const v of (product.variants || [])) {
        for (const a of (v.attributes || [])) {
          if (!attrMap.has(a.name)) attrMap.set(a.name, new Set());
          attrMap.get(a.name).add(String(a.value));
        }
      }
      return Array.from(attrMap.entries()).map(([name, values]) => ({
        name,
        options: Array.from(values).map(v => ({ name: v })),
      }));
    })(),
    dimensions,
    weightInGrams: product.weightInGrams || 0,
  };
}

/**
 * Sincroniza um produto na Suri.
 *
 * Estratégia: POST primeiro (criar). Se a Suri indicar que o produto
 * já existe (HTTP 409, ou HTTP 400/422 com "already exists" / "duplicate"),
 * faz PUT (atualizar). Isso evita o erro de validação do campo `brand`
 * que ocorria quando se tentava PUT em produtos ainda não criados.
 *
 * @param {string} endpoint
 * @param {string} token
 * @param {object} product  - produto normalizado
 * @param {string|null} resolvedStoreId - ID da loja Suri resolvido via store mapping.
 *   Se null, usa getFirstStoreId como fallback.
 * @param {Map<string,string>|null} categoryIdMap - mapa nuvemshop_id → suri_id para categorias.
 */
export async function syncProduct(endpoint, token, product, resolvedStoreId = null, categoryIdMap = null) {
  const storeId = resolvedStoreId || await getFirstStoreId(endpoint, token) || "141301072";

  // Resolve o categoryId para o ID interno da Suri.
  // Se não houver mapeamento, envia null para evitar rejeição por ID de outra plataforma.
  const resolvedCategoryId = (() => {
    if (!product.categoryId) return null;
    if (categoryIdMap && categoryIdMap.size > 0) {
      const mapped = categoryIdMap.get(String(product.categoryId));
      return mapped || null;
    }
    // Sem mapa disponível: não envia o ID externo pois a Suri vai rejeitar
    return null;
  })();

  const productWithResolvedCategory = { ...product, categoryId: resolvedCategoryId };
  const suriPayload = toSuriFormat(productWithResolvedCategory, storeId);

  // 1) Verifica se o produto já existe na Suri pelo ID
  let exists = false;
  try {
    exists = await client.productExists(endpoint, token, product.id);
  } catch {
    // Se não conseguir verificar, tenta POST e deixa a Suri decidir
    exists = false;
  }

  if (exists) {
    // Produto já existe → PUT (atualizar)
    await client.updateProduct(endpoint, token, suriPayload);
    return { action: "product_updated", productId: product.id, storeId };
  }

  // Produto não existe → POST (criar)
  try {
    await client.createProduct(endpoint, token, suriPayload);
    return { action: "product_created", productId: product.id, storeId };
  } catch (createErr) {
    const msg = createErr.message || "";
    // Se a Suri retornar que o produto já existe (race condition ou ID duplicado),
    // tenta PUT como fallback
    const alreadyExists =
      msg.includes("HTTP 409") ||
      msg.includes("already exists") ||
      msg.includes("duplicate") ||
      msg.includes("já existe");
    if (alreadyExists) {
      await client.updateProduct(endpoint, token, suriPayload);
      return { action: "product_updated", productId: product.id, storeId };
    }
    throw createErr;
  }
}

export async function deactivateProduct(endpoint, token, productId) {
  try {
    await client.deactivateProduct(endpoint, token, productId);
    return { action: "product_deactivated", productId };
  } catch (err) {
    if (err.message.includes("404")) return { action: "product_not_found_in_suri", productId };
    throw err;
  }
}