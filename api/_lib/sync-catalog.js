import pool from "./db.js";
import { requireAuth } from "../_auth.js";

const SUPPORTED_PLATFORMS = ["nuvemshop", "olist", "shopify", "woocommerce", "tray", "vtex"];

async function resolvePlatformAdapters(platform, ecommerceConfig) {
  switch (platform) {
    case "nuvemshop": {
      const client = await import("./ecommerce/nuvemshop/client.js");
      const { normalizeProduct } = await import("./ecommerce/nuvemshop/products.js");
      const { fetchCategories } = await import("./ecommerce/nuvemshop/categories.js");
      const { store_id, access_token } = ecommerceConfig;
      return {
        listProductsFn: (params) => client.listProducts(store_id, access_token, params),
        getVariantsFn: (productId) => client.getProductVariants(store_id, access_token, productId),
        normalizeProduct,
        fetchCategories: () => fetchCategories({ store_id, access_token }),
        storeKeyValid: !!store_id && !!access_token,
      };
    }
    case "olist": {
      const client = await import("./ecommerce/olist/client.js");
      const { normalizeProduct } = await import("./ecommerce/olist/products.js");
      const { fetchCategories } = await import("./ecommerce/olist/categories.js");
      const { store_url, access_token } = ecommerceConfig;
      return {
        listProductsFn: (params) => client.listProducts(store_url, access_token, params),
        getVariantsFn: (productId) => client.getProductVariants(store_url, access_token, productId),
        normalizeProduct,
        fetchCategories: () => fetchCategories({ store_url, access_token }),
        storeKeyValid: !!store_url && !!access_token,
      };
    }
    case "shopify": {
      const client = await import("./ecommerce/shopify/client.js");
      const { normalizeProduct } = await import("./ecommerce/shopify/products.js");
      const { fetchCategories } = await import("./ecommerce/shopify/categories.js");
      const { store_url, api_token, api_version } = ecommerceConfig;
      return {
        listProductsFn: (params) => client.listProducts(store_url, api_token, params, api_version),
        getVariantsFn: null,
        normalizeProduct: (raw) => normalizeProduct(raw, store_url),
        fetchCategories: () => fetchCategories({ store_url, api_token, api_version }),
        storeKeyValid: !!store_url && !!api_token,
      };
    }
    case "woocommerce": {
      const client = await import("./ecommerce/woocommerce/client.js");
      const { normalizeProduct } = await import("./ecommerce/woocommerce/products.js");
      const { fetchCategories } = await import("./ecommerce/woocommerce/categories.js");
      const { site_url, consumer_key, consumer_secret } = ecommerceConfig;
      return {
        listProductsFn: (params) => client.listProducts(site_url, consumer_key, consumer_secret, params),
        getVariantsFn: async (productId) => {
          try {
            return await client.getProductVariations(site_url, consumer_key, consumer_secret, productId, { per_page: 100 });
          } catch { return []; }
        },
        normalizeProduct: (raw, variants) => normalizeProduct(raw, variants || []),
        fetchCategories: () => fetchCategories({ site_url, consumer_key, consumer_secret }),
        storeKeyValid: !!site_url && !!consumer_key && !!consumer_secret,
      };
    }
    case "tray": {
      const client = await import("./ecommerce/tray/client.js");
      const { normalizeProduct } = await import("./ecommerce/tray/products.js");
      const { fetchCategories } = await import("./ecommerce/tray/categories.js");
      const { api_address, access_token } = ecommerceConfig;
      return {
        listProductsFn: async (params) => {
          const data = await client.listProducts(api_address, access_token, params);
          const items = data.Products || data.products || [];
          return items.map(i => i.Product || i);
        },
        getVariantsFn: (productId) => client.getProductVariants(api_address, access_token, productId).catch(() => []),
        normalizeProduct: (raw, variants) => normalizeProduct({ ...raw, Variants: variants || raw.Variants }),
        fetchCategories: () => fetchCategories({ api_address, access_token }),
        storeKeyValid: !!api_address && !!access_token,
      };
    }
    case "vtex": {
      const client = await import("./ecommerce/vtex/client.js");
      const { normalizeProduct } = await import("./ecommerce/vtex/products.js");
      const { fetchCategories } = await import("./ecommerce/vtex/categories.js");
      const { account_name, app_key, app_token } = ecommerceConfig;
      return {
        listProductsFn: async () => [],
        getVariantsFn: null,
        normalizeProduct,
        fetchCategories: () => fetchCategories({ account_name, app_key, app_token }),
        storeKeyValid: !!account_name && !!app_key && !!app_token,
      };
    }
    default:
      return null;
  }
}

export async function handleSyncCatalog(req, res) {
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

  if (!platform || !SUPPORTED_PLATFORMS.includes(platform))
    return res.status(400).json({ success: false, message: `Sincronização ainda não disponível para ${platform || "(nenhuma plataforma)"}.` });
  if (!suriEndpoint || !suriToken)
    return res.status(400).json({ success: false, message: "Chatbot (Suri) não configurado." });

  const adapters = await resolvePlatformAdapters(platform, ecommerceConfig);
  if (!adapters) return res.status(400).json({ success: false, message: `Sincronização ainda não disponível para ${platform}.` });
  if (!adapters.storeKeyValid) return res.status(400).json({ success: false, message: "E-commerce não configurado corretamente — credenciais ausentes." });
  if (platform === "vtex") return res.status(400).json({ success: false, message: "Sincronização em lote da VTEX ainda não disponível — utilize o fluxo de webhooks para sincronização incremental por produto." });

  const { syncProduct } = await import("./chatbot/suri/products.js");
  const { syncCategory, listCategories } = await import("./chatbot/suri/categories.js");

  // Resolve store mapping: ecommerce store_id → suri storeId
  let resolvedStoreId = null;
  try {
    const mappings = ecommerceConfig._store_mappings ? JSON.parse(ecommerceConfig._store_mappings) : [];
    const storeKeyForMapping = ecommerceConfig.store_id || ecommerceConfig.store_url || ecommerceConfig.account_name || "";
    const match = mappings.find(m => String(m.ecommerceStoreId) === String(storeKeyForMapping));
    if (match) resolvedStoreId = String(match.chatbotStoreId);
  } catch { /* sem mapeamento */ }

  const allResults = [];
  const categoryIdMap = new Map();

  async function runConcurrent(items, fn, concurrency = 5) {
    const chunks = [];
    for (let i = 0; i < items.length; i += concurrency) chunks.push(items.slice(i, i + concurrency));
    for (const chunk of chunks) await Promise.all(chunk.map(fn));
  }

  // 1. Categorias em paralelo — coleta mapa platform_id → suri_id
  // DEBUG: expõe estrutura bruta do GET /api/shop/categories para diagnóstico
  try {
    const { request: suriRequest } = await import("./chatbot/suri/client.js");
    const rawCatsResponse = await suriRequest(suriEndpoint, suriToken, "GET", "/api/shop/categories", undefined).catch(e => ({ _error: e.message }));
    allResults.push({ type: "info", entity: "debug", message: `GET /api/shop/categories → ${JSON.stringify(rawCatsResponse).slice(0, 500)}` });
  } catch (e) {
    allResults.push({ type: "info", entity: "debug", message: `GET /api/shop/categories falhou: ${e.message}` });
  }

  try {
    const cats = await adapters.fetchCategories();
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

  if (categoryIdMap.size === 0) {
    try {
      const suriCats = await listCategories(suriEndpoint, suriToken);
      for (const c of suriCats) {
        const suriId = String(c.id);
        if (c.externalId) categoryIdMap.set(String(c.externalId), suriId);
        categoryIdMap.set(suriId, suriId);
      }
    } catch { /* ignora */ }
  }

  // 2. Produtos paginados com variantes atualizadas em paralelo por batch
  const allRawProducts = [];
  try {
    let page = 1, hasMore = true;
    while (hasMore) {
      const batch = await adapters.listProductsFn({ page, per_page: 50, limit: 50 });
      if (!Array.isArray(batch) || batch.length === 0) { hasMore = false; break; }

      if (adapters.getVariantsFn) {
        await Promise.all(batch.map(async (p) => {
          try {
            const variants = await adapters.getVariantsFn(p.id || p.Id);
            if (Array.isArray(variants) && variants.length > 0) p._fetchedVariants = variants;
          } catch { /* mantém variants já presentes no produto, se houver */ }
        }));
      }

      for (const raw of batch) allRawProducts.push(raw);
      hasMore = batch.length >= 50;
      page++;
      if (page > 200) break;
    }
  } catch (err) {
    allResults.push({ type: "error", entity: "product", message: err.message });
  }

  // Sincroniza produtos em paralelo (10 por vez)
  await runConcurrent(allRawProducts, async (raw) => {
    try {
      const normalized = adapters.normalizeProduct(raw, raw._fetchedVariants);
      if (normalized.categoryId && !categoryIdMap.has(String(normalized.categoryId))) {
        categoryIdMap.set(String(normalized.categoryId), String(normalized.categoryId));
      }
      const r = await syncProduct(suriEndpoint, suriToken, normalized, resolvedStoreId, categoryIdMap.size > 0 ? categoryIdMap : null);
      const action = r?.action || "product_updated";
      allResults.push({ type: action, entity: "product", id: String(raw.id || raw.Id), name: normalized.name || String(raw.id || raw.Id), storeId: resolvedStoreId });
    } catch (err) {
      const rawName = raw.name ?? raw.Name;
      const nameStr = typeof rawName === 'string' ? rawName : (rawName?.pt || rawName?.es || rawName?.en || Object.values(rawName || {})[0] || String(raw.id || raw.Id));
      allResults.push({ type: "error", entity: "product", id: String(raw.id || raw.Id), name: nameStr, storeId: resolvedStoreId, message: err.message });
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
