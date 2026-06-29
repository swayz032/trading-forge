/**
 * shadow-signal-divergence-loader.ts — Wave 29 Pass A.3 (critic-optimizer)
 *
 * DB-access companion to shadow-signal-divergence-checker.ts.
 *
 * Separation of concerns: the comparator is PURE (no I/O); this module
 * owns all database reads required to feed the comparator.
 *
 * Schema dependency (A.1 — LANDED, Wave 29 Pass A.1 paper-parity):
 *   lifecycle_shadow_signals table (migration 0160_shadow_signals.sql) with columns:
 *     id, strategy_id, signal_ts, direction, entry_price, intended_size,
 *     killzone, regime, confluence_score, lifecycle_state, divergence_vs_backtest,
 *     source_correlation_id, traderspost_webhook_called, created_at.
 *   A.1 ships the complete schema with direct strategy_id FK (no join through
 *   paper_sessions required). The old pre-A.1 shadow_signals Wave 23 table
 *   (different schema: session_id join path, no direction/intended_size) is
 *   separate and unused by this loader.
 *
 * Schema dependency (backtests.expected_signals):
 *   Not yet persisted in the backtests table as of Wave 29 Pass A.
 *   loadBacktestExpectedSignalsForPeriod() currently returns [] for
 *   pre-Wave-29 backtests (triggers insufficient_samples guard — safe).
 *   A.4 architect will wire this once backtest-core adds expected_signals.
 */

import { db } from "../db/index.js";
import { lifecycleShadowSignals, backtests } from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "./logger.js";
import type { ShadowSignal, ExpectedSignal } from "./shadow-signal-divergence-checker.js";

// ──────────────────────────────────────────────────────────────────────────────
// Shadow signal loader
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Load the last N shadow signals for a strategy, sorted newest-first then
 * returned in chronological order (oldest first for comparator stability).
 *
 * @param strategyId  The strategy UUID.
 * @param n           Number of shadow signals to fetch (default 20).
 * @returns           Array of ShadowSignal, oldest-first. Empty array if none.
 */
export async function loadShadowSignalsForStrategy(
  strategyId: string,
  n = 20,
): Promise<ShadowSignal[]> {
  try {
    // A.1 (Wave 29 Pass A.1, paper-parity) shipped lifecycle_shadow_signals
    // with direct strategy_id FK and all required columns:
    //   signal_ts, direction, entry_price, intended_size,
    //   killzone, regime, confluence_score, lifecycle_state.
    // No join through paper_sessions required.
    const rows = await db
      .select({
        signalTs: lifecycleShadowSignals.signalTs,
        direction: lifecycleShadowSignals.direction,
        entryPrice: lifecycleShadowSignals.entryPrice,
        intendedSize: lifecycleShadowSignals.intendedSize,
        killzone: lifecycleShadowSignals.killzone,
        regime: lifecycleShadowSignals.regime,
        confluenceScore: lifecycleShadowSignals.confluenceScore,
      })
      .from(lifecycleShadowSignals)
      .where(eq(lifecycleShadowSignals.strategyId, strategyId))
      .orderBy(desc(lifecycleShadowSignals.signalTs))
      .limit(n);

    // Reverse to chronological (oldest first) for comparator stability.
    rows.reverse();

    return rows.map((row) => ({
      signal_ts: Math.floor(new Date(row.signalTs).getTime() / 1000),
      direction: row.direction,
      entry_price: row.entryPrice != null ? Number(row.entryPrice) : 0,
      intended_size: row.intendedSize ?? 1,
      killzone: row.killzone,
      regime: row.regime,
      confluence_score: row.confluenceScore != null ? Number(row.confluenceScore) : null,
    }));
  } catch (err) {
    logger.warn({ strategyId, err }, "shadow-signal-divergence-loader: loadShadowSignalsForStrategy threw");
    return [];
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Backtest expected signal loader
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Load the backtest's expected entry signals for the same trading days as
 * the shadow signals window.
 *
 * Expected signals are sourced from backtests.expected_signals JSONB column.
 * This column does not yet exist for pre-Wave-29 backtests; the loader returns
 * [] in that case (triggers insufficient_samples guard in the comparator — safe).
 *
 * @param strategyId  The strategy UUID.
 * @param startTs     Start of the window (Unix epoch seconds, inclusive).
 * @param endTs       End of the window (Unix epoch seconds, inclusive).
 * @returns           Array of ExpectedSignal chronologically ordered. Empty if none.
 */
export async function loadBacktestExpectedSignalsForPeriod(
  strategyId: string,
  startTs: number,
  endTs: number,
): Promise<ExpectedSignal[]> {
  try {
    const startDate = new Date(startTs * 1000);
    const endDate = new Date(endTs * 1000);

    // Find the latest completed backtest for this strategy.
    const [latestBt] = await db
      .select({
        id: backtests.id,
        resultExtras: backtests.resultExtras,
        gateResult: backtests.gateResult,
      })
      .from(backtests)
      .where(
        and(
          eq(backtests.strategyId, strategyId),
          eq(backtests.status, "completed"),
        ),
      )
      .orderBy(desc(backtests.createdAt))
      .limit(1);

    if (!latestBt) {
      logger.warn({ strategyId }, "shadow-signal-divergence-loader: no completed backtest found");
      return [];
    }

    // WIRED (Wave 29 Pass A.3): the Python backtester populates
    // result["expected_signals"] via _build_expected_signals_from_trades()
    // (backtester.py ~5079), and backtest-service.ts persists it into
    // resultExtras.expected_signals (extraKeys list). The earlier "not yet wired"
    // TODO is obsolete (2026-06-29 deep-scan #4 verified the full producer chain).
    // An empty/absent array means a 0-trade backtest or a pre-Wave-29 backtest:
    // the comparator's baseline-availability gate then BLOCKs fail-closed with
    // reason "backtest_baseline_unavailable" (not a spurious 100% divergence).
    const extras = latestBt.resultExtras as Record<string, unknown> | null;
    const rawExpected = extras?.expected_signals as unknown[] | undefined;

    if (!Array.isArray(rawExpected) || rawExpected.length === 0) {
      logger.warn(
        { strategyId, backtestId: latestBt.id },
        "shadow-signal-divergence-loader: backtests.resultExtras.expected_signals " +
        "empty/absent (0-trade or pre-Wave-29 backtest) — comparator blocks fail-closed " +
        "with backtest_baseline_unavailable.",
      );
      return [];
    }

    // Filter to the requested time window and coerce to ExpectedSignal shape.
    const startEpoch = startTs;
    const endEpoch = endTs;

    const inWindow = (rawExpected as Array<Record<string, unknown>>)
      .filter((row) => {
        const ts = typeof row.signal_ts === "number" ? row.signal_ts : 0;
        return ts >= startEpoch && ts <= endEpoch;
      })
      .map((row): ExpectedSignal => ({
        signal_ts: typeof row.signal_ts === "number" ? row.signal_ts : 0,
        direction: typeof row.direction === "string" ? row.direction : "long",
        entry_price: typeof row.entry_price === "number" ? row.entry_price : 0,
        intended_size: typeof row.intended_size === "number" ? row.intended_size : 1,
      }))
      .sort((a, b) => a.signal_ts - b.signal_ts);

    return inWindow;
  } catch (err) {
    logger.warn({ strategyId, err }, "shadow-signal-divergence-loader: loadBacktestExpectedSignalsForPeriod threw");
    return [];
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Convenience: load both and derive time window from shadow signals
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Convenience loader: fetch shadow signals + backtest expected signals for the
 * same trading window. Returns both arrays ready for compareShadowToBacktest().
 *
 * @param strategyId  The strategy UUID.
 * @param n           Shadow signal count to load (default 20).
 */
export async function loadDivergenceInputs(
  strategyId: string,
  n = 20,
): Promise<{ shadowSignals: ShadowSignal[]; backtestExpected: ExpectedSignal[] }> {
  const shadow = await loadShadowSignalsForStrategy(strategyId, n);

  if (shadow.length === 0) {
    return { shadowSignals: [], backtestExpected: [] };
  }

  const timestamps = shadow.map((s) => s.signal_ts);
  const startTs = Math.min(...timestamps);
  const endTs = Math.max(...timestamps);

  const backtestExpected = await loadBacktestExpectedSignalsForPeriod(
    strategyId,
    startTs,
    endTs,
  );

  return { shadowSignals: shadow, backtestExpected };
}
