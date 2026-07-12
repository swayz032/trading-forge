/**
 * paper-to-deploy-ready-gates.test.ts — Pass 5 Track A
 *
 * Unit tests with REFACTOR-PARITY FIXTURES for evaluatePaperToDeployReadyGates.
 *
 * Coverage:
 *  - Each gate blocks when its blocking condition is met
 *  - All-gates-pass fixture
 *  - Legacy/null data fixture (grandfather pass)
 *  - First-gate-in-order when two gates would both fail
 *  - B14 env-toggle disable path
 *  - B15 env-toggle disable path
 *  - Composite shadow: observability only — never blocks
 *  - Frozen-policy: first-time freeze sets needsFirstTimeFreeze
 *  - Frozen-policy: hash mismatch blocks
 *  - Frozen-policy: exception blocks fail-CLOSED
 *  - B14 infra-error path blocks fail-CLOSED
 *  - No MC run (b14McDataAvailable=false) blocks fail-CLOSED
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ─────────────────────────────────────────────────────────────
// All gate evaluators are imported inside the pure function — mock at module level.

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

// Mock logger to suppress output during tests
vi.mock("../logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the Python subprocess runner so resolveSurvivalTwinOnDemand can be tested
// without spawning Python.
vi.mock("../python-runner.js", () => ({
  runPythonModule: vi.fn(),
}));

import {
  evaluatePaperToDeployReadyGates,
  resolveSurvivalTwinOnDemand,
  type PaperToDeployReadyGateInput,
} from "../paper-to-deploy-ready-gates.js";
import { runPythonModule } from "../python-runner.js";
import { evaluateB14CiGate, evaluateDsrWalkForwardGate } from "../b14-ci-gate.js";
import { evaluateWfeGate } from "../wfe-gate.js";
import { evaluateParameterDriftGate } from "../parameter-drift-gate.js";
import { evaluatePromotionGates } from "../promotion-gate-orchestrator.js";
import { evaluateFrozenPolicyDriftAtPromotion } from "../frozen-policy-contract.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockB14Ci = vi.mocked(evaluateB14CiGate);
const mockDsr = vi.mocked(evaluateDsrWalkForwardGate);
const mockWfe = vi.mocked(evaluateWfeGate);
const mockDrift = vi.mocked(evaluateParameterDriftGate);
const mockOrch = vi.mocked(evaluatePromotionGates);
const mockFrozen = vi.mocked(evaluateFrozenPolicyDriftAtPromotion);
const mockRunPython = vi.mocked(runPythonModule);

/** Returns all gate mocks in their "pass" configuration. */
function setAllGatesPass() {
  // B14 CI: passed
  mockB14Ci.mockReturnValue({
    passed: true,
    reason: "ci_high below threshold",
    legacyFallback: false,
    auditPayload: {
      point_estimate: 0.05,
      ci_low: 0.01,
      ci_high: 0.08,
      threshold: 0.20,
      blocked: false,
      legacy_ruin_scalar_fallback: false,
      ci_method: "bca",
      n_resamples: 1000,
    },
  });
  // DSR: passed
  mockDsr.mockReturnValue({
    passed: true,
    status: "pass",
    auditAction: null,
    reason: "DSR above floor",
    auditPayload: {
      dsr_pass: true,
      dsr_unavailable: false,
      dsr: 0.92,
      status: "pass",
      blocked: false,
    },
  });
  // WFE: passed
  mockWfe.mockReturnValue({
    status: "passed",
    passed: true,
    wfeOverall: 0.85,
    hardFloor: 0.70,
    warnFloor: 0.50,
    auditAction: null,
  });
  // Parameter drift: passed
  mockDrift.mockReturnValue({
    status: "passed",
    passed: true,
    classification: "stable",
    confidence: 0.95,
    auditAction: null,
  });
  // Orchestrator: all pass
  mockOrch.mockReturnValue({
    gate_results: {
      b14_ci_high: { passed: true, value: 0.08, threshold: 0.40, reason: "ok", data_available: true },
      wfe_floor: { passed: true, value: 0.85, threshold: 0.80, reason: "ok", data_available: true },
      cpcv_n_paths: { passed: true, value: 20, threshold: 15, reason: "ok", data_available: true },
      wrc_p: { passed: true, value: 0.02, threshold: 0.05, reason: "ok", data_available: true },
      spa_p: { passed: true, value: 0.01, threshold: 0.05, reason: "ok", data_available: true },
    },
    can_promote: true,
    n_gates_failed: 0,
    failing_gates: [],
  });
  // Frozen policy: passes with a frozen hash
  mockFrozen.mockReturnValue({
    ok: true,
    currentHash: "aabbccdd11223344",
    frozenHash: "aabbccdd11223344",
  });
}

/** Minimal frozen-policy input that passes. */
const frozenPolicyPass: PaperToDeployReadyGateInput["frozenPolicy"] = {
  id: "strategy-abc",
  config: { stopLoss: 12, takeProfit: 18 },
  frozenPolicyHash: "aabbccdd11223344",
};

/** Minimal WFR that passes. */
const wfrPass: PaperToDeployReadyGateInput["walkForwardResults"] = {
  wfe_overall: 0.85,
  wfe_status: null,
  param_stability: { drift_classification: "stable", drift_confidence: 0.95 },
  wf_metadata: { dsr_pass: true, dsr_unavailable: false, dsr: 0.92 },
  wf_metadata_mode: "cpcv",
  wf_metadata_n_paths: 20,
};

/** Builds a passing full input. */
function buildPassInput(): PaperToDeployReadyGateInput {
  return {
    strategyId: "strategy-abc",
    correlationId: "corr-001",
    b14HardGateEnabled: true,
    b15HardGateEnabled: true,
    b14SurvivalTwin: {
      survival_twin: { passed: true },
    },
    mcRuinCi: {
      probability_of_ruin_ci: {
        ci_high: 0.08,
        ci_low: 0.01,
        point_estimate: 0.05,
        ci_method: "bca",
        n_resamples: 1000,
      },
      probability_of_ruin: 0.05,
    },
    b14McDataAvailable: true,
    b15Battery: { passed: true, sdr: 0.9, psi: 0.85, rws: 0.88, failures: [] },
    walkForwardResults: wfrPass,
    orchGates: { wrcPValue: 0.02, spaConsistentP: 0.01 },
    compositeShadow: {
      availability: "available",
      composite_score: 0.82,
      verdict: "HEALTHY",
      shadow_decision: "WOULD_PROMOTE",
      weights_version_id: "v1",
      evaluated_at: new Date(),
      staleness_age_hours: 2,
      computed_from_n_subsystems: 8,
      reason: "composite.healthy",
    },
    frozenPolicy: frozenPolicyPass,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("evaluatePaperToDeployReadyGates", () => {
  // ── All gates pass ──────────────────────────────────────────────────────────
  describe("all-gates-pass fixture", () => {
    it("returns passed:true, status:'pass' when all gates allow promotion", () => {
      setAllGatesPass();
      const result = evaluatePaperToDeployReadyGates(buildPassInput());

      expect(result.passed).toBe(true);
      expect(result.status).toBe("pass");
      expect(result.auditAction).toBeNull();
      expect(result.failedGate).toBeUndefined();
      expect(result.needsFirstTimeFreeze).toBeUndefined();
    });

    it("includes shadowEvaluation in the result", () => {
      setAllGatesPass();
      const result = evaluatePaperToDeployReadyGates(buildPassInput());

      expect(result.shadowEvaluation).toBeDefined();
      expect(result.shadowEvaluation?.shadow_decision).toBe("WOULD_PROMOTE");
    });
  });

  // ── Gate 1: B14 Survival Twin ───────────────────────────────────────────────
  describe("Gate 1 — B14 Survival Twin", () => {
    it("blocks when survival_twin.passed === false", () => {
      setAllGatesPass();
      const input = buildPassInput();
      input.b14SurvivalTwin = { survival_twin: { passed: false, survival_rate: 0.45 } };

      const result = evaluatePaperToDeployReadyGates(input);

      expect(result.passed).toBe(false);
      expect(result.failedGate).toBe("b14_survival_twin");
      expect(result.auditAction).toBe("lifecycle.b14_hard_blocked");
    });

    it("blocks fail-CLOSED when infraError=true", () => {
      setAllGatesPass();
      const input = buildPassInput();
      input.b14SurvivalTwin = { infraError: true };

      const result = evaluatePaperToDeployReadyGates(input);

      expect(result.passed).toBe(false);
      expect(result.failedGate).toBe("b14_survival_twin");
      expect(result.auditAction).toBe("b14.gate_error_fail_closed");
      expect(result.status).toBe("infra_error");
    });

    it("freshscan7 MED: BIF gate fail-CLOSES when bifInput.computationError=true (manual-path cron parity)", () => {
      // A compute_bif() THROW leaves bif=null + walkForwardResults.bif_computation_error=true. Previously
      // the manual PATCH path's bifInput had no computationError field, so a computation-FAILURE null was
      // indistinguishable from a pre-Wave-3 legacy null → the BIF gate grandfather-PASSED → bypassed on the
      // path that promotes toward live capital. The autonomous cron path already fail-closed. Now both do.
      setAllGatesPass();
      const input = buildPassInput();
      input.bifInput = { bif: null, kEff: 20, computationError: true };

      const result = evaluatePaperToDeployReadyGates(input);

      expect(result.passed).toBe(false);
      expect(JSON.stringify(result)).toContain("bif.computation_error_fail_closed");
    });

    it("freshscan7 MED control: bif=null WITHOUT computationError still grandfather-passes (legacy Wave-3 null)", () => {
      // The fix must NOT block a genuine pre-Wave-3 legacy null (computationError absent/false).
      setAllGatesPass();
      const input = buildPassInput();
      input.bifInput = { bif: null, kEff: 20 };

      const result = evaluatePaperToDeployReadyGates(input);

      expect(result.passed).toBe(true);
    });

    it("does not block when b14HardGateEnabled=false even if survival_twin.passed===false", () => {
      setAllGatesPass();
      const input = buildPassInput();
      input.b14HardGateEnabled = false;
      input.b14SurvivalTwin = { survival_twin: { passed: false } };

      const result = evaluatePaperToDeployReadyGates(input);

      // Gate disabled — should not block at B14 survival twin
      expect(result.failedGate).not.toBe("b14_survival_twin");
    });
  });

  // ── Gate 2: B14 CI ──────────────────────────────────────────────────────────
  describe("Gate 2 — B14 CI", () => {
    it("blocks when evaluateB14CiGate returns passed:false", () => {
      setAllGatesPass();
      mockB14Ci.mockReturnValue({
        passed: false,
        reason: "ci_high 0.35 > threshold 0.20",
        legacyFallback: false,
        auditPayload: {
          point_estimate: 0.28,
          ci_low: 0.15,
          ci_high: 0.35,
          threshold: 0.20,
          blocked: true,
          legacy_ruin_scalar_fallback: false,
          ci_method: "bca",
          n_resamples: 1000,
        },
      });

      const result = evaluatePaperToDeployReadyGates(buildPassInput());

      expect(result.passed).toBe(false);
      expect(result.failedGate).toBe("b14_ci");
      expect(result.auditAction).toBe("b14.gate_evaluated");
    });

    it("blocks fail-CLOSED when b14McDataAvailable=false (no MC run)", () => {
      setAllGatesPass();
      // evaluateB14CiGate(null, null) will be called — mock it to block
      mockB14Ci.mockReturnValue({
        passed: false,
        reason: "no_mc_run_fail_closed",
        legacyFallback: false,
        auditPayload: {
          point_estimate: null,
          ci_low: null,
          ci_high: null,
          threshold: 0.20,
          blocked: true,
          legacy_ruin_scalar_fallback: false,
          ci_method: null,
          n_resamples: null,
        },
      });

      const input = buildPassInput();
      input.b14McDataAvailable = false;

      const result = evaluatePaperToDeployReadyGates(input);

      expect(result.passed).toBe(false);
      expect(result.failedGate).toBe("b14_ci");
      expect(result.status).toBe("data_unavailable");
    });

    it("does not evaluate B14 CI when b14HardGateEnabled=false", () => {
      setAllGatesPass();
      // Make B14 CI return blocking if called
      mockB14Ci.mockReturnValue({
        passed: false,
        reason: "would block if called",
        legacyFallback: false,
        auditPayload: { point_estimate: null, ci_low: null, ci_high: 0.99, threshold: 0.20, blocked: true, legacy_ruin_scalar_fallback: false, ci_method: null, n_resamples: null },
      });

      const input = buildPassInput();
      input.b14HardGateEnabled = false;

      const result = evaluatePaperToDeployReadyGates(input);

      // B14 disabled — should proceed past both B14 gates
      expect(result.failedGate).not.toBe("b14_ci");
      expect(result.failedGate).not.toBe("b14_survival_twin");
    });
  });

  // ── Gate 3: B15 ─────────────────────────────────────────────────────────────
  describe("Gate 3 — B15 Parameter Robustness", () => {
    it("blocks when b15Battery.passed=false and b15HardGateEnabled=true", () => {
      setAllGatesPass();
      const input = buildPassInput();
      input.b15Battery = {
        passed: false,
        sdr: 0.45,
        psi: 0.60,
        rws: 0.70,
        failures: ["sdr_below_threshold"],
      };

      const result = evaluatePaperToDeployReadyGates(input);

      expect(result.passed).toBe(false);
      expect(result.failedGate).toBe("b15");
      expect(result.auditAction).toBe("lifecycle.b15_parameter_robustness_blocked");
    });

    it("does not block when b15Battery.passed=false but b15HardGateEnabled=false", () => {
      setAllGatesPass();
      const input = buildPassInput();
      input.b15HardGateEnabled = false;
      input.b15Battery = { passed: false, sdr: 0.45, failures: ["sdr_below_threshold"] };

      const result = evaluatePaperToDeployReadyGates(input);

      expect(result.failedGate).not.toBe("b15");
    });

    it("does not block when b15Battery is null (pre-B15 backtest, backward compat)", () => {
      setAllGatesPass();
      const input = buildPassInput();
      input.b15Battery = null;

      const result = evaluatePaperToDeployReadyGates(input);

      expect(result.failedGate).not.toBe("b15");
      expect(result.passed).toBe(true);
    });
  });

  // ── Gate 4: WFE ─────────────────────────────────────────────────────────────
  describe("Gate 4 — WFE hard floor", () => {
    it("blocks when evaluateWfeGate returns status='blocked'", () => {
      setAllGatesPass();
      mockWfe.mockReturnValue({
        status: "blocked",
        passed: false,
        wfeOverall: 0.55,
        hardFloor: 0.70,
        warnFloor: 0.50,
        auditAction: "lifecycle.wfe_hard_floor_block",
      });

      const result = evaluatePaperToDeployReadyGates(buildPassInput());

      expect(result.passed).toBe(false);
      expect(result.failedGate).toBe("wfe");
      expect(result.auditAction).toBe("lifecycle.wfe_hard_floor_block");
    });

    it("blocks when evaluateWfeGate returns status='degenerate_is_block'", () => {
      setAllGatesPass();
      mockWfe.mockReturnValue({
        status: "degenerate_is_block",
        passed: false,
        wfeOverall: 0.0,
        hardFloor: 0.70,
        warnFloor: 0.50,
        auditAction: "lifecycle.wfe_degenerate_is_block",
      });

      const result = evaluatePaperToDeployReadyGates(buildPassInput());

      expect(result.passed).toBe(false);
      expect(result.failedGate).toBe("wfe");
    });

    it("does not block when WFE is legacy_null (grandfather)", () => {
      setAllGatesPass();
      mockWfe.mockReturnValue({
        status: "legacy_null",
        passed: true,
        wfeOverall: null,
        hardFloor: 0.70,
        warnFloor: 0.50,
        auditAction: "lifecycle.wfe_unavailable_legacy",
      });

      const result = evaluatePaperToDeployReadyGates(buildPassInput());

      expect(result.failedGate).not.toBe("wfe");
    });
  });

  // ── Gate 5: Parameter drift ─────────────────────────────────────────────────
  describe("Gate 5 — Parameter drift", () => {
    it("blocks when evaluateParameterDriftGate returns status='blocked'", () => {
      setAllGatesPass();
      mockDrift.mockReturnValue({
        status: "blocked",
        passed: false,
        classification: "overfit_drift",
        confidence: 0.85,
        auditAction: "lifecycle.parameter_overfit_drift_block",
      });

      const result = evaluatePaperToDeployReadyGates(buildPassInput());

      expect(result.passed).toBe(false);
      expect(result.failedGate).toBe("parameter_drift");
      expect(result.auditAction).toBe("lifecycle.parameter_overfit_drift_block");
    });

    it("blocks when evaluateParameterDriftGate returns status='blocked_classifier_error'", () => {
      setAllGatesPass();
      mockDrift.mockReturnValue({
        status: "blocked_classifier_error",
        passed: false,
        classification: "classifier_error",
        confidence: null,
        auditAction: "lifecycle.parameter_drift_classifier_error_block",
      });

      const result = evaluatePaperToDeployReadyGates(buildPassInput());

      expect(result.passed).toBe(false);
      expect(result.failedGate).toBe("parameter_drift");
    });

    it("does not block on warned_overfit (low confidence)", () => {
      setAllGatesPass();
      mockDrift.mockReturnValue({
        status: "warned_overfit",
        passed: true,
        classification: "overfit_drift",
        confidence: 0.55,
        auditAction: "lifecycle.parameter_drift_overfit_low_confidence_warn",
      });

      const result = evaluatePaperToDeployReadyGates(buildPassInput());

      expect(result.failedGate).not.toBe("parameter_drift");
    });

    it("does not block on legacy_null (no drift classification)", () => {
      setAllGatesPass();
      mockDrift.mockReturnValue({
        status: "legacy_null",
        passed: true,
        classification: null,
        confidence: null,
        auditAction: "lifecycle.parameter_drift_unavailable",
      });

      const result = evaluatePaperToDeployReadyGates(buildPassInput());

      expect(result.failedGate).not.toBe("parameter_drift");
    });

    // ── C1 (2026-06-29): param_stability_status threading ────────────────────
    it("threads param_stability_status into evaluateParameterDriftGate as the 3rd arg", () => {
      setAllGatesPass();
      const input = buildPassInput();
      input.walkForwardResults = {
        ...wfrPass,
        param_stability: { drift_classification: null, drift_confidence: null },
        param_stability_status: "cpcv_not_applicable",
      };

      evaluatePaperToDeployReadyGates(input);

      // Gate must forward the top-level status so the gate can resolve cpcv_exempt.
      expect(mockDrift).toHaveBeenCalledWith(null, null, "cpcv_not_applicable");
    });

    it("does not block on cpcv_exempt (CPCV path is non-blocking, distinct audit)", () => {
      setAllGatesPass();
      mockDrift.mockReturnValue({
        status: "cpcv_exempt",
        passed: true,
        classification: null,
        confidence: null,
        auditAction: "lifecycle.parameter_drift_cpcv_exempt",
      });
      const input = buildPassInput();
      input.walkForwardResults = { ...wfrPass, param_stability_status: "cpcv_not_applicable" };

      const result = evaluatePaperToDeployReadyGates(input);

      expect(result.failedGate).not.toBe("parameter_drift");
    });

    it("passes null 3rd arg when param_stability_status is absent (legacy backtests)", () => {
      setAllGatesPass();
      evaluatePaperToDeployReadyGates(buildPassInput()); // wfrPass has no param_stability_status
      const lastCall = mockDrift.mock.calls.at(-1);
      expect(lastCall?.[2]).toBeNull();
    });
  });

  // ── Gate 6: DSR walk-forward ────────────────────────────────────────────────
  describe("Gate 6 — DSR walk-forward", () => {
    it("blocks when evaluateDsrWalkForwardGate returns passed:false", () => {
      setAllGatesPass();
      mockDsr.mockReturnValue({
        passed: false,
        status: "blocked_dsr_unavailable",
        auditAction: "lifecycle.dsr_unavailable_block",
        reason: "dsr_unavailable=true and dsr_pass=false",
        auditPayload: {
          dsr_pass: false,
          dsr_unavailable: true,
          dsr: null,
          status: "blocked_dsr_unavailable",
          blocked: true,
        },
      });

      const result = evaluatePaperToDeployReadyGates(buildPassInput());

      expect(result.passed).toBe(false);
      expect(result.failedGate).toBe("dsr_walk_forward");
      expect(result.auditAction).toBe("lifecycle.dsr_unavailable_block");
    });

    it("does not block on legacy_proceed status", () => {
      setAllGatesPass();
      mockDsr.mockReturnValue({
        passed: true,
        status: "legacy_proceed",
        auditAction: "lifecycle.dsr_unavailable_legacy",
        reason: "legacy_proceed: pre-Wave-A backtest — dsr_pass field absent",
        auditPayload: {
          dsr_pass: null,
          dsr_unavailable: false,
          dsr: null,
          status: "legacy_proceed",
          blocked: false,
        },
      });

      const result = evaluatePaperToDeployReadyGates(buildPassInput());

      expect(result.failedGate).not.toBe("dsr_walk_forward");
    });
  });

  // ── Gate 7: Wave 26 orchestrator ────────────────────────────────────────────
  describe("Gate 7 — Wave 26 Pass G orchestrator", () => {
    it("blocks when wfe_floor gate fails in orchestrator", () => {
      setAllGatesPass();
      mockOrch.mockReturnValue({
        gate_results: {
          b14_ci_high: { passed: true, value: 0.08, threshold: 0.40, reason: "ok", data_available: true },
          wfe_floor: { passed: false, value: 0.72, threshold: 0.80, reason: "wfe_floor: 0.72 < 0.80", data_available: true },
          cpcv_n_paths: { passed: true, value: 20, threshold: 15, reason: "ok", data_available: true },
          wrc_p: { passed: true, value: 0.02, threshold: 0.05, reason: "ok", data_available: true },
          spa_p: { passed: true, value: 0.01, threshold: 0.05, reason: "ok", data_available: true },
        },
        can_promote: false,
        n_gates_failed: 1,
        failing_gates: ["wfe_floor"],
      });

      const result = evaluatePaperToDeployReadyGates(buildPassInput());

      expect(result.passed).toBe(false);
      expect(result.failedGate).toBe("wave26_orchestrator");
      expect(result.auditAction).toBe("promotion.gate_failed");
      expect(result.auditPayload).toMatchObject({ failing_gates: ["wfe_floor"] });
    });

    it("blocks when spa_p gate fails in orchestrator", () => {
      setAllGatesPass();
      mockOrch.mockReturnValue({
        gate_results: {
          b14_ci_high: { passed: true, value: 0.08, threshold: 0.40, reason: "ok", data_available: true },
          wfe_floor: { passed: true, value: 0.85, threshold: 0.80, reason: "ok", data_available: true },
          cpcv_n_paths: { passed: true, value: 20, threshold: 15, reason: "ok", data_available: true },
          wrc_p: { passed: true, value: 0.02, threshold: 0.05, reason: "ok", data_available: true },
          spa_p: { passed: false, value: 0.08, threshold: 0.05, reason: "spa_p: 0.08 >= 0.05", data_available: true },
        },
        can_promote: false,
        n_gates_failed: 1,
        failing_gates: ["spa_p"],
      });

      const result = evaluatePaperToDeployReadyGates(buildPassInput());

      expect(result.passed).toBe(false);
      expect(result.failedGate).toBe("wave26_orchestrator");
      expect(result.auditPayload.failing_gates).toContain("spa_p");
    });
  });

  // ── Gate 8: Composite shadow (OBSERVABILITY ONLY) ───────────────────────────
  describe("Gate 8 — Composite shadow (observability)", () => {
    it("NEVER blocks even when shadow_decision=WOULD_BLOCK", () => {
      setAllGatesPass();
      const input = buildPassInput();
      input.compositeShadow = {
        availability: "available",
        composite_score: 0.30,
        verdict: "CRITICAL",
        shadow_decision: "WOULD_BLOCK",
        weights_version_id: "v1",
        evaluated_at: new Date(),
        staleness_age_hours: 1,
        computed_from_n_subsystems: 8,
        reason: "composite.critical",
      };

      const result = evaluatePaperToDeployReadyGates(input);

      // Shadow must NOT block — all other gates pass → overall pass
      expect(result.passed).toBe(true);
      expect(result.failedGate).toBeUndefined();
      expect(result.shadowEvaluation?.shadow_decision).toBe("WOULD_BLOCK");
      expect(result.shadowEvaluation?.agreement).toBe("disagree_shadow_blocks");
    });

    it("records shadow evaluation even when compositeShadow is null", () => {
      setAllGatesPass();
      const input = buildPassInput();
      input.compositeShadow = null;

      const result = evaluatePaperToDeployReadyGates(input);

      expect(result.passed).toBe(true);
      expect(result.shadowEvaluation?.shadow_decision).toBe("NO_OPINION");
      expect(result.shadowEvaluation?.availability).toBe("missing");
    });
  });

  // ── Gate 9: Frozen-policy drift ─────────────────────────────────────────────
  describe("Gate 9 — Frozen-policy drift", () => {
    it("blocks when frozen hash mismatches (ok=false, frozenHash non-null)", () => {
      setAllGatesPass();
      mockFrozen.mockReturnValue({
        ok: false,
        currentHash: "aaaabbbb11112222",
        frozenHash: "ccccdddd33334444",
        reason: "frozen_policy.hash_mismatch: current aaaabbbb... !== frozen ccccdddd...",
      });

      const result = evaluatePaperToDeployReadyGates(buildPassInput());

      expect(result.passed).toBe(false);
      expect(result.failedGate).toBe("frozen_policy");
      expect(result.auditAction).toBe("lifecycle.frozen_policy_drift_blocked");
    });

    it("returns needsFirstTimeFreeze=true when no frozen hash exists (first time)", () => {
      setAllGatesPass();
      mockFrozen.mockReturnValue({
        ok: true,
        currentHash: "aabbccdd11223344",
        frozenHash: null, // never frozen before
      });

      const input = buildPassInput();
      input.frozenPolicy = { id: "strategy-new", config: { stopLoss: 12 }, frozenPolicyHash: null };

      const result = evaluatePaperToDeployReadyGates(input);

      expect(result.passed).toBe(true);
      expect(result.needsFirstTimeFreeze).toBe(true);
      expect(result.reason).toBe("all_gates_passed_first_time_freeze");
    });

    it("blocks fail-CLOSED when evaluateFrozenPolicyDriftAtPromotion throws", () => {
      setAllGatesPass();
      mockFrozen.mockImplementation(() => {
        throw new Error("hash compute exception: crypto module unavailable");
      });

      const result = evaluatePaperToDeployReadyGates(buildPassInput());

      expect(result.passed).toBe(false);
      expect(result.failedGate).toBe("frozen_policy");
      expect(result.auditAction).toBe("frozen_policy.hash_compute_failed");
      expect(result.status).toBe("infra_error");
    });
  });

  // ── First-gate ordering ─────────────────────────────────────────────────────
  describe("first-gate ordering — two gates both fail", () => {
    it("returns the FIRST failing gate (b14_survival_twin before b15) in canonical order", () => {
      setAllGatesPass();

      // Both B14 survival twin AND B15 would fail
      const input = buildPassInput();
      input.b14SurvivalTwin = { survival_twin: { passed: false } };
      input.b15Battery = { passed: false, failures: ["sdr_below_threshold"] };

      const result = evaluatePaperToDeployReadyGates(input);

      // B14 survival twin is gate 1 — must be the one returned
      expect(result.failedGate).toBe("b14_survival_twin");
      expect(result.auditAction).toBe("lifecycle.b14_hard_blocked");
    });

    it("returns b14_ci before b15 in canonical order", () => {
      setAllGatesPass();
      mockB14Ci.mockReturnValue({
        passed: false,
        reason: "ci_high 0.35 > threshold 0.20",
        legacyFallback: false,
        auditPayload: { point_estimate: 0.28, ci_low: 0.15, ci_high: 0.35, threshold: 0.20, blocked: true, legacy_ruin_scalar_fallback: false, ci_method: "bca", n_resamples: 1000 },
      });

      const input = buildPassInput();
      input.b15Battery = { passed: false, failures: ["sdr_below_threshold"] };

      const result = evaluatePaperToDeployReadyGates(input);

      expect(result.failedGate).toBe("b14_ci");
    });

    it("returns wfe before parameter_drift in canonical order", () => {
      setAllGatesPass();
      mockWfe.mockReturnValue({
        status: "blocked",
        passed: false,
        wfeOverall: 0.55,
        hardFloor: 0.70,
        warnFloor: 0.50,
        auditAction: "lifecycle.wfe_hard_floor_block",
      });
      mockDrift.mockReturnValue({
        status: "blocked",
        passed: false,
        classification: "overfit_drift",
        confidence: 0.90,
        auditAction: "lifecycle.parameter_overfit_drift_block",
      });

      const result = evaluatePaperToDeployReadyGates(buildPassInput());

      expect(result.failedGate).toBe("wfe");
    });
  });

  // ── Legacy null input (all gate data absent) ─────────────────────────────────
  describe("legacy null data fixture — all data absent", () => {
    it("passes when all inputs are null/absent and gate functions return legacy_null", () => {
      // Set all inner gates to their grandfather/legacy pass responses
      mockB14Ci.mockReturnValue({
        passed: true,
        reason: "no_mc_data_legacy",
        legacyFallback: true,
        auditPayload: { point_estimate: null, ci_low: null, ci_high: null, threshold: 0.20, blocked: false, legacy_ruin_scalar_fallback: true, ci_method: null, n_resamples: null },
      });
      mockDsr.mockReturnValue({
        passed: true,
        status: "legacy_proceed",
        auditAction: "lifecycle.dsr_unavailable_legacy",
        reason: "legacy_proceed",
        auditPayload: { dsr_pass: null, dsr_unavailable: false, dsr: null, status: "legacy_proceed", blocked: false },
      });
      mockWfe.mockReturnValue({
        status: "legacy_null",
        passed: true,
        wfeOverall: null,
        hardFloor: 0.70,
        warnFloor: 0.50,
        auditAction: "lifecycle.wfe_unavailable_legacy",
      });
      mockDrift.mockReturnValue({
        status: "legacy_null",
        passed: true,
        classification: null,
        confidence: null,
        auditAction: "lifecycle.parameter_drift_unavailable",
      });
      mockOrch.mockReturnValue({
        gate_results: {
          b14_ci_high: { passed: true, value: null, threshold: 0.40, reason: "no_data_fail_open", data_available: false },
          wfe_floor: { passed: true, value: null, threshold: 0.80, reason: "no_data_fail_open", data_available: false },
          cpcv_n_paths: { passed: true, value: null, threshold: 15, reason: "no_data_fail_open", data_available: false },
          wrc_p: { passed: true, value: null, threshold: 0.05, reason: "no_data_fail_open", data_available: false },
          spa_p: { passed: true, value: null, threshold: 0.05, reason: "no_data_fail_open", data_available: false },
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

      const legacyInput: PaperToDeployReadyGateInput = {
        strategyId: "strategy-legacy",
        b14HardGateEnabled: true,
        b15HardGateEnabled: true,
        b14SurvivalTwin: null,
        mcRuinCi: null,
        b14McDataAvailable: true,
        b15Battery: null,
        walkForwardResults: null,
        orchGates: null,
        compositeShadow: null,
        frozenPolicy: frozenPolicyPass,
      };

      const result = evaluatePaperToDeployReadyGates(legacyInput);

      expect(result.passed).toBe(true);
      expect(result.failedGate).toBeUndefined();
    });
  });

  // ── Gate 1 honest 3-state — on-demand survival twin replay ──────────────────
  describe("Gate 1 — on-demand survival twin replay (honest 3-state)", () => {
    it("(a) PRESENT + passed===false → BLOCK; survivalTwin.status=survival_twin_blocked", () => {
      setAllGatesPass();
      const input = buildPassInput();
      input.b14SurvivalTwin = { survival_twin: { passed: false } };

      const result = evaluatePaperToDeployReadyGates(input);

      expect(result.passed).toBe(false);
      expect(result.failedGate).toBe("b14_survival_twin");
      expect(result.auditAction).toBe("lifecycle.b14_hard_blocked");
      expect(result.survivalTwin?.status).toBe("survival_twin_blocked");
      expect(result.survivalTwin?.evaluatedVia).toBe("present_gate_result");
    });

    it("(b) ABSENT + on-demand replay BLOCKED → BLOCK on b14_survival_twin", () => {
      setAllGatesPass();
      const input = buildPassInput();
      input.b14SurvivalTwin = {
        survival_twin: null,
        onDemandReplay: {
          status: "blocked",
          reason: "survival_twin_replay_grade_fail",
          perFirm: [{ firm: "Topstep", grade: "F", survival_score: 22, status: "completed" }],
        },
      };

      const result = evaluatePaperToDeployReadyGates(input);

      expect(result.passed).toBe(false);
      expect(result.failedGate).toBe("b14_survival_twin");
      expect(result.auditAction).toBe("lifecycle.b14_survival_twin_replay_blocked");
      expect(result.survivalTwin?.status).toBe("survival_twin_blocked");
      expect(result.survivalTwin?.evaluatedVia).toBe("on_demand_replay");
      expect(result.survivalTwin?.perFirm?.[0]?.grade).toBe("F");
    });

    it("(c) ABSENT + on-demand replay PASSED → PASS; survivalTwin.status=survival_twin_passed", () => {
      setAllGatesPass();
      const input = buildPassInput();
      input.b14SurvivalTwin = {
        survival_twin: null,
        onDemandReplay: {
          status: "passed",
          reason: "survival_twin_replay_grade_pass",
          perFirm: [{ firm: "Topstep", grade: "B", survival_score: 71, status: "completed" }],
        },
      };

      const result = evaluatePaperToDeployReadyGates(input);

      expect(result.passed).toBe(true);
      expect(result.failedGate).toBeUndefined();
      expect(result.survivalTwin?.status).toBe("survival_twin_passed");
      expect(result.survivalTwin?.evaluatedVia).toBe("on_demand_replay");
    });

    it("(d) ABSENT + on-demand replay NOT-EVALUATED → allow through + advisory_not_evaluated", () => {
      setAllGatesPass();
      const input = buildPassInput();
      input.b14SurvivalTwin = {
        survival_twin: null,
        onDemandReplay: {
          status: "advisory_not_evaluated",
          reason: "on_demand_replay_error",
          error: "timed out",
          perFirm: null,
        },
      };

      const result = evaluatePaperToDeployReadyGates(input);

      // allow-through — the B14 ci_high ruin gate remains the hard guard
      expect(result.passed).toBe(true);
      expect(result.failedGate).toBeUndefined();
      expect(result.survivalTwin?.status).toBe("survival_twin_advisory_not_evaluated");
      expect(result.survivalTwin?.replayError).toBe("timed out");
    });

    it("ABSENT + no on-demand replay provided → advisory_not_evaluated, allow through (honest legacy)", () => {
      setAllGatesPass();
      const input = buildPassInput();
      input.b14SurvivalTwin = null;

      const result = evaluatePaperToDeployReadyGates(input);

      expect(result.passed).toBe(true);
      expect(result.survivalTwin?.status).toBe("survival_twin_advisory_not_evaluated");
      expect(result.survivalTwin?.evaluatedVia).toBe("not_evaluated");
    });
  });
});

// ── resolveSurvivalTwinOnDemand (mock runPythonModule) ────────────────────────
describe("resolveSurvivalTwinOnDemand", () => {
  beforeEach(() => {
    mockRunPython.mockReset();
  });

  it("maps replay verdict 'blocked' → status blocked (real protection)", async () => {
    mockRunPython.mockResolvedValue({
      verdict: "blocked",
      reason: "survival_twin_replay_grade_fail",
      per_firm: [{ firm: "MFFU", grade: "F", survival_score: 18, status: "completed" }],
    });

    const r = await resolveSurvivalTwinOnDemand({ strategyId: "s1", backtestId: "bt1" });

    expect(r.status).toBe("blocked");
    expect(r.perFirm?.[0]?.grade).toBe("F");
    expect(r.perFirm?.[0]?.survival_score).toBe(18);
  });

  it("maps replay verdict 'passed' → status passed", async () => {
    mockRunPython.mockResolvedValue({
      verdict: "passed",
      reason: "survival_twin_replay_grade_pass",
      per_firm: [{ firm: "Topstep", grade: "A", survival_score: 88, status: "completed" }],
    });

    const r = await resolveSurvivalTwinOnDemand({ strategyId: "s1", backtestId: "bt1" });

    expect(r.status).toBe("passed");
  });

  it("maps replay verdict 'advisory_not_evaluated' → status advisory_not_evaluated", async () => {
    mockRunPython.mockResolvedValue({
      verdict: "advisory_not_evaluated",
      reason: "no_completed_firm_replay",
      per_firm: [],
    });

    const r = await resolveSurvivalTwinOnDemand({ strategyId: "s1", backtestId: "bt1" });

    expect(r.status).toBe("advisory_not_evaluated");
    expect(r.reason).toBe("no_completed_firm_replay");
  });

  it("FAIL-SOFT: runPythonModule throws → advisory_not_evaluated (NEVER blocked — cannot fail-OPEN)", async () => {
    mockRunPython.mockRejectedValue(
      new Error("b14-survival-twin-on-demand-replay timed out after 60000ms"),
    );

    const r = await resolveSurvivalTwinOnDemand({ strategyId: "s1", backtestId: "bt1" });

    expect(r.status).toBe("advisory_not_evaluated");
    expect(r.reason).toBe("on_demand_replay_error");
    expect(r.error).toContain("timed out");
    expect(mockRunPython).toHaveBeenCalledTimes(1);
  });

  it("unrecognized verdict → advisory_not_evaluated (never silently blocks/passes)", async () => {
    mockRunPython.mockResolvedValue({ verdict: "weird_unknown", reason: "x", per_firm: [] });

    const r = await resolveSurvivalTwinOnDemand({ strategyId: "s1", backtestId: "bt1" });

    expect(r.status).toBe("advisory_not_evaluated");
  });

  it("no backtestId → advisory_not_evaluated without invoking python", async () => {
    const r = await resolveSurvivalTwinOnDemand({ strategyId: "s1", backtestId: null });

    expect(r.status).toBe("advisory_not_evaluated");
    expect(r.reason).toBe("no_completed_backtest_for_on_demand_replay");
    expect(mockRunPython).not.toHaveBeenCalled();
  });
});
