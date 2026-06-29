import { randomUUID } from "crypto";
import { createMassiveFetcher } from "../../data/fetchers/massive.js";
import { updatePositionPrices, type StyleExitBarContext } from "./paper-execution-service.js";
import { evaluateSignals, updateStateOnly, ATR } from "./paper-signal-service.js";
import { CircuitBreakerRegistry } from "../lib/circuit-breaker.js";
import { logger } from "../index.js";
import { toEasternDateString } from "./paper-risk-gate.js";
import { getDevelopingSessionPoc } from "./volume-profile-service.js";
import { initSmtBarBufferProvider } from "./smt-live-service.js";

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
async function processSessionBar(sessionId: string, bar: Bar) {
  // Mint a per-bar correlationId at the Massive-WS entry point.
  // Every downstream call that accepts a correlationId receives this value.
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
    await updatePositionPrices(sessionId, priceMap, exitBarContext);
  } catch (err) {
    logger.error({ err, sessionId, symbol: bar.symbol, correlationId }, "Failed to update position prices");
  }

  try {
    await evaluateSignals(sessionId, bar.symbol, bar, getBarBuffer(bar.symbol), { correlationId });
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

  pushBar(bar.symbol, bar);

  const sessions = sessionsForSymbol(bar.symbol);
  if (sessions.length === 0) return;

  const promises = sessions.map((sessionId) => {
    // Chain onto the existing lock for this session (or start fresh)
    const prev = sessionLocks.get(sessionId) ?? Promise.resolve();
    const next = prev.then(() => processSessionBar(sessionId, bar)).catch((err) => {
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

  ws.on("connected", () => {
    logger.info({ symbol }, "Massive WebSocket connected");
    
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
  });

  ws.on("reconnecting", (info: { attempt: number; delayMs: number }) => {
    logger.info({ symbol, ...info }, "Massive WebSocket reconnecting");
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
