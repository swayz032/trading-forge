/**
 * Incident overlay — the Command Room's incident receiver.
 *
 * Listens to the existing /api/sse/events stream (no new backend channel).
 * When a critical event fires, stacks a red toast in the top-right of the
 * canvas. Auto-dismiss after 60 s (operator can dismiss earlier).
 *
 * Coupled with IncidentLight (3D pulsing red mesh) via the same `incidents`
 * state — we expose a hook so the 3D component reads the same source of
 * truth without re-listening.
 */

import { useEffect, useRef, useState } from "react";
import { AlertOctagon, X } from "lucide-react";

const WATCHED_EVENTS = [
  "prop-firm:suspension-detected",
  "exchange:outage-detected",
  "paper:order-blocked-suspension",
  "paper:order-blocked-outage",
  "paper:kill-switch-tripped",
  "windows:health-check-failed",
  "strategy:drift-alert",
] as const;

export interface CommandRoomIncident {
  id: string;
  event: string;
  title: string;
  detail: string;
  receivedAt: number;
}

const SHOW_FOR_MS = 60 * 1000;

const incidentSubscribers = new Set<(list: CommandRoomIncident[]) => void>();
let currentIncidents: CommandRoomIncident[] = [];

function broadcast() {
  for (const cb of incidentSubscribers) cb(currentIncidents);
}

function pushIncident(i: CommandRoomIncident) {
  currentIncidents = [i, ...currentIncidents].slice(0, 6);
  broadcast();
}

function removeIncident(id: string) {
  currentIncidents = currentIncidents.filter((i) => i.id !== id);
  broadcast();
}

/** Subscribe — used by IncidentLight (3D) and IncidentOverlay (HUD). */
export function useIncidents(): CommandRoomIncident[] {
  const [list, setList] = useState<CommandRoomIncident[]>(currentIncidents);
  useEffect(() => {
    const cb = (next: CommandRoomIncident[]) => setList([...next]);
    incidentSubscribers.add(cb);
    return () => {
      incidentSubscribers.delete(cb);
    };
  }, []);
  return list;
}

function eventTitle(eventName: string, payload: Record<string, unknown>): { title: string; detail: string } {
  switch (eventName) {
    case "prop-firm:suspension-detected":
      return {
        title: "Prop firm suspended",
        detail: `${(payload.firmId ?? "unknown firm")} just locked us out — new entries blocked.`,
      };
    case "exchange:outage-detected":
      return {
        title: "Exchange offline",
        detail: `${(payload.exchange ?? "CME")} is down. Orders held; no auto-reissue.`,
      };
    case "paper:order-blocked-suspension":
      return {
        title: "Order blocked — firm suspension",
        detail: `Refused entry on ${(payload.firmId ?? "firm")} (suspended).`,
      };
    case "paper:order-blocked-outage":
      return {
        title: "Order blocked — exchange outage",
        detail: "Exchange halted. Held the order.",
      };
    case "paper:kill-switch-tripped":
      return {
        title: "Kill switch tripped",
        detail: `${(payload.reason ?? "Risk limit hit")}.`,
      };
    case "windows:health-check-failed":
      return {
        title: "Windows reboot pending",
        detail: "Pre-trading-day check failed. Pipeline auto-paused.",
      };
    case "strategy:drift-alert":
      return {
        title: "Strategy drifted",
        detail: `${(payload.strategyName ?? "A strategy")} performance is sliding.`,
      };
    default:
      return { title: "Incident", detail: eventName };
  }
}

export function IncidentOverlay() {
  const incidents = useIncidents();
  const sourceRef = useRef<EventSource | null>(null);

  // Wire SSE listener once
  useEffect(() => {
    if (sourceRef.current) return;
    const es = new EventSource("/api/sse/events");
    sourceRef.current = es;

    const handlers = WATCHED_EVENTS.map((evName) => {
      const handler = (e: MessageEvent) => {
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(e.data) as Record<string, unknown>;
        } catch {
          // ignore malformed
        }
        const { title, detail } = eventTitle(evName, payload);
        pushIncident({
          id: `${evName}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          event: evName,
          title,
          detail,
          receivedAt: Date.now(),
        });
      };
      es.addEventListener(evName, handler as EventListener);
      return { evName, handler };
    });

    return () => {
      for (const { evName, handler } of handlers) {
        es.removeEventListener(evName, handler as EventListener);
      }
      es.close();
      sourceRef.current = null;
    };
  }, []);

  // Auto-dismiss
  useEffect(() => {
    if (incidents.length === 0) return;
    const timers = incidents.map((i) => {
      const remaining = SHOW_FOR_MS - (Date.now() - i.receivedAt);
      if (remaining <= 0) {
        removeIncident(i.id);
        return null;
      }
      return setTimeout(() => removeIncident(i.id), remaining);
    });
    return () => {
      for (const t of timers) if (t) clearTimeout(t);
    };
  }, [incidents]);

  if (incidents.length === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 64,
        right: 16,
        zIndex: 25,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: 360,
        pointerEvents: "auto",
      }}
    >
      {incidents.map((i) => (
        <div
          key={i.id}
          role="alert"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "12px 14px",
            background: "rgba(127,29,29,0.92)",
            border: "1px solid #dc2626",
            borderRadius: 10,
            color: "#fff",
            fontFamily: "Inter, system-ui, sans-serif",
            boxShadow: "0 12px 28px rgba(0,0,0,0.5)",
            backdropFilter: "blur(6px)",
          }}
        >
          <AlertOctagon size={18} style={{ marginTop: 1, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, letterSpacing: "0.18em", fontWeight: 700, textTransform: "uppercase" }}>
              {i.title}
            </div>
            <div style={{ fontSize: 12, marginTop: 4, lineHeight: 1.4, color: "#fee2e2" }}>
              {i.detail}
            </div>
            <div style={{ fontSize: 10, marginTop: 4, color: "#fca5a5", letterSpacing: "0.12em" }}>
              {new Date(i.receivedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}
            </div>
          </div>
          <button
            type="button"
            onClick={() => removeIncident(i.id)}
            aria-label="Dismiss"
            style={{
              border: "none",
              background: "transparent",
              color: "#fff",
              cursor: "pointer",
              padding: 0,
            }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
