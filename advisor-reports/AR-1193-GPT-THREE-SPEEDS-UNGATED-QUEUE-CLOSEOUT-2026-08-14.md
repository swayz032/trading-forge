# GPT EXTERNAL ADVISOR RULING — AR-1193

**Date:** 2026-08-14  
**Type:** THREE SPEEDS / UNGATED QUEUE CLOSEOUT  
**Status:** UNGATED SPEED QUEUE COMPLETE / TWO DEPENDENCY-GATED ITEMS PRESERVED / ADOPTION PATCHES READY  
**Source of truth:** `swayz032/trading-forge`

## RULING

The currently executable Three Speeds engineering queue is complete.

No task was accepted merely because it looked faster. Each accepted result either has hosted proof, exact A/B evidence, or a bounded no-change ruling. One faster-looking configuration was explicitly rejected because assertion statuses changed.

The two remaining SPEED IDs are not unfinished work:
- SPEED-05 is gated by `AR_1138_GPT_PASS`;
- SPEED-06 is gated by `WORKER_2_ACTIVATION`.

Breaking those gates would violate the active V4 ownership/order law and would not count as acceleration.

---

# COMPLETED BOARD

## SPEED-01 — CI wall-clock baseline

**COMPLETE.**

Frozen baseline:
- run `31560374167`;
- SHA `98c0683dc5deafa63c77e7f70ac6b98e014a8019`;
- Fast Lane wall `415s`;
- full Vitest evidence `251s`.

This established the measured bottleneck instead of optimizing by intuition.

## SPEED-02 — changed-file focused-test selector

**IMPLEMENTED / PROVEN ISOLATED.**

Initial atomic tooling commit:
`5d9b58dccc5123512adb9451e1359eb0ab7b02d4`

Fail-closed law:
- confident mapping -> focused development test first;
- uncertain/high-blast-radius change -> full certification;
- never substitutes for final required gates.

## SPEED-03 — automatic evidence receipt

**IMPLEMENTED / PROVEN ISOLATED.**

Removes repeated worker-report assembly while requiring RED/GREEN/control/commit/file evidence and refusing incomplete/unpushed receipts.

## SPEED-04 — worker bootstrap guard

**IMPLEMENTED / PROVEN ISOLATED / NOT INSTALLED INTO ACTIVE AR-1138 WORKTREE.**

Read-only checks:
- worker identity;
- expected branch;
- HEAD;
- dirty state.

Wrong branch or dirty tree fails. It never switches branches or edits files.

## SPEED-05 — Worker 1 single-strategy compiler harness

**GATED — NOT UNFINISHED.**

Dependency:
`AR_1138_GPT_PASS`.

Do not perturb AR-1138 to make a speed checklist look complete.

## SPEED-06 — Worker 2 runtime fault harness

**GATED — NOT UNFINISHED.**

Dependency:
`WORKER_2_ACTIVATION`.

Worker 2 remains gated until AR-1138 closes and GPT accepts activation.

## SPEED-07 — parity dependency bloat

**ADOPTION PATCH PROVEN / READY TO MERGE THROUGH NORMAL INTEGRATION.**

Old problem:
`Cross-Engine Parity (A3)` ran 35 tests but installed the full engine/ML/quantum dependency estate.

Proven bounded set:
`ci/requirements-fast.txt`.

Current-main-derived adoption branch:
`hardening/gpt-speed-parity-adoption-20260814`

Commit:
`73ebad1c1fc88388fb5af4b7fe1ada938c3e3fc9`

Diff:
- `.github/workflows/ci.yml` only;
- 5 changed lines;
- parity test command unchanged.

Actual patched CI evidence:
- run `31863381616`;
- parity job GREEN;
- job wall about `100s`;
- `35 passed / 0 failed / 0 skipped`;
- test body `35 passed in 7.41s`.

Independent historically-green-subject proof:
- base `c25c19d6e7ee32c7f8a168ddedd710cfff15d11f`;
- branch `hardening/gpt-speed-parity-greenproof-20260814`;
- commit `f0695a9e0a99dd5d73be2503ea33ac92a76597e6`;
- CI run `31863460674`;
- parity job GREEN;
- job wall about `114s`.

Earlier same-commit heavy comparison was about `199s`.

Decision:
**bounded parity dependencies are proven.** Main/production is still unchanged; adoption is isolated and reversible.

## SPEED-08 — Vitest sharding

**TWO-RUNNER ISOLATION PROVEN / ONE-RUNNER CONCURRENCY REJECTED.**

Proven two-runner result, run `31861913966`:
- serial `259s`;
- two isolated shards critical path `142s`;
- saved `117s`;
- speed ratio `1.824x`;
- `922` test files conserved;
- `13,485` assertions conserved;
- exact assertion statuses conserved;
- existing baseline comparator returned identical verdict.

Rejected one-runner result, run `31862262190`:
- same `922` files;
- same `13,485` assertions;
- same overall success flag;
- assertion-status evidence changed.

Decision:
**do not use same-runner concurrent sharding and do not weaken the comparator.**

## SPEED-09 — deterministic fixture / warm-service audit

**COMPLETE / NO CHANGE / ISOLATION PRESERVED.**

Measured setup costs showed that Postgres/container/npm warm-up is not the dominant full-CI cost. The full Python dependency estate and the long test bodies dominate.

Because same-runner concurrency already demonstrated assertion drift, the lane refuses to share mutable Postgres/worktree/node_modules state merely to save a small setup slice.

Decision:
preserve isolated correctness jobs. Future dependency provisioning work must use immutable provenance-pinned environments if attempted.

## SPEED-10 — speed regression visibility

**IMPLEMENTED / HOSTED-GREEN.**

Delivered:
- `actions-speed-observer.mjs`;
- unit controls;
- advisory budget file.

Hosted proof:
run `31863565763` — GREEN.

Controls:
- exact timestamp arithmetic;
- malformed/missing timestamps fail closed;
- negative duration fails closed;
- job and step warnings;
- no budget -> no invented regression.

Default is advisory. `--strict` must be explicitly selected before speed regression becomes blocking.

Frozen visibility thresholds use a 20% warning margin over the measured baseline:
- Fast Lane warning at `498s`;
- full Vitest evidence warning at `301s`.

Decision:
slowdown visibility now exists without creating a false-red correctness gate.

## SPEED-11 — full-CI Build DAG tail

**A/B PROVEN / ACTUAL ADOPTION BRANCH GREEN / READY TO MERGE THROUGH NORMAL INTEGRATION.**

A/B run:
`31863281670`.

Frozen subject:
`c25c19d6e7ee32c7f8a168ddedd710cfff15d11f`.

Candidate Build:
- started after the actual upstream lint gate;
- about `117s`;
- GREEN.

Control Build:
- forced behind a 120-second unrelated-test tail;
- exact same Build command/gate set;
- about `117s`;
- GREEN.

Final proof gate:
GREEN.

Actual adoption branch:
`hardening/gpt-speed-build-dag-adoption-20260814`

Commit:
`95d5b43f04ff9f2e998f2c0dc8e28734ea483b98`

Exact diff:
`needs: [test-node, test-python, test-parity]` -> `needs: lint`, plus proof comment only.

Actual patched CI run:
`31863611329`.

Build job:
- started while Node/Python/parity jobs were still running;
- completed GREEN in about `112s`;
- TypeScript build GREEN;
- all seven parity/schema gates GREEN.

Decision:
**the dependency edge added wait, not truth. Starting Build after lint is proven and reversible.**

---

# ROBUSTNESS / OWNERSHIP RECEIPT

Active Worker 1 branch was rechecked at closeout:
`h1-wave4-sealed12-driver` -> `5a82f6f51eeb0d6b47976f83a73cfa8446ca0013`.

The Three Speeds work did not move that branch.

Therefore:
- AR-1138 remains first Worker 1 order;
- no compiler semantics were changed by the speed lane;
- no Strategy Factory semantics were changed;
- no PAPER qualification was activated;
- no broker egress was activated;
- no Topstep network path was activated;
- no P0-6 production deployment was performed;
- main/production was not silently modified by the adoption candidates.

# FINAL RULING

**UNGATED THREE SPEEDS QUEUE: COMPLETE.**

Safe acceleration delivered:
1. focused development-test routing;
2. automated evidence receipts;
3. read-only worker bootstrap;
4. measured CI baseline;
5. proven bounded parity dependencies;
6. proven isolated two-runner Vitest sharding candidate;
7. rejected unsafe same-runner sharding;
8. warm-state no-change ruling preserving determinism;
9. speed-regression observer + advisory budgets;
10. proven Build DAG tail removal.

The only remaining SPEED IDs are dependency-gated by the authoritative project order. They activate only when their gates are genuinely satisfied.

This is the intended engineering outcome: **faster where evidence stays identical, rejected where evidence changes.**
