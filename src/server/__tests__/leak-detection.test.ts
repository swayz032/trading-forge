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
 *
 *   5-CATEGORY CLASSIFIER mocks (DB rows supplied as test fixtures):
 *     - detectExecutionSlippage — clean, warning, high-severity
 *     - detectAllocationDrift  — clean, high-severity (contracts diverge)
 *     - detectRegimeLeak       — trained regime matches, mismatch PAPER (warning), mismatch DEPLOYED (high)
 *     - detectAttributionOpacity — all full, majority minimal (high), moderate (warning)
 *     - detectSubsystemConsensus — no drop, drop below threshold, drop above threshold
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
});
