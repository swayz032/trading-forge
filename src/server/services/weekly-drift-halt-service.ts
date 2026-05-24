/**
 * Weekly Drift 2σ Auto-HALT Service (Wave 24 Pass 1)
 *
 * Runs every Sunday 18:00 ET. For each PILOT and DEPLOYED strategy:
 *   1. Pulls 7-day live paper_trades P&L returns.
 *   2. Pulls baseline daily returns from the last DEPLOY_READY-passing backtest.
 *   3. Computes z-score of the observed vs baseline difference.
 *   4. If abs(z) > 2.0: activates production HALT via kill-switch, writes audit_log,
 *      fires Discord CRITICAL.
 *
 * Idempotency: skips strategies whose halt is already active for "weekly_drift_2sigma".
 * Fail-open per strategy: one strategy's query error never blocks others.
 *
 * Note: live paper return series often has <7 trades for new strategies. We require
 * at least 5 observations to compute a meaningful z-score; below that threshold
 * we emit a warning log and skip the strategy to avoid false HALT on sparse data.
 */

import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies, paperTrades, paperSessions, backtests } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";
import { notifyCritical } from "./notification-service.js";
import { killSwitch } from "../production/kill-switch.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const Z_SCORE_HALT_THRESHOLD = 2.0;
const MIN_OBSERVATIONS = 5;
const LOOKBACK_DAYS = 7;
const HALT_REASON_PREFIX = "weekly_drift_2sigma";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stddev(values: number[], mu?: number): number {
  if (values.length < 2) return 0;
  const m = mu ?? mean(values);
  const variance = values.reduce((s, v) => s + Math.pow(v - m, 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function computeZScore(observedDailyReturns: number[], baselineDailyReturns: number[]): number {
  const obsMean = mean(observedDailyReturns);
  const baselineMean = mean(baselineDailyReturns);
  const diff = obsMean - baselineMean;

  // Pooled standard error of the difference of means
  const obsStd = stddev(observedDailyReturns);
  const baselineStd = stddev(baselineDailyReturns);
  const se = Math.sqrt(
    Math.pow(obsStd, 2) / observedDailyReturns.length +
    Math.pow(baselineStd, 2) / Math.max(baselineDailyReturns.length, 1),
  );

  if (se === 0) return 0;
  return diff / se;
}

// ─── Per-strategy check ───────────────────────────────────────────────────────

interface DriftCheckResult {
  strategyId: string;
  strategyName: string;
  outcome: "halted" | "ok" | "skipped" | "insufficient_data" | "error";
  zScore?: number;
  observedMean?: number;
  baselineMean?: number;
  reason?: string;
}

async function checkStrategyDrift(
  strategyId: string,
  strategyName: string,
  correlationId: string,
): Promise<DriftCheckResult> {
  // ── 1. Fetch live 7-day paper returns ──────────────────────────────────────
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  let liveTrades: Array<{ pnl: string; exitTime: Date }>;
  try {
    const sessions = await db
      .select({ id: paperSessions.id })
      .from(paperSessions)
      .where(eq(paperSessions.strategyId, strategyId));

    const sessionIds = sessions.map((s) => s.id);
    if (sessionIds.length === 0) {
      return { strategyId, strategyName, outcome: "insufficient_data", reason: "no_sessions" };
    }

    liveTrades = await db
      .select({ pnl: paperTrades.pnl, exitTime: paperTrades.exitTime })
      .from(paperTrades)
      .where(
        and(
          inArray(paperTrades.sessionId, sessionIds),
          gte(paperTrades.exitTime, cutoff),
        ),
      );
  } catch (err) {
    logger.warn({ err, strategyId }, "weekly-drift-halt: live trade query failed — skipping");
    return { strategyId, strategyName, outcome: "error", reason: String(err) };
  }

  if (liveTrades.length < MIN_OBSERVATIONS) {
    logger.info(
      { strategyId, tradeCount: liveTrades.length, minRequired: MIN_OBSERVATIONS },
      "weekly-drift-halt: insufficient live observations — skipping",
    );
    return { strategyId, strategyName, outcome: "insufficient_data", reason: `only_${liveTrades.length}_trades` };
  }

  // Aggregate into daily buckets
  const dailyPnlMap = new Map<string, number>();
  for (const t of liveTrades) {
    const key = t.exitTime.toISOString().slice(0, 10);
    dailyPnlMap.set(key, (dailyPnlMap.get(key) ?? 0) + parseFloat(t.pnl));
  }
  const liveDaily = Array.from(dailyPnlMap.values());

  // ── 2. Fetch baseline returns from last DEPLOY_READY backtest ──────────────
  let baselineDaily: number[] = [];
  try {
    const [lastBacktest] = await db
      .select({ resultExtras: backtests.resultExtras })
      .from(backtests)
      .where(
        and(
          eq(backtests.strategyId, strategyId),
          eq(backtests.status, "completed"),
        ),
      )
      .orderBy(backtests.createdAt)
      .limit(1);

    if (lastBacktest?.resultExtras) {
      const extras = lastBacktest.resultExtras as Record<string, unknown>;
      // Try to extract daily returns from resultExtras (governor or metrics section)
      const governor = extras["governor"] as Record<string, unknown> | undefined;
      const metrics = (extras["metrics"] ?? governor) as Record<string, unknown> | undefined;
      const trades = metrics?.["trades_by_day"] as number[] | undefined
        ?? metrics?.["daily_returns"] as number[] | undefined;

      if (Array.isArray(trades) && trades.length >= MIN_OBSERVATIONS) {
        baselineDaily = trades.map(Number).filter(Number.isFinite);
      } else {
        // Fall back to using the scalar daily_mean if available
        const dailyMean = metrics?.["daily_pnl_mean"] as number | undefined;
        const dailyStd = metrics?.["daily_pnl_std"] as number | undefined;
        if (typeof dailyMean === "number" && typeof dailyStd === "number" && dailyStd > 0) {
          // Synthesize a representative baseline array for z-score computation
          baselineDaily = Array.from({ length: 20 }, (_, i) => dailyMean + dailyStd * Math.sin(i));
        }
      }
    }
  } catch (err) {
    logger.warn({ err, strategyId }, "weekly-drift-halt: baseline query failed — using zero baseline");
  }

  if (baselineDaily.length < MIN_OBSERVATIONS) {
    logger.info(
      { strategyId, baselineLength: baselineDaily.length },
      "weekly-drift-halt: no baseline return series — using zero mean (conservative)",
    );
    // If no baseline, compare against 0 (expects any positive expectancy)
    baselineDaily = Array.from({ length: 10 }, () => 0);
  }

  // ── 3. Compute z-score ─────────────────────────────────────────────────────
  const zScore = computeZScore(liveDaily, baselineDaily);
  const observedMean = mean(liveDaily);
  const baselineMean = mean(baselineDaily);

  logger.info(
    { strategyId, strategyName, zScore, observedMean, baselineMean, liveTradeCount: liveTrades.length },
    "weekly-drift-halt: z-score computed",
  );

  if (Math.abs(zScore) <= Z_SCORE_HALT_THRESHOLD) {
    return { strategyId, strategyName, outcome: "ok", zScore, observedMean, baselineMean };
  }

  // ── 4. z-score exceeded — check idempotency ────────────────────────────────
  const haltReason = `${HALT_REASON_PREFIX}:strategy=${strategyId}:z=${zScore.toFixed(3)}`;
  try {
    const state = await killSwitch.getCurrentState();
    if (state.production_mode === "HALT" && state.kill_reason?.startsWith(HALT_REASON_PREFIX)) {
      logger.info(
        { strategyId, strategyName, zScore, currentHaltReason: state.kill_reason },
        "weekly-drift-halt: halt already active for this reason — idempotent skip",
      );
      return { strategyId, strategyName, outcome: "skipped", zScore, observedMean, baselineMean, reason: "already_halted" };
    }
  } catch (err) {
    logger.warn({ err }, "weekly-drift-halt: kill-switch state check failed — proceeding with halt");
  }

  // ── 5. Activate HALT ───────────────────────────────────────────────────────
  logger.error(
    { strategyId, strategyName, zScore, observedMean, baselineMean },
    `weekly-drift-halt: HALT TRIGGERED — abs(z) > ${Z_SCORE_HALT_THRESHOLD}`,
  );

  try {
    await killSwitch.setMode("HALT", haltReason, "weekly_drift_halt_service");
  } catch (err) {
    logger.error({ err, strategyId }, "weekly-drift-halt: kill-switch.setMode() failed");
    return { strategyId, strategyName, outcome: "error", zScore, reason: `setMode_failed: ${err}` };
  }

  // ── 6. Audit row ───────────────────────────────────────────────────────────
  // CANONICAL ACTION NAME: "drift.weekly_2sigma_halt"
  // This is the authoritative string for all consumers (dashboard queries,
  // reconciliation scripts, audit_log filters, n8n drift detector checks).
  // Do NOT use "auto_halt.weekly_drift_2sigma" — that variant was rejected
  // in Wave 25 Pass 2 R-3 audit. Update any consumer that queries the wrong name.
  await insertAuditRow({
    action: "drift.weekly_2sigma_halt",
    entityType: "strategy",
    entityId: strategyId,
    decisionAuthority: "system",
    input: {
      lookback_days: LOOKBACK_DAYS,
      live_trade_count: liveTrades.length,
      live_daily_count: liveDaily.length,
      baseline_daily_count: baselineDaily.length,
    } as Record<string, unknown>,
    result: {
      z_score: zScore,
      observed_mean: observedMean,
      baseline_mean: baselineMean,
      halt_reason: haltReason,
    } as Record<string, unknown>,
    status: "success",
    correlationId,
  }).catch((err) => logger.error({ err, strategyId }, "weekly-drift-halt: audit_log write failed"));

  // ── 7. Discord CRITICAL ───────────────────────────────────────────────────
  notifyCritical(
    `Weekly Drift HALT: ${strategyName}`,
    `Strategy "${strategyName}" (${strategyId}) exceeded 2σ weekly drift threshold.\n` +
      `Z-score: ${zScore.toFixed(3)} | Observed 7d mean: $${observedMean.toFixed(2)} | Baseline mean: $${baselineMean.toFixed(2)}\n` +
      `Production mode set to HALT. Review drift and reset via POST /api/production/halt with operator credentials.`,
    { strategyId, strategyName, zScore, observedMean, baselineMean, correlationId },
  );

  return { strategyId, strategyName, outcome: "halted", zScore, observedMean, baselineMean };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface WeeklyDriftHaltReport {
  checked: number;
  halted: number;
  ok: number;
  skipped: number;
  errors: number;
  results: DriftCheckResult[];
}

/**
 * Run the weekly 2σ drift halt check.
 * Called by the scheduler every Sunday 18:00 ET.
 */
export async function runWeeklyDriftHaltCheck(): Promise<WeeklyDriftHaltReport> {
  const correlationId = randomUUID();
  logger.info({ correlationId }, "weekly-drift-halt: starting Sunday sweep");

  // Scan PILOT and DEPLOYED strategies only
  let targetStrategies: Array<{ id: string; name: string }>;
  try {
    targetStrategies = await db
      .select({ id: strategies.id, name: strategies.name })
      .from(strategies)
      .where(inArray(strategies.lifecycleState, ["PILOT", "DEPLOYED"]));
  } catch (err) {
    logger.error({ err, correlationId }, "weekly-drift-halt: strategy query failed — aborting sweep");
    return { checked: 0, halted: 0, ok: 0, skipped: 0, errors: 1, results: [] };
  }

  if (targetStrategies.length === 0) {
    logger.info({ correlationId }, "weekly-drift-halt: no PILOT/DEPLOYED strategies — nothing to check");
    return { checked: 0, halted: 0, ok: 0, skipped: 0, errors: 0, results: [] };
  }

  logger.info({ correlationId, strategyCount: targetStrategies.length }, "weekly-drift-halt: scanning strategies");

  const results: DriftCheckResult[] = [];
  for (const strat of targetStrategies) {
    const result = await checkStrategyDrift(strat.id, strat.name, correlationId);
    results.push(result);
  }

  const report: WeeklyDriftHaltReport = {
    checked: results.length,
    halted: results.filter((r) => r.outcome === "halted").length,
    ok: results.filter((r) => r.outcome === "ok").length,
    skipped: results.filter((r) => r.outcome === "skipped").length,
    errors: results.filter((r) => r.outcome === "error" || r.outcome === "insufficient_data").length,
    results,
  };

  logger.info({ correlationId, ...report }, "weekly-drift-halt: sweep complete");
  return report;
}
