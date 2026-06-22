/**
 * ecommerce/vtex/client.js
 * Client HTTP da API da VTEX.
 * Autenticação via headers X-VTEX-API-AppKey e X-VTEX-API-AppToken.
 */

function headers(appKey, appToken) {
  return {
    "X-VTEX-API-AppKey": appKey,
    "X-VTEX-API-AppToken": appToken,
    "Content-Type": "application/json",
    "Accept": "application/json",
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

async function request(accountName, appKey, appToken, method, path, body, environment = "vtexcommercestable") {
  const url = `https://${accountName}.${environment}.com.br${path}`;
  return withRetry(async () => {
    const res = await fetch(url, {
      method,
      headers: headers(appKey, appToken),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`VTEX ${method} ${path} → HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    return data;
  });
}

// ─── Catálogo ─────────────────────────────────────────────────────────────────
export async function getProduct(accountName, appKey, appToken, productId) {
  return request(accountName, appKey, appToken, "GET", `/api/catalog/pvt/product/${productId}`);
}

export async function getSku(accountName, appKey, appToken, skuId) {
  return request(accountName, appKey, appToken, "GET", `/api/catalog/pvt/stockkeepingunit/${skuId}`);
}

export async function getSkuContext(accountName, appKey, appToken, skuId) {
  return request(accountName, appKey, appToken, "GET", `/api/catalog_system/pvt/sku/stockkeepingunitbyid/${skuId}`);
}

export async function listSkusByProduct(accountName, appKey, appToken, productId) {
  return request(accountName, appKey, appToken, "GET", `/api/catalog_system/pvt/sku/stockkeepingunitidsbyproductid/${productId}`);
}

export async function getCategoryTree(accountName, appKey, appToken, levels = 3) {
  return request(accountName, appKey, appToken, "GET", `/api/catalog_system/pub/category/tree/${levels}`);
}

export async function getCategory(accountName, appKey, appToken, categoryId) {
  return request(accountName, appKey, appToken, "GET", `/api/catalog/pvt/category/${categoryId}`);
}

// ─── Logística / Estoque ───────────────────────────────────────────────────────
export async function listWarehouses(accountName, appKey, appToken) {
  return request(accountName, appKey, appToken, "GET", "/api/logistics/pvt/configuration/warehouses");
}

export async function getInventoryBySku(accountName, appKey, appToken, skuId) {
  return request(accountName, appKey, appToken, "GET", `/api/logistics/pvt/inventory/skus/${skuId}`);
}

export async function updateInventory(accountName, appKey, appToken, skuId, warehouseId, quantity) {
  return request(accountName, appKey, appToken, "PUT", `/api/logistics/pvt/inventory/skus/${skuId}/warehouses/${warehouseId}`, {
    unlimitedQuantity: false,
    quantity,
  });
}

// ─── Pedidos (OMS) ──────────────────────────────────────────────────────────────
export async function getOrder(accountName, appKey, appToken, orderId) {
  return request(accountName, appKey, appToken, "GET", `/api/oms/pvt/orders/${orderId}`);
}

export async function listOrders(accountName, appKey, appToken, params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request(accountName, appKey, appToken, "GET", `/api/oms/pvt/orders${qs ? `?${qs}` : ""}`);
}

export async function cancelOrder(accountName, appKey, appToken, orderId) {
  return request(accountName, appKey, appToken, "POST", `/api/oms/pvt/orders/${orderId}/cancel`, {});
}

export async function invoiceOrder(accountName, appKey, appToken, orderId, invoiceData) {
  return request(accountName, appKey, appToken, "POST", `/api/oms/pvt/orders/${orderId}/invoice`, invoiceData);
}

export async function addOrderTracking(accountName, appKey, appToken, orderId, invoiceNumber, trackingData) {
  return request(accountName, appKey, appToken, "POST", `/api/oms/pvt/orders/${orderId}/invoice/${invoiceNumber}/tracking`, trackingData);
}

// ─── Hooks de pedidos (notificações) ─────────────────────────────────────────────
export async function getOrderHookConfig(accountName, appKey, appToken) {
  return request(accountName, appKey, appToken, "GET", "/api/orders/hook/config");
}

export async function setOrderHookConfig(accountName, appKey, appToken, hookUrl) {
  return request(accountName, appKey, appToken, "POST", "/api/orders/hook/config", {
    url: hookUrl,
    key: "",
  });
}
