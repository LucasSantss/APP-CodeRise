import { beforeEach, describe, expect, it, vi } from "vitest";

const { notifyAdminIntegrationError, queryMock } = vi.hoisted(() => ({
  notifyAdminIntegrationError: vi.fn(),
  queryMock: vi.fn(),
}));

vi.mock("../../api/_lib/error-webhook.js", () => ({
  notifyAdminIntegrationError,
}));

vi.mock("../../api/_lib/db.js", () => ({
  default: { query: queryMock },
  checkDb: vi.fn(),
}));

vi.mock("../../api/_auth.js", () => ({
  requireAuth: vi.fn(),
  getUserByTokenString: vi.fn(),
}));

import { syncCatalogForIntegrationRow } from "../../api/_lib/sync-catalog.js";
import { normalizePayload } from "../../api/_lib/webhook-receiver.js";

describe("syncCatalogForIntegrationRow", () => {
  beforeEach(() => {
    notifyAdminIntegrationError.mockReset();
    queryMock.mockReset();
    queryMock.mockResolvedValue({ rows: [] });
  });

  it("emite uma notificação quando a sincronização falha logo no início", async () => {
    const result = await syncCatalogForIntegrationRow({
      user_id: 42,
      ecommerce_platform: "unknown",
      ecommerce_config: {},
      chatbot_config: {},
      suri_endpoint: null,
      suri_token: null,
    });

    expect(result.success).toBe(false);
    expect(notifyAdminIntegrationError).toHaveBeenCalledWith(
      expect.stringContaining("Sincronização"),
      expect.any(String),
      expect.objectContaining({
        platform: "unknown",
        userId: 42,
      })
    );
  });

  it("mapeia os webhooks da Olist para tipos internos preservando o evento original para logs", () => {
    const cases = [
      { event: "prices-changed", expectedEventType: "product.sync", expectedDisplay: "prices-changed" },
      { event: "stocks-changed", expectedEventType: "product.sync", expectedDisplay: "stocks-changed" },
      { event: "product-activated", expectedEventType: "product.sync", expectedDisplay: "product-activated" },
      { event: "product-changed", expectedEventType: "product.sync", expectedDisplay: "product-changed" },
      { event: "order-canceled", expectedEventType: "order.cancelled", expectedDisplay: "order-canceled" },
      { event: "order-confirmed", expectedEventType: "order.created", expectedDisplay: "order-confirmed" },
      { event: "order-received", expectedEventType: "order.created", expectedDisplay: "order-received" },
      { event: "order-sent", expectedEventType: "order.shipped", expectedDisplay: "order-sent" },
    ];

    for (const testCase of cases) {
      const result = normalizePayload("olist", { event: testCase.event, product: { id: "123" } });
      expect(result.eventType).toBe(testCase.expectedEventType);
      expect(result.displayEventType).toBe(testCase.expectedDisplay);
    }
  });
});
