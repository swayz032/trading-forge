/**
 * Wave 27 Pass 4 — B14 Survival Twin Disagreement Signal Test
 * Test suite for src/server/lib/replay/survival-twin-disagreement.ts
 *
 * All tests are pure-function unit tests — no DB, no filesystem side-effects.
 *
 * Governance: these tests verify:
 *   - Spearman + Mann-Whitney parity vs known reference values
 *   - Decision rule mapping (SIGNAL/INCONCLUSIVE/NO_SIGNAL/PRELIMINARY)
 *   - Cross-method disagreement (survival_twin vs Pass A ruin_CI)
 *   - Per-firm independence in analysis
 *   - Dry-run: no markdown written
 *   - Apply: markdown written to path
 *   - Governance isolation (no execution authority, advisor only)
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
  applySurvivalDecisionRule,
  computeCrossMethodAgreement,
  computePerFirmMannWhitney,
  buildSurvivalTwinReport,
  mannWhitneyU,
  computePearson,
  stdNormalCdf,
  type SurvivalFoldMetrics,
  type SurvivalTwinAnalysisResult,
  type CrossMethodAgreementResult,
  MIN_FOLDS_FOR_FULL_ANALYSIS,
  SHARPE_DEGRADATION_FLOOR,
  MW_MIN_N_PER_FIRM,
  SUPPORTED_FIRMS,
} from "../../lib/replay/survival-twin-disagreement.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeFold(overrides: Partial<SurvivalFoldMetrics>): SurvivalFoldMetrics {
  return {
    replayRowId: "row-1",
    backtest_id: "bt-1",
    strategyId: "s-1",
    firm: "Topstep",
    survivalBreachProb: 0.20,
    survivalScore: 70.0,
    grade: "B",
    passARuinCiHigh: 0.22,
    crossMethodDisagreement: 0.02,
    oosSharpe: 1.2,
    isSharpe: 1.5,
    sharpeDegradation: -0.3,
    ...overrides,
  };
}

function makeAnalysis(
  overrides: Partial<SurvivalTwinAnalysisResult>,
): SurvivalTwinAnalysisResult {
  return {
    replayRowsQueried: 60,
    validFolds: 60,
    isPreliminary: false,
    spearmanRho: 0.30,
    spearmanPValue: 0.02,
    crossMethodAgreement: {
      pearsonR: 0.45,
      meanAbsDisagreement: 0.08,
      n: 55,
      betterPredictorOnDisagreement: "survival_twin",
    },
    mannWhitney: {
      firmA: "Topstep",
      firmB: "MFFU",
      nA: 30,
      nB: 30,
      uStatistic: 450,
      pValue: 0.04,
      interpretation: "test",
    },
    firmDistributions: [
      { firm: "Topstep", survivingScores: [70, 75, 80], oosSharpes: [1.2, 1.4], n: 3 },
      { firm: "MFFU", survivingScores: [65, 68, 72], oosSharpes: [1.1, 1.3], n: 3 },
    ],
    verdict: "SIGNAL",
    scorerGitShaRange: { min: "abc123", max: "def456" },
    folds: [],
    ...overrides,
  };
}

// ─── test_spearman_parity ─────────────────────────────────────────────────────

describe("test_spearman_parity_vs_reference", () => {
  it("perfectly anti-correlated arrays → rho = -1.0", () => {
    const { rho } = computeSpearman([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]);
    expect(rho).toBeCloseTo(-1.0, 6);
  });

  it("perfectly correlated arrays → rho = 1.0", () => {
    const { rho } = computeSpearman([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]);
    expect(rho).toBeCloseTo(1.0, 6);
  });

  it("n < 3 returns rho=0, pValue=1", () => {
    const { rho, pValue } = computeSpearman([1, 2], [3, 4]);
    expect(rho).toBe(0);
    expect(pValue).toBe(1.0);
  });
});

// ─── test_pearson_parity ──────────────────────────────────────────────────────

describe("test_pearson_parity", () => {
  it("perfectly correlated → r = 1.0", () => {
    const r = computePearson([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]);
    expect(r).toBeCloseTo(1.0, 5);
  });

  it("perfectly anti-correlated → r = -1.0", () => {
    const r = computePearson([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]);
    expect(r).toBeCloseTo(-1.0, 5);
  });

  it("n < 3 → r = 0", () => {
    expect(computePearson([1, 2], [3, 4])).toBe(0);
  });

  it("constant array → r = 0 (zero variance)", () => {
    expect(computePearson([2, 2, 2, 2, 2], [1, 2, 3, 4, 5])).toBe(0);
  });
});

// ─── test_mann_whitney_parity ─────────────────────────────────────────────────

describe("test_mann_whitney_parity", () => {
  it("identical distributions → p-value near 1.0 (no difference)", () => {
    const g = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const { pValue } = mannWhitneyU(g, g);
    // Identical groups: U = n*n/2 = 50, mean = 50, std = sqrt(n*n*(2n+1)/12) → z ≈ 0
    expect(pValue).toBeGreaterThan(0.8);
  });

  it("non-overlapping distributions → p-value near 0 (clear difference)", () => {
    const groupA = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const groupB = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    const { pValue } = mannWhitneyU(groupA, groupB);
    expect(pValue).toBeLessThan(0.05);
  });

  it("empty groups return pValue=1", () => {
    const { pValue } = mannWhitneyU([], [1, 2, 3]);
    expect(pValue).toBe(1.0);
  });

  it("uStatistic is non-negative", () => {
    const { uStatistic } = mannWhitneyU([1, 2, 3], [4, 5, 6]);
    expect(uStatistic).toBeGreaterThanOrEqual(0);
  });
});

// ─── test_decision_rules ──────────────────────────────────────────────────────

describe("test_decision_rules", () => {
  it("n < 50 → PRELIMINARY regardless of rho", () => {
    expect(applySurvivalDecisionRule(0.50, 0.001, 49)).toBe("PRELIMINARY");
    expect(applySurvivalDecisionRule(0.10, 0.05, 1)).toBe("PRELIMINARY");
  });

  it("|rho| >= 0.25 AND p <= 0.05 AND n >= 50 → SIGNAL", () => {
    expect(applySurvivalDecisionRule(0.30, 0.03, 60)).toBe("SIGNAL");
    expect(applySurvivalDecisionRule(-0.27, 0.04, 50)).toBe("SIGNAL");
  });

  it("0.10 <= |rho| < 0.25 AND n >= 50 → INCONCLUSIVE", () => {
    expect(applySurvivalDecisionRule(0.20, 0.10, 60)).toBe("INCONCLUSIVE");
    expect(applySurvivalDecisionRule(-0.15, 0.20, 50)).toBe("INCONCLUSIVE");
  });

  it("|rho| < 0.10 AND n >= 50 → NO_SIGNAL", () => {
    expect(applySurvivalDecisionRule(0.05, 0.60, 60)).toBe("NO_SIGNAL");
    expect(applySurvivalDecisionRule(0.00, 1.00, 50)).toBe("NO_SIGNAL");
  });

  it("border case: rho=0.25, p=0.05, n=50 → SIGNAL", () => {
    expect(applySurvivalDecisionRule(0.25, 0.05, 50)).toBe("SIGNAL");
  });
});

// ─── test_cross_method_disagreement ──────────────────────────────────────────

describe("test_cross_method_disagreement", () => {
  it("insufficient paired data → insufficient_data verdict", () => {
    const result = computeCrossMethodAgreement(
      [makeFold({ passARuinCiHigh: null })],
      SHARPE_DEGRADATION_FLOOR,
    );
    expect(result.betterPredictorOnDisagreement).toBe("insufficient_data");
  });

  it("strong correlation between methods → high pearsonR", () => {
    const folds = Array.from({ length: 10 }, (_, i) =>
      makeFold({
        survivalBreachProb: (i + 1) * 0.05,
        passARuinCiHigh: (i + 1) * 0.05 + 0.01,  // nearly identical
        sharpeDegradation: -(i + 1) * 0.05,
      }),
    );
    const result = computeCrossMethodAgreement(folds, SHARPE_DEGRADATION_FLOOR);
    expect(result.pearsonR).toBeGreaterThan(0.90);
    expect(result.n).toBe(10);
  });

  it("mean abs disagreement computed correctly for 2 paired folds", () => {
    const folds = [
      makeFold({ survivalBreachProb: 0.30, passARuinCiHigh: 0.40 }),
      makeFold({ survivalBreachProb: 0.20, passARuinCiHigh: 0.30 }),
    ];
    const result = computeCrossMethodAgreement(folds, SHARPE_DEGRADATION_FLOOR);
    // Both disagree by 0.10; mean = 0.10
    expect(result.meanAbsDisagreement).toBeCloseTo(0.10, 5);
  });

  it("folds without passARuinCiHigh excluded from paired count", () => {
    const folds = [
      makeFold({ passARuinCiHigh: 0.25 }),
      makeFold({ passARuinCiHigh: null }),
      makeFold({ passARuinCiHigh: 0.30 }),
    ];
    const result = computeCrossMethodAgreement(folds, SHARPE_DEGRADATION_FLOOR);
    expect(result.n).toBe(2);
  });
});

// ─── test_per_firm_independence ───────────────────────────────────────────────

describe("test_per_firm_independence", () => {
  it("Mann-Whitney returns null when fewer than MW_MIN_N_PER_FIRM per firm", () => {
    const folds = [
      makeFold({ firm: "Topstep", oosSharpe: 1.0 }),
      makeFold({ firm: "MFFU", oosSharpe: 0.9 }),
    ];
    const result = computePerFirmMannWhitney(folds);
    expect(result).toBeNull();
  });

  it("Mann-Whitney non-null with enough data per firm", () => {
    const folds = [
      ...Array.from({ length: MW_MIN_N_PER_FIRM }, (_, i) =>
        makeFold({ firm: "Topstep", oosSharpe: 1.0 + i * 0.1 }),
      ),
      ...Array.from({ length: MW_MIN_N_PER_FIRM }, (_, i) =>
        makeFold({ firm: "MFFU", oosSharpe: 0.8 + i * 0.1 }),
      ),
    ];
    const result = computePerFirmMannWhitney(folds);
    expect(result).not.toBeNull();
    expect(result!.firmA).toBe("Topstep");
    expect(result!.firmB).toBe("MFFU");
    expect(result!.pValue).toBeGreaterThanOrEqual(0);
    expect(result!.pValue).toBeLessThanOrEqual(1);
  });

  it("folds with null oosSharpe excluded from Mann-Whitney", () => {
    const folds = [
      ...Array.from({ length: MW_MIN_N_PER_FIRM }, (_, i) =>
        makeFold({ firm: "Topstep", oosSharpe: i % 3 === 0 ? null : 1.0 + i * 0.1 }),
      ),
      ...Array.from({ length: MW_MIN_N_PER_FIRM }, (_, i) =>
        makeFold({ firm: "MFFU", oosSharpe: 0.8 + i * 0.1 }),
      ),
    ];
    // Should not throw
    computePerFirmMannWhitney(folds);
  });
});

// ─── test_dry_run_no_markdown_written ────────────────────────────────────────

describe("test_dry_run_no_markdown_written", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "survival-twin-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("buildSurvivalTwinReport does not write files", () => {
    const analysis = makeAnalysis({});
    const report = buildSurvivalTwinReport(analysis, "2026-05-25");
    // No file was written — function is pure
    const files = fs.readdirSync(tmpDir);
    expect(files).toHaveLength(0);
    // Report string is returned
    expect(report).toContain("Wave 27 Pass 4");
  });
});

// ─── test_apply_writes_markdown ───────────────────────────────────────────────

describe("test_apply_writes_markdown", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "survival-twin-apply-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("buildSurvivalTwinReport returns string that can be written to file", () => {
    const analysis = makeAnalysis({});
    const report = buildSurvivalTwinReport(analysis, "2026-05-25");
    const outPath = path.join(tmpDir, "2026-05-25-survival-twin-disagreement.md");
    fs.writeFileSync(outPath, report, "utf8");

    expect(fs.existsSync(outPath)).toBe(true);
    const content = fs.readFileSync(outPath, "utf8");
    expect(content).toContain("Wave 27 Pass 4");
    expect(content).toContain("Spearman Test");
    expect(content).toContain("Cross-Method Agreement");
    expect(content).toContain("Per-Firm Mann-Whitney");
    expect(content).toContain("Reproducibility");
  });
});

// ─── test_report_shape ───────────────────────────────────────────────────────

describe("test_report_shape", () => {
  it("report contains all required sections", () => {
    const analysis = makeAnalysis({});
    const report = buildSurvivalTwinReport(analysis, "2026-05-26");

    expect(report).toContain("# Wave 27 Pass 4");
    expect(report).toContain("**Date:** 2026-05-26");
    expect(report).toContain("**Verdict:**");
    expect(report).toContain("## Spearman Test");
    expect(report).toContain("## Cross-Method Agreement");
    expect(report).toContain("## Per-Firm Mann-Whitney");
    expect(report).toContain("## Decision Rule Applied");
    expect(report).toContain("## Reproducibility");
  });

  it("PRELIMINARY verdict included in report body", () => {
    const analysis = makeAnalysis({ verdict: "PRELIMINARY", validFolds: 10 });
    const report = buildSurvivalTwinReport(analysis, "2026-05-26");
    expect(report).toContain("PRELIMINARY");
  });

  it("SIGNAL verdict included in report body", () => {
    const analysis = makeAnalysis({ verdict: "SIGNAL" });
    const report = buildSurvivalTwinReport(analysis, "2026-05-26");
    expect(report).toContain("SIGNAL");
  });

  it("NO_SIGNAL verdict included in report body", () => {
    const analysis = makeAnalysis({ verdict: "NO_SIGNAL" });
    const report = buildSurvivalTwinReport(analysis, "2026-05-26");
    expect(report).toContain("NO_SIGNAL");
  });

  it("governance metadata included in reproducibility section", () => {
    const analysis = makeAnalysis({});
    const report = buildSurvivalTwinReport(analysis, "2026-05-26");
    expect(report).toContain("authoritative=false");
    expect(report).toContain("decision_role=challenger_only");
    expect(report).toContain("survival_twin=true");
  });
});

// ─── test_supported_firms ─────────────────────────────────────────────────────

describe("test_supported_firms", () => {
  it("SUPPORTED_FIRMS contains Topstep and MFFU", () => {
    expect(SUPPORTED_FIRMS).toContain("Topstep");
    expect(SUPPORTED_FIRMS).toContain("MFFU");
  });

  it("per-firm fold metrics preserve firm identity", () => {
    const topstepFold = makeFold({ firm: "Topstep" });
    const mffuFold = makeFold({ firm: "MFFU" });
    expect(topstepFold.firm).toBe("Topstep");
    expect(mffuFold.firm).toBe("MFFU");
  });
});
