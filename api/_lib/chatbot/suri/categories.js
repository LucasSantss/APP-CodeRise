/**
 * chatbot/suri/categories.js
 * Operações de categorias na Suri.
 */

import * as client from "./client.js";

export async function listCategories(endpoint, token) {
  const data = await client.listCategories(endpoint, token);
  return Array.isArray(data) ? data : (data?.data || data?.categories || []);
}

export async function findCategoryByExternalId(endpoint, token, externalId) {
  const categories = await listCategories(endpoint, token);
  return categories.find(c => c.externalId === String(externalId) || c.id === String(externalId)) || null;
}

export async function syncCategory(endpoint, token, category, resolvedStoreId = null) {
  const payload = {
    id: category.id,
    name: category.name,
    description: category.description || "",
    parentId: category.parentId || null,
    ...(resolvedStoreId ? { storeId: resolvedStoreId } : {}),
  };

  const existing = await findCategoryByExternalId(endpoint, token, category.id).catch(() => null);

  try {
    if (existing) {
      await client.updateCategory(endpoint, token, { ...payload, id: existing.id });
      return { action: "category_updated", categoryId: category.id, suriId: existing.id, storeId: resolvedStoreId };
    } else {
      await client.createCategory(endpoint, token, payload);
      return { action: "category_created", categoryId: category.id, storeId: resolvedStoreId };
    }
  } catch (err) {
    if (err.message.includes("404") || err.message.includes("HTTP 404")) {
      await client.createCategory(endpoint, token, payload);
      return { action: "category_created", categoryId: category.id, storeId: resolvedStoreId };
    }
    throw err;
  }
}
