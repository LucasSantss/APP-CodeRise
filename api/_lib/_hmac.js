import crypto from "crypto";

/**
 * Valida assinatura HMAC do webhook por plataforma.
 * Retorna { valid: true } ou { valid: false, reason: "..." }
 */
export function validateWebhookSignature(platform, req, ecomConfig) {
  const cfg = ecomConfig || {};

  switch (platform) {
    case "shopify": {
      const secret = cfg.webhook_secret || cfg.shared_secret || cfg.client_secret;
      if (!secret) return { valid: true, skipped: true };
      const received = req.headers["x-shopify-hmac-sha256"] || "";
      if (!received) return { valid: false, reason: "Header X-Shopify-Hmac-Sha256 ausente" };
      const expected = crypto.createHmac("sha256", secret)
        .update(JSON.stringify(req.body || {}), "utf8").digest("base64");
      if (!crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected)))
        return { valid: false, reason: "Assinatura Shopify inválida" };
      return { valid: true };
    }
    case "woocommerce": {
      const secret = cfg.webhook_secret || cfg.consumer_secret;
      if (!secret) return { valid: true, skipped: true };
      const received = req.headers["x-wc-webhook-signature"] || "";
      if (!received) return { valid: false, reason: "Header X-WC-Webhook-Signature ausente" };
      const expected = crypto.createHmac("sha256", secret)
        .update(JSON.stringify(req.body || {}), "utf8").digest("base64");
      if (!crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected)))
        return { valid: false, reason: "Assinatura WooCommerce inválida" };
      return { valid: true };
    }
    case "nuvemshop": {
      const secret = cfg.webhook_secret;
      if (!secret) return { valid: true, skipped: true };
      const received = req.headers["x-linkedstore-token"] || req.headers["x-tiendanube-token"] || req.query?.token || "";
      if (received !== secret) return { valid: false, reason: "Token Nuvemshop inválido" };
      return { valid: true };
    }
    default:
      return { valid: true, skipped: true };
  }
}

export function rejectIfInvalidSignature(platform, req, res, ecomConfig) {
  const result = validateWebhookSignature(platform, req, ecomConfig);
  if (!result.valid) {
    console.warn(`[hmac] Assinatura inválida para ${platform}: ${result.reason}`);
    res.status(401).json({ success: false, message: "Webhook signature inválida", reason: result.reason });
    return true;
  }
  return false;
}
