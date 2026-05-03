/**
 * W19 Schema 2 — OI Liquidity Filter
 *
 * Checks open interest trend for a symbol to detect stale/expiring contracts.
 * Blocks new entries when 5-day OI has declined > 20% (contract rolling out of
 * front-month position — liquidity drying up before expiry).
 *
 * This is a SOFT gate: it returns a recommendation, not an enforcement block.
 * Enforcement wired into paper-signal-service.ts as an advisory check.
 *
 * Authority: OBSERVATION + SOFT GATE. Does NOT block lifecycle transitions.
 * Pipeline-gated: honours isActive() via the calling signal service.
 */

import { desc, eq, and, gte } from "drizzle-orm";
import { db } from "../db/index.js";
import { dailyStatistics } from "../db/schema.js";
import { logger } from "../lib/logger.js";

const OI_DECLINE_THRESHOLD = 0.20; // 20% decline over 5 days → block new entries
const OI_LOOKBACK_DAYS = 5;

// In-memory cache per symbol (10-minute TTL — OI published once per day)
const CACHE_TTL_MS = 10 * 60 * 1000;
const oiCache = new Map<string, { result: OiFilterResult; cachedAt: number }>();

export interface OiFilterResult {
  symbol: string;
  shouldBlock: boolean;
  reason: string;
  latestOi: number | null;
  earliestOi: number | null;
  declinePct: number | null;
  threshold: number;
  dataPoints: number;
  checkedAt: string;
}

export function invalidateOiCache(symbol?: string): void {
  if (symbol) {
    oiCache.delete(symbol);
  } else {
    oiCache.clear();
  }
}

/**
 * Check if a symbol's open interest is declining enough to block new entries.
 * Returns a filter result with shouldBlock flag and explanation.
 *
 * Fail-open: if we have no OI data for a symbol, shouldBlock=false.
 * This prevents the filter from silently blocking all entries when data is missing.
 */
export async function checkOiLiquidity(symbol: string): Promise<OiFilterResult> {
  const cached = oiCache.get(symbol);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.result;
  }

  const checkedAt = new Date().toISOString();
  const defaultResult: OiFilterResult = {
    symbol,
    shouldBlock: false,
    reason: "no_oi_data",
    latestOi: null,
    earliestOi: null,
    declinePct: null,
    threshold: OI_DECLINE_THRESHOLD,
    dataPoints: 0,
    checkedAt,
  };

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - OI_LOOKBACK_DAYS - 2); // extra buffer for holidays
    const cutoffStr = cutoffDate.toISOString().slice(0, 10);

    const rows = await db
      .select({
        tradeDate: dailyStatistics.tradeDate,
        openInterest: dailyStatistics.openInterest,
      })
      .from(dailyStatistics)
      .where(
        and(
          eq(dailyStatistics.symbol, symbol),
          gte(dailyStatistics.tradeDate, cutoffStr),
        ),
      )
      .orderBy(desc(dailyStatistics.tradeDate))
      .limit(OI_LOOKBACK_DAYS + 3);

    const oiRows = rows.filter((r) => r.openInterest != null && r.openInterest > 0);

    if (oiRows.length < 2) {
      // Insufficient data — fail open
      const result = { ...defaultResult, reason: "insufficient_data", dataPoints: oiRows.length };
      oiCache.set(symbol, { result, cachedAt: Date.now() });
      return result;
    }

    const latestOi = oiRows[0].openInterest!;
    const earliestOi = oiRows[oiRows.length - 1].openInterest!;
    const declinePct = (earliestOi - latestOi) / earliestOi;

    const shouldBlock = declinePct > OI_DECLINE_THRESHOLD;
    const result: OiFilterResult = {
      symbol,
      shouldBlock,
      reason: shouldBlock
        ? `oi_declined_${Math.round(declinePct * 100)}pct_over_${oiRows.length}_days`
        : "oi_healthy",
      latestOi,
      earliestOi,
      declinePct,
      threshold: OI_DECLINE_THRESHOLD,
      dataPoints: oiRows.length,
      checkedAt,
    };

    if (shouldBlock) {
      logger.warn(
        { symbol, latestOi, earliestOi, declinePct, threshold: OI_DECLINE_THRESHOLD },
        "oi-liquidity-filter: declining OI detected — new entries should be blocked",
      );
    }

    oiCache.set(symbol, { result, cachedAt: Date.now() });
    return result;
  } catch (err) {
    logger.warn({ err, symbol }, "oi-liquidity-filter: DB read failed — failing open");
    const result = { ...defaultResult, reason: "db_error" };
    oiCache.set(symbol, { result, cachedAt: Date.now() });
    return result;
  }
}

/**
 * Check OI for all tracked symbols. Used in daily health reports.
 */
export async function checkAllSymbolsOi(): Promise<OiFilterResult[]> {
  const symbols = ["ES", "NQ", "MES", "MNQ", "MCL"];
  return Promise.all(symbols.map(checkOiLiquidity));
}
