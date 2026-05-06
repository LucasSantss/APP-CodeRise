/**
 * chatbot/suri/index.js
 * Orquestra o fluxo direto: evento normalizado → ação na Suri.
 */

import { syncProduct, deactivateProduct } from "./products.js";
import { syncCategory } from "./categories.js";
import { createOrder, shipOrder, partiallyShipOrder, cancelOrder } from "./orders.js";

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
      return syncProduct(endpoint, token, product, resolvedStoreId);
    }

    case "product.deleted":
      return deactivateProduct(endpoint, token, normalized.productId);

    case "category.sync": {
      let category = normalized.category;
      // Se o payload só trouxe o ID (needsApiFetch: true), busca dados completos na API
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
