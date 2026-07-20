// scripts/soak/__tests__/guard-backtest-detection.test.mjs
//
// BOTH-POLARITY PROOF for the tower-idle guard narrowing (OR-066).
//
// THE DEFECT
// ----------
// `decide()` skipped whenever `pythonCount > 0` — every python-named process on the
// box. The tower's own assistant tooling is python (8 idle MCP servers + monitor
// scripts, measured live 2026-07-20), so the rails yielded to themselves. The soak
// produced 8 nights of skip rows and NEVER ONCE RAN, exiting 0 each time with a
// plausible reason, while `backtestsActive` sat at 0 in the very same sample.
//
// WHAT MUST STAY TRUE (the fail-safe direction is asserted FIRST and in more cases
// than the permissive one — this narrowing must never become a weakening):
//   * a real backtest running        -> STILL SKIPS
//   * backtestsActive > 0            -> STILL SKIPS (primary signal untouched)
//   * probe failed / unreadable      -> SKIPS (uncertainty yields)
//   * a python process we can't read -> counted AS a worker by the sensor
//   * ONLY idle MCP tooling/monitors -> RUNS   <- the single behaviour change
import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../soak-guard.cjs";

const SW = { mode: "on", skipUntilMs: null };
const HEALTHY = { reachable: true, ok: true, status: 200, backtestsActive: 0 };

/** A sample with everything quiet; override just the field under test. */
const sample = (over = {}) => ({
  health: { ...HEALTHY },
  backtestWorkerCount: 0,
  pythonCount: 0,
  gpuUtil: 0,
  ...over,
});

const run = (over = {}, phase = "startup") =>
  decide({ sample: sample(over), sw: SW, gpuBusyPct: 25, nowMs: 1_784_000_000_000, phase });

// ── POLARITY A — the guard still yields. Asserted first and most. ────────────
test("A1: a real backtest worker running -> STILL SKIPS", () => {
  const r = run({ backtestWorkerCount: 1, pythonCount: 1 });
  assert.equal(r.action, "SKIP");
  assert.equal(r.reason, "backtest_workers_active");
});

test("A2: backtestsActive > 0 -> STILL SKIPS (primary signal untouched)", () => {
  const r = run({ health: { ...HEALTHY, backtestsActive: 2 }, backtestWorkerCount: 0 });
  assert.equal(r.action, "SKIP");
  assert.equal(r.reason, "backtests_active");
});

test("A3: probe FAILED (null) -> SKIPS. null is not zero; uncertainty yields", () => {
  const r = run({ backtestWorkerCount: null, pythonCount: 9 });
  assert.equal(r.action, "SKIP");
  assert.equal(r.reason, "backtest_probe_unavailable");
});

test("A4: field entirely absent -> SKIPS (an older sample shape must not read as idle)", () => {
  const s = sample();
  delete s.backtestWorkerCount;
  const r = decide({ sample: s, sw: SW, gpuBusyPct: 25, nowMs: 1, phase: "startup" });
  assert.equal(r.action, "SKIP");
  assert.equal(r.reason, "backtest_probe_unavailable");
});

test("A5: a real backtest ALONGSIDE idle tooling -> STILL SKIPS", () => {
  // The realistic mixed case: 8 MCP servers idle AND one genuine worker. The battery
  // must win. If this ever flipped, the narrowing would have become a weakening.
  const r = run({ backtestWorkerCount: 1, pythonCount: 9 });
  assert.equal(r.action, "SKIP");
  assert.equal(r.reason, "backtest_workers_active");
});

test("A6: mid-run, a backtest appearing -> ABORT (not merely skip)", () => {
  const r = run({ backtestWorkerCount: 1 }, "midrun");
  assert.equal(r.action, "ABORT");
});

test("A7: GPU busy still skips even with zero workers", () => {
  const r = run({ gpuUtil: 90 });
  assert.equal(r.action, "SKIP");
  assert.equal(r.reason, "gpu_busy");
});

test("A8: operator switch off still wins over everything", () => {
  const r = decide({
    sample: sample(),
    sw: { mode: "off" },
    gpuBusyPct: 25,
    nowMs: 1,
    phase: "startup",
  });
  assert.equal(r.action, "SKIP");
  assert.equal(r.reason, "switch_off");
});

// ── POLARITY B — the one behaviour that changes. ─────────────────────────────
test("B1: ONLY idle MCP tooling/monitors -> RUNS (this is the whole fix)", () => {
  // The measured live state on 2026-07-20: 9 python processes, ZERO of them engine
  // work, backtestsActive 0. Under the old rule this skipped — 8 nights running.
  const r = run({ pythonCount: 9, backtestWorkerCount: 0 });
  assert.equal(r.action, "RUN", "the tower is battery-idle; the rails must be allowed to measure");
  assert.equal(r.reason, "quiet");
});

test("B2: a genuinely empty box -> RUNS", () => {
  assert.equal(run({ pythonCount: 0, backtestWorkerCount: 0 }).action, "RUN");
});

test("★ the OLD rule and the NEW rule disagree on exactly ONE of these cases", () => {
  // Proves the change is surgical, not a blanket loosening. The old predicate was
  // `pythonCount > 0`; the new one is `backtestWorkerCount > 0` (with null -> skip).
  const cases = [
    { pythonCount: 9, backtestWorkerCount: 0 }, // idle tooling      old:SKIP new:RUN  <-- the fix
    { pythonCount: 9, backtestWorkerCount: 1 }, // tooling + battery old:SKIP new:SKIP
    { pythonCount: 1, backtestWorkerCount: 1 }, // battery only      old:SKIP new:SKIP
    { pythonCount: 0, backtestWorkerCount: 0 }, // empty             old:RUN  new:RUN
  ];
  const oldSkips = cases.map((c) => c.pythonCount > 0);
  const newSkips = cases.map((c) => run(c).action === "SKIP");
  const diverged = cases.filter((_, i) => oldSkips[i] !== newSkips[i]);
  assert.equal(diverged.length, 1, "the narrowing must change exactly one case");
  assert.deepEqual(diverged[0], { pythonCount: 9, backtestWorkerCount: 0 });
  // ...and it diverges only in the direction of RUNNING when there is no battery.
  assert.equal(run(diverged[0]).action, "RUN");
});
