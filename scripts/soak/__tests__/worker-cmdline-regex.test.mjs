// scripts/soak/__tests__/worker-cmdline-regex.test.mjs
//
// ★ Grader F-2 (2026-07-20): WORKER_CMDLINE_RE is the load-bearing half of the guard's
// secondary check, and it shipped with ZERO coverage in either direction. The 11 cases in
// guard-backtest-detection.test.mjs feed `backtestWorkerCount` in as a literal — they prove
// decide() is surgical GIVEN a correct count, and say nothing about whether a real backtest
// command line produces one. The hard half of the problem lived untested inside a
// PowerShell string.
//
// FALSE NEGATIVES are the dangerous direction: a worker we fail to recognise means the lane
// runs during contended work. So the MATCH table is the safety table and comes first.
//
// Every command line below is derived from a REAL spawn site, not invented:
//   python-runner.ts:323  finalArgs.push("-m", module)      -> `-m src.…`
//   python-runner.ts:318  scriptCode written to a temp file -> `tf-script-<uuid>.py`
//   scheduler.ts:5244     bare spawn("python", …)           -> `-m scripts.…`  (NO semaphore)
//   full-lane.cjs         pytestCmd()                       -> `-m pytest src/engine`
import { test } from "node:test";
import assert from "node:assert/strict";
import { WORKER_CMDLINE_RE, readWindows } from "../soak-sensors.cjs";

// PowerShell's -match is case-insensitive by default; mirror that here so this test and the
// shipped behaviour cannot drift apart on casing.
const re = () => new RegExp(WORKER_CMDLINE_RE, "i");

const MUST_MATCH = [
  ['-m src.engine.backtester', 'python.exe -m src.engine.backtester --config C:\\tf\\cfg.json'],
  ['-m src.engine nested', 'python.exe -m src.engine.replay.quantum_replay --backtest-id 7 --apply'],
  ['pytest over src/engine', 'python.exe -m pytest src/engine -q -m "not gpu"'],
  ['direct engine script path', 'python.exe C:\\Users\\t\\Projects\\tf\\src\\engine\\backtester.py'],
  ['forward-slash engine path', 'python3 /home/t/tf/src/engine/walk_forward.py'],
  ['data pipeline script', 'python.exe C:\\tf\\src\\data\\scripts\\run_pipeline.py --symbol MES'],
  // ★ the two the grader proved were MISSED by the original regex:
  ['-m scripts.… (bare spawn, no semaphore — double miss)',
   'python.exe -m scripts.sync_naked_pocs_to_liquidity_map --symbol MES --apply'],
  ['tf-script temp file (module name never appears)',
   'python.exe C:\\Users\\t\\AppData\\Local\\Temp\\tf-script-9f2c1a.py --config C:\\Temp\\tf-config-1a.json'],
];

const MUST_NOT_MATCH = [
  // The whole point of the narrowing: the tower's own tooling must NOT look like a battery.
  ['elevenlabs MCP server',
   'C:\\Users\\t\\AppData\\Local\\uv\\cache\\archive-v0\\9j3\\Scripts\\python.exe C:\\Users\\t\\AppData\\Local\\uv\\cache\\archive-v0\\9j3\\Scripts\\elevenlabs-mcp.exe'],
  ['generic mcp server', 'python.exe -m mcp_server.stdio --port 0'],
  ['plain REPL', 'python.exe'],
  ['unrelated one-liner', 'python.exe -c "import time; time.sleep(45)"'],
  // ★ The trap that would have carried the bug through its own fix: an agent monitor whose
  // PATH contains "trading-forge" (as C--Users-tonio-Projects-trading-forge). If the regex
  // ever matched the repo name, this would count as a worker and the guard would keep
  // yielding to tooling forever.
  ['agent monitor under a path containing "trading-forge"',
   'C:\\Program Files\\Python313\\python.exe -u C:/Users/t/AppData/Local/Temp/claude/C--Users-tonio-Projects-trading-forge/abc/scratchpad/advisor_ruling_monitor.py'],
];

test("★ MATCH table — every real worker shape is recognised (false negatives are the danger)", () => {
  for (const [label, cmd] of MUST_MATCH) {
    assert.ok(re().test(cmd), `MISSED a real worker shape [${label}]: ${cmd}`);
  }
});

test("★ NON-MATCH table — assistant tooling must never count as a battery", () => {
  for (const [label, cmd] of MUST_NOT_MATCH) {
    assert.ok(!re().test(cmd), `tooling misread as a worker [${label}]: ${cmd}`);
  }
});

test("the repo name alone is NEVER sufficient to match", () => {
  // Stated as its own case because it is the single reasoning error that would have made
  // the entire guard fix a no-op while looking correct.
  assert.ok(!re().test('python.exe C:\\Users\\t\\Projects\\trading-forge\\something_unrelated.py'));
  assert.ok(!re().test('python.exe -u C--Users-tonio-Projects-trading-forge/scratchpad/mon.py'));
});

test("the regex is a valid, non-empty pattern (an empty one would match everything)", () => {
  // A degenerate regex here fails OPEN in the worst way: `""` matches every command line,
  // so every python process would count as a worker and the rails would never run again.
  assert.equal(typeof WORKER_CMDLINE_RE, "string");
  assert.ok(WORKER_CMDLINE_RE.length > 10);
  assert.doesNotThrow(() => new RegExp(WORKER_CMDLINE_RE));
  assert.ok(!re().test(""), "the pattern must not match an empty command line");
});

// ── ★ NEW-2 (re-grader): the env hop is the seam that fails SILENTLY ──
//
// ★ MAJOR-1 (third pass): the FIRST version of this test ended with
//   `if (w.pythonCount === null) return;`
// which node:test reports as a ✔ PASS, not a skip. `readWindows()` shells out to
// powershell, so on the Linux CI runner (fast.yml runs test:scripts on wsl-tower) the
// probe never resolves, the assertion never executes, and the line reads green — 1.1ms
// versus 1566ms when it genuinely runs, with byte-identical output.
//
// The test written BECAUSE "unit tests passed while real-data runs failed" was itself a
// test that passes without running. It only had teeth when a human ran it on Windows.
//
// t.skip() makes a non-executing run visibly distinct from a passing one, and the
// host-state precondition is a SKIP rather than an assertion so a Windows box with no
// python idling fails for a real regression only, never for its environment.
test("★ the regex actually ARRIVES in PowerShell — an empty one would match everything", (t) => {
  // If it arrived empty, PowerShell's -match would match EVERY command line, every python
  // would count as a worker, and the rails would never run again. Fail-CLOSED, which is
  // exactly why it would go unnoticed.
  const w = readWindows(4000);
  if (w.pythonCount === null) {
    t.skip("powershell probe unavailable on this host — assertion NOT executed");
    return;
  }
  if (!(w.pythonCount > 0)) {
    t.skip("no python processes on this host — nothing to discriminate against");
    return;
  }
  // The discriminator: with tooling present, a working injection MUST produce
  // backtestWorkerCount < pythonCount. A broken (empty) regex makes them equal.
  assert.ok(
    w.backtestWorkerCount < w.pythonCount,
    `backtestWorkerCount (${w.backtestWorkerCount}) == pythonCount (${w.pythonCount}) — ` +
      `the regex likely arrived EMPTY in PowerShell and matched everything`,
  );
});
