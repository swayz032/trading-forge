/**
 * Meta Optimizer Service — Phase 3.3: Auto-Tuning
 *
 * Monthly gate analysis: reviews system-wide performance metrics and
 * recommends (or auto-applies) parameter adjustments to system-level
 * thresholds like minimum forge score, MC survival threshold, rate limits, etc.
 *
 * Safety: changes are always logged to system_parameter_history.
 * Auto-tunable parameters are updated directly; others generate recommendations.
 */

import { eq, gte, and } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  strategies,
  backtests,
  criticOptimizationRuns,
  paperSessions,
  paperTrades,
  systemParameters,
  systemParameterHistory,
  auditLog,
} from "../db/schema.js";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../index.js";
import { agentCoordinator } from "./agent-coordinator-service.js";

// ─── Gate Analysis Types ────────────────────────────────────────────

interface GateMetrics {
  /** How many strategies passed each lifecycle stage in the review period */
  pipelineThroughput: {
    candidateToTesting: number;
    testingToPaper: number;
    paperToDeployReady: number;
    deployedCount: number;
    retiredCount: number;
    graveyardCount: number;
  };
  /** Average backtest quality metrics across completed backtests */
  backtestQuality: {
    avgForgeScore: number;
    avgSharpe: number;
    avgProfitFactor: number;
    passRate: number; // % that passed tier gates
    totalCompleted: number;
  };
  /** Critic optimizer effectiveness */
  criticEffectiveness: {
    totalRuns: number;
    survivorRate: number; // % that produced a survivor
    avgUplift: number;
    failRate: number;
  };
  /** Paper trading health */
  paperHealth: {
    activeSessions: number;
    avgDailyPnl: number;
    avgWinRate: number;
  };
}

interface ParameterRecommendation {
  paramName: string;
  currentValue: number;
  suggestedValue: number;
  reason: string;
  autoApplicable: boolean;
  confidence: "high" | "medium" | "low";
}

interface MetaOptimizationResult {
  metrics: GateMetrics;
  recommendations: ParameterRecommendation[];
  appliedChanges: Array<{ param: string; oldValue: number; newValue: number }>;
  reviewPeriodDays: number;
  timestamp: string;
}

// ─── Metrics Collection ─────────────────────────────────────────────

async function collectGateMetrics(reviewPeriodDays: number = 30): Promise<GateMetrics> {
  const cutoff = new Date(Date.now() - reviewPeriodDays * 24 * 60 * 60 * 1000);

  // Pipeline throughput
  const allStrats = await db.select({ state: strategies.lifecycleState }).from(strategies);
  const stateCounts: Record<string, number> = {};
  for (const s of allStrats) {
    stateCounts[s.state] = (stateCounts[s.state] ?? 0) + 1;
  }

  // Recent backtests
  const recentBacktests = await db
    .select()
    .from(backtests)
    .where(and(eq(backtests.status, "completed"), gte(backtests.createdAt, cutoff)));

  const forgeScores = recentBacktests.map((b) => Number(b.forgeScore ?? 0)).filter((s) => s > 0);
  const sharpes = recentBacktests.map((b) => Number(b.sharpeRatio ?? 0)).filter((s) => s !== 0);
  const pfs = recentBacktests.map((b) => Number(b.profitFactor ?? 0)).filter((s) => s > 0);
  const tiered = recentBacktests.filter((b) => b.tier && b.tier !== "REJECTED");

  // Critic runs
  const recentCriticRuns = await db
    .select()
    .from(criticOptimizationRuns)
    .where(gte(criticOptimizationRuns.createdAt, cutoff));

  const completedCritic = recentCriticRuns.filter((r) => r.status === "completed");
  const withSurvivor = completedCritic.filter((r) => r.survivorCandidateId !== null);
  const failedCritic = recentCriticRuns.filter((r) => r.status === "failed");

  // Paper sessions
  const activeSessions = await db
    .select()
    .from(paperSessions)
    .where(eq(paperSessions.status, "active"));

  // Paper trades in review period
  const recentPaperTrades = await db
    .select({ pnl: paperTrades.pnl })
    .from(paperTrades)
    .where(gte(paperTrades.exitTime, cutoff));

  const paperPnls = recentPaperTrades.map((t) => Number(t.pnl ?? 0));
  const paperWins = paperPnls.filter((p) => p > 0).length;

  return {
    pipelineThroughput: {
      candidateToTesting: stateCounts["TESTING"] ?? 0,
      testingToPaper: stateCounts["PAPER"] ?? 0,
      paperToDeployReady: stateCounts["DEPLOY_READY"] ?? 0,
      deployedCount: stateCounts["DEPLOYED"] ?? 0,
      retiredCount: stateCounts["RETIRED"] ?? 0,
      graveyardCount: stateCounts["GRAVEYARD"] ?? 0,
    },
    backtestQuality: {
      avgForgeScore: forgeScores.length > 0 ? forgeScores.reduce((a, b) => a + b, 0) / forgeScores.length : 0,
      avgSharpe: sharpes.length > 0 ? sharpes.reduce((a, b) => a + b, 0) / sharpes.length : 0,
      avgProfitFactor: pfs.length > 0 ? pfs.reduce((a, b) => a + b, 0) / pfs.length : 0,
      passRate: recentBacktests.length > 0 ? tiered.length / recentBacktests.length : 0,
      totalCompleted: recentBacktests.length,
    },
    criticEffectiveness: {
      totalRuns: recentCriticRuns.length,
      survivorRate: completedCritic.length > 0 ? withSurvivor.length / completedCritic.length : 0,
      avgUplift: 0, // Would need to compute from composite score deltas
      failRate: recentCriticRuns.length > 0 ? failedCritic.length / recentCriticRuns.length : 0,
    },
    paperHealth: {
      activeSessions: activeSessions.length,
      avgDailyPnl: paperPnls.length > 0 ? paperPnls.reduce((a, b) => a + b, 0) / Math.max(1, paperPnls.length) : 0,
      avgWinRate: paperPnls.length > 0 ? paperWins / paperPnls.length : 0,
    },
  };
}

// ─── Recommendation Engine ──────────────────────────────────────────

function generateRecommendations(
  metrics: GateMetrics,
  currentParams: Map<string, { value: number; autoTunable: boolean }>,
): ParameterRecommendation[] {
  const recs: ParameterRecommendation[] = [];

  // If pass rate is too low, consider lowering forge score threshold slightly
  if (metrics.backtestQuality.passRate < 0.05 && metrics.backtestQuality.totalCompleted > 10) {
    const current = currentParams.get("minimum_forge_score")?.value ?? 50;
    recs.push({
      paramName: "minimum_forge_score",
      currentValue: current,
      suggestedValue: Math.max(40, current - 5),
      reason: `Backtest pass rate is ${(metrics.backtestQuality.passRate * 100).toFixed(1)}% — pipeline may be too restrictive`,
      autoApplicable: false,
      confidence: "medium",
    });
  }

  // If pass rate is very high, tighten gates
  if (metrics.backtestQuality.passRate > 0.5 && metrics.backtestQuality.totalCompleted > 10) {
    const current = currentParams.get("minimum_forge_score")?.value ?? 50;
    recs.push({
      paramName: "minimum_forge_score",
      currentValue: current,
      suggestedValue: Math.min(70, current + 5),
      reason: `Backtest pass rate is ${(metrics.backtestQuality.passRate * 100).toFixed(1)}% — gates may be too loose`,
      autoApplicable: false,
      confidence: "medium",
    });
  }

  // If critic failure rate is high, increase rate limit
  if (metrics.criticEffectiveness.failRate > 0.5 && metrics.criticEffectiveness.totalRuns > 5) {
    const current = currentParams.get("critic_rate_limit_hours")?.value ?? 24;
    recs.push({
      paramName: "critic_rate_limit_hours",
      currentValue: current,
      suggestedValue: Math.min(48, current + 12),
      reason: `Critic fail rate ${(metrics.criticEffectiveness.failRate * 100).toFixed(0)}% — increase cooldown to reduce wasted compute`,
      autoApplicable: currentParams.get("critic_rate_limit_hours")?.autoTunable ?? false,
      confidence: "high",
    });
  }

  // If paper average daily PnL is negative, flag
  if (metrics.paperHealth.avgDailyPnl < 0 && metrics.paperHealth.activeSessions > 0) {
    recs.push({
      paramName: "paper_promotion_sharpe_threshold",
      currentValue: currentParams.get("paper_promotion_sharpe_threshold")?.value ?? 1.5,
      suggestedValue: 1.75,
      reason: `Paper trading avg daily P&L is negative ($${metrics.paperHealth.avgDailyPnl.toFixed(0)}) — tighten promotion threshold`,
      autoApplicable: false,
      confidence: "medium",
    });
  }

  // If no strategies reach PAPER stage, loosen testing -> paper gate
  if (metrics.pipelineThroughput.testingToPaper === 0 && metrics.pipelineThroughput.candidateToTesting > 3) {
    const current = currentParams.get("mc_survival_threshold")?.value ?? 0.7;
    recs.push({
      paramName: "mc_survival_threshold",
      currentValue: current,
      suggestedValue: Math.max(0.6, current - 0.05),
      reason: `No strategies reached PAPER despite ${metrics.pipelineThroughput.candidateToTesting} in TESTING — MC gate may be too strict`,
      autoApplicable: false,
      confidence: "low",
    });
  }

  return recs;
}

// ─── Apply Auto-Tunable Changes ─────────────────────────────────────

async function applyAutoTunableChanges(
  recommendations: ParameterRecommendation[],
): Promise<Array<{ param: string; oldValue: number; newValue: number }>> {
  const applied: Array<{ param: string; oldValue: number; newValue: number }> = [];

  for (const rec of recommendations) {
    if (!rec.autoApplicable) continue;
    if (rec.confidence === "low") continue; // Don't auto-apply low confidence

    try {
      // Find param in DB
      const [param] = await db
        .select()
        .from(systemParameters)
        .where(eq(systemParameters.paramName, rec.paramName))
        .limit(1);

      if (!param || !param.autoTunable) continue;

      // Check bounds
      const min = param.minValue ? Number(param.minValue) : -Infinity;
      const max = param.maxValue ? Number(param.maxValue) : Infinity;
      const clampedValue = Math.max(min, Math.min(max, rec.suggestedValue));

      // Update
      await db
        .update(systemParameters)
        .set({ currentValue: String(clampedValue), updatedAt: new Date() })
        .where(eq(systemParameters.id, param.id));

      // Log history
      await db.insert(systemParameterHistory).values({
        paramId: param.id,
        previousValue: param.currentValue,
        newValue: String(clampedValue),
        reason: rec.reason,
        source: "meta-optimizer",
        gateMetrics: rec as any,
      });

      applied.push({ param: rec.paramName, oldValue: Number(param.currentValue), newValue: clampedValue });

      // Notify coordinator
      await agentCoordinator.emit("meta:parameter_changed", {
        param: rec.paramName,
        oldValue: Number(param.currentValue),
        newValue: clampedValue,
        reason: rec.reason,
      });
    } catch (err) {
      logger.error({ paramName: rec.paramName, err }, "Failed to auto-apply parameter change");
    }
  }

  return applied;
}

// ─── Main Entry Point ───────────────────────────────────────────────

/**
 * Run the monthly meta-optimization review.
 * Collects gate metrics, generates recommendations, applies auto-tunable changes.
 */
export async function runMetaParameterReview(
  reviewPeriodDays: number = 30,
): Promise<MetaOptimizationResult> {
  try {
    logger.info({ reviewPeriodDays }, "Meta optimizer: starting parameter review");

    // 1. Collect metrics
    const metrics = await collectGateMetrics(reviewPeriodDays);

    // 2. Load current parameters
    const params = await db.select().from(systemParameters);
    const paramMap = new Map<string, { value: number; autoTunable: boolean }>();
    for (const p of params) {
      paramMap.set(p.paramName, {
        value: Number(p.currentValue),
        autoTunable: p.autoTunable ?? false,
      });
    }

    // 3. Generate recommendations
    const recommendations = generateRecommendations(metrics, paramMap);

    // 4. Apply auto-tunable changes
    const appliedChanges = await applyAutoTunableChanges(recommendations);

    const result: MetaOptimizationResult = {
      metrics,
      recommendations,
      appliedChanges,
      reviewPeriodDays,
      timestamp: new Date().toISOString(),
    };

    // 5. Audit log
    try {
      await db.insert(auditLog).values({
        action: "meta-optimizer.review",
        entityType: "system_parameters",
        entityId: "meta-review",
        input: JSON.stringify({ metrics }),
        result: JSON.stringify({ recommendations: recommendations.length, applied: appliedChanges.length }),
        status: "success",
        decisionAuthority: "agent",
      });
    } catch {
      // Non-blocking
    }

    // 6. Broadcast
    broadcastSSE("meta:parameter_review", {
      recommendations: recommendations.length,
      applied: appliedChanges.length,
      pipelineThroughput: metrics.pipelineThroughput,
      backtestPassRate: metrics.backtestQuality.passRate,
      criticFailRate: metrics.criticEffectiveness.failRate,
      timestamp: result.timestamp,
    });

    if (recommendations.length > 0) {
      logger.warn(
        { recommendations: recommendations.length, applied: appliedChanges.length },
        "Meta optimizer: parameter review generated recommendations",
      );
    } else {
      logger.info("Meta optimizer: parameter review — no changes needed");
    }

    return result;
  } catch (err) {
    logger.error({ err }, "Meta optimizer: parameter review failed");
    throw err;
  }
}
