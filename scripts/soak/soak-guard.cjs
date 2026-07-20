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
  // ★ CRITICAL (grader F-1, 2026-07-20): RUN REQUIRES POSITIVE EVIDENCE OF IDLENESS.
  //
  // `backtestsActive ?? 0` read an UNKNOWN counter as IDLE. That was survivable only while
  // `pythonCount > 0` was a blanket backstop; narrowing the secondary check removed the
  // backstop and made this fail-open load-bearing for the first time.
  //
  // The naive fix — "null means busy" — collides with a DATED safety decision: the 07-11
  // false-positive fix deliberately keeps a reachable-but-non-200 backend (auth-gated
  // 401/503) RUNNING, and that state nulls this counter. Blanket null-means-busy would make
  // an auth-gated tower skip forever: the exact never-measures bug this whole unit exists to
  // kill, rebuilt in a new coat. Two dated safety decisions, pulling opposite ways.
  //
  // Resolved by asking what the guard actually needs, which is not "no evidence of busy" but
  // EVIDENCE OF IDLE. Two independent sources can supply it — the backend's own counter, and
  // the OS-level worker probe, which does not depend on the backend at all. Either suffices.
  // With neither, we know nothing and we yield.
  //   auth-gated backend + probe sees 0 workers -> RUN  (07-11 intent preserved)
  //   counter null + probe unavailable          -> SKIP (grader F-1 closed)
  const counterIdle = sample.health.backtestsActive === 0;
  const probeIdle = sample.backtestWorkerCount === 0;
  if (!counterIdle && !probeIdle) {
    return { action: busyAction, reason: "no_idle_evidence" };
  }
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
  if (sample.backtestWorkerCount > 0) {
    // NEW-3 (re-grader): backtestWorkerCount = matched + UNREADABLE. On Windows, a python
    // owned by SYSTEM or another user has an unreadable CommandLine, so a single such
    // process pins this above zero forever -> permanent yield. The polarity is right
    // (unjudgeable counts as busy), but the operator must be able to tell "a battery is
    // running" from "we cannot see what is running" — otherwise a permanent skip looks
    // like a permanently busy tower, and that is the never-measures bug in its safe coat.
    const unreadable = sample.pythonCmdlineUnreadable ?? 0;
    const matched = sample.backtestWorkerCount - unreadable;
    if (matched <= 0 && unreadable > 0) {
      return { action: busyAction, reason: "python_cmdline_unreadable" };
    }
    return { action: busyAction, reason: "backtest_workers_active" };
  }
  if ((sample.gpuUtil ?? 0) > gpuBusyPct) return { action: busyAction, reason: "gpu_busy" };
  return { action: "RUN", reason: "quiet" };
}

module.exports = { decide };
