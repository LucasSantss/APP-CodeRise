/**
 * ecommerce/olist/categories.js
 * Operações de categorias (tags) na API da Olist Ecommerce (Vnda).
 *
 * Na Olist, categorias são implementadas como "tags" com type="categoria".
 * Endpoint: GET /api/v2/tags (doc: https://developers.vnda.com.br/api/operations/get-api-v2-tags/)
 * Cada tag retornada por /tags usa o campo "type"; já as tags embutidas em
 * produtos (GET /products → category_tags) usam o campo "tag_type" — são
 * nomes diferentes para o mesmo conceito, então normalizeCategory aceita os dois.
 */

import * as client from "./client.js";

const CATEGORY_TAG_TYPE = "categoria";

// Categoria de fallback para produtos sem nenhuma tag do tipo "categoria"
// (ex: Gift Cards). A Suri rejeita produtos sem categoryId, então esta
// categoria é sempre criada/atualizada junto com as demais.
export const UNCATEGORIZED_ID = "sem-categoria";
const UNCATEGORIZED_CATEGORY = {
  id: UNCATEGORIZED_ID,
  name: "Sem categoria",
  description: "",
  parentId: null,
  tagType: CATEGORY_TAG_TYPE,
  handle: UNCATEGORIZED_ID,
};

/**
 * Busca todas as categorias (tags do tipo "categoria") da loja Olist.
 * Fallback: se o endpoint /tags falhar ou não retornar nada, deriva as
 * categorias varrendo os produtos e agregando suas category_tags.
 */
export async function fetchCategories(config) {
  const { store_url, access_token } = config;
  let categories;
  try {
    categories = await fetchCategoriesFromTagsEndpoint(store_url, access_token);
    if (categories.length === 0) categories = await fetchCategoriesFromProducts(store_url, access_token);
  } catch {
    // /tags indisponível — cai para o fallback abaixo
    categories = await fetchCategoriesFromProducts(store_url, access_token);
  }

  return [...categories, UNCATEGORIZED_CATEGORY];
}

async function fetchCategoriesFromTagsEndpoint(store_url, access_token) {
  let allTags = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const batch = await client.listCategories(store_url, access_token, { page, per_page: 50, type: CATEGORY_TAG_TYPE });
    const items = Array.isArray(batch) ? batch : (batch.tags || []);
    if (!items.length) { hasMore = false; break; }
    allTags = allTags.concat(items.map(normalizeCategory));
    hasMore = items.length >= 50;
    page++;
  }

  return allTags;
}

/**
 * Deriva categorias a partir das category_tags encontradas nos produtos,
 * usada apenas quando o endpoint /tags não está acessível.
 */
async function fetchCategoriesFromProducts(store_url, access_token) {
  const seen = new Map(); // tag.name → categoria normalizada
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const batch = await client.listProducts(store_url, access_token, { page, per_page: 50 });
    const items = Array.isArray(batch) ? batch : (batch.products || []);
    if (!items.length) { hasMore = false; break; }

    for (const p of items) {
      const tags = p.category_tags || p.tags || [];
      for (const t of tags) {
        const key = String(t.name || "");
        if (!key || String(t.tag_type || "").toLowerCase() !== CATEGORY_TAG_TYPE || seen.has(key)) continue;
        seen.set(key, normalizeCategory(t));
      }
    }

    hasMore = items.length >= 50;
    page++;
    if (page > 200) break; // proteção contra loop infinito
  }

  return Array.from(seen.values());
}

/**
 * Normaliza uma categoria (tag) da Olist para o formato interno.
 *
 * Estrutura típica (GET /tags): { name, type, title, subtitle, description, image_url, ... }
 * Estrutura embutida em produto (category_tags): { name, tag_type, title }
 */
export function normalizeCategory(c) {
  return {
    id:          String(c.name || c.id || ""),   // Na Olist, o "name" da tag é o identificador único
    name:        c.title || c.name || "",
    description: c.description || "",
    parentId:    c.parent || null,
    tagType:     c.type || c.tag_type || null,
    handle:      c.slug || c.name || null,
  };
}
