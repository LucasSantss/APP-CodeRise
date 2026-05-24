/**
 * chatbot/suri/index.js
 * Orquestra o fluxo direto: evento normalizado → ação na Suri.
 *
 * STORE MAPPING:
 *   ecommerceConfig._store_mappings é um JSON array:
 *   [{ ecommerceStoreId, ecommerceStoreName, chatbotStoreId, chatbotStoreName }]
 *
 * CATEGORY ID MAPPING:
 *   A Suri usa IDs internos próprios para categorias.
 *   Quando um produto chega da Nuvemshop, o categoryId é o ID da Nuvemshop.
 *   Antes de sincronizar o produto, buscamos todas as categorias da Suri,
 *   construímos um mapa { nuvemshop_id → suri_id } e resolvemos o categoryId
 *   correto. Sem isso, a Suri rejeita com errorCode:1003 ("Product must have a category").
 *
 *   O mapa é construído uma vez por chamada a processForwardEvent e não é
 *   persistido entre requests (stateless serverless).
 */

import { syncProduct, deactivateProduct } from "./products.js";
import { syncCategory, listCategories } from "./categories.js";
import { createOrder, shipOrder, partiallyShipOrder, cancelOrder } from "./orders.js";

// ─── Store mapping ─────────────────────────────────────────────────────────────

function resolveStoreId(ecommerceConfig) {
  if (!ecommerceConfig?._store_mappings) return null;
  let mappings;
  try {
    mappings = typeof ecommerceConfig._store_mappings === "string"
      ? JSON.parse(ecommerceConfig._store_mappings)
      : ecommerceConfig._store_mappings;
  } catch { return null; }
  if (!Array.isArray(mappings) || mappings.length === 0) return null;
  const ecommerceStoreId = String(ecommerceConfig.store_id || "");
  if (ecommerceStoreId) {
    const match = mappings.find(m => String(m.ecommerceStoreId) === ecommerceStoreId);
    if (match?.chatbotStoreId) return String(match.chatbotStoreId);
  }
  if (mappings[0]?.chatbotStoreId) return String(mappings[0].chatbotStoreId);
  return null;
}

// ─── Category ID mapping ────────────────────────────────────────────────────────

/**
 * Busca todas as categorias da Suri e constrói um mapa:
 *   externalId (= ID da plataforma de e-commerce) → id interno da Suri
 *
 * A Suri retorna cada categoria com:
 *   { id: "suri-uuid", name: "...", externalId: "nuvemshop-id", ... }
 *
 * Quando externalId não existe (categoria criada manualmente na Suri),
 * o mapa também inclui id → id para cobrir casos onde o categoryId do produto
 * já seja o ID interno da Suri.
 *
 * @returns {Map<string, string>} externalId/suriId → suriId
 */
async function buildCategoryIdMap(endpoint, token) {
  try {
    const categories = await listCategories(endpoint, token);
    const map = new Map();
    for (const c of categories) {
      const suriId = String(c.id || "");
      if (!suriId) continue;
      // Mapeia pelo externalId (= ID da Nuvemshop)
      if (c.externalId) map.set(String(c.externalId), suriId);
      // Mapeia pelo próprio ID da Suri (cobertura extra)
      map.set(suriId, suriId);
    }
    return map;
  } catch {
    // Se não conseguir listar categorias, retorna mapa vazio.
    // syncProduct vai deixar categoryId como null e a Suri vai rejeitar
    // com errorCode:1003 — mas isso é melhor do que uma exceção não tratada.
    return new Map();
  }
}

/**
 * Resolve o categoryId do produto para o ID interno da Suri.
 * - Se houver mapeamento, retorna o suriId correspondente.
 * - Se não houver mapeamento mas o produto tem categoryId, tenta
 *   usar direto (pode já ser o ID interno).
 * - Se não houver nenhuma categoria, retorna null.
 *
 * IMPORTANTE: se retornar null, o produto será rejeitado pela Suri (errorCode:1003).
 * Nesse caso, o produto precisa ter suas categorias sincronizadas primeiro.
 */
function resolveCategoryId(externalCategoryId, categoryIdMap) {
  if (!externalCategoryId) return null;
  const key = String(externalCategoryId);
  if (categoryIdMap.size > 0) {
    const mapped = categoryIdMap.get(key);
    if (mapped) return mapped;
  }
  return null;
}

// ─── Entry point ────────────────────────────────────────────────────────────────

export async function processForwardEvent(endpoint, token, normalized, ecommerceConfig, ecommercePlatform) {
  const { eventType } = normalized;
  const resolvedStoreId = resolveStoreId(ecommerceConfig);

  switch (eventType) {

    case "product.sync": {
      let product = normalized.product;
      if (normalized.needsApiFetch && normalized.productId && ecommerceConfig) {
        product = await fetchProductFromEcommerce(ecommercePlatform, ecommerceConfig, normalized.productId);
      }
      if (!product) throw new Error(`Não foi possível obter dados do produto ${normalized.productId}`);

      // Constrói o mapa de categorias (nuvemshop_id → suri_id) antes de sincronizar
      const categoryIdMap = await buildCategoryIdMap(endpoint, token);

      // Resolve o categoryId do produto para o ID interno da Suri
      const resolvedCategoryId = resolveCategoryId(product.categoryId, categoryIdMap);

      // Se o produto tem categoria na Nuvemshop mas não encontrou na Suri,
      // tenta sincronizar a categoria primeiro, depois reenvia o produto
      if (product.categoryId && !resolvedCategoryId) {
        const categoryResult = await syncCategoryFromEcommerce(
          endpoint, token, ecommercePlatform, ecommerceConfig,
          product.categoryId, resolvedStoreId
        );
        // Depois da sincronização, o suriId está no resultado
        const newSuriId = categoryResult?.suriId || null;

        const productWithCategory = { ...product, categoryId: newSuriId };
        return syncProduct(endpoint, token, productWithCategory, resolvedStoreId, null);
      }

      // Categoria já mapeada: injeta o suriId no produto antes de enviar
      const productWithResolvedCategory = { ...product, categoryId: resolvedCategoryId };
      return syncProduct(endpoint, token, productWithResolvedCategory, resolvedStoreId, null);
    }

    case "product.deleted":
      return deactivateProduct(endpoint, token, normalized.productId);

    case "category.sync": {
      let category = normalized.category;
      if (normalized.needsApiFetch && normalized.categoryId && ecommerceConfig) {
        category = await fetchCategoryFromEcommerce(ecommercePlatform, ecommerceConfig, normalized.categoryId);
      }
      if (!category) throw new Error(`Não foi possível obter dados da categoria ${normalized.categoryId}`);
      if (!category.name) throw new Error(`Categoria ${category.id} sem nome — verifique os dados na plataforma.`);
      return syncCategory(endpoint, token, category, resolvedStoreId);
    }

    case "category.deleted":
      return {
        action: "category_delete_ignored",
        categoryId: normalized.categoryId,
        storeId: resolvedStoreId,
        note: "Remoção de categoria não propagada à Suri (operação não suportada via webhook).",
      };

    case "order.created":
      return createOrder(endpoint, token, normalized);

    case "order.shipped":
      return shipOrder(endpoint, token, normalized);

    case "order.partially_shipped":
      return partiallyShipOrder(endpoint, token, normalized);

    case "order.cancelled":
      return cancelOrder(endpoint, token, normalized);

    default:
      return { action: "no_mapping", eventType };
  }
}

// ─── Helpers internos ──────────────────────────────────────────────────────────

/**
 * Sincroniza a categoria da plataforma e-commerce na Suri on-the-fly,
 * chamado quando o produto tem uma categoria não encontrada no mapeamento.
 */
async function syncCategoryFromEcommerce(endpoint, token, platform, config, categoryId, resolvedStoreId) {
  try {
    const category = await fetchCategoryFromEcommerce(platform, config, categoryId);
    if (!category || !category.name) return null;
    return await syncCategory(endpoint, token, category, resolvedStoreId);
  } catch {
    return null;
  }
}

async function fetchCategoryFromEcommerce(platform, config, categoryId) {
  switch (platform) {
    case "nuvemshop": {
      const { fetchCategory } = await import("../../ecommerce/nuvemshop/categories.js");
      return fetchCategory(config, categoryId);
    }
    default:
      throw new Error(`Busca de categoria via API não implementada para plataforma: ${platform}`);
  }
}

async function fetchProductFromEcommerce(platform, config, productId) {
  switch (platform) {
    case "nuvemshop": {
      const { fetchAndNormalizeProduct } = await import("../../ecommerce/nuvemshop/products.js");
      return fetchAndNormalizeProduct(config, productId);
    }
    case "shopify": {
      const { fetchAndNormalizeProduct } = await import("../../ecommerce/shopify/products.js");
      return fetchAndNormalizeProduct(config, productId);
    }
    case "woocommerce": {
      const { fetchAndNormalizeProduct } = await import("../../ecommerce/woocommerce/products.js");
      return fetchAndNormalizeProduct(config, productId);
    }
    case "vtex": {
      const { fetchAndNormalizeProduct } = await import("../../ecommerce/vtex/products.js");
      return fetchAndNormalizeProduct(config, productId);
    }
    case "tray": {
      const { fetchAndNormalizeProduct } = await import("../../ecommerce/tray/products.js");
      return fetchAndNormalizeProduct(config, productId);
    }
    default:
      throw new Error(`Busca via API não implementada para plataforma: ${platform}`);
  }
}
