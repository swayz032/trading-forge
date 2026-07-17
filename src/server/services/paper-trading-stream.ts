import { randomUUID } from "crypto";
import { createMassiveFetcher } from "../../data/fetchers/massive.js";
import { updatePositionPrices, type StyleExitBarContext } from "./paper-execution-service.js";
import { evaluateSignals, updateStateOnly, ATR, getSessionTimeframe } from "./paper-signal-service.js";
import { CircuitBreakerRegistry } from "../lib/circuit-breaker.js";
import { logger } from "../index.js";
import { toEasternDateString } from "./paper-risk-gate.js";
import { getDevelopingSessionPoc } from "./volume-profile-service.js";
import { initSmtBarBufferProvider } from "./smt-live-service.js";
import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";
import { paperStreamLifecycleTotal, auditWriteFailuresTotal } from "../lib/metrics-registry.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";
import { broadcastSSE } from "../routes/sse.js";
import { classifyFeedGap } from "../lib/feed-gap-classifier.js";
import { feedBar as feedTimeframeAggregator, parseTimeframeMinutes, resetAggregatorForSymbol } from "../lib/timeframe-bar-aggregator.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Bar {
  symbol: string;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface StreamInfo {
  symbols: string[];
  connected: boolean;
}

interface SharedSocket {
  ws: ReturnType<ReturnType<typeof createMassiveFetcher>["createWebSocket"]>;
  /** Session IDs currently using this symbol's feed */
  sessions: Set<string>;
}

// ── State ──────────────────────────────────────────────────────────────────────

/** sessionId → set of symbols the session subscribes to */
const sessionSymbols = new Map<string, Set<string>>();

/**
 * F12: Per-symbol POC cache keyed by bar ISO timestamp.
 * getDevelopingSessionPoc runs a DB query on every call; with multiple sessions
 * subscribed to the same symbol this can fire dozens of times per bar.
 * Cache key = `${symbol}:${barTimestamp}` provides a 1-bar TTL automatically —
 * each new bar timestamp invalidates the prior entry for that symbol.
 * Map is bounded: old keys are evicted when the cache exceeds 50 entries.
 */
const pocCacheByBar = new Map<string, number | null>();

/** symbol → shared WebSocket connection info */
const sharedSockets = new Map<string, SharedSocket>();

/** symbol → rolling window of last 200 bars */
const barBuffer = new Map<string, Bar[]>();

/** Per-session lock to prevent concurrent evaluateSignals calls */
const sessionLocks = new Map<string, Promise<void>>();

/**
 * M1c (2026-07-17, F-1 closure — independent accuracy-validator grade): per-
 * symbol lock serializing the timeframe-resolution + aggregator-feed step in
 * handleBar(). Without this, two overlapping handleBar() calls for the SAME
 * symbol (the raw WS onBar callback is fire-and-forget — not awaited by its
 * caller) could feed timeframe-bar-aggregator.ts OUT OF ARRIVAL ORDER: the
 * step needs an async getSessionTimeframe() lookup before it can call
 * feedBar(), and a cold cache-miss on bar N's lookup racing a warm cache hit
 * on bar N+1's lookup could let bar N+1 reach feedBar() first. A dedicated
 * lock (separate Map from sessionLocks — a symbol is not a sessionId, and
 * sharing sessionLocks would conflate two different serialization scopes)
 * guarantees the resolve+feed step runs in the SAME order handleBar() was
 * called, regardless of which individual await settles first.
 */
const mtfFeedLocks = new Map<string, Promise<void>>();

/**
 * F-2 (deep-scan re-scan 2026-07-10, MED): run `fn` serialized against all other
 * per-session work on THIS sessionId, chaining on the same `sessionLocks` map the WS
 * bar loop uses. PREVIOUS GAP: `POST /api/paper/prices` called `updatePositionPrices`
 * directly with no lock — concurrent with the live WS stream (or another POST) on the
 * same session it was a read-then-blind-write lost-update race on unrealized equity /
 * MAE / MFE (which feed the cross-symbol DLL 60/67/95% ladder + dashboard equity).
 * Routing that call through here makes it queue behind the WS handler instead of racing.
 * Result/errors propagate to THIS caller; the next queued caller only waits for
 * completion (value/error is not leaked into the shared lock).
 */
export function runSerializedPerSession<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = sessionLocks.get(sessionId) ?? Promise.resolve();
  const result = prev.then(fn, fn); // run after prev settles, regardless of its outcome
  sessionLocks.set(sessionId, result.then(() => undefined, () => undefined));
  return result;
}

// ── F3: Median ATR helper (exported for tests) ────────────────────────────────

/**
 * Compute the median true-range over a bar window using Wilder's formula.
 * True range = max(H-L, |H-prevClose|, |L-prevClose|) per bar.
 * First bar in the window has no prevClose; it falls back to H-L.
 *
 * Exported so tests can verify overnight-gap handling without requiring a
 * full barBuffer setup or running the bar loop.
 */
export function computeMedianTrueRangeFromWindow(
  window: ReadonlyArray<{ high: number; low: number; close: number }>,
): number | undefined {
  if (window.length < 1) return undefined;
  const trueRanges = window.map((b, i) => {
    const hl = (b.high ?? b.close) - (b.low ?? b.close);
    if (i === 0) return hl;
    const prevClose = window[i - 1].close;
    return Math.max(
      hl,
      Math.abs((b.high ?? b.close) - prevClose),
      Math.abs((b.low  ?? b.close) - prevClose),
    );
  });
  const sorted = [...trueRanges].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return median > 0 ? median : undefined;
}

// ── F12: POC cache test helpers ────────────────────────────────────────────────

/**
 * @internal Exported for testing only — allows tests to inspect or reset the
 * per-bar POC cache between test runs to prevent cross-test contamination.
 */
export function _testClearPocCache(): void { pocCacheByBar.clear(); }
export function _testGetPocCacheSize(): number { return pocCacheByBar.size; }
export function _testGetPocCacheValue(symbol: string, barTimestamp: string): number | null | undefined {
  return pocCacheByBar.get(`${symbol}:${barTimestamp}`);
}
export function _testSetBarBuffer(symbol: string, bars: Bar[]): void { barBuffer.set(symbol, bars); }

const BAR_BUFFER_SIZE = 200;

/** Symbol → whether backfill is in progress */
const isBackfilling = new Map<string, boolean>();

/** Symbol → bars received while backfilling */
const pendingRealtimeBars = new Map<string, Bar[]>();

// ── Wave M1b (2026-07-17): feed-gap classification connection tracker ────────
// See src/server/lib/feed-gap-classifier.ts for the full classification
// contract (MARKET_CLOSED / PROVIDER_GAP / EXPECTED_NO_TRADE) and the
// "never gates anything" invariant this observability-only feature must hold.

type FeedGapConnState = "connected" | "disconnected" | "reconnecting";

/**
 * symbol -> current WS connection state + the wall-clock ms timestamp of the
 * last transition INTO that state. Updated exclusively by the ws.on(...)
 * handlers registered in ensureSocket() below (the only place that observes
 * real connection-state transitions). Consumed by evaluateFeedGap() to
 * determine "was the connection continuously 'connected' for the entire gap
 * window" — see that function's docstring for the comparison basis.
 */
const feedGapConnectionState = new Map<string, { state: FeedGapConnState; since: number }>();

/**
 * symbol -> wall-clock ms timestamp when a bar was last processed for this
 * symbol (set in evaluateFeedGap's `finally`, so it always advances even when
 * classification itself fails). Used ONLY as the "since" comparison baseline
 * for connection continuity — deliberately wall-clock-vs-wall-clock (not
 * bar-timestamp-vs-wall-clock) so a delayed feed's bar timestamps are never
 * conflated with real-time WS transition timestamps.
 */
const lastBarWallClockTime = new Map<string, number>();

function recordFeedGapConnectionState(symbol: string, state: FeedGapConnState): void {
  feedGapConnectionState.set(symbol, { state, since: Date.now() });
}

/**
 * Wave M1b: classify the gap (if any) between `previousBar` and the
 * just-arrived `bar` for `symbol`, and emit the resulting observability
 * signals. PURE OBSERVABILITY — never blocks, pauses, or gates bar
 * processing; every branch is wrapped so a thrown error here can NEVER
 * propagate into handleBar()/the signal-evaluation critical path (fail-open,
 * matching the "classifier must fail open" contract in
 * feed-gap-classifier.ts's docstring).
 *
 * Audit row: `feed_gap.classified` (status "warning" for PROVIDER_GAP,
 * "info" for MARKET_CLOSED/EXPECTED_NO_TRADE). SSE `feed:gap_classified` is
 * fired ONLY for PROVIDER_GAP (the operationally actionable case) — routine
 * EXPECTED_NO_TRADE events are frequent (esp. overnight) and would spam the
 * dashboard if broadcast.
 *
 * On internal failure: logs a warning, writes a `feed_gap.classifier_failed`
 * warning audit row documenting the classifier's OWN failure, and fires no
 * SSE. Bar processing (handleBar) is entirely unaffected either way — this
 * function is called fire-and-forget (never awaited) from handleBar.
 *
 * @internal exported for tests — production entry point is handleBar().
 */
export function evaluateFeedGap(symbol: string, previousBar: Bar | undefined, bar: Bar): void {
  // F-1 (independent accuracy-validator grade, 2026-07-17): mint a correlationId so every
  // audit row + SSE this function emits is linkable to the SAME classification event —
  // mirrors processSessionBar's own per-bar correlationId minting one function away.
  // Without this, insertAuditRow's own helper logs "written without correlation_id —
  // context propagation gap" on every single feed-gap row (§2 90-day reconstruction mandate).
  const correlationId = randomUUID();
  try {
    if (!previousBar) return; // no baseline for this symbol yet — nothing to compare

    const lastSeenWallClock = lastBarWallClockTime.get(symbol);
    const conn = feedGapConnectionState.get(symbol);
    // Continuously connected iff the CURRENT state is "connected" AND that
    // connected streak began at or before the last time we saw a bar for this
    // symbol — i.e. no disconnected/reconnecting transition happened in
    // between. See feed-gap-classifier.ts docstring for why this is the
    // caller's responsibility (kept out of the pure module).
    const continuouslyConnected =
      conn?.state === "connected" &&
      lastSeenWallClock !== undefined &&
      conn.since <= lastSeenWallClock;

    const result = classifyFeedGap({
      previousBarTimestamp: new Date(previousBar.timestamp),
      currentBarTimestamp: new Date(bar.timestamp),
      continuouslyConnected,
    });

    if (result.classified && result.classification) {
      const status = result.classification === "PROVIDER_GAP" ? "warning" : "info";
      insertAuditRow({
        action: "feed_gap.classified",
        entityType: "symbol",
        entityId: symbol,
        decisionAuthority: "system",
        status,
        input: {
          symbol,
          previousBarTimestamp: previousBar.timestamp,
          currentBarTimestamp: bar.timestamp,
          continuouslyConnected,
        } as Record<string, unknown>,
        result: {
          symbol,
          gapMinutes: result.gapMinutes,
          classification: result.classification,
          reason: result.reason,
        } as Record<string, unknown>,
        correlationId,
      }).catch((e: unknown) => {
        logger.warn({ e, symbol, action: "feed_gap.classified" }, "feed-gap-classifier: audit write failed — non-blocking");
        auditWriteFailuresTotal.labels({ action: "feed_gap.classified" }).inc();
      });

      // SSE only for the operationally actionable case — see docstring.
      if (result.classification === "PROVIDER_GAP") {
        broadcastSSE("feed:gap_classified", {
          symbol,
          gapMinutes: result.gapMinutes,
          classification: result.classification,
          correlationId,
        });
      }
    }
  } catch (err) {
    logger.warn({ err, symbol }, "feed-gap-classifier: classification threw — fail-open, bar processing unaffected");
    insertAuditRow({
      action: "feed_gap.classifier_failed",
      entityType: "symbol",
      entityId: symbol,
      decisionAuthority: "system",
      status: "warning",
      input: { symbol } as Record<string, unknown>,
      result: { error: err instanceof Error ? err.message : String(err) } as Record<string, unknown>,
      correlationId,
    }).catch((e: unknown) => {
      logger.warn(
        { e, symbol, action: "feed_gap.classifier_failed" },
        "feed-gap-classifier: failure-audit write also failed — non-blocking",
      );
      auditWriteFailuresTotal.labels({ action: "feed_gap.classifier_failed" }).inc();
    });
  } finally {
    // Always advance the wall-clock baseline, even on failure — otherwise a
    // classifier bug would leave a stale baseline that skews the NEXT gap's
    // continuity check.
    lastBarWallClockTime.set(symbol, Date.now());
  }
}

// ── Feed-gap test seams ─────────────────────────────────────────────────────
// @internal exported for tests only — production code never calls these.
export function _testSetFeedGapConnectionState(symbol: string, state: FeedGapConnState, since = Date.now()): void {
  feedGapConnectionState.set(symbol, { state, since });
}
export function _testGetFeedGapConnectionState(symbol: string): { state: FeedGapConnState; since: number } | undefined {
  return feedGapConnectionState.get(symbol);
}
export function _testSetLastBarWallClockTime(symbol: string, ms: number): void {
  lastBarWallClockTime.set(symbol, ms);
}
export function _testClearFeedGapState(): void {
  feedGapConnectionState.clear();
  lastBarWallClockTime.clear();
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getMassiveFetcher() {
  const apiKey = process.env.MASSIVE_API_KEY;
  if (!apiKey) throw new Error("MASSIVE_API_KEY not set");
  return createMassiveFetcher({ apiKey });
}

/** Track last bar's Globex session key per symbol for session boundary detection */
const lastBarDate = new Map<string, string>();

/**
 * Globex session date key (M-2 fix).
 *
 * The raw bar buffer must reset on the CME Globex session boundary (18:00 ET),
 * NOT ET calendar midnight. Parity with the backtester's
 * `_assign_globex_session_id()` in src/engine/indicators/core.py: bars at ET
 * hour >= 18 belong to the NEXT calendar day's session.
 *
 * A +6h instant shift maps 18:00 ET → ET-calendar-midnight of the next day, so a
 * plain ET-date format yields the correct Globex session date:
 *   18:00 ET + 6h = 00:00 ET next day  → next session date
 *   17:59 ET + 6h = 23:59 ET same day  → current session date
 * (CME has no bars in the 17:00–18:00 ET maintenance pause, so this is exact, and
 * it agrees with paper-signal-service.ts::filterToGlobexSession's +7h/17:00 key on
 * every real bar — the filter path stays correct as defense-in-depth.)
 *
 * Prior code keyed on toEasternDateString (ET calendar midnight) and only stayed
 * correct because filterToGlobexSession() re-filtered the buffer before every VWAP
 * read. Keying the buffer itself on the Globex boundary makes it correct regardless
 * of read-path order — any future callsite computing VWAP before the filter no
 * longer contaminates the next session's anchor with 17:00–18:00 ET bars.
 *
 * Exported for unit testing.
 */
export function toGlobexSessionDateString(date: Date): string {
  return toEasternDateString(new Date(date.getTime() + 6 * 3600_000));
}

function pushBar(symbol: string, bar: Bar) {
  let buf = barBuffer.get(symbol);
  if (!buf) {
    buf = [];
    barBuffer.set(symbol, buf);
  }

  // Session boundary reset: detect Globex session change → clear buffer for VWAP
  // freshness. Futures sessions reset at 18:00 ET (Globex open after the 17:00–18:00
  // maintenance pause). Keying on toGlobexSessionDateString (18:00 ET boundary)
  // instead of toEasternDateString (ET calendar midnight) makes the raw buffer
  // correct independent of call order — see toGlobexSessionDateString docstring.
  const barSessionKey = toGlobexSessionDateString(new Date(bar.timestamp));
  const prevSessionKey = lastBarDate.get(symbol);
  if (prevSessionKey && barSessionKey !== prevSessionKey) {
    buf.length = 0; // Reset buffer on new Globex trading session (18:00 ET boundary)
    // M1c (2026-07-17): mirror the same reset for the aggregated N-minute bar
    // history so a stale prior session's bars don't bleed into the new
    // session's indicator warmup — consistent with how the raw 1-minute
    // buffer above already resets (pre-existing behavior for 1m strategies;
    // this keeps non-1m strategies on the same session-boundary contract
    // rather than introducing a new divergence between the two).
    resetAggregatorForSymbol(symbol);
  }
  lastBarDate.set(symbol, barSessionKey);

  buf.push(bar);
  if (buf.length > BAR_BUFFER_SIZE) {
    buf.shift();
  }
}

/**
 * Returns every sessionId currently subscribed to a given symbol.
 */
function sessionsForSymbol(symbol: string): string[] {
  const ids: string[] = [];
  for (const [sessionId, syms] of sessionSymbols) {
    if (syms.has(symbol)) ids.push(sessionId);
  }
  return ids;
}

/**
 * Build a StyleExitBarContext for the current bar.
 *
 * Provides:
 *   - atr14: ATR(14) computed from the bar buffer (fail-soft to 0 if insufficient)
 *   - barVol: bar.volume (the actual bar volume — enables true AVWAP; Wave 26)
 *   - developingSessionPoc: in-memory developing POC from volume-profile-service
 *
 * All fields except atr14 are optional — handlers return HOLD when absent.
 * This function never throws — any error returns undefined so processSessionBar
 * can proceed without exitBarContext (falls back to legacy ATR-only exits).
 */
/** @internal exported for tests — production entry point is processSessionBar */
export async function buildExitBarContext(bar: Bar): Promise<StyleExitBarContext | undefined> {
  try {
    // Use the local barBuffer map (paper-trading-stream.ts owns the streaming buffer).
    // This is the same buffer used by evaluateSignals (passed as getBarBuffer(symbol)).
    const buf = barBuffer.get(bar.symbol) ?? [];
    const atr = ATR(buf, 14);
    // ATR returns NaN when buffer is too short — clamp to 0 (HOLD guard in handlers)
    const atr14 = Number.isFinite(atr) ? atr : 0;

    // F12: cache POC by bar timestamp to avoid a DB round-trip on every bar for every
    // session subscribed to the same symbol. Key = "symbol:isoTimestamp" gives a
    // 1-bar TTL automatically — a new bar timestamp evicts the prior symbol entry.
    const pocCacheKey = `${bar.symbol}:${bar.timestamp}`; // bar.timestamp is always a string
    let poc: number | null;
    if (pocCacheByBar.has(pocCacheKey)) {
      poc = pocCacheByBar.get(pocCacheKey)!;
    } else {
      poc = await getDevelopingSessionPoc(bar.symbol).catch(() => null);
      pocCacheByBar.set(pocCacheKey, poc);
      // Evict oldest entry when the cache grows beyond 50 keys (bounded memory)
      if (pocCacheByBar.size > 50) {
        const oldest = pocCacheByBar.keys().next().value;
        if (oldest !== undefined) pocCacheByBar.delete(oldest);
      }
    }

    // ET time for time-stop evaluation (HH:MM from bar timestamp)
    const barDate = new Date(bar.timestamp);
    const etFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const currentTimeEt = etFormatter.format(barDate);

    // H-2 fix: last2barSwingLow/High from the buffer — prior 2 bars before the current bar.
    // buf[buf.length-1] = current bar (just pushed by pushBar before processSessionBar).
    // buf[buf.length-2] = previous bar, buf[buf.length-3] = 2 bars ago.
    // "last 2-bar swing" = min/max low/high of those 2 prior bars (not the current bar).
    let last2barSwingLow: number | undefined = undefined;
    let last2barSwingHigh: number | undefined = undefined;
    if (buf.length >= 3) {
      const prevBar1 = buf[buf.length - 2];
      const prevBar2 = buf[buf.length - 3];
      // Both bars must have valid OHLC fields (backfill bars always do; unit test stubs may omit high/low)
      if (prevBar1.low != null && prevBar2.low != null) {
        last2barSwingLow  = Math.min(prevBar1.low,  prevBar2.low);
        last2barSwingHigh = Math.max(prevBar1.high, prevBar2.high);
      }
    }

    // BL-8 fix: compute rolling median ATR from the last 100 bars of the buffer.
    // The backtest uses np.nanmedian(atr_values) over all bars; paper previously used
    // atr * 0.85 (constant ratio ~1.176 regardless of regime volatility).
    // A 100-bar window approximates the backtest median over the recent regime.
    // min 14 bars required (ATR warmup); falls back to undefined (no ATR scaling).
    //
    // FIX MED-4 (2026-06-29): use Wilder True Range instead of |high-low| proxy.
    // |H-L| underestimates ATR on gap-open bars (CME Globex gap days, EIA on MCL)
    // → slippage was underestimated → paper P&L optimistically biased vs live.
    // True Range = max(|H-L|, |H-prevClose|, |L-prevClose|), matching backtester.py.
    // Fallback: when no prevClose is available (first bar in window), use |H-L|.
    let medianAtr14Val: number | undefined = undefined;
    if (buf.length >= 14) {
      const window = buf.slice(-100);  // last 100 bars (or fewer on session start)
      const trueRanges = window.map((b, i) => {
        const h = b.high ?? b.close;
        const l = b.low ?? b.close;
        const hl = Math.abs(h - l);
        if (i === 0) return hl; // no prevClose for first window bar — fallback
        const prevC = window[i - 1].close;
        return Math.max(hl, Math.abs(h - prevC), Math.abs(l - prevC));
      });
      const sortedRanges = [...trueRanges].sort((a, b) => a - b);
      const mid = Math.floor(sortedRanges.length / 2);
      medianAtr14Val = sortedRanges.length % 2 === 0
        ? (sortedRanges[mid - 1] + sortedRanges[mid]) / 2
        : sortedRanges[mid];
      if (medianAtr14Val <= 0) medianAtr14Val = undefined;
    }

    const ctx: StyleExitBarContext = {
      currentTimeEt,
      atr14: { [bar.symbol]: atr14 },
      // Wave 26: wire actual bar volume for true AVWAP (ΣP·V / ΣV).
      // Handlers fallback to unit-vol (barVol=1) when this map is absent or zero.
      barVol: { [bar.symbol]: bar.volume > 0 ? bar.volume : 1 },
      ...(poc != null ? { developingSessionPoc: { [bar.symbol]: poc } } : {}),
      // H-2 fix: swing data from bar buffer (populated when buffer has ≥3 bars)
      ...(last2barSwingLow  != null ? { last2barSwingLow:  { [bar.symbol]: last2barSwingLow  } } : {}),
      ...(last2barSwingHigh != null ? { last2barSwingHigh: { [bar.symbol]: last2barSwingHigh } } : {}),
      // BL-8 fix: rolling median ATR for slippage ATR-scaling (replaces atr*0.85 constant)
      ...(medianAtr14Val != null ? { medianAtr14: { [bar.symbol]: medianAtr14Val } } : {}),
      // C2 fix: current bar OHLC extremes for intrabar TP touch detection.
      // Passed to style_c_handler.py as bar_high/bar_low so price_reached() uses the
      // bar's intrabar high (longs) / low (shorts) instead of bar close, matching
      // backtester.py:1248/1260. Bar.high/Bar.low are always numbers per the Bar interface.
      currentBarHigh: { [bar.symbol]: bar.high },
      currentBarLow:  { [bar.symbol]: bar.low  },
      // F-3 (freshscan11 2026-07-12, amended 2026-07-16): the actual market bar time (already
      // computed above as `barDate` for the ET time-of-day string) — threaded through to
      // applyExitDecision/bookPartialClose/closePosition so exit-slippage session classification
      // uses the bar's time, not the wall clock at code-execution time.
      barTimestamp: barDate,
    };
    return ctx;
  } catch (err) {
    logger.warn({ err, symbol: bar.symbol }, "buildExitBarContext: failed — skipping exit handler dispatch for this bar");
    return undefined;
  }
}

/**
 * Process a single session's price update + signal evaluation.
 * Serialized per-session via sessionLocks to prevent concurrent evaluateSignals.
 *
 * H2 fix (2026-06-23): mint a fresh correlationId per bar so every downstream
 * audit row (confluence score, DLL gate, shadow log, openPosition, exit handler)
 * is linked by a non-null correlationId. Satisfies §2 90-day reconstruction contract.
 * Each bar gets a NEW UUID — no carryover between bars — so individual bars are
 * independently traceable and not conflated in audit queries.
 */
async function processSessionBar(
  sessionId: string,
  bar: Bar,
  mtfContext?: { isBucketClose: boolean; aggregatedBuffer: Bar[] },
) {
  // Mint a per-bar correlationId at the Massive-WS entry point.
  // Every downstream call that accepts a correlationId receives this value.
  //
  // M2 determinism caveat (accuracy-validator grade, 2026-07-17, F-3): this
  // correlationId seeds the M2 deterministic fill-model RNG (paper-execution-service.ts
  // FillModelSeedIdentity.orderIntentId) — but it is minted fresh here on EVERY bar,
  // independent of tape/bar content. That gives reconstruction-from-recorded-identity
  // determinism (replay the same correlationId → same fill), NOT fresh-tape determinism
  // (re-running the identical OHLCV sequence from scratch mints new correlationIds and
  // will NOT reproduce the same fills). A future replay/audit tool must reuse the
  // recorded correlationIds from the original run, not just the original bar data.
  const correlationId = randomUUID();

  // BL-1 / H-1 fix: pass full OHLC bar so updatePositionPrices can:
  //   (a) detect intrabar stop breaches using bar.low (longs) / bar.high (shorts)
  //   (b) update highSinceEntryPrice / lowSinceEntryPrice running trackers
  // Prior code sent only bar.close — the high/low fields were always equal to close
  // in normalizePriceUpdate (the number-fallback path).
  const priceMap: Record<string, import("./paper-execution-service.js").PriceBarUpdate> = {
    [bar.symbol]: { close: bar.close, high: bar.high, low: bar.low, volume: bar.volume },
  };

  // Build exit bar context for Track 3 Style C/adaptive runner trail dispatch.
  // Includes true bar volume (Wave 26 AVWAP wiring). Fail-soft: if context build
  // fails, updatePositionPrices still runs (legacy ATR-only path).
  const exitBarContext = await buildExitBarContext(bar);

  try {
    // deepscan14 E1: thread the per-bar correlationId through so bookPartialClose/
    // TP1/TP2/stop/trail audit rows fired from this bar carry it — previously this
    // call omitted the 4th arg, so updatePositionPrices defaulted to
    // correlationId=null on every real-time bar (§2 90-day reconstruction gap).
    await updatePositionPrices(sessionId, priceMap, exitBarContext, { correlationId });
  } catch (err) {
    logger.error({ err, sessionId, symbol: bar.symbol, correlationId }, "Failed to update position prices");
  }

  try {
    // M1c (2026-07-17): mtfContext is computed ONCE per distinct timeframe per
    // raw bar by handleBar (see its docstring) and passed in here — never
    // re-derived per-session, since two sessions sharing the same symbol+
    // timeframe must observe the exact same aggregator bucket. 1m sessions
    // (the regression anchor, 9 of 120 strategies) receive mtfContext=undefined
    // -> evaluateSignals behaves byte-identically to before this wave.
    // updatePositionPrices above is deliberately UNTHROTTLED regardless — see
    // evaluateSignals's own mtfContext docstring for the full rationale
    // (wall-clock flatten + stop/TP touch-detection must never delay to
    // bucket-close cadence).
    await evaluateSignals(sessionId, bar.symbol, bar, getBarBuffer(bar.symbol), { correlationId }, mtfContext);
  } catch (err) {
    logger.error({ err, sessionId, symbol: bar.symbol, correlationId }, "Failed to evaluate signals");
  }
}

/**
 * Called on every bar from any shared WebSocket.
 * Fans out price updates and signal evaluation to every session that cares.
 * Uses per-session locks to serialize processing — prevents race conditions
 * where two bars for the same session overlap and corrupt state.
 */
async function handleBar(bar: Bar) {
  // If backfilling, buffer this bar to process later (in order)
  if (isBackfilling.get(bar.symbol)) {
    let pending = pendingRealtimeBars.get(bar.symbol);
    if (!pending) {
      pending = [];
      pendingRealtimeBars.set(bar.symbol, pending);
    }
    pending.push(bar);
    return;
  }

  // Wave M1b: capture the previous last bar BEFORE pushBar mutates the buffer,
  // so evaluateFeedGap can compare against the true prior bar. Fire-and-forget
  // (never awaited) — pure observability, must never delay bar processing.
  const priorBars = barBuffer.get(bar.symbol);
  const previousBar = priorBars && priorBars.length > 0 ? priorBars[priorBars.length - 1] : undefined;

  pushBar(bar.symbol, bar);

  try {
    evaluateFeedGap(bar.symbol, previousBar, bar);
  } catch (err) {
    // Defense-in-depth only — evaluateFeedGap already wraps its entire body in
    // try/catch/finally and should never throw synchronously. This outer
    // catch exists so a change inside evaluateFeedGap can never regress the
    // fail-open contract for the bar-processing critical path.
    logger.warn({ err, symbol: bar.symbol }, "feed-gap-classifier: evaluateFeedGap threw unexpectedly outside its own guard (fail-open)");
  }

  const sessions = sessionsForSymbol(bar.symbol);
  if (sessions.length === 0) return;

  // M1c (2026-07-17): resolve each session's timeframe, then feed the shared
  // timeframe-bar-aggregator EXACTLY ONCE per DISTINCT timeframe among these
  // sessions for THIS bar — never once per session. Two sessions trading the
  // same symbol at the same timeframe must observe the identical aggregator
  // bucket; feeding it once per session would double-count volume and corrupt
  // bucket-close detection for that shared bucket.
  //
  // F-1 closure (independent accuracy-validator grade, 2026-07-17): this whole
  // step is routed through mtfFeedLocks, a per-symbol lock, so two overlapping
  // handleBar() calls for the SAME symbol always feed the aggregator in the
  // order handleBar() was called — not in whatever order their individual
  // getSessionTimeframe() awaits happen to settle (a cold cache-miss on an
  // earlier bar racing a warm cache-hit on a later one could otherwise let
  // the later bar reach feedBar() first).
  const mtfFeedPrev = mtfFeedLocks.get(bar.symbol) ?? Promise.resolve();
  const mtfFeedResult = mtfFeedPrev.then(async () => {
    const sessionTimeframes = await Promise.all(
      sessions.map(async (sessionId) => [sessionId, await getSessionTimeframe(sessionId)] as const),
    );
    const mtfContextByTimeframe = new Map<string, ReturnType<typeof feedTimeframeAggregator> | undefined>();
    for (const [, timeframe] of sessionTimeframes) {
      if (mtfContextByTimeframe.has(timeframe)) continue; // already fed this bar for this timeframe
      const timeframeMinutes = parseTimeframeMinutes(timeframe);
      mtfContextByTimeframe.set(
        timeframe,
        (timeframeMinutes !== null && timeframeMinutes > 1)
          ? feedTimeframeAggregator(bar.symbol, timeframeMinutes, bar)
          : undefined, // 1m (or unparseable) sessions: byte-identical pre-M1c behavior
      );
    }
    return new Map(
      sessionTimeframes.map(([sessionId, timeframe]) => [sessionId, mtfContextByTimeframe.get(timeframe)]),
    );
  });
  // Chain the lock forward regardless of outcome (mirrors sessionLocks' own
  // pattern) so a failure here can never permanently wedge this symbol's lock.
  mtfFeedLocks.set(bar.symbol, mtfFeedResult.then(() => undefined, () => undefined));
  const mtfContextBySession = await mtfFeedResult.catch((err) => {
    logger.error(
      { err, symbol: bar.symbol },
      "M1c: failed to resolve timeframe / feed aggregator for this bar — sessions in this fan-out proceed with mtfContext=undefined (1m-equivalent fail-open, never blocks bar processing)",
    );
    return new Map<string, ReturnType<typeof feedTimeframeAggregator> | undefined>();
  });

  const promises = sessions.map((sessionId) => {
    // Chain onto the existing lock for this session (or start fresh)
    const prev = sessionLocks.get(sessionId) ?? Promise.resolve();
    const next = prev.then(() => processSessionBar(sessionId, bar, mtfContextBySession.get(sessionId))).catch((err) => {
      logger.error({ err, sessionId, symbol: bar.symbol }, "Session bar processing failed");
    });
    sessionLocks.set(sessionId, next);
    return next;
  });

  await Promise.all(promises);
}

async function backfillBars(symbol: string, lastTimestamp: string) {
  if (isBackfilling.get(symbol)) return; // Already backfilling

  isBackfilling.set(symbol, true);
  logger.info({ symbol, lastTimestamp }, "Starting backfill for symbol");

  try {
    const fetcher = getMassiveFetcher();
    const now = new Date().toISOString();

    // Fetch 1min bars to fill the gap — protected by circuit breaker
    // (WebSocket has its own reconnect logic, so only HTTP backfill is wrapped)
    const bars = await CircuitBreakerRegistry.get("massive-api").call(() =>
      fetcher.fetchBars({
        symbol,
        timeframe: "1min",
        from: lastTimestamp,
        to: now,
      }),
    );

    if (bars.length > 0) {
      logger.info({ symbol, count: bars.length }, "Backfilled bars fetched");
      
      // Sort just in case API returns out of order
      bars.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      // Filter out bars we already have (duplicate overlap)
      const lastTs = new Date(lastTimestamp).getTime();
      const newBars = bars.filter(b => new Date(b.timestamp).getTime() > lastTs);

      for (const rawBar of newBars) {
        const bar: Bar = { ...rawBar, symbol };
        pushBar(bar.symbol, bar);
        
        // Update state for all sessions (indicators only, no trading)
        const sessions = sessionsForSymbol(bar.symbol);
        await Promise.all(sessions.map(sid => 
          updateStateOnly(sid, bar.symbol, bar, getBarBuffer(bar.symbol))
        ));
      }
    }
  } catch (err) {
    logger.error({ err, symbol }, "Failed to backfill bars");
  } finally {
    // Process any buffered real-time bars
    const pending = pendingRealtimeBars.get(symbol) || [];
    pendingRealtimeBars.delete(symbol);
    isBackfilling.set(symbol, false);

    logger.info({ symbol, pendingCount: pending.length }, "Finished backfill, processing pending bars");
    
    // Sort pending bars by time to ensure order
    pending.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    for (const bar of pending) {
      await handleBar(bar);
    }
  }
}

/**
 * Ensure a shared WebSocket exists for the given symbol.
 * If one already exists, just register the session; otherwise create one.
 */
function ensureSocket(symbol: string, sessionId: string) {
  let shared = sharedSockets.get(symbol);

  if (shared) {
    shared.sessions.add(sessionId);
    logger.info(
      { symbol, sessionId, totalSessions: shared.sessions.size },
      "Reusing existing WebSocket for symbol",
    );
    return;
  }

  const fetcher = getMassiveFetcher();
  const ws = fetcher.createWebSocket([symbol], (bar) => {
    handleBar({ ...bar }).catch((err) => {
      logger.error({ err, symbol }, "Unhandled error in bar handler");
    });
  });

  shared = { ws, sessions: new Set([sessionId]) };
  sharedSockets.set(symbol, shared);

  // Wave M1b: seed the feed-gap connection tracker as "disconnected" the
  // instant the socket object is created (before ws.connect() below) — a
  // conservative baseline so a bar that somehow arrived before the first
  // "connected" event would correctly read as NOT continuously connected.
  recordFeedGapConnectionState(symbol, "disconnected");

  ws.on("connected", () => {
    logger.info({ symbol }, "Massive WebSocket connected");
    recordFeedGapConnectionState(symbol, "connected"); // Wave M1b

    // Check if we need to backfill (do we have existing bars?)
    const buffer = barBuffer.get(symbol);
    if (buffer && buffer.length > 0) {
      const lastBar = buffer[buffer.length - 1];
      // Fire and forget backfill — it will buffer real-time bars until done
      backfillBars(symbol, lastBar.timestamp).catch(err => {
        logger.error({ err, symbol }, "Backfill error");
      });
    }

    const s = sharedSockets.get(symbol);
    if (s) {
      // Mark all sessions using this symbol as connected
      for (const sid of s.sessions) {
        updateSessionConnected(sid);
      }
    }
  });

  ws.on("disconnected", () => {
    logger.warn({ symbol }, "Massive WebSocket disconnected");
    recordFeedGapConnectionState(symbol, "disconnected"); // Wave M1b
  });

  ws.on("reconnecting", (info: { attempt: number; delayMs: number }) => {
    logger.info({ symbol, ...info }, "Massive WebSocket reconnecting");
    recordFeedGapConnectionState(symbol, "reconnecting"); // Wave M1b
  });

  ws.on("error", (err: Error) => {
    logger.error({ err, symbol }, "Massive WebSocket error");
  });

  ws.connect();
  logger.info({ symbol, sessionId }, "Created new Massive WebSocket");
}

/**
 * No-op helper — just ensures the session map reflects current connectivity.
 * We don't store a per-session `connected` flag; we derive it from socket state.
 */
function updateSessionConnected(_sessionId: string) {
  // Connectivity is derived on-the-fly in getActiveStreams()
}

/**
 * Remove a session's reference from a shared socket.
 * If no sessions remain, disconnect and clean up the socket.
 */
function releaseSocket(symbol: string, sessionId: string) {
  const shared = sharedSockets.get(symbol);
  if (!shared) return;

  shared.sessions.delete(sessionId);

  if (shared.sessions.size === 0) {
    shared.ws.disconnect();
    sharedSockets.delete(symbol);
    barBuffer.delete(symbol);
    // Wave M1b: bound the feed-gap tracker maps — no reason to keep tracking
    // connection state for a symbol nothing subscribes to anymore. A fresh
    // subscription later re-seeds via ensureSocket's "disconnected" baseline.
    feedGapConnectionState.delete(symbol);
    lastBarWallClockTime.delete(symbol);
    // M1c (2026-07-17): same bound for the timeframe-bar-aggregator's state —
    // no reason to keep in-progress buckets / completed-bar history for a
    // symbol nothing subscribes to anymore. A fresh subscription later
    // bootstraps cleanly (feedBar's own first-bar-ever handling).
    resetAggregatorForSymbol(symbol);
    logger.info({ symbol }, "Disconnected shared WebSocket (no remaining sessions)");
  } else {
    logger.info(
      { symbol, sessionId, remainingSessions: shared.sessions.size },
      "Released session from shared WebSocket",
    );
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Start streaming live prices for a paper trading session.
 * Shares WebSocket connections across sessions trading the same symbol.
 */
export function startStream(sessionId: string, symbols: string[]): void {
  if (sessionSymbols.has(sessionId)) {
    logger.warn({ sessionId }, "Stream already active — stopping first");
    stopStream(sessionId);
  }

  const symSet = new Set(symbols);
  sessionSymbols.set(sessionId, symSet);

  for (const symbol of symSet) {
    ensureSocket(symbol, sessionId);
  }

  logger.info({ sessionId, symbols }, "Paper trading stream started");

  // Deep-scan #16 Wave 2 Track G2 (#21): startStream/stopStream/stopAllStreams
  // previously had NO audit/metric trace — the safety-critical TESTING→PAPER
  // stream lifecycle left no durable record beyond an in-process log line.
  // Fire-and-forget + non-blocking: startStream is synchronous by design and
  // called from hot paths — this must never become async or block on the DB.
  try { paperStreamLifecycleTotal.labels({ event: "start" }).inc(); } catch { /* non-blocking counter */ }
  db.insert(auditLog).values({
    action: "paper_stream.started",
    entityType: "paper_session",
    entityId: sessionId,
    status: "info",
    decisionAuthority: "system",
    input: { symbols },
    result: { symbolCount: symSet.size },
  }).catch((err) => {
    logger.warn({ err, sessionId }, "paper-trading-stream: paper_stream.started audit write failed (non-blocking)");
  });
}

/**
 * Stop streaming for a specific session.
 * Shared sockets are only torn down when no sessions need them.
 */
export function stopStream(sessionId: string): void {
  const syms = sessionSymbols.get(sessionId);
  if (!syms) {
    logger.warn({ sessionId }, "No active stream to stop");
    return;
  }

  for (const symbol of syms) {
    releaseSocket(symbol, sessionId);
  }

  sessionSymbols.delete(sessionId);
  sessionLocks.delete(sessionId);
  logger.info({ sessionId }, "Paper trading stream stopped");

  // Deep-scan #16 Wave 2 Track G2 (#21): see startStream's comment above — same
  // fire-and-forget, non-blocking counter+audit pair for the stop path.
  try { paperStreamLifecycleTotal.labels({ event: "stop" }).inc(); } catch { /* non-blocking counter */ }
  db.insert(auditLog).values({
    action: "paper_stream.stopped",
    entityType: "paper_session",
    entityId: sessionId,
    status: "info",
    decisionAuthority: "system",
    input: { symbols: [...syms] },
    result: { symbolCount: syms.size },
  }).catch((err) => {
    logger.warn({ err, sessionId }, "paper-trading-stream: paper_stream.stopped audit write failed (non-blocking)");
  });
}

/**
 * Stop all active streams and tear down every WebSocket.
 */
export function stopAllStreams(): void {
  const sessionIds = [...sessionSymbols.keys()];
  for (const sessionId of sessionIds) {
    stopStream(sessionId);
  }
  logger.info({ count: sessionIds.length }, "All paper trading streams stopped");

  // Deep-scan #16 Wave 2 Track G2 (#21): batch-level marker — each underlying
  // session already emitted its own "stop" event/audit row above via stopStream().
  try { paperStreamLifecycleTotal.labels({ event: "stop_all" }).inc(); } catch { /* non-blocking counter */ }
  db.insert(auditLog).values({
    action: "paper_stream.stopped_all",
    entityType: "paper_session",
    entityId: null,
    status: "info",
    decisionAuthority: "system",
    input: {},
    result: { sessionCount: sessionIds.length, sessionIds },
  }).catch((err) => {
    logger.warn({ err, sessionCount: sessionIds.length }, "paper-trading-stream: paper_stream.stopped_all audit write failed (non-blocking)");
  });
}

/**
 * Return a snapshot of active streams: sessionId → { symbols, connected }.
 */
export function getActiveStreams(): Map<string, StreamInfo> {
  const result = new Map<string, StreamInfo>();

  for (const [sessionId, syms] of sessionSymbols) {
    const symbols = [...syms];
    // Session is connected if ALL its symbols have a connected socket
    const connected = symbols.every((s) => {
      const shared = sharedSockets.get(s);
      return shared?.ws.isConnected() ?? false;
    });
    result.set(sessionId, { symbols, connected });
  }

  return result;
}

/**
 * Check whether a session has an active stream.
 */
export function isStreaming(sessionId: string): boolean {
  return sessionSymbols.has(sessionId);
}

/**
 * Get the bar buffer for a symbol (useful for indicators / signal evaluator).
 */
export function getBarBuffer(symbol: string): Bar[] {
  return barBuffer.get(symbol) ?? [];
}

// Wire bar buffer provider into smt-live-service (breaks circular dependency).
// smt-live-service cannot import paper-trading-stream (would be circular since
// paper-signal-service imports both). Provider injection is the safe pattern.
// Must be called after getBarBuffer is defined above.
initSmtBarBufferProvider(getBarBuffer);

/**
 * Health snapshot for a single session — used by the scheduler's auto-recovery
 * loop to detect crashed WebSocket streams. Returns `connected: false` for
 * unknown / closed sessions so callers fail closed.
 */
export function getStreamHealth(sessionId: string): { connected: boolean; symbols: string[] } {
  const symbols = sessionSymbols.get(sessionId);
  if (!symbols) return { connected: false, symbols: [] };
  const arr = Array.from(symbols);
  const connected = arr.every((s) => {
    const shared = sharedSockets.get(s);
    return shared?.ws.isConnected() ?? false;
  });
  return { connected, symbols: arr };
}
