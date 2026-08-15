# GPT EXTERNAL ADVISOR RULING — AR-1190

**Date:** 2026-08-14  
**Type:** CONTROL / NEW GPT ENGINEERING SPEED LANE  
**Status:** ACTIVE  
**Branch:** `external-advisor/gpt-rulings`

## RULING

Create and activate a new GPT engineering lane organized around the **Three Speeds** model:

```text
1. THINKING SPEED
   Plans, ownership, edit maps, architecture.
   STATUS: heavily optimized. Maintain only when fresh evidence requires it.

2. CODING LOOP SPEED
   Fast tests, search, fixtures, scripts, automation.
   STATUS: active GPT optimization mission.

3. MACHINE / CI SPEED
   Parallelism, caching, sharding, warm services.
   STATUS: active GPT optimization mission.
```

This is now the GPT lane's standing mission.

The purpose is not to make Claude rush. The purpose is to remove repeated non-coding time while preserving or strengthening truth.

## BOSS DECISION

The previous acceleration phase attacked THINKING SPEED aggressively.

That phase is mature enough that GPT must not default back into producing more architecture/control paperwork.

The new default is:

```text
MEASURE REAL WALL-CLOCK WASTE
-> FIND REPEATED WORK
-> PREPARE SMALLEST SAFE TOOLING/CI IMPROVEMENT
-> PROVE SAME OR STRONGER CORRECTNESS
-> MEASURE AFTER
-> KEEP ONLY PROVEN SPEEDUP
```

## HARD LAW

A speedup is INVALID if it comes from:

- skipping required tests;
- hiding failures;
- weakening fail-closed behavior;
- changing blocking capital/safety gates to advisory;
- shrinking semantic proof without equivalent coverage;
- introducing nondeterministic tests;
- unsafe shared worktrees;
- pulling Worker 1 or Worker 2 ahead of existing activation gates;
- enabling broker egress or Topstep transport.

**AR-1138 remains Worker 1's first order.**

## NEW LANE CONTROL FILES

Mission:
`advisor-prepared/gpt-speed-engineering-lane/MISSION.md`

Machine-readable queue:
`advisor-prepared/gpt-speed-engineering-lane/QUEUE.json`

## FIRST QUEUE

1. `SPEED-01` — CI wall-clock baseline.
2. `SPEED-02` — changed-file -> focused-test selector.
3. `SPEED-03` — automated evidence receipt.
4. `SPEED-04` — worker bootstrap command.
5. `SPEED-05` — Worker 1 single-strategy compiler iteration harness after AR-1138 GPT PASS.
6. `SPEED-06` — Worker 2 deterministic runtime fault harness after Worker 2 activation.
7. `SPEED-07` — CI install/setup duplication audit.
8. `SPEED-08` — safe parallelism/sharding audit.
9. `SPEED-09` — deterministic fixture/warm-service audit.
10. `SPEED-10` — speed-regression visibility after stable baselines exist.

## SPEED-01 — INITIAL EVIDENCE ALREADY COLLECTED

A successful Trading Forge Fast Lane run (`31560374167`, SHA `98c0683dc5deafa63c77e7f70ac6b98e014a8019`) ran its single machine-enforced job from approximately `03:32:10Z` to `03:39:05Z`: about **6 minutes 55 seconds**.

Observed step durations from GitHub Actions timestamps:

- container initialization: ~14s;
- Node dependency install: ~10s;
- CPU-only Python fast dependencies: ~44s;
- DB migrations: ~2s;
- TypeScript typecheck: ~27s;
- remaining contract/parity checks: ~21s;
- scripts/node:test lane: ~18s;
- full Vitest evidence collection: ~4m11s;
- fast pytest evidence: ~11s;
- baseline comparisons/final verdict: ~2s total order of magnitude.

### INITIAL BOTTLENECK RULING

The **full Vitest evidence collection is the first major Machine/CI speed target** because it dominates the observed successful Fast Lane wall clock.

But its current one-worker process isolation exists for a reason: prior Node 24/V8 WASM/thread-pool behavior could crash before JSON evidence was flushed, creating a false-red baseline verdict.

Therefore:

**DO NOT simply increase Vitest worker count.**

First investigate whether the suite can be safely partitioned/sharded into deterministic process-isolated groups that each produce complete evidence and can be recombined without changing the frozen-baseline truth contract.

A proposed speedup must prove:

1. same test census;
2. same pass/fail identities;
3. same baseline comparison semantics;
4. no missing JSON evidence on process failure;
5. repeated-run determinism;
6. measured wall-clock improvement.

If those cannot be proven, keep the current one-worker evidence path and attack the next bottleneck instead.

## CODING LOOP MISSION

GPT should also attack non-CI time paid repeatedly by Claude:

```text
worker reset
-> environment reconstruction
-> repo search
-> test-command discovery
-> broad test wait
-> manual evidence gathering
-> report prose
```

Target state:

```text
worker reset
-> one bootstrap command
-> owner/test selector
-> focused RED
-> edit
-> focused GREEN
-> generated evidence receipt
-> commit/push
-> GPT grade
```

Focused development tooling may accelerate local work, but it must never masquerade as release certification.

## MACHINE / CI MISSION

Investigate, with before/after receipts:

- safe process-isolated test sharding;
- dependency/cache strategy;
- repeated installs across workflow jobs;
- DB/service setup reuse where isolation is preserved;
- critical-path job dependencies;
- reusable deterministic fixtures;
- build/typecheck reuse where SHA binding is preserved;
- warm local developer services where reset/isolation is proven.

## MEASUREMENT CONTRACT

Every accepted speed packet should publish:

```text
TARGET:
BEFORE:
CHANGE:
AFTER:
SAVED:
CORRECTNESS COVERAGE:
NEGATIVE/MUTATION CONTROL:
FALSE-GREEN CHECK:
ROLLBACK:
```

## FINAL CALL

The Three Speeds model is now the official GPT speed-engineering mission:

```text
THINKING SPEED = maintain
CODING LOOP SPEED = optimize
MACHINE / CI SPEED = optimize
```

GPT's job is to make the workers spend more time **building Trading Forge** and less time waiting, searching, bootstrapping, and manually proving work — without buying speed by lowering the engineering standard.
