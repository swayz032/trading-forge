/**
 * Worker stations — 4 NPCs + their monitors, positioned at desks, activity
 * driven by real Trading Forge system state.
 *
 * Each NPC represents a pipeline worker. Their typing intensity, head focus,
 * uniform-strip glow, and monitor-screen pulse all rise when the system they
 * "control" is doing something — no hard-coded fake activity.
 *
 *   BACKTEST  — busy when any backtest is running or pending
 *   CRITIC    — busy when there are recent critique-eligible candidates
 *               (proxy: strategies in TESTING/CANDIDATE state in last 24h)
 *   SCOUT     — busy when a scout has produced new finds recently
 *               (proxy: CANDIDATE strategies created in the last 6h)
 *   RISK      — busy when there's an active incident in the room
 *
 * All four pull from existing hooks. No new endpoints, no new SSE channels.
 */

import { useMemo } from "react";
import { NPCWorker } from "./NPCWorker";
import { DeskMonitor } from "./DeskMonitor";
import { useStrategies } from "@/hooks/useStrategies";
import { useBacktests } from "@/hooks/useBacktests";
import { useIncidents } from "./IncidentOverlay";

const HOUR_MS = 60 * 60 * 1000;

function recentlyCreated(iso: string | null | undefined, withinMs: number): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < withinMs;
}

interface Station {
  role: string;
  accent: string;
  phase: number;
  /** NPC chair / standing position. */
  npcPos: [number, number, number];
  /** Monitor on the desk in front of the NPC. */
  monitorPos: [number, number, number];
  /** Both the NPC and the monitor share this rotation so they face the same way. */
  rotationY: number;
  /** Live activity computed by parent. */
  activity: number;
}

export function WorkerStations() {
  const { data: strategies } = useStrategies();
  const { data: backtests } = useBacktests();
  const incidents = useIncidents();

  const stations = useMemo<Station[]>(() => {
    // ── BACKTEST activity — running OR pending backtests ──
    const runningCount = (backtests ?? []).filter(
      (bt) => bt.status === "running" || bt.status === "pending",
    ).length;
    const backtestActivity = Math.min(1, 0.25 + runningCount * 0.4);

    // ── CRITIC activity — recent TESTING/CANDIDATE strategies (24h) ──
    const recentCriticTargets = (strategies ?? []).filter(
      (s) =>
        (s.lifecycleState === "TESTING" || s.lifecycleState === "CANDIDATE") &&
        recentlyCreated(s.createdAt, 24 * HOUR_MS),
    ).length;
    const criticActivity = Math.min(1, 0.25 + recentCriticTargets * 0.18);

    // ── SCOUT activity — CANDIDATE strategies created in last 6h ──
    const recentScoutFinds = (strategies ?? []).filter(
      (s) => s.lifecycleState === "CANDIDATE" && recentlyCreated(s.createdAt, 6 * HOUR_MS),
    ).length;
    const scoutActivity = Math.min(1, 0.3 + recentScoutFinds * 0.18);

    // ── RISK activity — any active incident pushes Risk worker into red zone ──
    const riskActivity = incidents.length > 0 ? 1.0 : 0.25;

    // Desk layout — 2 rows of desks per side, NPCs sit on the inner side
    // facing the centre aisle (and the front-wall command TV).
    return [
      {
        role: "Backtest",
        accent: "#10B981",
        phase: 0,
        // Front-left row — NPC sits with body facing -z (toward whiteboard)
        npcPos: [-2.4, 0.1, -2.4],
        monitorPos: [-2.4, 0.78, -3.0],
        rotationY: 0, // facing -z
        activity: backtestActivity,
      },
      {
        role: "Critic",
        accent: "#34D399",
        phase: 1.4,
        // Front-right row
        npcPos: [2.4, 0.1, -2.4],
        monitorPos: [2.4, 0.78, -3.0],
        rotationY: 0,
        activity: criticActivity,
      },
      {
        role: "Scout",
        accent: "#facc15",
        phase: 2.8,
        // Back-left row
        npcPos: [-2.4, 0.1, 1.0],
        monitorPos: [-2.4, 0.78, 0.4],
        rotationY: 0,
        activity: scoutActivity,
      },
      {
        role: "Risk",
        accent: "#ef4444",
        phase: 4.2,
        // Back-right row
        npcPos: [2.4, 0.1, 1.0],
        monitorPos: [2.4, 0.78, 0.4],
        rotationY: 0,
        activity: riskActivity,
      },
    ];
  }, [strategies, backtests, incidents]);

  return (
    <group>
      {stations.map((s) => (
        <group key={s.role}>
          <NPCWorker
            position={s.npcPos}
            rotationY={s.rotationY}
            role={s.role}
            accent={s.accent}
            phase={s.phase}
            activity={s.activity}
          />
          <DeskMonitor
            position={s.monitorPos}
            rotationY={s.rotationY + Math.PI} // monitor faces back toward NPC
            color={s.accent}
            activity={s.activity}
          />
        </group>
      ))}
    </group>
  );
}
