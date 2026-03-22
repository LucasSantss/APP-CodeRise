/**
 * chatbot/suri/client.js
 * Client HTTP da API da Suri.
 * Todas as chamadas à Suri passam por aqui.
 */

export async function request(endpoint, token, method, path, body) {
  const base = endpoint.replace(/\/+$/, "");
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(`Suri ${method} ${path} → HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

// ─── Lojas / Depósitos ────────────────────────────────────────────────────────
export async function listStores(endpoint, token) {
  return request(endpoint, token, "GET", "/api/shop/stores");
}

// ─── Produtos ─────────────────────────────────────────────────────────────────
export async function createProduct(endpoint, token, body) {
  return request(endpoint, token, "POST", "/api/shop/products", body);
}

export async function updateProduct(endpoint, token, body) {
  return request(endpoint, token, "PUT", "/api/shop/products", body);
}

export async function deactivateProduct(endpoint, token, productId) {
  return request(endpoint, token, "PUT", "/api/shop/products", { id: productId, isActive: false });
}

// ─── Categorias ───────────────────────────────────────────────────────────────
export async function listCategories(endpoint, token) {
  return request(endpoint, token, "GET", "/api/shop/categories");
}

export async function createCategory(endpoint, token, body) {
  return request(endpoint, token, "POST", "/api/shop/categories", body);
}

export async function updateCategory(endpoint, token, body) {
  return request(endpoint, token, "PUT", "/api/shop/categories", body);
}

// ─── Pedidos ──────────────────────────────────────────────────────────────────
export async function searchOrders(endpoint, token, providerOrderId) {
  return request(endpoint, token, "POST", "/api/shop/orders", {
    ProviderOrderId: String(providerOrderId),
    Page: 1,
    PerPage: 1,
  });
}

export async function createOrderBudget(endpoint, token, body) {
  return request(endpoint, token, "POST", "/api/shop/orders/budget", body);
}

export async function markOrderPaid(endpoint, token, orderId, paymentTracking) {
  return request(endpoint, token, "POST", "/api/shop/orders/paid", {
    orderId,
    paymentTracking: paymentTracking || "",
  });
}

export async function updateOrderLogistic(endpoint, token, orderId, status) {
  return request(endpoint, token, "POST", "/api/shop/orders/logistic", { id: orderId, status });
}

export async function cancelOrder(endpoint, token, orderId) {
  return request(endpoint, token, "POST", "/api/shop/orders/cancel", { orderId });
}

export async function deductStock(endpoint, token, productId, sku, quantity) {
  return request(endpoint, token, "POST", "/api/shop/orders/stock-deduction", {
    productId, sku, quantity,
  });
}
