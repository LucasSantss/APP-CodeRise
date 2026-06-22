/**
 * ecommerce/vtex/categories.js
 * Operações de categorias na VTEX — usa árvore de categorias do catálogo.
 */

import * as client from "./client.js";

export async function fetchCategories(config) {
  const { account_name, app_key, app_token } = config;
  const tree = await client.getCategoryTree(account_name, app_key, app_token, 5);

  const flat = [];
  function walk(nodes, parentId = null) {
    for (const node of nodes || []) {
      flat.push(normalizeCategory(node, parentId));
      if (node.children && node.children.length) walk(node.children, node.id);
    }
  }
  walk(tree);

  return flat;
}

export function normalizeCategory(c, parentId = null) {
  return {
    id: String(c.id),
    name: c.name || "",
    description: "",
    parentId: parentId ? String(parentId) : null,
    handle: c.url || null,
  };
}
