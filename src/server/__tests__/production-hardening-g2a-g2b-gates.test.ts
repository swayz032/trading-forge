/**
 * production-hardening-g2a-g2b-gates.test.ts
 * Wave hardening 2026-06-22 — G2a + G2b disconnect-proofing tests.
 *
 * These tests exercise the REAL producer→gate contract: they feed the gate
 * objects shaped exactly as walk_forward.py actually emits them.
 *
 * G2a (WFE silent-pass on degenerate IS windows):
 *   Producer contract: wfe_overall=0.0, wfe_status="degenerate_is"
 *   Gate MUST: BLOCK (degenerate_is_block), NOT legacy_null / grandfather pass.
 *
 * G2b (param-drift classifier exception → warn-and-allow):
 *   Producer contract: drift_classification="classifier_error"
 *   Gate MUST: BLOCK (blocked_classifier_error), NOT warned_indeterminate.
 *
 * Additionally:
 *   - genuine pre-W27.5 legacy (key absent / wfe_status absent) → grandfather pass GREEN
 *   - genuine indeterminate → warn-and-allow GREEN (regression)
 *   - wfe_overall=0.0 WITHOUT wfe_status → hard-floor block (existing numeric path)
 */

import { describe, it, expect, vi } from "vitest";
import {
  evaluateWfeGate,
  type WfeGateStatus,
} from "../lib/wfe-gate.js";
import {
  evaluateParameterDriftGate,
  type ParameterDriftGateStatus,
} from "../lib/parameter-drift-gate.js";

vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── G2a: WFE degenerate IS — producer-shaped contract tests ─────────────────

describe("G2a — WFE degenerate IS (producer contract: wfe_overall=0.0, wfe_status='degenerate_is')", () => {
  it("BLOCKS when producer emits wfe_overall=0.0 and wfe_status='degenerate_is'", () => {
    // This is the exact shape walk_forward.py emits after the G2a fix.
    const result = evaluateWfeGate(0.0, 0.70, 0.50, "degenerate_is");
    expect(result.status).toBe<WfeGateStatus>("degenerate_is_block");
    expect(result.passed).toBe(false);
    expect(result.auditAction).toBe("lifecycle.wfe_degenerate_is_block");
  });

  it("BLOCKS with distinct audit action (not wfe_hard_floor_block) for degenerate_is", () => {
    const result = evaluateWfeGate(0.0, 0.70, 0.50, "degenerate_is");
    // Must NOT fall into the generic block path — lifecycle audit trail needs the distinction
    expect(result.auditAction).not.toBe("lifecycle.wfe_hard_floor_block");
    expect(result.auditAction).toBe("lifecycle.wfe_degenerate_is_block");
  });

  it("BLOCKS even if wfe_overall is null alongside wfe_status='degenerate_is'", () => {
    // Edge case: producer could conceivably emit null+degenerate_is.
    // Must still BLOCK — degenerate_is takes priority over null legacy path.
    const result = evaluateWfeGate(null, 0.70, 0.50, "degenerate_is");
    expect(result.status).toBe<WfeGateStatus>("degenerate_is_block");
    expect(result.passed).toBe(false);
    expect(result.auditAction).toBe("lifecycle.wfe_degenerate_is_block");
  });

  it("IS NOT mislabeled as lifecycle.wfe_unavailable_legacy", () => {
    // Regression guard: the original bug routed null wfe_overall → legacy_null → passed.
    // With degenerate_is signal present this MUST never happen.
    const result = evaluateWfeGate(0.0, 0.70, 0.50, "degenerate_is");
    expect(result.auditAction).not.toBe("lifecycle.wfe_unavailable_legacy");
    expect(result.status).not.toBe<WfeGateStatus>("legacy_null");
  });
});

// ─── G2a: genuine legacy path stays GREEN (regression) ───────────────────────

describe("G2a — genuine legacy path (wfe_status absent/undefined → fail-closed per hardening)", () => {
  it("blocks when wfeOverall is null AND wfeStatus is undefined (key genuinely absent)", () => {
    const result = evaluateWfeGate(null, 0.70, 0.50, undefined);
    expect(result.status).toBe<WfeGateStatus>("legacy_null");
    expect(result.passed).toBe(false);
    expect(result.auditAction).toBe("lifecycle.wfe_unavailable_legacy");
  });

  it("blocks when wfeOverall is null AND wfeStatus is null (pre-W27.5 backtest row)", () => {
    const result = evaluateWfeGate(null, 0.70, 0.50, null);
    expect(result.status).toBe<WfeGateStatus>("legacy_null");
    expect(result.passed).toBe(false);
    expect(result.auditAction).toBe("lifecycle.wfe_unavailable_legacy");
  });

  it("blocks when wfeOverall is undefined AND no wfeStatus (omitted 4th arg — legacy caller)", () => {
    // Callers that do not yet pass wfeStatus (existing lifecycle-service.ts) remain unbroken
    const result = evaluateWfeGate(undefined);
    expect(result.status).toBe<WfeGateStatus>("legacy_null");
    expect(result.passed).toBe(false);
  });
});

// ─── G2a: wfe_overall=0.0 WITHOUT wfe_status → normal numeric block ──────────

describe("G2a — wfe_overall=0.0 without wfe_status → numeric hard-floor block (not degenerate_is)", () => {
  it("returns blocked (not degenerate_is_block) when wfe_overall=0.0 and no wfe_status", () => {
    const result = evaluateWfeGate(0.0, 0.70, 0.50);
    expect(result.status).toBe<WfeGateStatus>("blocked");
    expect(result.passed).toBe(false);
    expect(result.auditAction).toBe("lifecycle.wfe_hard_floor_block");
  });
});

// ─── G2b: classifier_error — producer-shaped contract tests ──────────────────

describe("G2b — classifier error (producer contract: drift_classification='classifier_error')", () => {
  it("BLOCKS when producer emits drift_classification='classifier_error'", () => {
    // This is the exact field name walk_forward.py writes into param_stability.
    const result = evaluateParameterDriftGate("classifier_error", null);
    expect(result.status).toBe<ParameterDriftGateStatus>("blocked_classifier_error");
    expect(result.passed).toBe(false);
    expect(result.auditAction).toBe("lifecycle.parameter_drift_classifier_error_block");
  });

  it("BLOCKS classifier_error regardless of confidence value", () => {
    // Confidence is null when classifier throws — but even if something slips through:
    const withConf = evaluateParameterDriftGate("classifier_error", 0.99);
    expect(withConf.passed).toBe(false);
    expect(withConf.status).toBe<ParameterDriftGateStatus>("blocked_classifier_error");
  });

  it("IS NOT mislabeled as warned_indeterminate (original defect)", () => {
    // Regression guard: before G2b fix, exception fallback wrote "indeterminate"
    // which then mapped to warned_indeterminate → passed=true.
    const result = evaluateParameterDriftGate("classifier_error", null);
    expect(result.status).not.toBe<ParameterDriftGateStatus>("warned_indeterminate");
    expect(result.passed).not.toBe(true);
    expect(result.auditAction).not.toBe("lifecycle.parameter_drift_indeterminate_warn");
  });

  it("has DISTINCT audit action from overfit_drift block", () => {
    const classifierErr = evaluateParameterDriftGate("classifier_error", null);
    const overfitBlock = evaluateParameterDriftGate("overfit_drift", 0.90);
    expect(classifierErr.auditAction).toBe("lifecycle.parameter_drift_classifier_error_block");
    expect(overfitBlock.auditAction).toBe("lifecycle.parameter_overfit_drift_block");
    expect(classifierErr.auditAction).not.toBe(overfitBlock.auditAction);
  });
});

// ─── G2b: genuine indeterminate → warn-and-allow (regression GREEN) ──────────

describe("G2b — genuine indeterminate → warn-and-allow (regression unchanged)", () => {
  it("warns and allows when classification=indeterminate (genuine ambiguity, no exception)", () => {
    const result = evaluateParameterDriftGate("indeterminate", 0.50);
    expect(result.status).toBe<ParameterDriftGateStatus>("warned_indeterminate");
    expect(result.passed).toBe(true);
    expect(result.auditAction).toBe("lifecycle.parameter_drift_indeterminate_warn");
  });

  it("warns and allows when indeterminate with null confidence", () => {
    const result = evaluateParameterDriftGate("indeterminate", null);
    expect(result.passed).toBe(true);
    expect(result.status).toBe<ParameterDriftGateStatus>("warned_indeterminate");
  });
});

// ─── G2b: forward-compat pass-through does NOT absorb classifier_error ────────

describe("G2b — forward-compat unknown value falls through but classifier_error does NOT", () => {
  it("unknown future classification → passed (forward-compat)", () => {
    const result = evaluateParameterDriftGate("future_value_unknown", 0.50);
    expect(result.status).toBe<ParameterDriftGateStatus>("passed");
    expect(result.passed).toBe(true);
  });

  it("classifier_error NEVER reaches the forward-compat pass-through", () => {
    const result = evaluateParameterDriftGate("classifier_error", 0.50);
    expect(result.status).not.toBe<ParameterDriftGateStatus>("passed");
    expect(result.passed).toBe(false);
  });
});

// ─── Combined contract: producer shapes for both defects ─────────────────────

describe("Combined producer-shaped objects (walk_forward.py output simulation)", () => {
  it("G2a: full producer-shaped WF result with degenerate IS → WFE gate BLOCKS", () => {
    // Simulates exactly what backtest-service.ts extracts from wf_result
    const wfResult = {
      wfe_overall: 0.0,       // emitted by G2a fix
      wfe_status: "degenerate_is",  // emitted by G2a fix
    };
    const gateResult = evaluateWfeGate(
      wfResult.wfe_overall,
      undefined,
      undefined,
      wfResult.wfe_status,
    );
    expect(gateResult.passed).toBe(false);
    expect(gateResult.auditAction).toBe("lifecycle.wfe_degenerate_is_block");
  });

  it("G2b: full producer-shaped WF result with classifier exception → drift gate BLOCKS", () => {
    // Simulates exactly what backtest-service.ts extracts from param_stability
    const paramStability = {
      drift_classification: "classifier_error",  // emitted by G2b fix
      drift_confidence: null,                    // emitted by G2b fix
    };
    const gateResult = evaluateParameterDriftGate(
      paramStability.drift_classification,
      paramStability.drift_confidence,
    );
    expect(gateResult.passed).toBe(false);
    expect(gateResult.auditAction).toBe("lifecycle.parameter_drift_classifier_error_block");
  });
});
