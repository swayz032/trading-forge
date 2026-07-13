/**
 * b14-hardening-2026-06-22.test.ts — B14 production-hardening audit
 *
 * TDD-first: these tests were written BEFORE the implementation fixes.
 * All 6 findings from the B14 audit:
 *
 *   F-1 + F-3: gate passes when firm-breach ruin is unavailable
 *     - ruin_unavailable=true in ruinCi → BLOCK
 *     - ci_high=null (no MC run) → BLOCK
 *     - no MC row at all → BLOCK (lifecycle catch, not tested here — tested via lifecycle mock)
 *   F-2:   catch block in lifecycle-service fails OPEN → must fail CLOSED
 *   F-4:   payout-window consistency must not be reconstructed from a full
 *          backtest history or turned into an account-survival failure
 *   E:     threshold default 0.40 is too loose → 0.20
 *   F-5:   B15_BATTERY_ENABLED default "false" → "true"
 *
 * Pure-function tests cover F-1/F-3/E (b14-ci-gate.ts).
 * Lifecycle integration tests cover F-2/F-4/F-5 via full lifecycle mock.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  evaluateB14CiGate,
  getB14CiHighThreshold,
  type RuinCiDict,
} from "../lib/b14-ci-gate.js";

// ── Logger mock ───────────────────────────────────────────────────────────────
vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

afterEach(() => {
  delete process.env.B14_RUIN_CI_HIGH_THRESHOLD;
});

// ─────────────────────────────────────────────────────────────────────────────
// E: default threshold tightened 0.40 → 0.20
// ─────────────────────────────────────────────────────────────────────────────

describe("E — threshold default 0.20 (tightened from 0.40)", () => {
  it("default threshold is now 0.20", () => {
    delete process.env.B14_RUIN_CI_HIGH_THRESHOLD;
    expect(getB14CiHighThreshold()).toBe(0.20);
  });

  it("ci_high=0.25 blocks at default 0.20 threshold", () => {
    const ruinCi: RuinCiDict = { ci_high: 0.25, point_estimate: 0.15 };
    const result = evaluateB14CiGate(ruinCi, null);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("b14.ci_high_exceeds_threshold");
    expect(result.auditPayload.threshold).toBe(0.20);
  });

  it("ci_high=0.15 passes at default 0.20 threshold", () => {
    const ruinCi: RuinCiDict = { ci_high: 0.15, point_estimate: 0.10 };
    const result = evaluateB14CiGate(ruinCi, null);
    expect(result.passed).toBe(true);
    expect(result.reason).toBe("b14.ci_high_within_threshold");
    expect(result.auditPayload.threshold).toBe(0.20);
  });

  it("ci_high=0.20 exactly passes (strict >)", () => {
    const ruinCi: RuinCiDict = { ci_high: 0.20, point_estimate: 0.15 };
    const result = evaluateB14CiGate(ruinCi, null);
    expect(result.passed).toBe(true); // strict > means exactly-equal passes
    expect(result.auditPayload.threshold).toBe(0.20);
  });

  it("env-override to 0.30 is respected — ci_high 0.25 passes at 0.30", () => {
    process.env.B14_RUIN_CI_HIGH_THRESHOLD = "0.30";
    const ruinCi: RuinCiDict = { ci_high: 0.25, point_estimate: 0.15 };
    const result = evaluateB14CiGate(ruinCi, null);
    expect(result.passed).toBe(true);
    expect(result.auditPayload.threshold).toBe(0.30);
  });

  it("env-override to 0.10 blocks ci_high 0.15", () => {
    process.env.B14_RUIN_CI_HIGH_THRESHOLD = "0.10";
    const ruinCi: RuinCiDict = { ci_high: 0.15, point_estimate: 0.08 };
    const result = evaluateB14CiGate(ruinCi, null);
    expect(result.passed).toBe(false);
    expect(result.auditPayload.threshold).toBe(0.10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F-1 + F-3: ci_high=null (no MC run) → BLOCK (fail-CLOSED)
// ─────────────────────────────────────────────────────────────────────────────

describe("F-1: no MC run (both ruinCi and scalar null) → BLOCK fail-CLOSED", () => {
  it("blocks when ruinCi is null and scalar is null (no MC run at all)", () => {
    const result = evaluateB14CiGate(null, null);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("b14.firm_breach_ruin_unavailable_fail_closed");
    expect(result.auditPayload.blocked).toBe(true);
  });

  it("blocks when ruinCi has null ci_high and no scalar (cannot prove survival)", () => {
    const ruinCi: RuinCiDict = {
      point_estimate: 0.05,
      ci_low: null,
      ci_high: null,
      ci_method: "BCa",
    };
    const result = evaluateB14CiGate(ruinCi, null);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("b14.firm_breach_ruin_unavailable_fail_closed");
    expect(result.auditPayload.blocked).toBe(true);
  });

  it("audit payload documents why it blocked (unavailable ci_high)", () => {
    const result = evaluateB14CiGate(null, null);
    expect(result.auditPayload.blocked).toBe(true);
    expect(result.auditPayload.ci_high).toBeNull();
    expect(result.auditPayload.legacy_ruin_scalar_fallback).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F-3: ruin_unavailable=true → BLOCK fail-CLOSED
// ─────────────────────────────────────────────────────────────────────────────

describe("F-3: ruin_unavailable=true in ruinCi → BLOCK fail-CLOSED", () => {
  it("blocks when ruinCi has ruin_unavailable=true (Python set no-firm authoritative)", () => {
    const ruinCi: RuinCiDict = {
      ruin_unavailable: true,
      ruin_basis: "terminal_negative_no_firm",
      point_estimate: 0.03,
      ci_high: null,
      ci_low: null,
    } as unknown as RuinCiDict;  // cast because ruin_unavailable is not in RuinCiDict yet
    const result = evaluateB14CiGate(ruinCi, null);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("b14.firm_breach_ruin_unavailable_fail_closed");
    expect(result.auditPayload.blocked).toBe(true);
  });

  it("blocks when ruin_unavailable=true even if a scalar point estimate is present", () => {
    // Scalar probability_of_ruin (terminal<=0) must NOT override the firm-breach
    // unavailability signal — doing so is F-1's root cause.
    const ruinCi: RuinCiDict = {
      ruin_unavailable: true,
      point_estimate: 0.02, // low terminal-negative ruin — must NOT auto-pass
      ci_high: null,
    } as unknown as RuinCiDict;
    const result = evaluateB14CiGate(ruinCi, 0.02); // scalar also low
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("b14.firm_breach_ruin_unavailable_fail_closed");
  });

  it("ruin_unavailable=true takes priority over a ci_high that would otherwise pass", () => {
    // Pathological edge: Python somehow set ruin_unavailable=true but also ci_high=0.10.
    // ruin_unavailable wins — the gate must block because the firm-breach basis is wrong.
    const ruinCi: RuinCiDict = {
      ruin_unavailable: true,
      ci_high: 0.10, // below threshold — but irrelevant; basis is wrong
      ci_low: 0.05,
      point_estimate: 0.08,
    } as unknown as RuinCiDict;
    const result = evaluateB14CiGate(ruinCi, 0.08);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("b14.firm_breach_ruin_unavailable_fail_closed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression: existing pass paths still work after F-1/F-3 fix
// ─────────────────────────────────────────────────────────────────────────────

describe("regression — firm-breach ruin CI available, below threshold → PASS", () => {
  it("ci_high=0.10 passes at default 0.20 threshold with ruin_basis=firm_breach", () => {
    const ruinCi: RuinCiDict = {
      point_estimate: 0.06,
      ci_low: 0.02,
      ci_high: 0.10,
      ci_method: "BCa",
      n_resamples: 9999,
      ruin_basis: "firm_breach",
    } as unknown as RuinCiDict;
    const result = evaluateB14CiGate(ruinCi, null);
    expect(result.passed).toBe(true);
    expect(result.reason).toBe("b14.ci_high_within_threshold");
    expect(result.legacyFallback).toBe(false);
  });

  it("ci_high=0.21 blocks at default 0.20 threshold with ruin_basis=firm_breach", () => {
    const ruinCi: RuinCiDict = {
      point_estimate: 0.15,
      ci_low: 0.10,
      ci_high: 0.21,
      ci_method: "BCa",
      n_resamples: 9999,
      ruin_basis: "firm_breach",
    } as unknown as RuinCiDict;
    const result = evaluateB14CiGate(ruinCi, null);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("b14.ci_high_exceeds_threshold");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F-4: payout eligibility remains separate from survival
// ─────────────────────────────────────────────────────────────────────────────

describe("F-4 — payout eligibility does not alter B14 survival", () => {
  it("does not block a low-ruin strategy when historical payout telemetry is high", () => {
    const ruinCi: RuinCiDict = {
      ci_high: 0.10,
      point_estimate: 0.06,
      ci_low: 0.03,
      ci_method: "BCa",
      n_resamples: 9999,
      ruin_basis: "firm_breach",
      per_firm: {
        topstep_50k: { consistency_fail_rate: 0.95 },
      },
    } as unknown as RuinCiDict;
    const result = evaluateB14CiGate(ruinCi, null);
    expect(result.passed).toBe(true);
    expect(result.reason).toBe("b14.ci_high_within_threshold");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Backward-compat: existing NaN/Infinity guard still works after threshold change
// ─────────────────────────────────────────────────────────────────────────────

describe("regression — NaN / Infinity guard preserved at new 0.20 threshold", () => {
  it("NaN ci_high with scalar 0.25 → scalar used, blocks at 0.20", () => {
    const ruinCi: RuinCiDict = {
      ci_high: NaN,
      point_estimate: 0.15,
    };
    const result = evaluateB14CiGate(ruinCi, 0.25);
    // NaN discard → scalar 0.25 > 0.20 → blocks
    expect(result.passed).toBe(false);
    expect(result.auditPayload.ci_high).toBe(0.25);
    expect(result.legacyFallback).toBe(true);
  });

  it("NaN ci_high with scalar 0.18 → scalar used, passes at 0.20", () => {
    const ruinCi: RuinCiDict = {
      ci_high: NaN,
      point_estimate: 0.15,
    };
    const result = evaluateB14CiGate(ruinCi, 0.18);
    // NaN discard → scalar 0.18 < 0.20 → passes
    expect(result.passed).toBe(true);
    expect(result.legacyFallback).toBe(true);
  });

  it("NaN ci_high AND NaN scalar → fail-CLOSED (non-finite both paths)", () => {
    const ruinCi: RuinCiDict = { ci_high: NaN };
    const result = evaluateB14CiGate(ruinCi, NaN);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("b14.ruin_estimate_non_finite_fail_closed");
  });
});
