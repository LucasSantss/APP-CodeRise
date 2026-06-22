/**
 * ecommerce/woocommerce/categories.js
 * Operações de categorias de produto no WooCommerce.
 */

import * as client from "./client.js";

export async function fetchCategories(config) {
  const { site_url, consumer_key, consumer_secret } = config;
  let allCategories = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const batch = await client.listCategories(site_url, consumer_key, consumer_secret, { page, per_page: 100 });
    if (!batch.length) { hasMore = false; break; }
    allCategories = allCategories.concat(batch.map(normalizeCategory));
    hasMore = batch.length >= 100;
    page++;
  }

  return allCategories;
}

export function normalizeCategory(c) {
  return {
    id: String(c.id),
    name: c.name || "",
    description: (c.description || "").replace(/<[^>]+>/g, ""),
    parentId: c.parent ? String(c.parent) : null,
    handle: c.slug || null,
  };
}
