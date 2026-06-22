/**
 * ecommerce/vtex/index.js
 * Normaliza notificações da VTEX para o formato interno do CodeRise
 * e re-exporta todas as operações dos módulos internos.
 *
 * VTEX tem dois mecanismos de notificação distintos:
 * 1) Order Hook — notifica mudanças de status de pedido (configurado via API)
 * 2) Catalog Affiliate Feed — notifica mudanças de produto/SKU (configurado no painel)
 *
 * Ambos enviam apenas IDs — sempre é necessário buscar os detalhes via API.
 */

import * as client         from "./client.js";
import * as productsLib    from "./products.js";
import * as stockLib       from "./stock.js";
import * as ordersLib      from "./orders.js";
import * as categoriesLib  from "./categories.js";

// ── Re-exportações de produtos ────────────────────────────────────────────────
export const fetchAndNormalizeProduct = productsLib.fetchAndNormalizeProduct;
export const normalizeProduct         = productsLib.normalizeProduct;

// ── Re-exportações de estoque ─────────────────────────────────────────────────
export const deductVariantStock       = stockLib.deductVariantStock;
export const returnVariantStock       = stockLib.returnVariantStock;
export const deductStockForOrderItems = stockLib.deductStockForOrderItems;

// ── Re-exportações de pedidos ─────────────────────────────────────────────────
export const normalizeOrder           = ordersLib.normalizeOrder;
export const cancelOrder              = ordersLib.cancelOrder;
export const fulfillOrder             = ordersLib.fulfillOrder;

// ── Re-exportações de categorias ──────────────────────────────────────────────
export const fetchCategories          = categoriesLib.fetchCategories;
export const normalizeCategory        = categoriesLib.normalizeCategory;

// ── Normalização de webhook ───────────────────────────────────────────────────

export function normalizeWebhook(payload) {
  // ── Order Hook: { OrderId, State, ... } ────────────────────────────────────
  if (payload.OrderId || payload.orderId) {
    const state = payload.State || payload.state || payload.status || "";
    let eventType = "order.created";
    if (/cancel/i.test(state))                           eventType = "order.cancelled";
    else if (/invoice|shipped|handling/i.test(state))    eventType = "order.shipped";

    return {
      eventType,
      orderId:      String(payload.OrderId || payload.orderId || ""),
      needsApiFetch: true,
    };
  }

  // ── Catalog Affiliate Feed: { IdSku, IdAffiliate, IsActive, ... } ──────────
  if (payload.IdSku || payload.idSku) {
    const isActive  = payload.IsActive ?? true;
    const eventType = isActive ? "product.sync" : "product.deleted";
    return {
      eventType,
      productId:    String(payload.IdSku || payload.idSku || ""),
      needsApiFetch: eventType === "product.sync",
    };
  }

  return { eventType: "unknown", needsApiFetch: false, raw: payload };
}

// ── Registro de webhooks ──────────────────────────────────────────────────────

/**
 * Registra o Order Hook na VTEX via API (notificação de status de pedido).
 * Notificações de catálogo (produto/SKU) precisam ser configuradas
 * manualmente no painel VTEX, na seção de "Affiliate" / integração de marketplace.
 */
export async function registerWebhooks(config, webhookUrl) {
  const { account_name, app_key, app_token } = config;

  try {
    await client.setOrderHookConfig(account_name, app_key, app_token, webhookUrl);
    return {
      success: true,
      message: `Order Hook configurado com sucesso na VTEX. Para notificações de produtos/SKUs, configure manualmente um Affiliate apontando para: ${webhookUrl}`,
      details: [{ type: "order_hook", status: "registered" }],
    };
  } catch (err) {
    return {
      success:     false,
      manual:      true,
      message:     `Não foi possível configurar o Order Hook automaticamente (${err.message}). Configure manualmente em VTEX Admin → Pedidos → Hook de pedidos, com a URL: ${webhookUrl}`,
      webhook_url: webhookUrl,
    };
  }
}
