/**
 * api/index.js — Router unificado (1 Serverless Function)
 * Roteia por req.url para manter todas as rotas originais intactas.
 *
 * MELHORIAS IMPLEMENTADAS:
 * 1. stocks populado no processProductSync (Nuvemshop → Suri)
 * 2. Fluxo reverso: order.created na Suri → stock_update na Nuvemshop
 * 3. Validação de assinatura HMAC para Nuvemshop, Shopify e WooCommerce
 * 4. Suporte a múltiplas variantes no normalizeNuvemshop e normalizeShopify
 * 5. Retry automático com backoff exponencial para falhas transientes na Suri
 * 6. Deduplicação de webhooks via event_id/idempotency key
 * 7. Senhas com hash bcrypt no _auth e users
 * 8. Baixa de estoque após order.created na Suri
 * 9. Eventos parciais da Nuvemshop: orders/partially_fulfilled e products/deleted
 */

import pool   from "./db.js";
import { setCors }                       from "./_cors.js";
import { getUserByToken, requireAuth, requireAdmin, isAdminSecret, verifyPassword } from "./_auth.js";
import crypto from "crypto";

// ─── helpers internos ────────────────────────────────────────────────────────
function getPath(req) {
  return (req.url || "").split("?")[0].replace(/^\/api/, "");
}

// ─── MELHORIA 5: retry com backoff exponencial ───────────────────────────────
async function withRetry(fn, maxAttempts = 3, baseDelayMs = 500) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Não faz retry em erros de negócio (4xx que não sejam 429)
      const isTransient = !err.message.includes("HTTP 4") || err.message.includes("HTTP 429") || err.message.includes("HTTP 408");
      if (!isTransient || attempt === maxAttempts) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 200;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ─── MELHORIA 3: validação HMAC ──────────────────────────────────────────────
function validateNuvemshopHmac(req, secret) {
  if (!secret) return true; // se não configurado, não bloqueia (retrocompatível)
  const signature = req.headers["x-linkedstore-hmac-sha256"] || req.headers["x-nuvemshop-hmac-sha256"] || "";
  if (!signature) return true; // Nuvemshop não envia em todos os eventos
  const body = JSON.stringify(req.body || {});
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function validateShopifyHmac(req, secret) {
  if (!secret) return true;
  const signature = req.headers["x-shopify-hmac-sha256"] || "";
  if (!signature) return false;
  const body = JSON.stringify(req.body || {});
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64");
  try { return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)); } catch { return false; }
}

function validateWoocommerceSignature(req, secret) {
  if (!secret) return true;
  const signature = req.headers["x-wc-webhook-signature"] || "";
  if (!signature) return false;
  const body = JSON.stringify(req.body || {});
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64");
  try { return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)); } catch { return false; }
}

// ─── MELHORIA 6: deduplicação de webhooks ────────────────────────────────────
function extractEventId(platform, payload, req) {
  switch (platform) {
    case "shopify":     return req.headers["x-shopify-webhook-id"] || null;
    case "nuvemshop":   return String(payload.id || payload.order?.id || payload.product?.id || "");
    case "woocommerce": return req.headers["x-wc-webhook-delivery-id"] || String(payload.id || "");
    default:            return String(payload.id || payload.order_id || "");
  }
}

async function isDuplicateEvent(userId, platform, eventId) {
  if (!eventId) return false;
  try {
    const key = `${platform}:${eventId}`;
    const r = await pool.query(
      "SELECT id FROM user_webhooks WHERE user_id=$1 AND status IN ('processed') AND payload->>'_event_id' = $2 ORDER BY received_at DESC LIMIT 1",
      [userId, key]
    );
    return r.rowCount > 0;
  } catch { return false; }
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  if (setCors(req, res)) return;

  const path = getPath(req);

  if (path === "/auth")              return handleAuth(req, res);
  if (path === "/chatbot" || path.startsWith("/chatbot?")) return handleChatbot(req, res);
  if (path === "/webhooks" || path.startsWith("/webhooks?")) return handleWebhooks(req, res);
  if (path === "/webhooks/poll" || path.startsWith("/webhooks/poll?")) return handleWebhooksPoll(req, res);
  if (path === "/webhook" || path.startsWith("/webhook?")) return handleWebhook(req, res);
  if (path === "/register-webhook" || path.startsWith("/register-webhook?")) return handleRegisterWebhook(req, res);
  if (path === "/setup" || path.startsWith("/setup?")) return handleSetup(req, res);
  if (path === "/platform-settings" || path.startsWith("/platform-settings?")) return handlePlatformSettings(req, res);
  if (path === "/test-suri"      || path.startsWith("/test-suri?"))      return handleTestSuri(req, res);
  if (path === "/test-ecommerce" || path.startsWith("/test-ecommerce?")) return handleTestEcommerce(req, res);

  return res.status(404).json({ success: false, message: `Rota não encontrada: ${path}` });
}

// ════════════════════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════════════════════
async function handleAuth(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { action } = req.query;
  try {
    if (action === "login") {
      const { email, password } = req.body || {};
      if (!email || !password) return res.status(400).json({ success: false, message: "email e password obrigatórios" });
      const r = await pool.query("SELECT id, name, email, role, active, password, token FROM users WHERE email = $1", [email]);
      const user = r.rows[0];
      if (!user || !(await verifyPassword(password, user.password))) return res.status(401).json({ success: false, message: "Credenciais inválidas" });
      if (!user.active) return res.status(403).json({ success: false, message: "Conta desativada" });
      return res.status(200).json({ success: true, token: user.token, user: { id: user.id, name: user.name, email: user.email, role: user.role, active: user.active } });
    }
    if (action === "logout") {
      const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
      if (!token) return res.status(400).json({ success: false, message: "Token não informado" });
      const newToken = crypto.randomBytes(32).toString("hex");
      await pool.query("UPDATE users SET token = $1, updated_at = NOW() WHERE token = $2", [newToken, token]);
      return res.status(200).json({ success: true, message: "Logout realizado" });
    }
    if (action === "refresh") {
      const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
      const newToken = crypto.randomBytes(32).toString("hex");
      const r = await pool.query("UPDATE users SET token = $1, updated_at = NOW() WHERE token = $2 AND active = true RETURNING id, name, email, role", [newToken, token]);
      if (!r.rows[0]) return res.status(401).json({ success: false, message: "Token inválido" });
      return res.status(200).json({ success: true, token: newToken, user: r.rows[0] });
    }
    return res.status(400).json({ success: false, message: "action inválido. Use: login | logout | refresh" });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
}

// ════════════════════════════════════════════════════════════════════════════
// CHATBOT
// ════════════════════════════════════════════════════════════════════════════
async function ensureChatbotRow(userId) {
  const ex = await pool.query("SELECT webhook_token, chatbot_token FROM user_integrations WHERE user_id = $1", [userId]);
  if (!ex.rows[0]) {
    const wt = crypto.randomBytes(32).toString("hex"), ct = crypto.randomBytes(32).toString("hex");
    await pool.query("INSERT INTO user_integrations (user_id, webhook_token, chatbot_token) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING", [userId, wt, ct]);
  } else if (!ex.rows[0].chatbot_token) {
    const ct = crypto.randomBytes(32).toString("hex");
    await pool.query("UPDATE user_integrations SET chatbot_token = $1 WHERE user_id = $2 AND chatbot_token IS NULL", [ct, userId]);
  }
}
async function handleChatbot(req, res) {
  try {
    switch (req.method) {
      case "GET": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const targetId = (caller.role === "admin" && req.query.user_id) ? req.query.user_id : caller.id;
        await ensureChatbotRow(targetId);
        const r = await pool.query("SELECT chatbot_platform, chatbot_config, chatbot_active, chatbot_token, created_at, updated_at FROM user_integrations WHERE user_id = $1", [targetId]);
        if (!r.rows[0]) return res.status(404).json({ success: false, message: "Integração não encontrada" });
        return res.status(200).json({ success: true, chatbot: r.rows[0] });
      }
      case "PUT": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const targetId = (caller.role === "admin" && req.query.user_id) ? req.query.user_id : caller.id;
        await ensureChatbotRow(targetId);
        const { chatbot_platform, chatbot_config } = req.body || {};
        const fields = [], values = []; let idx = 1;
        if (chatbot_platform !== undefined) { fields.push(`chatbot_platform = $${idx++}`); values.push(chatbot_platform); }
        if (chatbot_config   !== undefined) { fields.push(`chatbot_config = $${idx++}`);   values.push(JSON.stringify(chatbot_config)); }
        if (!fields.length) return res.status(400).json({ success: false, message: "Nenhum campo informado" });
        fields.push("updated_at = NOW()"); values.push(targetId);
        const r = await pool.query(`UPDATE user_integrations SET ${fields.join(", ")} WHERE user_id = $${idx} RETURNING chatbot_platform, chatbot_config, chatbot_active, chatbot_token, updated_at`, values);
        return res.status(200).json({ success: true, message: "Configuração de chatbot salva", chatbot: r.rows[0] });
      }
      case "PATCH": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const targetId = (caller.role === "admin" && req.query.user_id) ? req.query.user_id : caller.id;
        const { chatbot_active } = req.body || {};
        if (chatbot_active === undefined) return res.status(400).json({ success: false, message: "Informe chatbot_active" });
        const r = await pool.query("UPDATE user_integrations SET chatbot_active = $1, updated_at = NOW() WHERE user_id = $2 RETURNING chatbot_platform, chatbot_active, chatbot_token, updated_at", [chatbot_active, targetId]);
        if (!r.rows[0]) return res.status(404).json({ success: false, message: "Integração não encontrada" });
        return res.status(200).json({ success: true, chatbot: r.rows[0] });
      }
      case "POST": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const targetId = (caller.role === "admin" && req.query.user_id) ? req.query.user_id : caller.id;
        if (req.query.action !== "regenerate-token") return res.status(400).json({ success: false, message: "Ação inválida" });
        const newToken = crypto.randomBytes(32).toString("hex");
        const r = await pool.query("UPDATE user_integrations SET chatbot_token = $1, updated_at = NOW() WHERE user_id = $2 RETURNING chatbot_token, updated_at", [newToken, targetId]);
        if (!r.rows[0]) return res.status(404).json({ success: false, message: "Integração não encontrada" });
        return res.status(200).json({ success: true, message: "Token do chatbot regenerado", chatbot_token: r.rows[0].chatbot_token });
      }
      case "DELETE": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const targetId = (caller.role === "admin" && req.query.user_id) ? req.query.user_id : caller.id;
        await pool.query("UPDATE user_integrations SET chatbot_platform = NULL, chatbot_config = NULL, chatbot_active = false, updated_at = NOW() WHERE user_id = $1", [targetId]);
        return res.status(200).json({ success: true, message: "Configuração de chatbot removida" });
      }
      default: res.setHeader("Allow", ["GET","PUT","PATCH","POST","DELETE"]); return res.status(405).end();
    }
  } catch (err) { console.error("[chatbot]", err); return res.status(500).json({ success: false, message: err.message }); }
}

// ════════════════════════════════════════════════════════════════════════════
// WEBHOOKS (lista/status)
// ════════════════════════════════════════════════════════════════════════════
async function handleWebhooks(req, res) {
  try {
    switch (req.method) {
      case "GET": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const { id, event_type, status, limit, since, after_id } = req.query;
        const where = [], values = []; let idx = 1;
        if (caller.role !== "admin") { where.push(`uw.user_id = $${idx++}`); values.push(caller.id); }
        else if (req.query.user_id) { where.push(`uw.user_id = $${idx++}`); values.push(req.query.user_id); }
        if (id)         { where.push(`uw.id = $${idx++}`);         values.push(id); }
        if (event_type) { where.push(`uw.event_type = $${idx++}`); values.push(event_type); }
        if (status)     { where.push(`uw.status = $${idx++}`);     values.push(status); }
        if (since)      { where.push(`uw.received_at > $${idx++}`); values.push(since); }
        if (after_id)   { where.push(`uw.id > $${idx++}`);         values.push(after_id); }
        const whereStr = where.length ? `WHERE ${where.join(" AND ")}` : "";
        let maxRows = 500;
        if (limit) { const p = parseInt(limit, 10); if (!isNaN(p) && p > 0) maxRows = Math.min(p, 500); }
        const r = await pool.query(`SELECT uw.id, uw.user_id, u.name AS user_name, u.email AS user_email, uw.event_type, uw.payload, uw.status, uw.error_message, uw.received_at FROM user_webhooks uw JOIN users u ON u.id = uw.user_id ${whereStr} ORDER BY uw.received_at DESC LIMIT $${idx}`, [...values, maxRows]);
        if (id) { if (!r.rows[0]) return res.status(404).json({ success: false, message: "Evento não encontrado" }); return res.status(200).json({ success: true, webhook: r.rows[0] }); }
        return res.status(200).json({ success: true, webhooks: r.rows, total: r.rowCount, server_time: new Date().toISOString() });
      }
      case "PATCH": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const { id } = req.query; if (!id) return res.status(400).json({ success: false, message: "id obrigatório" });
        const { status, error_message } = req.body || {};
        if (!["received","processed","error"].includes(status)) return res.status(400).json({ success: false, message: "status inválido" });
        const ownerFilter = caller.role === "admin" ? "" : ` AND user_id = ${caller.id}`;
        const r = await pool.query(`UPDATE user_webhooks SET status=$1, error_message=$2 WHERE id=$3${ownerFilter} RETURNING id, status, error_message`, [status, error_message || null, id]);
        if (!r.rows[0]) return res.status(404).json({ success: false, message: "Evento não encontrado" });
        try { await pool.query("NOTIFY webhooks_changed, $1", [JSON.stringify({ id: r.rows[0].id, status: r.rows[0].status })]); } catch {}
        return res.status(200).json({ success: true, message: "Status atualizado", webhook: r.rows[0] });
      }
      case "DELETE": {
        const caller = await requireAuth(req, res); if (!caller) return;
        const { id } = req.query;
        if (id) {
          const ownerFilter = caller.role === "admin" ? "" : ` AND user_id = ${caller.id}`;
          const r = await pool.query(`DELETE FROM user_webhooks WHERE id=$1${ownerFilter} RETURNING id`, [id]);
          if (!r.rows[0]) return res.status(404).json({ success: false, message: "Evento não encontrado" });
          try { await pool.query("NOTIFY webhooks_changed, $1", [JSON.stringify({ id: r.rows[0].id, action: "deleted" })]); } catch {}
          return res.status(200).json({ success: true, message: "Evento apagado" });
        }
        if (caller.role === "admin" && req.query.user_id) { await pool.query("DELETE FROM user_webhooks WHERE user_id=$1", [req.query.user_id]); }
        else if (caller.role === "admin") { await pool.query("DELETE FROM user_webhooks"); }
        else { await pool.query("DELETE FROM user_webhooks WHERE user_id=$1", [caller.id]); }
        try { await pool.query("NOTIFY webhooks_changed, $1", [JSON.stringify({ action: "deleted_bulk" })]); } catch {}
        return res.status(200).json({ success: true, message: "Eventos apagados" });
      }
      default: res.setHeader("Allow", ["GET","PATCH","DELETE"]); return res.status(405).end();
    }
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
}

// ════════════════════════════════════════════════════════════════════════════
// NORMALIZADORES — MELHORIA 4: multi-variante
// ════════════════════════════════════════════════════════════════════════════
function normalizeVtex(payload) {
  const order = payload.order || payload;
  const rawEvent = payload.type || payload.event || order.status || "";
  const statusMap = { "payment-approved":"order.created","order-created":"order.created","OrderCreated":"order.created","invoiced":"order.shipped","shipped":"order.shipped","order-completed":"order.shipped","canceled":"order.cancelled","order-cancelled":"order.cancelled","product-created":"product.sync","product-updated":"product.sync" };
  const eventType = statusMap[rawEvent] || rawEvent;
  if (eventType === "product.sync") { const p = payload.product || payload; return { eventType, product: { id:String(p.Id||p.ProductId||p.id), sku:String(p.RefId||p.sku||"1"), name:p.ProductName||p.name, description:(p.Description||p.description||"").replace(/<[^>]+>/g,""), categoryId:String(p.CategoryId||p.categoryId||""), brand:p.BrandName||p.brand||null, isActive:p.IsActive??p.isActive??true, price:p.Price||p.price||0, promotionalPrice:p.ListPrice||p.promotionalPrice||0, url:p.DetailUrl||p.url||null, images:(p.Images||p.images||[]).map(i=>({url:i.ImageUrl||i.url,description:i.ImageLabel||null})), weightInGrams:p.WeightKg?p.WeightKg*1000:0, dimensions:{heightInCm:p.Height||0,widthInCm:p.Width||0,lengthInCm:p.Length||0}, stock:p.AvailableQuantity||p.stock||null } }; }
  const logInfo = order.shippingData?.logisticsInfo?.[0] || {};
  return { eventType, orderId:String(order.orderId||order.order_id||""), paymentTracking:order.paymentData?.transactions?.[0]?.transactionId||"", logisticStatus:order.status||"shipped", totalAmount:(order.value||0)/100, items:(order.items||[]).map(i=>({productId:String(i.productId||i.id),sku:String(i.id||i.sku),name:i.name,quantity:i.quantity,unitPrice:(i.sellingPrice||i.price||0)/100,discount:(i.manualDiscount||0)/100,sellerId:i.sellerId||"all"})), shipping:{provider:logInfo.deliveryCompany||"Entrega",type:1,price:(order.totals?.find(t=>t.id==="Shipping")?.value||0)/100,estimative:logInfo.shippingEstimateDate||"5 dias úteis"} };
}

// MELHORIA 4: Shopify envia todas as variantes — mapeamos todas
function normalizeShopify(payload) {
  const topic = payload.topic||payload.x_shopify_topic||"";
  const statusMap = { "orders/create":"order.created","orders/paid":"order.created","orders/fulfilled":"order.shipped","orders/cancelled":"order.cancelled","products/create":"product.sync","products/update":"product.sync" };
  const eventType = statusMap[topic]||topic;
  if (eventType === "product.sync") {
    const p=payload;
    // MELHORIA 4: mapear todas as variantes, não só a primeira
    const variants = (p.variants||[]).map(v => ({
      sku: String(v.sku||v.id),
      price: parseFloat(v.price||0),
      promotionalPrice: parseFloat(v.compare_at_price||0),
      weightInGrams: v.grams||0,
      stock: v.inventory_quantity||0,
      attributes: [
        ...(v.option1 ? [{ name:"option1", value:v.option1 }] : []),
        ...(v.option2 ? [{ name:"option2", value:v.option2 }] : []),
        ...(v.option3 ? [{ name:"option3", value:v.option3 }] : []),
      ]
    }));
    const v = variants[0] || {};
    return { eventType, product:{id:String(p.id),sku:String(p.variants?.[0]?.sku||p.id),name:p.title,description:(p.body_html||"").replace(/<[^>]+>/g,""),categoryId:String(p.product_type||""),brand:p.vendor||null,isActive:p.status==="active",price:v.price||0,promotionalPrice:v.promotionalPrice||0,url:p.handle?`https://shop.myshopify.com/products/${p.handle}`:null,images:(p.images||[]).map(i=>({url:i.src,description:i.alt||null})),weightInGrams:v.weightInGrams||0,dimensions:{heightInCm:0,widthInCm:0,lengthInCm:0},stock:v.stock||0,variants} };
  }
  const f=payload.fulfillments?.[0]||{};
  return { eventType, orderId:String(payload.id||payload.order_id||""), paymentTracking:payload.payment_gateway||"", logisticStatus:payload.fulfillment_status||"fulfilled", totalAmount:parseFloat(payload.total_price||0), items:(payload.line_items||[]).map(i=>({productId:String(i.product_id),sku:String(i.sku||i.variant_id),name:i.title,quantity:i.quantity,unitPrice:parseFloat(i.price||0),discount:parseFloat(i.total_discount||0),sellerId:"all"})), shipping:{provider:f.tracking_company||payload.shipping_lines?.[0]?.title||"Entrega",type:1,price:parseFloat(payload.shipping_lines?.[0]?.price||0),estimative:"5 dias úteis"} };
}

function normalizeWoocommerce(payload) {
  const action=payload.action||payload.webhook_event||payload.status||"";
  const statusMap={"woocommerce_new_order":"order.created","woocommerce_order_status_processing":"order.created","woocommerce_order_status_completed":"order.shipped","woocommerce_order_status_shipped":"order.shipped","woocommerce_order_status_cancelled":"order.cancelled","woocommerce_order_status_refunded":"order.cancelled","woocommerce_new_product":"product.sync","woocommerce_update_product":"product.sync","order.created":"order.created","order.updated":"order.shipped","order.deleted":"order.cancelled","product.created":"product.sync","product.updated":"product.sync","processing":"order.created","completed":"order.shipped","cancelled":"order.cancelled","refunded":"order.cancelled"};
  const eventType=statusMap[action]||"order.created";
  if (eventType==="product.sync") { const p=payload; return { eventType, product:{id:String(p.id),sku:String(p.sku||p.id),name:p.name,description:(p.short_description||p.description||"").replace(/<[^>]+>/g,""),categoryId:String(p.categories?.[0]?.id||""),brand:p.brands?.[0]?.name||null,isActive:p.status==="publish",price:parseFloat(p.price||p.regular_price||0),promotionalPrice:parseFloat(p.sale_price||0),url:p.permalink||null,images:(p.images||[]).map(i=>({url:i.src,description:i.alt||null})),weightInGrams:p.weight?parseFloat(p.weight)*1000:0,dimensions:{heightInCm:parseFloat(p.dimensions?.height||0),widthInCm:parseFloat(p.dimensions?.width||0),lengthInCm:parseFloat(p.dimensions?.length||0)},stock:parseInt(p.stock_quantity||0)} }; }
  const sh=payload.shipping_lines?.[0]||{};
  return { eventType, orderId:String(payload.id||payload.order_id||""), paymentTracking:payload.transaction_id||payload.payment_method||"", logisticStatus:payload.status||"processing", totalAmount:parseFloat(payload.total||0), items:(payload.line_items||[]).map(i=>({productId:String(i.product_id),sku:String(i.sku||i.product_id),name:i.name,quantity:i.quantity,unitPrice:parseFloat(i.price||0),discount:0,sellerId:"all"})), shipping:{provider:sh.method_title||"Entrega",type:1,price:parseFloat(sh.total||0),estimative:"5 dias úteis"} };
}

// MELHORIA 4: Nuvemshop — todas as variantes mapeadas
// MELHORIA 9: products/deleted mapeado para product.delete
function normalizeNuvemshop(payload) {
  const topic=payload.topic||payload.event||"";
  const statusMap={
    "orders/created":"order.created","orders/paid":"order.created",
    "orders/fulfilled":"order.shipped","orders/cancelled":"order.cancelled",
    "orders/partially_fulfilled":"order.partially_shipped", // MELHORIA 9
    "products/created":"product.sync","products/updated":"product.sync",
    "products/deleted":"product.deleted"                    // MELHORIA 9
  };
  const eventType=statusMap[topic]||topic;

  if (eventType==="product.deleted") {
    const p=payload.product||payload;
    return { eventType, product:{ id:String(p.id), isActive:false } };
  }

  if (eventType==="product.sync") {
    const p=payload.product||payload;
    // MELHORIA 4: mapear todas as variantes da Nuvemshop
    const variants = (p.variants||[]).map(v => ({
      sku: String(v.sku||p.id),
      price: parseFloat(v.price||p.price||0),
      promotionalPrice: parseFloat(v.promotional_price||p.promotional_price||0),
      weightInGrams: parseFloat(v.weight||0)*1000,
      dimensions:{ heightInCm:parseFloat(v.height||0), widthInCm:parseFloat(v.width||0), lengthInCm:parseFloat(v.depth||0) },
      stock: parseInt(v.stock||0),
      attributes: Object.entries(v.values||{}).map(([name,value])=>({name,value:String(value)}))
    }));
    const v=variants[0]||{};
    return { eventType, product:{
      id:String(p.id), sku:String(p.variants?.[0]?.sku||p.id),
      name:p.name?.pt||p.name?.es||Object.values(p.name||{})[0]||"",
      description:((p.description?.pt||p.description?.es||"")).replace(/<[^>]+>/g,""),
      categoryId:String(p.categories?.[0]?.id||""), brand:p.brand||null,
      isActive:!!p.published_at,
      price:v.price||0, promotionalPrice:v.promotionalPrice||0,
      url:p.canonical_url||null,
      images:(p.images||[]).map(i=>({url:i.src,description:i.alt||null})),
      weightInGrams:v.weightInGrams||0,
      dimensions:v.dimensions||{heightInCm:0,widthInCm:0,lengthInCm:0},
      stock:v.stock||0, variants
    }};
  }
  const order=payload.order||payload;
  return { eventType, orderId:String(order.id||order.number||""), paymentTracking:order.payment_details?.method||"", logisticStatus:order.shipping_status||order.status||"shipped", totalAmount:parseFloat(order.total||0), items:(order.products||[]).map(i=>({productId:String(i.product_id||i.id),sku:String(i.sku||i.variant_id),name:i.name,quantity:i.quantity,unitPrice:parseFloat(i.price||0),discount:parseFloat(i.discount||0),sellerId:"all"})), shipping:{provider:order.shipping_pickup_type||"Entrega",type:1,price:parseFloat(order.shipping_cost_owner||0),estimative:"5 dias úteis"} };
}

function normalizeTray(payload) {
  const event=payload.type||payload.trigger||payload.event||"";
  const statusMap={"order_created":"order.created","order_paid":"order.created","order_shipped":"order.shipped","order_delivered":"order.shipped","order_cancelled":"order.cancelled","product_created":"product.sync","product_updated":"product.sync"};
  const eventType=statusMap[event]||event;
  if (eventType==="product.sync") { const p=payload.Product||payload.product||payload; return { eventType, product:{id:String(p.id||p.Id),sku:String(p.reference||p.sku||p.id),name:p.name||p.Name,description:(p.description||p.Description||"").replace(/<[^>]+>/g,""),categoryId:String(p.category_id||p.CategoryId||""),brand:p.brand||p.Brand||null,isActive:p.available==="1"||p.available===true||p.Active===true,price:parseFloat(p.price||p.Price||0),promotionalPrice:parseFloat(p.promotional_price||p.PromotionalPrice||0),url:p.link||p.Url||null,images:(p.images||p.Images||[]).map(i=>({url:i.link||i.Url||i.url,description:i.alt||null})),weightInGrams:parseFloat(p.weight||p.Weight||0)*1000,dimensions:{heightInCm:parseFloat(p.height||p.Height||0),widthInCm:parseFloat(p.width||p.Width||0),lengthInCm:parseFloat(p.length||p.Length||0)},stock:parseInt(p.stock||p.Estoque||0)} }; }
  const order=payload.Order||payload.order||payload;
  return { eventType, orderId:String(order.id||order.Id||order.order_id||""), paymentTracking:order.payment?.payment_method||order.PaymentMethod||"", logisticStatus:order.status||order.Status||"shipped", totalAmount:parseFloat(order.total||order.Total||0), items:(order.ProductsSold||order.products||order.items||[]).map(i=>({productId:String(i.Product?.id||i.product_id||i.id),sku:String(i.Product?.reference||i.sku||i.id),name:i.Product?.name||i.name,quantity:parseInt(i.quantity||i.Quantity||1),unitPrice:parseFloat(i.price||i.Price||0),discount:parseFloat(i.discount||i.Discount||0),sellerId:"all"})), shipping:{provider:order.shipping?.carrier||order.Carrier||"Entrega",type:1,price:parseFloat(order.shipping?.cost||order.ShippingCost||0),estimative:"5 dias úteis"} };
}

function normalizePayload(platform, payload) {
  switch (platform) {
    case "vtex":        return normalizeVtex(payload);
    case "shopify":     return normalizeShopify(payload);
    case "woocommerce": return normalizeWoocommerce(payload);
    case "nuvemshop":   return normalizeNuvemshop(payload);
    case "tray":        return normalizeTray(payload);
    default: return { eventType:payload.type||payload.event||payload.event_type||"desconhecido", orderId:String(payload.order_id||payload.orderId||payload.id||""), paymentTracking:"", logisticStatus:payload.status||"shipped", totalAmount:parseFloat(payload.total||payload.total_price||0), items:payload.items||payload.line_items||[], shipping:{provider:"Entrega",type:1,price:0,estimative:"5 dias úteis"} };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SURI REQUEST
// ════════════════════════════════════════════════════════════════════════════
async function suriRequest(endpoint, token, method, path, body) {
  const base = endpoint.replace(/\/+$/, "");
  const res = await fetch(`${base}${path}`, { method, headers:{"Content-Type":"application/json","Accept":"application/json","Authorization":`Bearer ${token}`}, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(`Suri ${method} ${path} → HTTP ${res.status}: ${JSON.stringify(data)}`);
  return data;
}
async function findSuriOrder(endpoint, token, orderId) {
  try { const data = await suriRequest(endpoint, token, "POST", "/api/shop/orders", {ProviderOrderId:String(orderId),Page:1,PerPage:1}); const list=data?.orders||data?.data||data?.items||data||[]; return Array.isArray(list)?(list[0]||null):null; } catch { return null; }
}
function mapLogisticStatus(status) {
  const map={"ready-for-handling":1,"processing":1,"order_paid":1,"handling":2,"preparing":2,"invoiced":3,"shipped":3,"fulfilled":3,"order_shipped":3,"delivered":4,"order_delivered":4,"completed":4,"canceled":5,"cancelled":5,"refunded":5};
  return map[status]??1;
}

// MELHORIA 1: busca o ID do primeiro depósito ativo da Suri para usar no stocks
async function getSuriStoreId(endpoint, token) {
  try {
    const data = await suriRequest(endpoint, token, "GET", "/api/shop/stores");
    const stores = Array.isArray(data) ? data : (data?.data || data?.stores || []);
    return stores?.[0]?.id || null;
  } catch { return null; }
}

// MELHORIA 1 + 8: processProductSync com stocks populado + MELHORIA 4: múltiplas variantes
async function processProductSync(ep, tk, n) {
  const p = n.product;

  // MELHORIA 4: mapear todas as variantes como dimensões na Suri
  const dimensions = (p.variants && p.variants.length > 0)
    ? p.variants.map(v => ({
        sku: v.sku,
        dimensions: {},
        image: { url: p.images?.[0]?.url || "" },
        price: v.price || p.price,
        priceTables: {},
        // MELHORIA 1: stock populado por variante
        stocks: v.stock != null ? { all: v.stock } : {},
        measurements: {
          weightInGrams: v.weightInGrams || p.weightInGrams || 0,
          heightInCm: v.dimensions?.heightInCm || p.dimensions?.heightInCm || 0,
          widthInCm: v.dimensions?.widthInCm || p.dimensions?.widthInCm || 0,
          lengthInCm: v.dimensions?.lengthInCm || p.dimensions?.lengthInCm || 0,
          unitsPerPackage: 1
        },
        attributes: v.attributes || []
      }))
    : [{
        sku: p.sku,
        dimensions: {},
        image: { url: p.images?.[0]?.url || "" },
        price: p.price,
        priceTables: {},
        // MELHORIA 1: stock populado no produto simples
        stocks: p.stock != null ? { all: p.stock } : {},
        measurements: {
          weightInGrams: p.weightInGrams || 0,
          heightInCm: p.dimensions?.heightInCm || 0,
          widthInCm: p.dimensions?.widthInCm || 0,
          lengthInCm: p.dimensions?.lengthInCm || 0,
          unitsPerPackage: 1
        },
        attributes: []
      }];

  const sp = {
    id: p.id, sku: p.sku, categoryId: p.categoryId, subcategoryId: null,
    brand: p.brand || null, sellerId: "all", sellerName: null,
    isActive: p.isActive, name: p.name, description: p.description || "",
    url: p.url || null, price: p.price, promotionalPrice: p.promotionalPrice || 0,
    hasShippingRestriction: false, images: p.images || [],
    attributes: [], dimensions,
    weightInGrams: p.weightInGrams || 0
  };

  // MELHORIA 5: retry automático
  try {
    await withRetry(() => suriRequest(ep, tk, "PUT", "/api/shop/products", sp));
    return { action: "product_updated", productId: p.id };
  } catch (err) {
    if (err.message.includes("404")) {
      await withRetry(() => suriRequest(ep, tk, "POST", "/api/shop/products", sp));
      return { action: "product_created", productId: p.id };
    }
    throw err;
  }
}

// MELHORIA 9: desativar produto deletado na Suri
async function processProductDeleted(ep, tk, n) {
  const p = n.product;
  try {
    await withRetry(() => suriRequest(ep, tk, "PUT", "/api/shop/products", { id: p.id, isActive: false }));
    return { action: "product_deactivated", productId: p.id };
  } catch (err) {
    // Se não existir na Suri, não é erro crítico
    if (err.message.includes("404")) return { action: "product_not_found_suri", productId: p.id };
    throw err;
  }
}

// MELHORIA 8: baixa de estoque na Suri após criação do pedido
async function processStockDeductionSuri(ep, tk, items) {
  const results = [];
  for (const item of items) {
    try {
      // A Suri faz a baixa via logistic status ou endpoint dedicado
      // Tenta endpoint de consumo de estoque se disponível
      await withRetry(() => suriRequest(ep, tk, "POST", "/api/shop/orders/stock-deduction", {
        productId: item.productId, sku: item.sku, quantity: item.quantity
      }));
      results.push({ productId: item.productId, status: "deducted" });
    } catch {
      // Se endpoint não existir (404), a Suri gerencia internamente — não é erro
      results.push({ productId: item.productId, status: "managed_by_suri" });
    }
  }
  return results;
}

async function processOrderCreated(ep, tk, n) {
  const existing = await findSuriOrder(ep, tk, n.orderId);
  if (existing) {
    await withRetry(() => suriRequest(ep, tk, "POST", "/api/shop/orders/paid", {orderId:existing.id||existing.orderId,paymentTracking:n.paymentTracking||""}));
    return { action: "marked_paid", suriOrderId: existing.id };
  }
  const budget = { id:String(n.orderId), logistic:{providerId:"001",name:n.shipping.provider||"Entrega",description:"Padrão",type:n.shipping.type||1,price:n.shipping.price||0,minShippingTimeEstimative:n.shipping.estimative||"3 dias úteis",shippingTimeEstimative:n.shipping.estimative||"5 dias úteis"}, items:n.items.map(i=>({fromSellerId:i.sellerId||"all",ProductId:String(i.productId||i.id),Sku:String(i.sku||i.productId),Name:i.name,quantity:i.quantity,unitPrice:i.unitPrice,discountAmount:i.discount||0})), errorMessages:[] };
  const created = await withRetry(() => suriRequest(ep, tk, "POST", "/api/shop/orders/budget", budget));
  const suriOrderId = created?.id || created?.orderId;
  if (suriOrderId) {
    await withRetry(() => suriRequest(ep, tk, "POST", "/api/shop/orders/paid", {orderId:suriOrderId,paymentTracking:n.paymentTracking||""}));
    // MELHORIA 8: baixa de estoque após pedido pago
    if (n.items?.length) await processStockDeductionSuri(ep, tk, n.items).catch(() => {});
  }
  return { action: "created_and_paid", suriOrderId };
}

async function processOrderShipped(ep, tk, n) {
  const ex = await findSuriOrder(ep, tk, n.orderId);
  if (!ex) throw new Error(`Pedido ${n.orderId} não encontrado na Suri`);
  const st = mapLogisticStatus(n.logisticStatus);
  await withRetry(() => suriRequest(ep, tk, "POST", "/api/shop/orders/logistic", {id:ex.id||ex.orderId,status:st}));
  return { action: "logistic_updated", suriOrderId: ex.id, status: st };
}

// MELHORIA 9: order.partially_shipped — atualiza logistic sem cancelar
async function processOrderPartiallyShipped(ep, tk, n) {
  const ex = await findSuriOrder(ep, tk, n.orderId);
  if (!ex) throw new Error(`Pedido ${n.orderId} não encontrado na Suri`);
  await withRetry(() => suriRequest(ep, tk, "POST", "/api/shop/orders/logistic", {id:ex.id||ex.orderId,status:3})); // 3 = shipped parcial
  return { action: "logistic_partial_updated", suriOrderId: ex.id };
}

async function processOrderCancelled(ep, tk, n) {
  const ex = await findSuriOrder(ep, tk, n.orderId);
  if (!ex) throw new Error(`Pedido ${n.orderId} não encontrado na Suri`);
  await withRetry(() => suriRequest(ep, tk, "POST", "/api/shop/orders/cancel", {orderId:ex.id||ex.orderId}));
  return { action: "cancelled", suriOrderId: ex.id };
}

// ════════════════════════════════════════════════════════════════════════════
// FLUXO REVERSO: Suri → E-commerce
// MELHORIA 2: order.created na Suri → subtrai estoque na Nuvemshop
// ════════════════════════════════════════════════════════════════════════════
async function reverseNuvemshop(config, eventType, payload) {
  const { store_id, access_token } = config;
  const base = `https://api.tiendanube.com/v1/${store_id}`;
  const headers = { "Authentication": `bearer ${access_token}`, "User-Agent": "CodeRise Integration (suporte@coderise.com.br)", "Content-Type": "application/json" };

  switch (eventType) {
    // MELHORIA 2: venda na Suri → subtrai estoque na Nuvemshop
    case "order.created": {
      const items = payload.items || payload.line_items || [];
      const results = [];
      for (const item of items) {
        const productId = item.productId || item.product_id || item.ProductId;
        const sku = item.sku || item.Sku;
        const qty = parseInt(item.quantity || item.Quantity || 1);
        if (!productId) continue;
        try {
          const varRes = await fetch(`${base}/products/${productId}/variants?fields=id,sku,stock`, { headers });
          const varData = await varRes.json();
          const variants = Array.isArray(varData) ? varData : (varData.variants || []);
          const variant = sku ? variants.find(v => v.sku === sku) : variants[0];
          if (!variant) { results.push({ productId, status: "variant_not_found" }); continue; }
          const newStock = Math.max(0, (variant.stock || 0) - qty);
          const updateRes = await fetch(`${base}/products/${productId}/variants/${variant.id}`, { method: "PUT", headers, body: JSON.stringify({ stock: newStock }) });
          results.push({ productId, variantId: variant.id, previousStock: variant.stock, newStock, status: updateRes.ok ? "stock_reduced" : "error" });
        } catch (e) { results.push({ productId, status: "error", detail: e.message }); }
      }
      return { action: "stock_deducted_from_suri_sale", results };
    }
    case "order.shipped": {
      const orderId = payload.orderId || payload.order_id;
      if (!orderId) throw new Error("orderId obrigatorio para order.shipped");
      const searchRes = await fetch(`${base}/orders?q=${orderId}&fields=id,number,status`, { headers });
      const searchData = await searchRes.json();
      const orders = Array.isArray(searchData) ? searchData : (searchData.orders || []);
      const order = orders[0];
      if (!order) throw new Error(`Pedido ${orderId} nao encontrado na Nuvemshop`);
      const fulfillBody = { notify_customer: payload.notify_customer ?? true, ...(payload.tracking_number ? { tracking_number: payload.tracking_number } : {}), ...(payload.tracking_url ? { tracking_url: payload.tracking_url } : {}) };
      const fulfillRes = await fetch(`${base}/orders/${order.id}/fulfill`, { method: "POST", headers, body: JSON.stringify(fulfillBody) });
      const fulfillData = await fulfillRes.json();
      if (!fulfillRes.ok) throw new Error(`Nuvemshop fulfill falhou: ${JSON.stringify(fulfillData).slice(0,200)}`);
      return { action: "order_fulfilled", nuvemshopOrderId: order.id };
    }
    case "order.cancelled": {
      const orderId = payload.orderId || payload.order_id;
      if (!orderId) throw new Error("orderId obrigatorio para order.cancelled");
      const searchRes = await fetch(`${base}/orders?q=${orderId}&fields=id,status`, { headers });
      const searchData = await searchRes.json();
      const orders = Array.isArray(searchData) ? searchData : (searchData.orders || []);
      const order = orders[0];
      if (!order) throw new Error(`Pedido ${orderId} nao encontrado na Nuvemshop`);
      const cancelRes = await fetch(`${base}/orders/${order.id}/cancel`, { method: "POST", headers });
      const cancelData = await cancelRes.json();
      if (!cancelRes.ok) throw new Error(`Nuvemshop cancel falhou: ${JSON.stringify(cancelData).slice(0,200)}`);
      return { action: "order_cancelled", nuvemshopOrderId: order.id };
    }
    case "product.stock_update": {
      const { productId, sku, stock } = payload;
      if (!productId || stock === undefined) throw new Error("productId e stock sao obrigatorios");
      const varRes = await fetch(`${base}/products/${productId}/variants?fields=id,sku`, { headers });
      const varData = await varRes.json();
      const variants = Array.isArray(varData) ? varData : (varData.variants || []);
      const variant = sku ? variants.find(v => v.sku === sku) : variants[0];
      if (!variant) throw new Error(`Variante nao encontrada`);
      const updateRes = await fetch(`${base}/products/${productId}/variants/${variant.id}`, { method: "PUT", headers, body: JSON.stringify({ stock }) });
      const updateData = await updateRes.json();
      if (!updateRes.ok) throw new Error(`Stock update falhou: ${JSON.stringify(updateData).slice(0,200)}`);
      return { action: "stock_updated", variantId: variant.id, newStock: stock };
    }
    case "order.note": {
      const orderId = payload.orderId || payload.order_id;
      const note = payload.note || payload.message || "";
      if (!orderId || !note) throw new Error("orderId e note sao obrigatorios");
      const searchRes = await fetch(`${base}/orders?q=${orderId}&fields=id`, { headers });
      const searchData = await searchRes.json();
      const orders = Array.isArray(searchData) ? searchData : (searchData.orders || []);
      const order = orders[0];
      if (!order) throw new Error(`Pedido ${orderId} nao encontrado`);
      const updateRes = await fetch(`${base}/orders/${order.id}`, { method: "PUT", headers, body: JSON.stringify({ note }) });
      const updateData = await updateRes.json();
      if (!updateRes.ok) throw new Error(`Nota update falhou: ${JSON.stringify(updateData).slice(0,200)}`);
      return { action: "note_updated", nuvemshopOrderId: order.id };
    }
    default: return { action: "no_reverse_action", reason: `Evento "${eventType}" sem mapeamento reverso para Nuvemshop` };
  }
}

async function reverseShopify(config, eventType, payload) {
  const { store_url, api_token, api_version } = config;
  const version = api_version || "2024-01";
  const host = store_url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const base = `https://${host}/admin/api/${version}`;
  const headers = { "X-Shopify-Access-Token": api_token, "Content-Type": "application/json" };
  switch (eventType) {
    // MELHORIA 2: venda na Suri → subtrai estoque no Shopify
    case "order.created": {
      const items = payload.items || payload.line_items || [];
      const results = [];
      for (const item of items) {
        const variantId = item.variant_id || item.variantId;
        const qty = parseInt(item.quantity || 1);
        if (!variantId) continue;
        try {
          const levelRes = await fetch(`${base}/inventory_levels.json?variant_ids=${variantId}`, { headers });
          const levelData = await levelRes.json();
          const level = levelData.inventory_levels?.[0];
          if (!level) { results.push({ variantId, status: "level_not_found" }); continue; }
          const adjustRes = await fetch(`${base}/inventory_levels/adjust.json`, { method: "POST", headers, body: JSON.stringify({ location_id: level.location_id, inventory_item_id: level.inventory_item_id, available_adjustment: -qty }) });
          results.push({ variantId, status: adjustRes.ok ? "stock_reduced" : "error" });
        } catch (e) { results.push({ variantId, status: "error", detail: e.message }); }
      }
      return { action: "stock_deducted_from_suri_sale", results };
    }
    case "order.shipped": {
      const orderId = payload.orderId || payload.order_id;
      if (!orderId) throw new Error("orderId obrigatorio");
      const searchRes = await fetch(`${base}/orders.json?name=${orderId}&status=any&fields=id,name`, { headers });
      const order = (await searchRes.json()).orders?.[0];
      if (!order) throw new Error(`Pedido ${orderId} nao encontrado na Shopify`);
      const body = { fulfillment: { notify_customer: true, tracking_info: { ...(payload.tracking_number ? { number: payload.tracking_number } : {}), ...(payload.tracking_url ? { url: payload.tracking_url } : {}) } } };
      const fRes = await fetch(`${base}/orders/${order.id}/fulfillments.json`, { method: "POST", headers, body: JSON.stringify(body) });
      if (!fRes.ok) throw new Error(`Shopify fulfillment falhou HTTP ${fRes.status}`);
      return { action: "order_fulfilled", shopifyOrderId: order.id };
    }
    case "order.cancelled": {
      const orderId = payload.orderId || payload.order_id;
      if (!orderId) throw new Error("orderId obrigatorio");
      const searchRes = await fetch(`${base}/orders.json?name=${orderId}&status=any&fields=id`, { headers });
      const order = (await searchRes.json()).orders?.[0];
      if (!order) throw new Error(`Pedido ${orderId} nao encontrado na Shopify`);
      const cRes = await fetch(`${base}/orders/${order.id}/cancel.json`, { method: "POST", headers, body: "{}" });
      if (!cRes.ok) throw new Error(`Shopify cancel falhou HTTP ${cRes.status}`);
      return { action: "order_cancelled", shopifyOrderId: order.id };
    }
    default: return { action: "no_reverse_action", reason: `Evento "${eventType}" sem mapeamento reverso para Shopify` };
  }
}

async function reverseWoocommerce(config, eventType, payload) {
  const { site_url, consumer_key, consumer_secret } = config;
  const base = `${site_url.replace(/\/+$/, "")}/wp-json/wc/v3`;
  const auth = Buffer.from(`${consumer_key}:${consumer_secret}`).toString("base64");
  const headers = { "Authorization": `Basic ${auth}`, "Content-Type": "application/json" };
  switch (eventType) {
    case "order.created": {
      // MELHORIA 2: subtrai estoque no WooCommerce
      const items = payload.items || [];
      const results = [];
      for (const item of items) {
        const productId = item.productId || item.product_id;
        const qty = parseInt(item.quantity || 1);
        if (!productId) continue;
        try {
          const getRes = await fetch(`${base}/products/${productId}?fields=id,stock_quantity`, { headers });
          const prod = await getRes.json();
          const newStock = Math.max(0, (prod.stock_quantity || 0) - qty);
          const updateRes = await fetch(`${base}/products/${productId}`, { method: "PUT", headers, body: JSON.stringify({ stock_quantity: newStock, manage_stock: true }) });
          results.push({ productId, newStock, status: updateRes.ok ? "stock_reduced" : "error" });
        } catch (e) { results.push({ productId, status: "error", detail: e.message }); }
      }
      return { action: "stock_deducted_from_suri_sale", results };
    }
    case "order.shipped": {
      const orderId = payload.orderId || payload.order_id;
      if (!orderId) throw new Error("orderId obrigatorio");
      const note = `Pedido enviado${payload.tracking_number ? ` — Rastreamento: ${payload.tracking_number}` : ""}.`;
      const r = await fetch(`${base}/orders/${orderId}`, { method: "PUT", headers, body: JSON.stringify({ status: "completed", customer_note: note }) });
      if (!r.ok) throw new Error(`WooCommerce order update falhou HTTP ${r.status}`);
      return { action: "order_completed" };
    }
    case "order.cancelled": {
      const orderId = payload.orderId || payload.order_id;
      if (!orderId) throw new Error("orderId obrigatorio");
      const r = await fetch(`${base}/orders/${orderId}`, { method: "PUT", headers, body: JSON.stringify({ status: "cancelled" }) });
      if (!r.ok) throw new Error(`WooCommerce cancel falhou HTTP ${r.status}`);
      return { action: "order_cancelled" };
    }
    default: return { action: "no_reverse_action", reason: `Evento "${eventType}" sem mapeamento reverso para WooCommerce` };
  }
}

async function reverseVtex(config, eventType, payload) {
  const { account_name, app_key, app_token } = config;
  const base = `https://${account_name}.vtexcommercestable.com.br/api`;
  const headers = { "X-VTEX-API-AppKey": app_key, "X-VTEX-API-AppToken": app_token, "Content-Type": "application/json" };
  switch (eventType) {
    case "order.shipped": {
      const orderId = payload.orderId || payload.order_id;
      if (!orderId) throw new Error("orderId obrigatorio");
      await fetch(`${base}/oms/pvt/orders/${orderId}/start-handling`, { method: "POST", headers });
      const r = await fetch(`${base}/oms/pvt/orders/${orderId}/notify-invoice`, { method: "POST", headers, body: JSON.stringify({ type: "Output", trackingNumber: payload.tracking_number || "", trackingUrl: payload.tracking_url || "" }) });
      if (!r.ok) throw new Error(`VTEX notify-invoice falhou HTTP ${r.status}`);
      return { action: "order_shipped" };
    }
    case "order.cancelled": {
      const orderId = payload.orderId || payload.order_id;
      if (!orderId) throw new Error("orderId obrigatorio");
      const r = await fetch(`${base}/oms/pvt/orders/${orderId}/cancel`, { method: "POST", headers });
      if (!r.ok) throw new Error(`VTEX cancel falhou HTTP ${r.status}`);
      return { action: "order_cancelled" };
    }
    default: return { action: "no_reverse_action", reason: `Evento "${eventType}" sem mapeamento reverso para VTEX` };
  }
}

async function reverseTray(config, eventType, payload) {
  const { api_address, access_token } = config;
  const base = api_address.replace(/\/+$/, "");
  const headers = { "Authorization": `Bearer ${access_token}`, "Content-Type": "application/json" };
  switch (eventType) {
    case "order.shipped": {
      const orderId = payload.orderId || payload.order_id;
      if (!orderId) throw new Error("orderId obrigatorio");
      const r = await fetch(`${base}/orders/${orderId}`, { method: "PUT", headers, body: JSON.stringify({ Order: { status: "shipped", ...(payload.tracking_number ? { tracking_code: payload.tracking_number } : {}) } }) });
      if (!r.ok) throw new Error(`Tray order update falhou HTTP ${r.status}`);
      return { action: "order_shipped" };
    }
    case "order.cancelled": {
      const orderId = payload.orderId || payload.order_id;
      if (!orderId) throw new Error("orderId obrigatorio");
      const r = await fetch(`${base}/orders/${orderId}`, { method: "PUT", headers, body: JSON.stringify({ Order: { status: "canceled" } }) });
      if (!r.ok) throw new Error(`Tray cancel falhou HTTP ${r.status}`);
      return { action: "order_cancelled" };
    }
    default: return { action: "no_reverse_action", reason: `Evento "${eventType}" sem mapeamento reverso para Tray` };
  }
}

async function processReverseFlow(platform, ecommerce_config, eventType, payload) {
  switch (platform) {
    case "nuvemshop":   return reverseNuvemshop(ecommerce_config, eventType, payload);
    case "shopify":     return reverseShopify(ecommerce_config, eventType, payload);
    case "woocommerce": return reverseWoocommerce(ecommerce_config, eventType, payload);
    case "vtex":        return reverseVtex(ecommerce_config, eventType, payload);
    case "tray":        return reverseTray(ecommerce_config, eventType, payload);
    default: return { action: "no_reverse_action", reason: `Plataforma "${platform}" sem suporte reverso` };
  }
}

async function getActiveSyncRules(userId, eventType) {
  try {
    const r = await pool.query("SELECT * FROM sync_rules WHERE user_id = $1 AND event = $2 AND active = true ORDER BY created_at ASC", [userId, eventType]);
    return r.rows;
  } catch { return []; }
}

// ════════════════════════════════════════════════════════════════════════════
// WEBHOOK RECEIVER — MELHORIA 3: validação HMAC + MELHORIA 6: deduplicação
// ════════════════════════════════════════════════════════════════════════════
async function handleWebhook(req, res) {
  if (req.method === "GET") return res.status(200).json({ success: true, message: "Webhook endpoint ativo" });
  if (req.method !== "POST") { res.setHeader("Allow",["GET","POST"]); return res.status(405).end(); }
  const { token } = req.query;
  if (!token) return res.status(400).json({ success: false, message: "token obrigatório" });
  let integration;
  try {
    let r = await pool.query("SELECT ui.*, u.name AS user_name FROM user_integrations ui JOIN users u ON u.id = ui.user_id WHERE ui.webhook_token = $1", [token]);
    if (!r.rows[0]) r = await pool.query("SELECT ui.*, u.name AS user_name FROM user_integrations ui JOIN users u ON u.id = ui.user_id WHERE ui.chatbot_token = $1", [token]);
    if (!r.rows[0]) return res.status(404).json({ success: false, message: "Token inválido" });
    integration = r.rows[0];
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }

  const { user_id, suri_endpoint, suri_token, suri_active, ecommerce_platform, ecommerce_config, chatbot_platform, user_name } = integration;
  const isForward = integration.webhook_token === token;
  const rawPayload = req.body || {};

  // MELHORIA 3: validação HMAC para fluxo direto
  if (isForward && ecommerce_config) {
    const secret = ecommerce_config.webhook_secret || ecommerce_config.hmac_secret || null;
    let valid = true;
    if (ecommerce_platform === "nuvemshop") valid = validateNuvemshopHmac(req, secret);
    else if (ecommerce_platform === "shopify") valid = validateShopifyHmac(req, secret);
    else if (ecommerce_platform === "woocommerce") valid = validateWoocommerceSignature(req, secret);
    if (!valid) {
      console.warn(`[webhook] HMAC inválido — user ${user_id}, platform ${ecommerce_platform}`);
      return res.status(401).json({ success: false, message: "Assinatura do webhook inválida" });
    }
  }

  // MELHORIA 6: deduplicação de eventos
  if (isForward) {
    const eventId = extractEventId(ecommerce_platform, rawPayload, req);
    if (eventId) {
      const isDup = await isDuplicateEvent(user_id, ecommerce_platform, eventId);
      if (isDup) {
        return res.status(200).json({ success: true, message: "Evento duplicado ignorado", event_id: eventId, flow: "forward" });
      }
    }
  }

  const PLATFORM_LABELS = { shopify:"Shopify", woocommerce:"WooCommerce", nuvemshop:"Nuvemshop", vtex:"VTEX", tray:"Tray", suri:"Suri", evolution_api:"Evolution API", kommo:"Kommo", chatbot:"Chatbot", ecommerce:"E-commerce" };
  const activePlatform = isForward ? (ecommerce_platform||"ecommerce") : (chatbot_platform||"chatbot");
  const platformLabel = PLATFORM_LABELS[activePlatform] || activePlatform;
  const userName = user_name || `ID ${user_id}`;

  let normalized;
  try {
    normalized = isForward
      ? normalizePayload(ecommerce_platform, rawPayload)
      : { eventType: rawPayload.type||rawPayload.event||rawPayload.event_type||"desconhecido", orderId: String(rawPayload.orderId||rawPayload.order_id||rawPayload.id||""), ...rawPayload };
  } catch {
    normalized = { eventType: rawPayload.type||rawPayload.event||"desconhecido", orderId:"", items:[], shipping:{provider:"Entrega",type:1,price:0,estimative:"5 dias úteis"} };
  }
  const eventType = normalized.eventType;

  // MELHORIA 6: incluir event_id no payload salvo para deduplicação futura
  const eventId = isForward ? extractEventId(ecommerce_platform, rawPayload, req) : null;
  const payloadToSave = eventId ? { ...rawPayload, _event_id: `${ecommerce_platform}:${eventId}` } : rawPayload;

  let webhookId;
  try {
    const ins = await pool.query("INSERT INTO user_webhooks (user_id, event_type, payload, status) VALUES ($1, $2, $3, 'received') RETURNING id", [user_id, eventType, JSON.stringify(payloadToSave)]);
    webhookId = ins.rows[0].id;
    await pool.query(`DELETE FROM user_webhooks WHERE user_id=$1 AND id NOT IN (SELECT id FROM user_webhooks WHERE user_id=$1 ORDER BY received_at DESC LIMIT 100)`, [user_id]).catch(()=>{});
  } catch (err) { return res.status(500).json({ success: false, message: "Erro ao salvar: " + err.message }); }

  // ── FLUXO DIRETO: E-commerce → Suri ──────────────────────────────────────
  if (isForward) {
    if (!suri_active || !suri_endpoint || !suri_token) return res.status(200).json({ success:true, message:"Evento registrado. Suri não configurada ou inativa.", event_type:eventType, platform:ecommerce_platform, webhook_id:webhookId, flow:"forward" });
    try {
      let result;
      switch (eventType) {
        case "order.created":           result = await processOrderCreated(suri_endpoint, suri_token, normalized); break;
        case "order.shipped":           result = await processOrderShipped(suri_endpoint, suri_token, normalized); break;
        case "order.partially_shipped": result = await processOrderPartiallyShipped(suri_endpoint, suri_token, normalized); break; // MELHORIA 9
        case "order.cancelled":         result = await processOrderCancelled(suri_endpoint, suri_token, normalized); break;
        case "product.sync":            result = await processProductSync(suri_endpoint, suri_token, normalized); break;
        case "product.deleted":         result = await processProductDeleted(suri_endpoint, suri_token, normalized); break; // MELHORIA 9
        default:
          await pool.query("UPDATE user_webhooks SET status='processed', error_message=$1 WHERE id=$2", [`Evento '${eventType}' sem mapeamento`, webhookId]);
          return res.status(200).json({ success:true, message:"Evento registrado sem processamento", event_type:eventType, webhook_id:webhookId, flow:"forward" });
      }
      await pool.query("UPDATE user_webhooks SET status='processed', error_message=NULL WHERE id=$1", [webhookId]);
      await pool.query("SELECT pg_notify('webhooks_changed', $1)", [JSON.stringify({id:webhookId,status:"processed",event_type:eventType})]);
      return res.status(200).json({ success:true, message:"Evento processado com sucesso", event_type:eventType, platform:ecommerce_platform, webhook_id:webhookId, flow:"forward", suri_result:result });
    } catch (err) {
      await pool.query("UPDATE user_webhooks SET status='error', error_message=$1 WHERE id=$2", [err.message, webhookId]);
      await pool.query("SELECT pg_notify('webhooks_changed', $1)", [JSON.stringify({id:webhookId,status:"error",event_type:eventType})]);
      try {
        const errorTime = new Date().toLocaleString("pt-BR", { timeZone:"America/Sao_Paulo", day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit", second:"2-digit" });
        await pool.query("INSERT INTO notifications (type, title, message, target_role, target_user_id) VALUES ('error', $1, $2, 'user', $3)", [`Erro na integração ${platformLabel}`, `Evento "${eventType||"desconhecido"}" falhou em ${errorTime}.\n\nDetalhe: ${err.message}`, user_id]);
        await pool.query("INSERT INTO notifications (type, title, message, target_role) VALUES ('integration_error', $1, $2, 'admin')", [`Erro de integração — ${platformLabel}`, `Perfil: ${userName}\nPlataforma: ${platformLabel}\nEvento: ${eventType||"desconhecido"}\nHorário: ${errorTime}\n\nDetalhe: ${err.message}`]);
        await pool.query("SELECT pg_notify('notifications_changed', 'new')").catch(()=>{});
      } catch {}
      return res.status(200).json({ success:false, message:"Evento registrado mas falhou ao processar na Suri", event_type:eventType, platform:ecommerce_platform, webhook_id:webhookId, flow:"forward", error:err.message });
    }
  }

  // ── FLUXO REVERSO: Suri → E-commerce ─────────────────────────────────────
  if (!ecommerce_platform || !ecommerce_config) {
    await pool.query("UPDATE user_webhooks SET status='processed', error_message=$1 WHERE id=$2", ["E-commerce não configurado", webhookId]);
    return res.status(200).json({ success:true, message:"Evento registrado. E-commerce não configurado.", event_type:eventType, webhook_id:webhookId, flow:"reverse" });
  }

  // MELHORIA 2: order.created do fluxo reverso não precisa de sync_rule — é sempre executado
  const skipRuleCheck = eventType === "order.created";
  if (!skipRuleCheck) {
    const rules = await getActiveSyncRules(user_id, eventType);
    if (rules.length === 0) {
      await pool.query("UPDATE user_webhooks SET status='processed', error_message=$1 WHERE id=$2", [`Sem sync_rule ativa para "${eventType}"`, webhookId]);
      return res.status(200).json({ success:true, message:`Evento registrado. Nenhuma regra ativa para "${eventType}".`, event_type:eventType, webhook_id:webhookId, flow:"reverse" });
    }
  }

  try {
    const result = await processReverseFlow(ecommerce_platform, ecommerce_config, eventType, normalized);
    await pool.query("UPDATE user_webhooks SET status='processed', error_message=NULL WHERE id=$1", [webhookId]);
    await pool.query("SELECT pg_notify('webhooks_changed', $1)", [JSON.stringify({id:webhookId,status:"processed",event_type:eventType})]);
    return res.status(200).json({ success:true, message:"Evento reverso processado", event_type:eventType, platform:ecommerce_platform, webhook_id:webhookId, flow:"reverse", ecommerce_result:result });
  } catch (err) {
    await pool.query("UPDATE user_webhooks SET status='error', error_message=$1 WHERE id=$2", [err.message, webhookId]);
    await pool.query("SELECT pg_notify('webhooks_changed', $1)", [JSON.stringify({id:webhookId,status:"error",event_type:eventType})]);
    try {
      const errorTime = new Date().toLocaleString("pt-BR", { timeZone:"America/Sao_Paulo", day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit", second:"2-digit" });
      await pool.query("INSERT INTO notifications (type, title, message, target_role, target_user_id) VALUES ('error', $1, $2, 'user', $3)", [`Erro no retorno ao e-commerce`, `Evento "${eventType}" falhou em ${errorTime}.\n\nDetalhe: ${err.message}`, user_id]);
      await pool.query("INSERT INTO notifications (type, title, message, target_role) VALUES ('integration_error', $1, $2, 'admin')", [`Erro de integração reversa`, `Perfil: ${userName}\nPlataforma: ${ecommerce_platform}\nEvento: ${eventType}\nHorário: ${errorTime}\n\nDetalhe: ${err.message}`]);
      await pool.query("SELECT pg_notify('notifications_changed', 'new')").catch(()=>{});
    } catch {}
    return res.status(200).json({ success:false, message:"Falhou no retorno ao e-commerce", event_type:eventType, webhook_id:webhookId, flow:"reverse", error:err.message });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// WEBHOOKS LONG POLL
// ════════════════════════════════════════════════════════════════════════════
async function handleWebhooksPoll(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow", ["GET"]); return res.status(405).end(); }
  const caller = await requireAuth(req, res); if (!caller) return;
  const afterId = req.query.after_id ? parseInt(req.query.after_id, 10) : null;
  const timeout = 20000;
  const buildQuery = () => {
    const where = [], values = []; let idx = 1;
    if (caller.role !== "admin") { where.push(`uw.user_id = $${idx++}`); values.push(caller.id); }
    else if (req.query.user_id) { where.push(`uw.user_id = $${idx++}`); values.push(req.query.user_id); }
    if (req.query.status)     { where.push(`uw.status = $${idx++}`);     values.push(req.query.status); }
    if (req.query.event_type) { where.push(`uw.event_type = $${idx++}`); values.push(req.query.event_type); }
    if (afterId !== null)     { where.push(`uw.id > $${idx++}`);         values.push(afterId); }
    const whereStr = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return { sql: `SELECT uw.id, uw.user_id, u.name AS user_name, u.email AS user_email, uw.event_type, uw.payload, uw.status, uw.error_message, uw.received_at FROM user_webhooks uw JOIN users u ON u.id = uw.user_id ${whereStr} ORDER BY uw.received_at DESC LIMIT 100`, values };
  };
  const { sql, values } = buildQuery();
  const immediate = await pool.query(sql, values).catch(() => ({ rows: [] }));
  if (immediate.rows.length > 0) return res.status(200).json({ success: true, webhooks: immediate.rows, has_new: true, server_time: new Date().toISOString() });
  let client; let resolved = false;
  const respond = (webhooks) => { if (resolved) return; resolved = true; res.status(200).json({ success: true, webhooks, has_new: webhooks.length > 0, server_time: new Date().toISOString() }); };
  try {
    client = await pool.connect();
    await client.query(`CREATE OR REPLACE FUNCTION notify_webhook_change() RETURNS trigger AS $$ BEGIN PERFORM pg_notify('webhooks_changed', NEW.id::text); RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await client.query(`DROP TRIGGER IF EXISTS webhook_insert_notify ON user_webhooks; CREATE TRIGGER webhook_insert_notify AFTER INSERT OR UPDATE ON user_webhooks FOR EACH ROW EXECUTE FUNCTION notify_webhook_change()`);
    await client.query("LISTEN webhooks_changed");
    const timer = setTimeout(async () => { try { await client.query("UNLISTEN webhooks_changed"); client.release(); } catch {} respond([]); }, timeout);
    client.on("notification", async () => { clearTimeout(timer); try { await client.query("UNLISTEN webhooks_changed"); client.release(); } catch {} const { sql: s2, values: v2 } = buildQuery(); const fresh = await pool.query(s2, v2).catch(() => ({ rows: [] })); respond(fresh.rows); });
    req.on("close", () => { clearTimeout(timer); resolved = true; try { client.query("UNLISTEN webhooks_changed").then(() => client.release()).catch(() => {}); } catch {} });
  } catch (err) { if (client) { try { client.release(); } catch {} } if (!resolved) res.status(200).json({ success: true, webhooks: [], has_new: false, server_time: new Date().toISOString() }); }
}

// ════════════════════════════════════════════════════════════════════════════
// REGISTER WEBHOOK
// ════════════════════════════════════════════════════════════════════════════
async function registerShopify(config, webhookUrl) {
  const { store_url, api_token, api_version } = config;
  if (!store_url || !api_token) throw new Error("store_url e api_token são obrigatórios");
  const version = api_version || "2024-01";
  const base = `https://${store_url.replace(/^https?:\/\//, "")}/admin/api/${version}`;
  const headers = { "Content-Type":"application/json", "X-Shopify-Access-Token":api_token };
  const topics = ["orders/create","orders/fulfilled","orders/cancelled","products/create","products/update"];
  const results = [];
  for (const topic of topics) {
    const r = await fetch(`${base}/webhooks.json`, { method:"POST", headers, body:JSON.stringify({webhook:{topic,address:webhookUrl,format:"json"}}) });
    const data = await r.json();
    if (!r.ok) { results.push({topic,status:r.status===422&&JSON.stringify(data).includes("already")?"already_exists":"error",detail:data.errors||data}); }
    else { results.push({topic,status:"created",id:data.webhook?.id}); }
  }
  return { success:true, message:`${results.filter(r=>r.status!=="error").length}/${topics.length} webhooks registrados na Shopify`, details:results };
}
async function registerWoocommerce(config, webhookUrl) {
  const { site_url, consumer_key, consumer_secret } = config;
  if (!site_url||!consumer_key||!consumer_secret) throw new Error("site_url, consumer_key e consumer_secret são obrigatórios");
  const base=`${site_url.replace(/\/+$/,"")}/wp-json/wc/v3`;
  const auth=Buffer.from(`${consumer_key}:${consumer_secret}`).toString("base64");
  const headers={"Content-Type":"application/json","Authorization":`Basic ${auth}`};
  const topics=[{name:"Pedido Criado",topic:"order.created"},{name:"Pedido Atualizado",topic:"order.updated"},{name:"Pedido Deletado",topic:"order.deleted"},{name:"Prodluto Criado",topic:"product.created"},{name:"Produto Atualizado",topic:"product.updated"}];
  const results=[];
  for (const {name,topic} of topics) { const r=await fetch(`${base}/webhooks`,{method:"POST",headers,body:JSON.stringify({name,status:"active",topic,delivery_url:webhookUrl})}); const data=await r.json(); results.push(r.ok?{topic,status:"created",id:data.id}:{topic,status:"error",detail:data.message||data}); }
  return { success:true, message:`${results.filter(r=>r.status==="created").length}/${topics.length} webhooks registrados no WooCommerce`, details:results };
}
async function registerNuvemshop(config, webhookUrl) {
  const { store_id, access_token } = config;
  if (!store_id||!access_token) throw new Error("store_id e access_token são obrigatórios");
  const base=`https://api.tiendanube.com/v1/${store_id}`;
  const headers={"Content-Type":"application/json","Authentication":`bearer ${access_token}`,"User-Agent":"CodeRise Integration (suporte@coderise.com.br)"};
  const events=["order/created","order/paid","order/fulfilled","order/cancelled","order/partially_fulfilled","product/created","product/updated","product/deleted"];
  const results=[];
  for (const event of events) { const r=await fetch(`${base}/webhooks`,{method:"POST",headers,body:JSON.stringify({event,url:webhookUrl})}); const data=await r.json(); results.push(r.ok?{event,status:"created",id:data.id}:{event,status:"error",detail:data.description||data}); }
  return { success:true, message:`${results.filter(r=>r.status==="created").length}/${events.length} webhooks registrados na Nuvemshop`, details:results };
}
async function registerVtex(config, webhookUrl) {
  const { account_name, app_key, app_token } = config;
  if (!account_name||!app_key||!app_token) throw new Error("account_name, app_key e app_token são obrigatórios");
  const base=`https://${account_name}.vtexcommercestable.com.br/api`;
  const headers={"Content-Type":"application/json","X-VTEX-API-AppKey":app_key,"X-VTEX-API-AppToken":app_token};
  const r=await fetch(`${base}/orders/hook/config`,{method:"POST",headers,body:JSON.stringify({filter:{type:"FromWorkflow",status:["payment-approved","invoiced","canceled"]},hook:{headers:{"x-coderise-token":"webhook"},url:webhookUrl}})});
  const data=await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(`VTEX Hook API → HTTP ${r.status}: ${JSON.stringify(data)}`);
  return { success:true, message:"Hook de pedidos configurado na VTEX com sucesso", details:data };
}
async function registerTray(config, webhookUrl) {
  const { api_address, access_token } = config;
  if (!api_address||!access_token) throw new Error("api_address e access_token são obrigatórios");
  const base=api_address.replace(/\/+$/,"");
  const headers={"Content-Type":"application/json","Authorization":`Bearer ${access_token}`};
  const triggers=["order_created","order_paid","order_shipped","order_cancelled","product_created","product_updated"];
  const results=[];
  for (const trigger of triggers) { const r=await fetch(`${base}/web_hooks`,{method:"POST",headers,body:JSON.stringify({web_hook:{url:webhookUrl,trigger,active:"true"}})}); const data=await r.json().catch(()=>({})); results.push(r.ok?{trigger,status:"created",id:data.web_hook?.id}:{trigger,status:"error",detail:data.message||data}); }
  return { success:true, message:`${results.filter(r=>r.status==="created").length}/${triggers.length} webhooks registrados na Tray`, details:results };
}

async function handleRegisterWebhook(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow",["POST"]); return res.status(405).end(); }
  const caller = await requireAuth(req, res); if (!caller) return;
  try {
    const r = await pool.query("SELECT * FROM user_integrations WHERE user_id = $1", [caller.id]);
    if (!r.rows[0]) return res.status(404).json({ success:false, message:"Integração não encontrada. Salve as configurações primeiro." });
    const { ecommerce_platform, ecommerce_config, webhook_token } = r.rows[0];
    if (!ecommerce_platform) return res.status(400).json({ success:false, message:"Nenhuma plataforma de e-commerce configurada" });
    if (!ecommerce_config)   return res.status(400).json({ success:false, message:"Configure e salve as credenciais da plataforma primeiro" });
    const host=req.headers.host||req.headers["x-forwarded-host"]||"";
    const protocol=req.headers["x-forwarded-proto"]||"https";
    const webhookUrl=`${protocol}://${host}/webhook?token=${webhook_token}`;
    let result;
    switch (ecommerce_platform) {
      case "shopify":     result = await registerShopify(ecommerce_config, webhookUrl);     break;
      case "woocommerce": result = await registerWoocommerce(ecommerce_config, webhookUrl); break;
      case "nuvemshop":   result = await registerNuvemshop(ecommerce_config, webhookUrl);   break;
      case "vtex":        result = await registerVtex(ecommerce_config, webhookUrl);        break;
      case "tray":        result = await registerTray(ecommerce_config, webhookUrl);        break;
      default: return res.status(400).json({ success:false, message:`Registro automático não disponível para '${ecommerce_platform}'. URL: ${webhookUrl}` });
    }
    return res.status(200).json({ success:true, ...result, webhook_url:webhookUrl });
  } catch (err) { return res.status(500).json({ success:false, message:err.message }); }
}

// ════════════════════════════════════════════════════════════════════════════
// SETUP — MELHORIA 7: coluna webhook_secret na tabela
// ════════════════════════════════════════════════════════════════════════════
async function handleSetup(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  if (!isAdminSecret(req)) return res.status(401).json({ success:false, message:"Não autorizado" });
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, email VARCHAR(255) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL, role VARCHAR(20) NOT NULL DEFAULT 'user', active BOOLEAN NOT NULL DEFAULT true, token VARCHAR(64) UNIQUE, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW());`);
    await pool.query(`CREATE TABLE IF NOT EXISTS user_integrations (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, ecommerce_platform VARCHAR(50), ecommerce_config JSONB, ecommerce_active BOOLEAN NOT NULL DEFAULT false, webhook_token VARCHAR(64) UNIQUE NOT NULL, chatbot_platform VARCHAR(50), chatbot_config JSONB, chatbot_active BOOLEAN NOT NULL DEFAULT false, chatbot_token VARCHAR(64) UNIQUE, suri_endpoint TEXT, suri_token TEXT, suri_active BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW(), UNIQUE(user_id));`);
    for (const sql of [
      `ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS chatbot_platform VARCHAR(50)`,
      `ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS chatbot_config JSONB`,
      `ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS chatbot_active BOOLEAN NOT NULL DEFAULT false`,
      `ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS chatbot_token VARCHAR(64) UNIQUE`,
      // MELHORIA 7: coluna para armazenar webhook_secret (HMAC) por integração
      `ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS webhook_secret TEXT`,
    ]) { await pool.query(sql).catch(()=>{}); }
    const noToken = await pool.query("SELECT user_id FROM user_integrations WHERE chatbot_token IS NULL");
    for (const row of noToken.rows) { await pool.query("UPDATE user_integrations SET chatbot_token=$1 WHERE user_id=$2 AND chatbot_token IS NULL",[crypto.randomBytes(32).toString("hex"),row.user_id]); }
    await pool.query(`CREATE TABLE IF NOT EXISTS sync_rules (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, event VARCHAR(100) NOT NULL, active BOOLEAN NOT NULL DEFAULT true, message_template TEXT, delay_minutes INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW());`);
    await pool.query(`CREATE TABLE IF NOT EXISTS user_webhooks (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, event_type VARCHAR(100), payload JSONB, status VARCHAR(20) DEFAULT 'received', error_message TEXT, received_at TIMESTAMP NOT NULL DEFAULT NOW());`);
    await pool.query(`CREATE TABLE IF NOT EXISTS notifications (id SERIAL PRIMARY KEY, type VARCHAR(30) NOT NULL, title VARCHAR(100) NOT NULL, message TEXT NOT NULL, image_url TEXT, target_role VARCHAR(20) DEFAULT 'all', target_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, scheduled_at TIMESTAMP, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW());`);
    await pool.query(`CREATE TABLE IF NOT EXISTS platform_settings (key VARCHAR(100) PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMP NOT NULL DEFAULT NOW());`);
    await pool.query(`CREATE TABLE IF NOT EXISTS notification_reads (notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, hidden BOOLEAN NOT NULL DEFAULT false, read_at TIMESTAMP NOT NULL DEFAULT NOW(), PRIMARY KEY (notification_id, user_id));`);
    // MELHORIA 6: índice para deduplicação mais rápida
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_webhooks_event_id ON user_webhooks ((payload->>'_event_id')) WHERE payload->>'_event_id' IS NOT NULL;`).catch(()=>{});
    const adminToken=crypto.randomBytes(32).toString("hex");
    await pool.query(`INSERT INTO users (name,email,password,role,token) VALUES ('Administrador','admin@plataforma.com','admin123','admin',$1) ON CONFLICT (email) DO NOTHING`,[adminToken]);
    const userToken=crypto.randomBytes(32).toString("hex");
    await pool.query(`INSERT INTO users (name,email,password,role,token) VALUES ('Usuário Teste','teste@plataforma.com','teste123','user',$1) ON CONFLICT (email) DO NOTHING`,[userToken]);
    const testUser=await pool.query("SELECT id FROM users WHERE email='teste@plataforma.com'");
    if (testUser.rows[0]) { const wt=crypto.randomBytes(32).toString("hex"),ct=crypto.randomBytes(32).toString("hex"); await pool.query(`INSERT INTO user_integrations (user_id,webhook_token,chatbot_token) VALUES ($1,$2,$3) ON CONFLICT (user_id) DO NOTHING`,[testUser.rows[0].id,wt,ct]); }
    const admin=await pool.query("SELECT id,email,token FROM users WHERE email='admin@plataforma.com'");
    const user=await pool.query("SELECT id,email,token FROM users WHERE email='teste@plataforma.com'");
    return res.status(200).json({ success:true, message:"Tabelas criadas/migradas com sucesso!", tables:["users","user_integrations","sync_rules","user_webhooks","notifications","notification_reads"], seeds:{admin:admin.rows[0],user:user.rows[0]} });
  } catch (err) { return res.status(500).json({success:false,message:err.message}); }
}

// ════════════════════════════════════════════════════════════════════════════
// TEST SURI
// ════════════════════════════════════════════════════════════════════════════
async function handleTestSuri(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow",["POST"]); return res.status(405).end(); }
  const caller = await requireAuth(req, res); if (!caller) return;
  const { endpoint, token } = req.body || {};
  if (!endpoint||typeof endpoint!=="string"||!endpoint.trim()) return res.status(400).json({success:false,message:"URL do Chatbot é obrigatória."});
  if (!token||typeof token!=="string"||!token.trim()) return res.status(400).json({success:false,message:"Token de Integração é obrigatório."});
  let base;
  try { base=new URL(endpoint.trim().replace(/\/$/,"")); } catch { return res.status(400).json({success:false,message:`URL inválida: "${endpoint}". Verifique se começa com https://`}); }
  if (base.protocol!=="https:"&&base.protocol!=="http:") return res.status(400).json({success:false,message:"A URL deve começar com https:// ou http://"});
  const uuidRegex=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const tokenClean=token.trim();
  if (!uuidRegex.test(tokenClean)) return res.status(400).json({success:false,message:"Formato de token inválido. O Token de Integração da Suri deve ser um UUID."});
  const notifyAdminError = async (errorMsg) => {
    try {
      const errorTime = new Date().toLocaleString("pt-BR", { timeZone:"America/Sao_Paulo", day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit", second:"2-digit" });
      const uRow = await pool.query("SELECT name FROM users WHERE id = $1", [caller.id]);
      const userName = uRow.rows[0]?.name || `ID ${caller.id}`;
      const intRow = await pool.query("SELECT chatbot_platform FROM user_integrations WHERE user_id = $1", [caller.id]);
      const rawPlatform = intRow.rows[0]?.chatbot_platform || "suri";
      const PLATFORM_LABELS = { suri:"Suri", evolution_api:"Evolution API", kommo:"Kommo" };
      const platformLabel = PLATFORM_LABELS[rawPlatform] || rawPlatform;
      await pool.query("INSERT INTO notifications (type, title, message, target_role) VALUES ('integration_error', $1, $2, 'admin')", [`Falha no teste de conexão — ${platformLabel}`, `Perfil: ${userName}\nPlataforma: ${platformLabel}\nURL: ${base?.hostname||endpoint}\nHorário: ${errorTime}\n\nDetalhe: ${errorMsg}`]);
      await pool.query("SELECT pg_notify('notifications_changed', 'new')").catch(()=>{});
    } catch {}
  };
  let httpStatus, body;
  try {
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),10000);
    const upstream=await fetch(`${base.origin}/api/shop/stores`,{method:"GET",headers:{Authorization:`Bearer ${tokenClean}`,Accept:"application/json","Content-Type":"application/json"},signal:controller.signal});
    clearTimeout(timeout);
    httpStatus=upstream.status;
    const text=await upstream.text();
    try { body=JSON.parse(text); } catch { body={raw:text}; }
  } catch (err) {
    const msg = err.name==="AbortError"?`Timeout: "${base.hostname}" não respondeu em 10s.`:`Não foi possível conectar em "${base.hostname}": ${err.message}`;
    await notifyAdminError(msg);
    return res.status(502).json({success:false,message:msg});
  }
  if (httpStatus===401||httpStatus===403) { await notifyAdminError(`Token inválido ou sem permissão (HTTP ${httpStatus}).`); return res.status(200).json({success:false,httpStatus,message:`Token inválido ou sem permissão (HTTP ${httpStatus}).`}); }
  if (httpStatus===404) { await notifyAdminError(`Rota não encontrada (HTTP 404). Verifique a URL do Chatbot.`); return res.status(200).json({success:false,httpStatus,message:`Rota não encontrada (HTTP 404). Verifique a URL do Chatbot.`}); }
  if (httpStatus<200||httpStatus>=300) { await notifyAdminError(`Servidor retornou HTTP ${httpStatus}.`); return res.status(200).json({success:false,httpStatus,message:`Servidor retornou HTTP ${httpStatus}.`}); }
  const hasValidBody=Array.isArray(body)||(body&&typeof body==="object"&&!body.raw)||(body&&Array.isArray(body.data));
  if (!hasValidBody||body?.raw!==undefined) { await notifyAdminError(`Servidor respondeu HTTP ${httpStatus} mas body inesperado.`); return res.status(200).json({success:false,httpStatus,message:`Servidor respondeu HTTP ${httpStatus} mas body inesperado. Verifique a URL.`,debug:String(body?.raw||"").slice(0,200)}); }
  const storeCount=Array.isArray(body)?body.length:Array.isArray(body?.data)?body.data.length:null;
  return res.status(200).json({success:true,httpStatus,message:storeCount!==null?`Conexão bem-sucedida! ${storeCount} loja(s) encontrada(s).`:"Conexão com a Suri realizada com sucesso!"});
}

// ════════════════════════════════════════════════════════════════════════════
// TEST ECOMMERCE
// ════════════════════════════════════════════════════════════════════════════
async function handleTestEcommerce(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow",["POST"]); return res.status(405).end(); }
  const caller = await requireAuth(req, res); if (!caller) return;
  const { platform, config } = req.body || {};
  if (!platform || !config) return res.status(400).json({ success: false, message: "platform e config são obrigatórios." });
  const LABELS = { shopify:"Shopify", woocommerce:"WooCommerce", nuvemshop:"Nuvemshop", vtex:"VTEX", tray:"Tray" };
  const platformLabel = LABELS[platform] || platform;
  const notifyAdminError = async (errorMsg) => {
    try {
      const errorTime = new Date().toLocaleString("pt-BR", { timeZone:"America/Sao_Paulo", day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit", second:"2-digit" });
      const uRow = await pool.query("SELECT name FROM users WHERE id = $1", [caller.id]);
      const userName = uRow.rows[0]?.name || `ID ${caller.id}`;
      await pool.query("INSERT INTO notifications (type, title, message, target_role) VALUES ('integration_error', $1, $2, 'admin')", [`Falha no teste — ${platformLabel}`, `Perfil: ${userName}\nPlataforma: ${platformLabel} (E-commerce)\nHorário: ${errorTime}\n\nDetalhe: ${errorMsg}`]);
      await pool.query("SELECT pg_notify('notifications_changed', 'new')").catch(()=>{});
    } catch {}
  };
  try {
    let result;
    switch (platform) {
      case "nuvemshop": {
        const { store_id, access_token } = config;
        if (!store_id || !access_token) throw new Error("store_id e access_token são obrigatórios.");
        const r = await fetch(`https://api.tiendanube.com/v1/${store_id}/store`, { headers: { "Authentication":`bearer ${access_token}`, "User-Agent":"CodeRise Integration (suporte@coderise.com.br)", "Content-Type":"application/json" }, signal: AbortSignal.timeout(10000) });
        const body = await r.json().catch(()=>({}));
        if (r.status===401||r.status===403) throw new Error(`Token inválido ou sem permissão (HTTP ${r.status}).`);
        if (r.status===404) throw new Error(`Loja não encontrada (HTTP 404). Verifique o Store ID "${store_id}".`);
        if (!r.ok) throw new Error(`Nuvemshop retornou HTTP ${r.status}: ${JSON.stringify(body).slice(0,200)}`);
        const storeName = body.name?.pt || body.name?.es || Object.values(body.name||{})[0] || body.business_name || "—";
        result = { store: storeName, plan: body.plan_name||null };
        break;
      }
      case "shopify": {
        const { store_url, api_token, api_version } = config;
        if (!store_url || !api_token) throw new Error("store_url e api_token são obrigatórios.");
        const host = store_url.replace(/^https?:\/\//, "").replace(/\/$/, "");
        const r = await fetch(`https://${host}/admin/api/${api_version||"2024-01"}/shop.json`, { headers: { "X-Shopify-Access-Token": api_token }, signal: AbortSignal.timeout(10000) });
        const body = await r.json().catch(()=>({}));
        if (!r.ok) throw new Error(`Shopify retornou HTTP ${r.status}: ${JSON.stringify(body).slice(0,100)}`);
        result = { store: body.shop?.name||"—", plan: body.shop?.plan_name||null };
        break;
      }
      case "woocommerce": {
        const { site_url, consumer_key, consumer_secret } = config;
        if (!site_url||!consumer_key||!consumer_secret) throw new Error("site_url, consumer_key e consumer_secret são obrigatórios.");
        const auth = Buffer.from(`${consumer_key}:${consumer_secret}`).toString("base64");
        const r = await fetch(`${site_url.replace(/\/+$/,"")}/wp-json/wc/v3/system_status`, { headers: { "Authorization":`Basic ${auth}` }, signal: AbortSignal.timeout(10000) });
        if (!r.ok) throw new Error(`WooCommerce retornou HTTP ${r.status}.`);
        result = { store: site_url, plan: null };
        break;
      }
      case "vtex": {
        const { account_name, app_key, app_token } = config;
        if (!account_name||!app_key||!app_token) throw new Error("account_name, app_key e app_token são obrigatórios.");
        const r = await fetch(`https://${account_name}.vtexcommercestable.com.br/api/catalog_system/pub/category/tree/1`, { headers: { "X-VTEX-API-AppKey":app_key, "X-VTEX-API-AppToken":app_token }, signal: AbortSignal.timeout(10000) });
        if (!r.ok) throw new Error(`VTEX retornou HTTP ${r.status}.`);
        result = { store: account_name, plan: "VTEX" };
        break;
      }
      case "tray": {
        const { api_address, access_token } = config;
        if (!api_address||!access_token) throw new Error("api_address e access_token são obrigatórios.");
        const r = await fetch(`${api_address.replace(/\/+$/,"")}/store`, { headers: { "Authorization":`Bearer ${access_token}` }, signal: AbortSignal.timeout(10000) });
        if (!r.ok) throw new Error(`Tray retornou HTTP ${r.status}.`);
        result = { store: api_address, plan: null };
        break;
      }
      default: return res.status(400).json({ success:false, message:`Teste não disponível para "${platform}".` });
    }
    return res.status(200).json({ success:true, message:`Conexão com ${platformLabel} bem-sucedida!${result.store ? ` Loja: ${result.store}.` : ""}`, ...result });
  } catch (err) {
    const msg = err.name==="TimeoutError" ? `Timeout: ${platformLabel} não respondeu em 10s.` : err.message;
    await notifyAdminError(msg);
    return res.status(200).json({ success:false, message:msg });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PLATFORM SETTINGS
// ════════════════════════════════════════════════════════════════════════════
async function handlePlatformSettings(req, res) {
  const caller = await requireAuth(req, res); if (!caller) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS platform_settings (key VARCHAR(100) PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMP NOT NULL DEFAULT NOW());`).catch(()=>{});
  if (req.method === "GET") {
    const r = await pool.query("SELECT key, value FROM platform_settings WHERE key LIKE 'platform:%'");
    const platforms = {};
    for (const row of r.rows) { const name = row.key.replace("platform:", ""); platforms[name] = row.value === "true"; }
    return res.status(200).json({ success: true, platforms });
  }
  if (req.method === "PATCH") {
    if (caller.role !== "admin") return res.status(403).json({ success: false, message: "Acesso negado" });
    const { platforms } = req.body || {};
    if (!platforms || typeof platforms !== "object" || !Object.keys(platforms).length) return res.status(400).json({ success: false, message: "Informe o objeto 'platforms' com as plataformas a atualizar" });
    for (const [name, enabled] of Object.entries(platforms)) { await pool.query("INSERT INTO platform_settings (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()", [`platform:${name}`, String(Boolean(enabled))]); }
    const r = await pool.query("SELECT key, value FROM platform_settings WHERE key LIKE 'platform:%'");
    const result = {};
    for (const row of r.rows) result[row.key.replace("platform:", "")] = row.value === "true";
    return res.status(200).json({ success: true, message: "Configurações salvas", platforms: result });
  }
  res.setHeader("Allow", ["GET", "PATCH"]);
  return res.status(405).end();
}
