/**
 * ecommerce/nuvemshop/client.js
 * Client HTTP da API da Nuvemshop (Tiendanube).
 * Todas as chamadas à API da Nuvemshop passam por aqui.
 */

const BASE_URL = "https://api.tiendanube.com/v1";
const USER_AGENT = "CodeRise Integration (suporte@coderise.com.br)";

function headers(accessToken) {
  return {
    "Authentication": `bearer ${accessToken}`,
    "User-Agent": USER_AGENT,
    "Content-Type": "application/json",
  };
}

async function request(storeId, accessToken, method, path, body) {
  const url = `${BASE_URL}/${storeId}${path}`;
  const res = await fetch(url, {
    method,
    headers: headers(accessToken),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Nuvemshop ${method} ${path} → HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

// ─── Produtos ─────────────────────────────────────────────────────────────────
export async function getProduct(storeId, accessToken, productId) {
  return request(storeId, accessToken, "GET", `/products/${productId}`);
}

export async function listProducts(storeId, accessToken, params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request(storeId, accessToken, "GET", `/products${qs ? `?${qs}` : ""}`);
}

// ─── Variantes ────────────────────────────────────────────────────────────────
export async function getProductVariants(storeId, accessToken, productId) {
  return request(storeId, accessToken, "GET", `/products/${productId}/variants`);
}

export async function updateVariantStock(storeId, accessToken, productId, variantId, stock) {
  return request(storeId, accessToken, "PUT", `/products/${productId}/variants/${variantId}`, { stock });
}

// ─── Categorias ───────────────────────────────────────────────────────────────
export async function listCategories(storeId, accessToken) {
  return request(storeId, accessToken, "GET", "/categories");
}

export async function getCategory(storeId, accessToken, categoryId) {
  return request(storeId, accessToken, "GET", `/categories/${categoryId}`);
}

// ─── Loja ─────────────────────────────────────────────────────────────────────
export async function getStore(storeId, accessToken) {
  return request(storeId, accessToken, "GET", "/store");
}

// ─── Pedidos ──────────────────────────────────────────────────────────────────
export async function getOrder(storeId, accessToken, orderId) {
  return request(storeId, accessToken, "GET", `/orders/${orderId}`);
}

export async function searchOrders(storeId, accessToken, query) {
  return request(storeId, accessToken, "GET", `/orders?q=${query}&fields=id,number,status`);
}

export async function fulfillOrder(storeId, accessToken, orderId, body) {
  return request(storeId, accessToken, "POST", `/orders/${orderId}/fulfill`, body);
}

export async function cancelOrder(storeId, accessToken, orderId) {
  return request(storeId, accessToken, "POST", `/orders/${orderId}/cancel`);
}

export async function updateOrder(storeId, accessToken, orderId, body) {
  return request(storeId, accessToken, "PUT", `/orders/${orderId}`, body);
}

// ─── Webhooks ─────────────────────────────────────────────────────────────────
export async function registerWebhook(storeId, accessToken, event, url) {
  return request(storeId, accessToken, "POST", "/webhooks", { event, url });
}

export async function testConnection(storeId, accessToken) {
  return getStore(storeId, accessToken);
}
