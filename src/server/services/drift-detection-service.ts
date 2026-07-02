import { randomUUID } from "crypto";
import { db } from "../db/index.js";
import { backtests, paperTrades, complianceReviews, paperSessions, strategies } from "../db/schema.js";
import { eq, desc, and, isNull, inArray } from "drizzle-orm";
import { broadcastSSE } from "../routes/sse.js";
// Deep-scan #5 H4a (2026-06-29): logger from the leaf module, NOT ../index.js.
// Importing from ../index.js drags the whole Express bootstrap graph into any
// module that loads drift-detection-service, breaking test isolation on partial mocks.
import { logger } from "../lib/logger.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";

export interface DriftReport {
  strategyId: string;
  metric: string;
  backtestValue: number;
  liveValue: number;
  deviationStdDevs: number;
  severity: "ok" | "investigate" | "alert";
  message: string;
}

// Calculate standard deviation
function stdDev(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}

// Compare live paper trading metrics against backtest expectations
export async function detectDrift(strategyId: string, sessionId: string): Promise<DriftReport[]> {
  const correlationId = randomUUID();

  // Get latest completed backtest for this strategy
  const [backtest] = await db.select().from(backtests)
    .where(and(eq(backtests.strategyId, strategyId), eq(backtests.status, "completed")))
    .orderBy(desc(backtests.createdAt))
    .limit(1);

  if (!backtest) return [];

  // Get paper trades for this session (ordered by exit time — critical for drawdown calc)
  const trades = await db.select().from(paperTrades)
    .where(eq(paperTrades.sessionId, sessionId))
    .orderBy(paperTrades.exitTime);

  if (trades.length < 5) return []; // Need enough data to compare

  const reports: DriftReport[] = [];

  // OBSERVABILITY-ONLY: win rate is logged for visibility but MUST NOT drive a gate
  // or auto-demotion. Project mandate (CLAUDE.md \u00A71 + win-rate-is-output rule):
  // "Win rate is an OBSERVED output metric \u2014 never a target, never a gate."
  // Severity is capped at "investigate" \u2014 it will NEVER be "alert", so it is
  // excluded from the alerts[] filter below that triggers PAPER \u2192 DECLINING demotion.
  const liveWins = trades.filter(t => Number(t.pnl) > 0).length;
  const liveWinRate = liveWins / trades.length;
  const backtestWinRate = Number(backtest.winRate ?? 0);

  if (backtestWinRate > 0) {
    const winRateDiff = Math.abs(liveWinRate - backtestWinRate);
    const expectedStdDev = Math.sqrt(backtestWinRate * (1 - backtestWinRate) / trades.length);
    const deviationStdDevs = expectedStdDev > 0 ? winRateDiff / expectedStdDev : 0;

    reports.push({
      strategyId,
      metric: "winRate",
      backtestValue: backtestWinRate,
      liveValue: liveWinRate,
      deviationStdDevs: Math.round(deviationStdDevs * 100) / 100,
      // Severity capped at "investigate" \u2014 NEVER "alert". Win rate deviation alone
      // must NOT trigger the auto-demotion path below. R-expectancy / avg-trade-PnL /
      // drawdown metrics (which follow) are the authoritative demotion signals.
      severity: deviationStdDevs > 1 ? "investigate" : "ok",
      message: deviationStdDevs > 2
        ? `Win rate drifted ${deviationStdDevs.toFixed(1)}\u03C3 from backtest (${(backtestWinRate * 100).toFixed(0)}% \u2192 ${(liveWinRate * 100).toFixed(0)}%) [observability only \u2014 not a gate]`
        : `Win rate within expected range`,
    });
  }

  // Compare avg trade P&L
  const livePnls = trades.map(t => Number(t.pnl));
  const liveAvgPnl = livePnls.reduce((a, b) => a + b, 0) / livePnls.length;
  const backtestAvgPnl = Number(backtest.avgTradePnl ?? 0);
  const pnlStdDev = stdDev(livePnls);

  if (pnlStdDev > 0 && backtestAvgPnl !== 0) {
    const pnlDeviation = Math.abs(liveAvgPnl - backtestAvgPnl) / pnlStdDev;

    reports.push({
      strategyId,
      metric: "avgTradePnl",
      backtestValue: backtestAvgPnl,
      liveValue: Math.round(liveAvgPnl * 100) / 100,
      deviationStdDevs: Math.round(pnlDeviation * 100) / 100,
      severity: pnlDeviation > 2 ? "alert" : pnlDeviation > 1 ? "investigate" : "ok",
      message: pnlDeviation > 2
        ? `Avg trade P&L drifted ${pnlDeviation.toFixed(1)}\u03C3 ($${backtestAvgPnl.toFixed(0)} \u2192 $${liveAvgPnl.toFixed(0)})`
        : `Avg trade P&L within expected range`,
    });
  }

  // Compare max drawdown
  let maxDrawdown = 0;
  let peak = 0;
  let cumPnl = 0;
  for (const pnl of livePnls) {
    cumPnl += pnl;
    if (cumPnl > peak) peak = cumPnl;
    const drawdown = peak - cumPnl;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  const backtestMaxDD = Math.abs(Number(backtest.maxDrawdown ?? 0));
  if (backtestMaxDD > 0) {
    const ddRatio = maxDrawdown / backtestMaxDD;
    reports.push({
      strategyId,
      metric: "maxDrawdown",
      backtestValue: backtestMaxDD,
      liveValue: Math.round(maxDrawdown * 100) / 100,
      deviationStdDevs: Math.round(ddRatio * 100) / 100,
      severity: ddRatio > 1.5 ? "alert" : ddRatio > 1.0 ? "investigate" : "ok",
      message: ddRatio > 1.5
        ? `Live drawdown exceeds backtest by ${((ddRatio - 1) * 100).toFixed(0)}%`
        : `Drawdown within expected range`,
    });
  }

  // Broadcast alerts for any high-severity drift.
  // NOTE: winRate is capped at "investigate" above — it cannot reach "alert" here,
  // so win-rate-only deviations are excluded from the auto-demotion path per mandate.
  // Only R-expectancy / avg-trade-PnL / drawdown alerts trigger demotion.
  const alerts = reports.filter(r => r.severity === "alert");
  if (alerts.length > 0) {
    broadcastSSE("drift:alert", { strategyId, sessionId, alerts, correlationId });
    logger.warn({ strategyId, alerts, correlationId }, "Drift detected in paper trading");

    // Deep-scan #5 H4c (2026-06-29): persist drift evidence durably. SSE + logs are
    // ephemeral (offline client / log rotation) — the demotion action is audited by
    // promoteStrategy() but the TRIGGERING evidence (which metrics, by how much) was not.
    await insertAuditRowSafe({
      action: "drift.alert_triggered",
      entityType: "strategy",
      entityId: strategyId,
      status: "warning",
      input: { sessionId },
      result: { alerts },
      correlationId,
    });

    // Auto-demote from PAPER to DECLINING if any GATED metric (NOT winRate) exceeds 2σ.
    // maxDrift is derived from alerts[] which can only contain avgTradePnl and maxDrawdown
    // after the winRate severity cap above.
    const maxDrift = Math.max(...alerts.map(a => a.deviationStdDevs));
    if (maxDrift > 2.0) {
      try {
        const { LifecycleService } = await import("./lifecycle-service.js");
        const lifecycle = new LifecycleService();
        await lifecycle.promoteStrategy(strategyId, "PAPER", "DECLINING");
        broadcastSSE("strategy:drift-demotion", { strategyId, driftSeverity: maxDrift, correlationId, trigger: alerts.map(a => a.metric) });
        logger.warn({ strategyId, driftSeverity: maxDrift, correlationId, trigger: alerts.map(a => a.metric) }, "Strategy auto-demoted due to drift > 2σ in expectancy/drawdown metrics");
      } catch (demoteErr) {
        logger.error({ strategyId, err: demoteErr, correlationId }, "Auto-demotion from drift failed");
      }
    }
  }

  return reports;
}

/**
 * Enhanced drift detection using PELT structural break detection.
 * Calls Python changepoint module for edge-death analysis.
 */
export async function detectStructuralBreaks(
  dailyPnls: number[],
  rollingSharpe: number[],
): Promise<{ edgeDeathDetected: boolean; deathDay: number | null; pnlBreaks: number[]; sharpeBreaks: number[] }> {
  try {
    const { runPythonModule } = await import("../lib/python-runner.js");
    const result = await runPythonModule<{
      edge_death_detected: boolean;
      death_day: number | null;
      pnl_breaks: { breakpoints: number[] };
      sharpe_breaks: { breakpoints: number[] };
    }>({
      module: "src.engine.changepoint",
      config: { daily_pnls: dailyPnls, rolling_sharpe: rollingSharpe, mode: "edge_death" },
      timeoutMs: 15_000,
      componentName: "changepoint-detection",
    });

    return {
      edgeDeathDetected: result.edge_death_detected ?? false,
      deathDay: result.death_day ?? null,
      pnlBreaks: result.pnl_breaks?.breakpoints ?? [],
      sharpeBreaks: result.sharpe_breaks?.breakpoints ?? [],
    };
  } catch (err) {
    // Deep-scan #5 H4b (2026-06-29): was a SILENT empty catch — a real Python crash
    // (OOM / timeout / import error) was indistinguishable from "module not available",
    // and callers received edgeDeathDetected:false as if the check passed (silent
    // false-negative on an edge-death signal). Log it so the failure is visible.
    logger.warn({ err }, "detectStructuralBreaks: changepoint call failed — returning no-break default (edge-death check did NOT run)");
    return { edgeDeathDetected: false, deathDay: null, pnlBreaks: [], sharpeBreaks: [] };
  }
}

// ─── Compliance Cascade Revalidation ────────────────────────────────

/**
 * Cascade revalidation for a firm: invalidates all active compliance reviews,
 * pauses DEPLOYED strategies tied to that firm, and emits a critical alert.
 *
 * Called when drift detection finds that a firm's rules have changed.
 * This ensures no strategy runs under stale compliance assumptions.
 */
export async function cascadeRevalidation(firm: string): Promise<{
  invalidatedReviews: number;
  pausedStrategies: string[];
}> {
  logger.warn({ firm }, "Compliance cascade: invalidating all reviews and pausing strategies");

  // 1. Invalidate all non-invalidated reviews for this firm
  const invalidated = await db
    .update(complianceReviews)
    .set({
      invalidatedAt: new Date(),
      invalidationReason: `Automatic cascade: drift detected for ${firm} rules`,
    })
    .where(
      and(
        eq(complianceReviews.firm, firm),
        isNull(complianceReviews.invalidatedAt),
      ),
    )
    .returning({ id: complianceReviews.id, strategyId: complianceReviews.strategyId });

  const affectedStrategyIds = [
    ...new Set(invalidated.map((r) => r.strategyId).filter((id): id is string => id !== null)),
  ];

  // 2. Pause DEPLOYED strategies that have compliance reviews at this firm
  const pausedStrategies: string[] = [];

  if (affectedStrategyIds.length > 0) {
    // Find which of these strategies are currently DEPLOYED
    const deployedStrats = await db
      .select({ id: strategies.id })
      .from(strategies)
      .where(
        and(
          inArray(strategies.id, affectedStrategyIds),
          eq(strategies.lifecycleState, "DEPLOYED"),
        ),
      );

    // Deep-scan #5 L3 (2026-06-29): hoist the dynamic import out of the loop —
    // the module is stable; importing per-iteration is wasted work.
    const { LifecycleService } = await import("./lifecycle-service.js");
    const lifecycle = new LifecycleService();
    for (const strat of deployedStrats) {
      try {
        await lifecycle.promoteStrategy(strat.id, "DEPLOYED", "DECLINING");
        pausedStrategies.push(strat.id);
        logger.warn({ strategyId: strat.id, firm }, "Strategy demoted to DECLINING due to compliance cascade");
      } catch (err) {
        logger.error({ strategyId: strat.id, err }, "Failed to demote strategy during compliance cascade");
      }
    }

    // Also pause active paper sessions for affected strategies
    for (const stratId of affectedStrategyIds) {
      try {
        await db
          .update(paperSessions)
          .set({ status: "paused", pausedAt: new Date() })
          .where(
            and(
              eq(paperSessions.strategyId, stratId),
              eq(paperSessions.status, "active"),
            ),
          );
      } catch (err) {
        // Deep-scan #5 H4d (2026-06-29): was a SILENT catch. If the pause fails, a
        // strategy whose compliance reviews were just invalidated keeps executing under
        // stale compliance assumptions with zero visibility. Log it loudly (non-blocking
        // so the cascade still pauses the other sessions).
        logger.error({ strategyId: stratId, firm, err }, "cascadeRevalidation: failed to pause paper session — strategy may continue under invalidated compliance");
      }
    }
  }

  // 3. Emit critical alert via SSE
  broadcastSSE("compliance:cascade_revalidation", {
    firm,
    invalidatedReviews: invalidated.length,
    pausedStrategies,
    affectedStrategyIds,
    severity: "critical",
    message: `Compliance cascade: ${firm} rules changed — ${invalidated.length} reviews invalidated, ${pausedStrategies.length} strategies paused`,
    timestamp: new Date().toISOString(),
  });

  // 4. Emit via agent coordinator if available
  try {
    const { agentCoordinator } = await import("./agent-coordinator-service.js");
    await agentCoordinator.emit("compliance:invalidated", {
      firm,
      affectedStrategies: affectedStrategyIds,
      reason: `Drift detected — ${invalidated.length} reviews invalidated`,
    });
  } catch {
    // Agent coordinator may not be initialized yet
  }

  logger.warn(
    { firm, invalidatedReviews: invalidated.length, pausedStrategies: pausedStrategies.length },
    "Compliance cascade complete",
  );

  return { invalidatedReviews: invalidated.length, pausedStrategies };
}

// Rolling 30-day Sharpe calculation for alpha decay monitoring
export function calculateRollingSharpe(dailyPnls: number[]): number {
  if (dailyPnls.length < 5) return 0;
  const recent = dailyPnls.slice(-30);
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const sd = stdDev(recent);
  if (sd === 0) return 0;
  return (mean / sd) * Math.sqrt(252);
}
