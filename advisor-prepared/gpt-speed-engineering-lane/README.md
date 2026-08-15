# GPT Three Speeds — Engineering Tooling

This directory is the implementation lane for **Coding Loop Speed**, **Machine / CI Speed**, and bounded **Claude Support Engineering** helpers.
It does not own trading semantics, compiler meaning, PAPER decisions, or broker execution.

## Robustness law

A speed/support change is valid only when it preserves or strengthens failure detection. No speedup may come from skipping a required test, hiding a failure, weakening fail-closed behavior, or crossing Worker 1/2 ownership.

Support helpers may inspect worker changes, receipts, refs, and path ownership. They do **not** authorize semantic edits, activate Worker 2, bypass AR-1138, activate PAPER qualification, enable broker egress, or enable Topstep network access.

## Tools

### changed-test-selector.mjs
Given changed repository paths, returns the smallest safe first test set it can prove. If it cannot prove a focused mapping, it deliberately escalates to full-fleet/full-CI instead of guessing.

Example:
`node changed-test-selector.mjs src/server/services/fill-reconciliation-service.ts`

### evidence-receipt.mjs
Turns structured worker evidence into the short GPT receipt format. It fails closed when required proof is missing, requires `pushed=true` and `stopped_for_gpt=true`, and redacts common secret forms.

Example:
`node evidence-receipt.mjs --input receipt.json --output receipt.md`

### worker-bootstrap.mjs
Read-only worktree guard. It verifies exact worker identity input, expected branch, clean Git status, current HEAD, and active order. It never changes branches or files.

Example:
`node worker-bootstrap.mjs --worker worker-1 --expected-branch h1-wave4-sealed12-driver --order AR-1138`

### lane-boundary-guard.mjs
Fail-closed pre-edit path guard for the two Claude workers. It allows only paths that match the selected worker's obvious lane, blocks obvious other-worker paths, requires handoff for known shared coordination paths, and sends unknown ownership to review instead of inventing authority.

Examples:
`node lane-boundary-guard.mjs --worker worker-1 src/server/compiler/lower.ts`

`node lane-boundary-guard.mjs --worker worker-2 src/server/services/fill-reconciliation-service.ts`

A non-zero exit means Claude should not silently proceed on the supplied path set.

### commit-evidence-verifier.mjs
Mechanical verifier for worker receipts. It checks that the reported commit exists in Git, that the reported branch contains it, and that `files_changed` exactly matches the commit diff. It also requires the receipt to assert `pushed=true` and `stopped_for_gpt=true`.

Example:
`node commit-evidence-verifier.mjs --input receipt.json --repo .`

This reduces repeated self-review paperwork, but it does not replace GPT's semantic review of production code and tests.

### branch-collision-audit.mjs
Read-only comparison for two worker refs. It finds the merge base, computes each branch's changed-path set, and fails closed on exact path overlap. No overlap is only a path-collision result; semantic/shared-contract coordination rules still apply.

Example:
`node branch-collision-audit.mjs --left worker-1-branch --right worker-2-branch --repo .`

### resume-anchor-guard.mjs
Read-only exact-state guard for resuming paused Claude work. It verifies the expected branch, exact expected commit, and clean worktree before work resumes. A moved branch, wrong branch, or dirty tree is a stop rather than an implicit rebase of the worker's mental model.

Example:
`node resume-anchor-guard.mjs --expected-branch h1-wave4-sealed12-driver --expected-head <sha>`

### edit-scope-guard.mjs
Fail-closed packet-scope checker. Given an explicit authorization file and a base/head diff, it rejects any changed path outside the exact files or explicit directory prefixes the active packet authorized. Empty scope is rejected; there is no implicit "anything goes" mode.

Example scope:
`{"allowed_exact":["src/a.ts","test/a.test.ts"],"allowed_prefixes":["fixtures/ar-1138/"]}`

Example:
`node edit-scope-guard.mjs --base <start-sha> --head HEAD --scope-file packet-scope.json`

### ci-failure-triage.mjs
Fail-closed GitHub Actions jobs summarizer. It strips successful-job noise and surfaces failed jobs/steps. Cancelled jobs are not green, and queued/in-progress jobs return `INCOMPLETE` rather than a false success.

Example:
`node ci-failure-triage.mjs --input jobs.json`

This is triage only; it does not reinterpret a failing job as acceptable or replace the underlying logs when root-cause inspection is required.

## Test

`node --test advisor-prepared/gpt-speed-engineering-lane/tooling/*.test.mjs`

The dedicated GitHub workflow runs these tests without installing project dependencies.
