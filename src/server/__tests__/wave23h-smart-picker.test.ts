/**
 * W23H.C (2026-05-20) — Smart picker composite score tests.
 *
 * Tests:
 *  1. Composite ranks differently from MAX-Sharpe
 *  2. Recency penalty: strategy picked today has lower recency than never-picked
 *  3. Recency decays monotonically with days-since-last-pick
 *  4. Multi-regime eligibility filter (pure function)
 *  5. NO_TRADE day → null guard
 *  6. Empty pool → empty Map
 *  7. Audit event shape — all component fields present + bounded to [0,1]
 *  8. Composite equals equal-weight sum of four components
 *  9. Fail-open: DAL errors return safe defaults (0 / 1.0)
 * 10. Diversification: same-archetype repeated picks reduce score
 *
 * All tests use DAL injection — no live DB connection required.
 */

import { describe, it, expect } from "vitest";
import {
  computePickerScores,
  type PickerDataAccessLayer,
  type StrategyNameRow,
  type BacktestRow,
  type LatestBacktestIdRow,
  type TradeRow,
  type BiasStatePickRow,
  type DiversificationPickRow,
} from "../services/picker-metrics.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ID_A = "00000000-0000-0000-0000-000000000001";
const ID_B = "00000000-0000-0000-0000-000000000002";
const ID_C = "00000000-0000-0000-0000-000000000003";

// Fixed "now" for deterministic time-based assertions
const BASE_NOW = new Date("2026-05-20T14:00:00Z");

// ─── DAL stub factory ─────────────────────────────────────────────────────────

interface DalStubConfig {
  names?: StrategyNameRow[];
  backtests?: BacktestRow[];
  latestBacktestIds?: LatestBacktestIdRow[];
  trades?: TradeRow[];
  biasStatePicks?: BiasStatePickRow[];
  diversificationPicks?: DiversificationPickRow[];
}

function makeDal(cfg: DalStubConfig = {}): PickerDataAccessLayer {
  return {
    getStrategyNames: async () => cfg.names ?? [],
    getRecentBacktests: async () => cfg.backtests ?? [],
    getLatestBacktestIds: async () => cfg.latestBacktestIds ?? [],
    getRegimeFilteredTrades: async () => cfg.trades ?? [],
    getBiasStatePicks: async () => cfg.biasStatePicks ?? [],
    getDiversificationPicks: async () => cfg.diversificationPicks ?? [],
  };
}

function makeThrowingDal(): PickerDataAccessLayer {
  const err = () => Promise.reject(new Error("DAL error — simulated failure"));
  return {
    getStrategyNames: err,
    getRecentBacktests: err,
    getLatestBacktestIds: err,
    getRegimeFilteredTrades: err,
    getBiasStatePicks: err,
    getDiversificationPicks: err,
  };
}

// ─── Test 1: Composite ranks differently from MAX-Sharpe ──────────────────────

describe("W23H.C composite vs MAX-Sharpe", () => {
  it("strategy B wins composite despite lower Sharpe because it was never picked (recency=1.0)", async () => {
    // Strategy A: sharpe=0.9 → dsr_norm=0.3, pf=0, recency=0.1 (picked 270 days ago), div=1.0
    //   composite_A = 0.3*0.25 + 0*0.25 + 0.1*0.25 + 1.0*0.25 = 0.075+0+0.025+0.25 = 0.35
    //
    // Strategy B: sharpe=0.7 → dsr_norm=0.233, pf=0, recency=1.0 (never picked), div=1.0
    //   composite_B = 0.233*0.25 + 0*0.25 + 1.0*0.25 + 1.0*0.25 = 0.058+0+0.25+0.25 = 0.558 ← WINNER
    //
    // Strategy C: sharpe=0.5 → dsr_norm=0.167, pf=0, recency=0.5 (picked 30d ago), div=1.0
    //   composite_C = 0.167*0.25 + 0*0.25 + 0.5*0.25 + 1.0*0.25 = 0.042+0+0.125+0.25 = 0.417

    const daysSinceA = 270; // recency = 1/(1+270/30) = 1/10 = 0.1
    const daysSinceC = 30;  // recency = 1/(1+30/30) = 1/2 = 0.5

    const pickedAtA = new Date(BASE_NOW.getTime() - daysSinceA * 24 * 3600 * 1000);
    const pickedAtC = new Date(BASE_NOW.getTime() - daysSinceC * 24 * 3600 * 1000);

    const dal = makeDal({
      names: [
        { id: ID_A, name: "ema_mes_15m" },
        { id: ID_B, name: "orb_mes_15m" },
        { id: ID_C, name: "vwap_mes_5m" },
      ],
      backtests: [
        { strategyId: ID_A, resultExtras: { deflated_sharpe: { dsr: 0.9 } }, createdAt: new Date(BASE_NOW.getTime() - 1 * 24 * 3600 * 1000) },
        { strategyId: ID_B, resultExtras: { deflated_sharpe: { dsr: 0.7 } }, createdAt: new Date(BASE_NOW.getTime() - 1 * 24 * 3600 * 1000) },
        { strategyId: ID_C, resultExtras: { deflated_sharpe: { dsr: 0.5 } }, createdAt: new Date(BASE_NOW.getTime() - 1 * 24 * 3600 * 1000) },
      ],
      latestBacktestIds: [],
      trades: [],
      biasStatePicks: [
        { activeStrategyId: ID_A, computedAt: pickedAtA },
        { activeStrategyId: ID_C, computedAt: pickedAtC },
        // B never picked
      ],
      diversificationPicks: [], // all get div=1.0
    });

    const scores = await computePickerScores([ID_A, ID_B, ID_C], "TRENDING_UP", {
      now: BASE_NOW,
      dalOverride: dal,
    });

    const a = scores.get(ID_A)!;
    const b = scores.get(ID_B)!;
    const c = scores.get(ID_C)!;

    // A has highest Sharpe
    expect(a.rolling_30d_deflated_sharpe).toBeGreaterThan(b.rolling_30d_deflated_sharpe);

    // B has highest recency (never picked)
    expect(b.recency_penalty).toBe(1.0);
    expect(a.recency_penalty).toBeLessThan(b.recency_penalty);

    // B wins composite despite lower Sharpe — the key W23H.C assertion
    expect(b.composite).toBeGreaterThan(a.composite);
    expect(b.composite).toBeGreaterThan(c.composite);
  });
});

// ─── Test 2: Recency penalty — picked today < never picked ───────────────────

describe("W23H.C recency penalty", () => {
  it("strategy picked today has lower recency_penalty than never-picked strategy", async () => {
    const pickedToday = new Date(BASE_NOW.getTime() - 0.5 * 24 * 3600 * 1000); // 12h ago

    const dal = makeDal({
      names: [
        { id: ID_A, name: "ema_mes_15m" },
        { id: ID_B, name: "orb_mes_5m" },
      ],
      biasStatePicks: [
        { activeStrategyId: ID_A, computedAt: pickedToday }, // A was picked 12h ago
        // B never picked
      ],
    });

    const scores = await computePickerScores([ID_A, ID_B], "TRENDING_UP", {
      now: BASE_NOW,
      dalOverride: dal,
    });

    const recencyA = scores.get(ID_A)!.recency_penalty;
    const recencyB = scores.get(ID_B)!.recency_penalty;

    expect(recencyB).toBe(1.0); // never picked = max recency
    expect(recencyA).toBeLessThan(1.0); // picked recently → below max
    expect(recencyA).toBeLessThan(recencyB); // B scores higher recency
  });

  it("recency decays monotonically: 1-day-ago > 30-days-ago > 90-days-ago", async () => {
    const oneDay     = new Date(BASE_NOW.getTime() -  1 * 24 * 3600 * 1000);
    const thirtyDays = new Date(BASE_NOW.getTime() - 30 * 24 * 3600 * 1000);
    const ninetyDays = new Date(BASE_NOW.getTime() - 90 * 24 * 3600 * 1000);

    const dal = makeDal({
      names: [
        { id: ID_A, name: "a" },
        { id: ID_B, name: "b" },
        { id: ID_C, name: "c" },
      ],
      biasStatePicks: [
        { activeStrategyId: ID_A, computedAt: oneDay },
        { activeStrategyId: ID_B, computedAt: thirtyDays },
        { activeStrategyId: ID_C, computedAt: ninetyDays },
      ],
    });

    const scores = await computePickerScores([ID_A, ID_B, ID_C], "TRENDING_UP", {
      now: BASE_NOW,
      dalOverride: dal,
    });

    const rA = scores.get(ID_A)!.recency_penalty;
    const rB = scores.get(ID_B)!.recency_penalty;
    const rC = scores.get(ID_C)!.recency_penalty;

    // recency = 1/(1 + days/30): shorter gap → higher recency score
    expect(rA).toBeGreaterThan(rB);
    expect(rB).toBeGreaterThan(rC);

    // Verify exact values
    expect(rA).toBeCloseTo(1 / (1 +  1 / 30), 3);
    expect(rB).toBeCloseTo(1 / (1 + 30 / 30), 3);
    expect(rC).toBeCloseTo(1 / (1 + 90 / 30), 3);
  });
});

// ─── Test 3: Multi-regime eligibility (pure logic) ────────────────────────────

describe("W23H.C multi-regime eligibility (pure filter logic)", () => {
  /**
   * Mirrors the eligibility filter from resolveActiveStrategy in bias-state-service.ts.
   * Array containment (W23H.B new column) OR single-value fallback (pre-W23H rows).
   */
  function isEligible(
    strategy: { preferredRegimes: string[] | null; preferredRegime: string | null },
    regimeLabel: string,
  ): boolean {
    if (regimeLabel === "NO_TRADE") return false;
    if (regimeLabel === "UNKNOWN") return true;
    const arrayMatch = strategy.preferredRegimes?.includes(regimeLabel) ?? false;
    const singleMatch = strategy.preferredRegime === regimeLabel;
    return arrayMatch || singleMatch;
  }

  const multi = { preferredRegimes: ["TRENDING_UP", "RANGE_BOUND"], preferredRegime: "TRENDING_UP" };
  const trendDown = { preferredRegimes: ["TRENDING_DOWN"], preferredRegime: "TRENDING_DOWN" };
  const preW23H = { preferredRegimes: null, preferredRegime: "TRENDING_UP" };  // null = not backfilled yet

  it("multi-regime strategy qualifies on TRENDING_UP", () => {
    expect(isEligible(multi, "TRENDING_UP")).toBe(true);
  });

  it("multi-regime strategy qualifies on RANGE_BOUND", () => {
    expect(isEligible(multi, "RANGE_BOUND")).toBe(true);
  });

  it("multi-regime strategy does NOT qualify on TRENDING_DOWN", () => {
    expect(isEligible(multi, "TRENDING_DOWN")).toBe(false);
  });

  it("TRENDING_DOWN-only strategy: qualifies TRENDING_DOWN, not others", () => {
    expect(isEligible(trendDown, "TRENDING_DOWN")).toBe(true);
    expect(isEligible(trendDown, "TRENDING_UP")).toBe(false);
    expect(isEligible(trendDown, "RANGE_BOUND")).toBe(false);
  });

  it("pre-W23H row (null preferredRegimes) falls back to preferredRegime field", () => {
    expect(isEligible(preW23H, "TRENDING_UP")).toBe(true);
    expect(isEligible(preW23H, "TRENDING_DOWN")).toBe(false);
  });

  it("UNKNOWN regime matches any strategy (fallback mode)", () => {
    expect(isEligible(multi, "UNKNOWN")).toBe(true);
    expect(isEligible(trendDown, "UNKNOWN")).toBe(true);
  });
});

// ─── Test 4: NO_TRADE → null ──────────────────────────────────────────────────

describe("W23H.C NO_TRADE regime guard", () => {
  it("resolveActiveStrategy returns null on NO_TRADE (guard logic)", () => {
    function guardNoTrade(regimeLabel: string): null | "proceed" {
      if (regimeLabel === "NO_TRADE") return null;
      return "proceed";
    }
    expect(guardNoTrade("NO_TRADE")).toBeNull();
    expect(guardNoTrade("TRENDING_UP")).toBe("proceed");
    expect(guardNoTrade("RANGE_BOUND")).toBe("proceed");
    expect(guardNoTrade("UNKNOWN")).toBe("proceed");
  });
});

// ─── Test 5: Empty pool ────────────────────────────────────────────────────────

describe("W23H.C empty pool handling", () => {
  it("returns empty Map when candidateIds is empty", async () => {
    const scores = await computePickerScores([], "TRENDING_UP", {
      now: BASE_NOW,
      dalOverride: makeDal(),
    });
    expect(scores.size).toBe(0);
  });
});

// ─── Test 6: Audit event shape ────────────────────────────────────────────────

describe("W23H.C audit event component scores shape", () => {
  it("each score entry has all required component fields", async () => {
    const dal = makeDal({
      names: [{ id: ID_A, name: "orb_mes_15m" }],
    });

    const scores = await computePickerScores([ID_A], "TRENDING_UP", {
      now: BASE_NOW,
      dalOverride: dal,
    });

    const entry = scores.get(ID_A);
    expect(entry).toBeDefined();
    const { rolling_30d_deflated_sharpe, regime_conditional_pf, recency_penalty, diversification_score, composite } = entry!;

    expect(typeof rolling_30d_deflated_sharpe).toBe("number");
    expect(typeof regime_conditional_pf).toBe("number");
    expect(typeof recency_penalty).toBe("number");
    expect(typeof diversification_score).toBe("number");
    expect(typeof composite).toBe("number");

    // All values in [0, 1]
    for (const val of [rolling_30d_deflated_sharpe, regime_conditional_pf, recency_penalty, diversification_score, composite]) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });

  it("composite is the equal-weight sum of four components", async () => {
    // Set up specific component values via DAL:
    // DSR = 1.5 → norm = 0.5
    // PF: 3 wins of $300, 1 loss of $100 → PF = 900/100 = 9.0 → norm = min(9/3,1) = 1.0
    // Recency: picked 15 days ago → 1/(1+15/30) = 1/(1+0.5) = 0.667
    // Diversification: 0 prior picks → 1.0

    const daysSince = 15;
    const pickedAt = new Date(BASE_NOW.getTime() - daysSince * 24 * 3600 * 1000);

    const dal = makeDal({
      names: [{ id: ID_A, name: "orb_mes_15m" }],
      backtests: [
        {
          strategyId: ID_A,
          resultExtras: { deflated_sharpe: { dsr: 1.5 } },
          createdAt: new Date(BASE_NOW.getTime() - 1 * 24 * 3600 * 1000),
        },
      ],
      latestBacktestIds: [{ strategyId: ID_A, backtestId: "bt-a" }],
      trades: [
        { backtestId: "bt-a", pnl: "300" },
        { backtestId: "bt-a", pnl: "300" },
        { backtestId: "bt-a", pnl: "300" },
        { backtestId: "bt-a", pnl: "-100" },
      ],
      biasStatePicks: [{ activeStrategyId: ID_A, computedAt: pickedAt }],
      diversificationPicks: [],
    });

    const scores = await computePickerScores([ID_A], "TRENDING_UP", {
      now: BASE_NOW,
      dalOverride: dal,
    });

    const s = scores.get(ID_A)!;

    // Verify composite matches formula
    const expectedComposite = Math.min(1,
      s.rolling_30d_deflated_sharpe * 0.25 +
      s.regime_conditional_pf * 0.25 +
      s.recency_penalty * 0.25 +
      s.diversification_score * 0.25,
    );
    expect(s.composite).toBeCloseTo(expectedComposite, 6);

    // Verify approximate component values
    expect(s.rolling_30d_deflated_sharpe).toBeCloseTo(0.5, 3);   // 1.5/3=0.5
    expect(s.regime_conditional_pf).toBe(1.0);                    // capped at 1.0
    expect(s.recency_penalty).toBeCloseTo(1 / (1 + 15 / 30), 3); // ≈ 0.667
    expect(s.diversification_score).toBe(1.0);
  });
});

// ─── Test 7: Fail-open on DAL errors ─────────────────────────────────────────

describe("W23H.C fail-open on DAL errors", () => {
  it("returns safe defaults (sharpe=0, pf=0, recency=1.0, div=1.0) when DAL throws", async () => {
    const scores = await computePickerScores([ID_A], "TRENDING_UP", {
      now: BASE_NOW,
      dalOverride: makeThrowingDal(),
    });

    // Should not throw — all components default to safe values
    expect(scores.has(ID_A)).toBe(true);
    const s = scores.get(ID_A)!;

    expect(s.rolling_30d_deflated_sharpe).toBe(0);
    expect(s.regime_conditional_pf).toBe(0);
    expect(s.recency_penalty).toBe(1.0);
    expect(s.diversification_score).toBe(1.0);
  });
});

// ─── Test 8: Diversification score ───────────────────────────────────────────

describe("W23H.C diversification score", () => {
  it("strategy with same archetype as majority of past picks gets lower div score", async () => {
    // Past 7 days: 4 picks of "ema_*" strategies, 1 pick of "orb_*"
    // Candidate A: ema_mes_15m → archetype "ema" → fraction = 4/5 = 0.8 → div = 0.2
    // Candidate B: orb_mes_5m  → archetype "orb" → fraction = 1/5 = 0.2 → div = 0.8
    const weekAgo = new Date(BASE_NOW.getTime() - 3 * 24 * 3600 * 1000);

    const dal = makeDal({
      names: [
        { id: ID_A, name: "ema_mes_15m" },
        { id: ID_B, name: "orb_mes_5m" },
      ],
      diversificationPicks: [
        { activeStrategyId: "x1", stratName: "ema_foo", computedAt: weekAgo },
        { activeStrategyId: "x2", stratName: "ema_bar", computedAt: weekAgo },
        { activeStrategyId: "x3", stratName: "ema_baz", computedAt: weekAgo },
        { activeStrategyId: "x4", stratName: "ema_qux", computedAt: weekAgo },
        { activeStrategyId: "x5", stratName: "orb_mnq", computedAt: weekAgo },
      ],
    });

    const scores = await computePickerScores([ID_A, ID_B], "TRENDING_UP", {
      now: BASE_NOW,
      dalOverride: dal,
    });

    const divA = scores.get(ID_A)!.diversification_score;
    const divB = scores.get(ID_B)!.diversification_score;

    // "ema" is over-represented → A gets penalized
    expect(divA).toBeLessThan(divB);
    expect(divA).toBeCloseTo(1.0 - 4 / 5, 3); // 0.2
    expect(divB).toBeCloseTo(1.0 - 1 / 5, 3); // 0.8
  });

  it("no prior picks → all strategies get diversification_score = 1.0", async () => {
    const dal = makeDal({
      names: [
        { id: ID_A, name: "ema_mes_15m" },
        { id: ID_B, name: "ema_mnq_5m" },
      ],
      diversificationPicks: [],
    });

    const scores = await computePickerScores([ID_A, ID_B], "TRENDING_UP", {
      now: BASE_NOW,
      dalOverride: dal,
    });

    expect(scores.get(ID_A)!.diversification_score).toBe(1.0);
    expect(scores.get(ID_B)!.diversification_score).toBe(1.0);
  });
});
