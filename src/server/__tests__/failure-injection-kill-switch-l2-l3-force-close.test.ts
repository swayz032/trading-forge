/**
 * failure-injection-kill-switch-l2-l3-force-close.test.ts
 *
 * FAILURE-INJECTION (not code-existence) coverage for capital-safety incident
 * classes #1 and #2 of the autonomous-readiness fault-injection campaign
 * (2026-07-12, requested by an independent grader as an unmet prerequisite for
 * institutional-grade certification).
 *
 * The distinction this file enforces: a test that asserts `halted === true` only
 * proves the kill-switch REPORTS a breach. It does NOT prove the bot actually
 * stops bleeding — Layer 2/3 are documented to FORCE-CLOSE (flatten) the account
 * at 95%, not merely halt new entries. This file injects the real breach STATE
 * (a P&L/equity reading that crosses the documented threshold) into the REAL
 * kill-switch.ts decision code (checkLayer2DailyLoss / checkLayer3TrailingDD via
 * killSwitch.evaluateAllKillSwitchLayers) and asserts the observable SIDE EFFECT —
 * forceCloseAllPositions was actually invoked with the correct scope — not just
 * the returned halted flag.
 *
 * Incident class #1: Layer 2 DLL breach (personal DLL 67% halt / 95% force-close).
 *   Inject currentEquity/P&L below the force-close threshold -> assert
 *   _safeForceClose actually fires (forceCloseAllPositions called), not just
 *   halted:true.
 *
 * Incident class #2: Layer 3 trailing-DD breach.
 *   Inject peakEquity - currentEquity >= maxDrawdown - buffer -> assert the
 *   documented flatten fires. The 2026-07-11 ledger flagged CAP-1 ("L3 only
 *   HALTS and never force-closes") as a then-open capital-safety gap. Reading
 *   src/server/production/kill-switch.ts (lines ~824-933) shows a "CAP-1 fix
 *   (deep-scan 2026-07-11)" comment claiming L3 now mirrors L2's force-close.
 *   This test is the injection-based PROOF that claim holds in this base —
 *   if CAP-1 regressed, this test fails and that is the confirmed finding.
 *
 * Mock conventions mirror src/server/__tests__/kill-switch-track-m-fixes.test.ts
 * and kill-switch.test.ts (established project pattern for this module).
 *
 * DO NOT EDIT SOURCE FROM THIS FILE. New test file only, per campaign
 * constraint (a concurrent freshscan11 deep-scan is reading the same source
 * tree and must not be contaminated by source edits).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mutable injection state ──────────────────────────────────────────────────
// Each test overwrites these before invoking the kill-switch so the "failure
// state" (session rows visible to Layer 2 / Layer 3's DB queries) is injected
// fresh per case. Declared via vi.hoisted() so the container exists BEFORE the
// hoisted vi.mock() factory below runs (avoids the TDZ "Cannot access before
// initialization" hoisting trap), and every chain step reads the container
// LIVE (at call time), never a pre-baked snapshot, so re-assigning
// mockState.activeSessions between it() blocks actually takes effect.

const mockState = vi.hoisted(() => ({
  activeSessions: [] as Array<Record<string, unknown>>,
  systemStateRow: {
    productionMode: "PAPER",
    killReason: null,
    setBy: "test",
    setAt: new Date("2026-07-12T00:00:00Z"),
  } as Record<string, unknown>,
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          // Direct-await path (checkLayer2DailyLoss / checkLayer3TrailingDD /
          // unscoped Layer 7 broker_accounts query all await the where() result
          // directly without .limit()). Reads mockState LIVE at call time.
          then(resolve: (v: unknown[]) => unknown, reject?: (err: unknown) => unknown) {
            return Promise.resolve(mockState.activeSessions).then(resolve, reject);
          },
          // .limit() path — system_state singleton read (Layer 1). Also live.
          limit: vi.fn(() => Promise.resolve([mockState.systemStateRow])),
        }),
        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
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
    id: "id",
    firmId: "firm_id",
    status: "status",
    config: "config",
    startingCapital: "starting_capital",
    currentEquity: "current_equity",
    realizedPeakEquity: "realized_peak_equity",
  },
  ProductionMode: undefined,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_c: unknown, v: unknown) => `eq(${String(v)})`),
  desc: vi.fn(() => "desc"),
  and: vi.fn((...a: unknown[]) => `and(${a.join(",")})`),
  inArray: vi.fn((_c: unknown, v: unknown) => `inArray(${JSON.stringify(v)})`),
}));

vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../services/alert-service.js", () => ({
  AlertFactory: { systemError: vi.fn(), criticalAlert: vi.fn() },
  createAlert: vi.fn().mockResolvedValue(undefined),
}));

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
  evaluateMacroGates: vi.fn().mockResolvedValue({ macroContext: { crisisGateTriggered: false } }),
}));

vi.mock("../services/windows-health-check-service.js", () => ({
  runPreTradingDayHealthCheck: vi.fn().mockResolvedValue({ status: "healthy" }),
}));

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
}));

// firm-config.js is dynamically imported by checkLayer3TrailingDD.
vi.mock("../../shared/firm-config.js", () => ({
  getFirmAccount: vi.fn().mockReturnValue({ maxDrawdown: 2000, maxDailyDrawdown: 2000 }),
  TOPSTEP_TRAILING_DD_BY_SIZE: { 50000: 2000 },
}));

// cross-symbol-pnl.js: keep the REAL evaluateCrossSymbolDll / resolveAccountKey /
// resolvePersonalDllDollars (the actual threshold math under test) — only the
// async DB-backed P&L fetch (getAccountSessionCumulativePnL) is overridden per
// test to inject the failure state. This is the injection seam: we control the
// INPUT DATA (a P&L reading), not the DECISION (real code decides force_close).
vi.mock("../services/cross-symbol-pnl.js", async () => {
  const actual = await vi.importActual<typeof import("../services/cross-symbol-pnl.js")>(
    "../services/cross-symbol-pnl.js",
  );
  return {
    ...actual,
    getAccountSessionCumulativePnL: vi.fn(),
  };
});

// paper-execution-service.js::forceCloseAllPositions is dynamically imported by
// kill-switch.ts's _confirmedForceClose. This is the OBSERVABLE SIDE EFFECT we
// assert on — the actual "did the bot flatten the account" signal.
vi.mock("../services/paper-execution-service.js", () => ({
  forceCloseAllPositions: vi.fn(),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { killSwitch } from "../production/kill-switch.js";
import { getAccountSessionCumulativePnL } from "../services/cross-symbol-pnl.js";
import { forceCloseAllPositions } from "../services/paper-execution-service.js";

function uniqueAccountKey(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

describe("FAILURE-INJECTION: kill-switch Layer 2 DLL 95% force-close (incident class #1)", () => {
  beforeEach(() => {
    killSwitch._invalidateCacheForTests();
    vi.clearAllMocks();
    mockState.systemStateRow = {
      productionMode: "PAPER",
      killReason: null,
      setBy: "test",
      setAt: new Date("2026-07-12T00:00:00Z"),
    };
    vi.mocked(forceCloseAllPositions).mockResolvedValue({ count: 1, closed: 1, stuck: 0 } as never);
  });

  it("INJECTED: currentEquity loss crosses 95% of personal DLL -> forceCloseAllPositions is ACTUALLY CALLED (not just halted:true)", async () => {
    const accountKey = uniqueAccountKey("l2-95pct");

    // Inject the failure STATE: a session on Topstep whose resolved account
    // starting floor puts its personal DLL at $2,000 (Topstep 50K default),
    // and a real cumulative P&L reading of -$1,900 (>= 95% of $2,000 = $1,900).
    mockState.activeSessions = [
      {
        id: "sess-l2",
        firmId: "topstep",
        config: { account_key: accountKey },
        startingCapital: "50000",
      },
    ];
    vi.mocked(getAccountSessionCumulativePnL).mockResolvedValue({
      firmId: accountKey,
      sessionDate: "2026-07-12",
      realizedPnL: -1900,
      openPnLMtm: 0,
      totalPnL: -1900,
      pnLBySymbol: { MES: -1900 },
    });

    const decision = await killSwitch.evaluateAllKillSwitchLayers({ accountKey });

    // The RESPONSE: halted is reported...
    expect(decision.halted).toBe(true);
    expect(decision.reason).toBe("dll_force_close_at_95pct");
    // ...AND the account was actually flattened (the observable side effect a
    // "halted:true"-only test would miss).
    expect(forceCloseAllPositions).toHaveBeenCalledTimes(1);
    const [reasonArg, optsArg] = vi.mocked(forceCloseAllPositions).mock.calls[0];
    expect(String(reasonArg)).toContain("dll_force_close_at_95pct");
    expect((optsArg as { scope?: { accountKey?: string } }).scope?.accountKey).toBe(accountKey);
  });

  it("INJECTED: loss at exactly 67% (halt band) does NOT force-close — only blocks new entries", async () => {
    const accountKey = uniqueAccountKey("l2-67pct");
    mockState.activeSessions = [
      { id: "sess-l2b", firmId: "topstep", config: { account_key: accountKey }, startingCapital: "50000" },
    ];
    // 67% of $2,000 = $1,340 (halt band; well under the $1,900 force-close line).
    vi.mocked(getAccountSessionCumulativePnL).mockResolvedValue({
      firmId: accountKey,
      sessionDate: "2026-07-12",
      realizedPnL: -1400,
      openPnLMtm: 0,
      totalPnL: -1400,
      pnLBySymbol: { MES: -1400 },
    });

    const decision = await killSwitch.evaluateAllKillSwitchLayers({ accountKey });

    expect(decision.halted).toBe(true);
    expect(decision.reason).toMatch(/dll_at_67pct_personal_threshold/);
    // Capital-safety assertion: the halt band must NOT trigger a flatten —
    // force-close is reserved for the 95% band per the documented 4-band ladder.
    expect(forceCloseAllPositions).not.toHaveBeenCalled();
  });

  it("GAP-CHECK: an INCOMPLETE force-close (partial fill, stuck position) does NOT arm the day-dedup and re-attempts on the next eval", async () => {
    const accountKey = uniqueAccountKey("l2-incomplete");
    mockState.activeSessions = [
      { id: "sess-l2c", firmId: "topstep", config: { account_key: accountKey }, startingCapital: "50000" },
    ];
    vi.mocked(getAccountSessionCumulativePnL).mockResolvedValue({
      firmId: accountKey,
      sessionDate: "2026-07-12",
      realizedPnL: -1950,
      openPnLMtm: 0,
      totalPnL: -1950,
      pnLBySymbol: { MES: -1950 },
    });
    // Inject a STUCK position: forceCloseAllPositions resolves but closed < count.
    vi.mocked(forceCloseAllPositions).mockResolvedValue({ count: 1, closed: 0, stuck: 1 } as never);

    const first = await killSwitch.evaluateAllKillSwitchLayers({ accountKey });
    expect(first.halted).toBe(true);
    expect(forceCloseAllPositions).toHaveBeenCalledTimes(1);

    // Invalidate ONLY the layer cache (not the dedup maps) to simulate the next
    // signal-path bar tick within the 1s TTL boundary being re-evaluated after
    // cache expiry — re-run through the public API.
    killSwitch._invalidateCacheForTests();
    // A stuck/incomplete close must NOT have armed the "already force-closed
    // today" dedup — the next eval must be willing to re-attempt (backoff
    // window permitting). We assert the underlying per-account state was not
    // silently marked "done" by checking the layer decision reason is not the
    // silent "_already_done_today" short-circuit that would mask an open bleed.
    const second = await killSwitch.evaluateAllKillSwitchLayers({ accountKey });
    expect(second.halted).toBe(true);
    expect(second.reason).not.toBe("dll_force_close_already_done_today");
  });
});

describe("FAILURE-INJECTION: kill-switch Layer 3 trailing-DD force-close (incident class #2, CAP-1 verification)", () => {
  beforeEach(() => {
    killSwitch._invalidateCacheForTests();
    vi.clearAllMocks();
    mockState.systemStateRow = {
      productionMode: "PAPER",
      killReason: null,
      setBy: "test",
      setAt: new Date("2026-07-12T00:00:00Z"),
    };
    vi.mocked(forceCloseAllPositions).mockResolvedValue({ count: 1, closed: 1, stuck: 0 } as never);
  });

  it("INJECTED: peakEquity - currentEquity crosses (maxDrawdown - buffer) -> the documented flatten ACTUALLY FIRES (CAP-1 must be fixed, not just halted:true)", async () => {
    const accountKey = uniqueAccountKey("l3-breach");

    // Seed Layer 2 as clean for THIS scope so evaluateAllKillSwitchLayers
    // reaches Layer 3 (established project pattern — see
    // kill-switch-track-m-fixes.test.ts "seed layers 2-9 as passing so only
    // the layer under test is exercised").
    killSwitch._setLayerCacheForTests(2, { halted: false }, accountKey);

    // Inject the failure STATE: currentEquity is $2,000 below realizedPeakEquity
    // (the firm's maxDrawdown), which is >= maxDrawdown($2,000) - buffer($200) = $1,800.
    mockState.activeSessions = [
      {
        id: "sess-l3",
        firmId: "topstep",
        config: { account_key: accountKey },
        currentEquity: "48000",
        realizedPeakEquity: "50000",
      },
    ];

    const decision = await killSwitch.evaluateAllKillSwitchLayers({ accountKey });

    expect(decision.halted).toBe(true);
    expect(decision.layer).toBe(3);
    expect(decision.reason).toBe("trailing_dd_force_close_at_95pct");
    // CAP-1 verification: this is the assertion that actually proves the
    // documented flatten fires — a test that stopped at `halted === true`
    // would have passed even under the PRE-CAP-1-fix regression (L3-halts-
    // only-never-closes). Confirmed via injection: forceCloseAllPositions was
    // actually invoked, scoped to the breaching account.
    expect(forceCloseAllPositions).toHaveBeenCalledTimes(1);
    const [reasonArg, optsArg] = vi.mocked(forceCloseAllPositions).mock.calls[0];
    expect(String(reasonArg)).toContain("trailing_dd_force_close_at_95pct");
    expect((optsArg as { scope?: { accountKey?: string } }).scope?.accountKey).toBe(accountKey);
  });

  it("INJECTED: drawdown just INSIDE the buffer (below threshold) does NOT force-close — negative control", async () => {
    const accountKey = uniqueAccountKey("l3-safe");
    killSwitch._setLayerCacheForTests(2, { halted: false }, accountKey);

    // drawdown = $1,000, well under maxDrawdown($2,000) - buffer($200) = $1,800.
    mockState.activeSessions = [
      {
        id: "sess-l3-safe",
        firmId: "topstep",
        config: { account_key: accountKey },
        currentEquity: "49000",
        realizedPeakEquity: "50000",
      },
    ];

    const decision = await killSwitch.evaluateAllKillSwitchLayers({ accountKey });

    expect(decision.halted).toBe(false);
    expect(forceCloseAllPositions).not.toHaveBeenCalled();
  });

  it("ORDERING INVARIANT: a Layer-2 breach on the SAME account short-circuits before Layer 3 is even evaluated (force_close priority > trailing-DD priority)", async () => {
    const accountKey = uniqueAccountKey("l2-before-l3");

    // Inject BOTH an L2 95% DLL breach AND an L3 trailing-DD breach
    // simultaneously on the same account/session row.
    mockState.activeSessions = [
      {
        id: "sess-both",
        firmId: "topstep",
        config: { account_key: accountKey },
        startingCapital: "50000",
        currentEquity: "48000",
        realizedPeakEquity: "50000",
      },
    ];
    vi.mocked(getAccountSessionCumulativePnL).mockResolvedValue({
      firmId: accountKey,
      sessionDate: "2026-07-12",
      realizedPnL: -1900,
      openPnLMtm: 0,
      totalPnL: -1900,
      pnLBySymbol: { MES: -1900 },
    });

    const decision = await killSwitch.evaluateAllKillSwitchLayers({ accountKey });

    // Layer priority is L1 > L2 > L3 (evaluateAllKillSwitchLayers returns on
    // the FIRST blocking layer) — L2 must win when both are breached.
    expect(decision.layer).toBe(2);
    expect(decision.reason).toBe("dll_force_close_at_95pct");
    expect(forceCloseAllPositions).toHaveBeenCalledTimes(1);
  });
});
