/**
 * api/index.js — Router unificado
 */
import pool        from "./db.js";
import { setCors } from "./_cors.js";

import { handleAuth }             from "./auth.js";
import { handleChatbot }          from "./chatbot.js";
import { handleWebhooks, handleWebhooksPoll } from "./webhooks.js";
import { handleWebhook }          from "./webhook-receiver.js";
import { handleRegisterWebhook }  from "./register-webhook.js";
import { handleSyncCatalog }      from "./sync-catalog.js";
import { handlePlatformSettings } from "./platform-settings.js";
import { handleSetup }            from "./setup.js";
import { handleTestSuri }         from "./test-suri.js";
import { handleTenants }          from "./tenants.js";
import { handleQueue }            from "./queue.js";
import { handleCleanup }          from "./cleanup.js";

import handleUsers         from "./users.js";
import handleIntegrations  from "./integrations.js";
import handleNotifications from "./notifications.js";
import handleSyncRules     from "./sync-rules.js";
import handleTestEcommerce from "./test-ecommerce.js";

function getPath(req) {
  return (req.url || "").split("?")[0].replace(/^\/api/, "");
}

pool.query(`ALTER TABLE user_webhooks ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'ecommerce'`).catch(() => {});

export default async function handler(req, res) {
  if (setCors(req, res)) return;
  const path = getPath(req);

  if (path === "/tenants"          || path.startsWith("/tenants?"))           return handleTenants(req, res);
  if (path === "/queue"            || path.startsWith("/queue"))              return handleQueue(req, res);
  if (path === "/cleanup"          || path.startsWith("/cleanup?"))           return handleCleanup(req, res);
  if (path === "/auth")                                                        return handleAuth(req, res);
  if (path === "/chatbot"          || path.startsWith("/chatbot?"))           return handleChatbot(req, res);
  if (path === "/webhooks"         || path.startsWith("/webhooks?"))          return handleWebhooks(req, res);
  if (path === "/webhooks/poll"    || path.startsWith("/webhooks/poll?"))     return handleWebhooksPoll(req, res);
  if (path === "/webhook"          || path.startsWith("/webhook?"))           return handleWebhook(req, res);
  if (path === "/register-webhook" || path.startsWith("/register-webhook?")) return handleRegisterWebhook(req, res);
  if (path === "/sync-catalog"     || path.startsWith("/sync-catalog?"))     return handleSyncCatalog(req, res);
  if (path === "/platform-settings"|| path.startsWith("/platform-settings?"))return handlePlatformSettings(req, res);
  if (path === "/setup"            || path.startsWith("/setup?"))             return handleSetup(req, res);
  if (path === "/test-suri"        || path.startsWith("/test-suri?"))         return handleTestSuri(req, res);
  if (path === "/test-ecommerce"   || path.startsWith("/test-ecommerce?"))    return handleTestEcommerce(req, res);
  if (path.startsWith("/users"))         return handleUsers(req, res);
  if (path.startsWith("/integrations"))  return handleIntegrations(req, res);
  if (path.startsWith("/notifications")) return handleNotifications(req, res);
  if (path.startsWith("/sync-rules"))    return handleSyncRules(req, res);

  return res.status(404).json({ success: false, message: `Rota não encontrada: ${path}` });
}
