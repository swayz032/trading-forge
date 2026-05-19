/**
 * Phase 4.6 — Paper Session Feedback Service
 *
 * After each paper session closes, this service computes structured learning
 * evidence and persists it to paper_session_feedback. The record is queryable
 * by the critic in the next optimization cycle.
 *
 * Computed metrics:
 *   - win rate overall and by session window (ASIA/LONDON/NY_OPEN/NY_CORE/NY_CLOSE/OVERNIGHT)
 *   - P&L and trade count by session window
 *   - best and worst session windows
 *   - stop tightness: median MAE vs average loss size (>1.0 = stops too tight)
 *   - average realized R:R: mean(MFE / |MAE|) per trade (when MAE/MFE data available)
 *   - MFE capture rate: avg_win / avg_mfe_on_winners
 *   - win rate by side (long vs short)
 *   - profit factor
 *
 * Call contract:
 *   - Fire-and-forget from the session stop path (both route and auto-stop)
 *   - All failures are caught internally and logged; they never propagate to the caller
 *   - A second call for the same session_id is safe: it upserts (replaces) the row
 */

import { db } from "../db/index.js";
import { paperTrades, paperSessions, paperSessionFeedback } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

// ─── Internal helpers ────────────────────────────────────────────────────────

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// ─── Core computation ────────────────────────────────────────────────────────

export interface SessionFeedback {
  sessionId: string;
  strategyId: string | null;
  totalTrades: number;
  totalPnl: number;
  winRate: number | null;
  avgRrRealized: number | null;
  profitFactor: number | null;
  medianMae: number | null;
  avgLoss: number | null;
  stopTightnessRatio: number | null;
  winRateBySession: Record<string, number>;
  pnlBySession: Record<string, number>;
  tradeCountBySession: Record<string, number>;
  bestSessionWindow: string | null;
  worstSessionWindow: string | null;
  winRateBySide: Record<string, number>;
  medianMfe: number | null;
  avgMfeOnWinners: number | null;
  mfeCaptureRate: number | null;
  sessionStart: Date | null;
  sessionEnd: Date | null;
  hasMaeData: boolean;
  notes: string;
}

export async function computeSessionFeedback(sessionId: string): Promise<SessionFeedback | null> {
  // Fetch all trades for the session — we need the full row for MAE/MFE/sessionType/side
  const trades = await db
    .select({
      pnl: paperTrades.pnl,
      grossPnl: paperTrades.grossPnl,
      side: paperTrades.side,
      entryTime: paperTrades.entryTime,
      exitTime: paperTrades.exitTime,
      sessionType: paperTrades.sessionType,
      mae: paperTrades.mae,
      mfe: paperTrades.mfe,
    })
    .from(paperTrades)
    .where(eq(paperTrades.sessionId, sessionId))
    .orderBy(paperTrades.exitTime);

  // Also fetch the session for strategyId and timestamps
  const [session] = await db
    .select({
      strategyId: paperSessions.strategyId,
      startedAt: paperSessions.startedAt,
      stoppedAt: paperSessions.stoppedAt,
    })
    .from(paperSessions)
    .where(eq(paperSessions.id, sessionId));

  if (!session) return null;

  const totalTrades = trades.length;
  if (totalTrades === 0) {
    return {
      sessionId,
      strategyId: session.strategyId ?? null,
      totalTrades: 0,
      totalPnl: 0,
      winRate: null,
      avgRrRealized: null,
      profitFactor: null,
      medianMae: null,
      avgLoss: null,
      stopTightnessRatio: null,
      winRateBySession: {},
      pnlBySession: {},
      tradeCountBySession: {},
      bestSessionWindow: null,
      worstSessionWindow: null,
      winRateBySide: {},
      medianMfe: null,
      avgMfeOnWinners: null,
      mfeCaptureRate: null,
      sessionStart: session.startedAt ?? null,
      sessionEnd: session.stoppedAt ?? null,
      hasMaeData: false,
      notes: "No trades in session.",
    };
  }

  const pnls = trades.map((t) => Number(t.pnl ?? 0));
  const totalPnl = pnls.reduce((s, v) => s + v, 0);

  // ── Win rate overall ──────────────────────────────────────────────────────
  const winners = pnls.filter((p) => p > 0);
  const losers = pnls.filter((p) => p < 0);
  const winRate = pnls.length > 0 ? winners.length / pnls.length : null;

  // ── Profit factor ─────────────────────────────────────────────────────────
  const grossProfit = winners.reduce((s, v) => s + v, 0);
  const grossLoss = Math.abs(losers.reduce((s, v) => s + v, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : null;

  // ── Average loss ─────────────────────────────────────────────────────────
  const avgLoss = losers.length > 0 ? mean(losers) : null;

  // ── MAE / MFE ─────────────────────────────────────────────────────────────
  // mae and mfe columns are populated by Phase 1.5 (per-bar watermark tracking).
  // When the data is available, we compute stop-tightness and R:R ratios.
  // When unavailable (all null), hasMaeData = false and those metrics are null.
  const maeValues = trades
    .filter((t) => t.mae !== null && t.mae !== undefined)
    .map((t) => Math.abs(Number(t.mae))); // MAE is stored as negative $, convert to positive

  const mfeValues = trades
    .filter((t) => t.mfe !== null && t.mfe !== undefined)
    .map((t) => Math.abs(Number(t.mfe))); // MFE is stored as positive $

  const hasMaeData = maeValues.length > 0 && mfeValues.length > 0;

  const medianMae = hasMaeData ? median(maeValues) : null;
  const medianMfe = hasMaeData ? median(mfeValues) : null;

  // Stop tightness: |median_mae / avg_loss|
  // >1.0 means the median adverse excursion exceeded the average loss, implying
  // stops were too tight — trades were stopped out but would have recovered.
  const stopTightnessRatio =
    medianMae !== null && avgLoss !== null && avgLoss < 0
      ? medianMae / Math.abs(avgLoss)
      : null;

  // Average realized R:R = mean(MFE / |MAE|) per trade
  // Only computed for trades that have both MAE and MFE populated
  const rrPerTrade = trades
    .filter(
      (t) =>
        t.mae !== null &&
        t.mfe !== null &&
        Math.abs(Number(t.mae)) > 0,
    )
    .map((t) => Math.abs(Number(t.mfe)) / Math.abs(Number(t.mae)));

  const avgRrRealized = rrPerTrade.length > 0 ? mean(rrPerTrade) : null;

  // MFE capture rate = avg_win / avg_mfe_on_winners
  // How much of the max favorable move did we actually capture?
  const winnerMfes = trades
    .filter((t) => Number(t.pnl ?? 0) > 0 && t.mfe !== null)
    .map((t) => Math.abs(Number(t.mfe)));

  const avgMfeOnWinners = winnerMfes.length > 0 ? mean(winnerMfes) : null;
  const avgWin = winners.length > 0 ? mean(winners) : null;
  const mfeCaptureRate =
    avgWin !== null && avgMfeOnWinners !== null && avgMfeOnWinners > 0
      ? avgWin / avgMfeOnWinners
      : null;

  // ── Win rate / P&L by session window ────────────────────────────────────
  // Build accumulators keyed by sessionType.
  // Trades that pre-date Phase 1.1 (sessionType = null) go into an "UNKNOWN" bucket
  // so they're not silently dropped from the analysis.
  const sessionBuckets: Record<
    string,
    { pnls: number[]; wins: number }
  > = {};

  for (const t of trades) {
    const key = t.sessionType ?? "UNKNOWN";
    if (!sessionBuckets[key]) sessionBuckets[key] = { pnls: [], wins: 0 };
    const p = Number(t.pnl ?? 0);
    sessionBuckets[key].pnls.push(p);
    if (p > 0) sessionBuckets[key].wins++;
  }

  const winRateBySession: Record<string, number> = {};
  const pnlBySession: Record<string, number> = {};
  const tradeCountBySession: Record<string, number> = {};

  for (const [key, bucket] of Object.entries(sessionBuckets)) {
    winRateBySession[key] = bucket.pnls.length > 0 ? bucket.wins / bucket.pnls.length : 0;
    pnlBySession[key] = bucket.pnls.reduce((s, v) => s + v, 0);
    tradeCountBySession[key] = bucket.pnls.length;
  }

  // Auto-detect unprofitable session windows
  const sessionExclusions: string[] = [];
  for (const [window, pnl] of Object.entries(pnlBySession)) {
    const trades = tradeCountBySession[window] ?? 0;
    if (trades >= 20 && pnl < 0) {
      sessionExclusions.push(window);
      logger.info({ window, pnl, trades }, "Session window flagged for exclusion (negative P&L over 20+ trades)");
    }
  }

  // Best / worst by total P&L (exclude UNKNOWN from the comparison if other data exists)
  const sessionKeys = Object.keys(pnlBySession).filter(
    (k) => k !== "UNKNOWN" || Object.keys(pnlBySession).length === 1,
  );

  let bestSessionWindow: string | null = null;
  let worstSessionWindow: string | null = null;

  if (sessionKeys.length > 0) {
    bestSessionWindow = sessionKeys.reduce((best, k) =>
      pnlBySession[k] > (pnlBySession[best] ?? -Infinity) ? k : best,
    );
    worstSessionWindow = sessionKeys.reduce((worst, k) =>
      pnlBySession[k] < (pnlBySession[worst] ?? Infinity) ? k : worst,
    );
  }

  // ── Win rate by side ─────────────────────────────────────────────────────
  const sideBuckets: Record<string, { pnls: number[]; wins: number }> = {};
  for (const t of trades) {
    const key = t.side ?? "unknown";
    if (!sideBuckets[key]) sideBuckets[key] = { pnls: [], wins: 0 };
    const p = Number(t.pnl ?? 0);
    sideBuckets[key].pnls.push(p);
    if (p > 0) sideBuckets[key].wins++;
  }

  const winRateBySide: Record<string, number> = {};
  for (const [key, bucket] of Object.entries(sideBuckets)) {
    winRateBySide[key] = bucket.pnls.length > 0 ? bucket.wins / bucket.pnls.length : 0;
  }

  // ── Notes — human-readable summary for the critic ────────────────────────
  const noteFragments: string[] = [
    `${totalTrades} trades, net P&L $${totalPnl.toFixed(2)}.`,
  ];
  if (winRate !== null) noteFragments.push(`Win rate: ${(winRate * 100).toFixed(1)}%.`);
  if (profitFactor !== null) noteFragments.push(`Profit factor: ${profitFactor.toFixed(2)}.`);
  if (bestSessionWindow) noteFragments.push(`Best window: ${bestSessionWindow} ($${(pnlBySession[bestSessionWindow] ?? 0).toFixed(2)}).`);
  if (worstSessionWindow && worstSessionWindow !== bestSessionWindow)
    noteFragments.push(`Worst window: ${worstSessionWindow} ($${(pnlBySession[worstSessionWindow] ?? 0).toFixed(2)}).`);
  if (stopTightnessRatio !== null)
    noteFragments.push(
      stopTightnessRatio > 1.2
        ? `Stop tightness: ${stopTightnessRatio.toFixed(2)} (too tight — consider wider stops).`
        : `Stop tightness: ${stopTightnessRatio.toFixed(2)} (within acceptable range).`,
    );
  if (avgRrRealized !== null)
    noteFragments.push(`Avg realized R:R: ${avgRrRealized.toFixed(2)}.`);
  if (mfeCaptureRate !== null)
    noteFragments.push(`MFE capture rate: ${(mfeCaptureRate * 100).toFixed(1)}%.`);
  if (!hasMaeData)
    noteFragments.push("MAE/MFE data not available for this session — stop tightness and R:R are estimates only.");
  if (sessionExclusions.length > 0)
    noteFragments.push(`Session exclusion candidates (negative P&L, 20+ trades): ${sessionExclusions.join(", ")}.`);

  return {
    sessionId,
    strategyId: session.strategyId ?? null,
    totalTrades,
    totalPnl,
    winRate,
    avgRrRealized,
    profitFactor,
    medianMae,
    avgLoss,
    stopTightnessRatio,
    winRateBySession,
    pnlBySession,
    tradeCountBySession,
    bestSessionWindow,
    worstSessionWindow,
    winRateBySide,
    medianMfe,
    avgMfeOnWinners,
    mfeCaptureRate,
    sessionStart: session.startedAt ?? null,
    sessionEnd: session.stoppedAt ?? null,
    hasMaeData,
    notes: noteFragments.join(" "),
  };
}

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Compute and persist structured learning feedback for a closed paper session.
 *
 * This is intended to be called fire-and-forget from the session stop path.
 * All errors are caught and logged; they never propagate to the caller.
 *
 * If a feedback record already exists for the session it is replaced, so
 * calling twice (e.g., auto-stop then manual stop) is idempotent.
 */
export async function computeAndPersistSessionFeedback(
  sessionId: string,
): Promise<void> {
  try {
    const feedback = await computeSessionFeedback(sessionId);
    if (!feedback) {
      logger.warn({ sessionId }, "Paper session feedback: session not found, skipping");
      return;
    }

    // Delete any existing feedback for this session before inserting (idempotent)
    await db
      .delete(paperSessionFeedback)
      .where(eq(paperSessionFeedback.sessionId, sessionId));

    await db.insert(paperSessionFeedback).values({
      sessionId: feedback.sessionId,
      strategyId: feedback.strategyId ?? undefined,
      totalTrades: feedback.totalTrades,
      totalPnl: feedback.totalPnl?.toString(),
      winRate: feedback.winRate?.toString() ?? undefined,
      avgRrRealized: feedback.avgRrRealized?.toString() ?? undefined,
      profitFactor: feedback.profitFactor?.toString() ?? undefined,
      medianMae: feedback.medianMae?.toString() ?? undefined,
      avgLoss: feedback.avgLoss?.toString() ?? undefined,
      stopTightnessRatio: feedback.stopTightnessRatio?.toString() ?? undefined,
      winRateBySession: feedback.winRateBySession as Record<string, unknown>,
      pnlBySession: feedback.pnlBySession as Record<string, unknown>,
      tradeCountBySession: feedback.tradeCountBySession as Record<string, unknown>,
      bestSessionWindow: feedback.bestSessionWindow ?? undefined,
      worstSessionWindow: feedback.worstSessionWindow ?? undefined,
      winRateBySide: feedback.winRateBySide as Record<string, unknown>,
      medianMfe: feedback.medianMfe?.toString() ?? undefined,
      avgMfeOnWinners: feedback.avgMfeOnWinners?.toString() ?? undefined,
      mfeCaptureRate: feedback.mfeCaptureRate?.toString() ?? undefined,
      sessionStart: feedback.sessionStart ?? undefined,
      sessionEnd: feedback.sessionEnd ?? undefined,
      hasMaeData: feedback.hasMaeData,
      notes: feedback.notes,
    });

    logger.info(
      {
        sessionId,
        strategyId: feedback.strategyId,
        totalTrades: feedback.totalTrades,
        winRate: feedback.winRate,
        bestWindow: feedback.bestSessionWindow,
        stopTightnessRatio: feedback.stopTightnessRatio,
        hasMaeData: feedback.hasMaeData,
      },
      "Paper session feedback persisted",
    );
  } catch (err) {
    logger.error({ sessionId, err }, "Failed to compute or persist paper session feedback (non-blocking)");
  }
}
