/**
 * Tests for prop-firm-cookie-refresh-service.ts (Track 7)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn(),
  },
}));
vi.mock("../db/schema.js", () => ({
  auditLog: { _tableName: "audit_log" },
}));
vi.mock("../services/alert-service.js", () => ({
  AlertFactory: {
    notifyCookieRefreshFailed: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Playwright mock
vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn().mockImplementation(async () => ({
      newContext: vi.fn().mockResolvedValue({
        newPage: vi.fn().mockResolvedValue({
          goto: vi.fn().mockResolvedValue(undefined),
          fill: vi.fn().mockResolvedValue(undefined),
          click: vi.fn().mockResolvedValue(undefined),
          waitForNavigation: vi.fn().mockResolvedValue(undefined),
          waitForTimeout: vi.fn().mockResolvedValue(undefined),
        }),
        cookies: vi.fn().mockResolvedValue([
          { name: "session", value: "abc123", domain: "example.com" },
        ]),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));

import { db } from "../db/index.js";
import { AlertFactory } from "../services/alert-service.js";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("prop-firm-cookie-refresh-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db as typeof db & { insert: ReturnType<typeof vi.fn> }).insert.mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    });
    process.env["MFFU_USERNAME"] = "test@mffu.com";
    process.env["MFFU_PASSWORD"] = "password123";
    process.env["TOPSTEP_USERNAME"] = "test@topstep.com";
    process.env["TOPSTEP_PASSWORD"] = "topsteppass";
  });

  afterEach(() => {
    delete process.env["MFFU_USERNAME"];
    delete process.env["MFFU_PASSWORD"];
    delete process.env["TOPSTEP_USERNAME"];
    delete process.env["TOPSTEP_PASSWORD"];
    vi.clearAllMocks();
  });

  it("service module is importable", async () => {
    const mod = await import("../services/prop-firm-cookie-refresh-service.js");
    expect(typeof mod.runPropFirmCookieRefresh).toBe("function");
    expect(typeof mod.getCookieStatus).toBe("function");
  });

  it("refreshes both MFFU and Topstep when credentials configured", async () => {
    const { runPropFirmCookieRefresh } = await import("../services/prop-firm-cookie-refresh-service.js");
    const report = await runPropFirmCookieRefresh();
    expect(report.results.length).toBe(2);
    expect(report.results.every((r) => r.firmId === "mffu" || r.firmId === "topstep")).toBe(true);
  });

  it("writes audit_log per firm", async () => {
    const insertValues = vi.fn().mockResolvedValue([]);
    (db as typeof db & { insert: ReturnType<typeof vi.fn> }).insert.mockReturnValue({ values: insertValues });
    const { runPropFirmCookieRefresh } = await import("../services/prop-firm-cookie-refresh-service.js");
    await runPropFirmCookieRefresh();
    expect(insertValues).toHaveBeenCalledTimes(2);
  });

  it("skips MFFU when credentials not configured", async () => {
    delete process.env["MFFU_USERNAME"];
    delete process.env["MFFU_PASSWORD"];
    const { runPropFirmCookieRefresh } = await import("../services/prop-firm-cookie-refresh-service.js");
    const report = await runPropFirmCookieRefresh();
    const mffu = report.results.find((r) => r.firmId === "mffu");
    expect(mffu?.status).toBe("skipped_no_credentials");
  });

  it("per-firm independence: one firm failing does not block the other", async () => {
    // Make chromium.launch throw for MFFU's turn (first call)
    // @ts-ignore — playwright not installed in dev; imported dynamically only in cookie-refresh service (W0.3 2026-06-22)
    const { chromium } = await import("playwright");
    let launchCallCount = 0;
    (chromium.launch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      launchCallCount++;
      if (launchCallCount === 1) {
        throw new Error("Playwright launch failed for MFFU");
      }
      return {
        newContext: vi.fn().mockResolvedValue({
          newPage: vi.fn().mockResolvedValue({
            goto: vi.fn().mockResolvedValue(undefined),
            fill: vi.fn().mockResolvedValue(undefined),
            click: vi.fn().mockResolvedValue(undefined),
            waitForNavigation: vi.fn().mockResolvedValue(undefined),
            waitForTimeout: vi.fn().mockResolvedValue(undefined),
          }),
          cookies: vi.fn().mockResolvedValue([{ name: "session", value: "ok" }]),
        }),
        close: vi.fn().mockResolvedValue(undefined),
      };
    });

    const { runPropFirmCookieRefresh } = await import("../services/prop-firm-cookie-refresh-service.js");
    const report = await runPropFirmCookieRefresh();
    const mffu = report.results.find((r) => r.firmId === "mffu");
    const topstep = report.results.find((r) => r.firmId === "topstep");
    expect(mffu?.status).toBe("failed");
    expect(topstep?.status).toBe("refreshed");
  });

  it("fires alert for each firm that fails", async () => {
    // @ts-ignore — playwright not installed in dev; imported dynamically only in cookie-refresh service (W0.3 2026-06-22)
    const { chromium } = await import("playwright");
    (chromium.launch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Playwright not available"));
    const { runPropFirmCookieRefresh } = await import("../services/prop-firm-cookie-refresh-service.js");
    await runPropFirmCookieRefresh();
    expect(AlertFactory.notifyCookieRefreshFailed).toHaveBeenCalledWith("mffu", expect.any(String));
    expect(AlertFactory.notifyCookieRefreshFailed).toHaveBeenCalledWith("topstep", expect.any(String));
  });

  it("getCookieStatus returns tracked status", async () => {
    const { getCookieStatus } = await import("../services/prop-firm-cookie-refresh-service.js");
    const status = getCookieStatus();
    expect(status).toHaveProperty("mffu");
    expect(status).toHaveProperty("topstep");
  });

  it("bypasses pipeline gate (always runs)", async () => {
    // No isPipelineActive import in the service — verify run completes
    const { runPropFirmCookieRefresh } = await import("../services/prop-firm-cookie-refresh-service.js");
    const report = await runPropFirmCookieRefresh();
    expect(report.results).toHaveLength(2);
  });
});
