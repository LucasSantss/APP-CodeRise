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

  // Fetch all Suri categories once; match by externalId, id, or name (case-insensitive)
  const all = await client.listCategories(endpoint, token).catch(() => []);
  const suriCats = Array.isArray(all) ? all : (all?.data || all?.categories || []);
  const nameLower = category.name.toLowerCase();
  const existing = suriCats.find(c =>
    c.externalId === String(category.id) ||
    c.id === String(category.id) ||
    (c.name && c.name.toLowerCase() === nameLower)
  ) || null;

  if (existing) {
    const res = await client.updateCategory(endpoint, token, { ...payload, id: existing.id });
    const suriId = res?.id || existing.id || null;
    return { action: "category_updated", categoryId: category.id, suriId, storeId: resolvedStoreId };
  }

  try {
    const res = await client.createCategory(endpoint, token, payload);
    const suriId = res?.id || category.id || null;
    return { action: "category_created", categoryId: category.id, suriId, storeId: resolvedStoreId };
  } catch (err) {
    const msg = err.message || "";
    // "already exists" (400): re-search by name in the list we already have
    if (msg.includes("already exists")) {
      const match = suriCats.find(c => c.name && c.name.toLowerCase() === nameLower);
      if (match) {
        const res = await client.updateCategory(endpoint, token, { ...payload, id: match.id });
        const suriId = res?.id || match.id || null;
        return { action: "category_updated", categoryId: category.id, suriId, storeId: resolvedStoreId };
      }
    }
    if (msg.includes("HTTP 404")) {
      const res = await client.createCategory(endpoint, token, payload);
      const suriId = res?.id || category.id || null;
      return { action: "category_created", categoryId: category.id, suriId, storeId: resolvedStoreId };
    }
    throw err;
  }
}