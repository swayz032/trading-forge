/**
 * Wave 27 Pass 3.G1 — Consistency Gate Payout-Denial Prediction Signal Test
 * Test suite for src/server/lib/replay/consistency-disagreement.ts
 *
 * deep-scan (Replay-F1, 2026-07-17): this is the ONLY replay lane that
 * previously shipped with zero test coverage. Two honesty bugs were found and
 * fixed in the same wave — this suite guards both:
 *
 *   (a) `gateFiresAtThreshold` used to take a `blockPct` parameter it never
 *       referenced, so the old 5×5 warn×block threshold sweep produced
 *       byte-identical matrices per warn-row (dead parameter). Fixed by
 *       dropping the parameter and collapsing to a single-axis sweep —
 *       this suite asserts the sweep is now genuinely single-axis and that
 *       varying the ONE threshold DOES change the matrix.
 *   (b) The ground-truth label (scripts/replay-grade-consistency.ts
 *       ::inferPayoutDenied) collapses to the SAME feature
 *       (concentrationPct >= 50%) the predictor (concentrationPct >= 40%)
 *       fires on, forcing recall to be definitionally 0 or 1. This suite
 *       asserts that property explicitly and asserts the verdict is honestly
 *       capped at INCONCLUSIVE/PRELIMINARY — never SIGNAL or NO_SIGNAL.
 *   (c) n < 50 → PRELIMINARY (same floor convention as sibling lanes).
 *
 * All tests are pure-function unit tests — no DB, no filesystem side-effects.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateConsistencyGateSignal,
  buildConsistencyMarkdownReport,
  gateFiresAtThreshold,
  buildConsistencyMatrix,
  computePrecision,
  computeRecall,
  computeF1,
  computeThresholdSensitivity,
  applyConsistencyDecisionRule,
  DEFAULT_WARN_THRESHOLD_PCT,
  DEFAULT_BLOCK_THRESHOLD_PCT,
  THRESHOLD_SWEEP_VALUES,
  MIN_OBSERVATIONS_FOR_FULL_ANALYSIS,
  GROUND_TRUTH_LABEL_STRUCTURALLY_CIRCULAR,
  type DayAccountState,
  type ConsistencyConfusionMatrix,
} from "../../lib/replay/consistency-disagreement.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeObservation(overrides: Partial<DayAccountState> = {}): DayAccountState {
  return {
    accountId: `acct-${Math.random().toString(36).slice(2)}`,
    observationDate: "2026-06-01",
    concentrationPct: 30,
    gateState: "ok",
    falsePositiveSuspected: false,
    payoutDenied: false,
    ...overrides,
  };
}

/**
 * Mirrors scripts/replay-grade-consistency.ts::inferPayoutDenied — the exact
 * circular proxy this suite is guarding against. Kept as a local mirror
 * (rather than importing the CLI script, which requires DATABASE_URL at
 * module load) so the test stays a pure-function unit test.
 */
function inferPayoutDeniedMirror(
  gateState: "ok" | "warn_40" | "block_50",
  concentrationPct: number,
): boolean {
  return gateState === "block_50" || concentrationPct >= DEFAULT_BLOCK_THRESHOLD_PCT;
}

function makeCircularObservation(concentrationPct: number, index: number): DayAccountState {
  const gateState: "ok" | "warn_40" | "block_50" =
    concentrationPct >= DEFAULT_BLOCK_THRESHOLD_PCT
      ? "block_50"
      : concentrationPct >= DEFAULT_WARN_THRESHOLD_PCT
        ? "warn_40"
        : "ok";
  return makeObservation({
    accountId: `acct-${index}`,
    concentrationPct,
    gateState,
    payoutDenied: inferPayoutDeniedMirror(gateState, concentrationPct),
  });
}

describe("gateFiresAtThreshold (single-threshold predictor)", () => {
  it("fires when concentrationPct >= thresholdPct", () => {
    expect(gateFiresAtThreshold(makeObservation({ concentrationPct: 45 }), 40)).toBe(true);
    expect(gateFiresAtThreshold(makeObservation({ concentrationPct: 40 }), 40)).toBe(true);
  });

  it("does not fire when concentrationPct < thresholdPct", () => {
    expect(gateFiresAtThreshold(makeObservation({ concentrationPct: 35 }), 40)).toBe(false);
  });

  it("has a single-parameter signature (no dead blockPct argument)", () => {
    // gateFiresAtThreshold.length reflects the number of formally-declared
    // parameters — the pre-fix version declared 3 (obs, warnPct, blockPct)
    // even though it never referenced the third. Post-fix it must declare 2.
    expect(gateFiresAtThreshold.length).toBe(2);
  });
});

describe("buildConsistencyMatrix", () => {
  it("classifies TP/FP/TN/FN correctly at a given threshold", () => {
    const observations: DayAccountState[] = [
      makeObservation({ concentrationPct: 60, payoutDenied: true }), // TP
      makeObservation({ concentrationPct: 55, payoutDenied: false }), // FP
      makeObservation({ concentrationPct: 20, payoutDenied: false }), // TN
      makeObservation({ concentrationPct: 10, payoutDenied: true }), // FN
    ];
    const matrix = buildConsistencyMatrix(observations, 40);
    expect(matrix).toEqual({ tp: 1, fp: 1, tn: 1, fn: 1, skipped: 0 });
  });

  it("skips observations with payoutDenied === null", () => {
    const observations: DayAccountState[] = [
      makeObservation({ concentrationPct: 60, payoutDenied: null }),
      makeObservation({ concentrationPct: 60, payoutDenied: true }),
    ];
    const matrix = buildConsistencyMatrix(observations, 40);
    expect(matrix.skipped).toBe(1);
    expect(matrix.tp).toBe(1);
  });

  it("defaults to DEFAULT_WARN_THRESHOLD_PCT when no threshold is given", () => {
    const observations: DayAccountState[] = [
      makeObservation({ concentrationPct: DEFAULT_WARN_THRESHOLD_PCT, payoutDenied: true }),
    ];
    const matrix = buildConsistencyMatrix(observations);
    expect(matrix.tp).toBe(1);
  });
});

describe("computePrecision / computeRecall / computeF1", () => {
  it("computes precision = TP / (TP + FP)", () => {
    const cm: ConsistencyConfusionMatrix = { tp: 3, fp: 1, tn: 5, fn: 2 };
    expect(computePrecision(cm)).toBeCloseTo(0.75, 6);
  });

  it("computes recall = TP / (TP + FN)", () => {
    const cm: ConsistencyConfusionMatrix = { tp: 3, fp: 1, tn: 5, fn: 2 };
    expect(computeRecall(cm)).toBeCloseTo(0.6, 6);
  });

  it("returns 0 for precision/recall when denominator is 0 (never NaN)", () => {
    const cm: ConsistencyConfusionMatrix = { tp: 0, fp: 0, tn: 5, fn: 0 };
    expect(computePrecision(cm)).toBe(0);
    expect(computeRecall(cm)).toBe(0);
  });

  it("computes F1 = 2PR/(P+R) and returns 0 when both are 0", () => {
    expect(computeF1(0.8, 0.5)).toBeCloseTo(2 * 0.8 * 0.5 / (0.8 + 0.5), 6);
    expect(computeF1(0, 0)).toBe(0);
  });
});

describe("computeThresholdSensitivity (single-axis sweep — Fix (a))", () => {
  it("produces exactly one row per THRESHOLD_SWEEP_VALUES entry (no 5x5 grid)", () => {
    const observations = [makeObservation({ concentrationPct: 42, payoutDenied: true })];
    const sweep = computeThresholdSensitivity(observations);
    expect(sweep.length).toBe(THRESHOLD_SWEEP_VALUES.length);
  });

  it("each row's thresholdPct is a real, distinct value from THRESHOLD_SWEEP_VALUES", () => {
    const observations = [makeObservation({ concentrationPct: 42, payoutDenied: true })];
    const sweep = computeThresholdSensitivity(observations);
    const thresholds = sweep.map((r) => r.thresholdPct);
    expect(thresholds).toEqual([...THRESHOLD_SWEEP_VALUES]);
    expect(new Set(thresholds).size).toBe(thresholds.length); // all distinct
  });

  it("varying the single threshold DOES change the confusion matrix — the sweep is real, not dead", () => {
    // One observation at 41%: fires for thresholds <= 41, does not for > 41.
    const observations = [makeObservation({ concentrationPct: 41, payoutDenied: true })];
    const sweep = computeThresholdSensitivity(observations);

    const belowOrEqual = sweep.filter((r) => r.thresholdPct <= 41);
    const above = sweep.filter((r) => r.thresholdPct > 41);

    expect(belowOrEqual.length).toBeGreaterThan(0);
    expect(above.length).toBeGreaterThan(0);
    // Below/equal thresholds: gate fired (gatedCount=1). Above: gate did not fire (gatedCount=0).
    for (const row of belowOrEqual) expect(row.gatedCount).toBe(1);
    for (const row of above) expect(row.gatedCount).toBe(0);
    // Prove the rows are NOT byte-identical (the pre-fix bug's symptom).
    expect(belowOrEqual[0]).not.toEqual(above[0]);
  });

  it("no result row carries a blockThresholdPct field (dead parameter fully removed)", () => {
    const observations = [makeObservation({ concentrationPct: 42, payoutDenied: true })];
    const sweep = computeThresholdSensitivity(observations);
    for (const row of sweep) {
      expect(row).not.toHaveProperty("blockThresholdPct");
      expect(row).not.toHaveProperty("warnThresholdPct");
      expect(row).toHaveProperty("thresholdPct");
    }
  });
});

describe("circular ground-truth property — Fix (b)", () => {
  it("GROUND_TRUTH_LABEL_STRUCTURALLY_CIRCULAR is exported and true", () => {
    expect(GROUND_TRUTH_LABEL_STRUCTURALLY_CIRCULAR).toBe(true);
  });

  it("recall is always exactly 0 or 1 when the ground truth is derived via the real inferPayoutDenied proxy", () => {
    // Sweep concentrationPct across a wide, evenly-spaced range using the SAME
    // circular proxy the production script uses (mirrored above). No matter
    // how the distribution is shaped, FN must always be 0 — the truth
    // criterion (>=50%) is strictly stricter than the predictor (>=40%), so
    // every truth-positive is mathematically also a predictor-positive.
    for (const concentrations of [
      [10, 20, 30, 40, 45, 50, 55, 60, 70, 80],
      [38, 39, 40, 41, 49, 50, 51, 100],
      [0, 5, 12, 33, 47, 48, 49, 50, 62, 90, 95],
    ]) {
      const observations = concentrations.map((pct, idx) => makeCircularObservation(pct, idx));
      const matrix = buildConsistencyMatrix(observations, DEFAULT_WARN_THRESHOLD_PCT);
      expect(matrix.fn).toBe(0);
      const recall = computeRecall(matrix);
      expect(recall === 0 || recall === 1).toBe(true);
    }
  });

  it("evaluateConsistencyGateSignal on circular-proxy data reports groundTruthLabelCircular=true", () => {
    const observations = Array.from({ length: 60 }, (_, i) =>
      makeCircularObservation(20 + (i % 50), i),
    );
    const result = evaluateConsistencyGateSignal(observations);
    expect(result.groundTruthLabelCircular).toBe(true);
  });
});

describe("applyConsistencyDecisionRule — honest verdict cap (Fix (b))", () => {
  it("returns PRELIMINARY when n < MIN_OBSERVATIONS_FOR_FULL_ANALYSIS", () => {
    expect(applyConsistencyDecisionRule(0.9, 1.0, 0.9, MIN_OBSERVATIONS_FOR_FULL_ANALYSIS - 1)).toBe(
      "PRELIMINARY",
    );
    expect(applyConsistencyDecisionRule(0.1, 0, 0, 0)).toBe("PRELIMINARY");
  });

  it("returns INCONCLUSIVE at n >= MIN_OBSERVATIONS_FOR_FULL_ANALYSIS regardless of precision/recall/F1", () => {
    // These inputs would have triggered SIGNAL under the pre-fix rule
    // (precision >= 0.65 AND recall >= 0.50) — the honest fix caps them.
    expect(applyConsistencyDecisionRule(0.99, 1.0, 0.99, 1000)).toBe("INCONCLUSIVE");
    // These would have triggered NO_SIGNAL under the pre-fix rule.
    expect(applyConsistencyDecisionRule(0.01, 0.01, 0.01, 1000)).toBe("INCONCLUSIVE");
    // Boundary: exactly at the floor.
    expect(
      applyConsistencyDecisionRule(0.5, 0.5, 0.5, MIN_OBSERVATIONS_FOR_FULL_ANALYSIS),
    ).toBe("INCONCLUSIVE");
  });

  it("never returns SIGNAL or NO_SIGNAL for any precision/recall/F1 combination", () => {
    const grid = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
    for (const precision of grid) {
      for (const recall of grid) {
        for (const f1 of grid) {
          const verdict = applyConsistencyDecisionRule(precision, recall, f1, 500);
          expect(verdict).not.toBe("SIGNAL");
          expect(verdict).not.toBe("NO_SIGNAL");
        }
      }
    }
  });
});

describe("evaluateConsistencyGateSignal — regression guard against fabrication (coordinator-requested sharpening)", () => {
  it("on a corpus with GENUINE independent negatives (real FN>0, recall NOT trivially 1.0), verdict is still INCONCLUSIVE, never SIGNAL", () => {
    // This corpus is deliberately NOT built from the circular inferPayoutDenied
    // proxy (concentrationPct >= 50) — payoutDenied is assigned independently of
    // concentrationPct, producing genuine false negatives (gate did NOT fire but
    // a denial happened anyway). This is the "corpus with known negatives" check:
    // if the honesty fix ever regressed (e.g. someone restored the old ladder
    // `precision>=0.65 && recall>=0.50 -> SIGNAL`), THIS test would fail, because
    // this exact corpus produces precision=0.667 and recall=0.667 — both comfortably
    // over the old SIGNAL thresholds — on data that is NOT the degenerate circular
    // case. It proves two things at once: (1) buildConsistencyMatrix/computeRecall
    // themselves are NOT rigged to force recall to 0/1 — the circularity is a
    // property of the production ground-truth proxy, not of this pure-function
    // library; (2) the decision-rule cap holds even when the underlying data would
    // have looked like a strong, real signal under the pre-fix rule.
    const observations: DayAccountState[] = [
      ...Array.from({ length: 20 }, (_, i) =>
        makeObservation({ accountId: `tp-${i}`, concentrationPct: 45, gateState: "warn_40", payoutDenied: true }),
      ), // TP: gate fired, denial happened
      ...Array.from({ length: 10 }, (_, i) =>
        makeObservation({ accountId: `fp-${i}`, concentrationPct: 45, gateState: "warn_40", payoutDenied: false }),
      ), // FP: gate fired, no denial
      ...Array.from({ length: 20 }, (_, i) =>
        makeObservation({ accountId: `tn-${i}`, concentrationPct: 20, gateState: "ok", payoutDenied: false }),
      ), // TN: gate quiet, no denial
      ...Array.from({ length: 10 }, (_, i) =>
        makeObservation({ accountId: `fn-${i}`, concentrationPct: 20, gateState: "ok", payoutDenied: true }),
      ), // FN: gate quiet, denial happened anyway — the "known negative" the gate missed
    ];

    const result = evaluateConsistencyGateSignal(observations);

    // Sanity: this is a real, non-degenerate confusion matrix (recall is a genuine
    // fraction, NOT the definitional 0-or-1 the circular proxy always produces).
    expect(result.confusion).toEqual({ tp: 20, fp: 10, tn: 20, fn: 10 });
    expect(result.recall).toBeCloseTo(20 / 30, 4);
    expect(result.precision).toBeCloseTo(20 / 30, 4);
    expect(result.recall).not.toBe(0);
    expect(result.recall).not.toBe(1);

    // The regression guard: precision=0.667 AND recall=0.667 would have satisfied
    // the OLD rule's SIGNAL branch (precision>=0.65 && recall>=0.50). The fix must
    // still cap this at INCONCLUSIVE.
    expect(result.isPreliminary).toBe(false); // n=60 >= 50, so this isn't just the sample-size floor talking
    expect(result.verdict).toBe("INCONCLUSIVE");
    expect(result.verdict).not.toBe("SIGNAL");
  });
});

describe("evaluateConsistencyGateSignal — end-to-end honesty", () => {
  it("n < 50 with-outcome observations → PRELIMINARY verdict", () => {
    const observations = Array.from({ length: 10 }, (_, i) =>
      makeCircularObservation(20 + i, i),
    );
    const result = evaluateConsistencyGateSignal(observations);
    expect(result.isPreliminary).toBe(true);
    expect(result.verdict).toBe("PRELIMINARY");
  });

  it("n >= 50 with-outcome observations → INCONCLUSIVE verdict, never SIGNAL/NO_SIGNAL", () => {
    // Construct a dataset that would maximize precision+recall under the old
    // (broken) rule: every observation exactly at or above the block
    // threshold, guaranteeing TP-heavy, FP-free, FN-free composition.
    const observations = Array.from({ length: 60 }, (_, i) =>
      makeCircularObservation(50 + i, i), // all >= block threshold => all TP
    );
    const result = evaluateConsistencyGateSignal(observations);
    expect(result.isPreliminary).toBe(false);
    expect(result.verdict).toBe("INCONCLUSIVE");
    expect(result.verdict).not.toBe("SIGNAL");
  });

  it("handles zero observations without throwing (empty analysis fallback)", () => {
    const result = evaluateConsistencyGateSignal([]);
    expect(result.verdict).toBe("PRELIMINARY");
    expect(result.groundTruthLabelCircular).toBe(true);
    expect(result.totalObservations).toBe(0);
  });

  it("thresholdSweep on the result carries the single-axis shape (Fix a)", () => {
    const observations = Array.from({ length: 60 }, (_, i) => makeCircularObservation(20 + i, i));
    const result = evaluateConsistencyGateSignal(observations);
    expect(result.thresholdSweep.length).toBe(THRESHOLD_SWEEP_VALUES.length);
    for (const row of result.thresholdSweep) {
      expect(row).not.toHaveProperty("blockThresholdPct");
    }
  });
});

describe("buildConsistencyMarkdownReport — honest report text", () => {
  it("PRELIMINARY report warns statistical conclusions should not drive decisions", () => {
    const result = evaluateConsistencyGateSignal(
      Array.from({ length: 5 }, (_, i) => makeCircularObservation(20 + i, i)),
    );
    const report = buildConsistencyMarkdownReport(result, "2026-07-17", 90);
    expect(report).toContain("PRELIMINARY");
    expect(report).toContain("should not drive threshold-wiring decisions");
  });

  it("INCONCLUSIVE (circular) report explicitly states the ground-truth caveat and never claims predictive value", () => {
    const observations = Array.from({ length: 60 }, (_, i) => makeCircularObservation(20 + i, i));
    const result = evaluateConsistencyGateSignal(observations);
    const report = buildConsistencyMarkdownReport(result, "2026-07-17", 90);

    expect(report).toContain("STRUCTURALLY NON-INFORMATIVE");
    expect(report).toMatch(/definitionally 0 or 1/);
    // The old fabricated claim must never appear.
    expect(report).not.toContain("demonstrates predictive value");
    expect(report).not.toContain("Wire shouldBlockNewEntry() into paper-signal-service entry gate");
  });

  it("report no longer contains a '5×5 grid' threshold sweep heading", () => {
    const observations = Array.from({ length: 60 }, (_, i) => makeCircularObservation(20 + i, i));
    const result = evaluateConsistencyGateSignal(observations);
    const report = buildConsistencyMarkdownReport(result, "2026-07-17", 90);
    expect(report).not.toContain("5×5 grid");
    expect(report).not.toContain("## Threshold Optimization");
  });
});
