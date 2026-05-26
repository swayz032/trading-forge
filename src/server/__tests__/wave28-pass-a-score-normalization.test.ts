/**
 * wave28-pass-a-score-normalization.test.ts — Wave 28 Pass A.3
 *
 * Verifies the pure-function score-normalization library:
 *   - Each normalizer: floor, ceiling, mid-value
 *   - Composite: happy path, renormalization with nulls, below MIN_AVAILABLE
 *   - EQUAL_WEIGHTS: sum to 1.00 ± 0.0001, frozen
 *   - computeWeightsVersionId: deterministic, changes on weight mutation
 *   - verdictFromComposite: boundary tests + null passthrough
 *   - B14 invert correctness
 */

import { describe, it, expect } from "vitest";
import {
  EQUAL_WEIGHTS,
  MIN_AVAILABLE_FOR_COMPOSITE,
  VERDICT_HEALTHY_THRESHOLD,
  VERDICT_MARGINAL_THRESHOLD,
  VERDICT_UNHEALTHY_THRESHOLD,
  normalizeB14SurvivalTwin,
  normalizeWfe,
  normalizeParameterDrift,
  normalizeB15Robustness,
  normalizeCompliance,
  normalizeTradeCritique,
  normalizePatternAggregator,
  normalizeConsistencyTracker,
  normalizeDeepAr,
  normalizeBlackSwan,
  normalizeNemo,
  normalizeQuantumReplay,
  computeComposite,
  computeWeightsVersionId,
  verdictFromComposite,
  WFE_CLIP_MAX,
  type SubsystemScores,
} from "../lib/score-normalization.js";

// ─── EQUAL_WEIGHTS structural invariants ─────────────────────────────────────

describe("EQUAL_WEIGHTS", () => {
  it("sums to 1.00 ± 0.0001", () => {
    const total = Object.values(EQUAL_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 4);
  });

  it("is frozen — mutation throws in strict mode", () => {
    expect(() => {
      // TypeScript would catch this at compile time; we test the runtime guard.
      (EQUAL_WEIGHTS as Record<string, number>)["b14_survival_twin"] = 999;
    }).toThrow();
  });

  it("has exactly 12 keys", () => {
    expect(Object.keys(EQUAL_WEIGHTS).length).toBe(12);
  });
});

// ─── B14 Survival Twin ────────────────────────────────────────────────────────

describe("normalizeB14SurvivalTwin", () => {
  it("ci_high=0.0 (floor) → score=1.0", () => {
    expect(normalizeB14SurvivalTwin(0.0, true)).toBeCloseTo(1.0);
  });

  it("ci_high=1.0 (ceiling) → score=0.0", () => {
    expect(normalizeB14SurvivalTwin(1.0, true)).toBeCloseTo(0.0);
  });

  it("ci_high=0.40 (gate threshold) → score=0.60", () => {
    expect(normalizeB14SurvivalTwin(0.40, true)).toBeCloseTo(0.60);
  });

  it("ci_high=0.5 (mid) → score=0.5", () => {
    expect(normalizeB14SurvivalTwin(0.5, true)).toBeCloseTo(0.5);
  });

  it("unavailable → null", () => {
    expect(normalizeB14SurvivalTwin(0.3, false)).toBeNull();
  });
});

// ─── WFE ─────────────────────────────────────────────────────────────────────

describe("normalizeWfe", () => {
  it("wfe=0.0 (floor) → score=0.0", () => {
    expect(normalizeWfe(0.0, true)).toBeCloseTo(0.0);
  });

  it("wfe=1.5 (clip max) → score=1.0", () => {
    expect(normalizeWfe(WFE_CLIP_MAX, true)).toBeCloseTo(1.0);
  });

  it("wfe=2.0 (above clip max) → score=1.0 (clipped)", () => {
    expect(normalizeWfe(2.0, true)).toBeCloseTo(1.0);
  });

  it("wfe=0.75 (mid) → score=0.5", () => {
    expect(normalizeWfe(0.75, true)).toBeCloseTo(0.5);
  });

  it("unavailable → null", () => {
    expect(normalizeWfe(0.8, false)).toBeNull();
  });
});

// ─── Parameter Drift ─────────────────────────────────────────────────────────

describe("normalizeParameterDrift", () => {
  it("stable → 1.0", () => {
    expect(normalizeParameterDrift("stable", true)).toBeCloseTo(1.0);
  });

  it("regime_driven → 0.75", () => {
    expect(normalizeParameterDrift("regime_driven", true)).toBeCloseTo(0.75);
  });

  it("indeterminate → 0.40", () => {
    expect(normalizeParameterDrift("indeterminate", true)).toBeCloseTo(0.40);
  });

  it("overfit_drift → 0.0", () => {
    expect(normalizeParameterDrift("overfit_drift", true)).toBeCloseTo(0.0);
  });

  it("unknown classification → null", () => {
    expect(normalizeParameterDrift("unknown_class", true)).toBeNull();
  });

  it("unavailable → null", () => {
    expect(normalizeParameterDrift("stable", false)).toBeNull();
  });
});

// ─── B15 Robustness ───────────────────────────────────────────────────────────

describe("normalizeB15Robustness", () => {
  it("perfect (SDR=1, PSI=0, RWS=0) → score=1.0", () => {
    expect(normalizeB15Robustness(1.0, 0.0, 0.0, true)).toBeCloseTo(1.0);
  });

  it("worst (SDR=0, PSI=0.05, RWS=0.20) → score=0.0", () => {
    // min(0, 1-0.05×20, 1-0.20×5) = min(0, 0, 0) = 0
    expect(normalizeB15Robustness(0.0, 0.05, 0.20, true)).toBeCloseTo(0.0);
  });

  it("borderline (SDR=0.85, PSI=0.025, RWS=0.10) → score=0.50", () => {
    // 1-PSI×20 = 1-0.5 = 0.5; 1-RWS×5 = 1-0.5 = 0.5; min(0.85, 0.5, 0.5) = 0.5
    expect(normalizeB15Robustness(0.85, 0.025, 0.10, true)).toBeCloseTo(0.5);
  });

  it("unavailable → null", () => {
    expect(normalizeB15Robustness(0.9, 0.01, 0.05, false)).toBeNull();
  });
});

// ─── Compliance ───────────────────────────────────────────────────────────────

describe("normalizeCompliance", () => {
  it("block_rate=0 (floor) → score=1.0", () => {
    expect(normalizeCompliance(0.0, true)).toBeCloseTo(1.0);
  });

  it("block_rate=1 (ceiling) → score=0.0", () => {
    expect(normalizeCompliance(1.0, true)).toBeCloseTo(0.0);
  });

  it("block_rate=0.5 (mid) → score=0.5", () => {
    expect(normalizeCompliance(0.5, true)).toBeCloseTo(0.5);
  });

  it("unavailable → null", () => {
    expect(normalizeCompliance(0.0, false)).toBeNull();
  });
});

// ─── Trade Critique ───────────────────────────────────────────────────────────

describe("normalizeTradeCritique", () => {
  it("all A+ → 1.0", () => {
    expect(normalizeTradeCritique(["A+", "A+", "A+"], true)).toBeCloseTo(1.0);
  });

  it("all F → 0.0", () => {
    expect(normalizeTradeCritique(["F", "F"], true)).toBeCloseTo(0.0);
  });

  it("A+ and F average → 0.5", () => {
    // (1.0 + 0.0) / 2 = 0.5
    expect(normalizeTradeCritique(["A+", "F"], true)).toBeCloseTo(0.5);
  });

  it("single B → 0.55", () => {
    expect(normalizeTradeCritique(["B"], true)).toBeCloseTo(0.55);
  });

  it("empty grades → null", () => {
    expect(normalizeTradeCritique([], true)).toBeNull();
  });

  it("unrecognized grade → null", () => {
    expect(normalizeTradeCritique(["X", "A+"], true)).toBeNull();
  });

  it("unavailable → null", () => {
    expect(normalizeTradeCritique(["A+"], false)).toBeNull();
  });
});

// ─── Pattern Aggregator ───────────────────────────────────────────────────────

describe("normalizePatternAggregator", () => {
  it("applied → 1.0", () => {
    expect(normalizePatternAggregator("applied", true)).toBeCloseTo(1.0);
  });

  it("no_change → 0.7", () => {
    expect(normalizePatternAggregator("no_change", true)).toBeCloseTo(0.7);
  });

  it("failed → 0.0", () => {
    expect(normalizePatternAggregator("failed", true)).toBeCloseTo(0.0);
  });

  it("unknown verdict → null", () => {
    expect(normalizePatternAggregator("unknown", true)).toBeNull();
  });

  it("unavailable → null", () => {
    expect(normalizePatternAggregator("applied", false)).toBeNull();
  });
});

// ─── Consistency Tracker ─────────────────────────────────────────────────────

describe("normalizeConsistencyTracker", () => {
  it("pct=0.30 (well below 40% floor) → score=1.0", () => {
    expect(normalizeConsistencyTracker(0.30, true)).toBeCloseTo(1.0);
  });

  it("pct=0.40 (at floor boundary) → score=1.0", () => {
    expect(normalizeConsistencyTracker(0.40, true)).toBeCloseTo(1.0);
  });

  it("pct=0.50 (at ceiling boundary) → score=0.0", () => {
    expect(normalizeConsistencyTracker(0.50, true)).toBeCloseTo(0.0);
  });

  it("pct=0.60 (above ceiling) → score=0.0 (clamped)", () => {
    expect(normalizeConsistencyTracker(0.60, true)).toBeCloseTo(0.0);
  });

  it("pct=0.45 (mid) → score=0.5", () => {
    // (0.50 - 0.45) / (0.50 - 0.40) = 0.5
    expect(normalizeConsistencyTracker(0.45, true)).toBeCloseTo(0.5);
  });

  it("unavailable → null", () => {
    expect(normalizeConsistencyTracker(0.35, false)).toBeNull();
  });
});

// ─── DeepAR ───────────────────────────────────────────────────────────────────

describe("normalizeDeepAr", () => {
  it("error=0 (perfect) → score=1.0", () => {
    expect(normalizeDeepAr(0.0, true)).toBeCloseTo(1.0);
  });

  it("error=threshold (at max) → score=0.0", () => {
    expect(normalizeDeepAr(1.0, true, 1.0)).toBeCloseTo(0.0);
  });

  it("error=0.5 with threshold=1.0 → score=0.5", () => {
    expect(normalizeDeepAr(0.5, true, 1.0)).toBeCloseTo(0.5);
  });

  it("negative error uses absolute value", () => {
    expect(normalizeDeepAr(-0.5, true, 1.0)).toBeCloseTo(0.5);
  });

  it("unavailable → null", () => {
    expect(normalizeDeepAr(0.1, false)).toBeNull();
  });
});

// ─── Black Swan ───────────────────────────────────────────────────────────────

describe("normalizeBlackSwan", () => {
  it("score=0 (floor) → 0.0", () => {
    expect(normalizeBlackSwan(0.0, true)).toBeCloseTo(0.0);
  });

  it("score=1 (ceiling) → 1.0", () => {
    expect(normalizeBlackSwan(1.0, true)).toBeCloseTo(1.0);
  });

  it("score=0.5 (mid) → 0.5 passthrough", () => {
    expect(normalizeBlackSwan(0.5, true)).toBeCloseTo(0.5);
  });

  it("unavailable → null", () => {
    expect(normalizeBlackSwan(0.8, false)).toBeNull();
  });
});

// ─── NeMo ─────────────────────────────────────────────────────────────────────

describe("normalizeNemo", () => {
  it("score=0 (floor) → 0.0", () => {
    expect(normalizeNemo(0.0, true)).toBeCloseTo(0.0);
  });

  it("score=1 (ceiling) → 1.0", () => {
    expect(normalizeNemo(1.0, true)).toBeCloseTo(1.0);
  });

  it("score=0.7 (mid) → 0.7 passthrough", () => {
    expect(normalizeNemo(0.7, true)).toBeCloseTo(0.7);
  });

  it("unavailable → null", () => {
    expect(normalizeNemo(0.5, false)).toBeNull();
  });
});

// ─── Quantum Replay ───────────────────────────────────────────────────────────

describe("normalizeQuantumReplay", () => {
  it("SIGNAL → 1.0", () => {
    expect(normalizeQuantumReplay("SIGNAL", true)).toBeCloseTo(1.0);
  });

  it("PRELIMINARY → 0.7", () => {
    expect(normalizeQuantumReplay("PRELIMINARY", true)).toBeCloseTo(0.7);
  });

  it("INCONCLUSIVE → 0.5", () => {
    expect(normalizeQuantumReplay("INCONCLUSIVE", true)).toBeCloseTo(0.5);
  });

  it("NO_SIGNAL → 0.3", () => {
    expect(normalizeQuantumReplay("NO_SIGNAL", true)).toBeCloseTo(0.3);
  });

  it("FAILURE → 0.0", () => {
    expect(normalizeQuantumReplay("FAILURE", true)).toBeCloseTo(0.0);
  });

  it("unknown verdict → null", () => {
    expect(normalizeQuantumReplay("UNKNOWN", true)).toBeNull();
  });

  it("unavailable → null", () => {
    expect(normalizeQuantumReplay("SIGNAL", false)).toBeNull();
  });
});

// ─── computeComposite ─────────────────────────────────────────────────────────

function allScores(value: number): SubsystemScores {
  return {
    b14_survival_twin:   value,
    wfe:                 value,
    parameter_drift:     value,
    b15_robustness:      value,
    compliance:          value,
    trade_critique:      value,
    pattern_aggregator:  value,
    consistency_tracker: value,
    deepar:              value,
    black_swan:          value,
    nemo:                value,
    quantum_replay:      value,
  };
}

describe("computeComposite — happy path", () => {
  it("all 12 scores at 0.5 → composite=0.5", () => {
    const result = computeComposite(allScores(0.5));
    expect(result.score).toBeCloseTo(0.5);
    expect(result.availableCount).toBe(12);
  });

  it("all 12 scores at 1.0 → composite=1.0", () => {
    const result = computeComposite(allScores(1.0));
    expect(result.score).toBeCloseTo(1.0);
  });

  it("all 12 scores at 0.0 → composite=0.0", () => {
    const result = computeComposite(allScores(0.0));
    expect(result.score).toBeCloseTo(0.0);
  });
});

describe("computeComposite — renormalization with nulls", () => {
  it("4 nulls + 8 scores of 0.5 → composite=0.5 (denominator = sum of 8 weights)", () => {
    const scores: SubsystemScores = {
      ...allScores(0.5),
      black_swan:    null,
      nemo:          null,
      quantum_replay: null,
      deepar:        null,
    };
    const result = computeComposite(scores);
    expect(result.availableCount).toBe(8);
    // Each equal weight is 1/12.  8 × (1/12) × 0.5  / (8 × 1/12) = 0.5
    expect(result.score).toBeCloseTo(0.5);
  });

  it("4 nulls + 8 scores at 1.0 → composite=1.0 (renorm denominator correct)", () => {
    const scores: SubsystemScores = {
      ...allScores(1.0),
      black_swan:    null,
      nemo:          null,
      quantum_replay: null,
      deepar:        null,
    };
    const result = computeComposite(scores);
    expect(result.score).toBeCloseTo(1.0);
  });
});

describe("computeComposite — below MIN_AVAILABLE", () => {
  it("7 non-null scores (< 8 minimum) → score=null, verdict=null", () => {
    const scores: SubsystemScores = {
      b14_survival_twin: 0.8,
      wfe:               0.8,
      parameter_drift:   0.8,
      b15_robustness:    0.8,
      compliance:        0.8,
      trade_critique:    0.8,
      pattern_aggregator: 0.8,
      // 5 nulls → only 7 available
      consistency_tracker: null,
      deepar:              null,
      black_swan:          null,
      nemo:                null,
      quantum_replay:      null,
    };
    const result = computeComposite(scores);
    expect(result.score).toBeNull();
    expect(result.verdict).toBeNull();
    expect(result.availableCount).toBe(7);
  });
});

// ─── computeWeightsVersionId ──────────────────────────────────────────────────

describe("computeWeightsVersionId", () => {
  it("is deterministic — same input produces same hash", () => {
    const h1 = computeWeightsVersionId(EQUAL_WEIGHTS);
    const h2 = computeWeightsVersionId(EQUAL_WEIGHTS);
    expect(h1).toBe(h2);
  });

  it("produces a 64-character hex string (full SHA-256)", () => {
    const hash = computeWeightsVersionId(EQUAL_WEIGHTS);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when ANY weight changes", () => {
    const original = computeWeightsVersionId(EQUAL_WEIGHTS);
    // Build a mutated copy (not frozen)
    const mutated: Record<string, number> = { ...EQUAL_WEIGHTS };
    mutated["b14_survival_twin"] = 0.5;
    const modified = computeWeightsVersionId(mutated);
    expect(modified).not.toBe(original);
  });

  it("is key-order independent (canonical sorted JSON)", () => {
    const w1 = { a: 0.5, b: 0.5 };
    const w2 = { b: 0.5, a: 0.5 };
    expect(computeWeightsVersionId(w1)).toBe(computeWeightsVersionId(w2));
  });
});

// ─── verdictFromComposite ─────────────────────────────────────────────────────

describe("verdictFromComposite", () => {
  it("null → null", () => {
    expect(verdictFromComposite(null)).toBeNull();
  });

  it("score=0.75 (exactly at HEALTHY threshold) → HEALTHY", () => {
    expect(verdictFromComposite(VERDICT_HEALTHY_THRESHOLD)).toBe("HEALTHY");
  });

  it("score=0.76 (above HEALTHY threshold) → HEALTHY", () => {
    expect(verdictFromComposite(0.76)).toBe("HEALTHY");
  });

  it("score=0.74 (just below HEALTHY threshold) → MARGINAL", () => {
    expect(verdictFromComposite(0.74)).toBe("MARGINAL");
  });

  it("score=0.50 (exactly at MARGINAL threshold) → MARGINAL", () => {
    expect(verdictFromComposite(VERDICT_MARGINAL_THRESHOLD)).toBe("MARGINAL");
  });

  it("score=0.49 (just below MARGINAL threshold) → UNHEALTHY", () => {
    expect(verdictFromComposite(0.49)).toBe("UNHEALTHY");
  });

  it("score=0.25 (exactly at UNHEALTHY threshold) → UNHEALTHY", () => {
    expect(verdictFromComposite(VERDICT_UNHEALTHY_THRESHOLD)).toBe("UNHEALTHY");
  });

  it("score=0.24 (just below UNHEALTHY threshold) → CRITICAL", () => {
    expect(verdictFromComposite(0.24)).toBe("CRITICAL");
  });

  it("score=0.0 (floor) → CRITICAL", () => {
    expect(verdictFromComposite(0.0)).toBe("CRITICAL");
  });

  it("score=1.0 (ceiling) → HEALTHY", () => {
    expect(verdictFromComposite(1.0)).toBe("HEALTHY");
  });
});

// ─── Composite + verdict integration ─────────────────────────────────────────

describe("computeComposite verdict integration", () => {
  it("all 12 at 0.8 → HEALTHY verdict", () => {
    const result = computeComposite(allScores(0.8));
    expect(result.verdict).toBe("HEALTHY");
  });

  it("all 12 at 0.3 → UNHEALTHY verdict", () => {
    const result = computeComposite(allScores(0.3));
    expect(result.verdict).toBe("UNHEALTHY");
  });

  it("all 12 at 0.1 → CRITICAL verdict", () => {
    const result = computeComposite(allScores(0.1));
    expect(result.verdict).toBe("CRITICAL");
  });
});
