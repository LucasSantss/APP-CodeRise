/**
 * chatbot/suri/index.js
 * Orquestra o fluxo direto: evento normalizado → ação na Suri.
 * Para produtos, busca dados completos via API do ecommerce antes de enviar.
 */

export * from "./client.js";
export * from "./stores.js";
export * from "./products.js";
export * from "./categories.js";
export * from "./orders.js";

import { syncProduct, deactivateProduct } from "./products.js";
import { syncCategory } from "./categories.js";
import { createOrder, shipOrder, partiallyShipOrder, cancelOrder } from "./orders.js";

/**
 * Processa um evento normalizado e executa a ação correspondente na Suri.
 * Para product.sync com needsApiFetch=true, busca dados completos do ecommerce primeiro.
 *
 * @param {string} endpoint - URL base da Suri
 * @param {string} token - Token de autenticação da Suri
 * @param {object} normalized - Evento normalizado (saída do normalizeWebhook do ecommerce)
 * @param {object} ecommerceConfig - Credenciais do ecommerce para busca via API
 * @param {string} ecommercePlatform - Nome da plataforma (nuvemshop, shopify, etc.)
 */
export async function processForwardEvent(endpoint, token, normalized, ecommerceConfig, ecommercePlatform) {
  const { eventType } = normalized;

  switch (eventType) {
    case "product.sync": {
      let product = normalized.product;

      // FLUXO CORRETO: se precisar buscar via API (webhook trouxe só o ID)
      if (normalized.needsApiFetch && normalized.productId && ecommerceConfig) {
        product = await fetchProductFromEcommerce(ecommercePlatform, ecommerceConfig, normalized.productId);
      }

      if (!product) throw new Error(`Não foi possível obter dados do produto ${normalized.productId}`);
      return syncProduct(endpoint, token, product);
    }

    case "product.deleted":
      return deactivateProduct(endpoint, token, normalized.productId);

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

/**
 * Busca o produto completo via API do ecommerce pelo ID.
 * Suporta múltiplas plataformas — cada uma tem seu módulo próprio.
 */
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
