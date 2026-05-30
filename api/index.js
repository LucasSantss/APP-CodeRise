/**
 * api/index.js — Router unificado (1 Serverless Function)
 * Roteia por req.url para manter todas as rotas originais intactas.
 */
import pool   from "./db.js";
import { setCors }                       from "./_cors.js";
import { getUserByToken, requireAuth, requireAdmin, isAdminSecret } from "./_auth.js";
import crypto from "crypto";

// ─── helpers internos ────────────────────────────────────────────────────────
function getPath(req) {
  return (req.url || "").split("?")[0].replace(/^\/api/, "");
}

// ─── migração lazy: garante coluna source sem precisar chamar /setup ─────────
pool.query(`ALTER TABLE user_webhooks ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'ecommerce'`).catch(() => {});

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
  if (path === "/test-suri" || path.startsWith("/test-suri?")) return handleTestSuri(req, res);
  if (path === "/test-ecommerce" || path.startsWith("/test-ecommerce?")) return handleTestEcommerce(req, res);
  if (path === "/sync-catalog" || path.startsWith("/sync-catalog?")) return handleSyncCatalog(req, res);
  if (path === "/platform-settings" || path.startsWith("/platform-settings?")) return handlePlatformSettings(req, res);

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
      if (!user || user.password !== password) return res.status(401).json({ success: false, message: "Credenciais inválidas" });
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
        let r;
        try {
          r = await pool.query("SELECT chatbot_platform, chatbot_config, chatbot_active, chatbot_token, suri_endpoint, suri_token, suri_active, created_at, updated_at FROM user_integrations WHERE user_id = $1", [targetId]);
        } catch {
          r = await pool.query("SELECT chatbot_platform, chatbot_config, chatbot_active, chatbot_token, created_at, updated_at FROM user_integrations WHERE user_id = $1", [targetId]);
        }
        if (!r.rows[0]) return res.status(404).json({ success: false, message: "Integração não encontrada" });
        const row = r.rows[0]; const ccfg = row.chatbot_config || {};
        if (!row.suri_endpoint && ccfg.endpoint) row.suri_endpoint = ccfg.endpoint;
        if (!row.suri_token    && ccfg.token)    row.suri_token    = ccfg.token;
        return res.status(200).json({ success: true, chatbot: row });
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
        const { id, event_type, status, limit, since, after_id, source } = req.query;
        const where = [], values = []; let idx = 1;
        if (caller.role !== "admin") { where.push(`uw.user_id = $${idx++}`); values.push(caller.id); }
        else if (req.query.user_id) { where.push(`uw.user_id = $${idx++}`); values.push(req.query.user_id); }
        if (id)         { where.push(`uw.id = $${idx++}`);         values.push(id); }
        if (event_type) { where.push(`uw.event_type = $${idx++}`); values.push(event_type); }
        if (status)     { where.push(`uw.status = $${idx++}`);     values.push(status); }
        if (source)     { where.push(`uw.source = $${idx++}`);     values.push(source); }
        if (since)      { where.push(`uw.received_at > $${idx++}`); values.push(since); }
        if (after_id)   { where.push(`uw.id > $${idx++}`);         values.push(after_id); }
        const whereStr = where.length ? `WHERE ${where.join(" AND ")}` : "";
        let maxRows = 500;
        if (limit) { const p = parseInt(limit, 10); if (!isNaN(p) && p > 0) maxRows = Math.min(p, 500); }
        const r = await pool.query(`SELECT uw.id, uw.user_id, u.name AS user_name, u.email AS user_email, uw.event_type, uw.payload, uw.status, uw.error_message, uw.source, uw.received_at FROM user_webhooks uw JOIN users u ON u.id = uw.user_id ${whereStr} ORDER BY uw.received_at DESC LIMIT $${idx}`, [...values, maxRows]);
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
// WEBHOOK RECEIVER (e-commerce → Suri)
// ════════════════════════════════════════════════════════════════════════════
function normalizeVtex(payload) {
  const order = payload.order || payload;
  const rawEvent = payload.type || payload.event || order.status || "";
  const statusMap = { "payment-approved":"order.created","order-created":"order.created","OrderCreated":"order.created","invoiced":"order.shipped","shipped":"order.shipped","order-completed":"order.shipped","canceled":"order.cancelled","order-cancelled":"order.cancelled","product-created":"product.sync","product-updated":"product.sync" };
  const eventType = statusMap[rawEvent] || rawEvent;
  if (eventType === "product.sync") { const p = payload.product || payload; return { eventType, product: { id:String(p.Id||p.ProductId||p.id), sku:String(p.RefId||p.sku||"1"), name:p.ProductName||p.name, description:(p.Description||p.description||"").replace(/<[^>]+>/g,""), categoryId:String(p.CategoryId||p.categoryId||""), brand:p.BrandName||p.brand||null, isActive:p.IsActive??p.isActive??true, price:p.Price||p.price||0, promotionalPrice:p.ListPrice||p.promotionalPrice||0, url:p.DetailUrl||p.url||null, images:(p.Images||p.images||[]).map(i=>({url:i.ImageUrl||i.url,description:i.ImageLabel||null})), weightInGrams:p.WeightKg?p.WeightKg*1000:0, dimensions:{heightInCm:p.Height||0,widthInCm:p.Width||0,lengthInCm:p.Length||0} } }; }
  const logInfo = order.shippingData?.logisticsInfo?.[0] || {};
  return { eventType, orderId:String(order.orderId||order.order_id||""), paymentTracking:order.paymentData?.transactions?.[0]?.transactionId||"", logisticStatus:order.status||"shipped", totalAmount:(order.value||0)/100, items:(order.items||[]).map(i=>({productId:String(i.productId||i.id),sku:String(i.id||i.sku),name:i.name,quantity:i.quantity,unitPrice:(i.sellingPrice||i.price||0)/100,discount:(i.manualDiscount||0)/100,sellerId:i.sellerId||"all"})), shipping:{provider:logInfo.deliveryCompany||"Entrega",type:1,price:(order.totals?.find(t=>t.id==="Shipping")?.value||0)/100,estimative:logInfo.shippingEstimateDate||"5 dias úteis"} };
}
function normalizeShopify(payload) {
  const topic = payload.topic||payload.x_shopify_topic||"";
  const statusMap = { "orders/create":"order.created","orders/paid":"order.created","orders/fulfilled":"order.shipped","orders/cancelled":"order.cancelled","products/create":"product.sync","products/update":"product.sync" };
  const eventType = statusMap[topic]||topic;
  if (eventType === "product.sync") { const p=payload,v=p.variants?.[0]||{}; return { eventType, product:{id:String(p.id),sku:String(v.sku||p.id),name:p.title,description:(p.body_html||"").replace(/<[^>]+>/g,""),categoryId:String(p.product_type||""),brand:p.vendor||null,isActive:p.status==="active",price:parseFloat(v.price||0),promotionalPrice:parseFloat(v.compare_at_price||0),url:p.handle?`https://shop.myshopify.com/products/${p.handle}`:null,images:(p.images||[]).map(i=>({url:i.src,description:i.alt||null})),weightInGrams:v.grams||0,dimensions:{heightInCm:0,widthInCm:0,lengthInCm:0}} }; }
  const f=payload.fulfillments?.[0]||{};
  return { eventType, orderId:String(payload.id||payload.order_id||""), paymentTracking:payload.payment_gateway||"", logisticStatus:payload.fulfillment_status||"fulfilled", totalAmount:parseFloat(payload.total_price||0), items:(payload.line_items||[]).map(i=>({productId:String(i.product_id),sku:String(i.sku||i.variant_id),name:i.title,quantity:i.quantity,unitPrice:parseFloat(i.price||0),discount:parseFloat(i.total_discount||0),sellerId:"all"})), shipping:{provider:f.tracking_company||payload.shipping_lines?.[0]?.title||"Entrega",type:1,price:parseFloat(payload.shipping_lines?.[0]?.price||0),estimative:"5 dias úteis"} };
}
function normalizeWoocommerce(payload) {
  const action=payload.action||payload.webhook_event||payload.status||"";
  const statusMap={"woocommerce_new_order":"order.created","woocommerce_order_status_processing":"order.created","woocommerce_order_status_completed":"order.shipped","woocommerce_order_status_shipped":"order.shipped","woocommerce_order_status_cancelled":"order.cancelled","woocommerce_order_status_refunded":"order.cancelled","woocommerce_new_product":"product.sync","woocommerce_update_product":"product.sync","order.created":"order.created","order.updated":"order.shipped","order.deleted":"order.cancelled","product.created":"product.sync","product.updated":"product.sync","processing":"order.created","completed":"order.shipped","cancelled":"order.cancelled","refunded":"order.cancelled"};
  const eventType=statusMap[action]||"order.created";
  if (eventType==="product.sync") { const p=payload; return { eventType, product:{id:String(p.id),sku:String(p.sku||p.id),name:p.name,description:(p.short_description||p.description||"").replace(/<[^>]+>/g,""),categoryId:String(p.categories?.[0]?.id||""),brand:p.brands?.[0]?.name||null,isActive:p.status==="publish",price:parseFloat(p.price||p.regular_price||0),promotionalPrice:parseFloat(p.sale_price||0),url:p.permalink||null,images:(p.images||[]).map(i=>({url:i.src,description:i.alt||null})),weightInGrams:p.weight?parseFloat(p.weight)*1000:0,dimensions:{heightInCm:parseFloat(p.dimensions?.height||0),widthInCm:parseFloat(p.dimensions?.width||0),lengthInCm:parseFloat(p.dimensions?.length||0)}} }; }
  const sh=payload.shipping_lines?.[0]||{};
  return { eventType, orderId:String(payload.id||payload.order_id||""), paymentTracking:payload.transaction_id||payload.payment_method||"", logisticStatus:payload.status||"processing", totalAmount:parseFloat(payload.total||0), items:(payload.line_items||[]).map(i=>({productId:String(i.product_id),sku:String(i.sku||i.product_id),name:i.name,quantity:i.quantity,unitPrice:parseFloat(i.price||0),discount:0,sellerId:"all"})), shipping:{provider:sh.method_title||"Entrega",type:1,price:parseFloat(sh.total||0),estimative:"5 dias úteis"} };
}
function normalizeNuvemshop(payload) {
  const topic=payload.topic||payload.event||"";
  const statusMap={
    // Order events
    "order/created":"order.created","order/paid":"order.created","order/updated":"order.created",
    "order/packed":"order.shipped","order/fulfilled":"order.shipped","order/cancelled":"order.cancelled",
    "order/pending":"order.created","order/voided":"order.cancelled",
    "order/custom_fields_updated":"order.created","order/edited":"order.created",
    // Fulfillment events
    "fulfillment/updated":"order.shipped",
    "fulfillment_order/status_updated":"order.shipped",
    "fulfillment_order/tracking_event_created":"order.shipped",
    "fulfillment_order/tracking_event_updated":"order.shipped",
    "fulfillment_order/tracking_event_deleted":"order.shipped",
    // Product events (real API format uses singular + slash)
    "product/created":"product.sync","product/updated":"product.sync","product/deleted":"product.sync",
    "product_variant/custom_fields_updated":"product.sync",
    // Category events
    "category/created":"product.sync","category/updated":"product.sync","category/deleted":"product.sync",
    // Legacy plural format (fallback)
    "orders/created":"order.created","orders/paid":"order.created","orders/fulfilled":"order.shipped","orders/cancelled":"order.cancelled",
    "products/created":"product.sync","products/updated":"product.sync",
  };
  const eventType=statusMap[topic]||topic;
  // Para product.sync: usa o produto completo já injetado pelo handleWebhook (com variantes atualizadas)
  if (eventType==="product.sync") {
    const p=payload.product||payload;
    return { eventType, product: p };
  }
  const order=payload.order||payload;
  return { eventType, orderId:String(order.id||order.number||""), paymentTracking:order.payment_details?.method||"", logisticStatus:order.shipping_status||order.status||"shipped", totalAmount:parseFloat(order.total||0), items:(order.products||[]).map(i=>({productId:String(i.product_id||i.id),sku:String(i.sku||i.variant_id),name:i.name,quantity:i.quantity,unitPrice:parseFloat(i.price||0),discount:parseFloat(i.discount||0),sellerId:"all"})), shipping:{provider:order.shipping_pickup_type||"Entrega",type:1,price:parseFloat(order.shipping_cost_owner||0),estimative:"5 dias úteis"} };
}
function normalizeTray(payload) {
  const event=payload.type||payload.trigger||payload.event||"";
  const statusMap={"order_created":"order.created","order_paid":"order.created","order_shipped":"order.shipped","order_delivered":"order.shipped","order_cancelled":"order.cancelled","product_created":"product.sync","product_updated":"product.sync"};
  const eventType=statusMap[event]||event;
  if (eventType==="product.sync") { const p=payload.Product||payload.product||payload; return { eventType, product:{id:String(p.id||p.Id),sku:String(p.reference||p.sku||p.id),name:p.name||p.Name,description:(p.description||p.Description||"").replace(/<[^>]+>/g,""),categoryId:String(p.category_id||p.CategoryId||""),brand:p.brand||p.Brand||null,isActive:p.available==="1"||p.available===true||p.Active===true,price:parseFloat(p.price||p.Price||0),promotionalPrice:parseFloat(p.promotional_price||p.PromotionalPrice||0),url:p.link||p.Url||null,images:(p.images||p.Images||[]).map(i=>({url:i.link||i.Url||i.url,description:i.alt||null})),weightInGrams:parseFloat(p.weight||p.Weight||0)*1000,dimensions:{heightInCm:parseFloat(p.height||p.Height||0),widthInCm:parseFloat(p.width||p.Width||0),lengthInCm:parseFloat(p.length||p.Length||0)}} }; }
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
async function processOrderCreated(ep, tk, n) {
  const existing = await findSuriOrder(ep, tk, n.orderId);
  if (existing) { await suriRequest(ep,tk,"POST","/api/shop/orders/paid",{orderId:existing.id||existing.orderId,paymentTracking:n.paymentTracking||""}); return {action:"marked_paid",suriOrderId:existing.id}; }
  const budget={id:String(n.orderId),logistic:{providerId:"001",name:n.shipping.provider||"Entrega",description:"Padrão",type:n.shipping.type||1,price:n.shipping.price||0,minShippingTimeEstimative:n.shipping.estimative||"3 dias úteis",shippingTimeEstimative:n.shipping.estimative||"5 dias úteis"},items:n.items.map(i=>({fromSellerId:i.sellerId||"all",ProductId:String(i.productId||i.id),Sku:String(i.sku||i.productId),Name:i.name,quantity:i.quantity,unitPrice:i.unitPrice,discountAmount:i.discount||0})),errorMessages:[]};
  const created = await suriRequest(ep,tk,"POST","/api/shop/orders/budget",budget);
  const suriOrderId=created?.id||created?.orderId;
  if (suriOrderId) await suriRequest(ep,tk,"POST","/api/shop/orders/paid",{orderId:suriOrderId,paymentTracking:n.paymentTracking||""});
  return {action:"created_and_paid",suriOrderId};
}
async function processOrderShipped(ep,tk,n) { const ex=await findSuriOrder(ep,tk,n.orderId); if (!ex) throw new Error(`Pedido ${n.orderId} não encontrado na Suri`); const st=mapLogisticStatus(n.logisticStatus); await suriRequest(ep,tk,"POST","/api/shop/orders/logistic",{id:ex.id||ex.orderId,status:st}); return {action:"logistic_updated",suriOrderId:ex.id,status:st}; }
async function processOrderCancelled(ep,tk,n) { const ex=await findSuriOrder(ep,tk,n.orderId); if (!ex) throw new Error(`Pedido ${n.orderId} não encontrado na Suri`); await suriRequest(ep,tk,"POST","/api/shop/orders/cancel",{orderId:ex.id||ex.orderId}); return {action:"cancelled",suriOrderId:ex.id}; }
async function processProductSync(ep, tk, n) {
  const { syncProduct } = await import("./_lib/chatbot/suri/products.js");
  const { listCategories } = await import("./_lib/chatbot/suri/categories.js");
  const { normalizeProduct } = await import("./_lib/ecommerce/nuvemshop/products.js");

  // n.product vem no formato raw da Nuvemshop (com variantes atualizadas)
  const product = n.product ? normalizeProduct(n.product) : null;
  if (!product) throw new Error("Produto não encontrado no payload do webhook");

  // Monta categoryIdMap: tenta externalId, id e name como chaves
  const categoryIdMap = new Map();
  try {
    const suriCats = await listCategories(ep, tk);
    for (const c of suriCats) {
      const suriId = String(c.id);
      // mapeia por externalId (ideal)
      if (c.externalId) categoryIdMap.set(String(c.externalId), suriId);
      // mapeia também pelo próprio id (caso a Suri use o ID da Nuvemshop como id interno)
      categoryIdMap.set(suriId, suriId);
    }
  } catch { /* sem mapa */ }

  // Se o mapa não tem o categoryId do produto, tenta usar o ID diretamente
  // (funciona quando a Suri usa o mesmo ID da Nuvemshop como ID interno)
  if (product.categoryId && !categoryIdMap.has(String(product.categoryId))) {
    categoryIdMap.set(String(product.categoryId), String(product.categoryId));
  }

  return syncProduct(ep, tk, product, null, categoryIdMap.size > 0 ? categoryIdMap : null);
}
async function handleWebhook(req, res) {
  if (req.method === "GET") return res.status(200).json({ success: true, message: "Webhook endpoint ativo" });
  if (req.method !== "POST") { res.setHeader("Allow",["GET","POST"]); return res.status(405).end(); }
  const { token } = req.query;
  if (!token) return res.status(400).json({ success: false, message: "token obrigatório" });
  let integration;
  try {
    let r = await pool.query("SELECT user_id, suri_active, suri_endpoint, suri_token, ecommerce_platform, chatbot_platform, chatbot_config, chatbot_active, chatbot_token, webhook_token FROM user_integrations WHERE webhook_token = $1", [token]);
    if (!r.rows[0]) r = await pool.query("SELECT user_id, suri_active, suri_endpoint, suri_token, ecommerce_platform, chatbot_platform, chatbot_config, chatbot_active, chatbot_token, webhook_token FROM user_integrations WHERE chatbot_token = $1", [token]);
    if (!r.rows[0]) return res.status(404).json({ success: false, message: "Token inválido" });
    integration = r.rows[0];
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
  const _ccfg = integration.chatbot_config || {};
  const suri_endpoint = integration.suri_endpoint || _ccfg.endpoint || null;
  const suri_token    = integration.suri_token    || _ccfg.token    || null;
  const suri_active   = !!(integration.suri_active ?? integration.chatbot_active ?? (suri_endpoint && suri_token));
  const { user_id, ecommerce_platform, chatbot_platform } = integration;

  // Descobre se veio pelo token de chatbot ou ecommerce
  const isViaWebhookToken = integration.webhook_token === token;
  const activePlatform = isViaWebhookToken
    ? (ecommerce_platform || "ecommerce")
    : (chatbot_platform   || "chatbot");

  // Mapa de nomes legíveis por plataforma
  const PLATFORM_LABELS = {
    shopify: "Shopify", woocommerce: "WooCommerce", nuvemshop: "Nuvemshop",
    vtex: "VTEX", tray: "Tray", suri: "Suri", evolution_api: "Evolution API",
    kommo: "Kommo", chatbot: "Chatbot", ecommerce: "E-commerce",
  };
  const platformLabel = PLATFORM_LABELS[activePlatform] || activePlatform;

  // Busca nome do usuário para mensagens de erro
  let userName = `ID ${user_id}`;
  try {
    const uRow = await pool.query("SELECT name FROM users WHERE id = $1", [user_id]);
    if (uRow.rows[0]) userName = uRow.rows[0].name;
  } catch {}

  let rawPayload = req.body || {};

  // Nuvemshop envia apenas {id, event, store_id} — sem dados do produto/pedido.
  // É necessário fazer um GET na API para buscar os dados completos antes de normalizar.
  if (ecommerce_platform === "nuvemshop" && rawPayload.id && rawPayload.event) {
    try {
      const intRow = await pool.query("SELECT ecommerce_config FROM user_integrations WHERE user_id = $1", [user_id]);
      const cfg = intRow.rows[0]?.ecommerce_config || {};
      const { store_id, access_token } = cfg;
      if (store_id && access_token) {
        const headers = {
          "Content-Type": "application/json",
          "Authentication": `bearer ${access_token}`,
          "User-Agent": "CodeRise Integration (suporte@coderise.com.br)",
        };
        const base = `https://api.tiendanube.com/v1/${store_id}`;
        const ev = rawPayload.event || "";
        let fetchUrl = null;
        if (ev.startsWith("product")) {
          fetchUrl = `${base}/products/${rawPayload.id}`;
        } else if (ev.startsWith("order")) {
          fetchUrl = `${base}/orders/${rawPayload.id}`;
        } else if (ev.startsWith("category")) {
          fetchUrl = `${base}/categories/${rawPayload.id}`;
        }
        if (fetchUrl) {
          const r = await fetch(fetchUrl, { headers });
          if (r.ok) {
            const fullData = await r.json();
            // Merge: mantém event/store_id originais e injeta dados completos
            if (ev.startsWith("product")) {
              // Busca variantes atualizadas em paralelo para garantir estoque correto
              let variants = fullData.variants || [];
              try {
                const vr = await fetch(`${base}/products/${rawPayload.id}/variants`, { headers });
                if (vr.ok) { const vd = await vr.json(); if (Array.isArray(vd) && vd.length > 0) variants = vd; }
              } catch { /* usa variantes do produto */ }
              rawPayload = { ...rawPayload, product: { ...fullData, variants } };
            } else if (ev.startsWith("order")) {
              rawPayload = { ...rawPayload, order: fullData };
            } else {
              rawPayload = { ...rawPayload, ...fullData };
            }
          }
        }
      }
    } catch { /* continua com payload original se o fetch falhar */ }
  }

  let normalized;
  // Webhook da Suri (chatbot) — tem formato próprio com HookEvent
  if (!isViaWebhookToken && rawPayload.HookEvent) {
    const suriEventMap = {
      "OrdersPaid":      "order.paid",
      "OrdersCreated":   "order.created",
      "OrdersCancelled": "order.cancelled",
      "OrdersShipped":   "order.shipped",
    };
    const eventType = suriEventMap[rawPayload.HookEvent] || rawPayload.HookEvent;
    normalized = { eventType, orderId: String(rawPayload.OrderId || rawPayload.Id || ""), suriOrderId: String(rawPayload.Id || "") };
  } else {
    try { normalized = normalizePayload(ecommerce_platform, rawPayload); }
    catch { normalized = { eventType: rawPayload.type||rawPayload.event||"desconhecido", orderId:"", items:[], shipping:{provider:"Entrega",type:1,price:0,estimative:"5 dias úteis"} }; }
  }
  const eventType = normalized.eventType;
  let webhookId;
  try {
    const webhookSource = isViaWebhookToken ? "ecommerce" : "chatbot";
    const ins = await pool.query("INSERT INTO user_webhooks (user_id, event_type, payload, status, source) VALUES ($1, $2, $3, 'received', $4) RETURNING id", [user_id, eventType, JSON.stringify(rawPayload), webhookSource]);
    webhookId = ins.rows[0].id;
    // Auto-cleanup: mantém no máximo 100 linhas por usuário em user_webhooks
    await pool.query(`DELETE FROM user_webhooks WHERE user_id=$1 AND id NOT IN (SELECT id FROM user_webhooks WHERE user_id=$1 ORDER BY received_at DESC LIMIT 100)`,[user_id]).catch(()=>{});
  }
  catch (err) { return res.status(500).json({ success: false, message: "Erro ao salvar: " + err.message }); }
  if (!suri_active || !suri_endpoint || !suri_token) return res.status(200).json({ success:true, message:"Evento registrado. Suri não configurada ou inativa.", event_type:eventType, platform:ecommerce_platform, webhook_id:webhookId });
  try {
    let result;
    switch (eventType) {
      case "order.created":   result = await processOrderCreated(suri_endpoint, suri_token, normalized);  break;
      case "order.shipped":   result = await processOrderShipped(suri_endpoint, suri_token, normalized);  break;
      case "order.cancelled": result = await processOrderCancelled(suri_endpoint, suri_token, normalized); break;
      case "product.sync":    result = await processProductSync(suri_endpoint, suri_token, normalized);   break;
      case "order.paid":      result = await processSuriOrderPaid(suri_endpoint, suri_token, normalized, user_id); break;
      default:
        await pool.query("UPDATE user_webhooks SET status='processed', error_message=$1 WHERE id=$2", [`Evento '${eventType}' sem mapeamento`, webhookId]);
        return res.status(200).json({ success:true, message:"Evento registrado sem processamento", event_type:eventType, webhook_id:webhookId });
    }
    await pool.query("UPDATE user_webhooks SET status='processed', error_message=NULL WHERE id=$1", [webhookId]);
    await pool.query("SELECT pg_notify('webhooks_changed', $1)", [JSON.stringify({id:webhookId,status:"processed",event_type:eventType})]);
    return res.status(200).json({ success:true, message:"Evento processado com sucesso", event_type:eventType, platform:ecommerce_platform, webhook_id:webhookId, suri_result:result });
  } catch (err) {
    await pool.query("UPDATE user_webhooks SET status='error', error_message=$1 WHERE id=$2", [err.message, webhookId]);
    await pool.query("SELECT pg_notify('webhooks_changed', $1)", [JSON.stringify({id:webhookId,status:"error",event_type:eventType})]);
    try {
      const errorTime = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

      // Notificação para o próprio usuário
      await pool.query(
        "INSERT INTO notifications (type, title, message, target_role, target_user_id) VALUES ('error', $1, $2, 'user', $3)",
        [
          `Erro na integração ${platformLabel}`,
          `Evento "${eventType || "desconhecido"}" falhou em ${errorTime}.\n\nDetalhe: ${err.message}`,
          user_id,
        ]
      );
      // Notificação detalhada para administradores
      await pool.query(
        "INSERT INTO notifications (type, title, message, target_role) VALUES ('integration_error', $1, $2, 'admin')",
        [
          `Erro de integração — ${platformLabel}`,
          `Perfil: ${userName}\nPlataforma: ${platformLabel}\nEvento: ${eventType || "desconhecido"}\nHorário: ${errorTime}\n\nDetalhe: ${err.message}`,
        ]
      );
      // Dispara SSE imediatamente para todos os admins conectados
      await pool.query("SELECT pg_notify('notifications_changed', 'new')").catch(() => {});
    } catch {}
    return res.status(200).json({ success:false, message:"Evento registrado mas falhou ao processar na Suri", event_type:eventType, platform:ecommerce_platform, webhook_id:webhookId, error:err.message });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// WEBHOOKS STREAM (SSE)
// ════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════
// WEBHOOKS LONG POLL
// ════════════════════════════════════════════════════════════════════════════
async function handleWebhooksPoll(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow", ["GET"]); return res.status(405).end(); }
  const caller = await requireAuth(req, res); if (!caller) return;

  // after_id: ID do último evento que o cliente já conhece
  const afterId = req.query.after_id ? parseInt(req.query.after_id, 10) : null;
  const timeout = 20000; // 20s max — abaixo do limite do Vercel

  // Monta query base
  const buildQuery = () => {
    const where = [], values = []; let idx = 1;
    if (caller.role !== "admin") { where.push(`uw.user_id = $${idx++}`); values.push(caller.id); }
    else if (req.query.user_id) { where.push(`uw.user_id = $${idx++}`); values.push(req.query.user_id); }
    if (req.query.status)     { where.push(`uw.status = $${idx++}`);     values.push(req.query.status); }
    if (req.query.event_type) { where.push(`uw.event_type = $${idx++}`); values.push(req.query.event_type); }
    if (afterId !== null)     { where.push(`uw.id > $${idx++}`);         values.push(afterId); }
    const whereStr = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return { sql: `SELECT uw.id, uw.user_id, u.name AS user_name, u.email AS user_email, uw.event_type, uw.payload, uw.status, uw.error_message, uw.source, uw.received_at FROM user_webhooks uw JOIN users u ON u.id = uw.user_id ${whereStr} ORDER BY uw.received_at DESC LIMIT 100`, values };
  };

  // 1ª consulta imediata — se já houver eventos novos, retorna agora
  const { sql, values } = buildQuery();
  const immediate = await pool.query(sql, values).catch(() => ({ rows: [] }));
  if (immediate.rows.length > 0) {
    return res.status(200).json({ success: true, webhooks: immediate.rows, has_new: true, server_time: new Date().toISOString() });
  }

  // Nada novo ainda — aguarda notificação via LISTEN/NOTIFY até o timeout
  let client;
  let resolved = false;
  const respond = (webhooks) => {
    if (resolved) return;
    resolved = true;
    res.status(200).json({ success: true, webhooks, has_new: webhooks.length > 0, server_time: new Date().toISOString() });
  };

  try {
    client = await pool.connect();
    // Garante trigger
    await client.query(`CREATE OR REPLACE FUNCTION notify_webhook_change() RETURNS trigger AS $$ BEGIN PERFORM pg_notify('webhooks_changed', NEW.id::text); RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await client.query(`DROP TRIGGER IF EXISTS webhook_insert_notify ON user_webhooks; CREATE TRIGGER webhook_insert_notify AFTER INSERT OR UPDATE ON user_webhooks FOR EACH ROW EXECUTE FUNCTION notify_webhook_change()`);
    await client.query("LISTEN webhooks_changed");

    // Timeout — retorna vazio após 20s (cliente imediatamente faz outra requisição)
    const timer = setTimeout(async () => {
      try { await client.query("UNLISTEN webhooks_changed"); client.release(); } catch {}
      respond([]);
    }, timeout);

    client.on("notification", async () => {
      clearTimeout(timer);
      try { await client.query("UNLISTEN webhooks_changed"); client.release(); } catch {}
      const { sql: s2, values: v2 } = buildQuery();
      const fresh = await pool.query(s2, v2).catch(() => ({ rows: [] }));
      respond(fresh.rows);
    });

    req.on("close", () => {
      clearTimeout(timer);
      resolved = true;
      try { client.query("UNLISTEN webhooks_changed").then(() => client.release()).catch(() => {}); } catch {}
    });
  } catch (err) {
    if (client) { try { client.release(); } catch {} }
    if (!resolved) res.status(200).json({ success: true, webhooks: [], has_new: false, server_time: new Date().toISOString() });
  }
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
  const topics=[{name:"Pedido Criado",topic:"order.created"},{name:"Pedido Atualizado",topic:"order.updated"},{name:"Pedido Deletado",topic:"order.deleted"},{name:"Produto Criado",topic:"product.created"},{name:"Produto Atualizado",topic:"product.updated"}];
  const results=[];
  for (const {name,topic} of topics) { const r=await fetch(`${base}/webhooks`,{method:"POST",headers,body:JSON.stringify({name,status:"active",topic,delivery_url:webhookUrl})}); const data=await r.json(); results.push(r.ok?{topic,status:"created",id:data.id}:{topic,status:"error",detail:data.message||data}); }
  return { success:true, message:`${results.filter(r=>r.status==="created").length}/${topics.length} webhooks registrados no WooCommerce`, details:results };
}
async function registerNuvemshop(config, webhookUrl) {
  const { store_id, access_token } = config;
  if (!store_id||!access_token) throw new Error("store_id e access_token são obrigatórios");
  const base=`https://api.tiendanube.com/v1/${store_id}`;
  const headers={"Content-Type":"application/json","Authentication":`bearer ${access_token}`,"User-Agent":"CodeRise Integration (suporte@coderise.com.br)"};
  const events=[
    // App
    "app/uninstalled","app/suspended","app/resumed",
    // Category
    "category/created","category/updated","category/deleted",
    // Order
    "order/created","order/updated","order/paid","order/packed",
    "order/fulfilled","order/cancelled","order/custom_fields_updated",
    "order/edited","order/pending","order/voided",
    // Product
    "product/created","product/updated","product/deleted",
    // Product Variant
    "product_variant/custom_fields_updated",
    // Domain
    "domain/updated",
    // Order Custom Field
    "order_custom_field/created","order_custom_field/updated","order_custom_field/deleted",
    // Product Variant Custom Field
    "product_variant_custom_field/created","product_variant_custom_field/updated","product_variant_custom_field/deleted",
    // Fulfillment
    "fulfillment/updated",
    // Fulfillment Order
    "fulfillment_order/status_updated",
    "fulfillment_order/tracking_event_created",
    "fulfillment_order/tracking_event_updated",
    "fulfillment_order/tracking_event_deleted",
    // Location
    "location/created","location/updated","location/deleted",
  ];
  const results=[];
  for (const event of events) {
    const r=await fetch(`${base}/webhooks`,{method:"POST",headers,body:JSON.stringify({event,url:webhookUrl})});
    const data=await r.json().catch(()=>({}));
    if (!r.ok) {
      const alreadyExists=r.status===422&&JSON.stringify(data).toLowerCase().includes("already");
      results.push({event,status:alreadyExists?"already_exists":"error",detail:data.description||data});
    } else {
      results.push({event,status:"created",id:data.id});
    }
  }
  const ok=results.filter(r=>r.status==="created"||r.status==="already_exists").length;
  return { success:true, message:`${ok}/${events.length} webhooks registrados na Nuvemshop`, details:results };
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
// SETUP
// ════════════════════════════════════════════════════════════════════════════
async function handleSetup(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  if (!isAdminSecret(req)) return res.status(401).json({ success:false, message:"Não autorizado" });
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, email VARCHAR(255) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL, role VARCHAR(20) NOT NULL DEFAULT 'user', active BOOLEAN NOT NULL DEFAULT true, token VARCHAR(64) UNIQUE, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW());`);
    await pool.query(`CREATE TABLE IF NOT EXISTS user_integrations (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, ecommerce_platform VARCHAR(50), ecommerce_config JSONB, ecommerce_active BOOLEAN NOT NULL DEFAULT false, webhook_token VARCHAR(64) UNIQUE NOT NULL, chatbot_platform VARCHAR(50), chatbot_config JSONB, chatbot_active BOOLEAN NOT NULL DEFAULT false, chatbot_token VARCHAR(64) UNIQUE, suri_endpoint TEXT, suri_token TEXT, suri_active BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW(), UNIQUE(user_id));`);
    for (const sql of [`ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS chatbot_platform VARCHAR(50)`,`ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS chatbot_config JSONB`,`ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS chatbot_active BOOLEAN NOT NULL DEFAULT false`,`ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS chatbot_token VARCHAR(64) UNIQUE`]) { await pool.query(sql).catch(()=>{}); }
    const noToken = await pool.query("SELECT user_id FROM user_integrations WHERE chatbot_token IS NULL");
    for (const row of noToken.rows) { await pool.query("UPDATE user_integrations SET chatbot_token=$1 WHERE user_id=$2 AND chatbot_token IS NULL",[crypto.randomBytes(32).toString("hex"),row.user_id]); }
    await pool.query(`CREATE TABLE IF NOT EXISTS sync_rules (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, event VARCHAR(100) NOT NULL, active BOOLEAN NOT NULL DEFAULT true, message_template TEXT, delay_minutes INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW());`);
    await pool.query(`CREATE TABLE IF NOT EXISTS user_webhooks (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, event_type VARCHAR(100), payload JSONB, status VARCHAR(20) DEFAULT 'received', error_message TEXT, source VARCHAR(20) DEFAULT 'ecommerce', received_at TIMESTAMP NOT NULL DEFAULT NOW());`);
    await pool.query(`ALTER TABLE user_webhooks ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'ecommerce'`).catch(()=>{});
    await pool.query(`CREATE TABLE IF NOT EXISTS notifications (id SERIAL PRIMARY KEY, type VARCHAR(30) NOT NULL, title VARCHAR(100) NOT NULL, message TEXT NOT NULL, image_url TEXT, target_role VARCHAR(20) DEFAULT 'all', target_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, scheduled_at TIMESTAMP, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMP NOT NULL DEFAULT NOW());`);
    await pool.query(`CREATE TABLE IF NOT EXISTS notification_reads (notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, hidden BOOLEAN NOT NULL DEFAULT false, read_at TIMESTAMP NOT NULL DEFAULT NOW(), PRIMARY KEY (notification_id, user_id));`);
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

  // Cria notificação de erro para admins e dispara SSE
  const notifyAdminError = async (errorMsg) => {
    try {
      const errorTime = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const uRow = await pool.query("SELECT name FROM users WHERE id = $1", [caller.id]);
      const userName = uRow.rows[0]?.name || `ID ${caller.id}`;
      const intRow = await pool.query("SELECT chatbot_platform FROM user_integrations WHERE user_id = $1", [caller.id]);
      const rawPlatform = intRow.rows[0]?.chatbot_platform || "suri";
      const PLATFORM_LABELS = { suri: "Suri", evolution_api: "Evolution API", kommo: "Kommo" };
      const platformLabel = PLATFORM_LABELS[rawPlatform] || rawPlatform;
      await pool.query(
        "INSERT INTO notifications (type, title, message, target_role) VALUES ('integration_error', $1, $2, 'admin')",
        [
          `Falha no teste de conexão — ${platformLabel}`,
          `Perfil: ${userName}\nPlataforma: ${platformLabel}\nURL: ${base?.hostname || endpoint}\nHorário: ${errorTime}\n\nDetalhe: ${errorMsg}`,
        ]
      );
      await pool.query("SELECT pg_notify('notifications_changed', 'new')").catch(() => {});
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
// ─── handleTestEcommerce ──────────────────────────────────────────────────────

async function handleTestEcommerce(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end();
  }
  const caller = await requireAuth(req, res);
  if (!caller) return;

  const { platform, config } = req.body || {};
  if (!platform || !config)
    return res.status(400).json({ success: false, message: "platform e config são obrigatórios." });

  const LABELS = {
    shopify: "Shopify", woocommerce: "WooCommerce", nuvemshop: "Nuvemshop",
    vtex: "VTEX", tray: "Tray", custom: "Custom",
  };
  const label = LABELS[platform] || platform;

  try {
    let result = {};

    if (platform === "nuvemshop") {
      const { store_id, access_token } = config;
      if (!store_id || !access_token)
        throw new Error("store_id e access_token são obrigatórios.");

      const r = await fetch(`https://api.tiendanube.com/v1/${store_id}/store`, {
        headers: {
          "Authentication": `bearer ${access_token}`,
          "User-Agent": "CodeRise Integration (suporte@coderise.com.br)",
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(10000),
      });
      const body = await r.json().catch(() => ({}));

      if (r.status === 401 || r.status === 403)
        throw new Error(`Token inválido ou sem permissão (HTTP ${r.status}). Verifique o Access Token.`);
      if (r.status === 404)
        throw new Error(`Loja não encontrada (HTTP 404). Verifique o Store ID "${store_id}".`);
      if (!r.ok)
        throw new Error(`Nuvemshop retornou HTTP ${r.status}: ${JSON.stringify(body).slice(0, 200)}`);

      const storeName = body.name?.pt || body.name?.es || Object.values(body.name || {})[0] || body.business_name || "—";
      result = {
        store: storeName,
        plan: body.plan_name || null,
        country: body.country || null,
        stores: [{ id: String(store_id), name: storeName }],
      };

    } else if (platform === "shopify") {
      const { store_url, api_token, api_version } = config;
      if (!store_url || !api_token) throw new Error("store_url e api_token são obrigatórios.");
      const version = api_version || "2024-01";
      const host = store_url.replace(/^https?:\/\//, "").replace(/\/$/, "");
      const r = await fetch(`https://${host}/admin/api/${version}/shop.json`, {
        headers: { "X-Shopify-Access-Token": api_token, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Shopify HTTP ${r.status}: ${JSON.stringify(body).slice(0, 200)}`);
      const shop = body.shop || {};
      result = { store: shop.name || "—", plan: shop.plan_name || null, country: shop.country_name || null, stores: [{ id: String(shop.id || store_url), name: shop.name || store_url }] };

    } else if (platform === "woocommerce") {
      const { site_url, consumer_key, consumer_secret } = config;
      if (!site_url || !consumer_key || !consumer_secret)
        throw new Error("site_url, consumer_key e consumer_secret são obrigatórios.");
      const base = site_url.replace(/\/+$/, "");
      const auth = Buffer.from(`${consumer_key}:${consumer_secret}`).toString("base64");
      const r = await fetch(`${base}/wp-json/wc/v3/system_status`, {
        headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`WooCommerce HTTP ${r.status}: ${JSON.stringify(body).slice(0, 200)}`);
      const env = body.environment || {};
      result = { store: env.site_url || site_url, plan: `WC ${env.version || ""}`.trim(), country: null, stores: [{ id: site_url, name: env.site_url || site_url }] };

    } else if (platform === "vtex") {
      const { account_name, app_key, app_token } = config;
      if (!account_name || !app_key || !app_token)
        throw new Error("account_name, app_key e app_token são obrigatórios.");
      const r = await fetch(
        `https://${account_name}.vtexcommercestable.com.br/api/catalog_system/pub/category/tree/1`,
        { headers: { "X-VTEX-API-AppKey": app_key, "X-VTEX-API-AppToken": app_token }, signal: AbortSignal.timeout(10000) }
      );
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`VTEX HTTP ${r.status}: ${JSON.stringify(body).slice(0, 200)}`);
      result = { store: account_name, plan: "VTEX", country: null, stores: [{ id: account_name, name: account_name }] };

    } else if (platform === "tray") {
      const { api_address, access_token } = config;
      if (!api_address || !access_token) throw new Error("api_address e access_token são obrigatórios.");
      const base = api_address.replace(/\/+$/, "");
      const r = await fetch(`${base}/store`, {
        headers: { "Authorization": `Bearer ${access_token}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Tray HTTP ${r.status}: ${JSON.stringify(body).slice(0, 200)}`);
      const store = body.Store || body.store || {};
      result = { store: store.name || api_address, plan: null, country: null, stores: [{ id: String(store.id || api_address), name: store.name || api_address }] };

    } else {
      return res.status(400).json({ success: false, message: `Teste automático não disponível para "${platform}".` });
    }

    return res.status(200).json({
      success: true,
      message: `Conexão com ${label} realizada com sucesso!${result.store ? ` Loja: ${result.store}.` : ""}`,
      store: result.store || null,
      plan: result.plan || null,
      country: result.country || null,
      stores: result.stores || [],
    });

  } catch (err) {
    const msg = err.name === "TimeoutError"
      ? `Timeout: "${label}" não respondeu em 10 segundos.`
      : err.message;
    return res.status(200).json({ success: false, message: msg });
  }
}
// ════════════════════════════════════════════════════════════════════════════
// PLATFORM SETTINGS — controle de quais plataformas estão habilitadas
// GET  /platform-settings → retorna { platforms: { suri: true, nuvemshop: true, ... } }
// PATCH /platform-settings → admin atualiza quais plataformas estão ativas
// ════════════════════════════════════════════════════════════════════════════
async function handlePlatformSettings(req, res) {
  const caller = await requireAuth(req, res);
  if (!caller) return;

  // Garante que a tabela de configurações existe
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      key VARCHAR(100) PRIMARY KEY,
      value JSONB NOT NULL DEFAULT 'true',
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});

  if (req.method === "GET") {
    try {
      const r = await pool.query("SELECT key, value FROM platform_settings");
      const platforms = {};
      for (const row of r.rows) {
        platforms[row.key] = row.value;
      }
      return res.status(200).json({ success: true, platforms });
    } catch {
      // Se tabela não existe ainda, retorna todas habilitadas (padrão)
      return res.status(200).json({ success: true, platforms: {} });
    }
  }

  if (req.method === "PATCH") {
    // Apenas admin pode alterar
    if (!caller.is_admin) {
      return res.status(403).json({ success: false, message: "Apenas administradores podem alterar configurações de plataforma." });
    }
    const { platforms } = req.body || {};
    if (!platforms || typeof platforms !== "object") {
      return res.status(400).json({ success: false, message: "Campo 'platforms' obrigatório." });
    }
    for (const [key, value] of Object.entries(platforms)) {
      await pool.query(
        "INSERT INTO platform_settings (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()",
        [key, JSON.stringify(value)]
      );
    }
    const r = await pool.query("SELECT key, value FROM platform_settings");
    const updated = {};
    for (const row of r.rows) updated[row.key] = row.value;
    return res.status(200).json({ success: true, platforms: updated });
  }

  res.setHeader("Allow", ["GET", "PATCH"]);
  return res.status(405).end();
}

// ════════════════════════════════════════════════════════════════════════════
// SYNC CATALOG — sincroniza categorias e produtos do e-commerce na Suri
// ─── Suri OrdersPaid → deduz estoque na Nuvemshop ───────────────────────────
async function processSuriOrderPaid(suriEndpoint, suriToken, normalized, userId) {
  const { getProductVariants, updateVariantStock } = await import("./_lib/ecommerce/nuvemshop/client.js");

  // Busca credenciais da Nuvemshop para este usuário
  const intRow = await pool.query(
    "SELECT ecommerce_platform, ecommerce_config FROM user_integrations WHERE user_id = $1",
    [userId]
  );
  const integration = intRow.rows[0];
  if (!integration || integration.ecommerce_platform !== "nuvemshop") {
    return { action: "skipped", reason: "E-commerce não é Nuvemshop" };
  }
  const { store_id, access_token } = integration.ecommerce_config || {};
  if (!store_id || !access_token) {
    return { action: "skipped", reason: "Credenciais da Nuvemshop não configuradas" };
  }

  // Usa OrderId (numérico) para buscar na Suri — o campo Id tem prefixo "cb" que deve ser ignorado
  const suriOrderId = normalized.orderId || normalized.suriOrderId;
  if (!suriOrderId) return { action: "skipped", reason: "OrderId não encontrado no payload" };

  let suriOrder;
  try {
    const { request } = await import("./_lib/chatbot/suri/client.js");
    suriOrder = await request(suriEndpoint, suriToken, "GET", `/api/shop/orders/${suriOrderId}`);
  } catch (err) {
    throw new Error(`Erro ao buscar pedido na Suri: ${err.message}`);
  }

  if (!suriOrder) throw new Error(`Pedido ${suriOrderId} não encontrado na Suri`);

  // A Suri pode retornar { data: {...} } ou o objeto diretamente
  const orderData = suriOrder?.data || suriOrder;
  const items = orderData?.items || orderData?.Items || orderData?.products || orderData?.Products || [];
  if (!items.length) return { action: "skipped", reason: "Pedido sem itens", orderId: suriOrderId };

  const stockResults = [];
  for (const item of items) {
    const productId = String(item.productId || item.ProductId || item.product_id || "");
    const sku       = String(item.sku || item.Sku || item.SKU || "");
    const qty       = parseInt(item.quantity || item.Quantity || item.qty || 1, 10);
    if (!productId || !qty) continue;

    try {
      // Busca variantes do produto na Nuvemshop para encontrar pelo SKU
      const variants = await getProductVariants(store_id, access_token, productId);
      const variant  = Array.isArray(variants)
        ? variants.find(v => String(v.sku) === sku || String(v.id) === sku) || variants[0]
        : null;

      if (!variant) {
        stockResults.push({ productId, sku, status: "variant_not_found" });
        continue;
      }

      const currentStock = variant.stock ?? 0;
      const newStock     = Math.max(0, currentStock - qty);
      await updateVariantStock(store_id, access_token, productId, variant.id, newStock);
      stockResults.push({ productId, sku, variantId: variant.id, previousStock: currentStock, newStock, deducted: currentStock - newStock });
    } catch (err) {
      stockResults.push({ productId, sku, status: "error", error: err.message });
    }
  }

  return { action: "stock_deducted", orderId: suriOrderId, items: stockResults };
}

// POST /sync-catalog
// ════════════════════════════════════════════════════════════════════════════
async function handleSyncCatalog(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", ["POST"]); return res.status(405).end(); }
  const caller = await requireAuth(req, res);
  if (!caller) return;

  const row = await pool.query(
    "SELECT ecommerce_platform, ecommerce_config, chatbot_config, suri_endpoint, suri_token FROM user_integrations WHERE user_id = $1",
    [caller.id]
  ).then(r => r.rows[0]).catch(() => null);

  if (!row) return res.status(404).json({ success: false, message: "Integração não encontrada." });

  const platform = row.ecommerce_platform;
  const ecommerceConfig = row.ecommerce_config || {};
  const chatbotCfg = row.chatbot_config || {};
  const suriEndpoint = row.suri_endpoint || chatbotCfg.endpoint || null;
  const suriToken    = row.suri_token    || chatbotCfg.token    || null;

  if (!platform || !ecommerceConfig.store_id) {
    return res.status(400).json({ success: false, message: "E-commerce não configurado." });
  }
  if (!suriEndpoint || !suriToken) {
    return res.status(400).json({ success: false, message: "Chatbot (Suri) não configurado." });
  }
  if (platform !== "nuvemshop") {
    return res.status(400).json({ success: false, message: `Sincronização ainda não disponível para ${platform}.` });
  }

  const { store_id, access_token } = ecommerceConfig;
  const { fetchCategories: fetchNuvemCategories } = await import("./_lib/ecommerce/nuvemshop/categories.js");
  const { listProducts, getProductVariants } = await import("./_lib/ecommerce/nuvemshop/client.js");
  const { normalizeProduct } = await import("./_lib/ecommerce/nuvemshop/products.js");
  const { syncProduct } = await import("./_lib/chatbot/suri/products.js");
  const { syncCategory, listCategories } = await import("./_lib/chatbot/suri/categories.js");

  // Resolve store mapping
  let resolvedStoreId = null;
  try {
    const mappings = ecommerceConfig._store_mappings ? JSON.parse(ecommerceConfig._store_mappings) : [];
    const match = mappings.find(m => String(m.ecommerceStoreId) === String(store_id));
    if (match) resolvedStoreId = String(match.chatbotStoreId);
  } catch { /* sem mapeamento */ }

  const allResults = [];
  const categoryIdMap = new Map(); // nuvemshop_id → suri_id

  // Helper: executa em paralelo com limite de concorrência
  async function runConcurrent(items, fn, concurrency = 5) {
    const chunks = [];
    for (let i = 0; i < items.length; i += concurrency) chunks.push(items.slice(i, i + concurrency));
    for (const chunk of chunks) await Promise.all(chunk.map(fn));
  }

  // 1. Categorias em paralelo — coleta o mapa nuvemshop_id → suri_id
  try {
    const cats = await fetchNuvemCategories(ecommerceConfig);
    await runConcurrent(cats, async (cat) => {
      try {
        const r = await syncCategory(suriEndpoint, suriToken, cat, resolvedStoreId);
        const action = r?.action || "category_updated";
        if (r?.suriId) categoryIdMap.set(String(cat.id), String(r.suriId));
        allResults.push({ type: action, entity: "category", id: String(cat.id), name: cat.name, storeId: resolvedStoreId });
      } catch (err) {
        allResults.push({ type: "error", entity: "category", id: String(cat.id), name: cat.name, storeId: resolvedStoreId, message: err.message });
      }
    }, 5);
  } catch (err) {
    allResults.push({ type: "error", entity: "category", message: err.message });
  }

  // Se o mapa ficou vazio (ex: categorias já existiam e suriId não veio), busca da Suri
  if (categoryIdMap.size === 0) {
    try {
      const suriCats = await listCategories(suriEndpoint, suriToken);
      for (const c of suriCats) {
        const suriId = String(c.id);
        if (c.externalId) categoryIdMap.set(String(c.externalId), suriId);
        // mapeia também pelo próprio id como chave
        categoryIdMap.set(suriId, suriId);
      }
    } catch { /* ignora */ }
  }

  // 2. Busca todos os produtos paginado, injetando variantes atualizadas em paralelo por batch
  const allRawProducts = [];
  try {
    let page = 1, hasMore = true;
    while (hasMore) {
      const batch = await listProducts(store_id, access_token, { page, per_page: 50 });
      if (!Array.isArray(batch) || batch.length === 0) { hasMore = false; break; }

      // Busca variantes atualizadas de todos os produtos do batch em paralelo
      await Promise.all(batch.map(async (p) => {
        try {
          const variants = await getProductVariants(store_id, access_token, p.id);
          if (Array.isArray(variants) && variants.length > 0) p.variants = variants;
        } catch { /* mantém variants do listProducts */ }
      }));

      for (const raw of batch) allRawProducts.push(raw);
      hasMore = batch.length >= 50;
      page++;
    }
  } catch (err) {
    allResults.push({ type: "error", entity: "product", message: err.message });
  }

  await runConcurrent(allRawProducts, async (raw) => {
    try {
      const normalized = normalizeProduct(raw);
      // Fallback: se o categoryId não está no mapa, tenta usar o ID diretamente
      if (normalized.categoryId && !categoryIdMap.has(String(normalized.categoryId))) {
        categoryIdMap.set(String(normalized.categoryId), String(normalized.categoryId));
      }
      const r = await syncProduct(suriEndpoint, suriToken, normalized, resolvedStoreId, categoryIdMap.size > 0 ? categoryIdMap : null);
      const action = r?.action || "product_updated";
      allResults.push({ type: action, entity: "product", id: String(raw.id), name: normalized.name || String(raw.id), storeId: resolvedStoreId });
    } catch (err) {
      allResults.push({ type: "error", entity: "product", id: String(raw.id), name: raw.name?.pt || String(raw.id), storeId: resolvedStoreId, message: err.message });
    }
  }, 10);

  const summary = {
    categories_created: allResults.filter(r => r.type === "category_created").length,
    categories_updated: allResults.filter(r => r.entity === "category" && r.type !== "error" && r.type !== "category_created").length,
    products_created:   allResults.filter(r => r.type === "product_created").length,
    products_updated:   allResults.filter(r => r.entity === "product" && r.type !== "error" && r.type !== "product_created").length,
    errors:             allResults.filter(r => r.type === "error").length,
  };

  const hasSuccess = (summary.categories_created + summary.categories_updated + summary.products_created + summary.products_updated) > 0;

  return res.status(200).json({
    success: hasSuccess,
    message: `Sincronização concluída: ${summary.categories_created + summary.categories_updated} categoria(s), ${summary.products_created + summary.products_updated} produto(s)${summary.errors > 0 ? `, ${summary.errors} erro(s)` : ""}.`,
    summary,
    results: allResults,
    resolvedStoreId,
    platform,
  });
}