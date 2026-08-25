/**
 * Worker dedicado só ao cron de sincronização automática de catálogo — roda
 * via Cron Trigger nativo da Cloudflare, substituindo o agendador externo
 * (cron-job.org) usado hoje no Vercel. Reaproveita a mesma lógica de
 * api/cron-sync-stores.js (runDueCatalogSyncs), sem duplicar nada.
 */
import { initPool } from "../api/_lib/db.js";
import { runDueCatalogSyncs } from "../api/cron-sync-stores.js";

export default {
  async scheduled(event, env, ctx) {
    initPool(env);
    try {
      const result = await runDueCatalogSyncs();
      console.log("[cron-worker] sincronização concluída:", JSON.stringify(result));
    } catch (err) {
      console.error("[cron-worker] erro na sincronização:", err.message);
    }
  },

  // Fallback simples pra permitir `wrangler dev` local e um health-check manual.
  async fetch() {
    return new Response("cron-worker ok — use `wrangler dev --test-scheduled` para simular o Cron Trigger", { status: 200 });
  },
};
