# GPT EXTERNAL ADVISOR RULING — AR-1195

**Date:** 2026-08-15  
**Type:** CLAUDE SUPPORT ENGINEERING / UNGATED TOOLING  
**Status:** WAVE 2 IMPLEMENTED / HOSTED-GREEN / FAIL-CLOSED CONTROLS  
**Source of truth:** `swayz032/trading-forge`

## RULING

Claude Support Engineering may continue in parallel when it removes measurable worker overhead without taking semantic/runtime ownership from Claude.

Wave 2 is accepted because it targets three concrete failure modes with read-only/fail-closed tooling:
1. resuming Claude from stale repository state;
2. silently changing files outside the active packet scope;
3. wasting review/context budget scanning successful CI noise while still refusing incomplete/cancelled runs as green.

No compiler meaning, Strategy Factory meaning, PAPER behavior, broker execution, Topstep network path, or AR-1138 authority was changed.

## SUPPORT-05 — RESUME ANCHOR GUARD

Files:
- `advisor-prepared/gpt-speed-engineering-lane/tooling/resume-anchor-guard.mjs`
- `advisor-prepared/gpt-speed-engineering-lane/tooling/resume-anchor-guard.test.mjs`

Atomic implementation commit:
`3a87e99438bdd8a25b0af10f34e8dfe5b83df33f`

Behavior:
- expected branch is mandatory;
- expected resume commit is mandatory and must resolve as a commit;
- current HEAD must equal the frozen resume commit exactly;
- clean worktree is required by default;
- wrong branch -> fail;
- moved branch -> fail;
- dirty tree -> fail.

This closes a gap in `worker-bootstrap.mjs`: bootstrap reported HEAD, but did not prove that HEAD still matched the exact paused-state anchor.

## SUPPORT-06 — AUTHORIZED EDIT-SCOPE GUARD

Files:
- `advisor-prepared/gpt-speed-engineering-lane/tooling/edit-scope-guard.mjs`
- `advisor-prepared/gpt-speed-engineering-lane/tooling/edit-scope-guard.test.mjs`

Atomic implementation commit:
`3a87e99438bdd8a25b0af10f34e8dfe5b83df33f`

Behavior:
- compares actual Git changed paths between frozen base and head;
- only explicitly listed files or explicitly listed directory prefixes are allowed;
- an extra changed file -> fail;
- empty authorization -> reject, never implicit allow-all;
- unsafe traversal syntax -> reject;
- directory prefixes must be explicit and end in `/`.

This is deliberately narrower than semantic ownership. Passing scope means only that the diff stayed inside the packet's declared file envelope; it is not semantic approval.

## SUPPORT-07 — CI FAILURE TRIAGE

Files:
- `advisor-prepared/gpt-speed-engineering-lane/tooling/ci-failure-triage.mjs`
- `advisor-prepared/gpt-speed-engineering-lane/tooling/ci-failure-triage.test.mjs`

Atomic implementation commit:
`3a87e99438bdd8a25b0af10f34e8dfe5b83df33f`

Behavior:
- consumes GitHub Actions jobs JSON;
- strips successful-job noise;
- returns failed jobs and failing steps;
- cancelled jobs are not green;
- queued/in-progress/pending jobs return `INCOMPLETE` rather than false success;
- malformed payloads reject.

This is triage only. It cannot waive a failed job and does not replace root-cause log inspection when required.

## DOCUMENTATION

README updated on the isolated GPT engineering branch to document the new helpers, including examples and their non-authorization boundaries.

## HOSTED PROOF

Workflow:
`GPT Speed Engineering Tooling`

Run:
`31866753182`

Head:
`3a87e99438bdd8a25b0af10f34e8dfe5b83df33f`

Result:
**GREEN**.

Hosted job proof:
- checkout GREEN;
- Node setup GREEN;
- complete `tooling/*.test.mjs` suite GREEN;
- changed-file selector fail-closed smoke control GREEN;
- frozen baseline JSON validation GREEN;
- complete job GREEN.

The workflow finished successfully on the exact atomic commit containing all three new tools and all three new test files.

## ROBUSTNESS RECEIPT

Negative controls now prove:
- resume after branch movement is rejected;
- resume from wrong branch is rejected;
- resume with dirty worktree is rejected;
- unauthorized extra changed file is rejected;
- empty scope cannot become allow-all;
- unsafe path syntax is rejected;
- cancelled CI cannot become green;
- in-progress CI cannot become green;
- malformed CI payload cannot become green.

## OWNERSHIP / SAFETY RECEIPT

Wave 2 did NOT:
- edit the active AR-1138 worker branch;
- alter source-decision representation;
- alter graph/compiler lowering or refusal semantics;
- alter Strategy Factory semantics;
- activate Worker 2;
- activate PAPER qualification;
- change broker behavior;
- enable Topstep network access;
- merge speed/adoption candidates to production/main;
- weaken required tests or evidence.

## CONTINUATION LAW

GPT may continue building support tooling only when the next item either:
- removes an observed Claude quota/context/time cost; or
- strengthens failure detection.

Do not add speculative helpers just to expand the lane.

Preserved gates remain unchanged:
- AR-1138 remains first Worker 1 order;
- single-strategy compiler harness waits for `AR_1138_GPT_PASS`;
- runtime fault harness waits for `WORKER_2_ACTIVATION`;
- broker egress remains OFF;
- Topstep network path remains OFF.

# FINAL RULING

**CLAUDE SUPPORT ENGINEERING WAVE 2: PASS / HOSTED-GREEN.**

GPT is authorized to keep assisting Claude in isolated engineering-support work under the same fail-closed ownership boundaries.