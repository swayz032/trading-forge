import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../db/index.js", () => ({ db: { execute: mocks.execute } }));

const ORDER = ["strategy", "backtest", "mc", "frankenstein", "blackSwan", "paper", "shadow", "health"] as const;

// FIX (fix-wave telemetry-honesty-registry-dashboards, 2026-07-17 — CRIT
// finding): these fixtures previously used `total_pnl` / `trade_count` /
// `result_json` / `percentile_5` / `percentile_50` / `percentile_95` — NONE
// of which exist on the real `backtests` / `monte_carlo_runs` tables
// (verified against schema.ts). Because this suite mocks `db.execute`
// unconditionally (it never validates the SQL text against a real schema),
// the fixtures could drift arbitrarily far from reality while staying green
// — the exact "fabricated mock masks a real bug" failure class. Corrected to
// the real column shapes; see src/server/__tests__/slumhouse/
// recipe-data-pglite.test.ts for the schema-validating regression test that
// would have (and did) catch the original mismatch.
//
// `total_trades` is the real column (was `trade_count`). There is no scalar
// total-P&L column at all — recipe-data.ts now derives totalMade by summing
// daily_pnls, so `totalMade` in these fixtures is whatever daily_pnls sums to
// (+28 for the default 118+340-430 daily_pnls below), not an independently
// stamped number.
//
// Monte Carlo: `risk_metrics` (jsonb, carries `probability_of_ruin_ci.
// ci_high`) + `paths` (jsonb, `number[][]` of sampled equity curves per
// src/engine/monte_carlo.py::_sample_paths — [initial_capital, ...equity];
// terminal P&L = last - first) are the real columns (were `result_json`).
function setupQueries(custom: Partial<Record<typeof ORDER[number], unknown[]>> = {}) {
  const responses: Record<string, unknown[]> = {
    strategy: [{ id: "s1", name: "vwap-band-mes", symbol: "MES", symbols: ["MES"], timeframe: "5m", config: {}, lifecycle_state: "DEPLOY_READY" }],
    backtest: [{
      total_trades: 1283,
      daily_pnls: JSON.stringify([
        { date: "2026-05-01", pnl: 118 }, { date: "2026-05-02", pnl: 340 }, { date: "2026-05-03", pnl: -430 },
      ]),
      equity_curve: JSON.stringify([0, 500, 1200, 2300]),
      win_rate: 0.61, sharpe_ratio: 1.75, profit_factor: 1.92, max_drawdown: 0.08,
      walk_forward_results: JSON.stringify({ wfe_overall: 0.78, folds: [0.72, 0.81, 0.8] }),
      b15_battery: JSON.stringify({ passed: true, sdr: 0.91, psi: 0.03, rws: 0.12 }),
      mrp_regime_breakdown: JSON.stringify({ trend: 1.2, chop: 0.7 }),
      prop_compliance: JSON.stringify({ pass_rate: 1 }),
      result_extras: JSON.stringify({
        wfe_overall: 0.01, b15_passed: false, a14_severity: "warn",
        b10_pass: false, frankenstein_pass: false, compliance_pass_rate: 0,
        sharpe_ratio: 9.99,
      }),
    }],
    frankenstein: [{ passed: true, p95_sharpe: 0.21, median_pf: 1.02 }],
    blackSwan: [{ survival_rate: 0.8, num_regimes_tested: 5, num_regimes_survived: 4, worst_regime_drawdown: 0.12, worst_regime_label: "2008" }],
    mc: [{
      risk_metrics: JSON.stringify({ probability_of_ruin_ci: { ci_high: 0.03 } }),
      paths: JSON.stringify([[50000, 47160], [50000, 92500], [50000, 144200]]), // terminal P&L: -2840, 42500, 94200
      probability_of_ruin: 0.03,
    }],
    paper: [{ paper_total: 3840, paper_count: 12 }],
    shadow: [{ divergence_vs_backtest: 0.018 }],
    health: [{ composite_score: 0.84 }],
    ...custom,
  };
  let i = 0;
  mocks.execute.mockReset();
  mocks.execute.mockImplementation(() => Promise.resolve(responses[ORDER[i++]] ?? []));
}

describe("recipe-data", () => {
  beforeEach(() => { mocks.execute.mockReset(); });

  it("binds completed downstream evidence to the exact rendered backtest", async () => {
    setupQueries();
    const { assembleRecipeData } = await import("../../lib/slumhouse/recipe-data.js");
    await assembleRecipeData({ strategyId: "s1" });
    const flatten = (value: any): string => {
      if (typeof value === "string") return value;
      if (!value || typeof value !== "object") return "";
      if (Array.isArray(value)) return value.map(flatten).join(" ");
      return flatten(value.queryChunks || value.value || []);
    };
    const queries = mocks.execute.mock.calls.map(([query]) => flatten(query));
    expect(queries[1]).toContain("SELECT id::text AS backtest_id");
    expect(queries[2]).toContain("mc.backtest_id =");
    expect(queries[3]).toContain("backtest_id =");
    expect(queries[4]).toContain("backtest_id =");
  });

  it("treats zero-PnL paper trades as measured evidence and missing compliance as neutral", async () => {
    setupQueries({
      backtest: [{ total_trades: 1, daily_pnls: "[]", equity_curve: "[]", result_extras: "{}" }],
      paper: [{ paper_total: 0, paper_count: 2 }],
    });
    const { assembleRecipeData } = await import("../../lib/slumhouse/recipe-data.js");
    const r = await assembleRecipeData({ strategyId: "s1" });
    expect(r.gateMetrics.Preseason.value).toBe("$0");
    expect(r.gateMetrics.Preseason.instrument).toMatchObject({ pnl: 0, tradeCount: 2 });
    expect(r.otherTests.find((test) => test.name === "Plays Clean")?.sentence).toContain("hasn't been run yet");
    expect(r.gateMetrics["Plays Clean"].value).toBe("Not run yet");
  });

  it("normalizes null symbols exactly like the Kitchen/Menu identity path", async () => {
    setupQueries({ strategy: [{ id: "s1", name: "vwap-band-mes", symbol: "MES", symbols: null, timeframe: "5m", config: {}, lifecycle_state: "DEPLOY_READY" }] });
    const { assembleRecipeData } = await import("../../lib/slumhouse/recipe-data.js");
    const { resolvePremiumName } = await import("../../lib/slumhouse/premium-names.js");
    const recipe = await assembleRecipeData({ strategyId: "s1" });
    expect(recipe.identity.displayName).toBe(resolvePremiumName({ name: "vwap-band-mes", symbols: [], timeframe: "5m", config: {} }).displayName);
  });

  it("assembles all 4 panels + 8 tests with full data", async () => {
    setupQueries();
    const { assembleRecipeData } = await import("../../lib/slumhouse/recipe-data.js");
    const r = await assembleRecipeData({ strategyId: "s1" });

    expect(r.identity.name).toBe("vwap-band-mes");
    const { resolvePremiumName } = await import("../../lib/slumhouse/premium-names.js");
    expect(r.identity.displayName).toBe(resolvePremiumName({ name: "vwap-band-mes", symbols: ["MES"], timeframe: "5m", config: {} }).displayName);
    expect(r.identity.stationStreet).toBe("Small Plates");
    expect(r.slumdawgScore).toBe(84);

    expect(r.backtest.totalMade).toBe("+$28"); // derived: sum of daily_pnls (118 + 340 - 430)
    expect(r.backtest.tradesCount).toBe(1283);
    expect(r.backtest.worstDay).toBe("−$430");
    expect(r.backtest.winningDays).toBe(2);
    expect(r.backtest.sharpeRatio).toBe(1.75);

    expect(r.monteCarlo.blowUpOdds).toBe("3 outta 100");
    expect(r.monteCarlo.worstYear).toBe("−$2,840");
    expect(r.monteCarlo.bestYear).toBe("+$94,200");
    expect(r.monteCarlo.medianYear).toBe("+$42,500");
    expect(r.monteCarlo.verdictGreen).toBe(true);

    expect(r.calendar).toHaveLength(3);
    expect(r.otherTests).toHaveLength(8);
    expect(r.otherTests.find((t) => t.name === "Surprise Test")?.status).toBe("pass");
    expect(r.otherTests.find((t) => t.name === "Sloppy Bot Test")?.status).toBe("pass");
    expect(r.otherTests.find((t) => t.name === "Worst Day Test")?.status).toBe("warn"); // a14_severity=warn
    expect(r.otherTests.find((t) => t.name === "Preseason")?.sentence).toContain("$3,840");
    expect(r.otherTests.find((t) => t.name === "Real-Time Match")?.status).toBe("pass"); // 1.8% < 5%
    expect(r.gateMetrics["Real-Time Match"].instrument).toMatchObject({ kind: "drift", divergence: 0.018 });
    expect(r.gateMetrics["Real or Lucky"].instrument).toMatchObject({ kind: "shuffle", p95Sharpe: 0.21 });
  });

  // ── Slumhouse progress line — gate journey from otherTests + lifecycle ──
  it("exposes gateJourney (8 gates matching GATE_DEFS) + dead; GRAVEYARD w/ failed Real or Lucky → real_edge fail", async () => {
    setupQueries({
      strategy: [{ id: "s1", name: "dead-strat", symbol: "MES", lifecycle_state: "GRAVEYARD" }],
      backtest: [{
        total_trades: 200, daily_pnls: "[]", equity_curve: "[]",
        result_extras: JSON.stringify({
          wfe_overall: 0.78, b15_passed: true, a14_severity: "pass",
          b10_pass: true, frankenstein_pass: false, compliance_pass_rate: 1.0,
        }),
      }],
      frankenstein: [{ passed: false, p95_sharpe: 0.5, median_pf: 1.4 }],
    });
    const { assembleRecipeData } = await import("../../lib/slumhouse/recipe-data.js");
    const { GATE_DEFS } = await import("../../lib/slumhouse/gate-journey.js");
    const r = await assembleRecipeData({ strategyId: "s1" });

    expect(Array.isArray(r.gateJourney)).toBe(true);
    expect(r.gateJourney).toHaveLength(8);
    expect(r.gateJourney.map((g) => g.label)).toEqual(GATE_DEFS.map((d) => d.label));
    expect(typeof r.dead).toBe("boolean");
    expect(r.dead).toBe(true);
    // "Real or Lucky" (frankenstein) failed → the real_edge gate shows fail
    expect(r.gateJourney.find((g) => g.key === "real_edge")?.status).toBe("fail");
  });

  it("throws strategy_not_found when strategy missing", async () => {
    setupQueries({ strategy: [] });
    const { assembleRecipeData } = await import("../../lib/slumhouse/recipe-data.js");
    await expect(assembleRecipeData({ strategyId: "doesntexist" })).rejects.toThrow(/strategy_not_found/);
  });

  it("fails-soft on missing backtest (no extras, zero KPIs)", async () => {
    setupQueries({ backtest: [], mc: [], paper: [], shadow: [], health: [] });
    const { assembleRecipeData } = await import("../../lib/slumhouse/recipe-data.js");
    const r = await assembleRecipeData({ strategyId: "s1" });
    expect(r.backtest.totalMade).toBe("$0");
    expect(r.backtest.tradesCount).toBe(0);
    expect(r.monteCarlo.blowUpOdds).toBe("0 outta 100");
    expect(r.slumdawgScore).toBe(0);
    expect(r.otherTests).toHaveLength(8);
  });

  it("marks Real-Time Match as fail when divergence > 5%", async () => {
    setupQueries({ shadow: [{ divergence_vs_backtest: 0.08 }] });
    const { assembleRecipeData } = await import("../../lib/slumhouse/recipe-data.js");
    const r = await assembleRecipeData({ strategyId: "s1" });
    expect(r.otherTests.find((t) => t.name === "Real-Time Match")?.status).toBe("fail");
  });

  it("marks Sloppy Bot Test as fail when b15 not passed", async () => {
    setupQueries({
      backtest: [{
        total_trades: 0, daily_pnls: "[]", equity_curve: "[]",
        result_extras: JSON.stringify({ b15_passed: false, wfe_overall: 0.8, b10_pass: true, frankenstein_pass: true, compliance_pass_rate: 1, a14_severity: "pass" }),
      }],
    });
    const { assembleRecipeData } = await import("../../lib/slumhouse/recipe-data.js");
    const r = await assembleRecipeData({ strategyId: "s1" });
    expect(r.otherTests.find((t) => t.name === "Sloppy Bot Test")?.status).toBe("fail");
  });

  // ── FIX 1: B14 threshold parity (deep-scan #12 Track T) ──────────────────
  // The gate threshold is 0.20 (tightened from 0.40 on 2026-06-22). Any
  // ci_high > 0.20 must produce verdictGreen=false, even if it was < 0.40.

  it("verdictGreen=false when ci_high=0.30 (was TRUE under old 0.40 hardcode, gate BLOCKS)", async () => {
    setupQueries({
      mc: [{ risk_metrics: JSON.stringify({
        probability_of_ruin_ci: { ci_high: 0.30 },
      }) }],
    });
    const { assembleRecipeData } = await import("../../lib/slumhouse/recipe-data.js");
    const r = await assembleRecipeData({ strategyId: "s1" });
    expect(r.monteCarlo.verdictGreen).toBe(false);
  });

  it("verdictGreen=true at boundary ci_high=0.20 (gate passes: NOT blocked)", async () => {
    // Gate uses strict > so ci_high exactly equal to threshold is NOT blocked.
    setupQueries({
      mc: [{ risk_metrics: JSON.stringify({
        probability_of_ruin_ci: { ci_high: 0.20 },
      }) }],
    });
    const { assembleRecipeData } = await import("../../lib/slumhouse/recipe-data.js");
    const r = await assembleRecipeData({ strategyId: "s1" });
    expect(r.monteCarlo.verdictGreen).toBe(true);
  });

  it("verdictGreen=false when ci_high=0.21 (just over the 0.20 threshold)", async () => {
    setupQueries({
      mc: [{ risk_metrics: JSON.stringify({
        probability_of_ruin_ci: { ci_high: 0.21 },
      }) }],
    });
    const { assembleRecipeData } = await import("../../lib/slumhouse/recipe-data.js");
    const r = await assembleRecipeData({ strategyId: "s1" });
    expect(r.monteCarlo.verdictGreen).toBe(false);
  });

  it("verdictGreen=false when MC has not run (no mc row, ciHighRaw=null)", async () => {
    // Previously: ciHigh defaulted to 0 → verdictGreen = 0 < 0.40 = true (misleading).
    // Now: ciHighRaw = null → verdictGreen = false (unknown/missing, not promising).
    setupQueries({ mc: [] });
    const { assembleRecipeData } = await import("../../lib/slumhouse/recipe-data.js");
    const r = await assembleRecipeData({ strategyId: "s1" });
    expect(r.monteCarlo.verdictGreen).toBe(false);
  });

  it("verdictGreen respects B14_RUIN_CI_HIGH_THRESHOLD env override", async () => {
    const originalEnv = process.env.B14_RUIN_CI_HIGH_THRESHOLD;
    process.env.B14_RUIN_CI_HIGH_THRESHOLD = "0.30";
    try {
      setupQueries({
        mc: [{ risk_metrics: JSON.stringify({
          probability_of_ruin_ci: { ci_high: 0.25 },
        }) }],
      });
      const { assembleRecipeData } = await import("../../lib/slumhouse/recipe-data.js");
      const r = await assembleRecipeData({ strategyId: "s1" });
      // 0.25 <= 0.30 → verdictGreen=true with the overridden threshold
      expect(r.monteCarlo.verdictGreen).toBe(true);
    } finally {
      if (originalEnv === undefined) delete process.env.B14_RUIN_CI_HIGH_THRESHOLD;
      else process.env.B14_RUIN_CI_HIGH_THRESHOLD = originalEnv;
    }
  });

  // ── FIX 1: WFE threshold parity ───────────────────────────────────────────
  it("Surprise Test=pass when WFE at hard floor 0.70 (gate boundary: >= floor)", async () => {
    setupQueries({
      backtest: [{
        total_trades: 0, daily_pnls: "[]", equity_curve: "[]",
        result_extras: JSON.stringify({ wfe_overall: 0.70, b15_passed: true, b10_pass: true, frankenstein_pass: true, compliance_pass_rate: 1, a14_severity: "pass" }),
      }],
    });
    const { assembleRecipeData } = await import("../../lib/slumhouse/recipe-data.js");
    const r = await assembleRecipeData({ strategyId: "s1" });
    expect(r.otherTests.find((t) => t.name === "Surprise Test")?.status).toBe("pass");
  });

  it("Surprise Test=warn when WFE=0.69 (below floor — gate would block, display shows warn)", async () => {
    setupQueries({
      backtest: [{
        total_trades: 0, daily_pnls: "[]", equity_curve: "[]",
        result_extras: JSON.stringify({ wfe_overall: 0.69, b15_passed: true, b10_pass: true, frankenstein_pass: true, compliance_pass_rate: 1, a14_severity: "pass" }),
      }],
    });
    const { assembleRecipeData } = await import("../../lib/slumhouse/recipe-data.js");
    const r = await assembleRecipeData({ strategyId: "s1" });
    expect(r.otherTests.find((t) => t.name === "Surprise Test")?.status).toBe("warn");
  });

  // ── Deep-scan #13 Task 12: prose must match gate status, missing = untested ──

  it("Sloppy Bot Test sentence does NOT claim success when b15 failed", async () => {
    setupQueries({
      backtest: [{
        total_trades: 0, daily_pnls: "[]", equity_curve: "[]",
        result_extras: JSON.stringify({ b15_passed: false, wfe_overall: 0.8, b10_pass: true, frankenstein_pass: true, compliance_pass_rate: 1, a14_severity: "pass" }),
      }],
    });
    const { assembleRecipeData } = await import("../../lib/slumhouse/recipe-data.js");
    const r = await assembleRecipeData({ strategyId: "s1" });
    const sloppy = r.otherTests.find((t) => t.name === "Sloppy Bot Test");
    expect(sloppy?.status).toBe("fail");
    expect(sloppy?.sentence).not.toContain("Still cashed out");
  });

  it("Every Mood Test is warn+untested when b10_pass is absent (not fabricated pass)", async () => {
    setupQueries({
      backtest: [{
        total_trades: 0, daily_pnls: "[]", equity_curve: "[]",
        // b10_pass intentionally omitted — untested, must NOT default to pass
        result_extras: JSON.stringify({ b15_passed: true, wfe_overall: 0.8, frankenstein_pass: true, compliance_pass_rate: 1, a14_severity: "pass" }),
      }],
    });
    const { assembleRecipeData } = await import("../../lib/slumhouse/recipe-data.js");
    const r = await assembleRecipeData({ strategyId: "s1" });
    const mood = r.otherTests.find((t) => t.name === "Every Mood Test");
    expect(mood?.status).toBe("warn");
    expect(mood?.status).not.toBe("pass");
    expect(mood?.sentence.toLowerCase()).toContain("hasn't taken this test yet");
  });

  it("Every Mood Test is fail with a losing sentence when b10_pass is false", async () => {
    setupQueries({
      backtest: [{
        total_trades: 0, daily_pnls: "[]", equity_curve: "[]",
        result_extras: JSON.stringify({ b15_passed: true, wfe_overall: 0.8, b10_pass: false, frankenstein_pass: true, compliance_pass_rate: 1, a14_severity: "pass" }),
      }],
    });
    const { assembleRecipeData } = await import("../../lib/slumhouse/recipe-data.js");
    const r = await assembleRecipeData({ strategyId: "s1" });
    const mood = r.otherTests.find((t) => t.name === "Every Mood Test");
    expect(mood?.status).toBe("fail");
    expect(mood?.sentence).not.toContain("Won every one");
  });

  it("Real or Lucky is warn+untested when frankenstein_pass is absent (not fabricated pass)", async () => {
    setupQueries({
      backtest: [{
        total_trades: 0, daily_pnls: "[]", equity_curve: "[]",
        // frankenstein_pass intentionally omitted — untested, must NOT default to pass
        result_extras: JSON.stringify({ b15_passed: true, wfe_overall: 0.8, b10_pass: true, compliance_pass_rate: 1, a14_severity: "pass" }),
      }], frankenstein: [],
    });
    const { assembleRecipeData } = await import("../../lib/slumhouse/recipe-data.js");
    const r = await assembleRecipeData({ strategyId: "s1" });
    const rol = r.otherTests.find((t) => t.name === "Real or Lucky");
    expect(rol?.status).toBe("warn");
    expect(rol?.status).not.toBe("pass");
    expect(rol?.sentence.toLowerCase()).toContain("hasn't taken this test yet");
    expect(rol?.sentence).not.toContain("Got real game");
  });

  it("Plays Clean sentence does NOT claim clean when compliance is below 1.0", async () => {
    setupQueries({
      backtest: [{
        total_trades: 0, daily_pnls: "[]", equity_curve: "[]",
        result_extras: JSON.stringify({ b15_passed: true, wfe_overall: 0.8, b10_pass: true, frankenstein_pass: true, compliance_pass_rate: 0.90, a14_severity: "pass" }),
      }],
    });
    const { assembleRecipeData } = await import("../../lib/slumhouse/recipe-data.js");
    const r = await assembleRecipeData({ strategyId: "s1" });
    const clean = r.otherTests.find((t) => t.name === "Plays Clean");
    expect(clean?.status).toBe("fail");
    expect(clean?.sentence).not.toContain("Won't get the account shut down");
  });
});
