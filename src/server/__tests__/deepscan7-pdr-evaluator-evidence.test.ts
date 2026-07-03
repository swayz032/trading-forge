/**
 * deepscan7-pdr-evaluator-evidence.test.ts — Track B / B3 (F-3), 2026-07-02
 *
 * Evidence-completeness surface of evaluatePaperToDeployReadyGates (real module,
 * real sub-gates): the evaluator now mirrors the cron's Track A.2
 * gateEvidenceStatuses pushes and returns incompleteGateCount +
 * gateEvidenceStatuses on PASS results, so the manual PATCH path can enforce the
 * same >=3-incomplete governor the cron enforces.
 *
 * The incomplete predicate is EXACTLY the cron's: status contains "legacy" OR
 * equals "data_unavailable".
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// frozen-policy-contract.ts (imported by the evaluator for the pure drift check)
// opens a DB handle at module scope — stub it; no test here touches the DB.
vi.mock("../db/index.js", () => ({ db: {} }));

import { evaluatePaperToDeployReadyGates } from "../lib/paper-to-deploy-ready-gates.js";
import type { PaperToDeployReadyGateInput } from "../lib/paper-to-deploy-ready-gates.js";
import { computeFrozenPolicyHash } from "../lib/frozen-policy-contract.js";

const STRAT_ID = "dddd0002-0000-0000-0000-000000000002";

/**
 * Legacy-heavy input: every fail-OPEN gate rides its grandfather path.
 *   Gate 1 survival twin  → absent, no on-demand      → legacy_unavailable
 *   Gate 2 B14 CI         → scalar-only MC (pre-Pass-A) → legacy_null
 *   Gate 5 param drift    → no classification          → legacy_null
 *   Gate 6 DSR            → no wf_metadata             → legacy_proceed
 *   Gate 6.5 BIF          → null bif (pre-Wave-3)      → legacy_null
 *   Gate 7 orchestrator   → no data (grandfather env)  → legacy_proceed
 *   Gate 8 shadow         → observability-only         → complete
 *   Gate 9 frozen policy  → per-scenario
 */
function legacyHeavyInput(overrides: Partial<PaperToDeployReadyGateInput> = {}): PaperToDeployReadyGateInput {
  return {
    strategyId: STRAT_ID,
    b14SurvivalTwin: { survival_twin: null, onDemandReplay: null },
    b14McDataAvailable: true,
    mcRuinCi: { probability_of_ruin_ci: null, probability_of_ruin: 0.02 },
    b15Battery: null,
    walkForwardResults: null,
    orchGates: null,
    bifInput: null,
    compositeShadow: null,
    frozenPolicy: { id: STRAT_ID, config: {}, frozenPolicyHash: null },
    ...overrides,
  } as PaperToDeployReadyGateInput;
}

describe("B3 (F-3) — evaluator surfaces incompleteGateCount on PASS results", () => {
  beforeEach(() => {
    // Orchestrator (WFE-0.80 / CPCV / WRC / SPA) fails CLOSED on missing data unless
    // the documented grandfather flag is on — the legacy-heavy scenario needs it to
    // reach the pass return, exactly like a pre-Pass-E strategy in production.
    process.env.PROMOTION_GRANDFATHER_PRE_PASS_E = "true";
  });
  afterEach(() => {
    delete process.env.PROMOTION_GRANDFATHER_PRE_PASS_E;
  });

  it("legacy-heavy pass (first-time freeze) reports incompleteGateCount >= 3", () => {
    const result = evaluatePaperToDeployReadyGates(legacyHeavyInput());

    expect(result.passed).toBe(true);
    expect(result.needsFirstTimeFreeze).toBe(true);
    expect(result.gateEvidenceStatuses).toBeDefined();
    expect(result.incompleteGateCount).toBeDefined();
    // 7 incomplete statuses expected: twin legacy_unavailable, CI legacy_null,
    // drift legacy_null, DSR legacy_proceed, BIF legacy_null, orch legacy_proceed,
    // frozen-policy legacy_proceed (null hash). Shadow is "complete".
    expect(result.incompleteGateCount!).toBeGreaterThanOrEqual(3);
    // Predicate parity with the cron: recompute and compare.
    const recount = result.gateEvidenceStatuses!.filter(
      (st) => st.includes("legacy") || st === "data_unavailable",
    ).length;
    expect(result.incompleteGateCount).toBe(recount);
  });

  it("existing frozen hash pass (no first-time freeze) still carries the evidence surface", () => {
    const config = { entry_quality: { confluence_factors: ["structural_setup"] } };
    const hash = computeFrozenPolicyHash({ config });
    const result = evaluatePaperToDeployReadyGates(
      legacyHeavyInput({ frozenPolicy: { id: STRAT_ID, config, frozenPolicyHash: hash } }),
    );

    expect(result.passed).toBe(true);
    expect(result.needsFirstTimeFreeze).toBeUndefined();
    expect(result.reason).toBe("all_gates_passed");
    expect(result.incompleteGateCount).toBeGreaterThanOrEqual(3);
    // Frozen-policy gate reports complete when the hash exists.
    expect(result.gateEvidenceStatuses![result.gateEvidenceStatuses!.length - 1]).toBe("complete");
  });

  it("complete-evidence gates reduce the incomplete count (CI with real _ci dict is complete)", () => {
    const legacy = evaluatePaperToDeployReadyGates(legacyHeavyInput());
    const withCi = evaluatePaperToDeployReadyGates(
      legacyHeavyInput({
        mcRuinCi: {
          probability_of_ruin_ci: { point_estimate: 0.02, ci_low: 0.01, ci_high: 0.05, ci_method: "bca", n_resamples: 1000 },
          probability_of_ruin: 0.02,
        },
      }),
    );
    expect(withCi.passed).toBe(true);
    expect(withCi.incompleteGateCount!).toBe(legacy.incompleteGateCount! - 1);
    expect(withCi.gateEvidenceStatuses).toContain("complete");
  });

  it("blocked results do not need the surface (governor unreachable) — passed=false path unchanged", () => {
    // ci_high 0.9 >> threshold 0.20 → B14 CI hard block before any governor could run.
    const blocked = evaluatePaperToDeployReadyGates(
      legacyHeavyInput({
        mcRuinCi: {
          probability_of_ruin_ci: { point_estimate: 0.8, ci_low: 0.6, ci_high: 0.9, ci_method: "bca", n_resamples: 1000 },
          probability_of_ruin: 0.8,
        },
      }),
    );
    expect(blocked.passed).toBe(false);
    expect(blocked.failedGate).toBe("b14_ci");
  });
});
