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
});
