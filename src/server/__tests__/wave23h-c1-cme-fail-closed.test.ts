/**
 * wave23h-c1-cme-fail-closed.test.ts — Wave 23H Fix 1
 *
 * Verifies that Layer 6 (C1 CME Outage) in kill-switch.ts is fail-CLOSED:
 * when isExchangeHalted("CME") throws an exception, the layer must:
 *   1. Set l6Halted = true (block entries, not allow them through)
 *   2. Call logger.error (not warn)
 *   3. Insert an audit_log row with action = kill_switch.c1_cme_outage_eval_failed
 *   4. Broadcast SSE event kill_switch:c1_cme_eval_failed
 *   5. Report overall_halted = true in getKillSwitchStatus()
 *
 * Regression: before this fix, the catch block set l6Halted = false (fail-open),
 * which allowed entries during a CME poller crash — the opposite of safe behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks (hoisted) ──────────────────────────────────────────────────────────

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          // Thenable: direct await returns [] (broker_accounts path)
          then(
            resolve: (v: unknown[]) => unknown,
            reject?: (err: unknown) => unknown,
          ) {
            return Promise.resolve([]).then(resolve, reject);
          },
          // .limit() path: returns system_state PAPER row
          limit: vi.fn().mockResolvedValue([
            {
              productionMode: "PAPER",
              killReason: null,
              setBy: "operator",
              setAt: new Date("2026-05-20T00:00:00Z"),
            },
          ]),
        }),
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([{ id: "test-id" }]),
    }),
  },
}));

vi.mock("../db/schema.js", () => ({
  systemState: { id: "system_state" },
  auditLog: { action: "audit_log" },
  weeklyDriftReports: { severity: "severity", reportWeek: "report_week", ranAt: "ran_at" },
  brokerAccounts: { firmId: "firm_id", enabled: "enabled" },
  ProductionMode: undefined,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col, _val) => `eq(${String(_val)})`),
  desc: vi.fn(() => "desc"),
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../services/alert-service.js", () => ({
  AlertFactory: { systemError: vi.fn() },
}));

// Layer 6 subject under test: isExchangeHalted will be overridden per-test
vi.mock("../services/exchange-status-service.js", () => ({
  isExchangeHalted: vi.fn().mockReturnValue(false),
}));

vi.mock("../services/prop-firm-health-service.js", () => ({
  isFirmSuspended: vi.fn().mockReturnValue(false),
}));

vi.mock("../lib/network-failover.js", () => ({
  isConnectivityDegraded: vi.fn().mockReturnValue(false),
}));

vi.mock("../services/macro-gate-service.js", () => ({
  evaluateMacroGates: vi.fn().mockResolvedValue({ crisisGateTriggered: false }),
}));

vi.mock("../services/windows-health-check-service.js", () => ({
  runPreTradingDayHealthCheck: vi.fn().mockResolvedValue({ status: "healthy" }),
}));

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { killSwitch } from "../production/kill-switch.js";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../lib/logger.js";
import { isExchangeHalted } from "../services/exchange-status-service.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Wave 23H Fix 1 — C1 CME Outage Layer 6 fail-CLOSED", () => {
  beforeEach(() => {
    killSwitch._invalidateCacheForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    killSwitch._invalidateCacheForTests();
  });

  // ── 1. Exception → l6Halted = true (fail-CLOSED) ──────────────────────────
  it("Layer 6: isExchangeHalted() throw → l6Halted=true, overall_halted=true", async () => {
    vi.mocked(isExchangeHalted).mockImplementation(() => {
      throw new Error("CME poller crashed: connection refused");
    });

    const report = await killSwitch.getKillSwitchStatus();

    const layer6 = report.layers.find((l) => l.layer === 6);
    expect(layer6).toBeDefined();
    expect(layer6!.halted).toBe(true);
    expect(report.overall_halted).toBe(true);
  });

  // ── 2. Exception → logger.error called (not warn) ─────────────────────────
  it("Layer 6: exception logs at error level (not warn)", async () => {
    vi.mocked(isExchangeHalted).mockImplementation(() => {
      throw new Error("CME poller crashed");
    });

    await killSwitch.getKillSwitchStatus();

    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining("C1 CME outage eval FAILED"),
    );
    // Must NOT downgrade to warn
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("C1"),
    );
  });

  // ── 3. Exception → audit_log row inserted ─────────────────────────────────
  it("Layer 6: exception inserts audit_log row with action=kill_switch.c1_cme_outage_eval_failed", async () => {
    const cmeErr = new Error("exchange-status-service import failed");
    vi.mocked(isExchangeHalted).mockImplementation(() => {
      throw cmeErr;
    });

    await killSwitch.getKillSwitchStatus();

    expect(vi.mocked(insertAuditRow)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "kill_switch.c1_cme_outage_eval_failed",
        entityType: "system",
        status: "failure",
        input: expect.objectContaining({
          error_message: cmeErr.message,
          layer: 6,
        }),
        result: expect.objectContaining({ l6Halted: true }),
      }),
    );
  });

  // ── 4. Exception → SSE event broadcast ───────────────────────────────────
  it("Layer 6: exception broadcasts SSE kill_switch:c1_cme_eval_failed", async () => {
    const cmeErr = new Error("isExchangeHalted threw unexpectedly");
    vi.mocked(isExchangeHalted).mockImplementation(() => {
      throw cmeErr;
    });

    await killSwitch.getKillSwitchStatus();

    expect(vi.mocked(broadcastSSE)).toHaveBeenCalledWith(
      "kill_switch:c1_cme_eval_failed",
      expect.objectContaining({
        error_message: cmeErr.message,
        layer: 6,
        halted: true,
      }),
    );
  });

  // ── 5. Normal path: no exception → l6Halted follows isExchangeHalted() ───
  it("Layer 6: nominal path — no exception, isExchangeHalted=false → l6Halted=false", async () => {
    vi.mocked(isExchangeHalted).mockReturnValue(false);

    const report = await killSwitch.getKillSwitchStatus();
    const layer6 = report.layers.find((l) => l.layer === 6)!;

    expect(layer6.halted).toBe(false);
    expect(vi.mocked(insertAuditRow)).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "kill_switch.c1_cme_outage_eval_failed" }),
    );
    expect(vi.mocked(broadcastSSE)).not.toHaveBeenCalledWith(
      "kill_switch:c1_cme_eval_failed",
      expect.anything(),
    );
  });

  // ── 6. Normal path: isExchangeHalted=true → halted (existing behavior) ───
  it("Layer 6: nominal path — isExchangeHalted=true → l6Halted=true", async () => {
    vi.mocked(isExchangeHalted).mockReturnValue(true);

    const report = await killSwitch.getKillSwitchStatus();
    const layer6 = report.layers.find((l) => l.layer === 6)!;

    expect(layer6.halted).toBe(true);
    expect(report.overall_halted).toBe(true);
  });
});
