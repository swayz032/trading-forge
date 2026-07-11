# Hardening Rails — Plan 1: CI Fast Lane + Divergence Alarm + Worktree TTL

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first two rails from `docs/hardening-machine-rails-2026-07-11.md`: a self-hosted WSL2 GitHub Actions FAST lane that verdicts every push (tsc + 3 hard gates + parity checks + full vitest + fast pytest against a baseline-failure manifest), plus the standalone branch-divergence alarm and weekly worktree-TTL report.

**Architecture:** Soak-harness mold throughout — external standalone watchers (doer≠grader), pure DI-tested decision functions, fail-closed on uncertainty, JSONL + audit_log persistence, plain-English Discord output. CI runs inside a resource-capped WSL2 sandbox (≤8 GB / 4 cores) so it can never contend with agent campaign work; the alarm/TTL scripts are one-git-command lightweights that need no tower-idle guard.

**Tech Stack:** GitHub Actions (self-hosted runner in WSL2 Ubuntu), Node ≥20 `.cjs`/`.mjs` standalone scripts (no build step), vitest JSON reporter, pytest junitxml, `schtasks` for scheduling, direct `postgres` client for audit rows (mirror `wt-soak/scripts/soak/soak-watcher.cjs`).

## Global Constraints

- **Phase:** Production Hardening — this plan adds ZERO trading logic and touches ZERO instrument code (no ratify packet needed; verify no file under `src/engine/` or gate/sizing/classifier paths is modified).
- **Worktree isolation (§11b, fail-CLOSED):** all repo edits happen in an isolated worktree pinned to an explicit base SHA. Junction node_modules (`New-Item -ItemType Junction`), run REAL binaries (`node node_modules/typescript/bin/tsc --noEmit` — NEVER `npx tsc`), never `git stash`, land FF-only, diff-stat tripwire before push, junction removed reparse-safe (`[System.IO.Directory]::Delete($path, $false)`).
- **Commit discipline (§11a):** commit + push after every GREEN task. Inside the isolated worktree `git add -A` is allowed; on the shared tree only `git commit -o <paths>`.
- **3 CI hard gates green before landing:** `npm run check:production-isolation`, `npm run check:2026-compliance`, `npm run system-map:check`.
- **No production secrets in GitHub Actions.** The runner checkout never receives `.env`. Discord/DB credentials are used only by tower-side standalone scripts reading the tower's own `.env`.
- **No GPU use in CI.** The WSL2 runner has no GPU passthrough; any test needing one is quarantined in the baseline manifest with a reason.
- **WSL2 caps mandatory before first CI job:** `%UserProfile%\.wslconfig` with `memory=8GB`, `processors=4`.
- **Soak-mold rules:** thresholds/manifests are versioned files, frozen once green (changes are dated commits, never silent); every watcher fails closed (uncertainty → don't run / don't alert-spam → one plain-English Discord line); JSONL ledgers live under gitignored `data/`.
- **Scheduling dead zone:** nothing from this plan schedules inside 03:00–09:00 tower-local (soak quiet window). Alarm 10:00, TTL Sunday 10:15 — both daytime lightweights.
- **New scripts live in `scripts/rails/` and `ci/`** — standalone `.cjs`/`.mjs`, CommonJS/ESM per extension, no imports from `src/server/` (they must run without the backend).
- **audit_log shape:** columns are `action, entity_type, entity_id, input, result, status, ...` — NO `payload` column, `status` NOT NULL, `entity_id` must be a UUID or NULL (use `input`/`result` JSONB; never a non-UUID string in `entity_id`).

## Program index (later plans, authored at their session start via writing-plans)

- Plan 2: tower-idle guard shared module (vendored `decide()` from `wt-soak/scripts/soak/soak-guard.cjs`) + CI FULL lane + nightly sequence orchestrator (22:00 FULL → 23:30 rig slot).
- Plan 3: nightly certification rig v1 (pinned battery + gate chain + certificate diff).
- Plan 4: feature ledger + zero-engagement weekly report + contract-key registry extension.
- Plan 5: metamorphic engine property tests (no-look-ahead / seed determinism / fill sanity).
- Plan 6: subsystem-tiers file + deep-scan skill diff-scoping + CLAUDE.md pointer.
- Plan 7: Office v2 — "Tower Rails" Reporting Room card + "Rails Switch" control card + SSE + route.

---

### Task 0: Session preflight + isolated worktree

**Files:** none created in repo yet (worktree mechanics only).

**Interfaces:**
- Produces: worktree at `C:\Users\tonio\Projects\trading-forge\wt-rails-p1` on branch `hardening/rails-p1` pinned to a recorded base SHA; junctioned node_modules; verified real tsc.

- [ ] **Step 1: Capture base SHA and create the worktree**

```powershell
Set-Location C:\Users\tonio\Projects\trading-forge\trading-forge
git fetch origin
$base = git rev-parse origin/hardening/phase-0
$base   # record this SHA in the session log
git worktree add ..\wt-rails-p1 $base
git -C ..\wt-rails-p1 switch -c hardening/rails-p1
```

- [ ] **Step 2: Junction node_modules and prove tsc is real**

```powershell
New-Item -ItemType Junction -Path ..\wt-rails-p1\node_modules -Target C:\Users\tonio\Projects\trading-forge\trading-forge\node_modules
Set-Location ..\wt-rails-p1
node node_modules\typescript\bin\tsc --noEmit; $LASTEXITCODE   # expect 0
```
Then inject one deliberate type error into any `.ts` file, re-run, expect exit 1 and the error named; revert the injection. A checker that can't go red is not a checker.

- [ ] **Step 3: Confirm no instrument files will be touched** — this plan's file list contains only `ci/`, `scripts/rails/`, `.github/workflows/`, `docs/`. If any task drifts into `src/engine/` or gate/sizing files, STOP and stage a ratify packet instead.

---

### Task 1: WSL2 runner environment (ops — some steps may need the operator)

**Files:**
- Create: `%UserProfile%\.wslconfig` (Windows-side, not in repo)
- Create: `scripts/rails/register-runner-task.ps1`

**Interfaces:**
- Produces: a GitHub self-hosted runner labeled `[self-hosted, linux, wsl-tower]` showing **Idle** for repo `swayz032/trading-forge`, auto-starting at boot via Windows scheduled task `TF-CI-Runner`.

- [ ] **Step 1: Check WSL2 availability**

```powershell
wsl --status
wsl -l -v
```
If WSL2 with an Ubuntu distro exists → continue. If NOT installed: `wsl --install -d Ubuntu` requires admin and a reboot — **flag to operator, pause this task, continue with Task 2/5/6 (they don't need the runner), resume after reboot.**

- [ ] **Step 2: Write the resource cap file** (Windows side)

```
# %UserProfile%\.wslconfig
[wsl2]
memory=8GB
processors=4
swap=4GB
```
Then `wsl --shutdown` so caps apply on next start. Verify inside WSL: `free -g` shows ~8 total, `nproc` shows 4.

- [ ] **Step 3: Install toolchains inside WSL (Ubuntu)**

```bash
sudo apt-get update && sudo apt-get install -y curl git build-essential python3.11 python3.11-venv python3-pip
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
node -v && python3.11 --version
```
Clone happens via the runner itself (actions/checkout) — no manual clone needed. Python deps install is deferred to the workflow's own steps (Task 3) so CI documents its own environment.

- [ ] **Step 4: Register the self-hosted runner**

```bash
# inside WSL, as the normal user
mkdir -p ~/actions-runner && cd ~/actions-runner
# get the registration token (needs repo admin; gh on Windows side):
#   gh api -X POST repos/swayz032/trading-forge/actions/runners/registration-token --jq .token
# if gh lacks admin scope, OPERATOR does: GitHub → repo Settings → Actions → Runners → New self-hosted runner (Linux x64) and reads the token off that page.
curl -o actions-runner.tar.gz -L https://github.com/actions/runner/releases/latest/download/actions-runner-linux-x64.tar.gz
tar xzf actions-runner.tar.gz
./config.sh --url https://github.com/swayz032/trading-forge --token <TOKEN> --labels wsl-tower --unattended --name wsl-tower
```

- [ ] **Step 5: Auto-start at boot** — write `scripts/rails/register-runner-task.ps1`:

```powershell
# scripts/rails/register-runner-task.ps1 — one-time registration of the CI runner autostart task
schtasks /Create /TN "TF-CI-Runner" /SC ONSTART /RU $env:USERNAME /F `
  /TR "wsl -d Ubuntu -- bash -lc 'cd ~/actions-runner && ./run.sh'"
Write-Host "TF-CI-Runner registered. Start now with: schtasks /Run /TN TF-CI-Runner"
```
Run it, then `schtasks /Run /TN "TF-CI-Runner"`.

- [ ] **Step 6: Verify Idle**

```powershell
gh api repos/swayz032/trading-forge/actions/runners --jq '.runners[] | {name, status, labels: [.labels[].name]}'
```
Expected: `wsl-tower`, `status: "online"`. Also (operator or gh): repo Settings → Actions → General → restrict Actions to repository-defined workflows.

- [ ] **Step 7: Commit the registration script** (from the worktree)

```powershell
git add scripts/rails/register-runner-task.ps1
git commit -m "rails-p1: CI runner autostart registration script"
```

---

### Task 2: Baseline comparator (`ci/compare-baseline.mjs`) — TDD

**Files:**
- Create: `ci/compare-baseline.mjs`
- Create: `ci/baseline-failures.json`
- Test: `ci/__tests__/compare-baseline.test.mjs`

**Interfaces:**
- Produces: `compareBaseline({ suite, results, baseline })` → `{ verdict: "GREEN"|"RED", newFailures: string[], fixedFailures: string[], collected: number, floorBreached: boolean }`; CLI `node ci/compare-baseline.mjs --suite vitest --results ci/out/vitest.json` exits 0 GREEN / 1 RED and prints the named tests. Task 3's workflow calls the CLI exactly like that.
- Consumes: vitest JSON reporter file (`testResults[].assertionResults[]` with `status`, `fullName`) and pytest junit XML (`<testcase classname name>` with child `<failure>`/`<error>`).

- [ ] **Step 1: Write the failing tests**

```js
// ci/__tests__/compare-baseline.test.mjs
import { describe, it, expect } from "vitest";
import { compareBaseline, parseVitestJson, parsePytestJunit } from "../compare-baseline.mjs";

const baseline = { knownFailures: ["a.test.ts > old bug"], collectionFloor: 3 };

describe("compareBaseline", () => {
  it("GREEN when failures match baseline exactly", () => {
    const r = compareBaseline({ results: { failures: ["a.test.ts > old bug"], collected: 5 }, baseline });
    expect(r.verdict).toBe("GREEN");
    expect(r.newFailures).toEqual([]);
  });
  it("RED on any new failure, names it", () => {
    const r = compareBaseline({ results: { failures: ["a.test.ts > old bug", "b.test.ts > fresh"], collected: 5 }, baseline });
    expect(r.verdict).toBe("RED");
    expect(r.newFailures).toEqual(["b.test.ts > fresh"]);
  });
  it("GREEN but reports fixed failures so the manifest shrinks", () => {
    const r = compareBaseline({ results: { failures: [], collected: 5 }, baseline });
    expect(r.verdict).toBe("GREEN");
    expect(r.fixedFailures).toEqual(["a.test.ts > old bug"]);
  });
  it("RED when collected count drops below floor (collection crash class)", () => {
    const r = compareBaseline({ results: { failures: [], collected: 2 }, baseline });
    expect(r.verdict).toBe("RED");
    expect(r.floorBreached).toBe(true);
  });
  it("parses vitest JSON reporter shape", () => {
    const j = { testResults: [{ name: "/x/a.test.ts", assertionResults: [
      { status: "passed", fullName: "a ok" }, { status: "failed", fullName: "a bad" }] }] };
    expect(parseVitestJson(j)).toEqual({ failures: ["a.test.ts > a bad"], collected: 2 });
  });
  it("parses pytest junit shape", () => {
    const xml = `<testsuite tests="2"><testcase classname="t_a" name="ok"/><testcase classname="t_a" name="bad"><failure>x</failure></testcase></testsuite>`;
    expect(parsePytestJunit(xml)).toEqual({ failures: ["t_a::bad"], collected: 2 });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `node node_modules/vitest/vitest.mjs run ci/__tests__/compare-baseline.test.mjs` → expect module-not-found FAIL.

- [ ] **Step 3: Implement `ci/compare-baseline.mjs`**

```js
// ci/compare-baseline.mjs — baseline-failure manifest comparator (Rail 1).
// GREEN = failures ⊆ baseline AND collected ≥ floor. Any NEW failure or a
// collection-count drop is RED. Fixed failures are reported so the manifest shrinks.
import { readFileSync } from "node:fs";
import { basename } from "node:path";

export function compareBaseline({ results, baseline }) {
  const known = new Set(baseline.knownFailures ?? []);
  const actual = new Set(results.failures ?? []);
  const newFailures = [...actual].filter((f) => !known.has(f)).sort();
  const fixedFailures = [...known].filter((f) => !actual.has(f)).sort();
  const floorBreached = (results.collected ?? 0) < (baseline.collectionFloor ?? 0);
  return {
    verdict: newFailures.length || floorBreached ? "RED" : "GREEN",
    newFailures, fixedFailures, collected: results.collected ?? 0, floorBreached,
  };
}

export function parseVitestJson(j) {
  const failures = []; let collected = 0;
  for (const file of j.testResults ?? []) for (const t of file.assertionResults ?? []) {
    collected += 1;
    if (t.status === "failed") failures.push(`${basename(file.name)} > ${t.fullName}`);
  }
  return { failures, collected };
}

export function parsePytestJunit(xml) {
  const failures = []; let collected = 0;
  const cases = xml.match(/<testcase\b[^>]*(?:\/>|>[\s\S]*?<\/testcase>)/g) ?? [];
  for (const c of cases) {
    collected += 1;
    const cls = /classname="([^"]*)"/.exec(c)?.[1] ?? "";
    const name = /name="([^"]*)"/.exec(c)?.[1] ?? "";
    if (/<(failure|error)\b/.test(c)) failures.push(`${cls}::${name}`);
  }
  return { failures, collected };
}

// CLI: node ci/compare-baseline.mjs --suite vitest|pytest --results <file> [--baseline ci/baseline-failures.json]
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
  const suite = arg("suite"); const resultsPath = arg("results");
  const manifest = JSON.parse(readFileSync(arg("baseline", "ci/baseline-failures.json"), "utf8"));
  const baseline = manifest[suite];
  if (!baseline) { console.error(`no baseline section for suite "${suite}" — fail closed`); process.exit(1); }
  const raw = readFileSync(resultsPath, "utf8");
  const results = suite === "pytest" ? parsePytestJunit(raw) : parseVitestJson(JSON.parse(raw));
  const r = compareBaseline({ results, baseline });
  console.log(JSON.stringify(r, null, 2));
  if (r.fixedFailures.length) console.log(`NOTE: ${r.fixedFailures.length} baseline entries now pass — shrink ci/baseline-failures.json`);
  process.exit(r.verdict === "GREEN" ? 0 : 1);
}
```

- [ ] **Step 4: Seed the manifest** — `ci/baseline-failures.json`:

```json
{
  "_comment": "rails_thresholds_v1 — frozen once fast lane is green. Every entry needs a reason. Changes are dated commits, never silent.",
  "vitest": { "knownFailures": [], "collectionFloor": 0 },
  "pytest": { "knownFailures": [], "collectionFloor": 0 },
  "checksSkipped": []
}
```
(Real values are filled during Task 3 bring-up from actual Linux runs, then floors set to ~95% of observed collected counts.)

- [ ] **Step 5: Run tests to verify pass** — same vitest command → expect 6/6 PASS.

- [ ] **Step 6: Commit** — `git add ci/ && git commit -m "rails-p1: baseline comparator + manifest seed (6 tests)"`

---

### Task 3: FAST lane workflow + bring-up loop

**Files:**
- Create: `.github/workflows/fast.yml`
- Modify: `ci/baseline-failures.json` (quarantine entries discovered during bring-up, each with a reason string)

**Interfaces:**
- Consumes: Task 2's CLI contract; Task 1's runner label `wsl-tower`.
- Produces: a required-on-every-push verdict; the seeded manifest frozen as `rails_thresholds_v1`.

- [ ] **Step 1: Write `.github/workflows/fast.yml`**

```yaml
name: fast-lane
on:
  push: {}
concurrency: { group: fast-${{ github.ref }}, cancel-in-progress: true }
jobs:
  fast:
    runs-on: [self-hosted, linux, wsl-tower]
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - name: npm ci
        run: npm ci
      - name: typecheck (must pass, no baseline)
        run: node node_modules/typescript/bin/tsc --noEmit
      - name: hard gates (must pass, no baseline)
        run: |
          npm run check:production-isolation
          npm run check:2026-compliance
          npm run system-map:check
      - name: parity checks (manifest-quarantinable)
        run: node ci/run-checks.mjs   # Step 2 below — runs remaining check:* honoring checksSkipped
      - name: vitest full (Linux)
        run: node node_modules/vitest/vitest.mjs run --reporter=json --outputFile=ci/out/vitest.json || true
      - name: vitest vs baseline
        run: node ci/compare-baseline.mjs --suite vitest --results ci/out/vitest.json
      - name: python deps + fast pytest tier
        run: |
          python3.11 -m venv .venv && . .venv/bin/activate
          pip install -q -r requirements.txt 2>/dev/null || pip install -q polars numpy pytest duckdb
          python -m pytest src/engine/tests/test_metric_snapshot.py src/engine/tests/test_golden_fixtures.py src/engine/tests/test_frankenstein.py src/engine/tests/test_cross_engine_parity.py --junitxml=ci/out/pytest.xml || true
      - name: pytest vs baseline
        run: node ci/compare-baseline.mjs --suite pytest --results ci/out/pytest.xml
```

- [ ] **Step 2: Write `ci/run-checks.mjs`** — runs the remaining 13 `check:*` scripts (not the 3 hard gates), skipping any listed in `checksSkipped` (each `{name, reason}`), failing on any other non-zero exit:

```js
// ci/run-checks.mjs — remaining check:* scripts with manifest-honored quarantine.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
const CHECKS = ["check:family-grade-postscript","check:sse-contract","check:gate-parity",
  "check:ts-python-exit-parity","check:pglite-ddl-parity","check:gate-contract-keys",
  "check:spec-binding-plan-parity","check:ts-python-tier1-parity","check:ts-python-pm-factor-parity",
  "check:ts-python-firm-rules-version","check:archetype-lockstep","check:migration-immutability",
  "check:gate-fault-injection"];
const skipped = new Map((JSON.parse(readFileSync("ci/baseline-failures.json","utf8")).checksSkipped ?? []).map(s => [s.name, s.reason]));
let failed = [];
for (const c of CHECKS) {
  if (skipped.has(c)) { console.log(`SKIP ${c} — ${skipped.get(c)}`); continue; }
  try { execSync(`npm run ${c}`, { stdio: "inherit" }); }
  catch { failed.push(c); }
}
if (failed.length) { console.error(`RED checks: ${failed.join(", ")}`); process.exit(1); }
```
Add a matching unit test in `ci/__tests__/` only for the manifest-skip parsing (execSync is not unit-tested; the workflow run is its test).

- [ ] **Step 3: Bring-up loop on a scratch branch** — push `hardening/rails-p1` (workflow runs on push, all branches). Iterate: inspect the run; every Linux-environment failure gets EITHER a real fix (path separators, line endings) OR a manifest quarantine entry with a reason (`"windows-only fixture"`, `"needs GPU"`, `"needs live DB"`). Repeat until the run is GREEN. Then set `collectionFloor` for both suites to ~95% of the observed collected counts and commit the frozen manifest: `git commit -m "rails-p1: freeze rails_thresholds_v1 baselines (vitest N collected / pytest M collected)"`.

- [ ] **Step 4: Inspect actual reporter shapes once** — open `ci/out/vitest.json` and `ci/out/pytest.xml` from the first real run and confirm the parser fields match reality (`testResults[].assertionResults[]`; `<testcase classname name>`). If vitest's shape differs from the parser, fix `parseVitestJson` + its fixture test in the same commit. This is the wiring-verification step — never trust the parser against an un-inspected format.

---

### Task 4: CI RED-proofs (a checker that can't go red is a false green)

**Files:** scratch branch `rails-p1-redproof` only — every injection is reverted; nothing lands.

- [ ] **Step 1: Type-error injection** — add `const x: number = "no";` to any `.ts`, push → expect fast-lane RED at typecheck step.
- [ ] **Step 2: New-failing-test injection** — add a vitest file asserting `expect(1).toBe(2)`, push → expect RED at "vitest vs baseline" naming exactly that test.
- [ ] **Step 3: Collection-floor injection** — rename one large `.test.ts` to `.test.ts.off`, push → expect RED with `floorBreached: true`.
- [ ] **Step 4: Delete the scratch branch.** Record all three run URLs in the session log — this is the rail's RED-proof evidence.

---

### Task 5: Divergence alarm (soak-mold standalone) — TDD

**Files:**
- Create: `scripts/rails/divergence-check.cjs` (pure logic + CLI)
- Create: `scripts/rails/register-divergence-task.ps1`
- Test: `scripts/rails/__tests__/divergence-check.test.mjs`

**Interfaces:**
- Produces: `decideDivergence({ pairs, threshold })` → `{ verdict: "OK"|"ALARM", lines: string[] }` where each pair is `{ name, ahead, behind, ffPossible }`; CLI run does `git fetch` + emits one JSONL line to `data/rails/divergence-YYYYMMDD.jsonl`, posts Discord ONLY on ALARM, writes one `audit_log` row (`action: "rails.divergence_checked"`, `entity_id: null`, detail in `input`/`result`).
- Consumes: Discord + postgres client patterns copied from `wt-soak/scripts/soak/soak-watcher.cjs` (read it first; mirror its env-var names and client setup exactly).

- [ ] **Step 1: Write the failing tests**

```js
// scripts/rails/__tests__/divergence-check.test.mjs
import { describe, it, expect } from "vitest";
import { decideDivergence } from "../divergence-check.cjs";

describe("decideDivergence", () => {
  it("OK when all pairs within threshold and FF-able", () => {
    const r = decideDivergence({ pairs: [{ name: "hardening/phase-0", ahead: 2, behind: 3, ffPossible: true }], threshold: 10 });
    expect(r.verdict).toBe("OK");
  });
  it("ALARM when skew exceeds threshold either direction", () => {
    const r = decideDivergence({ pairs: [{ name: "main", ahead: 0, behind: 11, ffPossible: true }], threshold: 10 });
    expect(r.verdict).toBe("ALARM");
    expect(r.lines[0]).toContain("main");
    expect(r.lines[0]).toContain("11");
  });
  it("ALARM when histories forked (no fast-forward possible), regardless of counts", () => {
    const r = decideDivergence({ pairs: [{ name: "main", ahead: 1, behind: 1, ffPossible: false }], threshold: 10 });
    expect(r.verdict).toBe("ALARM");
    expect(r.lines[0].toLowerCase()).toContain("fork");
  });
  it("fail-closed: unreadable pair (nulls) is an ALARM, not a silent OK", () => {
    const r = decideDivergence({ pairs: [{ name: "main", ahead: null, behind: null, ffPossible: null }], threshold: 10 });
    expect(r.verdict).toBe("ALARM");
  });
});
```

- [ ] **Step 2: Run to verify FAIL**, then **Step 3: implement**

```js
// scripts/rails/divergence-check.cjs — daily branch-divergence alarm (Rail 5).
// Pure decision + thin CLI. Soak-mold: fail-closed, JSONL ledger, Discord only on ALARM.
"use strict";
function decideDivergence({ pairs, threshold }) {
  const lines = []; let alarm = false;
  for (const p of pairs) {
    if (p.ahead == null || p.behind == null || p.ffPossible == null) { alarm = true; lines.push(`${p.name}: UNREADABLE — investigate (fail-closed alarm)`); continue; }
    if (!p.ffPossible) { alarm = true; lines.push(`${p.name}: histories FORKED (no fast-forward) — reconcile before it grows`); continue; }
    if (p.ahead > threshold || p.behind > threshold) { alarm = true; lines.push(`${p.name}: local ${p.ahead} ahead / ${p.behind} behind origin (threshold ${threshold})`); }
  }
  return { verdict: alarm ? "ALARM" : "OK", lines };
}
module.exports = { decideDivergence };

if (require.main === module) {
  const { execSync } = require("node:child_process");
  const run = (cmd) => execSync(cmd, { cwd: process.env.TF_REPO_DIR ?? "C:/Users/tonio/Projects/trading-forge/trading-forge", encoding: "utf8" }).trim();
  const pair = (name) => {
    try {
      run("git fetch origin --quiet");
      const ahead = Number(run(`git rev-list --count origin/${name}..${name}`));
      const behind = Number(run(`git rev-list --count ${name}..origin/${name}`));
      let ffPossible = true;
      try { run(`git merge-base --is-ancestor ${name} origin/${name}`); }
      catch { try { run(`git merge-base --is-ancestor origin/${name} ${name}`); } catch { ffPossible = false; } }
      return { name, ahead, behind, ffPossible };
    } catch { return { name, ahead: null, behind: null, ffPossible: null }; }
  };
  const testSkew = process.argv.includes("--test-skew"); // RED-proof mode: fabricate a breach
  const pairs = testSkew ? [{ name: "main", ahead: 0, behind: 15, ffPossible: true }]
                         : [pair("hardening/phase-0"), pair("main")];
  const r = decideDivergence({ pairs, threshold: Number(process.env.RAILS_DIVERGENCE_THRESHOLD ?? 10) });
  // ledger + audit + discord: mirror soak-watcher.cjs helpers (appendJsonl / auditInsert / discordPost)
  console.log(JSON.stringify({ at: new Date().toISOString(), ...r, pairs }));
  process.exit(0); // alarm is a NOTIFICATION, not a failed job
}
```
Complete the CLI tail by copying the three helper functions (JSONL append, direct-postgres audit insert, Discord post) from `wt-soak/scripts/soak/soak-watcher.cjs` verbatim, adjusting only the audit `action` to `rails.divergence_checked` and the JSONL path to `data/rails/`. The audit row uses `entity_id: null` (non-UUID strings are forbidden in that column) with branch detail in `input`.

- [ ] **Step 4: Run tests → 4/4 PASS.**
- [ ] **Step 5: RED-proof + real run** — `node scripts/rails/divergence-check.cjs --test-skew` → ALARM posted to Discord (verify the message arrived, screenshot/link in session log). Then a real run → expect OK (or a real alarm — which is a finding, not a bug).
- [ ] **Step 6: Register the daily task** — `scripts/rails/register-divergence-task.ps1` mirroring `wt-soak/scripts/soak/register-soak-task.ps1`, `schtasks /Create /TN "TF-Rails-Divergence" /SC DAILY /ST 10:00`. Run it; `schtasks /Query /TN "TF-Rails-Divergence"` shows Ready.
- [ ] **Step 7: Commit** — `git add scripts/rails ci && git commit -m "rails-p1: divergence alarm (4 tests + RED-proof + 10:00 daily task)"`

---

### Task 6: Worktree TTL report (weekly)

**Files:**
- Create: `scripts/rails/worktree-ttl.cjs`
- Test: `scripts/rails/__tests__/worktree-ttl.test.mjs`
- Create: `scripts/rails/register-worktree-ttl-task.ps1`

**Interfaces:**
- Produces: `summarizeWorktrees(entries, nowMs, ttlDays)` → `{ stale: [{path, branch, ageDays, uniqueCommits}], count }`; weekly Discord digest listing worktrees older than 7 days with their unique-commit counts (this list is REPORT-ONLY — removal stays a human/deliberate act; auto-deleting worktrees cost us 2 branches on 2026-07-10).

- [ ] **Step 1: Failing test** — feed `summarizeWorktrees` a fixture of 3 entries (fresh, stale-with-commits, stale-clean) and assert only the 2 stale ones appear, ordered oldest-first, each carrying `uniqueCommits`.

```js
import { describe, it, expect } from "vitest";
import { summarizeWorktrees } from "../worktree-ttl.cjs";
const DAY = 86400000;
it("lists only >ttl worktrees, oldest first, with commit counts", () => {
  const now = 100 * DAY;
  const r = summarizeWorktrees([
    { path: "wt-a", branch: "x", mtimeMs: now - 1 * DAY, uniqueCommits: 2 },
    { path: "wt-b", branch: "y", mtimeMs: now - 30 * DAY, uniqueCommits: 0 },
    { path: "wt-c", branch: "z", mtimeMs: now - 9 * DAY, uniqueCommits: 5 },
  ], now, 7);
  expect(r.stale.map(s => s.path)).toEqual(["wt-b", "wt-c"]);
  expect(r.stale[1].uniqueCommits).toBe(5);
});
```

- [ ] **Step 2: Implement** — `git worktree list --porcelain` parse; age from directory mtime; `uniqueCommits` via `git rev-list --count <branch> --not --remotes`; Discord/JSONL/audit helpers same as Task 5 (`action: "rails.worktree_ttl_reported"`). Weekly task `TF-Rails-WorktreeTTL`, Sunday 10:15.
- [ ] **Step 3: Test PASS, then real run** — expect a genuinely long report today (~24 known worktrees; that's correct data, not a bug). Verify the Discord digest reads in plain English.
- [ ] **Step 4: Commit.**

---

### Task 7: Land + independent verification (doer ≠ grader)

**Files:**
- Modify: `AGENT-LOGS.md` (session entry, on the shared tree via `git commit -o`)

- [ ] **Step 1: Full verify in the worktree** — real tsc exit 0; `node node_modules/vitest/vitest.mjs run ci scripts/rails` all green; the 3 hard gates green.
- [ ] **Step 2: Diff-stat tripwire** — `git diff --stat <baseSHA>..HEAD`: expect ONLY additions under `ci/`, `scripts/rails/`, `.github/workflows/`, `docs/` (~10 files, net-positive, zero `src/` changes). Any deletion or `src/` line = STOP, wrong-base check.
- [ ] **Step 3: Land FF-only** — fetch, rebase `hardening/rails-p1` onto current `origin/hardening/phase-0` tip, re-run tsc + gates if anything moved, `git checkout hardening/phase-0 && git merge --ff-only hardening/rails-p1`, push. Clean up worktree (junction removed via `[System.IO.Directory]::Delete($path, $false)`, then `git worktree remove`).
- [ ] **Step 4: Independent verification pass** — dispatch a FRESH read-only agent (accuracy-validator) with zero context from this session: "verify from zero that (a) fast-lane run on the landed tip is green and its RED-proof runs exist, (b) TF-Rails-Divergence + TF-Rails-WorktreeTTL schtasks exist and their scripts run clean, (c) no instrument file changed vs base SHA." Its report — not this session's self-report — is the completion evidence.
- [ ] **Step 5: AGENT-LOGS session entry** + update the rails spec's sequencing table row 1-2 status to SHIPPED with the RED-proof run URLs.

---

## Self-review record (author, 2026-07-11)

- **Spec coverage (Plan-1 scope):** Rail 1 FAST lane (Tasks 1-4) ✓, baseline manifest + collection floor (2-3) ✓, RED-proofs (4) ✓, Rail 5 alarm + TTL (5-6) ✓, soak-mold persistence/Discord/fail-closed (5-6 helpers) ✓, no-secrets/no-GPU/caps (constraints + Task 1) ✓. FULL lane, guard module, rig, ledger cards = Plans 2-7 by design.
- **Placeholder scan:** the two deliberate "copy from soak-watcher.cjs" steps name the exact source file and the exact three helpers to copy — treated as reuse-by-reference of working code, not a TBD.
- **Type consistency:** comparator contract (`--suite/--results`, exit codes) matches between Task 2 CLI and Task 3 workflow; `decideDivergence` pair shape matches tests and CLI construction.
