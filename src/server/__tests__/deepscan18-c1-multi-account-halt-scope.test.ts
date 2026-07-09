/**
 * deepscan18-c1-multi-account-halt-scope.test.ts — deepscan #18 fix wave,
 * Track 1: Multi-Account Isolation (agent FIX-KILLSWITCH, 2026-07-05)
 *
 * Deep-Scan #18 found that deepscan17's C-1 fix scoped the force-close ACTION
 * (forceCloseAllPositions) to the breaching account, but left THREE sibling
 * paths still GLOBALLY scoped:
 *
 *   C-C1: isHaltedForProduction()/evaluateAllKillSwitchLayers() took no
 *   account param. Layer 2 (checkLayer2DailyLoss), Layer 3
 *   (checkLayer3TrailingDD), and Layer 7 (checkLayer7FirmSuspension) each
 *   iterate every active account/session/firm and `break` on the FIRST
 *   breach found ANYWHERE, returning ONE decision every caller receives
 *   regardless of which account is asking. Fix: an OPTIONAL account/firm
 *   scope threaded through the whole chain.
 *
 *   A-C2: the force-close concurrency guard (_forceCloseInFlight) was a
 *   single module-level boolean shared by EVERY account — two accounts
 *   breaching 95% within the same FORCE_CLOSE_TIMEOUT_MS window meant the
 *   SECOND account's flatten was silently deduped away. Fix: keyed by
 *   account (Map<accountKey|"__global__", boolean>).
 *
 * This suite proves:
 *   (a) two accounts, only the breaching one halts/flattens
 *   (b) the per-account force-close-in-flight guard doesn't cross-block
 *       a sibling account's genuine concurrent breach
 *   (c) the unscoped/global path is BYTE-IDENTICAL to pre-fix behavior
 *       (iterate-every-account, halt-on-first-breach-found-anywhere)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../db/index.js", () => ({
  db: { select: vi.fn() },
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

const mockIsFirmSuspended = vi.fn().mockReturnValue(false);
vi.mock("../services/prop-firm-health-service.js", () => ({ isFirmSuspended: (...a: unknown[]) => mockIsFirmSuspended(...a) }));

vi.mock("../lib/network-failover.js", () => ({ isConnectivityDegraded: vi.fn().mockReturnValue(false) }));
vi.mock("../services/macro-gate-service.js", () => ({
  evaluateMacroGates: vi.fn().mockResolvedValue({ macroContext: { crisisGateTriggered: false } }),
}));
vi.mock("../services/windows-health-check-service.js", () => ({
  runPreTradingDayHealthCheck: vi.fn().mockResolvedValue({ status: "healthy" }),
}));
vi.mock("../lib/audit-log-helper.js", () => ({ insertAuditRow: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../shared/firm-config.js", () => ({
  getFirmAccount: vi.fn(() => ({ dailyLossLimit: 1000, maxDrawdown: 2000 })),
  TOPSTEP_TRAILING_DD_BY_SIZE: { 50000: 2000, 100000: 3000, 150000: 4500 },
}));
const mockForceCloseAllPositions = vi.fn().mockResolvedValue({ count: 0, closed: 0, stuck: 0 });
vi.mock("../services/paper-execution-service.js", () => ({
  forceCloseAllPositions: (...a: unknown[]) => mockForceCloseAllPositions(...a),
}));

import {
  killSwitch,
  _setForceCloseInFlightForTests,
  _getForceCloseInFlightForTests,
} from "../production/kill-switch.js";
import { db } from "../db/index.js";

function todayCmeKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(
    new Date(Date.now() + 7 * 3_600_000),
  );
}

const STATE_ROW = { productionMode: "PAPER", killReason: null, setBy: "test", setAt: new Date() };

/** Route db.select() to the right fixture by inspecting the requested column shape. */
function routeSelect(fixtures: {
  sessionsL2?: object[]; // id, firmId, config, startingCapital (Layer2's own query)
  sessionsL3?: object[]; // id, firmId, config, currentEquity, realizedPeakEquity (Layer3's own query)
  cumPnlSessions?: object[]; // getAccountSessionCumulativePnL step 1 (dailyPnlBreakdown + symbol)
  openPositions?: object[]; // getAccountSessionCumulativePnL step 2 (unrealizedPnl)
  brokerFirms?: object[]; // Layer7 unscoped (firmId only)
}) {
  return vi.fn().mockImplementation((cols?: Record<string, unknown>) => {
    // Layer 1: db.select() with NO args (select *)
    if (cols === undefined) {
      return { from: () => ({ where: () => ({ limit: () => Promise.resolve([STATE_ROW]) }) }) };
    }
    // Layer 5 drift: {severity, reportWeek}
    if ("severity" in cols) {
      return { from: () => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }) };
    }
    // getAccountSessionCumulativePnL step 2 (MTM): {symbol, unrealizedPnl, sessionFirmId, sessionConfig}
    if ("unrealizedPnl" in cols) {
      return { from: () => ({ innerJoin: () => ({ where: () => Promise.resolve(fixtures.openPositions ?? []) }) }) };
    }
    // getAccountSessionCumulativePnL step 1 (realized): has dailyPnlBreakdown + symbol
    if ("dailyPnlBreakdown" in cols && "symbol" in cols) {
      return { from: () => ({ where: () => Promise.resolve(fixtures.cumPnlSessions ?? []) }) };
    }
    // Layer 7 unscoped: exactly {firmId}
    if (Object.keys(cols).length === 1 && "firmId" in cols) {
      return { from: () => ({ where: () => Promise.resolve(fixtures.brokerFirms ?? []) }) };
    }
    // Layer 3 own query: has currentEquity
    if ("currentEquity" in cols) {
      return { from: () => ({ where: () => Promise.resolve(fixtures.sessionsL3 ?? []) }) };
    }
    // Layer 2 own query: has startingCapital, no dailyPnlBreakdown
    if ("startingCapital" in cols) {
      return { from: () => ({ where: () => Promise.resolve(fixtures.sessionsL2 ?? []) }) };
    }
    // Fallback — empty
    return { from: () => ({ where: () => Promise.resolve([]) }) };
  });
}

describe("deepscan18 C-C1: Layer 2 (daily loss) account-scoped evaluation", () => {
  const today = todayCmeKey();
  // Account A: topstep, DLL=2000 (50k tier), -1950 loss = 97.5% -> force_close.
  const acctASessions = [
    { id: "s-A", firmId: "topstep", config: { account_key: "acct-A" }, startingCapital: "50000" },
  ];
  // Account B: topstep, DLL=2000, no loss today -> healthy.
  const acctBSessions = [
    { id: "s-B", firmId: "topstep", config: { account_key: "acct-B" }, startingCapital: "50000" },
  ];
  const cumPnlAll = [
    { id: "s-A", firmId: "topstep", config: { account_key: "acct-A" }, symbol: "MES", dailyPnlBreakdown: { [today]: -1950 } },
    { id: "s-B", firmId: "topstep", config: { account_key: "acct-B" }, symbol: "MNQ", dailyPnlBreakdown: {} },
  ];

  beforeEach(() => {
    killSwitch._invalidateCacheForTests();
    vi.clearAllMocks();
    // Seed every OTHER layer as a clean pass (global scope — independent of
    // whatever accountKey the test under Layer 2 supplies).
    for (const l of [3, 4, 5, 6, 7, 8, 9]) killSwitch._setLayerCacheForTests(l, { halted: false });
    vi.mocked(db.select).mockImplementation(
      routeSelect({
        sessionsL2: [...acctASessions, ...acctBSessions],
        cumPnlSessions: cumPnlAll,
      }),
    );
  });

  it("(regression) unscoped call still halts due to Account A's 95% breach — byte-identical to deepscan17", async () => {
    const decision = await killSwitch.evaluateAllKillSwitchLayers();
    expect(decision.halted).toBe(true);
    expect(decision.layer).toBe(2);
    expect(decision.reason).toBe("dll_force_close_at_95pct");
    expect(decision.detail).toMatchObject({ account_key: "acct-A" });
  });

  it("scoped to healthy Account B does NOT halt despite Account A's breach", async () => {
    const decision = await killSwitch.evaluateAllKillSwitchLayers({ accountKey: "acct-B" });
    expect(decision.halted).toBe(false);
  });

  it("isHaltedForProduction({accountKey:'acct-B'}) returns false (the actual signal-path gate)", async () => {
    const halted = await killSwitch.isHaltedForProduction({ accountKey: "acct-B" });
    expect(halted).toBe(false);
  });

  it("scoped to breaching Account A halts with force_close and scopes the flatten to acct-A only", async () => {
    const decision = await killSwitch.evaluateAllKillSwitchLayers({ accountKey: "acct-A" });
    expect(decision.halted).toBe(true);
    expect(decision.layer).toBe(2);
    expect(decision.reason).toBe("dll_force_close_at_95pct");

    await new Promise((r) => setTimeout(r, 0));
    expect(mockForceCloseAllPositions).toHaveBeenCalledWith(
      expect.stringContaining("acct-A"),
      expect.objectContaining({ scope: { accountKey: "acct-A" } }),
    );
  });

  it("scoping to an account with no matching active session returns not-halted (no crash)", async () => {
    const decision = await killSwitch.evaluateAllKillSwitchLayers({ accountKey: "acct-does-not-exist" });
    expect(decision.halted).toBe(false);
  });
});

describe("deepscan18 C-C1: Layer 3 (trailing drawdown) account-scoped evaluation", () => {
  // Account A: near the $2,000 max-drawdown floor -> breach (buffer < $200).
  const acctA = { id: "s-A", firmId: "topstep", config: { account_key: "acct-A" }, currentEquity: "48050", realizedPeakEquity: "50000" };
  // Account B: flat -> healthy.
  const acctB = { id: "s-B", firmId: "topstep", config: { account_key: "acct-B" }, currentEquity: "50000", realizedPeakEquity: "50000" };

  beforeEach(() => {
    killSwitch._invalidateCacheForTests();
    vi.clearAllMocks();
    // Seed L2 as a clean pass (global) and every layer above/below L3.
    for (const l of [2, 4, 5, 6, 7, 8, 9]) killSwitch._setLayerCacheForTests(l, { halted: false });
    vi.mocked(db.select).mockImplementation(routeSelect({ sessionsL3: [acctA, acctB] }));
  });

  it("(regression) unscoped call halts due to Account A's trailing-DD breach", async () => {
    const decision = await killSwitch.evaluateAllKillSwitchLayers();
    expect(decision.halted).toBe(true);
    expect(decision.layer).toBe(3);
    expect(decision.detail).toMatchObject({ session_id: "s-A" });
  });

  it("scoped to healthy Account B does NOT halt despite Account A's trailing-DD breach", async () => {
    const decision = await killSwitch.evaluateAllKillSwitchLayers({ accountKey: "acct-B" });
    expect(decision.halted).toBe(false);
  });

  it("scoped to breaching Account A halts on Layer 3", async () => {
    const decision = await killSwitch.evaluateAllKillSwitchLayers({ accountKey: "acct-A" });
    expect(decision.halted).toBe(true);
    expect(decision.layer).toBe(3);
  });
});

describe("deepscan18 C-C1: Layer 7 (firm suspension) firm-scoped evaluation", () => {
  beforeEach(() => {
    killSwitch._invalidateCacheForTests();
    vi.clearAllMocks();
    for (const l of [2, 3, 4, 5, 6, 8, 9]) killSwitch._setLayerCacheForTests(l, { halted: false });
    // mffu is suspended; topstep is healthy.
    mockIsFirmSuspended.mockImplementation((firmId: string) => firmId === "mffu");
    vi.mocked(db.select).mockImplementation(
      routeSelect({ brokerFirms: [{ firmId: "topstep" }, { firmId: "mffu" }] }),
    );
  });

  it("(regression) unscoped call halts because ANY enabled firm (mffu) is suspended", async () => {
    const decision = await killSwitch.evaluateAllKillSwitchLayers();
    expect(decision.halted).toBe(true);
    expect(decision.layer).toBe(7);
    expect(decision.reason).toContain("mffu");
  });

  it("scoped to firmId=topstep (healthy) does NOT halt despite mffu being suspended", async () => {
    const decision = await killSwitch.evaluateAllKillSwitchLayers({ firmId: "topstep" });
    expect(decision.halted).toBe(false);
  });

  it("scoped to firmId=mffu (suspended) halts", async () => {
    const decision = await killSwitch.evaluateAllKillSwitchLayers({ firmId: "mffu" });
    expect(decision.halted).toBe(true);
    expect(decision.layer).toBe(7);
    expect(decision.reason).toBe("firm_suspended:mffu");
  });
});

describe("deepscan18 A-C2: force-close in-flight guard is per-account", () => {
  beforeEach(() => {
    killSwitch._invalidateCacheForTests();
    vi.clearAllMocks();
    _setForceCloseInFlightForTests(false); // full reset
    for (const l of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      if (l !== 1) killSwitch._setLayerCacheForTests(l, { halted: false });
    }
    vi.mocked(db.select).mockImplementation(routeSelect({}));
  });

  it("Account A's in-flight force-close does NOT fast-path-halt Account B's scoped evaluation", async () => {
    _setForceCloseInFlightForTests(true, "acct-A");
    const decision = await killSwitch.evaluateAllKillSwitchLayers({ accountKey: "acct-B" });
    expect(decision.halted).toBe(false);
  });

  it("Account A's in-flight force-close DOES fast-path-halt Account A's own scoped evaluation", async () => {
    _setForceCloseInFlightForTests(true, "acct-A");
    const decision = await killSwitch.evaluateAllKillSwitchLayers({ accountKey: "acct-A" });
    expect(decision.halted).toBe(true);
    expect(decision.reason).toBe("force_close_in_flight");
  });

  it("unscoped (legacy) evaluation is still halted by ANY account's in-flight force-close — conservative byte-identical default", async () => {
    _setForceCloseInFlightForTests(true, "acct-A");
    const decision = await killSwitch.evaluateAllKillSwitchLayers();
    expect(decision.halted).toBe(true);
    expect(decision.reason).toBe("force_close_in_flight");
  });

  it("a GLOBAL (system-wide) in-flight force-close still blocks EVERY scoped account too", async () => {
    _setForceCloseInFlightForTests(true); // no accountKey -> GLOBAL_SCOPE_KEY
    const decisionA = await killSwitch.evaluateAllKillSwitchLayers({ accountKey: "acct-A" });
    const decisionB = await killSwitch.evaluateAllKillSwitchLayers({ accountKey: "acct-B" });
    expect(decisionA.halted).toBe(true);
    expect(decisionB.halted).toBe(true);
  });

  it("_getForceCloseInFlightForTests(accountKey) reads independently per account", () => {
    _setForceCloseInFlightForTests(true, "acct-A");
    expect(_getForceCloseInFlightForTests("acct-A")).toBe(true);
    expect(_getForceCloseInFlightForTests("acct-B")).toBe(false);
    // Unscoped read stays conservative (true if ANY account is in-flight) —
    // preserves the pre-fix single-boolean semantics for legacy callers.
    expect(_getForceCloseInFlightForTests()).toBe(true);
  });
});

describe("deepscan18 A-C2: two accounts breaching 95% concurrently — neither force-close is deduped away", () => {
  const today = todayCmeKey();

  beforeEach(() => {
    killSwitch._invalidateCacheForTests();
    vi.clearAllMocks();
    _setForceCloseInFlightForTests(false);
    for (const l of [3, 4, 5, 6, 7, 8, 9]) killSwitch._setLayerCacheForTests(l, { halted: false });
  });

  it("Account A's force-close already in-flight does not dedupe Account B's own concurrent 95% breach", async () => {
    // Account B breaches 95% on its own (-1950 of a 2000 DLL).
    const acctBSessions = [{ id: "s-B", firmId: "topstep", config: { account_key: "acct-B" }, startingCapital: "50000" }];
    const cumPnlB = [{ id: "s-B", firmId: "topstep", config: { account_key: "acct-B" }, symbol: "MNQ", dailyPnlBreakdown: { [today]: -1950 } }];
    vi.mocked(db.select).mockImplementation(routeSelect({ sessionsL2: acctBSessions, cumPnlSessions: cumPnlB }));

    // Simulate Account A's force-close already running (e.g. from a prior bar's
    // L2 breach) — this must NOT dedupe Account B's independent breach.
    _setForceCloseInFlightForTests(true, "acct-A");

    const decision = await killSwitch.evaluateAllKillSwitchLayers({ accountKey: "acct-B" });
    expect(decision.halted).toBe(true);
    expect(decision.reason).toBe("dll_force_close_at_95pct");

    await new Promise((r) => setTimeout(r, 0));
    // The critical assertion: forceCloseAllPositions WAS called for acct-B —
    // pre-fix, the shared boolean would have deduped this into a no-op.
    expect(mockForceCloseAllPositions).toHaveBeenCalledWith(
      expect.stringContaining("acct-B"),
      expect.objectContaining({ scope: { accountKey: "acct-B" } }),
    );
  });
});
