/**
 * ecommerce/tray/index.js
 * Normaliza notificações da Tray para o formato interno do CodeRise
 * e re-exporta todas as operações dos módulos internos.
 *
 * A Tray envia POST com campos: seller_id, scope_id, scope_name, act, app_code.
 * Combinação scope_name + act define o evento, ex: "order"+"insert" = order_insert.
 */

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

// ── Mapa de eventos ───────────────────────────────────────────────────────────

const EVENT_MAP = {
  "order_insert":         "order.created",
  "order_update":         "order.created",
  "product_insert":       "product.sync",
  "product_update":       "product.sync",
  "product_delete":       "product.deleted",
  "variant_stock_update": "product.sync",
  "variant_update":       "product.sync",
  "category_insert":      "category.sync",
  "category_update":      "category.sync",
  "category_delete":      "category.deleted",
};

// ── Normalização de webhook ───────────────────────────────────────────────────

export function normalizeWebhook(payload) {
  const scopeName = payload.scope_name || "";
  const act       = payload.act        || "";
  const key       = `${scopeName}_${act}`;
  const eventType = EVENT_MAP[key] || key;

  // ── Categoria deletada ──────────────────────────────────────────────────────
  if (eventType === "category.deleted") {
    return { eventType, categoryId: String(payload.scope_id || ""), needsApiFetch: false };
  }

  // ── Categoria criada/atualizada ─────────────────────────────────────────────
  if (eventType === "category.sync") {
    return { eventType, categoryId: String(payload.scope_id || ""), needsApiFetch: true };
  }

  // ── Produto deletado ────────────────────────────────────────────────────────
  if (eventType === "product.deleted") {
    return { eventType, productId: String(payload.scope_id || ""), needsApiFetch: false };
  }

  // ── Produto criado/atualizado ───────────────────────────────────────────────
  // Tray notifica apenas o ID — sempre buscar via API
  if (eventType === "product.sync") {
    return { eventType, productId: String(payload.scope_id || ""), needsApiFetch: true };
  }

  // ── Pedido criado/atualizado ────────────────────────────────────────────────
  // Tray notifica apenas o ID do pedido — sempre buscar via API
  if (eventType === "order.created") {
    return { eventType, orderId: String(payload.scope_id || ""), needsApiFetch: true };
  }

  return { eventType, needsApiFetch: true, rawScopeId: String(payload.scope_id || "") };
}

// ── Registro de webhooks ──────────────────────────────────────────────────────

/**
 * A Tray não permite registro de webhooks por tópico via API pública —
 * a URL de notificação do app é configurada uma única vez, durante o
 * processo de homologação do aplicativo, via chamado de suporte.
 */
export async function registerWebhooks(_config, webhookUrl) {
  return {
    success:     true,
    manual:      true,
    message:     `A Tray não permite registro automático de webhooks via API. Informe esta URL durante a homologação do seu app na Tray, via chamado de suporte: ${webhookUrl}`,
    webhook_url: webhookUrl,
    events:      [
      "order_insert", "product_insert", "product_update",
      "variant_stock_update", "category_insert", "category_update",
    ],
  };
}
