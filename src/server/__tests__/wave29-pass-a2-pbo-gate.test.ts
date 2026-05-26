/**
 * wave29-pass-a2-pbo-gate.test.ts — Wave 29 Pass A.2 (backtest-core)
 *
 * Tests for:
 *   - evaluatePboGate() pure-function lifecycle gate
 *   - Threshold env-var override (PBO_OVERFIT_THRESHOLD_PCT)
 *   - Legacy null / missing pbo_overall → PROCEED + legacy audit
 *   - lifecycle-service.ts integration: TESTING → SHADOW/PAPER gate fires
 *
 * Pattern mirrors wave27-5-pass-b-b14-ci-gate.test.ts (structural template).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  evaluatePboGate,
  getPboLifecycleThreshold,
  PBO_LIFECYCLE_THRESHOLD_DEFAULT,
  type PboGateInput,
} from "../lib/pbo-gate.js";

// ── Logger mock (leaf module per CLAUDE.md §10 operator memory) ───────────────
vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

afterEach(() => {
  // Reset env after each test that modifies it
  delete process.env.PBO_OVERFIT_THRESHOLD_PCT;
});

// ─── Threshold env-var ────────────────────────────────────────────────────────

describe("getPboLifecycleThreshold", () => {
  it("returns 0.15 when env var is unset", () => {
    delete process.env.PBO_OVERFIT_THRESHOLD_PCT;
    expect(getPboLifecycleThreshold()).toBe(0.15);
  });

  it("returns 0.15 as module constant default", () => {
    expect(PBO_LIFECYCLE_THRESHOLD_DEFAULT).toBe(0.15);
  });

  it("returns parsed value when env var is a valid float string", () => {
    process.env.PBO_OVERFIT_THRESHOLD_PCT = "0.10";
    expect(getPboLifecycleThreshold()).toBe(0.10);
  });

  it("returns 0.15 default for invalid string env var", () => {
    process.env.PBO_OVERFIT_THRESHOLD_PCT = "banana";
    expect(getPboLifecycleThreshold()).toBe(0.15);
  });

  it("returns 0.15 default for value > 1", () => {
    process.env.PBO_OVERFIT_THRESHOLD_PCT = "1.5";
    expect(getPboLifecycleThreshold()).toBe(0.15);
  });

  it("returns 0.15 default for negative value", () => {
    process.env.PBO_OVERFIT_THRESHOLD_PCT = "-0.1";
    expect(getPboLifecycleThreshold()).toBe(0.15);
  });
});

// ─── Gate evaluation — pbo_overall present ───────────────────────────────────

describe("evaluatePboGate — pbo_overall = 0.10 → ok: true", () => {
  it("passes when pbo_overall (0.10) < default threshold (0.15)", () => {
    const result = evaluatePboGate({ pbo_overall: 0.10 });
    expect(result.ok).toBe(true);
    expect(result.pbo).toBe(0.10);
    expect(result.threshold).toBe(0.15);
    expect(result.legacyNull).toBe(false);
    expect(result.auditPayload.blocked).toBe(false);
  });
});

describe("evaluatePboGate — pbo_overall = 0.20 → ok: false", () => {
  it("blocks when pbo_overall (0.20) > default threshold (0.15)", () => {
    const result = evaluatePboGate({ pbo_overall: 0.20 });
    expect(result.ok).toBe(false);
    expect(result.pbo).toBe(0.20);
    expect(result.threshold).toBe(0.15);
    expect(result.reason).toBe("lifecycle.pbo_overfit_block");
    expect(result.legacyNull).toBe(false);
    expect(result.auditPayload.blocked).toBe(true);
    expect(result.auditPayload.pbo).toBe(0.20);
    expect(result.auditPayload.threshold).toBe(0.15);
  });
});

describe("evaluatePboGate — legacy null pbo_overall", () => {
  it("proceeds with legacyNull=true when pbo_overall is undefined", () => {
    const result = evaluatePboGate({});
    expect(result.ok).toBe(true);
    expect(result.pbo).toBeNull();
    expect(result.legacyNull).toBe(true);
    expect(result.reason).toBe("lifecycle.pbo_unavailable_legacy");
    expect(result.auditPayload.blocked).toBe(false);
    expect(result.auditPayload.legacy_null).toBe(true);
  });

  it("proceeds with legacyNull=true when pbo_overall is explicitly null", () => {
    const result = evaluatePboGate({ pbo_overall: null });
    expect(result.ok).toBe(true);
    expect(result.pbo).toBeNull();
    expect(result.legacyNull).toBe(true);
  });
});

describe("evaluatePboGate — at-threshold boundary", () => {
  it("pbo_overall = 0.15 exactly → ok: true (strict <, not <=)", () => {
    // Convention: strict > for blocking. pbo === threshold is NOT blocked.
    const result = evaluatePboGate({ pbo_overall: 0.15 });
    expect(result.ok).toBe(true);
    expect(result.pbo).toBe(0.15);
    expect(result.threshold).toBe(0.15);
    expect(result.auditPayload.blocked).toBe(false);
  });
});

describe("evaluatePboGate — env threshold override", () => {
  it("blocks 0.12 when PBO_OVERFIT_THRESHOLD_PCT=0.10", () => {
    process.env.PBO_OVERFIT_THRESHOLD_PCT = "0.10";
    const result = evaluatePboGate({ pbo_overall: 0.12 });
    expect(result.ok).toBe(false);
    expect(result.threshold).toBe(0.10);
    expect(result.auditPayload.blocked).toBe(true);
  });

  it("passes 0.12 when PBO_OVERFIT_THRESHOLD_PCT=0.20", () => {
    process.env.PBO_OVERFIT_THRESHOLD_PCT = "0.20";
    const result = evaluatePboGate({ pbo_overall: 0.12 });
    expect(result.ok).toBe(true);
    expect(result.threshold).toBe(0.20);
    expect(result.auditPayload.blocked).toBe(false);
  });

  it("threshold opts param overrides env", () => {
    process.env.PBO_OVERFIT_THRESHOLD_PCT = "0.20";
    const result = evaluatePboGate({ pbo_overall: 0.12 }, { threshold: 0.10 });
    expect(result.ok).toBe(false);
    expect(result.threshold).toBe(0.10);
  });
});

describe("evaluatePboGate — audit payload completeness", () => {
  it("audit payload has all required fields on block", () => {
    const result = evaluatePboGate({ pbo_overall: 0.30, pbo_p_value: 0.02 });
    expect(result.ok).toBe(false);
    expect(result.auditPayload).toMatchObject({
      pbo: 0.30,
      pbo_p_value: 0.02,
      threshold: 0.15,
      blocked: true,
      legacy_null: false,
    });
  });

  it("audit payload has all required fields on pass", () => {
    const result = evaluatePboGate({ pbo_overall: 0.05, pbo_p_value: null });
    expect(result.ok).toBe(true);
    expect(result.auditPayload).toMatchObject({
      pbo: 0.05,
      pbo_p_value: null,
      threshold: 0.15,
      blocked: false,
      legacy_null: false,
    });
  });

  it("audit payload has all required fields on legacy null", () => {
    const result = evaluatePboGate({});
    expect(result.auditPayload).toMatchObject({
      pbo: null,
      pbo_p_value: null,
      threshold: 0.15,
      blocked: false,
      legacy_null: true,
    });
  });
});

// ─── Two-threshold separation invariant ──────────────────────────────────────

describe("Two-threshold invariant", () => {
  it("PBO_LIFECYCLE_THRESHOLD_DEFAULT (0.15) is stricter than W27.5 warn threshold (0.5)", () => {
    // This test documents the institutional separation between the two thresholds.
    // The lifecycle gate (Wave 29) must be STRICTER than the W27.5 warn threshold.
    const lifecycleThreshold = PBO_LIFECYCLE_THRESHOLD_DEFAULT;
    const w275WarnThreshold = 0.5; // PBO_OVERFIT_THRESHOLD default in walk_forward.py
    expect(lifecycleThreshold).toBeLessThan(w275WarnThreshold);
  });

  it("a strategy with PBO=0.20 passes W27.5 warn but is blocked by W29 lifecycle gate", () => {
    // PBO=0.20 < 0.50 → W27.5 would NOT warn
    // PBO=0.20 > 0.15 → W29 lifecycle gate BLOCKS
    const pbo = 0.20;
    const w275WarnThreshold = 0.5;
    const w29LifecycleThreshold = PBO_LIFECYCLE_THRESHOLD_DEFAULT;

    const passesW275Warn = pbo <= w275WarnThreshold;
    const blockedByW29 = pbo > w29LifecycleThreshold;

    expect(passesW275Warn).toBe(true);  // Would not trigger W27.5 warn
    expect(blockedByW29).toBe(true);    // IS blocked by W29 lifecycle gate
  });
});

// ─── lifecycle-service.ts integration ────────────────────────────────────────

describe("lifecycle-service.ts integration contract", () => {
  it("evaluatePboGate returns ok=false for PBO=0.20 (will block TESTING → SHADOW)", () => {
    // This test verifies the exact contract that lifecycle-service.ts depends on:
    // evaluatePboGate({ pbo_overall: 0.20 }).ok === false
    // lifecycle-service.ts returns { success: false, error } when ok === false
    const result = evaluatePboGate({ pbo_overall: 0.20 });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("lifecycle.pbo_overfit_block");
  });

  it("evaluatePboGate returns ok=true for PBO=0.05 (will allow TESTING → SHADOW)", () => {
    const result = evaluatePboGate({ pbo_overall: 0.05 });
    expect(result.ok).toBe(true);
    expect(result.auditPayload.blocked).toBe(false);
  });

  it("evaluatePboGate returns ok=true for missing pbo_overall (legacy grandfather)", () => {
    // Pre-Wave-29 backtests have no pbo_overall in walkForwardResults.
    // lifecycle-service.ts must PROCEED (not block) for these.
    const result = evaluatePboGate({ pbo_overall: undefined });
    expect(result.ok).toBe(true);
    expect(result.legacyNull).toBe(true);
    expect(result.reason).toBe("lifecycle.pbo_unavailable_legacy");
  });

  it("gate wires to TESTING → SHADOW (A.1 SHADOW state is LIVE in VALID_STATES)", () => {
    // Documents that A.1 HAS landed: SHADOW is a valid lifecycle state.
    // lifecycle-service.ts VALID_STATES includes "SHADOW".
    // Gate fires on (fromState === "TESTING" && (toState === "SHADOW" || toState === "PAPER")).
    // This test verifies the gating intent — not the full lifecycle-service call.
    const resultForShadow = evaluatePboGate({ pbo_overall: 0.20 });
    const resultForPaper = evaluatePboGate({ pbo_overall: 0.20 });
    // Both routes blocked by the same gate logic
    expect(resultForShadow.ok).toBe(false);
    expect(resultForPaper.ok).toBe(false);
  });
});
