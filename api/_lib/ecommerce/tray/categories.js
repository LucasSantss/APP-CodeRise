/**
 * ecommerce/tray/categories.js
 * Operações de categorias na API da Tray.
 */

import * as client from "./client.js";

export async function fetchCategories(config) {
  const { api_address, access_token } = config;
  let allCategories = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const batch = await client.listCategories(api_address, access_token, { page, limit: 50 });
    const items = batch.Categories || batch.categories || [];
    if (!items.length) { hasMore = false; break; }
    allCategories = allCategories.concat(items.map(normalizeCategory));
    hasMore = items.length >= 50;
    page++;
  }

  return allCategories;
}

export function normalizeCategory(item) {
  const c = item.Category || item;
  return {
    id: String(c.id || c.Id),
    name: c.name || c.Name || "",
    description: (c.description || c.Description || "").replace(/<[^>]+>/g, ""),
    parentId: c.father_category_id ? String(c.father_category_id) : null,
    handle: c.url || null,
  };
}
