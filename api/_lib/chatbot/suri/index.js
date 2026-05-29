/**
 * chatbot/suri/index.js
 * Orquestra o fluxo direto: evento normalizado → ação na Suri.
 *
 * FLUXO product.sync:
 *   1. Webhook recebe ID do produto
 *   2. GET Nuvemshop /products/{id} + /products/{id}/variants  → dados atualizados
 *   3. GET Suri /api/shop/categories                           → monta mapa externalId→suriId
 *   4. Resolve categoryId: nuvemshop_id → suriId interno
 *   5. Se categoria não existe na Suri → sincroniza on-the-fly via GET Nuvemshop /categories/{id}
 *   6. PUT Suri /api/shop/products (com categoryId correto)
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
  return mappings[0]?.chatbotStoreId ? String(mappings[0].chatbotStoreId) : null;
}

// ─── Category ID mapping ────────────────────────────────────────────────────────
// A Suri usa IDs internos próprios para categorias.
// O produto vem da Nuvemshop com categoryId = ID da Nuvemshop.
// Precisamos cruzar com as categorias da Suri pelo campo externalId.

async function buildCategoryIdMap(endpoint, token) {
  try {
    const categories = await listCategories(endpoint, token);
    const map = new Map();
    for (const c of categories) {
      const suriId = String(c.id || "");
      if (!suriId) continue;
      // externalId = ID da plataforma e-commerce (Nuvemshop)
      if (c.externalId)  map.set(String(c.externalId), suriId);
      if (c.providerId)  map.set(String(c.providerId), suriId);
      // Mapeia o próprio ID interno também (cobertura extra)
      map.set(suriId, suriId);
    }
    return map;
  } catch (err) {
    console.error("[CategoryMap] Falha ao listar categorias da Suri:", err.message);
    return new Map();
  }
}

// ─── Entry point ────────────────────────────────────────────────────────────────

export async function processForwardEvent(endpoint, token, normalized, ecommerceConfig, ecommercePlatform) {
  const { eventType } = normalized;
  const resolvedStoreId = resolveStoreId(ecommerceConfig);

  switch (eventType) {

    case "product.sync": {
      // PASSO 1 — Busca produto atualizado na API da plataforma e-commerce.
      // O nuvemshop/index.js sempre envia needsApiFetch:true — mas por segurança
      // o fetch acontece sempre, independente desse flag.
      const productIdToFetch = normalized.productId || normalized.product?.id;
      if (!productIdToFetch) {
        throw new Error(`product.sync sem productId no payload: ${JSON.stringify(normalized).slice(0, 200)}`);
      }
      let product;
      try {
        product = await fetchProductFromEcommerce(ecommercePlatform, ecommerceConfig, productIdToFetch);
      } catch (err) {
        throw new Error(`GET produto #${productIdToFetch} na ${ecommercePlatform} falhou: ${err.message}`);
      }
      if (!product) {
        throw new Error(`Produto #${productIdToFetch} não encontrado na ${ecommercePlatform}.`);
      }

      // PASSO 2 — Monta mapa categoryId-nuvemshop → suriId interno
      const categoryIdMap = await buildCategoryIdMap(endpoint, token);
      let resolvedCategoryId = product.categoryId
        ? (categoryIdMap.get(String(product.categoryId)) || null)
        : null;

      // PASSO 3 — Se categoria não existe na Suri, sincroniza on-the-fly
      if (product.categoryId && !resolvedCategoryId) {
        try {
          const catData = await fetchCategoryFromEcommerce(ecommercePlatform, ecommerceConfig, product.categoryId);
          if (catData?.name) {
            const catResult = await syncCategory(endpoint, token, catData, resolvedStoreId);
            // suriId retornado pelo syncCategory
            resolvedCategoryId = catResult?.suriId || catResult?.categoryId || null;
          }
        } catch (err) {
          // Falha silenciosa: lança erro descritivo para aparecer no log
          throw new Error(
            `Produto #${product.id}: categoria #${product.categoryId} não existe na Suri e não pôde ser criada: ${err.message}. ` +
            `Crie a categoria manualmente na Suri ou dispare o webhook de criação de categoria.`
          );
        }
      }

      // PASSO 4 — Envia produto com categoryId correto para a Suri
      const productToSync = { ...product, categoryId: resolvedCategoryId };
      return syncProduct(endpoint, token, productToSync, resolvedStoreId);
    }

    case "product.deleted":
      return deactivateProduct(endpoint, token, normalized.productId);

    case "category.sync": {
      // Busca dados completos da categoria na API quando necessário
      let category = normalized.category;
      if (!category || normalized.needsApiFetch) {
        try {
          category = await fetchCategoryFromEcommerce(ecommercePlatform, ecommerceConfig, normalized.categoryId || normalized.category?.id);
        } catch (err) {
          throw new Error(`GET categoria #${normalized.categoryId} na ${ecommercePlatform} falhou: ${err.message}`);
        }
      }
      if (!category) throw new Error(`Categoria #${normalized.categoryId} não encontrada.`);
      if (!category.name) throw new Error(`Categoria #${category.id} sem nome — verifique na plataforma.`);
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

// ─── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchCategoryFromEcommerce(platform, config, categoryId) {
  switch (platform) {
    case "nuvemshop": {
      const { fetchCategory } = await import("../../ecommerce/nuvemshop/categories.js");
      return fetchCategory(config, categoryId);
    }
    default:
      throw new Error(`Busca de categoria via API não implementada para: ${platform}`);
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
      throw new Error(`Busca de produto via API não implementada para: ${platform}`);
  }
}
