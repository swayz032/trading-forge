/**
 * finding2-bif-cpcv-advisory.test.ts — FINDING-2 regression
 *
 * Verifies the CPCV proxy-basis advisory path in evaluatePaperToDeployReadyGates():
 *
 *   BEFORE FIX:
 *     evaluateBifGate() was called with bif ≈ 1.0 even in CPCV mode.
 *     In CPCV, the IS Sharpe proxy IS the OOS mean (same data series), so
 *     BIF = IS_proxy / OOS_agg = OOS_mean / OOS_mean ≈ 1.0 structurally.
 *     A BIF of 1.0 returns bif.clean (PASS) — but this is MISLEADING: the gate
 *     cannot detect overfitting from a circular IS proxy. FINDING-2 documents
 *     that every CPCV run silently passed the BIF gate with a meaningless value.
 *
 *   AFTER FIX:
 *     walk_forward.py emits bif_proxy_basis="oos_mean_not_is" in the result dict
 *     when in CPCV mode. paper-to-deploy-ready-gates.ts checks this field from
 *     wf_metadata before calling evaluateBifGate():
 *
 *       bif_proxy_basis === "oos_mean_not_is"  → advisory-only (skip evaluateBifGate)
 *       bif_proxy_basis !== "oos_mean_not_is"  → evaluateBifGate() called normally
 *
 *     The advisory path is NON-BLOCKING: the gate passes and the audit payload
 *     carries bif_unavailable_cpcv reason. Wave 30 carry-forward introduces true
 *     per-path IS fold Sharpe so BIF is meaningful in CPCV.
 *
 * Scope: paper-to-deploy-ready-gates.ts, BIF gate section (Gate 6.5)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────
// All gate evaluators that paper-to-deploy-ready-gates imports internally.

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

// FINDING-2: spy on evaluateBifGate to verify it is/isn't called
vi.mock("../bif-gate.js", () => ({
  evaluateBifGate: vi.fn(),
}));

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../python-runner.js", () => ({
  runPythonModule: vi.fn(),
}));

import {
  evaluatePaperToDeployReadyGates,
  type PaperToDeployReadyGateInput,
} from "../paper-to-deploy-ready-gates.js";
import { evaluateB14CiGate, evaluateDsrWalkForwardGate } from "../b14-ci-gate.js";
import { evaluateWfeGate } from "../wfe-gate.js";
import { evaluateParameterDriftGate } from "../parameter-drift-gate.js";
import { evaluatePromotionGates } from "../promotion-gate-orchestrator.js";
import { evaluateFrozenPolicyDriftAtPromotion } from "../frozen-policy-contract.js";
import { evaluateBifGate } from "../bif-gate.js";

// ── Typed mocks ───────────────────────────────────────────────────────────────

const mockB14Ci = vi.mocked(evaluateB14CiGate);
const mockDsr = vi.mocked(evaluateDsrWalkForwardGate);
const mockWfe = vi.mocked(evaluateWfeGate);
const mockDrift = vi.mocked(evaluateParameterDriftGate);
const mockOrch = vi.mocked(evaluatePromotionGates);
const mockFrozen = vi.mocked(evaluateFrozenPolicyDriftAtPromotion);
const mockBifGate = vi.mocked(evaluateBifGate);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Set all upstream gates to their PASS configuration. */
function setAllUpstreamGatesPass() {
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
  mockWfe.mockReturnValue({
    status: "passed",
    passed: true,
    wfeOverall: 0.85,
    hardFloor: 0.70,
    warnFloor: 0.50,
    auditAction: null,
  });
  mockDrift.mockReturnValue({
    status: "passed",
    passed: true,
    classification: "stable",
    confidence: 0.95,
    auditAction: null,
  });
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
  mockFrozen.mockReturnValue({
    ok: true,
    currentHash: "aabbccdd11223344",
    frozenHash: "aabbccdd11223344",
  });
}

/** BIF gate mock that returns PASS (bif.clean). */
function setBifGatePass() {
  mockBifGate.mockReturnValue({
    passed: true,
    reason: "bif.clean",
    legacyNull: false,
    auditPayload: {
      bif: 1.0,
      k_eff: 15,
      block_threshold: 4.0,
      warn_threshold: 2.0,
      blocked: false,
      legacy_null: false,
      reason: "bif.clean",
      proxy_basis_warn: null,
    },
  });
}

/** BIF gate mock that BLOCKS (bif > threshold). */
function setBifGateBlock() {
  mockBifGate.mockReturnValue({
    passed: false,
    reason: "bif.blocked",
    legacyNull: false,
    auditPayload: {
      bif: 5.2,
      k_eff: 10,
      block_threshold: 4.0,
      warn_threshold: 2.0,
      blocked: true,
      legacy_null: false,
      reason: "bif.blocked_exceeds_threshold",
      proxy_basis_warn: null,
    },
  });
}

/** Build a minimal passing input with optional bif_proxy_basis in wf_metadata. */
function buildPassInput(options?: {
  bifProxyBasis?: string | null;
  bif?: number | null;
  kEff?: number | null;
}): PaperToDeployReadyGateInput {
  return {
    strategyId: "strategy-finding2",
    correlationId: "corr-f2-001",
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
    walkForwardResults: {
      wfe_overall: 0.85,
      wfe_status: null,
      param_stability: { drift_classification: "stable", drift_confidence: 0.95 },
      // bif_proxy_basis is injected as a JSONB extra field (cast for test purposes)
      wf_metadata: {
        dsr_pass: true,
        dsr_unavailable: false,
        dsr: 0.92,
        ...(options?.bifProxyBasis !== undefined
          ? { bif_proxy_basis: options.bifProxyBasis }
          : {}),
      } as Parameters<typeof evaluateDsrWalkForwardGate>[0],
      wf_metadata_mode: "cpcv",
      wf_metadata_n_paths: 20,
    },
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
    frozenPolicy: {
      id: "strategy-finding2",
      config: { stopLoss: 12, takeProfit: 18 },
      frozenPolicyHash: "aabbccdd11223344",
    },
    // BIF input
    bifInput: {
      bif: options?.bif ?? 1.02,
      kEff: options?.kEff ?? 15,
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  setAllUpstreamGatesPass();
});

describe("evaluatePaperToDeployReadyGates — FINDING-2: CPCV BIF proxy-basis advisory", () => {
  // ── Core FINDING-2 behavior ─────────────────────────────────────────────────

  it("does NOT call evaluateBifGate when bif_proxy_basis='oos_mean_not_is'", () => {
    // FINDING-2 core: CPCV mode emits this basis tag; gate must skip evaluation.
    // Before fix: evaluateBifGate was called with bif≈1.0 and returned bif.clean.
    // After fix: advisory-only path fires, evaluateBifGate is not called at all.
    setBifGatePass();

    const result = evaluatePaperToDeployReadyGates(
      buildPassInput({ bifProxyBasis: "oos_mean_not_is", bif: 1.02 }),
    );

    expect(mockBifGate).not.toHaveBeenCalled();
    // Gate still passes (advisory-only — non-blocking)
    expect(result.passed).toBe(true);
  });

  it("passes (non-blocking) when bif_proxy_basis='oos_mean_not_is', even with high BIF", () => {
    // A structurally-circular BIF of 1.0 (or any value) must NOT block in CPCV mode.
    // The gate skips evaluation entirely; the high BIF value is meaningless.
    setBifGatePass();

    const result = evaluatePaperToDeployReadyGates(
      buildPassInput({ bifProxyBasis: "oos_mean_not_is", bif: 6.0 }), // would block normally
    );

    expect(mockBifGate).not.toHaveBeenCalled();
    expect(result.passed).toBe(true);
    expect(result.failedGate).not.toBe("bif");
  });

  // ── Non-CPCV path: evaluateBifGate IS called ────────────────────────────────

  it("DOES call evaluateBifGate when bif_proxy_basis is null (non-CPCV path)", () => {
    // Plain walk-forward (not CPCV) or pre-Finding-2 run: no proxy basis tag.
    // BIF is meaningful; gate must evaluate normally.
    setBifGatePass();

    evaluatePaperToDeployReadyGates(buildPassInput({ bifProxyBasis: null }));

    expect(mockBifGate).toHaveBeenCalledOnce();
  });

  it("DOES call evaluateBifGate when bif_proxy_basis is absent from wf_metadata", () => {
    setBifGatePass();

    // No bifProxyBasis option → field not injected into wf_metadata
    evaluatePaperToDeployReadyGates(buildPassInput());

    expect(mockBifGate).toHaveBeenCalledOnce();
  });

  it("DOES call evaluateBifGate when bif_proxy_basis is a different string", () => {
    // Only "oos_mean_not_is" triggers the advisory path; any other string uses normal path.
    setBifGatePass();

    evaluatePaperToDeployReadyGates(buildPassInput({ bifProxyBasis: "is_daily_pnl" }));

    expect(mockBifGate).toHaveBeenCalledOnce();
  });

  // ── Non-CPCV BIF block still works ─────────────────────────────────────────

  it("BLOCKs when BIF > threshold on non-CPCV path (gate still evaluates)", () => {
    // Without the proxy basis, a genuinely high BIF (5.2 > 4.0 threshold) must block.
    setBifGateBlock();

    const result = evaluatePaperToDeployReadyGates(
      buildPassInput({ bifProxyBasis: null, bif: 5.2 }),
    );

    expect(mockBifGate).toHaveBeenCalledOnce();
    expect(result.passed).toBe(false);
    expect(result.failedGate).toBe("bif");
    expect(result.reason).toBe("bif.blocked");
  });
});
