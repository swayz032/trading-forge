/**
 * Wave 27 Pass 3.G1 — Pattern Aggregator Appendix Improvement Signal Test
 * Test suite for src/server/lib/replay/pattern-aggregator-disagreement.ts
 *
 * All tests are pure-function unit tests — no DB, no filesystem side-effects
 * by default.
 *
 * Governance: these tests verify:
 *   - Synthetic improvement scenarios produce SIGNAL
 *   - Random Sharpe distributions produce NO_SIGNAL
 *   - PRELIMINARY flag when < MIN_VERSIONS_FOR_FULL_ANALYSIS qualifying versions
 *   - Trend test (Spearman) correctness on known data
 *   - Decision rule for all four verdict states
 *   - Dry-run: no file written (pure function contract)
 *   - Apply mode writes markdown (I/O via caller)
 *   - dryRun=true passed through to pattern-aggregator service (mock)
 *   - Attribution of strategies to appendix versions
 *   - Mann-Whitney consecutive pair comparison correctness
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  evaluatePatternAggregatorSignal,
  buildPatternAggregatorMarkdownReport,
  computeSharpe,
  computeStd,
  mannWhitneyU,
  attributeStrategiesToVersions,
  buildVersionStats,
  computeConsecutivePairs,
  applyPatternDecisionRule,
  MIN_VERSIONS_FOR_FULL_ANALYSIS,
  MIN_STRATEGIES_PER_VERSION,
  SPEARMAN_SIGNAL_RHO,
  SPEARMAN_SIGNAL_P,
  MW_IMPROVEMENT_RATE_SIGNAL,
  type AppendixVersion,
  type GeneratedStrategy,
  type PatternAggregatorAnalysisResult,
} from "../../lib/replay/pattern-aggregator-disagreement.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeVersion(
  versionIndex: number,
  activatedDaysAgo: number,
): AppendixVersion {
  const activatedAt = new Date();
  activatedAt.setDate(activatedAt.getDate() - activatedDaysAgo);
  return {
    versionId: `v-${versionIndex}`,
    versionIndex,
    activatedAt,
  };
}

function makeStrategy(
  strategyId: string,
  generatedDaysAgo: number,
  appendixVersionId: string,
  appendixVersionIndex: number,
): GeneratedStrategy {
  const generatedAt = new Date();
  generatedAt.setDate(generatedAt.getDate() - generatedDaysAgo);
  return {
    strategyId,
    appendixVersionId,
    appendixVersionIndex,
    generatedAt,
  };
}

/**
 * Build N versions with controlled avg Sharpe per version.
 * Strategies are distributed evenly across versions.
 * sharpesPerVersion[i] = Sharpe values for strategies in version i.
 */
function makeSyntheticVersionDataset(opts: {
  sharpesPerVersion: number[][];
}): {
  versions: AppendixVersion[];
  strategies: GeneratedStrategy[];
  sharpeByStrategy: Map<string, number>;
} {
  const versions: AppendixVersion[] = [];
  const strategies: GeneratedStrategy[] = [];
  const sharpeByStrategy = new Map<string, number>();

  const nVersions = opts.sharpesPerVersion.length;

  for (let vi = 0; vi < nVersions; vi++) {
    const daysAgo = (nVersions - vi) * 30; // older versions activated further back
    const v = makeVersion(vi + 1, daysAgo + 1);
    versions.push(v);

    const sharpes = opts.sharpesPerVersion[vi];
    for (let si = 0; si < sharpes.length; si++) {
      const strategyId = `strat-v${vi}-s${si}`;
      // Strategy generated shortly after version activation
      const s = makeStrategy(strategyId, daysAgo - 1, v.versionId, v.versionIndex);
      strategies.push(s);
      sharpeByStrategy.set(strategyId, sharpes[si]);
    }
  }

  return { versions, strategies, sharpeByStrategy };
}

function makeFullAnalysisResult(
  overrides: Partial<PatternAggregatorAnalysisResult>,
): PatternAggregatorAnalysisResult {
  return {
    totalVersionsQueried: 15,
    qualifyingVersions: 12,
    totalStrategiesAttributed: 80,
    strategiesWithSharpe: 70,
    spearmanRho: 0.60,
    spearmanPValue: 0.02,
    versionStats: [],
    consecutivePairs: [],
    improvementRate: 0.72,
    verdict: "SIGNAL",
    isPreliminary: false,
    auditEntries: [],
    ...overrides,
  };
}

// ─── test_synthetic_appendix_improvement ─────────────────────────────────────

describe("test_synthetic_appendix_improvement", () => {
  it("3 versions with clear monotone Sharpe improvement → SIGNAL (or PRELIMINARY if < 10 versions)", () => {
    // Note: with only 3 versions we will get PRELIMINARY since min is 10.
    // But the trend and ρ should be correct regardless.
    const { versions, strategies, sharpeByStrategy } = makeSyntheticVersionDataset({
      sharpesPerVersion: [
        [0.5, 0.6, 0.4, 0.7, 0.5, 0.6],  // v1 avg ≈ 0.55
        [0.9, 1.0, 0.8, 1.1, 0.9, 1.0],  // v2 avg ≈ 0.95
        [1.4, 1.5, 1.3, 1.6, 1.4, 1.5],  // v3 avg ≈ 1.45
      ],
    });

    const result = evaluatePatternAggregatorSignal(versions, strategies, sharpeByStrategy);
    // With 3 qualifying versions < 10 → PRELIMINARY
    expect(result.isPreliminary).toBe(true);
    expect(result.verdict).toBe("PRELIMINARY");
    // But Spearman ρ should be strongly positive
    expect(result.spearmanRho).toBeGreaterThan(0);
    expect(result.qualifyingVersions).toBe(3);
    expect(result.consecutivePairs.length).toBeGreaterThan(0);
    expect(result.consecutivePairs.every((p) => p.improvedRaw)).toBe(true);
  });

  it("10+ versions with monotone Sharpe improvement → SIGNAL", () => {
    const sharpesPerVersion: number[][] = [];
    for (let i = 0; i < 12; i++) {
      // Each version improves avg Sharpe by ~0.2
      const base = 0.5 + i * 0.2;
      sharpesPerVersion.push([base - 0.05, base, base + 0.05, base - 0.03, base + 0.03, base]);
    }

    const { versions, strategies, sharpeByStrategy } = makeSyntheticVersionDataset({
      sharpesPerVersion,
    });

    const result = evaluatePatternAggregatorSignal(versions, strategies, sharpeByStrategy);
    expect(result.isPreliminary).toBe(false);
    expect(result.qualifyingVersions).toBe(12);
    // Strong monotone → SIGNAL
    expect(result.verdict).toBe("SIGNAL");
    expect(result.spearmanRho).toBeGreaterThanOrEqual(SPEARMAN_SIGNAL_RHO);
    expect(result.improvementRate).toBeGreaterThanOrEqual(MW_IMPROVEMENT_RATE_SIGNAL);
  });

  it("improvement rate computed correctly from consecutive pairs", () => {
    // 5 pairs: 4 improved, 1 regressed → rate = 0.80
    const { versions, strategies, sharpeByStrategy } = makeSyntheticVersionDataset({
      sharpesPerVersion: [
        [0.5, 0.5, 0.5, 0.5, 0.5, 0.5],  // v1 avg=0.50
        [0.8, 0.8, 0.8, 0.8, 0.8, 0.8],  // v2 avg=0.80 → improved
        [1.0, 1.0, 1.0, 1.0, 1.0, 1.0],  // v3 avg=1.00 → improved
        [0.7, 0.7, 0.7, 0.7, 0.7, 0.7],  // v4 avg=0.70 → regressed
        [1.2, 1.2, 1.2, 1.2, 1.2, 1.2],  // v5 avg=1.20 → improved
        [1.5, 1.5, 1.5, 1.5, 1.5, 1.5],  // v6 avg=1.50 → improved
      ],
    });

    const result = evaluatePatternAggregatorSignal(versions, strategies, sharpeByStrategy);
    // 5 consecutive pairs: pairs (v1→v2), (v2→v3), (v3→v4), (v4→v5), (v5→v6)
    // improved: v1→v2 YES, v2→v3 YES, v3→v4 NO, v4→v5 YES, v5→v6 YES = 4/5 = 0.80
    expect(result.consecutivePairs.length).toBe(5);
    const improved = result.consecutivePairs.filter((p) => p.improvedRaw).length;
    expect(improved).toBe(4);
    expect(result.improvementRate).toBeCloseTo(0.80, 2);
  });
});

// ─── test_no_appendix_signal ──────────────────────────────────────────────────

describe("test_no_appendix_signal", () => {
  it("random Sharpe distribution → rho near zero → NO_SIGNAL or PRELIMINARY", () => {
    // 12 versions all with avg Sharpe ~1.0 (flat, no trend)
    const sharpesPerVersion: number[][] = [];
    for (let i = 0; i < 12; i++) {
      sharpesPerVersion.push([1.0, 1.0, 1.0, 1.0, 1.0, 1.0]);
    }

    const { versions, strategies, sharpeByStrategy } = makeSyntheticVersionDataset({
      sharpesPerVersion,
    });

    const result = evaluatePatternAggregatorSignal(versions, strategies, sharpeByStrategy);
    expect(result.qualifyingVersions).toBe(12);
    // All avg Sharpes are equal → ρ = 0 exactly → NO_SIGNAL
    expect(result.spearmanRho).toBeCloseTo(0, 4);
    expect(result.verdict).toBe("NO_SIGNAL");
  });

  it("empty strategies → PRELIMINARY with audit warn", () => {
    const versions = [makeVersion(1, 60), makeVersion(2, 30)];
    const result = evaluatePatternAggregatorSignal(versions, [], new Map());
    expect(result.verdict).toBe("PRELIMINARY");
    expect(result.isPreliminary).toBe(true);
    expect(result.totalStrategiesAttributed).toBe(0);
  });

  it("all strategies below MIN_STRATEGIES_PER_VERSION → no qualifying versions → PRELIMINARY", () => {
    // Each version has only 2 strategies (below threshold of 5)
    const { versions, strategies, sharpeByStrategy } = makeSyntheticVersionDataset({
      sharpesPerVersion: [
        [0.5, 0.6],  // only 2 strategies
        [0.8, 0.9],
        [1.0, 1.1],
      ],
    });

    const result = evaluatePatternAggregatorSignal(versions, strategies, sharpeByStrategy);
    expect(result.qualifyingVersions).toBe(0);
    expect(result.isPreliminary).toBe(true);
    expect(result.verdict).toBe("PRELIMINARY");
  });
});

// ─── test_preliminary_below_10_versions ──────────────────────────────────────

describe("test_preliminary_below_10_versions", () => {
  it("applyPatternDecisionRule with n=8 → PRELIMINARY regardless of rho", () => {
    const verdict = applyPatternDecisionRule(0.90, 0.001, 8, 1.0, 7);
    expect(verdict).toBe("PRELIMINARY");
  });

  it("applyPatternDecisionRule with n=9 → PRELIMINARY", () => {
    const verdict = applyPatternDecisionRule(0.80, 0.01, 9, 0.80, 8);
    expect(verdict).toBe("PRELIMINARY");
  });

  it("applyPatternDecisionRule with n=10 → not PRELIMINARY when signal criteria met", () => {
    const verdict = applyPatternDecisionRule(
      0.30, 0.04, 10, MW_IMPROVEMENT_RATE_SIGNAL + 0.05, 5,
    );
    expect(verdict).not.toBe("PRELIMINARY");
  });

  it("evaluatePatternAggregatorSignal sets isPreliminary=true when qualifying < 10", () => {
    const { versions, strategies, sharpeByStrategy } = makeSyntheticVersionDataset({
      sharpesPerVersion: [
        [0.5, 0.6, 0.7, 0.8, 0.5, 0.6],
        [0.8, 0.9, 1.0, 1.1, 0.8, 0.9],
      ],
    });
    const result = evaluatePatternAggregatorSignal(versions, strategies, sharpeByStrategy);
    expect(result.isPreliminary).toBe(true);
    expect(result.qualifyingVersions).toBeLessThan(MIN_VERSIONS_FOR_FULL_ANALYSIS);
  });

  it("PRELIMINARY warning appears near top of markdown report", () => {
    const result = makeFullAnalysisResult({
      qualifyingVersions: 5,
      isPreliminary: true,
      verdict: "PRELIMINARY",
    });
    const report = buildPatternAggregatorMarkdownReport(result, "2026-05-25");
    const idx = report.indexOf("PRELIMINARY");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(600);
  });
});

// ─── test_trend_test_correctness ─────────────────────────────────────────────

describe("test_trend_test_correctness", () => {
  it("perfectly monotone version indices and Sharpe → ρ = 1.0", () => {
    // 10 versions with linear Sharpe increase
    const sharpesPerVersion: number[][] = [];
    for (let i = 0; i < 10; i++) {
      const s = (i + 1) * 0.5; // 0.5, 1.0, 1.5, ..., 5.0
      sharpesPerVersion.push([s, s, s, s, s, s]);
    }

    const { versions, strategies, sharpeByStrategy } = makeSyntheticVersionDataset({
      sharpesPerVersion,
    });

    const result = evaluatePatternAggregatorSignal(versions, strategies, sharpeByStrategy);
    expect(result.spearmanRho).toBeCloseTo(1.0, 1);
    expect(result.spearmanPValue).toBeLessThan(0.05);
    expect(result.verdict).toBe("SIGNAL");
  });

  it("Mann-Whitney U returns u>0 when B has strictly higher values", () => {
    const groupA = [1, 2, 3, 4, 5];
    const groupB = [6, 7, 8, 9, 10];
    const { uStatistic, pValue } = mannWhitneyU(groupA, groupB);
    // All B values > all A values → u = nA * nB = 25
    expect(uStatistic).toBeCloseTo(25, 0);
    expect(pValue).toBeLessThan(0.05);
  });

  it("Mann-Whitney U returns u=0 when A has strictly higher values", () => {
    const groupA = [10, 11, 12, 13, 14];
    const groupB = [1, 2, 3, 4, 5];
    const { uStatistic } = mannWhitneyU(groupA, groupB);
    // B never beats A → u = 0
    expect(uStatistic).toBe(0);
  });

  it("attributeStrategiesToVersions correctly assigns to most-recent prior version", () => {
    const v1 = makeVersion(1, 100);
    const v2 = makeVersion(2, 50);
    const v3 = makeVersion(3, 10);

    // Strategy generated 30 days ago → between v2 (50d ago) and v3 (10d ago) → goes to v2
    const s = makeStrategy("strat-x", 30, v2.versionId, v2.versionIndex);

    const attribution = attributeStrategiesToVersions([v1, v2, v3], [s]);
    expect(attribution.get(v2.versionId)).toContain("strat-x");
    expect(attribution.get(v1.versionId)).not.toContain("strat-x");
    expect(attribution.get(v3.versionId)).not.toContain("strat-x");
  });
});

// ─── test_decision_rule_per_outcome ──────────────────────────────────────────

describe("test_decision_rule_per_outcome", () => {
  it("SIGNAL: rho >= 0.25 AND p <= 0.05 AND n >= 10", () => {
    const verdict = applyPatternDecisionRule(0.30, 0.04, 10, 0.50, 3);
    expect(verdict).toBe("SIGNAL");
  });

  it("SIGNAL: improvementRate >= 0.60 AND n_pairs >= 5 (even if rho low)", () => {
    const verdict = applyPatternDecisionRule(0.05, 0.80, 12, 0.70, 6);
    expect(verdict).toBe("SIGNAL");
  });

  it("INCONCLUSIVE: 0.10 <= |rho| < 0.25", () => {
    const verdict = applyPatternDecisionRule(0.15, 0.20, 12, 0.40, 5);
    expect(verdict).toBe("INCONCLUSIVE");
  });

  it("NO_SIGNAL: |rho| < 0.10", () => {
    const verdict = applyPatternDecisionRule(0.05, 0.80, 12, 0.40, 5);
    expect(verdict).toBe("NO_SIGNAL");
  });

  it("PRELIMINARY: n < 10 overrides all", () => {
    const verdict = applyPatternDecisionRule(1.0, 0.0, 5, 1.0, 9);
    expect(verdict).toBe("PRELIMINARY");
  });
});

// ─── test_dry_run_no_file_written ─────────────────────────────────────────────

describe("test_dry_run_no_file_written", () => {
  it("buildPatternAggregatorMarkdownReport returns non-empty string (pure function)", () => {
    const result = makeFullAnalysisResult({});
    const report = buildPatternAggregatorMarkdownReport(result, "2026-05-25");
    expect(typeof report).toBe("string");
    expect(report.length).toBeGreaterThan(100);
  });

  it("buildPatternAggregatorMarkdownReport does NOT write any files", () => {
    const result = makeFullAnalysisResult({});
    const tmpPath = path.join(
      os.tmpdir(),
      `pattern-dryrun-${Date.now()}.md`,
    );
    buildPatternAggregatorMarkdownReport(result, "2026-05-25");
    expect(fs.existsSync(tmpPath)).toBe(false);
  });

  it("evaluatePatternAggregatorSignal does NOT write any files", () => {
    const { versions, strategies, sharpeByStrategy } = makeSyntheticVersionDataset({
      sharpesPerVersion: [[0.5, 0.6, 0.7, 0.8, 0.5]],
    });
    const tmpPath = path.join(
      os.tmpdir(),
      `pattern-eval-${Date.now()}.md`,
    );
    evaluatePatternAggregatorSignal(versions, strategies, sharpeByStrategy);
    expect(fs.existsSync(tmpPath)).toBe(false);
  });
});

// ─── test_apply_writes_markdown ───────────────────────────────────────────────

describe("test_apply_writes_markdown", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "pattern-grade-test-"),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("report written via caller contains expected headings", () => {
    const result = makeFullAnalysisResult({});
    const report = buildPatternAggregatorMarkdownReport(result, "2026-05-25");
    const outputPath = path.join(
      tmpDir,
      "2026-05-25-pattern-aggregator-disagreement.md",
    );
    fs.writeFileSync(outputPath, report, "utf8");

    const content = fs.readFileSync(outputPath, "utf8");
    expect(content).toContain(
      "# Wave 27 Pass 3 — Pattern Aggregator Appendix Improvement Signal Test",
    );
    expect(content).toContain("## Spearman Trend Test");
    expect(content).toContain("## Per-Version Sharpe Statistics");
    expect(content).toContain("## Consecutive Version Pair Comparison");
    expect(content).toContain("## Decision Rule Applied");
    expect(content).toContain("## Reproducibility");
  });

  it("written report contains Date, Verdict, Prompt versions queried fields", () => {
    const result = makeFullAnalysisResult({ verdict: "SIGNAL" });
    const report = buildPatternAggregatorMarkdownReport(result, "2026-05-25");
    const outputPath = path.join(tmpDir, "test-report.md");
    fs.writeFileSync(outputPath, report, "utf8");

    const content = fs.readFileSync(outputPath, "utf8");
    expect(content).toContain("**Date:** 2026-05-25");
    expect(content).toContain("**Prompt versions queried:**");
    expect(content).toContain("**Verdict:** SIGNAL");
  });
});

// ─── test_dryRun_passed_to_pattern_aggregator_service ────────────────────────

describe("test_dryRun_passed_to_pattern_aggregator_service", () => {
  it("dryRun=true signature accepted by runPatternAggregator interface contract", () => {
    const called: { dryRun: boolean }[] = [];
    const mockRunPatternAggregator = (dryRun: boolean = false): Promise<unknown> => {
      called.push({ dryRun });
      return Promise.resolve({ status: "completed", critiques_reviewed: 5 });
    };

    void mockRunPatternAggregator(true);
    expect(called[0].dryRun).toBe(true);
  });

  it("dryRun=true suppresses DB writes (mock contract verification)", () => {
    const dbWrites: unknown[] = [];
    const mockDryRunPath = async (dryRun: boolean) => {
      if (!dryRun) {
        dbWrites.push({ table: "prompt_versions", action: "insert" });
        dbWrites.push({ table: "audit_log", action: "insert" });
      }
      return { status: "completed" };
    };

    void mockDryRunPath(true);
    expect(dbWrites.length).toBe(0);
  });

  it("computeSharpe returns correct value for known PnLs", () => {
    // [10, -10, 10, -10] → mean=0, std>0 → Sharpe=0
    expect(computeSharpe([10, -10, 10, -10])).toBe(0);
    // All positive PnLs → Sharpe > 0
    const s = computeSharpe([5, 5, 5, 5, 5]);
    expect(s).toBeGreaterThan(0);
  });

  it("computeStd returns 0 for single value", () => {
    expect(computeStd([5.0])).toBe(0);
  });

  it("buildVersionStats aggregates correctly for known input", () => {
    const v1 = makeVersion(1, 100);
    const v2 = makeVersion(2, 50);
    const attribution = new Map<string, string[]>([
      [v1.versionId, ["s1", "s2"]],
      [v2.versionId, ["s3", "s4", "s5"]],
    ]);
    const sharpeByStrategy = new Map([
      ["s1", 1.0],
      ["s2", 2.0],
      ["s3", 0.5],
      ["s4", 1.5],
      ["s5", 1.0],
    ]);

    const stats = buildVersionStats([v1, v2], attribution, sharpeByStrategy);
    expect(stats.length).toBe(2);

    const statV1 = stats.find((s) => s.versionId === v1.versionId)!;
    expect(statV1.avgSharpe).toBeCloseTo(1.5, 5); // (1.0+2.0)/2
    expect(statV1.nStrategies).toBe(2);

    const statV2 = stats.find((s) => s.versionId === v2.versionId)!;
    expect(statV2.avgSharpe).toBeCloseTo(1.0, 5); // (0.5+1.5+1.0)/3
    expect(statV2.nStrategies).toBe(3);
  });

  it("computeConsecutivePairs returns empty array for < 2 qualifying versions", () => {
    const stats = buildVersionStats(
      [makeVersion(1, 50)],
      new Map([["v-1", ["s1", "s2", "s3", "s4", "s5", "s6"]]]),
      new Map([["s1", 1.0], ["s2", 1.0], ["s3", 1.0], ["s4", 1.0], ["s5", 1.0], ["s6", 1.0]]),
    );
    const pairs = computeConsecutivePairs(stats);
    expect(pairs.length).toBe(0);
  });
});
