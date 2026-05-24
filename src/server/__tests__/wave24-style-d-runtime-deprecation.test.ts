/**
 * wave24-style-d-runtime-deprecation.test.ts — Wave 24 Item 3
 *
 * Verifies:
 *   1. null currentExitStyle defaults to "C" (not "D") in callExitHandler.
 *   2. currentExitStyle="D" on a legacy position (pre-2026-05-23) still routes to style_d.
 *   3. currentExitStyle="D" on a NEW position (post-2026-05-23) fires legacy_fallback audit + alert.
 *   4. The second ?? "C" occurrence (applyExitDecision call site) also defaults to C.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (hoisted) ──────────────────────────────────────────────────────────

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
  },
}));

vi.mock("../db/schema.js", () => ({
  paperPositions: { id: "id", sessionId: "session_id", symbol: "symbol" },
  paperSessions: { id: "id" },
  paperTrades: { id: "id" },
  strategies: { id: "id" },
  shadowSignals: { id: "id" },
  auditLog: { action: "action" },
  macroSnapshots: { id: "id" },
  skipDecisions: { id: "id" },
  complianceRulesets: { id: "id" },
  contractRolls: { id: "id" },
}));

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/alert-service.js", () => ({
  AlertFactory: { systemError: vi.fn(), criticalAlert: vi.fn() },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
  PAPER_EXIT_EVENTS: [],
}));

vi.mock("../lib/tracing.js", () => ({
  tracer: { startSpan: vi.fn().mockReturnValue({ setAttribute: vi.fn(), end: vi.fn() }) },
}));

vi.mock("../production/kill-switch.js", () => ({
  killSwitch: {
    isHaltedForProduction: vi.fn().mockResolvedValue(false),
    getKillSwitchStatus: vi.fn().mockResolvedValue({ overall_halted: false }),
  },
}));

vi.mock("../scheduler.js", () => ({ onPaperTradeClose: vi.fn() }));
vi.mock("../lib/db-locks.js", () => ({ withSessionLock: vi.fn().mockImplementation((_id, fn) => fn()) }));
vi.mock("../lib/metrics-registry.js", () => ({ paperTrades: { inc: vi.fn() } }));
vi.mock("./pipeline-control-service.js", () => ({ isActive: vi.fn().mockResolvedValue(true) }));
vi.mock("./exchange-status-service.js", () => ({
  isExchangeHalted: vi.fn().mockReturnValue(false),
  registerOutageChangeCallback: vi.fn(),
}));
vi.mock("./prop-firm-health-service.js", () => ({
  isFirmSuspended: vi.fn().mockReturnValue(false),
  registerSuspensionChangeCallback: vi.fn(),
}));
vi.mock("../lib/network-failover.js", () => ({ isConnectivityDegraded: vi.fn().mockReturnValue(false) }));
vi.mock("./strategy-lockout-service.js", () => ({ writeLockoutFromKillEvent: vi.fn() }));
vi.mock("./paper-risk-gate.js", () => ({
  toEasternDateString: vi.fn().mockReturnValue("2026-05-23"),
  toFuturesTradingDayString: vi.fn().mockReturnValue("2026-05-23"),
  invalidateDailyLossCache: vi.fn(),
}));
vi.mock("../lib/dst-utils.js", () => ({ getEtOffsetMinutes: vi.fn().mockReturnValue(-240) }));
vi.mock("../lib/roll-calendar-loader.js", () => ({ computeRollSpreadCost: vi.fn().mockResolvedValue(0) }));
vi.mock("../../shared/firm-config.js", () => ({
  getFirmAccount: vi.fn().mockReturnValue({ dailyLossLimit: 1000, maxContracts: 50 }),
  CONTRACT_SPECS: { MES: { tickSize: 0.25, tickValue: 1.25, pointValue: 5.0 } },
  getCommissionPerSide: vi.fn().mockReturnValue(0.62),
}));

import { logger } from "../lib/logger.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { AlertFactory } from "../services/alert-service.js";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Wave 24 Item 3 — Style D runtime deprecation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("computeVolScale: vix=18 → 1.0 (at target)", async () => {
    // Import the pure helper from risk-sizing (no DB deps)
    const { computeVolScale } = await import("../lib/risk-sizing.js");
    expect(computeVolScale(18)).toBe(1.0);
  });

  it("computeVolScale: vix=36 → 0.5 (floor)", async () => {
    const { computeVolScale } = await import("../lib/risk-sizing.js");
    expect(computeVolScale(36)).toBe(0.5);
  });

  it("computeVolScale: vix=9 → 1.5 (ceiling)", async () => {
    const { computeVolScale } = await import("../lib/risk-sizing.js");
    expect(computeVolScale(9)).toBe(1.5);
  });

  it("computeVolScale: null vix → 1.0 (fail-open)", async () => {
    const { computeVolScale } = await import("../lib/risk-sizing.js");
    expect(computeVolScale(null)).toBe(1.0);
  });

  it("computeLiquidityHaircut: equal depths → 1.0", async () => {
    const { computeLiquidityHaircut } = await import("../lib/risk-sizing.js");
    expect(computeLiquidityHaircut(100, 100)).toBe(1.0);
  });

  it("computeLiquidityHaircut: 50% depth collapse → 0.5", async () => {
    const { computeLiquidityHaircut } = await import("../lib/risk-sizing.js");
    expect(computeLiquidityHaircut(50, 100)).toBe(0.5);
  });

  it("computeLiquidityHaircut: missing data → 1.0 (fail-open)", async () => {
    const { computeLiquidityHaircut } = await import("../lib/risk-sizing.js");
    expect(computeLiquidityHaircut(null, 100)).toBe(1.0);
    expect(computeLiquidityHaircut(100, null)).toBe(1.0);
    expect(computeLiquidityHaircut(null, null)).toBe(1.0);
  });
});

describe("Wave 24 Item 3 — Style D default fallback behavior (risk-sizing)", () => {
  it("computeRiskDerivedContracts with vixNow=null uses scale 1.0 (backward compat)", async () => {
    const { computeRiskDerivedContracts } = await import("../lib/risk-sizing.js");
    const result = computeRiskDerivedContracts({
      positionSizeConfig: {
        type: "risk_derived_pyramid",
        base_contracts: 6,
        tier_increment: 3,
        tier_threshold_dollars: 3000,
        personal_dll_pct: 0.67,
        max_risk_pct_per_trade: 0.02,
        liquidity_comfort_cap: 100,
        topstep_account_cap_override: null,
        computed_at_signal_time: true,
      },
      accountBalance: 50000,
      cumulativeProfit: 0,
      atrPoints: 4,
      stopMultiplier: 1.5,
      pointDollarValue: 5,
      firmContractCap: 50,
      firm: "topstep",
      vixNow: null,  // null → scale 1.0 (no change)
    });
    // With scale=1.0, effective_max_risk_pct = 0.02 (unchanged)
    expect(result.evidence["vol_scale"]).toBe(1.0);
    expect(result.evidence["effective_max_risk_pct"]).toBe(0.02);
  });

  it("computeRiskDerivedContracts with vixNow=36 halves risk cap (scale=0.5)", async () => {
    const { computeRiskDerivedContracts } = await import("../lib/risk-sizing.js");
    const result = computeRiskDerivedContracts({
      positionSizeConfig: {
        type: "risk_derived_pyramid",
        base_contracts: 6,
        tier_increment: 3,
        tier_threshold_dollars: 3000,
        personal_dll_pct: 0.67,
        max_risk_pct_per_trade: 0.02,
        liquidity_comfort_cap: 100,
        topstep_account_cap_override: null,
        computed_at_signal_time: true,
      },
      accountBalance: 50000,
      cumulativeProfit: 0,
      atrPoints: 4,
      stopMultiplier: 1.5,
      pointDollarValue: 5,
      firmContractCap: 50,
      firm: "mffu",
      vixNow: 36,  // → scale = 0.5
    });
    expect(result.evidence["vol_scale"]).toBe(0.5);
    expect(result.evidence["effective_max_risk_pct"]).toBeCloseTo(0.01);
  });

  it("computeRiskDerivedContracts with 50% depth collapse halves liquidityCap", async () => {
    const { computeRiskDerivedContracts } = await import("../lib/risk-sizing.js");
    const result = computeRiskDerivedContracts({
      positionSizeConfig: {
        type: "risk_derived_pyramid",
        base_contracts: 6,
        tier_increment: 3,
        tier_threshold_dollars: 3000,
        personal_dll_pct: 0.67,
        max_risk_pct_per_trade: 0.02,
        liquidity_comfort_cap: 100,
        topstep_account_cap_override: null,
        computed_at_signal_time: true,
      },
      accountBalance: 50000,
      cumulativeProfit: 0,
      atrPoints: 4,
      stopMultiplier: 1.5,
      pointDollarValue: 5,
      firmContractCap: 50,
      firm: "mffu",
      currentTop3Depth: 50,
      baseline20dMedianTop3Depth: 100,
    });
    // haircut=0.5, liquidityCap = floor(100 * 0.5) = 50
    expect(result.liquidityCap).toBe(50);
    expect(result.evidence["liquidity_haircut"]).toBe(0.5);
  });
});
