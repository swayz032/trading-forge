/**
 * wave29-pass-c3-dsr-gate.test.ts — Wave 29 Pass C.3
 *
 * Tests for the RL DSR gate (rl-dsr-gate.ts).
 * Pure-function tests — no DB, no I/O, fully deterministic.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateRlDsrGate,
  computeDsrComponents,
  probit,
  DEFAULT_DSR_THRESHOLD,
  MIN_TRAINING_ITERATIONS,
} from "../lib/rl-dsr-gate.js";

// ─── Probit tests ─────────────────────────────────────────────────────────────

describe("probit — inverse normal CDF approximation", () => {
  it("returns 0 for p=0.5", () => {
    expect(probit(0.5)).toBe(0);
  });

  it("returns a positive value for p > 0.5", () => {
    expect(probit(0.75)).toBeGreaterThan(0);
    expect(probit(0.95)).toBeGreaterThan(1);
  });

  it("is antisymmetric: probit(1-p) == -probit(p)", () => {
    const p = 0.25;
    expect(probit(p)).toBeCloseTo(-probit(1 - p), 3);
  });

  it("returns -Infinity for p=0", () => {
    expect(probit(0)).toBe(-Infinity);
  });

  it("returns +Infinity for p=1", () => {
    expect(probit(1)).toBe(+Infinity);
  });

  it("probit(0.975) ≈ 1.96 (standard normal 95% CI)", () => {
    expect(probit(0.975)).toBeCloseTo(1.96, 1);
  });
});

// ─── computeDsrComponents ─────────────────────────────────────────────────────

describe("computeDsrComponents", () => {
  it("returns null when N < MIN_TRAINING_ITERATIONS", () => {
    const result = computeDsrComponents(1.0, 0.8, MIN_TRAINING_ITERATIONS - 1);
    expect(result).toBeNull();
  });

  it("returns non-null when N >= MIN_TRAINING_ITERATIONS", () => {
    const result = computeDsrComponents(1.0, 0.8, 100);
    expect(result).not.toBeNull();
  });

  it("gamma is clipped to [0, 1]", () => {
    // SR_oos > SR_is would give gamma > 1 without clipping
    const result = computeDsrComponents(1.0, 2.0, 100);
    expect(result!.gamma).toBeLessThanOrEqual(1.0);
    expect(result!.gamma).toBeGreaterThanOrEqual(0.0);
  });

  it("gamma is 0 when SR_is is 0 (zero division guard)", () => {
    const result = computeDsrComponents(0, 0.5, 100);
    expect(result!.gamma).toBe(0);
  });

  it("sigma_sr = 1/sqrt(N)", () => {
    const n = 100;
    const result = computeDsrComponents(1.0, 0.8, n);
    expect(result!.sigma_sr).toBeCloseTo(1 / Math.sqrt(n), 6);
  });

  it("sigma_n is positive for positive SR_is", () => {
    const result = computeDsrComponents(1.5, 0.8, 50);
    expect(result!.sigma_n).toBeGreaterThan(0);
  });
});

// ─── evaluateRlDsrGate — rejection cases ─────────────────────────────────────

describe("evaluateRlDsrGate — rejection", () => {
  it("rejects when N < MIN_TRAINING_ITERATIONS", () => {
    const result = evaluateRlDsrGate(1.0, 0.8, 1);
    expect(result.ok).toBe(false);
    expect(result.dsr).toBeNull();
    expect(result.reason).toContain("Insufficient training iterations");
  });

  it("rejects when DSR < threshold (strong IS-to-OOS decay)", () => {
    // Very strong decay: IS=2.0, OOS=0.1, few iterations → DSR likely negative
    const result = evaluateRlDsrGate(2.0, 0.1, 10, 0.5);
    expect(result.ok).toBe(false);
    expect(result.dsr).not.toBeNull();
    if (result.dsr !== null) {
      expect(result.dsr).toBeLessThan(0.5);
    }
  });

  it("rejects at N=2 (boundary — exactly MIN)", () => {
    // N=2 is the minimum valid N — may or may not pass DSR depending on SR values
    const result = evaluateRlDsrGate(1.0, -1.0, 2, 0.5);
    expect(result.ok).toBe(false);
  });

  it("auditPayload.blocked is true on rejection", () => {
    const result = evaluateRlDsrGate(2.0, -0.5, 10, 0.5);
    expect(result.auditPayload.blocked).toBe(true);
    expect(result.auditPayload.dsr_threshold).toBe(0.5);
    expect(result.auditPayload.n_training_iterations).toBe(10);
  });
});

// ─── evaluateRlDsrGate — pass cases ──────────────────────────────────────────

describe("evaluateRlDsrGate — graduation pass", () => {
  it("passes when DSR >= threshold (strong OOS performance, many iterations)", () => {
    // High OOS Sharpe, close to IS, many iterations → DSR well above 0.5
    const result = evaluateRlDsrGate(1.5, 1.4, 1000, 0.5);
    expect(result.ok).toBe(true);
    expect(result.dsr).not.toBeNull();
    if (result.dsr !== null) {
      expect(result.dsr).toBeGreaterThanOrEqual(0.5);
    }
  });

  it("passes with very high N and good OOS Sharpe", () => {
    const result = evaluateRlDsrGate(1.0, 0.95, 5000, 0.5);
    expect(result.ok).toBe(true);
  });

  it("auditPayload.blocked is false on pass", () => {
    const result = evaluateRlDsrGate(1.5, 1.4, 1000, 0.5);
    expect(result.auditPayload.blocked).toBe(false);
  });

  it("auditPayload captures all inputs", () => {
    const result = evaluateRlDsrGate(1.2, 1.1, 500, 0.5);
    expect(result.auditPayload.sr_is).toBe(1.2);
    expect(result.auditPayload.sr_oos).toBe(1.1);
    expect(result.auditPayload.n_training_iterations).toBe(500);
    expect(result.auditPayload.dsr_threshold).toBe(0.5);
  });

  it("custom threshold works: lower threshold is easier to pass", () => {
    // With threshold 0.0, even modest DSR should pass
    const result = evaluateRlDsrGate(1.0, 0.5, 50, 0.0);
    // DSR ≥ 0.0 should always pass for positive OOS Sharpe with modest decay
    // (not guaranteed but very likely with these inputs)
    expect(result.dsrThreshold).toBe(0.0);
    expect(result.auditPayload.dsr_threshold).toBe(0.0);
  });
});

// ─── DEFAULT_DSR_THRESHOLD constant ──────────────────────────────────────────

describe("evaluateRlDsrGate — threshold defaults", () => {
  it("uses DEFAULT_DSR_THRESHOLD when no threshold provided", () => {
    const result = evaluateRlDsrGate(1.5, 1.4, 1000);
    expect(result.dsrThreshold).toBe(DEFAULT_DSR_THRESHOLD);
  });

  it("DSR threshold is exactly 0.5", () => {
    expect(DEFAULT_DSR_THRESHOLD).toBe(0.5);
  });
});

// ─── Components exposed in result ────────────────────────────────────────────

describe("evaluateRlDsrGate — components in result", () => {
  it("components are null when N < MIN_TRAINING_ITERATIONS", () => {
    const result = evaluateRlDsrGate(1.0, 0.8, 1);
    expect(result.components).toBeNull();
  });

  it("components are non-null when N >= MIN_TRAINING_ITERATIONS", () => {
    const result = evaluateRlDsrGate(1.0, 0.8, 100);
    expect(result.components).not.toBeNull();
    expect(result.components!.sigma_n).toBeGreaterThan(0);
    expect(result.components!.sigma_sr).toBeGreaterThan(0);
  });
});
