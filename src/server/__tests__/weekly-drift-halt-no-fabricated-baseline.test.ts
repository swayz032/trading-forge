/**
 * CRITICAL safety finding (telemetry-honesty-safety-adjacent, 2026-07-17):
 * weekly-drift-halt-service.ts::checkStrategyDrift() used to fabricate an
 * all-zero baseline (`Array.from({length:10}, () => 0)`, "using zero mean
 * (conservative)") whenever real baseline data was missing (no completed
 * backtest, or a backtest whose resultExtras lacked a usable daily-return
 * series), and fed that MADE-UP baseline straight into computeZScore().
 *
 * A data-missing condition is not evidence the strategy has zero expected
 * daily P&L — but the fabricated baseline was indistinguishable from a real
 * one to the z-score math, so ANY sufficiently negative (or positive) live
 * P&L run could synthesize a z-score that crosses Z_SCORE_HALT_THRESHOLD and
 * fires killSwitch.setMode("HALT", ...) — a GLOBAL production halt — off a
 * number that was never a real measurement.
 *
 * This suite proves: when the baseline is unavailable, the drift check now
 * SKIPS for that cycle (outcome="insufficient_data") — killSwitch.setMode()
 * is never called — and a durable "baseline unavailable" audit row is
 * written instead of a silent log line.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockSetMode = vi.fn().mockResolvedValue(undefined);
const mockGetCurrentState = vi.fn().mockResolvedValue({ production_mode: "ACTIVE", kill_reason: null });

vi.mock("../production/kill-switch.js", () => ({
  killSwitch: {
    setMode: mockSetMode,
    getCurrentState: mockGetCurrentState,
    isHaltedForProduction: vi.fn().mockResolvedValue(false),
  },
}));

const mockInsertAuditRow = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: mockInsertAuditRow,
  insertAuditRowSafe: vi.fn().mockResolvedValue(true),
}));

const mockNotifyCritical = vi.fn();
vi.mock("../services/notification-service.js", () => ({
  notifyCritical: mockNotifyCritical,
  notifyWarning: vi.fn(),
  notifyInfo: vi.fn(),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// DB mock — configured per test
const mockDbSelect = vi.fn();
vi.mock("../db/index.js", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
  },
}));

vi.mock("../db/schema.js", () => ({
  strategies: { id: "id", name: "name", lifecycleState: "lifecycle_state" },
  paperTrades: { pnl: "pnl", exitTime: "exit_time", sessionId: "session_id" },
  paperSessions: { id: "id", strategyId: "strategy_id" },
  backtests: { strategyId: "strategy_id", status: "status", resultExtras: "result_extras", createdAt: "created_at" },
}));

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeTrades(pnls: number[]): Array<{ pnl: string; exitTime: Date }> {
  // Spread across distinct days so daily-bucket aggregation doesn't collapse
  // all trades into a single bucket (irrelevant to MIN_OBSERVATIONS, which
  // counts raw trades, but keeps the fixture realistic).
  return pnls.map((pnl, i) => ({
    pnl: String(pnl),
    exitTime: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
  }));
}

const STRATEGY_ID = "strat-no-baseline";
const STRATEGY_NAME = "orb_mes_5m";

/**
 * Wires the 4-query sequence checkStrategyDrift() makes:
 *   1. strategies list                              → .where() awaited directly
 *   2. paperSessions for the strategy                → .where() awaited directly
 *   3. paperTrades (live 7d returns)                 → .where() awaited directly
 *   4. backtests (baseline)                           → .where().orderBy().limit()
 */
function wireQueries(liveTrades: Array<{ pnl: string; exitTime: Date }>, backtestRows: unknown[]) {
  let callCount = 0;
  mockDbSelect.mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve([{ id: STRATEGY_ID, name: STRATEGY_NAME }]);
        if (callCount === 2) return Promise.resolve([{ id: "sess-1" }]);
        if (callCount === 3) return Promise.resolve(liveTrades);
        // callCount 4: backtests — has .orderBy().limit()
        return {
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(backtestRows),
          }),
        };
      }),
    }),
  }));
}

describe("weekly-drift-halt-service: no fabricated zero baseline (CRITICAL safety fix)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetMode.mockResolvedValue(undefined);
    mockGetCurrentState.mockResolvedValue({ production_mode: "ACTIVE", kill_reason: null });
    mockInsertAuditRow.mockResolvedValue(undefined);
  });

  it("no completed backtest at all + strongly negative live P&L → skips (insufficient_data), NEVER halts", async () => {
    // 7 live trades, all deeply negative — under the OLD fabricated-zero-baseline
    // logic this would synthesize a large negative z-score (observed mean << 0,
    // baseline mean fabricated to exactly 0) and cross the 2.0 threshold, firing
    // a GLOBAL production HALT off data that was never real.
    const liveTrades = makeTrades([-800, -750, -900, -820, -770, -810, -790]);
    wireQueries(liveTrades, [] /* no completed backtest → baselineDaily stays empty */);

    const { runWeeklyDriftHaltCheck } = await import("../services/weekly-drift-halt-service.js");
    const report = await runWeeklyDriftHaltCheck();

    // The core safety assertion: killSwitch.setMode must NEVER be called when
    // the baseline is fabricated data rather than a real measurement.
    expect(mockSetMode).not.toHaveBeenCalled();
    expect(mockNotifyCritical).not.toHaveBeenCalled();

    const result = report.results.find((r) => r.strategyId === STRATEGY_ID);
    expect(result).toBeDefined();
    expect(result?.outcome).toBe("insufficient_data");
    expect(result?.reason).toBe("no_baseline_data");
  });

  it("writes a durable drift.weekly_2sigma_baseline_unavailable audit row (not just a log line)", async () => {
    const liveTrades = makeTrades([-800, -750, -900, -820, -770, -810, -790]);
    wireQueries(liveTrades, []);

    const { runWeeklyDriftHaltCheck } = await import("../services/weekly-drift-halt-service.js");
    await runWeeklyDriftHaltCheck();

    const auditCalls = mockInsertAuditRow.mock.calls as Array<
      [{ action: string; entityType: string; entityId: string; status: string }]
    >;
    const baselineUnavailableCall = auditCalls.find(
      ([args]) => args.action === "drift.weekly_2sigma_baseline_unavailable",
    );
    expect(baselineUnavailableCall).toBeDefined();
    expect(baselineUnavailableCall![0]).toMatchObject({
      entityType: "strategy",
      entityId: STRATEGY_ID,
      status: "warning",
    });

    // The HALT-specific audit action must NOT have fired.
    const haltCall = auditCalls.find(([args]) => args.action === "drift.weekly_2sigma_halt");
    expect(haltCall).toBeUndefined();
  });

  it("backtest row exists but resultExtras has no usable daily-return series → still skips, never halts", async () => {
    const liveTrades = makeTrades([-800, -750, -900, -820, -770, -810, -790]);
    // A completed backtest row is present, but its resultExtras carries
    // neither a trades_by_day/daily_returns array nor a scalar daily_pnl_mean
    // + daily_pnl_std pair — so baselineDaily still ends up empty.
    wireQueries(liveTrades, [{ resultExtras: { metrics: { some_unrelated_field: 42 } } }]);

    const { runWeeklyDriftHaltCheck } = await import("../services/weekly-drift-halt-service.js");
    const report = await runWeeklyDriftHaltCheck();

    expect(mockSetMode).not.toHaveBeenCalled();
    const result = report.results.find((r) => r.strategyId === STRATEGY_ID);
    expect(result?.outcome).toBe("insufficient_data");
  });
});
