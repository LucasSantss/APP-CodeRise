/**
 * api/_hmac.js — Validação de assinatura HMAC dos webhooks
 *
 * Cada plataforma usa um mecanismo diferente:
 *   - Shopify:     X-Shopify-Hmac-Sha256 (base64, corpo raw)
 *   - WooCommerce: X-WC-Webhook-Signature (base64, corpo raw)
 *   - Nuvemshop:   X-Linkedstore-Token (token estático simples)
 *   - VTEX:        sem assinatura padrão (usa token na URL)
 *   - Tray:        sem assinatura padrão (usa token na URL)
 *
 * Como ler o body raw no Vercel:
 *   O Vercel parseia o body antes de chegar no handler. Para validar HMAC
 *   precisamos do body RAW (antes do JSON.parse). A solução é ler do
 *   req.body e reserializar — não é idêntico ao original mas funciona
 *   para payloads JSON simples. Para máxima fidelidade, configurar
 *   bodyParser: false no vercel.json e ler manualmente.
 */

import crypto from "crypto";

/**
 * Valida a assinatura HMAC do webhook.
 * Retorna { valid: true } ou { valid: false, reason: "..." }
 *
 * @param {string} platform    "shopify" | "woocommerce" | "nuvemshop" | outros
 * @param {object} req         Request do Vercel (headers + body já parseado)
 * @param {object} ecomConfig  ecommerce_config do usuário (contém o secret)
 */
export function validateWebhookSignature(platform, req, ecomConfig) {
  const cfg = ecomConfig || {};

  switch (platform) {

    case "shopify": {
      const secret = cfg.webhook_secret || cfg.shared_secret || cfg.client_secret;
      if (!secret) return { valid: true, skipped: true, reason: "Sem secret configurado" };

      const receivedSig = req.headers["x-shopify-hmac-sha256"] || "";
      if (!receivedSig) return { valid: false, reason: "Header X-Shopify-Hmac-Sha256 ausente" };

      // Reserializa o body para gerar a assinatura
      const rawBody = JSON.stringify(req.body || {});
      const expected = crypto
        .createHmac("sha256", secret)
        .update(rawBody, "utf8")
        .digest("base64");

      if (!crypto.timingSafeEqual(Buffer.from(receivedSig), Buffer.from(expected))) {
        return { valid: false, reason: "Assinatura Shopify inválida" };
      }
      return { valid: true };
    }

    case "woocommerce": {
      const secret = cfg.webhook_secret || cfg.consumer_secret;
      if (!secret) return { valid: true, skipped: true, reason: "Sem secret configurado" };

      const receivedSig = req.headers["x-wc-webhook-signature"] || "";
      if (!receivedSig) return { valid: false, reason: "Header X-WC-Webhook-Signature ausente" };

      const rawBody = JSON.stringify(req.body || {});
      const expected = crypto
        .createHmac("sha256", secret)
        .update(rawBody, "utf8")
        .digest("base64");

      if (!crypto.timingSafeEqual(Buffer.from(receivedSig), Buffer.from(expected))) {
        return { valid: false, reason: "Assinatura WooCommerce inválida" };
      }
      return { valid: true };
    }

    case "nuvemshop": {
      // Nuvemshop usa um token de segurança estático configurado na loja
      const secret = cfg.webhook_secret;
      if (!secret) return { valid: true, skipped: true, reason: "Sem secret configurado" };

      const receivedToken =
        req.headers["x-linkedstore-token"] ||
        req.headers["x-tiendanube-token"] ||
        req.query?.token ||
        "";

      if (receivedToken !== secret) {
        return { valid: false, reason: "Token Nuvemshop inválido" };
      }
      return { valid: true };
    }

    case "vtex":
    case "tray":
    default:
      // Plataformas sem assinatura — autenticação via webhook_token na URL
      return { valid: true, skipped: true, reason: `${platform} sem assinatura HMAC` };
  }
}

/**
 * Middleware helper: rejeita a request se a assinatura for inválida.
 * Retorna true se deve interromper o processamento (inválido).
 */
export function rejectIfInvalidSignature(platform, req, res, ecomConfig) {
  const result = validateWebhookSignature(platform, req, ecomConfig);
  if (!result.valid) {
    console.warn(`[hmac] Assinatura inválida para ${platform}: ${result.reason}`);
    res.status(401).json({ success: false, message: "Webhook signature inválida", reason: result.reason });
    return true;
  }
  return false;
}
