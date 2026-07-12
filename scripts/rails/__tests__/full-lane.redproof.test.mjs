// scripts/rails/__tests__/full-lane.redproof.test.mjs
// Proves the guard genuinely gates the lane: every busy signal must SKIP (runners throw if
// called), and switch-off / unreadable fail closed. Forced-run overrides a busy tower.
import { test } from "node:test";
import assert from "node:assert/strict";
import { guardOnce } from "../../lib/tower-idle-guard.cjs";
import { runFullLane } from "../full-lane.cjs";

const sw = async () => ({ mode: "armed", skipUntilMs: null });
const mk = (over) => ({ health: { reachable: true, ok: true, backtestsActive: 0 }, gpuUtil: 5, pythonCount: 0, ...over });
const guardWith = (sample, forceRun = false) => () => guardOnce({ takeSampleFn: async () => sample, readSwitchFn: sw, gpuBusyPct: 25, nowMs: 1, phase: "startup", forceRun });
const neverRun = async () => { throw new Error("runner must not fire when tower busy"); };

test("backtests active → lane SKIPS (runners throw if called)", async () => {
  const r = await runFullLane({ guardFn: guardWith(mk({ health: { reachable: true, ok: true, backtestsActive: 2 } })), runPytestFn: neverRun, runReplayFn: neverRun, nowMs: 1 });
  assert.equal(r.verdict, "skipped"); assert.equal(r.reason, "backtests_active");
});
test("python workers present → lane SKIPS", async () => {
  const r = await runFullLane({ guardFn: guardWith(mk({ pythonCount: 11 })), runPytestFn: neverRun, runReplayFn: neverRun, nowMs: 1 });
  assert.equal(r.verdict, "skipped"); assert.equal(r.reason, "python_workers_active");
});
test("GPU busy (80% > 25% threshold) → lane SKIPS", async () => {
  const r = await runFullLane({ guardFn: guardWith(mk({ gpuUtil: 80 })), runPytestFn: neverRun, runReplayFn: neverRun, nowMs: 1 });
  assert.equal(r.verdict, "skipped"); assert.equal(r.reason, "gpu_busy");
});
test("switch off → lane SKIPS", async () => {
  const g = () => guardOnce({ takeSampleFn: async () => mk({}), readSwitchFn: async () => ({ mode: "off", skipUntilMs: null }), gpuBusyPct: 25, nowMs: 1, phase: "startup" });
  const r = await runFullLane({ guardFn: g, runPytestFn: neverRun, runReplayFn: neverRun, nowMs: 1 });
  assert.equal(r.verdict, "skipped"); assert.equal(r.reason, "switch_off");
});
test("switch unreadable (mode null) → lane SKIPS fail-closed", async () => {
  const g = () => guardOnce({ takeSampleFn: async () => mk({}), readSwitchFn: async () => ({ mode: null, skipUntilMs: null }), gpuBusyPct: 25, nowMs: 1, phase: "startup" });
  const r = await runFullLane({ guardFn: g, runPytestFn: neverRun, runReplayFn: neverRun, nowMs: 1 });
  assert.equal(r.verdict, "skipped"); assert.equal(r.reason, "switch_unreadable");
});
test("forced run on a BUSY tower → RUNS anyway", async () => {
  let ran = false;
  const r = await runFullLane({ guardFn: guardWith(mk({ pythonCount: 11 }), true), runPytestFn: async () => { ran = true; return { ok: true, exitCode: 0, durationMs: 1 }; }, runReplayFn: async () => ({ ok: true, exitCode: 0, durationMs: 1 }), nowMs: 1 });
  assert.equal(ran, true); assert.equal(r.verdict, "green");
});
