import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../db/index.js", () => ({ db: { execute: mocks.execute } }));

const ORDER = ["strategy", "backtest", "mc", "paper", "shadow", "health"] as const;

function setupQueries(custom: Partial<Record<typeof ORDER[number], unknown[]>> = {}) {
  const responses: Record<string, unknown[]> = {
    strategy: [{ id: "s1", name: "vwap-band-mes", symbol: "MES", lifecycle_state: "DEPLOY_READY" }],
    backtest: [{
      total_pnl: 118420, trade_count: 1283,
      daily_pnls: JSON.stringify([
        { date: "2026-05-01", pnl: 118 }, { date: "2026-05-02", pnl: 340 }, { date: "2026-05-03", pnl: -430 },
      ]),
      equity_curve: JSON.stringify([0, 500, 1200, 2300]),
      result_extras: JSON.stringify({
        wfe_overall: 0.78, b15_passed: true, a14_severity: "warn",
        b10_pass: true, frankenstein_pass: true, compliance_pass_rate: 1.0,
      }),
    }],
    mc: [{ result_json: JSON.stringify({
      probability_of_ruin_ci: { ci_high: 0.03 },
      percentile_5: -2840, percentile_50: 42500, percentile_95: 94200,
    }) }],
    paper: [{ paper_total: 3840 }],
    shadow: [{ divergence_pct: 0.018 }],
    health: [{ composite_score: 0.84 }],
    ...custom,
  };
  let i = 0;
  mocks.execute.mockReset();
  mocks.execute.mockImplementation(() => Promise.resolve(responses[ORDER[i++]] ?? []));
}

describe("recipe-data", () => {
  beforeEach(() => { mocks.execute.mockReset(); });

  it("assembles all 4 panels + 8 tests with full data", async () => {
    setupQueries();
    const { assembleRecipeData } = await import("../../lib/slumhouse/recipe-data.js");
    const r = await assembleRecipeData({ strategyId: "s1" });

    expect(r.identity.name).toBe("vwap-band-mes");
    expect(r.identity.stationStreet).toBe("Small Plates");
    expect(r.slumdawgScore).toBe(84);

    expect(r.backtest.totalMade).toBe("+$118,420");
    expect(r.backtest.tradesCount).toBe(1283);
    expect(r.backtest.worstDay).toBe("−$430");
    expect(r.backtest.winningDays).toBe(2);

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
    setupQueries({ shadow: [{ divergence_pct: 0.08 }] });
    const { assembleRecipeData } = await import("../../lib/slumhouse/recipe-data.js");
    const r = await assembleRecipeData({ strategyId: "s1" });
    expect(r.otherTests.find((t) => t.name === "Real-Time Match")?.status).toBe("fail");
  });

  it("marks Sloppy Bot Test as fail when b15 not passed", async () => {
    setupQueries({
      backtest: [{
        total_pnl: 0, trade_count: 0, daily_pnls: "[]", equity_curve: "[]",
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
      mc: [{ result_json: JSON.stringify({
        probability_of_ruin_ci: { ci_high: 0.30 },
        percentile_5: -1000, percentile_50: 20000, percentile_95: 50000,
      }) }],
    });
    const { assembleRecipeData } = await import("../../lib/slumhouse/recipe-data.js");
    const r = await assembleRecipeData({ strategyId: "s1" });
    expect(r.monteCarlo.verdictGreen).toBe(false);
  });

  it("verdictGreen=true at boundary ci_high=0.20 (gate passes: NOT blocked)", async () => {
    // Gate uses strict > so ci_high exactly equal to threshold is NOT blocked.
    setupQueries({
      mc: [{ result_json: JSON.stringify({
        probability_of_ruin_ci: { ci_high: 0.20 },
        percentile_5: -500, percentile_50: 18000, percentile_95: 42000,
      }) }],
    });
    const { assembleRecipeData } = await import("../../lib/slumhouse/recipe-data.js");
    const r = await assembleRecipeData({ strategyId: "s1" });
    expect(r.monteCarlo.verdictGreen).toBe(true);
  });

  it("verdictGreen=false when ci_high=0.21 (just over the 0.20 threshold)", async () => {
    setupQueries({
      mc: [{ result_json: JSON.stringify({
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
        mc: [{ result_json: JSON.stringify({
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
        total_pnl: 0, trade_count: 0, daily_pnls: "[]", equity_curve: "[]",
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
        total_pnl: 0, trade_count: 0, daily_pnls: "[]", equity_curve: "[]",
        result_extras: JSON.stringify({ wfe_overall: 0.69, b15_passed: true, b10_pass: true, frankenstein_pass: true, compliance_pass_rate: 1, a14_severity: "pass" }),
      }],
    });
    const { assembleRecipeData } = await import("../../lib/slumhouse/recipe-data.js");
    const r = await assembleRecipeData({ strategyId: "s1" });
    expect(r.otherTests.find((t) => t.name === "Surprise Test")?.status).toBe("warn");
  });
});
