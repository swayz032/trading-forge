/**
 * Strategy Lifecycle Service — state machine for strategy pipeline.
 *
 * Valid transitions:
 * CANDIDATE → TESTING → PAPER → DEPLOY_READY → DEPLOYED → DECLINING → RETIRED → GRAVEYARD
 * DECLINING → TESTING (retry)
 * TESTING → DECLINING (catastrophic failure)
 * PAPER → DECLINING (drift demotion)
 * Every state → GRAVEYARD (terminal burial)
 *
 * DEPLOY_READY is the "strategy library" — strategies that passed paper trading
 * and are ready for human review. Only manual approval moves them to DEPLOYED.
 * The system NEVER auto-deploys to TradingView.
 */

import { eq, and, desc, gte, sql, count } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies, strategyNames, strategyGraveyard, backtests, auditLog, lifecycleTransitions, monteCarloRuns, quantumMcRuns, paperSessions, paperTrades, complianceRulesets, pilotSessions } from "../db/schema.js";
import { computeAgreement } from "../lib/quantum-agreement.js";
import { getLatestAdversarialStressRun } from "./adversarial-stress-service.js";
import { getLatestFrankensteinRun } from "./frankenstein-service.js";
// Track A F-5 / F-6: Use leaf logger; add insertAuditRowSafe for migrated call sites.
// Remaining db.insert(auditLog) call sites in this file retain the raw pattern
// until incremental migration completes.
// TODO: correlation_id not threaded through most call sites in this file.
import { logger } from "../lib/logger.js";
import { insertAuditRow, insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { evolveStrategy } from "./evolution-service.js";
import { AlertFactory } from "./alert-service.js";
import { broadcastSSE } from "../routes/sse.js";
import { compileDualPineExport } from "./pine-export-service.js";
import { agentCoordinator } from "./agent-coordinator-service.js";
import { tracer } from "../lib/tracing.js";
import { strategyPromotions } from "../lib/metrics-registry.js";
import { evaluateMultiFirmEligibility } from "./multi-firm-promotion-service.js";
import { killSwitch } from "../production/kill-switch.js";
import { evaluateB14CiGate } from "../lib/b14-ci-gate.js";
import { evaluateWfeGate } from "../lib/wfe-gate.js";
import { evaluateParameterDriftGate } from "../lib/parameter-drift-gate.js";
import { evaluateCompositeShadow } from "../lib/composite-shadow-gate.js";
import { routeShadowDisagreementAlert } from "../lib/composite-shadow-discord-router.js";
import { evaluatePromotionGates, getWfePromotionFloor, getCpcvMinPaths } from "../lib/promotion-gate-orchestrator.js";
// Wave 29 Pass A.2 — PBO lifecycle gate (TESTING → SHADOW/PAPER hard gate).
// PBO_OVERFIT_THRESHOLD_PCT (default 0.15) — stricter than W27.5 PBO_OVERFIT_THRESHOLD (0.5).
import { evaluatePboGate } from "../lib/pbo-gate.js";
// Wave 29 Pass A.3 — shadow-signal divergence gate (SHADOW → PAPER).
// TODO (A.4 architect): Once A.1's SHADOW lifecycle state lands and the
// shadow_signals schema is extended with direction/intended_size/killzone/
// regime/confluence_score columns, remove the TODO markers in the loader.
import { compareShadowToBacktest } from "../lib/shadow-signal-divergence-checker.js";
import { loadDivergenceInputs } from "../lib/shadow-signal-divergence-loader.js";
// Wave 29 Pass B.2 — frozen-policy drift gate (PAPER → DEPLOY_READY).
// evaluateFrozenPolicyDriftAtPromotion: hash mismatch blocks promotion; first-time freeze stamps hash.
// freezePolicyForStrategy: called on first-time freeze to stamp all 4 columns atomically.
import {
  evaluateFrozenPolicyDriftAtPromotion,
  freezePolicyForStrategy,
} from "../lib/frozen-policy-contract.js";

const VALID_STATES = [
  "CANDIDATE",
  "TESTING",
  // Wave 29 Pass A.1: SHADOW stage sits between TESTING and PAPER.
  // Signals fire Pine alerts (TradingView) but TradersPost webhook is OFF.
  // Logged to lifecycle_shadow_signals for divergence analysis (A.3).
  // Promotes to PAPER after ≥20 shadow signals with <5% divergence (A.3 gate).
  "SHADOW",
  "PAPER",
  "DEPLOY_READY",
  "PILOT",
  "DEPLOYED",
  "DECLINING",
  "RETIRED",
  "GRAVEYARD",
] as const;

type LifecycleState = (typeof VALID_STATES)[number];

interface PromoteStrategyOptions {
  actor?: "system" | "human_release";
  reason?: string;
  /** Parent strategy ID for evolution-driven promotions (e.g., gen+1 child created by evolution-service). */
  parentStrategyId?: string;
  /** HTTP request correlation ID (req.id) or scheduler-generated UUID for end-to-end tracing. */
  correlationId?: string;
}

const VALID_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  CANDIDATE: ["TESTING", "PAPER", "GRAVEYARD"],  // PAPER is fast-track for tier-qualified strategies (Wave B1)
  // Wave 29 Pass A.1: TESTING can go to SHADOW (new path) OR directly to PAPER (legacy path preserved).
  // Both routes are valid depending on whether shadow_mode_enabled=true on the strategy.
  TESTING: ["SHADOW", "PAPER", "DECLINING", "GRAVEYARD"],
  // Wave 29 Pass A.1: SHADOW → PAPER after A.3 divergence gate clears (≥20 signals, <5% divergence).
  // SHADOW → DEPLOY_READY direct is INVALID — must go through PAPER first (full paper history required).
  SHADOW: ["PAPER", "DECLINING", "GRAVEYARD"],
  PAPER: ["DEPLOY_READY", "DECLINING", "GRAVEYARD"],  // Demotable on drift
  DEPLOY_READY: ["PILOT", "DEPLOYED", "PAPER", "GRAVEYARD"],  // Human approves PILOT canary OR legacy direct deploy OR back to paper
  // B8: PILOT canary state — 5 sessions, 1 contract.
  // PILOT → DEPLOYED: automatic after 5 sessions (rolling Sharpe > 1.0, no compliance violations).
  // PILOT → GRAVEYARD: automatic if any kill switch fires.
  // PILOT is entered via human approval (actor="human_release") from DEPLOY_READY.
  PILOT: ["DEPLOYED", "GRAVEYARD"],
  DEPLOYED: ["DECLINING", "GRAVEYARD"],
  DECLINING: ["TESTING", "RETIRED", "GRAVEYARD"],
  RETIRED: ["GRAVEYARD"],
  GRAVEYARD: [],  // Terminal state
};

/**
 * P0-1 compliance-drift gate helper.
 *
 * propCompliance JSONB uses per-firm keys like "topstep_50k" / "mffu_50k", but
 * compliance_rulesets.firm uses display names ("Topstep" / "MFFU"). When we
 * gate a promotion on rule freshness we have to translate the propCompliance
 * keys into the firm names that match what the compliance refresh service
 * writes into compliance_rulesets.firm (see compliance-refresh-service.ts:20
 * for the canonical FIRMS list).
 */
// Only Topstep (PRIMARY) + MFFU (secondary) per CLAUDE.md §6.
const FIRM_KEY_TO_FIRM_NAME: Record<string, string> = {
  topstep_50k: "Topstep",
  mffu_50k: "MFFU",
};

/**
 * Resolve the set of distinct firm-name strings (matching compliance_rulesets.firm)
 * for the firms a strategy currently passes prop compliance against. Returns an
 * empty array when no firms pass — caller MUST treat that as "no drift gate
 * applies" rather than "drift detected".
 */
export function passingFirmNamesFromCompliance(
  propCompliance: unknown,
): string[] {
  if (!propCompliance || typeof propCompliance !== "object") return [];
  const propResults = propCompliance as Record<string, { passed?: boolean; pass?: boolean }>;
  const names = new Set<string>();
  for (const [firmKey, result] of Object.entries(propResults)) {
    const passing = result?.passed === true || result?.pass === true;
    if (!passing) continue;
    const firmName = FIRM_KEY_TO_FIRM_NAME[firmKey];
    // Fallback: if a firm key doesn't have a mapping (new firm not yet in
    // FIRM_KEY_TO_FIRM_NAME), use the prefix as the firm name. Better to
    // miss than to fail open — we still try a lookup against the raw prefix.
    if (firmName) {
      names.add(firmName);
    } else {
      const prefix = firmKey.split("_")[0];
      if (prefix) names.add(prefix);
    }
  }
  return [...names];
}

/**
 * Returns the list of firms (from `firmNames`) whose latest compliance ruleset
 * has driftDetected=true. Empty array means no drift; callers must treat
 * non-empty as a hard block on the promotion.
 *
 * Reads the LATEST ruleset row per firm (sorted by createdAt DESC) so a stale
 * older row from before the most recent verify cycle does not falsely block.
 */
export async function findFirmsWithComplianceDrift(firmNames: string[]): Promise<string[]> {
  if (firmNames.length === 0) return [];

  // Latest ruleset row per firm. We can't easily DISTINCT ON in drizzle
  // without raw SQL, so do a simple per-firm scan. Firms list is bounded
  // to <=8 in practice (FIRMS in compliance-refresh-service.ts).
  const driftFirms: string[] = [];
  for (const firm of firmNames) {
    const [latest] = await db
      .select({
        firm: complianceRulesets.firm,
        driftDetected: complianceRulesets.driftDetected,
        status: complianceRulesets.status,
      })
      .from(complianceRulesets)
      .where(eq(complianceRulesets.firm, firm))
      .orderBy(desc(complianceRulesets.createdAt))
      .limit(1);
    if (!latest) continue; // No ruleset row at all -> not "drift"; covered by other guards
    if (latest.driftDetected === true || latest.status === "drift_detected") {
      driftFirms.push(firm);
    }
  }
  return driftFirms;
}

/**
 * P0-2 part 2: Promotion-time compliance gate (mirrors the per-bar gate in
 * paper-execution-service.ts:637-865 but applied at lifecycle promotion time).
 *
 * For each firm in `firmNames`, runs `compliance_gate.check_freshness` against
 * the latest ruleset row. Returns the list of firms that fail the freshness
 * check (which is what blocks promotion). Does NOT run `check_violation`
 * (that requires runtime strategy_state which lifecycle promotion does not
 * have); the violation check still runs at order-execution time on every bar.
 *
 * Fail-closed: if the Python subprocess errors out, the firm is treated as
 * failing the gate. Promotion-time is rare (every 6h scheduler tick) so
 * subprocess failures are not a hot path; failing closed here is safer than
 * letting a strategy onto the live track behind a broken compliance check.
 *
 * Returns: { firmsFailing, errors } — `firmsFailing` is the list of firm
 * names whose compliance check did NOT pass (or threw); `errors` carries the
 * underlying messages keyed by firm so audit rows can capture the cause.
 */
export async function runComplianceGateForFirms(
  firmNames: string[],
): Promise<{ firmsFailing: string[]; details: Record<string, { fresh: boolean; status: string; message: string }> }> {
  if (firmNames.length === 0) return { firmsFailing: [], details: {} };

  const { runPythonModule } = await import("../lib/python-runner.js");

  const firmsFailing: string[] = [];
  const details: Record<string, { fresh: boolean; status: string; message: string }> = {};

  for (const firm of firmNames) {
    try {
      // Fetch the latest ruleset row for this firm so the Python module can
      // evaluate against actual rule data (matches paper-execution-service
      // pattern at line 668-693).
      const [rs] = await db
        .select({
          firm: complianceRulesets.firm,
          parsedRules: complianceRulesets.parsedRules,
          retrievedAt: complianceRulesets.retrievedAt,
          driftDetected: complianceRulesets.driftDetected,
          contentHash: complianceRulesets.contentHash,
          status: complianceRulesets.status,
        })
        .from(complianceRulesets)
        .where(eq(complianceRulesets.firm, firm))
        .orderBy(desc(complianceRulesets.retrievedAt))
        .limit(1);

      if (!rs) {
        // No ruleset for this firm — fail closed at promotion time. The
        // compliance refresh service should always have populated rulesets
        // for the canonical firms list before any strategy can pass prop
        // compliance against them.
        firmsFailing.push(firm);
        details[firm] = {
          fresh: false,
          status: "no_ruleset",
          message: `No compliance ruleset row for firm '${firm}' — compliance gate cannot be evaluated.`,
        };
        continue;
      }

      const rulesetPayload: Record<string, unknown> = {
        firm: rs.firm,
        retrieved_at: rs.retrievedAt instanceof Date
          ? rs.retrievedAt.toISOString()
          : new Date(rs.retrievedAt as unknown as string).toISOString(),
        drift_detected: !!rs.driftDetected,
        status: rs.status,
        parsed_rules: rs.parsedRules ?? {},
        content_hash: rs.contentHash ?? null,
      };

      const result = await runPythonModule<{
        fresh: boolean;
        status: string;
        message: string;
        drift_detected?: boolean;
      }>({
        module: "src.engine.compliance.compliance_gate",
        config: {
          action: "check_freshness",
          firm,
          ruleset: rulesetPayload,
          context: "active_trading",
        },
        timeoutMs: 5_000,
        componentName: "compliance-gate-promotion",
      });

      details[firm] = {
        fresh: !!result.fresh,
        status: result.status,
        message: result.message,
      };

      if (!result.fresh) {
        firmsFailing.push(firm);
      }
    } catch (err) {
      // Fail-closed on subprocess error — promotion-time is not a hot path,
      // and a broken Python check is safer treated as a failed gate than as
      // an open one (a strategy promoted on a broken gate enters the live
      // track without verified compliance).
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ firm, err }, "runComplianceGateForFirms: Python subprocess threw — treating firm as failing the gate");
      firmsFailing.push(firm);
      details[firm] = {
        fresh: false,
        status: "subprocess_error",
        message: `compliance_gate.check_freshness threw: ${msg}`,
      };
    }
  }

  return { firmsFailing, details };
}

export class LifecycleService {
  /**
   * Promote or demote a strategy to a new lifecycle state.
   * Validates the transition is allowed, logs to audit_log.
   *
   * Wave B5 atomicity contract:
   *   - When no caller-tx is provided, ALL writes (strategy update, strategyNames
   *     update on RETIRED, strategy.lifecycle audit row, and the
   *     strategy.graveyard_burial_pending audit row for DECLINING/RETIRED)
   *     execute inside a single db.transaction(). On any failure, the entire
   *     unit rolls back and the caller sees a thrown error / no partial state.
   *   - When a caller passes its own tx (e.g., backtest-service paper session),
   *     this method runs all writes through the caller's tx so atomicity is
   *     scoped to the caller's outer transaction.
   *   - SSE broadcasts and the fire-and-forget buryInGraveyard() call run
   *     ONLY after the transaction commits successfully. They never run inside
   *     the transaction or on a rolled-back path.
   */
  async promoteStrategy(
    id: string,
    fromState: LifecycleState,
    toState: LifecycleState,
    options: PromoteStrategyOptions = {},
    tx?: typeof db,
  ): Promise<{ success: boolean; error?: string; retry_after_seconds?: number }> {
    const span = tracer.startSpan("lifecycle.promote");
    span.setAttribute("strategy.id", id);
    span.setAttribute("lifecycle.from", fromState);
    span.setAttribute("lifecycle.to", toState);
    span.setAttribute("actor", options.actor ?? "system");
    span.setAttribute("correlationId", options.correlationId ?? "");

    try {
      return await this._promoteStrategyInner(id, fromState, toState, options, tx);
    } catch (err) {
      span.setAttribute("error", true);
      span.setAttribute("error.message", err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      span.end();
    }
  }

  private async _promoteStrategyInner(
    id: string,
    fromState: LifecycleState,
    toState: LifecycleState,
    options: PromoteStrategyOptions,
    tx?: typeof db,
  ): Promise<{ success: boolean; error?: string; retry_after_seconds?: number }> {
    if (fromState === "DEPLOY_READY" && toState === "DEPLOYED" && options.actor !== "human_release") {
      const error = "Only manual release authority can promote DEPLOY_READY -> DEPLOYED";
      logger.warn({ id, fromState, toState, actor: options.actor ?? "system" }, error);
      return { success: false, error };
    }

    // B8: DEPLOY_READY → PILOT requires human approval (same authority as DEPLOYED).
    // This prevents system-auto promotion into the canary track — a human must decide
    // to enter the canary window for each strategy.
    if (fromState === "DEPLOY_READY" && toState === "PILOT" && options.actor !== "human_release") {
      const error = "Only manual release authority can promote DEPLOY_READY -> PILOT (canary track requires human approval)";
      logger.warn({ id, fromState, toState, actor: options.actor ?? "system" }, error);
      return { success: false, error };
    }

    // B8: PILOT → DEPLOYED requires either human_release OR system auto-promotion
    // (system actor = automatic after 5 sessions pass). PILOT → GRAVEYARD is always
    // allowed (kill switch path — no actor restriction).
    // No additional guard needed here; the VALID_TRANSITIONS map allows both.

    // Validate transition
    const allowed = VALID_TRANSITIONS[fromState];
    if (!allowed || !allowed.includes(toState)) {
      const error = `Invalid transition: ${fromState} → ${toState}. Allowed: ${allowed?.join(", ") || "none"}`;
      logger.warn({ id, fromState, toState }, error);
      return { success: false, error };
    }

    // Pre-tx read: verify current state matches before opening a transaction.
    // This avoids burning a tx slot on stale/missing strategies and lets us
    // return early on guard failures without touching the transaction at all.
    const readCtx = tx ?? db;
    const [strategy] = await readCtx
      .select()
      .from(strategies)
      .where(eq(strategies.id, id));

    if (!strategy) {
      return { success: false, error: "Strategy not found" };
    }

    if (strategy.lifecycleState !== fromState) {
      return {
        success: false,
        error: `Strategy is in state '${strategy.lifecycleState}', not '${fromState}'`,
      };
    }

    // Captured for post-commit side effects (SSE, fire-and-forget burial).
    // Populated INSIDE the tx, consumed AFTER commit.
    let retiredCodename: string | null = null;

    // FIX 2: Look up evidence snapshot for the audit row (both manual and auto promotions).
    // Done outside the tx (read-only) so the write block stays lean.
    // Failures are non-blocking — evidence is best-effort.
    let promotionEvidence: {
      backtestId: string | null;
      forgeScore: number | null;
      mcSurvivalRate: number | null;
      // Tier 1.1 QAE shadow fields — populated when quantum_mc_runs data exists.
      // Phase 0: these are observed only. Gate behavior is 100% classical.
      quantumAgreementScore: number | null;
      quantumAdvantageDelta: number | null;
      quantumFallbackTriggered: boolean;
      quantumClassicalDisagreementPct: number | null;
      // Tier 3.4 adversarial stress shadow fields — populated when adversarial_stress_runs data exists.
      // Phase 0 SHADOW ONLY: these are observed only. Gate behavior is 100% classical.
      // Phase 1 (W7b Day 52): worstCaseBreachProb > 0.5 AND breachMinimalNTrades < 4 -> BLOCK.
      adversarialWorstCaseBreachProb: number | null;
      adversarialBreachMinimalNTrades: number | null;
      adversarialPhase1BlockRecommended: boolean;
      adversarialMethod: string | null;
    } = {
      backtestId: null,
      forgeScore: null,
      mcSurvivalRate: null,
      quantumAgreementScore: null,
      quantumAdvantageDelta: null,
      quantumFallbackTriggered: false,
      quantumClassicalDisagreementPct: null,
      adversarialWorstCaseBreachProb: null,
      adversarialBreachMinimalNTrades: null,
      adversarialPhase1BlockRecommended: false,
      adversarialMethod: null,
    };

    try {
      const [latestBtEvidence] = await (tx ?? db)
        .select({
          id: backtests.id,
          forgeScore: backtests.forgeScore,
          // CRITICAL #6: read resultExtras for invariants.overall_passed + parity_shadow.passed
          resultExtras: backtests.resultExtras,
          createdAt: backtests.createdAt,
        })
        .from(backtests)
        .where(
          and(
            eq(backtests.strategyId, id),
            eq(backtests.status, "completed"),
          ),
        )
        .orderBy(desc(backtests.createdAt))
        .limit(1);

      if (latestBtEvidence) {
        const [mcEvidence] = await (tx ?? db)
          .select({ probabilityOfRuin: monteCarloRuns.probabilityOfRuin })
          .from(monteCarloRuns)
          .where(eq(monteCarloRuns.backtestId, latestBtEvidence.id))
          .orderBy(desc(monteCarloRuns.createdAt))
          .limit(1);

        const ruinProb = mcEvidence?.probabilityOfRuin != null
          ? parseFloat(String(mcEvidence.probabilityOfRuin))
          : null;

        promotionEvidence = {
          backtestId: latestBtEvidence.id,
          forgeScore: latestBtEvidence.forgeScore != null ? parseFloat(String(latestBtEvidence.forgeScore)) : null,
          mcSurvivalRate: ruinProb != null ? 1 - ruinProb : null,
          // Quantum fields default — populated below after parallel QMC read
          quantumAgreementScore: null,
          quantumAdvantageDelta: null,
          quantumFallbackTriggered: false,
          quantumClassicalDisagreementPct: null,
          // Adversarial stress fields default — populated below for TESTING->PAPER gate
          adversarialWorstCaseBreachProb: null,
          adversarialBreachMinimalNTrades: null,
          adversarialPhase1BlockRecommended: false,
          adversarialMethod: null,
        };

        // ── Tier 1.1 QAE shadow: read latest quantum_mc_runs row for this backtest ──
        // Phase 0 = shadow only. This read is:
        //   (a) non-blocking — any error falls through to fallback
        //   (b) non-authoritative — the classical decision is unaffected by this read
        //   (c) gated on QUANTUM_QAE_GATE_PHASE >= 0 (which is always true in Phase 0)
        //
        // AUTHORITY BOUNDARY: The result is stored in lifecycle_transitions for
        // Tier 7 graduation analysis. It MUST NOT influence the gate decision
        // while QUANTUM_QAE_GATE_PHASE=0.
        try {
          const [qmcRun] = await (tx ?? db)
            .select({
              estimatedValue: quantumMcRuns.estimatedValue,
              confidenceInterval: quantumMcRuns.confidenceInterval,
            })
            .from(quantumMcRuns)
            .where(
              and(
                eq(quantumMcRuns.backtestId, latestBtEvidence.id),
                eq(quantumMcRuns.status, "completed"),
              ),
            )
            .orderBy(desc(quantumMcRuns.createdAt))
            .limit(1);

          if (qmcRun) {
            const quantumEstimate = qmcRun.estimatedValue != null
              ? parseFloat(String(qmcRun.estimatedValue))
              : null;

            // Parse CI from jsonb: {lower, upper, confidence_level}
            const ciRaw = qmcRun.confidenceInterval as { lower?: number; upper?: number } | null;
            const ci: [number, number] | undefined =
              ciRaw?.lower != null && ciRaw?.upper != null
                ? [ciRaw.lower, ciRaw.upper]
                : undefined;

            // classical comparison uses probabilityOfRuin (higher = more risk)
            // quantum estimatedValue is also a probability (breach/ruin event)
            const agreement = computeAgreement(ruinProb, quantumEstimate, ci);

            promotionEvidence.quantumAgreementScore = agreement.score;
            promotionEvidence.quantumAdvantageDelta = agreement.delta;
            promotionEvidence.quantumFallbackTriggered = agreement.fallback;
            promotionEvidence.quantumClassicalDisagreementPct = agreement.disagreementPct;

            // Log disagreement for Tier 7 analysis — never suppress
            if (!agreement.withinTolerance && !agreement.fallback) {
              logger.warn(
                {
                  strategyId: id,
                  fromState,
                  toState,
                  classicalRuin: ruinProb,
                  quantumEstimate,
                  delta: agreement.delta,
                  disagreementPct: agreement.disagreementPct,
                  phase: process.env.QUANTUM_QAE_GATE_PHASE ?? "0",
                },
                "QAE shadow: quantum-classical disagreement exceeds 5pp tolerance (Phase 0 — advisory only, gate unaffected)",
              );
            }
          } else {
            // No completed QMC run for this backtest — normal during Phase 0 ramp-up
            promotionEvidence.quantumFallbackTriggered = true;
          }
        } catch (qmcErr) {
          // Non-blocking — quantum evidence read failure must never abort a promotion
          promotionEvidence.quantumFallbackTriggered = true;
          logger.warn(
            { strategyId: id, err: qmcErr },
            "QAE shadow: quantum_mc_runs read failed — fallback_triggered=true, classical decision unaffected",
          );
        }

        // ── Tier 3.4 adversarial stress shadow: read latest adversarial_stress_runs row ──
        // Phase 0 = shadow only. This read is:
        //   (a) non-blocking — any error falls through silently
        //   (b) non-authoritative — classical decision is unaffected by this read
        //   (c) TESTING->PAPER gate only — adversarial stress is irrelevant for other transitions
        //
        // AUTHORITY BOUNDARY: The result is stored in lifecycle_transitions.quantum_*
        // for Tier 7 / W7b graduation analysis (Day 52). It MUST NOT influence the
        // gate decision while QUANTUM_ADVERSARIAL_STRESS_ENABLED=false (Phase 0).
        if (fromState === "TESTING" && toState === "PAPER" && latestBtEvidence) {
          try {
            const adversarialRun = await getLatestAdversarialStressRun(latestBtEvidence.id);
            if (adversarialRun) {
              promotionEvidence.adversarialWorstCaseBreachProb = adversarialRun.worstCaseBreachProb;
              promotionEvidence.adversarialBreachMinimalNTrades = adversarialRun.breachMinimalNTrades;
              promotionEvidence.adversarialPhase1BlockRecommended = adversarialRun.phase1BlockRecommended;
              promotionEvidence.adversarialMethod = adversarialRun.method;

              // Log Phase 1 block recommendation — never suppress, never act on it in Phase 0
              if (adversarialRun.phase1BlockRecommended) {
                logger.warn(
                  {
                    strategyId: id,
                    fromState,
                    toState,
                    worstCaseBreachProb: adversarialRun.worstCaseBreachProb,
                    breachMinimalNTrades: adversarialRun.breachMinimalNTrades,
                    method: adversarialRun.method,
                    phase: "0_shadow",
                  },
                  "Adversarial stress shadow: Phase 1 would BLOCK this promotion (worst_case_breach_prob > 0.5 AND breach_minimal_n_trades < 4) — Phase 0 shadow, gate unaffected",
                );
              } else {
                logger.info(
                  {
                    strategyId: id,
                    fromState,
                    toState,
                    worstCaseBreachProb: adversarialRun.worstCaseBreachProb,
                    breachMinimalNTrades: adversarialRun.breachMinimalNTrades,
                    method: adversarialRun.method,
                    phase: "0_shadow",
                  },
                  "Adversarial stress shadow: evidence logged (Phase 0 — advisory only, gate unaffected)",
                );
              }
            }
            // No adversarial run for this backtest: normal — ramp-up phase, TIER_3, or no trades
          } catch (adversarialErr) {
            // Non-blocking — adversarial evidence read failure must never abort a promotion
            logger.warn(
              { strategyId: id, err: adversarialErr },
              "Adversarial stress shadow: read failed — continuing without adversarial evidence, classical decision unaffected",
            );
          }
        }
      }
    } catch (evidenceErr) {
      // Non-blocking — evidence enrichment must never abort a promotion
      logger.warn({ strategyId: id, err: evidenceErr }, "promoteStrategy: evidence lookup failed (audit row will lack backtestId/forgeScore/mcSurvivalRate)");
    }

    // ── HIGH #14: Backtest staleness gate ───────────────────────────────────
    // Promotion on a months-old backtest that doesn't reflect current market regime
    // is a trust violation. Default BACKTEST_STALENESS_DAYS=30; env-configurable.
    // Applied to all paths that consume a backtest (i.e., when promotionEvidence.backtestId exists).
    if (promotionEvidence.backtestId) {
      const stalenessDays = parseInt(process.env.BACKTEST_STALENESS_DAYS ?? "30", 10);
      // latestBtEvidence.createdAt is available via the extended select above.
      // We re-fetch from promotionEvidence which doesn't store createdAt — we need to
      // carry the createdAt alongside. We stored it in latestBtEvidence but not promotionEvidence.
      // Read it from the evidence again inline (cheap — single row by PK).
      try {
        const [btAge] = await (tx ?? db)
          .select({ createdAt: backtests.createdAt })
          .from(backtests)
          .where(eq(backtests.id, promotionEvidence.backtestId))
          .limit(1);

        if (btAge) {
          const ageMs = Date.now() - new Date(btAge.createdAt).getTime();
          const ageDays = ageMs / (1000 * 60 * 60 * 24);
          if (ageDays > stalenessDays) {
            const error =
              `lifecycle.backtest_stale: latest backtest for strategy ${id} is ${ageDays.toFixed(1)} days old ` +
              `(limit: ${stalenessDays}d via BACKTEST_STALENESS_DAYS). Re-run backtest before promoting.`;
            logger.warn({ strategyId: id, fromState, toState, ageDays: ageDays.toFixed(1), stalenessDays }, error);
            insertAuditRow({
              action: "lifecycle.backtest_stale",
              entityType: "strategy",
              entityId: id,
              decisionAuthority: "gate",
              status: "failure",
              input: { fromState, toState, backtestId: promotionEvidence.backtestId } as Record<string, unknown>,
              result: {
                reason: "backtest_too_old",
                age_days: parseFloat(ageDays.toFixed(1)),
                limit_days: stalenessDays,
                backtest_created_at: btAge.createdAt,
              } as Record<string, unknown>,
              correlationId: options.correlationId ?? null,
            }).catch((auditErr: unknown) => logger.error({ err: auditErr, strategyId: id }, "lifecycle.backtest_stale audit row write failed"));
            return { success: false, error };
          }
        }
      } catch (stalenessErr) {
        // Non-blocking infra failure: log and continue (fail-open; stale backtest is
        // a quality gate, not a safety gate — don't block on DB read errors).
        logger.warn({ strategyId: id, backtestId: promotionEvidence.backtestId, err: stalenessErr }, "lifecycle.backtest_stale: age check threw (non-blocking — promotion continues)");
      }
    }

    // ── CRITICAL #6: Truthiness gate: resultExtras invariants + parity shadow ─
    // Applies to TESTING → PAPER only (the trust boundary before paper trading).
    // invariants.overall_passed=false → BLOCK (hard gate: curvefitting invariant harness)
    // parity_shadow.passed=false     → ADVISORY WARN (env-gated; not all backtests have it)
    if (fromState === "TESTING" && toState === "PAPER" && promotionEvidence.backtestId) {
      try {
        const [btExtras] = await (tx ?? db)
          .select({ resultExtras: backtests.resultExtras })
          .from(backtests)
          .where(eq(backtests.id, promotionEvidence.backtestId))
          .limit(1);

        if (btExtras?.resultExtras) {
          const extras = btExtras.resultExtras as Record<string, unknown>;

          // ── Wave 24 / Item 12: mc_provisional sentinel check ────────────────
          // mc_provisional=true means Monte Carlo is still running. Promoting on
          // partial MC data yields distorted promotion inputs (Known-Facts Pin
          // 2026-05-20 Pass 2B F-8). Defer and instruct caller to retry in 30min.
          // Missing mc_provisional (undefined/null) = already cleared → proceed.
          if (extras.mc_provisional === true) {
            const deferMsg = `lifecycle.mc_provisional_deferred: MC still in progress for backtest ${promotionEvidence.backtestId} — promotion to PAPER deferred`;
            logger.warn({ strategyId: id, backtestId: promotionEvidence.backtestId }, deferMsg);
            insertAuditRow({
              action: "lifecycle.mc_provisional_deferred",
              entityType: "strategy",
              entityId: id,
              decisionAuthority: "gate",
              status: "failure",
              input: { backtestId: promotionEvidence.backtestId, attempted_transition: "TESTING→PAPER" } as Record<string, unknown>,
              result: { reason: "mc_provisional_in_progress", retry_after_seconds: 1800 } as Record<string, unknown>,
              correlationId: options.correlationId ?? null,
            }).catch((auditErr: unknown) => logger.error({ err: auditErr, strategyId: id }, "lifecycle.mc_provisional_deferred audit write failed"));
            return { success: false, error: "mc_provisional_in_progress", retry_after_seconds: 1800 };
          }

          // Invariant harness (B-2): hard block if overall_passed=false
          const invariants = extras.invariants as Record<string, unknown> | undefined;
          if (invariants?.overall_passed === false) {
            const criticalFailures = (invariants.critical_failures as unknown[]) ?? [];
            const error =
              `lifecycle.invariant_blocked: invariant harness FAILED for strategy ${id} — ` +
              `promotion to PAPER blocked. Critical failures: ${JSON.stringify(criticalFailures)}`;
            logger.warn({ strategyId: id, fromState, toState, criticalFailures }, error);
            insertAuditRow({
              action: "lifecycle.invariant_blocked",
              entityType: "strategy",
              entityId: id,
              decisionAuthority: "gate",
              status: "failure",
              input: { fromState, toState, backtestId: promotionEvidence.backtestId } as Record<string, unknown>,
              result: {
                reason: "invariant_harness_failed",
                critical_failures: criticalFailures,
                invariants_summary: invariants,
              } as Record<string, unknown>,
              correlationId: options.correlationId ?? null,
            }).catch((auditErr: unknown) => logger.error({ err: auditErr, strategyId: id }, "lifecycle.invariant_blocked audit row write failed"));
            return { success: false, error };
          }

          // Parity shadow (B-1): advisory warn only (env-gated — not all backtests have it)
          const parityShadow = extras.parity_shadow as Record<string, unknown> | undefined;
          if (parityShadow && parityShadow.passed === false) {
            logger.warn(
              { strategyId: id, fromState, toState, parityShadow },
              "lifecycle.parity_shadow_warn: parity shadow check reported passed=false — ADVISORY ONLY (promotion continues). Investigate paper/backtest drift before live deployment.",
            );
            insertAuditRow({
              action: "lifecycle.parity_shadow_warn",
              entityType: "strategy",
              entityId: id,
              decisionAuthority: "gate",
              status: "success",  // advisory — not blocking
              input: { fromState, toState, backtestId: promotionEvidence.backtestId } as Record<string, unknown>,
              result: {
                reason: "parity_shadow_failed_advisory",
                parity_shadow: parityShadow,
                note: "Parity shadow is env-gated; not all backtests have it. Investigate before live deployment.",
              } as Record<string, unknown>,
              correlationId: options.correlationId ?? null,
            }).catch((auditErr: unknown) => logger.error({ err: auditErr, strategyId: id }, "lifecycle.parity_shadow_warn audit row write failed"));
          }
        }
      } catch (extrasErr) {
        // Non-blocking: truthiness read failure must never abort a promotion.
        // Log at WARN — this is a trust gate and missing data should be visible.
        logger.warn({ strategyId: id, backtestId: promotionEvidence.backtestId, err: extrasErr }, "lifecycle.invariant_gate: resultExtras read failed (non-blocking — promotion continues)");
      }
    }

    // ── Wave 24 Pass 1 — Item 10: WF mode gate (Style C + plain WF → block) ─
    // Style C runner can span many bars. Plain walk-forward leaks future info
    // via overlapping runner holds at the IS/OOS boundary. Require purged_embargo
    // or cpcv mode for any Style C strategy. (Item 10, Wave 24 Pass 1, 2026-05-23)
    if (fromState === "TESTING" && toState === "PAPER" && promotionEvidence.backtestId) {
      try {
        const [btExtrasWf] = await (tx ?? db)
          .select({ resultExtras: backtests.resultExtras })
          .from(backtests)
          .where(eq(backtests.id, promotionEvidence.backtestId))
          .limit(1);

        if (btExtrasWf?.resultExtras) {
          const extrasWf = btExtrasWf.resultExtras as Record<string, unknown>;
          const wfMeta = extrasWf.wf_metadata as Record<string, unknown> | undefined;
          const wfMode = wfMeta?.mode as string | undefined;

          // Read strategy DSL to check for Style C runner.
          // Strategy config lives in the strategies table — read the DSL column.
          const [stratDsl] = await (tx ?? db)
            .select({ dsl: strategies.config })
            .from(strategies)
            .where(eq(strategies.id, id))
            .limit(1);

          const dslConfig = stratDsl?.dsl as Record<string, unknown> | undefined;
          const exitParams = (dslConfig?.exit_params ?? dslConfig?.exitParams) as Record<string, unknown> | undefined;
          const isStyleC = exitParams?.style === "c" || exitParams?.style === "C";

          if (isStyleC && wfMode === "plain") {
            const error =
              `lifecycle.wf_mode_insufficient: strategy ${id} uses Style C runner exits ` +
              `but walk-forward mode is "plain" — overlapping runner bars leak IS→OOS. ` +
              `Re-run backtest with WF_MODE=purged_embargo or WF_MODE=cpcv before promoting to PAPER.`;
            logger.warn(
              { strategyId: id, fromState, toState, wfMode, isStyleC, backtestId: promotionEvidence.backtestId },
              error,
            );
            insertAuditRow({
              action: "lifecycle.wf_mode_insufficient",
              entityType: "strategy",
              entityId: id,
              decisionAuthority: "gate",
              status: "failure",
              input: { fromState, toState, backtestId: promotionEvidence.backtestId, wfMode } as Record<string, unknown>,
              result: {
                reason: "plain_wf_with_style_c_runner",
                wf_mode: wfMode,
                is_style_c: isStyleC,
                required_modes: ["purged_embargo", "cpcv"],
              } as Record<string, unknown>,
              correlationId: options.correlationId ?? null,
            }).catch((auditErr: unknown) => logger.error({ err: auditErr, strategyId: id }, "lifecycle.wf_mode_insufficient audit row write failed"));
            return { success: false, error };
          }
        }
      } catch (wfModeErr) {
        // Non-blocking: WF mode gate failure must not abort a promotion.
        logger.warn({ strategyId: id, backtestId: promotionEvidence.backtestId, err: wfModeErr }, "lifecycle.wf_mode_gate: read failed (non-blocking — promotion continues)");
      }
    }

    // ── Wave 24 Pass 1 — Item 18: PBO overfit gate (TESTING → PAPER) ────────
    // PBO > 0.5 = more likely overfit than not. Block promotion. (Item 18, W24P1)
    if (fromState === "TESTING" && toState === "PAPER" && promotionEvidence.backtestId) {
      try {
        const [btExtrasPbo] = await (tx ?? db)
          .select({ resultExtras: backtests.resultExtras })
          .from(backtests)
          .where(eq(backtests.id, promotionEvidence.backtestId))
          .limit(1);

        if (btExtrasPbo?.resultExtras) {
          const extrasPbo = btExtrasPbo.resultExtras as Record<string, unknown>;
          const invariants = extrasPbo.invariants as Record<string, unknown> | undefined;
          const pboFlag = invariants?.pbo_flag as boolean | undefined;
          const pboData = invariants?.pbo as Record<string, unknown> | undefined;

          // Only block when pbo_flag is explicitly true (not when N/A or missing).
          if (pboFlag === true) {
            const pboThreshold = parseFloat(process.env.PBO_PROMOTION_THRESHOLD ?? "0.5");
            const pboValue = pboData?.value as number | null ?? null;
            const error =
              `lifecycle.pbo_overfit_blocked: strategy ${id} has PBO=${pboValue?.toFixed(3) ?? "?"} ` +
              `which exceeds threshold ${pboThreshold}. ` +
              `Strategy appears curve-fit — block promotion to PAPER. ` +
              `Re-run backtest with more walk-forward windows or reduce parameter search space.`;
            logger.warn(
              { strategyId: id, fromState, toState, pboValue, pboThreshold, backtestId: promotionEvidence.backtestId },
              error,
            );
            insertAuditRow({
              action: "lifecycle.pbo_overfit_blocked",
              entityType: "strategy",
              entityId: id,
              decisionAuthority: "gate",
              status: "failure",
              input: { fromState, toState, backtestId: promotionEvidence.backtestId } as Record<string, unknown>,
              result: {
                reason: "pbo_exceeds_threshold",
                pbo_value: pboValue,
                pbo_threshold: pboThreshold,
                pbo_data: pboData,
              } as Record<string, unknown>,
              correlationId: options.correlationId ?? null,
            }).catch((auditErr: unknown) => logger.error({ err: auditErr, strategyId: id }, "lifecycle.pbo_overfit_blocked audit row write failed"));
            return { success: false, error };
          }
        }
      } catch (pboErr) {
        // Non-blocking: PBO gate failure must not abort a promotion.
        logger.warn({ strategyId: id, backtestId: promotionEvidence.backtestId, err: pboErr }, "lifecycle.pbo_gate: read failed (non-blocking — promotion continues)");
      }
    }

    // ── Wave 29 Pass A.2: PBO lifecycle gate (TESTING → SHADOW/PAPER) ────────
    // Institutional 2026 standard: PBO < 0.15 required (Lopez de Prado /
    // QuantBeckman 2025 / arXiv 2512.12924).
    //
    // Wire target: TESTING → SHADOW AND TESTING → PAPER (legacy fast-track).
    // A.1 HAS landed SHADOW in VALID_STATES. Gate fires on both routes.
    // A.4 architect: if desired, restrict to TESTING → SHADOW only; legacy
    // TESTING → PAPER fast-track can stay gated for extra safety.
    //
    // Two separate thresholds:
    //   PBO_OVERFIT_THRESHOLD     (0.5)  — W27.5 warn threshold (walk_forward.py)
    //   PBO_OVERFIT_THRESHOLD_PCT (0.15) — this gate (Wave 29 lifecycle hard gate)
    if (
      fromState === "TESTING" &&
      (toState === "SHADOW" || toState === "PAPER") &&
      promotionEvidence.backtestId
    ) {
      try {
        const [btExtrasPboW29] = await (tx ?? db)
          .select({ walkForwardResults: backtests.walkForwardResults })
          .from(backtests)
          .where(eq(backtests.id, promotionEvidence.backtestId))
          .limit(1);

        if (btExtrasPboW29) {
          // pbo_overall lives in walkForwardResults (the WF result JSON blob).
          // Wave 29 Pass A.2 wires pbo_overall + pbo_overall_p_value into the
          // walk_forward.py return dict, which backtest-service persists here.
          const wfMeta = btExtrasPboW29.walkForwardResults as Record<string, unknown> | null | undefined;
          const pboOverall = wfMeta?.pbo_overall as number | null | undefined;
          const pboOverallPValue = wfMeta?.pbo_overall_p_value as number | null | undefined;

          const pboGateResult = evaluatePboGate(
            { pbo_overall: pboOverall, pbo_p_value: pboOverallPValue },
          );

          if (!pboGateResult.ok) {
            const pboError =
              `lifecycle.pbo_overfit_block: strategy ${id} has PBO=${pboGateResult.pbo?.toFixed(4) ?? "?"} ` +
              `which exceeds threshold ${pboGateResult.threshold} (Wave 29 institutional gate). ` +
              `Strategy appears overfit — block promotion to ${toState}. ` +
              `Re-run backtest with more CPCV folds or reduce parameter search space.`;
            logger.warn(
              { strategyId: id, fromState, toState, pbo: pboGateResult.pbo, threshold: pboGateResult.threshold, backtestId: promotionEvidence.backtestId },
              pboError,
            );
            // Emit lifecycle.pbo_overfit_block audit (canonical Wave 29 action name)
            insertAuditRow({
              action: "lifecycle.pbo_overfit_block",
              entityType: "strategy",
              entityId: id,
              decisionAuthority: "gate",
              status: "failure",
              input: { fromState, toState, backtestId: promotionEvidence.backtestId } as Record<string, unknown>,
              result: pboGateResult.auditPayload as Record<string, unknown>,
              correlationId: options.correlationId ?? null,
            }).catch((auditErr: unknown) => logger.error({ err: auditErr, strategyId: id }, "lifecycle.pbo_overfit_block audit row write failed"));
            // Emit SSE event lifecycle:pbo_evaluated
            broadcastSSE("lifecycle:pbo_evaluated", {
              strategyId: id,
              fromState,
              toState,
              pbo: pboGateResult.pbo,
              threshold: pboGateResult.threshold,
              blocked: true,
            });
            return { success: false, error: pboError };
          }

          // Legacy null or pbo passes — emit lifecycle.pbo_unavailable_legacy warn if needed
          if (pboGateResult.legacyNull) {
            insertAuditRow({
              action: "lifecycle.pbo_unavailable_legacy",
              entityType: "strategy",
              entityId: id,
              decisionAuthority: "gate",
              status: "success",
              input: { fromState, toState, backtestId: promotionEvidence.backtestId } as Record<string, unknown>,
              result: pboGateResult.auditPayload as Record<string, unknown>,
              correlationId: options.correlationId ?? null,
            }).catch((auditErr: unknown) => logger.error({ err: auditErr, strategyId: id }, "lifecycle.pbo_unavailable_legacy audit row write failed"));
          }

          // Emit SSE event lifecycle:pbo_evaluated on every evaluation
          broadcastSSE("lifecycle:pbo_evaluated", {
            strategyId: id,
            fromState,
            toState,
            pbo: pboGateResult.pbo,
            threshold: pboGateResult.threshold,
            blocked: false,
            legacy_null: pboGateResult.legacyNull,
          });
        }
      } catch (pboW29Err) {
        // Non-blocking: PBO gate failure must not abort a promotion.
        logger.warn({ strategyId: id, backtestId: promotionEvidence.backtestId, err: pboW29Err }, "lifecycle.pbo_gate (Wave 29): read/eval failed (non-blocking — promotion continues)");
      }
    }

    // ── Wave 24 Pass 1 — Item 19: Honest DSR gate (TESTING → PAPER) ─────────
    // Honest DSR (multiple-testing corrected) < threshold → block. (Item 19, W24P1)
    // Uses DSR_HONEST_THRESHOLD env (default 1.5). Old "dsr" field preserved for
    // back-compat; this gate reads dsr_honest.dsr_passed which is the honest value.
    if (fromState === "TESTING" && toState === "PAPER" && promotionEvidence.backtestId) {
      try {
        const [btExtrasDsr] = await (tx ?? db)
          .select({ resultExtras: backtests.resultExtras })
          .from(backtests)
          .where(eq(backtests.id, promotionEvidence.backtestId))
          .limit(1);

        if (btExtrasDsr?.resultExtras) {
          const extrasDsr = btExtrasDsr.resultExtras as Record<string, unknown>;
          const invariants = extrasDsr.invariants as Record<string, unknown> | undefined;
          const dsrHonest = invariants?.dsr_honest as Record<string, unknown> | undefined;

          // Only gate when dsr_honest is present and not_applicable is not set.
          if (dsrHonest && !dsrHonest.not_applicable) {
            const dsrPassed = dsrHonest.dsr_passed as boolean | undefined;
            const dsrValue = dsrHonest.dsr as number | null ?? null;
            const nTrials = dsrHonest.n_trials as number | null ?? null;
            const dsrThreshold = parseFloat(process.env.DSR_HONEST_THRESHOLD ?? "1.5");

            if (dsrPassed === false) {
              const error =
                `lifecycle.dsr_honest_blocked: strategy ${id} has honest DSR=${dsrValue?.toFixed(3) ?? "?"} ` +
                `(threshold ${dsrThreshold}, n_trials=${nTrials}). ` +
                `Multiple-testing correction reduces confidence in this edge. ` +
                `Increase OOS track record or reduce parameter search space before promoting to PAPER.`;
              logger.warn(
                { strategyId: id, fromState, toState, dsrValue, dsrThreshold, nTrials, backtestId: promotionEvidence.backtestId },
                error,
              );
              insertAuditRow({
                action: "lifecycle.dsr_honest_blocked",
                entityType: "strategy",
                entityId: id,
                decisionAuthority: "gate",
                status: "failure",
                input: { fromState, toState, backtestId: promotionEvidence.backtestId } as Record<string, unknown>,
                result: {
                  reason: "honest_dsr_below_threshold",
                  dsr_honest: dsrHonest,
                  dsr_threshold: dsrThreshold,
                } as Record<string, unknown>,
                correlationId: options.correlationId ?? null,
              }).catch((auditErr: unknown) => logger.error({ err: auditErr, strategyId: id }, "lifecycle.dsr_honest_blocked audit row write failed"));
              return { success: false, error };
            }
          }
        }
      } catch (dsrErr) {
        // Non-blocking: DSR gate failure must not abort a promotion.
        logger.warn({ strategyId: id, backtestId: promotionEvidence.backtestId, err: dsrErr }, "lifecycle.dsr_honest_gate: read failed (non-blocking — promotion continues)");
      }
    }

    // ── A4 Frankenstein Gate: TESTING → PAPER and CANDIDATE → PAPER hard block ─
    // The Frankenstein test detects lookahead / future-data bugs by checking
    // whether the strategy shows edge on shuffled/GBM data. If it does, the
    // backtester has a structural bug that invalidates all metrics.
    //
    // This is a HARD gate — not Phase 0 shadow. A failed Frankenstein test
    // blocks promotion immediately with a clear reason. No graduation required.
    //
    // Pass criteria (locked from plan):
    //   95th pct of |Sharpe| < 0.3 AND median PF in [0.85, 1.15]
    //
    // If no Frankenstein run exists yet: promotion is BLOCKED with a clear
    // message asking the operator to run the Frankenstein test first.
    // This forces the test to be run before any strategy can enter paper trading.
    //
    // F-12 FIX: Gate applies to CANDIDATE → PAPER as well as TESTING → PAPER.
    // CANDIDATE → PAPER is a valid fast-track (VALID_TRANSITIONS allows it) but
    // MUST still pass A4 — the fast-track bypasses TESTING iteration, not the
    // structural integrity test. Without this, a CANDIDATE with a lookahead bug
    // could skip directly into live paper trading.
    if ((fromState === "TESTING" || fromState === "CANDIDATE") && toState === "PAPER") {
      if (promotionEvidence.backtestId) {
        try {
          const frankResult = await getLatestFrankensteinRun(promotionEvidence.backtestId);

          if (!frankResult) {
            // No Frankenstein run exists — block promotion and require the test
            const error =
              "Frankenstein gate: no completed Frankenstein test run found for this backtest. " +
              "Run POST /api/frankenstein/run before promoting to PAPER.";
            logger.warn(
              { strategyId: id, backtestId: promotionEvidence.backtestId, fromState, toState },
              error,
            );
            // Wave 23H Fix 3: audit row on every rejection path (was logger.warn only)
            insertAuditRow({
              action: "lifecycle.frankenstein_rejected",
              entityType: "strategy",
              entityId: id,
              decisionAuthority: "gate",
              status: "failure",
              input: { fromState, toState, backtestId: promotionEvidence.backtestId } as Record<string, unknown>,
              result: { decision: "missing_run", reason: "no completed Frankenstein test run found" } as Record<string, unknown>,
              correlationId: options.correlationId ?? null,
            }).catch((err: unknown) => logger.error({ err, strategyId: id }, "A4: missing_run audit row write failed"));
            return { success: false, error };
          }

          if (!frankResult.passed) {
            // Frankenstein test FAILED — hard block
            const error =
              `Frankenstein gate: FAILED. Strategy shows edge on randomized data — backtester likely has a lookahead bug. ` +
              `p95_sharpe=${frankResult.p95Sharpe?.toFixed(3) ?? "null"} (threshold: <0.3), ` +
              `median_pf=${frankResult.medianPf?.toFixed(3) ?? "null"} (threshold: [0.85, 1.15]). ` +
              `Run ID: ${frankResult.runId}`;
            logger.warn(
              {
                strategyId: id,
                backtestId: promotionEvidence.backtestId,
                frankRunId: frankResult.runId,
                p95Sharpe: frankResult.p95Sharpe,
                medianPf: frankResult.medianPf,
                fromState,
                toState,
              },
              "Frankenstein gate: BLOCKED promotion — strategy failed randomization detection test",
            );
            // Wave 23H Fix 3: audit row on every rejection path (was logger.warn only)
            insertAuditRow({
              action: "lifecycle.frankenstein_rejected",
              entityType: "strategy",
              entityId: id,
              decisionAuthority: "gate",
              status: "failure",
              input: {
                fromState, toState,
                backtestId: promotionEvidence.backtestId,
                frankRunId: frankResult.runId,
              } as Record<string, unknown>,
              result: {
                decision: "failed",
                n_shuffles: frankResult.nShuffles,
                p_value_observed: frankResult.p95Sharpe,
                p_value_threshold: 0.3,
                median_pf: frankResult.medianPf,
                reason: "strategy shows edge on randomized data",
              } as Record<string, unknown>,
              correlationId: options.correlationId ?? null,
            }).catch((err: unknown) => logger.error({ err, strategyId: id }, "A4: failed audit row write failed"));
            return { success: false, error };
          }

          // Frankenstein passed — log confirmation and proceed
          logger.info(
            {
              strategyId: id,
              backtestId: promotionEvidence.backtestId,
              frankRunId: frankResult.runId,
              p95Sharpe: frankResult.p95Sharpe,
              medianPf: frankResult.medianPf,
              fromState,
              toState,
            },
            "Frankenstein gate: PASSED — promotion allowed",
          );
        } catch (frankErr) {
          // Gate failure should fail-closed: if we can't read the result, block promotion.
          // A broken Frankenstein check is safer treated as a failed gate than an open one.
          const msg = frankErr instanceof Error ? frankErr.message : String(frankErr);
          const error = `Frankenstein gate: read failed (fail-closed). Error: ${msg}`;
          logger.warn(
            { strategyId: id, backtestId: promotionEvidence.backtestId, err: frankErr },
            "Frankenstein gate: read error — blocking promotion (fail-closed)",
          );
          // Wave 23H Fix 3: audit row on every rejection path (was logger.warn only)
          insertAuditRow({
            action: "lifecycle.frankenstein_rejected",
            entityType: "strategy",
            entityId: id,
            decisionAuthority: "gate",
            status: "failure",
            input: { fromState, toState, backtestId: promotionEvidence.backtestId } as Record<string, unknown>,
            result: { decision: "infrastructure_error", reason: msg } as Record<string, unknown>,
            correlationId: options.correlationId ?? null,
          }).catch((auditErr: unknown) => logger.error({ err: auditErr, strategyId: id }, "A4: infra_error audit row write failed"));
          return { success: false, error };
        }
      } else {
        // No backtestId in evidence — can't look up Frankenstein result.
        // Fail-closed: require a backtest before promotion.
        const error =
          "Frankenstein gate: no backtest ID found in evidence — cannot verify Frankenstein test. " +
          "Run a backtest and Frankenstein test before promoting to PAPER.";
        logger.warn({ strategyId: id, fromState, toState }, error);
        // Wave 23H Fix 3: audit row on every rejection path (was logger.warn only)
        insertAuditRow({
          action: "lifecycle.frankenstein_rejected",
          entityType: "strategy",
          entityId: id,
          decisionAuthority: "gate",
          status: "failure",
          input: { fromState, toState, backtestId: null } as Record<string, unknown>,
          result: { decision: "no_backtest_id", reason: "no backtest ID in promotion evidence" } as Record<string, unknown>,
          correlationId: options.correlationId ?? null,
        }).catch((err: unknown) => logger.error({ err, strategyId: id }, "A4: no_backtest_id audit row write failed"));
        return { success: false, error };
      }
    }

    // Atomic write block: state update + (optional) name retire + audit rows.
    // If a caller provided a tx we run inline against it (caller owns commit/rollback);
    // otherwise we open a fresh db.transaction() for these writes.
    const writeBlock = async (txCtx: typeof db): Promise<void> => {
      // CRITICAL #2: Add AND lifecycleState = fromState to the WHERE clause.
      // Two concurrent callers (cron + manual API) can both pass the pre-tx state read
      // and both attempt to UPDATE. With the state guard, only the first writer succeeds;
      // the second gets back an empty RETURNING array and we roll back with a conflict error.
      const updatedRows = await txCtx
        .update(strategies)
        .set({
          lifecycleState: toState,
          lifecycleChangedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(strategies.id, id), eq(strategies.lifecycleState, fromState)))
        .returning({ id: strategies.id });

      if (!updatedRows || updatedRows.length === 0) {
        // Another concurrent caller already transitioned this strategy out of fromState.
        // Write a race_blocked audit row for observability then throw so the transaction rolls back.
        await txCtx.insert(auditLog).values({
          action: "lifecycle.race_blocked",
          entityType: "strategy",
          entityId: id,
          input: { fromState, toState },
          result: {
            reason: "concurrent_promotion: strategy was no longer in fromState when UPDATE executed",
            actor: options.actor ?? "system",
            correlationId: options.correlationId ?? null,
          },
          status: "failure",
          decisionAuthority: "gate",
          correlationId: options.correlationId ?? null,
        });
        throw new Error(`lifecycle.race_blocked: strategy ${id} was no longer in '${fromState}' when the update executed — concurrent promotion detected`);
      }

      // Retire Forge name when strategy transitions to RETIRED.
      // Must be inside the transaction so name-retire and lifecycle update commit together.
      if (toState === "RETIRED") {
        const [retiredName] = await txCtx
          .update(strategyNames)
          .set({ retired: true, retiredAt: new Date() })
          .where(eq(strategyNames.strategyId, id))
          .returning();
        if (retiredName) {
          retiredCodename = retiredName.codename;
        }
      }

      // Audit row for the lifecycle transition itself (FIX 2: includes evidence snapshot)
      await txCtx.insert(auditLog).values({
        action: "strategy.lifecycle",
        entityType: "strategy",
        entityId: id,
        input: { fromState, toState },
        result: {
          success: true,
          actor: options.actor ?? "system",
          reason: options.reason ?? null,
          backtestId: promotionEvidence.backtestId,
          forgeScore: promotionEvidence.forgeScore,
          mcSurvivalRate: promotionEvidence.mcSurvivalRate,
        },
        status: "success",
        decisionAuthority: options.actor === "human_release" ? "human" : "gate",
        correlationId: options.correlationId ?? null,
      });

      // Tier 0.1 dual-write: typed lifecycle_transitions row alongside the
      // audit_log row. Both inserts run inside the same transaction so the
      // audit_log + lifecycle_transitions + strategy.lifecycle_state always
      // commit/roll back as a unit. Synchronous, no fire-and-forget.
      //
      // Tier 1.1 QAE shadow: quantum challenger evidence columns are now
      // populated from promotionEvidence (computed above, outside the tx).
      // Phase 0: gate behavior is 100% classical — quantum values are
      // observation-only. The partial index idx_lifecycle_transitions_quantum_agreement
      // begins filling as QMC runs accumulate for tested backtests.
      await txCtx.insert(lifecycleTransitions).values({
        strategyId: id,
        fromState,
        toState,
        decisionAuthority: options.actor === "human_release" ? "human" : "gate",
        reason: options.reason ?? null,
        backtestId: promotionEvidence.backtestId,
        forgeScore: promotionEvidence.forgeScore != null ? String(promotionEvidence.forgeScore) : null,
        mcSurvivalRate: promotionEvidence.mcSurvivalRate != null ? String(promotionEvidence.mcSurvivalRate) : null,
        // Tier 1.1 QAE shadow — populated when a completed quantum_mc_runs row exists
        // for the latest backtest. Null when no QMC run has been performed yet (expected
        // during Phase 0 ramp-up). AUTHORITY BOUNDARY: these values are advisory only.
        quantumAgreementScore: promotionEvidence.quantumAgreementScore != null
          ? String(promotionEvidence.quantumAgreementScore)
          : null,
        quantumAdvantageDelta: promotionEvidence.quantumAdvantageDelta != null
          ? String(promotionEvidence.quantumAdvantageDelta)
          : null,
        quantumFallbackTriggered: promotionEvidence.quantumFallbackTriggered,
        quantumClassicalDisagreementPct: promotionEvidence.quantumClassicalDisagreementPct != null
          ? String(promotionEvidence.quantumClassicalDisagreementPct)
          : null,
        cloudQmcRunId: null,
      });

      // Pending-burial audit row for DECLINING/RETIRED.
      // Written inside the transaction so the burial *intent* is durable even if
      // the post-commit fire-and-forget buryInGraveyard() crashes. Future replays
      // can scan for graveyard_burial_pending rows that lack a matching
      // strategy_graveyard row and re-run the burial.
      if (toState === "DECLINING" || toState === "RETIRED") {
        await txCtx.insert(auditLog).values({
          action: "strategy.graveyard_burial_pending",
          entityType: "strategy",
          entityId: id,
          input: { fromState, toState },
          result: {
            actor: options.actor ?? "system",
            reason: options.reason ?? null,
            burial_trigger: toState === "DECLINING" ? "demotion" : "retirement",
          },
          status: "pending",
          decisionAuthority: options.actor === "human_release" ? "human" : "gate",
          correlationId: options.correlationId ?? null,
        });
      }
    };

    try {
      if (tx) {
        // Caller owns the transaction — run inline, do not open a new tx.
        await writeBlock(tx);
      } else {
        // Standalone path — open a transaction. On throw, the entire unit rolls back.
        await db.transaction(async (innerTx) => {
          await writeBlock(innerTx as unknown as typeof db);
        });
      }
    } catch (writeErr) {
      // CRITICAL #2: race_blocked is a clean conflict — surface as { success: false }
      // rather than propagating an exception so callers can handle it gracefully.
      const errMsg = writeErr instanceof Error ? writeErr.message : String(writeErr);
      if (errMsg.startsWith("lifecycle.race_blocked:")) {
        logger.warn({ strategyId: id, fromState, toState, correlationId: options.correlationId }, errMsg);
        return { success: false, error: errMsg };
      }
      // All other transaction errors propagate normally (atomicity guarantee).
      throw writeErr;
    }

    // ── Post-commit side effects ────────────────────────────────────────────
    // Everything below this line runs ONLY after the transaction commits
    // successfully. SSE/fire-and-forget burial NEVER fires on rollback.

    if (retiredCodename) {
      logger.info({ strategyId: id, codename: retiredCodename }, "Forge name retired with strategy");
    }

    // F-11 FIX: Only bury on truly terminal states (GRAVEYARD, RETIRED).
    // DECLINING is retry-eligible per VALID_TRANSITIONS (DECLINING → TESTING/RETIRED/GRAVEYARD)
    // and must NOT be buried — burial here would create a graveyard record for a strategy
    // that may still be promoted via checkDeclingAndTriggerRegen(). Burial on DECLINING
    // was causing premature graveyard records that blocked re-entry into TESTING.
    if (toState === "GRAVEYARD" || toState === "RETIRED") {
      this.buryInGraveyard(id, strategy, options.correlationId).catch((buryErr) => {
        logger.warn(
          { strategyId: id, toState, err: buryErr },
          "Failed to auto-bury strategy in graveyard (non-blocking — pending audit row exists)",
        );
      });
    }

    // ── Tier 4.5 cloud QMC enrichment: enqueue AFTER TESTING→PAPER promotion ──
    // Phase 0 shadow: enqueue is ALWAYS async and NEVER blocks promotion.
    // Classical promotion is already committed above. This fire-and-forget runs
    // best-effort, 24h enrichment window. Promotion decision is UNCHANGED.
    //
    // AUTHORITY BOUNDARY:
    //   - Classical promotion completes FIRST (already committed above).
    //   - enqueueCloudQmcRun() is fire-and-forget: promotion NEVER waits.
    //   - cloud_qmc_runs.governance_labels.decision_role = "challenger_only"
    //   - Lifecycle gate is 100% classical. Cloud QMC is observation-only.
    //   - Matches W3b Tier 3.4 Grover shadow pattern (same post-commit placement).
    //
    // Default OFF: QUANTUM_CLOUD_ENABLED env flag must be "true" to enable IBM
    // submissions. Without the flag, enqueueCloudQmcRun logs and returns quietly.
    if (fromState === "TESTING" && toState === "PAPER") {
      const cloudQmcEnabled = (process.env.QUANTUM_CLOUD_ENABLED ?? "").toLowerCase() === "true";
      if (cloudQmcEnabled) {
        import("./cloud-qmc-service.js").then(({ enqueueCloudQmcRun }) => {
          enqueueCloudQmcRun({
            strategyId: id,
            backtestId: promotionEvidence.backtestId ?? "",
            classicalRuinProb: promotionEvidence.mcSurvivalRate != null
              ? 1 - promotionEvidence.mcSurvivalRate
              : null,
            localIaeEstimate: promotionEvidence.quantumAgreementScore,
          }).catch((cloudErr) => {
            logger.warn(
              { strategyId: id, err: cloudErr },
              "cloud-qmc: enqueueCloudQmcRun failed (non-blocking — promotion unaffected, Phase 0 shadow)",
            );
          });
        }).catch((importErr) => {
          logger.warn(
            { strategyId: id, err: importErr },
            "cloud-qmc: service import failed (non-blocking — promotion unaffected)",
          );
        });
        logger.info(
          { strategyId: id, fromState, toState },
          "cloud-qmc: async enrichment enqueued post-promotion (challenger-only, Phase 0 shadow, never blocks)",
        );
      } else {
        logger.debug(
          { strategyId: id, fromState, toState },
          "cloud-qmc: QUANTUM_CLOUD_ENABLED=false — IBM enrichment skipped, promotion unaffected",
        );
      }
    }

    strategyPromotions.labels({
      from_state: fromState,
      to_state: toState,
      actor: options.actor ?? "system",
    }).inc();

    logger.info({ id, fromState, toState }, "Strategy lifecycle transition");
    return { success: true };
  }

  /**
   * Bury a retired strategy in the graveyard for duplicate-checking.
   * Loads the latest backtest, extracts failure modes, inserts graveyard row.
   */
  private async buryInGraveyard(
    strategyId: string,
    strategy: { name: string; config: unknown },
    correlationId?: string,
  ): Promise<void> {
    // Check if already buried (idempotent)
    const [existing] = await db
      .select({ id: strategyGraveyard.id })
      .from(strategyGraveyard)
      .where(eq(strategyGraveyard.strategyId, strategyId))
      .limit(1);
    if (existing) return;

    // Fetch latest completed backtest for failure analysis
    const [latestBt] = await db
      .select()
      .from(backtests)
      .where(
        and(
          eq(backtests.strategyId, strategyId),
          eq(backtests.status, "completed"),
        ),
      )
      .orderBy(desc(backtests.createdAt))
      .limit(1);

    // Derive failure modes from metrics
    const failureModes: string[] = [];
    if (latestBt) {
      const sharpe = Number(latestBt.sharpeRatio ?? 0);
      const pf = Number(latestBt.profitFactor ?? 0);
      const wr = Number(latestBt.winRate ?? 0);
      const dd = Number(latestBt.maxDrawdown ?? 0);
      const avgDaily = Number(latestBt.avgDailyPnl ?? 0);

      if (sharpe < 0.8) failureModes.push("low_sharpe");
      if (pf < 1.0) failureModes.push("unprofitable");
      if (wr < 0.4) failureModes.push("low_win_rate");
      if (dd > 3000) failureModes.push("excessive_drawdown");
      if (avgDaily < 250) failureModes.push("below_minimum_daily_pnl");
      if (latestBt.tier === "REJECTED") failureModes.push("rejected_by_gate");
    }
    if (failureModes.length === 0) failureModes.push("alpha_decay");

    const backtestSummary = latestBt
      ? {
          sharpe: latestBt.sharpeRatio,
          profitFactor: latestBt.profitFactor,
          winRate: latestBt.winRate,
          maxDrawdown: latestBt.maxDrawdown,
          avgDailyPnl: latestBt.avgDailyPnl,
          tier: latestBt.tier,
          totalTrades: latestBt.totalTrades,
        }
      : null;

    await db.insert(strategyGraveyard).values({
      strategyId,
      name: strategy.name,
      dslSnapshot: strategy.config ?? {},
      failureModes,
      failureDetails: { backtestId: latestBt?.id ?? null, autoAnalysis: true },
      backtestSummary,
      deathReason: `Auto-retired: ${failureModes.join(", ")}`,
      deathDate: new Date(),
      source: "auto",
    });

    // Audit trail — graveyard burial is a non-reversible terminal transition
    // Track A F-6: migrated to insertAuditRowSafe
    await insertAuditRowSafe({
      action: "strategy.graveyard_burial",
      entityType: "strategy",
      entityId: strategyId,
      input: {
        name: strategy.name,
        source: "auto",
        failureModes,
      },
      result: {
        deathReason: `Auto-retired: ${failureModes.join(", ")}`,
        backtestId: latestBt?.id ?? null,
        backtestSummary,
      },
      status: "success",
      decisionAuthority: "gate",
      correlationId: correlationId ?? null,
    });

    // Fire alert for visibility
    AlertFactory.decayAlert(strategyId, "retire").catch(() => {});

    logger.info(
      { strategyId, failureModes, name: strategy.name },
      "Strategy auto-buried in graveyard",
    );
  }

  /**
   * Check for auto-promotions across all lifecycle gates:
   *   1. CANDIDATE → TESTING  (backtest + WF + tier + forgeScore)
   *   2. TESTING → PAPER      (MC survival + tier)
   *   3. PAPER → DEPLOY_READY (30 profitable days + rolling Sharpe)
   *
   * DEPLOY_READY → DEPLOYED is ALWAYS manual. The system NEVER auto-deploys.
   */
  async checkAutoPromotions(context?: { correlationId?: string }): Promise<string[]> {
    const correlationId = context?.correlationId ?? null;

    // HIGH #13: killSwitch is the FIRST gate on every lifecycle-mutating entry path.
    // CLAUDE.md §12 mandates this; lifecycle mutations are entry paths.
    if (await killSwitch.isHaltedForProduction()) {
      logger.warn({ correlationId, fn: "checkAutoPromotions" }, "Skipping — killSwitch halted");
      return [];
    }

    const promoted: string[] = [];

    // ──────────────────────────────────────────────────────────────
    // Gate 1: CANDIDATE → TESTING
    // Requires: completed backtest with walk-forward, non-REJECTED tier, forgeScore >= 50
    // ──────────────────────────────────────────────────────────────
    const candidates = await db
      .select()
      .from(strategies)
      .where(eq(strategies.lifecycleState, "CANDIDATE"));

    for (const s of candidates) {
      try {
        // Find latest completed backtest
        const [latestBt] = await db
          .select()
          .from(backtests)
          .where(
            and(
              eq(backtests.strategyId, s.id),
              eq(backtests.status, "completed"),
            ),
          )
          .orderBy(desc(backtests.createdAt))
          .limit(1);

        if (!latestBt) continue;
        if (!latestBt.walkForwardResults) continue;

        const tier = latestBt.tier;
        if (!tier || tier === "REJECTED") continue;

        const forgeScore = s.forgeScore ? parseFloat(String(s.forgeScore)) : 0;
        if (forgeScore < 50) continue;

        const result = await this.promoteStrategy(s.id, "CANDIDATE", "TESTING", { correlationId: correlationId ?? undefined });
        if (result.success) {
          promoted.push(s.id);

          broadcastSSE("lifecycle:promoted", {
            strategyId: s.id,
            from: "CANDIDATE",
            to: "TESTING",
            name: s.name,
            forgeScore,
            tier,
          });

          // Mirror onto the typed agent event bus so cross-domain subscribers fire.
          // Existing SSE consumers are unaffected (additive).
          agentCoordinator.emit("strategy:promoted", {
            strategyId: s.id,
            from: "CANDIDATE",
            to: "TESTING",
          }).catch((emitErr) => {
            logger.warn({ strategyId: s.id, err: emitErr }, "agentCoordinator emit failed (non-blocking)");
          });

          logger.info(
            { id: s.id, forgeScore, tier },
            "Auto-promoted CANDIDATE → TESTING",
          );
        }
      } catch (err) {
        logger.error({ strategyId: s.id, err }, "Error checking CANDIDATE → TESTING promotion");
      }
    }

    // ──────────────────────────────────────────────────────────────
    // Gate 2: TESTING → PAPER
    // Requires: completed backtest with WF, MC survival > 0.70, non-REJECTED tier
    // Prop compliance is checked if data exists but does NOT block if absent
    // ──────────────────────────────────────────────────────────────
    const testingStrategies = await db
      .select()
      .from(strategies)
      .where(eq(strategies.lifecycleState, "TESTING"));

    for (const s of testingStrategies) {
      try {
        // Find latest completed backtest with walk-forward
        const [latestBt] = await db
          .select()
          .from(backtests)
          .where(
            and(
              eq(backtests.strategyId, s.id),
              eq(backtests.status, "completed"),
            ),
          )
          .orderBy(desc(backtests.createdAt))
          .limit(1);

        if (!latestBt) continue;
        if (!latestBt.walkForwardResults) continue;

        const tier = latestBt.tier;
        if (!tier || tier === "REJECTED") continue;

        // HIGH #14: Backtest staleness gate — TESTING → PAPER auto-check path.
        // Default BACKTEST_STALENESS_DAYS=30; env-configurable.
        {
          const stalenessDays = parseInt(process.env.BACKTEST_STALENESS_DAYS ?? "30", 10);
          const ageMs = Date.now() - new Date(latestBt.createdAt).getTime();
          const ageDays = ageMs / (1000 * 60 * 60 * 24);
          if (ageDays > stalenessDays) {
            logger.warn({ strategyId: s.id, ageDays: ageDays.toFixed(1), stalenessDays }, "TESTING → PAPER blocked (auto-check): backtest too old");
            await db.insert(auditLog).values({
              action: "lifecycle.backtest_stale",
              entityType: "strategy",
              entityId: s.id,
              status: "failure",
              decisionAuthority: "gate",
              input: { fromState: "TESTING", toState: "PAPER" },
              result: {
                reason: "backtest_too_old",
                age_days: parseFloat(ageDays.toFixed(1)),
                limit_days: stalenessDays,
                backtest_created_at: latestBt.createdAt,
              },
              correlationId,
            }).catch((auditErr) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "lifecycle.backtest_stale auto-check audit insert failed (non-blocking)");
            });
            continue;
          }
        }

        // Check MC survival rate > 0.70
        const [mcRun] = await db
          .select({
            probabilityOfRuin: monteCarloRuns.probabilityOfRuin,
          })
          .from(monteCarloRuns)
          .where(eq(monteCarloRuns.backtestId, latestBt.id))
          .orderBy(desc(monteCarloRuns.createdAt))
          .limit(1);

        if (!mcRun) continue;

        const ruinProb = mcRun.probabilityOfRuin != null ? parseFloat(String(mcRun.probabilityOfRuin)) : null;
        if (ruinProb === null) continue;

        const survivalRate = 1 - ruinProb;
        if (survivalRate <= 0.70) {
          logger.debug(
            { id: s.id, survivalRate: survivalRate.toFixed(3) },
            "TESTING → PAPER blocked: MC survival rate <= 0.70",
          );
          continue;
        }

        // Prop compliance: check backtests.propCompliance if present, but don't block if absent
        // The propCompliance field is a per-firm results blob set during backtest
        if (latestBt.propCompliance) {
          const propResults = latestBt.propCompliance as Record<string, { passed?: boolean; pass?: boolean }>;
          const anyPassing = Object.values(propResults).some(
            (r) => r.passed === true || r.pass === true,
          );
          if (!anyPassing) {
            logger.debug(
              { id: s.id },
              "TESTING → PAPER blocked: no passing prop compliance result",
            );
            continue;
          }
        }
        // If propCompliance is null/undefined, skip this check — don't block on missing optional data

        // P0-1: Compliance-drift gate. TESTING→PAPER puts a strategy on the
        // live-track; if any firm whose rules it qualified for has
        // driftDetected=true on its latest ruleset, the static
        // backtests.propCompliance result is no longer trustworthy. Block the
        // promotion (audit row, no SSE — drift is a system-wide guard, not a
        // strategy-specific event) and let the next scheduler tick retry once
        // the human revalidates the ruleset.
        {
          const passingFirmNames = passingFirmNamesFromCompliance(latestBt.propCompliance);
          if (passingFirmNames.length > 0) {
            const driftFirms = await findFirmsWithComplianceDrift(passingFirmNames);
            if (driftFirms.length > 0) {
              logger.warn(
                { strategyId: s.id, driftFirms, transition: "TESTING→PAPER" },
                "TESTING → PAPER blocked: compliance ruleset drift detected",
              );
              await db.insert(auditLog).values({
                action: "lifecycle.promotion_blocked_compliance_drift",
                entityId: s.id,
                entityType: "strategy",
                status: "failure",
                decisionAuthority: "gate",
                input: { fromState: "TESTING", toState: "PAPER" },
                result: {
                  firms_with_drift: driftFirms,
                  qualifying_firms: passingFirmNames,
                  reason: "compliance ruleset drift_detected — promotion held until human revalidation",
                },
                correlationId,
              }).catch((auditErr) => {
                logger.warn({ strategyId: s.id, err: auditErr }, "compliance-drift audit insert failed (non-blocking)");
              });
              continue;
            }
          }
        }

        // P0-2 part 2: Compliance gate at promotion time. The same
        // compliance_gate.py module that runs at every paper-execution bar
        // also runs here, giving us belt-and-suspenders protection: a
        // strategy that fails the freshness/violation check must never reach
        // PAPER even if a 6h scheduler tick catches up before the per-bar
        // gate. Drift gate above already filters on driftDetected; this
        // gate adds the freshness window check and surfaces "no_ruleset"
        // cases that the drift gate silently lets through.
        {
          const passingFirmNames = passingFirmNamesFromCompliance(latestBt.propCompliance);
          if (passingFirmNames.length > 0) {
            try {
              const { firmsFailing, details } = await runComplianceGateForFirms(passingFirmNames);
              if (firmsFailing.length > 0) {
                logger.warn(
                  { strategyId: s.id, firmsFailing, details, transition: "TESTING→PAPER" },
                  "TESTING → PAPER blocked: compliance gate (freshness) failed",
                );
                await db.insert(auditLog).values({
                  action: "strategy.lifecycle.compliance_blocked",
                  entityId: s.id,
                  entityType: "strategy",
                  status: "failure",
                  decisionAuthority: "gate",
                  input: { fromState: "TESTING", toState: "PAPER" },
                  result: {
                    firms_failing: firmsFailing,
                    qualifying_firms: passingFirmNames,
                    details,
                    reason: "compliance_gate.check_freshness failed — promotion held until ruleset is fresh and violation-free",
                  },
                  correlationId,
                }).catch((auditErr) => {
                  logger.warn({ strategyId: s.id, err: auditErr }, "compliance_blocked audit insert failed (non-blocking)");
                });
                broadcastSSE("strategy:compliance_blocked", {
                  strategyId: s.id,
                  name: s.name,
                  fromState: "TESTING",
                  toState: "PAPER",
                  firmsFailing,
                  details,
                });
                continue;
              }
            } catch (gateErr) {
              // Subprocess infrastructure failure (not a per-firm fail) —
              // fail closed, mirror runComplianceGateForFirms's posture.
              logger.error(
                { strategyId: s.id, err: gateErr, transition: "TESTING→PAPER" },
                "TESTING → PAPER blocked: compliance gate threw at the wrapper level",
              );
              await db.insert(auditLog).values({
                action: "strategy.lifecycle.compliance_blocked",
                entityId: s.id,
                entityType: "strategy",
                status: "failure",
                decisionAuthority: "gate",
                input: { fromState: "TESTING", toState: "PAPER" },
                result: {
                  qualifying_firms: passingFirmNames,
                  reason: "compliance_gate wrapper threw",
                  error: gateErr instanceof Error ? gateErr.message : String(gateErr),
                },
                correlationId,
              }).catch(() => {});
              broadcastSSE("strategy:compliance_blocked", {
                strategyId: s.id,
                name: s.name,
                fromState: "TESTING",
                toState: "PAPER",
                error: gateErr instanceof Error ? gateErr.message : String(gateErr),
              });
              continue;
            }
          }
        }

        // C4: Survival score gate — require survival_score >= 60 before TESTING → PAPER.
        // The survival scorer (survival_scorer.py) measures prop-firm survivability across
        // 7 dimensions (daily breach prob, DD breach, consistency, recovery, worst month,
        // commission drag, eval speed). A strategy that looks profitable in backtests but
        // has poor survival characteristics will breach firm rules in live trading.
        // Score < 60 means the strategy is likely to hit daily loss limits or DD limits.
        //
        // Read source: backtests.gateResult (JSONB) — populated by backtest-service.ts:358
        // from the Python run_backtest result.gate_result. The Python contract is:
        //   { score, passed, components: { raw_survival_score, survival_optimizer, ... },
        //     crisis_veto, crisis_veto_reason, tier, gate_rejections }
        // (Pre-fix this read targeted backtests.forgeScore which is a numeric column,
        //  so `typeof === "object"` was always false and this entire gate was dead code.)
        const gateResult = latestBt.gateResult as Record<string, unknown> | null | undefined;
        if (gateResult && typeof gateResult === "object") {
          const components = (gateResult.components as Record<string, number> | undefined) ?? undefined;
          // Python emits `raw_survival_score` (the unscaled 0-100 score) in components.
          // The C4 gate operates on the raw score, NOT the weighted survival_optimizer
          // sub-score. Falls back to legacy `survival_score` key for forward-compat.
          const rawSurvivalScore = components?.raw_survival_score ?? components?.survival_score ?? null;
          if (rawSurvivalScore !== null && rawSurvivalScore < 60) {
            logger.debug(
              { id: s.id, rawSurvivalScore },
              "TESTING → PAPER blocked: survival-score-below-threshold",
            );
            // Audit the block reason explicitly
            await db.insert(auditLog).values({
              action: "strategy.lifecycle.blocked",
              entityId: s.id,
              entityType: "strategy",
              status: "failure",
              decisionAuthority: "gate",
              result: {
                reason: "survival-score-below-threshold",
                survival_score: rawSurvivalScore,
                minimum_required: 60,
                from: "TESTING",
                to: "PAPER",
              },
              correlationId,
            });
            continue;
          }
        } else {
          // Permissive fallback: legacy backtests written before gateResult was persisted
          // do not have survival-score data. Let the strategy advance, but emit a structured
          // warning + audit row so the gap is queryable and replayable. Once gateResult
          // backfill catches up, this branch should rarely fire.
          logger.warn(
            { strategyId: s.id, backtestId: latestBt.id },
            "TESTING → PAPER: survival-score-gate-missing-data (gateResult absent on latest backtest, defaulting to permissive)",
          );
          await db.insert(auditLog).values({
            action: "survival-score-gate-missing-data",
            entityId: s.id,
            entityType: "strategy",
            status: "success",
            decisionAuthority: "gate",
            input: { fromState: "TESTING", toState: "PAPER" },
            result: {
              backtestId: latestBt.id,
              note: "gateResult JSONB missing on latest backtest — survival-score gate skipped, promotion proceeded",
            },
            correlationId,
          }).catch((auditErr) => {
            logger.warn({ strategyId: s.id, err: auditErr }, "survival-score-gate-missing-data audit insert failed (non-blocking)");
          });
        }

        // H2: Pine exportability pre-check (G6.3 wiring) — BLOCKING.
        // A strategy that cannot be exported to Pine cannot be deployed to TradingView,
        // so promoting it to PAPER would create a stuck DEPLOY_READY downstream.
        // Block the promotion, audit the block, broadcast SSE so the frontend surfaces it.
        let exportabilityBlocked = false;
        try {
          const { checkExportability } = await import("./pine-export-service.js");
          const exportCheck = await checkExportability(s.id);
          if (!exportCheck.ok) {
            logger.warn({
              strategyId: s.id,
              score: exportCheck.score,
              band: exportCheck.band,
              deductions: exportCheck.deductions,
              reasons: (exportCheck as Record<string, unknown>).reasons,
            }, "TESTING→PAPER: BLOCKED — strategy has Pine exportability issues");

            // Durable audit row so the block is queryable and replayable
            await db.insert(auditLog).values({
              action: "strategy.lifecycle.exportability_blocked",
              entityType: "strategy",
              entityId: s.id,
              decisionAuthority: "gate",
              input: { fromState: "TESTING", toState: "PAPER" },
              result: {
                reasons: (exportCheck as Record<string, unknown>).reasons ?? null,
                score: exportCheck.score,
                band: exportCheck.band,
                deductions: exportCheck.deductions,
              } as Record<string, unknown>,
              status: "failure",
              correlationId,
            }).catch(() => {});

            // SSE so the dashboard can surface the block to the operator
            broadcastSSE("strategy:exportability_blocked", {
              strategyId: s.id,
              name: s.name,
              fromState: "TESTING",
              toState: "PAPER",
              score: exportCheck.score,
              band: exportCheck.band,
              reasons: (exportCheck as Record<string, unknown>).reasons ?? null,
            });

            exportabilityBlocked = true;
          }
        } catch (err) {
          // checkExportability infra failure is informational (not a strategy failure) — do not block on infra errors
          logger.warn({ err, strategyId: s.id }, "checkExportability call failed (non-blocking, promotion continues)");
        }
        if (exportabilityBlocked) continue;

        const result = await this.promoteStrategy(s.id, "TESTING", "PAPER", { correlationId: correlationId ?? undefined });
        if (result.success) {
          promoted.push(s.id);

          broadcastSSE("lifecycle:promoted", {
            strategyId: s.id,
            from: "TESTING",
            to: "PAPER",
            name: s.name,
            survivalRate: survivalRate.toFixed(3),
            tier,
          });

          // Mirror onto the typed agent event bus so cross-domain subscribers fire.
          // Existing SSE consumers are unaffected (additive).
          agentCoordinator.emit("strategy:promoted", {
            strategyId: s.id,
            from: "TESTING",
            to: "PAPER",
          }).catch((emitErr) => {
            logger.warn({ strategyId: s.id, err: emitErr }, "agentCoordinator emit failed (non-blocking)");
          });

          logger.info(
            { id: s.id, survivalRate: survivalRate.toFixed(3), tier },
            "Auto-promoted TESTING → PAPER",
          );
        }
      } catch (err) {
        logger.error({ strategyId: s.id, err }, "Error checking TESTING → PAPER promotion");
      }
    }

    // ──────────────────────────────────────────────────────────────
    // Gate 2.5 — Wave 29 Pass A.3: SHADOW → PAPER (shadow-signal divergence)
    //
    // Catches training-serving skew before paper money is deployed.
    // Compare logged shadow signals (TradingView Pine WITHOUT TradersPost webhook)
    // against what the historical backtest expected for the same period.
    // Gate: ≥5% divergence across ≥20 signals = BLOCK SHADOW → PAPER.
    //
    // TODO (A.4 architect): A.1 (paper-parity, parallel) adds the SHADOW lifecycle
    // state and shadow_mode_enabled flag. Until that lands, this block is a
    // PLACEHOLDER that returns ok: true (PROCEED) so the existing TESTING → PAPER
    // path is unblocked. A.4 will reconcile by wiring:
    //   1. Query strategies WHERE lifecycle_state = 'SHADOW'
    //   2. Remove the placeholder ok=true short-circuit below
    //
    // Fail-soft contract: if shadow_signals table is missing or query throws,
    // emit lifecycle.shadow_divergence_check_unavailable_legacy warn + PROCEED
    // (grandfather window for pre-Wave-29 strategies).
    // ──────────────────────────────────────────────────────────────
    try {
      // Wave 29 Pass A.4 architect close: A.1's SHADOW lifecycle state landed in VALID_STATES;
      // real Drizzle query replaces the empty-array placeholder.
      const shadowStrategies = await db
        .select()
        .from(strategies)
        .where(eq(strategies.lifecycleState, "SHADOW"));

      for (const s of shadowStrategies) {
        try {
          const { shadowSignals: sSignals, backtestExpected } = await loadDivergenceInputs(s.id, 20);

          const divergenceResult = compareShadowToBacktest(sSignals, backtestExpected);

          if (!divergenceResult.ok) {
            const isInsufficientSamples = divergenceResult.reason === "insufficient_samples";
            const auditAction = isInsufficientSamples
              ? "lifecycle.shadow_divergence_insufficient_samples"
              : "lifecycle.shadow_divergence_blocked";

            logger.warn(
              {
                strategyId: s.id,
                divergence_pct: divergenceResult.divergence_pct,
                sample_size: divergenceResult.sample_size,
                reason: divergenceResult.reason,
                violations: divergenceResult.per_signal_violations.length,
              },
              `SHADOW → PAPER BLOCKED: ${divergenceResult.reason}`,
            );

            await db.insert(auditLog).values({
              action: auditAction,
              entityType: "strategy",
              entityId: s.id,
              status: "failure",
              decisionAuthority: "gate",
              input: { fromState: "SHADOW", toState: "PAPER" },
              result: {
                ok: false,
                divergence_pct: divergenceResult.divergence_pct,
                sample_size: divergenceResult.sample_size,
                reason: divergenceResult.reason,
                per_signal_violations: divergenceResult.per_signal_violations,
                note: "SHADOW → PAPER blocked by divergence gate (Wave 29 Pass A.3)",
              },
              correlationId,
            }).catch((auditErr: unknown) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "shadow divergence block audit insert failed (non-blocking)");
            });

            broadcastSSE("lifecycle:shadow_divergence_evaluated", {
              strategyId: s.id,
              ok: false,
              divergence_pct: divergenceResult.divergence_pct,
              sample_size: divergenceResult.sample_size,
              reason: divergenceResult.reason,
            });

            continue; // BLOCK SHADOW → PAPER
          }

          // ok: true — PROMOTE to PAPER
          logger.info(
            {
              strategyId: s.id,
              divergence_pct: divergenceResult.divergence_pct,
              sample_size: divergenceResult.sample_size,
            },
            "SHADOW → PAPER: divergence gate PASSED",
          );

          await db.insert(auditLog).values({
            action: "lifecycle.shadow_promotion_passed",
            entityType: "strategy",
            entityId: s.id,
            status: "success",
            decisionAuthority: "gate",
            input: { fromState: "SHADOW", toState: "PAPER" },
            result: {
              ok: true,
              divergence_pct: divergenceResult.divergence_pct,
              sample_size: divergenceResult.sample_size,
              note: "SHADOW → PAPER cleared by divergence gate (Wave 29 Pass A.3)",
            },
            correlationId,
          }).catch((auditErr: unknown) => {
            logger.warn({ strategyId: s.id, err: auditErr }, "shadow promotion passed audit insert failed (non-blocking)");
          });

          broadcastSSE("lifecycle:shadow_divergence_evaluated", {
            strategyId: s.id,
            ok: true,
            divergence_pct: divergenceResult.divergence_pct,
            sample_size: divergenceResult.sample_size,
          });

          const shadowResult = await this.promoteStrategy(s.id, "SHADOW", "PAPER", { correlationId: correlationId ?? undefined });
          if (shadowResult.success) {
            promoted.push(s.id);
            logger.info({ strategyId: s.id }, "Auto-promoted SHADOW → PAPER");
          }
        } catch (shadowStratErr: unknown) {
          // Fail-soft: shadow_signals table missing or query throws →
          // grandfather window for pre-Wave-29 strategies.
          logger.warn(
            { strategyId: s.id, err: shadowStratErr },
            "SHADOW → PAPER divergence check threw — emitting unavailable legacy warn + PROCEED",
          );

          await db.insert(auditLog).values({
            action: "lifecycle.shadow_divergence_check_unavailable_legacy",
            entityType: "strategy",
            entityId: s.id,
            status: "warning",
            decisionAuthority: "gate",
            input: { fromState: "SHADOW", toState: "PAPER" },
            result: {
              note: "shadow_divergence_check threw (legacy grandfather window) — promotion proceeds via classical gates",
              error: String(shadowStratErr),
            },
            correlationId,
          }).catch(() => {});

          // Proceed: classical gates still apply via promoteStrategy
          const legacyResult = await this.promoteStrategy(s.id, "SHADOW", "PAPER", { correlationId: correlationId ?? undefined });
          if (legacyResult.success) {
            promoted.push(s.id);
            logger.info({ strategyId: s.id }, "SHADOW → PAPER: proceeded via legacy fallback (grandfather window)");
          }
        }
      }
    } catch (shadowGateErr: unknown) {
      // Fail-soft: outer SHADOW query failure is non-blocking.
      logger.warn({ err: shadowGateErr }, "SHADOW → PAPER gate: outer query threw (non-blocking)");
    }

    // ──────────────────────────────────────────────────────────────
    // Gate 3: PAPER → DEPLOY_READY (30 distinct trading days + rolling Sharpe >= 1.5)
    // After promotion, fire-and-forget Pine compile for TradingView export.
    // DEPLOY_READY → DEPLOYED remains HUMAN-ONLY.
    //
    // Trading-day rule: count distinct calendar dates on which paper_trades closed
    // (exitTime) AFTER lifecycleChangedAt. This makes the gate honest — a strategy
    // promoted Monday cannot reach DEPLOY_READY on Saturday by sitting idle through
    // a weekend; it needs actual trade activity over 30 distinct days.
    // ──────────────────────────────────────────────────────────────
    const paperStrategies = await db
      .select()
      .from(strategies)
      .where(eq(strategies.lifecycleState, "PAPER"));

    for (const s of paperStrategies) {
      if (!s.lifecycleChangedAt) continue;

      // Count distinct trading days (paper_trades.exitTime dates) since this strategy
      // entered PAPER. paperTrades has sessionId not strategyId, so join via paperSessions.
      const tradeDays = await db
        .select({ day: sql<string>`DATE(${paperTrades.exitTime})` })
        .from(paperTrades)
        .innerJoin(paperSessions, eq(paperSessions.id, paperTrades.sessionId))
        .where(
          and(
            eq(paperSessions.strategyId, s.id),
            gte(paperTrades.exitTime, s.lifecycleChangedAt),
          ),
        )
        .groupBy(sql`DATE(${paperTrades.exitTime})`);
      const tradingDays = tradeDays.length;

      const rollingSharpe = s.rollingSharpe30d ? parseFloat(String(s.rollingSharpe30d)) : 0;
      if (tradingDays >= 30 && rollingSharpe >= 1.5) {
        // P0-1: Compliance-drift gate at PAPER → DEPLOY_READY. DEPLOY_READY is the
        // gate to deployment authorization — promoting a strategy whose firm rules
        // are stale would let the human approve a deployment based on a ruleset
        // that no longer matches reality. Block until human revalidates.
        try {
          const [latestBt] = await db
            .select({ propCompliance: backtests.propCompliance, createdAt: backtests.createdAt })
            .from(backtests)
            .where(
              and(
                eq(backtests.strategyId, s.id),
                eq(backtests.status, "completed"),
              ),
            )
            .orderBy(desc(backtests.createdAt))
            .limit(1);

          // HIGH #14: Backtest staleness gate — PAPER → DEPLOY_READY auto-check path.
          if (latestBt) {
            const stalenessDays = parseInt(process.env.BACKTEST_STALENESS_DAYS ?? "30", 10);
            const ageMs = Date.now() - new Date(latestBt.createdAt).getTime();
            const ageDays = ageMs / (1000 * 60 * 60 * 24);
            if (ageDays > stalenessDays) {
              logger.warn({ strategyId: s.id, ageDays: ageDays.toFixed(1), stalenessDays }, "PAPER → DEPLOY_READY blocked (auto-check): backtest too old");
              await db.insert(auditLog).values({
                action: "lifecycle.backtest_stale",
                entityType: "strategy",
                entityId: s.id,
                status: "failure",
                decisionAuthority: "gate",
                input: { fromState: "PAPER", toState: "DEPLOY_READY" },
                result: {
                  reason: "backtest_too_old",
                  age_days: parseFloat(ageDays.toFixed(1)),
                  limit_days: stalenessDays,
                  backtest_created_at: latestBt.createdAt,
                },
                correlationId,
              }).catch((auditErr) => {
                logger.warn({ strategyId: s.id, err: auditErr }, "lifecycle.backtest_stale PAPER audit insert failed (non-blocking)");
              });
              continue;  // skip to next strategy — inside the outer try
            }
          }

          if (latestBt?.propCompliance) {
            const passingFirmNames = passingFirmNamesFromCompliance(latestBt.propCompliance);
            if (passingFirmNames.length > 0) {
              const driftFirms = await findFirmsWithComplianceDrift(passingFirmNames);
              if (driftFirms.length > 0) {
                logger.warn(
                  { strategyId: s.id, driftFirms, transition: "PAPER→DEPLOY_READY" },
                  "PAPER → DEPLOY_READY blocked: compliance ruleset drift detected",
                );
                await db.insert(auditLog).values({
                  action: "lifecycle.promotion_blocked_compliance_drift",
                  entityId: s.id,
                  entityType: "strategy",
                  status: "failure",
                  decisionAuthority: "gate",
                  input: { fromState: "PAPER", toState: "DEPLOY_READY" },
                  result: {
                    firms_with_drift: driftFirms,
                    qualifying_firms: passingFirmNames,
                    reason: "compliance ruleset drift_detected — promotion held until human revalidation",
                  },
                  correlationId,
                }).catch((auditErr) => {
                  logger.warn({ strategyId: s.id, err: auditErr }, "compliance-drift audit insert failed (non-blocking)");
                });
                continue;
              }
            }
          }
        } catch (driftCheckErr) {
          // F-6 FIX: Drift-check infrastructure failure must fail-CLOSED, symmetric
          // with TESTING→PAPER (A7 gate at lines ~1888-1910 fail-closed on infra error).
          // A broken drift check on a promotion-gate boundary is NOT informational —
          // promoting a strategy whose compliance ruleset we cannot verify could send
          // live orders against stale firm rules. Operator manual override required.
          const errMsg = driftCheckErr instanceof Error ? driftCheckErr.message : String(driftCheckErr);
          logger.warn(
            { strategyId: s.id, err: driftCheckErr },
            "PAPER → DEPLOY_READY drift-check threw — blocking promotion (fail-closed, manual override required)",
          );
          await db.insert(auditLog).values({
            action: "lifecycle.drift_check_infra_error",
            entityId: s.id,
            entityType: "strategy",
            status: "failure",
            decisionAuthority: "gate",
            input: { fromState: "PAPER", toState: "DEPLOY_READY" },
            result: {
              reason: "drift_check_infrastructure_error",
              error: errMsg,
              note: "Manual operator override required — cannot verify compliance ruleset integrity",
            },
            correlationId,
          }).catch((auditErr) => {
            logger.warn({ strategyId: s.id, err: auditErr }, "lifecycle.drift_check_infra_error audit insert failed (non-blocking)");
          });
          continue;
        }

        // ── B10: MRP Soft Gate: PAPER → DEPLOY_READY advisory ────────────────
        // SOFT gate: MRP > 0.5 is advisory for now. Hard gate activates after
        // 30 days of MRP data accumulates. Log at WARN if violated; never block.
        //
        // mrp_sharpe is computed post-backtest (fire-and-forget). If null (pre-B10
        // backtest or no regime data), log advisory and continue — never block.
        try {
          const [mrpBacktest] = await db
            .select({ mrpSharpe: backtests.mrpSharpe, mrpRegimeBreakdown: backtests.mrpRegimeBreakdown })
            .from(backtests)
            .where(
              and(
                eq(backtests.strategyId, s.id),
                eq(backtests.status, "completed"),
              ),
            )
            .orderBy(desc(backtests.createdAt))
            .limit(1);

          if (mrpBacktest?.mrpSharpe != null) {
            const mrpValue = parseFloat(String(mrpBacktest.mrpSharpe));
            const MRP_SOFT_THRESHOLD = 0.5;

            if (mrpValue < MRP_SOFT_THRESHOLD) {
              logger.warn(
                {
                  strategyId: s.id,
                  mrpSharpe: mrpValue.toFixed(3),
                  threshold: MRP_SOFT_THRESHOLD,
                  regimeBreakdown: mrpBacktest.mrpRegimeBreakdown,
                  transition: "PAPER→DEPLOY_READY",
                },
                "B10 MRP soft gate: mrp_sharpe < 0.5 — strategy has regime-conditional fragility (advisory only, promotion continues)",
              );
              // Log advisory audit row so analysts can track MRP violations over time
              await db.insert(auditLog).values({
                action: "lifecycle.mrp_soft_gate_advisory",
                entityId: s.id,
                entityType: "strategy",
                status: "success",  // advisory — not a block
                decisionAuthority: "gate",
                input: { fromState: "PAPER", toState: "DEPLOY_READY" },
                result: {
                  mrp_sharpe: mrpValue,
                  threshold: MRP_SOFT_THRESHOLD,
                  regime_breakdown: mrpBacktest.mrpRegimeBreakdown,
                  gate_phase: "soft_advisory",
                  note: "Hard gate activates after 30 days of MRP data",
                },
                correlationId,
              }).catch((auditErr) => {
                logger.warn({ strategyId: s.id, err: auditErr }, "B10 MRP advisory audit insert failed (non-blocking)");
              });
            } else {
              logger.info(
                { strategyId: s.id, mrpSharpe: mrpValue.toFixed(3), transition: "PAPER→DEPLOY_READY" },
                "B10 MRP soft gate: mrp_sharpe >= 0.5 — PASSED",
              );
            }
          } else {
            // No MRP data yet — pre-B10 backtest or strategy with no regime data
            logger.info(
              { strategyId: s.id, transition: "PAPER→DEPLOY_READY" },
              "B10 MRP soft gate: no mrp_sharpe data — advisory skipped (pre-B10 backtest)",
            );
          }
        } catch (mrpGateErr) {
          // Non-blocking — MRP gate read failure must never abort promotion
          logger.warn(
            { strategyId: s.id, err: mrpGateErr },
            "B10 MRP soft gate: read failed (non-blocking — promotion continues)",
          );
        }

        // ── A7: Signal Correlation Gate: PAPER → DEPLOY_READY hard block ──────
        // Fail-closed: block promotion if the candidate strategy's signal vector
        // has cosine similarity > 0.85 with ANY DEPLOYED strategy.
        // Also blocks if no signal vector exists (strategy must have completed
        // a backtest that emitted signal_vector via backtester.py A7 changes).
        //
        // Ramp-up mode: if no DEPLOYED strategies have signal vectors yet (pre-A7
        // backtests), the gate passes with a warning. This prevents A7 from
        // permanently blocking all promotions during initial deployment.
        //
        // Authority: HARD GATE (fail-closed). Does NOT override classical gates.
        // Additive to existing Frankenstein, compliance-drift, and Sharpe gates.
        try {
          const { checkSignalCorrelationGate } = await import("./signal-correlation-service.js");
          const sigCorrelationResult = await checkSignalCorrelationGate(s.id);

          if (!sigCorrelationResult.allowed) {
            logger.warn(
              {
                strategyId: s.id,
                reason: sigCorrelationResult.reason,
                maxSimilarity: sigCorrelationResult.maxSimilarity,
                blockingStrategyId: sigCorrelationResult.blockingStrategyId,
                transition: "PAPER→DEPLOY_READY",
              },
              "A7 signal correlation gate: BLOCKED PAPER→DEPLOY_READY promotion",
            );
            await db.insert(auditLog).values({
              action: "lifecycle.promotion_blocked_signal_correlation",
              entityId: s.id,
              entityType: "strategy",
              status: "failure",
              decisionAuthority: "gate",
              input: { fromState: "PAPER", toState: "DEPLOY_READY" },
              result: {
                reason: sigCorrelationResult.reason,
                max_similarity: sigCorrelationResult.maxSimilarity,
                blocking_strategy_id: sigCorrelationResult.blockingStrategyId,
                threshold: 0.85,
              },
              correlationId,
            }).catch((auditErr) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "A7 audit insert failed (non-blocking)");
            });
            continue;
          }

          logger.info(
            {
              strategyId: s.id,
              reason: sigCorrelationResult.reason,
              maxSimilarity: sigCorrelationResult.maxSimilarity,
              transition: "PAPER→DEPLOY_READY",
            },
            "A7 signal correlation gate: PASSED",
          );
        } catch (sigCorrelationErr) {
          // Fail-closed on infrastructure error — same policy as Frankenstein gate.
          // A broken correlation check is safer treated as a failed gate than an
          // open one (a strategy promoted on a broken gate could be a signal duplicate).
          const msg = sigCorrelationErr instanceof Error ? sigCorrelationErr.message : String(sigCorrelationErr);
          logger.warn(
            { strategyId: s.id, err: sigCorrelationErr },
            "A7 signal correlation gate: infrastructure error — blocking promotion (fail-closed)",
          );
          await db.insert(auditLog).values({
            action: "lifecycle.promotion_blocked_signal_correlation",
            entityId: s.id,
            entityType: "strategy",
            status: "failure",
            decisionAuthority: "gate",
            input: { fromState: "PAPER", toState: "DEPLOY_READY" },
            result: {
              reason: `A7 gate infrastructure error (fail-closed): ${msg}`,
              max_similarity: null,
              blocking_strategy_id: null,
              threshold: 0.85,
            },
            correlationId,
          }).catch(() => {});
          continue;
        }

        // ── Wave 24 Item 9: B14 Survival Twin HARD gate: PAPER → DEPLOY_READY ──
        // PropScorer 2026-03: Topstep documented $40K payout-denial bans for
        // consistency violations. B14 must HARD-block before any live payout claim.
        // Env: B14_HARD_GATE_ENABLED (default "true") — set "false" for emergency disable.
        //
        // Wave 27.5 Pass B.2: B14 now ALSO reads probability_of_ruin_ci.ci_high from
        // the latest MC run (Pass A introduced BCa CI bootstrap). When ci_high > threshold
        // (default 0.40, env B14_RUIN_CI_HIGH_THRESHOLD), the gate hard-blocks.
        // Falls back to scalar probability_of_ruin for pre-Pass-A MC runs.
        const b14HardGateEnabled = (process.env.B14_HARD_GATE_ENABLED ?? "true") !== "false";
        if (b14HardGateEnabled) {
          try {
            const [latestBtForB14] = await db
              .select({
                id: backtests.id,
                gateResult: backtests.gateResult,
                resultExtras: backtests.resultExtras,
              })
              .from(backtests)
              .where(
                and(
                  eq(backtests.strategyId, s.id),
                  eq(backtests.status, "completed"),
                ),
              )
              .orderBy(desc(backtests.createdAt))
              .limit(1);

            if (latestBtForB14?.gateResult) {
              const b14Gate = latestBtForB14.gateResult as Record<string, unknown>;
              // survival_twin.passed=false → HARD block.
              const survivalTwin = b14Gate.survival_twin as Record<string, unknown> | undefined;

              // 40% single-day consistency cap check (Topstep documented rule).
              // If any single backtest day's P&L > 40% of payout-window total P&L → violation.
              let consistencyViolation = false;
              if (latestBtForB14.resultExtras) {
                const extras = latestBtForB14.resultExtras as Record<string, unknown>;
                const dailyPnls = (extras.daily_pnls ?? extras.daily_pnl_series) as Record<string, number> | number[] | undefined;
                if (dailyPnls) {
                  const pnlValues = Array.isArray(dailyPnls)
                    ? dailyPnls
                    : Object.values(dailyPnls as Record<string, number>);
                  const positiveDays = pnlValues.filter((v) => v > 0);
                  const windowTotal = positiveDays.reduce((a, b) => a + b, 0);
                  if (windowTotal > 0) {
                    const maxDay = Math.max(...positiveDays);
                    const maxDayPct = maxDay / windowTotal;
                    if (maxDayPct > 0.40) {
                      consistencyViolation = true;
                      logger.warn(
                        { strategyId: s.id, maxDayPct: maxDayPct.toFixed(3), windowTotal },
                        "B14: 40% single-day consistency violation detected",
                      );
                    }
                  }
                }
              }

              const b14Failed = (survivalTwin && survivalTwin.passed === false) || consistencyViolation;
              if (b14Failed) {
                const blockReason = consistencyViolation
                  ? "b14_consistency_40pct_violation"
                  : "b14_survival_twin_failed";
                logger.warn(
                  { strategyId: s.id, blockReason, survivalTwin, consistencyViolation, transition: "PAPER→DEPLOY_READY" },
                  "B14 Survival Twin HARD gate BLOCKED PAPER→DEPLOY_READY promotion",
                );
                await db.insert(auditLog).values({
                  action: "lifecycle.b14_hard_blocked",
                  entityId: s.id,
                  entityType: "strategy",
                  status: "failure",
                  decisionAuthority: "gate",
                  input: { fromState: "PAPER", toState: "DEPLOY_READY" },
                  result: {
                    reason: blockReason,
                    survival_twin: survivalTwin ?? null,
                    consistency_violation: consistencyViolation,
                    b14_hard_gate_enabled: true,
                  },
                  correlationId,
                }).catch((auditErr) => {
                  logger.warn({ strategyId: s.id, err: auditErr }, "B14 audit insert failed (non-blocking)");
                });
                continue;
              }
            }
            // No gateResult or survival_twin data → log advisory, allow through
            // (legacy backtests pre-B14 don't have this data).

            // ── Wave 27.5 Pass B.2: B14 CI gate (probability_of_ruin_ci.ci_high) ──
            // Reads the latest MC run for this backtest and evaluates ci_high against
            // the institutional 0.40 threshold. Falls back to scalar for pre-Pass-A runs.
            if (latestBtForB14?.id) {
              const [latestMcForB14] = await db
                .select({
                  probabilityOfRuin: monteCarloRuns.probabilityOfRuin,
                  riskMetrics: monteCarloRuns.riskMetrics,
                })
                .from(monteCarloRuns)
                .where(
                  and(
                    eq(monteCarloRuns.backtestId, latestBtForB14.id),
                    eq(monteCarloRuns.status, "completed"),
                  ),
                )
                .orderBy(desc(monteCarloRuns.createdAt))
                .limit(1);

              if (latestMcForB14) {
                const rm = (latestMcForB14.riskMetrics as Record<string, unknown> | null) ?? {};
                const ruinCi = (rm.probability_of_ruin_ci ?? null) as Record<string, unknown> | null;
                const pointEstimate = latestMcForB14.probabilityOfRuin != null
                  ? Number(latestMcForB14.probabilityOfRuin)
                  : null;

                const b14CiResult = evaluateB14CiGate(ruinCi, pointEstimate);

                // Always emit audit row so dashboard can show gate evaluation history.
                await db.insert(auditLog).values({
                  action: "b14.gate_evaluated",
                  entityId: s.id,
                  entityType: "strategy",
                  status: b14CiResult.passed ? "success" : "failure",
                  decisionAuthority: "gate",
                  input: { fromState: "PAPER", toState: "DEPLOY_READY" },
                  result: b14CiResult.auditPayload,
                  correlationId,
                }).catch((auditErr) => {
                  logger.warn({ strategyId: s.id, err: auditErr }, "B14 CI gate audit insert failed (non-blocking)");
                });

                broadcastSSE("lifecycle:b14_evaluated", {
                  strategyId: s.id,
                  ...b14CiResult.auditPayload,
                  passed: b14CiResult.passed,
                  reason: b14CiResult.reason,
                  legacyFallback: b14CiResult.legacyFallback,
                });

                if (!b14CiResult.passed) {
                  logger.warn(
                    {
                      strategyId: s.id,
                      ciHigh: b14CiResult.auditPayload.ci_high,
                      threshold: b14CiResult.auditPayload.threshold,
                      transition: "PAPER→DEPLOY_READY",
                    },
                    "B14 CI gate BLOCKED: probability_of_ruin_ci.ci_high exceeds institutional threshold",
                  );
                  continue;
                }

                if (b14CiResult.legacyFallback) {
                  logger.warn(
                    { strategyId: s.id },
                    "B14 CI gate: using legacy scalar fallback (pre-Pass-A MC run — upgrade to get BCa CI)",
                  );
                }
              }
              // No MC run at all for this backtest → fail-open (pre-MC strategies).
            }
          } catch (b14Err) {
            // Fail-open: B14 gate read failure is non-blocking (survival_twin is
            // computed post-backtest; early strategies may not have the data yet).
            logger.warn(
              { strategyId: s.id, err: b14Err },
              "B14 Survival Twin gate: read failed (non-blocking — promotion continues)",
            );
          }
        } else {
          logger.warn(
            { strategyId: s.id },
            "B14 Survival Twin HARD gate DISABLED via B14_HARD_GATE_ENABLED=false — advisory only",
          );
        }

        // ── Wave 25 Item 5: B15 Parameter Robustness Battery gate: PAPER → DEPLOY_READY ──
        // Advisory-only for 30 days (B15_BATTERY_ENABLED=false default).
        // When B15_BATTERY_ENABLED=true, strategies that ran the battery and FAILED are HARD-blocked.
        // Strategies WITHOUT b15_battery data (pre-B15 backtests) are NEVER blocked — backward compat.
        const b15HardGateEnabled = (process.env.B15_BATTERY_ENABLED ?? "false") === "true";
        try {
          const [latestBtForB15] = await db
            .select({ b15Battery: backtests.b15Battery })
            .from(backtests)
            .where(
              and(
                eq(backtests.strategyId, s.id),
                eq(backtests.status, "completed"),
              ),
            )
            .orderBy(desc(backtests.createdAt))
            .limit(1);

          if (latestBtForB15?.b15Battery) {
            const b15 = latestBtForB15.b15Battery as Record<string, unknown>;
            // Only block when battery explicitly ran and passed=false.
            // Absent b15_battery → skip (backward compat for pre-B15 backtests).
            if (b15.passed === false) {
              const failures = (b15.failures as string[] | undefined) ?? [];
              const sdr = b15.sdr as number | undefined;
              const psi = b15.psi as number | undefined;
              const rws = b15.rws as number | undefined;
              logger.warn(
                { strategyId: s.id, sdr, psi, rws, failures, b15HardGateEnabled, transition: "PAPER→DEPLOY_READY" },
                b15HardGateEnabled
                  ? "B15 Parameter Robustness Battery HARD gate BLOCKED PAPER→DEPLOY_READY promotion"
                  : "B15 Parameter Robustness Battery ADVISORY — promotion continues (B15_BATTERY_ENABLED=false)",
              );
              await db.insert(auditLog).values({
                action: "lifecycle.b15_parameter_robustness_blocked",
                entityId: s.id,
                entityType: "strategy",
                status: b15HardGateEnabled ? "failure" : "warning",
                decisionAuthority: "gate",
                input: { fromState: "PAPER", toState: "DEPLOY_READY" },
                result: {
                  sdr: sdr ?? null,
                  psi: psi ?? null,
                  rws: rws ?? null,
                  thresholds: b15.thresholds ?? null,
                  failures,
                  hard_gate_enabled: b15HardGateEnabled,
                },
                correlationId,
              }).catch((auditErr) => {
                logger.warn({ strategyId: s.id, err: auditErr }, "B15 audit insert failed (non-blocking)");
              });
              if (b15HardGateEnabled) {
                continue;
              }
            }
          }
        } catch (b15Err) {
          // Fail-open: B15 gate read failure is non-blocking (pre-B15 strategies may not have data).
          logger.warn(
            { strategyId: s.id, err: b15Err },
            "B15 Parameter Robustness Battery gate: read failed (non-blocking — promotion continues)",
          );
        }

        // ── Wave 27.5 Pass B.2 Gate #2: WFE hard floor: PAPER → DEPLOY_READY ──
        // Reads backtests.walk_forward_results.wfe_overall (written by Pass B.1
        // walk_forward.py — embedded in existing walkForwardResults JSONB column).
        // WFE < WFE_WARN_FLOOR (default 0.50) → HARD block (likely overfit).
        // WFE_WARN_FLOOR ≤ WFE < WFE_HARD_FLOOR (default 0.70) → WARN + allow.
        // Null WFE (pre-Pass-B.1 backtest or non-WF backtest) → fail-open for legacy compat.
        try {
          const [latestBtForWfe] = await db
            .select({ walkForwardResults: backtests.walkForwardResults })
            .from(backtests)
            .where(
              and(
                eq(backtests.strategyId, s.id),
                eq(backtests.status, "completed"),
              ),
            )
            .orderBy(desc(backtests.createdAt))
            .limit(1);

          const wfResults = (latestBtForWfe?.walkForwardResults as Record<string, unknown> | null) ?? null;
          const wfeOverall = wfResults?.wfe_overall != null ? Number(wfResults.wfe_overall) : null;

          const wfeResult = evaluateWfeGate(wfeOverall);

          broadcastSSE("lifecycle:wfe_evaluated", {
            strategyId: s.id,
            wfe_overall: wfeResult.wfeOverall,
            status: wfeResult.status,
            hard_floor: wfeResult.hardFloor,
            warn_floor: wfeResult.warnFloor,
            passed: wfeResult.passed,
          });

          if (wfeResult.auditAction) {
            const isBlock = wfeResult.status === "blocked";
            logger[isBlock ? "warn" : "info"](
              {
                strategyId: s.id,
                wfeOverall: wfeResult.wfeOverall,
                hardFloor: wfeResult.hardFloor,
                warnFloor: wfeResult.warnFloor,
                status: wfeResult.status,
                transition: "PAPER→DEPLOY_READY",
              },
              isBlock
                ? "WFE gate BLOCKED PAPER→DEPLOY_READY: wfe_overall below hard floor"
                : wfeResult.status === "warned"
                ? "WFE gate ADVISORY: wfe_overall below target (0.70) — promotion continues"
                : "WFE gate: wfe_overall unavailable (legacy backtest) — promotion continues",
            );
            await db.insert(auditLog).values({
              action: wfeResult.auditAction,
              entityId: s.id,
              entityType: "strategy",
              status: isBlock ? "failure" : "warning",
              decisionAuthority: "gate",
              input: { fromState: "PAPER", toState: "DEPLOY_READY" },
              result: {
                wfe_overall: wfeResult.wfeOverall,
                hard_floor: wfeResult.hardFloor,
                warn_floor: wfeResult.warnFloor,
                status: wfeResult.status,
              },
              correlationId,
            }).catch((auditErr) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "WFE gate audit insert failed (non-blocking)");
            });

            // Wave 27.5 Pass D.3 — WFE warn-floor Discord WARN (carry-forward from Pass B).
            // When WFE is in the warn band [WFE_WARN_FLOOR, WFE_HARD_FLOOR) the promotion
            // continues but the operator should see a phone notification. Block path already
            // uses continue above; this fires only for the "warned" status.
            if (wfeResult.status === "warned") {
              const wfeVal = wfeResult.wfeOverall != null ? wfeResult.wfeOverall.toFixed(2) : "N/A";
              const operatorBody =
                `[WARN] Walk-Forward Efficiency below institutional target\n` +
                `Strategy: ${s.name}\n` +
                `WFE: ${wfeVal} (warn floor: ${wfeResult.warnFloor.toFixed(2)}, hard floor: ${wfeResult.hardFloor.toFixed(2)})\n` +
                `Promotion ALLOWED but flagged for operator review`;
              const plainWhat =
                "A strategy passed all gates but the bot's out-of-sample performance was " +
                "lower than the institutional target. Tony will review.";
              const plainAction = "No action needed.";
              // Dynamic import keeps lifecycle-service.ts free of a hard notification-service dep
              // (consistent with backtest-service.ts pattern — avoids circular boot graph).
              Promise.all([
                import("./notification-service.js"),
                import("../lib/notification-helpers.js"),
              ]).then(([{ notifyWarning }, { appendFamilyGradePostscript }]) => {
                notifyWarning(
                  `WFE below target: ${s.name} (${wfeVal})`,
                  appendFamilyGradePostscript(operatorBody, plainWhat, plainAction),
                  {
                    strategyId: s.id,
                    strategyName: s.name,
                    wfe_overall: wfeResult.wfeOverall,
                    warn_floor: wfeResult.warnFloor,
                    hard_floor: wfeResult.hardFloor,
                    transition: "PAPER→DEPLOY_READY",
                    correlationId,
                  },
                );
              }).catch((notifyErr) => {
                logger.warn({ strategyId: s.id, err: notifyErr }, "WFE warn-floor Discord notify failed (non-blocking)");
              });
            }

            if (isBlock) {
              continue;
            }
          }
        } catch (wfeErr) {
          // Fail-open: WFE gate read failure is non-blocking.
          logger.warn(
            { strategyId: s.id, err: wfeErr },
            "WFE gate: read failed (non-blocking — promotion continues)",
          );
        }

        // ── Wave 27.5 Pass B.2 Gate #3: Parameter drift classification: PAPER → DEPLOY_READY ──
        // Reads backtests.walk_forward_results.param_stability.drift_classification (Pass B.1).
        // Pass B.1 walk_forward.py writes regime-context classification into param_stability
        // as {drift_classification, drift_confidence, drift_evidence} — embedded in the
        // existing walkForwardResults JSONB column.
        // overfit_drift + confidence >= 0.70 → HARD block.
        // overfit_drift (low confidence) OR indeterminate → WARN + allow.
        // regime_driven | stable → no action.
        // Null → fail-open for legacy compat.
        try {
          const [latestBtForDrift] = await db
            .select({ walkForwardResults: backtests.walkForwardResults })
            .from(backtests)
            .where(
              and(
                eq(backtests.strategyId, s.id),
                eq(backtests.status, "completed"),
              ),
            )
            .orderBy(desc(backtests.createdAt))
            .limit(1);

          const driftWfResults = (latestBtForDrift?.walkForwardResults as Record<string, unknown> | null) ?? null;
          // param_stability.drift_classification is the regime-context enhanced field.
          // Falls back to binary is_fragile via "indeterminate" in legacy WF runs.
          const paramStability = (driftWfResults?.param_stability as Record<string, unknown> | null) ?? null;
          const driftClassification = (paramStability?.drift_classification as string | null) ?? null;
          const driftConfidence = paramStability?.drift_confidence != null
            ? Number(paramStability.drift_confidence)
            : null;

          const driftResult = evaluateParameterDriftGate(driftClassification, driftConfidence);

          broadcastSSE("lifecycle:parameter_drift_evaluated", {
            strategyId: s.id,
            classification: driftResult.classification,
            confidence: driftResult.confidence,
            status: driftResult.status,
            passed: driftResult.passed,
          });

          if (driftResult.auditAction) {
            const isBlock = driftResult.status === "blocked";
            logger[isBlock ? "warn" : "info"](
              {
                strategyId: s.id,
                classification: driftResult.classification,
                confidence: driftResult.confidence,
                status: driftResult.status,
                transition: "PAPER→DEPLOY_READY",
              },
              isBlock
                ? "Parameter drift gate BLOCKED PAPER→DEPLOY_READY: overfit_drift with high confidence"
                : `Parameter drift gate ADVISORY: ${driftResult.classification ?? "unavailable"} — promotion continues`,
            );
            await db.insert(auditLog).values({
              action: driftResult.auditAction,
              entityId: s.id,
              entityType: "strategy",
              status: isBlock ? "failure" : "warning",
              decisionAuthority: "gate",
              input: { fromState: "PAPER", toState: "DEPLOY_READY" },
              result: {
                classification: driftResult.classification,
                confidence: driftResult.confidence,
                status: driftResult.status,
              },
              correlationId,
            }).catch((auditErr) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "Parameter drift gate audit insert failed (non-blocking)");
            });
            if (isBlock) {
              continue;
            }
          }
        } catch (driftErr) {
          // Fail-open: drift gate read failure is non-blocking.
          logger.warn(
            { strategyId: s.id, err: driftErr },
            "Parameter drift gate: read failed (non-blocking — promotion continues)",
          );
        }

        // ── Wave 26 Pass G Pass E Gate Stack: WFE-0.80 + CPCV-15 + WRC + SPA ─
        // Evaluates 4 additional institutional gates via promotion-gate-orchestrator.
        // The orchestrator reads pre-fetched backtest data and applies AND logic:
        //
        //   Gate 1 (wfe_floor): WFE >= WFE_PROMOTION_FLOOR (default 0.80 — lifted
        //     from 0.70 per Bailey & Lopez de Prado 2025 conference). Backward-compat:
        //     strategies already at DEPLOY_READY/PILOT/DEPLOYED not demoted; floor
        //     applies only to new PAPER → DEPLOY_READY transitions.
        //
        //   Gate 2 (cpcv_n_paths): latest CPCV run must have n_paths >= CPCV_MIN_PATHS
        //     (default 15, env CPCV_MIN_PATHS). Fails-open when no CPCV run yet.
        //
        //   Gate 3 (wrc_p): White's Reality Check p_value < 0.05. Fails-open for
        //     pre-Pass-E backtests that lack wrc_result.
        //
        //   Gate 4 (spa_p): Hansen SPA spa_consistent_p < 0.05. Fails-open for
        //     pre-Pass-E backtests that lack spa_result.
        //
        // When ANY gate blocks: write audit `promotion.gate_failed` + continue (skip promotion).
        // When ALL pass: write audit `promotion.gates_cleared` and proceed.
        // Note: B14 ci_high gate continues to run via its existing block above; the
        // orchestrator's b14 result is redundant here but included for the unified
        // `promotion.gates_cleared` audit row.
        try {
          const [latestBtForOrch] = await db
            .select({
              walkForwardResults: backtests.walkForwardResults,
              wrcResult: backtests.wrcResult,
              spaResult: backtests.spaResult,
              gateResult: backtests.gateResult,
            })
            .from(backtests)
            .where(
              and(
                eq(backtests.strategyId, s.id),
                eq(backtests.status, "completed"),
              ),
            )
            .orderBy(desc(backtests.createdAt))
            .limit(1);

          if (latestBtForOrch) {
            const wfResults = (latestBtForOrch.walkForwardResults as Record<string, unknown> | null) ?? null;
            const wfeOverall = wfResults?.wfe_overall != null ? Number(wfResults.wfe_overall) : null;

            // CPCV n_paths lives in wf_metadata sub-object
            const wfMeta = (wfResults?.wf_metadata as Record<string, unknown> | null) ?? null;
            const cpcvNPaths = wfMeta?.mode === "cpcv" && wfMeta.n_paths != null
              ? Number(wfMeta.n_paths)
              : null;

            const wrcData = (latestBtForOrch.wrcResult as Record<string, unknown> | null) ?? null;
            const wrcPValue = wrcData?.p_value != null ? Number(wrcData.p_value) : null;

            const spaData = (latestBtForOrch.spaResult as Record<string, unknown> | null) ?? null;
            const spaConsistentP = spaData?.spa_consistent_p != null ? Number(spaData.spa_consistent_p) : null;

            // Run the orchestrator (skipping B14 — already evaluated above)
            const orchResult = evaluatePromotionGates({
              ruinCi: null,       // B14 already handled by the dedicated block above
              wfeOverall,
              cpcvNPaths,
              wrcPValue,
              spaConsistentP,
            });

            // Remove b14 from orchestrator result to avoid double-counting
            const gatesToEvaluate: Array<"wfe_floor" | "cpcv_n_paths" | "wrc_p" | "spa_p"> =
              ["wfe_floor", "cpcv_n_paths", "wrc_p", "spa_p"];

            const orchFailingGates = gatesToEvaluate.filter(
              (g) => !orchResult.gate_results[g].passed,
            );

            if (orchFailingGates.length > 0) {
              // At least one Pass E gate blocked
              const primaryFail = orchResult.gate_results[orchFailingGates[0]!];
              logger.warn(
                {
                  strategyId: s.id,
                  failingGates: orchFailingGates,
                  gateDetails: orchFailingGates.map((g) => ({
                    gate: g,
                    value: orchResult.gate_results[g].value,
                    threshold: orchResult.gate_results[g].threshold,
                    reason: orchResult.gate_results[g].reason,
                  })),
                  transition: "PAPER→DEPLOY_READY",
                },
                "Wave 26 Pass G Pass E gates BLOCKED PAPER→DEPLOY_READY promotion",
              );
              for (const gate of orchFailingGates) {
                const gateRes = orchResult.gate_results[gate];
                await db.insert(auditLog).values({
                  action: "promotion.gate_failed",
                  entityId: s.id,
                  entityType: "strategy",
                  status: "failure",
                  decisionAuthority: "gate",
                  input: { fromState: "PAPER", toState: "DEPLOY_READY" },
                  result: {
                    gate,
                    value: gateRes.value,
                    threshold: gateRes.threshold,
                    reason: gateRes.reason,
                    data_available: gateRes.data_available,
                  },
                  correlationId,
                }).catch((auditErr) => {
                  logger.warn({ strategyId: s.id, gate, err: auditErr }, "Pass E gate_failed audit insert failed (non-blocking)");
                });
              }
              continue;
            }

            // All Pass E gates cleared — write gates_cleared audit (advisory, not blocking)
            await db.insert(auditLog).values({
              action: "promotion.gates_cleared",
              entityId: s.id,
              entityType: "strategy",
              status: "success",
              decisionAuthority: "gate",
              input: { fromState: "PAPER", toState: "DEPLOY_READY" },
              result: {
                wfe_floor: {
                  value: orchResult.gate_results.wfe_floor.value,
                  threshold: orchResult.gate_results.wfe_floor.threshold,
                  data_available: orchResult.gate_results.wfe_floor.data_available,
                },
                cpcv_n_paths: {
                  value: orchResult.gate_results.cpcv_n_paths.value,
                  threshold: orchResult.gate_results.cpcv_n_paths.threshold,
                  data_available: orchResult.gate_results.cpcv_n_paths.data_available,
                },
                wrc_p: {
                  value: orchResult.gate_results.wrc_p.value,
                  threshold: orchResult.gate_results.wrc_p.threshold,
                  data_available: orchResult.gate_results.wrc_p.data_available,
                },
                spa_p: {
                  value: orchResult.gate_results.spa_p.value,
                  threshold: orchResult.gate_results.spa_p.threshold,
                  data_available: orchResult.gate_results.spa_p.data_available,
                },
              },
              correlationId,
            }).catch((auditErr) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "Pass E gates_cleared audit insert failed (non-blocking)");
            });
          }
        } catch (orchErr) {
          // Fail-open: orchestrator read failure is non-blocking (same pattern as other gates).
          logger.warn(
            { strategyId: s.id, err: orchErr },
            "Wave 26 Pass G Pass E gate orchestrator: read failed (non-blocking — promotion continues)",
          );
        }

        // ── Wave 28 Pass B.1: Composite shadow gate (OBSERVABILITY ONLY) ─────
        //
        // OBSERVABILITY ONLY — Pass B shadow mode; Wave 27.5 hard gates remain
        // authoritative. See Wave 28 plan.
        //
        // This block runs AFTER all Wave 27.5 hard gates (B14 ci_high, WFE,
        // parameter drift, orchestrator gates) have already made their
        // ALLOW/BLOCK decisions.  The composite shadow result is logged as an
        // audit row so 14 days of agreement data can accumulate before Pass C
        // considers activation.  The shadow result NEVER changes the hard-gate
        // decision that precedes or follows it.  Fail-OPEN for observability:
        // any throw is caught, emits composite.shadow_evaluation_error, and
        // promotion proceeds via the hard-gate outcome alone.
        {
          // hard_gate_outcome reflects whether all gates above allowed promotion.
          // We have reached this line only because none of the earlier `continue`
          // statements fired — so hard gates ALLOWED this promotion attempt.
          // The type is widened to string so the agreement branches compile cleanly
          // (TypeScript would otherwise flag the "blocked" branches as dead code
          // because the const literal type narrows to "allowed").
          const hardGateOutcome: string = "allowed";

          try {
            const shadowResult = await evaluateCompositeShadow(s.id);

            // Compute agreement between shadow and hard-gate outcome.
            type AgreementLabel =
              | "agree_allow"
              | "agree_block"
              | "disagree_shadow_blocks"
              | "disagree_shadow_allows"
              | "shadow_no_opinion";

            let agreement: AgreementLabel;
            if (
              shadowResult.shadow_decision === "NO_OPINION" ||
              shadowResult.shadow_decision === "WOULD_WARN"
            ) {
              agreement = "shadow_no_opinion";
            } else if (hardGateOutcome === "allowed" && shadowResult.shadow_decision === "WOULD_PROMOTE") {
              agreement = "agree_allow";
            } else if (hardGateOutcome === "allowed" && shadowResult.shadow_decision === "WOULD_BLOCK") {
              agreement = "disagree_shadow_blocks";
            } else if (hardGateOutcome === "blocked" && shadowResult.shadow_decision === "WOULD_BLOCK") {
              agreement = "agree_block";
            } else if (hardGateOutcome === "blocked" && shadowResult.shadow_decision === "WOULD_PROMOTE") {
              agreement = "disagree_shadow_allows";
            } else {
              agreement = "shadow_no_opinion";
            }

            await db.insert(auditLog).values({
              action: "composite.shadow_evaluation",
              entityId: s.id,
              entityType: "strategy",
              status: "success",
              decisionAuthority: "gate",
              input: { fromState: "PAPER", toState: "DEPLOY_READY" },
              result: {
                strategy_id: s.id,
                hard_gate_outcome: hardGateOutcome,
                shadow_result: shadowResult,
                agreement,
              },
              correlationId,
            }).catch((auditErr) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "composite shadow evaluation audit insert failed (non-blocking)");
            });

            logger.info(
              {
                strategyId: s.id,
                agreement,
                shadow_decision: shadowResult.shadow_decision,
                composite_score: shadowResult.composite_score,
                verdict: shadowResult.verdict,
                availability: shadowResult.availability,
                hard_gate_outcome: hardGateOutcome,
              },
              "composite-shadow-gate: shadow evaluation logged (observability only — no gate authority)",
            );

            // ── Wave 28 Pass B.2: Discord disagreement routing ──────────────
            // Fire-and-forget — must never block or throw into this try-block.
            // Agreements and shadow_no_opinion are silenced inside the router.
            routeShadowDisagreementAlert({
              strategyId: s.id,
              strategyName: s.name,
              hardGateOutcome,
              shadow_result: shadowResult,
              agreement,
            }).catch((routerErr) => {
              logger.warn(
                { strategyId: s.id, err: routerErr },
                "composite-shadow-discord-router: unexpected throw (caught at lifecycle boundary) — promotion unaffected",
              );
            });
          } catch (shadowErr) {
            // Fail-OPEN: shadow infrastructure must NEVER cause a real lifecycle failure.
            // Catch any throw, emit a separate error audit, and proceed to promoteStrategy.
            const msg = shadowErr instanceof Error ? shadowErr.message : String(shadowErr);
            logger.warn(
              { strategyId: s.id, err: shadowErr },
              "composite-shadow-gate: helper threw — emitting error audit, promotion proceeds (fail-OPEN)",
            );
            await db.insert(auditLog).values({
              action: "composite.shadow_evaluation_error",
              entityId: s.id,
              entityType: "strategy",
              status: "warning",
              decisionAuthority: "gate",
              input: { fromState: "PAPER", toState: "DEPLOY_READY" },
              result: {
                error: msg,
                hard_gate_outcome: hardGateOutcome,
                note: "composite shadow gate threw — promotion proceeds via Wave 27.5 hard gates alone",
              },
              correlationId,
            }).catch(() => {});
          }
        }
        // ── End Wave 28 Pass B.1 composite shadow gate ───────────────────────

        // ── Wave 29 Pass B.2: Frozen-policy drift gate (PAPER → DEPLOY_READY) ──
        // Gate: evaluate whether the live config hash matches the frozen hash.
        //   - First-time freeze (frozenPolicyHash == null): PERMIT promotion + stamp hash.
        //   - Hash matches: PERMIT promotion — policy is stable.
        //   - Hash mismatch (config changed since freeze): BLOCK promotion.
        //     Operator must POST /api/admin/frozen-policy-override with HMAC + rationale ≥50.
        // Fail-soft: hash computation error → emit warn audit + PROCEED (never block on hash plumbing).
        let frozenPolicyBlocked = false;
        try {
          const driftResult = evaluateFrozenPolicyDriftAtPromotion({
            id: s.id,
            config: s.config,
            frozenPolicyHash: s.frozenPolicyHash,
          });

          if (!driftResult.ok && driftResult.frozenHash !== null) {
            // Hash mismatch — config changed after policy was frozen.  Hard block.
            frozenPolicyBlocked = true;
            logger.warn(
              {
                strategyId: s.id,
                currentHash: driftResult.currentHash.slice(0, 16),
                frozenHash: (driftResult.frozenHash ?? "").slice(0, 16),
                transition: "PAPER→DEPLOY_READY",
              },
              "Frozen-policy drift gate BLOCKED PAPER→DEPLOY_READY promotion",
            );
            await db.insert(auditLog).values({
              action: "lifecycle.frozen_policy_drift_blocked",
              entityId: s.id,
              entityType: "strategy",
              status: "blocked",
              decisionAuthority: "gate",
              input: { fromState: "PAPER", toState: "DEPLOY_READY" },
              result: {
                strategy_id: s.id,
                current_hash: driftResult.currentHash,
                frozen_hash: driftResult.frozenHash,
                reason: driftResult.reason ?? "frozen_policy.hash_mismatch",
                note: "Operator must POST /api/admin/frozen-policy-override with HMAC + rationale ≥50 chars",
              },
              correlationId,
            }).catch((auditErr) => {
              logger.warn({ strategyId: s.id, err: auditErr }, "frozen_policy drift-block audit failed (non-blocking)");
            });
            continue; // skip this strategy in the current pass
          }

          if (driftResult.ok && driftResult.frozenHash === null) {
            // First-time freeze: stamp the policy hash + regime. Fire-and-forget.
            // Determine the current institutional_regime from bias_state (regimeLabel field).
            // Fail-soft: if regime is unavailable, use "UNKNOWN" — never block on it.
            let currentRegime = "UNKNOWN";
            try {
              const { biasState: biasStateTable } = await import("../db/schema.js");
              const biasStateRows = await db
                .select({ regimeLabel: biasStateTable.regimeLabel })
                .from(biasStateTable)
                .limit(1)
                .catch(() => [] as { regimeLabel: string }[]);
              if (biasStateRows.length > 0 && typeof biasStateRows[0].regimeLabel === "string") {
                currentRegime = biasStateRows[0].regimeLabel;
              }
            } catch {
              // Regime lookup error is non-fatal.
            }

            freezePolicyForStrategy(s.id, currentRegime).catch((freezeErr) => {
              logger.warn({ strategyId: s.id, err: freezeErr }, "frozen_policy first-time freeze failed (non-blocking — promotion proceeds)");
            });

            logger.info(
              { strategyId: s.id, regime: currentRegime },
              "Frozen-policy first-time freeze: hash will be stamped (fire-and-forget)",
            );
          }
        } catch (frozenPolicyErr) {
          // Fail-soft: hash compute error NEVER blocks real lifecycle.
          const msg = frozenPolicyErr instanceof Error ? frozenPolicyErr.message : String(frozenPolicyErr);
          logger.warn({ strategyId: s.id, err: frozenPolicyErr }, "frozen_policy gate threw — emitting warn audit, promotion proceeds (fail-soft)");
          await db.insert(auditLog).values({
            action: "frozen_policy.hash_compute_failed",
            entityId: s.id,
            entityType: "strategy",
            status: "warning",
            decisionAuthority: "gate",
            input: { fromState: "PAPER", toState: "DEPLOY_READY" },
            result: { error: msg, note: "hash compute error — promotion proceeds" },
            correlationId,
          }).catch(() => {});
        }

        if (frozenPolicyBlocked) continue; // already continued above; guard for clarity
        // ── End Wave 29 Pass B.2 frozen-policy drift gate ────────────────────

        const result = await this.promoteStrategy(s.id, "PAPER", "DEPLOY_READY", { correlationId: correlationId ?? undefined });
        if (result.success) {
          promoted.push(s.id);

          // Alert the human — strategy is ready for deployment review
          broadcastSSE("strategy:deploy-ready", {
            strategyId: s.id,
            name: s.name,
            symbol: s.symbol,
            rollingSharpe,
            tradingDays,
            message: `Strategy "${s.name}" qualified for deployment — review in library`,
          });

          AlertFactory.deployReady(
            s.id,
            `Strategy "${s.name}" is DEPLOY_READY — Sharpe ${rollingSharpe.toFixed(2)}, ${tradingDays} trading days. Awaiting your approval.`,
          ).catch(() => {});

          logger.info(
            { id: s.id, rollingSharpe, tradingDays },
            "Strategy moved to DEPLOY_READY library — awaiting human approval",
          );

          // Fire-and-forget: compile Pine export for TradingView
          this.triggerPineCompile(s.id).catch((pineErr) => {
            logger.warn(
              { strategyId: s.id, err: pineErr },
              "Pine compile failed after DEPLOY_READY promotion (non-blocking)",
            );
          });

          // B5: Fire-and-forget multi-firm eligibility check.
          // Runs AFTER the promotion commits — does NOT block DEPLOY_READY.
          // Iterates all 8 configured firms, stores one row per firm in
          // strategy_firm_eligibility for human review and B7 Kelly sizing.
          this.triggerMultiFirmEligibility(s.id, correlationId ?? undefined).catch((mfErr) => {
            logger.warn(
              { strategyId: s.id, err: mfErr },
              "B5 multi-firm eligibility check failed after DEPLOY_READY promotion (non-blocking)",
            );
          });
        }
      } else if (tradingDays >= 30 && rollingSharpe < 1.5) {
        logger.warn({ id: s.id, rollingSharpe, tradingDays }, "DEPLOY_READY blocked: rolling Sharpe < 1.5");
      }
    }

    return promoted;
  }

  /**
   * Fire-and-forget Pine compile for a strategy that just reached DEPLOY_READY.
   * Fetches latest backtest + MC data to build risk intelligence for the export.
   */
  private async triggerPineCompile(strategyId: string): Promise<void> {
    // Fetch strategy for firm association
    const [strategy] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.id, strategyId));

    if (!strategy) return;

    // Find latest completed backtest
    const [latestBt] = await db
      .select()
      .from(backtests)
      .where(
        and(
          eq(backtests.strategyId, strategyId),
          eq(backtests.status, "completed"),
        ),
      )
      .orderBy(desc(backtests.createdAt))
      .limit(1);

    // Build risk intelligence from MC if available
    let riskIntelligence: Record<string, number | string | null> | null = null;
    if (latestBt) {
      const [mcRun] = await db
        .select({
          probabilityOfRuin: monteCarloRuns.probabilityOfRuin,
          sharpeP50: monteCarloRuns.sharpeP50,
          riskMetrics: monteCarloRuns.riskMetrics,
        })
        .from(monteCarloRuns)
        .where(eq(monteCarloRuns.backtestId, latestBt.id))
        .orderBy(desc(monteCarloRuns.createdAt))
        .limit(1);

      if (mcRun) {
        const ruinProb = mcRun.probabilityOfRuin != null ? Number(mcRun.probabilityOfRuin) : null;
        const survivalRate = ruinProb != null ? 1 - ruinProb : null;
        const rm = (mcRun.riskMetrics as Record<string, unknown> | null) ?? {};
        const breachProb = rm.breach_probability != null ? Number(rm.breach_probability) : null;
        const sharpeP50 = mcRun.sharpeP50 != null ? Number(mcRun.sharpeP50) : null;

        riskIntelligence = {
          breach_probability: breachProb,
          ruin_probability: ruinProb,
          survival_rate: survivalRate,
          mc_sharpe_p50: sharpeP50,
        };
      }
    }

    // Derive firm key from prop compliance if available
    let firmKey = "topstep_50k";
    if (latestBt?.propCompliance) {
      const propResults = latestBt.propCompliance as Record<string, { passed?: boolean; pass?: boolean }>;
      const passingFirm = Object.entries(propResults).find(
        ([, r]) => r.passed === true || r.pass === true,
      );
      if (passingFirm) {
        firmKey = passingFirm[0];
      }
    }

    // Emit both _INDICATOR.pine (manual-approval firms) and _STRATEGY.pine (ATS firms)
    // from the same underlying signal logic.  compileDualPineExport writes two separate
    // artifact rows into strategy_export_artifacts (artifact_type = dual_indicator |
    // dual_strategy | dual_alerts_json).  No DB schema change required.
    const result = await compileDualPineExport(strategyId, firmKey, riskIntelligence);
    logger.info(
      {
        strategyId,
        firmKey,
        exportId: result?.id,
        indicator_file: (result as Record<string, unknown>)?.indicator_file,
        strategy_file: (result as Record<string, unknown>)?.strategy_file,
      },
      "Pine dual compile completed for DEPLOY_READY strategy",
    );
  }

  /**
   * B5: Fire-and-forget multi-firm eligibility check.
   *
   * Called after PAPER → DEPLOY_READY promotion. Fetches the latest completed
   * backtest ID and delegates to evaluateMultiFirmEligibility() which runs
   * compliance_gate.py for each of the 8 configured firms and persists one
   * strategy_firm_eligibility row per firm.
   *
   * Does NOT gate or reverse the promotion — purely additive.
   */
  private async triggerMultiFirmEligibility(
    strategyId: string,
    correlationId?: string,
  ): Promise<void> {
    // Resolve the latest completed backtest ID for compliance input
    const [latestBt] = await db
      .select({ id: backtests.id })
      .from(backtests)
      .where(
        and(
          eq(backtests.strategyId, strategyId),
          eq(backtests.status, "completed"),
        ),
      )
      .orderBy(desc(backtests.createdAt))
      .limit(1);

    const backtestId = latestBt?.id ?? null;

    await evaluateMultiFirmEligibility(strategyId, backtestId, correlationId);
  }

  /**
   * Check for auto-demotions: DEPLOYED → DECLINING if rolling Sharpe < 1.0.
   */
  async checkAutoDemotions(context?: { correlationId?: string }): Promise<string[]> {
    const correlationId = context?.correlationId;

    // HIGH #13: killSwitch is the FIRST gate on every lifecycle-mutating entry path.
    if (await killSwitch.isHaltedForProduction()) {
      logger.warn({ correlationId, fn: "checkAutoDemotions" }, "Skipping — killSwitch halted");
      return [];
    }

    const demoted: string[] = [];

    const deployedStrategies = await db
      .select()
      .from(strategies)
      .where(eq(strategies.lifecycleState, "DEPLOYED"));

    for (const s of deployedStrategies) {
      const sharpe = s.rollingSharpe30d ? parseFloat(s.rollingSharpe30d) : null;

      if (sharpe !== null && sharpe < 1.0) {
        const result = await this.promoteStrategy(s.id, "DEPLOYED", "DECLINING", { correlationId });
        if (result.success) {
          demoted.push(s.id);

          // Emit regen.auto_triggered audit row — intent record before the fire-and-forget call.
          // This serves as the idempotency marker for the critic-feedback daily sweep
          // (checkDeclingAndTriggerRegen), ensuring it won't re-fire on the same strategy
          // within the 7-day cooldown window. Written fire-and-forget (non-blocking).
          const declineReason = `rolling_sharpe_${sharpe.toFixed(3)}_below_1.0`;
          db.insert(auditLog).values({
            action: "regen.auto_triggered",
            entityType: "strategy",
            entityId: s.id,
            input: {
              strategyName: s.name,
              generation: s.generation,
              triggerPath: "checkAutoDemotions",
              declineReason,
              rollingSharpe30d: sharpe,
            },
            result: {
              note: "evolution auto-spawn fired (fire-and-forget; check strategy.evolved audit row for outcome)",
            },
            status: "pending",
            decisionAuthority: "scheduler",
            correlationId: correlationId ?? null,
          }).catch((auditErr) => {
            logger.warn({ strategyId: s.id, err: auditErr }, "regen.auto_triggered audit insert failed (non-blocking)");
          });

          // Fire-and-forget: trigger self-evolution for declining strategy.
          // evolveStrategy() internally guards: pipeline pause, max generations, 7-day
          // cooldown, circuit breaker. Errors are non-blocking — lifecycle demotion already
          // committed above and the daily sweep (checkDeclingAndTriggerRegen) will retry.
          evolveStrategy(s.id, { correlationId }).then((evoResult) => {
            logger.info({ strategyId: s.id, ...evoResult }, "Auto-evolution completed for declining strategy");
          }).catch((evoErr) => {
            logger.error({ strategyId: s.id, err: evoErr }, "Auto-evolution failed (non-blocking)");
          });
        }
      }
    }

    return demoted;
  }

  /**
   * Get pipeline health — count of strategies per lifecycle state.
   */
  async getPipelineHealth(): Promise<{
    counts: Record<string, number>;
    alerts: string[];
  }> {
    const allStrategies = await db.select().from(strategies);

    const counts: Record<string, number> = {};
    for (const state of VALID_STATES) {
      counts[state] = 0;
    }
    for (const s of allStrategies) {
      const state = s.lifecycleState;
      counts[state] = (counts[state] || 0) + 1;
    }

    const alerts: string[] = [];

    // Alert if strategies waiting for deployment approval
    if (counts.DEPLOY_READY > 0) {
      alerts.push(`${counts.DEPLOY_READY} strateg${counts.DEPLOY_READY === 1 ? "y" : "ies"} ready for deployment — review at GET /api/strategies/library`);
    }

    // Alert if no DEPLOYED strategies
    if (counts.DEPLOYED === 0) {
      alerts.push("No deployed strategies — pipeline is empty");
    }

    // Alert if no CANDIDATE/TESTING strategies (pipeline drying up)
    if (counts.CANDIDATE === 0 && counts.TESTING === 0) {
      alerts.push("No strategies in development — pipeline will dry up");
    }

    // Alert if too many DECLINING
    if (counts.DECLINING > counts.DEPLOYED) {
      alerts.push("More declining than deployed strategies — investigate");
    }

    return { counts, alerts };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // B8: PILOT auto-promotion / auto-kill sweep
  //
  // Called by the 6-hour lifecycle cron alongside checkAutoPromotions().
  // Evaluates every strategy currently in PILOT state:
  //
  //   Promotion criteria (PILOT → DEPLOYED):
  //     - Exactly PILOT_REQUIRED_SESSIONS=5 pilot sessions completed
  //     - All sessions: compliancePassed=true
  //     - rollingSharpeFinal >= PILOT_MIN_SHARPE=1.0 (at least for the last session)
  //     - No kill switch has fired (no 'killed' outcome row)
  //
  //   Auto-kill criteria (PILOT → GRAVEYARD):
  //     - Any pilot session has outcome='killed' (kill switch fired)
  //
  // Contract guarantees:
  //   - Exactly 1 contract is enforced by paper-signal-service during PILOT
  //     (checked via the pilotContracts field on the paper session config).
  //   - This function is non-blocking: errors per strategy are caught and logged.
  //   - Duplicate runs (idempotent): already-promoted strategies are not in PILOT state.
  // ─────────────────────────────────────────────────────────────────────────
  async checkPilotAutoPromotions(context?: { correlationId?: string }): Promise<{
    swept: number;
    promoted: number;
    killed: number;
    pending: number;
    errors: number;
  }> {
    const correlationId = context?.correlationId;

    // HIGH #13: killSwitch is the FIRST gate on every lifecycle-mutating entry path.
    if (await killSwitch.isHaltedForProduction()) {
      logger.warn({ correlationId, fn: "checkPilotAutoPromotions" }, "Skipping — killSwitch halted");
      return { swept: 0, promoted: 0, killed: 0, pending: 0, errors: 0 };
    }

    const PILOT_REQUIRED_SESSIONS = 5;
    const PILOT_MIN_SHARPE = 1.0;

    const result = { swept: 0, promoted: 0, killed: 0, pending: 0, errors: 0 };

    // Find all strategies currently in PILOT state
    const pilotStrategies = await db
      .select({ id: strategies.id, name: strategies.name })
      .from(strategies)
      .where(eq(strategies.lifecycleState, "PILOT"));

    result.swept = pilotStrategies.length;

    for (const s of pilotStrategies) {
      try {
        // Fetch all pilot session rows for this strategy
        const sessions = await db
          .select()
          .from(pilotSessions)
          .where(eq(pilotSessions.strategyId, s.id))
          .orderBy(pilotSessions.sessionNumber);

        // Auto-kill: any session with outcome='killed' means a kill switch fired
        const killedSession = sessions.find((ps) => ps.outcome === "killed");
        if (killedSession) {
          logger.warn(
            { strategyId: s.id, killReason: killedSession.killReason, sessionNumber: killedSession.sessionNumber },
            "PILOT auto-kill: kill switch fired — promoting to GRAVEYARD",
          );
          const killResult = await this.promoteStrategy(s.id, "PILOT", "GRAVEYARD", {
            actor: "system",
            reason: `PILOT kill switch fired in session ${killedSession.sessionNumber}: ${killedSession.killReason ?? "kill_switch"}`,
            correlationId,
          });
          if (killResult.success) {
            result.killed++;
            broadcastSSE("lifecycle:promoted", {
              strategyId: s.id,
              from: "PILOT",
              to: "GRAVEYARD",
              name: s.name,
              reason: killedSession.killReason,
            });
          } else {
            logger.warn({ strategyId: s.id, error: killResult.error }, "PILOT auto-kill promotion failed");
            result.errors++;
          }
          continue;
        }

        // Count completed sessions (outcome = 'passed' or 'failed')
        const completedSessions = sessions.filter((ps) => ps.outcome === "passed" || ps.outcome === "failed");

        if (completedSessions.length < PILOT_REQUIRED_SESSIONS) {
          // Still accumulating sessions — not yet evaluable
          result.pending++;
          logger.debug(
            { strategyId: s.id, completed: completedSessions.length, required: PILOT_REQUIRED_SESSIONS },
            "PILOT: insufficient sessions — pending",
          );
          continue;
        }

        // All 5 sessions completed — evaluate promotion criteria
        const allCompliant = completedSessions.every((ps) => ps.compliancePassed === true);
        // F-4 FIX: ALL sessions must have rollingSharpeFinal >= PILOT_MIN_SHARPE.
        // Previously only the last session was checked, allowing strategies with
        // early sub-threshold Sharpe sessions (e.g. [0.4, 0.3, 0.5, 0.6, 1.1]) to
        // promote. Promotion gate is the trust boundary before live deployment —
        // every session in the canary window must demonstrate quality.
        const allSharpePassed = completedSessions.every(
          (ps) =>
            ps.rollingSharpeFinal != null &&
            parseFloat(String(ps.rollingSharpeFinal)) >= PILOT_MIN_SHARPE,
        );
        const lastSession = completedSessions[completedSessions.length - 1];

        if (allCompliant && allSharpePassed) {
          // PILOT → DEPLOYED: automatic promotion after successful canary
          logger.info(
            {
              strategyId: s.id,
              sessions: completedSessions.length,
              allSharpes: completedSessions.map((ps) => ps.rollingSharpeFinal),
              allCompliant,
            },
            "PILOT auto-promote: 5 sessions passed — promoting to DEPLOYED",
          );
          const promoteResult = await this.promoteStrategy(s.id, "PILOT", "DEPLOYED", {
            actor: "system",
            reason: `PILOT canary passed: ${PILOT_REQUIRED_SESSIONS} sessions, all compliant, rolling Sharpe >= ${PILOT_MIN_SHARPE}`,
            correlationId,
          });
          if (promoteResult.success) {
            result.promoted++;
            broadcastSSE("lifecycle:promoted", {
              strategyId: s.id,
              from: "PILOT",
              to: "DEPLOYED",
              name: s.name,
              pilotSessionsCompleted: completedSessions.length,
              lastRollingSharpe: lastSession?.rollingSharpeFinal,
            });
            // Compile Pine on promotion to DEPLOYED (same as DEPLOY_READY → DEPLOYED path)
            compileDualPineExport(s.id, correlationId ?? undefined).catch((pineErr) => {
              logger.warn({ strategyId: s.id, err: pineErr }, "PILOT auto-promote: Pine export failed (non-blocking)");
            });
          } else {
            logger.warn({ strategyId: s.id, error: promoteResult.error }, "PILOT auto-promote failed");
            result.errors++;
          }
        } else {
          // Criteria not met — send to GRAVEYARD (PILOT failed but no kill switch)
          const failureReason = !allCompliant
            ? "compliance_violation_in_pilot_session"
            : `rolling_sharpe_below_${PILOT_MIN_SHARPE}`;
          logger.warn(
            {
              strategyId: s.id,
              allCompliant,
              allSharpePassed,
              allSharpes: completedSessions.map((ps) => ps.rollingSharpeFinal),
              failureReason,
            },
            "PILOT criteria not met — promoting to GRAVEYARD",
          );
          const failResult = await this.promoteStrategy(s.id, "PILOT", "GRAVEYARD", {
            actor: "system",
            reason: `PILOT failed: ${failureReason}`,
            correlationId,
          });
          if (failResult.success) {
            result.killed++;
            broadcastSSE("lifecycle:promoted", {
              strategyId: s.id,
              from: "PILOT",
              to: "GRAVEYARD",
              name: s.name,
              reason: failureReason,
            });
          } else {
            logger.warn({ strategyId: s.id, error: failResult.error }, "PILOT failure promotion to GRAVEYARD failed");
            result.errors++;
          }
        }
      } catch (err) {
        result.errors++;
        logger.error({ strategyId: s.id, err }, "checkPilotAutoPromotions: error processing PILOT strategy (non-blocking)");
      }
    }

    logger.info(result, "PILOT auto-promotion sweep complete");
    return result;
  }

  /**
   * Record a completed pilot session row for a PILOT strategy.
   * Called by paper-execution-service when a paper session closes for a PILOT strategy.
   *
   * Enforces the 1-contract constraint by reading the pilot session's contracts field.
   * Does NOT promote the strategy — promotion is handled by checkPilotAutoPromotions().
   */
  async recordPilotSession(options: {
    strategyId: string;
    paperSessionId: string;
    rollingSharpeFinal: number | null;
    compliancePassed: boolean;
    outcome: "passed" | "failed" | "killed";
    killReason?: string;
  }): Promise<void> {
    // Count existing pilot sessions for this strategy (determines session_number)
    const [existingCount] = await db
      .select({ n: count() })
      .from(pilotSessions)
      .where(eq(pilotSessions.strategyId, options.strategyId));

    const sessionNumber = Number(existingCount?.n ?? 0) + 1;

    await db.insert(pilotSessions).values({
      strategyId: options.strategyId,
      sessionNumber,
      paperSessionId: options.paperSessionId,
      rollingSharpeFinal: options.rollingSharpeFinal != null ? String(options.rollingSharpeFinal) : null,
      compliancePassed: options.compliancePassed,
      contracts: 1,  // Always 1 in PILOT
      completedAt: new Date(),
      outcome: options.outcome,
      killReason: options.killReason ?? null,
    });

    logger.info(
      {
        strategyId: options.strategyId,
        sessionNumber,
        outcome: options.outcome,
        rollingSharpeFinal: options.rollingSharpeFinal,
        compliancePassed: options.compliancePassed,
      },
      "Pilot session recorded",
    );
  }
}

// ─── F-4: promoted_at backfill from lifecycle_transitions ────────────────────
// The schema has no `strategies.promoted_at` column. Python decay computations
// need the strategy's most-recent DEPLOYED transition timestamp to short-circuit
// the decay verdict during the grace window. This helper queries
// lifecycle_transitions for the latest row with to_state='DEPLOYED' for the
// given strategy and returns an ISO string (the format the Python helper
// `_within_grace_period()` accepts as a string).
//
// Returns null when:
//   - the strategy has never been promoted to DEPLOYED
//   - the lookup throws (caller treats null as "no grace period")
export async function getPromotedAtFromTransitions(
  strategyId: string,
): Promise<string | null> {
  try {
    const rows = await db
      .select({ createdAt: lifecycleTransitions.createdAt })
      .from(lifecycleTransitions)
      .where(
        and(
          eq(lifecycleTransitions.strategyId, strategyId),
          eq(lifecycleTransitions.toState, "DEPLOYED"),
        ),
      )
      .orderBy(desc(lifecycleTransitions.createdAt))
      .limit(1);
    const row = rows[0];
    if (!row || !row.createdAt) return null;
    return new Date(row.createdAt).toISOString();
  } catch (err) {
    logger.warn(
      { err, strategyId },
      "lifecycle-service: getPromotedAtFromTransitions failed — returning null (no grace period)",
    );
    return null;
  }
}
