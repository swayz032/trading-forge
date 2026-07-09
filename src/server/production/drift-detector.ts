/**
 * src/server/production/drift-detector.ts
 *
 * Weekly Sunday drift detection cron (Phase 4B).
 *
 * Computes 30-day rolling live Sharpe vs backtest expected Sharpe.
 * Auto-HALTs via killSwitch.setMode('HALT') when drift >= 2σ.
 *
 * ─── HARD ISOLATION BOUNDARY ───────────────────────────────────────────────
 * This file MUST NOT import from: agent-service, critic-optimizer-service,
 * quantum_* modules, synthetic_market_simulator, or any scout-* service.
 * Violation detection: `npm run check:production-isolation`
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Design principles:
 *   - Fail-CLOSED: data fetch error → severity=red, auto-halt triggered
 *   - Bypasses pipeline gate: safety-signal cron — runs regardless of pause state
 *   - Idempotent: UNIQUE constraint on report_week, upserts cleanly
 *   - Audit_log row on every run with severity + sigma values
 *   - Discord alert on yellow OR red
 *
 * Thresholds (all in config — no magic numbers in logic):
 *   SIGMA_YELLOW_THRESHOLD  = 1.0    (>= 1σ → yellow, alert, no halt)
 *   SIGMA_RED_THRESHOLD     = 2.0    (>= 2σ → red, auto-HALT)
 *   LIVE_SHARPE_LOOKBACK_DAYS = 30   (rolling window for live Sharpe)
 */

import { db } from "../db/index.js";
import {
  weeklyDriftReports,
  productionTrades,
  paperTrades,
  strategies,
  auditLog,
} from "../db/schema.js";
import { eq, gte, sql, and, desc } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { AlertFactory } from "../services/alert-service.js";
import { broadcastSSE } from "../routes/sse.js";
import { killSwitch } from "./kill-switch.js";

// ─── Config (all thresholds here — no magic numbers in logic) ────────────────

export const DRIFT_CONFIG = {
  SIGMA_YELLOW_THRESHOLD: Number(process.env["DRIFT_SIGMA_YELLOW_THRESHOLD"] ?? 1.0),
  SIGMA_RED_THRESHOLD:    Number(process.env["DRIFT_SIGMA_RED_THRESHOLD"] ?? 2.0),
  LIVE_SHARPE_LOOKBACK_DAYS: Number(process.env["DRIFT_SHARPE_LOOKBACK_DAYS"] ?? 30),
  ANNUAL_FACTOR: 252, // Annualization factor for Sharpe computation
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type DriftSeverity = "green" | "yellow" | "red";

export interface DriftReport {
  reportWeek: string;
  liveSharpe30d: number | null;
  backtestSharpeExpected: number | null;
  sharpeDeltaSigma: number | null;
  winRateDelta: number | null;
  slippageDelta: number | null;
  latencyP95Ms: number | null;
  severity: DriftSeverity;
  autoHaltTriggered: boolean;
  ranAt: Date;
}

// ─── Helper: Monday of current week (start-of-report-week) ───────────────────

function currentWeekMonday(): Date {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon, ... 6=Sat
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - daysToMonday
  ));
  return monday;
}

// ─── Live Sharpe computation ──────────────────────────────────────────────────

interface LiveMetrics {
  sharpe: number | null;
  winRate: number | null;
  avgSlippage: number | null;
}

/**
 * Compute 30-day rolling live Sharpe from production_trades.
 *
 * When no trades exist, returns null (not zero — null signals "insufficient data"
 * and prevents spurious sigma calculations).
 *
 * Sharpe = mean(daily_pnl) / std(daily_pnl) * sqrt(ANNUAL_FACTOR)
 * Daily P&L is aggregated from expected_pnl per bar_timestamp date.
 */
async function computeLiveMetrics(lookbackDays: number): Promise<LiveMetrics> {
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  // Fetch daily P&L sums from production_trades.
  // deep-scan market-data F-2 (2026-07-06): the live-Sharpe leg read SUM(expected_pnl), but broker-router writes
  // expected_pnl=null by design (never fabricates a number) → every day's SUM was null→0 → stdDev=0 → sharpe=null
  // → the drift-detector auto-HALT leg has been permanently DARK, indistinguishable from a transient "need more
  // days". FIX: prefer the REAL realized P&L (actual_pnl, written by fill-reconciliation) via COALESCE, and count
  // the non-null P&L rows so we can loudly distinguish "structurally dark (no real P&L ever)" from "N<2 days".
  const dailyRows = await db.execute<{ trade_date: string; daily_pnl: string; trade_count: string; pnl_rows: string; slippage_avg: string }>(
    sql`
      SELECT
        DATE(bar_timestamp) AS trade_date,
        SUM(COALESCE(actual_pnl, expected_pnl)) AS daily_pnl,
        COUNT(*) AS trade_count,
        COUNT(COALESCE(actual_pnl, expected_pnl)) AS pnl_rows,
        AVG(actual_slippage - expected_slippage) AS slippage_avg
      FROM production_trades
      WHERE bar_timestamp >= ${cutoff.toISOString()}
      GROUP BY DATE(bar_timestamp)
      ORDER BY trade_date
    `
  );

  // Structural-dark detection: if NO row across the whole lookback carries a non-null P&L, the live-Sharpe leg
  // cannot compute — surface it distinctly so it is never mistaken for a transient "insufficient data" green.
  const totalPnlRows = dailyRows.reduce((s, r) => s + Number(r.pnl_rows ?? 0), 0);
  if (dailyRows.length >= 2 && totalPnlRows === 0) {
    logger.warn(
      { lookbackDays, tradeDays: dailyRows.length },
      "drift-detector: live-Sharpe leg is STRUCTURALLY DARK — production_trades has trades but ZERO non-null P&L " +
        "(expected_pnl is null by design; actual_pnl unpopulated until fill-reconciliation runs). The >2σ auto-HALT " +
        "cannot fire on live Sharpe. This is a DISTINCT structural gap, not a transient 'need more days' state.",
    );
    return { sharpe: null, winRate: null, avgSlippage: null };
  }

  if (dailyRows.length < 2) {
    // Insufficient data for Sharpe computation (transient — genuinely too few trade-days yet)
    return { sharpe: null, winRate: null, avgSlippage: null };
  }

  const dailyPnls = dailyRows.map((r: { trade_date: string; daily_pnl: string; trade_count: string; pnl_rows: string; slippage_avg: string }) => Number(r.daily_pnl ?? 0));
  const n = dailyPnls.length;
  const mean = dailyPnls.reduce((a: number, b: number) => a + b, 0) / n;
  const variance = dailyPnls.reduce((s: number, x: number) => s + (x - mean) ** 2, 0) / (n - 1);
  const stdDev = Math.sqrt(variance);

  const sharpe = stdDev > 0
    ? (mean / stdDev) * Math.sqrt(DRIFT_CONFIG.ANNUAL_FACTOR)
    : null;

  const winDays = dailyPnls.filter((p: number) => p > 0).length;
  const winRate = n > 0 ? winDays / n : null;

  const slippageValues = dailyRows
    .map((r: { trade_date: string; daily_pnl: string; trade_count: string; slippage_avg: string }) => Number(r.slippage_avg ?? 0))
    .filter((v: number) => !isNaN(v));
  const avgSlippage = slippageValues.length > 0
    ? slippageValues.reduce((a, b) => a + b, 0) / slippageValues.length
    : null;

  return { sharpe, winRate, avgSlippage };
}

/**
 * Get the backtest-expected Sharpe for the most recently DEPLOYED strategy.
 *
 * Falls back to null when no deployed strategy has backtest metrics.
 * The drift detector compares live vs this expected value.
 */
async function fetchBacktestExpectedSharpe(): Promise<number | null> {
  // Use paper_trades as proxy for deployed-strategy performance expectation.
  // In Phase 4C, this will pull from strategies.config.expected_sharpe once wired.
  // For now, derive from recent paper_trades rolling Sharpe as the "expected" baseline.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const dailyRows = await db.execute<{ trade_date: string; daily_pnl: string }>(
    sql`
      SELECT
        DATE(exit_time) AS trade_date,
        SUM(pnl) AS daily_pnl
      FROM paper_trades
      WHERE exit_time >= ${thirtyDaysAgo.toISOString()}
        AND exit_time < NOW() - INTERVAL '30 days'
      GROUP BY DATE(exit_time)
      ORDER BY trade_date
    `
  );

  if (dailyRows.length < 2) {
    return null;
  }

  const dailyPnls = dailyRows.map((r: { trade_date: string; daily_pnl: string }) => Number(r.daily_pnl ?? 0));
  const n = dailyPnls.length;
  const mean = dailyPnls.reduce((a: number, b: number) => a + b, 0) / n;
  const variance = dailyPnls.reduce((s: number, x: number) => s + (x - mean) ** 2, 0) / (n - 1);
  const stdDev = Math.sqrt(variance);

  return stdDev > 0
    ? (mean / stdDev) * Math.sqrt(DRIFT_CONFIG.ANNUAL_FACTOR)
    : null;
}

// ─── Sigma deviation computation ─────────────────────────────────────────────

/**
 * Compute the sigma deviation between live and expected Sharpe.
 *
 * Uses a simplified approach: delta / expected_std where expected_std is
 * approximated from 1/sqrt(n_obs) (standard error of Sharpe estimate).
 *
 * Returns null when either metric is unavailable.
 */
function computeSharpeDeltaSigma(
  liveSharpe: number | null,
  expectedSharpe: number | null,
  lookbackDays: number
): number | null {
  if (liveSharpe === null || expectedSharpe === null) {
    return null;
  }

  const delta = Math.abs(liveSharpe - expectedSharpe);

  // Standard error of Sharpe estimate: approx 1/sqrt(T) where T = number of periods
  // For daily Sharpe with lookbackDays observations: SE ≈ sqrt((1 + Sharpe^2/2) / T)
  const T = Math.max(lookbackDays, 5); // floor at 5 to prevent division issues
  const se = Math.sqrt((1 + expectedSharpe ** 2 / 2) / T);

  return se > 0 ? delta / se : null;
}

// ─── Main drift detection logic ───────────────────────────────────────────────

/**
 * Run weekly drift detection for `reportWeek` (defaults to current week Monday).
 *
 * Fail-CLOSED: any data fetch error → severity=red, auto-halt triggered,
 * audit_log + alert fired.
 */
export async function runWeeklyDriftDetection(
  reportWeek: Date = currentWeekMonday()
): Promise<DriftReport> {
  const startedAt = Date.now();
  const reportWeekStr = reportWeek.toISOString().slice(0, 10);

  logger.info(
    { reportWeek: reportWeekStr },
    "drift-detector: starting weekly drift detection"
  );

  // ── Data fetch with fail-CLOSED ──────────────────────────────────────────
  let liveMetrics: LiveMetrics;
  let backtestSharpeExpected: number | null;

  try {
    [liveMetrics, backtestSharpeExpected] = await Promise.all([
      computeLiveMetrics(DRIFT_CONFIG.LIVE_SHARPE_LOOKBACK_DAYS),
      fetchBacktestExpectedSharpe(),
    ]);
  } catch (fetchErr) {
    logger.error(
      { err: fetchErr, reportWeek: reportWeekStr },
      "drift-detector: data fetch error — triggering fail-CLOSED halt"
    );

    const failClosedReport = await writeDriftRow({
      reportWeek: reportWeekStr,
      liveSharpe30d: null,
      backtestSharpeExpected: null,
      sharpeDeltaSigma: null,
      winRateDelta: null,
      slippageDelta: null,
      latencyP95Ms: null,
      severity: "red",
      autoHaltTriggered: true,
      startedAt,
      error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
    });

    // Trigger auto-halt (fail-CLOSED)
    await killSwitch.setMode(
      "HALT",
      `drift_red_fail_closed: data fetch error — ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
      "drift-detector"
    );

    await AlertFactory.driftAlert(
      "drift-detector",
      "sharpe_delta_sigma",
      DRIFT_CONFIG.SIGMA_RED_THRESHOLD + 1 // sentinel value for "data unavailable → treat as red"
    );

    return failClosedReport;
  }

  // ── Compute sigma deviation ───────────────────────────────────────────────
  const sharpeDeltaSigma = computeSharpeDeltaSigma(
    liveMetrics.sharpe,
    backtestSharpeExpected,
    DRIFT_CONFIG.LIVE_SHARPE_LOOKBACK_DAYS
  );

  // ── Derive severity ───────────────────────────────────────────────────────
  let severity: DriftSeverity;
  let autoHaltTriggered = false;

  if (sharpeDeltaSigma === null) {
    // Insufficient data — treat as green (no data to violate)
    severity = "green";
  } else if (sharpeDeltaSigma < DRIFT_CONFIG.SIGMA_YELLOW_THRESHOLD) {
    severity = "green";
  } else if (sharpeDeltaSigma < DRIFT_CONFIG.SIGMA_RED_THRESHOLD) {
    severity = "yellow";
  } else {
    severity = "red";
    autoHaltTriggered = true;
  }

  // ── Write weekly_drift_reports row ────────────────────────────────────────
  const report = await writeDriftRow({
    reportWeek: reportWeekStr,
    liveSharpe30d: liveMetrics.sharpe,
    backtestSharpeExpected,
    sharpeDeltaSigma,
    winRateDelta: null, // Phase 4C wires win rate from paper session data
    slippageDelta: liveMetrics.avgSlippage,
    latencyP95Ms: null, // Phase 4C wires p95 from paper execution latency
    severity,
    autoHaltTriggered,
    startedAt,
  });

  // ── Auto-HALT on red ──────────────────────────────────────────────────────
  if (autoHaltTriggered) {
    logger.error(
      {
        reportWeek: reportWeekStr,
        sharpeDeltaSigma,
        sigma_threshold: DRIFT_CONFIG.SIGMA_RED_THRESHOLD,
      },
      "drift-detector: severity=red — triggering automatic production HALT"
    );

    await killSwitch.setMode(
      "HALT",
      `drift_red: sharpe_delta_sigma=${sharpeDeltaSigma?.toFixed(2)} >= ${DRIFT_CONFIG.SIGMA_RED_THRESHOLD}σ threshold`,
      "drift-detector"
    );
  }

  // ── Fire alert on yellow OR red ───────────────────────────────────────────
  if (severity === "yellow" || severity === "red") {
    await AlertFactory.driftAlert(
      "live-strategy",
      "sharpe_delta_sigma",
      sharpeDeltaSigma ?? 0
    );
  }

  logger.info(
    {
      reportWeek: reportWeekStr,
      severity,
      sharpeDeltaSigma,
      liveSharpe30d: liveMetrics.sharpe,
      backtestSharpeExpected,
      autoHaltTriggered,
      durationMs: Date.now() - startedAt,
    },
    "drift-detector: weekly drift detection complete"
  );

  return report;
}

// ─── Write drift row + audit_log ──────────────────────────────────────────────

interface WriteDriftRowParams {
  reportWeek: string;
  liveSharpe30d: number | null;
  backtestSharpeExpected: number | null;
  sharpeDeltaSigma: number | null;
  winRateDelta: number | null;
  slippageDelta: number | null;
  latencyP95Ms: number | null;
  severity: DriftSeverity;
  autoHaltTriggered: boolean;
  startedAt: number;
  error?: string;
}

async function writeDriftRow(params: WriteDriftRowParams): Promise<DriftReport> {
  const ranAt = new Date();
  const durationMs = Date.now() - params.startedAt;

  // Upsert (idempotent — UNIQUE on report_week)
  await db
    .insert(weeklyDriftReports)
    .values({
      reportWeek: params.reportWeek,
      liveSharpe30d: params.liveSharpe30d !== null ? String(params.liveSharpe30d) : null,
      backtestSharpeExpected: params.backtestSharpeExpected !== null ? String(params.backtestSharpeExpected) : null,
      sharpeDeltaSigma: params.sharpeDeltaSigma !== null ? String(params.sharpeDeltaSigma) : null,
      winRateDelta: params.winRateDelta !== null ? String(params.winRateDelta) : null,
      slippageDelta: params.slippageDelta !== null ? String(params.slippageDelta) : null,
      latencyP95Ms: params.latencyP95Ms,
      severity: params.severity,
      autoHaltTriggered: params.autoHaltTriggered,
      ranAt,
    })
    .onConflictDoUpdate({
      target: weeklyDriftReports.reportWeek,
      set: {
        liveSharpe30d: params.liveSharpe30d !== null ? String(params.liveSharpe30d) : null,
        backtestSharpeExpected: params.backtestSharpeExpected !== null ? String(params.backtestSharpeExpected) : null,
        sharpeDeltaSigma: params.sharpeDeltaSigma !== null ? String(params.sharpeDeltaSigma) : null,
        winRateDelta: params.winRateDelta !== null ? String(params.winRateDelta) : null,
        slippageDelta: params.slippageDelta !== null ? String(params.slippageDelta) : null,
        latencyP95Ms: params.latencyP95Ms,
        severity: params.severity,
        autoHaltTriggered: params.autoHaltTriggered,
        ranAt,
      },
    });

  // Audit log — non-blocking
  db.insert(auditLog)
    .values({
      action: "production.drift_detection.completed",
      entityType: "drift_report",
      entityId: null,
      decisionAuthority: "system",
      input: {
        reportWeek: params.reportWeek,
        lookbackDays: DRIFT_CONFIG.LIVE_SHARPE_LOOKBACK_DAYS,
      } as Record<string, unknown>,
      result: {
        severity: params.severity,
        sharpeDeltaSigma: params.sharpeDeltaSigma,
        liveSharpe30d: params.liveSharpe30d,
        backtestSharpeExpected: params.backtestSharpeExpected,
        autoHaltTriggered: params.autoHaltTriggered,
        ...(params.error ? { error: params.error } : {}),
      } as Record<string, unknown>,
      status: params.severity === "red" ? "failure" : "success",
      durationMs,
      correlationId: null,
    })
    .catch((err) =>
      logger.error({ err }, "drift-detector: audit_log write failed (non-blocking)")
    );

  // SSE event
  broadcastSSE("production:drift-detection-completed", {
    reportWeek: params.reportWeek,
    severity: params.severity,
    sharpeDeltaSigma: params.sharpeDeltaSigma,
    autoHaltTriggered: params.autoHaltTriggered,
    ranAt: ranAt.toISOString(),
  });

  return {
    reportWeek: params.reportWeek,
    liveSharpe30d: params.liveSharpe30d,
    backtestSharpeExpected: params.backtestSharpeExpected,
    sharpeDeltaSigma: params.sharpeDeltaSigma,
    winRateDelta: params.winRateDelta,
    slippageDelta: params.slippageDelta,
    latencyP95Ms: params.latencyP95Ms,
    severity: params.severity,
    autoHaltTriggered: params.autoHaltTriggered,
    ranAt,
  };
}
