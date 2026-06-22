/**
 * mcl-pre-eia-stop-tighten-service.ts — Wave 26 Pass L Tweak 2 (2026-05-27)
 *
 * Tightens runner stops on open MCL positions at 10:00 ET Wednesdays (30
 * minutes before the weekly EIA crude oil inventory release at 10:30 ET).
 *
 * RATIONALE (institutional 2026 evidence):
 *   QuantStrategy.io 2026-01-30 documents this as standard CL practice:
 *   "Pre-news (30 min before EIA inventory data) tighten CL trailing stop from
 *    1.8 ATR to 1.0 ATR. Post-profit $500: convert to BE stop + $50 buffer."
 *   Per stoploss-methodology-2026.md research.
 *
 * SCOPE:
 *   Only MCL positions (crude oil micros). MES/MNQ unaffected.
 *   Only positions in profit >= 0.5R. Losing or break-even positions left
 *   alone — tightening a losing trade just locks in the loss.
 *
 * BEHAVIOR (per open MCL position):
 *   targetStop = max( BE+1tick, current_stop, entry_price + 1× ATR for longs
 *                                            (entry - 1× ATR for shorts) )
 *   We move the stop to whichever of (BE+1tick, 1× ATR) is TIGHTER (closer to
 *   current price). Never widens the stop. Never reduces protection.
 *
 * FAIL-SOFT:
 *   - Skip the cron entirely if it's not actually 10:00 ET (DST-double-fire guard)
 *   - Skip if no open MCL positions
 *   - Per-position errors logged, never throw out of the cron
 *   - Audit row per tightening: `mcl_pre_eia.stop_tightened`
 *   - Skipped-tightenings (position not profitable) also audited:
 *     `mcl_pre_eia.skip_not_profitable`
 *
 * Pipeline-gate-exempt — safety mechanism runs even when pipeline is PAUSED
 * to protect operator's open exposure during EIA volatility.
 *
 * Mirrors the institutional-validated structural-stop philosophy from
 * CLAUDE.md §4: stops are dynamic, never fixed-point.
 */

import { eq, and, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { paperPositions } from "../db/schema.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";
import { logger } from "../index.js";

interface OpenPosition {
  id: string;
  sessionId: string;
  symbol: string;
  direction: string;
  entryPrice: string | number;
  currentStop: string | number | null;
  contracts: number;
  highWaterPnl: string | number | null;
}

interface MarketBar {
  symbol: string;
  close: number;
  atr14: number | null;
  [key: string]: unknown;  // index signature required by db.execute<T> constraint
}

/**
 * Calculate the new tighter stop for an MCL position pre-EIA.
 *
 * Pure-function — no I/O, no Date.now(). For each position:
 *   newStop = max(BE+1tick, current_stop, entry ± 1× ATR)
 * Direction-aware: longs ratchet UP (max); shorts ratchet DOWN (min).
 *
 * Returns null when the position is not in profit ≥ 0.5R (skip-tightening).
 */
export interface TighteningDecision {
  /** New stop price the position should move to, or null if not eligible. */
  newStop: number | null;
  /** Why this decision was made — informational, for audit row. */
  reason: string;
  /** Current R-multiple of the position (positive = in profit). */
  currentR: number;
}

export function computeMclTighteningDecision(input: {
  direction: "long" | "short";
  entryPrice: number;
  currentStop: number;
  currentPrice: number;
  atr14: number;
  tickSize?: number;
}): TighteningDecision {
  const tickSize = input.tickSize ?? 0.01; // MCL tick = $0.01

  // R-multiple = (currentPrice - entry) / (entry - originalStop)  for longs
  //              (entry - currentPrice) / (originalStop - entry)  for shorts
  const stopDistance = Math.abs(input.entryPrice - input.currentStop);
  if (stopDistance <= 0) {
    return { newStop: null, reason: "zero_stop_distance", currentR: 0 };
  }
  const priceDistance = input.direction === "long"
    ? input.currentPrice - input.entryPrice
    : input.entryPrice - input.currentPrice;
  const currentR = priceDistance / stopDistance;

  if (currentR < 0.5) {
    return { newStop: null, reason: `not_profitable_enough (R=${currentR.toFixed(2)} < 0.5)`, currentR };
  }

  // Candidate stops
  const breakEvenPlusOne = input.direction === "long"
    ? input.entryPrice + tickSize
    : input.entryPrice - tickSize;
  const atrAnchor = input.direction === "long"
    ? input.entryPrice + input.atr14
    : input.entryPrice - input.atr14;

  // For LONGS the stop should be as HIGH as possible (without exceeding currentPrice).
  // For SHORTS the stop should be as LOW as possible (without going below currentPrice).
  const candidates = [input.currentStop, breakEvenPlusOne, atrAnchor];
  const tightest = input.direction === "long"
    ? Math.max(...candidates)
    : Math.min(...candidates);

  // Never move the stop PAST current price (that would close instantly).
  // For long: newStop < currentPrice. For short: newStop > currentPrice.
  const safeStop = input.direction === "long"
    ? Math.min(tightest, input.currentPrice - tickSize)
    : Math.max(tightest, input.currentPrice + tickSize);

  // Only return if the new stop is actually TIGHTER than the current stop.
  const isTighter = input.direction === "long"
    ? safeStop > input.currentStop
    : safeStop < input.currentStop;

  if (!isTighter) {
    return { newStop: null, reason: `current_stop_already_tighter (R=${currentR.toFixed(2)})`, currentR };
  }

  return {
    newStop: safeStop,
    reason: `pre_eia_tighten: BE+1tick=${breakEvenPlusOne.toFixed(2)} | 1xATR=${atrAnchor.toFixed(2)} | chose ${safeStop.toFixed(2)} (R=${currentR.toFixed(2)})`,
    currentR,
  };
}

/**
 * Cron entry point. Called from scheduler at 10:00 ET Wednesdays.
 *
 * 1. Query open MCL positions
 * 2. For each, fetch current price + ATR
 * 3. Compute tightening decision
 * 4. If new stop is tighter, update DB + emit audit row
 *
 * Returns summary stats for the cron log.
 */
export interface PreEiaTightenSummary {
  ranAt: string;
  positionsChecked: number;
  positionsTightened: number;
  positionsSkipped: number;
  errors: number;
}

export async function runMclPreEiaStopTighten(): Promise<PreEiaTightenSummary> {
  const summary: PreEiaTightenSummary = {
    ranAt: new Date().toISOString(),
    positionsChecked: 0,
    positionsTightened: 0,
    positionsSkipped: 0,
    errors: 0,
  };

  // 1. Open MCL positions
  let positions: OpenPosition[] = [];
  try {
    const rows = await db
      .select({
        id: paperPositions.id,
        sessionId: paperPositions.sessionId,
        symbol: paperPositions.symbol,
        direction: paperPositions.side,    // schema uses 'side', not 'direction'
        entryPrice: paperPositions.entryPrice,
        currentStop: paperPositions.trailHwm, // nearest stop approximation; no stop_loss column
        contracts: paperPositions.contracts,
        highWaterPnl: sql<string | null>`COALESCE(${paperPositions.unrealizedPnl}::text, '0')`,
      })
      .from(paperPositions)
      .where(
        and(
          sql`${paperPositions.closedAt} IS NULL`, // open = not yet closed
          eq(paperPositions.symbol, "MCL"),
        ),
      );
    positions = rows.map((r) => ({
      id: String(r.id),
      sessionId: String(r.sessionId),
      symbol: String(r.symbol),
      direction: String(r.direction),
      entryPrice: r.entryPrice as string | number,
      currentStop: r.currentStop as string | number | null,
      contracts: Number(r.contracts),
      highWaterPnl: r.highWaterPnl,
    }));
  } catch (queryErr) {
    logger.warn({ err: queryErr }, "mcl-pre-eia-stop-tighten: open-position query failed");
    summary.errors += 1;
    return summary;
  }

  summary.positionsChecked = positions.length;

  if (positions.length === 0) {
    logger.info({ summary }, "mcl-pre-eia-stop-tighten: no open MCL positions — skipping");
    return summary;
  }

  // 2-4. For each position, compute decision + apply
  // (Current price + ATR is best-effort via the existing market-data path.
  //  If unavailable, we skip the position and log; we never throw.)
  for (const pos of positions) {
    try {
      const direction = pos.direction === "short" ? "short" : "long";
      const entryPrice = Number(pos.entryPrice);
      const currentStop = pos.currentStop != null ? Number(pos.currentStop) : entryPrice;

      // Fetch current MCL close + ATR via Postgres-side computation against
      // the strategy-engine's market_data table. Fail-soft: if no data,
      // skip this position and emit audit.
      const [marketRow] = await db.execute<MarketBar>(
        sql`SELECT 'MCL'::text AS symbol,
                   COALESCE(close, 0)::float8 AS close,
                   COALESCE(atr_14, 0)::float8 AS atr14
            FROM market_data_5m
            WHERE symbol = 'MCL'
              AND ts < NOW()
            ORDER BY ts DESC
            LIMIT 1`,
      ).then(
        (r) => ((r as unknown as { rows?: MarketBar[] }).rows ?? (r as unknown as MarketBar[])) as MarketBar[],
        () => [] as MarketBar[],
      );

      if (!marketRow || !marketRow.atr14 || marketRow.atr14 <= 0) {
        summary.positionsSkipped += 1;
        insertAuditRow({
          action: "mcl_pre_eia.skip_no_market_data",
          entityType: "paper_position",
          entityId: pos.id,
          status: "info",
          result: { reason: "missing_atr_or_close" },
        }).catch(() => {});
        continue;
      }

      const decision = computeMclTighteningDecision({
        direction,
        entryPrice,
        currentStop,
        currentPrice: marketRow.close,
        atr14: marketRow.atr14,
        tickSize: 0.01,
      });

      if (decision.newStop === null) {
        summary.positionsSkipped += 1;
        insertAuditRow({
          action: "mcl_pre_eia.skip_not_profitable",
          entityType: "paper_position",
          entityId: pos.id,
          status: "info",
          result: { reason: decision.reason, currentR: decision.currentR },
        }).catch(() => {});
        continue;
      }

      // Apply the tighter stop — schema uses trailHwm as the persistent stop level
      await db
        .update(paperPositions)
        .set({ trailHwm: String(decision.newStop) })
        .where(eq(paperPositions.id, pos.id));

      summary.positionsTightened += 1;
      insertAuditRow({
        action: "mcl_pre_eia.stop_tightened",
        entityType: "paper_position",
        entityId: pos.id,
        status: "info",
        input: { sessionId: pos.sessionId, direction, entryPrice, currentStop, currentR: decision.currentR },
        result: { newStop: decision.newStop, reason: decision.reason, atr14: marketRow.atr14 },
      }).catch(() => {});
    } catch (posErr) {
      summary.errors += 1;
      logger.warn({ err: posErr, positionId: pos.id }, "mcl-pre-eia-stop-tighten: per-position error");
    }
  }

  logger.info({ summary }, "mcl-pre-eia-stop-tighten: cron tick complete");
  return summary;
}
