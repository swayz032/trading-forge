# GPT EXTERNAL ADVISOR RULING — AR-1191

**Date:** 2026-08-14  
**Type:** THREE SPEEDS / EXECUTION WAVE 1 / CODING-LOOP + MACHINE-CI ENGINEERING  
**Status:** EXECUTED / PROVEN RESULTS RECORDED / PRODUCTION ADOPTION STILL GATED WHERE NOTED  
**Advisor branch:** `external-advisor/gpt-rulings`  
**Implementation lab branch:** `external-advisor/gpt-speed-engineering`

## RULING

The Three Speeds lane has moved from planning into real engineering.

Wave 1 produced working developer-speed tools, measured CI baselines, and two machine-speed candidates with correctness fences. No source-strategy semantics, compiler semantics, PAPER behavior, runtime capital controls, broker routing, or Topstep transport were changed.

**AR-1138 remains Worker 1's first order.** Worker 1 branch `h1-wave4-sealed12-driver` was rechecked at `5a82f6f51eeb0d6b47976f83a73cfa8446ca0013` during this wave. The speed lane did not modify it.

---

# 1. CODING LOOP SPEED — REAL TOOLS BUILT

Atomic initial implementation:
`5d9b58dccc5123512adb9451e1359eb0ab7b02d4`

Hosted tooling proof:
- run `31861640477` — GREEN;
- run `31861824914` — GREEN after shard-proof helpers were added;
- local/hosted tooling suite reached `16 passed / 0 failed` with the later helper tests included.

## A. Changed-file -> focused-test selector

Path:
`advisor-prepared/gpt-speed-engineering-lane/tooling/changed-test-selector.mjs`

Purpose:
- remove repeated test-command hunting from Claude's coding loop;
- run the smallest first test set the tool can actually justify;
- never replace final certification.

Fail-closed controls:
- no confident focused mapping -> escalate to full fleet/full CI;
- high-blast-radius CI/package/migration/schema paths -> require full gate;
- unsafe path traversal -> reject.

Verdict:
**IMPLEMENTED / PROVEN IN ISOLATED SPEED LANE.**

## B. Automatic evidence receipt

Path:
`advisor-prepared/gpt-speed-engineering-lane/tooling/evidence-receipt.mjs`

Purpose:
remove repetitive worker-report writing while conserving exact proof.

Controls:
- required RED/GREEN/control/commit/files fields;
- refuses `pushed != true`;
- refuses `stopped_for_gpt != true`;
- redacts common Bearer/API-key/token/password/secret forms.

Verdict:
**IMPLEMENTED / PROVEN IN ISOLATED SPEED LANE.**

## C. Read-only worker bootstrap guard

Path:
`advisor-prepared/gpt-speed-engineering-lane/tooling/worker-bootstrap.mjs`

Purpose:
remove worker-reset branch/status reconstruction time.

Controls:
- exact worker identity input;
- exact expected branch;
- current HEAD receipt;
- dirty tree fails;
- wrong branch fails;
- tool never switches branches or edits files.

Verdict:
**IMPLEMENTED / PROVEN IN ISOLATED SPEED LANE / NOT INSTALLED INTO ACTIVE AR-1138 WORKTREE.**

That final clause is intentional. Speed tooling must not perturb the active compiler proof before AR-1138 closes.

---

# 2. SPEED-01 — WALL-CLOCK BASELINE COMPLETE

Historical successful Fast Lane used as the frozen baseline:
- run `31560374167`;
- SHA `98c0683dc5deafa63c77e7f70ac6b98e014a8019`;
- total job wall time: `415s` (`6m55s`).

Largest measured step:
- full single-worker Vitest evidence: `251s` (`4m11s`), about `60.5%` of the entire Fast Lane.

Other measured costs included:
- fast Python dependencies: `44s`;
- TypeScript typecheck: `27s`;
- remaining contract/parity checks: `21s`;
- node:test scripts lane: `18s`;
- fast pytest: `11s`;
- npm install: `10s`.

The current one-worker Vitest mode was not treated as accidental. Repository comments document it as protection against a prior Node/V8 WASM teardown false-red.

Verdict:
**BASELINE COMPLETE. OPTIMIZE THE 251s BOTTLENECK WITHOUT REINTRODUCING THE OLD FALSE-RED CLASS.**

---

# 3. SPEED-08 — SAFE VITEST SHARDING PROOF

## Initial experiment

The first benchmark attempt failed before Vitest at `npm ci` because the experiment inherited incompatible advisor-branch package state.

Ruling at that point was correctly:
**UNMEASURED — NOT A SHARDING FAILURE, NOT A PASS.**

No speed claim was accepted from that run.

## Corrected experiment

Corrected benchmark commit:
`71c53290a3e57c1b6b5fecf34c9d90b59f31e6e8`

Run:
`31861913966`

The corrected benchmark pinned the exact known-runnable subject SHA `98c0683dc5deafa63c77e7f70ac6b98e014a8019` and changed only the execution geometry:

- serial control: forks + one worker;
- shard 1/2: forks + one worker;
- shard 2/2: forks + one worker;
- shards ran as isolated processes/runners, not restored thread-pool parallelism.

Evidence conservation:
- `922` test-file result entries conserved;
- `13,485` tests conserved;
- merged shard evidence matched fresh serial evidence file-for-file and assertion-status-for-assertion-status;
- the repository's existing `ci/compare-baseline.mjs` produced the identical verdict on fresh serial and merged-shard reports.

Timing:
- serial: `259s`;
- shard 1: `125s`;
- shard 2: `142s`;
- parallel critical test time: `142s`;
- saved: `117s`;
- speed ratio: `1.824x`.

Verdict:
**TWO-RUNNER SHARDING CANDIDATE PROVEN.**

This is a real machine-speed result, but it is **NOT YET AUTHORIZATION TO EDIT PRODUCTION FAST LANE** because the production lane is one job and a two-runner proof does not by itself prove the final one-runner adoption geometry.

## Adoption-shape experiment

A stricter one-runner experiment was launched at:
- commit `7491e1db6c7d82bc5d28fd2f453d9cc9517f451f`;
- run `31862262190`.

Design:
- install dependencies once;
- create serial DB + one isolated DB per shard;
- serial control first;
- then two concurrent single-worker/forks child processes on the same runner, each with its own database;
- exact evidence merge and existing-baseline-comparator equality required.

At this AR-1191 receipt, that adoption-shape experiment is **RUNNING / UNACCEPTED**.

Hard law:
**DO NOT CHANGE PRODUCTION FAST LANE UNTIL THE ADOPTION SHAPE PASSES OR AN EQUIVALENT EXACT-SHA PROOF PASSES.**

---

# 4. SPEED-07 — PARITY DEPENDENCY BLOAT

The full CI cross-engine parity job runs only:
`src/engine/tests/test_cross_engine_parity.py`

The historical/current CI path nevertheless installs the full engine dependency estate, including heavy quantum/ML/GPU-adjacent packages irrelevant to this exact 35-test selection.

The repository already contains bounded `ci/requirements-fast.txt` used for fast parity-oriented work.

## Frozen historical benchmark

Run:
`31862024411`

Exact subject SHA:
`c25c19d6e7ee32c7f8a168ddedd710cfff15d11f`

Result:
- exact parity census: `35 passed / 0 failed / 0 skipped`;
- historical heavy install/setup comparison: `121s`;
- bounded Node + Python install: `52s`;
- saved: `69s`.

## Same-commit A/B proof on current-main code

A proof branch was created from current `main` and only added the A/B proof workflow:
`hardening/gpt-speed-parity-fast-deps`

Proof commit:
`f7fb249785e52017f9f582c49f11b54e6c061b3e`

Light job:
- run `31862200710`;
- total job: `76s`;
- exact test selection: GREEN;
- fail-closed census check: `35 passed / 0 failed / 0 skipped`.

Untouched existing heavy CI parity job on the same commit:
- run `31862200652`;
- job total: `199s`;
- exact test selection: GREEN;
- dependency-install step alone: `134s`;
- parity test step: `17s`.

Same-commit wall saving for the parity job:
`199s - 76s = 123s`.

Verdict:
**BOUNDED PARITY DEPENDENCY SET IS A STRONGLY PROVEN CI CANDIDATE.**

Production `.github/workflows/ci.yml` was NOT changed by this ruling. Adoption should be one bounded CI edit with exact-SHA full-lane proof and rollback.

---

# 5. FULL-CI DAG TAIL — MEASURED, NOT YET PROVEN BY A/B

Historical successful full CI showed `Build Check` waits on:
`[test-node, test-python, test-parity]`.

Inspection shows Build checks out independently and does not consume artifacts from those jobs.

On the measured run, that dependency graph left roughly `104s` of avoidable tail after the slow Python job completed.

Candidate:
allow Build to start after the actual prerequisite gate (`lint`) rather than waiting for unrelated test completion, while preserving every Build/parity command.

Verdict:
**MEASURED CANDIDATE / NO CI EDIT AUTHORIZED YET.**

It requires a controlled A/B because dependency-graph edits can create hidden ordering assumptions even when YAML shows no artifact dependency.

---

# 6. ROBUSTNESS / OWNERSHIP CHECK

No Wave 1 production change touched:
- AR-1138 active Worker 1 branch;
- Graph Engineering semantics;
- compiler lowering semantics;
- Strategy Factory semantics;
- PAPER qualification;
- runtime trading behavior;
- broker account routing;
- Topstep transport;
- capital safety gates.

No broker egress was enabled.
No Topstep network path was enabled.
No required test was converted to advisory for speed.
No known failure was hidden to obtain a green speed benchmark.

The implementation lab remains isolated from the Claude worker lanes.

---

# 7. EXECUTIVE RESULT

The Three Speeds model is now producing real savings:

```text
THINKING SPEED
  heavily optimized already

CODING LOOP SPEED
  focused-test selector      PROVEN ISOLATED
  evidence receipt           PROVEN ISOLATED
  worker bootstrap guard     PROVEN ISOLATED

MACHINE / CI SPEED
  parity dependency slimming PROVEN CANDIDATE
  2-shard Vitest geometry    PROVEN CANDIDATE
  one-runner Vitest adoption RUNNING / UNACCEPTED
  Build DAG tail             MEASURED / NEEDS A-B
```

The important engineering result is not merely that tests can run faster. It is that the speed lane now has a **proof discipline**:

```text
BEFORE TIME
-> CHANGE ONE EXECUTION VARIABLE
-> CONSERVE TEST/EVIDENCE IDENTITY
-> RUN NEGATIVE/FAIL-CLOSED CONTROLS
-> AFTER TIME
-> KEEP ONLY IF TRUTH IS UNCHANGED OR STRONGER
```

## FINAL RULING

**WAVE 1 PASSES.**

Continue the Three Speeds lane, but do not install speed tooling into the active AR-1138 worktree and do not modify production CI from a benchmark alone.

The next production-facing speed move must be an exact-SHA bounded adoption proof, not another architecture document.
