import { useEffect, useRef, useState } from "react";
import { CloudOff, X } from "lucide-react";
import { sseClient } from "@/lib/sse-client";
import type { SSEEvent, SSEEventData } from "@/types/sse-events";

/**
 * Banner shown in two cases:
 *   1. Graceful shutdown — backend broadcasts `system:shutdown` before SIGTERM/SIGINT.
 *   2. Unexpected disconnect — SSE connection dropped (crash / network loss / proxy
 *      killed the keep-alive). Shows "Disconnected — data may be stale since HH:MM"
 *      until the connection reopens.
 *
 * Without the disconnect banner the SPA serves stale React Query cache with no
 * indicator — operator makes decisions on data that is hours old. (Deep-scan #12
 * Track R FIX 2.)
 *
 * Connection model: shares the global `sseClient` singleton (one EventSource per
 * tab). `onConnectionStateChange` provides 'open'/'closed' transitions. The
 * singleton owns reconnect/backoff (1s→30s cap); we just track state transitions
 * and show/hide the appropriate banner.
 */

const RECONNECT_GRACE_MS = 60 * 1000; // hide shutdown banner after 60s if no clean re-open

type ShutdownState = SSEEventData<"system:shutdown"> & {
  receivedAt: number;
};

export function ServerStatusBanner() {
  const [state, setState] = useState<ShutdownState | null>(null);
  const [disconnectSince, setDisconnectSince] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const sawShutdownRef = useRef(false);

  useEffect(() => {
    const handleEvent = (event: SSEEvent) => {
      if (event.type !== "system:shutdown") return;
      const data = event.data as SSEEventData<"system:shutdown">;
      sawShutdownRef.current = true;
      setState({
        reason: data?.reason ?? "server_shutdown",
        signal: data?.signal,
        receivedAt: Date.now(),
      });
      setDismissed(false);
    };

    const unsubscribe = sseClient.subscribe(["system:shutdown"], handleEvent);

    const unsubscribeConnState = sseClient.onConnectionStateChange((connState) => {
      if (connState === "open") {
        // Connection recovered — clear both banners.
        if (sawShutdownRef.current) {
          sawShutdownRef.current = false;
          setState(null);
        }
        setDisconnectSince(null);
        setDismissed(false);
      } else if (connState === "closed") {
        // Unexpected disconnect — surface a persistent stale-data warning.
        // Only activate if we don't already have a shutdown banner (shutdown is
        // more specific and should take precedence).
        if (!sawShutdownRef.current) {
          setDisconnectSince(
            new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          );
          setDismissed(false);
        }
      }
    });

    return () => {
      unsubscribe();
      unsubscribeConnState();
    };
  }, []);

  // Auto-clear shutdown banner after the grace window if the EventSource never
  // sees a fresh `open` (e.g. user backgrounded the tab).
  useEffect(() => {
    if (!state) return;
    const remaining = RECONNECT_GRACE_MS - (Date.now() - state.receivedAt);
    if (remaining <= 0) {
      setState(null);
      return;
    }
    const t = setTimeout(() => setState(null), remaining);
    return () => clearTimeout(t);
  }, [state]);

  if (dismissed) return null;

  // ── Shutdown banner (graceful drain) ──────────────────────────────────────
  if (state) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="w-full bg-amber-700 text-white border-b border-amber-900 shadow-lg"
      >
        <div className="flex items-center gap-3 px-4 py-2.5 max-w-[1800px] mx-auto">
          <CloudOff className="w-5 h-5 shrink-0 animate-pulse" />
          <div className="flex-1 min-w-0">
            <span className="font-bold uppercase tracking-wider text-xs sm:text-sm">
              Server going offline
            </span>
            <span className="ml-3 font-mono text-xs opacity-90">
              reason: {state.reason}
              {state.signal ? ` · signal ${state.signal}` : ""} · reconnecting…
            </span>
          </div>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="p-1 rounded hover:bg-amber-800 transition-colors shrink-0"
            aria-label="Dismiss server status banner"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // ── Disconnect banner (crash / network drop / proxy timeout) ─────────────
  if (disconnectSince) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="w-full bg-amber-700 text-white border-b border-amber-900 shadow-lg"
      >
        <div className="flex items-center gap-3 px-4 py-2.5 max-w-[1800px] mx-auto">
          <CloudOff className="w-5 h-5 shrink-0 animate-pulse" />
          <div className="flex-1 min-w-0">
            <span className="font-bold uppercase tracking-wider text-xs sm:text-sm">
              Disconnected
            </span>
            <span className="ml-3 font-mono text-xs opacity-90">
              data may be stale since {disconnectSince} · reconnecting…
            </span>
          </div>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="p-1 rounded hover:bg-amber-800 transition-colors shrink-0"
            aria-label="Dismiss disconnected banner"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return null;
}
