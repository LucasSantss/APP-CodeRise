/**
 * ecommerce/nuvemshop/categories.js
 * Operações de categorias na API da Nuvemshop.
 */

import * as client from "./client.js";

/**
 * Busca todas as categorias da loja Nuvemshop.
 */
export async function fetchCategories(config) {
  const { store_id, access_token } = config;
  const data = await client.listCategories(store_id, access_token);
  return Array.isArray(data) ? data.map(normalizeCategory) : [];
}

/**
 * Busca uma categoria específica pelo ID.
 */
export async function fetchCategory(config, categoryId) {
  const { store_id, access_token } = config;
  const data = await client.getCategory(store_id, access_token, categoryId);
  return normalizeCategory(data);
}

/**
 * Normaliza uma categoria da Nuvemshop para o formato interno.
 */
export function normalizeCategory(c) {
  return {
    id: String(c.id),
    name: c.name?.pt || c.name?.es || Object.values(c.name || {})[0] || "",
    description: c.description?.pt || c.description?.es || "",
    parentId: c.parent ? String(c.parent.id) : null,
    googleShopping: c.google_shopping_category || null,
    seoTitle: c.seo_title?.pt || c.seo_title?.es || null,
    seoDescription: c.seo_description?.pt || c.seo_description?.es || null,
    handle: c.handle?.pt || c.handle?.es || null,
  };
}
