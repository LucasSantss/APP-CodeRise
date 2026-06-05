/**
 * chatbot/suri/stores.js
 * Operações de lojas/depósitos na Suri.
 * O ID da loja é usado no campo `stocks` ao criar/atualizar produtos.
 */

import * as client from "./client.js";

// Cache em memória para evitar chamadas repetidas dentro da mesma execução
const storeIdCache = new Map();

/**
 * Busca o ID do primeiro depósito ativo da Suri.
 * Usa cache para evitar chamada extra a cada produto sincronizado.
 */
export async function getFirstStoreId(endpoint, token) {
  const cacheKey = `${endpoint}:${token.slice(0, 8)}`;
  if (storeIdCache.has(cacheKey)) return storeIdCache.get(cacheKey);

  try {
    const data = await client.listStores(endpoint, token);
    const stores = Array.isArray(data) ? data : (data?.data || data?.stores || []);
    const storeId = stores?.[0]?.id || null;
    if (storeId) storeIdCache.set(cacheKey, storeId);
    return storeId;
  } catch {
    return null;
  }
}

/**
 * Retorna o objeto `stocks` no formato exato que a Suri aceita:
 * { "141301072": { "stock": 50 } }
 */
export function buildStocks(storeId, stock) {
  if (stock == null || stock === undefined) return {};
  return { [storeId]: { stock: Number(stock) } };
}

/**
 * Lista todas as lojas/depósitos disponíveis.
 */
export async function listStores(endpoint, token) {
  const data = await client.listStores(endpoint, token);
  return Array.isArray(data) ? data : (data?.data || data?.stores || []);
}
