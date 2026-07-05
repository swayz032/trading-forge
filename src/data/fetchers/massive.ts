import WebSocket from "ws";

/**
 * Massive Data Fetcher
 *
 * Role: Real-time streaming + supplemental historical data
 * - Free tier: Currencies Basic, Indices Basic, Options Basic, Stocks Basic
 * - WebSocket for live/paper trading (Phase 6)
 * - REST for on-demand historical bars
 *
 * API Docs: https://massive.io/docs (REST + WebSocket)
 * Dashboard: https://massive.io/dashboard/subscriptions
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

  function createWebSocket(symbols: string[], onBar: (bar: Bar & { symbol: string }) => void) {
    const wsUrl = config.baseUrl?.replace(/^https?/, "wss")?.replace(/\/v1$/, "/v1/stream")
      ?? "wss://stream.massive.io/v1/stream";

    // Fast lookup set — only process bars for symbols we actually subscribed to
    const symbolSet = new Set(symbols);

    let ws: WebSocket | null = null;
    let connected = false;
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

    function connect() {
      intentionalClose = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      ws = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      ws.on("open", () => {
        connected = true;
        reconnectAttempts = 0;
        startHeartbeat();

        // Subscribe to symbols
        ws!.send(JSON.stringify({ action: "subscribe", symbols }));
        emit("connected");
      });

      ws.on("message", (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString());
          // Handle bar data — expect { symbol, timestamp, open, high, low, close, volume }
          // Filter to only subscribed symbols — Massive may send data for entire tier
          if (msg.timestamp !== undefined && msg.symbol && symbolSet.has(msg.symbol)) {
            const open = Number(msg.open);
            const high = Number(msg.high);
            const low = Number(msg.low);
            const close = Number(msg.close);
            const volume = Number(msg.volume);
            // Drop bars with invalid/NaN prices — prevents NaN from propagating through the pipeline
            if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) return;
            onBar({ symbol: msg.symbol, timestamp: msg.timestamp, open, high, low, close, volume: isNaN(volume) ? 0 : volume });
          }
        } catch {
          // Ignore non-JSON messages (heartbeat acks, etc.)
        }
      });

      ws.on("close", () => {
        connected = false;
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
    }

    function isConnected(): boolean {
      return connected;
    }

    function subscribedSymbols(): string[] {
      return [...symbols];
    }

    return { connect, disconnect, isConnected, subscribedSymbols, on };
  }

  return { fetchBars, createWebSocket };
}
