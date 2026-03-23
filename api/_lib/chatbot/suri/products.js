/**
 * chatbot/suri/products.js
 * Criação e atualização de produtos na Suri.
 */

import * as client from "./client.js";
import { getFirstStoreId, buildStocks } from "./stores.js";

function toSuriFormat(product, storeId) {
  const dimensions = (product.variants && product.variants.length > 0)
    ? product.variants.map(v => ({
        sku: v.sku,
        dimensions: {},
        image: { url: v.imageUrl || product.images?.[0]?.url || "", description: null },
        price: v.price || product.price,
        priceTables: {},
        stocks: buildStocks(storeId, v.stock),
        measurements: {
          weightInGrams: v.weightInGrams || product.weightInGrams || 0,
          heightInCm: v.dimensions?.heightInCm || product.dimensions?.heightInCm || 0,
          widthInCm: v.dimensions?.widthInCm || product.dimensions?.widthInCm || 0,
          lengthInCm: v.dimensions?.lengthInCm || product.dimensions?.lengthInCm || 0,
          unitsPerPackage: 1,
        },
        attributes: v.attributes || [],
      }))
    : [{
        sku: product.sku,
        dimensions: {},
        image: { url: product.images?.[0]?.url || "", description: null },
        price: product.price,
        priceTables: {},
        stocks: buildStocks(storeId, product.stock),
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
    sku: product.sku,
    categoryId: product.categoryId || null,
    subcategoryId: null,
    brand: product.brand || null,
    sellerId: "all",
    sellerName: null,
    isActive: product.isActive,
    name: product.name,
    description: product.description || "",
    url: product.url || null,
    price: product.price,
    promotionalPrice: product.promotionalPrice || 0,
    hasShippingRestriction: false,
    images: product.images || [],
    attributes: [],
    dimensions,
    weightInGrams: product.weightInGrams || 0,
  };
}

/**
 * Sincroniza um produto na Suri — cria se não existir, atualiza se já existir.
 * A Suri retorna HTTP 400 com errorCode 1000 quando o produto não existe para PUT.
 */
export async function syncProduct(endpoint, token, product) {
  const storeId = await getFirstStoreId(endpoint, token) || "141301072";
  const suriPayload = toSuriFormat(product, storeId);

  try {
    await client.updateProduct(endpoint, token, suriPayload);
    return { action: "product_updated", productId: product.id, storeId };
  } catch (err) {
    const msg = err.message || "";
    const isNotFound = msg.includes("HTTP 404") || msg.includes("errorCode") || (msg.includes("HTTP 400") && msg.includes("not found"));
    if (isNotFound) {
      await client.createProduct(endpoint, token, suriPayload);
      return { action: "product_created", productId: product.id, storeId };
    }
    throw err;
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
