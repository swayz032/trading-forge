# Two-Worker Claude Install and Verification Checklist

Status: GPT-prepared; Claude-side local installation only after AR-1138 completion + GPT external grade.

## Phase 0 — gate

Do not install/activate while AR-1138 is still active.

Required first:
- AR-1138 completed;
- tests/evidence run;
- commit/push;
- worker report;
- GPT independent review approves activation.

## Phase 1 — inspect canonical local skills

Claude must directly inspect the installed local sources, including the canonical worker onboarding command/skill and `/root/.claude/skills/worker-execution/SKILL.md` (or the actual resolved paths if different).

Compare them against this GPT-prepared package. Preserve existing strong shared execution law. Do not blindly overwrite canonical `worker-execution`.

## Phase 2 — install distinct identity entrypoints

Create two resolvable onboarding identities, for example:
- `/worker-onboarding worker-1` or `/worker-1-onboarding`;
- `/worker-onboarding worker-2` or `/worker-2-onboarding`.

Exact mechanism may follow the existing Claude skill/command convention, but identity must resolve BEFORE any active history scan.

## Phase 3 — wire shared execution + role overlay

Each worker startup must:
1. resolve identity;
2. re-read canonical `worker-execution`;
3. apply its own role overlay;
4. read its own lane manifest;
5. read only its own active order/referenced history.

## Phase 4 — worktree/branch isolation

Prove each Claude instance uses a distinct worktree/branch before parallel implementation.

Worker 1 and Worker 2 must not concurrently edit the same semantic authority, migration, schema, or shared file without explicit serialization.

## Phase 5 — identity acceptance tests

### Positive controls

Worker 1 startup must report:
- `worker_id=worker-1`;
- role = Team Lead / Graph-Compiler-Factory;
- lane = `compiler-factory`;
- Worker 1 manifest loaded;
- Worker 2 default inbox not loaded.

Worker 2 startup must report:
- `worker_id=worker-2`;
- role = Runtime & Execution Engineer;
- lane = `paper-runtime-safety`;
- Worker 2 manifest loaded;
- Worker 1 default inbox not loaded.

Both must confirm canonical `worker-execution` was re-read from installed source.

### Negative controls

Prove:
- Worker 1 onboarding cannot silently resolve to Worker 2 identity;
- Worker 2 onboarding cannot silently resolve to Worker 1 identity;
- neither onboarding blindly scans every `advisor-reports/` file;
- a Worker 2-only active order is not accepted by Worker 1 without explicit reassignment;
- a Worker 1-only active order is not accepted by Worker 2 without explicit reassignment;
- cross-lane same-file ownership collision causes STOP/message/serialization rather than parallel edits.

## Phase 6 — Agent Teams smoke test

With no money-path mutation required, run a bounded communication smoke test:

1. Worker 1 sends Worker 2 a dummy artifact-contract message.
2. Worker 2 acknowledges the message without adopting Worker 1 identity or queue.
3. Worker 2 sends Worker 1 a dummy dependency/blocker message.
4. Worker 1 acknowledges without adopting Worker 2 queue.
5. Verify both remain on distinct branches/worktrees.

## Phase 7 — evidence/report

Claude reports:
- exact installed skill/command paths;
- diff from canonical onboarding and worker-execution;
- identity outputs for both workers;
- inbox/manifest outputs;
- negative-control results;
- worktree/branch proof;
- Agent Teams smoke-test evidence;
- any deviation from GPT-prepared source and reason.

Then STOP for GPT independent review before assigning real parallel implementation packets.