# GPT Three Speeds — Engineering Tooling

This directory is the implementation lane for **Coding Loop Speed**, **Machine / CI Speed**, and bounded **Claude Support Engineering** helpers.
It does not own trading semantics, compiler meaning, PAPER decisions, or broker execution.

## Robustness law

A speed/support change is valid only when it preserves or strengthens failure detection. No speedup may come from skipping a required test, hiding a failure, weakening fail-closed behavior, or crossing Worker 1/2 ownership.

Support helpers may inspect worker changes, receipts, refs, CI evidence, timing data, and path ownership. They do **not** authorize semantic edits, activate Worker 2, bypass AR-1138, activate PAPER qualification, enable broker egress, or enable Topstep network access.

## Start / finish wrappers

### claude-preflight.mjs
One-command read-only start gate. It combines the exact paused branch/commit/clean-tree check with intended-path lane ownership. Any stale anchor, wrong lane, shared coordination path, or unknown ownership returns STOP rather than silently proceeding.

Example config:
`{"worker":"worker-1","expected_branch":"h1-wave4-sealed12-driver","expected_head":"<sha>","intended_paths":["src/server/compiler/lower.ts"]}`

Example:
`node claude-preflight.mjs --input preflight.json --repo .`

### claude-finish-check.mjs
One-command mechanical finish gate. It verifies the real base/head diff stayed in the authorized edit scope, re-checks lane ownership on actual changed paths, verifies the commit receipt, requires the checked head to equal the reported commit, requires a clean tree, and optionally checks exact-path collision with the other worker branch.

Example:
`node claude-finish-check.mjs --input finish.json --repo .`

PASS means **PASS_FOR_GPT_REVIEW**, not semantic approval. GPT still inspects production code, RED/GREEN validity, controls, architecture, and CI.

## Existing support tools

### changed-test-selector.mjs
Given changed repository paths, returns the smallest safe first test set it can prove. If it cannot prove a focused mapping, it deliberately escalates to full-fleet/full-CI instead of guessing.

### evidence-receipt.mjs
Turns structured worker evidence into the short GPT receipt format. It fails closed when required proof is missing, requires `pushed=true` and `stopped_for_gpt=true`, and redacts common secret forms.

### worker-bootstrap.mjs
Read-only worktree guard. It verifies exact worker identity input, expected branch, clean Git status, current HEAD, and active order. It never changes branches or files.

### lane-boundary-guard.mjs
Fail-closed pre-edit path guard for the two Claude workers. Obvious other-worker paths block; shared coordination paths require handoff; unknown ownership requires review.

### commit-evidence-verifier.mjs
Mechanical worker receipt verifier. The reported commit must exist, the branch must contain it, and `files_changed` must exactly match the commit diff. It does not replace semantic review.

### branch-collision-audit.mjs
Read-only comparison for two worker refs. It finds the merge base and exact changed-path overlaps. Zero overlap is not semantic merge authorization.

### resume-anchor-guard.mjs
Exact-state resume guard. Wrong branch, moved commit, or dirty worktree stops.

### edit-scope-guard.mjs
Packet-scope checker. Any actual changed path outside explicitly allowed files/prefixes stops. Empty scope is rejected.

### ci-failure-triage.mjs
GitHub Actions jobs summarizer. Successful-job noise is stripped; failed jobs/steps are surfaced. Cancelled and incomplete runs never become green.

## New Wave 3 helpers

### test-theater-detector.mjs
Conservative static screening for obvious fake-green/test-theater risks. It can block critical skip/todo declarations and configured production dependency mocks, and requires review when expected production import tokens or required mutation evidence are absent. A clean result is only `NO_STATIC_RISK_SIGNALS`; it never claims the test truly exercises production behavior.

### ci-root-cause-extractor.mjs
Redacting log-noise reducer. It extracts bounded context around likely failure signals, deduplicates repeated excerpts, and returns `NO_ROOT_CAUSE_SIGNAL_FOUND` rather than inventing a diagnosis when nothing useful is found. It cannot waive a failed CI job.

### test-hotspot-profiler.mjs
Deterministic timing profiler for normalized test timing rows. It ranks slow tests and computes individual/cumulative wall-time share. Timing evidence identifies optimization candidates only; it never authorizes skipping or weakening coverage.

## Native Claude robustness bridge

### claude-hook-runner.mjs + claude-hook-bridge.mjs
Gated Claude Code hook integration for the worker-company operating system. It reuses the existing resume-anchor, lane-boundary, edit-scope, finish-check, receipt, and collision authorities instead of creating duplicate policy.

When later activated per the existing AR-1138 / two-worker gates:
- `SessionStart` verifies the exact paused branch/SHA and arms a session marker only on success;
- `PreToolUse` blocks native edits that escape the worker lane or explicit packet scope;
- `PreToolUse` also blocks common Bash mutation paths that would bypass inspected Edit/Write targets while keeping normal read/test Bash commands available;
- `TaskCompleted` blocks completion unless the real commit/evidence packet passes the existing finish check.

Candidate hook settings and manifest examples live in `claude-hooks/`. They are intentionally **not** installed into `.claude/settings.json` on the active worker while AR-1138 is unfinished.

This bridge is defense in depth. It does not replace separate worktrees, Git history, CI, worker identity onboarding, canonical `worker-execution`, or GPT semantic review.

## Test

`node --test advisor-prepared/gpt-speed-engineering-lane/tooling/*.test.mjs`

The dedicated GitHub workflow runs these tests without installing project dependencies.
