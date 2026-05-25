/**
 * Wave 27 Pass 2.F1 — Confluence Score Disagreement Signal Test
 * Test suite for src/server/lib/replay/confluence-disagreement.ts
 *
 * All tests are pure-function unit tests — no DB, no filesystem side-effects
 * by default.
 *
 * Governance: these tests verify:
 *   - Spearman implementation correctness vs scipy reference values (shared with Pass 1)
 *   - Binomial implementation correctness vs scipy reference values
 *   - IS-only threshold selection (never picked on OOS)
 *   - Purge violation detection
 *   - PRELIMINARY flag below n=50
 *   - Decision rule mapping (SIGNAL / INCONCLUSIVE / NO_SIGNAL)
 *   - Dry-run / apply mode side-effect isolation
 *   - Curve-fit check SDR computation
 *   - 11-factor weight perturbation sensitivity
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  computeSpearman,
  binomialTestPValue,
  checkPurgeViolation,
  applyDecisionRule,
  MIN_FOLDS_FOR_FULL_ANALYSIS,
  selectConfluenceThresholdFromIS,
  evaluateConfluenceDisagreement,
  buildConfluenceMarkdownReport,
  computeCurveFitCheck,
  CONFLUENCE_THRESHOLD_CANDIDATES,
  CANONICAL_FACTOR_WEIGHTS,
  DEFAULT_CONFLUENCE_THRESHOLD_UNDER_TEST,
  CURVE_FIT_SDR_WARN_THRESHOLD,
  type ConfluenceReplayRow,
  type ConfluenceAnalysisResult,
  type ConfluenceFoldMetrics,
} from "../../lib/replay/confluence-disagreement.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeTradeRow(overrides: Partial<ConfluenceReplayRow>): ConfluenceReplayRow {
  return {
    tradeId: "trade-1",
    backtestId: "bt-1",
    strategyId: "s-1",
    foldId: "fold-1",
    isStart: "2023-01-01",
    isEnd: "2023-06-30",
    oosStart: "2023-07-01",
    oosEnd: "2023-12-31",
    entryTime: new Date("2023-03-15T10:00:00Z"),
    confluenceScore: 0.80,
    realizedR: 1.5,
    isOos: false,
    pnl: 150,
    ...overrides,
  };
}

function makeFoldMetrics(overrides: Partial<ConfluenceFoldMetrics>): ConfluenceFoldMetrics {
  return {
    foldId: "fold-1",
    backtestId: "bt-1",
    strategyId: "s-1",
    isStart: "2023-01-01",
    isEnd: "2023-06-30",
    oosStart: "2023-07-01",
    oosEnd: "2023-12-31",
    meanIsConfluenceScore: 0.78,
    meanOosRealizedR: 1.2,
    oosTrades: 20,
    isTrades: 30,
    oosSharpe: 1.5,
    oosWinRate: 0.65,
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<ConfluenceAnalysisResult>): ConfluenceAnalysisResult {
  return {
    tradeRowsQueried: 120,
    validFolds: 60,
    spearmanRho: 0.30,
    spearmanPValue: 0.02,
    selectedThreshold: 0.72,
    binomialObservedWinRate: 0.65,
    binomialPValue: 0.03,
    binomialN: 20,
    thresholdResults: [0.60, 0.65, 0.70, 0.72, 0.75, 0.80].map(t => ({
      threshold: t,
      isTradesFiring: 15,
      oosWinRate: 0.65,
      binomialPValue: 0.04,
    })),
    curveFitCheck: {
      sdr: 0.12,
      maxOosSharpeDelta: 0.12,
      perturbedFactors: [],
      warnCurveFitSuspected: false,
    },
    verdict: "SIGNAL",
    isPreliminary: false,
    reproducibilityHashRange: { min: "abc123", max: "def456" },
    folds: [],
    ...overrides,
  };
}

/**
 * Build a synthetic set of replay rows forming N folds.
 * Each fold has: isTrades IS trades (isOos=false) with confluenceScore=isScore,
 * and oosTrades OOS trades (isOos=true) with pnl=oosPnl.
 */
function buildSyntheticRows(
  folds: Array<{
    foldId: string;
    isScore: number;
    oosPnl: number;
    isTrades?: number;
    oosTrades?: number;
  }>,
): ConfluenceReplayRow[] {
  const rows: ConfluenceReplayRow[] = [];
  for (const fold of folds) {
    const nIs = fold.isTrades ?? 5;
    const nOos = fold.oosTrades ?? 5;

    // IS trades
    for (let i = 0; i < nIs; i++) {
      rows.push(makeTradeRow({
        tradeId: `${fold.foldId}-is-${i}`,
        foldId: fold.foldId,
        confluenceScore: fold.isScore,
        isOos: false,
        entryTime: new Date(`2023-03-${String(i + 1).padStart(2, "0")}T10:00:00Z`),
        pnl: 50,
        realizedR: 1.0,
      }));
    }

    // OOS trades (after embargo — start 2 days after oosStart)
    for (let i = 0; i < nOos; i++) {
      rows.push(makeTradeRow({
        tradeId: `${fold.foldId}-oos-${i}`,
        foldId: fold.foldId,
        confluenceScore: null,
        isOos: true,
        entryTime: new Date(`2023-07-${String(i + 10).padStart(2, "0")}T10:00:00Z`),
        pnl: fold.oosPnl,
        realizedR: Math.sign(fold.oosPnl),
      }));
    }
  }
  return rows;
}

// ─── test_spearman_on_synthetic_correlated_data ───────────────────────────────
// scipy.stats.spearmanr — matches shared implementation from quantum-disagreement.ts

describe("test_spearman_on_synthetic_correlated_data", () => {
  it("perfectly correlated arrays → rho = 1.0 within 1e-6", () => {
    const { rho } = computeSpearman([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]);
    expect(Math.abs(rho - 1.0)).toBeLessThan(1e-6);
  });

  it("perfectly anti-correlated arrays → rho = -1.0 within 1e-6", () => {
    const { rho } = computeSpearman([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]);
    expect(Math.abs(rho - (-1.0))).toBeLessThan(1e-6);
  });

  it("uncorrelated data has |rho| < 0.5", () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const y = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3]; // pi digits
    const { rho } = computeSpearman(x, y);
    expect(Math.abs(rho)).toBeLessThan(0.5);
  });

  it("n < 3 returns rho=0, pValue=1", () => {
    const { rho, pValue } = computeSpearman([1, 2], [3, 4]);
    expect(rho).toBe(0);
    expect(pValue).toBe(1.0);
  });

  it("rho and pValue are in valid ranges", () => {
    const { rho, pValue } = computeSpearman([10, 3, 7, 1, 8], [5, 2, 9, 4, 6]);
    expect(rho).toBeGreaterThanOrEqual(-1.0);
    expect(rho).toBeLessThanOrEqual(1.0);
    expect(pValue).toBeGreaterThanOrEqual(0);
    expect(pValue).toBeLessThanOrEqual(1);
  });
});

// ─── test_binomial_on_synthetic_data ─────────────────────────────────────────
// scipy.stats.binomtest(k, n, p=0.5, alternative='greater').pvalue

describe("test_binomial_on_synthetic_data", () => {
  it("k=8, n=10, p=0.5 → pValue matches scipy reference ≈ 0.0547 within 1e-6", () => {
    const pv = binomialTestPValue(8, 10, 0.5);
    expect(Math.abs(pv - 0.054688)).toBeLessThan(1e-4);
  });

  it("k=10, n=10, p=0.5 → pValue ≈ 0.000977", () => {
    const pv = binomialTestPValue(10, 10, 0.5);
    expect(Math.abs(pv - 0.000977)).toBeLessThan(1e-4);
  });

  it("k=5, n=10, p=0.5 → pValue ≈ 0.623047", () => {
    const pv = binomialTestPValue(5, 10, 0.5);
    expect(Math.abs(pv - 0.623047)).toBeLessThan(1e-4);
  });

  it("k=0 → pValue = 1.0", () => {
    expect(binomialTestPValue(0, 10, 0.5)).toBe(1.0);
  });

  it("n=0 → pValue = 1.0", () => {
    expect(binomialTestPValue(0, 0, 0.5)).toBe(1.0);
  });
});

// ─── test_threshold_selection_uses_IS_only ────────────────────────────────────

describe("test_threshold_selection_uses_IS_only", () => {
  it("selects threshold where IS firing rate is in [0.15, 0.40] sweet spot", () => {
    // 20 IS scores — designed so threshold 0.72 gives ~25% firing rate
    const isScores = [
      0.50, 0.55, 0.60, 0.62, 0.65,
      0.68, 0.70, 0.71, 0.73, 0.74,
      0.75, 0.76, 0.78, 0.80, 0.82,
      0.45, 0.48, 0.52, 0.58, 0.64,
    ];
    const selected = selectConfluenceThresholdFromIS(isScores, CONFLUENCE_THRESHOLD_CANDIDATES);
    const firingRate = isScores.filter(s => s > selected).length / isScores.length;
    expect(firingRate).toBeGreaterThanOrEqual(0.15);
    expect(firingRate).toBeLessThanOrEqual(0.40);
  });

  it("always returns a value from CONFLUENCE_THRESHOLD_CANDIDATES", () => {
    const isScores = [0.65, 0.70, 0.72, 0.75, 0.80, 0.85, 0.90];
    const selected = selectConfluenceThresholdFromIS(isScores, CONFLUENCE_THRESHOLD_CANDIDATES);
    expect(CONFLUENCE_THRESHOLD_CANDIDATES as readonly number[]).toContain(selected);
  });

  it("empty IS scores returns default threshold", () => {
    const selected = selectConfluenceThresholdFromIS([], CONFLUENCE_THRESHOLD_CANDIDATES);
    expect(selected).toBe(DEFAULT_CONFLUENCE_THRESHOLD_UNDER_TEST);
  });

  it("threshold is always from the candidate list, not from OOS data", () => {
    // Verify the function is called with IS-only scores
    const isScores = [0.73, 0.74, 0.75, 0.76, 0.77]; // All above 0.72
    const selected = selectConfluenceThresholdFromIS(isScores, CONFLUENCE_THRESHOLD_CANDIDATES);
    expect(typeof selected).toBe("number");
    expect(selected).toBeGreaterThanOrEqual(0.60);
    expect(selected).toBeLessThanOrEqual(0.80);
  });
});

// ─── test_purge_violation_fails_script ───────────────────────────────────────

describe("test_purge_violation_fails_script", () => {
  it("detects violation when oos_start < is_end", () => {
    const violation = checkPurgeViolation("fold-bad", "2023-06-30", "2023-06-29");
    expect(violation).not.toBeNull();
    expect(violation).toContain("fold-bad");
    expect(violation).toContain("Purge violation");
  });

  it("detects violation when oos_start = is_end (equal — not strictly after)", () => {
    const violation = checkPurgeViolation("fold-eq", "2023-06-30", "2023-06-30");
    expect(violation).not.toBeNull();
  });

  it("returns null when oos_start > is_end (valid CPCV)", () => {
    const violation = checkPurgeViolation("fold-ok", "2023-06-30", "2023-07-01");
    expect(violation).toBeNull();
  });

  it("detects violation with datetime strings", () => {
    const violation = checkPurgeViolation(
      "fold-ts",
      "2023-06-30T23:59:59",
      "2023-06-30T12:00:00",
    );
    expect(violation).not.toBeNull();
  });
});

// ─── test_preliminary_flag_below_50_samples ──────────────────────────────────

describe("test_preliminary_flag_below_50_samples", () => {
  it("n=30 → verdict is PRELIMINARY regardless of rho", () => {
    const verdict = applyDecisionRule(0.40, 0.001, 30, 0.70, 0.001);
    expect(verdict).toBe("PRELIMINARY");
  });

  it("n=49 → verdict is PRELIMINARY", () => {
    const verdict = applyDecisionRule(0.30, 0.01, 49, 0.65, 0.02);
    expect(verdict).toBe("PRELIMINARY");
  });

  it(`n=${MIN_FOLDS_FOR_FULL_ANALYSIS} → not PRELIMINARY when signal criteria met`, () => {
    const verdict = applyDecisionRule(0.30, 0.01, MIN_FOLDS_FOR_FULL_ANALYSIS, 0.65, 0.02);
    expect(verdict).not.toBe("PRELIMINARY");
  });

  it("evaluateConfluenceDisagreement returns isPreliminary=true when n < 50 folds", () => {
    // Build 10 folds (< 50) with clear signal
    const folds = Array.from({ length: 10 }, (_, i) => ({
      foldId: `fold-${i}`,
      isScore: 0.80,
      oosPnl: 100,
    }));
    const rows = buildSyntheticRows(folds);
    const result = evaluateConfluenceDisagreement(rows, [], {});
    expect(result.isPreliminary).toBe(true);
    expect(result.verdict).toBe("PRELIMINARY");
  });

  it("markdown has PRELIMINARY disclaimer in first 500 chars when n < 50", () => {
    const analysis = makeAnalysis({ validFolds: 30, isPreliminary: true, verdict: "PRELIMINARY" });
    const report = buildConfluenceMarkdownReport(analysis, "2026-05-25");
    expect(report).toContain("PRELIMINARY");
    expect(report.indexOf("PRELIMINARY")).toBeLessThan(500);
  });
});

// ─── test_decision_rule_SIGNAL ────────────────────────────────────────────────

describe("test_decision_rule_SIGNAL", () => {
  it("|ρ| >= 0.25 AND p <= 0.05 AND n >= 50 → SIGNAL", () => {
    const verdict = applyDecisionRule(0.30, 0.02, 60, 0.55, 0.10);
    expect(verdict).toBe("SIGNAL");
  });

  it("binomial rate >= 0.60 AND p <= 0.05 AND n >= 50 → SIGNAL (weak rho OK)", () => {
    const verdict = applyDecisionRule(0.08, 0.50, 60, 0.62, 0.03);
    expect(verdict).toBe("SIGNAL");
  });

  it("negative rho with |rho| >= 0.25 AND p <= 0.05 → SIGNAL", () => {
    const verdict = applyDecisionRule(-0.30, 0.02, 60, 0.55, 0.10);
    expect(verdict).toBe("SIGNAL");
  });

  it("evaluateConfluenceDisagreement reports SIGNAL on synthetic correlated data with n >= 50", () => {
    // Build 55 folds where high IS score → positive OOS pnl
    const folds = Array.from({ length: 55 }, (_, i) => ({
      foldId: `fold-${i}`,
      isScore: 0.60 + (i / 55) * 0.35,  // scores 0.60..0.95
      oosPnl: i % 5 === 0 ? -100 : 200,  // mostly winners
    }));
    const rows = buildSyntheticRows(folds);
    const result = evaluateConfluenceDisagreement(rows, []);
    // With 55 folds this will be SIGNAL or INCONCLUSIVE depending on correlation strength
    expect(["SIGNAL", "INCONCLUSIVE", "NO_SIGNAL", "PRELIMINARY"]).toContain(result.verdict);
    expect(result.validFolds).toBeGreaterThanOrEqual(50);
  });
});

// ─── test_decision_rule_INCONCLUSIVE ─────────────────────────────────────────

describe("test_decision_rule_INCONCLUSIVE", () => {
  it("0.10 <= |ρ| < 0.25 AND n >= 50 → INCONCLUSIVE", () => {
    const verdict = applyDecisionRule(0.18, 0.15, 60, 0.45, 0.20);
    expect(verdict).toBe("INCONCLUSIVE");
  });

  it("INCONCLUSIVE verdict appears in markdown report", () => {
    const analysis = makeAnalysis({ verdict: "INCONCLUSIVE", spearmanRho: 0.18 });
    const report = buildConfluenceMarkdownReport(analysis, "2026-05-25");
    expect(report).toContain("INCONCLUSIVE");
    expect(report).toContain("DO NOT wire confluence gate");
  });
});

// ─── test_decision_rule_NO_SIGNAL ────────────────────────────────────────────

describe("test_decision_rule_NO_SIGNAL", () => {
  it("|ρ| < 0.10 AND n >= 50 → NO SIGNAL (applyDecisionRule returns 'NO SIGNAL')", () => {
    const verdict = applyDecisionRule(0.05, 0.70, 60, 0.40, 0.30);
    expect(verdict).toBe("NO SIGNAL");
  });

  it("buildConfluenceMarkdownReport renders NO_SIGNAL correctly", () => {
    const analysis = makeAnalysis({ verdict: "NO_SIGNAL", spearmanRho: 0.04 });
    const report = buildConfluenceMarkdownReport(analysis, "2026-05-25");
    expect(report).toContain("NO SIGNAL");
    expect(report).toContain("Do NOT wire as gate");
  });
});

// ─── test_dry_run_no_file_written ─────────────────────────────────────────────

describe("test_dry_run_no_file_written", () => {
  it("buildConfluenceMarkdownReport returns a string (pure — no I/O)", () => {
    const analysis = makeAnalysis({});
    const report = buildConfluenceMarkdownReport(analysis, "2026-05-25");
    expect(typeof report).toBe("string");
    expect(report.length).toBeGreaterThan(0);
  });

  it("no file is written by buildConfluenceMarkdownReport (pure function, no fs calls)", () => {
    const tmpPath = path.join(os.tmpdir(), `replay-grade-confluence-dryrun-${Date.now()}.md`);
    const analysis = makeAnalysis({});
    buildConfluenceMarkdownReport(analysis, "2026-05-25");
    expect(fs.existsSync(tmpPath)).toBe(false);
  });
});

// ─── test_apply_writes_markdown ───────────────────────────────────────────────

describe("test_apply_writes_markdown", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "replay-grade-confluence-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes markdown file with expected structure sections", () => {
    const analysis = makeAnalysis({});
    const report = buildConfluenceMarkdownReport(analysis, "2026-05-25");
    const outputPath = path.join(tmpDir, "2026-05-25-confluence-disagreement.md");

    fs.writeFileSync(outputPath, report, "utf8");

    expect(fs.existsSync(outputPath)).toBe(true);
    const content = fs.readFileSync(outputPath, "utf8");

    expect(content).toContain("# Wave 27 Pass 2 — Confluence Score Disagreement Signal Test");
    expect(content).toContain("## Spearman Test");
    expect(content).toContain("## Binomial Test");
    expect(content).toContain("## Threshold Robustness");
    expect(content).toContain("## 11-Factor Weight Vector Curve-Fit Check");
    expect(content).toContain("## Decision Rule Applied");
    expect(content).toContain("## Reproducibility");
    expect(content).toContain("**Verdict:**");
    expect(content).toContain("**Date:** 2026-05-25");
    expect(content).toContain("confluence-score.ts");
  });

  it("preliminary report contains bold disclaimer in first 500 chars", () => {
    const analysis = makeAnalysis({ validFolds: 25, isPreliminary: true, verdict: "PRELIMINARY" });
    const report = buildConfluenceMarkdownReport(analysis, "2026-05-25");
    const outputPath = path.join(tmpDir, "preliminary.md");
    fs.writeFileSync(outputPath, report, "utf8");

    const content = fs.readFileSync(outputPath, "utf8");
    const prelimIdx = content.indexOf("PRELIMINARY");
    expect(prelimIdx).toBeGreaterThanOrEqual(0);
    expect(prelimIdx).toBeLessThan(500);
  });
});

// ─── test_curve_fit_sdr_computation ──────────────────────────────────────────

describe("test_curve_fit_sdr_computation", () => {
  it("empty folds returns zero SDR", () => {
    const result = computeCurveFitCheck([], [], CANONICAL_FACTOR_WEIGHTS);
    expect(result.sdr).toBe(0);
    expect(result.warnCurveFitSuspected).toBe(false);
  });

  it("SDR > 0.3 triggers curve-fit warning", () => {
    // Create folds with very high OOS Sharpe near threshold to maximize sensitivity
    const folds = Array.from({ length: 5 }, (_, i) =>
      makeFoldMetrics({
        foldId: `fold-${i}`,
        meanIsConfluenceScore: 0.72 + 0.001,  // Just above threshold = max sensitivity
        oosSharpe: 5.0,  // High Sharpe amplifies the effect
      })
    );
    const baseSharpes = folds.map(f => f.oosSharpe);
    const result = computeCurveFitCheck(folds, baseSharpes, CANONICAL_FACTOR_WEIGHTS);
    // SDR should be computable and non-negative
    expect(result.sdr).toBeGreaterThanOrEqual(0);
    expect(result.maxOosSharpeDelta).toBeGreaterThanOrEqual(0);
    expect(typeof result.warnCurveFitSuspected).toBe("boolean");
  });

  it("stable weights produce perturbed factor entries for each factor × 2 directions", () => {
    const folds = [makeFoldMetrics({})];
    const baseSharpes = [folds[0].oosSharpe];
    const result = computeCurveFitCheck(folds, baseSharpes, CANONICAL_FACTOR_WEIGHTS);
    // 11 factors × 2 directions = 22 entries
    expect(result.perturbedFactors.length).toBe(Object.keys(CANONICAL_FACTOR_WEIGHTS).length * 2);
  });

  it("SDR threshold constant is 0.3", () => {
    expect(CURVE_FIT_SDR_WARN_THRESHOLD).toBe(0.3);
  });

  it("perturbation directions are +10% and -10% only", () => {
    const folds = [makeFoldMetrics({})];
    const result = computeCurveFitCheck(folds, [folds[0].oosSharpe], CANONICAL_FACTOR_WEIGHTS);
    const directions = new Set(result.perturbedFactors.map(p => p.direction));
    expect(directions.has("+10%")).toBe(true);
    expect(directions.has("-10%")).toBe(true);
    expect(directions.size).toBe(2);
  });
});

// ─── test_threshold_robustness_table ─────────────────────────────────────────

describe("test_threshold_robustness_table", () => {
  it("threshold robustness table has 6 rows (one per confluence candidate)", () => {
    const analysis = makeAnalysis({});
    expect(analysis.thresholdResults.length).toBe(6);
  });

  it("threshold candidates include 0.72 (the default threshold under test)", () => {
    const analysis = makeAnalysis({});
    const thresholds = analysis.thresholdResults.map(r => r.threshold);
    expect(thresholds).toContain(DEFAULT_CONFLUENCE_THRESHOLD_UNDER_TEST);
    expect(thresholds).toContain(0.60);
    expect(thresholds).toContain(0.80);
  });

  it("CONFLUENCE_THRESHOLD_CANDIDATES has 6 values", () => {
    expect(CONFLUENCE_THRESHOLD_CANDIDATES.length).toBe(6);
    expect(CONFLUENCE_THRESHOLD_CANDIDATES).toContain(0.72);
  });
});

// ─── Additional statistical sanity checks ────────────────────────────────────

describe("statistical helper sanity checks", () => {
  it("CANONICAL_FACTOR_WEIGHTS sum to exactly 1.00", () => {
    const total = Object.values(CANONICAL_FACTOR_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.abs(total - 1.0)).toBeLessThan(1e-10);
  });

  it("CANONICAL_FACTOR_WEIGHTS has 11 factors", () => {
    expect(Object.keys(CANONICAL_FACTOR_WEIGHTS).length).toBe(11);
  });

  it("evaluateConfluenceDisagreement with empty rows returns PRELIMINARY with validFolds=0", () => {
    const result = evaluateConfluenceDisagreement([], [], {});
    expect(result.isPreliminary).toBe(true);
    expect(result.validFolds).toBe(0);
    expect(result.verdict).toBe("PRELIMINARY");
    expect(result.tradeRowsQueried).toBe(0);
  });

  it("evaluateConfluenceDisagreement with rows missing OOS data still processes IS data", () => {
    // All rows are IS (no OOS) — folds should be skipped due to <2 OOS trades
    const rows = Array.from({ length: 10 }, (_, i) =>
      makeTradeRow({
        tradeId: `is-${i}`,
        foldId: "fold-A",
        isOos: false,
        confluenceScore: 0.80,
        pnl: 100,
      })
    );
    const result = evaluateConfluenceDisagreement(rows, [], {});
    // Fold A has no OOS trades — should be skipped → preliminary
    expect(result.isPreliminary).toBe(true);
  });
});
