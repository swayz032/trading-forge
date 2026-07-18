/**
 * paper-to-deploy-ready-gates-parity.test.ts — Pass 5 Track A
 *
 * REFACTOR-PARITY PROOF: Verifies that evaluatePaperToDeployReadyGates()
 * produces the SAME verdict as the inlined cron-sweep gate stack in
 * lifecycle-service.ts (checkAutoPromotions, lines ~2807-3688).
 *
 * These tests simulate the cron-sweep's decision logic inline for each
 * scenario and assert that the extracted evaluator returns an identical
 * verdict (passed/blocked/failedGate).
 *
 * "Inline simulation" = the same branch logic the cron sweep uses, expressed
 * as a plain JS predicate that does NOT import the evaluator under test.
 *
 * SCENARIOS:
 *  1. All gates pass → both: passed=true
 *  2. B14 survival twin fails → both: block on b14_survival_twin
 *  3. B14 CI fails (ci_high > threshold) → both: block on b14_ci
 *  4. B15 fails with hard gate enabled → both: block on b15
 *  5. WFE below hard floor → both: block on wfe
 *  6. Parameter drift = overfit_drift + high confidence → both: block on parameter_drift
 *  7. DSR unavailable → both: block on dsr_walk_forward
 *  8. Wave 26 orchestrator spa_p fails → both: block on wave26_orchestrator
 *  9. Frozen-policy hash mismatch → both: block on frozen_policy
 * 10. Composite shadow WOULD_BLOCK → both: still pass (observability only)
 * 11. First-time freeze scenario → both: pass + needsFirstTimeFreeze
 * 12. B14 gate disabled globally → both: skip B14 checks
 */

import { describe, it, expect, vi } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("../b14-ci-gate.js", () => ({
  evaluateB14CiGate: vi.fn(),
  evaluateDsrWalkForwardGate: vi.fn(),
}));

vi.mock("../wfe-gate.js", () => ({
  evaluateWfeGate: vi.fn(),
}));

vi.mock("../parameter-drift-gate.js", () => ({
  evaluateParameterDriftGate: vi.fn(),
}));

vi.mock("../promotion-gate-orchestrator.js", () => ({
  evaluatePromotionGates: vi.fn(),
  getWfePromotionFloor: vi.fn().mockReturnValue(0.80),
}));

vi.mock("../frozen-policy-contract.js", () => ({
  evaluateFrozenPolicyDriftAtPromotion: vi.fn(),
  computeFrozenPolicyHash: vi.fn().mockReturnValue("aabbccdd11223344"),
}));

vi.mock("../composite-shadow-gate.js", () => ({
  deriveShadowDecision: vi.fn().mockReturnValue("WOULD_PROMOTE"),
}));

vi.mock("../logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { evaluatePaperToDeployReadyGates, type PaperToDeployReadyGateInput } from "../paper-to-deploy-ready-gates.js";
import { evaluateB14CiGate, evaluateDsrWalkForwardGate } from "../b14-ci-gate.js";
import { evaluateWfeGate } from "../wfe-gate.js";
import { evaluateParameterDriftGate } from "../parameter-drift-gate.js";
import { evaluatePromotionGates } from "../promotion-gate-orchestrator.js";
import { evaluateFrozenPolicyDriftAtPromotion } from "../frozen-policy-contract.js";

const mockB14Ci = vi.mocked(evaluateB14CiGate);
const mockDsr = vi.mocked(evaluateDsrWalkForwardGate);
const mockWfe = vi.mocked(evaluateWfeGate);
const mockDrift = vi.mocked(evaluateParameterDriftGate);
const mockOrch = vi.mocked(evaluatePromotionGates);
const mockFrozen = vi.mocked(evaluateFrozenPolicyDriftAtPromotion);

// ── Shared "all pass" mock state ──────────────────────────────────────────────

function setAllPass() {
  mockB14Ci.mockReturnValue({
    passed: true,
    reason: "ok",
    legacyFallback: false,
    auditPayload: { point_estimate: 0.05, ci_low: 0.01, ci_high: 0.08, threshold: 0.20, blocked: false, legacy_ruin_scalar_fallback: false, ci_method: "bca", n_resamples: 1000 },
  });
  mockDsr.mockReturnValue({
    passed: true,
    status: "pass",
    auditAction: null,
    reason: "ok",
    auditPayload: { dsr_pass: true, dsr_unavailable: false, dsr: 0.95, status: "pass", blocked: false },
  });
  mockWfe.mockReturnValue({
    status: "passed",
    passed: true,
    wfeOverall: 0.88,
    hardFloor: 0.70,
    warnFloor: 0.50,
    auditAction: null,
  });
  mockDrift.mockReturnValue({
    status: "passed",
    passed: true,
    classification: "stable",
    confidence: 0.92,
    auditAction: null,
  });
  mockOrch.mockReturnValue({
    gate_results: {
      b14_ci_high: { passed: true, value: 0.08, threshold: 0.40, reason: "ok", data_available: true },
      wfe_floor: { passed: true, value: 0.88, threshold: 0.80, reason: "ok", data_available: true },
      cpcv_n_paths: { passed: true, value: 18, threshold: 15, reason: "ok", data_available: true },
      wrc_p: { passed: true, value: 0.02, threshold: 0.05, reason: "ok", data_available: true },
      spa_p: { passed: true, value: 0.01, threshold: 0.05, reason: "ok", data_available: true },
    },
    can_promote: true,
    n_gates_failed: 0,
    failing_gates: [],
  });
  mockFrozen.mockReturnValue({
    ok: true,
    currentHash: "aabbccdd11223344",
    frozenHash: "aabbccdd11223344",
  });
}

// ── Shared base input ─────────────────────────────────────────────────────────

function baseInput(): PaperToDeployReadyGateInput {
  return {
    strategyId: "parity-strategy-001",
    correlationId: "parity-corr-001",
    b14HardGateEnabled: true,
    b15HardGateEnabled: true,
    b14SurvivalTwin: { survival_twin: { passed: true } },
    mcRuinCi: {
      probability_of_ruin_ci: { ci_high: 0.08, ci_low: 0.01, point_estimate: 0.05, ci_method: "bca", n_resamples: 1000 },
      probability_of_ruin: 0.05,
    },
    b14McDataAvailable: true,
    b15Battery: { passed: true, sdr: 0.92, psi: 0.88, rws: 0.90, failures: [] },
    walkForwardResults: {
      wfe_overall: 0.88,
      wfe_status: null,
      param_stability: { drift_classification: "stable", drift_confidence: 0.92 },
      wf_metadata: { dsr_pass: true, dsr_unavailable: false, dsr: 0.95 },
      wf_metadata_mode: "cpcv",
      wf_metadata_n_paths: 18,
    },
    orchGates: { wrcPValue: 0.02, spaConsistentP: 0.01 },
    compositeShadow: {
      availability: "available",
      composite_score: 0.85,
      verdict: "HEALTHY",
      shadow_decision: "WOULD_PROMOTE",
      weights_version_id: "v2",
      evaluated_at: new Date(),
      staleness_age_hours: 3,
      computed_from_n_subsystems: 9,
      reason: "composite.healthy",
    },
    frozenPolicy: {
      id: "parity-strategy-001",
      config: { stopLoss: 12, takeProfit: 18, contractSize: 1 },
      frozenPolicyHash: "aabbccdd11223344",
    },
    // A pre-existing hardening commit fail-closed BIF's legacy-null path.
    // evaluateBifGate() is NOT mocked in this file — it runs for real — so a clean
    // BIF input is required for the "happy path" background gates to stay green;
    // 1.5 <= BIF_WARN_THRESHOLD(2.0) → "bif.clean".
    bifInput: { bif: 1.5, kEff: 8 },
  };
}

// ── Inline cron-sweep simulation ──────────────────────────────────────────────
/**
 * Simulates the cron-sweep decision logic for a given scenario.
 * Returns { passed, failedGate } — the verdict a human reading lifecycle-service.ts
 * would expect for the same gate mock returns.
 *
 * This does NOT call evaluatePaperToDeployReadyGates — it is independent.
 */
function simulateCronSweep(
  params: {
    b14HardGateEnabled: boolean;
    survivalTwinPassed: boolean | null;
    b14CiPassed: boolean;
    b15Present: boolean;
    b15Passed: boolean;
    b15HardGateEnabled: boolean;
    wfeStatus: string; // "passed"|"blocked"|"degenerate_is_block"|"legacy_null"
    wfeAuditAction: string | null;
    driftStatus: string; // "passed"|"blocked"|"blocked_classifier_error"|"warned_overfit"|etc
    driftAuditAction: string | null;
    dsrPassed: boolean;
    dsrAuditAction: string | null;
    orchFailingGates: string[];
    frozenOk: boolean;
    frozenHashNull: boolean;
    frozenException: boolean;
  }
): { passed: boolean; failedGate: string | null } {
  // Gate 1: B14 Survival Twin
  if (params.b14HardGateEnabled) {
    if (params.survivalTwinPassed === false) return { passed: false, failedGate: "b14_survival_twin" };
    // Gate 2: B14 CI
    if (!params.b14CiPassed) return { passed: false, failedGate: "b14_ci" };
  }
  // Gate 3: B15
  if (params.b15Present && params.b15Passed === false && params.b15HardGateEnabled) {
    return { passed: false, failedGate: "b15" };
  }
  // Gate 4: WFE
  if (params.wfeAuditAction) {
    const isBlock = params.wfeStatus === "blocked" || params.wfeStatus === "degenerate_is_block";
    if (isBlock) return { passed: false, failedGate: "wfe" };
  }
  // Gate 5: parameter drift
  if (params.driftAuditAction) {
    const isBlock = params.driftStatus === "blocked" || params.driftStatus === "blocked_classifier_error";
    if (isBlock) return { passed: false, failedGate: "parameter_drift" };
  }
  // Gate 6: DSR
  if (params.dsrAuditAction && !params.dsrPassed) {
    return { passed: false, failedGate: "dsr_walk_forward" };
  }
  // Gate 7: orchestrator
  if (params.orchFailingGates.length > 0) {
    return { passed: false, failedGate: "wave26_orchestrator" };
  }
  // Gate 8: composite shadow — NEVER blocks
  // Gate 9: frozen policy
  if (params.frozenException) return { passed: false, failedGate: "frozen_policy" };
  if (!params.frozenOk && !params.frozenHashNull) return { passed: false, failedGate: "frozen_policy" };
  return { passed: true, failedGate: null };
}

// ── Parity fixtures ───────────────────────────────────────────────────────────

describe("paper-to-deploy-ready-gates REFACTOR PARITY", () => {
  it("Scenario 1: all gates pass → both return passed:true", () => {
    setAllPass();
    const evaluated = evaluatePaperToDeployReadyGates(baseInput());
    const simulated = simulateCronSweep({
      b14HardGateEnabled: true,
      survivalTwinPassed: true,
      b14CiPassed: true,
      b15Present: true,
      b15Passed: true,
      b15HardGateEnabled: true,
      wfeStatus: "passed",
      wfeAuditAction: null,
      driftStatus: "passed",
      driftAuditAction: null,
      dsrPassed: true,
      dsrAuditAction: null,
      orchFailingGates: [],
      frozenOk: true,
      frozenHashNull: false,
      frozenException: false,
    });

    expect(evaluated.passed).toBe(simulated.passed);
    expect(evaluated.failedGate ?? null).toBe(simulated.failedGate);
  });

  it("Scenario 2: B14 survival twin fails → both block on b14_survival_twin", () => {
    setAllPass();
    const input = baseInput();
    input.b14SurvivalTwin = { survival_twin: { passed: false } };

    const evaluated = evaluatePaperToDeployReadyGates(input);
    const simulated = simulateCronSweep({
      b14HardGateEnabled: true,
      survivalTwinPassed: false,
      b14CiPassed: true,
      b15Present: true, b15Passed: true, b15HardGateEnabled: true,
      wfeStatus: "passed", wfeAuditAction: null,
      driftStatus: "passed", driftAuditAction: null,
      dsrPassed: true, dsrAuditAction: null,
      orchFailingGates: [],
      frozenOk: true, frozenHashNull: false, frozenException: false,
    });

    expect(evaluated.passed).toBe(simulated.passed);
    expect(evaluated.failedGate).toBe(simulated.failedGate);
    expect(evaluated.failedGate).toBe("b14_survival_twin");
  });

  it("Scenario 3: B14 CI fails → both block on b14_ci", () => {
    setAllPass();
    mockB14Ci.mockReturnValue({
      passed: false,
      reason: "ci_high 0.32 > 0.20",
      legacyFallback: false,
      auditPayload: { point_estimate: 0.25, ci_low: 0.12, ci_high: 0.32, threshold: 0.20, blocked: true, legacy_ruin_scalar_fallback: false, ci_method: "bca", n_resamples: 1000 },
    });

    const evaluated = evaluatePaperToDeployReadyGates(baseInput());
    const simulated = simulateCronSweep({
      b14HardGateEnabled: true,
      survivalTwinPassed: true,
      b14CiPassed: false,
      b15Present: true, b15Passed: true, b15HardGateEnabled: true,
      wfeStatus: "passed", wfeAuditAction: null,
      driftStatus: "passed", driftAuditAction: null,
      dsrPassed: true, dsrAuditAction: null,
      orchFailingGates: [],
      frozenOk: true, frozenHashNull: false, frozenException: false,
    });

    expect(evaluated.passed).toBe(simulated.passed);
    expect(evaluated.failedGate).toBe(simulated.failedGate);
    expect(evaluated.failedGate).toBe("b14_ci");
  });

  it("Scenario 4: B15 fails, hard gate enabled → both block on b15", () => {
    setAllPass();
    const input = baseInput();
    input.b15Battery = { passed: false, sdr: 0.40, failures: ["sdr_below_threshold"] };

    const evaluated = evaluatePaperToDeployReadyGates(input);
    const simulated = simulateCronSweep({
      b14HardGateEnabled: true, survivalTwinPassed: true, b14CiPassed: true,
      b15Present: true, b15Passed: false, b15HardGateEnabled: true,
      wfeStatus: "passed", wfeAuditAction: null,
      driftStatus: "passed", driftAuditAction: null,
      dsrPassed: true, dsrAuditAction: null,
      orchFailingGates: [],
      frozenOk: true, frozenHashNull: false, frozenException: false,
    });

    expect(evaluated.passed).toBe(simulated.passed);
    expect(evaluated.failedGate).toBe(simulated.failedGate);
    expect(evaluated.failedGate).toBe("b15");
  });

  it("Scenario 5: WFE below hard floor → both block on wfe", () => {
    setAllPass();
    mockWfe.mockReturnValue({
      status: "blocked",
      passed: false,
      wfeOverall: 0.58,
      hardFloor: 0.70,
      warnFloor: 0.50,
      auditAction: "lifecycle.wfe_hard_floor_block",
    });

    const evaluated = evaluatePaperToDeployReadyGates(baseInput());
    const simulated = simulateCronSweep({
      b14HardGateEnabled: true, survivalTwinPassed: true, b14CiPassed: true,
      b15Present: true, b15Passed: true, b15HardGateEnabled: true,
      wfeStatus: "blocked", wfeAuditAction: "lifecycle.wfe_hard_floor_block",
      driftStatus: "passed", driftAuditAction: null,
      dsrPassed: true, dsrAuditAction: null,
      orchFailingGates: [],
      frozenOk: true, frozenHashNull: false, frozenException: false,
    });

    expect(evaluated.passed).toBe(simulated.passed);
    expect(evaluated.failedGate).toBe(simulated.failedGate);
    expect(evaluated.failedGate).toBe("wfe");
  });

  it("Scenario 6: parameter drift = overfit_drift + high confidence → both block on parameter_drift", () => {
    setAllPass();
    mockDrift.mockReturnValue({
      status: "blocked",
      passed: false,
      classification: "overfit_drift",
      confidence: 0.87,
      auditAction: "lifecycle.parameter_overfit_drift_block",
    });

    const evaluated = evaluatePaperToDeployReadyGates(baseInput());
    const simulated = simulateCronSweep({
      b14HardGateEnabled: true, survivalTwinPassed: true, b14CiPassed: true,
      b15Present: true, b15Passed: true, b15HardGateEnabled: true,
      wfeStatus: "passed", wfeAuditAction: null,
      driftStatus: "blocked", driftAuditAction: "lifecycle.parameter_overfit_drift_block",
      dsrPassed: true, dsrAuditAction: null,
      orchFailingGates: [],
      frozenOk: true, frozenHashNull: false, frozenException: false,
    });

    expect(evaluated.passed).toBe(simulated.passed);
    expect(evaluated.failedGate).toBe(simulated.failedGate);
    expect(evaluated.failedGate).toBe("parameter_drift");
  });

  it("Scenario 7: DSR unavailable → both block on dsr_walk_forward", () => {
    setAllPass();
    mockDsr.mockReturnValue({
      passed: false,
      status: "blocked_dsr_unavailable",
      auditAction: "lifecycle.dsr_unavailable_block",
      reason: "dsr_unavailable flag set",
      auditPayload: { dsr_pass: false, dsr_unavailable: true, dsr: null, status: "blocked_dsr_unavailable", blocked: true },
    });

    const evaluated = evaluatePaperToDeployReadyGates(baseInput());
    const simulated = simulateCronSweep({
      b14HardGateEnabled: true, survivalTwinPassed: true, b14CiPassed: true,
      b15Present: true, b15Passed: true, b15HardGateEnabled: true,
      wfeStatus: "passed", wfeAuditAction: null,
      driftStatus: "passed", driftAuditAction: null,
      dsrPassed: false, dsrAuditAction: "lifecycle.dsr_unavailable_block",
      orchFailingGates: [],
      frozenOk: true, frozenHashNull: false, frozenException: false,
    });

    expect(evaluated.passed).toBe(simulated.passed);
    expect(evaluated.failedGate).toBe(simulated.failedGate);
    expect(evaluated.failedGate).toBe("dsr_walk_forward");
  });

  it("Scenario 8: orchestrator spa_p gate fails → both block on wave26_orchestrator", () => {
    setAllPass();
    mockOrch.mockReturnValue({
      gate_results: {
        b14_ci_high: { passed: true, value: 0.08, threshold: 0.40, reason: "ok", data_available: true },
        wfe_floor: { passed: true, value: 0.88, threshold: 0.80, reason: "ok", data_available: true },
        cpcv_n_paths: { passed: true, value: 18, threshold: 15, reason: "ok", data_available: true },
        wrc_p: { passed: true, value: 0.02, threshold: 0.05, reason: "ok", data_available: true },
        spa_p: { passed: false, value: 0.09, threshold: 0.05, reason: "spa_p: 0.09 >= 0.05", data_available: true },
      },
      can_promote: false,
      n_gates_failed: 1,
      failing_gates: ["spa_p"],
    });

    const evaluated = evaluatePaperToDeployReadyGates(baseInput());
    const simulated = simulateCronSweep({
      b14HardGateEnabled: true, survivalTwinPassed: true, b14CiPassed: true,
      b15Present: true, b15Passed: true, b15HardGateEnabled: true,
      wfeStatus: "passed", wfeAuditAction: null,
      driftStatus: "passed", driftAuditAction: null,
      dsrPassed: true, dsrAuditAction: null,
      orchFailingGates: ["spa_p"],
      frozenOk: true, frozenHashNull: false, frozenException: false,
    });

    expect(evaluated.passed).toBe(simulated.passed);
    expect(evaluated.failedGate).toBe(simulated.failedGate);
    expect(evaluated.failedGate).toBe("wave26_orchestrator");
  });

  it("Scenario 9: frozen-policy hash mismatch → both block on frozen_policy", () => {
    setAllPass();
    mockFrozen.mockReturnValue({
      ok: false,
      currentHash: "aabbccdd11223344",
      frozenHash: "xxxx00001111yyyy",
      reason: "frozen_policy.hash_mismatch",
    });

    const evaluated = evaluatePaperToDeployReadyGates(baseInput());
    const simulated = simulateCronSweep({
      b14HardGateEnabled: true, survivalTwinPassed: true, b14CiPassed: true,
      b15Present: true, b15Passed: true, b15HardGateEnabled: true,
      wfeStatus: "passed", wfeAuditAction: null,
      driftStatus: "passed", driftAuditAction: null,
      dsrPassed: true, dsrAuditAction: null,
      orchFailingGates: [],
      frozenOk: false, frozenHashNull: false, frozenException: false,
    });

    expect(evaluated.passed).toBe(simulated.passed);
    expect(evaluated.failedGate).toBe(simulated.failedGate);
    expect(evaluated.failedGate).toBe("frozen_policy");
  });

  it("Scenario 10: composite shadow WOULD_BLOCK → both still pass (observability only)", () => {
    setAllPass();
    const input = baseInput();
    input.compositeShadow = {
      availability: "available",
      composite_score: 0.22,
      verdict: "CRITICAL",
      shadow_decision: "WOULD_BLOCK",
      weights_version_id: "v2",
      evaluated_at: new Date(),
      staleness_age_hours: 1,
      computed_from_n_subsystems: 9,
      reason: "composite.critical",
    };

    const evaluated = evaluatePaperToDeployReadyGates(input);
    const simulated = simulateCronSweep({
      b14HardGateEnabled: true, survivalTwinPassed: true, b14CiPassed: true,
      b15Present: true, b15Passed: true, b15HardGateEnabled: true,
      wfeStatus: "passed", wfeAuditAction: null,
      driftStatus: "passed", driftAuditAction: null,
      dsrPassed: true, dsrAuditAction: null,
      orchFailingGates: [],
      frozenOk: true, frozenHashNull: false, frozenException: false,
    });

    expect(evaluated.passed).toBe(simulated.passed);
    expect(evaluated.failedGate ?? null).toBe(simulated.failedGate);
    expect(evaluated.passed).toBe(true);
    expect(evaluated.shadowEvaluation?.shadow_decision).toBe("WOULD_BLOCK");
  });

  it("Scenario 11: first-time freeze → both return passed:true; evaluator sets needsFirstTimeFreeze", () => {
    setAllPass();
    mockFrozen.mockReturnValue({
      ok: true,
      currentHash: "aabbccdd11223344",
      frozenHash: null,
    });

    const input = baseInput();
    input.frozenPolicy.frozenPolicyHash = null;

    const evaluated = evaluatePaperToDeployReadyGates(input);
    const simulated = simulateCronSweep({
      b14HardGateEnabled: true, survivalTwinPassed: true, b14CiPassed: true,
      b15Present: true, b15Passed: true, b15HardGateEnabled: true,
      wfeStatus: "passed", wfeAuditAction: null,
      driftStatus: "passed", driftAuditAction: null,
      dsrPassed: true, dsrAuditAction: null,
      orchFailingGates: [],
      frozenOk: true, frozenHashNull: true, frozenException: false,
    });

    expect(evaluated.passed).toBe(simulated.passed);
    expect(evaluated.passed).toBe(true);
    expect(evaluated.needsFirstTimeFreeze).toBe(true);
  });

  it("Scenario 12: B14 gate disabled → both skip B14 checks; next gate determines outcome", () => {
    setAllPass();
    // Even if survival twin would fail — with disabled gate, should not block there
    const input = baseInput();
    input.b14HardGateEnabled = false;
    input.b14SurvivalTwin = { survival_twin: { passed: false } };

    const evaluated = evaluatePaperToDeployReadyGates(input);
    const simulated = simulateCronSweep({
      b14HardGateEnabled: false, // Gate disabled
      survivalTwinPassed: false,
      b14CiPassed: false, // Would block if gate were enabled
      b15Present: true, b15Passed: true, b15HardGateEnabled: true,
      wfeStatus: "passed", wfeAuditAction: null,
      driftStatus: "passed", driftAuditAction: null,
      dsrPassed: true, dsrAuditAction: null,
      orchFailingGates: [],
      frozenOk: true, frozenHashNull: false, frozenException: false,
    });

    expect(evaluated.failedGate !== "b14_survival_twin").toBe(true);
    expect(evaluated.failedGate !== "b14_ci").toBe(true);
    expect(evaluated.passed).toBe(simulated.passed);
    expect(evaluated.passed).toBe(true); // All non-B14 gates pass
  });
});
