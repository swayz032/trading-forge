// scripts/lib/__tests__/tower-idle-guard.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { exitCodeFor, guardOnce } from "../tower-idle-guard.cjs";

test("exit code mapping", () => {
  assert.equal(exitCodeFor("RUN"), 0);
  assert.equal(exitCodeFor("SKIP"), 10);
  assert.equal(exitCodeFor("ABORT"), 20);
});

const quietSample = { health: { reachable: true, ok: true, backtestsActive: 0 }, gpuUtil: 5, pythonCount: 0, backtestWorkerCount: 0 };

test("quiet + armed → RUN", async () => {
  const r = await guardOnce({
    takeSampleFn: async () => quietSample,
    readSwitchFn: async () => ({ mode: "armed", skipUntilMs: null }),
    gpuBusyPct: 25, nowMs: 1000, phase: "startup",
  });
  assert.equal(r.action, "RUN");
});

test("switch off → SKIP", async () => {
  const r = await guardOnce({
    takeSampleFn: async () => quietSample,
    readSwitchFn: async () => ({ mode: "off", skipUntilMs: null }),
    gpuBusyPct: 25, nowMs: 1000, phase: "startup",
  });
  assert.equal(r.reason, "switch_off");
  assert.equal(r.action, "SKIP");
});

test("forceRun bypasses busy tower → RUN forced", async () => {
  const busy = { health: { reachable: true, ok: true, backtestsActive: 3 }, gpuUtil: 5, pythonCount: 0, backtestWorkerCount: 0 };
  const r = await guardOnce({
    takeSampleFn: async () => busy,
    readSwitchFn: async () => ({ mode: "armed", skipUntilMs: null }),
    gpuBusyPct: 25, nowMs: 1000, phase: "startup", forceRun: true,
  });
  assert.deepEqual({ a: r.action, why: r.reason }, { a: "RUN", why: "forced" });
});
