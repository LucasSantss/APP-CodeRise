/**
 * ecommerce/shopify/categories.js
 * Operações de categorias na Shopify — usa Custom Collections como categorias.
 */

import * as client from "./client.js";

export async function fetchCategories(config) {
  const { store_url, api_token, api_version } = config;
  let allCollections = [];
  let pageInfo = null;

  do {
    const params = { limit: 250 };
    if (pageInfo) params.page_info = pageInfo;
    const batch = await client.listCustomCollections(store_url, api_token, params, api_version);
    if (!batch.length) break;
    allCollections = allCollections.concat(batch.map(normalizeCategory));
    pageInfo = batch.length >= 250 ? "next" : null; // Shopify usa cursor real via Link header; simplificado aqui
  } while (pageInfo && allCollections.length < 5000);

  return allCollections;
}

export function normalizeCategory(c) {
  return {
    id: String(c.id),
    name: c.title || "",
    description: (c.body_html || "").replace(/<[^>]+>/g, ""),
    parentId: null,
    handle: c.handle || null,
  };
}
