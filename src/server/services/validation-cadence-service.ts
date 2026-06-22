/**
 * C7 — Validation Cadence Forcing Function (W16 Team C)
 *
 * **Why this exists:**
 * Most common failure mode for sophisticated solo operators: build elaborate
 * infrastructure for 3-6 months, never validate live, then watch a regime
 * change wipe it all out. Reddit/Medium documents traders who built 100+
 * elaborate backtested systems that hit Sharpe 0.0 on regime change.
 *
 * This service is the FORCING FUNCTION that prevents that:
 *   - Tracks "Days Since Last Live Backtest" (RED at >7 days)
 *   - Tracks "Strategies Tested End-to-End This Month" (RED if < threshold)
 *   - Computes "Reality Check Score" (composite 0-100)
 *   - Runs monthly Reality Check report (backtested vs paper performance)
 *
 * **Authority:** OBSERVATION + ALERT layer ONLY.
 *   - Does NOT block lifecycle promotions.
 *   - Does NOT modify strategies/backtests/sessions.
 *   - Reads `backtests`, `lifecycle_transitions`, `paper_sessions`, `paper_trades`.
 *   - Writes `audit_log` (monthly report) and `alerts` (RED alerts).
 *
 * **Map convergence:** The forcing function closes the gap between "system
 * appears healthy" and "system is actually being used to validate strategies."
 * It is the operator-facing accountability layer.
 *
 * **Reuse:** existing `audit_log`, `alerts`, `lifecycle_transitions`,
 * `backtests`, `paper_sessions`, `paper_trades`. No new tables.
 */

import { and, gte, eq, desc, inArray, isNotNull } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  backtests,
  lifecycleTransitions,
  paperSessions,
  paperTrades,
  strategies,
  auditLog,
} from "../db/schema.js";
import { createAlert } from "./alert-service.js";
import { logger } from "../lib/logger.js";

// ─── Configuration ────────────────────────────────────────────────────────────

/** Days-since-last-live-backtest threshold above which the panel turns RED. */
export const VALIDATION_CADENCE_RED_THRESHOLD_DAYS = Number(
  process.env.VALIDATION_CADENCE_RED_THRESHOLD_DAYS ?? "7",
);

/** Minimum strategies that must be tested end-to-end per month before
 *  AGENTS.md hard rule allows new infrastructure work to be approved. */
export const VALIDATION_CADENCE_MIN_STRATEGIES_PER_MONTH = Number(
  process.env.VALIDATION_CADENCE_MIN_STRATEGIES_PER_MONTH ?? "1",
);

/** Lifecycle states that count as "tested end-to-end" (PAPER and beyond). */
const END_TO_END_TARGET_STATES = ["PAPER", "DEPLOY_READY", "PILOT", "DEPLOYED"] as const;

/** Lifecycle states for "PAPER+" Reality Check coverage. */
const PAPER_PLUS_STATES = ["PAPER", "DEPLOY_READY", "PILOT", "DEPLOYED"] as const;

// ─── Public API: dashboard metrics ────────────────────────────────────────────

export interface DaysSinceLastLiveBacktestResult {
  /** Floor of (now - last_completed_backtest.createdAt) in calendar days. */
  days: number | null;
  /** ISO timestamp of the most recent completed backtest, or null if none. */
  lastBacktestAt: string | null;
  /** ID of that backtest (for traceability), or null if none. */
  lastBacktestId: string | null;
  /** True if days > VALIDATION_CADENCE_RED_THRESHOLD_DAYS (or null when no backtests exist). */
  isRed: boolean;
  /** The configured threshold (echoed back so the panel can show why it's RED). */
  thresholdDays: number;
}

/**
 * Days since the most recently COMPLETED backtest (status='completed').
 *
 * "Live backtest" here means a real, finished backtest — not a pending or
 * failed one. If no completed backtests exist, returns days=null and
 * isRed=true (system has never run a backtest = critical).
 */
export async function getDaysSinceLastLiveBacktest(): Promise<DaysSinceLastLiveBacktestResult> {
  const [latest] = await db
    .select({ id: backtests.id, createdAt: backtests.createdAt })
    .from(backtests)
    .where(eq(backtests.status, "completed"))
    .orderBy(desc(backtests.createdAt))
    .limit(1);

  if (!latest) {
    return {
      days: null,
      lastBacktestAt: null,
      lastBacktestId: null,
      isRed: true, // never validated = always RED
      thresholdDays: VALIDATION_CADENCE_RED_THRESHOLD_DAYS,
    };
  }

  const last = latest.createdAt instanceof Date ? latest.createdAt : new Date(latest.createdAt);
  const ms = Date.now() - last.getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));

  return {
    days,
    lastBacktestAt: last.toISOString(),
    lastBacktestId: latest.id,
    isRed: days > VALIDATION_CADENCE_RED_THRESHOLD_DAYS,
    thresholdDays: VALIDATION_CADENCE_RED_THRESHOLD_DAYS,
  };
}

export interface StrategiesTestedThisMonthResult {
  /** Count of distinct strategies that reached PAPER+ via lifecycle_transitions in current calendar month. */
  count: number;
  /** Distinct strategy IDs that crossed into PAPER+ this month. */
  strategyIds: string[];
  /** ISO timestamp of the start of the month (UTC). */
  monthStart: string;
  /** Configured minimum threshold. */
  minThreshold: number;
  /** True if count < minThreshold. */
  isBelowThreshold: boolean;
}

/**
 * Count of distinct strategies that traversed CANDIDATE/TESTING → PAPER+ this
 * calendar month (UTC month). This is the "end-to-end pipeline ran" signal.
 *
 * A strategy that bounces TESTING ↔ TESTING is NOT counted. Only first crossing
 * into PAPER/DEPLOY_READY/PILOT/DEPLOYED counts.
 */
export async function getStrategiesTestedEndToEndThisMonth(): Promise<StrategiesTestedThisMonthResult> {
  const monthStart = startOfMonthUtc(new Date());

  const rows = await db
    .selectDistinct({ strategyId: lifecycleTransitions.strategyId })
    .from(lifecycleTransitions)
    .where(
      and(
        gte(lifecycleTransitions.createdAt, monthStart),
        inArray(lifecycleTransitions.toState, [...END_TO_END_TARGET_STATES]),
      ),
    );

  const strategyIds = rows.map((r) => r.strategyId).filter((id): id is string => id !== null);

  return {
    count: strategyIds.length,
    strategyIds,
    monthStart: monthStart.toISOString(),
    minThreshold: VALIDATION_CADENCE_MIN_STRATEGIES_PER_MONTH,
    isBelowThreshold: strategyIds.length < VALIDATION_CADENCE_MIN_STRATEGIES_PER_MONTH,
  };
}

export interface RealityCheckScoreResult {
  /** Composite 0-100 score. 100 = perfect cadence; 0 = system never validated. */
  score: number;
  /** Sub-component scores for traceability. */
  breakdown: {
    /** 0-40 points based on days since last backtest. */
    cadenceScore: number;
    /** 0-40 points based on strategies tested this month. */
    throughputScore: number;
    /** 0-20 points based on average paper-vs-backtest deviation (lower deviation = more points). */
    fidelityScore: number;
  };
  /** Same threshold as for the dashboard panel, echoed for traceability. */
  thresholdDays: number;
  /** Same threshold for the throughput component. */
  minStrategiesThreshold: number;
}

/**
 * Composite Reality Check Score:
 *
 *   cadenceScore   = max(0, 40 - 5 * max(0, days_idle - 1))
 *                    (40 if backtested today, 0 once idle 9+ days)
 *   throughputScore = min(40, 10 * strategies_tested_this_month)
 *                    (40 once 4+ strategies through this month)
 *   fidelityScore  = max(0, 20 - 4 * avg_recent_deviation_sigma)
 *                    (20 if paper matches backtest perfectly, 0 at 5 sigma deviation)
 *
 * Lower numbers in the breakdown directly map to operator action items.
 */
export async function getRealityCheckScore(): Promise<RealityCheckScoreResult> {
  const cadence = await getDaysSinceLastLiveBacktest();
  const throughput = await getStrategiesTestedEndToEndThisMonth();
  const fidelity = await getRecentPaperVsBacktestFidelity();

  const cadenceDays = cadence.days ?? 999; // never validated → max penalty
  const cadenceScore = Math.max(0, 40 - 5 * Math.max(0, cadenceDays - 1));
  const throughputScore = Math.min(40, 10 * throughput.count);
  const fidelityScore = Math.max(0, 20 - 4 * fidelity.avgDeviationSigmas);

  const score = Math.round(cadenceScore + throughputScore + fidelityScore);

  return {
    score,
    breakdown: {
      cadenceScore: Math.round(cadenceScore),
      throughputScore: Math.round(throughputScore),
      fidelityScore: Math.round(fidelityScore),
    },
    thresholdDays: VALIDATION_CADENCE_RED_THRESHOLD_DAYS,
    minStrategiesThreshold: VALIDATION_CADENCE_MIN_STRATEGIES_PER_MONTH,
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** First day of the current month at 00:00:00 UTC. */
function startOfMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

interface PaperVsBacktestFidelity {
  /** Average sigma deviation across recent paper-vs-backtest comparisons. */
  avgDeviationSigmas: number;
  /** Number of recently-stopped sessions used for the average (last 30 days). */
  sessionsCompared: number;
}

/**
 * Average paper-vs-backtest deviation across all paper sessions stopped in the
 * last 30 days. Mirrors the heuristic in scheduler.ts:comparePaperToBacktest()
 * but does not trigger SSE alerts (read-only summary).
 *
 * Returns avgDeviationSigmas = 0 if there are no recent comparisons.
 */
async function getRecentPaperVsBacktestFidelity(): Promise<PaperVsBacktestFidelity> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const stoppedSessions = await db
    .select()
    .from(paperSessions)
    .where(
      and(
        eq(paperSessions.status, "stopped"),
        gte(paperSessions.stoppedAt, thirtyDaysAgo),
        isNotNull(paperSessions.strategyId),
      ),
    );

  if (stoppedSessions.length === 0) {
    return { avgDeviationSigmas: 0, sessionsCompared: 0 };
  }

  const deviations: number[] = [];

  for (const session of stoppedSessions) {
    if (!session.strategyId) continue;

    const trades = await db
      .select({ pnl: paperTrades.pnl })
      .from(paperTrades)
      .where(eq(paperTrades.sessionId, session.id));

    if (trades.length === 0) continue;

    // Paper Sharpe (simplified — same formula as scheduler.ts)
    const pnls = trades.map((t) => Number(t.pnl));
    const avgPnl = pnls.reduce((a, b) => a + b, 0) / pnls.length;
    const stdDev =
      pnls.length > 1
        ? Math.sqrt(pnls.reduce((sum, p) => sum + (p - avgPnl) ** 2, 0) / (pnls.length - 1))
        : 0;
    const paperSharpe = stdDev > 0 ? (avgPnl / stdDev) * Math.sqrt(252) : 0;

    // Latest completed backtest for the strategy
    const [bt] = await db
      .select({ sharpeRatio: backtests.sharpeRatio })
      .from(backtests)
      .where(
        and(
          eq(backtests.strategyId, session.strategyId),
          eq(backtests.status, "completed"),
        ),
      )
      .orderBy(desc(backtests.createdAt))
      .limit(1);

    if (!bt || bt.sharpeRatio == null) continue;

    const btSharpe = Number(bt.sharpeRatio);
    if (btSharpe === 0) continue;

    const sharpeDeviation =
      Math.abs(paperSharpe - btSharpe) / Math.max(Math.abs(btSharpe) * 0.5, 0.1);
    deviations.push(sharpeDeviation);
  }

  if (deviations.length === 0) {
    return { avgDeviationSigmas: 0, sessionsCompared: 0 };
  }

  const avg = deviations.reduce((a, b) => a + b, 0) / deviations.length;
  return { avgDeviationSigmas: avg, sessionsCompared: deviations.length };
}

// ─── Monthly Reality Check report ─────────────────────────────────────────────

export interface RealityCheckReport {
  /** ISO timestamp of when the report was generated. */
  generatedAt: string;
  /** Cadence/throughput/fidelity score breakdown. */
  realityCheck: RealityCheckScoreResult;
  /** Days since last live backtest. */
  daysSinceLastLiveBacktest: DaysSinceLastLiveBacktestResult;
  /** Strategies tested end-to-end this month. */
  strategiesThisMonth: StrategiesTestedThisMonthResult;
  /** Per-strategy comparison: backtested vs realized paper performance. */
  comparisons: StrategyComparison[];
  /** Severity assessment used to gate alert emission. */
  severity: "info" | "warning" | "critical";
}

export interface StrategyComparison {
  strategyId: string;
  strategyName: string | null;
  lifecycleState: string;
  /** Most recent completed backtest sharpe; null if none. */
  backtestSharpe: number | null;
  /** Realized paper Sharpe across all paper trades for the strategy; null if no trades. */
  paperSharpe: number | null;
  /** Avg daily PnL from backtest; null if backtest field missing. */
  backtestAvgDailyPnl: number | null;
  /** Avg daily PnL realized in paper; null if no trades. */
  paperAvgDailyPnl: number | null;
  /** Number of paper trades observed for the strategy. */
  paperTradeCount: number;
  /** Sigma deviation between paperSharpe and backtestSharpe. */
  sharpeDeviationSigmas: number | null;
}

/**
 * Generate the monthly Reality Check report:
 *   - Compares backtested vs paper performance for all PAPER+ strategies
 *   - Persists a summary `audit_log` row for replayability
 *   - Fires a `createAlert(severity=warning)` when critical thresholds are breached
 *
 * Returns the report shape regardless of severity so callers can render it.
 */
export async function runMonthlyRealityCheckReport(): Promise<RealityCheckReport> {
  const generatedAt = new Date().toISOString();

  logger.info("validation-cadence: generating monthly Reality Check report");

  const [realityCheck, daysSinceLastLiveBacktest, strategiesThisMonth] = await Promise.all([
    getRealityCheckScore(),
    getDaysSinceLastLiveBacktest(),
    getStrategiesTestedEndToEndThisMonth(),
  ]);

  const paperPlusStrategies = await db
    .select({
      id: strategies.id,
      name: strategies.name,
      lifecycleState: strategies.lifecycleState,
    })
    .from(strategies)
    .where(inArray(strategies.lifecycleState, [...PAPER_PLUS_STATES]));

  const comparisons: StrategyComparison[] = [];

  for (const strat of paperPlusStrategies) {
    // Latest completed backtest for the strategy
    const [bt] = await db
      .select({
        sharpeRatio: backtests.sharpeRatio,
        avgDailyPnl: backtests.avgDailyPnl,
      })
      .from(backtests)
      .where(
        and(
          eq(backtests.strategyId, strat.id),
          eq(backtests.status, "completed"),
        ),
      )
      .orderBy(desc(backtests.createdAt))
      .limit(1);

    // Aggregate paper trades for the strategy across all sessions
    const sessions = await db
      .select({ id: paperSessions.id })
      .from(paperSessions)
      .where(eq(paperSessions.strategyId, strat.id));

    const sessionIds = sessions.map((s) => s.id);
    let paperSharpe: number | null = null;
    let paperAvgDailyPnl: number | null = null;
    let paperTradeCount = 0;

    if (sessionIds.length > 0) {
      const trades = await db
        .select({
          pnl: paperTrades.pnl,
          exitTime: paperTrades.exitTime,
          entryTime: paperTrades.entryTime,
        })
        .from(paperTrades)
        .where(inArray(paperTrades.sessionId, sessionIds));

      paperTradeCount = trades.length;

      if (trades.length > 0) {
        const pnls = trades.map((t) => Number(t.pnl));
        const avgPnl = pnls.reduce((a, b) => a + b, 0) / pnls.length;
        const stdDev =
          pnls.length > 1
            ? Math.sqrt(pnls.reduce((s, p) => s + (p - avgPnl) ** 2, 0) / (pnls.length - 1))
            : 0;
        paperSharpe = stdDev > 0 ? (avgPnl / stdDev) * Math.sqrt(252) : 0;

        const dailyMap = new Map<string, number>();
        for (const t of trades) {
          const raw = t.exitTime ?? t.entryTime;
          if (!raw) continue;
          const day = (raw instanceof Date ? raw : new Date(raw)).toISOString().slice(0, 10);
          dailyMap.set(day, (dailyMap.get(day) ?? 0) + Number(t.pnl ?? 0));
        }
        const dailies = [...dailyMap.values()];
        paperAvgDailyPnl =
          dailies.length > 0 ? dailies.reduce((a, b) => a + b, 0) / dailies.length : null;
      }
    }

    const backtestSharpe = bt?.sharpeRatio != null ? Number(bt.sharpeRatio) : null;
    const backtestAvgDailyPnl = bt?.avgDailyPnl != null ? Number(bt.avgDailyPnl) : null;

    let sharpeDeviationSigmas: number | null = null;
    if (backtestSharpe != null && backtestSharpe !== 0 && paperSharpe != null) {
      sharpeDeviationSigmas =
        Math.abs(paperSharpe - backtestSharpe) / Math.max(Math.abs(backtestSharpe) * 0.5, 0.1);
    }

    comparisons.push({
      strategyId: strat.id,
      strategyName: strat.name ?? null,
      lifecycleState: strat.lifecycleState,
      backtestSharpe,
      paperSharpe,
      backtestAvgDailyPnl,
      paperAvgDailyPnl,
      paperTradeCount,
      sharpeDeviationSigmas,
    });
  }

  // Severity: critical if RED on cadence; warning if below throughput; info otherwise
  let severity: "info" | "warning" | "critical" = "info";
  if (daysSinceLastLiveBacktest.isRed) {
    severity = "critical";
  } else if (strategiesThisMonth.isBelowThreshold) {
    severity = "warning";
  }

  const report: RealityCheckReport = {
    generatedAt,
    realityCheck,
    daysSinceLastLiveBacktest,
    strategiesThisMonth,
    comparisons,
    severity,
  };

  // Persist audit_log row for replayability
  try {
    await db.insert(auditLog).values({
      action: "validation_cadence.reality_check",
      entityType: "system",
      entityId: null,
      input: {
        thresholdDays: VALIDATION_CADENCE_RED_THRESHOLD_DAYS,
        minStrategies: VALIDATION_CADENCE_MIN_STRATEGIES_PER_MONTH,
      },
      result: {
        score: realityCheck.score,
        breakdown: realityCheck.breakdown,
        daysSinceLastLiveBacktest: daysSinceLastLiveBacktest.days,
        isRed: daysSinceLastLiveBacktest.isRed,
        strategiesThisMonth: strategiesThisMonth.count,
        isBelowThreshold: strategiesThisMonth.isBelowThreshold,
        comparisonsCount: comparisons.length,
        comparisons: comparisons.slice(0, 50), // cap to keep JSONB row small
      },
      status: "success",
      decisionAuthority: "scheduler",
    });
  } catch (err) {
    logger.error({ err }, "validation-cadence: failed to persist audit_log row (non-blocking)");
  }

  // Fire alert for critical/warning severity
  if (severity !== "info") {
    try {
      await createAlert({
        type: "system",
        severity,
        title:
          severity === "critical"
            ? `Reality Check FAILED: ${daysSinceLastLiveBacktest.days ?? "no"} days since last backtest`
            : `Reality Check: only ${strategiesThisMonth.count} strategies tested end-to-end this month`,
        message:
          severity === "critical"
            ? `Validation cadence threshold breached. Days since last live backtest: ${
                daysSinceLastLiveBacktest.days ?? "never"
              } (threshold: ${VALIDATION_CADENCE_RED_THRESHOLD_DAYS}). ` +
              `Reality Check Score: ${realityCheck.score}/100. ` +
              `Stop building infrastructure and run a strategy through the full pipeline.`
            : `Only ${strategiesThisMonth.count} strategies tested end-to-end this month ` +
              `(minimum: ${VALIDATION_CADENCE_MIN_STRATEGIES_PER_MONTH}). ` +
              `Reality Check Score: ${realityCheck.score}/100. ` +
              `Per AGENTS.md, no new infrastructure work is approved until this clears.`,
        metadata: {
          score: realityCheck.score,
          breakdown: realityCheck.breakdown,
          daysSinceLastLiveBacktest: daysSinceLastLiveBacktest.days,
          strategiesThisMonth: strategiesThisMonth.count,
          generatedAt,
        },
      });
    } catch (err) {
      logger.error({ err }, "validation-cadence: failed to create alert (non-blocking)");
    }
  }

  logger.info(
    {
      score: realityCheck.score,
      severity,
      daysIdle: daysSinceLastLiveBacktest.days,
      strategiesThisMonth: strategiesThisMonth.count,
      comparisonsCount: comparisons.length,
    },
    "validation-cadence: monthly Reality Check report complete",
  );

  return report;
}

// ─── Convenience: full dashboard payload ─────────────────────────────────────

export interface ValidationCadenceDashboard {
  generatedAt: string;
  daysSinceLastLiveBacktest: DaysSinceLastLiveBacktestResult;
  strategiesThisMonth: StrategiesTestedThisMonthResult;
  realityCheck: RealityCheckScoreResult;
}

/**
 * Single dashboard payload for the panel and the GET route. Pulls all three
 * metrics in one call so the panel renders without race conditions.
 */
export async function getValidationCadenceDashboard(): Promise<ValidationCadenceDashboard> {
  const [daysSinceLastLiveBacktest, strategiesThisMonth, realityCheck] = await Promise.all([
    getDaysSinceLastLiveBacktest(),
    getStrategiesTestedEndToEndThisMonth(),
    getRealityCheckScore(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    daysSinceLastLiveBacktest,
    strategiesThisMonth,
    realityCheck,
  };
}
