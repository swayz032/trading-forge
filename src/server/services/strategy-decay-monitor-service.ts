/**
 * strategy-decay-monitor-service.ts — inst-10of10 blueprint gap #2
 *
 * Within-regime rolling-Sharpe z-score edge decay monitor. Distinct from
 * regime-drift-detector (which catches REGIME CHANGES) — this catches edge
 * DECAY within a STABLE regime.
 *
 * Runs daily at 17:00 ET (21:00 UTC EDT / 22:00 UTC EST). DST-safe double-fire
 * at 21,22 UTC with ET-hour=17 guard prevents double execution.
 *
 * Per Man Group "continuous factor-decay monitoring": strategies whose OOS
 * Sharpe degrades significantly without a regime change signal need review.
 *
 * Algorithm per DEPLOYED strategy:
 *  1. Read last STABLE_REGIME_CHECK_DAYS of bias_state.regime_label for the
 *     strategy's symbol. If any day differs → SHIFTING → skip evaluation.
 *  2. Collect paper_trades for the last DECAY_LOOKBACK_CALENDAR_DAYS calendar days.
 *  3. Build daily P&L buckets; require >= DECAY_MIN_DAILY_BUCKETS data points.
 *  4. Sort daily buckets chronologically; compute current 63-day rolling Sharpe.
 *  5. Compute historical rolling Sharpe series (all preceding 63-day windows).
 *  6. Derive baseline mean+std from historical series.
 *  7. z-score = (currentSharpe - baselineMean) / baselineStd
 *  8. z < -2  → strategy.edge_decay_demotion_review + Discord WARN
 *     z < -1  → strategy.edge_decay_warn + Discord WARN
 *     z >= -1 → strategy.edge_decay_ok (info; no Discord)
 *
 * Advisory only — no auto-demotion. Operator or regime-drift-detector owns
 * lifecycle mutations.
 *
 * Audit actions (all in audit_log.result, status NOT NULL):
 *   strategy_decay_monitor.skipped_lock_contention  (info)
 *   strategy_decay_monitor.skipped_dst_guard        (info)
 *   strategy_decay_monitor.completed                (success)
 *   strategy.edge_decay_regime_shifting             (info)
 *   strategy.edge_decay_insufficient_data           (info)
 *   strategy.edge_decay_baseline_zero_std           (info)
 *   strategy.edge_decay_ok                          (info)
 *   strategy.edge_decay_warn                        (warning)
 *   strategy.edge_decay_demotion_review             (warning)
 *
 * Import notes:
 *   logger from ./logger.js leaf module (per CLAUDE.md feedback_helper_logger_import.md)
 */

import { randomUUID } from "crypto";
import { eq, and, desc, gte, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies, biasState, paperSessions, paperTrades } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
import { notifyWarning } from "./notification-service.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Rolling Sharpe window length in trading days. */
export const DECAY_WINDOW_DAYS = 63;

/** Calendar-day lookback for collecting paper_trades. ~2× trading window. */
export const DECAY_LOOKBACK_CALENDAR_DAYS = 126;

/** Minimum daily P&L buckets required before computing z-score baseline. */
export const DECAY_MIN_DAILY_BUCKETS = 70;

/** Days of consistent regime_label that must exist to classify regime as STABLE. */
export const STABLE_REGIME_CHECK_DAYS = 3;

/** z-score threshold for edge_decay_warn signal. */
export const DECAY_WARN_ZSCORE = -1;

/** z-score threshold for edge_decay_demotion_review signal. */
export const DECAY_REVIEW_ZSCORE = -2;

/** Minimum baseline Sharpe std to compute a meaningful z-score. */
const BASELINE_STD_MIN = 0.01;

/** Target ET hour for DST-safe guard (17 = 5:00 PM ET). */
const TARGET_ET_HOUR = 17;

// ─── Public types ─────────────────────────────────────────────────────────────

export type DecaySignal = "ok" | "warn" | "demotion_review";

export type DecaySkipReason =
  | "regime_shifting"
  | "insufficient_data"
  | "baseline_zero_std";

export interface DecayMonitorStrategyResult {
  strategyId: string;
  strategyName: string;
  symbol: string;
  skippedReason?: DecaySkipReason;
  signal?: DecaySignal;
  currentSharpe?: number;
  baselineMean?: number;
  baselineStd?: number;
  zScore?: number;
  dailyBucketsCount?: number;
}

export interface DecayMonitorResult {
  status: "completed" | "skipped_lock_contention" | "skipped_dst_guard";
  correlationId: string;
  durationMs: number;
  strategiesChecked: number;
  warnCount: number;
  reviewCount: number;
  skippedCount: number;
  dryRun: boolean;
  strategyResults?: DecayMonitorStrategyResult[];
}

// ─── DST-safe ET-hour helper ──────────────────────────────────────────────────

/** Returns current Eastern Time hour (0–23) using Intl.DateTimeFormat. DST-safe. */
export function _getEtHour(asOf: Date): number {
  const etHourStr = asOf.toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  });
  return parseInt(etHourStr, 10);
}

// ─── In-flight lock ───────────────────────────────────────────────────────────

let _decayMonitorInFlight = false;

export function _tryAcquireDecayLock(): boolean {
  if (_decayMonitorInFlight) return false;
  _decayMonitorInFlight = true;
  return true;
}

export function _releaseDecayLock(): void {
  _decayMonitorInFlight = false;
}

/** Test seam — reset the in-flight lock between tests. Do NOT call from production code. */
export function _resetDecayLockForTest(): void {
  _decayMonitorInFlight = false;
}

// ─── Pure-TS Sharpe helpers ───────────────────────────────────────────────────

/** Annualised Sharpe from a daily P&L series. Returns 0 when std is zero. */
export function _computeSharpe(dailyPnl: number[]): number {
  if (dailyPnl.length === 0) return 0;
  const mean = dailyPnl.reduce((a, b) => a + b, 0) / dailyPnl.length;
  const variance =
    dailyPnl.reduce((sum, r) => sum + (r - mean) ** 2, 0) /
    Math.max(dailyPnl.length - 1, 1);
  const std = Math.sqrt(variance);
  return std > 0 ? (mean / std) * Math.sqrt(252) : 0;
}

/**
 * Computes the rolling 63-day Sharpe series over the provided sorted daily series.
 * Returns every full-window slice from index 0 onward (step 1).
 */
export function _rollingSharpeSeries(sorted: number[], windowSize: number): number[] {
  const result: number[] = [];
  for (let i = 0; i + windowSize <= sorted.length; i++) {
    result.push(_computeSharpe(sorted.slice(i, i + windowSize)));
  }
  return result;
}

// ─── Core monitor ─────────────────────────────────────────────────────────────

/**
 * runStrategyDecayMonitor — main entry point.
 *
 * @param opts.asOf   Override the "now" timestamp (used in tests).
 * @param opts.dryRun When true, detects decay but suppresses Discord posts.
 *                    Audit rows are still written.
 */
export async function runStrategyDecayMonitor(opts?: {
  asOf?: Date;
  dryRun?: boolean;
}): Promise<DecayMonitorResult> {
  const asOf = opts?.asOf ?? new Date();
  const dryRun = opts?.dryRun ?? false;
  const correlationId = randomUUID();
  const startMs = Date.now();

  // ── Step 1: Job lock ──────────────────────────────────────────────────────
  const acquired = _tryAcquireDecayLock();
  if (!acquired) {
    logger.info(
      { correlationId, jobName: "strategy-decay-monitor" },
      "strategy-decay-monitor: previous tick still in-flight — skipping",
    );
    await insertAuditRowSafe({
      action: "strategy_decay_monitor.skipped_lock_contention",
      entityType: "scheduler_job",
      entityId: "strategy-decay-monitor",
      result: { correlationId },
      status: "info",
      decisionAuthority: "system",
      correlationId,
    });
    return {
      status: "skipped_lock_contention",
      correlationId,
      durationMs: Date.now() - startMs,
      strategiesChecked: 0,
      warnCount: 0,
      reviewCount: 0,
      skippedCount: 0,
      dryRun,
    };
  }

  try {
    // ── Step 2: DST-safe ET-hour guard ────────────────────────────────────
    const etHour = _getEtHour(asOf);
    if (etHour !== TARGET_ET_HOUR) {
      logger.info(
        { correlationId, jobName: "strategy-decay-monitor", etHour, expected: TARGET_ET_HOUR },
        "strategy-decay-monitor: ET-hour guard failed — skipping (DST double-fire protection)",
      );
      await insertAuditRowSafe({
        action: "strategy_decay_monitor.skipped_dst_guard",
        entityType: "scheduler_job",
        entityId: "strategy-decay-monitor",
        result: { correlationId, etHour, expected: TARGET_ET_HOUR },
        status: "info",
        decisionAuthority: "system",
        correlationId,
      });
      return {
        status: "skipped_dst_guard",
        correlationId,
        durationMs: Date.now() - startMs,
        strategiesChecked: 0,
        warnCount: 0,
        reviewCount: 0,
        skippedCount: 0,
        dryRun,
      };
    }

    // ── Step 3: Query DEPLOYED strategies ────────────────────────────────
    const deployedStrategies = await db
      .select({
        id: strategies.id,
        name: strategies.name,
        symbol: strategies.symbol,
      })
      .from(strategies)
      .where(eq(strategies.lifecycleState, "DEPLOYED"));

    logger.info(
      { correlationId, strategyCount: deployedStrategies.length, dryRun },
      "strategy-decay-monitor: starting daily sweep",
    );

    const strategyResults: DecayMonitorStrategyResult[] = [];
    let warnCount = 0;
    let reviewCount = 0;
    let skippedCount = 0;

    // ── Step 4: Per-strategy evaluation ──────────────────────────────────
    for (const strategy of deployedStrategies) {
      let result: DecayMonitorStrategyResult;
      try {
        result = await _evaluateStrategyDecay(strategy, asOf, dryRun, correlationId);
      } catch (err) {
        logger.error(
          { strategyId: strategy.id, err },
          "strategy-decay-monitor: per-strategy evaluation threw — skipping strategy",
        );
        await insertAuditRowSafe({
          action: "strategy_decay_monitor.strategy_eval_failed",
          entityType: "strategy",
          entityId: strategy.id,
          result: { correlationId, error_message: String(err) },
          status: "warning",
          decisionAuthority: "system",
          correlationId,
        });
        skippedCount++;
        continue;
      }
      strategyResults.push(result);

      if (result.skippedReason) {
        skippedCount++;
      } else if (result.signal === "demotion_review") {
        reviewCount++;
      } else if (result.signal === "warn") {
        warnCount++;
      }
    }

    // ── Step 5: Completion audit ──────────────────────────────────────────
    const durationMs = Date.now() - startMs;
    logger.info(
      {
        correlationId,
        strategiesChecked: deployedStrategies.length,
        warnCount,
        reviewCount,
        skippedCount,
        durationMs,
        dryRun,
      },
      "strategy-decay-monitor: sweep completed",
    );

    await insertAuditRowSafe({
      action: "strategy_decay_monitor.completed",
      entityType: "scheduler_job",
      entityId: "strategy-decay-monitor",
      result: {
        correlationId,
        strategiesChecked: deployedStrategies.length,
        warnCount,
        reviewCount,
        skippedCount,
        durationMs,
        dryRun,
      },
      status: "success",
      decisionAuthority: "system",
      correlationId,
    });

    return {
      status: "completed",
      correlationId,
      durationMs,
      strategiesChecked: deployedStrategies.length,
      warnCount,
      reviewCount,
      skippedCount,
      dryRun,
      strategyResults,
    };
  } finally {
    _releaseDecayLock();
  }
}

// ─── Per-strategy decay evaluation ───────────────────────────────────────────

async function _evaluateStrategyDecay(
  strategy: { id: string; name: string; symbol: string },
  asOf: Date,
  dryRun: boolean,
  correlationId: string,
): Promise<DecayMonitorStrategyResult> {
  const { id: strategyId, name: strategyName, symbol } = strategy;

  // Step 1: Stable-regime guard — read last STABLE_REGIME_CHECK_DAYS of regime_label.
  // If any of the last 3 days differ the market is actively changing; skip decay eval.
  const recentRegimeRows = await db
    .select({ regimeLabel: biasState.regimeLabel, sessionDate: biasState.sessionDate })
    .from(biasState)
    .where(eq(biasState.symbol, symbol))
    .orderBy(desc(biasState.sessionDate))
    .limit(STABLE_REGIME_CHECK_DAYS);

  const recentRegimes = recentRegimeRows.map((r) => r.regimeLabel);
  const uniqueRegimes = new Set(recentRegimes);

  // Fewer than required rows → treat as insufficient data for regime stability check
  if (recentRegimes.length < STABLE_REGIME_CHECK_DAYS || uniqueRegimes.size > 1) {
    logger.info(
      { correlationId, strategyId, strategyName, symbol, recentRegimes },
      "strategy-decay-monitor: regime is shifting or insufficient — skipping strategy",
    );
    await insertAuditRowSafe({
      action: "strategy.edge_decay_regime_shifting",
      entityType: "strategy",
      entityId: strategyId,
      result: {
        correlationId,
        strategyId,
        strategyName,
        symbol,
        recent_regimes: recentRegimes,
        days_checked: recentRegimes.length,
      },
      status: "info",
      decisionAuthority: "system",
      correlationId,
    });
    return { strategyId, strategyName, symbol, skippedReason: "regime_shifting" };
  }

  // Step 2: Collect paper_trades for the last DECAY_LOOKBACK_CALENDAR_DAYS calendar days.
  const lookbackFrom = new Date(asOf.getTime() - DECAY_LOOKBACK_CALENDAR_DAYS * 24 * 60 * 60 * 1000);

  const sessionRows = await db
    .select({ id: paperSessions.id })
    .from(paperSessions)
    .where(
      and(
        eq(paperSessions.strategyId, strategyId),
        inArray(paperSessions.status, ["active", "paused", "stopped"]),
      ),
    );

  const allTrades: { pnl: string; exitTime: Date | string }[] = [];
  for (const session of sessionRows) {
    const trades = await db
      .select({ pnl: paperTrades.pnl, exitTime: paperTrades.exitTime })
      .from(paperTrades)
      .where(
        and(
          eq(paperTrades.sessionId, session.id),
          gte(paperTrades.exitTime, lookbackFrom),
        ),
      );
    allTrades.push(...trades);
  }

  // Step 3: Build daily P&L buckets keyed by YYYY-MM-DD (UTC date of exit).
  const dailyPnlMap = new Map<string, number>();
  for (const t of allTrades) {
    const day = (t.exitTime instanceof Date ? t.exitTime : new Date(t.exitTime))
      .toISOString()
      .slice(0, 10);
    dailyPnlMap.set(day, (dailyPnlMap.get(day) ?? 0) + Number(t.pnl ?? 0));
  }

  // Step 4: Require minimum daily buckets for meaningful baseline computation.
  const dailyBucketsCount = dailyPnlMap.size;
  if (dailyBucketsCount < DECAY_MIN_DAILY_BUCKETS) {
    logger.info(
      { correlationId, strategyId, strategyName, dailyBucketsCount, required: DECAY_MIN_DAILY_BUCKETS },
      "strategy-decay-monitor: insufficient daily P&L data — skipping strategy",
    );
    await insertAuditRowSafe({
      action: "strategy.edge_decay_insufficient_data",
      entityType: "strategy",
      entityId: strategyId,
      result: {
        correlationId,
        strategyId,
        strategyName,
        symbol,
        daily_buckets_found: dailyBucketsCount,
        required: DECAY_MIN_DAILY_BUCKETS,
      },
      status: "info",
      decisionAuthority: "system",
      correlationId,
    });
    return { strategyId, strategyName, symbol, dailyBucketsCount, skippedReason: "insufficient_data" };
  }

  // Step 5: Sort daily P&L chronologically.
  const sortedDates = [...dailyPnlMap.keys()].sort();
  const sortedPnl = sortedDates.map((d) => dailyPnlMap.get(d) as number);

  // Step 6: Current Sharpe = last DECAY_WINDOW_DAYS daily values.
  const currentPnl = sortedPnl.slice(-DECAY_WINDOW_DAYS);
  const currentSharpe = _computeSharpe(currentPnl);

  // Step 7: Historical rolling Sharpe series = all preceding full 63-day windows.
  // historicalSharpes[i] = sharpe(sortedPnl[i .. i+DECAY_WINDOW_DAYS-1])
  // We exclude the current window (the last one) to avoid contamination.
  const allWindows = _rollingSharpeSeries(sortedPnl, DECAY_WINDOW_DAYS);
  // All windows except the last are historical; last window = current.
  const historicalSharpes = allWindows.slice(0, allWindows.length - 1);

  if (historicalSharpes.length === 0) {
    // Only one window available — not enough history to form a baseline.
    await insertAuditRowSafe({
      action: "strategy.edge_decay_insufficient_data",
      entityType: "strategy",
      entityId: strategyId,
      result: {
        correlationId,
        strategyId,
        strategyName,
        symbol,
        daily_buckets_found: dailyBucketsCount,
        note: "only one rolling window available — baseline requires at least two",
      },
      status: "info",
      decisionAuthority: "system",
      correlationId,
    });
    return { strategyId, strategyName, symbol, dailyBucketsCount, skippedReason: "insufficient_data" };
  }

  // Step 8: Baseline mean + std.
  const baselineMean =
    historicalSharpes.reduce((a, b) => a + b, 0) / historicalSharpes.length;
  const baselineVariance =
    historicalSharpes.reduce((sum, s) => sum + (s - baselineMean) ** 2, 0) /
    Math.max(historicalSharpes.length - 1, 1);
  const baselineStd = Math.sqrt(baselineVariance);

  if (baselineStd < BASELINE_STD_MIN) {
    // Baseline Sharpe has near-zero variation — z-score would be meaningless.
    logger.info(
      { correlationId, strategyId, strategyName, baselineMean, baselineStd },
      "strategy-decay-monitor: baseline Sharpe std near-zero — skipping z-score",
    );
    await insertAuditRowSafe({
      action: "strategy.edge_decay_baseline_zero_std",
      entityType: "strategy",
      entityId: strategyId,
      result: {
        correlationId,
        strategyId,
        strategyName,
        symbol,
        current_sharpe: currentSharpe,
        baseline_mean: baselineMean,
        baseline_std: baselineStd,
      },
      status: "info",
      decisionAuthority: "system",
      correlationId,
    });
    return { strategyId, strategyName, symbol, dailyBucketsCount, skippedReason: "baseline_zero_std" };
  }

  // Step 9: Z-score.
  const zScore = (currentSharpe - baselineMean) / baselineStd;

  logger.info(
    { correlationId, strategyId, strategyName, symbol, currentSharpe, baselineMean, baselineStd, zScore },
    "strategy-decay-monitor: z-score computed",
  );

  // Step 10: Route by z-score threshold.
  if (zScore < DECAY_REVIEW_ZSCORE) {
    return _emitDemotionReview({
      strategyId,
      strategyName,
      symbol,
      currentSharpe,
      baselineMean,
      baselineStd,
      zScore,
      dailyBucketsCount,
      correlationId,
      dryRun,
    });
  }

  if (zScore < DECAY_WARN_ZSCORE) {
    return _emitWarn({
      strategyId,
      strategyName,
      symbol,
      currentSharpe,
      baselineMean,
      baselineStd,
      zScore,
      dailyBucketsCount,
      correlationId,
      dryRun,
    });
  }

  // Healthy
  return _emitOk({
    strategyId,
    strategyName,
    symbol,
    currentSharpe,
    baselineMean,
    baselineStd,
    zScore,
    dailyBucketsCount,
    correlationId,
  });
}

// ─── Signal emitters ──────────────────────────────────────────────────────────

interface DecaySignalContext {
  strategyId: string;
  strategyName: string;
  symbol: string;
  currentSharpe: number;
  baselineMean: number;
  baselineStd: number;
  zScore: number;
  dailyBucketsCount: number;
  correlationId: string;
  dryRun?: boolean;
}

async function _emitOk(ctx: DecaySignalContext): Promise<DecayMonitorStrategyResult> {
  const { strategyId, strategyName, symbol, currentSharpe, baselineMean, baselineStd, zScore, dailyBucketsCount, correlationId } = ctx;
  await insertAuditRowSafe({
    action: "strategy.edge_decay_ok",
    entityType: "strategy",
    entityId: strategyId,
    result: {
      correlationId,
      strategyId,
      strategyName,
      symbol,
      current_sharpe: currentSharpe,
      baseline_mean: baselineMean,
      baseline_std: baselineStd,
      z_score: zScore,
      daily_buckets: dailyBucketsCount,
    },
    status: "info",
    decisionAuthority: "system",
    correlationId,
  });
  return { strategyId, strategyName, symbol, signal: "ok", currentSharpe, baselineMean, baselineStd, zScore, dailyBucketsCount };
}

async function _emitWarn(ctx: DecaySignalContext): Promise<DecayMonitorStrategyResult> {
  const { strategyId, strategyName, symbol, currentSharpe, baselineMean, baselineStd, zScore, dailyBucketsCount, correlationId, dryRun } = ctx;

  logger.warn(
    { correlationId, strategyId, strategyName, symbol, currentSharpe, zScore },
    "strategy-decay-monitor: edge decay warn (z < -1σ)",
  );

  await insertAuditRowSafe({
    action: "strategy.edge_decay_warn",
    entityType: "strategy",
    entityId: strategyId,
    result: {
      correlationId,
      strategyId,
      strategyName,
      symbol,
      current_sharpe: currentSharpe,
      baseline_mean: baselineMean,
      baseline_std: baselineStd,
      z_score: zScore,
      daily_buckets: dailyBucketsCount,
      threshold: DECAY_WARN_ZSCORE,
      advisory: "no auto-demotion — operator review recommended",
    },
    status: "warning",
    decisionAuthority: "system",
    correlationId,
  });

  if (!dryRun) {
    const operatorBody =
      `[WARN] Edge Decay Detected — Strategy: ${strategyName} (${strategyId})\n` +
      `Symbol: ${symbol}\n` +
      `Current 63-day Sharpe: ${currentSharpe.toFixed(3)}\n` +
      `Baseline Sharpe mean: ${baselineMean.toFixed(3)}  std: ${baselineStd.toFixed(3)}\n` +
      `Z-score: ${zScore.toFixed(2)} (threshold: ${DECAY_WARN_ZSCORE}σ)\n` +
      `Advisory only — no automatic demotion.\n` +
      `Correlation ID: ${correlationId}`;

    const fullBody = appendFamilyGradePostscript(
      operatorBody,
      "Your bot noticed that one strategy is performing below its historical average even though market conditions have not changed.",
      "No action needed yet — the bot is just watching. If this gets worse it will flag for a closer review.",
    );

    notifyWarning(
      `[decay-monitor] Edge Decay Warn — ${strategyName}`,
      fullBody,
      { strategyId, strategyName, symbol, currentSharpe, zScore, correlationId },
    );
  }

  return { strategyId, strategyName, symbol, signal: "warn", currentSharpe, baselineMean, baselineStd, zScore, dailyBucketsCount };
}

async function _emitDemotionReview(ctx: DecaySignalContext): Promise<DecayMonitorStrategyResult> {
  const { strategyId, strategyName, symbol, currentSharpe, baselineMean, baselineStd, zScore, dailyBucketsCount, correlationId, dryRun } = ctx;

  logger.warn(
    { correlationId, strategyId, strategyName, symbol, currentSharpe, zScore },
    "strategy-decay-monitor: edge decay demotion review (z < -2σ)",
  );

  await insertAuditRowSafe({
    action: "strategy.edge_decay_demotion_review",
    entityType: "strategy",
    entityId: strategyId,
    result: {
      correlationId,
      strategyId,
      strategyName,
      symbol,
      current_sharpe: currentSharpe,
      baseline_mean: baselineMean,
      baseline_std: baselineStd,
      z_score: zScore,
      daily_buckets: dailyBucketsCount,
      threshold: DECAY_REVIEW_ZSCORE,
      advisory: "demotion review recommended — operator decision required",
    },
    status: "warning",
    decisionAuthority: "system",
    correlationId,
  });

  if (!dryRun) {
    const operatorBody =
      `[WARN] Edge Decay — Demotion Review Recommended\n` +
      `Strategy: ${strategyName} (${strategyId})\n` +
      `Symbol: ${symbol}\n` +
      `Current 63-day Sharpe: ${currentSharpe.toFixed(3)}\n` +
      `Baseline Sharpe mean: ${baselineMean.toFixed(3)}  std: ${baselineStd.toFixed(3)}\n` +
      `Z-score: ${zScore.toFixed(2)} (threshold: ${DECAY_REVIEW_ZSCORE}σ)\n` +
      `Advisory only — no automatic demotion. Operator review required.\n` +
      `Correlation ID: ${correlationId}`;

    const fullBody = appendFamilyGradePostscript(
      operatorBody,
      "Your bot noticed that one strategy has dropped significantly below its historical performance level, even though market conditions are stable.",
      "No trade has been blocked. Please review this strategy when convenient — it may need to be re-trained or paused manually.",
    );

    notifyWarning(
      `[decay-monitor] Edge Decay — Demotion Review Required for ${strategyName}`,
      fullBody,
      { strategyId, strategyName, symbol, currentSharpe, zScore, correlationId },
    );
  }

  return { strategyId, strategyName, symbol, signal: "demotion_review", currentSharpe, baselineMean, baselineStd, zScore, dailyBucketsCount };
}
