import { useEffect, useState } from "react";
import { AlertOctagon, X } from "lucide-react";
import { sseClient } from "@/lib/sse-client";
import type { SSEEvent } from "@/types/sse-events";

type KillEvent = {
  sessionId: string;
  symbol?: string;
  reason: string;
  force_close?: boolean;
  receivedAt: number;
};

const SHOW_FOR_MS = 30 * 60 * 1000; // 30 minutes
const STORAGE_KEY = "tf:kill-switch-event";
/** Max size we'll ever persist to localStorage for a single kill event.
 *  Caps any pathological payload (e.g. multi-KB reason string) from
 *  ballooning the storage quota. 2 KB is plenty for {sessionId, reason, …}. */
const MAX_STORAGE_BYTES = 2048;
/** Defensive caps on string fields so a hostile/malformed event can't blow up
 *  the banner UI or localStorage. */
const MAX_REASON_LEN = 256;
const MAX_SYMBOL_LEN = 16;
const MAX_SESSION_ID_LEN = 64;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function clampString(v: string, max: number): string {
  return v.length > max ? v.slice(0, max) : v;
}

function loadStored(): KillEvent | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const ev = JSON.parse(raw) as KillEvent;
    if (!ev?.receivedAt) return null;
    if (Date.now() - ev.receivedAt > SHOW_FOR_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return ev;
  } catch {
    return null;
  }
}

export function KillSwitchBanner() {
  const [event, setEvent] = useState<KillEvent | null>(() => loadStored());
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // F-5 fix: route through the shared sseClient singleton instead of opening
    // a second EventSource. Multiplexed across all subscribers; respects the
    // per-domain connection cap; inherits reconnect/backoff.
    const handler = (e: SSEEvent) => {
      if (e.type !== "paper:kill-switch-tripped") return;
      const data = e.data as Record<string, unknown> | null | undefined;
      if (!data || typeof data !== "object") return;

      // Validate required string fields BEFORE persisting to localStorage.
      // Fail-closed: bail entirely on malformed payloads rather than write
      // "unknown" placeholders that mask backend bugs.
      const sessionIdRaw = (data as { sessionId?: unknown }).sessionId;
      const reasonRaw = (data as { reason?: unknown }).reason;
      const symbolRaw = (data as { symbol?: unknown }).symbol;
      const forceCloseRaw = (data as { force_close?: unknown }).force_close;

      if (!isNonEmptyString(sessionIdRaw)) return;
      if (!isNonEmptyString(reasonRaw)) return;
      if (symbolRaw !== undefined && !isNonEmptyString(symbolRaw)) return;

      const ev: KillEvent = {
        sessionId: clampString(sessionIdRaw, MAX_SESSION_ID_LEN),
        reason: clampString(reasonRaw, MAX_REASON_LEN),
        symbol: isNonEmptyString(symbolRaw) ? clampString(symbolRaw, MAX_SYMBOL_LEN) : undefined,
        force_close: typeof forceCloseRaw === "boolean" ? forceCloseRaw : undefined,
        receivedAt: Date.now(),
      };

      try {
        const serialized = JSON.stringify(ev);
        // Cap storage entry size — refuse to persist anything pathological.
        if (serialized.length <= MAX_STORAGE_BYTES) {
          localStorage.setItem(STORAGE_KEY, serialized);
        }
      } catch {
        // ignore storage failure (quota exceeded, private mode, etc.)
      }
      setEvent(ev);
      setDismissed(false);
    };

    const unsubscribe = sseClient.subscribe(["paper:kill-switch-tripped"], handler);
    return unsubscribe;
  }, []);

  // Auto-hide after 30 min
  useEffect(() => {
    if (!event) return;
    const remaining = SHOW_FOR_MS - (Date.now() - event.receivedAt);
    if (remaining <= 0) {
      setEvent(null);
      return;
    }
    const t = setTimeout(() => setEvent(null), remaining);
    return () => clearTimeout(t);
  }, [event]);

  if (!event || dismissed) return null;

  const when = new Date(event.receivedAt).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div
      role="alert"
      className="w-full bg-red-700 text-white border-b border-red-900 shadow-lg"
    >
      <div className="flex items-center gap-3 px-4 py-2.5 max-w-[1800px] mx-auto">
        <AlertOctagon className="w-5 h-5 shrink-0 animate-pulse" />
        <div className="flex-1 min-w-0">
          <span className="font-bold uppercase tracking-wider text-xs sm:text-sm">
            Kill switch tripped
          </span>
          <span className="ml-3 font-mono text-xs opacity-90">
            session {event.sessionId.slice(0, 8)}
            {event.symbol ? ` · ${event.symbol}` : ""} · {event.reason}
            {event.force_close ? " · FORCE-CLOSE" : ""} · {when}
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setDismissed(true);
            try {
              localStorage.removeItem(STORAGE_KEY);
            } catch {
              // ignore
            }
          }}
          className="p-1 rounded hover:bg-red-800 transition-colors shrink-0"
          aria-label="Dismiss kill switch banner"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
