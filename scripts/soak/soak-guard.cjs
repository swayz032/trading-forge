// scripts/soak/soak-guard.cjs — PURE contention/switch decision. Two layers:
// machine detects load, operator declares intent. Fail-closed to SKIP under uncertainty.
"use strict";

function decide({ sample, sw, gpuBusyPct, nowMs, phase }) {
  const busyAction = phase === "midrun" ? "ABORT" : "SKIP";
  // Operator intent first (switch). Unreadable switch → fail-closed SKIP.
  if (!sw || sw.mode === null || sw.mode === undefined) return { action: "SKIP", reason: "switch_unreadable" };
  if (sw.mode === "off") return { action: "SKIP", reason: "switch_off" };
  if (sw.skipUntilMs && sw.skipUntilMs > nowMs) return { action: "SKIP", reason: "skip_requested" };
  // Machine-detected load.
  if (!sample.health || sample.health.ok === false) return { action: busyAction, reason: "backend_unreachable" };
  if ((sample.health.backtestsActive ?? 0) > 0) return { action: busyAction, reason: "backtests_active" };
  // pythonCount catches the campaign's backtest workers even when backtestConcurrency reads 0.
  if ((sample.pythonCount ?? 0) > 0) return { action: busyAction, reason: "python_workers_active" };
  if ((sample.gpuUtil ?? 0) > gpuBusyPct) return { action: busyAction, reason: "gpu_busy" };
  return { action: "RUN", reason: "quiet" };
}

module.exports = { decide };
