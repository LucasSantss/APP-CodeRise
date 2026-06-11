import pool from "./db.js";

// ─── Normalizers por plataforma ───────────────────────────────────────────────
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
    "order/created":"order.created","order/paid":"order.created","order/updated":"order.created",
    "order/packed":"order.shipped","order/fulfilled":"order.shipped","order/cancelled":"order.cancelled",
    "order/pending":"order.created","order/voided":"order.cancelled",
    "order/custom_fields_updated":"order.created","order/edited":"order.created",
    "fulfillment/updated":"order.shipped","fulfillment_order/status_updated":"order.shipped",
    "fulfillment_order/tracking_event_created":"order.shipped","fulfillment_order/tracking_event_updated":"order.shipped",
    "fulfillment_order/tracking_event_deleted":"order.shipped",
    "product/created":"product.sync","product/updated":"product.sync","product/deleted":"product.sync",
    "product_variant/custom_fields_updated":"product.sync",
    "category/created":"product.sync","category/updated":"product.sync","category/deleted":"product.sync",
    "orders/created":"order.created","orders/paid":"order.created","orders/fulfilled":"order.shipped","orders/cancelled":"order.cancelled",
    "products/created":"product.sync","products/updated":"product.sync",
  };
  const eventType=statusMap[topic]||topic;
  if (eventType==="product.sync") { const p=payload.product||payload; return { eventType, product: p }; }
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
function normalizeOlist(payload) {
  const topic = payload.event || payload.topic || payload.type || "";
  const statusMap = {
    "order_paid":       "order.created",
    "order_created":    "order.created",
    "order_confirmed":  "order.created",
    "order_shipped":    "order.shipped",
    "order_delivered":  "order.shipped",
    "order_cancelled":  "order.cancelled",
    "order_voided":     "order.cancelled",
    "order_refunded":   "order.cancelled",
    "product_created":  "product.sync",
    "product_updated":  "product.sync",
    "product_deleted":  "product.deleted",
    "tag_created":      "category.sync",
    "tag_updated":      "category.sync",
    "tag_deleted":      "category.deleted",
  };
  const eventType = statusMap[topic] || topic;
  if (eventType === "product.sync" || eventType === "product.deleted") {
    const p = payload.product || payload;
    return { eventType, product: p };
  }
  const order = payload.order || payload;
  return {
    eventType,
    orderId:         String(order.code || order.id || ""),
    paymentTracking: order.payment_method || order.payment_type || "",
    logisticStatus:  order.shipping_status || order.status || "shipped",
    totalAmount:     parseFloat(order.total || 0),
    items: (order.items || order.line_items || []).map(i => ({
      productId: String(i.product_id || i.id || ""),
      sku:       String(i.sku || i.variant_sku || ""),
      name:      i.name || i.product_name || "Produto",
      quantity:  parseInt(i.quantity || 1),
      unitPrice: parseFloat(i.price || i.unit_price || 0),
      discount:  parseFloat(i.discount || 0),
      sellerId:  "all",
    })),
    shipping: {
      provider:   order.shipping_method_name || "Entrega",
      type:       1,
      price:      parseFloat(order.shipping_price || 0),
      estimative: "5 dias úteis",
    },
  };
}
export function normalizePayload(platform, payload) {
  switch (platform) {
    case "vtex":        return normalizeVtex(payload);
    case "shopify":     return normalizeShopify(payload);
    case "woocommerce": return normalizeWoocommerce(payload);
    case "nuvemshop":   return normalizeNuvemshop(payload);
    case "tray":        return normalizeTray(payload);
    case "olist":       return normalizeOlist(payload);
    default: return { eventType:payload.type||payload.event||payload.event_type||"desconhecido", orderId:String(payload.order_id||payload.orderId||payload.id||""), paymentTracking:"", logisticStatus:payload.status||"shipped", totalAmount:parseFloat(payload.total||payload.total_price||0), items:payload.items||payload.line_items||[], shipping:{provider:"Entrega",type:1,price:0,estimative:"5 dias úteis"} };
  }
}

// ─── Helpers Suri ─────────────────────────────────────────────────────────────
export async function suriRequest(endpoint, token, method, path, body) {
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

// ─── Processadores de evento ──────────────────────────────────────────────────
export async function processOrderCreated(ep, tk, n) {
  const existing = await findSuriOrder(ep, tk, n.orderId);
  if (existing) { await suriRequest(ep,tk,"POST","/api/shop/orders/paid",{orderId:existing.id||existing.orderId,paymentTracking:n.paymentTracking||""}); return {action:"marked_paid",suriOrderId:existing.id}; }
  const budget={id:String(n.orderId),logistic:{providerId:"001",name:n.shipping.provider||"Entrega",description:"Padrão",type:n.shipping.type||1,price:n.shipping.price||0,minShippingTimeEstimative:n.shipping.estimative||"3 dias úteis",shippingTimeEstimative:n.shipping.estimative||"5 dias úteis"},items:n.items.map(i=>({fromSellerId:i.sellerId||"all",ProductId:String(i.productId||i.id),Sku:String(i.sku||i.productId),Name:i.name,quantity:i.quantity,unitPrice:i.unitPrice,discountAmount:i.discount||0})),errorMessages:[]};
  const created = await suriRequest(ep,tk,"POST","/api/shop/orders/budget",budget);
  const suriOrderId=created?.id||created?.orderId;
  if (suriOrderId) await suriRequest(ep,tk,"POST","/api/shop/orders/paid",{orderId:suriOrderId,paymentTracking:n.paymentTracking||""});
  return {action:"created_and_paid",suriOrderId};
}
export async function processOrderShipped(ep,tk,n) { const ex=await findSuriOrder(ep,tk,n.orderId); if (!ex) throw new Error(`Pedido ${n.orderId} não encontrado na Suri`); const st=mapLogisticStatus(n.logisticStatus); await suriRequest(ep,tk,"POST","/api/shop/orders/logistic",{id:ex.id||ex.orderId,status:st}); return {action:"logistic_updated",suriOrderId:ex.id,status:st}; }
export async function processOrderCancelled(ep,tk,n) { const ex=await findSuriOrder(ep,tk,n.orderId); if (!ex) throw new Error(`Pedido ${n.orderId} não encontrado na Suri`); await suriRequest(ep,tk,"POST","/api/shop/orders/cancel",{orderId:ex.id||ex.orderId}); return {action:"cancelled",suriOrderId:ex.id}; }
export async function processProductSync(ep, tk, n) {
  const { syncProduct } = await import("./chatbot/suri/products.js");
  const { listCategories } = await import("./chatbot/suri/categories.js");
  const { normalizeProduct } = await import("./ecommerce/nuvemshop/products.js");
  const product = n.product ? normalizeProduct(n.product) : null;
  if (!product) throw new Error("Produto não encontrado no payload do webhook");
  const categoryIdMap = new Map();
  try {
    const suriCats = await listCategories(ep, tk);
    for (const c of suriCats) {
      const suriId = String(c.id);
      if (c.externalId) categoryIdMap.set(String(c.externalId), suriId);
      categoryIdMap.set(suriId, suriId);
    }
  } catch {}
  if (product.categoryId && !categoryIdMap.has(String(product.categoryId))) {
    categoryIdMap.set(String(product.categoryId), String(product.categoryId));
  }
  return syncProduct(ep, tk, product, null, categoryIdMap.size > 0 ? categoryIdMap : null);
}

// ─── Processadores de pedido da Suri (chatbot → Nuvemshop) ───────────────────
export async function processSuriOrderPaid(suriEndpoint, suriToken, normalized, userId) {
  const { getProductVariants, updateVariantStock } = await import("./ecommerce/nuvemshop/client.js");
  const intRow = await pool.query("SELECT ecommerce_platform, ecommerce_config FROM user_integrations WHERE user_id = $1", [userId]);
  const integration = intRow.rows[0];
  if (!integration || integration.ecommerce_platform !== "nuvemshop") return { action: "skipped", reason: "E-commerce não é Nuvemshop" };
  const { store_id, access_token } = integration.ecommerce_config || {};
  if (!store_id || !access_token) return { action: "skipped", reason: "Credenciais da Nuvemshop não configuradas" };
  const suriOrderId = normalized.orderId || normalized.suriOrderId;
  if (!suriOrderId) return { action: "skipped", reason: "OrderId não encontrado no payload" };
  const base = suriEndpoint.replace(/\/+$/, "");
  const orderRes = await fetch(`${base}/api/shop/orders/${suriOrderId}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", "Accept": "application/json", "Authorization": `Bearer ${suriToken}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!orderRes.ok) { const errBody = await orderRes.json().catch(() => ({})); throw new Error(`Suri GET /api/shop/orders/${suriOrderId} → HTTP ${orderRes.status}: ${JSON.stringify(errBody).slice(0, 300)}`); }
  const suriOrder = await orderRes.json();
  const orderData = suriOrder?.data || suriOrder;
  const items = orderData?.items || [];
  if (!items.length) return { action: "skipped", reason: "Pedido sem itens", orderId: suriOrderId };
  const stockResults = [];
  for (const item of items) {
    const productId = String(item.providerId || "");
    const sku = String(item.sku || "");
    const qty = Math.round(parseFloat(item.quantity || item.paidQuantity || 1));
    if (!productId || !qty) continue;
    try {
      const variants = await getProductVariants(store_id, access_token, productId);
      const variant = Array.isArray(variants) ? variants.find(v => String(v.sku) === sku) || variants[0] : null;
      if (!variant) { stockResults.push({ productId, sku, status: "variant_not_found" }); continue; }
      const currentStock = variant.stock ?? 0;
      const newStock = Math.max(0, currentStock - qty);
      await updateVariantStock(store_id, access_token, productId, variant.id, newStock);
      stockResults.push({ productId, sku, variantId: variant.id, previousStock: currentStock, newStock, deducted: currentStock - newStock });
    } catch (err) { stockResults.push({ productId, sku, status: "error", error: err.message }); }
  }
  return { action: "stock_deducted", orderId: suriOrderId, items: stockResults };
}
export async function processSuriOrderCancelled(suriEndpoint, suriToken, normalized, userId) {
  const { getProductVariants, updateVariantStock } = await import("./ecommerce/nuvemshop/client.js");
  const intRow = await pool.query("SELECT ecommerce_platform, ecommerce_config FROM user_integrations WHERE user_id = $1", [userId]);
  const integration = intRow.rows[0];
  if (!integration || integration.ecommerce_platform !== "nuvemshop") return { action: "skipped", reason: "E-commerce não é Nuvemshop" };
  const { store_id, access_token } = integration.ecommerce_config || {};
  if (!store_id || !access_token) return { action: "skipped", reason: "Credenciais da Nuvemshop não configuradas" };
  const suriOrderId = normalized.orderId || normalized.suriOrderId;
  if (!suriOrderId) return { action: "skipped", reason: "OrderId não encontrado no payload" };
  const base = suriEndpoint.replace(/\/+$/, "");
  const orderRes = await fetch(`${base}/api/shop/orders/${suriOrderId}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", "Accept": "application/json", "Authorization": `Bearer ${suriToken}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!orderRes.ok) { const errBody = await orderRes.json().catch(() => ({})); throw new Error(`Suri GET /api/shop/orders/${suriOrderId} → HTTP ${orderRes.status}: ${JSON.stringify(errBody).slice(0, 300)}`); }
  const suriOrder = await orderRes.json();
  const orderData = suriOrder?.data || suriOrder;
  const items = orderData?.items || [];
  if (!items.length) return { action: "skipped", reason: "Pedido sem itens", orderId: suriOrderId };
  const stockResults = [];
  for (const item of items) {
    const productId = String(item.providerId || "");
    const sku = String(item.sku || "");
    const qty = Math.round(parseFloat(item.quantity || item.paidQuantity || 1));
    if (!productId || !qty) continue;
    try {
      const variants = await getProductVariants(store_id, access_token, productId);
      const variant = Array.isArray(variants) ? variants.find(v => String(v.sku) === sku) || variants[0] : null;
      if (!variant) { stockResults.push({ productId, sku, status: "variant_not_found" }); continue; }
      const currentStock = variant.stock ?? 0;
      const newStock = currentStock + qty;
      await updateVariantStock(store_id, access_token, productId, variant.id, newStock);
      stockResults.push({ productId, sku, variantId: variant.id, previousStock: currentStock, newStock, returned: qty });
    } catch (err) { stockResults.push({ productId, sku, status: "error", error: err.message }); }
  }
  return { action: "stock_returned", orderId: suriOrderId, items: stockResults };
}


export async function processSuriOrderPaidOlist(suriEndpoint, suriToken, normalized, userId) {
  const { deductStockForOrderItems } = await import("./ecommerce/olist/stock.js");
  const intRow = await pool.query("SELECT ecommerce_platform, ecommerce_config FROM user_integrations WHERE user_id = $1", [userId]);
  const integration = intRow.rows[0];
  if (!integration || integration.ecommerce_platform !== "olist") return { action: "skipped", reason: "E-commerce não é Olist" };
  const { store_url, access_token } = integration.ecommerce_config || {};
  if (!store_url || !access_token) return { action: "skipped", reason: "Credenciais da Olist não configuradas" };
  const suriOrderId = normalized.orderId || normalized.suriOrderId;
  if (!suriOrderId) return { action: "skipped", reason: "OrderId não encontrado no payload" };
  const base = suriEndpoint.replace(/\/+$/, "");
  const orderRes = await fetch(`${base}/api/shop/orders/${suriOrderId}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", "Accept": "application/json", "Authorization": `Bearer ${suriToken}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!orderRes.ok) { const errBody = await orderRes.json().catch(() => ({})); throw new Error(`Suri GET /api/shop/orders/${suriOrderId} → HTTP ${orderRes.status}: ${JSON.stringify(errBody).slice(0, 300)}`); }
  const suriOrder = await orderRes.json();
  const items = (suriOrder?.data || suriOrder)?.items || [];
  if (!items.length) return { action: "skipped", reason: "Pedido sem itens", orderId: suriOrderId };
  const result = await deductStockForOrderItems(
    { store_url, access_token },
    items.map(i => ({ sku: String(i.sku || ""), quantity: Math.round(parseFloat(i.quantity || i.paidQuantity || 1)), name: i.name || "" }))
  );
  return { action: "stock_deducted", orderId: suriOrderId, ...result };
}
export async function processSuriOrderCancelledOlist(suriEndpoint, suriToken, normalized, userId) {
  const { getVariantBySku, updateVariantStock } = await import("./ecommerce/olist/client.js");
  const intRow = await pool.query("SELECT ecommerce_platform, ecommerce_config FROM user_integrations WHERE user_id = $1", [userId]);
  const integration = intRow.rows[0];
  if (!integration || integration.ecommerce_platform !== "olist") return { action: "skipped", reason: "E-commerce não é Olist" };
  const { store_url, access_token } = integration.ecommerce_config || {};
  if (!store_url || !access_token) return { action: "skipped", reason: "Credenciais da Olist não configuradas" };
  const suriOrderId = normalized.orderId || normalized.suriOrderId;
  if (!suriOrderId) return { action: "skipped", reason: "OrderId não encontrado no payload" };
  const base = suriEndpoint.replace(/\/+$/, "");
  const orderRes = await fetch(`${base}/api/shop/orders/${suriOrderId}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", "Accept": "application/json", "Authorization": `Bearer ${suriToken}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!orderRes.ok) { const errBody = await orderRes.json().catch(() => ({})); throw new Error(`Suri GET /api/shop/orders/${suriOrderId} → HTTP ${orderRes.status}: ${JSON.stringify(errBody).slice(0, 300)}`); }
  const suriOrder = await orderRes.json();
  const items = (suriOrder?.data || suriOrder)?.items || [];
  if (!items.length) return { action: "skipped", reason: "Pedido sem itens", orderId: suriOrderId };
  const stockResults = [];
  for (const item of items) {
    const sku = String(item.sku || "");
    const qty = Math.round(parseFloat(item.quantity || item.paidQuantity || 1));
    if (!sku) continue;
    try {
      const variant      = await getVariantBySku(store_url, access_token, sku);
      const currentStock = parseInt(variant.quantity ?? variant.stock ?? 0);
      const newStock     = currentStock + qty;
      await updateVariantStock(store_url, access_token, sku, newStock);
      stockResults.push({ sku, previousStock: currentStock, newStock, returned: qty });
    } catch (err) { stockResults.push({ sku, status: "error", error: err.message }); }
  }
  return { action: "stock_returned", orderId: suriOrderId, items: stockResults };
}

// ─── Handler principal do webhook ────────────────────────────────────────────
export async function handleWebhook(req, res) {
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
  const isViaWebhookToken = integration.webhook_token === token;
  const activePlatform = isViaWebhookToken ? (ecommerce_platform || "ecommerce") : (chatbot_platform || "chatbot");
  const PLATFORM_LABELS = { shopify:"Shopify", woocommerce:"WooCommerce", nuvemshop:"Nuvemshop", vtex:"VTEX", tray:"Tray", suri:"Suri", evolution_api:"Evolution API", kommo:"Kommo", chatbot:"Chatbot", ecommerce:"E-commerce" };
  const platformLabel = PLATFORM_LABELS[activePlatform] || activePlatform;
  let userName = `ID ${user_id}`;
  try { const uRow = await pool.query("SELECT name FROM users WHERE id = $1", [user_id]); if (uRow.rows[0]) userName = uRow.rows[0].name; } catch {}

  let rawPayload = req.body || {};

  // Nuvemshop: busca dados completos + variantes atualizadas
  if (ecommerce_platform === "nuvemshop" && rawPayload.id && rawPayload.event) {
    try {
      const intRow = await pool.query("SELECT ecommerce_config FROM user_integrations WHERE user_id = $1", [user_id]);
      const cfg = intRow.rows[0]?.ecommerce_config || {};
      const { store_id, access_token } = cfg;
      if (store_id && access_token) {
        const headers = { "Content-Type":"application/json", "Authentication":`bearer ${access_token}`, "User-Agent":"CodeRise Integration (suporte@coderise.com.br)" };
        const base = `https://api.tiendanube.com/v1/${store_id}`;
        const ev = rawPayload.event || "";
        let fetchUrl = null;
        if (ev.startsWith("product")) fetchUrl = `${base}/products/${rawPayload.id}`;
        else if (ev.startsWith("order")) fetchUrl = `${base}/orders/${rawPayload.id}`;
        else if (ev.startsWith("category")) fetchUrl = `${base}/categories/${rawPayload.id}`;
        if (fetchUrl) {
          const r = await fetch(fetchUrl, { headers });
          if (r.ok) {
            const fullData = await r.json();
            if (ev.startsWith("product")) {
              let variants = fullData.variants || [];
              try { const vr = await fetch(`${base}/products/${rawPayload.id}/variants`, { headers }); if (vr.ok) { const vd = await vr.json(); if (Array.isArray(vd) && vd.length > 0) variants = vd; } } catch {}
              rawPayload = { ...rawPayload, product: { ...fullData, variants } };
            } else if (ev.startsWith("order")) {
              rawPayload = { ...rawPayload, order: fullData };
            } else {
              rawPayload = { ...rawPayload, ...fullData };
            }
          }
        }
      }
    } catch {}
  }

  let normalized;
  if (!isViaWebhookToken && rawPayload.HookEvent) {
    const suriEventMap = { "OrdersPaid":"order.paid", "OrdersCreated":"order.created", "OrdersCancelled":"order.cancelled", "OrdersCanceled":"order.cancelled", "OrdersShipped":"order.shipped" };
    const displayEventType = suriEventMap[rawPayload.HookEvent] || rawPayload.HookEvent;
    const _isOlist = ecommerce_platform === "olist";
    const routeEventType = displayEventType === "order.cancelled"
      ? (_isOlist ? "order.cancelled.olist" : "order.cancelled.suri")
      : (displayEventType === "order.paid" || displayEventType === "order.created")
      ? (_isOlist ? "order.paid.olist" : "order.created.suri")
      : displayEventType === "order.shipped"
      ? "order.shipped.suri"
      : displayEventType;
    normalized = { eventType: routeEventType, displayEventType, orderId: String(rawPayload.OrderId || rawPayload.Id || ""), suriOrderId: String(rawPayload.Id || "") };
  } else {
    try { normalized = normalizePayload(ecommerce_platform, rawPayload); }
    catch { normalized = { eventType: rawPayload.type||rawPayload.event||"desconhecido", orderId:"", items:[], shipping:{provider:"Entrega",type:1,price:0,estimative:"5 dias úteis"} }; }
  }

  const eventType = normalized.eventType;
  const logEventType = normalized.displayEventType || eventType;
  let webhookId;
  try {
    const webhookSource = isViaWebhookToken ? "ecommerce" : "chatbot";
    const ins = await pool.query("INSERT INTO user_webhooks (user_id, event_type, payload, status, source) VALUES ($1, $2, $3, 'received', $4) RETURNING id", [user_id, logEventType, JSON.stringify(rawPayload), webhookSource]);
    webhookId = ins.rows[0].id;
    await pool.query(`DELETE FROM user_webhooks WHERE user_id=$1 AND id NOT IN (SELECT id FROM user_webhooks WHERE user_id=$1 ORDER BY received_at DESC LIMIT 100)`,[user_id]).catch(()=>{});
  } catch (err) { return res.status(500).json({ success: false, message: "Erro ao salvar: " + err.message }); }

  if (!suri_active || !suri_endpoint || !suri_token) return res.status(200).json({ success:true, message:"Evento registrado. Suri não configurada ou inativa.", event_type:eventType, platform:ecommerce_platform, webhook_id:webhookId });

  try {
    let result;
    switch (eventType) {
      case "order.created":        result = await processOrderCreated(suri_endpoint, suri_token, normalized);  break;
      case "order.shipped":        result = await processOrderShipped(suri_endpoint, suri_token, normalized);  break;
      case "order.cancelled":      result = await processOrderCancelled(suri_endpoint, suri_token, normalized); break;
      case "product.sync":         result = await processProductSync(suri_endpoint, suri_token, normalized);   break;
      case "order.paid":           result = await processSuriOrderPaid(suri_endpoint, suri_token, normalized, user_id); break;
      case "order.cancelled.suri": result = await processSuriOrderCancelled(suri_endpoint, suri_token, normalized, user_id); break;
      case "order.paid.olist":           result = await processSuriOrderPaidOlist(suri_endpoint, suri_token, normalized, user_id); break;
      case "order.cancelled.olist":      result = await processSuriOrderCancelledOlist(suri_endpoint, suri_token, normalized, user_id); break;
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
      const errorTime = new Date().toLocaleString("pt-BR", { timeZone:"America/Sao_Paulo", day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit", second:"2-digit" });
      await pool.query("INSERT INTO notifications (type, title, message, target_role, target_user_id) VALUES ('error', $1, $2, 'user', $3)", [`Erro na integração ${platformLabel}`, `Evento "${eventType || "desconhecido"}" falhou em ${errorTime}.\n\nDetalhe: ${err.message}`, user_id]);
      await pool.query("INSERT INTO notifications (type, title, message, target_role) VALUES ('integration_error', $1, $2, 'admin')", [`Erro de integração — ${platformLabel}`, `Perfil: ${userName}\nPlataforma: ${platformLabel}\nEvento: ${eventType || "desconhecido"}\nHorário: ${errorTime}\n\nDetalhe: ${err.message}`]);
      await pool.query("SELECT pg_notify('notifications_changed', 'new')").catch(() => {});
    } catch {}
    return res.status(200).json({ success:false, message:"Evento registrado mas falhou ao processar na Suri", event_type:eventType, platform:ecommerce_platform, webhook_id:webhookId, error:err.message });
  }
}
