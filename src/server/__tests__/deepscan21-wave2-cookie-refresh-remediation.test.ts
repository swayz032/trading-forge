/**
 * Deep-Scan #21 Wave 2 — Fix 2: prop-firm-cookie-refresh-service.ts Playwright
 * auto-remediation regression test.
 *
 * Band F of deep-scan #21 found that a missing-Playwright ImportError went
 * straight to "mark cookie stale + fire a daily Discord alert" with ZERO
 * remediation attempt (~L237-263 pre-fix). This test pins the fix: before
 * falling back to alert-only, the service now makes exactly ONE bounded
 * attempt per process to run `npx playwright install chromium`, and:
 *
 *   - never throws into the refresh loop (fully fail-soft)
 *   - runs the install command AT MOST ONCE per process, even across both
 *     firms (MFFU + Topstep) in the same sweep
 *   - emits an audit row for the remediation attempt AND its outcome
 *   - retries the refresh once on install success; on failure (either the
 *     install command itself fails, or the module still doesn't resolve
 *     after a "successful" install) falls through to the pre-existing
 *     alert-only path unchanged
 *
 * "playwright" genuinely is not an installed dependency in this repo (no
 * entry in package.json, nothing under node_modules/playwright — verified
 * during Wave 2 triage), so these tests do NOT mock the "playwright"
 * specifier at all: the real dynamic `import("playwright")` fails on its own,
 * exercising the exact same code path production hits when the package or
 * its browser binary goes missing. Only `node:child_process` is mocked, to
 * control whether the install command "succeeds" or "fails" without actually
 * shelling out to npx in the test suite.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
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
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
}));

// Control the install-command outcome per test via this mutable holder —
// vi.mock factories are hoisted and evaluated once, so the mock implementation
// itself must read from a variable that tests can mutate afterward.
const execFileMock = vi.fn(
  (_file: string, _args: string[], _options: unknown, callback: (err: Error | null, stdout?: string, stderr?: string) => void) => {
    callback(new Error("default mock: not configured — see beforeEach"));
  },
);

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => (execFileMock as unknown as (...a: unknown[]) => void)(...args),
}));

// ─── Test setup ───────────────────────────────────────────────────────────────

describe("Deep-Scan #21 Wave 2 Fix 2 — Playwright one-time auto-remediation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules(); // fresh module instance per test so the one-time-per-process guard resets
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
  });

  it("attempts remediation exactly once per process even though both firms hit the missing-playwright path", async () => {
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback(new Error("npx playwright install chromium failed: ENOENT"));
    });

    const { runPropFirmCookieRefresh } = await import("../services/prop-firm-cookie-refresh-service.js");
    const report = await runPropFirmCookieRefresh();

    // Both firms hit the missing-playwright path (real "playwright" import
    // fails in this environment), but the install command must fire only once.
    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock.mock.calls[0][0]).toBe("npx");
    expect(execFileMock.mock.calls[0][1]).toEqual(["playwright", "install", "chromium"]);

    expect(report.results.every((r) => r.status === "skipped_playwright_unavailable")).toBe(true);
  });

  it("falls through to the existing alert-only path when the install command fails", async () => {
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback(new Error("npx playwright install chromium failed: network unreachable"));
    });

    const { insertAuditRow } = await import("../lib/audit-log-helper.js");
    const { AlertFactory } = await import("../services/alert-service.js");
    const { runPropFirmCookieRefresh } = await import("../services/prop-firm-cookie-refresh-service.js");

    const report = await runPropFirmCookieRefresh();

    const mffu = report.results.find((r) => r.firmId === "mffu");
    expect(mffu?.status).toBe("skipped_playwright_unavailable");

    const auditActions = (insertAuditRow as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[0] as { action: string }).action);
    expect(auditActions).toContain("prop_firm.cookie_refresh_playwright_remediation_attempted");
    expect(auditActions).toContain("prop_firm.cookie_refresh_playwright_remediation_failed");
    expect(auditActions).not.toContain("prop_firm.cookie_refresh_playwright_remediation_succeeded");

    // Existing alert-only behavior is preserved unchanged.
    expect(AlertFactory.notifyCookieRefreshFailed).toHaveBeenCalledWith(
      "mffu",
      expect.stringContaining("playwright_unavailable"),
    );
  });

  it("retries once after a successful install command, then falls through to alert-only if the module still doesn't resolve", async () => {
    // The install command "succeeds" (exit 0 — callback with no error), but
    // the real "playwright" npm package is still not installed in this repo,
    // so the post-remediation import retry genuinely fails too. This is the
    // realistic case where `npx playwright install chromium` only ever
    // downloaded browser binaries and the package was never a declared
    // dependency in the first place.
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback(null, "", "");
    });

    const { insertAuditRow } = await import("../lib/audit-log-helper.js");
    const { runPropFirmCookieRefresh } = await import("../services/prop-firm-cookie-refresh-service.js");

    const report = await runPropFirmCookieRefresh();

    expect(execFileMock).toHaveBeenCalledTimes(1); // still only one install attempt this process
    expect(report.results.every((r) => r.status === "skipped_playwright_unavailable")).toBe(true);

    const auditActions = (insertAuditRow as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[0] as { action: string }).action);
    expect(auditActions).toContain("prop_firm.cookie_refresh_playwright_remediation_attempted");
    expect(auditActions).toContain("prop_firm.cookie_refresh_playwright_remediation_succeeded");
  });

  it("never throws into the refresh loop even if the remediation helper itself errors unexpectedly", async () => {
    execFileMock.mockImplementation(() => {
      // Simulate execFile throwing synchronously (never invoking the callback) —
      // the remediation path must still be fully fail-soft.
      throw new Error("synchronous execFile explosion");
    });

    const { runPropFirmCookieRefresh } = await import("../services/prop-firm-cookie-refresh-service.js");

    const report = await runPropFirmCookieRefresh();
    expect(report.results).toHaveLength(2);
    expect(report.results.every((r) => r.status === "skipped_playwright_unavailable")).toBe(true);

    // A second sweep in the same process must also complete without throwing —
    // proving the earlier synchronous explosion didn't corrupt the one-time
    // guard into some broken half-attempted state that would hang future ticks.
    const secondReport = await runPropFirmCookieRefresh();
    expect(secondReport.results).toHaveLength(2);
  });
});
