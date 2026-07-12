// scripts/rails/__tests__/full-lane.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { runFullLane, pytestCmd, replayCmd, exitToResult, PYTEST_TIMEOUT_MS, REPLAY_TIMEOUT_MS, SCHTASK_LIMIT_MS } from "../full-lane.cjs";

const ok = async () => ({ ok: true, exitCode: 0, durationMs: 10 });
const bad = async () => ({ ok: false, exitCode: 1, durationMs: 10 });

test("guard SKIP → skipped, runners never called", async () => {
  let calls = 0;
  const r = await runFullLane({
    guardFn: async () => ({ action: "SKIP", reason: "backtests_active" }),
    runPytestFn: async () => { calls++; return ok(); },
    runReplayFn: async () => { calls++; return ok(); },
    nowMs: 1,
  });
  assert.equal(r.verdict, "skipped");
  assert.equal(r.reason, "backtests_active");
  assert.equal(calls, 0);
});

test("guard RUN + both pass → green", async () => {
  const r = await runFullLane({ guardFn: async () => ({ action: "RUN", reason: "quiet" }), runPytestFn: ok, runReplayFn: ok, nowMs: 1 });
  assert.equal(r.verdict, "green");
});

test("guard RUN + replay fails → red", async () => {
  const r = await runFullLane({ guardFn: async () => ({ action: "RUN", reason: "quiet" }), runPytestFn: ok, runReplayFn: bad, nowMs: 1 });
  assert.equal(r.verdict, "red");
  assert.equal(r.replay.ok, false);
});

test("pytest command excludes gpu-marked tests", () => {
  const { args } = pytestCmd();
  assert.ok(args.join(" ").includes("not gpu"));
});
test("replay command targets the fresh-bootstrap replay test", () => {
  const { args } = replayCmd();
  assert.ok(args.join(" ").includes("fresh-bootstrap-migration-replay"));
});
test("exitToResult maps 0→ok, nonzero→not ok", () => {
  assert.equal(exitToResult(0, 5).ok, true);
  assert.equal(exitToResult(1, 5).ok, false);
});
test("INVARIANT: runner timeouts sum stays under the schtask cap (audit-before-force-kill)", () => {
  // If this fails, Task Scheduler could kill the process before the audit/JSONL write. Keep a
  // margin so the guard + persistence overhead also fits under the cap.
  assert.ok(PYTEST_TIMEOUT_MS + REPLAY_TIMEOUT_MS < SCHTASK_LIMIT_MS,
    `runner sum ${PYTEST_TIMEOUT_MS + REPLAY_TIMEOUT_MS}ms must be < schtask cap ${SCHTASK_LIMIT_MS}ms`);
  assert.equal(pytestCmd().timeoutMs, PYTEST_TIMEOUT_MS);
  assert.equal(replayCmd().timeoutMs, REPLAY_TIMEOUT_MS);
});
