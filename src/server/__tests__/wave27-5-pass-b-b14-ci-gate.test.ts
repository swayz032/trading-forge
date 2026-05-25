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
  it("returns 0.40 when env var is unset", () => {
    delete process.env.B14_RUIN_CI_HIGH_THRESHOLD;
    expect(getB14CiHighThreshold()).toBe(0.40);
  });

  it("returns parsed value when env var is a valid float string", () => {
    process.env.B14_RUIN_CI_HIGH_THRESHOLD = "0.35";
    expect(getB14CiHighThreshold()).toBe(0.35);
  });

  it("returns 0.40 default for invalid string env var", () => {
    process.env.B14_RUIN_CI_HIGH_THRESHOLD = "banana";
    expect(getB14CiHighThreshold()).toBe(0.40);
  });
});

// ─── Happy path — ci_high available ──────────────────────────────────────────

describe("evaluateB14CiGate — ci_high above threshold → blocked", () => {
  it("blocks when ci_high is 0.41 against default threshold 0.40", () => {
    const ruinCi: RuinCiDict = {
      point_estimate: 0.30,
      ci_low: 0.20,
      ci_high: 0.41,
      ci_method: "BCa",
      n_resamples: 9999,
    };
    const result = evaluateB14CiGate(ruinCi, null);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("b14.ci_high_exceeds_threshold");
    expect(result.legacyFallback).toBe(false);
    expect(result.auditPayload.blocked).toBe(true);
    expect(result.auditPayload.ci_high).toBe(0.41);
    expect(result.auditPayload.threshold).toBe(0.40);
  });

  it("blocks when ci_high is 0.80 (very high ruin probability)", () => {
    const ruinCi: RuinCiDict = { ci_high: 0.80, ci_low: 0.60, point_estimate: 0.70 };
    const result = evaluateB14CiGate(ruinCi, null);
    expect(result.passed).toBe(false);
    expect(result.auditPayload.blocked).toBe(true);
  });
});

describe("evaluateB14CiGate — ci_high below threshold → passes", () => {
  it("passes when ci_high is 0.20 (well below threshold)", () => {
    const ruinCi: RuinCiDict = {
      point_estimate: 0.10,
      ci_low: 0.05,
      ci_high: 0.20,
      ci_method: "BCa",
      n_resamples: 9999,
    };
    const result = evaluateB14CiGate(ruinCi, null);
    expect(result.passed).toBe(true);
    expect(result.reason).toBe("b14.ci_high_within_threshold");
    expect(result.legacyFallback).toBe(false);
    expect(result.auditPayload.blocked).toBe(false);
  });

  it("passes when ci_high is 0.39 (just below threshold)", () => {
    const ruinCi: RuinCiDict = { ci_high: 0.39, point_estimate: 0.25 };
    const result = evaluateB14CiGate(ruinCi, null);
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
  it("uses scalar point estimate when ruinCi is null (pre-Pass-A MC run)", () => {
    const result = evaluateB14CiGate(null, 0.50);
    expect(result.legacyFallback).toBe(true);
    // ci_high is set from scalar → 0.50 > 0.40 → blocked
    expect(result.passed).toBe(false);
    expect(result.auditPayload.legacy_ruin_scalar_fallback).toBe(true);
    expect(result.auditPayload.ci_high).toBe(0.50);
  });

  it("uses scalar fallback and passes when scalar is below threshold", () => {
    const result = evaluateB14CiGate(null, 0.20);
    expect(result.legacyFallback).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.auditPayload.ci_high).toBe(0.20);
  });

  it("uses scalar fallback when ruinCi dict is missing ci_high key", () => {
    const ruinCi: RuinCiDict = { point_estimate: 0.15, ci_low: 0.05 }; // ci_high absent
    const result = evaluateB14CiGate(ruinCi, 0.25);
    expect(result.legacyFallback).toBe(true);
    expect(result.auditPayload.ci_high).toBe(0.25);
  });

  it("passes with no-MC-run marker when both ruinCi and scalar are null", () => {
    const result = evaluateB14CiGate(null, null);
    expect(result.passed).toBe(true);
    expect(result.reason).toBe("b14.ci_high_unavailable_no_mc_run");
    expect(result.auditPayload.ci_high).toBeNull();
    expect(result.auditPayload.blocked).toBe(false);
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
    // 0.55 < 0.60 → should pass
    expect(result.passed).toBe(true);
    expect(result.auditPayload.threshold).toBe(0.60);
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
