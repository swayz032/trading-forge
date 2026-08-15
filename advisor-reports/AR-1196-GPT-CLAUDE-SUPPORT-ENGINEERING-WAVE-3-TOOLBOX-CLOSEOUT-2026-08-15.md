# GPT EXTERNAL ADVISOR RULING — AR-1196

**Date:** 2026-08-15  
**Type:** CLAUDE SUPPORT ENGINEERING / GENERAL TOOLBOX CLOSEOUT  
**Status:** WAVE 3 PASS / RED-FIX-GREEN / GENERAL UNGATED TOOLBOX COMPLETE  
**Source of truth:** `swayz032/trading-forge`

## RULING

The remaining general-purpose Claude Support Engineering toolbox is complete enough to stop speculative helper-building.

Wave 3 delivered five bounded tools on `external-advisor/gpt-speed-engineering`:

1. one-command Claude preflight;
2. one-command Claude finish check;
3. conservative test-theater/fake-green screening;
4. CI root-cause log extraction;
5. deterministic test hotspot profiling.

The wave was not accepted on first push. Hosted proof correctly failed, a concrete matcher defect was identified and repaired, and the full hosted tooling suite then passed.

No compiler meaning, Strategy Factory meaning, PAPER behavior, broker execution, Topstep network path, Worker 2 activation, or AR-1138 authority changed.

## SUPPORT-08 — CLAUDE PREFLIGHT

Files:
- `advisor-prepared/gpt-speed-engineering-lane/tooling/claude-preflight.mjs`
- `advisor-prepared/gpt-speed-engineering-lane/tooling/claude-preflight.test.mjs`

Purpose:
one command before a worker starts/resumes.

It composes the already-proven exact resume-anchor guard with lane-boundary ownership checks.

It requires:
- valid worker identity;
- exact expected branch;
- exact paused commit;
- clean worktree;
- non-empty intended path set;
- intended paths bounded to the selected worker lane.

Wrong/stale state or wrong/shared/unknown lane returns `STOP` rather than silently proceeding.

PASS is not permission to exceed the active order.

## SUPPORT-09 — CLAUDE FINISH CHECK

Files:
- `advisor-prepared/gpt-speed-engineering-lane/tooling/claude-finish-check.mjs`
- `advisor-prepared/gpt-speed-engineering-lane/tooling/claude-finish-check.test.mjs`

Purpose:
one mechanical command before Claude reports a work packet complete.

It checks:
- worktree clean after completion;
- actual base/head diff exists;
- actual diff stays inside explicit packet scope;
- actual changed paths remain inside worker lane rules;
- commit/evidence receipt is mechanically true;
- reported receipt commit equals checked head commit;
- optional exact-path collision check against the other worker branch.

Success verdict is deliberately named:
`PASS_FOR_GPT_REVIEW`.

It does not replace GPT semantic/code/test/architecture/CI inspection.

## SUPPORT-10 — TEST THEATER DETECTOR

Files:
- `advisor-prepared/gpt-speed-engineering-lane/tooling/test-theater-detector.mjs`
- `advisor-prepared/gpt-speed-engineering-lane/tooling/test-theater-detector.test.mjs`

Conservative static screening only.

It can:
- block skip/todo declarations in a configured critical test;
- block explicitly configured production dependency mocks;
- require review when expected production import tokens are absent;
- require review when required mutation/negative-control evidence is absent.

A clean result is only:
`NO_STATIC_RISK_SIGNALS`.

It explicitly does NOT claim that static screening proves the test exercises production behavior.

## SUPPORT-11 — CI ROOT-CAUSE EXTRACTOR

Files:
- `advisor-prepared/gpt-speed-engineering-lane/tooling/ci-root-cause-extractor.mjs`
- `advisor-prepared/gpt-speed-engineering-lane/tooling/ci-root-cause-extractor.test.mjs`

Purpose:
reduce Claude/GPT context waste after the earlier CI triage tool identifies the failing job.

It:
- scans raw log text for bounded failure signals;
- extracts only nearby context;
- deduplicates repeated excerpts;
- caps output;
- redacts common bearer/token/secret/password/API-key forms;
- returns `NO_ROOT_CAUSE_SIGNAL_FOUND` instead of inventing a diagnosis.

It cannot declare CI green or waive the underlying failed job.

### Hosted RED found a real defect

Initial hosted run:
`31867325461`

Head:
`aee0172dda7e3acf74efefdc03407bcd1e685fb3`

Result:
**FAILURE** in `Run speed-tooling tests`.

Root cause identified in the new extractor matcher:
it recognized standalone `error`, but the word-boundary pattern did not recognize common named classes such as `AssertionError` / `TypeError`.

Repair commit:
`c4f4a507f7f4ac1e097290bef8b2d61954ffab9f`

Repair:
expanded the bounded signal matcher to recognize common named Error classes while preserving the existing generic failure tokens.

No test was deleted, skipped, weakened, or reclassified to make the run green.

## SUPPORT-12 — TEST HOTSPOT PROFILER

Files:
- `advisor-prepared/gpt-speed-engineering-lane/tooling/test-hotspot-profiler.mjs`
- `advisor-prepared/gpt-speed-engineering-lane/tooling/test-hotspot-profiler.test.mjs`

Input:
normalized test timing rows with name + duration.

Output:
- total measured duration;
- slowest tests first;
- per-test share of measured duration;
- cumulative share.

Invalid, negative, non-finite, or empty timing input rejects.

The tool identifies optimization candidates only. It does not authorize skipping, weakening, or reordering correctness coverage.

## FINAL HOSTED GREEN

Workflow:
`GPT Speed Engineering Tooling`

Run:
`31867358447`

Head:
`c4f4a507f7f4ac1e097290bef8b2d61954ffab9f`

Result:
**SUCCESS**.

Hosted proof:
- checkout GREEN;
- Node setup GREEN;
- complete `tooling/*.test.mjs` suite GREEN;
- changed-file selector fail-closed smoke control GREEN;
- frozen baseline JSON validation GREEN;
- complete job GREEN.

This is the accepted evidence for Wave 3.

## INTEGRATION / BRANCH RECEIPT

During assembly, documentation-only commits advanced the isolated GPT support branch before an initially-created tooling tree was attached. Those intermediate tooling commits were not accepted as live state.

The branch ref was explicitly corrected to the live tooling tree before hosted proof. The accepted live branch then advanced normally to the repair commit above.

This cleanup affected only:
`external-advisor/gpt-speed-engineering`.

It did not rewrite or move main, the AR-1138 Worker 1 branch, Worker 2, production, PAPER, broker, or Topstep refs.

## GENERAL TOOLBOX STATUS

The ungated general support toolbox now covers:

### BEFORE CLAUDE WORK
- worker/bootstrap guard;
- exact resume-anchor guard;
- one-command preflight;
- lane-boundary guard.

### DURING CLAUDE WORK
- changed-file focused-test selector;
- authorized edit-scope guard;
- test-theater static screening;
- branch collision audit;
- test timing hotspot profiling.

### AFTER CLAUDE WORK
- one-command finish check;
- automated evidence receipt;
- commit/evidence verifier;
- CI failure triage;
- CI root-cause extraction;
- speed regression visibility;
- independent GPT semantic review.

## STOP-BUILDING RULE

Do not keep expanding the general support toolbox merely because more helpers can be imagined.

From this point, new ungated support tooling requires an observed repeated Claude cost or a demonstrated failure-detection gap.

The default next action when Claude quota returns is real production engineering, not another generic support-tool wave.

## PRESERVED GATES

Still unchanged:
- AR-1138 remains first Worker 1 order;
- SPEED-05 single-strategy compiler harness waits for `AR_1138_GPT_PASS`;
- SPEED-06 / runtime fault harness waits for `WORKER_2_ACTIVATION`;
- Worker 2 activation gate remains intact;
- PAPER activation remains controlled;
- broker egress remains OFF;
- Topstep network path remains OFF.

# FINAL RULING

**CLAUDE SUPPORT ENGINEERING WAVE 3: PASS / HOSTED-GREEN AFTER REAL RED→FIX→GREEN.**

**GENERAL UNGATED CLAUDE SUPPORT TOOLBOX: COMPLETE ENOUGH — STOP SPECULATIVE TOOL BUILDING.**

GPT should now spend its support effort on real Claude commits, real CI failures, real branch collisions, real test-theater findings, and the two already-preserved dependency-gated harnesses when their gates actually open.