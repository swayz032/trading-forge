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

interface Bar {
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

/** symbol → shared WebSocket connection info */
const sharedSockets = new Map<string, SharedSocket>();

/** symbol → rolling window of last 200 bars */
const barBuffer = new Map<string, Bar[]>();

/** Per-session lock to prevent concurrent evaluateSignals calls */
const sessionLocks = new Map<string, Promise<void>>();

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

/** Track last bar date per symbol for session boundary detection */
const lastBarDate = new Map<string, string>();

function pushBar(symbol: string, bar: Bar) {
  let buf = barBuffer.get(symbol);
  if (!buf) {
    buf = [];
    barBuffer.set(symbol, buf);
  }

  // Session boundary reset: detect ET date change → clear buffer for VWAP freshness.
  // Futures sessions reset at 6 PM ET (Globex open), which aligns with the ET date
  // boundary for evening-to-overnight trading.  Using UTC date change would cause
  // the VWAP to reset at midnight UTC (7 PM ET in winter, 8 PM ET in summer) —
  // mid-session for overnight traders.  ET date change matches actual session logic.
  const barEtDate = toEasternDateString(new Date(bar.timestamp));
  const prevEtDate = lastBarDate.get(symbol);
  if (prevEtDate && barEtDate !== prevEtDate) {
    buf.length = 0; // Reset buffer on new ET trading day (Globex session boundary)
  }
  lastBarDate.set(symbol, barEtDate);

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
async function buildExitBarContext(bar: Bar): Promise<StyleExitBarContext | undefined> {
  try {
    // Use the local barBuffer map (paper-trading-stream.ts owns the streaming buffer).
    // This is the same buffer used by evaluateSignals (passed as getBarBuffer(symbol)).
    const buf = barBuffer.get(bar.symbol) ?? [];
    const atr = ATR(buf, 14);
    // ATR returns NaN when buffer is too short — clamp to 0 (HOLD guard in handlers)
    const atr14 = Number.isFinite(atr) ? atr : 0;

    const poc = await getDevelopingSessionPoc(bar.symbol).catch(() => null);

    // ET time for time-stop evaluation (HH:MM from bar timestamp)
    const barDate = new Date(bar.timestamp);
    const etFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const currentTimeEt = etFormatter.format(barDate);

    const ctx: StyleExitBarContext = {
      currentTimeEt,
      atr14: { [bar.symbol]: atr14 },
      // Wave 26: wire actual bar volume for true AVWAP (ΣP·V / ΣV).
      // Handlers fallback to unit-vol (barVol=1) when this map is absent or zero.
      barVol: { [bar.symbol]: bar.volume > 0 ? bar.volume : 1 },
      ...(poc != null ? { developingSessionPoc: { [bar.symbol]: poc } } : {}),
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

  const priceMap = { [bar.symbol]: bar.close };

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
