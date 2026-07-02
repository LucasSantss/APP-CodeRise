/**
 * ecommerce/shopify/client.js
 * Client HTTP da Admin API da Shopify (REST).
 * Autenticação via header X-Shopify-Access-Token.
 */

const API_VERSION = "2025-01";

function headers(apiToken) {
  return {
    "X-Shopify-Access-Token": apiToken,
    "Content-Type": "application/json",
  };
}

function hostFrom(storeUrl) {
  return storeUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
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

async function request(storeUrl, apiToken, method, path, body, apiVersion) {
  const host = hostFrom(storeUrl);
  const version = apiVersion || API_VERSION;
  const url = `https://${host}/admin/api/${version}${path}`;
  return withRetry(async () => {
    const res = await fetch(url, {
      method,
      headers: headers(apiToken),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Shopify ${method} ${path} → HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    return data;
  });
}

// ─── Loja ──────────────────────────────────────────────────────────────────────
export async function getShop(storeUrl, apiToken, apiVersion) {
  const data = await request(storeUrl, apiToken, "GET", "/shop.json", null, apiVersion);
  return data.shop;
}

// ─── Produtos ─────────────────────────────────────────────────────────────────
export async function listProducts(storeUrl, apiToken, params = {}, apiVersion) {
  const qs = new URLSearchParams(params).toString();
  const data = await request(storeUrl, apiToken, "GET", `/products.json${qs ? `?${qs}` : ""}`, null, apiVersion);
  return data.products || [];
}

export async function getProduct(storeUrl, apiToken, productId, apiVersion) {
  const data = await request(storeUrl, apiToken, "GET", `/products/${productId}.json`, null, apiVersion);
  return data.product;
}

// ─── Variantes / Inventário ───────────────────────────────────────────────────
export async function getVariant(storeUrl, apiToken, variantId, apiVersion) {
  const data = await request(storeUrl, apiToken, "GET", `/variants/${variantId}.json`, null, apiVersion);
  return data.variant;
}

export async function getInventoryLevels(storeUrl, apiToken, inventoryItemIds, apiVersion) {
  const ids = Array.isArray(inventoryItemIds) ? inventoryItemIds.join(",") : inventoryItemIds;
  const data = await request(storeUrl, apiToken, "GET", `/inventory_levels.json?inventory_item_ids=${ids}`, null, apiVersion);
  return data.inventory_levels || [];
}

export async function setInventoryLevel(storeUrl, apiToken, locationId, inventoryItemId, available, apiVersion) {
  return request(storeUrl, apiToken, "POST", "/inventory_levels/set.json", {
    location_id: locationId,
    inventory_item_id: inventoryItemId,
    available,
  }, apiVersion);
}

export async function adjustInventoryLevel(storeUrl, apiToken, locationId, inventoryItemId, availableAdjustment, apiVersion) {
  return request(storeUrl, apiToken, "POST", "/inventory_levels/adjust.json", {
    location_id: locationId,
    inventory_item_id: inventoryItemId,
    available_adjustment: availableAdjustment,
  }, apiVersion);
}

export async function listLocations(storeUrl, apiToken, apiVersion) {
  const data = await request(storeUrl, apiToken, "GET", "/locations.json", null, apiVersion);
  return data.locations || [];
}

// ─── Categorias (Custom Collections) ──────────────────────────────────────────
export async function listCustomCollections(storeUrl, apiToken, params = {}, apiVersion) {
  const qs = new URLSearchParams(params).toString();
  const data = await request(storeUrl, apiToken, "GET", `/custom_collections.json${qs ? `?${qs}` : ""}`, null, apiVersion);
  return data.custom_collections || [];
}

export async function getCustomCollection(storeUrl, apiToken, collectionId, apiVersion) {
  const data = await request(storeUrl, apiToken, "GET", `/custom_collections/${collectionId}.json`, null, apiVersion);
  return data.custom_collection;
}

// ─── Pedidos ──────────────────────────────────────────────────────────────────
export async function listOrders(storeUrl, apiToken, params = {}, apiVersion) {
  const qs = new URLSearchParams(params).toString();
  const data = await request(storeUrl, apiToken, "GET", `/orders.json${qs ? `?${qs}` : ""}`, null, apiVersion);
  return data.orders || [];
}

export async function getOrder(storeUrl, apiToken, orderId, apiVersion) {
  const data = await request(storeUrl, apiToken, "GET", `/orders/${orderId}.json`, null, apiVersion);
  return data.order;
}

export async function cancelOrder(storeUrl, apiToken, orderId, apiVersion) {
  return request(storeUrl, apiToken, "POST", `/orders/${orderId}/cancel.json`, {}, apiVersion);
}

export async function closeOrder(storeUrl, apiToken, orderId, apiVersion) {
  return request(storeUrl, apiToken, "POST", `/orders/${orderId}/close.json`, {}, apiVersion);
}

// ─── Fulfillment (Envio) ───────────────────────────────────────────────────────
export async function listFulfillmentOrders(storeUrl, apiToken, orderId, apiVersion) {
  const data = await request(storeUrl, apiToken, "GET", `/orders/${orderId}/fulfillment_orders.json`, null, apiVersion);
  return data.fulfillment_orders || [];
}

export async function createFulfillment(storeUrl, apiToken, fulfillmentOrderId, trackingInfo, apiVersion) {
  return request(storeUrl, apiToken, "POST", "/fulfillments.json", {
    fulfillment: {
      line_items_by_fulfillment_order: [{ fulfillment_order_id: fulfillmentOrderId }],
      tracking_info: trackingInfo || undefined,
      notify_customer: true,
    },
  }, apiVersion);
}

// ─── Webhooks ─────────────────────────────────────────────────────────────────
export async function listWebhooks(storeUrl, apiToken, apiVersion) {
  const data = await request(storeUrl, apiToken, "GET", "/webhooks.json", null, apiVersion);
  return data.webhooks || [];
}

export async function createWebhook(storeUrl, apiToken, topic, address, apiVersion) {
  return request(storeUrl, apiToken, "POST", "/webhooks.json", {
    webhook: { topic, address, format: "json" },
  }, apiVersion);
}

export async function deleteWebhook(storeUrl, apiToken, webhookId, apiVersion) {
  return request(storeUrl, apiToken, "DELETE", `/webhooks/${webhookId}.json`, null, apiVersion);
}
