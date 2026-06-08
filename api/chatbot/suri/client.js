/**
 * chatbot/suri/client.js
 * Client HTTP da API da Suri.
 * Todas as chamadas à Suri passam por aqui.
 */

// Retry com backoff exponencial para falhas transientes
async function withRetry(fn, maxAttempts = 3, baseDelayMs = 600) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try { return await fn(); } catch (err) {
      lastErr = err;
      const msg = err.message || "";
      // Não faz retry em erros de cliente (4xx), exceto 429 (rate limit) e 408 (timeout)
      const isClientError = msg.includes("HTTP 4") && !msg.includes("HTTP 429") && !msg.includes("HTTP 408");
      if (isClientError || attempt === maxAttempts) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 300;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export async function request(endpoint, token, method, path, body) {
  const base = endpoint.replace(/\/+$/, "");
  return withRetry(async () => {
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
  });
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

/**
 * Verifica se um produto existe na Suri pelo ID.
 * Retorna true se existir, false se não existir (404).
 * Lança erro para outros problemas de rede/autenticação.
 */
export async function productExists(endpoint, token, productId) {
  try {
    await request(endpoint, token, "GET", `/api/shop/products/${productId}`, undefined);
    return true;
  } catch (err) {
    const msg = err.message || "";
    if (msg.includes("HTTP 404")) return false;
    // Se a Suri não suporta GET por ID, tratamos como desconhecido (false = tentar POST)
    if (msg.includes("HTTP 405") || msg.includes("HTTP 501")) return false;
    throw err;
  }
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
