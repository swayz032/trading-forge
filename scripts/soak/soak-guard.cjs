// scripts/soak/soak-guard.cjs — PURE contention/switch decision. Two layers:
// machine detects load, operator declares intent. Fail-closed to SKIP under uncertainty.
"use strict";

function decide({ sample, sw, gpuBusyPct, nowMs, phase }) {
  const busyAction = phase === "midrun" ? "ABORT" : "SKIP";
  // Operator intent first (switch). Unreadable switch → fail-closed SKIP.
  if (!sw || sw.mode === null || sw.mode === undefined) return { action: "SKIP", reason: "switch_unreadable" };
  if (sw.mode === "off") return { action: "SKIP", reason: "switch_off" };
  if (sw.skipUntilMs && sw.skipUntilMs > nowMs) return { action: "SKIP", reason: "skip_requested" };
  // Machine-detected load. "unreachable" = truly no connection (HTTP 000). A reachable-but-non-200
  // backend (auth-gated/slow) is UP — don't skip for that; fall through to the load checks.
  if (!sample.health || sample.health.reachable === false) return { action: busyAction, reason: "backend_unreachable" };
  if ((sample.health.backtestsActive ?? 0) > 0) return { action: busyAction, reason: "backtests_active" };
  // Secondary battery check — catches backtest workers even when backtestsActive reads 0.
  //
  // ops-experience 2026-07-20 (OR-066). This was `pythonCount > 0` — EVERY python-named
  // process on the box. The tower's own assistant tooling is python (8 idle MCP servers
  // plus monitor scripts were measured live), so the rails yielded to themselves: the
  // soak produced 8 nights of skip rows and NEVER ONCE RAN, exiting 0 each time with a
  // plausible reason, while `backtestsActive` sat at 0 in the very same sample.
  //
  // Now driven by backtestWorkerCount — python processes positively identified as engine
  // work by command line (`-m src.…`, `src/engine/…`). This does NOT weaken the guard:
  // `backtestsActive` above still yields to any live battery, and a process we cannot
  // read is counted AS a worker by the sensor. It only stops yielding to unrelated tooling.
  //
  // null (probe failed) is NOT 0 — uncertainty yields, it does not run.
  if (sample.backtestWorkerCount === null || sample.backtestWorkerCount === undefined) {
    return { action: busyAction, reason: "backtest_probe_unavailable" };
  }
  if (sample.backtestWorkerCount > 0) return { action: busyAction, reason: "backtest_workers_active" };
  if ((sample.gpuUtil ?? 0) > gpuBusyPct) return { action: busyAction, reason: "gpu_busy" };
  return { action: "RUN", reason: "quiet" };
}

module.exports = { decide };
