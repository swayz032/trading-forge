/**
 * B10 — Minimum Regime Performance (MRP) Tests (W14 Team C Step 2)
 *
 * Tests the MRP computation logic and the soft gate advisory behavior:
 *   1. Per-regime Sharpe computation (mean/std/annualization formula)
 *   2. Minimum selection across regimes (worst-regime Sharpe)
 *   3. Soft gate: mrp_sharpe < 0.5 logs advisory but does NOT block
 *   4. Null handling: no trade data, no regime data, or pre-B10 backtest
 *   5. Regime grouping: UNKNOWN excluded from minimum
 *   6. Minimum 3 trades per regime required
 */

import { describe, it, expect } from "vitest";

// ─── MRP computation logic (mirrors backtest-service.ts fire-and-forget block) ──

const ANNUALIZE = Math.sqrt(252);
const MIN_TRADES_PER_REGIME = 3;
const MRP_SOFT_THRESHOLD = 0.5;

interface MockTrade {
  pnl: number;
  macroRegime: string | null;
}

interface MRPResult {
  mrpSharpe: number | null;
  regimeSharpes: Record<string, number>;
  skipped: boolean;
  skipReason?: string;
}

/**
 * Compute MRP from a list of mock trades. Mirrors the logic in backtest-service.ts.
 */
function computeMRP(trades: MockTrade[]): MRPResult {
  if (trades.length === 0) {
    return { mrpSharpe: null, regimeSharpes: {}, skipped: true, skipReason: "no_trades" };
  }

  // Group by regime
  const byRegime: Record<string, number[]> = {};
  for (const t of trades) {
    const regime = t.macroRegime ?? "UNKNOWN";
    if (!byRegime[regime]) byRegime[regime] = [];
    byRegime[regime].push(t.pnl);
  }

  // Per-regime Sharpe (annualized, min 3 trades, UNKNOWN excluded)
  const regimeSharpes: Record<string, number> = {};
  for (const [regime, pnls] of Object.entries(byRegime)) {
    if (regime === "UNKNOWN" || pnls.length < MIN_TRADES_PER_REGIME) continue;
    const mean = pnls.reduce((s, v) => s + v, 0) / pnls.length;
    const variance = pnls.reduce((s, v) => s + (v - mean) ** 2, 0) / pnls.length;
    const std = Math.sqrt(variance);
    if (std === 0) continue;
    regimeSharpes[regime] = (mean / std) * ANNUALIZE;
  }

  if (Object.keys(regimeSharpes).length === 0) {
    return { mrpSharpe: null, regimeSharpes: {}, skipped: true, skipReason: "no_qualifying_regimes" };
  }

  const mrpSharpe = Math.min(...Object.values(regimeSharpes));
  return { mrpSharpe, regimeSharpes, skipped: false };
}

// ─── MRP soft gate logic (mirrors lifecycle-service.ts advisory check) ─────────

interface MRPGateResult {
  advisory: boolean;    // true = advisory logged (mrp < threshold)
  blocked: boolean;     // always false in soft-gate phase
  mrpSharpe: number | null;
  reason: string;
}

function evaluateMRPGate(mrpSharpe: number | null): MRPGateResult {
  if (mrpSharpe === null) {
    return { advisory: false, blocked: false, mrpSharpe: null, reason: "no_mrp_data_pre_b10" };
  }
  if (mrpSharpe < MRP_SOFT_THRESHOLD) {
    return { advisory: true, blocked: false, mrpSharpe, reason: "mrp_below_threshold_advisory" };
  }
  return { advisory: false, blocked: false, mrpSharpe, reason: "mrp_passed" };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("B10 MRP — per-regime Sharpe computation", () => {
  it("computes correct Sharpe for a single regime", () => {
    // Mean=$100, std = sqrt(mean((100-100)^2 + (200-100)^2 + (0-100)^2)) = sqrt(6666) ≈ 81.65
    // Sharpe = (100 / 81.65) * sqrt(252) ≈ 1.225 * 15.87 ≈ 19.44 (per-trade)
    const trades: MockTrade[] = [
      { pnl: 100, macroRegime: "RISK_ON" },
      { pnl: 200, macroRegime: "RISK_ON" },
      { pnl: 0,   macroRegime: "RISK_ON" },
    ];
    const result = computeMRP(trades);
    expect(result.skipped).toBe(false);
    expect(result.mrpSharpe).not.toBeNull();
    expect(result.regimeSharpes).toHaveProperty("RISK_ON");
    const sharpe = result.regimeSharpes["RISK_ON"]!;
    // mean=100, variance = ((100-100)^2 + (200-100)^2 + (0-100)^2)/3 = 20000/3 = 6666.67, std = 81.65
    // Sharpe = (100/81.65)*sqrt(252)
    expect(sharpe).toBeCloseTo((100 / 81.65) * ANNUALIZE, 0);
  });

  it("finds the MINIMUM Sharpe across regimes (worst case)", () => {
    // RISK_ON has higher Sharpe (all winners), RISK_OFF has lower (mixed)
    const trades: MockTrade[] = [
      // RISK_ON: 3 winning trades — high Sharpe
      { pnl: 500, macroRegime: "RISK_ON" },
      { pnl: 400, macroRegime: "RISK_ON" },
      { pnl: 450, macroRegime: "RISK_ON" },
      // RISK_OFF: 3 mixed trades — lower Sharpe
      { pnl: -300, macroRegime: "RISK_OFF" },
      { pnl: 100,  macroRegime: "RISK_OFF" },
      { pnl: -100, macroRegime: "RISK_OFF" },
    ];
    const result = computeMRP(trades);
    expect(result.skipped).toBe(false);
    expect(result.regimeSharpes).toHaveProperty("RISK_ON");
    expect(result.regimeSharpes).toHaveProperty("RISK_OFF");
    // MRP must be the minimum (RISK_OFF Sharpe is negative here)
    expect(result.mrpSharpe).toBeLessThan(result.regimeSharpes["RISK_ON"]!);
    expect(result.mrpSharpe).toBe(result.regimeSharpes["RISK_OFF"]!);
  });

  it("excludes UNKNOWN regime from MRP minimum", () => {
    const trades: MockTrade[] = [
      { pnl: 100, macroRegime: "RISK_ON" },
      { pnl: 200, macroRegime: "RISK_ON" },
      { pnl: 150, macroRegime: "RISK_ON" },
      // UNKNOWN trades: large negative — should NOT drag down MRP
      { pnl: -9999, macroRegime: null },
      { pnl: -9999, macroRegime: null },
      { pnl: -9999, macroRegime: null },
    ];
    const result = computeMRP(trades);
    expect(result.skipped).toBe(false);
    expect(result.regimeSharpes).not.toHaveProperty("UNKNOWN");
    // MRP should be the RISK_ON Sharpe (positive), not the UNKNOWN regime
    expect(result.mrpSharpe).toBeGreaterThan(0);
  });

  it("skips a regime with fewer than 3 trades", () => {
    const trades: MockTrade[] = [
      { pnl: 100, macroRegime: "RISK_ON" },
      { pnl: 200, macroRegime: "RISK_ON" },
      { pnl: 150, macroRegime: "RISK_ON" },
      // TRANSITION: only 2 trades — below minimum
      { pnl: -500, macroRegime: "TRANSITION" },
      { pnl: -600, macroRegime: "TRANSITION" },
    ];
    const result = computeMRP(trades);
    expect(result.skipped).toBe(false);
    expect(result.regimeSharpes).not.toHaveProperty("TRANSITION");  // excluded (< 3 trades)
    expect(result.regimeSharpes).toHaveProperty("RISK_ON");
  });

  it("skips computation when no regime has >= 3 trades", () => {
    const trades: MockTrade[] = [
      { pnl: 100, macroRegime: "RISK_ON" },
      { pnl: 200, macroRegime: "RISK_ON" },  // only 2 — below minimum
    ];
    const result = computeMRP(trades);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("no_qualifying_regimes");
    expect(result.mrpSharpe).toBeNull();
  });

  it("returns skipped=true with no_trades reason when empty trade list", () => {
    const result = computeMRP([]);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("no_trades");
    expect(result.mrpSharpe).toBeNull();
  });

  it("handles all trades being null macroRegime (all UNKNOWN)", () => {
    const trades: MockTrade[] = [
      { pnl: 100, macroRegime: null },
      { pnl: 200, macroRegime: null },
      { pnl: 300, macroRegime: null },
    ];
    const result = computeMRP(trades);
    // All UNKNOWN — excluded from minimum — no qualifying regimes
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("no_qualifying_regimes");
  });

  it("handles multiple regimes and picks the worst", () => {
    const trades: MockTrade[] = [
      // RISK_ON: steady winners
      { pnl: 100, macroRegime: "RISK_ON" },
      { pnl: 110, macroRegime: "RISK_ON" },
      { pnl: 105, macroRegime: "RISK_ON" },
      // RANGE_BOUND: break-even
      { pnl: 50,  macroRegime: "RANGE_BOUND" },
      { pnl: -50, macroRegime: "RANGE_BOUND" },
      { pnl: 0,   macroRegime: "RANGE_BOUND" },
      // RISK_OFF: losses
      { pnl: -200, macroRegime: "RISK_OFF" },
      { pnl: -150, macroRegime: "RISK_OFF" },
      { pnl: -100, macroRegime: "RISK_OFF" },
    ];
    const result = computeMRP(trades);
    expect(result.skipped).toBe(false);
    expect(Object.keys(result.regimeSharpes).length).toBe(3);
    // RISK_OFF should be the worst
    expect(result.mrpSharpe).toBe(result.regimeSharpes["RISK_OFF"]!);
    expect(result.mrpSharpe).toBeLessThan(result.regimeSharpes["RISK_ON"]!);
  });
});

describe("B10 MRP — soft gate (PAPER → DEPLOY_READY)", () => {
  it("is advisory only when mrp_sharpe < 0.5 (does NOT block)", () => {
    const gate = evaluateMRPGate(0.3);
    expect(gate.advisory).toBe(true);
    expect(gate.blocked).toBe(false);  // CRITICAL: never blocks in soft phase
    expect(gate.reason).toBe("mrp_below_threshold_advisory");
  });

  it("passes without advisory when mrp_sharpe >= 0.5", () => {
    const gate = evaluateMRPGate(0.7);
    expect(gate.advisory).toBe(false);
    expect(gate.blocked).toBe(false);
    expect(gate.reason).toBe("mrp_passed");
  });

  it("passes without advisory when mrp_sharpe is exactly 0.5", () => {
    const gate = evaluateMRPGate(0.5);
    expect(gate.advisory).toBe(false);
    expect(gate.blocked).toBe(false);
    expect(gate.reason).toBe("mrp_passed");
  });

  it("skips advisory when mrp_sharpe is null (pre-B10 backtest)", () => {
    const gate = evaluateMRPGate(null);
    expect(gate.advisory).toBe(false);
    expect(gate.blocked).toBe(false);
    expect(gate.reason).toBe("no_mrp_data_pre_b10");
  });

  it("logs advisory for strongly negative mrp_sharpe (regime failure)", () => {
    const gate = evaluateMRPGate(-1.5);
    expect(gate.advisory).toBe(true);
    expect(gate.blocked).toBe(false);  // still does NOT block
  });

  it("MRP_SOFT_THRESHOLD is 0.5 per Alexander-Fabozzi 2026", () => {
    expect(MRP_SOFT_THRESHOLD).toBe(0.5);
  });

  it("MIN_TRADES_PER_REGIME is 3 (statistical floor)", () => {
    expect(MIN_TRADES_PER_REGIME).toBe(3);
  });
});

describe("B10 MRP — regime isolation (TRENDING vs RANGE_BOUND)", () => {
  it("correctly identifies worst regime when strategy works in TRENDING but fails in RANGE_BOUND", () => {
    const trades: MockTrade[] = [
      // TRENDING: strong positive Sharpe
      { pnl: 500, macroRegime: "TRENDING" },
      { pnl: 450, macroRegime: "TRENDING" },
      { pnl: 520, macroRegime: "TRENDING" },
      { pnl: 480, macroRegime: "TRENDING" },
      { pnl: 510, macroRegime: "TRENDING" },
      // RANGE_BOUND: negative P&L — strategy fails
      { pnl: -200, macroRegime: "RANGE_BOUND" },
      { pnl: -150, macroRegime: "RANGE_BOUND" },
      { pnl: -180, macroRegime: "RANGE_BOUND" },
      { pnl: -160, macroRegime: "RANGE_BOUND" },
    ];
    const result = computeMRP(trades);
    expect(result.skipped).toBe(false);
    // RANGE_BOUND Sharpe is negative
    expect(result.regimeSharpes["RANGE_BOUND"]).toBeLessThan(0);
    // TRENDING Sharpe is high positive
    expect(result.regimeSharpes["TRENDING"]).toBeGreaterThan(0);
    // MRP = worst = RANGE_BOUND
    expect(result.mrpSharpe).toBe(result.regimeSharpes["RANGE_BOUND"]!);
    // MRP < 0.5 → advisory fired
    const gate = evaluateMRPGate(result.mrpSharpe);
    expect(gate.advisory).toBe(true);
    expect(gate.blocked).toBe(false);
  });
});
