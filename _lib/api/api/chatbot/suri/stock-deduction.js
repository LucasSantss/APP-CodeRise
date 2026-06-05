/**
 * chatbot/suri/stock-deduction.js
 * Processa o evento OrdersPaid vindo da Suri via webhook.
 *
 * FLUXO:
 *   1. Recebe { HookEvent: "OrdersPaid", OrderId: "148221206" }
 *   2. Busca o pedido completo via GET {chatbot_url}/api/shop/orders/:id
 *   3. Extrai os itens (sku + paidQuantity)
 *   4. Para cada item, subtrai a quantidade do estoque na Nuvemshop
 *      via PUT /v1/{store_id}/products/{product_id}/variants/{variant_id}
 */

import { request } from "./client.js";
import { deductStockForOrderItems } from "../../ecommerce/nuvemshop/stock.js";

/**
 * Busca o pedido completo na Suri pelo ID.
 * Endpoint: GET {suri_endpoint}/api/shop/orders/:id
 *
 * @param {string} endpoint  - URL base da Suri (ex: https://chatbot.suri.com.br)
 * @param {string} token     - Token de autenticação Suri
 * @param {string} orderId   - ID do pedido
 * @returns {object}         - Dados completos do pedido
 */
async function fetchSuriOrder(endpoint, token, orderId) {
  const data = await request(endpoint, token, "GET", `/api/shop/orders/${orderId}`);

  // A Suri pode envolver o pedido em data.data ou data.order
  const order = data?.data || data?.order || data;
  if (!order || !order.id) {
    throw new Error(
      `Pedido ${orderId} não encontrado na Suri ou resposta inválida: ${JSON.stringify(data).slice(0, 200)}`
    );
  }
  return order;
}

/**
 * Extrai os itens relevantes do pedido da Suri.
 * Normaliza para [{ sku, quantity, name }].
 *
 * @param {object} order - Pedido completo da Suri
 * @returns {Array}
 */
function extractOrderItems(order) {
  const rawItems = order.items || [];
  return rawItems.map(item => ({
    sku: String(item.sku || item.Sku || item.providerId || ""),
    quantity: parseInt(item.paidQuantity ?? item.quantity ?? 1, 10),
    name: item.name || item.Name || "",
  }));
}

/**
 * Ponto de entrada principal para o evento OrdersPaid da Suri.
 *
 * @param {string} suriEndpoint  - URL base da Suri
 * @param {string} suriToken     - Token Suri
 * @param {string} orderId       - ID do pedido (vem do webhook)
 * @param {object} ecommerceConfig  - Config da Nuvemshop { store_id, access_token }
 * @returns {object}             - Resultado completo da operação
 */
export async function handleOrdersPaid(suriEndpoint, suriToken, orderId, ecommerceConfig) {
  if (!orderId) throw new Error("OrderId não informado no webhook da Suri");
  if (!ecommerceConfig?.store_id || !ecommerceConfig?.access_token) {
    throw new Error("Configuração da Nuvemshop incompleta (store_id e access_token são obrigatórios)");
  }

  // 1. Busca o pedido na Suri
  const order = await fetchSuriOrder(suriEndpoint, suriToken, orderId);

  // 2. Extrai itens
  const items = extractOrderItems(order);
  if (items.length === 0) {
    return {
      action: "stock_deduction_skipped",
      orderId,
      reason: "Pedido sem itens para baixa de estoque",
    };
  }

  // 3. Baixa de estoque na Nuvemshop
  const deductionResult = await deductStockForOrderItems(ecommerceConfig, items);

  return {
    action: "stock_deducted",
    orderId,
    suriOrderStatus: order.status,
    ...deductionResult,
  };
}
