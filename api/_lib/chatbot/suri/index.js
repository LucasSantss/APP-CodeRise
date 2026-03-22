/**
 * chatbot/suri/index.js
 * Orquestra o fluxo direto: evento normalizado → ação na Suri.
 * Para produtos, busca dados completos via API do ecommerce antes de enviar.
 */

import { syncProduct, deactivateProduct } from "./products.js";
import { syncCategory } from "./categories.js";
import { createOrder, shipOrder, partiallyShipOrder, cancelOrder } from "./orders.js";

export async function processForwardEvent(endpoint, token, normalized, ecommerceConfig, ecommercePlatform) {
  const { eventType } = normalized;

  switch (eventType) {
    case "product.sync": {
      let product = normalized.product;
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
