/**
 * chatbot/suri/categories.js
 * Operações de categorias na Suri.
 */

import * as client from "./client.js";

/**
 * Lista todas as categorias da Suri.
 */
export async function listCategories(endpoint, token) {
  const data = await client.listCategories(endpoint, token);
  return Array.isArray(data) ? data : (data?.data || data?.categories || []);
}

/**
 * Busca uma categoria na Suri pelo ID externo (ID do ecommerce).
 */
export async function findCategoryByExternalId(endpoint, token, externalId) {
  const categories = await listCategories(endpoint, token);
  return categories.find(c => c.externalId === String(externalId) || c.id === String(externalId)) || null;
}

/**
 * Sincroniza uma categoria do ecommerce na Suri.
 * Cria se não existir, atualiza se existir.
 */
export async function syncCategory(endpoint, token, category) {
  const payload = {
    id: category.id,
    name: category.name,
    description: category.description || "",
    parentId: category.parentId || null,
  };

  try {
    await client.updateCategory(endpoint, token, payload);
    return { action: "category_updated", categoryId: category.id };
  } catch (err) {
    if (err.message.includes("404") || err.message.includes("HTTP 404")) {
      await client.createCategory(endpoint, token, payload);
      return { action: "category_created", categoryId: category.id };
    }
    throw err;
  }
}
