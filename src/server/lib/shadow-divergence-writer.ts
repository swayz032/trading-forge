/**
 * shadow-divergence-writer.ts — M2 fix (hardening/phase-0 2026-06-23)
 *
 * Computes and persists divergence_vs_backtest on a lifecycle_shadow_signals row
 * immediately after it is INSERT-ed.  Called inline from the shadow-intercept block
 * in paper-signal-service.ts to keep the column fresh without a cron or worker.
 *
 * Strategy:
 *   1. Fetch the latest completed backtest's expected_signals baseline.
 *   2. Load the last N shadow signals for the strategy (including the one just inserted).
 *   3. Run compareShadowToBacktest() (pure function, no I/O).
 *   4. UPDATE lifecycle_shadow_signals SET divergence_vs_backtest = <result> WHERE id = <row>.
 *
 * Audit:
 *   - "lifecycle.shadow_divergence_computed" info  — successful UPDATE.
 *   - "lifecycle.shadow_divergence_baseline_missing" warn — no expected_signals in DB;
 *     writes NULL + continues (fail-OPEN per task spec).
 *
 * Performance:
 *   The loader reads at most N=20 shadow rows + 1 backtest row.  Measured well under
 *   the 50ms per-bar latency budget on the Skytech tower (no LLM calls; pure DB reads +
 *   synchronous pure-function computation).  If the tower is under high load and the
 *   await extends beyond 50ms the caller catches + logs without blocking the shadow path.
 *
 * IMPORTANT: this module must NOT be imported from any module that runs before the DB
 * is initialized (e.g. at module-load time in the test harness without mocking).
 */

import { db } from "../db/index.js";
import { lifecycleShadowSignals, backtests } from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "./logger.js";
import { insertAuditRow } from "./audit-log-helper.js";
import { compareShadowToBacktest } from "./shadow-signal-divergence-checker.js";
import type { ShadowSignal, ExpectedSignal } from "./shadow-signal-divergence-checker.js";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface ShadowDivergenceWriteResult {
  /** The raw divergence value written (null when baseline missing). */
  divergenceVsBacktest: number | null;
  /** Whether the UPDATE was successfully executed. */
  updated: boolean;
  /** Reason string when baseline is missing. */
  reason?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Load the latest completed backtest's expected_signals for a strategy.
 * Returns [] when absent (triggers insufficient_samples guard — fail-OPEN).
 */
async function loadExpectedSignals(strategyId: string): Promise<ExpectedSignal[]> {
  const [latestBt] = await db
    .select({ id: backtests.id, resultExtras: backtests.resultExtras })
    .from(backtests)
    .where(
      and(
        eq(backtests.strategyId, strategyId),
        eq(backtests.status, "completed"),
      ),
    )
    .orderBy(desc(backtests.createdAt))
    .limit(1);

  if (!latestBt) return [];

  const extras = latestBt.resultExtras as Record<string, unknown> | null;
  const rawExpected = extras?.expected_signals as unknown[] | undefined;

  if (!Array.isArray(rawExpected) || rawExpected.length === 0) return [];

  return (rawExpected as Array<Record<string, unknown>>)
    .map((row): ExpectedSignal => ({
      signal_ts:    typeof row.signal_ts    === "number" ? row.signal_ts    : 0,
      direction:    typeof row.direction    === "string" ? row.direction    : "long",
      entry_price:  typeof row.entry_price  === "number" ? row.entry_price  : 0,
      intended_size: typeof row.intended_size === "number" ? row.intended_size : 1,
    }))
    .sort((a, b) => a.signal_ts - b.signal_ts);
}

/**
 * Load the last N shadow signals for a strategy, chronological order.
 */
async function loadRecentShadowSignals(
  strategyId: string,
  n = 20,
): Promise<ShadowSignal[]> {
  const rows = await db
    .select({
      signalTs:       lifecycleShadowSignals.signalTs,
      direction:      lifecycleShadowSignals.direction,
      entryPrice:     lifecycleShadowSignals.entryPrice,
      intendedSize:   lifecycleShadowSignals.intendedSize,
      killzone:       lifecycleShadowSignals.killzone,
      regime:         lifecycleShadowSignals.regime,
      confluenceScore: lifecycleShadowSignals.confluenceScore,
    })
    .from(lifecycleShadowSignals)
    .where(eq(lifecycleShadowSignals.strategyId, strategyId))
    .orderBy(desc(lifecycleShadowSignals.signalTs))
    .limit(n);

  // Return chronological (oldest first) for comparator stability.
  rows.reverse();

  return rows.map((row) => ({
    signal_ts:       Math.floor(new Date(row.signalTs).getTime() / 1000),
    direction:       row.direction,
    entry_price:     row.entryPrice != null ? Number(row.entryPrice) : 0,
    intended_size:   row.intendedSize ?? 1,
    killzone:        row.killzone,
    regime:          row.regime,
    confluence_score: row.confluenceScore != null ? Number(row.confluenceScore) : null,
  }));
}

// ──────────────────────────────────────────────────────────────────────────────
// Primary export
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Compute divergence_vs_backtest for the just-inserted shadow signal row and
 * UPDATE the row in place.
 *
 * @param shadowRowId    The `id` (bigint) of the row just inserted.
 * @param strategyId     The strategy UUID.
 * @param correlationId  Trace ID for the audit chain.
 * @returns              Write result (divergenceVsBacktest may be null on baseline miss).
 */
export async function writeShadowDivergence(
  shadowRowId: bigint,
  strategyId: string,
  correlationId: string,
): Promise<ShadowDivergenceWriteResult> {
  // ── Step 1: load expected_signals baseline ──────────────────────────────────
  const backtestExpected = await loadExpectedSignals(strategyId);

  if (backtestExpected.length === 0) {
    // Fail-OPEN: write NULL + emit warn audit.  Do NOT block the shadow path.
    logger.warn(
      { strategyId, shadowRowId: shadowRowId.toString() },
      "M2: shadow divergence baseline missing — writing NULL (pre-Wave-29 backtest or expected_signals absent)",
    );

    await insertAuditRow({
      action: "lifecycle.shadow_divergence_baseline_missing",
      entityType: "strategy",
      entityId: strategyId,
      decisionAuthority: "system",
      result: {
        shadow_row_id:  shadowRowId.toString(),
        reason:         "expected_signals_absent_or_pre_wave29",
        divergence:     null,
        correlation_id: correlationId,
      } as Record<string, unknown>,
      status: "warn",
      correlationId,
    }).catch((err: unknown) =>
      logger.warn({ err, strategyId }, "M2: audit insert failed for shadow_divergence_baseline_missing"),
    );

    // UPDATE the row with NULL so the column is no longer the implicit "never computed"
    // state — NULL now means "computed; baseline absent" vs "not yet computed".
    await db
      .update(lifecycleShadowSignals)
      .set({ divergenceVsBacktest: null })
      .where(eq(lifecycleShadowSignals.id, shadowRowId));

    return { divergenceVsBacktest: null, updated: true, reason: "baseline_missing" };
  }

  // ── Step 2: load recent shadow signals (includes the just-inserted row) ─────
  const shadowSignals = await loadRecentShadowSignals(strategyId, 20);

  // ── Step 3: run pure comparator ─────────────────────────────────────────────
  const result = compareShadowToBacktest(shadowSignals, backtestExpected);

  const divergenceValue = result.sample_size >= 20
    ? result.divergence_pct   // real value when gate has enough samples
    : null;                   // insufficient_samples → NULL (not enough data yet)

  // ── Step 4: UPDATE the row ──────────────────────────────────────────────────
  await db
    .update(lifecycleShadowSignals)
    .set({ divergenceVsBacktest: divergenceValue })
    .where(eq(lifecycleShadowSignals.id, shadowRowId));

  // ── Step 5: audit ───────────────────────────────────────────────────────────
  await insertAuditRow({
    action: "lifecycle.shadow_divergence_computed",
    entityType: "strategy",
    entityId: strategyId,
    decisionAuthority: "system",
    result: {
      shadow_row_id:         shadowRowId.toString(),
      divergence_vs_backtest: divergenceValue,
      sample_size:           result.sample_size,
      divergence_pct:        result.divergence_pct,
      ok:                    result.ok,
      reason:                result.reason ?? null,
      correlation_id:        correlationId,
    } as Record<string, unknown>,
    status: "info",
    correlationId,
  }).catch((err: unknown) =>
    logger.warn({ err, strategyId }, "M2: audit insert failed for shadow_divergence_computed"),
  );

  logger.info(
    {
      strategyId,
      shadowRowId: shadowRowId.toString(),
      divergenceVsBacktest: divergenceValue,
      sampleSize: result.sample_size,
    },
    "M2: shadow divergence_vs_backtest updated",
  );

  return { divergenceVsBacktest: divergenceValue, updated: true };
}
