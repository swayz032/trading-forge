import WebSocket from "ws";

/**
 * Massive Data Fetcher
 *
 * Role: Real-time streaming + supplemental historical data
 * - Free tier: Currencies Basic, Indices Basic, Options Basic, Stocks Basic
 * - WebSocket for live/paper trading (Phase 6)
 * - REST for on-demand historical bars
 *
 * API Docs: https://massive.com/docs (REST + WebSocket)
 * Dashboard: https://massive.com/dashboard/subscriptions
 *
 * M1a (2026-07-17): "Massive" is Polygon.io, rebranded — the prior
 * `massive.io` domain reference above was stale and 404s; the real service
 * lives at massive.com. The WebSocket handling below was rewritten to match
 * the REAL, independently-verified protocol (see
 * src/data/fetchers/__fixtures__/massive/README.md for full source
 * citations + confirmed-vs-inferred provenance per detail). Prior code
 * guessed a Bearer-header auth + bare-object-per-message shape that does
 * NOT match the real API on any of: auth flow, subscribe message format,
 * message envelope (array-wrapped, not single objects), or field names
 * (short keys `sym`/`o`/`h`/`l`/`c`/`v`/`s`/`e`, not `symbol`/`open`/etc).
 */

interface MassiveConfig {
  apiKey: string;
  baseUrl?: string;
}

// Deep-scan #16 Wave-1 Track 5 (HIGH #13): fetchBars() previously had no
// AbortController/timeout — CircuitBreaker.call() (the caller-side wrapper used
// elsewhere in the codebase) imposes no deadline of its own, so a hung Massive
// API response wedged a symbol's internal backfill indefinitely. Mirrors the
// per-attempt AbortController pattern used by traderspost/client.ts (SUBMIT_TIMEOUT_MS).
// Pre-PAPER simulator only (CANDIDATE/TESTING) per CLAUDE.md §8, but the data it
// fetches feeds CANDIDATE/TESTING gate evaluation — a hang here silently stalls
// the whole pre-paper pipeline for that symbol.
const MASSIVE_FETCH_TIMEOUT_MS = Math.max(
  1000,
  parseInt(process.env.MASSIVE_FETCH_TIMEOUT_MS ?? "15000", 10) || 15000,
);

interface BarRequest {
  symbol: string;
  timeframe: "1min" | "5min" | "15min" | "1hour" | "daily";
  from: string;
  to: string;
}

interface Bar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function createMassiveFetcher(config: MassiveConfig) {
  const { apiKey, baseUrl = "https://api.massive.io/v1" } = config;

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  async function fetchBars(request: BarRequest): Promise<Bar[]> {
    const params = new URLSearchParams({
      symbol: request.symbol,
      timeframe: request.timeframe,
      from: request.from,
      to: request.to,
    });

    // HIGH #13: bounded AbortController timeout so a hung Massive response can never
    // wedge the caller (or the circuit breaker, which imposes no deadline of its own)
    // indefinitely. A timeout abort surfaces as a distinguishable AbortError so callers
    // can tell "Massive is slow/down" apart from a genuine 4xx/5xx API error.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), MASSIVE_FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/bars?${params}`, { headers, signal: controller.signal });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`Massive API fetchBars timed out after ${MASSIVE_FETCH_TIMEOUT_MS}ms (symbol=${request.symbol}, timeframe=${request.timeframe})`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new Error(`Massive API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.bars as Bar[];
  }

  // M1a: minute aggregates (AM) are the canonical bar source per campaign
  // scope — no second-aggregate (A.) bar-builder. See fixtures README.
  const AM_CHANNEL = "AM";

  /** One rejected/malformed inbound bar — surfaced via the "incident" event, never silently dropped. */
  interface MassiveIncident {
    reason: "non_numeric_price" | "invalid_ohlc" | "negative_volume";
    raw: unknown;
  }

  function validateAmEvent(raw: Record<string, unknown>): { bar: Bar & { symbol: string } } | { incident: MassiveIncident } {
    // Reject null/undefined/missing price fields explicitly BEFORE Number()
    // coercion — Number(null) is 0 (a plausible-looking but wrong price),
    // not NaN, so a missing field would otherwise silently masquerade as a
    // real (and likely OHLC-invalid, for the wrong reported reason) price.
    for (const field of ["o", "h", "l", "c"] as const) {
      if (raw[field] === null || raw[field] === undefined) {
        return { incident: { reason: "non_numeric_price", raw } };
      }
    }
    const open = Number(raw.o);
    const high = Number(raw.h);
    const low = Number(raw.l);
    const close = Number(raw.c);
    const volume = Number(raw.v);

    if (Number.isNaN(open) || Number.isNaN(high) || Number.isNaN(low) || Number.isNaN(close)) {
      return { incident: { reason: "non_numeric_price", raw } };
    }
    if (!Number.isNaN(volume) && volume < 0) {
      return { incident: { reason: "negative_volume", raw } };
    }
    // Invalid OHLC: high must be >= max(open,close,low); low must be <= min(open,close,high).
    if (high < low || high < open || high < close || low > open || low > close) {
      return { incident: { reason: "invalid_ohlc", raw } };
    }

    return {
      bar: {
        symbol: String(raw.sym),
        // Trust the payload's own aggregation-window-start timestamp end-to-end
        // (Unix milliseconds per the confirmed AM schema) — never wall-clock.
        timestamp: new Date(Number(raw.s)).toISOString(),
        open,
        high,
        low,
        close,
        volume: Number.isNaN(volume) ? 0 : volume,
      },
    };
  }

  function createWebSocket(symbols: string[], onBar: (bar: Bar & { symbol: string }) => void) {
    // M1a: confirmed delayed-tier host is wss://delayed.massive.com (stocks
    // cluster, per massive-com/client-js README) — the exact futures-cluster
    // path is NOT independently confirmed (see fixtures README). Callers on
    // a real futures subscription MUST pass the correct full URL via
    // config.baseUrl until that's verified; this default is a documented
    // best-guess placeholder, not a confirmed endpoint.
    const wsUrl = config.baseUrl ?? "wss://delayed.massive.com/futures";

    // Fast lookup set — only process bars for symbols we actually subscribed to
    const symbolSet = new Set(symbols);

    let ws: WebSocket | null = null;
    let connected = false;
    let authenticated = false;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let intentionalClose = false;
    const listeners = new Map<string, Set<(...args: any[]) => void>>();

    function emit(event: string, ...args: any[]) {
      const fns = listeners.get(event);
      if (fns) fns.forEach(fn => fn(...args));
    }

    function on(event: string, fn: (...args: any[]) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    }

    function startHeartbeat() {
      stopHeartbeat();
      heartbeatTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }, 30_000);
    }

    function stopHeartbeat() {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }

    function scheduleReconnect() {
      if (intentionalClose) return;
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30_000);
      reconnectAttempts++;
      emit("reconnecting", { attempt: reconnectAttempts, delayMs: delay });
      reconnectTimer = setTimeout(() => connect(), delay);
    }

    function subscribeParams(): string {
      return symbols.map((sym) => `${AM_CHANNEL}.${sym}`).join(",");
    }

    function handleEvent(evt: Record<string, unknown>) {
      if (evt.ev === "status") {
        const status = evt.status;
        if (status === "auth_success") {
          authenticated = true;
          ws!.send(JSON.stringify({ action: "subscribe", params: subscribeParams() }));
          return;
        }
        if (status === "auth_failed") {
          authenticated = false;
          emit("error", new Error(`Massive WS auth failed: ${String(evt.message ?? "unknown reason")}`));
          return;
        }
        // Any other status (e.g. subscribe confirmation) is treated as the
        // stream being genuinely ready — reset backoff and tell the caller.
        reconnectAttempts = 0;
        emit("connected");
        return;
      }

      if (evt.ev === AM_CHANNEL) {
        const sym = evt.sym;
        if (typeof sym !== "string" || !symbolSet.has(sym)) return; // not a symbol we subscribed to
        const result = validateAmEvent(evt);
        if ("incident" in result) {
          emit("incident", result.incident);
          return;
        }
        onBar(result.bar);
        return;
      }
      // Unrecognized event type — forward-compat no-op, not an error.
    }

    function connect() {
      intentionalClose = false;
      authenticated = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      // No Authorization header — the real protocol authenticates via a
      // post-connect WS message (see handleEvent's "auth_success" branch).
      ws = new WebSocket(wsUrl);

      ws.on("open", () => {
        connected = true;
        startHeartbeat();
        // Auth is a message, not a header/query-string — sent immediately
        // after the socket opens, before any subscribe attempt.
        ws!.send(JSON.stringify({ action: "auth", params: apiKey }));
      });

      ws.on("message", (data: WebSocket.Data) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(data.toString());
        } catch {
          // Ignore non-JSON frames.
          return;
        }
        // Every real inbound frame is a JSON ARRAY of event objects — a
        // bare object here would indicate either a protocol change or a
        // malformed frame; either way, do not silently coerce it.
        if (!Array.isArray(parsed)) return;
        for (const evt of parsed) {
          if (evt && typeof evt === "object") handleEvent(evt as Record<string, unknown>);
        }
      });

      ws.on("close", () => {
        connected = false;
        authenticated = false;
        stopHeartbeat();
        emit("disconnected");
        scheduleReconnect();
      });

      ws.on("error", (err: Error) => {
        emit("error", err);
      });

      ws.on("pong", () => {
        // Server responded to ping — connection is alive
      });
    }

    function disconnect() {
      intentionalClose = true;
      stopHeartbeat();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        ws.close();
        ws = null;
      }
      connected = false;
      authenticated = false;
    }

    function isConnected(): boolean {
      return connected && authenticated;
    }

    function subscribedSymbols(): string[] {
      return [...symbols];
    }

    return { connect, disconnect, isConnected, subscribedSymbols, on };
  }

  return { fetchBars, createWebSocket };
}
