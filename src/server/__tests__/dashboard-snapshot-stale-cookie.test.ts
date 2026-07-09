/**
 * broker/cookie F-1 (deep-scan re-verify 2026-07-06) — dashboard-snapshot stale-cookie detection.
 *
 * Makes the F-1 fix DURABLE (the grader verified it only via a throwaway script). captureOneFirm is private,
 * so we drive it through the exported runDashboardSnapshots(). Playwright is NOT installed on the tower —
 * captureOneFirm lazy-`await import("playwright")`s it — so we register a VIRTUAL mock of the whole
 * chromium → browser → context → page chain and steer page.$ / page.url per scenario.
 *
 * Contract pinned:
 *   - password field present after goto  → status "error"/"stale_cookie_redirected_to_login", NO screenshot,
 *     dashboard_snapshot.capture_failed audit (a stale login screen must NEVER be stored as payout evidence).
 *   - login-path URL (no password field) → same error path.
 *   - clean session                      → status "captured", screenshot fired, dashboard_snapshot.captured audit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockPage, chromiumMock } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const page: any = {
    setDefaultTimeout: vi.fn(),
    goto: vi.fn().mockResolvedValue(undefined),
    $: vi.fn().mockResolvedValue(null),
    url: vi.fn().mockReturnValue("https://trader.topstep.com/dashboard"),
    screenshot: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const context: any = {
    addCookies: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const browser: any = {
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const chromium = { launch: vi.fn().mockResolvedValue(browser) };
  return { mockPage: page, chromiumMock: chromium };
});

vi.mock("playwright", () => ({ chromium: chromiumMock }));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: vi.fn().mockResolvedValue(undefined),
}));

import { runDashboardSnapshots } from "../services/dashboard-snapshot-service.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";

const TOPSTEP_COOKIES = JSON.stringify([
  { name: "sid", value: "x", domain: ".topstep.com", path: "/" },
]);

describe("dashboard-snapshot stale-cookie detection (broker/cookie F-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Only topstep is credentialed → mffu returns skipped_no_credentials and stays out of the way.
    process.env.TOPSTEP_SESSION_COOKIES = TOPSTEP_COOKIES;
    delete process.env.MFFU_SESSION_COOKIES;
    // Keep the (only-created-on-capture) snapshot dir out of the repo.
    process.env.FIRM_SNAPSHOT_DIR =
      "C:/Users/tonio/AppData/Local/Temp/claude/C--Users-tonio-Projects-trading-forge/ef89d0ed-e571-4520-bbe0-a0421b425faa/scratchpad/firm-snapshots-test";
    mockPage.$.mockResolvedValue(null);
    mockPage.url.mockReturnValue("https://trader.topstep.com/dashboard");
  });

  afterEach(() => {
    delete process.env.TOPSTEP_SESSION_COOKIES;
  });

  it("password field after goto → error 'stale_cookie_redirected_to_login', NO screenshot, capture_failed audit", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockPage.$.mockImplementation(async (sel: string) => (sel.includes("password") ? {} : null));

    const results = await runDashboardSnapshots();
    const topstep = results.find((r) => r.firmId === "topstep");

    expect(topstep?.status).toBe("error");
    expect(topstep?.errorMessage).toBe("stale_cookie_redirected_to_login");
    expect(mockPage.screenshot).not.toHaveBeenCalled(); // must NOT store the login screen
    expect(insertAuditRowSafe).toHaveBeenCalledWith(
      expect.objectContaining({ action: "dashboard_snapshot.capture_failed", entityId: "topstep" }),
    );
  });

  it("login-path URL (no password field) → also 'stale_cookie_redirected_to_login'", async () => {
    mockPage.$.mockResolvedValue(null);
    mockPage.url.mockReturnValue("https://trader.topstep.com/login");

    const results = await runDashboardSnapshots();
    const topstep = results.find((r) => r.firmId === "topstep");

    expect(topstep?.status).toBe("error");
    expect(topstep?.errorMessage).toBe("stale_cookie_redirected_to_login");
    expect(mockPage.screenshot).not.toHaveBeenCalled();
  });

  it("clean session → captured + screenshot fired + dashboard_snapshot.captured audit", async () => {
    mockPage.$.mockResolvedValue(null); // no password field; targeted selectors also resolve null (skipped)
    mockPage.url.mockReturnValue("https://trader.topstep.com/dashboard");

    const results = await runDashboardSnapshots();
    const topstep = results.find((r) => r.firmId === "topstep");

    expect(topstep?.status).toBe("captured");
    expect(mockPage.screenshot).toHaveBeenCalled();
    expect(insertAuditRowSafe).toHaveBeenCalledWith(
      expect.objectContaining({ action: "dashboard_snapshot.captured", entityId: "topstep" }),
    );
  });
});
