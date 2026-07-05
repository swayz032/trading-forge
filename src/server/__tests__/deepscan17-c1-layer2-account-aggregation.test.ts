/**
 * deepscan17-c1-layer2-account-aggregation.test.ts — deepscan #17 fix wave 1
 * (agent FIX-KILLSWITCH, 2026-07-05)
 *
 * C-1(a) UNDER-HALT regression coverage: kill-switch.ts::checkLayer2DailyLoss()
 * used to evaluate each session's OWN dailyPnlBreakdown[today] in isolation
 * against the full firm DLL. Two sessions on the SAME account (e.g. Topstep
 * MES -$1,500 + MNQ -$600 on a $2,000 DLL = 105% combined) sit well past the
 * 95% force-close band, but neither session alone crossed it — so pre-fix,
 * NEITHER halted and the breach was invisible.
 *
 * Fix: checkLayer2DailyLoss now groups active sessions by the resolved account
 * key (cross-symbol-pnl.ts::resolveAccountKey) and reads combined P&L via
 * getAccountSessionCumulativePnL / evaluateCrossSymbolDll — the SAME
 * single source of truth the signal-time DLL gates already use.
 *
 * Mock pattern mirrors m1-a5-dll-force-close-warn.test.ts (established during
 * this fix wave) — same db/schema/drizzle-orm/firm-config mock shape, extended
 * to return TWO session rows sharing one account instead of one.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then(resolve: (v: unknown[]) => unknown, reject?: (e: unknown) => unknown) {
            return Promise.resolve([]).then(resolve, reject);
          },
          limit: vi.fn().mockResolvedValue([
            { productionMode: "PAPER", killReason: null, setBy: "test", setAt: new Date("2026-07-05T00:00:00Z") },
          ]),
        }),
        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
        innerJoin: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      }),
    }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([{ id: "test-id" }]) }),
  },
}));

vi.mock("../db/schema.js", () => ({
  systemState: { id: "system_state" },
  auditLog: { action: "audit_log" },
  weeklyDriftReports: { severity: "severity", reportWeek: "report_week", ranAt: "ran_at" },
  brokerAccounts: { firmId: "firm_id", enabled: "enabled" },
  paperSessions: {
    id: "id", firmId: "firm_id", status: "status", config: "config", startingCapital: "starting_capital",
    dailyPnlBreakdown: "daily_pnl_breakdown", currentEquity: "current_equity", realizedPeakEquity: "realized_peak_equity",
  },
  // deepscan17: cross-symbol-pnl.ts::getAccountSessionCumulativePnL (now called by
  // checkLayer2DailyLoss) also destructures paperPositions for its open-MTM query.
  paperPositions: { id: "id", sessionId: "session_id", symbol: "symbol", unrealizedPnl: "unrealized_pnl", closedAt: "closed_at" },
  ProductionMode: undefined,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_c: unknown, v: unknown) => `eq(${String(v)})`),
  desc: vi.fn(() => "desc"),
  and: vi.fn((...a: unknown[]) => `and(${a.join(",")})`),
  isNull: vi.fn(() => "isNull"),
  inArray: vi.fn((_c: unknown, vals: unknown[]) => `inArray(${vals})`),
  sql: Object.assign(vi.fn((..._a: unknown[]) => ({ as: vi.fn((n: string) => `sql_as(${n})`) })), {}),
}));

vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../services/alert-service.js", () => ({
  AlertFactory: { systemError: vi.fn(), criticalAlert: vi.fn() },
  createAlert: vi.fn().mockResolvedValue({ id: "alert-1" }),
}));
vi.mock("../services/exchange-status-service.js", () => ({ isExchangeHalted: vi.fn().mockReturnValue(false) }));
vi.mock("../services/prop-firm-health-service.js", () => ({ isFirmSuspended: vi.fn().mockReturnValue(false) }));
vi.mock("../lib/network-failover.js", () => ({ isConnectivityDegraded: vi.fn().mockReturnValue(false) }));
vi.mock("../services/macro-gate-service.js", () => ({
  evaluateMacroGates: vi.fn().mockResolvedValue({ macroContext: { crisisGateTriggered: false } }),
}));
vi.mock("../services/windows-health-check-service.js", () => ({
  runPreTradingDayHealthCheck: vi.fn().mockResolvedValue({ status: "healthy" }),
}));
vi.mock("../lib/audit-log-helper.js", () => ({ insertAuditRow: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../shared/firm-config.js", () => ({
  getFirmAccount: vi.fn().mockReturnValue({ dailyLossLimit: 1000, maxDrawdown: 2000 }),
  // deepscan17 C-2 fix: checkLayer2DailyLoss now resolves the personal DLL base via
  // resolvePersonalDllDollars (cross-symbol-pnl.ts), which reads this tier table for
  // firmId="topstep" instead of the getFirmAccount() mock above.
  TOPSTEP_TRAILING_DD_BY_SIZE: { 50000: 2000, 100000: 3000, 150000: 4500 },
}));
// forceCloseAllPositions is dynamically imported by kill-switch.ts.
vi.mock("../services/paper-execution-service.js", () => ({
  forceCloseAllPositions: vi.fn().mockResolvedValue({ count: 0, closed: 0, stuck: 0 }),
}));

import { killSwitch } from "../production/kill-switch.js";
import { db } from "../db/index.js";

function todayCmeKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(
    new Date(Date.now() + 7 * 3_600_000),
  );
}

/**
 * Two active sessions on the SAME Topstep account (no config.account_key
 * override on either — both resolve to accountKey="topstep" via the firmId
 * fallback, matching the common single-account-per-firm operator setup).
 */
function mockTwoSessionsOneAccount(pnlA: number, pnlB: number) {
  const today = todayCmeKey();
  const sessions = [
    { id: "s-mes", firmId: "topstep", config: null, startingCapital: "50000", dailyPnlBreakdown: { [today]: pnlA }, currentEquity: "50000", realizedPeakEquity: "50000" },
    { id: "s-mnq", firmId: "topstep", config: null, startingCapital: "50000", dailyPnlBreakdown: { [today]: pnlB }, currentEquity: "50000", realizedPeakEquity: "50000" },
  ];

  // @ts-ignore — mock shape
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        then(resolve: (v: unknown[]) => unknown, reject?: (e: unknown) => unknown) {
          return Promise.resolve(sessions).then(resolve, reject);
        },
        limit: vi.fn().mockResolvedValue([
          { productionMode: "PAPER", killReason: null, setBy: "test", setAt: new Date() },
        ]),
      }),
      orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      innerJoin: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
  } as ReturnType<typeof db.select>);
}

describe("deepscan17 C-1(a): checkLayer2DailyLoss aggregates per-account, not per-session", () => {
  beforeEach(() => {
    killSwitch._invalidateCacheForTests();
    vi.clearAllMocks();
    for (let l = 3; l <= 9; l++) {
      killSwitch._setLayerCacheForTests(l, { halted: false });
    }
  });

  it("sanity check: neither session alone crosses 95% of the $2,000 Topstep DLL", () => {
    // -1500/2000 = 75%, -600/2000 = 30% — both individually under the 95% band
    // (the first would only individually trigger the 67% halt, not force-close).
    expect(Math.abs(-1500) / 2000).toBeLessThan(0.95);
    expect(Math.abs(-600) / 2000).toBeLessThan(0.95);
  });

  it("combined P&L across two sessions on ONE account crosses 95% and HALTS via force-close", async () => {
    mockTwoSessionsOneAccount(-1500, -600);
    const decision = await killSwitch.evaluateAllKillSwitchLayers();

    // -1500 + -600 = -2100; 2100/2000 = 105% >= 95% force-close threshold.
    // Pre-fix: neither session's isolated check would have crossed 95pct — this
    // breach was invisible. Post-fix: the combined account view catches it.
    expect(decision.halted).toBe(true);
    expect(decision.layer).toBe(2);
    expect(decision.reason).toBe("dll_force_close_at_95pct");
    expect(decision.detail).toMatchObject({ account_key: "topstep", day_pnl: -2100, dll: 2000 });
  });

  it("scopes the force-close call to the resolved account_key (not a single session id)", async () => {
    mockTwoSessionsOneAccount(-1500, -600);
    await killSwitch.evaluateAllKillSwitchLayers();
    await new Promise((r) => setTimeout(r, 0));

    const { forceCloseAllPositions } = await import("../services/paper-execution-service.js");
    expect(vi.mocked(forceCloseAllPositions)).toHaveBeenCalledWith(
      expect.stringContaining("dll_force_close_at_95pct:topstep"),
      expect.objectContaining({ scope: { accountKey: "topstep" } }),
    );
  });

  it("isHaltedForProduction() (the actual signal-path gate) returns true for the combined breach", async () => {
    mockTwoSessionsOneAccount(-1500, -600);
    const halted = await killSwitch.isHaltedForProduction();
    expect(halted).toBe(true);
  });

  it("does NOT force-close when the combined account P&L stays under 95% (regression guard)", async () => {
    // -1000 + -600 = -1600; 1600/2000 = 80% — over the 67% halt but under 95% force-close.
    mockTwoSessionsOneAccount(-1000, -600);
    const decision = await killSwitch.evaluateAllKillSwitchLayers();
    expect(decision.halted).toBe(true);
    expect(decision.reason).not.toBe("dll_force_close_at_95pct");
    expect(decision.reason).toMatch(/67pct/);
  });
});
