/**
 * bars-window.ts — pure date/window/shaping helpers backing GET /api/bars/:symbol.
 *
 * Kept dependency-free and side-effect-free (no DB, no fetch, no time.now() defaults
 * baked in) so every branch is deterministically unit-testable. All ET conversions use
 * Intl.DateTimeFormat against the IANA "America/New_York" zone (DST-correct at every
 * call), matching the existing killzone.ts / session-filter.ts convention documented
 * in CLAUDE.md §2b.
 */

const ET_TZ = "America/New_York";

export interface RawBar {
  /** ISO-8601 UTC timestamp, as emitted by data_loader.py's CLI (trailing Z or +offset). */
  ts_event: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface DailyBarOut {
  date: string; // YYYY-MM-DD (UTC calendar date of the daily bar's ts_event)
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface IntraBarOut {
  ts: string; // ISO-8601 UTC
  open: number;
  high: number;
  low: number;
  close: number;
}

/** ET wall-clock hour [0,23] for a UTC ISO timestamp, DST-correct. */
export function etHourOf(isoUtc: string): number {
  const d = new Date(isoUtc);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: ET_TZ, hour: "2-digit", hour12: false });
  const raw = fmt.formatToParts(d).find((p) => p.type === "hour")?.value ?? "0";
  const h = parseInt(raw, 10);
  return h === 24 ? 0 : h; // some locales render midnight as "24"
}

/** ET wall-clock minute [0,59] for a UTC ISO timestamp, DST-correct. */
export function etMinuteOf(isoUtc: string): number {
  const d = new Date(isoUtc);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: ET_TZ, minute: "2-digit" });
  const raw = fmt.formatToParts(d).find((p) => p.type === "minute")?.value ?? "0";
  return parseInt(raw, 10);
}

/** ET calendar date (YYYY-MM-DD) for a UTC ISO timestamp, DST-correct. */
export function etDateOf(isoUtc: string): string {
  const d = new Date(isoUtc);
  // en-CA formats as YYYY-MM-DD directly.
  return new Intl.DateTimeFormat("en-CA", { timeZone: ET_TZ }).format(d);
}

/** True when a UTC timestamp is at or after 09:30 ET wall-clock. */
function isAtOrAfter0930Et(isoUtc: string): boolean {
  const h = etHourOf(isoUtc);
  const m = etMinuteOf(isoUtc);
  return h > 9 || (h === 9 && m >= 30);
}

/**
 * Resolve a [start, end] YYYY-MM-DD date range wide enough to contain at least
 * `limit` DAILY bars (1 per trading day), given weekends + a holiday buffer.
 * `~252` trading days/year → ~1.6 calendar days per trading day; +15 buffer
 * absorbs holidays/short weeks without materially over-fetching.
 */
export function resolveDailyRange(limit: number, endDate?: string): { start: string; end: string } {
  const end = endDate ?? new Date().toISOString().slice(0, 10);
  const endD = new Date(`${end}T12:00:00Z`); // noon UTC — avoids DST-boundary date-shift ambiguity
  const calendarDaysBack = Math.ceil(limit * 1.6) + 15;
  const startD = new Date(endD);
  startD.setUTCDate(startD.getUTCDate() - calendarDaysBack);
  return { start: startD.toISOString().slice(0, 10), end };
}

/**
 * Resolve the [start, end] date range to request from load_ohlcv for an intraday
 * (5m-class) query anchored on `date`. The overnight window (18:00 ET prev day →
 * 09:30 ET `date`) spans two UTC calendar dates around the ET boundary, so the
 * fetch window must start one day earlier; all other intraday queries (hour-window,
 * first-RTH-bar) stay within `date` itself.
 */
export function resolveIntradayRange(params: { date: string; overnight?: boolean }): { start: string; end: string } {
  if (params.overnight) {
    const d = new Date(`${params.date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return { start: d.toISOString().slice(0, 10), end: params.date };
  }
  return { start: params.date, end: params.date };
}

/**
 * Shape raw daily bars into the DailyBar[] contract, newest-first, capped at `limit`.
 * One bar per UTC calendar date (daily-timeframe bars are already one-per-day).
 */
export function shapeDailyBars(raw: RawBar[], limit: number): DailyBarOut[] {
  const mapped: DailyBarOut[] = raw.map((b) => ({
    date: b.ts_event.slice(0, 10),
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    ...(b.volume != null ? { volume: b.volume } : {}),
  }));
  mapped.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest-first
  return mapped.slice(0, limit);
}

/** Shape raw bars into ascending-chronological IntraBar[]. */
export function shapeIntraBars(raw: RawBar[]): IntraBarOut[] {
  return raw
    .slice()
    .sort((a, b) => (a.ts_event < b.ts_event ? -1 : a.ts_event > b.ts_event ? 1 : 0))
    .map((b) => ({ ts: b.ts_event, open: b.open, high: b.high, low: b.low, close: b.close }));
}

/**
 * Filter to the overnight Globex window: 18:00 ET prev-day (inclusive) through
 * 09:30 ET `sessionDate` (exclusive). Deliberately does NOT truncate to a caller
 * `limit` — this window backs a high/low range computation (overnight_range_points),
 * and dropping bars from either end would silently understate the true range. The
 * full window is ~186 5m bars; callers that pass a smaller `limit` as a size hint
 * get the accurate full window instead of a truncated, potentially-wrong one.
 */
export function filterOvernightWindow(raw: RawBar[], sessionDate: string): IntraBarOut[] {
  const bars = shapeIntraBars(raw);
  const prevDayD = new Date(`${sessionDate}T12:00:00Z`);
  prevDayD.setUTCDate(prevDayD.getUTCDate() - 1);
  const prevDay = prevDayD.toISOString().slice(0, 10);
  return bars.filter((b) => {
    const etDate = etDateOf(b.ts);
    if (etDate === sessionDate) return !isAtOrAfter0930Et(b.ts);
    // must be the IMMEDIATE prior ET calendar date, not just any earlier date
    // (a bar from two days back at hour>=18 must not match).
    if (etDate === prevDay) return etHourOf(b.ts) >= 18;
    return false;
  });
}

/**
 * Filter to bars whose ET wall-clock hour falls in [startHourEt, endHourEt) on
 * `date` — used for London range (3–8 ET) and first-30min volume (9–10 ET) style
 * fixed-window aggregations. Ascending chronological order, unbounded by `limit`
 * for the same range-accuracy reason as filterOvernightWindow.
 */
export function filterHourWindow(
  raw: RawBar[],
  date: string,
  startHourEt: number,
  endHourEt: number,
): IntraBarOut[] {
  const bars = shapeIntraBars(raw);
  return bars.filter((b) => {
    if (etDateOf(b.ts) !== date) return false;
    const h = etHourOf(b.ts);
    return h >= startHourEt && h < endHourEt;
  });
}

/** First bar at or after 09:30 ET on `date`, or null if none exists in `raw`. */
export function firstRthBar(raw: RawBar[], date: string): IntraBarOut | null {
  const bars = shapeIntraBars(raw);
  const found = bars.find((b) => etDateOf(b.ts) === date && isAtOrAfter0930Et(b.ts));
  return found ?? null;
}
