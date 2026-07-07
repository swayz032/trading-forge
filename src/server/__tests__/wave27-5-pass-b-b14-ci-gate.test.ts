/**
 * wave27-5-pass-b-b14-ci-gate.test.ts — Wave 27.5 Pass B.2 (paper-parity)
 *
 * Tests the pure-function evaluateB14CiGate helper.
 * Covers:
 *   - ci_high above threshold → blocked
 *   - ci_high below threshold → passes
 *   - ci_high exactly equal to threshold → passes (strict >, not >=)
 *   - null ruinCi → legacy scalar fallback + audit warn flag
 *   - missing ci_high in ruinCi dict → legacy scalar fallback
 *   - scalar fallback also above threshold → blocked
 *   - both ruinCi and scalar null → passes (no MC run guard)
 *   - threshold env-var override respected
 *   - audit payload fields complete and correctly typed
 *   - reason strings match expected values
 *   - getB14CiHighThreshold default and env-override
 *   - SSE event emitted on every evaluation (tested via the gate result surface)
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  evaluateB14CiGate,
  getB14CiHighThreshold,
  type RuinCiDict,
} from "../lib/b14-ci-gate.js";

// ── Logger mock (leaf module per CLAUDE.md) ────────────────────────────────────
vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

afterEach(() => {
  // Reset env after each test that modifies it
  delete process.env.B14_RUIN_CI_HIGH_THRESHOLD;
});

// ─── Threshold env-var ────────────────────────────────────────────────────────

describe("getB14CiHighThreshold", () => {
  it("returns 0.20 when env var is unset (hardening 2026-06-22: tightened from 0.40)", () => {
    delete process.env.B14_RUIN_CI_HIGH_THRESHOLD;
    expect(getB14CiHighThreshold()).toBe(0.20);
  });

  it("returns parsed value when env var is a valid float string", () => {
    process.env.B14_RUIN_CI_HIGH_THRESHOLD = "0.35";
    expect(getB14CiHighThreshold()).toBe(0.35);
  });

  it("returns 0.20 default for invalid string env var (hardening 2026-06-22)", () => {
    process.env.B14_RUIN_CI_HIGH_THRESHOLD = "banana";
    expect(getB14CiHighThreshold()).toBe(0.20);
  });
});

// ─── Happy path — ci_high available ──────────────────────────────────────────

describe("evaluateB14CiGate — ci_high above threshold → blocked", () => {
  it("blocks when ci_high is 0.41 against explicit threshold 0.40", () => {
    const ruinCi: RuinCiDict = {
      point_estimate: 0.30,
      ci_low: 0.20,
      ci_high: 0.41,
      ci_method: "BCa",
      n_resamples: 9999,
    };
    // Pass explicit threshold=0.40 so this test is independent of the default.
    const result = evaluateB14CiGate(ruinCi, null, 0.40);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("b14.ci_high_exceeds_threshold");
    expect(result.legacyFallback).toBe(false);
    expect(result.auditPayload.blocked).toBe(true);
    expect(result.auditPayload.ci_high).toBe(0.41);
    expect(result.auditPayload.threshold).toBe(0.40);
  });

  it("blocks when ci_high is 0.80 (very high ruin probability)", () => {
    const ruinCi: RuinCiDict = { ci_high: 0.80, ci_low: 0.60, point_estimate: 0.70 };
    const result = evaluateB14CiGate(ruinCi, null, 0.40);
    expect(result.passed).toBe(false);
    expect(result.auditPayload.blocked).toBe(true);
  });
});

describe("evaluateB14CiGate — ci_high below threshold → passes", () => {
  it("passes when ci_high is 0.10 (well below default 0.20 threshold)", () => {
    const ruinCi: RuinCiDict = {
      point_estimate: 0.06,
      ci_low: 0.02,
      ci_high: 0.10,
      ci_method: "BCa",
      n_resamples: 9999,
    };
    const result = evaluateB14CiGate(ruinCi, null);
    expect(result.passed).toBe(true);
    expect(result.reason).toBe("b14.ci_high_within_threshold");
    expect(result.legacyFallback).toBe(false);
    expect(result.auditPayload.blocked).toBe(false);
  });

  it("passes when ci_high is 0.19 (just below 0.20 default threshold)", () => {
    const ruinCi: RuinCiDict = { ci_high: 0.19, point_estimate: 0.12 };
    const result = evaluateB14CiGate(ruinCi, null);
    expect(result.passed).toBe(true);
  });

  it("passes when ci_high is 0.39 with explicit threshold 0.40", () => {
    const ruinCi: RuinCiDict = { ci_high: 0.39, point_estimate: 0.25 };
    const result = evaluateB14CiGate(ruinCi, null, 0.40);
    expect(result.passed).toBe(true);
  });
});

describe("evaluateB14CiGate — boundary: ci_high == threshold → NOT blocked (strict >)", () => {
  it("passes when ci_high exactly equals threshold (institutional convention: strict >)", () => {
    const ruinCi: RuinCiDict = { ci_high: 0.40, point_estimate: 0.30 };
    // ci_high = 0.40, threshold = 0.40 → strict > means NOT blocked
    const result = evaluateB14CiGate(ruinCi, null, 0.40);
    expect(result.passed).toBe(true);
    expect(result.reason).toBe("b14.ci_high_within_threshold");
    expect(result.auditPayload.blocked).toBe(false);
  });
});

// ─── Legacy fallback ──────────────────────────────────────────────────────────

describe("evaluateB14CiGate — null ruinCi → scalar fallback", () => {
  it("uses scalar point estimate when ruinCi is null (pre-Pass-A MC run) — blocks at 0.50", () => {
    // Use explicit threshold=0.40 to test scalar-fallback behavior independent of default.
    const result = evaluateB14CiGate(null, 0.50, 0.40);
    expect(result.legacyFallback).toBe(true);
    // ci_high is set from scalar → 0.50 > 0.40 → blocked
    expect(result.passed).toBe(false);
    expect(result.auditPayload.legacy_ruin_scalar_fallback).toBe(true);
    expect(result.auditPayload.ci_high).toBe(0.50);
  });

  it("uses scalar fallback and passes when scalar is below explicit threshold 0.40", () => {
    const result = evaluateB14CiGate(null, 0.20, 0.40);
    expect(result.legacyFallback).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.auditPayload.ci_high).toBe(0.20);
  });

  it("uses scalar fallback when ruinCi dict is missing ci_high key — blocks at 0.25 > 0.20 default", () => {
    const ruinCi: RuinCiDict = { point_estimate: 0.15, ci_low: 0.05 }; // ci_high absent
    const result = evaluateB14CiGate(ruinCi, 0.25);
    expect(result.legacyFallback).toBe(true);
    // 0.25 > 0.20 default threshold → blocks
    expect(result.passed).toBe(false);
    expect(result.auditPayload.ci_high).toBe(0.25);
  });

  it("BLOCKS (fail-CLOSED) when both ruinCi and scalar are null — hardening 2026-06-22", () => {
    // Previously returned passed:true with reason "b14.ci_high_unavailable_no_mc_run".
    // Hardening 2026-06-22 (F-1): when survival cannot be proven, BLOCK.
    // Any legacy/pre-MC grandfather is an explicit allow at the CALLER, not here.
    const result = evaluateB14CiGate(null, null);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("b14.firm_breach_ruin_unavailable_fail_closed");
    expect(result.auditPayload.ci_high).toBeNull();
    expect(result.auditPayload.blocked).toBe(true);
  });
});

// ─── Threshold override ───────────────────────────────────────────────────────

describe("evaluateB14CiGate — custom threshold override", () => {
  it("respects threshold argument (0.30) — blocks at ci_high 0.31", () => {
    const ruinCi: RuinCiDict = { ci_high: 0.31, point_estimate: 0.20 };
    const result = evaluateB14CiGate(ruinCi, null, 0.30);
    expect(result.passed).toBe(false);
    expect(result.auditPayload.threshold).toBe(0.30);
  });

  it("respects env var B14_RUIN_CI_HIGH_THRESHOLD when no override provided", () => {
    process.env.B14_RUIN_CI_HIGH_THRESHOLD = "0.60";
    const ruinCi: RuinCiDict = { ci_high: 0.55, point_estimate: 0.40 };
    const result = evaluateB14CiGate(ruinCi, null);
    // 0.55 < 0.60 env-threshold → should pass
    expect(result.passed).toBe(true);
    expect(result.auditPayload.threshold).toBe(0.60);
  });

  it("new default 0.20 blocks what the old 0.40 default would have passed", () => {
    // ci_high=0.25 would have passed at 0.40, now blocks at 0.20 (hardening)
    const ruinCi: RuinCiDict = { ci_high: 0.25, point_estimate: 0.15 };
    const result = evaluateB14CiGate(ruinCi, null);
    expect(result.passed).toBe(false);
    expect(result.auditPayload.threshold).toBe(0.20);
  });
});

// ─── Audit payload completeness ───────────────────────────────────────────────

describe("evaluateB14CiGate — audit payload fields", () => {
  it("audit payload contains all required fields for blocked case", () => {
    const ruinCi: RuinCiDict = {
      point_estimate: 0.35,
      ci_low: 0.25,
      ci_high: 0.50,
      ci_method: "BCa",
      n_resamples: 9999,
    };
    const result = evaluateB14CiGate(ruinCi, null, 0.40);
    const p = result.auditPayload;
    expect(p).toHaveProperty("point_estimate");
    expect(p).toHaveProperty("ci_low");
    expect(p).toHaveProperty("ci_high");
    expect(p).toHaveProperty("threshold");
    expect(p).toHaveProperty("blocked");
    expect(p).toHaveProperty("legacy_ruin_scalar_fallback");
    expect(p).toHaveProperty("ci_method");
    expect(p).toHaveProperty("n_resamples");
    expect(p.ci_method).toBe("BCa");
    expect(p.n_resamples).toBe(9999);
    expect(p.point_estimate).toBe(0.35);
  });

  it("audit payload ci_low and ci_method are null for scalar fallback", () => {
    const result = evaluateB14CiGate(null, 0.30);
    expect(result.auditPayload.ci_low).toBeNull();
    expect(result.auditPayload.ci_method).toBeNull();
    expect(result.auditPayload.n_resamples).toBeNull();
  });
});

// ─── Wave hardening 2026-06-22: non-finite ruin guard ────────────────────────
// Covers the scipy BCa DegenerateDataWarning (NaN ci_high) silent-pass defect.

describe("evaluateB14CiGate — ci_high=NaN with finite scalar below threshold → scalar fallback, passes", () => {
  it("falls back to scalar and passes when ci_high is NaN and scalar is below explicit threshold 0.40", () => {
    const ruinCi: RuinCiDict = {
      point_estimate: 0.20,
      ci_low: 0.05,
      ci_high: NaN, // scipy BCa DegenerateDataWarning
      ci_method: "BCa",
      n_resamples: 9999,
    };
    // Use explicit threshold=0.40 so this test is independent of the new 0.20 default.
    const result = evaluateB14CiGate(ruinCi, 0.25, 0.40);
    // ci_high NaN → discarded → falls to scalar 0.25 → 0.25 < 0.40 → passes
    expect(result.passed).toBe(true);
    expect(result.reason).toBe("b14.ci_high_within_threshold");
    expect(result.legacyFallback).toBe(true);
    expect(result.auditPayload.legacy_ruin_scalar_fallback).toBe(true);
    expect(result.auditPayload.ci_high).toBe(0.25);
  });
});

describe("evaluateB14CiGate — ci_high=NaN with finite scalar above threshold → blocks via scalar", () => {
  it("blocks when ci_high is NaN and scalar pointEstimate is above threshold", () => {
    const ruinCi: RuinCiDict = {
      point_estimate: 0.30,
      ci_low: 0.10,
      ci_high: NaN,
      ci_method: "BCa",
      n_resamples: 9999,
    };
    const result = evaluateB14CiGate(ruinCi, 0.55);
    // ci_high NaN → discarded → falls to scalar 0.55 → 0.55 > 0.40 → blocks
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("b14.ci_high_exceeds_threshold");
    expect(result.legacyFallback).toBe(true);
    expect(result.auditPayload.blocked).toBe(true);
    expect(result.auditPayload.ci_high).toBe(0.55);
  });
});

describe("evaluateB14CiGate — ci_high=NaN AND scalar NaN/null → fail-CLOSED", () => {
  it("fails CLOSED when ci_high is NaN and scalar pointEstimate is also NaN", () => {
    const ruinCi: RuinCiDict = {
      point_estimate: 0.15,
      ci_low: 0.05,
      ci_high: NaN,
      ci_method: "BCa",
      n_resamples: 9999,
    };
    const result = evaluateB14CiGate(ruinCi, NaN);
    // Both NaN → fail-CLOSED (MC ran but ruin estimate is corrupt/degenerate)
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("b14.ruin_estimate_non_finite_fail_closed");
    expect(result.legacyFallback).toBe(true);
    expect(result.auditPayload.blocked).toBe(true);
    expect(result.auditPayload.ci_high).toBeNull();
  });

  it("fails CLOSED when ci_high is NaN and scalar pointEstimate is null", () => {
    const ruinCi: RuinCiDict = {
      point_estimate: 0.15,
      ci_low: 0.05,
      ci_high: NaN,
    };
    const result = evaluateB14CiGate(ruinCi, null);
    // ci_high NaN → discarded; no scalar → fail-CLOSED
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("b14.ruin_estimate_non_finite_fail_closed");
    expect(result.auditPayload.blocked).toBe(true);
  });

  it("fails CLOSED when scalar is NaN with no ruinCi (degenerate pre-Pass-A scalar path)", () => {
    const result = evaluateB14CiGate(null, NaN);
    // ruinCi absent; scalar NaN → fail-CLOSED
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("b14.ruin_estimate_non_finite_fail_closed");
    expect(result.auditPayload.blocked).toBe(true);
    expect(result.auditPayload.ci_high).toBeNull();
  });
});

describe("evaluateB14CiGate — ci_high=Infinity → treated as non-finite → scalar/fail-CLOSED path", () => {
  it("fails CLOSED when ci_high is Infinity and scalar is also non-finite", () => {
    const ruinCi: RuinCiDict = {
      ci_high: Infinity,
      ci_low: 0.10,
      point_estimate: 0.30,
    };
    const result = evaluateB14CiGate(ruinCi, NaN);
    // Infinity treated as non-finite → scalar NaN also non-finite → fail-CLOSED
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("b14.ruin_estimate_non_finite_fail_closed");
    expect(result.auditPayload.blocked).toBe(true);
  });

  it("falls back to scalar and blocks when ci_high is Infinity and scalar is above threshold", () => {
    const ruinCi: RuinCiDict = {
      ci_high: Infinity,
      ci_low: 0.10,
      point_estimate: 0.30,
    };
    const result = evaluateB14CiGate(ruinCi, 0.50);
    // Infinity treated as non-finite → scalar 0.50 → 0.50 > 0.40 → blocks
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("b14.ci_high_exceeds_threshold");
    expect(result.legacyFallback).toBe(true);
    expect(result.auditPayload.ci_high).toBe(0.50);
    expect(result.auditPayload.blocked).toBe(true);
  });
});

describe("evaluateB14CiGate — regression: finite ci_high behaves identically to pre-fix", () => {
  it("finite ci_high just below 0.40 still passes", () => {
    const ruinCi: RuinCiDict = { ci_high: 0.399, point_estimate: 0.25 };
    const result = evaluateB14CiGate(ruinCi, null, 0.40);
    expect(result.passed).toBe(true);
    expect(result.reason).toBe("b14.ci_high_within_threshold");
    expect(result.legacyFallback).toBe(false);
    expect(result.auditPayload.blocked).toBe(false);
  });

  it("finite ci_high just above 0.40 still blocks", () => {
    const ruinCi: RuinCiDict = { ci_high: 0.401, point_estimate: 0.30 };
    const result = evaluateB14CiGate(ruinCi, null, 0.40);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("b14.ci_high_exceeds_threshold");
    expect(result.legacyFallback).toBe(false);
    expect(result.auditPayload.blocked).toBe(true);
  });
});

// ─── SSE surface (gate result models every evaluation) ────────────────────────

describe("evaluateB14CiGate — result surface (SSE payload source)", () => {
  it("every evaluation returns a complete result regardless of input", () => {
    // The caller spreads auditPayload + adds passed + reason + legacyFallback to SSE
    const cases: Array<[RuinCiDict | null, number | null]> = [
      [{ ci_high: 0.41 }, null],
      [{ ci_high: 0.20 }, null],
      [null, 0.30],
      [null, null],
    ];
    for (const [ruinCi, scalar] of cases) {
      const result = evaluateB14CiGate(ruinCi, scalar);
      expect(result).toHaveProperty("passed");
      expect(result).toHaveProperty("reason");
      expect(result).toHaveProperty("legacyFallback");
      expect(result).toHaveProperty("auditPayload");
      expect(typeof result.passed).toBe("boolean");
      expect(typeof result.reason).toBe("string");
      expect(typeof result.legacyFallback).toBe("boolean");
    }
  });
});

// ─── Payout-denial gate (regression: consistency_fail_rate merged into per_firm) ─
// Deep-scan payout-denial fix (2026-07-06): monte_carlo.py now merges
// firm_survival[firm].consistency_fail_rate INTO probability_of_ruin_ci.per_firm
// so this gate can actually fire. Previously per_firm never carried the key →
// the Topstep 40%-consistency payout-denial BLOCK could NEVER trigger.
describe("evaluateB14CiGate — payout-denial gate on per_firm.consistency_fail_rate", () => {
  it("BLOCKS when a firm's consistency_fail_rate exceeds the payout-denial threshold (>40% fail)", () => {
    // ci_high well below threshold so we reach the payout-denial check (not blocked earlier).
    const ruinCi = {
      point_estimate: 0.05,
      ci_low: 0.02,
      ci_high: 0.08,
      ci_method: "BCa",
      n_resamples: 9999,
      per_firm: {
        topstep_50k: {
          point_estimate: 0.05,
          ci_high: 0.08,
          consistency_fail_rate: 0.45, // >40% — Topstep payout-denial territory
        },
      },
    } as unknown as RuinCiDict;
    const result = evaluateB14CiGate(ruinCi, null, 0.40);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("b14.payout_denial_rate_exceeds_threshold");
    expect(result.auditPayload.blocked).toBe(true);
    expect(result.auditPayload.worst_consistency_fail_rate).toBe(0.45);
  });

  it("PASSES when consistency_fail_rate is below the payout-denial threshold", () => {
    const ruinCi = {
      ci_high: 0.08,
      point_estimate: 0.05,
      per_firm: {
        topstep_50k: { ci_high: 0.08, consistency_fail_rate: 0.05 },
      },
    } as unknown as RuinCiDict;
    const result = evaluateB14CiGate(ruinCi, null, 0.40);
    expect(result.passed).toBe(true);
    expect(result.reason).toBe("b14.ci_high_within_threshold");
  });

  it("selects the WORST firm's consistency_fail_rate across multiple firms", () => {
    const ruinCi = {
      ci_high: 0.08,
      point_estimate: 0.05,
      per_firm: {
        mffu_50k: { ci_high: 0.08, consistency_fail_rate: 0.12 },
        topstep_50k: { ci_high: 0.08, consistency_fail_rate: 0.55 },
      },
    } as unknown as RuinCiDict;
    const result = evaluateB14CiGate(ruinCi, null, 0.40);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("b14.payout_denial_rate_exceeds_threshold");
    expect(result.auditPayload.worst_consistency_fail_rate).toBe(0.55);
  });
});
