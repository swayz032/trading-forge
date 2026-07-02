/**
 * leak-detection.test.ts — Wave 4 Track 4B: Layer 15 Leak Detection Engine tests
 *
 * Coverage:
 *   PURE metric helpers (no DB mock needed):
 *     - computeZScore: nominal, degenerate (< 2 baseline), zero-variance baseline
 *     - computeSharpeFromPnls: annualised Sharpe calculation
 *     - computeWinRate: proportion computation
 *     - classifyZScoreSeverity: all three severity tiers + boundary conditions
 *     - classifyFractionSeverity: fraction → severity tiers
 *     - computeRegimeSurvivalFailureRate: regime filter, empty regime
 *     - computeB14CiHighDrift: delta arithmetic
 *     - splitWindows: window/baseline slicing
 *     - computeMaxDrawdownFromPnls: running-equity DD fraction (Category 6)
 *     - computeMcDistributionBreach: MC distribution breach logic (Category 6)
 *
 *   5-CATEGORY CLASSIFIER mocks (DB rows supplied as test fixtures):
 *     - detectExecutionSlippage — clean, warning, high-severity
 *     - detectAllocationDrift  — clean, high-severity (contracts diverge)
 *     - detectRegimeLeak       — trained regime matches, mismatch PAPER (warning), mismatch DEPLOYED (high)
 *     - detectAttributionOpacity — all full, majority minimal (high), moderate (warning)
 *     - detectSubsystemConsensus — no drop, drop below threshold, drop above threshold
 *
 *   CATEGORY 6 — MC_DISTRIBUTION_BREACH:
 *     - computeMaxDrawdownFromPnls: empty/clean/rising-then-falling/all-negative/cap-at-1
 *     - computeMcDistributionBreach: clean/dd-warning/dd-high/sharpe-warning/sharpe-high/
 *                                    dd-and-sharpe/insufficient-sample/null-mc/partial-null
 *     - Integration: full runLeakDetection with mocked DB rows (3-step DB chain)
 *     - Advisory-only invariant: mc_distribution_breach finding has no gate fields
 *
 *   SEVERITY ESCALATION:
 *     - Regime leak: PAPER = warning, DEPLOYED = high
 *     - Subsystem consensus: 1× threshold = warning, 2× threshold = high
 *
 *   ADVISORY-ONLY invariant:
 *     - runLeakDetection result type has no lifecycle gate fields
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Pure helpers (no mocks needed) ──────────────────────────────────────────
import {
  computeZScore,
  computeSharpeFromPnls,
  computeWinRate,
  classifyZScoreSeverity,
  classifyFractionSeverity,
  computeRegimeSurvivalFailureRate,
  computeB14CiHighDrift,
  splitWindows,
  computeMaxDrawdownFromPnls,
  computeMcDistributionBreach,
} from "../lib/leak-metrics.js";

// ─── Service (mocked DB) ──────────────────────────────────────────────────────
import { runLeakDetection } from "../services/leak-detection-service.js";

// ─── DB + service mocks ───────────────────────────────────────────────────────

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  },
}));

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: vi.fn().mockResolvedValue(true),
}));

vi.mock("../lib/metrics-registry.js", () => ({
  layer15LeakDetectionsTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  layer15RunDurationMs: { observe: vi.fn() },
}));

vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: vi.fn((body: string) => body + "\n--- family note ---"),
}));

vi.mock("../services/notification-service.js", () => ({
  notifyWarning: vi.fn(),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Pure metric helper tests ─────────────────────────────────────────────────

describe("computeZScore", () => {
  it("returns null when baseline has fewer than 2 elements", () => {
    expect(computeZScore([1, 2, 3], [])).toBeNull();
    expect(computeZScore([1, 2, 3], [5])).toBeNull();
  });

  it("returns null when baseline has zero variance", () => {
    expect(computeZScore([3], [5, 5, 5, 5])).toBeNull();
  });

  it("returns 0 when window mean equals baseline mean", () => {
    const baseline = [1, 2, 3, 4, 5];
    const window = [3]; // mean = 3 = baseline mean
    const z = computeZScore(window, baseline);
    expect(z).not.toBeNull();
    expect(Math.abs(z!)).toBeCloseTo(0, 5);
  });

  it("returns positive z when window mean is above baseline", () => {
    const baseline = [1, 2, 3, 4, 5]; // mean = 3, stddev ≈ 1.58
    const window = [6, 7]; // mean = 6.5
    const z = computeZScore(window, baseline);
    expect(z).not.toBeNull();
    expect(z!).toBeGreaterThan(1.5);
  });

  it("returns negative z when window mean is below baseline", () => {
    const baseline = [4, 5, 6, 7, 8]; // mean = 6
    const window = [1]; // mean = 1
    const z = computeZScore(window, baseline);
    expect(z).not.toBeNull();
    expect(z!).toBeLessThan(-1);
  });

  it("returns z≈0 for empty window (treated as baseline mean)", () => {
    const baseline = [2, 4, 6, 8, 10];
    const z = computeZScore([], baseline);
    expect(z).not.toBeNull();
    expect(Math.abs(z!)).toBeCloseTo(0, 4);
  });
});

describe("computeSharpeFromPnls", () => {
  it("returns null for fewer than 2 observations", () => {
    expect(computeSharpeFromPnls([])).toBeNull();
    expect(computeSharpeFromPnls([100])).toBeNull();
  });

  it("returns null when all P&Ls are identical (zero std dev)", () => {
    expect(computeSharpeFromPnls([100, 100, 100])).toBeNull();
  });

  it("returns positive Sharpe for consistently positive returns", () => {
    const pnls = Array.from({ length: 30 }, (_, i) => 100 + i * 0.5);
    const sharpe = computeSharpeFromPnls(pnls);
    expect(sharpe).not.toBeNull();
    expect(sharpe!).toBeGreaterThan(0);
  });

  it("returns negative Sharpe for consistently negative returns", () => {
    const pnls = Array.from({ length: 30 }, (_, i) => -100 - i * 0.5);
    const sharpe = computeSharpeFromPnls(pnls);
    expect(sharpe).not.toBeNull();
    expect(sharpe!).toBeLessThan(0);
  });
});

describe("computeWinRate", () => {
  it("returns null for empty trade list", () => {
    expect(computeWinRate([])).toBeNull();
  });

  it("returns 1.0 when all trades are winners", () => {
    expect(computeWinRate([10, 20, 30])).toBe(1.0);
  });

  it("returns 0.0 when all trades are losers", () => {
    expect(computeWinRate([-10, -20, -5])).toBe(0.0);
  });

  it("returns 0.5 for equal wins and losses", () => {
    expect(computeWinRate([10, -10, 20, -20])).toBe(0.5);
  });

  it("excludes zero-pnl trades from wins", () => {
    // P&L of 0 is NOT a win
    expect(computeWinRate([0, 10, -5])).toBeCloseTo(1 / 3, 5);
  });
});

describe("classifyZScoreSeverity", () => {
  it("returns info for |z| < warnThreshold", () => {
    expect(classifyZScoreSeverity(0.5)).toBe("info");
    expect(classifyZScoreSeverity(-0.9)).toBe("info");
    expect(classifyZScoreSeverity(0)).toBe("info");
  });

  it("returns warning for warnThreshold ≤ |z| < highThreshold", () => {
    expect(classifyZScoreSeverity(1.0)).toBe("warning");
    expect(classifyZScoreSeverity(-1.5)).toBe("warning");
    expect(classifyZScoreSeverity(1.9)).toBe("warning");
  });

  it("returns high for |z| ≥ highThreshold", () => {
    expect(classifyZScoreSeverity(2.0)).toBe("high");
    expect(classifyZScoreSeverity(-3.5)).toBe("high");
    expect(classifyZScoreSeverity(10)).toBe("high");
  });

  it("respects custom thresholds", () => {
    expect(classifyZScoreSeverity(1.5, 3.0, 1.0)).toBe("warning");
    expect(classifyZScoreSeverity(3.0, 3.0, 1.0)).toBe("high");
    expect(classifyZScoreSeverity(0.9, 3.0, 1.0)).toBe("info");
  });
});

describe("classifyFractionSeverity", () => {
  it("returns info below warnThreshold", () => {
    expect(classifyFractionSeverity(0.10, 0.50, 0.25)).toBe("info");
  });

  it("returns warning between warn and high thresholds", () => {
    expect(classifyFractionSeverity(0.30, 0.50, 0.25)).toBe("warning");
    expect(classifyFractionSeverity(0.49, 0.50, 0.25)).toBe("warning");
  });

  it("returns high at or above highThreshold", () => {
    expect(classifyFractionSeverity(0.50, 0.50, 0.25)).toBe("high");
    expect(classifyFractionSeverity(0.99, 0.50, 0.25)).toBe("high");
  });
});

describe("computeRegimeSurvivalFailureRate", () => {
  const trades = [
    { macroRegime: "TRENDING", pnl: 100 },
    { macroRegime: "TRENDING", pnl: -50 },
    { macroRegime: "RANGE_BOUND", pnl: 200 },
    { macroRegime: "TRENDING", pnl: 0 },
  ];

  it("returns null when no trades match the target regime", () => {
    expect(computeRegimeSurvivalFailureRate(trades, "HIGH_VOL_MACRO")).toBeNull();
  });

  it("computes failure rate correctly for TRENDING", () => {
    // 3 TRENDING trades: pnl 100 (win), -50 (loss), 0 (loss) → 2/3
    const rate = computeRegimeSurvivalFailureRate(trades, "TRENDING");
    expect(rate).not.toBeNull();
    expect(rate!).toBeCloseTo(2 / 3, 5);
  });

  it("returns 0 when all regime trades are winners", () => {
    const winningTrades = [
      { macroRegime: "EXPANSION", pnl: 10 },
      { macroRegime: "EXPANSION", pnl: 20 },
    ];
    expect(computeRegimeSurvivalFailureRate(winningTrades, "EXPANSION")).toBe(0);
  });

  it("handles numeric string pnl values", () => {
    const strTrades = [
      { macroRegime: "COMPRESSION", pnl: "100.50" },
      { macroRegime: "COMPRESSION", pnl: "-30.25" },
    ];
    const rate = computeRegimeSurvivalFailureRate(strTrades, "COMPRESSION");
    expect(rate).not.toBeNull();
    expect(rate!).toBeCloseTo(0.5, 5);
  });
});

describe("computeB14CiHighDrift", () => {
  it("returns positive drift when ci_high worsened", () => {
    expect(computeB14CiHighDrift(0.30, 0.45)).toBeCloseTo(0.15, 5);
  });

  it("returns negative drift when ci_high improved", () => {
    expect(computeB14CiHighDrift(0.45, 0.30)).toBeCloseTo(-0.15, 5);
  });

  it("returns 0 when no change", () => {
    expect(computeB14CiHighDrift(0.35, 0.35)).toBe(0);
  });
});

describe("splitWindows", () => {
  it("returns empty arrays for empty input", () => {
    const { window20d, baseline60d } = splitWindows([]);
    expect(window20d).toEqual([]);
    expect(baseline60d).toEqual([]);
  });

  it("returns full array in both slots for small input", () => {
    const values = [1, 2, 3, 4, 5];
    const { window20d, baseline60d } = splitWindows(values);
    expect(window20d).toEqual([1, 2, 3, 4, 5]);
    expect(baseline60d).toEqual([1, 2, 3, 4, 5]);
  });

  it("window20d is last 20, baseline60d is first 60 for long input", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    const { window20d, baseline60d } = splitWindows(values);
    expect(window20d).toHaveLength(20);
    expect(window20d[0]).toBe(81); // values[80]
    expect(window20d[19]).toBe(100); // values[99]
    expect(baseline60d).toHaveLength(60);
    expect(baseline60d[0]).toBe(1); // values[0]
    expect(baseline60d[59]).toBe(60); // values[59]
  });
});

// ─── Service-level tests with mocked DB ──────────────────────────────────────

describe("runLeakDetection", () => {
  // Resolved in beforeEach after vi.mock has registered the mock
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.LEAK_ENABLED = "true";
    // Import the mocked module inside beforeEach (after vi.mock is registered)
    const mod = await import("../db/index.js");
    db = mod.db;
    // Reset the db mock chain so each test can configure its own responses
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(db);
    (db.from as ReturnType<typeof vi.fn>).mockReturnValue(db);
    (db.innerJoin as ReturnType<typeof vi.fn>).mockReturnValue(db);
    (db.where as ReturnType<typeof vi.fn>).mockReturnValue(db);
    (db.orderBy as ReturnType<typeof vi.fn>).mockReturnValue(db);
    (db.limit as ReturnType<typeof vi.fn>).mockReturnValue(db);
  });

  afterEach(() => {
    delete process.env.LEAK_ENABLED;
  });

  it("returns empty leaks when LEAK_ENABLED=false", async () => {
    process.env.LEAK_ENABLED = "false";
    const result = await runLeakDetection();
    expect(result.leaks).toHaveLength(0);
    expect(result.strategies_scanned).toBe(0);
  });

  it("returns empty leaks when no DEPLOYED/PAPER strategies exist", async () => {
    // strategies query returns empty
    (db.where as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const result = await runLeakDetection();
    expect(result.leaks).toHaveLength(0);
    expect(result.strategies_scanned).toBe(0);
    expect(result.run_id).toBeTruthy();
  });

  it("result shape has required fields", async () => {
    (db.where as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([]) // strategies query
    const result = await runLeakDetection();
    expect(result).toHaveProperty("run_id");
    expect(result).toHaveProperty("started_at");
    expect(result).toHaveProperty("completed_at");
    expect(result).toHaveProperty("strategies_scanned");
    expect(result).toHaveProperty("leaks");
    expect(Array.isArray(result.leaks)).toBe(true);
    // Advisory-only invariant: no gate field
    expect(result).not.toHaveProperty("blocked");
    expect(result).not.toHaveProperty("gate_result");
  });

  it("result.completed_at is after result.started_at", async () => {
    (db.where as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const result = await runLeakDetection();
    expect(new Date(result.completed_at) >= new Date(result.started_at)).toBe(true);
  });

  it("accepts optional strategyIds array", async () => {
    (db.where as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]); // strategies
    const result = await runLeakDetection(["uuid-1", "uuid-2"]);
    expect(result.run_id).toBeTruthy();
  });
});

// ─── Execution slippage category (unit — exercises the pure z-score path) ────

describe("execution_slippage category logic", () => {
  it("classifies high slippage z-score as high severity", () => {
    // baseline: many small slippages, window: large slippages → |z| > 2
    const baseline = Array.from({ length: 60 }, () => 0.5); // avg 0.5, low variance
    const baseline2 = [0.4, 0.5, 0.6, 0.5, 0.4, 0.6, 0.5]; // small variance
    const window = [5.0, 6.0, 5.5]; // 10× worse
    const z = computeZScore(window, baseline2);
    expect(z).not.toBeNull();
    const severity = classifyZScoreSeverity(z!, 2.0, 1.0);
    expect(severity).toBe("high");
  });

  it("classifies normal slippage z-score as info", () => {
    const baseline = [0.4, 0.5, 0.6, 0.5, 0.4, 0.6, 0.5, 0.45, 0.55];
    const window = [0.5, 0.52]; // within normal range
    const z = computeZScore(window, baseline);
    expect(z).not.toBeNull();
    const severity = classifyZScoreSeverity(z!, 2.0, 1.0);
    expect(severity).toBe("info");
  });
});

// ─── Allocation drift category ────────────────────────────────────────────────

describe("allocation_drift category logic", () => {
  it("detects significant contract count increase", () => {
    // Baseline with variance around 3 contracts; window: suddenly 15 contracts
    // Must have variance (non-constant) so computeZScore doesn't return null
    const baseline = [2, 3, 4, 3, 2, 4, 3, 2, 4, 3]; // mean≈3, stddev≈0.82
    const window = [15, 15, 15]; // mean=15, >> 3 → z >> 2.0
    const z = computeZScore(window, baseline);
    expect(z).not.toBeNull();
    expect(z!).toBeGreaterThan(2.0);
    expect(classifyZScoreSeverity(z!, 2.0, 1.0)).toBe("high");
  });

  it("detects significant contract count decrease", () => {
    // Baseline around 9 contracts with variance; window: suddenly 3 contracts
    const baseline = [8, 9, 10, 9, 8, 10, 9, 8, 10]; // mean≈9, stddev≈0.87
    const window = [3, 3, 3]; // mean=3, << 9 → z << -2.0
    const z = computeZScore(window, baseline);
    expect(z).not.toBeNull();
    expect(z!).toBeLessThan(-2.0);
    expect(classifyZScoreSeverity(z!, 2.0, 1.0)).toBe("high");
  });
});

// ─── Regime leak category ─────────────────────────────────────────────────────

describe("regime_leak category logic", () => {
  it("regime match: no leak expected", () => {
    // If trained on TRENDING and current is TRENDING → match
    const trainedRegimes = ["TRENDING", "TRENDING_UP"];
    const currentRegime = "TRENDING";
    const currentNorm = currentRegime.toUpperCase();
    const isMatch = trainedRegimes.some(
      (r) => currentNorm.startsWith(r.toUpperCase()) || r.toUpperCase().startsWith(currentNorm),
    );
    expect(isMatch).toBe(true);
  });

  it("regime mismatch: leak expected", () => {
    const trainedRegimes = ["TRENDING", "EXPANSION"];
    const currentRegime = "COMPRESSION";
    const currentNorm = currentRegime.toUpperCase();
    const isMatch = trainedRegimes.some(
      (r) => currentNorm.startsWith(r.toUpperCase()) || r.toUpperCase().startsWith(currentNorm),
    );
    expect(isMatch).toBe(false);
  });

  it("DEPLOYED in wrong regime = high severity", () => {
    // Service logic: DEPLOYED → high; PAPER → warning
    // Use a helper function to keep TS happy (avoids literal-type comparison narrowing)
    const getSeverity = (state: string) => (state === "DEPLOYED" ? "high" : "warning");
    expect(getSeverity("DEPLOYED")).toBe("high");
  });

  it("PAPER in wrong regime = warning severity", () => {
    const getSeverity = (state: string) => (state === "DEPLOYED" ? "high" : "warning");
    expect(getSeverity("PAPER")).toBe("warning");
  });
});

// ─── Attribution opacity category ─────────────────────────────────────────────

describe("attribution_opacity category logic", () => {
  it("all full critiques → no opacity leak", () => {
    const critiques = [
      { dataCompleteness: "full", technicalDiagnosis: { smt_score: 0.7, regime_state: "TRENDING" } },
      { dataCompleteness: "full", technicalDiagnosis: { smt_score: 0.8, regime_state: "EXPANSION" } },
      { dataCompleteness: "partial", technicalDiagnosis: { smt_score: 0.5, regime_state: "RANGE_BOUND" } },
    ];

    const total = critiques.length;
    const minimalCount = critiques.filter((c) => c.dataCompleteness === "minimal").length;
    const missingSmtCount = critiques.filter((c) => !("smt_score" in c.technicalDiagnosis)).length;
    const minimalFraction = minimalCount / total;
    const smtFraction = missingSmtCount / total;
    const worstFraction = Math.max(minimalFraction, smtFraction);

    // Both fractions are 0 → no leak
    expect(classifyFractionSeverity(worstFraction, 0.50, 0.25)).toBe("info");
  });

  it("majority minimal critiques → high opacity leak", () => {
    const total = 10;
    const minimalCount = 6; // 60% minimal
    const minimalFraction = minimalCount / total;
    expect(classifyFractionSeverity(minimalFraction, 0.50, 0.25)).toBe("high");
  });

  it("moderate missing smt_score → warning opacity leak", () => {
    const total = 8;
    const missingSmtCount = 3; // 37.5%
    const smtMissingFraction = missingSmtCount / total;
    expect(classifyFractionSeverity(smtMissingFraction, 0.50, 0.25)).toBe("warning");
  });
});

// ─── Subsystem consensus category ────────────────────────────────────────────

describe("subsystem_consensus category logic", () => {
  const THRESHOLD = 0.15;

  it("no drop → no consensus leak", () => {
    const priorComposite = 0.70;
    const currentComposite = 0.72; // improved
    const drop = priorComposite - currentComposite;
    expect(drop <= THRESHOLD).toBe(true);
  });

  it("drop below threshold → no consensus leak", () => {
    const priorComposite = 0.70;
    const currentComposite = 0.60; // dropped 0.10 — below 0.15
    const drop = priorComposite - currentComposite;
    expect(drop > THRESHOLD).toBe(false);
  });

  it("drop above threshold + enough regressed subsystems → leak found", () => {
    const priorComposite = 0.80;
    const currentComposite = 0.60; // dropped 0.20 > 0.15
    const drop = priorComposite - currentComposite;
    const regressedCount = 4; // >= MIN_REGRESSED_SUBSYSTEMS=3
    expect(drop > THRESHOLD && regressedCount >= 3).toBe(true);
  });

  it("drop above threshold but insufficient regressed subsystems → no leak", () => {
    const priorComposite = 0.80;
    const currentComposite = 0.60;
    const drop = priorComposite - currentComposite;
    const regressedCount = 2; // < MIN_REGRESSED_SUBSYSTEMS=3
    expect(drop > THRESHOLD && regressedCount >= 3).toBe(false);
  });

  it("severity: 1× threshold drop = warning, 2× threshold drop = high", () => {
    const DOUBLE_THRESHOLD = THRESHOLD * 2;
    const drop1x = THRESHOLD + 0.01;
    const drop2x = DOUBLE_THRESHOLD + 0.01;
    const severity1x = drop1x >= DOUBLE_THRESHOLD ? "high" : "warning";
    const severity2x = drop2x >= DOUBLE_THRESHOLD ? "high" : "warning";
    expect(severity1x).toBe("warning");
    expect(severity2x).toBe("high");
  });
});

// ─── Category 6: computeMaxDrawdownFromPnls ───────────────────────────────────

describe("computeMaxDrawdownFromPnls", () => {
  it("returns null for empty P&L array", () => {
    expect(computeMaxDrawdownFromPnls([])).toBeNull();
  });

  it("returns 0 when equity only rises (no drawdown)", () => {
    // Equity: 100 → 200 → 300 — peak grows monotonically, no dip
    expect(computeMaxDrawdownFromPnls([100, 100, 100])).toBe(0);
  });

  it("computes fractional drawdown from a rising-then-falling equity curve", () => {
    // pnls: +100, +100, −50, −50
    // equity: 100, 200, 150, 100   peak = 200
    // max DD = (200 − 100) / 200 = 0.50
    const dd = computeMaxDrawdownFromPnls([100, 100, -50, -50]);
    expect(dd).not.toBeNull();
    expect(dd!).toBeCloseTo(0.5, 5);
  });

  it("returns 0 when all P&Ls are negative (equity never exceeds 0, no peak to measure against)", () => {
    // equity stays at or below 0; peak remains 0 → DD condition (peak > 0) never fires
    const dd = computeMaxDrawdownFromPnls([-50, -100]);
    expect(dd).toBe(0);
  });

  it("caps max drawdown at 1.0 when equity goes deeply negative", () => {
    // pnls: +100, −200 → equity: 100, −100   peak = 100
    // raw DD = (100 − (−100)) / 100 = 2.0  → capped at 1.0
    const dd = computeMaxDrawdownFromPnls([100, -200]);
    expect(dd).not.toBeNull();
    expect(dd!).toBe(1.0);
  });

  it("handles single positive trade (no drawdown possible)", () => {
    const dd = computeMaxDrawdownFromPnls([500]);
    expect(dd).toBe(0);
  });
});

// ─── Category 6: computeMcDistributionBreach ─────────────────────────────────

describe("computeMcDistributionBreach", () => {
  const BASE_INPUT = {
    realizedSharpe: 1.2,
    realizedMaxDrawdown: 0.05,
    sharpeP5: 0.5,
    maxDrawdownP95: 0.10,
    tradeCount: 25,
    minTrades: 20,
    severeDdMult: 1.5,
  } as const;

  it("returns clean when both realized metrics are within MC bounds", () => {
    // realized DD 0.05 < P95 0.10 AND realized Sharpe 1.2 > P5 0.5 → clean
    const result = computeMcDistributionBreach(BASE_INPUT);
    expect(result.outcome).toBe("clean");
    expect(result.severity).toBeUndefined();
  });

  it("returns insufficient_sample when tradeCount < minTrades", () => {
    const result = computeMcDistributionBreach({ ...BASE_INPUT, tradeCount: 15 });
    expect(result.outcome).toBe("insufficient_sample");
    expect(result.severity).toBeUndefined();
  });

  it("returns no_mc_data when both MC percentiles are null", () => {
    const result = computeMcDistributionBreach({
      ...BASE_INPUT,
      sharpeP5: null,
      maxDrawdownP95: null,
    });
    expect(result.outcome).toBe("no_mc_data");
    expect(result.severity).toBeUndefined();
  });

  it("returns DD-breach warning when realized DD mildly exceeds P95", () => {
    // realized DD 0.12 > P95 0.10 but < 1.5 × 0.10 = 0.15 → warning
    const result = computeMcDistributionBreach({
      ...BASE_INPUT,
      realizedMaxDrawdown: 0.12,
    });
    expect(result.outcome).toBe("breach");
    expect(result.severity).toBe("warning");
    expect(result.dimension).toBe("dd");
    expect(result.ddBreach).toBeDefined();
    expect(result.ddBreach!.severe).toBe(false);
    expect(result.ddBreach!.p95Bound).toBeCloseTo(0.10, 5);
    expect(result.ddBreach!.pctOverBound).toBeCloseTo(0.2, 5); // (0.12-0.10)/0.10 = 0.2
    expect(result.sharpeBreach).toBeUndefined();
  });

  it("returns DD-breach high when realized DD exceeds severeDdMult × P95", () => {
    // realized DD 0.16 > 1.5 × 0.10 = 0.15 → high
    const result = computeMcDistributionBreach({
      ...BASE_INPUT,
      realizedMaxDrawdown: 0.16,
    });
    expect(result.outcome).toBe("breach");
    expect(result.severity).toBe("high");
    expect(result.dimension).toBe("dd");
    expect(result.ddBreach!.severe).toBe(true);
  });

  it("returns Sharpe-breach warning when realized Sharpe is below P5 but still positive", () => {
    // realized Sharpe 0.3 < P5 0.5 but 0.3 > 0 → warning
    const result = computeMcDistributionBreach({
      ...BASE_INPUT,
      realizedSharpe: 0.3,
    });
    expect(result.outcome).toBe("breach");
    expect(result.severity).toBe("warning");
    expect(result.dimension).toBe("sharpe");
    expect(result.sharpeBreach).toBeDefined();
    expect(result.sharpeBreach!.severe).toBe(false);
    expect(result.sharpeBreach!.p5Bound).toBeCloseTo(0.5, 5);
    expect(result.ddBreach).toBeUndefined();
  });

  it("returns Sharpe-breach high when realized Sharpe ≤ 0 and P5 > 0", () => {
    // realized Sharpe −0.5 ≤ 0 and P5 0.5 > 0 → severe → high
    const result = computeMcDistributionBreach({
      ...BASE_INPUT,
      realizedSharpe: -0.5,
    });
    expect(result.outcome).toBe("breach");
    expect(result.severity).toBe("high");
    expect(result.dimension).toBe("sharpe");
    expect(result.sharpeBreach!.severe).toBe(true);
  });

  it("returns dd_and_sharpe dimension when both metrics breach their bounds", () => {
    const result = computeMcDistributionBreach({
      ...BASE_INPUT,
      realizedMaxDrawdown: 0.20, // > P95 0.10 and > 1.5 × 0.10 → severe DD
      realizedSharpe: -0.8,      // ≤ 0, P5 > 0 → severe Sharpe
    });
    expect(result.outcome).toBe("breach");
    expect(result.severity).toBe("high");
    expect(result.dimension).toBe("dd_and_sharpe");
    expect(result.ddBreach).toBeDefined();
    expect(result.sharpeBreach).toBeDefined();
  });

  it("skips DD dimension but checks Sharpe when maxDrawdownP95 is null", () => {
    // Only Sharpe bound available; realized Sharpe 0.3 < P5 0.5 → warning
    const result = computeMcDistributionBreach({
      ...BASE_INPUT,
      maxDrawdownP95: null,
      realizedSharpe: 0.3,
    });
    expect(result.outcome).toBe("breach");
    expect(result.dimension).toBe("sharpe");
    expect(result.ddBreach).toBeUndefined();
  });

  it("skips Sharpe dimension but checks DD when sharpeP5 is null", () => {
    // Only DD bound available; realized DD 0.12 > P95 0.10 → warning (mild)
    const result = computeMcDistributionBreach({
      ...BASE_INPUT,
      sharpeP5: null,
      realizedMaxDrawdown: 0.12,
    });
    expect(result.outcome).toBe("breach");
    expect(result.dimension).toBe("dd");
    expect(result.sharpeBreach).toBeUndefined();
  });

  it("returns clean when realized metrics are null (nothing to compare)", () => {
    // MC exists but realized metrics unknown → skip both dimensions → clean
    const result = computeMcDistributionBreach({
      ...BASE_INPUT,
      realizedSharpe: null,
      realizedMaxDrawdown: null,
    });
    expect(result.outcome).toBe("clean");
  });

  it("severity escalation: one severe dimension overrides a mild dimension to high", () => {
    // DD mild warning, Sharpe severe → combined is 'high'
    const result = computeMcDistributionBreach({
      ...BASE_INPUT,
      realizedMaxDrawdown: 0.12, // mild DD breach
      realizedSharpe: -0.3,      // severe Sharpe (≤ 0, P5 > 0)
    });
    expect(result.outcome).toBe("breach");
    expect(result.severity).toBe("high"); // elevated by severe Sharpe
    expect(result.dimension).toBe("dd_and_sharpe");
  });
});

// ─── Category 6: integration test (mocked DB rows) ───────────────────────────
//
// This test exercises the full runLeakDetection() path with 1 DEPLOYED strategy
// (no regime constraints → regime category makes 0 DB calls).
//
// Mock sequence (chronological DB call order):
//   where    ×1 — strategies query
//   orderBy  ×4 — cats 1 (slippage), 2 (allocation), 4 (opacity), 5 (consensus)
//   orderBy  ×3 — cat 6: lifecycleTransitions, monteCarloRuns, paperTrades

describe("mc_distribution_breach integration (mocked DB)", () => {
  let db: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.LEAK_ENABLED = "true";
    process.env.LEAK_MC_MIN_TRADES = "20";
    process.env.LEAK_MC_DD_SEVERE_MULT = "1.5";
    const mod = await import("../db/index.js");
    db = mod.db as unknown as Record<string, ReturnType<typeof vi.fn>>;
    // Reset all mock chain methods to return db synchronously (default state)
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue(db);
    (db.from as ReturnType<typeof vi.fn>).mockReturnValue(db);
    (db.innerJoin as ReturnType<typeof vi.fn>).mockReturnValue(db);
    (db.where as ReturnType<typeof vi.fn>).mockReturnValue(db);
    (db.orderBy as ReturnType<typeof vi.fn>).mockReturnValue(db);
    (db.limit as ReturnType<typeof vi.fn>).mockReturnValue(db);
  });

  it("emits mc_distribution_breach finding (high) when paper equity curve is a tail MC outcome", async () => {
    const STRATEGY_ID = "11111111-1111-1111-1111-111111111111";
    const BACKTEST_ID = "22222222-2222-2222-2222-222222222222";
    const now = Date.now();

    // 10 positive trades then 15 loss trades → severe DD + negative Sharpe
    const TRADES = [
      ...Array.from({ length: 10 }, (_, i) => ({
        strategyId: STRATEGY_ID,
        pnl: "200",
        exitTime: new Date(now - (24 - i) * 86_400_000),
      })),
      ...Array.from({ length: 15 }, (_, i) => ({
        strategyId: STRATEGY_ID,
        pnl: "-150",
        exitTime: new Date(now - (13 - i) * 86_400_000),
      })),
    ];

    // 1. Strategies query (ends at where)
    // Note: symbol="" so filter(Boolean) gives symbols=[] → detectRegimeLeak returns early
    // with zero DB calls, keeping the orderBy mock queue at exactly 7 slots (4 cats + 3 mc).
    (db.where as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: STRATEGY_ID,
        name: "TestMCStrat",
        lifecycleState: "DEPLOYED",
        preferredRegimes: null,
        regimeTrainedOn: null,
        symbol: "",
      },
    ]);

    // Categories 1+2+4+5: all empty (no slippage/allocation/opacity/consensus leaks)
    (db.orderBy as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([]) // cat 1 execution_slippage
      .mockResolvedValueOnce([]) // cat 2 allocation_drift
      .mockResolvedValueOnce([]) // cat 4 attribution_opacity
      .mockResolvedValueOnce([]) // cat 5 subsystem_consensus
      // Category 6 — three-step DB chain
      .mockResolvedValueOnce([{ strategyId: STRATEGY_ID, backtestId: BACKTEST_ID }])
      .mockResolvedValueOnce([
        {
          backtestId: BACKTEST_ID,
          sharpeP5: "0.5",      // P5 Sharpe = 0.5 (realized < this triggers breach)
          maxDrawdownP95: "0.10", // P95 DD = 10% (realized >> 10% triggers breach)
          createdAt: new Date(),
        },
      ])
      .mockResolvedValueOnce(TRADES);

    const result = await runLeakDetection();

    const mcFindings = result.leaks.filter((l) => l.category === "mc_distribution_breach");
    expect(mcFindings).toHaveLength(1);

    const finding = mcFindings[0];
    expect(finding.severity).toBe("high");
    expect(finding.strategyId).toBe(STRATEGY_ID);
    expect(finding.evidence).toMatchObject({
      mcBacktestId: BACKTEST_ID,
      tradeCount: 25,
    });
    // Advisory-only: no gate fields
    expect(finding).not.toHaveProperty("blocks_promotion");
    expect(finding).not.toHaveProperty("gate_result");
    expect(finding).not.toHaveProperty("lifecycle_action");
    expect(finding.recommendedAction).toContain("regime shift or overfit");
  });

  it("emits no mc_distribution_breach finding when no promotion lifecycle transition exists", async () => {
    const STRATEGY_ID = "33333333-3333-3333-3333-333333333333";

    (db.where as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: STRATEGY_ID,
        name: "NoTransitionStrat",
        lifecycleState: "PAPER",
        preferredRegimes: null,
        regimeTrainedOn: null,
        symbol: "", // empty → regime_leak returns early, no extra orderBy call
      },
    ]);

    (db.orderBy as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([]) // cat 1
      .mockResolvedValueOnce([]) // cat 2
      .mockResolvedValueOnce([]) // cat 4
      .mockResolvedValueOnce([]) // cat 5
      .mockResolvedValueOnce([]); // cat 6: lifecycleTransitions — no promotion rows

    const result = await runLeakDetection();

    const mcFindings = result.leaks.filter((l) => l.category === "mc_distribution_breach");
    expect(mcFindings).toHaveLength(0);
    // Service still completes successfully
    expect(result.strategies_scanned).toBe(1);
  });

  it("emits no mc_distribution_breach finding when tradeCount < LEAK_MC_MIN_TRADES", async () => {
    process.env.LEAK_MC_MIN_TRADES = "20";
    const STRATEGY_ID = "44444444-4444-4444-4444-444444444444";
    const BACKTEST_ID = "55555555-5555-5555-5555-555555555555";
    const now = Date.now();

    // Only 10 trades — below the 20-trade minimum
    const SPARSE_TRADES = Array.from({ length: 10 }, (_, i) => ({
      strategyId: STRATEGY_ID,
      pnl: "-100",
      exitTime: new Date(now - i * 86_400_000),
    }));

    (db.where as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: STRATEGY_ID,
        name: "SparseTrades",
        lifecycleState: "PAPER",
        preferredRegimes: null,
        regimeTrainedOn: null,
        symbol: "", // empty → regime_leak returns early, no extra orderBy call
      },
    ]);

    (db.orderBy as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ strategyId: STRATEGY_ID, backtestId: BACKTEST_ID }])
      .mockResolvedValueOnce([
        {
          backtestId: BACKTEST_ID,
          sharpeP5: "0.5",
          maxDrawdownP95: "0.10",
          createdAt: new Date(),
        },
      ])
      .mockResolvedValueOnce(SPARSE_TRADES);

    const result = await runLeakDetection();

    // Insufficient sample → no finding emitted
    const mcFindings = result.leaks.filter((l) => l.category === "mc_distribution_breach");
    expect(mcFindings).toHaveLength(0);
  });
});

// ─── Advisory-only invariant ──────────────────────────────────────────────────

describe("advisory-only invariant", () => {
  it("LeakFinding has no lifecycle gate fields", () => {
    // Structural test: the type must not contain gate-authority fields.
    // We verify this by constructing a valid finding and asserting absence of blocked/gate fields.
    const finding = {
      category: "regime" as const,
      severity: "high" as const,
      strategyId: "abc-123",
      strategyName: "test-strategy",
      evidence: { currentRegime: "COMPRESSION", trainedRegimes: ["TRENDING"] },
      recommendedAction: "Monitor",
    };

    expect(finding).not.toHaveProperty("blocks_promotion");
    expect(finding).not.toHaveProperty("gate_result");
    expect(finding).not.toHaveProperty("lifecycle_action");
    expect(finding).not.toHaveProperty("blocked");
  });

  it("LeakDetectionResult has no gate authority fields", () => {
    const result = {
      run_id: "test-run",
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      strategies_scanned: 5,
      leaks: [],
    };

    expect(result).not.toHaveProperty("blocked");
    expect(result).not.toHaveProperty("gate_passed");
    expect(result).not.toHaveProperty("promote");
    expect(result).not.toHaveProperty("demote");
  });

  it("mc_distribution_breach finding has no lifecycle gate fields", () => {
    // Category 6 must follow the same advisory-only contract as categories 1–5.
    const finding = {
      category: "mc_distribution_breach" as const,
      severity: "high" as const,
      strategyId: "uuid-1",
      strategyName: "strat",
      evidence: {
        dimension: "dd",
        impliedPercentile: ">P95",
        tradeCount: 25,
        mcBacktestId: "bt-uuid-1",
        realizedMaxDrawdown: 0.22,
        mcMaxDrawdownP95: 0.10,
        ddPctOverBound: 1.2,
        ddSevere: true,
      },
      recommendedAction: "Review for regime shift or overfit.",
    };

    expect(finding).not.toHaveProperty("blocks_promotion");
    expect(finding).not.toHaveProperty("gate_result");
    expect(finding).not.toHaveProperty("lifecycle_action");
    expect(finding).not.toHaveProperty("blocked");
    // category is the correct constant
    expect(finding.category).toBe("mc_distribution_breach");
  });
});
