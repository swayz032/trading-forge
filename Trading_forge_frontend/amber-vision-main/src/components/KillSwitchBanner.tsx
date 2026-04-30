import { useEffect, useRef, useState } from "react";
import { AlertOctagon, X } from "lucide-react";

type KillEvent = {
  sessionId: string;
  symbol?: string;
  reason: string;
  force_close?: boolean;
  receivedAt: number;
};

const SHOW_FOR_MS = 30 * 60 * 1000; // 30 minutes
const STORAGE_KEY = "tf:kill-switch-event";

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
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/sse/events");
    sourceRef.current = es;

    const handler = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        const ev: KillEvent = {
          sessionId: data?.sessionId ?? "unknown",
          symbol: data?.symbol,
          reason: data?.reason ?? "Kill switch tripped",
          force_close: data?.force_close,
          receivedAt: Date.now(),
        };
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(ev));
        } catch {
          // ignore storage failure
        }
        setEvent(ev);
        setDismissed(false);
      } catch {
        // malformed payload — ignore
      }
    };

    es.addEventListener("paper:kill-switch-tripped", handler as EventListener);

    return () => {
      es.removeEventListener("paper:kill-switch-tripped", handler as EventListener);
      es.close();
      sourceRef.current = null;
    };
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
