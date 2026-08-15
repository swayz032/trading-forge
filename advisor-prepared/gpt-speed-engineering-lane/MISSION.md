# GPT SPEED ENGINEERING LANE — THREE SPEEDS MISSION

**Date:** 2026-08-14
**Status:** ACTIVE
**Home branch:** `external-advisor/gpt-rulings`

## MISSION

Trading Forge engineering speed is controlled as three separate systems:

```text
1. THINKING SPEED
   Plans, ownership, edit maps, architecture.
   STATUS: HEAVILY OPTIMIZED / MAINTAIN, DO NOT KEEP EXPANDING BY DEFAULT.

2. CODING LOOP SPEED
   Fast tests, code search, deterministic fixtures, worker bootstrap, proof/report scripts,
   focused harnesses, and automation.
   STATUS: ACTIVE OPTIMIZATION TARGET.

3. MACHINE / CI SPEED
   Parallelism, caching, sharding, warm services, install/build reuse, and critical-path reduction.
   STATUS: ACTIVE OPTIMIZATION TARGET.
```

## BOSS RULE

The GPT lane is no longer primarily a planning factory.

Its default job is now to find **measurable wall-clock waste** that Claude workers repeatedly pay, then prepare the smallest safe engineering improvement that removes that waste.

A speed change is not accepted because it looks clever. It must prove:

1. a measured BEFORE;
2. the same correctness/safety coverage;
3. a measured AFTER;
4. no new false-green route;
5. deterministic or bounded behavior;
6. a rollback path when the optimization changes infrastructure.

## NON-NEGOTIABLE SAFETY

Speed may NOT come from:

- skipping required proof;
- weakening fail-closed behavior;
- converting blocking safety gates to advisory;
- reducing semantic coverage without a separate equivalent proof;
- hiding failures in baselines;
- increasing nondeterminism;
- letting Worker 1 and Worker 2 share an unsafe worktree;
- enabling broker egress, Topstep network transport, or PAPER qualification ahead of existing gates;
- pulling work ahead of AR-1138.

**AR-1138 remains Worker 1's first order.**

## PRIMARY SCOREBOARD

Measure and improve these quantities where evidence can be collected:

### Coding Loop
- worker reset -> first useful RED time;
- edit -> focused test result time;
- edit -> local GREEN time;
- local GREEN -> evidence receipt time;
- repeated repo-search/setup commands per packet;
- compiler one-strategy iteration time;
- runtime fault-scenario iteration time.

### Machine / CI
- push -> Fast Lane verdict time;
- push -> full launch-gate verdict time;
- dependency install time;
- DB setup/migration time;
- typecheck time;
- Vitest time;
- pytest time;
- parity/gate time;
- duplicate setup/install time across jobs;
- critical-path idle caused by unnecessary job dependencies.

## FIRST ENGINEERING QUEUE

### SPEED-01 — CI WALL-CLOCK BASELINE
Collect representative successful and failed Fast Lane/full-CI timing receipts. Identify the top wall-clock consumers before changing CI.

### SPEED-02 — CHANGED-FILE -> FOCUSED-TEST SELECTOR
Determine whether an existing authoritative test-selection mechanism exists. If absent, design a fail-safe selector that suggests focused tests for the coding loop while never replacing certification suites.

### SPEED-03 — AUTOMATED EVIDENCE RECEIPT
Turn RED/GREEN commands, changed files, branch/SHA, controls, and known limits into a machine-generated worker receipt. Reduce Claude prose/report tokens without weakening evidence.

### SPEED-04 — WORKER BOOTSTRAP COMMAND
Automate identity/worktree/branch/cleanliness/current-order checks so resets do not repeatedly spend Claude tokens reconstructing the environment.

### SPEED-05 — WORKER-1 SINGLE-STRATEGY COMPILER HARNESS
After AR-1138 GPT PASS, provide a seconds-scale source -> graph -> compiler -> factory iteration harness for the accepted strategy. It is a developer loop, not a replacement for full proof.

### SPEED-06 — WORKER-2 FAULT HARNESS
Provide deterministic local scenarios for crash/reconnect/duplicate-fill/position-drift/restart safety so runtime repairs can reproduce RED quickly without real broker egress.

### SPEED-07 — CI INSTALL / SETUP DUPLICATION AUDIT
Measure repeated `npm ci`, Python install, Postgres setup, migrations, and build work. Recommend caching/artifact/job-boundary changes only when correctness is conserved.

### SPEED-08 — SAFE PARALLELISM / SHARDING AUDIT
Find suites that can safely parallelize or shard. Respect known nondeterminism: the Fast Lane full Vitest evidence currently uses one worker because prior thread-pool behavior caused a Node/V8 evidence false-red. Do not simply turn concurrency on globally.

### SPEED-09 — DETERMINISTIC FIXTURE / WARM-SERVICE AUDIT
Find expensive fixtures or service boot work repeated inside focused development loops. Reuse only when isolation and deterministic reset are proven.

### SPEED-10 — SPEED REGRESSION GUARD
Once reliable baselines exist, make major speed regressions visible. Prefer trend/receipt evidence before hard timing gates because hosted runner variance can create false reds.

## WORK ORDER

```text
MEASURE
  -> REMOVE REPEATED HUMAN/CLAUDE WORK
  -> SHORTEN FOCUSED TEST LOOP
  -> SHORTEN MACHINE CRITICAL PATH
  -> RE-MEASURE
  -> KEEP ONLY PROVEN SPEEDUPS
```

## RELATIONSHIP TO THE TWO CLAUDE WORKERS

GPT owns the flashlight/measurement/pre-solve lane.

- Worker 1 remains owner of Graph Engineering -> Compiler -> Strategy Factory production semantics.
- Worker 2 remains owner of PAPER -> Runtime -> Execution Safety production work after activation.
- GPT may prepare speed tooling/specs and independently grade resulting commits.
- GPT must not silently edit Claude-owned semantic production paths just to make benchmarks faster.

## DEFINITION OF SUCCESS

The lane succeeds when Claude spends a larger fraction of quota/time on real production edits and a smaller fraction on:

- repo archaeology;
- repeated environment setup;
- waiting on unnecessarily broad tests during development;
- manually gathering proof;
- rebuilding deterministic fixtures;
- duplicated installs/build work;
- serial CI work that is safely parallelizable.

**Target principle:** faster feedback, same or stronger truth.
