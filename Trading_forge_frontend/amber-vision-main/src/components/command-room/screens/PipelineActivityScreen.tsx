/**
 * Pipeline Activity screen — what's happening across the lifecycle right now.
 *
 * Baby jargon:
 *   - "Live workers" / "Practicing" / "Studying" / "Resting"
 *   - One headline number + four mini-cells
 */

import { useStrategyPipeline, useStrategies } from "@/hooks/useStrategies";
import { useBacktests } from "@/hooks/useBacktests";
import { useMemo } from "react";

const BUCKETS: Array<{ label: string; states: string[]; color: string }> = [
  { label: "LIVE", states: ["DEPLOYED", "PILOT"], color: "#10B981" },
  { label: "PRACTICING", states: ["PAPER", "DEPLOY_READY"], color: "#34D399" },
  { label: "STUDYING", states: ["TESTING", "CANDIDATE"], color: "#facc15" },
  { label: "RESTING", states: ["DECLINING", "RETIRED", "GRAVEYARD"], color: "#94a3b8" },
];

export function PipelineActivityScreen() {
  const { data: pipeline } = useStrategyPipeline();
  const { data: strategies } = useStrategies();
  const { data: backtests } = useBacktests();

  const counts = useMemo(() => {
    const byState = pipeline?.byState ?? {};
    return BUCKETS.map((b) => ({
      ...b,
      count: b.states.reduce((sum, s) => sum + (byState[s] ?? 0), 0),
    }));
  }, [pipeline]);

  const total = counts.reduce((s, b) => s + b.count, 0);

  const runningBacktest = useMemo(() => {
    if (!backtests?.length) return null;
    return [...backtests]
      .filter((bt) => bt.status === "running" || bt.status === "pending")
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0] ?? null;
  }, [backtests]);

  const runningStrategy = useMemo(() => {
    if (!runningBacktest || !strategies?.length) return null;
    return strategies.find((s) => s.id === runningBacktest.strategyId) ?? null;
  }, [runningBacktest, strategies]);

  return (
    <>
      <div style={{ fontSize: 12, letterSpacing: "0.32em", color: "#10B981", fontWeight: 700 }}>
        WHAT'S HAPPENING RIGHT NOW
      </div>
      <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 6 }}>
        {total} {total === 1 ? "strategy" : "strategies"} in the family
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 18 }}>
        {counts.map((b) => (
          <div
            key={b.label}
            style={{
              background: "rgba(11,17,24,0.7)",
              border: `1px solid ${b.color}33`,
              borderRadius: 8,
              padding: "10px 12px",
            }}
          >
            <div style={{ fontSize: 9, letterSpacing: "0.18em", color: b.color, fontWeight: 700 }}>
              {b.label}
            </div>
            <div style={{ fontSize: 30, fontWeight: 700, color: "#e2e8f0", lineHeight: 1.05, marginTop: 2 }}>
              {b.count}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: "auto", paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ fontSize: 10, letterSpacing: "0.18em", color: "#64748b" }}>
          THINKING ABOUT
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4, color: "#e2e8f0" }}>
          {runningStrategy?.name ?? "Idle — no test running"}
        </div>
        <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
          {runningBacktest
            ? `${runningStrategy?.symbol ?? ""} ${runningStrategy?.timeframe ?? ""} · started ${new Date(runningBacktest.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
            : "the system is waiting for the next idea"}
        </div>
      </div>
    </>
  );
}
