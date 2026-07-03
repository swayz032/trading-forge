/**
 * python-runner.deepscan15-fix2.test.ts — deep-scan #15 FIX-1 (H2)
 *
 * Verifies the newly-exported acquireExternalPythonSlot / releaseExternalPythonSlot
 * pair correctly participate in the SAME lane accounting used internally by
 * runPythonModule() (_acquirePythonSlot / _releasePythonSlot), so bespoke external
 * spawners (quantum-mc-service.ts, quantum-rl-training-runner.ts) that call
 * child_process.spawn directly now count toward MAX_PYTHON_SUBPROCESSES /
 * MAX_PYTHON_SUBPROCESSES_EXECUTION and the pythonSubprocess{Active,Queued}
 * stats read by getPythonSubprocessStats() / /api/health.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  acquireExternalPythonSlot,
  releaseExternalPythonSlot,
  getPythonSubprocessStats,
} from "./python-runner.js";

describe("H2 — acquireExternalPythonSlot / releaseExternalPythonSlot lane accounting", () => {
  it("increments the backtest lane's active count on acquire and decrements on release", async () => {
    const before = getPythonSubprocessStats();

    await acquireExternalPythonSlot("backtest");
    const during = getPythonSubprocessStats();
    expect(during.lanes.backtest.active).toBe(before.lanes.backtest.active + 1);
    // Backward-compat top-level `active` field mirrors the backtest lane.
    expect(during.active).toBe(before.active + 1);

    releaseExternalPythonSlot("backtest");
    const after = getPythonSubprocessStats();
    expect(after.lanes.backtest.active).toBe(before.lanes.backtest.active);
    expect(after.active).toBe(before.active);
  });

  it("defaults to the backtest lane when no lane arg is supplied", async () => {
    const before = getPythonSubprocessStats();
    await acquireExternalPythonSlot();
    expect(getPythonSubprocessStats().lanes.backtest.active).toBe(before.lanes.backtest.active + 1);
    releaseExternalPythonSlot();
    expect(getPythonSubprocessStats().lanes.backtest.active).toBe(before.lanes.backtest.active);
  });

  it("tracks the execution lane independently from the backtest lane", async () => {
    const before = getPythonSubprocessStats();

    await acquireExternalPythonSlot("execution");
    const during = getPythonSubprocessStats();
    expect(during.lanes.execution.active).toBe(before.lanes.execution.active + 1);
    // Backtest lane must be untouched by an execution-lane acquire.
    expect(during.lanes.backtest.active).toBe(before.lanes.backtest.active);

    releaseExternalPythonSlot("execution");
    expect(getPythonSubprocessStats().lanes.execution.active).toBe(before.lanes.execution.active);
  });

  it("queues a second backtest-lane acquire once the lane is at its cap and resolves it on release", async () => {
    const cap = getPythonSubprocessStats().lanes.backtest.cap;

    // Fill the lane to capacity.
    for (let i = 0; i < cap; i++) {
      await acquireExternalPythonSlot("backtest");
    }
    expect(getPythonSubprocessStats().lanes.backtest.active).toBe(cap);

    // One more acquire should queue (not resolve) until a release happens.
    let resolved = false;
    const pending = acquireExternalPythonSlot("backtest").then(() => {
      resolved = true;
    });

    // Give the microtask queue a tick — the queued acquire must NOT have resolved yet.
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(getPythonSubprocessStats().lanes.backtest.queued).toBeGreaterThanOrEqual(1);

    // Releasing one slot should hand it to the queued acquire.
    releaseExternalPythonSlot("backtest");
    await pending;
    expect(resolved).toBe(true);
    expect(getPythonSubprocessStats().lanes.backtest.active).toBe(cap);

    // Clean up: release all cap slots we're still holding.
    for (let i = 0; i < cap; i++) {
      releaseExternalPythonSlot("backtest");
    }
    expect(getPythonSubprocessStats().lanes.backtest.active).toBe(0);
    expect(getPythonSubprocessStats().lanes.backtest.queued).toBe(0);
  });
});
