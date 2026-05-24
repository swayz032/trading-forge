/**
 * wave23h-c2-multi-firm.test.ts — Wave 23H Fix 2
 *
 * Verifies that Layer 7 (C2 Firm Suspension) in kill-switch.ts checks ALL
 * enabled firms from broker_accounts, not just PRIMARY_PROP_FIRM_ID.
 *
 * Cases:
 *   1. One of 3 enabled firms suspended → l7Halted=true, overall_halted=true
 *   2. No firms suspended → l7Halted=false
 *   3. Empty broker_accounts result → l7Halted=false (no firms to check)
 *   4. DB error → l7Halted=true (fail-CLOSED)
 *   5. Audit row written for each evaluation (both success and failure paths)
 *   6. All 3 firms checked when all enabled (dedup: multiple accounts per firm)
 *
 * Regression: before this fix, Layer 7 only checked process.env.PRIMARY_PROP_FIRM_ID
 * (defaulting to "mffu"), leaving Topstep and Tradeify unprotected.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks (hoisted) ──────────────────────────────────────────────────────────

// Mutable broker_accounts rows — tests override this per scenario
let _brokerAccountRows: Array<{ firmId: string }> = [];
let _brokerAccountsThrow = false;

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockImplementation(() => {
          if (_brokerAccountsThrow) {
            // thenable that rejects → simulates DB error for broker_accounts query
            return {
              then(
                _resolve: (v: unknown[]) => unknown,
                reject?: (err: unknown) => unknown,
              ) {
                const err = new Error("DB connection lost");
                if (reject) return reject(err);
                return Promise.reject(err);
              },
              limit: vi.fn().mockRejectedValue(new Error("DB connection lost")),
            };
          }
          return {
            // Direct-await path: broker_accounts rows
            then(
              resolve: (v: unknown[]) => unknown,
              reject?: (err: unknown) => unknown,
            ) {
              return Promise.resolve(_brokerAccountRows).then(resolve, reject);
            },
            // .limit() path: system_state PAPER row
            limit: vi.fn().mockResolvedValue([
              {
                productionMode: "PAPER",
                killReason: null,
                setBy: "operator",
                setAt: new Date("2026-05-20T00:00:00Z"),
              },
            ]),
          };
        }),
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      })),
    })),
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
  // paperSessions required so eq(paperSessions.status, "active") in L2/L3 does not throw
  // with "Cannot read property 'status' of undefined" → which makes L2/L3 fail-CLOSED
  // causing overall_halted=true even when no firms are suspended (Wave 24 fix).
  paperSessions: { id: "id", firmId: "firm_id", status: "status", dailyPnlBreakdown: "daily_pnl_breakdown", currentEquity: "current_equity", realizedPeakEquity: "realized_peak_equity" },
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

vi.mock("../services/exchange-status-service.js", () => ({
  isExchangeHalted: vi.fn().mockReturnValue(false),
}));

// isFirmSuspended is the main subject — overridden per test
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

// Mock firm-config so the dynamic import in L2/L3 does not fail in the test environment.
// The actual getFirmAccount values don't matter for Layer 7 tests — the mock returns null
// (unknown firm) so L2/L3 always skip without halting (Wave 24 fix).
vi.mock("../../shared/firm-config.js", () => ({
  getFirmAccount: vi.fn().mockReturnValue(null),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { killSwitch } from "../production/kill-switch.js";
import { logger } from "../lib/logger.js";
import { isFirmSuspended } from "../services/prop-firm-health-service.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";

// ─── Tests ────────────────────────────────────────────────────────────────────

const THREE_FIRMS = [
  { firmId: "topstep" },
  { firmId: "mffu" },
  { firmId: "tradeify" },
];

describe("Wave 23H Fix 2 — C2 Firm Suspension Layer 7 multi-firm", () => {
  beforeEach(() => {
    killSwitch._invalidateCacheForTests();
    vi.clearAllMocks();
    _brokerAccountRows = [];
    _brokerAccountsThrow = false;
  });

  afterEach(() => {
    killSwitch._invalidateCacheForTests();
  });

  // ── 1. One of 3 firms suspended → l7Halted=true ───────────────────────────
  it("Layer 7: mffu suspended among 3 enabled firms → l7Halted=true, overall_halted=true", async () => {
    _brokerAccountRows = [...THREE_FIRMS];
    vi.mocked(isFirmSuspended).mockImplementation((firmId) => firmId === "mffu");

    const report = await killSwitch.getKillSwitchStatus();
    const layer7 = report.layers.find((l) => l.layer === 7)!;

    expect(layer7.halted).toBe(true);
    expect(layer7.reason).toMatch(/mffu/);
    expect(report.overall_halted).toBe(true);
  });

  // ── 2. No firms suspended → l7Halted=false ───────────────────────────────
  it("Layer 7: 3 enabled firms, none suspended → l7Halted=false", async () => {
    _brokerAccountRows = [...THREE_FIRMS];
    vi.mocked(isFirmSuspended).mockReturnValue(false);

    const report = await killSwitch.getKillSwitchStatus();
    const layer7 = report.layers.find((l) => l.layer === 7)!;

    expect(layer7.halted).toBe(false);
    expect(report.overall_halted).toBe(false);
  });

  // ── 3. Empty firm list → l7Halted=false (no firms to check) ──────────────
  it("Layer 7: empty broker_accounts → l7Halted=false (nothing to suspend)", async () => {
    _brokerAccountRows = [];
    vi.mocked(isFirmSuspended).mockReturnValue(false);

    const report = await killSwitch.getKillSwitchStatus();
    const layer7 = report.layers.find((l) => l.layer === 7)!;

    expect(layer7.halted).toBe(false);
    expect(vi.mocked(isFirmSuspended)).not.toHaveBeenCalled();
  });

  // ── 4. DB error → l7Halted=true (fail-CLOSED) ────────────────────────────
  it("Layer 7: DB error on broker_accounts query → l7Halted=true (fail-CLOSED)", async () => {
    _brokerAccountsThrow = true;

    const report = await killSwitch.getKillSwitchStatus();
    const layer7 = report.layers.find((l) => l.layer === 7)!;

    expect(layer7.halted).toBe(true);
    expect(report.overall_halted).toBe(true);
  });

  // ── 5a. DB error → logger.error ──────────────────────────────────────────
  it("Layer 7: DB error logs at error level with fail-closed message", async () => {
    _brokerAccountsThrow = true;

    await killSwitch.getKillSwitchStatus();

    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining("C2 multi-firm suspension check FAILED"),
    );
  });

  // ── 5b. DB error → audit row with status=failure ─────────────────────────
  it("Layer 7: DB error inserts audit_log row with action=kill_switch.c2_multi_firm_check, status=failure", async () => {
    _brokerAccountsThrow = true;

    await killSwitch.getKillSwitchStatus();

    expect(vi.mocked(insertAuditRow)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "kill_switch.c2_multi_firm_check",
        status: "failure",
        result: expect.objectContaining({ halted: true, eval_failed: true }),
      }),
    );
  });

  // ── 5c. Success path → audit row with status=success ─────────────────────
  it("Layer 7: success path inserts audit_log row with action=kill_switch.c2_multi_firm_check, status=success", async () => {
    _brokerAccountRows = [...THREE_FIRMS];
    vi.mocked(isFirmSuspended).mockReturnValue(false);

    await killSwitch.getKillSwitchStatus();

    expect(vi.mocked(insertAuditRow)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "kill_switch.c2_multi_firm_check",
        status: "success",
        input: expect.objectContaining({ firms_checked: expect.any(Array) }),
        result: expect.objectContaining({ suspended_firms: [], halted: false }),
      }),
    );
  });

  // ── 6. Dedup: 2 accounts per firm → each firm checked once ───────────────
  it("Layer 7: duplicate firmIds in broker_accounts are deduplicated before calling isFirmSuspended", async () => {
    // Two Topstep accounts and two MFFU accounts
    _brokerAccountRows = [
      { firmId: "topstep" },
      { firmId: "topstep" },
      { firmId: "mffu" },
      { firmId: "mffu" },
    ];
    vi.mocked(isFirmSuspended).mockReturnValue(false);

    await killSwitch.getKillSwitchStatus();

    // isFirmSuspended should be called once per unique firmId, not once per account
    const calls = vi.mocked(isFirmSuspended).mock.calls.map(([id]) => id);
    expect(calls).toHaveLength(2);
    expect(calls).toContain("topstep");
    expect(calls).toContain("mffu");
  });

  // ── 7. Topstep suspended (not mffu) → still halts ────────────────────────
  it("Layer 7: Topstep suspended (MFFU healthy) → l7Halted=true", async () => {
    _brokerAccountRows = [...THREE_FIRMS];
    vi.mocked(isFirmSuspended).mockImplementation((firmId) => firmId === "topstep");

    const report = await killSwitch.getKillSwitchStatus();
    const layer7 = report.layers.find((l) => l.layer === 7)!;

    expect(layer7.halted).toBe(true);
    expect(layer7.reason).toMatch(/topstep/);
  });

  // ── 8. isFirmSuspended checked for all firms, not just PRIMARY_PROP_FIRM_ID ──
  it("Layer 7: all firms from broker_accounts are checked, not just PRIMARY_PROP_FIRM_ID env var", async () => {
    // Set env var to only mffu — but Topstep and Tradeify should still be checked
    const originalEnv = process.env["PRIMARY_PROP_FIRM_ID"];
    process.env["PRIMARY_PROP_FIRM_ID"] = "mffu";

    _brokerAccountRows = [...THREE_FIRMS];
    vi.mocked(isFirmSuspended).mockReturnValue(false);

    await killSwitch.getKillSwitchStatus();

    const checkedFirms = vi.mocked(isFirmSuspended).mock.calls.map(([id]) => id);
    expect(checkedFirms).toContain("topstep");
    expect(checkedFirms).toContain("tradeify");

    // Restore env
    if (originalEnv === undefined) {
      delete process.env["PRIMARY_PROP_FIRM_ID"];
    } else {
      process.env["PRIMARY_PROP_FIRM_ID"] = originalEnv;
    }
  });
});
