/**
 * ecommerce/olist/client.js
 * Client HTTP da API Olist Ecommerce (Vnda).
 * Autenticação via Bearer Token no header Authorization.
 * Base URL: https://{store_url}/api/v2
 */

const USER_AGENT = "CodeRise Integration (suporte@coderise.com.br)";

function headers(accessToken, shopHost) {
  return {
    "Authorization": `Bearer ${accessToken}`,
    "X-Shop-Host": shopHost,
    "Content-Type": "application/json",
  };
}

// Retry com backoff exponencial para falhas transientes
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

async function request(storeUrl, accessToken, method, path, body) {
  const base = storeUrl.replace(/\/+$/, "");
  const url = `${base}/api/v2${path}`;
  return withRetry(async () => {
    const res = await fetch(url, {
      method,
      headers: headers(accessToken),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Olist ${method} ${path} → HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    return data;
  });
}

// ─── Loja ──────────────────────────────────────────────────────────────────────
export async function getStore(storeUrl, accessToken) {
  // Usa /api/v2/orders com page=1 para validar credenciais (Olist não tem /store endpoint)
  return request(storeUrl, accessToken, "GET", "/orders?per_page=1");
}

// ─── Produtos ─────────────────────────────────────────────────────────────────
export async function listProducts(storeUrl, accessToken, params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request(storeUrl, accessToken, "GET", `/products${qs ? `?${qs}` : ""}`);
}

export async function getProduct(storeUrl, accessToken, productId) {
  return request(storeUrl, accessToken, "GET", `/products/${productId}`);
}

// ─── Variantes ────────────────────────────────────────────────────────────────
export async function getProductVariants(storeUrl, accessToken, productId) {
  return request(storeUrl, accessToken, "GET", `/products/${productId}/variants`);
}

export async function getVariantBySku(storeUrl, accessToken, sku) {
  return request(storeUrl, accessToken, "GET", `/variants/${encodeURIComponent(sku)}`);
}

export async function updateVariantStock(storeUrl, accessToken, sku, quantity) {
  // POST /api/v2/variants/{sku}/quantity
  return request(storeUrl, accessToken, "POST", `/variants/${encodeURIComponent(sku)}/quantity`, { quantity });
}

// ─── Categorias (Tags) ────────────────────────────────────────────────────────
export async function listCategories(storeUrl, accessToken, params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request(storeUrl, accessToken, "GET", `/tags${qs ? `?${qs}` : ""}`);
}

export async function getCategory(storeUrl, accessToken, name) {
  return request(storeUrl, accessToken, "GET", `/tags/${encodeURIComponent(name)}`);
}

// ─── Pedidos ──────────────────────────────────────────────────────────────────
export async function listOrders(storeUrl, accessToken, params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request(storeUrl, accessToken, "GET", `/orders${qs ? `?${qs}` : ""}`);
}

export async function getOrder(storeUrl, accessToken, orderCode) {
  return request(storeUrl, accessToken, "GET", `/orders/${orderCode}`);
}

export async function getOrderShippingAddress(storeUrl, accessToken, orderCode) {
  return request(storeUrl, accessToken, "GET", `/orders/${orderCode}/shipping_address`);
}

export async function getOrderPackages(storeUrl, accessToken, orderCode) {
  return request(storeUrl, accessToken, "GET", `/orders/${orderCode}/packages`);
}

// ─── Fluxo de pedidos ─────────────────────────────────────────────────────────
export async function captureOrder(storeUrl, accessToken, orderCode) {
  return request(storeUrl, accessToken, "POST", `/orders/${orderCode}/capture`);
}

export async function confirmOrder(storeUrl, accessToken, orderCode) {
  return request(storeUrl, accessToken, "POST", `/orders/${orderCode}/confirm`);
}

export async function cancelOrder(storeUrl, accessToken, orderCode) {
  return request(storeUrl, accessToken, "POST", `/orders/${orderCode}/cancel`);
}

// ─── Pacotes ──────────────────────────────────────────────────────────────────
export async function shipPackage(storeUrl, accessToken, orderCode, packageCode) {
  return request(storeUrl, accessToken, "PATCH", `/orders/${orderCode}/packages/${packageCode}/ship`);
}

export async function deliverPackage(storeUrl, accessToken, orderCode, packageCode) {
  return request(storeUrl, accessToken, "PATCH", `/orders/${orderCode}/packages/${packageCode}/deliver`);
}

export async function addInvoice(storeUrl, accessToken, orderCode, packageCode, invoiceData) {
  return request(storeUrl, accessToken, "POST", `/orders/${orderCode}/packages/${packageCode}/invoices`, invoiceData);
}

export async function addTracking(storeUrl, accessToken, orderCode, packageCode, trackingData) {
  return request(storeUrl, accessToken, "POST", `/orders/${orderCode}/packages/${packageCode}/trackings`, trackingData);
}

// ─── Webhooks ─────────────────────────────────────────────────────────────────
// Olist/Vnda usa o sistema de webhooks configurável via painel admin.
// Não há endpoint de registro via API pública, então apenas expõe testConnection.
export async function testConnection(storeUrl, accessToken) {
  return getStore(storeUrl, accessToken);
}
