/**
 * paper-to-deploy-ready-gates.ts — Pass 5 Track A (paper-parity)
 *
 * Pure-function PAPER → DEPLOY_READY 8-gate evaluator.
 *
 * Extracted from the cron-sweep gate stack in lifecycle-service.ts
 * (lines ~2807–3688) so the same decision logic can be called from BOTH:
 *   1. checkAutoPromotions cron sweep (existing)
 *   2. _promoteStrategyInner (PATCH /:id/lifecycle bypass fix — Track C wires this)
 *
 * DESIGN CONTRACT (mirrors b14-ci-gate.ts / wfe-gate.ts / parameter-drift-gate.ts):
 *   - No DB calls. No Date.now(). No I/O. No side effects.
 *   - Caller fetches all data, passes it in; evaluator returns a verdict.
 *   - Caller writes audit row, emits SSE, increments Prom counter.
 *   - Fail-OPEN / fail-CLOSED behaviour per gate is PRESERVED from cron-sweep source.
 *
 * Gate order (canonical — must match cron-sweep order):
 *   1. B14 survival twin       (fail-CLOSED on infra error — mirrors lifecycle-service.ts:2957)
 *   2. B14 ci_high             (fail-CLOSED when no MC run — F-1 hardening 2026-06-22)
 *   3. B15 parameter robustness(fail-OPEN  on read error — lifecycle-service.ts:3046)
 *   4. WFE hard floor          (fail-OPEN  on read error — lifecycle-service.ts:3137)
 *   5. Parameter drift         (fail-OPEN  on read error — lifecycle-service.ts:3220)
 *   6. DSR walk-forward        (fail-OPEN  on read error — lifecycle-service.ts:3288)
 *   7. Wave 26 Pass G orchestrator (fail-OPEN on read error — lifecycle-service.ts:3447)
 *   8. Composite shadow        (OBSERVABILITY ONLY — fail-OPEN always)
 *   9. Frozen-policy drift     (fail-CLOSED on hash error — lifecycle-service.ts:3669)
 *
 * NOTE: The composite-shadow gate (step 8) is observability-only and never blocks.
 * It is included so that _promoteStrategyInner can log the same shadow evaluation
 * the cron sweep logs.  Its `passed` field is always true in the returned result.
 *
 * The caller is responsible for:
 *   - Checking the pre-conditions (tradingDays >= 30, rollingSharpe >= 1.5)
 *   - Writing the audit row from `result.auditAction` + `result.auditPayload`
 *   - Broadcasting the SSE event
 *   - Incrementing the Prometheus counter
 *   - Calling freezePolicyForStrategy() when result.needsFirstTimeFreeze === true
 *
 * Import logger from ./logger.js (not ../index.js) per project convention.
 */

import { logger } from "./logger.js";
import {
  evaluateB14CiGate,
  evaluateDsrWalkForwardGate,
  type RuinCiDict,
  type WalkForwardDsrInput,
} from "./b14-ci-gate.js";
import { evaluateWfeGate } from "./wfe-gate.js";
import { evaluateParameterDriftGate } from "./parameter-drift-gate.js";
import { evaluatePromotionGates, type StrategyPromotionData } from "./promotion-gate-orchestrator.js";
// H1 fix 2026-06-28: import BIF gate so both manual and cron paths enforce it.
import { evaluateBifGate } from "./bif-gate.js";
import {
  evaluateFrozenPolicyDriftAtPromotion,
  type FrozenPolicyDriftResult,
} from "./frozen-policy-contract.js";
import {
  deriveShadowDecision,
  type ShadowResult,
} from "./composite-shadow-gate.js";

// ─── B15 battery input shape ──────────────────────────────────────────────────

export interface B15BatteryInput {
  passed?: boolean | null;
  sdr?: number | null;
  psi?: number | null;
  rws?: number | null;
  failures?: string[];
  thresholds?: unknown;
}

// ─── Walk-forward metadata bundle ────────────────────────────────────────────

export interface WalkForwardResultsInput {
  /** wfe_overall: OOS/IS Sharpe ratio aggregate (Pass B.1) */
  wfe_overall?: number | null;
  /** wfe_status: "degenerate_is" when IS windows produced non-positive Sharpe (G2a) */
  wfe_status?: string | null;
  /** param_stability.drift_classification (Pass B.1 regime-context) */
  param_stability?: {
    drift_classification?: string | null;
    drift_confidence?: number | null;
  } | null;
  /**
   * param_stability_status: top-level walk_forward output key (C1 consumer side, 2026-06-29).
   * "cpcv_not_applicable" on the CPCV path → parameter-drift-gate returns the DISTINCT
   * cpcv_exempt result instead of legacy_null. Absent/"computed" → normal drift logic.
   */
  param_stability_status?: string | null;
  /** wf_metadata: DSR gate inputs (FIX 7 / Wave A, 2026-06-22) */
  wf_metadata?: WalkForwardDsrInput | null;
  /** wf_metadata.mode and n_paths for CPCV orchestrator gate */
  wf_metadata_mode?: string | null;
  wf_metadata_n_paths?: number | null;
}

// ─── Monte Carlo ruin CI shape ────────────────────────────────────────────────

export interface McRuinCiInput {
  /** Full probability_of_ruin_ci dict from MC risk_metrics */
  probability_of_ruin_ci?: RuinCiDict & {
    ruin_unavailable?: boolean;
    per_firm?: Record<string, { consistency_fail_rate?: number }>;
  } | null;
  /** Scalar probability_of_ruin (pre-Pass-A fallback) */
  probability_of_ruin?: number | null;
}

// ─── Strategy identity for frozen-policy ─────────────────────────────────────

export interface FrozenPolicyInput {
  id: string;
  config?: unknown;
  frozenPolicyHash?: string | null;
}

// ─── Composite shadow input ───────────────────────────────────────────────────

/**
 * Pre-fetched shadow result (from evaluateCompositeShadow DB call).
 * Caller fetches this; pure function just reads it.
 * Pass null/undefined when composite-shadow data is unavailable.
 */
export interface CompositeShadowInput {
  availability: ShadowResult["availability"];
  composite_score: number | null;
  verdict: ShadowResult["verdict"];
  weights_version_id: string | null;
  evaluated_at: Date | null;
  staleness_age_hours: number | null;
  computed_from_n_subsystems: number | null;
  shadow_decision: ShadowResult["shadow_decision"];
  reason: string;
}

// ─── B14 survival twin input ──────────────────────────────────────────────────

/** Per-firm survival evidence row returned by the on-demand replay harness. */
export interface SurvivalTwinPerFirm {
  firm: string;
  grade: string | null;
  survival_score: number | null;
  status: string;
}

/**
 * Verdict from the on-demand survival-twin replay (resolveSurvivalTwinOnDemand).
 *
 * IMPORTANT contract: this resolver is FAIL-SOFT and is the defense-in-depth twin
 * to the B14 ci_high ruin gate (which remains the HARD ruin guard). It returns:
 *   - "blocked"               ONLY when a completed replay graded a firm as failing
 *   - "passed"                when a completed replay graded all firms surviving
 *   - "advisory_not_evaluated" when the replay could not run / errored / timed out
 *                             / produced no completed firm (NEVER a silent pass, NEVER
 *                             a hard freeze — honest "un-evaluated" so it is visible)
 * It NEVER returns "blocked" on an error path, so it cannot fail-OPEN into a false block.
 */
export interface OnDemandSurvivalReplayResult {
  status: "passed" | "blocked" | "advisory_not_evaluated";
  reason: string;
  perFirm?: SurvivalTwinPerFirm[] | null;
  /** Populated only on the error / not-evaluated path. */
  error?: string | null;
}

/** Honest survival-twin gate status surfaced on the gate result for audit. */
export type SurvivalTwinGateStatus =
  | "survival_twin_passed"
  | "survival_twin_blocked"
  | "survival_twin_advisory_not_evaluated";

/** Survival-twin verdict attached to the gate result so the caller can audit it honestly. */
export interface SurvivalTwinVerdict {
  status: SurvivalTwinGateStatus;
  evaluatedVia: "present_gate_result" | "on_demand_replay" | "not_evaluated";
  auditReason: string;
  perFirm?: SurvivalTwinPerFirm[] | null;
  replayError?: string | null;
}

export interface B14SurvivalTwinInput {
  /** gateResult.survival_twin from latest completed backtest */
  survival_twin?: { passed?: boolean; [key: string]: unknown } | null;
  /** True when B14 gate infra threw (caller's try/catch produced an error) */
  infraError?: boolean;
  /**
   * On-demand replay verdict resolved by the caller via resolveSurvivalTwinOnDemand()
   * when survival_twin data was ABSENT (the normal case — survival_twin is only ever
   * written by the manual replay tool). When present, Gate 1 evaluates it honestly
   * instead of silently auto-passing. Caller is responsible for the (async) replay
   * invocation; the pure evaluator stays sync + side-effect-free.
   */
  onDemandReplay?: OnDemandSurvivalReplayResult | null;
}

// ─── Orchestrator WRC/SPA inputs ─────────────────────────────────────────────

export interface OrchGatesInput {
  /** backtests.wrc_result.p_value */
  wrcPValue?: number | null;
  /** backtests.spa_result.spa_consistent_p */
  spaConsistentP?: number | null;
}

// ─── Top-level input ──────────────────────────────────────────────────────────

/**
 * All data required to evaluate the 8 PAPER → DEPLOY_READY gates.
 *
 * Caller pre-fetches from DB and passes in. No DB access inside the evaluator.
 *
 * IMPORTANT for callers: b14HardGateEnabled and b15HardGateEnabled default to
 * the same env-var semantics as the cron sweep (default: both enabled=true).
 * Pass false to simulate the disabled path.
 */
export interface PaperToDeployReadyGateInput {
  /** Strategy ID (for logging only — no DB calls) */
  strategyId: string;

  /** Optional correlation ID for audit row linking */
  correlationId?: string | null;

  // ── Gate toggles (mirror cron-sweep env reads) ──────────────────────────
  /** B14_HARD_GATE_ENABLED env (default true). Set false for emergency disable. */
  b14HardGateEnabled?: boolean;
  /** B15_BATTERY_ENABLED env (default true). */
  b15HardGateEnabled?: boolean;

  // ── Gate inputs ──────────────────────────────────────────────────────────

  /** B14 Survival Twin gate — survival_twin.passed from gateResult */
  b14SurvivalTwin?: B14SurvivalTwinInput | null;

  /** B14 CI gate — probability_of_ruin_ci + scalar from latest MC run */
  mcRuinCi?: McRuinCiInput | null;
  /**
   * True when the B14 CI data was available (i.e. a completed MC run existed
   * for the strategy's latest backtest). When false, the CI gate falls through
   * to evaluateB14CiGate(null, null) which blocks fail-CLOSED per F-1.
   */
  b14McDataAvailable?: boolean;

  /** B15 Parameter Robustness Battery output */
  b15Battery?: B15BatteryInput | null;

  /** Walk-forward results bundle (WFE + parameter drift + DSR + orchestrator CPCV) */
  walkForwardResults?: WalkForwardResultsInput | null;

  /** WRC and SPA gate inputs for orchestrator */
  orchGates?: OrchGatesInput | null;

  /**
   * H1 fix 2026-06-28 — BIF gate inputs (bif and k_eff from latest completed backtest).
   * Both stamped on backtests table by backtest-service.ts at completion.
   * Pass null / omit for pre-Wave-3 backtests (gate grandfather-passes on missing data).
   */
  bifInput?: { bif?: number | null; kEff?: number | null } | null;

  /**
   * Pre-fetched composite-shadow result (observability only — never blocks).
   * Pass null to skip the shadow evaluation (gate is logged as NO_OPINION).
   */
  compositeShadow?: CompositeShadowInput | null;

  /** Strategy fields needed for frozen-policy gate */
  frozenPolicy: FrozenPolicyInput;
}

// ─── Gate names ───────────────────────────────────────────────────────────────

export type PaperToDeployReadyFailedGate =
  | "b14_survival_twin"
  | "b14_ci"
  | "b15"
  | "wfe"
  | "parameter_drift"
  | "dsr_walk_forward"
  | "bif"
  | "wave26_orchestrator"
  | "frozen_policy";
// NOTE: composite_shadow is intentionally absent — it never blocks.

// ─── Result ───────────────────────────────────────────────────────────────────

export type PaperToDeployReadyGateStatus =
  | "pass"
  | "blocked"
  | "data_unavailable"    // gate blocked due to missing data (fail-CLOSED gates)
  | "legacy_null"         // gate data absent (grandfather window — fail-OPEN gates)
  | "infra_error";        // gate infrastructure error (fail-CLOSED: B14 outer catch)

export interface PaperToDeployReadyGateResult {
  /** True when ALL gates allow promotion; false when any gate blocked. */
  passed: boolean;
  /** Summary status of the aggregate decision. */
  status: PaperToDeployReadyGateStatus;
  /** Canonical audit action name for the blocking gate (null when passed). */
  auditAction: string | null;
  /** Audit payload to merge into the audit_log result JSONB. */
  auditPayload: Record<string, unknown>;
  /** Human-readable reason string. */
  reason: string;
  /** The gate that blocked first (null when passed). */
  failedGate?: PaperToDeployReadyFailedGate;

  /**
   * When true, the caller must call freezePolicyForStrategy() to stamp the
   * first-time frozen-policy hash BEFORE the promotion DB write.
   * Only set when all gates passed AND frozenPolicyHash was null.
   */
  needsFirstTimeFreeze?: boolean;

  /**
   * Honest B14 Survival Twin verdict. Distinguishes survival_twin_passed /
   * survival_twin_blocked / survival_twin_advisory_not_evaluated instead of
   * conflating "data absent" with "passed". The caller writes an honest audit row
   * from this (especially the advisory_not_evaluated state, so an un-evaluated gate
   * is visible rather than masquerading as protection). Attached on the gate-1
   * returns, the final pass return, and the frozen-policy returns.
   */
  survivalTwin?: SurvivalTwinVerdict;

  /**
   * Shadow evaluation result for observability logging.
   * Always present (even when null indicates data unavailable).
   * The caller should write a composite.shadow_evaluation audit row.
   */
  shadowEvaluation?: {
    shadow_decision: CompositeShadowInput["shadow_decision"];
    composite_score: number | null;
    verdict: CompositeShadowInput["verdict"];
    availability: CompositeShadowInput["availability"];
    reason: string;
    agreement: string;
  };
}

// ─── Pure evaluator ───────────────────────────────────────────────────────────

/**
 * Evaluate the 8 PAPER → DEPLOY_READY gates in canonical order.
 *
 * Mirrors the gate stack in checkAutoPromotions (lifecycle-service.ts:2807-3688).
 * Call this from both:
 *   1. checkAutoPromotions (replace inline block with this call)
 *   2. _promoteStrategyInner PAPER→DEPLOY_READY branch (Track C wires this)
 *
 * @param input  All pre-fetched gate data.
 * @returns      Verdict with passed/blocked, audit helpers, and shadow evaluation.
 */
export function evaluatePaperToDeployReadyGates(
  input: PaperToDeployReadyGateInput,
): PaperToDeployReadyGateResult {
  const {
    strategyId,
    b14HardGateEnabled = true,
    b15HardGateEnabled = true,
  } = input;

  // Honest survival-twin verdict — set by Gate 1 below and threaded onto the
  // gate-1 / final-pass / frozen-policy returns for the caller to audit.
  let survivalTwinVerdict: SurvivalTwinVerdict | undefined;

  // ──────────────────────────────────────────────────────────────────────────
  // Gate 1 — B14 Survival Twin (fail-CLOSED on infra error; HONEST 3-state otherwise)
  // Source: lifecycle-service.ts:2807-2984
  //
  // HONESTY FIX: previously this gate auto-PASSED whenever survival_twin data was
  // absent (it only blocked on survival_twin.passed===false). Since survival_twin
  // is only ever written by the manual replay tool, every normal strategy slid
  // through un-evaluated — a hard gate masquerading as protection.
  //
  // Now Gate 1 distinguishes three HONEST states:
  //   1. PRESENT + passed===false              → BLOCK (existing behavior)
  //   2. ABSENT  + on-demand replay blocked    → BLOCK (NEW real protection)
  //   3. ABSENT  + on-demand replay passed     → PASS
  //   4. ABSENT  + replay not-evaluated/errored→ advisory_not_evaluated, allow
  //      through (FAIL-SOFT — the B14 ci_high ruin gate below remains the HARD
  //      ruin guard; this avoids re-freezing promotion and never fail-OPENs into a
  //      false block, but is HONEST about being un-evaluated via a distinct audit).
  // ──────────────────────────────────────────────────────────────────────────
  if (b14HardGateEnabled) {
    const b14Twin = input.b14SurvivalTwin;

    // Caller signals infra error from the outer try/catch
    if (b14Twin?.infraError === true) {
      logger.warn(
        { strategyId },
        "evaluatePaperToDeployReadyGates: B14 gate infra error — blocking (fail-CLOSED)",
      );
      return {
        passed: false,
        status: "infra_error",
        auditAction: "b14.gate_error_fail_closed",
        auditPayload: { reason: "b14.gate_error_fail_closed" },
        reason: "b14.gate_error_fail_closed",
        failedGate: "b14_survival_twin",
      };
    }

    if (b14Twin?.survival_twin) {
      // ── State 1: survival_twin data PRESENT (written by the replay tool) ──
      const survivalTwin = b14Twin.survival_twin;
      if (survivalTwin.passed === false) {
        survivalTwinVerdict = {
          status: "survival_twin_blocked",
          evaluatedVia: "present_gate_result",
          auditReason: "b14_survival_twin_failed",
          perFirm: null,
        };
        logger.warn(
          { strategyId, survivalTwin },
          "evaluatePaperToDeployReadyGates: B14 Survival Twin BLOCKED PAPER→DEPLOY_READY",
        );
        return {
          passed: false,
          status: "blocked",
          auditAction: "lifecycle.b14_hard_blocked",
          auditPayload: {
            reason: "b14_survival_twin_failed",
            survival_twin: survivalTwin,
            b14_hard_gate_enabled: true,
          },
          reason: "b14_survival_twin_failed",
          failedGate: "b14_survival_twin",
          survivalTwin: survivalTwinVerdict,
        };
      }
      survivalTwinVerdict = {
        status: "survival_twin_passed",
        evaluatedVia: "present_gate_result",
        auditReason: "b14_survival_twin_present_passed",
        perFirm: null,
      };
    } else if (b14Twin?.onDemandReplay) {
      // ── States 2-4: survival_twin ABSENT — caller ran the on-demand replay ──
      const od = b14Twin.onDemandReplay;
      if (od.status === "blocked") {
        survivalTwinVerdict = {
          status: "survival_twin_blocked",
          evaluatedVia: "on_demand_replay",
          auditReason: od.reason,
          perFirm: od.perFirm ?? null,
          replayError: od.error ?? null,
        };
        logger.warn(
          { strategyId, reason: od.reason, perFirm: od.perFirm },
          "evaluatePaperToDeployReadyGates: B14 Survival Twin ON-DEMAND REPLAY BLOCKED PAPER→DEPLOY_READY",
        );
        return {
          passed: false,
          status: "blocked",
          auditAction: "lifecycle.b14_survival_twin_replay_blocked",
          auditPayload: {
            reason: od.reason,
            per_firm: od.perFirm ?? null,
            evaluated_via: "on_demand_replay",
            b14_hard_gate_enabled: true,
          },
          reason: od.reason,
          failedGate: "b14_survival_twin",
          survivalTwin: survivalTwinVerdict,
        };
      } else if (od.status === "passed") {
        survivalTwinVerdict = {
          status: "survival_twin_passed",
          evaluatedVia: "on_demand_replay",
          auditReason: od.reason,
          perFirm: od.perFirm ?? null,
        };
        logger.info(
          { strategyId, reason: od.reason },
          "evaluatePaperToDeployReadyGates: B14 Survival Twin on-demand replay PASSED",
        );
      } else {
        // advisory_not_evaluated — honest, allow through (B14 ci_high gate is the hard guard)
        survivalTwinVerdict = {
          status: "survival_twin_advisory_not_evaluated",
          evaluatedVia: "on_demand_replay",
          auditReason: od.reason,
          perFirm: od.perFirm ?? null,
          replayError: od.error ?? null,
        };
        logger.warn(
          { strategyId, reason: od.reason, replayError: od.error ?? null },
          "evaluatePaperToDeployReadyGates: B14 Survival Twin NOT EVALUATED (advisory) — allowing through; B14 ci_high ruin gate remains the hard guard",
        );
      }
    } else {
      // ── State 4 (no on-demand attempted): ABSENT and caller passed no replay ──
      // Honest "un-evaluated" rather than a silent legacy pass.
      survivalTwinVerdict = {
        status: "survival_twin_advisory_not_evaluated",
        evaluatedVia: "not_evaluated",
        auditReason: "survival_twin_absent_no_on_demand_replay",
        perFirm: null,
      };
      logger.warn(
        { strategyId },
        "evaluatePaperToDeployReadyGates: B14 Survival Twin data absent and no on-demand replay provided — advisory_not_evaluated (allowing through; B14 ci_high ruin gate remains the hard guard)",
      );
    }
  } else {
    survivalTwinVerdict = {
      status: "survival_twin_advisory_not_evaluated",
      evaluatedVia: "not_evaluated",
      auditReason: "b14_hard_gate_disabled",
      perFirm: null,
    };
    logger.warn(
      { strategyId },
      "evaluatePaperToDeployReadyGates: B14 Survival Twin gate DISABLED via b14HardGateEnabled=false",
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Gate 2 — B14 CI gate (fail-CLOSED when MC data absent)
  // Source: lifecycle-service.ts:2881-2956 + F-1 hardening 2026-06-22
  // ──────────────────────────────────────────────────────────────────────────
  if (b14HardGateEnabled) {
    const mcData = input.mcRuinCi;
    const mcAvailable = input.b14McDataAvailable !== false; // default true if not passed

    if (mcAvailable) {
      const rm = mcData ?? {};
      const ruinCi = (rm.probability_of_ruin_ci ?? null) as RuinCiDict | null;
      const pointEstimate = rm.probability_of_ruin != null
        ? Number(rm.probability_of_ruin)
        : null;

      const b14CiResult = evaluateB14CiGate(ruinCi, pointEstimate);

      if (!b14CiResult.passed) {
        logger.warn(
          {
            strategyId,
            ciHigh: b14CiResult.auditPayload.ci_high,
            threshold: b14CiResult.auditPayload.threshold,
            reason: b14CiResult.reason,
          },
          "evaluatePaperToDeployReadyGates: B14 CI gate BLOCKED",
        );
        return {
          passed: false,
          status: "blocked",
          auditAction: "b14.gate_evaluated",
          auditPayload: b14CiResult.auditPayload,
          reason: b14CiResult.reason,
          failedGate: "b14_ci",
        };
      }

      // CI passed — surface legacyFallback for caller to log if desired
      if (b14CiResult.legacyFallback) {
        logger.warn(
          { strategyId },
          "evaluatePaperToDeployReadyGates: B14 CI gate: using legacy scalar fallback (pre-Pass-A MC run)",
        );
      }
    }
    // No MC run at all: b14McDataAvailable=false → evaluateB14CiGate(null,null) blocks fail-CLOSED.
    // Represented here as !mcAvailable → evaluateB14CiGate with nulls.
    if (!mcAvailable) {
      const b14NullResult = evaluateB14CiGate(null, null);
      if (!b14NullResult.passed) {
        logger.warn(
          { strategyId },
          "evaluatePaperToDeployReadyGates: B14 CI gate BLOCKED (no MC run — fail-CLOSED per F-1)",
        );
        return {
          passed: false,
          status: "data_unavailable",
          auditAction: "b14.gate_evaluated",
          auditPayload: b14NullResult.auditPayload,
          reason: b14NullResult.reason,
          failedGate: "b14_ci",
        };
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Gate 3 — B15 Parameter Robustness Battery (fail-OPEN on read error)
  // Source: lifecycle-service.ts:2986-3051
  // ──────────────────────────────────────────────────────────────────────────
  const b15 = input.b15Battery;
  if (b15 != null && b15.passed === false && b15HardGateEnabled) {
    const failures = b15.failures ?? [];
    logger.warn(
      { strategyId, sdr: b15.sdr, psi: b15.psi, rws: b15.rws, failures },
      "evaluatePaperToDeployReadyGates: B15 HARD gate BLOCKED PAPER→DEPLOY_READY",
    );
    return {
      passed: false,
      status: "blocked",
      auditAction: "lifecycle.b15_parameter_robustness_blocked",
      auditPayload: {
        sdr: b15.sdr ?? null,
        psi: b15.psi ?? null,
        rws: b15.rws ?? null,
        thresholds: b15.thresholds ?? null,
        failures,
        hard_gate_enabled: b15HardGateEnabled,
      },
      reason: "b15_parameter_robustness_failed",
      failedGate: "b15",
    };
  }
  // b15.passed===false but b15HardGateEnabled=false → advisory only, do NOT block.
  // b15 null/absent → skip (backward compat for pre-B15 backtests).

  // ──────────────────────────────────────────────────────────────────────────
  // Gate 4 — WFE hard floor (fail-OPEN on read error)
  // Source: lifecycle-service.ts:3053-3142
  // ──────────────────────────────────────────────────────────────────────────
  const wfr = input.walkForwardResults;
  {
    const wfeOverall = wfr?.wfe_overall != null ? Number(wfr.wfe_overall) : null;
    const wfeStatus = wfr?.wfe_status != null ? String(wfr.wfe_status) : null;

    const wfeResult = evaluateWfeGate(wfeOverall, undefined, undefined, wfeStatus);

    if (wfeResult.auditAction) {
      const isBlock = wfeResult.status === "blocked" || wfeResult.status === "degenerate_is_block";
      if (isBlock) {
        logger.warn(
          { strategyId, wfeOverall: wfeResult.wfeOverall, status: wfeResult.status },
          "evaluatePaperToDeployReadyGates: WFE gate BLOCKED PAPER→DEPLOY_READY",
        );
        return {
          passed: false,
          status: "blocked",
          auditAction: wfeResult.auditAction,
          auditPayload: {
            wfe_overall: wfeResult.wfeOverall,
            hard_floor: wfeResult.hardFloor,
            warn_floor: wfeResult.warnFloor,
            status: wfeResult.status,
          },
          reason: wfeResult.auditAction,
          failedGate: "wfe",
        };
      }
      // legacy_null or non-blocking — log and continue
      logger.info(
        { strategyId, wfeStatus: wfeResult.status },
        "evaluatePaperToDeployReadyGates: WFE gate non-blocking (legacy/warn) — promotion continues",
      );
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Gate 5 — Parameter drift classification (fail-OPEN on read error)
  // Source: lifecycle-service.ts:3144-3226
  // ──────────────────────────────────────────────────────────────────────────
  {
    const paramStability = wfr?.param_stability ?? null;
    const driftClassification = (paramStability?.drift_classification as string | null) ?? null;
    const driftConfidence = paramStability?.drift_confidence != null
      ? Number(paramStability.drift_confidence)
      : null;
    // C1 (2026-06-29): thread param_stability_status so the CPCV path resolves to the
    // distinct cpcv_exempt result (non-block, distinct audit) instead of legacy_null.
    // Mirrors the WFE cpcv_exempt handling in Gate 4 above (non-blocking → log + continue).
    const paramStabilityStatus = (wfr?.param_stability_status as string | null | undefined) ?? null;

    const driftResult = evaluateParameterDriftGate(driftClassification, driftConfidence, paramStabilityStatus);

    if (driftResult.auditAction) {
      const isBlock = driftResult.status === "blocked" || driftResult.status === "blocked_classifier_error";
      if (isBlock) {
        logger.warn(
          { strategyId, classification: driftResult.classification, confidence: driftResult.confidence },
          "evaluatePaperToDeployReadyGates: Parameter drift gate BLOCKED PAPER→DEPLOY_READY",
        );
        return {
          passed: false,
          status: "blocked",
          auditAction: driftResult.auditAction,
          auditPayload: {
            classification: driftResult.classification,
            confidence: driftResult.confidence,
            status: driftResult.status,
          },
          reason: driftResult.auditAction,
          failedGate: "parameter_drift",
        };
      }
      // indeterminate or low-confidence warn — log and continue
      logger.info(
        { strategyId, status: driftResult.status, classification: driftResult.classification },
        "evaluatePaperToDeployReadyGates: Parameter drift advisory — promotion continues",
      );
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Gate 6 — DSR walk-forward gate (fail-OPEN on read error, fail-CLOSED on dsr_unavailable)
  // Source: lifecycle-service.ts:3228-3293
  // ──────────────────────────────────────────────────────────────────────────
  {
    const wfMeta = wfr?.wf_metadata ?? null;

    const dsrResult = evaluateDsrWalkForwardGate(
      wfMeta as WalkForwardDsrInput | null,
    );

    if (dsrResult.auditAction) {
      const isBlockDsr = !dsrResult.passed;
      if (isBlockDsr) {
        logger.warn(
          { strategyId, status: dsrResult.status, dsr: dsrResult.auditPayload.dsr },
          `evaluatePaperToDeployReadyGates: DSR gate BLOCKED PAPER→DEPLOY_READY: ${dsrResult.reason}`,
        );
        return {
          passed: false,
          status: "blocked",
          auditAction: dsrResult.auditAction,
          auditPayload: dsrResult.auditPayload,
          reason: dsrResult.reason,
          failedGate: "dsr_walk_forward",
        };
      }
      // legacy_proceed — log and continue
      logger.info(
        { strategyId },
        "evaluatePaperToDeployReadyGates: DSR gate: pre-Wave-A backtest — proceeding with legacy warn",
      );
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Gate 6.5 — BIF (Backtest Inflation Factor) gate (fail-OPEN on missing data)
  // H1 fix 2026-06-28: moved from cron-only inline block to symmetric evaluator
  // so BOTH the cron sweep and the manual PATCH /:id/lifecycle path enforce it.
  // Source: lifecycle-service.ts:3743-3845 (inline block now deleted from cron).
  // Hard-blocks when bif > BIF_BLOCK_THRESHOLD (default 4.0).
  // Warn band: BIF_WARN_THRESHOLD (2.0) < bif ≤ BIF_BLOCK_THRESHOLD — pass with warn.
  // Legacy grandfather: null bif (pre-Wave-3 backtest) → always pass.
  // ──────────────────────────────────────────────────────────────────────────
  {
    const bifIn = input.bifInput ?? null;
    const bifNum = bifIn?.bif != null && Number.isFinite(Number(bifIn.bif)) ? Number(bifIn.bif) : null;
    const kEffNum = bifIn?.kEff != null && Number.isFinite(Number(bifIn.kEff)) ? Number(bifIn.kEff) : null;

    // FINDING-2 fix: extract bif_proxy_basis from wf_metadata so the BIF gate
    // can route to advisory-only when CPCV mode is active.
    // wf_metadata is stored as JSONB in walkForwardResults; typed as Record<string,unknown>.
    const bifProxyBasis = ((wfr?.wf_metadata as Record<string, unknown> | null | undefined)?.["bif_proxy_basis"] as string | null | undefined) ?? null;

    // FINDING-2 fix: when CPCV proxy basis, BIF ≈ 1.0 is a STRUCTURAL ARTIFACT (both
    // IS proxy and WF agg_sharpe derive from the same OOS series). Computing and evaluating
    // it would silently pass bif.clean on a measurement that cannot detect overfitting.
    // Route to advisory-only (bif_unavailable_cpcv) instead of bif.clean.
    // This is non-blocking: the gate passes but the audit payload makes the structural
    // unavailability explicit instead of misleadingly showing a clean BIF value.
    // Wave 30 carry-forward: true per-path IS fold Sharpe will make BIF meaningful in CPCV.
    if (bifProxyBasis === "oos_mean_not_is") {
      logger.info(
        { strategyId, bif: bifNum, k_eff: kEffNum, proxyBasis: bifProxyBasis },
        "evaluatePaperToDeployReadyGates: BIF gate: CPCV proxy-basis — advisory-only " +
          "(bif_unavailable_cpcv); IS proxy derives from OOS data; BIF ≈ 1.0 is structural, " +
          "not meaningful; Wave 30 carry-forward for true IS fold Sharpe",
      );
      // Advisory-only: do not call evaluateBifGate with a misleading ≈1.0 value.
      // Promotion continues; audit shows bif_unavailable_cpcv explicitly.
    } else {
      const bifResult = evaluateBifGate(bifNum, kEffNum, { proxyBasis: bifProxyBasis });

      if (!bifResult.passed) {
        logger.warn(
          { strategyId, bif: bifNum, k_eff: kEffNum, reason: bifResult.reason },
          `evaluatePaperToDeployReadyGates: BIF gate BLOCKED PAPER→DEPLOY_READY: ${bifResult.reason}`,
        );
        return {
          passed: false,
          status: "blocked",
          auditAction: "bif.gate_evaluated",
          auditPayload: bifResult.auditPayload,
          reason: bifResult.reason,
          failedGate: "bif",
        };
      }

      if (bifResult.legacyNull) {
        logger.info({ strategyId }, "evaluatePaperToDeployReadyGates: BIF gate: pre-Wave-3 backtest — grandfather pass");
      } else {
        logger.info(
          { strategyId, bif: bifNum, reason: bifResult.reason },
          "evaluatePaperToDeployReadyGates: BIF gate passed",
        );
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Gate 7 — Wave 26 Pass G orchestrator (WFE-0.80, CPCV-15, WRC, SPA)
  // Fail-OPEN on read error (lifecycle-service.ts:3295-3452)
  // ──────────────────────────────────────────────────────────────────────────
  {
    const wfeOverall = wfr?.wfe_overall != null ? Number(wfr.wfe_overall) : null;
    const cpcvNPaths = wfr?.wf_metadata_n_paths ?? null;
    const orchInput: StrategyPromotionData = {
      ruinCi: null, // B14 already handled above — skip in orchestrator
      wfeOverall,
      cpcvNPaths,
      wrcPValue: input.orchGates?.wrcPValue ?? null,
      spaConsistentP: input.orchGates?.spaConsistentP ?? null,
    };

    const orchResult = evaluatePromotionGates(orchInput);

    const gatesToEvaluate: Array<"wfe_floor" | "cpcv_n_paths" | "wrc_p" | "spa_p"> =
      ["wfe_floor", "cpcv_n_paths", "wrc_p", "spa_p"];

    const orchFailingGates = gatesToEvaluate.filter(
      (g) => !orchResult.gate_results[g].passed,
    );

    if (orchFailingGates.length > 0) {
      const primaryFail = orchResult.gate_results[orchFailingGates[0]!];
      logger.warn(
        { strategyId, failingGates: orchFailingGates },
        "evaluatePaperToDeployReadyGates: Wave 26 Pass G orchestrator BLOCKED PAPER→DEPLOY_READY",
      );
      return {
        passed: false,
        status: "blocked",
        auditAction: "promotion.gate_failed",
        auditPayload: {
          failing_gates: orchFailingGates,
          primary_gate: orchFailingGates[0],
          primary_value: primaryFail.value,
          primary_threshold: primaryFail.threshold,
          primary_reason: primaryFail.reason,
          all_gate_details: orchFailingGates.map((g) => ({
            gate: g,
            value: orchResult.gate_results[g].value,
            threshold: orchResult.gate_results[g].threshold,
            reason: orchResult.gate_results[g].reason,
            data_available: orchResult.gate_results[g].data_available,
          })),
        },
        reason: `wave26_orchestrator: ${orchFailingGates.join(",")} failed`,
        failedGate: "wave26_orchestrator",
      };
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Gate 8 — Composite shadow (OBSERVABILITY ONLY — never blocks)
  // Source: lifecycle-service.ts:3454-3574
  // ──────────────────────────────────────────────────────────────────────────
  // Compute shadow agreement for caller to log. Does not alter `passed`.
  let shadowEvaluation: PaperToDeployReadyGateResult["shadowEvaluation"];
  {
    const shadow = input.compositeShadow;
    const hardGateOutcome = "allowed"; // we reach this line only if all hard gates passed

    if (shadow != null) {
      type AgreementLabel =
        | "agree_allow"
        | "agree_block"
        | "disagree_shadow_blocks"
        | "disagree_shadow_allows"
        | "shadow_no_opinion";

      let agreement: AgreementLabel;
      if (
        shadow.shadow_decision === "NO_OPINION" ||
        shadow.shadow_decision === "WOULD_WARN"
      ) {
        agreement = "shadow_no_opinion";
      } else if (shadow.shadow_decision === "WOULD_PROMOTE") {
        agreement = "agree_allow";
      } else if (shadow.shadow_decision === "WOULD_BLOCK") {
        agreement = "disagree_shadow_blocks";
      } else {
        agreement = "shadow_no_opinion";
      }

      shadowEvaluation = {
        shadow_decision: shadow.shadow_decision,
        composite_score: shadow.composite_score,
        verdict: shadow.verdict,
        availability: shadow.availability,
        reason: shadow.reason,
        agreement,
      };

      logger.info(
        {
          strategyId,
          agreement,
          shadow_decision: shadow.shadow_decision,
          composite_score: shadow.composite_score,
        },
        "evaluatePaperToDeployReadyGates: composite-shadow observation logged (observability only)",
      );
    } else {
      // Shadow data unavailable — record NO_OPINION
      shadowEvaluation = {
        shadow_decision: "NO_OPINION",
        composite_score: null,
        verdict: null,
        availability: "missing",
        reason: "composite_shadow_data_not_provided",
        agreement: "shadow_no_opinion",
      };
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Gate 9 — Frozen-policy drift (fail-CLOSED on hash error)
  // Source: lifecycle-service.ts:3577-3688
  // ──────────────────────────────────────────────────────────────────────────
  {
    let driftResult: FrozenPolicyDriftResult;
    try {
      driftResult = evaluateFrozenPolicyDriftAtPromotion(input.frozenPolicy);
    } catch (frozenErr) {
      // evaluateFrozenPolicyDriftAtPromotion itself threw (hash compute exception).
      // Fail-CLOSED per CLAUDE.md §12 (lifecycle-service.ts:3669-3686).
      const msg = frozenErr instanceof Error ? frozenErr.message : String(frozenErr);
      logger.warn(
        { strategyId, err: frozenErr },
        "evaluatePaperToDeployReadyGates: frozen_policy gate threw — blocking (fail-CLOSED)",
      );
      return {
        passed: false,
        status: "infra_error",
        auditAction: "frozen_policy.hash_compute_failed",
        auditPayload: { error: msg, note: "hash compute exception — promotion blocked" },
        reason: "frozen_policy.hash_compute_failed",
        failedGate: "frozen_policy",
        survivalTwin: survivalTwinVerdict,
        shadowEvaluation,
      };
    }

    if (!driftResult.ok && driftResult.frozenHash !== null) {
      // Hash mismatch — config changed since policy was frozen. Hard block.
      logger.warn(
        {
          strategyId,
          currentHash: driftResult.currentHash.slice(0, 16),
          frozenHash: (driftResult.frozenHash).slice(0, 16),
        },
        "evaluatePaperToDeployReadyGates: Frozen-policy drift gate BLOCKED",
      );
      return {
        passed: false,
        status: "blocked",
        auditAction: "lifecycle.frozen_policy_drift_blocked",
        auditPayload: {
          strategy_id: strategyId,
          current_hash: driftResult.currentHash,
          frozen_hash: driftResult.frozenHash,
          reason: driftResult.reason ?? "frozen_policy.hash_mismatch",
          note: "Operator must POST /api/admin/frozen-policy-override with HMAC + rationale ≥50 chars",
        },
        reason: "lifecycle.frozen_policy_drift_blocked",
        failedGate: "frozen_policy",
        survivalTwin: survivalTwinVerdict,
        shadowEvaluation,
      };
    }

    // First-time freeze: driftResult.ok=true AND frozenHash=null
    if (driftResult.ok && driftResult.frozenHash === null) {
      // Signal caller to freeze the policy BEFORE the promotion DB write.
      // The caller (checkAutoPromotions / _promoteStrategyInner) must call
      // freezePolicyForStrategy() and handle its own fail-CLOSED retry logic.
      logger.info(
        { strategyId },
        "evaluatePaperToDeployReadyGates: first-time frozen-policy freeze required — signalling caller",
      );
      return {
        passed: true,
        status: "pass",
        auditAction: null,
        auditPayload: {},
        reason: "all_gates_passed_first_time_freeze",
        needsFirstTimeFreeze: true,
        survivalTwin: survivalTwinVerdict,
        shadowEvaluation,
      };
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // All gates passed
  // ──────────────────────────────────────────────────────────────────────────
  logger.info(
    { strategyId },
    "evaluatePaperToDeployReadyGates: all 8 gates passed — PAPER→DEPLOY_READY allowed",
  );
  return {
    passed: true,
    status: "pass",
    auditAction: null,
    auditPayload: {},
    reason: "all_gates_passed",
    survivalTwin: survivalTwinVerdict,
    shadowEvaluation,
  };
}

// ─── On-demand B14 Survival Twin replay resolver ──────────────────────────────

/**
 * Inline Python wrapper that runs the existing B14 Survival Twin replay harness
 * (src/engine/replay/survival_twin_replay.replay_survival_on_backtest) for a single
 * backtest and prints a single aggregated JSON verdict to stdout.
 *
 * Why a wrapper (not `-m`): the module's __main__ prints a human-readable summary
 * and sys.exit()s — not parseable JSON. This wrapper imports the function directly
 * (per the circular-import workaround documented in db_loader.py) and emits JSON.
 *
 * Verdict criterion (grounded in survival_scorer._assign_grade): a completed firm
 * is "failing" when its letter grade is in fail_grades (default {"F"} = composite
 * survival score < 35) OR, optionally, when survival_score < min_score. blocked when
 * any completed firm fails; passed when all completed firms survive; advisory when
 * no firm produced a completed replay (no daily_pnls, unknown firm, load error, …).
 *
 * The wrapper NEVER raises — every path prints a JSON verdict so the Node side gets a
 * structured result instead of a subprocess error it has to interpret.
 */
const SURVIVAL_TWIN_REPLAY_WRAPPER = `
import json, sys

def _find_config_path(argv):
    for i, a in enumerate(argv):
        if a == "--config" and i + 1 < len(argv):
            return argv[i + 1]
    return None

def main():
    try:
        cfg_path = _find_config_path(sys.argv)
        if not cfg_path:
            print(json.dumps({"verdict": "advisory_not_evaluated", "reason": "no_config_path", "per_firm": []}))
            return
        with open(cfg_path) as f:
            cfg = json.load(f)
        backtest_id = cfg.get("backtest_id")
        fail_grades = set(cfg.get("fail_grades") or ["F"])
        min_score = cfg.get("min_score")
        if not backtest_id:
            print(json.dumps({"verdict": "advisory_not_evaluated", "reason": "missing_backtest_id", "per_firm": []}))
            return
        try:
            from src.engine.replay.survival_twin_replay import replay_survival_on_backtest
            results = replay_survival_on_backtest(backtest_id=backtest_id, apply=False)
        except Exception as exc:
            print(json.dumps({"verdict": "advisory_not_evaluated", "reason": "replay_invocation_error", "error": str(exc)[:500], "per_firm": []}))
            return
        per_firm = []
        completed = []
        for r in results:
            row = {
                "firm": getattr(r, "firm", None),
                "grade": getattr(r, "grade", None),
                "survival_score": getattr(r, "survival_score", None),
                "status": getattr(r, "status", None),
            }
            per_firm.append(row)
            if row["status"] == "completed":
                completed.append(row)
        if not completed:
            print(json.dumps({"verdict": "advisory_not_evaluated", "reason": "no_completed_firm_replay", "per_firm": per_firm}))
            return
        def _is_failing(row):
            g = row.get("grade")
            if g is not None and g in fail_grades:
                return True
            s = row.get("survival_score")
            if min_score is not None and s is not None and s < min_score:
                return True
            return False
        failing = [row for row in completed if _is_failing(row)]
        if failing:
            print(json.dumps({"verdict": "blocked", "reason": "survival_twin_replay_grade_fail", "per_firm": per_firm}))
        else:
            print(json.dumps({"verdict": "passed", "reason": "survival_twin_replay_grade_pass", "per_firm": per_firm}))
    except Exception as exc:
        print(json.dumps({"verdict": "advisory_not_evaluated", "reason": "wrapper_unexpected_error", "error": str(exc)[:500], "per_firm": []}))

main()
`;

interface SurvivalTwinReplayRaw {
  verdict?: string;
  reason?: string;
  error?: string;
  per_firm?: Array<Record<string, unknown>>;
}

/**
 * Resolve the B14 Survival Twin gate ON DEMAND when the normal backtest never wrote
 * survival_twin data (the normal case). Runs the existing replay harness in a bounded,
 * fail-soft Python subprocess and maps the result to an OnDemandSurvivalReplayResult.
 *
 * FAIL-SOFT POSTURE (deliberate — defense-in-depth, the B14 ci_high ruin gate is the
 * HARD ruin guard):
 *   - No backtestId            → advisory_not_evaluated (nothing to replay)
 *   - subprocess error/timeout → advisory_not_evaluated (NEVER blocked — cannot
 *                                fail-OPEN into a false block)
 *   - replay graded a firm F   → blocked (NEW real protection)
 *   - replay graded all firms surviving → passed
 *
 * This function NEVER throws. The caller awaits it BEFORE calling the (sync, pure)
 * evaluatePaperToDeployReadyGates and passes the verdict in via b14SurvivalTwin.onDemandReplay.
 *
 * Timeout: B14_SURVIVAL_TWIN_REPLAY_TIMEOUT_MS (default 60000). Fail criterion:
 * B14_SURVIVAL_TWIN_REPLAY_FAIL_GRADES (default "F") + optional
 * B14_SURVIVAL_TWIN_REPLAY_MIN_SCORE.
 */
export async function resolveSurvivalTwinOnDemand(params: {
  strategyId: string;
  backtestId?: string | null;
  timeoutMs?: number;
}): Promise<OnDemandSurvivalReplayResult> {
  const { strategyId, backtestId } = params;

  if (!backtestId) {
    return {
      status: "advisory_not_evaluated",
      reason: "no_completed_backtest_for_on_demand_replay",
      perFirm: null,
      error: null,
    };
  }

  const timeoutMs =
    params.timeoutMs ??
    (Number(process.env.B14_SURVIVAL_TWIN_REPLAY_TIMEOUT_MS) || 60_000);

  const failGrades = (process.env.B14_SURVIVAL_TWIN_REPLAY_FAIL_GRADES ?? "F")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const minScoreRaw = process.env.B14_SURVIVAL_TWIN_REPLAY_MIN_SCORE;
  const minScore =
    minScoreRaw != null && minScoreRaw !== "" && Number.isFinite(Number(minScoreRaw))
      ? Number(minScoreRaw)
      : null;

  try {
    const { runPythonModule } = await import("./python-runner.js");
    const raw = await runPythonModule<SurvivalTwinReplayRaw>({
      scriptCode: SURVIVAL_TWIN_REPLAY_WRAPPER,
      config: { backtest_id: backtestId, fail_grades: failGrades, min_score: minScore },
      timeoutMs,
      componentName: "b14-survival-twin-on-demand-replay",
    });

    const perFirm: SurvivalTwinPerFirm[] | null = Array.isArray(raw.per_firm)
      ? raw.per_firm.map((f) => ({
          firm: f.firm != null ? String(f.firm) : "",
          grade: f.grade != null ? String(f.grade) : null,
          survival_score: f.survival_score != null ? Number(f.survival_score) : null,
          status: f.status != null ? String(f.status) : "",
        }))
      : null;

    if (raw.verdict === "blocked") {
      return {
        status: "blocked",
        reason: raw.reason ?? "survival_twin_replay_grade_fail",
        perFirm,
        error: null,
      };
    }
    if (raw.verdict === "passed") {
      return {
        status: "passed",
        reason: raw.reason ?? "survival_twin_replay_grade_pass",
        perFirm,
        error: null,
      };
    }
    // advisory_not_evaluated OR any unrecognized verdict → honest, allow-through
    return {
      status: "advisory_not_evaluated",
      reason: raw.reason ?? "survival_twin_replay_not_evaluated",
      perFirm,
      error: raw.error ?? null,
    };
  } catch (err) {
    // FAIL-SOFT: a slow/broken replay never hangs (timeout) or fail-OPENs into a
    // hard block. It degrades to advisory_not_evaluated; the B14 ci_high ruin gate
    // remains the hard ruin guard.
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { strategyId, backtestId, err },
      "resolveSurvivalTwinOnDemand: on-demand replay failed — advisory_not_evaluated (B14 ci_high ruin gate remains the hard guard)",
    );
    return {
      status: "advisory_not_evaluated",
      reason: "on_demand_replay_error",
      perFirm: null,
      error: msg,
    };
  }
}
