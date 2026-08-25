/**
 * Catch-all das Cloudflare Pages Functions — espelha, rota por rota, o que hoje
 * está espalhado entre vercel.json (rewrites) e api/index.js (router interno).
 * Reaproveita os MESMOS módulos de api/** usados em produção no Vercel (nenhuma
 * lógica de negócio foi duplicada); só a "casca" de entrada/saída muda, via
 * http-adapter.js.
 *
 * Importante: se o path não bater com nenhuma rota de API conhecida, cai em
 * context.next() para deixar o Pages servir o estático/SPA (senão este
 * catch-all quebraria a navegação client-side do React Router).
 */
import { initPool } from "../api/_lib/db.js";
import { toPagesFunction } from "./_lib/http-adapter.js";

import { handleAuth } from "../api/_lib/auth.js";
import { handleChatbot } from "../api/_lib/chatbot.js";
import { handleWebhooks, handleWebhooksPoll } from "../api/_lib/webhooks.js";
import { handleWebhook } from "../api/_lib/webhook-receiver.js";
import { handleRegisterWebhook, handleRegisterChatbotWebhook } from "../api/_lib/register-webhook.js";
import { handleSyncCatalog } from "../api/_lib/sync-catalog.js";
import { handlePlatformSettings } from "../api/_lib/platform-settings.js";
import { handleErrorWebhookSettings } from "../api/_lib/error-webhook.js";
import { handleSetup } from "../api/_lib/setup.js";
import { handleTestSuri } from "../api/_lib/test-suri.js";
import handleTestEcommerce from "../api/_lib/test-ecommerce.js";

// Estes 4 + cron-sync-stores são os que hoje o vercel.json aponta direto para
// arquivos de topo em api/ (não para api/index.js) — ver tabela de "fontes da
// verdade" no plano de migração.
import handleUsers from "../api/users.js";
import handleIntegrations from "../api/integrations.js";
import handleNotifications from "../api/notifications.js";
import handleSyncRules from "../api/sync-rules.js";
import handleCronSyncStores from "../api/cron-sync-stores.js";

function getPath(pathname) {
  return pathname.replace(/\/+$/, "") || "/";
}

const routes = [
  [/^\/auth$/, handleAuth],
  [/^\/chatbot$/, handleChatbot],
  [/^\/webhooks\/poll$/, handleWebhooksPoll],
  [/^\/webhooks$/, handleWebhooks],
  [/^\/webhook$/, handleWebhook],
  [/^\/register-webhook$/, handleRegisterWebhook],
  [/^\/register-chatbot-webhook$/, handleRegisterChatbotWebhook],
  [/^\/sync-catalog$/, handleSyncCatalog],
  [/^\/platform-settings$/, handlePlatformSettings],
  [/^\/error-webhook-settings$/, handleErrorWebhookSettings],
  [/^\/setup$/, handleSetup],
  [/^\/test-suri$/, handleTestSuri],
  [/^\/test-ecommerce$/, handleTestEcommerce],
  [/^\/users(\/.*)?$/, handleUsers],
  [/^\/integrations(\/.*)?$/, handleIntegrations],
  [/^\/notifications(\/.*)?$/, handleNotifications],
  [/^\/sync-rules(\/.*)?$/, handleSyncRules],
  [/^\/cron-sync-stores$/, handleCronSyncStores],
];

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = getPath(url.pathname);

  const match = routes.find(([pattern]) => pattern.test(path));
  if (!match) return context.next();

  initPool(context.env);

  const [, handler] = match;
  return toPagesFunction(handler)(context);
}
