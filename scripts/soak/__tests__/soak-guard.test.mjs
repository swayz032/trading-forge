// Contention-guard decision tests. Pure logic, DI'd sample/switch. node:test + node:assert.
import { test } from "node:test";
import assert from "node:assert/strict";
import G from "../soak-guard.cjs";

const base = {
  sample: { health: { ok: true, backtestsActive: 0 }, gpuUtil: 5, pythonCount: 0 },
  sw: { mode: "armed", skipUntilMs: null },
  gpuBusyPct: 25, nowMs: 1000, phase: "startup",
};

test("quiet + armed → RUN", () => assert.equal(G.decide(base).action, "RUN"));
test("switch off → SKIP", () => assert.equal(G.decide({ ...base, sw: { mode: "off", skipUntilMs: null } }).reason, "switch_off"));
test("skip_until in future → SKIP", () => assert.equal(G.decide({ ...base, sw: { mode: "armed", skipUntilMs: 5000 } }).reason, "skip_requested"));
test("switch read failed (mode null) → SKIP fail-closed", () => assert.equal(G.decide({ ...base, sw: { mode: null, skipUntilMs: null } }).reason, "switch_unreadable"));
test("backend down at startup → SKIP", () => assert.equal(G.decide({ ...base, sample: { health: { ok: false, backtestsActive: null }, gpuUtil: 5, pythonCount: 0 } }).reason, "backend_unreachable"));
test("backtests active (counter) → SKIP at startup", () => assert.equal(G.decide({ ...base, sample: { health: { ok: true, backtestsActive: 2 }, gpuUtil: 5, pythonCount: 0 } }).reason, "backtests_active"));
test("python workers present (counter says 0) → SKIP — the real-campaign case", () =>
  assert.equal(G.decide({ ...base, sample: { health: { ok: true, backtestsActive: 0 }, gpuUtil: 5, pythonCount: 11 } }).reason, "python_workers_active"));
test("python workers present mid-run → ABORT", () =>
  assert.equal(G.decide({ ...base, phase: "midrun", sample: { health: { ok: true, backtestsActive: 0 }, gpuUtil: 5, pythonCount: 11 } }).action, "ABORT"));
test("gpu busy → SKIP", () => assert.equal(G.decide({ ...base, sample: { health: { ok: true, backtestsActive: 0 }, gpuUtil: 80, pythonCount: 0 } }).reason, "gpu_busy"));
test("backtests active mid-run → ABORT", () => assert.equal(G.decide({ ...base, phase: "midrun", sample: { health: { ok: true, backtestsActive: 2 }, gpuUtil: 5, pythonCount: 0 } }).action, "ABORT"));
