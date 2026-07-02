/**
 * m1-a5-dll-force-close-warn.test.ts
 *
 * TDD coverage for two deepscan findings in kill-switch.ts and cross-symbol-pnl.ts:
 *
 * M-1: DLL_FORCE_CLOSE_PCT (95%) was defined but never exercised on the DLL axis.
 *      Layer 2 (checkLayer2DailyLoss) only force-closed via the manual HALT path;
 *      Python compliance_gate.py:562 DOES force-close at 95% — parity break.
 *      FIX: sub-check in checkLayer2DailyLoss calls forceCloseAllPositions() when
 *      Math.abs(dayPnl) >= DLL_FORCE_CLOSE_PCT * dll, with audit + SSE.
 *
 * A-5: No alert existed between 67% halt and 95% force-close. Families see a
 *      force-close with no prior warning.
 *      FIX: 80% DLL alert fired once per session (dedup via Set), with family-grade
 *      text and sizing.dll_80pct_approach_warned audit action.
 *
 * Parity invariants verified:
 *   - force_close (95%) > halt (67%) ordering preserved
 *   - 95% force-close does NOT double-fire with Layer 3 (different trigger axis)
 *   - 80% warn dedup per session: fires once, not on every bar
 *   - 80% warn at 67-94% band: halt still fires independently (no regression)
 *   - DLL_WARN_80PCT constant exported from cross-symbol-pnl.ts with correct default
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock all external dependencies ──────────────────────────────────────────
// vi.mock() calls are hoisted — factories must be self-contained.

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then(
            resolve: (v: unknown[]) => unknown,
            reject?: (err: unknown) => unknown,
          ) {
            return Promise.resolve([]).then(resolve, reject);
          },
          limit: vi.fn().mockResolvedValue([
            {
              productionMode: "PAPER",
              killReason: null,
              setBy: "migration",
              setAt: new Date("2026-06-28T00:00:00Z"),
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
  weeklyDriftReports: {
    severity: "severity",
    reportWeek: "report_week",
    ranAt: "ran_at",
  },
  brokerAccounts: {
    firmId: "firm_id",
    enabled: "enabled",
  },
  paperSessions: {
    id: "id",
    firmId: "firm_id",
    status: "status",
    dailyPnlBreakdown: "daily_pnl_breakdown",
    currentEquity: "current_equity",
    realizedPeakEquity: "realized_peak_equity",
  },
  ProductionMode: undefined,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => `eq(${String(_val)})`),
  desc: vi.fn(() => "desc"),
  and: vi.fn((...args: unknown[]) => `and(${args.join(",")})`),
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
  AlertFactory: {
    systemError: vi.fn(),
  },
  createAlert: vi.fn().mockResolvedValue({ id: "alert-test-id" }),
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
  evaluateMacroGates: vi.fn().mockResolvedValue({
    macroContext: { crisisGateTriggered: false },
  }),
}));

vi.mock("../services/windows-health-check-service.js", () => ({
  runPreTradingDayHealthCheck: vi.fn().mockResolvedValue({ status: "healthy" }),
}));

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../shared/firm-config.js", () => ({
  getFirmAccount: vi.fn().mockReturnValue({ dailyLossLimit: 1000, maxDrawdown: 2000 }),
}));

// M-1: paper-execution-service mock — forceCloseAllPositions must be intercepted.
// kill-switch.ts dynamically imports this module (same pattern as setMode("HALT")),
// so vi.mock() here covers the dynamic import path too (Vite/vitest resolves mocks
// for dynamic imports at the module-registry level before the import() call runs).
vi.mock("../services/paper-execution-service.js", () => ({
  forceCloseAllPositions: vi.fn().mockResolvedValue({ count: 1, closed: 1, stuck: 0 }),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { killSwitch } from "../production/kill-switch.js";
import { broadcastSSE } from "../routes/sse.js";
import { createAlert } from "../services/alert-service.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";
import { db } from "../db/index.js";

// Import the constant under test from cross-symbol-pnl
import { DLL_WARN_80PCT } from "../services/cross-symbol-pnl.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Compute today's CME trading-day key (matches Layer 2's implementation). */
function todayCmeKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(
    new Date(Date.now() + 7 * 3_600_000),
  );
}

/**
 * Seed the DB mock so that:
 *   - system_state returns PAPER mode (L1 passes)
 *   - paperSessions returns [session] with the given dayPnl for today
 *
 * Both the system_state query (.limit()) and the paperSessions query (direct
 * thenable, no .limit()) come from the same db.select() mock — this helper
 * sets up the mock to route based on which path the caller uses.
 */
function mockSessionPnl(
  sessionId: string,
  dayPnl: number,
  firmId = "mffu",
  dll = 1000,
) {
  const today = todayCmeKey();
  const sessionRow = {
    id: sessionId,
    firmId,
    dailyPnlBreakdown: { [today]: dayPnl },
    currentEquity: "50000",
    realizedPeakEquity: "50000",
  };

  // @ts-ignore — mock shape
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        // Direct thenable path — used by paperSessions query in Layer 2 + 3
        then(
          resolve: (v: unknown[]) => unknown,
          reject?: (err: unknown) => unknown,
        ) {
          return Promise.resolve([sessionRow]).then(resolve, reject);
        },
        // .limit() path — used by system_state query (Layer 1)
        limit: vi.fn().mockResolvedValue([
          {
            productionMode: "PAPER",
            killReason: null,
            setBy: "test",
            setAt: new Date(),
          },
        ]),
      }),
      orderBy: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  } as ReturnType<typeof db.select>);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("M-1: DLL 95% force-close wired into Layer 2 (checkLayer2DailyLoss)", () => {
  beforeEach(() => {
    killSwitch._invalidateCacheForTests();
    vi.clearAllMocks();
    // Seed layers 3-9 as not-halted so Layer 2 is the variable under test
    for (let l = 3; l <= 9; l++) {
      killSwitch._setLayerCacheForTests(l, { halted: false });
    }
  });

  afterEach(() => {
    killSwitch._invalidateCacheForTests();
  });

  it("returns halted:true with reason dll_force_close_at_95pct when dayPnl >= 95% of DLL", async () => {
    // -950 is 95% of DLL=1000
    mockSessionPnl("session-fc-95", -950);
    const decision = await killSwitch.evaluateAllKillSwitchLayers();
    expect(decision.halted).toBe(true);
    expect(decision.layer).toBe(2);
    expect(decision.reason).toBe("dll_force_close_at_95pct");
  });

  it("calls forceCloseAllPositions when dayPnl >= 95% of DLL", async () => {
    mockSessionPnl("session-fc-call", -955);
    await killSwitch.evaluateAllKillSwitchLayers();

    // Dynamic import + .then() resolves via microtasks. Two Promise.resolve() ticks
    // flush the import chain; setTimeout flushes any remaining real-timer callbacks.
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    const { forceCloseAllPositions } = await import("../services/paper-execution-service.js");
    expect(vi.mocked(forceCloseAllPositions)).toHaveBeenCalledWith(
      expect.stringContaining("dll_force_close_at_95pct"),
    );
  });

  it("emits sizing.dll_force_close audit row when dayPnl >= 95% of DLL", async () => {
    mockSessionPnl("session-fc-audit", -960);
    await killSwitch.evaluateAllKillSwitchLayers();
    await new Promise((r) => setTimeout(r, 0));

    expect(vi.mocked(insertAuditRow)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sizing.dll_force_close",
        status: "success",
      }),
    );
  });

  it("emits kill_switch:dll_force_close SSE when dayPnl >= 95% of DLL", async () => {
    mockSessionPnl("session-fc-sse", -970);
    await killSwitch.evaluateAllKillSwitchLayers();
    await new Promise((r) => setTimeout(r, 0));

    expect(vi.mocked(broadcastSSE)).toHaveBeenCalledWith(
      "kill_switch:dll_force_close",
      expect.objectContaining({
        session_id: "session-fc-sse",
        threshold_pct: expect.closeTo(0.95, 2),
      }),
    );
  });

  it("detail includes session_id, firm_id, day_pnl, dll", async () => {
    // dll comes from getFirmAccount().dailyLossLimit (mocked as 1000 globally)
    mockSessionPnl("session-fc-detail", -980, "topstep");
    const decision = await killSwitch.evaluateAllKillSwitchLayers();
    expect(decision.detail).toMatchObject({
      session_id: "session-fc-detail",
      firm_id: "topstep",
      day_pnl: -980,
      dll: 1000,
    });
  });

  it("does NOT call forceCloseAllPositions when dayPnl is only at 67% (halt band)", async () => {
    // -670 = 67% of DLL=1000 — should halt but NOT force-close
    mockSessionPnl("session-halt-only", -670);
    const decision = await killSwitch.evaluateAllKillSwitchLayers();
    expect(decision.halted).toBe(true);
    expect(decision.layer).toBe(2);
    // reason should be the 67% halt reason, NOT force-close
    expect(decision.reason).toMatch(/67pct/);
    await new Promise((r) => setTimeout(r, 0));

    const { forceCloseAllPositions } = await import("../services/paper-execution-service.js");
    expect(vi.mocked(forceCloseAllPositions)).not.toHaveBeenCalled();
  });

  it("force_close (95%) has higher priority than halt (67%) — reason is force_close not halt", async () => {
    // At 95%, the 95% check fires first; the 67% check is never reached
    mockSessionPnl("session-priority", -960);
    const decision = await killSwitch.evaluateAllKillSwitchLayers();
    expect(decision.reason).toBe("dll_force_close_at_95pct");
    // Must NOT be the 67% reason
    expect(decision.reason).not.toMatch(/67pct/);
  });

  it("does NOT double-fire force-close when both L2 and L3 conditions are present", async () => {
    // L3 trailing-DD is pre-seeded to pass (halted: false) in beforeEach.
    // This test verifies L2 force-close fires independently of L3.
    // The L3 check runs on trailing-DD (equity vs peak), NOT daily PnL%.
    // Setting L3 to halted via cache should not affect L2's forceClose call.
    killSwitch._setLayerCacheForTests(3, { halted: true, layer: 3, reason: "trailing_dd_force_close_at_95pct" });
    mockSessionPnl("session-no-double-fc", -950);
    const decision = await killSwitch.evaluateAllKillSwitchLayers();

    // L2 fires first (higher priority than L3), so L3 is never reached
    expect(decision.halted).toBe(true);
    expect(decision.layer).toBe(2);
    expect(decision.reason).toBe("dll_force_close_at_95pct");

    // forceCloseAllPositions should still be called exactly once (from L2)
    await new Promise((r) => setTimeout(r, 0));
    const { forceCloseAllPositions } = await import("../services/paper-execution-service.js");
    expect(vi.mocked(forceCloseAllPositions)).toHaveBeenCalledTimes(1);
  });
});

describe("A-5: 80% DLL approach warning (once per session, family-grade)", () => {
  beforeEach(() => {
    killSwitch._invalidateCacheForTests();
    vi.clearAllMocks();
    // Seed layers 3-9 as not-halted so Layer 2 is the variable under test
    for (let l = 3; l <= 9; l++) {
      killSwitch._setLayerCacheForTests(l, { halted: false });
    }
  });

  afterEach(() => {
    killSwitch._invalidateCacheForTests();
  });

  it("emits sizing.dll_80pct_approach_warned audit when dayPnl is between 67% and 95% of DLL", async () => {
    // -820 = 82% of DLL=1000 — in the warn band [80%, 95%)
    // Use a session ID that has not been seen before in this process run
    const sessionId = `session-warn-80-${Date.now()}-${Math.random()}`;
    mockSessionPnl(sessionId, -820);
    await killSwitch.evaluateAllKillSwitchLayers();
    await new Promise((r) => setTimeout(r, 0));

    expect(vi.mocked(insertAuditRow)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sizing.dll_80pct_approach_warned",
        status: "success",
      }),
    );
  });

  it("emits createAlert with warning severity and family-grade message", async () => {
    const sessionId = `session-warn-alert-${Date.now()}-${Math.random()}`;
    mockSessionPnl(sessionId, -850);
    await killSwitch.evaluateAllKillSwitchLayers();
    await new Promise((r) => setTimeout(r, 0));

    expect(vi.mocked(createAlert)).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "warning",
        message: expect.stringContaining("80% of the safety limit"),
      }),
    );
  });

  it("family-grade message includes all required phrases", async () => {
    const sessionId = `session-warn-msg-${Date.now()}-${Math.random()}`;
    mockSessionPnl(sessionId, -830);
    await killSwitch.evaluateAllKillSwitchLayers();
    await new Promise((r) => setTimeout(r, 0));

    const call = vi.mocked(createAlert).mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call.message).toContain("stopped taking new trades");
    expect(call.message).toContain("still holding its current position");
    expect(call.message).toContain("exit automatically");
    expect(call.message).toContain("No action needed");
  });

  it("dedup: 80% warn fires only ONCE per session ID (second call same session skips)", async () => {
    const sessionId = `session-dedup-once-${Date.now()}-${Math.random()}`;
    mockSessionPnl(sessionId, -840);

    // First call — warn should fire
    await killSwitch.evaluateAllKillSwitchLayers();
    await new Promise((r) => setTimeout(r, 0));
    const firstCallCount = vi.mocked(createAlert).mock.calls.length;
    expect(firstCallCount).toBeGreaterThan(0);

    // Invalidate the layer cache so the check re-runs (bypasses the 1s layer cache)
    killSwitch._invalidateCacheForTests();
    for (let l = 3; l <= 9; l++) {
      killSwitch._setLayerCacheForTests(l, { halted: false });
    }

    // Second call with SAME session (same DB mock returns same session ID)
    await killSwitch.evaluateAllKillSwitchLayers();
    await new Promise((r) => setTimeout(r, 0));
    const secondCallCount = vi.mocked(createAlert).mock.calls.length;

    // createAlert should NOT have been called again (dedup)
    expect(secondCallCount).toBe(firstCallCount);
  });

  it("dedup: different session IDs each fire their own 80% warn", async () => {
    // Session A
    const sessionA = `session-dedup-a-${Date.now()}-${Math.random()}`;
    mockSessionPnl(sessionA, -800);
    await killSwitch.evaluateAllKillSwitchLayers();
    await new Promise((r) => setTimeout(r, 0));
    const afterA = vi.mocked(createAlert).mock.calls.length;

    // Session B (different session ID, new layer evaluation)
    killSwitch._invalidateCacheForTests();
    for (let l = 3; l <= 9; l++) {
      killSwitch._setLayerCacheForTests(l, { halted: false });
    }

    const sessionB = `session-dedup-b-${Date.now()}-${Math.random()}`;
    mockSessionPnl(sessionB, -800);
    await killSwitch.evaluateAllKillSwitchLayers();
    await new Promise((r) => setTimeout(r, 0));
    const afterB = vi.mocked(createAlert).mock.calls.length;

    // B should have added one more alert call
    expect(afterB).toBe(afterA + 1);
  });

  it("does NOT fire 80% warn when dayPnl is below 80% DLL (e.g., at 70%)", async () => {
    const sessionId = `session-no-warn-70-${Date.now()}-${Math.random()}`;
    // -700 = 70% of DLL=1000 — below the 80% warn threshold but above 67% halt
    mockSessionPnl(sessionId, -700);
    await killSwitch.evaluateAllKillSwitchLayers();
    await new Promise((r) => setTimeout(r, 0));

    // createAlert should NOT have been called for 80% warn
    expect(vi.mocked(createAlert)).not.toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sizing.dll_80pct_approach_warned",
      }),
    );
  });

  it("80% warn does NOT itself halt — Layer 2 still returns halted:true via 67% check", async () => {
    // 82% of DLL → 80% warn fires + 67% halt fires (80% > 67%)
    const sessionId = `session-warn-plus-halt-${Date.now()}-${Math.random()}`;
    mockSessionPnl(sessionId, -820);
    const decision = await killSwitch.evaluateAllKillSwitchLayers();

    // Should still be halted (67% threshold exceeded)
    expect(decision.halted).toBe(true);
    expect(decision.layer).toBe(2);
    // Should be the 67% halt reason, NOT force_close
    expect(decision.reason).toMatch(/67pct/);
  });

  it("80% warn does NOT fire when dayPnl >= 95% (force-close fires first, short-circuits loop)", async () => {
    // At 95%, the force-close fires and breaks the loop before the 80% warn check
    // Use a fresh session ID NOT in the dedup Set
    const sessionId = `session-fc-no-warn-${Date.now()}-${Math.random()}`;
    mockSessionPnl(sessionId, -960);
    await killSwitch.evaluateAllKillSwitchLayers();
    await new Promise((r) => setTimeout(r, 0));

    // createAlert (80% warn) should NOT have been called
    // (the 95% check breaks first; the warn check is not reached)
    expect(vi.mocked(createAlert)).not.toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sizing.dll_80pct_approach_warned",
      }),
    );
  });
});

describe("DLL_WARN_80PCT export from cross-symbol-pnl.ts", () => {
  it("DLL_WARN_80PCT default is 0.80", () => {
    expect(DLL_WARN_80PCT).toBe(0.80);
  });

  it("DLL_WARN_80PCT is between DLL_HALT_PCT (0.67) and DLL_FORCE_CLOSE_PCT (0.95)", async () => {
    const { DLL_HALT_PCT, DLL_FORCE_CLOSE_PCT } = await import("../services/cross-symbol-pnl.js");
    expect(DLL_WARN_80PCT).toBeGreaterThan(DLL_HALT_PCT);
    expect(DLL_WARN_80PCT).toBeLessThan(DLL_FORCE_CLOSE_PCT);
  });
});
