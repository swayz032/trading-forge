/**
 * Critic Feedback Service — Evaluates critic accuracy over time.
 *
 * Compares strategies the critic approved (passed into PAPER or beyond)
 * against their actual lifecycle outcomes. Tracks false positive rate
 * and auto-tightens thresholds when too many approved strategies fail.
 *
 * Runs weekly via scheduler.
 */

import { db } from "../db/index.js";
import { strategies, subsystemMetrics, systemParameters, systemParameterHistory } from "../db/schema.js";
import { sql, eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

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

  // Auto-adjust critic thresholds if false positive rate is too high
  // Only trigger with sufficient sample size (10+ strategies)
  if (falsePositiveRate > 0.30 && total >= 10) {
    logger.warn(
      { falsePositiveRate, total, demoted },
      "Critic false positive rate > 30% — auto-tightening thresholds",
    );

    // Tighten the minimum forge score threshold by 5 points
    try {
      const [current] = await db
        .select()
        .from(systemParameters)
        .where(eq(systemParameters.paramName, "critic_min_forge_score"))
        .limit(1);

      if (current) {
        const newValue = (Number(current.currentValue) + 5).toString();

        await db.insert(systemParameterHistory).values({
          paramId: current.id,
          previousValue: current.currentValue,
          newValue,
          reason: "false_positive_rate > 30%",
          source: "critic_feedback_auto_tighten",
        });

        await db
          .update(systemParameters)
          .set({ currentValue: newValue, updatedAt: new Date() })
          .where(eq(systemParameters.id, current.id));

        logger.info({ oldValue: current.currentValue, newValue }, "Critic min forge score threshold increased by 5");
      } else {
        logger.warn("critic_min_forge_score param not found — skipping auto-tighten");
      }
    } catch (err) {
      logger.warn({ err }, "Could not auto-adjust critic threshold");
    }
  }

  logger.info(
    { total, maintained, demoted, accuracy: Math.round(accuracy * 100), falsePositiveRate: Math.round(falsePositiveRate * 100) },
    "Critic accuracy evaluated",
  );

  return { totalEvaluated: total, maintained, demoted, accuracy, falsePositiveRate };
}
