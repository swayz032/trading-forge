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

import { eq, and, desc, gte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies, strategyNames, strategyGraveyard, backtests, auditLog, lifecycleTransitions, monteCarloRuns, quantumMcRuns, paperSessions, paperTrades, complianceRulesets } from "../db/schema.js";
import { computeAgreement } from "../lib/quantum-agreement.js";
import { logger } from "../index.js";
import { evolveStrategy } from "./evolution-service.js";
import { AlertFactory } from "./alert-service.js";
import { broadcastSSE } from "../routes/sse.js";
import { compileDualPineExport } from "./pine-export-service.js";
import { agentCoordinator } from "./agent-coordinator-service.js";
import { tracer } from "../lib/tracing.js";
import { strategyPromotions } from "../lib/metrics-registry.js";

const VALID_STATES = [
  "CANDIDATE",
  "TESTING",
  "PAPER",
  "DEPLOY_READY",
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
  TESTING: ["PAPER", "DECLINING", "GRAVEYARD"],  // Demotable on catastrophic failure
  PAPER: ["DEPLOY_READY", "DECLINING", "GRAVEYARD"],  // Demotable on drift
  DEPLOY_READY: ["DEPLOYED", "PAPER", "GRAVEYARD"],  // Human approves deploy OR sends back to paper
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
const FIRM_KEY_TO_FIRM_NAME: Record<string, string> = {
  topstep_50k: "Topstep",
  mffu_50k: "MFFU",
  tpt_50k: "TPT",
  apex_50k: "Apex",
  ffn_50k: "FFN",
  alpha_50k: "Alpha",
  tradeify_50k: "Tradeify",
  earn2trade_50k: "Earn2Trade",
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
  ): Promise<{ success: boolean; error?: string }> {
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
  ): Promise<{ success: boolean; error?: string }> {
    if (fromState === "DEPLOY_READY" && toState === "DEPLOYED" && options.actor !== "human_release") {
      const error = "Only manual release authority can promote DEPLOY_READY -> DEPLOYED";
      logger.warn({ id, fromState, toState, actor: options.actor ?? "system" }, error);
      return { success: false, error };
    }

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
    } = {
      backtestId: null,
      forgeScore: null,
      mcSurvivalRate: null,
      quantumAgreementScore: null,
      quantumAdvantageDelta: null,
      quantumFallbackTriggered: false,
      quantumClassicalDisagreementPct: null,
    };

    try {
      const [latestBtEvidence] = await (tx ?? db)
        .select({
          id: backtests.id,
          forgeScore: backtests.forgeScore,
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
      }
    } catch (evidenceErr) {
      // Non-blocking — evidence enrichment must never abort a promotion
      logger.warn({ strategyId: id, err: evidenceErr }, "promoteStrategy: evidence lookup failed (audit row will lack backtestId/forgeScore/mcSurvivalRate)");
    }

    // Atomic write block: state update + (optional) name retire + audit rows.
    // If a caller provided a tx we run inline against it (caller owns commit/rollback);
    // otherwise we open a fresh db.transaction() for these writes.
    const writeBlock = async (txCtx: typeof db): Promise<void> => {
      // Update strategy lifecycle state
      await txCtx
        .update(strategies)
        .set({
          lifecycleState: toState,
          lifecycleChangedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(strategies.id, id));

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

    if (tx) {
      // Caller owns the transaction — run inline, do not open a new tx.
      await writeBlock(tx);
    } else {
      // Standalone path — open a transaction. On throw, the entire unit rolls back.
      await db.transaction(async (innerTx) => {
        await writeBlock(innerTx as unknown as typeof db);
      });
    }

    // ── Post-commit side effects ────────────────────────────────────────────
    // Everything below this line runs ONLY after the transaction commits
    // successfully. SSE/fire-and-forget burial NEVER fires on rollback.

    if (retiredCodename) {
      logger.info({ strategyId: id, codename: retiredCodename }, "Forge name retired with strategy");
    }

    // Fire-and-forget burial for DECLINING/RETIRED. The pending audit row written
    // inside the tx is the durable record; this call is opportunistic.
    if (toState === "DECLINING" || toState === "RETIRED") {
      this.buryInGraveyard(id, strategy, options.correlationId).catch((buryErr) => {
        logger.warn(
          { strategyId: id, toState, err: buryErr },
          "Failed to auto-bury strategy in graveyard (non-blocking — pending audit row exists)",
        );
      });
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
    await db.insert(auditLog).values({
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
            .select({ propCompliance: backtests.propCompliance })
            .from(backtests)
            .where(
              and(
                eq(backtests.strategyId, s.id),
                eq(backtests.status, "completed"),
              ),
            )
            .orderBy(desc(backtests.createdAt))
            .limit(1);

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
          // Drift-check infrastructure failure is informational. Failing closed
          // here would block every PAPER→DEPLOY_READY when compliance_rulesets
          // table is unhealthy; the human can still revalidate manually.
          logger.warn(
            { strategyId: s.id, err: driftCheckErr },
            "PAPER → DEPLOY_READY drift-check threw (non-blocking, promotion continues)",
          );
        }

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
   * Check for auto-demotions: DEPLOYED → DECLINING if rolling Sharpe < 1.0.
   */
  async checkAutoDemotions(context?: { correlationId?: string }): Promise<string[]> {
    const correlationId = context?.correlationId;
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

          // Fire-and-forget: trigger self-evolution for declining strategy
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
}
