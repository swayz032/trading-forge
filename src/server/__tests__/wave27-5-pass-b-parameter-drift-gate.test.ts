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

// ─── C1 (2026-06-29): CPCV-exempt path (param_stability_status) ───────────────

describe("evaluateParameterDriftGate — param_stability_status='cpcv_not_applicable' → cpcv_exempt", () => {
  it("returns DISTINCT cpcv_exempt (not legacy_null) when status is cpcv_not_applicable + null classification", () => {
    // CPCV path: classifier is N/A so classification is null, but the producer
    // explicitly signals the exemption via param_stability_status.
    const result = evaluateParameterDriftGate(null, null, "cpcv_not_applicable");
    expect(result.status).toBe<ParameterDriftGateStatus>("cpcv_exempt");
    expect(result.status).not.toBe("legacy_null");
    expect(result.passed).toBe(true);
    expect(result.auditAction).toBe("lifecycle.parameter_drift_cpcv_exempt");
    expect(result.auditAction).not.toBe("lifecycle.parameter_drift_unavailable");
  });

  it("cpcv_not_applicable takes PRECEDENCE over a present classification (mirrors wfe-gate)", () => {
    // Even if a stray classification rides along, the CPCV exemption wins — the
    // drift formula is structurally N/A in CPCV mode.
    const result = evaluateParameterDriftGate("overfit_drift", 0.99, "cpcv_not_applicable");
    expect(result.status).toBe<ParameterDriftGateStatus>("cpcv_exempt");
    expect(result.passed).toBe(true);
    expect(result.auditAction).toBe("lifecycle.parameter_drift_cpcv_exempt");
  });

  it("ABSENT status (undefined) → genuine legacy_null path is UNCHANGED", () => {
    const result = evaluateParameterDriftGate(null, null, undefined);
    expect(result.status).toBe<ParameterDriftGateStatus>("legacy_null");
    expect(result.auditAction).toBe("lifecycle.parameter_drift_unavailable");
  });

  it("status='computed' (plain WF) does NOT trigger cpcv_exempt — real overfit_drift still BLOCKS", () => {
    const result = evaluateParameterDriftGate("overfit_drift", 0.90, "computed");
    expect(result.status).toBe<ParameterDriftGateStatus>("blocked");
    expect(result.passed).toBe(false);
    expect(result.auditAction).toBe("lifecycle.parameter_overfit_drift_block");
  });

  it("status='computed' with stable classification → passed (no false cpcv_exempt)", () => {
    const result = evaluateParameterDriftGate("stable", 0.80, "computed");
    expect(result.status).toBe<ParameterDriftGateStatus>("passed");
    expect(result.passed).toBe(true);
    expect(result.auditAction).toBeNull();
  });

  it("cpcv_exempt is distinct from legacy_null in audit trail (the C1 contract)", () => {
    const cpcv = evaluateParameterDriftGate(null, null, "cpcv_not_applicable");
    const legacy = evaluateParameterDriftGate(null, null);
    expect(cpcv.status).not.toBe(legacy.status);
    expect(cpcv.auditAction).not.toBe(legacy.auditAction);
    expect(cpcv.passed).toBe(true);
    expect(legacy.passed).toBe(true);
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
