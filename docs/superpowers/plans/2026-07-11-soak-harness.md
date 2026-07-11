# Tower Soak Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone nightly watcher that measures the Skytech tower's resource curves 3:00–9:00, self-skips when the tower is busy, and emits a deterministic verdict — proving the tower survives unattended time.

**Architecture:** External Node process (doer≠grader) launched by Windows Task Scheduler. Samples OS metrics + `/api/health` + `nvidia-smi` every 30s into incremental JSONL; at 9:00 a pure verdict engine grades against pre-registered thresholds and writes an immutable `audit_log` row. v1 is restart-free (no backend change, no migration). v2 adds `soak_runs` + Office cards at the next deploy.

**Tech Stack:** Node.js (`.cjs`, direct `postgres` client — the `real-tf-burn-today.cjs` pattern, NOT drizzle/backend imports), `nvidia-smi`, PowerShell `Get-Process`, Windows `schtasks`, Postgres (Railway).

## Global Constraints

- **RESTART-FREE v1 (HARD):** a live extraction/backtest campaign is running. v1 touches NO backend code, NO migration, NO NSSM restart. Only new standalone scripts + a `schtasks` task + direct DB reads/writes.
- **§11b worktree isolation (HARD, fail-CLOSED):** ALL work in a dedicated worktree pinned to an explicit base SHA. NEVER `git add -A` on the shared tree, NEVER `git stash`. Land FF-only at the end.
- **Standalone only:** the watcher must NOT `import`/`require` anything from `src/server/**` (that pulls heavy deps + couples the grader to the graded). Use a direct `postgres` client.
- **doer ≠ grader:** verdict is a pure function of samples; deterministic in → deterministic out; no LLM, no `Date.now()` inside the grade math (timestamps are sampled data, passed in).
- **Calibration nights 1–14 are UNGRADED** — return `CALIBRATING`, never a graded pill.
- **SKIP / INVALID never touch the green streak.**
- **Thresholds are frozen `soak_thresholds_v1`:** memory RED > 4 GB/30d, disk RED < 14 days, VRAM RED = floor ratchet, restart RED ≥ 1 crash under quiet load, heartbeat RED = gap > 2 min. GREEN: memory < 1 GB/30d, disk > 30 days.
- **schtasks uses tower-local time** = operator wall-clock (resolves the spec's open timezone item): `/st 03:00` is 3 AM on the tower.
- **Fail-closed direction for the switch = SKIP** (never run under config uncertainty; better to skip a night than disturb the tower).
- Spec of record: `docs/superpowers/specs/2026-07-11-soak-harness-design.md` (copied into the worktree in Task 1).

---

## FILE STRUCTURE

**v1 (tonight, restart-free) — all new files, no modifications:**
| File | Responsibility |
|---|---|
| `scripts/soak/soak-verdict.cjs` | PURE verdict engine: slope fit, projection, per-metric grade, night verdict, calibration guard. No I/O. |
| `scripts/soak/soak-sensors.cjs` | OS + health sampling: one `takeSample()` → a photo object. All I/O isolated here. |
| `scripts/soak/soak-guard.cjs` | Contention detection + switch reading (`system_parameters`). Returns RUN/SKIP/ABORT decision. |
| `scripts/soak/soak-watcher.cjs` | Orchestrator: loop 3:00→9:00, JSONL append, 9:00 compute + `audit_log` write + Discord. Entry point. |
| `scripts/soak/soak-skip.cjs` | CLI to flip the switch rows (`--tonight` / `--arm` / `--off` / `--status`). |
| `scripts/soak/register-soak-task.ps1` | Idempotent `schtasks` creator for the 3 AM daily trigger. |
| `scripts/soak/__tests__/soak-verdict.test.mjs` | vitest unit tests for the pure engine (the bug-critical surface). |
| `scripts/soak/__tests__/soak-guard.test.mjs` | vitest tests for guard/switch decisions (DI'd readers). |

**v2 (next deploy) — new + modifications:**
| File | Responsibility |
|---|---|
| `src/server/db/migrations/0178_soak_runs.sql` (number TBD at author time) | `soak_runs` append-only table. |
| `src/server/db/schema.ts` (modify) | `soakRuns` pgTable definition. |
| `src/server/routes/slumhouse/admin.ts` (modify) | `POST /api/slumhouse/admin/soak-switch` (arm/off/skip) + `GET .../soak-status`. |
| `src/server/services/soak-report-publish.ts` | Reads latest `soak_runs`, broadcasts SSE `soak:night-complete`, writes `system_parameters` latest-summary. |
| `public/slumhouse/office.html` (modify) | Soak Switch card (main surface) + Soak Report matter in `RR_STATE` rotation. |

---

## PHASE 1 — v1 (shippable tonight, restart-free)

### Task 1: Isolated worktree + spec/plan committed

**Files:**
- Create: worktree dir `../wt-soak` (sibling of the main checkout)
- Copy in: `docs/superpowers/specs/2026-07-11-soak-harness-design.md`, `docs/superpowers/plans/2026-07-11-soak-harness.md`

**Interfaces:** Produces the isolated workspace every later task runs in.

- [ ] **Step 1: Capture the base SHA (pin, don't track a branch)**

Run (in the main checkout `C:\Users\tonio\Projects\trading-forge\trading-forge`):
```bash
git rev-parse HEAD
```
Record the SHA. Confirm it is a sane tip: `git log -1 --oneline`.

- [ ] **Step 2: Create the worktree pinned to that SHA**

Run:
```bash
git worktree add ../wt-soak <SHA-from-step-1>
```
Expected: `Preparing worktree ... HEAD is now at <SHA>`.

- [ ] **Step 3: Create a work branch inside the worktree**

Run (in `../wt-soak`):
```bash
git switch -c soak/harness-v1
```

- [ ] **Step 4: Copy the spec + this plan into the worktree, commit explicit paths**

Copy the scratchpad spec → `docs/superpowers/specs/2026-07-11-soak-harness-design.md` and this plan → `docs/superpowers/plans/2026-07-11-soak-harness.md`.
```bash
git add docs/superpowers/specs/2026-07-11-soak-harness-design.md docs/superpowers/plans/2026-07-11-soak-harness.md
git commit -m "soak-harness: land approved spec + implementation plan"
```
Expected: 2 files committed. (Explicit paths — never `git add -A`, even in the worktree, until node_modules is confirmed junctioned per worktree-session skill.)

- [ ] **Step 5: Verify node_modules is a junction (troll-tsc guard)**

Per `worktree-session` skill: a fresh worktree may have a stub `tsc`. Run:
```bash
ls -la ../wt-soak/node_modules
```
If absent, create the junction to the main checkout's real `node_modules` (do NOT `npm install` fresh — that risks the partial-wipe crash-loop). Confirm `npx tsc --version` prints a real version, not a stub.

---

### Task 2: Pure verdict engine (`soak-verdict.cjs`) — TDD

**Files:**
- Create: `scripts/soak/soak-verdict.cjs`
- Test: `scripts/soak/__tests__/soak-verdict.test.mjs`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `linearSlopePerHour(samples)` → `{ slopeMbPerHr:number, ciHalfWidth:number }` where `samples: Array<{tMs:number, valueMb:number}>` (≥2 points; fewer → `{slopeMbPerHr:0, ciHalfWidth:Infinity}`).
  - `projectGrowthMb(slopeMbPerHr, hours)` → number.
  - `gradeMemory({slopeMbPerHr, ciHalfWidth, noiseFloorMbPerHr})` → `"GREEN"|"AMBER"|"RED"`.
  - `gradeDisk({freeBytesStart, freeBytesEnd, windowHours, totalBytes})` → `{verdict, daysToFull:number}`.
  - `gradeVram(vramFloorSeriesMb)` → `"GREEN"|"RED"|"UNAVAILABLE"` (empty/absent → UNAVAILABLE).
  - `gradeRestarts(pidSeries)` → `"GREEN"|"RED"` (any PID/startTime change → RED).
  - `gradeHeartbeat(heartbeatSeries)` → `"GREEN"|"RED"` (`heartbeatSeries: Array<{tMs, ok:boolean}>`; any gap where two consecutive `ok=false` span > 120000ms → RED).
  - `computeNightVerdict({metricGrades, nightIndex, invalidating})` → `"GREEN"|"RED"|"INVALID"|"CALIBRATING"` (nightIndex < 14 → CALIBRATING unless invalidating; invalidating truthy → INVALID; any RED → RED; else GREEN).
  - `THRESHOLDS_V1` frozen object.

- [ ] **Step 1: Write the failing tests**

```js
// scripts/soak/__tests__/soak-verdict.test.mjs
import { describe, it, expect } from "vitest";
import V from "../soak-verdict.cjs";

describe("linearSlopePerHour", () => {
  it("flat series → ~0 slope", () => {
    const s = Array.from({length: 10}, (_, i) => ({ tMs: i*60000, valueMb: 500 }));
    expect(Math.abs(V.linearSlopePerHour(s).slopeMbPerHr)).toBeLessThan(1e-6);
  });
  it("rising 60MB over 1h → +60 MB/hr", () => {
    const s = Array.from({length: 61}, (_, i) => ({ tMs: i*60000, valueMb: 500 + i }));
    expect(V.linearSlopePerHour(s).slopeMbPerHr).toBeCloseTo(60, 1);
  });
  it("<2 points → 0 slope, Infinity CI", () => {
    expect(V.linearSlopePerHour([{tMs:0,valueMb:1}])).toEqual({ slopeMbPerHr: 0, ciHalfWidth: Infinity });
  });
});

describe("projectGrowthMb", () => {
  it("5.7 MB/hr over 720h ≈ 4 GB", () => {
    expect(V.projectGrowthMb(5.7, 720)).toBeCloseTo(4104, 0);
  });
});

describe("gradeMemory (soak_thresholds_v1: <1GB/30d GREEN, >4GB/30d RED)", () => {
  it("slope below noise floor → GREEN (flat)", () => {
    expect(V.gradeMemory({ slopeMbPerHr: 3, ciHalfWidth: 5, noiseFloorMbPerHr: 4 })).toBe("GREEN");
  });
  it("confident fast rise (10 MB/hr → 7GB/30d) → RED", () => {
    expect(V.gradeMemory({ slopeMbPerHr: 10, ciHalfWidth: 1, noiseFloorMbPerHr: 2 })).toBe("RED");
  });
  it("confident moderate rise (2.5 MB/hr → ~1.8GB/30d) → AMBER", () => {
    expect(V.gradeMemory({ slopeMbPerHr: 2.5, ciHalfWidth: 0.5, noiseFloorMbPerHr: 1 })).toBe("AMBER");
  });
});

describe("gradeDisk (>30d GREEN, <14d RED)", () => {
  const GB = 1024**3;
  it("losing 1GB/6h with 100GB free → ~25 days → AMBER", () => {
    const r = V.gradeDisk({ freeBytesStart: 100*GB, freeBytesEnd: 99*GB, windowHours: 6, totalBytes: 500*GB });
    expect(r.verdict).toBe("AMBER"); expect(r.daysToFull).toBeCloseTo(25, 0);
  });
  it("losing 1GB/6h with 40GB free → 10 days → RED", () => {
    expect(V.gradeDisk({ freeBytesStart: 40*GB, freeBytesEnd: 39*GB, windowHours: 6, totalBytes: 500*GB }).verdict).toBe("RED");
  });
  it("no measurable loss → GREEN", () => {
    expect(V.gradeDisk({ freeBytesStart: 100*GB, freeBytesEnd: 100*GB, windowHours: 6, totalBytes: 500*GB }).verdict).toBe("GREEN");
  });
});

describe("gradeVram (orphan ratchet)", () => {
  it("stable floor → GREEN", () => expect(V.gradeVram([400, 402, 399, 401])).toBe("GREEN"));
  it("monotonic ratchet up → RED", () => expect(V.gradeVram([400, 900, 1500, 2100])).toBe("RED"));
  it("empty/no GPU → UNAVAILABLE", () => expect(V.gradeVram([])).toBe("UNAVAILABLE"));
});

describe("gradeRestarts", () => {
  it("stable PID → GREEN", () => expect(V.gradeRestarts([{pid:1,startMs:5},{pid:1,startMs:5}])).toBe("GREEN"));
  it("PID change under quiet load → RED", () => expect(V.gradeRestarts([{pid:1,startMs:5},{pid:2,startMs:9}])).toBe("RED"));
});

describe("gradeHeartbeat", () => {
  it("all ok → GREEN", () => expect(V.gradeHeartbeat([{tMs:0,ok:true},{tMs:60000,ok:true}])).toBe("GREEN"));
  it(">2min continuous gap → RED", () => expect(V.gradeHeartbeat([{tMs:0,ok:false},{tMs:150000,ok:false}])).toBe("RED"));
});

describe("computeNightVerdict", () => {
  const green = { memory:"GREEN", vram:"GREEN", disk:"GREEN", restarts:"GREEN", heartbeat:"GREEN" };
  it("night 3 (calibration) → CALIBRATING", () =>
    expect(V.computeNightVerdict({ metricGrades: green, nightIndex: 3, invalidating: false })).toBe("CALIBRATING"));
  it("night 20 all green → GREEN", () =>
    expect(V.computeNightVerdict({ metricGrades: green, nightIndex: 20, invalidating: false })).toBe("GREEN"));
  it("night 20 one red → RED", () =>
    expect(V.computeNightVerdict({ metricGrades: {...green, memory:"RED"}, nightIndex: 20, invalidating: false })).toBe("RED"));
  it("invalidating beats everything, even during calibration → INVALID", () =>
    expect(V.computeNightVerdict({ metricGrades: green, nightIndex: 3, invalidating: true })).toBe("INVALID"));
});
```

- [ ] **Step 2: Run to verify all fail**

Run: `npx vitest run scripts/soak/__tests__/soak-verdict.test.mjs`
Expected: FAIL — `Cannot find module ../soak-verdict.cjs`.

- [ ] **Step 3: Implement `soak-verdict.cjs`**

```js
// scripts/soak/soak-verdict.cjs — PURE. No I/O, no Date.now(), no imports.
"use strict";

const MB = 1024 * 1024;
const THRESHOLDS_V1 = Object.freeze({
  version: "soak_thresholds_v1",
  memGreen30dMb: 1024,   // <1 GB/30d projected → GREEN
  memRed30dMb: 4096,     // >4 GB/30d projected → RED
  diskGreenDays: 30,
  diskRedDays: 14,
  heartbeatGapMs: 120000,
  calibrationNights: 14,
});

function linearSlopePerHour(samples) {
  if (!Array.isArray(samples) || samples.length < 2) return { slopeMbPerHr: 0, ciHalfWidth: Infinity };
  const n = samples.length;
  const xs = samples.map(s => s.tMs / 3600000); // hours
  const ys = samples.map(s => s.valueMb);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i]-mx)**2; sxy += (xs[i]-mx)*(ys[i]-my); }
  if (sxx === 0) return { slopeMbPerHr: 0, ciHalfWidth: Infinity };
  const slope = sxy / sxx;
  // residual std error of slope → 95% CI half-width (t≈1.96 for large n)
  let sse = 0;
  const intercept = my - slope * mx;
  for (let i = 0; i < n; i++) { const yhat = intercept + slope * xs[i]; sse += (ys[i]-yhat)**2; }
  const seSlope = n > 2 ? Math.sqrt((sse / (n - 2)) / sxx) : Infinity;
  return { slopeMbPerHr: slope, ciHalfWidth: 1.96 * seSlope };
}

function projectGrowthMb(slopeMbPerHr, hours) { return slopeMbPerHr * hours; }

function gradeMemory({ slopeMbPerHr, ciHalfWidth, noiseFloorMbPerHr }) {
  // Only grade if the slope is confidently above the calibrated noise floor.
  const confidentlyRising = (slopeMbPerHr - ciHalfWidth) > noiseFloorMbPerHr;
  if (!confidentlyRising) return "GREEN"; // indistinguishable from flat
  const proj30d = projectGrowthMb(slopeMbPerHr, 720);
  if (proj30d > THRESHOLDS_V1.memRed30dMb) return "RED";
  if (proj30d < THRESHOLDS_V1.memGreen30dMb) return "GREEN";
  return "AMBER";
}

function gradeDisk({ freeBytesStart, freeBytesEnd, windowHours }) {
  const lostBytes = freeBytesStart - freeBytesEnd;
  if (lostBytes <= 0) return { verdict: "GREEN", daysToFull: Infinity };
  const bytesPerHr = lostBytes / windowHours;
  const daysToFull = (freeBytesEnd / bytesPerHr) / 24;
  let verdict = "AMBER";
  if (daysToFull >= THRESHOLDS_V1.diskGreenDays) verdict = "GREEN";
  else if (daysToFull < THRESHOLDS_V1.diskRedDays) verdict = "RED";
  return { verdict, daysToFull };
}

function gradeVram(vramFloorSeriesMb) {
  if (!Array.isArray(vramFloorSeriesMb) || vramFloorSeriesMb.length === 0) return "UNAVAILABLE";
  const first = vramFloorSeriesMb[0];
  const last = vramFloorSeriesMb[vramFloorSeriesMb.length - 1];
  // Ratchet: floor grew by >50% AND >256MB over the window with no return.
  if (last - first > 256 && last > first * 1.5) return "RED";
  return "GREEN";
}

function gradeRestarts(pidSeries) {
  for (let i = 1; i < pidSeries.length; i++) {
    if (pidSeries[i].pid !== pidSeries[i-1].pid || pidSeries[i].startMs !== pidSeries[i-1].startMs) return "RED";
  }
  return "GREEN";
}

function gradeHeartbeat(heartbeatSeries) {
  for (let i = 1; i < heartbeatSeries.length; i++) {
    const a = heartbeatSeries[i-1], b = heartbeatSeries[i];
    if (!a.ok && !b.ok && (b.tMs - a.tMs) > THRESHOLDS_V1.heartbeatGapMs) return "RED";
  }
  return "GREEN";
}

function computeNightVerdict({ metricGrades, nightIndex, invalidating }) {
  if (invalidating) return "INVALID";
  if (nightIndex < THRESHOLDS_V1.calibrationNights) return "CALIBRATING";
  const grades = Object.values(metricGrades);
  if (grades.includes("RED")) return "RED";
  return "GREEN";
}

module.exports = {
  THRESHOLDS_V1, linearSlopePerHour, projectGrowthMb,
  gradeMemory, gradeDisk, gradeVram, gradeRestarts, gradeHeartbeat, computeNightVerdict, MB,
};
```

- [ ] **Step 4: Run to verify all pass**

Run: `npx vitest run scripts/soak/__tests__/soak-verdict.test.mjs`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add scripts/soak/soak-verdict.cjs scripts/soak/__tests__/soak-verdict.test.mjs
git commit -m "soak-harness: pure verdict engine + frozen soak_thresholds_v1 (TDD)"
```

---

### Task 3: Sensors module (`soak-sensors.cjs`)

**Files:** Create `scripts/soak/soak-sensors.cjs`

**Interfaces:**
- Consumes: `fetch` (Node 18+ global) for `/api/health`; `child_process.execFileSync` for `nvidia-smi` + PowerShell.
- Produces: `takeSample({ healthUrl, processNames })` → Promise<`Sample`> where
  `Sample = { tMs:number, procs: Record<string,{pid:number|null, rssMb:number|null, handles:number|null, startMs:number|null}>, vramUsedMb:number|null, gpuUtil:number|null, diskFreeBytes:number|null, health:{ok:boolean, latencyMs:number|null, backtestsActive:number|null} }`.
  `tMs` is the absolute epoch ms of the sample (used only as the x-axis; the verdict engine never calls the clock itself).

- [ ] **Step 1: Implement sensors (thin, all I/O here, every probe fail-soft to null)**

```js
// scripts/soak/soak-sensors.cjs
"use strict";
const { execFileSync } = require("child_process");

function safeExec(cmd, args) {
  try { return execFileSync(cmd, args, { encoding: "utf-8", timeout: 8000 }).trim(); }
  catch { return null; }
}

function readGpu() {
  const out = safeExec("nvidia-smi", ["--query-gpu=utilization.gpu,memory.used", "--format=csv,noheader,nounits"]);
  if (!out) return { vramUsedMb: null, gpuUtil: null };
  const [util, mem] = out.split(",").map(s => parseFloat(s.trim()));
  return { vramUsedMb: Number.isFinite(mem) ? mem : null, gpuUtil: Number.isFinite(util) ? util : null };
}

function readProcs(processNames) {
  // Single PowerShell call returns all matching processes as JSON.
  const psExpr =
    "Get-Process -Name " + processNames.map(n => `'${n}'`).join(",") +
    " -ErrorAction SilentlyContinue | Select-Object Name,Id,@{n='RssMb';e={[math]::Round($_.WorkingSet64/1MB)}},HandleCount,@{n='StartMs';e={[int64]($_.StartTime - (Get-Date '1970-01-01')).TotalMilliseconds}} | ConvertTo-Json -Compress";
  const out = safeExec("powershell", ["-NoProfile", "-NonInteractive", "-Command", psExpr]);
  const byName = {};
  for (const n of processNames) byName[n] = { pid: null, rssMb: null, handles: null, startMs: null };
  if (!out) return byName;
  let rows; try { rows = JSON.parse(out); } catch { return byName; }
  if (!Array.isArray(rows)) rows = [rows];
  for (const r of rows) {
    // First match per name wins (the backend is one process; workers may be many — name maps to representative).
    if (byName[r.Name] && byName[r.Name].pid === null) {
      byName[r.Name] = { pid: r.Id ?? null, rssMb: r.RssMb ?? null, handles: r.HandleCount ?? null, startMs: r.StartMs ?? null };
    }
  }
  return byName;
}

function readDiskFree() {
  const out = safeExec("powershell", ["-NoProfile","-NonInteractive","-Command",
    "(Get-PSDrive C).Free"]);
  const n = out ? parseInt(out, 10) : NaN;
  return Number.isFinite(n) ? n : null;
}

async function readHealth(healthUrl) {
  const started = Date.now();
  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(8000) });
    const latencyMs = Date.now() - started;
    if (!res.ok) return { ok: false, latencyMs, backtestsActive: null };
    const body = await res.json();
    const active = body?.backtestConcurrency?.active;
    return { ok: true, latencyMs, backtestsActive: Number.isFinite(active) ? active : null };
  } catch { return { ok: false, latencyMs: null, backtestsActive: null }; }
}

async function takeSample({ healthUrl, processNames, nowMs }) {
  const gpu = readGpu();
  return {
    tMs: nowMs ?? Date.now(),
    procs: readProcs(processNames),
    vramUsedMb: gpu.vramUsedMb,
    gpuUtil: gpu.gpuUtil,
    diskFreeBytes: readDiskFree(),
    health: await readHealth(healthUrl),
  };
}

module.exports = { takeSample, readGpu, readProcs, readDiskFree, readHealth };
```

- [ ] **Step 2: Smoke-run against the live tower (read-only, safe)**

Run:
```bash
node -e "require('./scripts/soak/soak-sensors.cjs').takeSample({healthUrl:'http://localhost:4000/api/health', processNames:['node','ollama']}).then(s=>console.log(JSON.stringify(s,null,2)))"
```
Expected: JSON with real `rssMb` for node, a `vramUsedMb` number (ollama loaded), `diskFreeBytes`, and `health.backtestsActive` reflecting the running campaign (likely ≥1 right now — that's the contention signal working). **Wiring checklist items 1 + 8 confirmed here.**

- [ ] **Step 3: Commit**

```bash
git add scripts/soak/soak-sensors.cjs
git commit -m "soak-harness: OS + health sensors (fail-soft to null)"
```

---

### Task 4: Contention guard + switch reader (`soak-guard.cjs`) — TDD

**Files:** Create `scripts/soak/soak-guard.cjs`, `scripts/soak/__tests__/soak-guard.test.mjs`

**Interfaces:**
- Consumes: a DI'd `readSwitch()` → `{ mode:"armed"|"off"|null, skipUntilMs:number|null }` and a `sample` (from Task 3).
- Produces: `decide({ sample, sw, gpuBusyPct, nowMs })` → `{ action:"RUN"|"SKIP"|"ABORT", reason:string }`.
  Rules (order): switch `off` → SKIP; `skipUntilMs > nowMs` → SKIP; switch read failed (`mode===null`) → SKIP (fail-closed); `health.ok===false` at startup → SKIP(`backend_unreachable`); `backtestsActive>0` → SKIP/ABORT(`backtests_active`); `gpuUtil>gpuBusyPct` → SKIP/ABORT(`gpu_busy`). (Caller decides SKIP at startup vs ABORT mid-run by passing `phase`.)

- [ ] **Step 1: Write failing tests**

```js
// scripts/soak/__tests__/soak-guard.test.mjs
import { describe, it, expect } from "vitest";
import G from "../soak-guard.cjs";

const base = { sample: { health:{ok:true,backtestsActive:0}, gpuUtil:5 }, sw:{mode:"armed",skipUntilMs:null}, gpuBusyPct:25, nowMs:1000, phase:"startup" };

describe("decide", () => {
  it("quiet + armed → RUN", () => expect(G.decide(base).action).toBe("RUN"));
  it("switch off → SKIP", () => expect(G.decide({...base, sw:{mode:"off",skipUntilMs:null}}).reason).toBe("switch_off"));
  it("skip_until in future → SKIP", () => expect(G.decide({...base, sw:{mode:"armed",skipUntilMs:5000}}).reason).toBe("skip_requested"));
  it("switch read failed → SKIP (fail-closed)", () => expect(G.decide({...base, sw:{mode:null,skipUntilMs:null}}).reason).toBe("switch_unreadable"));
  it("backend down at startup → SKIP", () => expect(G.decide({...base, sample:{health:{ok:false,backtestsActive:null},gpuUtil:5}}).reason).toBe("backend_unreachable"));
  it("backtests active → SKIP at startup", () => expect(G.decide({...base, sample:{health:{ok:true,backtestsActive:2},gpuUtil:5}}).reason).toBe("backtests_active"));
  it("backtests active → ABORT mid-run", () => expect(G.decide({...base, phase:"midrun", sample:{health:{ok:true,backtestsActive:2},gpuUtil:5}}).action).toBe("ABORT"));
  it("gpu busy → SKIP", () => expect(G.decide({...base, sample:{health:{ok:true,backtestsActive:0},gpuUtil:80}}).reason).toBe("gpu_busy"));
});
```

- [ ] **Step 2: Run — verify fail.** `npx vitest run scripts/soak/__tests__/soak-guard.test.mjs` → FAIL (module missing).

- [ ] **Step 3: Implement**

```js
// scripts/soak/soak-guard.cjs
"use strict";
function decide({ sample, sw, gpuBusyPct, nowMs, phase }) {
  const busyAction = phase === "midrun" ? "ABORT" : "SKIP";
  if (!sw || sw.mode === null) return { action: "SKIP", reason: "switch_unreadable" };
  if (sw.mode === "off") return { action: "SKIP", reason: "switch_off" };
  if (sw.skipUntilMs && sw.skipUntilMs > nowMs) return { action: "SKIP", reason: "skip_requested" };
  if (!sample.health || sample.health.ok === false) return { action: busyAction, reason: "backend_unreachable" };
  if ((sample.health.backtestsActive ?? 0) > 0) return { action: busyAction, reason: "backtests_active" };
  if ((sample.gpuUtil ?? 0) > gpuBusyPct) return { action: busyAction, reason: "gpu_busy" };
  return { action: "RUN", reason: "quiet" };
}
module.exports = { decide };
```

- [ ] **Step 4: Run — verify pass.** Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add scripts/soak/soak-guard.cjs scripts/soak/__tests__/soak-guard.test.mjs
git commit -m "soak-harness: contention guard + fail-closed switch decision (TDD)"
```

---

### Task 5: Watcher orchestrator (`soak-watcher.cjs`)

**Files:** Create `scripts/soak/soak-watcher.cjs`

**Interfaces:**
- Consumes: `soak-sensors`, `soak-guard`, `soak-verdict`, `postgres` (direct client), `.env` (`DATABASE_URL`, `SOAK_HEALTH_URL` default `http://localhost:4000/api/health`, `SOAK_GPU_BUSY_PCT` default `25`, `SOAK_WINDOW_MIN` default `360`, `SOAK_SAMPLE_SEC` default `30`, `SOAK_DATA_DIR` default `./data/soak`, `DISCORD_WEBHOOK_URL` best-effort).
- Produces: JSONL at `${SOAK_DATA_DIR}/soak-<YYYYMMDD>.jsonl`; one `audit_log` INSERT `action='soak.night_completed'`; the switch rows read via `readSwitch()`.
- Reads `system_parameters` rows: `soak_mode` (current_value `armed`/`off`) and `soak_skip_until` (current_value epoch-ms string). `nightIndex` = count of prior `audit_log` rows with `action='soak.night_completed'`.

- [ ] **Step 1: Implement the orchestrator**

```js
// scripts/soak/soak-watcher.cjs
"use strict";
require("dotenv/config");
const fs = require("fs");
const path = require("path");
const postgres = require("postgres");
const { takeSample } = require("./soak-sensors.cjs");
const { decide } = require("./soak-guard.cjs");
const V = require("./soak-verdict.cjs");

const CFG = {
  healthUrl: process.env.SOAK_HEALTH_URL || "http://localhost:4000/api/health",
  gpuBusyPct: Number(process.env.SOAK_GPU_BUSY_PCT || 25),
  windowMin: Number(process.env.SOAK_WINDOW_MIN || 360),
  sampleSec: Number(process.env.SOAK_SAMPLE_SEC || 30),
  dataDir: process.env.SOAK_DATA_DIR || path.join(process.cwd(), "data", "soak"),
  procNames: ["node", "ollama", "python"],
  recheckEverySec: 300,
  dryRun: process.argv.includes("--dry-run"),
};

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

async function readSwitch() {
  try {
    const rows = await sql`SELECT param_name, current_value FROM system_parameters WHERE param_name IN ('soak_mode','soak_skip_until')`;
    const m = {}; for (const r of rows) m[r.param_name] = r.current_value;
    return { mode: m.soak_mode ?? "armed", skipUntilMs: m.soak_skip_until ? Number(m.soak_skip_until) : null };
  } catch { return { mode: null, skipUntilMs: null }; } // fail-closed → guard SKIPs
}

async function nightIndex() {
  try { const [r] = await sql`SELECT count(*)::int AS n FROM audit_log WHERE action='soak.night_completed'`; return r.n; }
  catch { return 0; }
}

async function writeAudit(payload) {
  // audit_log is append-only (migration 0058 trigger). INSERT only.
  await sql`INSERT INTO audit_log (action, status, result, created_at)
            VALUES ('soak.night_completed', ${payload.verdict === 'RED' ? 'warning' : 'info'}, ${sql.json(payload)}, now())`;
}

async function discord(msg) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;
  try { await fetch(url, { method:"POST", headers:{'Content-Type':'application/json'}, body: JSON.stringify({ content: msg }) }); } catch {}
}

function appendJsonl(file, obj) { fs.appendFileSync(file, JSON.stringify(obj) + "\n"); }

async function main() {
  fs.mkdirSync(CFG.dataDir, { recursive: true });
  const startMs = Date.now();
  const stamp = new Date(startMs).toISOString().slice(0,10).replace(/-/g,"");
  const jsonl = path.join(CFG.dataDir, `soak-${stamp}.jsonl`);
  const idx = await nightIndex();

  // Startup guard
  const first = await takeSample({ healthUrl: CFG.healthUrl, processNames: CFG.procNames });
  const sw0 = await readSwitch();
  const g0 = decide({ sample: first, sw: sw0, gpuBusyPct: CFG.gpuBusyPct, nowMs: Date.now(), phase: "startup" });
  if (g0.action !== "RUN") {
    appendJsonl(jsonl, { type:"skip", reason:g0.reason, tMs:startMs, nightIndex:idx });
    await writeAudit({ outcome:"SKIPPED", reason:g0.reason, verdict:"SKIPPED", nightIndex:idx, thresholds:V.THRESHOLDS_V1.version });
    await discord(`⚪ Tower Soak SKIPPED — ${g0.reason}`);
    await sql.end(); return;
  }
  appendJsonl(jsonl, { type:"start", tMs:startMs, nightIndex:idx, sample:first });

  const samples = [first];
  const windowMs = CFG.windowMin * 60000;
  const stepMs = (CFG.dryRun ? 2 : CFG.sampleSec) * 1000;
  const effectiveWindow = CFG.dryRun ? 180000 : windowMs; // 3-min dry-run
  let lastRecheck = startMs;
  let aborted = null;

  while (Date.now() - startMs < effectiveWindow) {
    await new Promise(r => setTimeout(r, stepMs));
    const s = await takeSample({ healthUrl: CFG.healthUrl, processNames: CFG.procNames });
    samples.push(s);
    appendJsonl(jsonl, { type:"sample", tMs:s.tMs, sample:s });
    if (Date.now() - lastRecheck >= CFG.recheckEverySec * 1000 || CFG.dryRun) {
      lastRecheck = Date.now();
      const sw = await readSwitch();
      const g = decide({ sample: s, sw, gpuBusyPct: CFG.gpuBusyPct, nowMs: Date.now(), phase: "midrun" });
      if (g.action === "ABORT") { aborted = g.reason; break; }
    }
  }

  // Build metric series + grade
  const memSeries = samples.filter(s => s.procs.node?.rssMb != null).map(s => ({ tMs: s.tMs - startMs, valueMb: s.procs.node.rssMb }));
  const slope = V.linearSlopePerHour(memSeries);
  const noiseFloor = Number(process.env.SOAK_MEM_NOISE_FLOOR_MBH || 8); // provisional until calibration re-baselines
  const vramFloor = samples.map(s => s.vramUsedMb).filter(v => v != null);
  const pidSeries = samples.filter(s => s.procs.node?.pid != null).map(s => ({ pid: s.procs.node.pid, startMs: s.procs.node.startMs }));
  const hbSeries = samples.map(s => ({ tMs: s.tMs - startMs, ok: !!s.health.ok }));
  const diskStart = samples[0].diskFreeBytes, diskEnd = samples[samples.length-1].diskFreeBytes;
  const windowHours = (samples[samples.length-1].tMs - samples[0].tMs) / 3600000;

  const invalidating = aborted || samples.length < (CFG.dryRun ? 3 : 0.8 * (windowMs / stepMs));
  const metricGrades = {
    memory: V.gradeMemory({ slopeMbPerHr: slope.slopeMbPerHr, ciHalfWidth: slope.ciHalfWidth, noiseFloorMbPerHr: noiseFloor }),
    vram: V.gradeVram(vramFloor),
    disk: (diskStart!=null && diskEnd!=null) ? V.gradeDisk({ freeBytesStart:diskStart, freeBytesEnd:diskEnd, windowHours }).verdict : "UNAVAILABLE",
    restarts: V.gradeRestarts(pidSeries),
    heartbeat: V.gradeHeartbeat(hbSeries),
  };
  const verdict = V.computeNightVerdict({ metricGrades, nightIndex: idx, invalidating });

  const payload = {
    outcome: invalidating ? "INVALID" : "RAN",
    verdict, nightIndex: idx, aborted, thresholds: V.THRESHOLDS_V1.version,
    memSlopeMbPerHr: Number(slope.slopeMbPerHr.toFixed(2)), memCi: Number(slope.ciHalfWidth.toFixed(2)),
    proj30dMb: Number(V.projectGrowthMb(slope.slopeMbPerHr, 720).toFixed(0)),
    metricGrades, sampleCount: samples.length, windowHours: Number(windowHours.toFixed(2)),
    buildSha: process.env.SOAK_BUILD_SHA || null,
  };
  appendJsonl(jsonl, { type:"verdict", tMs: Date.now(), ...payload });
  await writeAudit(payload);
  const pill = { GREEN:"🟢", RED:"🔴", INVALID:"🟠", CALIBRATING:"⚪", SKIPPED:"⚪" }[verdict] || "⚪";
  await discord(`${pill} Tower Soak ${verdict} — mem ${payload.memSlopeMbPerHr}MB/h (→${payload.proj30dMb}MB/30d) · disk ${metricGrades.disk} · restarts ${metricGrades.restarts} · n=${payload.sampleCount}`);
  await sql.end();
}

main().catch(async e => { try { await discord(`🔴 Tower Soak watcher crashed: ${String(e).slice(0,180)}`); } catch {} process.exitCode = 1; });
```

- [ ] **Step 2: Dry-run end-to-end (3-min compressed cycle, real tower)**

Run: `node scripts/soak/soak-watcher.cjs --dry-run`
Expected: creates `data/soak/soak-<date>.jsonl`, samples every 2s for ~3 min, writes ONE `audit_log` row, prints/pushes a Discord pill. Because the campaign is running, this will most likely emit `SKIPPED — backtests_active` (proving the guard fires correctly). To force a full RUN cycle for observation, temporarily point `SOAK_HEALTH_URL` at a mock or run when the campaign is idle.

- [ ] **Step 3: Verify the audit row landed**

Run: `node -e "const p=require('postgres');const s=p(process.env.DATABASE_URL,{max:1});s\`SELECT action,status,result FROM audit_log WHERE action='soak.night_completed' ORDER BY created_at DESC LIMIT 1\`.then(r=>{console.log(JSON.stringify(r[0],null,2));return s.end();})" `
Expected: the JSON payload with `outcome`, `verdict`, `metricGrades`. **Wiring checklist item 3 confirmed.**

- [ ] **Step 4: Commit**
```bash
git add scripts/soak/soak-watcher.cjs
git commit -m "soak-harness: watcher orchestrator (JSONL + audit_log, dry-run verified)"
```

---

### Task 6: Switch CLI (`soak-skip.cjs`)

**Files:** Create `scripts/soak/soak-skip.cjs`

**Interfaces:** Consumes `postgres`. `--status` prints current rows; `--tonight` sets `soak_skip_until` = next 09:00 tower-local epoch-ms; `--off` sets `soak_mode='off'`; `--arm` sets `soak_mode='armed'` and clears skip. Idempotent UPSERT on `param_name`.

- [ ] **Step 1: Implement**

```js
// scripts/soak/soak-skip.cjs
"use strict";
require("dotenv/config");
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

async function upsert(name, value) {
  await sql`INSERT INTO system_parameters (param_name, current_value)
            VALUES (${name}, ${value})
            ON CONFLICT (param_name) DO UPDATE SET current_value = EXCLUDED.current_value`;
}
function next9amMs() {
  const d = new Date(); const n = new Date(d);
  n.setHours(9,0,0,0); if (n <= d) n.setDate(n.getDate()+1);
  return n.getTime();
}
(async () => {
  const arg = process.argv[2];
  if (arg === "--status") {
    const rows = await sql`SELECT param_name, current_value FROM system_parameters WHERE param_name IN ('soak_mode','soak_skip_until')`;
    console.log(rows); await sql.end(); return;
  }
  if (arg === "--tonight") { await upsert("soak_skip_until", String(next9amMs())); console.log("Soak skipped until 09:00."); }
  else if (arg === "--off") { await upsert("soak_mode", "off"); console.log("Soak OFF."); }
  else if (arg === "--arm") { await upsert("soak_mode", "armed"); await upsert("soak_skip_until", "0"); console.log("Soak ARMED."); }
  else console.log("usage: soak-skip.cjs --status|--tonight|--off|--arm");
  await sql.end();
})();
```

**NOTE (confirm at author time):** `system_parameters` may have a NOT NULL `id`/`param_id` or additional required columns (schema.ts:1411). If the bare INSERT fails, add the required columns (e.g. `id = gen_random_uuid()`) — confirm the exact column set first with `\d system_parameters` or reading schema.ts:1411-1428. **Wiring checklist item 2.**

- [ ] **Step 2: Verify round-trip**
```bash
node scripts/soak/soak-skip.cjs --arm && node scripts/soak/soak-skip.cjs --status
```
Expected: shows `soak_mode=armed`, `soak_skip_until=0`.

- [ ] **Step 3: Commit**
```bash
git add scripts/soak/soak-skip.cjs
git commit -m "soak-harness: operator switch CLI (arm/off/tonight/status)"
```

---

### Task 7: Task Scheduler registration (`register-soak-task.ps1`)

**Files:** Create `scripts/soak/register-soak-task.ps1`

- [ ] **Step 1: Implement idempotent registration**

```powershell
# scripts/soak/register-soak-task.ps1  — run once (elevated not required for /sc DAILY under current user)
$ErrorActionPreference = "Stop"
$TaskName = "TF-Tower-Soak"
$Node = (Get-Command node).Source
$Script = Join-Path $PSScriptRoot "soak-watcher.cjs"
$WorkDir = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent  # repo root
$Action  = New-ScheduledTaskAction -Execute $Node -Argument "`"$Script`"" -WorkingDirectory $WorkDir
$Trigger = New-ScheduledTaskTrigger -Daily -At 3:00AM
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 7)
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Force
Write-Host "Registered $TaskName @ 3:00AM tower-local. Next run:" (Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo).NextRunTime
```

- [ ] **Step 2: Register + verify (does NOT run it now)**
```bash
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/soak/register-soak-task.ps1
```
Expected: prints `NextRunTime` = tomorrow 03:00. `StartWhenAvailable` means a missed 3am (tower asleep) runs at wake. `ExecutionTimeLimit 7h` kills a hung watcher.

- [ ] **Step 3: Commit**
```bash
git add scripts/soak/register-soak-task.ps1
git commit -m "soak-harness: Task Scheduler 3AM daily trigger (idempotent)"
```

---

### Task 8: v1 verification + land

- [ ] **Step 1: Full unit suite green**

Run: `npx vitest run scripts/soak/__tests__/`
Expected: all verdict + guard tests PASS.

- [ ] **Step 2: tsc/lint sanity (touched files only — .cjs are not type-checked, but confirm no repo-wide break)**

Run: `npx tsc --noEmit` — expected: no NEW errors attributable to soak files (they're `.cjs`, excluded from the TS graph; confirm the count didn't rise vs baseline).

- [ ] **Step 3: Arm the switch + confirm scheduled**
```bash
node scripts/soak/soak-skip.cjs --arm
powershell -NoProfile -Command "(Get-ScheduledTask -TaskName 'TF-Tower-Soak' | Get-ScheduledTaskInfo).NextRunTime"
```

- [ ] **Step 4: Land v1 FF-only (per §11b + worktree-session)**

```bash
git -C ../wt-soak log --oneline soak/harness-v1
# In main checkout, capture current tip, then FF:
git fetch . soak/harness-v1
git merge --ff-only soak/harness-v1   # if FF impossible, re-verify diff applies, then integrate — never blind-merge
```
Then per §11a commit-and-push discipline: push the branch. **Do NOT remove the worktree yet** — v2 continues in it.

---

## PHASE 2 — v2 (next natural deploy; needs one backend restart)

> Gate: run Phase 2 only AFTER the extraction/backtest campaign has finished and a deploy window is available. Each task still in the `../wt-soak` worktree.

### Task 9: `soak_runs` migration (INVOKE `migration-author` skill first)

**Files:** Create `src/server/db/migrations/<NNNN>_soak_runs.sql` + `meta/_journal.json` entry; modify `src/server/db/schema.ts`.

- [ ] **Step 1:** Invoke the `migration-author` skill (BOM safety, idempotency, journal `when` collision). Determine the next migration number by reading the latest in `meta/_journal.json`.
- [ ] **Step 2:** Write idempotent DDL:
```sql
-- <NNNN>_soak_runs.sql (append-only nightly ledger)
CREATE TABLE IF NOT EXISTS soak_runs (
  id            bigserial PRIMARY KEY,
  ran_on        date NOT NULL,
  outcome       text NOT NULL,            -- RAN | SKIPPED | INVALID
  verdict       text NOT NULL,            -- GREEN | RED | INVALID | CALIBRATING | SKIPPED
  build_sha     text,
  metric_grades jsonb NOT NULL DEFAULT '{}'::jsonb,
  mem_slope_mb_per_hr numeric,
  proj_30d_mb   numeric,
  sample_count  integer,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_soak_runs_ran_on_desc ON soak_runs (ran_on DESC);
```
- [ ] **Step 3:** Add `soakRuns` pgTable to `schema.ts` mirroring the columns. Run `npm run db:generate` guard / confirm no drift. Commit.

### Task 10: Watcher dual-writes `soak_runs` + SSE publish

- [ ] Extend `soak-watcher.cjs` `writeAudit()` to ALSO `INSERT INTO soak_runs (...)` (guarded: skip gracefully if table absent → keeps v1 forward-compatible). Add `scripts/soak/soak-report-publish` or reuse: after insert, `POST` an internal SSE-trigger endpoint OR write `system_parameters.soak_latest_summary`. Confirm the SSE broadcast pattern in `src/server/routes/sse.ts` (mirror `nightly:review-complete`). **Wiring checklist items 4, 6.** Commit.

### Task 11: Slumhouse admin route for the switch

- [ ] Add `POST /api/slumhouse/admin/soak-switch` (body `{action:'arm'|'off'|'skip_tonight'}`) + `GET /api/slumhouse/admin/soak-status` to `src/server/routes/slumhouse/admin.ts`, reusing the existing admin-session-cookie guard. Route writes the same `system_parameters` rows the CLI does. **Wiring checklist item 7.** Add vitest. Commit.

### Task 12: Office Soak Switch card

- [ ] Add the control card to `public/slumhouse/office.html` main surface: ARMED/OFF state, 7-dot strip (fetch `GET .../soak-status` → last 7 `soak_runs`), `Skip Tonight` primary button, two-tap OFF with amber badge. Match existing glassy-card styling. Commit.

### Task 13: Reporting Room Soak Report card

- [ ] Inject a soak "matter" into `RR_STATE.reports` rotation in `office.html`: 4 verdict lines + 14-night sparkline + night pill chip in the picker. Only RAN/INVALID/RED nights render; skipped nights don't. Tower-level (account-tab independent). **Wiring checklist item 5.** Commit.

### Task 14: v2 verification + land

- [ ] `npx vitest run` (new route + any card logic tests) green.
- [ ] `npm run check:production-isolation && npm run check:2026-compliance && npm run system-map:check` — all exit 0.
- [ ] `npm run system-map:sync` (new subsystem registered) + write `system_map.synced` audit row.
- [ ] Land FF-only per §11b. Deploy (backend restart applies migration 0-downtime via boot-migration runner). `git worktree remove ../wt-soak`.
- [ ] Append AGENT-LOGS.md session entry (§10b HARD RULE).

---

## SELF-REVIEW (run after writing; fix inline)

**Spec coverage:** §4 architecture → Tasks 2-5. §5 sensors → Task 3. §6 guard+switch → Tasks 4,6. §7 verdict/calibration → Task 2. §9 persistence → Task 5 (JSONL+audit) + Task 9/10 (soak_runs). §10 cards → Tasks 12,13. §11 error matrix → Task 5 (skip/abort/unreachable paths) + Task 4 (fail-closed). §12 isolation → Task 1; migration-author → Task 9; ratify determination = observability, not gated (spec §12). §13 testing → Tasks 2,4 (TDD) + dry-run Task 5. §14 wiring checklist → items mapped inline (1,8 Task3; 3 Task5; 2 Task6; 4,6 Task10; 7 Task11; 5 Task13; 9 constants in verdict). All covered.

**Placeholder scan:** migration number is `<NNNN>` — intentional, resolved by migration-author reading `_journal.json` (Task 9 Step 1). `system_parameters` exact column set flagged for confirmation (Task 6 note) — an explicit verification step, not a hidden gap. No other TBDs.

**Type consistency:** `Sample` shape produced by Task 3 `takeSample` is consumed identically in Task 5 (`s.procs.node.rssMb`, `s.vramUsedMb`, `s.health.backtestsActive`). Verdict fn names (`linearSlopePerHour`, `gradeMemory`, `computeNightVerdict`) identical between Task 2 definition and Task 5 usage. Guard `decide({sample,sw,gpuBusyPct,nowMs,phase})` identical Task 4 ↔ Task 5. Switch rows `soak_mode`/`soak_skip_until` identical across Tasks 5,6,11. Consistent.
