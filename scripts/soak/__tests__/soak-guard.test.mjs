// Contention-guard decision tests. Pure logic, DI'd sample/switch. node:test + node:assert.
import { test } from "node:test";
import assert from "node:assert/strict";
import G from "../soak-guard.cjs";

const base = {
  sample: { health: { reachable: true, ok: true, backtestsActive: 0 }, gpuUtil: 5, pythonCount: 0, backtestWorkerCount: 0 },
  sw: { mode: "armed", skipUntilMs: null },
  gpuBusyPct: 25, nowMs: 1000, phase: "startup",
};

test("quiet + armed → RUN", () => assert.equal(G.decide(base).action, "RUN"));
test("switch off → SKIP", () => assert.equal(G.decide({ ...base, sw: { mode: "off", skipUntilMs: null } }).reason, "switch_off"));
test("skip_until in future → SKIP", () => assert.equal(G.decide({ ...base, sw: { mode: "armed", skipUntilMs: 5000 } }).reason, "skip_requested"));
test("switch read failed (mode null) → SKIP fail-closed", () => assert.equal(G.decide({ ...base, sw: { mode: null, skipUntilMs: null } }).reason, "switch_unreadable"));
test("backend truly down (reachable:false, HTTP 000) → SKIP backend_unreachable", () => assert.equal(G.decide({ ...base, sample: { health: { reachable: false, ok: false, backtestsActive: null }, gpuUtil: 5, pythonCount: 0 } }).reason, "backend_unreachable"));
test("backend UP but auth-gated/slow (reachable:true, ok:false) → NOT unreachable → RUN (the 07-11 false-positive fix)", () => assert.equal(G.decide({ ...base, sample: { health: { reachable: true, ok: false, backtestsActive: null }, gpuUtil: 5, pythonCount: 0, backtestWorkerCount: 0 } }).action, "RUN"));
test("backtests active (counter) → SKIP at startup", () => assert.equal(G.decide({ ...base, sample: { health: { ok: true, backtestsActive: 2 }, gpuUtil: 5, pythonCount: 0, backtestWorkerCount: 0 } }).reason, "backtests_active"));
// Intent preserved from the original test: a backtest worker the health counter MISSED
// must still block the lane. Re-expressed in the post-OR-066 vocabulary — the catching
// is now done by command-line identification in the sensor rather than a raw process
// count, so the fixture names the worker instead of every python on the box.
test("backtest worker present while the counter says 0 → SKIP — the real-campaign case", () =>
  assert.equal(G.decide({ ...base, sample: { health: { ok: true, backtestsActive: 0 }, gpuUtil: 5, pythonCount: 11, backtestWorkerCount: 11 } }).reason, "backtest_workers_active"));
test("backtest worker present mid-run → ABORT", () =>
  assert.equal(G.decide({ ...base, phase: "midrun", sample: { health: { ok: true, backtestsActive: 0 }, gpuUtil: 5, pythonCount: 11, backtestWorkerCount: 11 } }).action, "ABORT"));
test("gpu busy → SKIP", () => assert.equal(G.decide({ ...base, sample: { health: { ok: true, backtestsActive: 0 }, gpuUtil: 80, pythonCount: 0, backtestWorkerCount: 0 } }).reason, "gpu_busy"));
test("backtests active mid-run → ABORT", () => assert.equal(G.decide({ ...base, phase: "midrun", sample: { health: { ok: true, backtestsActive: 2 }, gpuUtil: 5, pythonCount: 0, backtestWorkerCount: 0 } }).action, "ABORT"));
