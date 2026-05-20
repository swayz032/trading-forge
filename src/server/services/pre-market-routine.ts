/**
 * pre-market-routine.ts — W23H.2 Pre-Market Context Engine
 *
 * Computes the 8-item pre-market checklist for each symbol (MES/MNQ/MCL) at
 * 8:30 AM ET and persists to `pre_market_sessions` table via UPSERT.
 *
 * Steps (per symbol):
 *   1. Yesterday's 1d bar → PDH, PDL, prev_day_close
 *   2. Last 7d of 1d bars → PWH, PWL
 *   3. Overnight Globex 5m bars (18:00 prev day → 09:30 ET today) → overnight_range_points
 *   4. 20-period ATR on 1d bars → percentile vs 60d baseline → vix_bucket
 *   5. skipDecisions for today → economic_calendar_clear, blackout_windows
 *   6. First 5m bar open vs prev_day_close → opening_gap_pct
 *   7. First 5m bar open → vwap_anchor (initial anchor; updated by 10am refresh)
 *   8. computeBiasForAllSymbols → htf_bias
 *   9. Compose written_bias string
 *  10. UPSERT to pre_market_sessions
 *
 * All DB interactions are injectable via PreMarketDataAccessLayer for unit testing.
 * Fail-open: errors are logged and re-thrown so the scheduler can emit errored audit.
 */

import { randomUUID } from "crypto";
import { logger } from "../lib/logger.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";

// ─── Data Access Layer (injectable for tests) ─────────────────────────────────

export interface DailyBar {
  date: string;         // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface IntraBar {
  ts: string;           // ISO timestamp
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface SkipDecisionRow {
  decisionDate: Date;
  decision: string;
  reason: string | null;
  triggeredSignals: string[] | null;
}

export interface UpsertPreMarketInput {
  sessionDate: string;
  symbol: string;
  overnightRangePoints: number | null;
  vixBucket: string | null;
  vixProxyAtrPercentile: number | null;
  economicCalendarClear: boolean | null;
  blackoutWindows: BlackoutWindow[] | null;
  openingGapPct: number | null;
  vwapAnchor: number | null;
  pdh: number | null;
  pdl: number | null;
  pwh: number | null;
  pwl: number | null;
  htfBias: string | null;
  writtenBias: string | null;
}

export interface BlackoutWindow {
  event_type: string;
  start_utc: string;
  end_utc: string;
  severity: string;
}

export interface PreMarketDataAccessLayer {
  /** Daily OHLCV bars, newest first; limit as requested. */
  getDailyBars(symbol: string, limit: number): Promise<DailyBar[]>;
  /** Intraday 5m bars for overnight Globex window (18:00 prev day → 09:30 today ET). */
  getOvernightBars(symbol: string, sessionDate: string): Promise<IntraBar[]>;
  /** skipDecisions rows for today (decision_date on the session_date). */
  getSkipDecisionsForDate(sessionDate: string): Promise<SkipDecisionRow[]>;
  /** First available 5m bar at or after 09:30 ET on session_date. */
  getFirstRthBar(symbol: string, sessionDate: string): Promise<IntraBar | null>;
  /** Compute HTF bias for a symbol (wraps computeBiasForAllSymbols). */
  getHtfBias(symbol: string, sessionDate: string, correlationId: string): Promise<string | null>;
  /** UPSERT to pre_market_sessions; returns the persisted row id. */
  upsertPreMarketSession(input: UpsertPreMarketInput): Promise<number>;
}

// ─── Live DAL implementation ──────────────────────────────────────────────────

let _liveDal: PreMarketDataAccessLayer | null = null;

async function getLiveDal(): Promise<PreMarketDataAccessLayer> {
  if (_liveDal) return _liveDal;

  const { db } = await import("../db/index.js");
  const { preMarketSessions, skipDecisions } = await import("../db/schema.js");
  const { sql, and, gte, lte, eq } = await import("drizzle-orm");

  const dal: PreMarketDataAccessLayer = {
    async getDailyBars(symbol: string, limit: number): Promise<DailyBar[]> {
      // Fetch daily bars from the internal bars endpoint
      const apiUrl = process.env.TRADING_FORGE_API_URL ?? "http://localhost:4000";
      const apiKey = process.env.API_KEY ?? "";
      const url = `${apiUrl}/api/bars/${symbol}?timeframe=1d&limit=${limit}`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) {
        throw new Error(`getDailyBars HTTP ${resp.status} for ${symbol}`);
      }
      const body = (await resp.json()) as { bars?: DailyBar[] };
      return body.bars ?? [];
    },

    async getOvernightBars(symbol: string, sessionDate: string): Promise<IntraBar[]> {
      const apiUrl = process.env.TRADING_FORGE_API_URL ?? "http://localhost:4000";
      const apiKey = process.env.API_KEY ?? "";
      const url = `${apiUrl}/api/bars/${symbol}?date=${sessionDate}&timeframe=5m&limit=120&overnight=true`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) {
        // Non-fatal — overnight bars may not be available for all symbols
        logger.warn({ symbol, sessionDate, status: resp.status }, "pre-market-routine: overnight bars unavailable");
        return [];
      }
      const body = (await resp.json()) as { bars?: IntraBar[] };
      return body.bars ?? [];
    },

    async getSkipDecisionsForDate(sessionDate: string): Promise<SkipDecisionRow[]> {
      const dayStart = new Date(`${sessionDate}T00:00:00Z`);
      const dayEnd = new Date(`${sessionDate}T23:59:59Z`);
      const rows = await db
        .select({
          decisionDate: skipDecisions.decisionDate,
          decision: skipDecisions.decision,
          reason: skipDecisions.reason,
          triggeredSignals: skipDecisions.triggeredSignals,
        })
        .from(skipDecisions)
        .where(
          and(
            gte(skipDecisions.decisionDate, dayStart),
            lte(skipDecisions.decisionDate, dayEnd),
          ),
        );
      return rows;
    },

    async getFirstRthBar(symbol: string, sessionDate: string): Promise<IntraBar | null> {
      const apiUrl = process.env.TRADING_FORGE_API_URL ?? "http://localhost:4000";
      const apiKey = process.env.API_KEY ?? "";
      const url = `${apiUrl}/api/bars/${symbol}?date=${sessionDate}&timeframe=5m&limit=1`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(6000),
      });
      if (!resp.ok) return null;
      const body = (await resp.json()) as { bars?: IntraBar[] };
      return body.bars?.[0] ?? null;
    },

    async getHtfBias(symbol: string, sessionDate: string, correlationId: string): Promise<string | null> {
      try {
        const { computeBiasForAllSymbols } = await import("./bias-state-service.js");
        const results = await computeBiasForAllSymbols(sessionDate, correlationId, false);
        const biasState = results.get(symbol);
        if (!biasState) return null;
        return biasState.regimeLabel ?? null;
      } catch (err) {
        logger.warn({ err, symbol, sessionDate }, "pre-market-routine: htf bias fetch failed");
        return null;
      }
    },

    async upsertPreMarketSession(input: UpsertPreMarketInput): Promise<number> {
      const rows = await db
        .insert(preMarketSessions)
        .values({
          sessionDate: input.sessionDate,
          symbol: input.symbol,
          overnightRangePoints: input.overnightRangePoints != null ? String(input.overnightRangePoints) : null,
          vixBucket: input.vixBucket,
          vixProxyAtrPercentile: input.vixProxyAtrPercentile != null ? String(input.vixProxyAtrPercentile) : null,
          economicCalendarClear: input.economicCalendarClear,
          blackoutWindows: input.blackoutWindows,
          openingGapPct: input.openingGapPct != null ? String(input.openingGapPct) : null,
          vwapAnchor: input.vwapAnchor != null ? String(input.vwapAnchor) : null,
          pdh: input.pdh != null ? String(input.pdh) : null,
          pdl: input.pdl != null ? String(input.pdl) : null,
          pwh: input.pwh != null ? String(input.pwh) : null,
          pwl: input.pwl != null ? String(input.pwl) : null,
          htfBias: input.htfBias,
          writtenBias: input.writtenBias,
          computedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [preMarketSessions.sessionDate, preMarketSessions.symbol],
          set: {
            overnightRangePoints: sql`EXCLUDED.overnight_range_points`,
            vixBucket: sql`EXCLUDED.vix_bucket`,
            vixProxyAtrPercentile: sql`EXCLUDED.vix_proxy_atr_percentile`,
            economicCalendarClear: sql`EXCLUDED.economic_calendar_clear`,
            blackoutWindows: sql`EXCLUDED.blackout_windows`,
            openingGapPct: sql`EXCLUDED.opening_gap_pct`,
            vwapAnchor: sql`EXCLUDED.vwap_anchor`,
            pdh: sql`EXCLUDED.pdh`,
            pdl: sql`EXCLUDED.pdl`,
            pwh: sql`EXCLUDED.pwh`,
            pwl: sql`EXCLUDED.pwl`,
            htfBias: sql`EXCLUDED.htf_bias`,
            writtenBias: sql`EXCLUDED.written_bias`,
            computedAt: sql`EXCLUDED.computed_at`,
          },
        })
        .returning({ id: preMarketSessions.id });
      return rows[0]!.id;
    },
  };

  _liveDal = dal;
  return dal;
}

/** Test-only: reset the cached live DAL (injected DAL overrides are per-call anyway). */
export function __resetLiveDalForTests(): void {
  _liveDal = null;
}

// ─── ATR percentile computation ───────────────────────────────────────────────

/**
 * Compute the 14-period ATR for each daily bar (True Range = max(H-L, |H-prevC|, |L-prevC|)).
 * Returns the most-recent 20-period ATR value and its percentile vs the prior 60 days of ATR.
 */
export function computeAtrStats(bars: DailyBar[]): {
  currentAtr: number | null;
  percentile: number | null;
  bucket: "normal" | "elevated" | "extreme" | null;
} {
  if (bars.length < 2) {
    return { currentAtr: null, percentile: null, bucket: null };
  }

  // True Range for each bar (needs prior close)
  const trValues: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prevClose = bars[i - 1]!.close;
    const high = bars[i]!.high;
    const low = bars[i]!.low;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trValues.push(tr);
  }

  // 20-period ATR (SMA of TR) on most-recent bars
  const ATR_PERIOD = 20;
  if (trValues.length < ATR_PERIOD) {
    return { currentAtr: null, percentile: null, bucket: null };
  }

  const recentTr = trValues.slice(-ATR_PERIOD);
  const currentAtr = recentTr.reduce((s, v) => s + v, 0) / ATR_PERIOD;

  // Percentile: compare currentAtr against prior 60d of 20-period ATR values
  // We need at least ATR_PERIOD + 60 bars in total for a meaningful baseline
  const BASELINE_WINDOW = 60;
  const minBarsNeeded = ATR_PERIOD + BASELINE_WINDOW;
  if (trValues.length < minBarsNeeded) {
    // Not enough history — return current ATR without percentile
    return { currentAtr, percentile: null, bucket: null };
  }

  // Compute a rolling 20-period ATR for each position in the baseline window
  const baselineEnd = trValues.length - ATR_PERIOD;
  const baselineStart = Math.max(0, baselineEnd - BASELINE_WINDOW);
  const baselineAtrs: number[] = [];
  for (let i = baselineStart; i < baselineEnd; i++) {
    const slice = trValues.slice(i, i + ATR_PERIOD);
    const atr = slice.reduce((s, v) => s + v, 0) / ATR_PERIOD;
    baselineAtrs.push(atr);
  }

  if (baselineAtrs.length === 0) {
    return { currentAtr, percentile: null, bucket: null };
  }

  const below = baselineAtrs.filter((a) => a <= currentAtr).length;
  const percentile = (below / baselineAtrs.length) * 100;

  let bucket: "normal" | "elevated" | "extreme";
  if (percentile >= 80) {
    bucket = "extreme";
  } else if (percentile >= 50) {
    bucket = "elevated";
  } else {
    bucket = "normal";
  }

  return { currentAtr, percentile, bucket };
}

// ─── Written bias composition ─────────────────────────────────────────────────

/**
 * Compose a written_bias string from htf_bias and key level fields.
 *
 * Format:
 *   bullish → "bullish_above_<pdh>"
 *   bearish → "bearish_below_<pdl>"
 *   neutral / range → "neutral_<pdl>_<pdh>"
 *   null htf_bias → null
 */
export function composeWrittenBias(
  htfBias: string | null,
  pdh: number | null,
  pdl: number | null,
): string | null {
  if (!htfBias) return null;

  const upper = pdh ?? null;
  const lower = pdl ?? null;

  const label = htfBias.toLowerCase();

  if (label.includes("bullish") || label.includes("trending_up") || label.includes("full_long") || label.includes("lean_long")) {
    return upper != null ? `bullish_above_${upper}` : "bullish";
  }
  if (label.includes("bearish") || label.includes("trending_down") || label.includes("full_short") || label.includes("lean_short")) {
    return lower != null ? `bearish_below_${lower}` : "bearish";
  }
  if (label.includes("range") || label.includes("mean_rev") || label.includes("no_trade")) {
    if (lower != null && upper != null) return `neutral_${lower}_${upper}`;
    return "neutral";
  }
  // unknown / stub fallback
  return "neutral";
}

// ─── Main routine ─────────────────────────────────────────────────────────────

export interface PreMarketRoutineResult {
  sessionDate: string;
  symbol: string;
  rowId: number;
  fieldsPopulated: string[];
  computedAt: string;
}

/**
 * runPreMarketRoutine — compute and persist one symbol's pre-market context.
 *
 * @param symbol       Trading symbol (MES / MNQ / MCL)
 * @param sessionDate  Trading date string (YYYY-MM-DD)
 * @param correlationId  Correlation ID for audit linkage
 * @param dalOverride  Injectable DAL for unit tests
 */
export async function runPreMarketRoutine(
  symbol: string,
  sessionDate: string,
  correlationId: string = randomUUID(),
  dalOverride?: PreMarketDataAccessLayer,
): Promise<PreMarketRoutineResult> {
  const dal = dalOverride ?? (await getLiveDal());

  logger.info(
    { symbol, sessionDate, correlationId },
    "pre-market-routine: starting",
  );

  // ── Step 1+2: Daily bars — PDH, PDL, prev_day_close, PWH, PWL ───────────────
  // Fetch 8 bars: need 1 for yesterday + 7 for prev-week range
  const dailyBars = await dal.getDailyBars(symbol, 8);
  // dailyBars is newest-first from the API; we need oldest→newest for ATR
  const dailyBarsAsc = [...dailyBars].reverse();

  let pdh: number | null = null;
  let pdl: number | null = null;
  let prevDayClose: number | null = null;
  let pwh: number | null = null;
  let pwl: number | null = null;

  if (dailyBarsAsc.length >= 2) {
    // "Yesterday" = second most recent bar (index 0 in descending = today or most recent session;
    // index 1 = yesterday/prior session). In ascending order that's [length-2].
    const yesterday = dailyBarsAsc[dailyBarsAsc.length - 2]!;
    pdh = yesterday.high;
    pdl = yesterday.low;
    prevDayClose = yesterday.close;
  } else if (dailyBarsAsc.length === 1) {
    // Only one bar available — use it as yesterday
    const yesterday = dailyBarsAsc[0]!;
    pdh = yesterday.high;
    pdl = yesterday.low;
    prevDayClose = yesterday.close;
  }

  // Last 7 completed bars for prev-week high/low
  const weekBars = dailyBarsAsc.slice(-7);
  if (weekBars.length > 0) {
    pwh = Math.max(...weekBars.map((b) => b.high));
    pwl = Math.min(...weekBars.map((b) => b.low));
  }

  // ── Step 3: Overnight range ──────────────────────────────────────────────────
  let overnightRangePoints: number | null = null;
  const overnightBars = await dal.getOvernightBars(symbol, sessionDate);
  if (overnightBars.length > 0) {
    const ovHigh = Math.max(...overnightBars.map((b) => b.high));
    const ovLow = Math.min(...overnightBars.map((b) => b.low));
    overnightRangePoints = Math.round((ovHigh - ovLow) * 100) / 100;
  }

  // ── Step 4: ATR percentile (VIX proxy) ──────────────────────────────────────
  // Need at least 80 bars (20 ATR period + 60 baseline) for a meaningful percentile
  const atrBars = await dal.getDailyBars(symbol, 90);
  const atrBarsAsc = [...atrBars].reverse();
  const atrStats = computeAtrStats(atrBarsAsc);
  const vixBucket = atrStats.bucket;
  const vixProxyAtrPercentile =
    atrStats.percentile != null ? Math.round(atrStats.percentile * 10) / 10 : null;

  // ── Step 5: Economic calendar (skipDecisions) ────────────────────────────────
  const skipRows = await dal.getSkipDecisionsForDate(sessionDate);
  const economicCalendarClear = skipRows.length === 0;
  const blackoutWindows: BlackoutWindow[] = skipRows.map((row) => {
    // skipDecisions.decisionDate is the event time; we approximate a 1h blackout window
    const eventTime = row.decisionDate instanceof Date ? row.decisionDate : new Date(row.decisionDate);
    const endTime = new Date(eventTime.getTime() + 60 * 60 * 1000);
    return {
      event_type: row.decision,
      start_utc: eventTime.toISOString(),
      end_utc: endTime.toISOString(),
      severity: Array.isArray(row.triggeredSignals) && row.triggeredSignals.length > 0
        ? row.triggeredSignals[0]!
        : "medium",
    };
  });

  // ── Steps 6+7: Opening gap + VWAP anchor (from first RTH 5m bar) ─────────────
  let openingGapPct: number | null = null;
  let vwapAnchor: number | null = null;
  const firstRthBar = await dal.getFirstRthBar(symbol, sessionDate);
  if (firstRthBar && prevDayClose != null && prevDayClose !== 0) {
    vwapAnchor = firstRthBar.open;
    openingGapPct = Math.round(((firstRthBar.open - prevDayClose) / prevDayClose) * 100 * 1000) / 1000;
  } else if (firstRthBar) {
    vwapAnchor = firstRthBar.open;
  }

  // ── Step 8: HTF bias ─────────────────────────────────────────────────────────
  const htfBias = await dal.getHtfBias(symbol, sessionDate, correlationId);

  // ── Step 9: Written bias ──────────────────────────────────────────────────────
  const writtenBias = composeWrittenBias(htfBias, pdh, pdl);

  // ── Step 10: UPSERT ──────────────────────────────────────────────────────────
  const input: UpsertPreMarketInput = {
    sessionDate,
    symbol,
    overnightRangePoints,
    vixBucket: vixBucket ?? null,
    vixProxyAtrPercentile,
    economicCalendarClear,
    blackoutWindows: blackoutWindows.length > 0 ? blackoutWindows : null,
    openingGapPct,
    vwapAnchor,
    pdh,
    pdl,
    pwh,
    pwl,
    htfBias,
    writtenBias,
  };

  const rowId = await dal.upsertPreMarketSession(input);
  const computedAt = new Date().toISOString();

  // Collect which fields were actually populated (not null)
  const fieldsPopulated = (Object.keys(input) as Array<keyof UpsertPreMarketInput>).filter(
    (k) => k !== "sessionDate" && k !== "symbol" && input[k] != null,
  );

  // Audit emission
  await insertAuditRow({
    action: "pre_market_routine.completed",
    entityId: null,
    entityType: "pre_market_session",
    result: {
      session_date: sessionDate,
      symbol,
      fields_populated: fieldsPopulated,
      fields_populated_count: fieldsPopulated.length,
      computed_at: computedAt,
      row_id: rowId,
    },
    status: "success",
    decisionAuthority: "scheduler",
    correlationId,
  });

  logger.info(
    { symbol, sessionDate, correlationId, rowId, fieldsPopulatedCount: fieldsPopulated.length },
    "pre-market-routine: completed",
  );

  return { sessionDate, symbol, rowId, fieldsPopulated, computedAt };
}
