import pool from "./db.js";
import { requireAuth } from "./_auth.js";

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

  if (!platform || !ecommerceConfig.store_id)
    return res.status(400).json({ success: false, message: "E-commerce não configurado." });
  if (!suriEndpoint || !suriToken)
    return res.status(400).json({ success: false, message: "Chatbot (Suri) não configurado." });
  if (platform !== "nuvemshop")
    return res.status(400).json({ success: false, message: `Sincronização ainda não disponível para ${platform}.` });

  const { store_id, access_token } = ecommerceConfig;
  const { fetchCategories: fetchNuvemCategories } = await import("./ecommerce/nuvemshop/categories.js");
  const { listProducts, getProductVariants }       = await import("./ecommerce/nuvemshop/client.js");
  const { normalizeProduct }                       = await import("./ecommerce/nuvemshop/products.js");
  const { syncProduct }                            = await import("./chatbot/suri/products.js");
  const { syncCategory, listCategories }           = await import("./chatbot/suri/categories.js");

  // Resolve store mapping: ecommerce store_id → suri storeId
  let resolvedStoreId = null;
  try {
    const mappings = ecommerceConfig._store_mappings ? JSON.parse(ecommerceConfig._store_mappings) : [];
    const match = mappings.find(m => String(m.ecommerceStoreId) === String(store_id));
    if (match) resolvedStoreId = String(match.chatbotStoreId);
  } catch { /* sem mapeamento */ }

  const allResults = [];
  const categoryIdMap = new Map(); // nuvemshop_id → suri_id

  async function runConcurrent(items, fn, concurrency = 5) {
    const chunks = [];
    for (let i = 0; i < items.length; i += concurrency) chunks.push(items.slice(i, i + concurrency));
    for (const chunk of chunks) await Promise.all(chunk.map(fn));
  }

  // 1. Categorias em paralelo — coleta mapa nuvemshop_id → suri_id
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

  // Se mapa vazio, busca categorias da Suri pelo externalId
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
      const batch = await listProducts(store_id, access_token, { page, per_page: 50 });
      if (!Array.isArray(batch) || batch.length === 0) { hasMore = false; break; }
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

  // Sincroniza produtos em paralelo (10 por vez)
  await runConcurrent(allRawProducts, async (raw) => {
    try {
      const normalized = normalizeProduct(raw);
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
