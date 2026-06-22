/**
 * ecommerce/woocommerce/client.js
 * Client HTTP da REST API do WooCommerce (v3).
 * Autenticação via Basic Auth (consumer_key:consumer_secret).
 */

function headers(consumerKey, consumerSecret) {
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  return {
    "Authorization": `Basic ${auth}`,
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

async function request(siteUrl, consumerKey, consumerSecret, method, path, body) {
  const base = siteUrl.replace(/\/+$/, "");
  const url = `${base}/wp-json/wc/v3${path}`;
  return withRetry(async () => {
    const res = await fetch(url, {
      method,
      headers: headers(consumerKey, consumerSecret),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`WooCommerce ${method} ${path} → HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    return data;
  });
}

// ─── Sistema ──────────────────────────────────────────────────────────────────
export async function getSystemStatus(siteUrl, consumerKey, consumerSecret) {
  return request(siteUrl, consumerKey, consumerSecret, "GET", "/system_status");
}

// ─── Produtos ─────────────────────────────────────────────────────────────────
export async function listProducts(siteUrl, consumerKey, consumerSecret, params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request(siteUrl, consumerKey, consumerSecret, "GET", `/products${qs ? `?${qs}` : ""}`);
}

export async function getProduct(siteUrl, consumerKey, consumerSecret, productId) {
  return request(siteUrl, consumerKey, consumerSecret, "GET", `/products/${productId}`);
}

export async function updateProduct(siteUrl, consumerKey, consumerSecret, productId, data) {
  return request(siteUrl, consumerKey, consumerSecret, "PUT", `/products/${productId}`, data);
}

export async function getProductVariations(siteUrl, consumerKey, consumerSecret, productId, params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request(siteUrl, consumerKey, consumerSecret, "GET", `/products/${productId}/variations${qs ? `?${qs}` : ""}`);
}

export async function updateProductVariation(siteUrl, consumerKey, consumerSecret, productId, variationId, data) {
  return request(siteUrl, consumerKey, consumerSecret, "PUT", `/products/${productId}/variations/${variationId}`, data);
}

// ─── Categorias ───────────────────────────────────────────────────────────────
export async function listCategories(siteUrl, consumerKey, consumerSecret, params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request(siteUrl, consumerKey, consumerSecret, "GET", `/products/categories${qs ? `?${qs}` : ""}`);
}

export async function getCategory(siteUrl, consumerKey, consumerSecret, categoryId) {
  return request(siteUrl, consumerKey, consumerSecret, "GET", `/products/categories/${categoryId}`);
}

// ─── Pedidos ──────────────────────────────────────────────────────────────────
export async function listOrders(siteUrl, consumerKey, consumerSecret, params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request(siteUrl, consumerKey, consumerSecret, "GET", `/orders${qs ? `?${qs}` : ""}`);
}

export async function getOrder(siteUrl, consumerKey, consumerSecret, orderId) {
  return request(siteUrl, consumerKey, consumerSecret, "GET", `/orders/${orderId}`);
}

export async function updateOrder(siteUrl, consumerKey, consumerSecret, orderId, data) {
  return request(siteUrl, consumerKey, consumerSecret, "PUT", `/orders/${orderId}`, data);
}

// ─── Webhooks ─────────────────────────────────────────────────────────────────
export async function listWebhooks(siteUrl, consumerKey, consumerSecret, params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request(siteUrl, consumerKey, consumerSecret, "GET", `/webhooks${qs ? `?${qs}` : ""}`);
}

export async function createWebhook(siteUrl, consumerKey, consumerSecret, topic, deliveryUrl) {
  return request(siteUrl, consumerKey, consumerSecret, "POST", "/webhooks", {
    topic,
    delivery_url: deliveryUrl,
    status: "active",
  });
}
