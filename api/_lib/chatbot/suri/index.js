/**
 * chatbot/suri/index.js
 * Orquestra o fluxo direto: evento normalizado → ação na Suri.
 *
 * STORE MAPPING: resolve loja Suri de destino via _store_mappings no ecommerceConfig.
 * CATEGORY MAPPING: resolve categoryId externo → ID interno da Suri antes de sincronizar produto.
 *
 * Erros enriquecidos com contexto para aparecerem legíveis nos Logs do app.
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

async function buildCategoryIdMap(endpoint, token) {
  try {
    const categories = await listCategories(endpoint, token);
    const map = new Map();
    for (const c of categories) {
      const suriId = String(c.id || "");
      if (!suriId) continue;
      if (c.externalId) map.set(String(c.externalId), suriId);
      map.set(suriId, suriId);
      // Alguns campos alternativos de ID externo
      if (c.providerId) map.set(String(c.providerId), suriId);
    }
    return map;
  } catch (err) {
    // Retorna mapa vazio — produto pode falhar por falta de categoria,
    // mas o erro virá da Suri com mensagem clara
    console.error("[CategoryMap] Falha ao listar categorias da Suri:", err.message);
    return new Map();
  }
}

function resolveCategoryId(externalCategoryId, categoryIdMap) {
  if (!externalCategoryId) return null;
  const key = String(externalCategoryId);
  if (categoryIdMap.size === 0) return null;
  return categoryIdMap.get(key) || null;
}

// ─── Entry point ────────────────────────────────────────────────────────────────

export async function processForwardEvent(endpoint, token, normalized, ecommerceConfig, ecommercePlatform) {
  const { eventType } = normalized;
  const resolvedStoreId = resolveStoreId(ecommerceConfig);

  switch (eventType) {

    case "product.sync": {
      // 1) Busca o produto atualizado via API (nunca usa o payload do webhook)
      let product;
      try {
        product = await fetchProductFromEcommerce(ecommercePlatform, ecommerceConfig, normalized.productId);
      } catch (err) {
        throw new Error(`Falha ao buscar produto #${normalized.productId} na ${ecommercePlatform}: ${err.message}`);
      }

      if (!product) {
        throw new Error(`Produto #${normalized.productId} não encontrado na ${ecommercePlatform}.`);
      }

      // 2) Monta mapa de categorias Suri para resolver o ID correto
      const categoryIdMap = await buildCategoryIdMap(endpoint, token);
      let resolvedCategoryId = resolveCategoryId(product.categoryId, categoryIdMap);

      // 3) Categoria ainda não existe na Suri → sincroniza on-the-fly
      if (product.categoryId && !resolvedCategoryId) {
        console.log(`[ProductSync] Categoria externa #${product.categoryId} não encontrada na Suri — sincronizando...`);
        const catResult = await syncCategoryFromEcommerce(
          endpoint, token, ecommercePlatform, ecommerceConfig,
          product.categoryId, resolvedStoreId
        );
        resolvedCategoryId = catResult?.suriId || catResult?.categoryId || null;
        if (!resolvedCategoryId) {
          throw new Error(
            `Produto #${product.id}: categoria externa #${product.categoryId} não pôde ser sincronizada na Suri. ` +
            `Crie a categoria manualmente na Suri antes de sincronizar este produto.`
          );
        }
      }

      // 4) Injeta categoryId resolvido e sincroniza
      const productToSync = { ...product, categoryId: resolvedCategoryId };
      return syncProduct(endpoint, token, productToSync, resolvedStoreId);
    }

    case "product.deleted":
      return deactivateProduct(endpoint, token, normalized.productId);

    case "category.sync": {
      let category = normalized.category;
      if (normalized.needsApiFetch && normalized.categoryId && ecommerceConfig) {
        try {
          category = await fetchCategoryFromEcommerce(ecommercePlatform, ecommerceConfig, normalized.categoryId);
        } catch (err) {
          throw new Error(`Falha ao buscar categoria #${normalized.categoryId} na ${ecommercePlatform}: ${err.message}`);
        }
      }
      if (!category) throw new Error(`Categoria #${normalized.categoryId} não encontrada na ${ecommercePlatform}.`);
      if (!category.name) throw new Error(`Categoria #${category.id} sem nome — verifique os dados na plataforma.`);
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

async function syncCategoryFromEcommerce(endpoint, token, platform, config, categoryId, resolvedStoreId) {
  try {
    const category = await fetchCategoryFromEcommerce(platform, config, categoryId);
    if (!category || !category.name) return null;
    return await syncCategory(endpoint, token, category, resolvedStoreId);
  } catch (err) {
    console.error(`[CategorySync] Falha ao sincronizar categoria #${categoryId}:`, err.message);
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
