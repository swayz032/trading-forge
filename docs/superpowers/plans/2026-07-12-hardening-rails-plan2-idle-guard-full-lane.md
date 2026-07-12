# Hardening Rails — Wave 2: Tower-Idle Guard + FULL Nightly Lane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Also fire `worktree-session` at every create/verify/land and `grading-integrity` for the Task 7 cert.

**Goal:** Give the hardening rails a nightly FULL test lane that runs ON THE TOWER, yields to live trading/backtest work via the already-landed soak idle-guard, and records a browsable per-night result — without ever competing with the agent campaign or touching instrument code.

**Architecture:** Topology decision (operator-confirmed 2026-07-12): the FULL lane is a **tower-side Node orchestrator in the soak mold** (Windows Task Scheduler at 22:00), NOT a GitHub Actions `full.yml`. Rationale: the idle-guard reads tower-local signals (`nvidia-smi`, the `:4000` backend, tower python-process counts) that a GitHub-hosted runner cannot see, and the self-hosted `wsl-tower` runner is offline/fragile. We **reuse** the landed soak primitives (`scripts/soak/soak-guard.cjs::decide`, `scripts/soak/soak-sensors.cjs::takeSample`) verbatim via `require()` — no re-implementation — and add only: a rails-namespace switch reader, a thin guard CLI, the FULL-lane orchestrator, and its schtask registration.

**Tech Stack:** Node 24 (CommonJS `.cjs` for tower scripts, matching soak), `node:test` + `node:assert/strict` for DI unit tests, `postgres` npm for `system_parameters`, `vitest`/`pytest` as the lane's payload, Windows Task Scheduler via PowerShell.

## Global Constraints

- **Reuse, never duplicate soak primitives.** `decide()` and `takeSample()` are imported from `scripts/soak/*.cjs` via `require("../soak/soak-guard.cjs")` / `require("../soak/soak-sensors.cjs")`. Do NOT copy their bodies. The `decide()` contention matrix is already tested in `scripts/soak/__tests__/soak-guard.test.mjs` — do not re-test it here.
- **`decide()` contract (verbatim from landed source):** `decide({ sample, sw, gpuBusyPct, nowMs, phase }) → { action: "RUN"|"SKIP"|"ABORT", reason }`. `phase==="midrun"` → busy yields `ABORT`; else `SKIP`. Fail-closed reasons: `switch_unreadable`, `switch_off`, `skip_requested`, `backend_unreachable`, `backtests_active`, `python_workers_active`, `gpu_busy`; clear → `quiet`.
- **`takeSample()` contract (verbatim):** `takeSample({ healthUrl, port=4000, nowMs }) → { tMs, backend, ollama, pythonCount, diskFreeBytes, vramUsedMb, gpuUtil, health:{reachable,ok,status,latencyMs,backtestsActive} }`. Every probe fails soft to null.
- **Rails switch namespace = `rails_mode` / `rails_skip_until`** in `system_parameters` (NUMERIC `current_value`). Semantics mirror soak's `readSwitch` EXACTLY but on the rails rows: row absent → `mode:"armed"` (default-ON); `rails_mode==0` → `mode:"off"`; `rails_skip_until` (epoch ms) in the future → skip; a thrown/failed query → `mode:null` (guard fail-closes to SKIP). This is a SEPARATE switch from soak's — the operator can pause rails without pausing soak.
- **Scheduling windows:** 03:00–09:00 ET belongs to the soak (`TF-Tower-Soak` @ 3:00AM). The FULL lane registers at **22:00 tower-local**; the 23:30 certification-rig chain is Wave 3 (not this wave). Nothing this wave schedules inside 03:00–09:00.
- **Audit rows use `decision_authority='scheduler'`** (never `human` — must not reset the vacation operator-absence detector), mirroring `soak-watcher.cjs`.
- **Dry-run / force-run flags write a SEPARATE audit action** (`rails.full_lane_dryrun` vs the real `rails.full_lane_completed`) so test invocations never pollute the real ledger. `--force-run` bypasses the guard (sets `{action:"RUN",reason:"forced"}`) exactly as soak's `CFG.forceRun` does.
- **Zero instrument drift.** No file under `src/engine/`, gate/sizing/classifier paths may change. The lane INVOKES tests read-only; it never edits engine code. Task 7 certifies `git diff <base>..<tip> -- src/engine/` is empty.
- **Isolation:** all work in the SHA-pinned worktree `wt-rail2` (pinned at wave start). Junction node_modules for any tsc/vitest run; real binaries only; never `git stash`; FF-only land; diff-stat tripwire before push.

---

### Task 1: Rails-namespace switch reader

**Files:**
- Create: `scripts/lib/rails-switch.cjs`
- Test: `scripts/lib/__tests__/rails-switch.test.mjs`

**Interfaces:**
- Consumes: nothing (leaf module). Takes an injected async query function `q(name)` so it is DI-testable without a live DB.
- Produces: `readRailsSwitch(queryFn) → Promise<{ mode: "armed"|"off"|null, skipUntilMs: number|null }>`. `queryFn(names: string[]) → Promise<Array<{param_name, current_value}>>`. Mirrors soak `readSwitch` semantics on `rails_mode`/`rails_skip_until`.

- [ ] **Step 1: Write the failing test**

```js
// scripts/lib/__tests__/rails-switch.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readRailsSwitch } from "../rails-switch.cjs";

const q = (rows) => async () => rows;

test("no rows → armed (default-on)", async () => {
  assert.deepEqual(await readRailsSwitch(q([])), { mode: "armed", skipUntilMs: null });
});
test("rails_mode=0 → off", async () => {
  const r = await readRailsSwitch(q([{ param_name: "rails_mode", current_value: "0" }]));
  assert.equal(r.mode, "off");
});
test("rails_mode=2 (any nonzero) → armed", async () => {
  const r = await readRailsSwitch(q([{ param_name: "rails_mode", current_value: "2" }]));
  assert.equal(r.mode, "armed");
});
test("rails_skip_until in the future → skipUntilMs set", async () => {
  const r = await readRailsSwitch(q([{ param_name: "rails_skip_until", current_value: "9999999999999" }]));
  assert.equal(r.skipUntilMs, 9999999999999);
});
test("query throws → mode null (fail-closed)", async () => {
  const r = await readRailsSwitch(async () => { throw new Error("db down"); });
  assert.deepEqual(r, { mode: null, skipUntilMs: null });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/lib/__tests__/rails-switch.test.mjs`
Expected: FAIL — cannot find module `../rails-switch.cjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/lib/rails-switch.cjs — rails pause/skip switch. Mirrors soak readSwitch on the
// rails_* namespace so the operator can pause the rails independently of the soak.
"use strict";

async function readRailsSwitch(queryFn) {
  try {
    const rows = await queryFn(["rails_mode", "rails_skip_until"]);
    const m = {};
    for (const r of rows) m[r.param_name] = r.current_value;
    let mode = "armed"; // row absent → default-ON
    if (m.rails_mode !== undefined && Number(m.rails_mode) === 0) mode = "off";
    const skip = Number(m.rails_skip_until);
    return { mode, skipUntilMs: Number.isFinite(skip) ? skip : null };
  } catch {
    return { mode: null, skipUntilMs: null }; // fail-closed → guard SKIPs
  }
}

module.exports = { readRailsSwitch };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/lib/__tests__/rails-switch.test.mjs`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git commit -o scripts/lib/rails-switch.cjs scripts/lib/__tests__/rails-switch.test.mjs \
  -m "rails-w2: rails-namespace switch reader (DI-tested, fail-closed)" --no-verify
```

---

### Task 2: Tower-idle-guard CLI (composes soak decide + takeSample + rails switch)

**Files:**
- Create: `scripts/lib/tower-idle-guard.cjs`
- Test: `scripts/lib/__tests__/tower-idle-guard.test.mjs`

**Interfaces:**
- Consumes: `require("../soak/soak-guard.cjs").decide`, `require("../soak/soak-sensors.cjs").takeSample`, `require("./rails-switch.cjs").readRailsSwitch`.
- Produces: `exitCodeFor(action) → 0|10|20` (RUN→0, SKIP→10, ABORT→20); `guardOnce({ takeSampleFn, readSwitchFn, gpuBusyPct, nowMs, phase, forceRun }) → Promise<{action, reason, sample}>` (pure orchestration, all I/O injected); a CLI `main()` invoked when run directly. `decide` itself is re-exported for callers.

- [ ] **Step 1: Write the failing test**

```js
// scripts/lib/__tests__/tower-idle-guard.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { exitCodeFor, guardOnce } from "../tower-idle-guard.cjs";

test("exit code mapping", () => {
  assert.equal(exitCodeFor("RUN"), 0);
  assert.equal(exitCodeFor("SKIP"), 10);
  assert.equal(exitCodeFor("ABORT"), 20);
});

const quietSample = { health: { reachable: true, ok: true, backtestsActive: 0 }, gpuUtil: 5, pythonCount: 0 };

test("quiet + armed → RUN", async () => {
  const r = await guardOnce({
    takeSampleFn: async () => quietSample,
    readSwitchFn: async () => ({ mode: "armed", skipUntilMs: null }),
    gpuBusyPct: 25, nowMs: 1000, phase: "startup",
  });
  assert.equal(r.action, "RUN");
});

test("switch off → SKIP without sampling", async () => {
  let sampled = false;
  const r = await guardOnce({
    takeSampleFn: async () => { sampled = true; return quietSample; },
    readSwitchFn: async () => ({ mode: "off", skipUntilMs: null }),
    gpuBusyPct: 25, nowMs: 1000, phase: "startup",
  });
  assert.equal(r.reason, "switch_off");
  // sample still taken (decide handles switch first); the point is action is SKIP.
  assert.equal(r.action, "SKIP");
});

test("forceRun bypasses busy tower → RUN forced", async () => {
  const busy = { health: { reachable: true, ok: true, backtestsActive: 3 }, gpuUtil: 5, pythonCount: 0 };
  const r = await guardOnce({
    takeSampleFn: async () => busy,
    readSwitchFn: async () => ({ mode: "armed", skipUntilMs: null }),
    gpuBusyPct: 25, nowMs: 1000, phase: "startup", forceRun: true,
  });
  assert.deepEqual({ a: r.action, why: r.reason }, { a: "RUN", why: "forced" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/lib/__tests__/tower-idle-guard.test.mjs`
Expected: FAIL — cannot find module `../tower-idle-guard.cjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/lib/tower-idle-guard.cjs — rails idle guard. REUSES the landed soak decision +
// sensors; adds only the rails switch + a CLI verdict→exit-code so schtasks/full-lane can branch.
"use strict";
const { decide } = require("../soak/soak-guard.cjs");
const { takeSample } = require("../soak/soak-sensors.cjs");
const { readRailsSwitch } = require("./rails-switch.cjs");

function exitCodeFor(action) {
  return action === "RUN" ? 0 : action === "ABORT" ? 20 : 10;
}

async function guardOnce({ takeSampleFn, readSwitchFn, gpuBusyPct, nowMs, phase, forceRun }) {
  const sample = await takeSampleFn();
  if (forceRun) return { action: "RUN", reason: "forced", sample };
  const sw = await readSwitchFn();
  const g = decide({ sample, sw, gpuBusyPct, nowMs, phase });
  return { ...g, sample };
}

// CLI: node scripts/lib/tower-idle-guard.cjs  → prints verdict JSON, exits per exitCodeFor.
async function main() {
  const dotenv = require("dotenv"); const path = require("path");
  dotenv.config({ path: path.resolve(process.cwd(), ".env") });
  const postgres = require("postgres");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 5 });
  const forceRun = process.argv.includes("--force-run");
  try {
    const r = await guardOnce({
      takeSampleFn: () => takeSample({ healthUrl: process.env.TF_HEALTH_URL || "http://127.0.0.1:4000/api/health", port: 4000 }),
      readSwitchFn: () => readRailsSwitch((names) => sql`SELECT param_name, current_value FROM system_parameters WHERE param_name IN ${sql(names)}`),
      gpuBusyPct: Number(process.env.RAILS_GPU_BUSY_PCT || 25),
      nowMs: Date.now(), phase: "startup", forceRun,
    });
    console.log(JSON.stringify({ action: r.action, reason: r.reason }));
    process.exitCode = exitCodeFor(r.action);
  } finally { await sql.end({ timeout: 5 }); }
}

if (require.main === module) main();
module.exports = { exitCodeFor, guardOnce, decide };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/lib/__tests__/tower-idle-guard.test.mjs`
Expected: PASS (5/5 assertions across 4 tests).

- [ ] **Step 5: Commit**

```bash
git commit -o scripts/lib/tower-idle-guard.cjs scripts/lib/__tests__/tower-idle-guard.test.mjs \
  -m "rails-w2: tower-idle-guard CLI reusing soak decide+takeSample (DI-tested)" --no-verify
```

---

### Task 3: FULL-lane orchestrator — pure core (summarizer + skip path)

**Files:**
- Create: `scripts/rails/full-lane.cjs`
- Test: `scripts/rails/__tests__/full-lane.test.mjs`

**Interfaces:**
- Consumes: `guardOnce` from Task 2 (injected in tests). Runners injected: `runPytestFn() → Promise<{ok:boolean, exitCode:number, durationMs:number}>`, `runReplayFn() → Promise<{ok:boolean, exitCode:number, durationMs:number}>`.
- Produces: `runFullLane({ guardFn, runPytestFn, runReplayFn, nowMs }) → Promise<{ action, reason, pytest?, replay?, verdict }>`. `verdict` ∈ `"green" | "red" | "skipped"`. When guard action ≠ RUN → `{action, reason, verdict:"skipped"}` and NEITHER runner is invoked. When RUN → both runners execute; `verdict="green"` iff both `ok`, else `"red"`.

- [ ] **Step 1: Write the failing test**

```js
// scripts/rails/__tests__/full-lane.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { runFullLane } from "../full-lane.cjs";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/rails/__tests__/full-lane.test.mjs`
Expected: FAIL — cannot find module `../full-lane.cjs`.

- [ ] **Step 3: Write minimal implementation (pure core only; I/O wired in Task 4)**

```js
// scripts/rails/full-lane.cjs — nightly FULL test lane (soak mold). Pure core here; the
// real subprocess runners + JSONL/audit persistence are wired in Task 4's main().
"use strict";

async function runFullLane({ guardFn, runPytestFn, runReplayFn, nowMs }) {
  const g = await guardFn();
  if (g.action !== "RUN") {
    return { action: g.action, reason: g.reason, verdict: "skipped", tMs: nowMs };
  }
  const pytest = await runPytestFn();
  const replay = await runReplayFn();
  const verdict = pytest.ok && replay.ok ? "green" : "red";
  return { action: "RUN", reason: g.reason, pytest, replay, verdict, tMs: nowMs };
}

module.exports = { runFullLane };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/rails/__tests__/full-lane.test.mjs`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git commit -o scripts/rails/full-lane.cjs scripts/rails/__tests__/full-lane.test.mjs \
  -m "rails-w2: full-lane pure core (guard→run→verdict; skip path never runs tests)" --no-verify
```

---

### Task 4: FULL-lane I/O wiring — real runners + JSONL + audit + CLI

**Files:**
- Modify: `scripts/rails/full-lane.cjs` (add the I/O runners, persistence, and `main()`)
- Reference (copy the audit/JSONL helper shape verbatim): `scripts/soak/soak-watcher.cjs` (`writeAudit` with `decision_authority='scheduler'`, JSONL append under `data/soak/` → here `data/rails/`).

**Interfaces:**
- Consumes: `runFullLane` (Task 3 core), `readRailsSwitch` (Task 1), `guardOnce`/`takeSample` (Task 2). Real payload entrypoints (verified present at wave base): pytest = `python -m pytest src/engine -q -m "not gpu"` (GPU-marked tests excluded); replay = `npx vitest run src/server/__tests__/fresh-bootstrap-migration-replay.test.ts` (the 2-pass PGlite fresh-bootstrap replay that already exists).
- Produces: a runnable tower entry `node scripts/rails/full-lane.cjs [--dry-run] [--force-run]`. Writes `data/rails/full-lane-<ISO>.jsonl` + one `audit_log` row: action `rails.full_lane_completed` (or `rails.full_lane_dryrun` under `--dry-run`), `decision_authority='scheduler'`, payload = the verdict object.

- [ ] **Step 1: Add a failing test for the runner factory's command shape**

```js
// append to scripts/rails/__tests__/full-lane.test.mjs
import { pytestCmd, replayCmd, exitToResult } from "../full-lane.cjs";

test("pytest command excludes gpu-marked tests", () => {
  const { cmd, args } = pytestCmd();
  assert.ok(args.includes("not gpu") || args.join(" ").includes("not gpu"));
});
test("replay command targets the fresh-bootstrap replay test", () => {
  const { args } = replayCmd();
  assert.ok(args.join(" ").includes("fresh-bootstrap-migration-replay"));
});
test("exitToResult maps 0→ok, nonzero→not ok", () => {
  assert.equal(exitToResult(0, 5).ok, true);
  assert.equal(exitToResult(1, 5).ok, false);
});
```

- [ ] **Step 2: Run to verify new assertions fail**

Run: `node --test scripts/rails/__tests__/full-lane.test.mjs`
Expected: FAIL — `pytestCmd`/`replayCmd`/`exitToResult` not exported.

- [ ] **Step 3: Implement the I/O layer (spawns fail-soft; helpers copied from soak-watcher shape)**

```js
// add to scripts/rails/full-lane.cjs
const { spawnSync } = require("child_process");
const fs = require("fs"); const path = require("path");

function pytestCmd() { return { cmd: process.platform === "win32" ? "python" : "python3", args: ["-m", "pytest", "src/engine", "-q", "-m", "not gpu"] }; }
function replayCmd() { return { cmd: "npx", args: ["vitest", "run", "src/server/__tests__/fresh-bootstrap-migration-replay.test.ts"] }; }
function exitToResult(code, durationMs) { return { ok: code === 0, exitCode: code, durationMs }; }

function runCmd({ cmd, args }) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { encoding: "utf-8", timeout: 60 * 60 * 1000, windowsHide: true });
  return exitToResult(r.status ?? 1, Date.now() - t0);
}

function writeJsonl(result) {
  const dir = path.resolve(process.cwd(), "data", "rails");
  fs.mkdirSync(dir, { recursive: true });
  // Date.now() acceptable here (runtime tower script, not a resumable workflow).
  fs.appendFileSync(path.join(dir, `full-lane-${new Date().toISOString().slice(0, 10)}.jsonl`), JSON.stringify(result) + "\n");
}

async function writeAudit(sql, action, payload) {
  try {
    await sql`INSERT INTO audit_log (action, status, decision_authority, metadata)
              VALUES (${action}, ${payload.verdict === "red" ? "warning" : "success"}, 'scheduler', ${sql.json(payload)})`;
  } catch (e) { console.error("audit write failed (non-fatal):", e.message); }
}

async function main() {
  const dotenv = require("dotenv"); dotenv.config({ path: path.resolve(process.cwd(), ".env") });
  const postgres = require("postgres");
  const { takeSample } = require("../soak/soak-sensors.cjs");
  const { guardOnce } = require("../lib/tower-idle-guard.cjs");
  const { readRailsSwitch } = require("../lib/rails-switch.cjs");
  const dryRun = process.argv.includes("--dry-run");
  const forceRun = process.argv.includes("--force-run");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 5 });
  try {
    const result = await runFullLane({
      guardFn: () => guardOnce({
        takeSampleFn: () => takeSample({ healthUrl: process.env.TF_HEALTH_URL || "http://127.0.0.1:4000/api/health", port: 4000 }),
        readSwitchFn: () => readRailsSwitch((names) => sql`SELECT param_name, current_value FROM system_parameters WHERE param_name IN ${sql(names)}`),
        gpuBusyPct: Number(process.env.RAILS_GPU_BUSY_PCT || 25), nowMs: Date.now(), phase: "startup", forceRun,
      }),
      runPytestFn: async () => runCmd(pytestCmd()),
      runReplayFn: async () => runCmd(replayCmd()),
      nowMs: Date.now(),
    });
    writeJsonl(result);
    await writeAudit(sql, dryRun ? "rails.full_lane_dryrun" : "rails.full_lane_completed", result);
    console.log(JSON.stringify({ verdict: result.verdict, reason: result.reason }));
    process.exitCode = result.verdict === "red" ? 1 : 0;
  } finally { await sql.end({ timeout: 5 }); }
}

if (require.main === module) main();
module.exports = { runFullLane, pytestCmd, replayCmd, exitToResult };
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `node --test scripts/rails/__tests__/full-lane.test.mjs`
Expected: PASS (6/6 — 3 core + 3 command-shape).

- [ ] **Step 5: Commit**

```bash
git commit -o scripts/rails/full-lane.cjs scripts/rails/__tests__/full-lane.test.mjs \
  -m "rails-w2: full-lane I/O — guarded pytest + PGlite replay, JSONL + scheduler audit, dry/force flags" --no-verify
```

---

### Task 5: schtask registration (22:00 tower-local)

**Files:**
- Create: `scripts/rails/register-full-lane-task.ps1`
- Reference pattern (verbatim structure): `scripts/soak/register-soak-task.ps1`

**Interfaces:**
- Consumes: `scripts/rails/full-lane.cjs`.
- Produces: an idempotent `Register-ScheduledTask` for `TF-Rails-Full-Lane` at 22:00, WorkingDir = MAIN checkout (so `.env` + `data/rails` resolve to the live tree), 90-min execution limit, `StartWhenAvailable`, `MultipleInstances IgnoreNew`.

- [ ] **Step 1: Write the registration script**

```powershell
# scripts/rails/register-full-lane-task.ps1 — idempotent Task Scheduler registration for the
# nightly rails FULL lane. Mirrors register-soak-task.ps1. Script file may live in a frozen
# worktree while WorkingDir points at the MAIN checkout so .env + data/rails resolve live.
param(
  [string]$ScriptPath = "C:\Users\tonio\Projects\trading-forge\trading-forge\scripts\rails\full-lane.cjs",
  [string]$WorkingDir = "C:\Users\tonio\Projects\trading-forge\trading-forge",
  [string]$TaskName   = "TF-Rails-Full-Lane",
  [string]$At         = "10:00PM"
)
$ErrorActionPreference = "Stop"
$Node = (Get-Command node).Source
if (-not (Test-Path $ScriptPath)) { throw "full-lane not found: $ScriptPath" }
if (-not (Test-Path $WorkingDir)) { throw "working dir not found: $WorkingDir" }
$Action   = New-ScheduledTaskAction -Execute $Node -Argument "`"$ScriptPath`"" -WorkingDirectory $WorkingDir
$Trigger  = New-ScheduledTaskTrigger -Daily -At $At
# 22:00 is well clear of the soak's 03:00-09:00 window. 90-min cap kills a hung lane before soak.
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 90) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Force | Out-Null
$info = Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo
Write-Host "Registered '$TaskName' @ $At tower-local. Next run: $($info.NextRunTime)"
```

- [ ] **Step 2: Verify the script parses (no execution — registration is an operator/host step)**

Run: `powershell -NoProfile -NonInteractive -Command "[void][System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw scripts/rails/register-full-lane-task.ps1),[ref]$null); 'PARSE_OK'"`
Expected: `PARSE_OK`. (Actual `Register-ScheduledTask` runs on the tower host at land time, like the soak task.)

- [ ] **Step 3: Commit**

```bash
git commit -o scripts/rails/register-full-lane-task.ps1 \
  -m "rails-w2: schtask registration for FULL lane @ 22:00 (clear of soak 03:00-09:00)" --no-verify
```

---

### Task 6: RED-proofs (prove the guard and lane actually gate)

**Files:**
- Create: `scripts/rails/__tests__/full-lane.redproof.test.mjs`

**Interfaces:**
- Consumes: `runFullLane` (Task 3), the real `decide` via `guardOnce` (Task 2) with injected busy samples.

- [ ] **Step 1: Write RED-proof tests — every busy signal must SKIP, and forced/quiet must RUN**

```js
// scripts/rails/__tests__/full-lane.redproof.test.mjs
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
```

- [ ] **Step 2: Run — all must PASS (the guard genuinely gates)**

Run: `node --test scripts/rails/__tests__/full-lane.redproof.test.mjs`
Expected: PASS (6/6). If any busy case does NOT skip, the guard is not wired — STOP and fix before landing.

- [ ] **Step 3: Commit**

```bash
git commit -o scripts/rails/__tests__/full-lane.redproof.test.mjs \
  -m "rails-w2: RED-proofs — every busy signal SKIPs the lane; force-run overrides (6/6)" --no-verify
```

---

### Task 7: Full-suite verify, doer≠grader cert, land

**Files:** none new — verification + landing only.

- [ ] **Step 1: Run every new unit test together**

Run (from `wt-rail2`, junction node_modules first per worktree-session):
```bash
node --test scripts/lib/__tests__/rails-switch.test.mjs scripts/lib/__tests__/tower-idle-guard.test.mjs scripts/rails/__tests__/full-lane.test.mjs scripts/rails/__tests__/full-lane.redproof.test.mjs
```
Expected: all pass (5 + 5 + 6 + 6).

- [ ] **Step 2: Confirm the 3 CI hard gates + zero instrument drift**

```bash
node node_modules/typescript/bin/tsc --noEmit   # touched files are .cjs/.ps1/.md — expect no new TS errors
npm run check:production-isolation && npm run check:2026-compliance && npm run system-map:check
git diff <BASE_SHA>..HEAD -- src/engine/ ; test -z "$(git diff <BASE_SHA>..HEAD -- src/engine/)" && echo "ZERO src/engine drift"
```
Expected: gates exit 0; `ZERO src/engine drift`.

- [ ] **Step 3: Dispatch `accuracy-validator` (doer≠grader) — from-zero cert**

The validator (governed by `grading-integrity`) independently: re-runs the 4 test files; confirms the guard reuses (not re-implements) soak `decide`/`takeSample` via `require`; confirms every busy signal skips; confirms the 22:00 schtask lands clear of 03:00–09:00; confirms audit uses `decision_authority='scheduler'` and dry-run uses the separate action; confirms zero `src/engine` diff. Its report — NOT the builder's — is the completion evidence.

- [ ] **Step 4: Diff-stat tripwire + ancestry-guarded FF land**

```bash
git diff --stat <BASE_SHA>..HEAD        # expect only scripts/lib/*, scripts/rails/*, this plan doc
git fetch origin hardening/phase-0
# if origin==base → FF; elif merge-base --is-ancestor base origin → rebase-once → FF; else STOP (diverged)
git push origin HEAD:hardening/phase-0
```

- [ ] **Step 5: Operator host-step note + AGENT-LOGS + worktree cleanup**

- Operator (one-time, on the tower) runs `scripts/rails/register-full-lane-task.ps1` to arm the 22:00 lane, and (optional) seeds `system_parameters` `rails_mode`/`rails_skip_until` (absent = armed default-on, so seeding is not required to start).
- Append the §10b AGENT-LOGS entry (Wave 2 shipped, cert band from the validator).
- `git worktree remove wt-rail2` (junction cleanup first if one was created).

---

## Self-Review

**Spec coverage vs master-plan Wave 2:** (1) tower-idle guard → Tasks 1–2 (rails switch + CLI reusing soak). (2) FULL lane pytest + 2-pass PGlite replay, GPU excluded → Tasks 3–4 (`-m "not gpu"` + the real `fresh-bootstrap-migration-replay.test.ts`). (3) 22:00 nightly schtask → Task 5 (23:30 rig chain is Wave 3, explicitly out of scope). (4) RED-proofs (busy/switch/gpu matrix + forced-run) → Task 6. (5) accuracy-validator cert + nothing schedulable in 03:00–09:00 → Task 7 (22:00 is clear). Tower-idle-guard-yields-to-campaign and fail-closed semantics inherited verbatim from the reused soak `decide`.

**Placeholder scan:** none — every step has real code/commands. `<BASE_SHA>` is the one intentional fill-in (the wave-start pinned SHA), resolved at execution.

**Type consistency:** `readRailsSwitch(queryFn)→{mode,skipUntilMs}` (T1) consumed by `guardOnce.readSwitchFn` (T2). `guardOnce(...)→{action,reason,sample}` consumed by `runFullLane.guardFn` (T3). `pytestCmd/replayCmd/exitToResult` (T4) exported and tested (T4 step 1). `runFullLane` verdict enum `green|red|skipped` consistent across T3/T4/T6.
