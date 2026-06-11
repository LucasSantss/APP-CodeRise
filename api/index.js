/**
 * api/index.js — Router unificado
 *
 * Estrutura de pastas:
 *   api/
 *   ├── index.js              ← este arquivo (só roteia)
 *   ├── auth.js               ← login / logout / refresh
 *   ├── chatbot.js            ← CRUD configuração chatbot
 *   ├── webhooks.js           ← listagem e long poll de eventos
 *   ├── webhook-receiver.js   ← recebe webhooks (e-commerce + Suri)
 *   ├── register-webhook.js   ← registro automático de webhooks
 *   ├── sync-catalog.js       ← sincronização manual de catálogo
 *   ├── platform-settings.js  ← configurações de plataformas
 *   ├── setup.js              ← criação/migração de tabelas
 *   ├── test-suri.js          ← teste de conexão com Suri
 *   ├── chatbot/
 *   │   └── suri/             ← lib Suri (client, products, categories, orders...)
 *   └── ecommerce/
 *       ├── nuvemshop/        ← lib Nuvemshop
 *       ├── shopify/
 *       ├── woocommerce/
 *       ├── vtex/
 *       └── tray/
 */
import pool        from "./_lib/db.js";
import { setCors } from "./_cors.js";

import { handleAuth }             from "./_lib/auth.js";
import { handleChatbot }          from "./_lib/chatbot.js";
import { handleWebhooks, handleWebhooksPoll } from "./_lib/webhooks.js";
import { handleWebhook }          from "./_lib/webhook-receiver.js";
import { handleRegisterWebhook }  from "./_lib/register-webhook.js";
import { handleSyncCatalog }      from "./_lib/sync-catalog.js";
import { handlePlatformSettings } from "./_lib/platform-settings.js";
import { handleSetup }            from "./_lib/setup.js";
import { handleTestSuri }         from "./_lib/test-suri.js";

// Handlers existentes no projeto (não alterados)
import handleUsers         from "./users.js";
import handleIntegrations  from "./integrations.js";
import handleNotifications from "./notifications.js";
import handleSyncRules     from "./sync-rules.js";
import handleTestEcommerce from "./_lib/test-ecommerce.js";

// ─── helper ──────────────────────────────────────────────────────────────────
function getPath(req) {
  return (req.url || "").split("?")[0].replace(/^\/api/, "");
}

// ─── migração lazy ───────────────────────────────────────────────────────────
pool.query(`ALTER TABLE user_webhooks ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'ecommerce'`).catch(() => {});

// ════════════════════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  if (setCors(req, res)) return;

  const path = getPath(req);

  // ── Novos handlers separados ─────────────────────────────────────────────
  if (path === "/auth")                                                    return handleAuth(req, res);
  if (path === "/chatbot"           || path.startsWith("/chatbot?"))       return handleChatbot(req, res);
  if (path === "/webhooks"          || path.startsWith("/webhooks?"))      return handleWebhooks(req, res);
  if (path === "/webhooks/poll"     || path.startsWith("/webhooks/poll?")) return handleWebhooksPoll(req, res);
  if (path === "/webhook"           || path.startsWith("/webhook?"))       return handleWebhook(req, res);
  if (path === "/register-webhook"  || path.startsWith("/register-webhook?")) return handleRegisterWebhook(req, res);
  if (path === "/sync-catalog"      || path.startsWith("/sync-catalog?"))  return handleSyncCatalog(req, res);
  if (path === "/platform-settings" || path.startsWith("/platform-settings?")) return handlePlatformSettings(req, res);
  if (path === "/setup"             || path.startsWith("/setup?"))         return handleSetup(req, res);
  if (path === "/test-suri"         || path.startsWith("/test-suri?"))     return handleTestSuri(req, res);
  if (path === "/test-ecommerce"    || path.startsWith("/test-ecommerce?")) return handleTestEcommerce(req, res);

  // ── Handlers originais do projeto ────────────────────────────────────────
  if (path.startsWith("/users"))         return handleUsers(req, res);
  if (path.startsWith("/integrations"))  return handleIntegrations(req, res);
  if (path.startsWith("/notifications")) return handleNotifications(req, res);
  if (path.startsWith("/sync-rules"))    return handleSyncRules(req, res);

  return res.status(404).json({ success: false, message: `Rota não encontrada: ${path}` });
}
