/**
 * ecommerce/tray/client.js
 * Client HTTP da API da Tray Commerce.
 * Autenticação via Bearer Token (access_token obtido na homologação do app).
 * Base URL é específica de cada loja: https://{loja}.commercesuite.com.br/web_api
 * ou o endereço informado em api_address na configuração.
 */

const USER_AGENT = "CodeRise Integration (suporte@coderise.com.br)";

function headers(accessToken) {
  return {
    "Authorization": `Bearer ${accessToken}`,
    "User-Agent": USER_AGENT,
    "Content-Type": "application/json",
  };
}

async function withRetry(fn, maxAttempts = 3, baseDelayMs = 600) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try { return await fn(); } catch (err) {
      lastErr = err;
      const msg = err.message || "";
      const isClientError = msg.includes("HTTP 4") && !msg.includes("HTTP 429") && !msg.includes("HTTP 408");
      if (isClientError || attempt === maxAttempts) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 300;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

async function request(apiAddress, accessToken, method, path, body) {
  const base = apiAddress.replace(/\/+$/, "");
  const url = `${base}${path}`;
  return withRetry(async () => {
    const res = await fetch(url, {
      method,
      headers: headers(accessToken),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Tray ${method} ${path} → HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    return data;
  });
}

// ─── Loja ──────────────────────────────────────────────────────────────────────
export async function getStoreInfo(apiAddress, accessToken) {
  return request(apiAddress, accessToken, "GET", "/store_informations");
}

// ─── Produtos ─────────────────────────────────────────────────────────────────
export async function listProducts(apiAddress, accessToken, params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request(apiAddress, accessToken, "GET", `/products${qs ? `?${qs}` : ""}`);
}

export async function getProduct(apiAddress, accessToken, productId) {
  const data = await request(apiAddress, accessToken, "GET", `/products/${productId}`);
  return data.Product || data.product || data;
}

export async function getProductVariants(apiAddress, accessToken, productId) {
  const data = await request(apiAddress, accessToken, "GET", `/products/${productId}/variants`);
  return data.Variants || data.variants || [];
}

export async function updateVariantStock(apiAddress, accessToken, productId, variantId, stock) {
  return request(apiAddress, accessToken, "PUT", `/products/${productId}/variants/${variantId}`, {
    Variant: { stock: String(stock) },
  });
}

export async function updateProductStock(apiAddress, accessToken, productId, stock) {
  return request(apiAddress, accessToken, "PUT", `/products/${productId}`, {
    Product: { stock: String(stock) },
  });
}

// ─── Categorias ───────────────────────────────────────────────────────────────
export async function listCategories(apiAddress, accessToken, params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request(apiAddress, accessToken, "GET", `/categories${qs ? `?${qs}` : ""}`);
}

export async function getCategory(apiAddress, accessToken, categoryId) {
  const data = await request(apiAddress, accessToken, "GET", `/categories/${categoryId}`);
  return data.Category || data.category || data;
}

// ─── Pedidos ──────────────────────────────────────────────────────────────────
export async function listOrders(apiAddress, accessToken, params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request(apiAddress, accessToken, "GET", `/orders${qs ? `?${qs}` : ""}`);
}

export async function getOrder(apiAddress, accessToken, orderId) {
  const data = await request(apiAddress, accessToken, "GET", `/orders/${orderId}`);
  return data.Order || data.order || data;
}

export async function updateOrderStatus(apiAddress, accessToken, orderId, statusId) {
  return request(apiAddress, accessToken, "PUT", `/orders/${orderId}`, {
    Order: { situation_id: statusId },
  });
}

export async function getOrderStatuses(apiAddress, accessToken) {
  const data = await request(apiAddress, accessToken, "GET", "/order_status");
  return data.OrderStatus || data.order_status || [];
}

export async function addTracking(apiAddress, accessToken, orderId, trackingData) {
  return request(apiAddress, accessToken, "POST", `/orders/${orderId}/tracking`, {
    Tracking: trackingData,
  });
}

// ─── Webhooks ─────────────────────────────────────────────────────────────────
// A Tray notifica um único endpoint cadastrado no app (não há registro por tópico).
// O endereço de notificação é configurado no momento da homologação do app, via chamado.
