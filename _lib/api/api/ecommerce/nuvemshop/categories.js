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
 * Extrai o primeiro valor não vazio de um campo multilíngue da Nuvemshop.
 * Campos como name, description, handle, seo_title podem vir como:
 *   { "pt": "valor" }  ou  { "es": "valor" }  ou  { "en": "valor" }
 *   ou null  ou  string direta (formato legado)
 */
function extractI18n(field, fallback = "") {
  if (!field) return fallback;
  if (typeof field === "string") return field || fallback;
  // Prioridade: pt → es → en → qualquer outro idioma com valor não vazio
  const priority = ["pt", "es", "en"];
  for (const lang of priority) {
    if (field[lang] && typeof field[lang] === "string" && field[lang].trim()) {
      return field[lang].trim();
    }
  }
  // Qualquer outro idioma
  const anyValue = Object.values(field).find(v => v && typeof v === "string" && v.trim());
  return anyValue ? anyValue.trim() : fallback;
}

/**
 * Normaliza uma categoria da Nuvemshop para o formato interno.
 * Trata todos os formatos reais da API:
 *   - name/description/handle como objeto multilíngue { pt: "...", es: "..." }
 *   - parent como 0 (sem pai), número positivo (ID do pai) ou objeto { id: ... }
 */
export function normalizeCategory(c) {
  // parentId: parent=0 ou null/undefined → sem pai; número > 0 → ID direto; objeto → .id
  let parentId = null;
  if (c.parent && c.parent !== 0) {
    if (typeof c.parent === "object" && c.parent.id) {
      parentId = String(c.parent.id);
    } else if (typeof c.parent === "number" || typeof c.parent === "string") {
      parentId = String(c.parent);
    }
  }

  return {
    id:             String(c.id),
    name:           extractI18n(c.name),
    description:    extractI18n(c.description),
    parentId,
    googleShopping: c.google_shopping_category || null,
    seoTitle:       extractI18n(c.seo_title) || null,
    seoDescription: extractI18n(c.seo_description) || null,
    handle:         extractI18n(c.handle) || null,
  };
}
