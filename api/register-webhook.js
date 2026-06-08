import pool from "./db.js";
import { requireAuth } from "./_auth.js";

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
    "app/uninstalled","app/suspended","app/resumed",
    "category/created","category/updated","category/deleted",
    "order/created","order/updated","order/paid","order/packed",
    "order/fulfilled","order/cancelled","order/custom_fields_updated",
    "order/edited","order/pending","order/voided",
    "product/created","product/updated","product/deleted",
    "product_variant/custom_fields_updated",
    "domain/updated",
    "order_custom_field/created","order_custom_field/updated","order_custom_field/deleted",
    "product_variant_custom_field/created","product_variant_custom_field/updated","product_variant_custom_field/deleted",
    "fulfillment/updated",
    "fulfillment_order/status_updated","fulfillment_order/tracking_event_created",
    "fulfillment_order/tracking_event_updated","fulfillment_order/tracking_event_deleted",
    "location/created","location/updated","location/deleted",
  ];
  const results=[];
  for (const event of events) {
    const r=await fetch(`${base}/webhooks`,{method:"POST",headers,body:JSON.stringify({event,url:webhookUrl})});
    const data=await r.json().catch(()=>({}));
    if (!r.ok) { const alreadyExists=r.status===422&&JSON.stringify(data).toLowerCase().includes("already"); results.push({event,status:alreadyExists?"already_exists":"error",detail:data.description||data}); }
    else { results.push({event,status:"created",id:data.id}); }
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

export async function handleRegisterWebhook(req, res) {
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
