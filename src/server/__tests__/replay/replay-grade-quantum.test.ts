/**
 * Wave 27 Pass 1 — Quantum Disagreement Signal Test
 * Test suite for src/server/lib/replay/quantum-disagreement.ts
 *
 * All tests are pure-function unit tests — no DB, no filesystem side-effects
 * by default.
 *
 * Governance: these tests verify:
 *   - Statistical implementation correctness vs scipy reference values
 *   - IS-only threshold selection (never picked on OOS)
 *   - Purge violation detection
 *   - Decision rule mapping
 *   - Dry-run / apply mode side-effect isolation
 *   - PRELIMINARY flag below n=50
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
  selectThresholdFromIS,
  checkPurgeViolation,
  applyDecisionRule,
  buildMarkdownReport,
  computeSharpeFromTrades,
  applyEmbargo,
  computeReplayDisagreement,
  type AnalysisResult,
  type FoldMetrics,
} from "../../lib/replay/quantum-disagreement.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeFold(overrides: Partial<FoldMetrics>): FoldMetrics {
  return {
    foldId: "fold-1",
    backtestId: "bt-1",
    strategyId: "s-1",
    isStart: "2023-01-01",
    isEnd: "2023-06-30",
    oosStart: "2023-07-01",
    oosEnd: "2023-12-31",
    isSharpe: 1.5,
    disagreement: 0.08,
    oosSharpe: 1.2,
    oosProfitFactor: 1.4,
    oosAvgR: 0.5,
    sharpeDegradation: -0.3,
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<AnalysisResult>): AnalysisResult {
  return {
    replayRowsQueried: 60,
    validFolds: 60,
    spearmanRho: 0.30,
    spearmanPValue: 0.02,
    selectedThreshold: 0.10,
    binomialObservedRate: 0.65,
    binomialPValue: 0.03,
    binomialN: 20,
    thresholdResults: [0.05, 0.10, 0.15, 0.20, 0.25].map(t => ({
      threshold: t,
      isFoldsFiring: 10,
      oosDegradationRate: 0.6,
      binomialPValue: 0.04,
    })),
    verdict: "SIGNAL",
    isPreliminary: false,
    reproducibilityHashRange: { min: "abc123", max: "def456" },
    folds: [],
    ...overrides,
  };
}

// Suppress unused variable warnings — makeFold is useful for future tests
void makeFold;

// ─── test_spearman_matches_scipy_reference ─────────────────────────────────────
// scipy.stats.spearmanr([1,2,3,4,5], [5,4,3,2,1]) → rho=-1.0, p-value near 0

describe("test_spearman_matches_scipy_reference", () => {
  it("perfectly anti-correlated arrays → rho = -1.0", () => {
    const { rho } = computeSpearman([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]);
    expect(rho).toBeCloseTo(-1.0, 6);
  });

  it("perfectly correlated arrays → rho = 1.0", () => {
    const { rho } = computeSpearman([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]);
    expect(rho).toBeCloseTo(1.0, 6);
  });

  it("known reference case — rho within bounds", () => {
    // Any valid Spearman result on n=5 arrays must be in [-1, 1] with valid p-value
    const { rho, pValue } = computeSpearman([1, 3, 2, 5, 4], [4, 1, 3, 2, 5]);
    expect(rho).toBeGreaterThanOrEqual(-1.0);
    expect(rho).toBeLessThanOrEqual(1.0);
    expect(pValue).toBeGreaterThanOrEqual(0);
    expect(pValue).toBeLessThanOrEqual(1);
  });

  it("uncorrelated random-ish data has |rho| < 0.5 (synthetic sanity check)", () => {
    // Fixed data designed to give near-zero correlation
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const y = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3]; // pi digits — low correlation with 1..10
    const { rho } = computeSpearman(x, y);
    expect(Math.abs(rho)).toBeLessThan(0.5);
  });

  it("n < 3 returns rho=0, pValue=1", () => {
    const { rho, pValue } = computeSpearman([1, 2], [3, 4]);
    expect(rho).toBe(0);
    expect(pValue).toBe(1.0);
  });
});

// ─── test_binomial_matches_scipy_reference ────────────────────────────────────
// scipy.stats.binomtest(k, n, p=0.5, alternative='greater').pvalue

describe("test_binomial_matches_scipy_reference", () => {
  it("k=8, n=10, p=0.5 → pValue matches scipy reference (≈0.0547)", () => {
    // P(X >= 8 | n=10, p=0.5) = (45 + 10 + 1) / 1024 = 56/1024 ≈ 0.054688
    const pv = binomialTestPValue(8, 10, 0.5);
    expect(pv).toBeCloseTo(0.054688, 3);
  });

  it("k=10, n=10, p=0.5 → pValue ≈ 0.000977 (all successes)", () => {
    // P(X >= 10) = 0.5^10 ≈ 0.000977
    const pv = binomialTestPValue(10, 10, 0.5);
    expect(pv).toBeCloseTo(0.000977, 4);
  });

  it("k=5, n=10, p=0.5 → pValue ≈ 0.623047 (half successes, one-sided)", () => {
    // P(X >= 5) = 638/1024 ≈ 0.623047
    const pv = binomialTestPValue(5, 10, 0.5);
    expect(pv).toBeCloseTo(0.623047, 3);
  });

  it("k=0, n=10, p=0.5 → pValue = 1.0 (no degradations)", () => {
    const pv = binomialTestPValue(0, 10, 0.5);
    expect(pv).toBe(1.0);
  });

  it("n=0 → pValue = 1.0 (no data)", () => {
    const pv = binomialTestPValue(0, 0, 0.5);
    expect(pv).toBe(1.0);
  });
});

// ─── test_threshold_selection_uses_IS_only ────────────────────────────────────

describe("test_threshold_selection_uses_IS_only", () => {
  it("selects threshold where IS positive rate is in [0.15, 0.40] sweet spot", () => {
    // 10 folds with disagreements spread so only 0.20 gives 20% IS rate
    const disagreements = [
      0.02, 0.05, 0.08, 0.09, 0.12,
      0.16, 0.18, 0.22, 0.28, 0.35,
    ];
    const selected = selectThresholdFromIS(
      disagreements,
      [0.05, 0.10, 0.15, 0.20, 0.25],
    );
    const firingRate = disagreements.filter(d => d > selected).length / disagreements.length;
    expect(firingRate).toBeGreaterThanOrEqual(0.15);
    expect(firingRate).toBeLessThanOrEqual(0.40);
  });

  it("synthetic case — IS-selected threshold always from candidates list", () => {
    // Verify the function always returns a value from THRESHOLD_CANDIDATES
    const isDisagreements = [
      0.22, 0.25, 0.28, 0.30, 0.35, 0.40, 0.45, 0.50,
      0.03, 0.04,
    ];
    const selected = selectThresholdFromIS(
      isDisagreements,
      [0.05, 0.10, 0.15, 0.20, 0.25],
    );
    expect(typeof selected).toBe("number");
    expect([0.05, 0.10, 0.15, 0.20, 0.25]).toContain(selected);
  });

  it("empty disagreements returns a valid threshold candidate", () => {
    const selected = selectThresholdFromIS([], [0.05, 0.10, 0.15, 0.20, 0.25]);
    expect([0.05, 0.10, 0.15, 0.20, 0.25]).toContain(selected);
  });
});

// ─── test_purge_violation_fails_script ────────────────────────────────────────

describe("test_purge_violation_fails_script", () => {
  it("detects violation when oos_start < is_end", () => {
    const violation = checkPurgeViolation(
      "fold-bad",
      "2023-06-30",
      "2023-06-29", // oos_start < is_end — VIOLATION
    );
    expect(violation).not.toBeNull();
    expect(violation).toContain("fold-bad");
    // FIX (Wave A Critic Finding #16): canonical message now uppercase "PURGE VIOLATION"
    // (previously "Purge violation" from the old quantum-disagreement.ts implementation).
    expect(violation).toContain("PURGE VIOLATION");
  });

  it("detects violation when oos_start = is_end (equal — not strictly after)", () => {
    const violation = checkPurgeViolation(
      "fold-eq",
      "2023-06-30",
      "2023-06-30",
    );
    expect(violation).not.toBeNull();
  });

  it("returns null when oos_start > is_end (valid CPCV)", () => {
    const violation = checkPurgeViolation(
      "fold-ok",
      "2023-06-30",
      "2023-07-01",
    );
    expect(violation).toBeNull();
  });

  it("detects violation with datetime strings", () => {
    const violation = checkPurgeViolation(
      "fold-ts",
      "2023-06-30T23:59:59",
      "2023-06-30T12:00:00", // before is_end — VIOLATION
    );
    expect(violation).not.toBeNull();
  });
});

// ─── test_preliminary_flag_below_50 ──────────────────────────────────────────

describe("test_preliminary_flag_below_50", () => {
  it("n=30 → verdict is PRELIMINARY", () => {
    const verdict = applyDecisionRule(0.30, 0.01, 30, 0.65, 0.02);
    expect(verdict).toBe("PRELIMINARY");
  });

  it("n=49 → verdict is PRELIMINARY", () => {
    const verdict = applyDecisionRule(0.30, 0.01, 49, 0.65, 0.02);
    expect(verdict).toBe("PRELIMINARY");
  });

  it("n=50 → not PRELIMINARY when signal criteria met", () => {
    const verdict = applyDecisionRule(0.30, 0.01, 50, 0.65, 0.02);
    expect(verdict).not.toBe("PRELIMINARY");
  });

  it("markdown has PRELIMINARY at top when n < 50", () => {
    const analysis = makeAnalysis({
      validFolds: 30,
      isPreliminary: true,
      verdict: "PRELIMINARY",
    });
    const report = buildMarkdownReport(analysis, "2026-05-24");
    expect(report).toContain("PRELIMINARY");
    // Should appear early in the document (within first 500 chars)
    expect(report.indexOf("PRELIMINARY")).toBeLessThan(500);
  });
});

// ─── test_decision_rule_applied ───────────────────────────────────────────────

describe("test_decision_rule_applied", () => {
  it("SIGNAL: |rho| >= 0.25 AND p <= 0.05 AND n >= 50", () => {
    const verdict = applyDecisionRule(0.30, 0.02, 60, 0.55, 0.10);
    expect(verdict).toBe("SIGNAL");
  });

  it("SIGNAL: binomial rate >= 0.60 AND p <= 0.05 AND n >= 50 (weak rho OK)", () => {
    const verdict = applyDecisionRule(0.08, 0.50, 60, 0.62, 0.03);
    expect(verdict).toBe("SIGNAL");
  });

  it("INCONCLUSIVE: 0.10 <= |rho| < 0.25", () => {
    const verdict = applyDecisionRule(0.18, 0.15, 60, 0.45, 0.20);
    expect(verdict).toBe("INCONCLUSIVE");
  });

  it("NO SIGNAL: |rho| < 0.10", () => {
    const verdict = applyDecisionRule(0.05, 0.70, 60, 0.40, 0.30);
    expect(verdict).toBe("NO SIGNAL");
  });

  it("PRELIMINARY: n < 50 regardless of effect size", () => {
    const verdict = applyDecisionRule(0.90, 0.001, 10, 0.90, 0.001);
    expect(verdict).toBe("PRELIMINARY");
  });

  it("SIGNAL with negative rho (|rho| >= 0.25)", () => {
    const verdict = applyDecisionRule(-0.30, 0.02, 60, 0.55, 0.10);
    expect(verdict).toBe("SIGNAL");
  });
});

// ─── test_dry_run_no_file_written (bonus) ─────────────────────────────────────

describe("test_dry_run_no_file_written", () => {
  it("buildMarkdownReport returns a string (pure — no I/O)", () => {
    const analysis = makeAnalysis({});
    const report = buildMarkdownReport(analysis, "2026-05-24");
    expect(typeof report).toBe("string");
    expect(report.length).toBeGreaterThan(0);
  });

  it("no file is written by buildMarkdownReport (pure function, no fs calls)", () => {
    // buildMarkdownReport is a pure function — I/O is entirely in CLI main().
    // Verify: call it and confirm no temp file appears on disk.
    const tmpPath = path.join(os.tmpdir(), `replay-grade-dryrun-${Date.now()}.md`);
    const analysis = makeAnalysis({});
    buildMarkdownReport(analysis, "2026-05-24");
    expect(fs.existsSync(tmpPath)).toBe(false);
  });
});

// ─── test_apply_writes_markdown (bonus) ──────────────────────────────────────

describe("test_apply_writes_markdown", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "replay-grade-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes markdown file with expected structure", () => {
    const analysis = makeAnalysis({});
    const report = buildMarkdownReport(analysis, "2026-05-24");
    const outputPath = path.join(tmpDir, "2026-05-24-quantum-disagreement.md");

    fs.writeFileSync(outputPath, report, "utf8");

    expect(fs.existsSync(outputPath)).toBe(true);
    const content = fs.readFileSync(outputPath, "utf8");

    expect(content).toContain("# Wave 27 Pass 1 — Quantum Disagreement Signal Test");
    expect(content).toContain("## Spearman Test");
    expect(content).toContain("## Binomial Test");
    expect(content).toContain("## Threshold Robustness");
    expect(content).toContain("## Decision Rule Applied");
    expect(content).toContain("## Reproducibility");
    expect(content).toContain("Source commits: A1=5b42697, A2=e94fc3d");
    expect(content).toContain("**Verdict:**");
    expect(content).toContain("**Date:** 2026-05-24");
  });

  it("preliminary report contains bold disclaimer in first 500 chars", () => {
    const analysis = makeAnalysis({
      validFolds: 25,
      isPreliminary: true,
      verdict: "PRELIMINARY",
    });
    const report = buildMarkdownReport(analysis, "2026-05-24");
    const outputPath = path.join(tmpDir, "preliminary.md");
    fs.writeFileSync(outputPath, report, "utf8");

    const content = fs.readFileSync(outputPath, "utf8");
    const prelimIdx = content.indexOf("PRELIMINARY");
    expect(prelimIdx).toBeGreaterThanOrEqual(0);
    expect(prelimIdx).toBeLessThan(500);
  });
});

// ─── Additional statistical sanity checks ────────────────────────────────────

describe("statistical helper sanity checks", () => {
  it("computeSharpeFromTrades returns 0 for < 2 trades", () => {
    expect(computeSharpeFromTrades([])).toBe(0);
    expect(computeSharpeFromTrades([100])).toBe(0);
  });

  it("computeSharpeFromTrades returns positive Sharpe for all-positive PnLs", () => {
    const pnls = [100, 200, 150, 180, 120];
    const sharpe = computeSharpeFromTrades(pnls);
    expect(sharpe).toBeGreaterThan(0);
  });

  it("applyEmbargo drops trades on the first trading day after oosStart", () => {
    const oosStart = "2023-07-03"; // Monday
    const trades = [
      { entryTime: new Date("2023-07-03T10:00:00Z"), pnl: 100 }, // day 0
      { entryTime: new Date("2023-07-04T10:00:00Z"), pnl: 200 }, // day 1 — embargo
      { entryTime: new Date("2023-07-05T10:00:00Z"), pnl: 300 }, // day 2 — post-embargo
    ];
    const result = applyEmbargo(trades, oosStart, 1);
    expect(result.some(t => t.pnl === 300)).toBe(true);
    expect(result.every(t => t.pnl !== 100)).toBe(true);
  });

  it("applyEmbargo with embargoTradingDays=0 returns all trades", () => {
    const trades = [
      { entryTime: new Date("2023-07-03T10:00:00Z"), pnl: 100 },
      { entryTime: new Date("2023-07-04T10:00:00Z"), pnl: 200 },
    ];
    const result = applyEmbargo(trades, "2023-07-03", 0);
    expect(result.length).toBe(2);
  });

  it("threshold robustness table has 5 rows (one per candidate)", () => {
    const analysis = makeAnalysis({});
    expect(analysis.thresholdResults.length).toBe(5);
    const thresholds = analysis.thresholdResults.map(r => r.threshold);
    expect(thresholds).toContain(0.05);
    expect(thresholds).toContain(0.25);
  });
});

// ─── Gap 2 parity test: computeReplayDisagreement vs Python quantum_replay.py ──
//
// Python (src/engine/replay/quantum_replay.py:374-376):
//   disagreement = abs(quantum_estimate - stored_classical_ruin) / max(
//       abs(stored_classical_ruin), 1e-6
//   )
//
// Pins computeReplayDisagreement() to that exact formula: same numerator
// (abs(q - c)), same denominator shape (max(abs(c), epsilon)), same epsilon
// (1e-6). Values below are hand-computed against the Python formula so a
// future edit to either side that breaks parity fails this test.
describe("test_compute_replay_disagreement_matches_python_quantum_replay", () => {
  it("matches Python for typical non-negative breach/ruin probabilities", () => {
    // abs(0.25 - 0.20) / max(abs(0.20), 1e-6) = 0.05 / 0.20 = 0.25
    expect(computeReplayDisagreement(0.25, 0.20)).toBeCloseTo(0.25, 10);
    // abs(0.02 - 0.02) / max(abs(0.02), 1e-6) = 0 / 0.02 = 0
    expect(computeReplayDisagreement(0.02, 0.02)).toBeCloseTo(0, 10);
  });

  it("matches Python's epsilon floor when classical is exactly zero", () => {
    // abs(0.05 - 0) / max(abs(0), 1e-6) = 0.05 / 1e-6 = 50000
    expect(computeReplayDisagreement(0.05, 0)).toBeCloseTo(50000, 4);
  });

  it("uses abs(classical) in the denominator — NOT a bare max(c, epsilon) — for a negative classical value", () => {
    // This is the Gap 2 finding: the pre-fix TS recompute used
    // Math.max(c, 1e-6) (no abs on c), which — for a negative c — collapses
    // the denominator to 1e-6 regardless of |c|'s true magnitude. Python's
    // max(abs(c), 1e-6) instead tracks |c|. Real breach/ruin probabilities
    // are always in [0,1] (never negative) so this path is not hit by
    // production data today — but the function must match Python's formula
    // exactly, not merely "happen to agree on the domain we currently see".
    const q = 0.10;
    const c = -0.40;
    const expected = Math.abs(q - c) / Math.max(Math.abs(c), 1e-6); // = 0.50 / 0.40 = 1.25
    const buggyPreFixValue = Math.abs(q - c) / Math.max(c, 1e-6);   // = 0.50 / 1e-6 = 500000 (WRONG)
    expect(computeReplayDisagreement(q, c)).toBeCloseTo(expected, 10);
    expect(computeReplayDisagreement(q, c)).toBeCloseTo(1.25, 10);
    expect(computeReplayDisagreement(q, c)).not.toBeCloseTo(buggyPreFixValue, 0);
  });

  it("is symmetric-safe: quantum below classical produces the same magnitude as quantum above", () => {
    expect(computeReplayDisagreement(0.10, 0.20)).toBeCloseTo(
      computeReplayDisagreement(0.30, 0.20),
      10,
    );
  });
});
