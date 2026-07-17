/**
 * timeframe-bar-aggregator.ts — Campaign M1c (2026-07-17, "$250-1K/day Readiness")
 *
 * PURPOSE: live paper trading previously evaluated every strategy on raw
 * Massive/Polygon 1-minute bars regardless of its configured timeframe
 * (5m/15m/30m/1h/4h) — a >4x lookback-unit distortion vs the backtest, which
 * loads genuinely timeframe-native pre-aggregated bars via `load_ohlcv()`
 * (see docs/ratify-packets/m1b-multi-tf-aggregation-parity-2026-07-17.md).
 * This module buckets the raw 1-minute stream into the strategy's real
 * timeframe so entry-signal/indicator evaluation sees what the backtest saw.
 *
 * ANCHOR CONVENTION (the load-bearing design decision — verified empirically
 * 2026-07-17, NOT assumed): buckets are plain UTC-epoch-truncated windows —
 * `bucketStart = floor(ts_ms / (N_minutes*60000)) * (N_minutes*60000)` — the
 * same convention the backtest's ETL (`src/data/scripts/refresh_local_cache.py
 * ::resample_1m_to_tf`, intraday branch) produces via Polars `group_by_dynamic`
 * with no origin override. Confirmed three ways: (1) that ETL's own source,
 * (2) `load_ohlcv` does no resampling of its own (trusts the file as-is), and
 * (3) real ES 4-hour consolidated bars land on UTC 00/04/08/12/16/20 — pure
 * epoch-truncation, NOT Globex-session-open (18:00 ET) or RTH-open (09:30 ET)
 * anchored, which would land on different UTC boundaries. A wrongly-anchored
 * aggregator would have shipped a *subtler* divergence than the 1-minute bug
 * it replaces — this anchor is proven against real production data in
 * `timeframe-bar-aggregator.realdata-parity.test.ts`, not merely unit-tested.
 *
 * SCOPE (deliberately narrow — see the M1c wave notes / advisor consult for
 * the full rationale): this module ONLY buckets bars for indicator computation
 * and entry-signal-firing cadence. It does NOT touch — and must never gate —
 * mark-to-market equity updates, the 15:55 ET hard flatten, or stop/TP/trail
 * intrabar touch-detection, all of which stay on every raw 1-minute bar
 * exactly as before this wave. Those are wall-clock/account-risk controls (or,
 * for touch-detection, a deliberately-kept finer-grained residual — raw-bar
 * checking can produce a genuinely different intrabar-path outcome than the
 * backtest's single-aggregated-bar tie-break when a window touches two levels,
 * which is a real two-way tradeoff, not a strict improvement — either way,
 * throttling it to bucket-close would risk delaying a real capital-risk
 * control, which is worse than the parity gap it would "fix"). See
 * `paper-trading-stream.ts::processSessionBar` for exactly what stays
 * unthrottled and why.
 *
 * NEVER emits a partial/in-progress bucket — `feedBar()` only returns
 * `isBucketClose: true` (with the just-completed bar folded into
 * `aggregatedBuffer`) on the raw bar that starts the NEXT bucket. The
 * in-progress bucket's own data is never exposed to a caller.
 */

/**
 * Minimal OHLCV shape accepted as raw input to feedBar() — deliberately has
 * NO `symbol` field. `feedBar` already takes `symbol` as an explicit param
 * (it's how the aggregator keys its per-symbol-per-timeframe state), so
 * requiring it again on every input bar would be redundant and invite a
 * caller passing a bar whose own `.symbol` disagrees with the `symbol` arg.
 */
export interface OhlcvBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Shape of a COMPLETED aggregated bar, as emitted in `aggregatedBuffer`.
 * Carries `symbol` so this is structurally assignable to paper-trading-
 * stream.ts's `Bar` type (which callers like `computeIndicators()` expect)
 * without this module importing that type and creating a cross-layer
 * dependency (lib/ must not depend on services/ — see feed-gap-classifier.ts
 * for the same precedent).
 */
export interface AggregatorBar extends OhlcvBar {
  symbol: string;
}

interface BucketAccumulator {
  bucketStartMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface AggregatorKeyState {
  current: BucketAccumulator | null;
  /** Rolling window of completed N-minute bars, oldest first. */
  completed: AggregatorBar[];
}

const MAX_COMPLETED_BARS = 200;

/** key = `${symbol}:${timeframe}` */
const state = new Map<string, AggregatorKeyState>();

/**
 * Parse a timeframe string ("1m"/"5m"/"15m"/"30m"/"1h"/"4h") into minutes.
 * Returns null for anything unparseable — callers must fail-soft (treat as
 * unaggregatable / pass-through), never fabricate a default period.
 */
export function parseTimeframeMinutes(timeframe: string): number | null {
  const match = timeframe.trim().toLowerCase().match(/^(\d+)(m|h)$/);
  if (!match) return null;
  const [, numStr, unit] = match;
  const num = parseInt(numStr, 10);
  if (!Number.isFinite(num) || num <= 0) return null;
  return unit === "h" ? num * 60 : num;
}

/**
 * The anchor convention itself (see module docstring). Plain epoch-ms
 * truncation — no session/RTH-open offset. Verified against real consolidated
 * parquet data (ES 4-hour bars land on UTC 00/04/08/12/16/20, and a direct
 * bucket-by-bucket replay of real 1-minute bars into 5-minute buckets using
 * exactly this formula reproduced the real 5-minute consolidated bars
 * bit-for-bit — see the realdata-parity test).
 */
export function bucketStartMs(timestampMs: number, timeframeMinutes: number): number {
  const bucketMs = timeframeMinutes * 60_000;
  return Math.floor(timestampMs / bucketMs) * bucketMs;
}

function keyFor(symbol: string, timeframe: string): string {
  return `${symbol}:${timeframe}`;
}

function toAggregatorBar(acc: BucketAccumulator, symbol: string): AggregatorBar {
  return {
    symbol,
    timestamp: new Date(acc.bucketStartMs).toISOString(),
    open: acc.open,
    high: acc.high,
    low: acc.low,
    close: acc.close,
    volume: acc.volume,
  };
}

export interface FeedBarResult {
  /**
   * True only on the raw bar that STARTS a new bucket — meaning the PREVIOUS
   * bucket has just fully closed and `aggregatedBuffer` now includes it.
   * False on every raw bar that merely extends the still-forming bucket, and
   * on the very first raw bar ever seen for this key (bootstrap — no prior
   * bucket to close).
   */
  isBucketClose: boolean;
  /**
   * Rolling window of COMPLETED N-minute bars only — never includes the
   * in-progress bucket. Empty until the first bucket closes (bootstrap).
   */
  aggregatedBuffer: AggregatorBar[];
}

/**
 * Feed one raw 1-minute bar into the aggregator for (symbol, timeframe).
 *
 * `timeframeMinutes` must come from `parseTimeframeMinutes()` — pass the
 * parsed value, not the raw string, so callers make the fail-soft decision
 * explicitly rather than this module silently defaulting an unparseable
 * timeframe to some period.
 *
 * Out-of-order bars (a raw bar whose bucket is EARLIER than the current
 * in-progress bucket — should never happen on the live WS path, which is
 * strictly ordered, but defensively guarded for any future out-of-order
 * caller such as a backfill race) are ignored: this function returns
 * `isBucketClose: false` and the unchanged `aggregatedBuffer` without
 * mutating state, rather than corrupting the in-progress accumulator.
 */
export function feedBar(
  symbol: string,
  timeframeMinutes: number,
  bar: OhlcvBar,
): FeedBarResult {
  const key = keyFor(symbol, `${timeframeMinutes}m`);
  let entry = state.get(key);
  if (!entry) {
    entry = { current: null, completed: [] };
    state.set(key, entry);
  }

  const barMs = new Date(bar.timestamp).getTime();
  const thisBucketStart = bucketStartMs(barMs, timeframeMinutes);

  if (!entry.current) {
    // Bootstrap: first bar ever seen for this key — start the accumulator,
    // nothing has closed yet.
    entry.current = {
      bucketStartMs: thisBucketStart,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    };
    return { isBucketClose: false, aggregatedBuffer: entry.completed };
  }

  if (thisBucketStart < entry.current.bucketStartMs) {
    // Out-of-order — ignore defensively, do not corrupt the running bucket.
    return { isBucketClose: false, aggregatedBuffer: entry.completed };
  }

  if (thisBucketStart === entry.current.bucketStartMs) {
    // Still within the same bucket — extend it.
    entry.current.high = Math.max(entry.current.high, bar.high);
    entry.current.low = Math.min(entry.current.low, bar.low);
    entry.current.close = bar.close;
    entry.current.volume += bar.volume;
    return { isBucketClose: false, aggregatedBuffer: entry.completed };
  }

  // thisBucketStart > entry.current.bucketStartMs: the prior bucket just closed.
  entry.completed.push(toAggregatorBar(entry.current, symbol));
  if (entry.completed.length > MAX_COMPLETED_BARS) {
    entry.completed.shift();
  }
  entry.current = {
    bucketStartMs: thisBucketStart,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  };
  return { isBucketClose: true, aggregatedBuffer: entry.completed };
}

/**
 * Clear all aggregator state for a symbol (every timeframe key sharing that
 * symbol prefix) — called on the Globex session boundary reset, mirroring
 * the raw `barBuffer`'s own session reset in paper-trading-stream.ts::pushBar
 * so aggregated indicator history doesn't bleed a stale prior session's bars
 * into the new session the same way the raw buffer already guards against.
 */
export function resetAggregatorForSymbol(symbol: string): void {
  const prefix = `${symbol}:`;
  for (const key of state.keys()) {
    if (key.startsWith(prefix)) state.delete(key);
  }
}

/** @internal exported for tests only. */
export function _testResetAllAggregatorState(): void {
  state.clear();
}
/** @internal exported for tests only. */
export function _testGetAggregatorState(symbol: string, timeframeMinutes: number): AggregatorKeyState | undefined {
  return state.get(keyFor(symbol, `${timeframeMinutes}m`));
}
