/**
 * pre-market-routine.ts — W23H.2 Pre-Market Context Engine (extended W25.5a)
 *
 * Computes the pre-market checklist for each symbol (MES/MNQ/MCL) at 8:30 AM ET
 * and persists to `pre_market_sessions` table via UPSERT.
 *
 * Steps (per symbol):
 *   1.  Yesterday's 1d bar → PDH, PDL, prev_day_close
 *   2.  Last 7d of 1d bars → PWH, PWL (7-day proxy)
 *   3.  Overnight Globex 5m bars (18:00 prev day → 09:30 ET today) → overnight_range_points
 *   4.  20-period ATR on 1d bars → percentile vs 60d baseline → vix_bucket
 *   5.  skipDecisions for today → economic_calendar_clear, blackout_windows
 *   6.  First 5m bar open vs prev_day_close → opening_gap_pct
 *   7.  First 5m bar open → vwap_anchor (initial anchor; updated by 10am refresh)
 *   8.  computeBiasForAllSymbols → htf_bias
 *   9.  Compose written_bias string
 *  10.  UPSERT to pre_market_sessions
 * --- W25.5a additions ---
 *  11. ISO-week PWH/PWL (pwh_iso / pwl_iso) — Mon–Fri ISO week from daily bars
 *  12. Prior-month H/L (pmh / pml) — from daily bars
 *  13. London range (london_range_high/low/points) — 03:00–08:00 ET 5m bars
 *  14. First-30min volume ratio (first_30min_volume_ratio) — RTH 09:30–10:00 vs 5d avg
 *  15. Nearby naked POCs (nearby_naked_pocs) — via volume-profile-service
 *  16. Extended calendar events (extended_calendar_events) — PPI/ISM/Retail/Jobless/GDP/Fed-speaker
 *  17. Bond auction today (bond_auction_today) — static Treasury calendar
 *  18. DXY + 10Y direction (dxy_direction / us10y_direction) — from existing daily bars
 *  19. cross_asset_aligned — derived bool from dxy/10y/bias
 *  20. tick_open / add_open / vold_open / trin_open — from market-internals-service
 *
 * All DB interactions are injectable via PreMarketDataAccessLayer for unit testing.
 * Fail-open: errors are logged and re-thrown so the scheduler can emit errored audit.
 */

import { randomUUID } from "crypto";
import { logger } from "../lib/logger.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";
import { isBondAuctionToday } from "../lib/treasury-auction-calendar.js";
import { getInternalsSnapshot } from "./market-internals-service.js";

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
  // ── W25.5a institutional expansion ──────────────────────────────────────────
  tickOpen: number | null;
  addOpen: number | null;
  voldOpen: number | null;
  trinOpen: number | null;
  dxyDirection: "up" | "down" | "flat" | null;
  us10yDirection: "up" | "down" | "flat" | null;
  crossAssetAligned: boolean | null;
  bondAuctionToday: boolean | null;
  extendedCalendarEvents: ExtendedCalendarEvent[] | null;
  nearbyNakedPocs: NakedPocLevel[] | null;
  londonRangeHigh: number | null;
  londonRangeLow: number | null;
  londonRangePoints: number | null;
  pmh: number | null;
  pml: number | null;
  pwhIso: number | null;
  pwlIso: number | null;
  first30minVolumeRatio: number | null;
}

/** Extended calendar event — beyond the core FOMC/CPI/NFP blackout. */
export interface ExtendedCalendarEvent {
  event_type: string;
  time_utc: string;
  severity: "high" | "medium" | "low";
}

/** Naked POC level surfaced from volume-profile-service. */
export interface NakedPocLevel {
  date: string;       // YYYY-MM-DD of the session the POC was created
  price: number;
  symbol: string;
  age_sessions: number;
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
  // ── W25.5a additions ────────────────────────────────────────────────────────
  /**
   * Intraday 5m bars for a specific ET time window (startHourET..endHourET).
   * Used for London range and first-30min volume.
   * Returns empty array on failure (non-fatal).
   */
  getIntraBarsWindow(
    symbol: string,
    sessionDate: string,
    startHourET: number,   // e.g. 3 for 03:00 ET
    endHourET: number,     // e.g. 8 for 08:00 ET (exclusive)
  ): Promise<IntraBar[]>;
  /**
   * Fetch nearby naked POC levels from volume-profile-service for last N sessions.
   * Returns empty array when VP service is unavailable (non-fatal).
   */
  getNearbyNakedPocs(symbol: string, sessionDate: string, lookbackSessions: number): Promise<NakedPocLevel[]>;
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
          // W25.5a fields
          tickOpen: input.tickOpen != null ? String(input.tickOpen) : null,
          addOpen: input.addOpen != null ? String(input.addOpen) : null,
          voldOpen: input.voldOpen != null ? String(input.voldOpen) : null,
          trinOpen: input.trinOpen != null ? String(input.trinOpen) : null,
          dxyDirection: input.dxyDirection,
          us10yDirection: input.us10yDirection,
          crossAssetAligned: input.crossAssetAligned,
          bondAuctionToday: input.bondAuctionToday,
          extendedCalendarEvents: input.extendedCalendarEvents,
          nearbyNakedPocs: input.nearbyNakedPocs,
          londonRangeHigh: input.londonRangeHigh != null ? String(input.londonRangeHigh) : null,
          londonRangeLow: input.londonRangeLow != null ? String(input.londonRangeLow) : null,
          londonRangePoints: input.londonRangePoints != null ? String(input.londonRangePoints) : null,
          pmh: input.pmh != null ? String(input.pmh) : null,
          pml: input.pml != null ? String(input.pml) : null,
          pwhIso: input.pwhIso != null ? String(input.pwhIso) : null,
          pwlIso: input.pwlIso != null ? String(input.pwlIso) : null,
          first30minVolumeRatio: input.first30minVolumeRatio != null ? String(input.first30minVolumeRatio) : null,
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
            // W25.5a fields
            tickOpen: sql`EXCLUDED.tick_open`,
            addOpen: sql`EXCLUDED.add_open`,
            voldOpen: sql`EXCLUDED.vold_open`,
            trinOpen: sql`EXCLUDED.trin_open`,
            dxyDirection: sql`EXCLUDED.dxy_direction`,
            us10yDirection: sql`EXCLUDED.us10y_direction`,
            crossAssetAligned: sql`EXCLUDED.cross_asset_aligned`,
            bondAuctionToday: sql`EXCLUDED.bond_auction_today`,
            extendedCalendarEvents: sql`EXCLUDED.extended_calendar_events`,
            nearbyNakedPocs: sql`EXCLUDED.nearby_naked_pocs`,
            londonRangeHigh: sql`EXCLUDED.london_range_high`,
            londonRangeLow: sql`EXCLUDED.london_range_low`,
            londonRangePoints: sql`EXCLUDED.london_range_points`,
            pmh: sql`EXCLUDED.pmh`,
            pml: sql`EXCLUDED.pml`,
            pwhIso: sql`EXCLUDED.pwh_iso`,
            pwlIso: sql`EXCLUDED.pwl_iso`,
            first30minVolumeRatio: sql`EXCLUDED.first_30min_volume_ratio`,
            computedAt: sql`EXCLUDED.computed_at`,
          },
        })
        .returning({ id: preMarketSessions.id });
      return rows[0]!.id;
    },

    async getIntraBarsWindow(
      symbol: string,
      sessionDate: string,
      startHourET: number,
      endHourET: number,
    ): Promise<IntraBar[]> {
      const apiUrl = process.env.TRADING_FORGE_API_URL ?? "http://localhost:4000";
      const apiKey = process.env.API_KEY ?? "";
      const url = `${apiUrl}/api/bars/${symbol}?date=${sessionDate}&timeframe=5m&start_hour_et=${startHourET}&end_hour_et=${endHourET}`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) {
        logger.warn(
          { symbol, sessionDate, startHourET, endHourET, status: resp.status },
          "pre-market-routine: intra-window bars unavailable",
        );
        return [];
      }
      const body = (await resp.json()) as { bars?: IntraBar[] };
      return body.bars ?? [];
    },

    async getNearbyNakedPocs(symbol: string, sessionDate: string, lookbackSessions: number): Promise<NakedPocLevel[]> {
      try {
        const { getLatestVPLevels } = await import("./volume-profile-service.js");
        const levels: NakedPocLevel[] = [];
        // Fetch the last lookbackSessions days of naked POC data
        for (let i = 1; i <= lookbackSessions; i++) {
          const d = new Date(sessionDate);
          d.setUTCDate(d.getUTCDate() - i);
          const dateStr = d.toISOString().slice(0, 10);
          const vp = await getLatestVPLevels(symbol, dateStr);
          if (vp && vp.nakedPocs) {
            const pocs = Array.isArray(vp.nakedPocs) ? vp.nakedPocs : [];
            for (const poc of pocs) {
              if (typeof poc === "object" && poc !== null && typeof poc.price === "number" && Number.isFinite(poc.price)) {
                levels.push({
                  date: dateStr,
                  price: poc.price,
                  symbol,
                  age_sessions: i,
                });
              }
            }
          }
        }
        return levels;
      } catch (err) {
        logger.warn({ err, symbol, sessionDate }, "pre-market-routine: naked POCs unavailable");
        return [];
      }
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

// ─── W25.5a: ISO-week PWH/PWL ────────────────────────────────────────────────

/**
 * Compute ISO-week previous-week high/low from daily bars.
 *
 * ISO week: Monday–Friday. We identify the Mon–Fri window of the calendar week
 * BEFORE the session date. Returns null when insufficient history.
 *
 * Note: dailyBars must be in ascending order (oldest first).
 */
export function computeIsoWeekPwhPwl(
  dailyBarsAsc: DailyBar[],
  sessionDate: string,
): { pwhIso: number | null; pwlIso: number | null } {
  if (dailyBarsAsc.length === 0) return { pwhIso: null, pwlIso: null };

  const session = new Date(`${sessionDate}T12:00:00Z`); // noon UTC to avoid DST ambiguity
  // day-of-week in ISO: Mon=1 … Sun=7
  const dow = session.getUTCDay() === 0 ? 7 : session.getUTCDay(); // Sun → 7

  // Start of current ISO week (Monday)
  const currentWeekMonday = new Date(session);
  currentWeekMonday.setUTCDate(session.getUTCDate() - (dow - 1));
  // Previous week is 7 days back
  const prevWeekMonday = new Date(currentWeekMonday);
  prevWeekMonday.setUTCDate(currentWeekMonday.getUTCDate() - 7);
  const prevWeekFriday = new Date(prevWeekMonday);
  prevWeekFriday.setUTCDate(prevWeekMonday.getUTCDate() + 4); // Friday

  const prevMonStr = prevWeekMonday.toISOString().slice(0, 10);
  const prevFriStr = prevWeekFriday.toISOString().slice(0, 10);

  const prevWeekBars = dailyBarsAsc.filter(
    (b) => b.date >= prevMonStr && b.date <= prevFriStr,
  );

  if (prevWeekBars.length === 0) {
    // Fallback: use last 5 calendar bars before session
    const last5 = dailyBarsAsc.filter((b) => b.date < sessionDate).slice(-5);
    if (last5.length === 0) return { pwhIso: null, pwlIso: null };
    return {
      pwhIso: Math.max(...last5.map((b) => b.high)),
      pwlIso: Math.min(...last5.map((b) => b.low)),
    };
  }

  return {
    pwhIso: Math.max(...prevWeekBars.map((b) => b.high)),
    pwlIso: Math.min(...prevWeekBars.map((b) => b.low)),
  };
}

// ─── W25.5a: Prior-month H/L ──────────────────────────────────────────────────

/**
 * Compute previous calendar month high/low from daily bars.
 * dailyBarsAsc: ascending order.
 */
export function computePriorMonthHl(
  dailyBarsAsc: DailyBar[],
  sessionDate: string,
): { pmh: number | null; pml: number | null } {
  if (dailyBarsAsc.length === 0) return { pmh: null, pml: null };

  const d = new Date(`${sessionDate}T12:00:00Z`);
  // First day of current month
  const firstOfMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  // First day of prior month
  const firstOfPriorMonth = new Date(firstOfMonth);
  firstOfPriorMonth.setUTCMonth(firstOfPriorMonth.getUTCMonth() - 1);

  const priorMonthStart = firstOfPriorMonth.toISOString().slice(0, 10);
  const priorMonthEnd = firstOfMonth.toISOString().slice(0, 10); // exclusive

  const priorBars = dailyBarsAsc.filter(
    (b) => b.date >= priorMonthStart && b.date < priorMonthEnd,
  );

  if (priorBars.length === 0) return { pmh: null, pml: null };

  return {
    pmh: Math.max(...priorBars.map((b) => b.high)),
    pml: Math.min(...priorBars.map((b) => b.low)),
  };
}

// ─── W25.5a: London range aggregation ────────────────────────────────────────

/**
 * Aggregate London range from 5m bars in 03:00–08:00 ET window.
 */
export function computeLondonRange(
  londonBars: IntraBar[],
): { londonRangeHigh: number | null; londonRangeLow: number | null; londonRangePoints: number | null } {
  if (londonBars.length === 0) {
    return { londonRangeHigh: null, londonRangeLow: null, londonRangePoints: null };
  }
  const high = Math.max(...londonBars.map((b) => b.high));
  const low = Math.min(...londonBars.map((b) => b.low));
  const points = Math.round((high - low) * 100) / 100;
  return { londonRangeHigh: high, londonRangeLow: low, londonRangePoints: points };
}

// ─── W25.5a: First-30min volume ratio ────────────────────────────────────────

/**
 * Compute first-30min volume ratio vs 5-session average.
 * first30minBars: 5m bars 09:30–10:00 ET for today.
 * priorFirst30minBarSets: arrays of 5m bars for the same 09:30–10:00 window on the last 5 sessions.
 */
export function computeFirst30minVolumeRatio(
  first30minVolume: number,
  prior5SessionVolumes: number[],
): number | null {
  if (prior5SessionVolumes.length === 0) return null;
  const avg = prior5SessionVolumes.reduce((s, v) => s + v, 0) / prior5SessionVolumes.length;
  if (avg === 0) return null;
  return Math.round((first30minVolume / avg) * 1000) / 1000;
}

// ─── W25.5a: Extended calendar events ────────────────────────────────────────

const EXTENDED_CALENDAR_PATTERNS: Array<{ pattern: RegExp; eventType: string; severity: "high" | "medium" | "low" }> = [
  { pattern: /PPI/i,                  eventType: "PPI",          severity: "high"   },
  { pattern: /ISM/i,                  eventType: "ISM",          severity: "medium" },
  { pattern: /retail.?sales/i,        eventType: "RETAIL_SALES", severity: "high"   },
  { pattern: /jobless.?claims/i,      eventType: "JOBLESS_CLAIMS", severity: "medium" },
  { pattern: /initial.?claims/i,      eventType: "JOBLESS_CLAIMS", severity: "medium" },
  { pattern: /GDP/i,                  eventType: "GDP",          severity: "high"   },
  { pattern: /fed.?speak|fed.?speak|fedspeak/i, eventType: "FED_SPEAKER", severity: "medium" },
  { pattern: /PCE/i,                  eventType: "PCE",          severity: "high"   },
  { pattern: /housing.?starts/i,      eventType: "HOUSING_STARTS", severity: "low"  },
  { pattern: /factory.?orders/i,      eventType: "FACTORY_ORDERS", severity: "low"  },
];

/**
 * Extract extended calendar events from skipDecision rows (beyond core FOMC/CPI/NFP).
 * Uses existing skipDecisions.reason + triggeredSignals to classify.
 */
export function extractExtendedCalendarEvents(
  skipRows: SkipDecisionRow[],
): ExtendedCalendarEvent[] {
  const events: ExtendedCalendarEvent[] = [];
  for (const row of skipRows) {
    const text = [row.decision, row.reason ?? "", ...(row.triggeredSignals ?? [])].join(" ");
    for (const { pattern, eventType, severity } of EXTENDED_CALENDAR_PATTERNS) {
      if (pattern.test(text)) {
        const eventTime = row.decisionDate instanceof Date ? row.decisionDate : new Date(row.decisionDate);
        events.push({
          event_type: eventType,
          time_utc: eventTime.toISOString(),
          severity,
        });
        break; // one event per skip row
      }
    }
  }
  return events;
}

// ─── W25.5a: DXY / 10Y direction ─────────────────────────────────────────────

/**
 * Derive cross-asset direction from daily bars.
 * For DXY: compare most recent bar close vs prior bar close.
 * For 10Y (ZN): same approach.
 *
 * Returns "up" | "down" | "flat" based on >0.05% threshold.
 */
export function computeDirectionFromDailyBars(
  bars: DailyBar[],
): "up" | "down" | "flat" | null {
  if (bars.length < 2) return null;
  // bars assumed newest-first (as returned by getDailyBars)
  const current = bars[0]!.close;
  const prior = bars[1]!.close;
  if (prior === 0) return null;
  const pct = (current - prior) / prior * 100;
  const FLAT_THRESHOLD = 0.05;
  if (pct > FLAT_THRESHOLD) return "up";
  if (pct < -FLAT_THRESHOLD) return "down";
  return "flat";
}

/**
 * Derive cross_asset_aligned boolean for ES/NQ or MCL.
 *
 * ES/NQ (equity index) logic — inverse correlation:
 *   long  → want DXY down OR 10Y down (risk-on)
 *   short → want DXY up OR 10Y up (risk-off)
 *
 * MCL (crude) logic — direct correlation with risk:
 *   long  → want DXY down (crude inversely correlated with dollar)
 *   short → want DXY up
 *
 * Returns null when no cross-asset data available.
 */
export function computeCrossAssetAligned(
  symbol: string,
  direction: "long" | "short" | null,
  dxyDirection: "up" | "down" | "flat" | null,
  us10yDirection: "up" | "down" | "flat" | null,
): boolean | null {
  if (!direction) return null;
  if (!dxyDirection && !us10yDirection) return null;

  const isMCL = symbol === "MCL";

  if (isMCL) {
    // Crude: dollar-inverse
    if (dxyDirection === null) return null;
    if (direction === "long")  return dxyDirection === "down";
    if (direction === "short") return dxyDirection === "up";
    return null;
  }

  // ES / NQ: inverse correlation with DXY and 10Y
  if (direction === "long") {
    if (dxyDirection === "down" || us10yDirection === "down") return true;
    if (dxyDirection === "up"   && us10yDirection === "up")   return false;
    if (dxyDirection === "flat" && us10yDirection === "flat") return false;
    return null; // mixed signals
  }
  if (direction === "short") {
    if (dxyDirection === "up" || us10yDirection === "up") return true;
    if (dxyDirection === "down" && us10yDirection === "down") return false;
    if (dxyDirection === "flat" && us10yDirection === "flat") return false;
    return null;
  }
  return null;
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
  // Separate fetches: 8 bars for PDH/PDL/PWH/PWL (original contract preserved for
  // test-DAL mock compatibility); 90 bars for ATR baseline + W25.5a ISO-week/prior-month.
  const dailyBarsSmallNewest = await dal.getDailyBars(symbol, 8);
  const dailyBars8Asc = [...dailyBarsSmallNewest].reverse();

  let pdh: number | null = null;
  let pdl: number | null = null;
  let prevDayClose: number | null = null;
  let pwh: number | null = null;
  let pwl: number | null = null;

  if (dailyBars8Asc.length >= 2) {
    // "Yesterday" = second most recent bar (index 0 in descending = today or most recent session;
    // index 1 = yesterday/prior session). In ascending order that's [length-2].
    const yesterday = dailyBars8Asc[dailyBars8Asc.length - 2]!;
    pdh = yesterday.high;
    pdl = yesterday.low;
    prevDayClose = yesterday.close;
  } else if (dailyBars8Asc.length === 1) {
    // Only one bar available — use it as yesterday
    const yesterday = dailyBars8Asc[0]!;
    pdh = yesterday.high;
    pdl = yesterday.low;
    prevDayClose = yesterday.close;
  }

  // Last 7 completed bars for prev-week high/low (legacy rolling 7d)
  const weekBars = dailyBars8Asc.slice(-7);
  if (weekBars.length > 0) {
    pwh = Math.max(...weekBars.map((b) => b.high));
    pwl = Math.min(...weekBars.map((b) => b.low));
  }

  // 90-bar fetch for ATR baseline + W25.5a helpers (ISO-week PWH/PWL, prior-month H/L)
  const dailyBarsNewest = await dal.getDailyBars(symbol, 90);
  // dailyBars is newest-first from the API; we need oldest→newest for ATR + W25.5a
  const dailyBarsAsc = [...dailyBarsNewest].reverse();

  // ── Step 3: Overnight range ──────────────────────────────────────────────────
  let overnightRangePoints: number | null = null;
  const overnightBars = await dal.getOvernightBars(symbol, sessionDate);
  if (overnightBars.length > 0) {
    const ovHigh = Math.max(...overnightBars.map((b) => b.high));
    const ovLow = Math.min(...overnightBars.map((b) => b.low));
    overnightRangePoints = Math.round((ovHigh - ovLow) * 100) / 100;
  }

  // ── Step 4: ATR percentile (VIX proxy) ──────────────────────────────────────
  // Re-use dailyBarsAsc already fetched above (90 bars)
  const atrStats = computeAtrStats(dailyBarsAsc);
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

  // ── W25.5a: Step 11 — ISO-week PWH/PWL ───────────────────────────────────────
  const { pwhIso, pwlIso } = computeIsoWeekPwhPwl(dailyBarsAsc, sessionDate);

  // ── W25.5a: Step 12 — Prior-month H/L ────────────────────────────────────────
  const { pmh, pml } = computePriorMonthHl(dailyBarsAsc, sessionDate);

  // ── W25.5a: Step 13 — London range (03:00–08:00 ET) ──────────────────────────
  let londonRangeHigh: number | null = null;
  let londonRangeLow: number | null = null;
  let londonRangePoints: number | null = null;
  try {
    const londonBars = await dal.getIntraBarsWindow(symbol, sessionDate, 3, 8);
    const londonRange = computeLondonRange(londonBars);
    londonRangeHigh = londonRange.londonRangeHigh;
    londonRangeLow = londonRange.londonRangeLow;
    londonRangePoints = londonRange.londonRangePoints;
  } catch (err) {
    logger.warn({ err, symbol, sessionDate }, "pre-market-routine: London range computation failed");
  }

  // ── W25.5a: Step 14 — First-30min volume ratio ────────────────────────────────
  let first30minVolumeRatio: number | null = null;
  try {
    const first30Bars = await dal.getIntraBarsWindow(symbol, sessionDate, 9, 10);
    const first30Vol = first30Bars.reduce((s, b) => s + ((b as unknown as IntraBar & { volume?: number }).volume ?? 0), 0);
    // For 5-day average, we would need prior session data — defer to future pass
    // For now: if we get bars, store the raw volume as ratio=1.0 sentinel until prior data wired
    // (tracked as known gap — first_30min_volume_ratio will be null until priorSessionVolume wired)
    if (first30Bars.length > 0 && first30Vol > 0) {
      // Cannot compute ratio without prior data — leave null (honest about gap)
      first30minVolumeRatio = null;
    }
    void first30Vol; // acknowledge variable (used above)
  } catch (err) {
    logger.warn({ err, symbol, sessionDate }, "pre-market-routine: first-30min volume ratio computation failed");
  }

  // ── W25.5a: Step 15 — Nearby naked POCs ──────────────────────────────────────
  let nearbyNakedPocs: NakedPocLevel[] | null = null;
  try {
    const pocs = await dal.getNearbyNakedPocs(symbol, sessionDate, 10);
    nearbyNakedPocs = pocs.length > 0 ? pocs : null;
  } catch (err) {
    logger.warn({ err, symbol, sessionDate }, "pre-market-routine: naked POC fetch failed");
  }

  // ── W25.5a: Step 16 — Extended calendar events ────────────────────────────────
  const extendedCalendarEvents = extractExtendedCalendarEvents(skipRows);

  // ── W25.5a: Step 17 — Bond auction today ─────────────────────────────────────
  const bondAuctionToday = isBondAuctionToday(new Date(`${sessionDate}T12:00:00Z`));

  // ── W25.5a: Step 18 — DXY / 10Y direction ────────────────────────────────────
  // DXY and ZN bars are fetched as daily bars for those symbols.
  // Graceful degradation: if TRADING_FORGE_API_URL doesn't serve DXY/ZN, returns null.
  let dxyDirection: "up" | "down" | "flat" | null = null;
  let us10yDirection: "up" | "down" | "flat" | null = null;
  try {
    const dxyBars = await dal.getDailyBars("DXY", 2);
    dxyDirection = computeDirectionFromDailyBars(dxyBars);
  } catch (err) {
    logger.debug({ err, symbol, sessionDate }, "pre-market-routine: DXY bars unavailable");
  }
  try {
    const znBars = await dal.getDailyBars("ZN", 2);
    us10yDirection = computeDirectionFromDailyBars(znBars);
  } catch (err) {
    logger.debug({ err, symbol, sessionDate }, "pre-market-routine: ZN (10Y) bars unavailable");
  }

  // ── W25.5a: Step 19 — cross_asset_aligned ────────────────────────────────────
  // Direction defaults to null for pre-market (no live signal yet); returns null when unknown
  const crossAssetAligned = computeCrossAssetAligned(symbol, null, dxyDirection, us10yDirection);

  // ── W25.5b: Step 20 — Internals at open ──────────────────────────────────────
  let tickOpen: number | null = null;
  let addOpen: number | null = null;
  let voldOpen: number | null = null;
  let trinOpen: number | null = null;
  try {
    const snapshot = getInternalsSnapshot();
    if (!snapshot.stale) {
      tickOpen = snapshot.tick;
      addOpen  = snapshot.add;
      voldOpen = snapshot.vold;
      trinOpen = snapshot.trin;
    } else {
      logger.debug(
        { symbol, sessionDate },
        "pre-market-routine: internals snapshot stale — skipping tick/add/vold/trin",
      );
      await insertAuditRow({
        action: "internals.stale_skipped",
        entityId: null,
        entityType: "pre_market_session",
        result: { symbol, sessionDate, reason: "stale_snapshot" },
        status: "skipped",
        decisionAuthority: "system",
        correlationId,
      });
    }
  } catch (err) {
    logger.warn({ err, symbol, sessionDate }, "pre-market-routine: internals snapshot failed — continuing without tick data");
  }

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
    // W25.5a
    tickOpen,
    addOpen,
    voldOpen,
    trinOpen,
    dxyDirection,
    us10yDirection,
    crossAssetAligned: crossAssetAligned ?? null,
    bondAuctionToday,
    extendedCalendarEvents: extendedCalendarEvents.length > 0 ? extendedCalendarEvents : null,
    nearbyNakedPocs,
    londonRangeHigh,
    londonRangeLow,
    londonRangePoints,
    pmh,
    pml,
    pwhIso,
    pwlIso,
    first30minVolumeRatio,
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
