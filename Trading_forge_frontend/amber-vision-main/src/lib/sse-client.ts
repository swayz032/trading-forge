/**
 * SSE singleton manager — multiplexes ONE EventSource across many subscribers.
 *
 * Why this exists:
 *   Every `useSSE` mount used to construct its own `EventSource`. With ~6 routes
 *   each subscribing, plus components like `ServerStatusBanner` and
 *   `KillSwitchBanner` opening their own connections, a single tab could easily
 *   blow past the per-domain HTTP/1.1 connection cap (typically 6) and starve
 *   other requests. It also meant 6× heartbeat traffic and 6× server-side write
 *   loops on every broadcast.
 *
 * Design:
 *   - Single module-level `EventSource` shared across all subscribers in the tab.
 *   - Subscribers register `(eventTypes[], handler)` and receive an unsubscribe fn.
 *   - The first subscriber opens the connection; the last one to leave closes it.
 *   - Reconnect with exponential backoff (1s → 2s → 4s → 8s → 16s → cap 30s) when
 *     the EventSource transitions to CLOSED.
 *
 * Backend protocol note:
 *   The Trading Forge backend (`src/server/routes/sse.ts`) emits **named** SSE
 *   events (`event: <name>\ndata: <json>`), not unnamed `data:`-only frames.
 *   That means we must use `addEventListener(name, ...)` per type — `onmessage`
 *   would only catch the connection sentinel and never the real events.
 *
 *   We attach a native listener lazily the first time any subscriber asks for a
 *   given type, and we keep that listener attached for the lifetime of the
 *   EventSource (cheap, <1KB per type, simpler than refcount tracking). On
 *   reconnect we rebuild the listener set from the live subscriber roster.
 */

import type { SSEEvent, SSEEventType } from "../types/sse-events";

type SubscriberFn = (event: SSEEvent) => void;

interface Subscriber {
  id: number;
  eventTypes: Set<SSEEventType | string>;
  handler: SubscriberFn;
}

/**
 * Connection lifecycle event consumed by `ServerStatusBanner` (and any future
 * connection-health UI) so they don't have to open a second EventSource just
 * to know whether we're connected.
 */
export type ConnectionState = "open" | "closed";
type ConnectionListener = (state: ConnectionState) => void;

class SSEClient {
  private eventSource: EventSource | null = null;
  private readonly subscribers = new Map<number, Subscriber>();
  private nextId = 1;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;

  /** Native listeners attached to the live EventSource, keyed by event name. */
  private nativeListeners = new Map<string, (e: MessageEvent) => void>();

  /** Connection-state listeners (open/closed transitions). */
  private connectionListeners = new Set<ConnectionListener>();

  private readonly url: string;

  constructor(url: string = "/api/sse/events") {
    this.url = url;
  }

  /**
   * Subscribe to one or more event types. Returns an unsubscribe function.
   *
   * If this is the first subscriber, opens the EventSource. If the last
   * subscriber unsubscribes, closes the EventSource.
   */
  subscribe(
    eventTypes: ReadonlyArray<SSEEventType | string>,
    handler: SubscriberFn,
  ): () => void {
    const id = this.nextId++;
    this.subscribers.set(id, {
      id,
      eventTypes: new Set(eventTypes),
      handler,
    });

    this.ensureConnected();
    // Attach a native listener for any newly-requested types.
    for (const type of eventTypes) {
      this.ensureNativeListener(type);
    }

    return () => {
      this.subscribers.delete(id);
      if (this.subscribers.size === 0) {
        this.disconnect();
      }
    };
  }

  /** Open the EventSource if it isn't already open. */
  private ensureConnected(): void {
    if (this.eventSource && this.eventSource.readyState !== EventSource.CLOSED) {
      return;
    }
    this.connect();
  }

  private connect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    try {
      this.eventSource = new EventSource(this.url);
    } catch (err) {
      // Construction can throw on insane URLs / sandbox restrictions.
      if (import.meta.env.DEV) {
        console.error("[sse-client] failed to construct EventSource:", err);
      }
      this.scheduleReconnect();
      return;
    }

    // Reset our native-listener bookkeeping — the new EventSource has none yet.
    this.nativeListeners.clear();

    this.eventSource.onopen = () => {
      this.reconnectAttempts = 0;
      if (import.meta.env.DEV) {
        console.info("[sse-client] connected");
      }
      this.notifyConnectionState("open");
    };

    this.eventSource.onerror = () => {
      // The browser auto-reconnects on transient errors. We only intervene when
      // the connection has been fully CLOSED (terminal state). In that case we
      // schedule our own backoff so we don't hammer the server.
      if (this.eventSource && this.eventSource.readyState === EventSource.CLOSED) {
        if (import.meta.env.DEV) {
          console.warn("[sse-client] connection closed; scheduling reconnect");
        }
        this.notifyConnectionState("closed");
        this.scheduleReconnect();
      }
    };

    // Re-attach native listeners for every type the live subscribers care about.
    // (After a reconnect this rehydrates the listener set on the fresh EventSource.)
    const allTypes = new Set<string>();
    for (const sub of this.subscribers.values()) {
      for (const t of sub.eventTypes) allTypes.add(t);
    }
    for (const type of allTypes) {
      this.ensureNativeListener(type);
    }
  }

  /**
   * Attach a single native EventSource listener for `type` if we don't have one
   * already on this EventSource. Idempotent.
   */
  private ensureNativeListener(type: string): void {
    if (!this.eventSource) return;
    if (this.nativeListeners.has(type)) return;

    const listener = (e: MessageEvent) => {
      this.dispatch(type, e.data);
    };
    this.eventSource.addEventListener(type, listener as EventListener);
    this.nativeListeners.set(type, listener);
  }

  /** Parse and fan out an incoming event to matching subscribers. */
  private dispatch(type: string, rawData: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawData);
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn(
          `[sse-client] failed to parse event JSON for ${type}:`,
          err,
          typeof rawData === "string" ? rawData.slice(0, 200) : rawData,
        );
      }
      return;
    }

    // Reconstruct the SSEEvent envelope. We trust the backend type contract;
    // the discriminated union narrows correctly because the wire `event:` name
    // matches the union's `type` literal.
    const event = { type, data: parsed } as SSEEvent;

    for (const sub of this.subscribers.values()) {
      if (!sub.eventTypes.has(type)) continue;
      try {
        sub.handler(event);
      } catch (err) {
        if (import.meta.env.DEV) {
          console.error(
            `[sse-client] subscriber ${sub.id} threw on event ${type}:`,
            err,
          );
        }
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.disconnect();

    // 1s → 2s → 4s → 8s → 16s → 30s (cap)
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30_000);
    this.reconnectAttempts++;

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.subscribers.size > 0) {
        if (import.meta.env.DEV) {
          console.info(
            `[sse-client] reconnecting (attempt ${this.reconnectAttempts})`,
          );
        }
        this.connect();
      }
    }, delay);
  }

  private disconnect(): void {
    if (this.eventSource) {
      // Removing native listeners is academic since we're closing, but it keeps
      // the bookkeeping honest if anyone reads `nativeListeners` between calls.
      for (const [type, fn] of this.nativeListeners) {
        try {
          this.eventSource.removeEventListener(type, fn as EventListener);
        } catch {
          // ignore
        }
      }
      this.nativeListeners.clear();
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  /** Force-close (for tests, HMR, or explicit teardown). */
  forceClose(): void {
    this.subscribers.clear();
    this.connectionListeners.clear();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.disconnect();
  }

  /**
   * Subscribe to open/closed transitions on the shared connection. Useful for
   * components that need to know "is the server back yet?" without opening
   * their own EventSource. Returns an unsubscribe function.
   */
  onConnectionStateChange(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  private notifyConnectionState(state: ConnectionState): void {
    for (const listener of this.connectionListeners) {
      try {
        listener(state);
      } catch (err) {
        if (import.meta.env.DEV) {
          console.error("[sse-client] connection-state listener threw:", err);
        }
      }
    }
  }

  // ── Test/debug helpers ──────────────────────────────────────────

  getSubscriberCount(): number {
    return this.subscribers.size;
  }

  isConnected(): boolean {
    return (
      this.eventSource !== null
      && this.eventSource.readyState === EventSource.OPEN
    );
  }
}

// Module-level singleton. One instance per browser tab/window.
export const sseClient = new SSEClient();

// Vite HMR cleanup — without this, every hot reload would leak an EventSource.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    sseClient.forceClose();
  });
}
