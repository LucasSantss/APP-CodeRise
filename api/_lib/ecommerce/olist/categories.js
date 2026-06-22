/**
 * ecommerce/olist/categories.js
 * Operações de categorias (tags) na API da Olist Ecommerce.
 *
 * Na Olist, categorias são implementadas como "tags" com um tag_type.
 * Endpoint: GET /api/v2/tags
 */

import * as client from "./client.js";

/**
 * Busca todas as categorias (tags) da loja Olist.
 */
export async function fetchCategories(config) {
  const { store_url, access_token } = config;
  let allTags = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const batch = await client.listCategories(store_url, access_token, { page, per_page: 50 });
    const items = Array.isArray(batch) ? batch : (batch.tags || []);
    if (!items.length) { hasMore = false; break; }
    allTags = allTags.concat(items.map(normalizeCategory));
    hasMore = items.length >= 50;
    page++;
  }

  return allTags;
}

/**
 * Normaliza uma categoria (tag) da Olist para o formato interno.
 *
 * Estrutura típica:
 *   { name, tag_type, description, title, slug, ... }
 */
export function normalizeCategory(c) {
  return {
    id:          String(c.name || c.id || ""),   // Na Olist, o "name" da tag é o identificador único
    name:        c.title || c.name || "",
    description: c.description || "",
    parentId:    c.parent || null,
    tagType:     c.tag_type || null,
    handle:      c.slug || c.name || null,
  };
}
