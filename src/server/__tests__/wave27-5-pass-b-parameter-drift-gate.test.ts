/**
 * wave27-5-pass-b-parameter-drift-gate.test.ts — Wave 27.5 Pass B.2 (paper-parity)
 *
 * Tests the pure-function evaluateParameterDriftGate helper.
 * Covers:
 *   - overfit_drift + confidence >= 0.70 → blocked
 *   - overfit_drift + confidence < 0.70 → warned (not blocked)
 *   - overfit_drift + confidence null → warned (conservative: missing conf ≠ high conf)
 *   - indeterminate → warned (allow)
 *   - regime_driven → passes, no audit
 *   - stable → passes, no audit
 *   - null classification → legacy proceed + audit
 *   - forward-compat: unknown classification → passes (safe default)
 *   - audit action names match spec
 *   - SSE payload fields present on every evaluation
 */

import { describe, it, expect } from "vitest";
import {
  evaluateParameterDriftGate,
  type ParameterDriftGateStatus,
} from "../lib/parameter-drift-gate.js";

// ─── overfit_drift — high confidence → BLOCK ─────────────────────────────────

describe("evaluateParameterDriftGate — overfit_drift + high confidence → blocked", () => {
  it("blocks when classification=overfit_drift and confidence=0.70 (boundary)", () => {
    const result = evaluateParameterDriftGate("overfit_drift", 0.70);
    expect(result.status).toBe<ParameterDriftGateStatus>("blocked");
    expect(result.passed).toBe(false);
    expect(result.auditAction).toBe("lifecycle.parameter_overfit_drift_block");
  });

  it("blocks when classification=overfit_drift and confidence=0.90", () => {
    const result = evaluateParameterDriftGate("overfit_drift", 0.90);
    expect(result.status).toBe<ParameterDriftGateStatus>("blocked");
    expect(result.passed).toBe(false);
  });

  it("blocks when classification=overfit_drift and confidence=1.0", () => {
    const result = evaluateParameterDriftGate("overfit_drift", 1.0);
    expect(result.passed).toBe(false);
  });
});

// ─── overfit_drift — low confidence → WARN (allow) ──────────────────────────

describe("evaluateParameterDriftGate — overfit_drift + low confidence → warned", () => {
  it("warns but allows when overfit_drift confidence=0.69 (just below threshold)", () => {
    const result = evaluateParameterDriftGate("overfit_drift", 0.69);
    expect(result.status).toBe<ParameterDriftGateStatus>("warned_overfit");
    expect(result.passed).toBe(true);
    expect(result.auditAction).toBe("lifecycle.parameter_drift_overfit_low_confidence_warn");
  });

  it("warns but allows when overfit_drift confidence=0.30", () => {
    const result = evaluateParameterDriftGate("overfit_drift", 0.30);
    expect(result.status).toBe<ParameterDriftGateStatus>("warned_overfit");
    expect(result.passed).toBe(true);
  });

  it("warns but allows when overfit_drift confidence is null (missing = not confirmed high confidence)", () => {
    const result = evaluateParameterDriftGate("overfit_drift", null);
    expect(result.status).toBe<ParameterDriftGateStatus>("warned_overfit");
    expect(result.passed).toBe(true);
    expect(result.confidence).toBeNull();
  });
});

// ─── indeterminate → WARN (allow) ────────────────────────────────────────────

describe("evaluateParameterDriftGate — indeterminate → warned", () => {
  it("warns but allows when classification=indeterminate", () => {
    const result = evaluateParameterDriftGate("indeterminate", 0.50);
    expect(result.status).toBe<ParameterDriftGateStatus>("warned_indeterminate");
    expect(result.passed).toBe(true);
    expect(result.auditAction).toBe("lifecycle.parameter_drift_indeterminate_warn");
  });

  it("warns but allows when classification=indeterminate with null confidence", () => {
    const result = evaluateParameterDriftGate("indeterminate", null);
    expect(result.status).toBe<ParameterDriftGateStatus>("warned_indeterminate");
    expect(result.passed).toBe(true);
  });
});

// ─── regime_driven → pass, no action ─────────────────────────────────────────

describe("evaluateParameterDriftGate — regime_driven → passed, no audit", () => {
  it("passes with no audit action when classification=regime_driven", () => {
    const result = evaluateParameterDriftGate("regime_driven", 0.85);
    expect(result.status).toBe<ParameterDriftGateStatus>("passed");
    expect(result.passed).toBe(true);
    expect(result.auditAction).toBeNull();
  });
});

// ─── stable → pass, no action ────────────────────────────────────────────────

describe("evaluateParameterDriftGate — stable → passed, no audit", () => {
  it("passes with no audit action when classification=stable", () => {
    const result = evaluateParameterDriftGate("stable", 0.60);
    expect(result.status).toBe<ParameterDriftGateStatus>("passed");
    expect(result.passed).toBe(true);
    expect(result.auditAction).toBeNull();
  });

  it("passes with no audit action when classification=stable and confidence null", () => {
    const result = evaluateParameterDriftGate("stable", null);
    expect(result.passed).toBe(true);
    expect(result.auditAction).toBeNull();
  });
});

// ─── null classification → legacy proceed ────────────────────────────────────

describe("evaluateParameterDriftGate — null classification → legacy proceed", () => {
  it("allows promotion with legacy_null status when classification is null", () => {
    const result = evaluateParameterDriftGate(null, null);
    expect(result.status).toBe<ParameterDriftGateStatus>("legacy_null");
    expect(result.passed).toBe(true);
    expect(result.auditAction).toBe("lifecycle.parameter_drift_unavailable");
    expect(result.classification).toBeNull();
  });

  it("allows promotion with legacy_null when classification is undefined", () => {
    const result = evaluateParameterDriftGate(undefined, undefined);
    expect(result.status).toBe<ParameterDriftGateStatus>("legacy_null");
    expect(result.passed).toBe(true);
  });
});

// ─── Forward-compat: unknown classification ───────────────────────────────────

describe("evaluateParameterDriftGate — unknown classification → passed (safe default)", () => {
  it("passes when classification is an unrecognised string (future Pass B.1 value)", () => {
    const result = evaluateParameterDriftGate("parameter_evolution", 0.50);
    expect(result.status).toBe<ParameterDriftGateStatus>("passed");
    expect(result.passed).toBe(true);
    expect(result.auditAction).toBeNull();
  });
});

// ─── Result payload completeness (SSE surface) ────────────────────────────────

describe("evaluateParameterDriftGate — result payload fields", () => {
  it("always returns required fields for SSE payload construction", () => {
    const cases: Array<[string | null, number | null]> = [
      ["overfit_drift", 0.90],
      ["overfit_drift", 0.30],
      ["indeterminate", null],
      ["regime_driven", 0.80],
      ["stable", null],
      [null, null],
    ];
    for (const [cls, conf] of cases) {
      const result = evaluateParameterDriftGate(cls, conf);
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("passed");
      expect(result).toHaveProperty("classification");
      expect(result).toHaveProperty("confidence");
      expect(result).toHaveProperty("auditAction");
      expect(typeof result.passed).toBe("boolean");
      expect(result.classification).toBe(cls ?? null);
    }
  });
});
