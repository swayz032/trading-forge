/**
 * Critic Feedback Service — Evaluates critic accuracy over time, and auto-triggers
 * strategy regeneration when strategies enter DECLINING state.
 *
 * Two responsibilities:
 * 1. evaluateCriticAccuracy() — weekly: compare approved strategies' paper
 *    performance against lifecycle outcomes, auto-tighten thresholds on high FPR.
 * 2. checkDeclingAndTriggerRegen() — daily sweep: find all strategies in DECLINING
 *    state that have not had a regen attempt in the last 7 days and auto-spawn
 *    evolution via evolveStrategy(). Catches DECLINING entries from ALL paths:
 *    - checkAutoDemotions() (DEPLOYED → DECLINING via Sharpe < 1.0)
 *    - Manual lifecycle PATCH (any state → DECLINING)
 *    - PAPER → DECLINING (drift demotion)
 *    - TESTING → DECLINING (catastrophic failure)
 *
 * Throttling / idempotency / recursion guards:
 * - 7-day cooldown per strategy (enforced by evolveStrategy() internally; also
 *   checked here via audit_log to prevent even calling evolveStrategy() on cooldown)
 * - Max 3 generations per lineage (enforced by evolveStrategy()'s MAX_GENERATIONS)
 * - Pipeline pause guard: isActive() check at sweep entry — skip entire sweep
 * - Graceful failure: per-strategy errors are caught and logged; sweep continues
 * - Every auto-trigger emits a regen.auto_triggered audit_log row for observability
 */

import { db } from "../db/index.js";
import { strategies, subsystemMetrics, systemParameters, systemParameterHistory, auditLog } from "../db/schema.js";
import { sql, eq, and, gte, or } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { isActive as isPipelineActive } from "./pipeline-control-service.js";
import { evolveStrategy } from "./evolution-service.js";

/**
 * Evaluate critic accuracy by comparing approved strategies' paper performance
 * with their actual lifecycle outcomes.
 */
export async function evaluateCriticAccuracy(): Promise<{
  totalEvaluated: number;
  maintained: number;
  demoted: number;
  accuracy: number;
  falsePositiveRate: number;
}> {
  // Find strategies that were critic-approved and entered PAPER at least 30 days ago
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Get strategies that went through PAPER stage (lifecycle_changed_at < 30d ago
  // means they've had time to prove themselves)
  const paperStrategies = await db
    .select({
      id: strategies.id,
      lifecycleState: strategies.lifecycleState,
      rollingSharpe: strategies.rollingSharpe30d,
    })
    .from(strategies)
    .where(sql`lifecycle_changed_at < ${thirtyDaysAgo} AND lifecycle_state IN (
      'PAPER', 'DEPLOY_READY', 'DEPLOYED',
      'DECLINING', 'RETIRED', 'GRAVEYARD'
    )`);

  if (paperStrategies.length === 0) {
    logger.info("Critic feedback: no strategies old enough to evaluate");
    return { totalEvaluated: 0, maintained: 0, demoted: 0, accuracy: 0, falsePositiveRate: 0 };
  }

  // Maintained = still in a healthy state (PAPER, DEPLOY_READY, DEPLOYED)
  const maintained = paperStrategies.filter((s) =>
    ["PAPER", "DEPLOY_READY", "DEPLOYED"].includes(s.lifecycleState),
  ).length;

  // Demoted = went to a failure state (DECLINING, RETIRED, GRAVEYARD)
  const demoted = paperStrategies.filter((s) =>
    ["DECLINING", "RETIRED", "GRAVEYARD"].includes(s.lifecycleState),
  ).length;

  const total = paperStrategies.length;
  const accuracy = total > 0 ? maintained / total : 0;
  const falsePositiveRate = total > 0 ? demoted / total : 0;

  // Store metrics
  const now = new Date();
  await db.insert(subsystemMetrics).values([
    {
      subsystem: "critic",
      metricName: "accuracy",
      metricValue: String(Math.round(accuracy * 10000) / 100),
      tags: null,
      measuredAt: now,
    },
    {
      subsystem: "critic",
      metricName: "false_positive_rate",
      metricValue: String(Math.round(falsePositiveRate * 10000) / 100),
      tags: null,
      measuredAt: now,
    },
    {
      subsystem: "critic",
      metricName: "total_evaluated",
      metricValue: String(total),
      tags: null,
      measuredAt: now,
    },
  ]);

  // Track E F-7: cap + floor prevent runaway threshold drift.
  // Without bounds the threshold could ratchet above 85 (no strategy would pass)
  // or never loosen when FPR recovered, starving the pipeline.
  const CRITIC_FORGE_SCORE_MAX = 85; // threshold hard ceiling — above this, nothing passes
  const CRITIC_FORGE_SCORE_MIN = 50; // threshold hard floor — below this, filter is useless

  // Auto-adjust critic thresholds if false positive rate is too high
  // Only trigger with sufficient sample size (10+ strategies)
  if (falsePositiveRate > 0.30 && total >= 10) {
    logger.warn(
      { falsePositiveRate, total, demoted },
      "Critic false positive rate > 30% — auto-tightening thresholds",
    );

    // Tighten the minimum forge score threshold by 5 points (capped at MAX)
    try {
      const [current] = await db
        .select()
        .from(systemParameters)
        .where(eq(systemParameters.paramName, "critic_min_forge_score"))
        .limit(1);

      if (current) {
        const currentValue = Number(current.currentValue);
        const newValue = Math.min(currentValue + 5, CRITIC_FORGE_SCORE_MAX);
        if (newValue > currentValue) {
          await db.insert(systemParameterHistory).values({
            paramId: current.id,
            previousValue: current.currentValue,
            newValue: newValue.toString(),
            reason: "false_positive_rate > 30%",
            source: "critic_feedback_auto_tighten",
          });

          await db
            .update(systemParameters)
            .set({ currentValue: newValue.toString(), updatedAt: new Date() })
            .where(eq(systemParameters.id, current.id));

          logger.warn({ from: currentValue, to: newValue }, "critic threshold tightened");
        } else {
          logger.warn({ currentValue, cap: CRITIC_FORGE_SCORE_MAX }, "critic threshold already at cap — skipping tighten");
        }
      } else {
        logger.warn("critic_min_forge_score param not found — skipping auto-tighten");
      }
    } catch (err) {
      logger.warn({ err }, "Could not auto-adjust critic threshold (tighten)");
    }
  } else if (falsePositiveRate < 0.10 && total >= 20) {
    // Track E F-7: auto-loosen when FPR is healthy — prevents threshold from staying
    // elevated after a transient high-FPR period, which would starve the pipeline.
    try {
      const [current] = await db
        .select()
        .from(systemParameters)
        .where(eq(systemParameters.paramName, "critic_min_forge_score"))
        .limit(1);

      if (current) {
        const currentValue = Number(current.currentValue);
        const newValue = Math.max(currentValue - 2, CRITIC_FORGE_SCORE_MIN);
        if (newValue < currentValue) {
          await db.insert(systemParameterHistory).values({
            paramId: current.id,
            previousValue: current.currentValue,
            newValue: newValue.toString(),
            reason: "false_positive_rate < 10%",
            source: "critic_feedback_auto_loosen",
          });

          await db
            .update(systemParameters)
            .set({ currentValue: newValue.toString(), updatedAt: new Date() })
            .where(eq(systemParameters.id, current.id));

          logger.info({ from: currentValue, to: newValue }, "critic threshold loosened");
        }
      }
    } catch (err) {
      logger.warn({ err }, "Could not auto-adjust critic threshold (loosen)");
    }
  }

  logger.info(
    { total, maintained, demoted, accuracy: Math.round(accuracy * 100), falsePositiveRate: Math.round(falsePositiveRate * 100) },
    "Critic accuracy evaluated",
  );

  return { totalEvaluated: total, maintained, demoted, accuracy, falsePositiveRate };
}

// ─── Regen auto-trigger constants ─────────────────────────────────────────────
/** Matches MAX_GENERATIONS in evolution-service.ts — variants from any lineage root
 *  that has already reached generation 3 are silently skipped (evolveStrategy()
 *  would retire them instead of spawning more variants). */
const REGEN_MAX_GENERATION = 3;

/** Must match COOLDOWN_DAYS in evolution-service.ts. */
const REGEN_COOLDOWN_DAYS = 7;

/** audit_log action emitted when this sweep fires evolution for a strategy. */
const REGEN_AUDIT_ACTION = "regen.auto_triggered";

/**
 * Daily sweep: find all DECLINING strategies that have not had a regen attempt
 * in the last 7 days and auto-spawn evolution.
 *
 * Design:
 * - Queries strategies in DECLINING state.
 * - For each, checks audit_log for a recent regen.auto_triggered row (idempotency).
 * - Skips strategies at or beyond MAX_GENERATIONS (evolveStrategy() would retire
 *   them; this check avoids an unnecessary DB round-trip to the Python evolver).
 * - Skips the entire sweep when the pipeline is paused.
 * - Emits regen.auto_triggered audit row BEFORE calling evolveStrategy() so that
 *   the intent is durable even if the evolution call crashes.
 * - Errors per strategy are caught and logged; the sweep continues to the next.
 *
 * Returns a summary of what happened for each DECLINING strategy.
 */
export async function checkDeclingAndTriggerRegen(context?: {
  correlationId?: string;
}): Promise<{
  sweepRan: boolean;
  skippedPipelinePaused: boolean;
  total: number;
  triggered: number;
  skippedCooldown: number;
  skippedMaxGeneration: number;
  errors: number;
  triggeredStrategyIds: string[];
}> {
  const correlationId = context?.correlationId;

  // ── Pipeline pause guard ─────────────────────────────────────────────────
  if (!(await isPipelineActive())) {
    logger.info({ fn: "checkDeclingAndTriggerRegen" }, "Regen sweep skipped: pipeline paused");
    return {
      sweepRan: false,
      skippedPipelinePaused: true,
      total: 0,
      triggered: 0,
      skippedCooldown: 0,
      skippedMaxGeneration: 0,
      errors: 0,
      triggeredStrategyIds: [],
    };
  }

  // ── Find all DECLINING strategies ────────────────────────────────────────
  const decliningStrategies = await db
    .select({
      id: strategies.id,
      name: strategies.name,
      generation: strategies.generation,
      parentStrategyId: strategies.parentStrategyId,
      lifecycleState: strategies.lifecycleState,
      lifecycleChangedAt: strategies.lifecycleChangedAt,
      rollingSharpe30d: strategies.rollingSharpe30d,
    })
    .from(strategies)
    .where(eq(strategies.lifecycleState, "DECLINING"));

  const total = decliningStrategies.length;

  if (total === 0) {
    logger.info({ fn: "checkDeclingAndTriggerRegen" }, "Regen sweep: no DECLINING strategies found");
    return {
      sweepRan: true,
      skippedPipelinePaused: false,
      total: 0,
      triggered: 0,
      skippedCooldown: 0,
      skippedMaxGeneration: 0,
      errors: 0,
      triggeredStrategyIds: [],
    };
  }

  logger.info({ fn: "checkDeclingAndTriggerRegen", total, correlationId }, "Regen sweep started");

  const cooldownCutoff = new Date(Date.now() - REGEN_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
  let triggered = 0;
  let skippedCooldown = 0;
  let skippedMaxGeneration = 0;
  let errors = 0;
  const triggeredStrategyIds: string[] = [];

  for (const s of decliningStrategies) {
    try {
      // ── Recursion / max-generation guard ──────────────────────────────────
      // Strategies at or beyond MAX_GENERATIONS will be retired by evolveStrategy(),
      // not evolved. Skip the trigger entirely — no audit row needed, no Python call.
      if (s.generation >= REGEN_MAX_GENERATION) {
        logger.info(
          { fn: "checkDeclingAndTriggerRegen", strategyId: s.id, generation: s.generation },
          "Regen sweep: skipping (max generation reached)",
        );
        skippedMaxGeneration++;
        continue;
      }

      // ── Idempotency guard: 7-day cooldown per strategy ────────────────────
      // Check audit_log for a recent regen.auto_triggered row for this strategy.
      // This prevents re-triggering on strategies where evolution is already in
      // progress or was attempted recently (evolveStrategy() also has this guard
      // internally, but the outer check avoids a wasted Python LLM call).
      const [recentRegenRow] = await db
        .select({ id: auditLog.id, createdAt: auditLog.createdAt })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, REGEN_AUDIT_ACTION),
            eq(auditLog.entityType, "strategy"),
            eq(auditLog.entityId, s.id),
            gte(auditLog.createdAt, cooldownCutoff),
          ),
        )
        .limit(1);

      if (recentRegenRow) {
        logger.info(
          {
            fn: "checkDeclingAndTriggerRegen",
            strategyId: s.id,
            lastTriggeredAt: recentRegenRow.createdAt.toISOString(),
          },
          "Regen sweep: skipping (cooldown active)",
        );
        skippedCooldown++;
        continue;
      }

      // ── Emit audit row BEFORE calling evolveStrategy() ──────────────────
      // The intent must be durable even if the evolution call fails. The audit row
      // also serves as the idempotency marker for the next sweep run.
      const declineReason = s.rollingSharpe30d !== null
        ? `rolling_sharpe_${parseFloat(s.rollingSharpe30d ?? "0").toFixed(3)}`
        : "unknown";

      await db.insert(auditLog).values({
        action: REGEN_AUDIT_ACTION,
        entityType: "strategy",
        entityId: s.id,
        input: {
          strategyName: s.name,
          generation: s.generation,
          parentStrategyId: s.parentStrategyId ?? null,
          lifecycleState: s.lifecycleState,
          declineReason,
          cooldownCutoff: cooldownCutoff.toISOString(),
        },
        result: {
          note: "evolution auto-spawn fired (fire-and-forget; check strategy.evolved audit row for outcome)",
        },
        status: "pending",
        decisionAuthority: "scheduler",
        correlationId: correlationId ?? null,
      });

      // ── Fire-and-forget evolveStrategy() ────────────────────────────────
      // Non-blocking: lifecycle transitions are not held for evolution to complete.
      // Graceful failure: errors are caught, logged, and the sweep continues.
      // evolveStrategy() internally handles:
      //   - pipeline pause guard (returns { status: "skipped" })
      //   - max generations (retires the strategy)
      //   - 7-day cooldown (returns { status: "cooldown" })
      //   - circuit breaker (returns { status: "deferred" })
      evolveStrategy(s.id, { correlationId }).then((evoResult) => {
        logger.info(
          { strategyId: s.id, evoStatus: evoResult.status, evolved: evoResult.evolved },
          "Regen auto-trigger: evolveStrategy completed",
        );
      }).catch((evoErr) => {
        logger.error(
          { strategyId: s.id, err: evoErr },
          "Regen auto-trigger: evolveStrategy threw unexpectedly (non-blocking)",
        );
      });

      triggeredStrategyIds.push(s.id);
      triggered++;

      logger.info(
        {
          fn: "checkDeclingAndTriggerRegen",
          strategyId: s.id,
          strategyName: s.name,
          generation: s.generation,
          declineReason,
          correlationId,
        },
        "Regen auto-trigger: evolution spawned",
      );
    } catch (err) {
      logger.error(
        { fn: "checkDeclingAndTriggerRegen", strategyId: s.id, err },
        "Regen sweep: per-strategy error (non-blocking — sweep continues)",
      );
      errors++;
    }
  }

  logger.info(
    {
      fn: "checkDeclingAndTriggerRegen",
      total,
      triggered,
      skippedCooldown,
      skippedMaxGeneration,
      errors,
      correlationId,
    },
    "Regen sweep complete",
  );

  return {
    sweepRan: true,
    skippedPipelinePaused: false,
    total,
    triggered,
    skippedCooldown,
    skippedMaxGeneration,
    errors,
    triggeredStrategyIds,
  };
}
