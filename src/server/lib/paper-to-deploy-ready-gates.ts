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

export interface B14SurvivalTwinInput {
  /** gateResult.survival_twin from latest completed backtest */
  survival_twin?: { passed?: boolean; [key: string]: unknown } | null;
  /** True when B14 gate infra threw (caller's try/catch produced an error) */
  infraError?: boolean;
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

  // ──────────────────────────────────────────────────────────────────────────
  // Gate 1 — B14 Survival Twin (fail-CLOSED on infra error)
  // Source: lifecycle-service.ts:2807-2984
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
      const survivalTwin = b14Twin.survival_twin;
      if (survivalTwin.passed === false) {
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
        };
      }
    }
    // No gateResult or survival_twin data → log advisory, allow through (legacy).
  } else {
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

    const driftResult = evaluateParameterDriftGate(driftClassification, driftConfidence);

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

    const bifResult = evaluateBifGate(bifNum, kEffNum);

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
    shadowEvaluation,
  };
}
