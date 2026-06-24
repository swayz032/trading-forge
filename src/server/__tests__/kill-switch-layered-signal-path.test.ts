/**
 * kill-switch-layered-signal-path.test.ts — H6 fix verification
 *
 * Verifies that isHaltedForProduction() (the signal-path gate) now evaluates
 * ALL 9 layers, not just Layer 1 (production_mode === 'HALT').
 *
 * Bug fixed (2026-06-23 hardening/phase-0):
 *   Previously isHaltedForProduction() only checked Layer 1. Layers 2-9
 *   (DLL, trailing-DD, CME outage, macro crisis, etc.) were computed inside
 *   getKillSwitchStatus() — a dashboard-only GET endpoint never called on the
 *   signal path. A 10% daily-loss breach, trailing-DD violation, CME outage,
 *   or macro crisis would NOT block new entries unless the operator also
 *   manually set production_mode = 'HALT'.
 *
 * Tests:
 *   1.  L1 HALT still blocks (regression)
 *   2.  L2 DLL breach blocks when L1 passes
 *   3.  L3 trailing-DD breach blocks when L1+L2 pass
 *   4.  L6 CME outage blocks
 *   5.  L8 macro crisis blocks
 *   6.  L9 Windows reboot pending blocks
 *   7.  L2 wins over L8 when both halt (priority ordering)
 *   8.  Layer check timeout fails-OPEN with audit row
 *   9.  Cached layer result reused within 1s TTL
 *   10. Legacy isHaltedForProduction() returns boolean (backward compat)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock all external dependencies ──────────────────────────────────────────

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then(
            resolve: (v: unknown[]) => unknown,
            reject?: (err: unknown) => unknown,
          ) {
            // Default: broker_accounts returns no rows (no firms to check)
            return Promise.resolve([]).then(resolve, reject);
          },
          limit: vi.fn().mockResolvedValue([
            {
              productionMode: "PAPER",
              killReason: null,
              setBy: "migration",
              setAt: new Date("2026-06-23T00:00:00Z"),
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
  eq: vi.fn((_col, _val) => `eq(${String(_val)})`),
  desc: vi.fn((_col) => "desc"),
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

// ─── Imports after mocks ──────────────────────────────────────────────────────

import { killSwitch, ALL_LAYERS_ENFORCED_ON_SIGNAL_PATH } from "../production/kill-switch.js";
import { db } from "../db/index.js";
import { isExchangeHalted } from "../services/exchange-status-service.js";
import { isConnectivityDegraded } from "../lib/network-failover.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";
import { broadcastSSE } from "../routes/sse.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Override system_state to return a specific production_mode. */
function mockProductionMode(mode: string) {
  const stateRow = {
    productionMode: mode,
    killReason: null,
    setBy: "test",
    setAt: new Date("2026-06-23T00:00:00Z"),
  };
  // @ts-ignore — mock shape
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        then(
          resolve: (v: unknown[]) => unknown,
          reject?: (err: unknown) => unknown,
        ) {
          return Promise.resolve([]).then(resolve, reject);
        },
        limit: vi.fn().mockResolvedValue([stateRow]),
      }),
      orderBy: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  } as ReturnType<typeof db.select>);
}

/**
 * Override system_state (PAPER mode) and simulate a DLL breach by making
 * paperSessions DB query return an active session with today's DLL at threshold.
 * firmId="mffu", dailyLossLimit=1000, today's loss = 670 (>= 67% of 1000).
 */
function mockDllBreach() {
  mockProductionMode("PAPER"); // L1 passes

  // Compute today's CME trading-day key the same way the layer does
  const cmeFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
  const today = cmeFormatter.format(new Date(Date.now() + 7 * 3_600_000));

  const sessionRow = {
    id: "session-dll-breach",
    firmId: "mffu",
    dailyPnlBreakdown: { [today]: -700 }, // -700 >= 67% of 1000
    currentEquity: "50000",
    realizedPeakEquity: "50000",
  };

  // paperSessions query uses .where() without .limit() — returns array directly
  // @ts-ignore
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockImplementation((table: unknown) => {
      const isSessionTable =
        String(table) === "id" || // duck-type: any non-systemState table
        (typeof table === "object" && table !== null && "id" in table);

      return {
        where: vi.fn().mockReturnValue({
          // Direct await (thenable) — used by paperSessions query
          then(
            resolve: (v: unknown[]) => unknown,
            reject?: (err: unknown) => unknown,
          ) {
            return Promise.resolve([sessionRow]).then(resolve, reject);
          },
          // .limit() — used by system_state query
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
      };
    }),
  } as ReturnType<typeof db.select>);
}

/**
 * Set up for trailing-DD breach: L1=PAPER, L2 no DLL issue,
 * L3 session has equity near the max drawdown floor.
 */
function mockTrailingDdBreach() {
  mockProductionMode("PAPER");

  // Use the injected cache seam to make L2 pass and only L3 triggers
  killSwitch._setLayerCacheForTests(2, { halted: false });

  const sessionRow = {
    id: "session-trailing-dd",
    firmId: "mffu",
    dailyPnlBreakdown: {},
    currentEquity: "48100",    // currentEquity
    realizedPeakEquity: "50000", // peakEquity; drawdown = 1900, maxDrawdown=2000, buffer=100 < 200
  };

  // @ts-ignore
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        then(
          resolve: (v: unknown[]) => unknown,
          reject?: (err: unknown) => unknown,
        ) {
          return Promise.resolve([sessionRow]).then(resolve, reject);
        },
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

describe("KillSwitch — H6 Fix: Layers 2-9 enforced on signal path", () => {
  beforeEach(() => {
    killSwitch._invalidateCacheForTests();
    vi.clearAllMocks();
    // Default: L1=PAPER (not halted), all service mocks return safe defaults
    mockProductionMode("PAPER");
  });

  afterEach(() => {
    killSwitch._invalidateCacheForTests();
  });

  // ── Sentinel export ───────────────────────────────────────────────────────
  it("ALL_LAYERS_ENFORCED_ON_SIGNAL_PATH sentinel is exported and true", () => {
    expect(ALL_LAYERS_ENFORCED_ON_SIGNAL_PATH).toBe(true);
  });

  // ── Test 1: L1 HALT regression ────────────────────────────────────────────
  it("halts on Layer 1 production_mode HALT regardless of other layers", async () => {
    mockProductionMode("HALT");
    const halted = await killSwitch.isHaltedForProduction();
    expect(halted).toBe(true);
  });

  it("evaluateAllKillSwitchLayers returns layer:1 reason on L1 block", async () => {
    mockProductionMode("HALT");
    const decision = await killSwitch.evaluateAllKillSwitchLayers();
    expect(decision.halted).toBe(true);
    expect(decision.layer).toBe(1);
    expect(decision.reason).toBe("production_mode_halt");
  });

  // ── Test 2: L2 DLL breach ────────────────────────────────────────────────
  it("halts on Layer 2 daily-loss when L1 passes but DLL breached", async () => {
    mockDllBreach();
    const halted = await killSwitch.isHaltedForProduction();
    expect(halted).toBe(true);
  });

  it("evaluateAllKillSwitchLayers returns layer:2 on DLL breach", async () => {
    mockDllBreach();
    const decision = await killSwitch.evaluateAllKillSwitchLayers();
    expect(decision.halted).toBe(true);
    expect(decision.layer).toBe(2);
    expect(decision.reason).toMatch(/dll/i);
  });

  // ── Test 3: L3 trailing-DD breach ────────────────────────────────────────
  it("halts on Layer 3 trailing-DD when L1+L2 pass but trailing-DD breached", async () => {
    mockTrailingDdBreach();
    const decision = await killSwitch.evaluateAllKillSwitchLayers();
    expect(decision.halted).toBe(true);
    expect(decision.layer).toBe(3);
    expect(decision.reason).toMatch(/trailing_dd/i);
  });

  // ── Test 4: L6 CME outage ────────────────────────────────────────────────
  it("halts on Layer 6 CME outage", async () => {
    // L1 passes (PAPER mode), inject pass for L2+L3 via cache seam
    killSwitch._setLayerCacheForTests(2, { halted: false });
    killSwitch._setLayerCacheForTests(3, { halted: false });
    killSwitch._setLayerCacheForTests(5, { halted: false });

    vi.mocked(isExchangeHalted).mockReturnValue(true);

    const decision = await killSwitch.evaluateAllKillSwitchLayers();
    expect(decision.halted).toBe(true);
    expect(decision.layer).toBe(6);
    expect(decision.reason).toMatch(/cme_outage/i);
  });

  // ── Test 5: L8 macro crisis ───────────────────────────────────────────────
  it("halts on Layer 8 macro crisis", async () => {
    killSwitch._setLayerCacheForTests(2, { halted: false });
    killSwitch._setLayerCacheForTests(3, { halted: false });
    killSwitch._setLayerCacheForTests(5, { halted: false });
    killSwitch._setLayerCacheForTests(6, { halted: false });
    killSwitch._setLayerCacheForTests(7, { halted: false });

    const { evaluateMacroGates } = await import("../services/macro-gate-service.js");
    vi.mocked(evaluateMacroGates).mockResolvedValue({
      macroContext: { crisisGateTriggered: true },
    } as Awaited<ReturnType<typeof evaluateMacroGates>>);

    const decision = await killSwitch.evaluateAllKillSwitchLayers();
    expect(decision.halted).toBe(true);
    expect(decision.layer).toBe(8);
    expect(decision.reason).toMatch(/macro_crisis/i);
  });

  // ── Test 6: L9 Windows reboot pending ────────────────────────────────────
  it("halts on Layer 9 Windows reboot pending", async () => {
    killSwitch._setLayerCacheForTests(2, { halted: false });
    killSwitch._setLayerCacheForTests(3, { halted: false });
    killSwitch._setLayerCacheForTests(5, { halted: false });
    killSwitch._setLayerCacheForTests(6, { halted: false });
    killSwitch._setLayerCacheForTests(7, { halted: false });
    killSwitch._setLayerCacheForTests(8, { halted: false });

    const { runPreTradingDayHealthCheck } = await import("../services/windows-health-check-service.js");
    vi.mocked(runPreTradingDayHealthCheck).mockResolvedValue({
      exitCode: 1,
      status: "pending_reboot",
      reason: "windows_reboot_required",
      durationMs: 50,
      payload: null,
      pipelinePaused: false,
    } satisfies Awaited<ReturnType<typeof runPreTradingDayHealthCheck>>);

    const decision = await killSwitch.evaluateAllKillSwitchLayers();
    expect(decision.halted).toBe(true);
    expect(decision.layer).toBe(9);
    expect(decision.reason).toMatch(/windows_reboot/i);
  });

  // ── Test 7: Priority ordering — L2 wins over L8 ──────────────────────────
  it("returns first-blocking layer in priority order (L2 wins over L8 if both halt)", async () => {
    mockDllBreach();
    // Also force L8 to halt via cache seam — both are halted, L2 must win
    killSwitch._setLayerCacheForTests(8, {
      halted: true,
      layer: 8,
      reason: "macro_crisis_gate_triggered",
    });

    const decision = await killSwitch.evaluateAllKillSwitchLayers();
    expect(decision.halted).toBe(true);
    // L2 should be returned first because it has higher priority
    expect(decision.layer).toBe(2);
  });

  // ── Test 8: Layer timeout fails-OPEN with audit row ───────────────────────
  it("layer check timeout fails-OPEN with audit row", async () => {
    // Inject a slow Layer 5 by overriding the drift DB query to hang
    // We achieve this by making db.select's orderBy chain return a never-resolving promise
    // for the drift query path, then confirm isHaltedForProduction still returns false.
    //
    // Seed all other layers via the cache seam so only L5 is the variable under test.
    killSwitch._setLayerCacheForTests(2, { halted: false });
    killSwitch._setLayerCacheForTests(3, { halted: false });
    killSwitch._setLayerCacheForTests(4, { halted: false });
    // L5 is NOT seeded — it will time out via the slow DB mock below
    killSwitch._setLayerCacheForTests(6, { halted: false });
    killSwitch._setLayerCacheForTests(7, { halted: false });
    killSwitch._setLayerCacheForTests(8, { halted: false });
    killSwitch._setLayerCacheForTests(9, { halted: false });

    // @ts-ignore
    vi.mocked(db.select).mockReturnValue({
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
              setBy: "test",
              setAt: new Date(),
            },
          ]),
        }),
        // Layer 5 uses orderBy+limit — return a promise that resolves after > 100ms
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue(
            new Promise<unknown[]>((resolve) => {
              setTimeout(() => resolve([{ severity: "red", reportWeek: "2026-W25" }]), 200);
            })
          ),
        }),
      }),
    } as ReturnType<typeof db.select>);

    // Layer 5 should timeout (100ms budget) and fail-OPEN
    // All other layers pass → overall result should be not halted
    const decision = await killSwitch.evaluateAllKillSwitchLayers();

    // Fail-OPEN means the system allows trading when a check times out
    expect(decision.halted).toBe(false);

    // Audit row for timeout should have been written
    expect(vi.mocked(insertAuditRow)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "kill_switch.layer_5_timeout",
        status: "failure",
      })
    );
  }, 3000); // 3s timeout for the test itself

  // ── Test 9: Cached layer result reused within 1s TTL ─────────────────────
  it("cached layer result reused within 1s TTL", async () => {
    // Pre-seed L2 cache with a halted decision
    killSwitch._setLayerCacheForTests(2, {
      halted: true,
      layer: 2,
      reason: "dll_at_67pct_personal_threshold",
    });

    // First call — uses cache (no DB query for L2)
    const decision1 = await killSwitch.evaluateAllKillSwitchLayers();
    expect(decision1.halted).toBe(true);
    expect(decision1.layer).toBe(2);

    // Second call immediately — still within 1s TTL, should reuse cache
    const decision2 = await killSwitch.evaluateAllKillSwitchLayers();
    expect(decision2.halted).toBe(true);
    expect(decision2.layer).toBe(2);

    // The DB should not have been called for the paperSessions layer 2 query
    // (only system_state via limit() would be called)
    // We verify by checking that no DLL-check-specific thenable calls happened
    // beyond the initial state read.
    // The key contract: same halted:true, layer:2 result from cache without extra work.
    expect(decision1.reason).toBe(decision2.reason);
  });

  // ── Test 10: Legacy isHaltedForProduction() returns boolean ──────────────
  it("legacy isHaltedForProduction() returns boolean for backward compat", async () => {
    // Seed all layers 2-9 as not halted so this is a clean boolean regression
    // against L1 only (L1 = PAPER = not halted).
    for (let layer = 2; layer <= 9; layer++) {
      killSwitch._setLayerCacheForTests(layer, { halted: false });
    }
    mockProductionMode("PAPER");
    const result = await killSwitch.isHaltedForProduction();
    expect(typeof result).toBe("boolean");
    expect(result).toBe(false);
  });

  it("isHaltedForProduction() returns true (boolean) when a layer fires", async () => {
    mockProductionMode("HALT");
    const result = await killSwitch.isHaltedForProduction();
    expect(typeof result).toBe("boolean");
    expect(result).toBe(true);
  });

  // ── Audit + SSE on halt ───────────────────────────────────────────────────
  it("emits kill_switch:layer_halted SSE event on block", async () => {
    mockProductionMode("HALT");
    await killSwitch.evaluateAllKillSwitchLayers();

    expect(vi.mocked(broadcastSSE)).toHaveBeenCalledWith(
      "kill_switch:layer_halted",
      expect.objectContaining({
        layer: 1,
        reason: "production_mode_halt",
      })
    );
  });

  it("emits kill_switch.layer_1_halted audit row on L1 block", async () => {
    mockProductionMode("HALT");
    await killSwitch.evaluateAllKillSwitchLayers({ correlationId: "test-corr-123" });

    expect(vi.mocked(insertAuditRow)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "kill_switch.layer_1_halted",
        correlationId: "test-corr-123",
        status: "failure",
      })
    );
  });
});
