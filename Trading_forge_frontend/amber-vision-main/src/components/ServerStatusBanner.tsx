import { useEffect, useRef, useState } from "react";
import { CloudOff, X } from "lucide-react";
import { sseClient } from "@/lib/sse-client";
import type { SSEEvent, SSEEventData } from "@/types/sse-events";

/**
 * Banner shown when the backend broadcasts `system:shutdown` (graceful drain
 * before SIGTERM/SIGINT) and while we wait for SSE to come back online.
 *
 * Connection model: previously this component owned its own EventSource so it
 * could survive independently of `useSSE` consumers. Now it shares the global
 * `sseClient` singleton (one EventSource per tab) and uses
 * `onConnectionStateChange` to detect "we're back" after a shutdown.
 *
 * Reconnect strategy: the singleton handles backoff (1s/2s/4s/8s/16s/30s cap)
 * and replays missed events via `Last-Event-ID`. We treat the next "open"
 * connection-state callback after a shutdown as the "we're back" signal and
 * clear the banner.
 */

const RECONNECT_GRACE_MS = 60 * 1000; // hide after 60s if we never get a clean re-open

type ShutdownState = SSEEventData<"system:shutdown"> & {
  receivedAt: number;
};

export function ServerStatusBanner() {
  const [state, setState] = useState<ShutdownState | null>(null);
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

    // If the connection comes back open after we've seen a shutdown, drop the
    // banner — the server has clearly recovered. (Initial open during normal
    // boot is harmless: `sawShutdownRef.current` stays false and we no-op.)
    const unsubscribeConnState = sseClient.onConnectionStateChange((connState) => {
      if (connState === "open" && sawShutdownRef.current) {
        sawShutdownRef.current = false;
        setState(null);
      }
    });

    return () => {
      unsubscribe();
      unsubscribeConnState();
    };
  }, []);

  // Auto-clear after the grace window so we don't strand the banner if the
  // EventSource never sees a fresh `open` (e.g. user backgrounded the tab).
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

  if (!state || dismissed) return null;

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
