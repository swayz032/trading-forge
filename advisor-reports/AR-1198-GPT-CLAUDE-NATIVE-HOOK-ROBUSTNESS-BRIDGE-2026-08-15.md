# GPT EXTERNAL ADVISOR RULING — AR-1198

**Status:** PASS — NATIVE CLAUDE ROBUSTNESS BRIDGE IMPLEMENTED / HOSTED GREEN / ACTIVATION STILL GATED

## Ruling

The GPT support lane now contains a bounded Claude Code native-hook bridge that reuses the existing worker enforcement authorities instead of creating a duplicate policy system.

Implementation head:

`dd1bc2306dee2f894272fa7c4a973c4812672dfe`

Branch:

`external-advisor/gpt-speed-engineering`

Hosted workflow:

`31871073091`

Hosted job:

`94979660815`

Result:

`SUCCESS`

The preceding hosted implementation run on `f7ed079b69244f07296353f8d0d4f62e075cc7c2` printed the full test census:

`86 tests / 86 pass / 0 fail / 0 cancelled / 0 skipped / 0 todo`

The exact final head `dd1bc2306dee2f894272fa7c4a973c4812672dfe` then re-ran the same tooling proof and completed GREEN.

## What was added

- `advisor-prepared/gpt-speed-engineering-lane/tooling/claude-hook-bridge.mjs`
- `advisor-prepared/gpt-speed-engineering-lane/tooling/claude-hook-bridge.test.mjs`
- `advisor-prepared/gpt-speed-engineering-lane/tooling/claude-hook-runner.mjs`
- `advisor-prepared/gpt-speed-engineering-lane/tooling/claude-hook-runner.test.mjs`
- `advisor-prepared/gpt-speed-engineering-lane/claude-hooks/settings.fragment.json`
- `advisor-prepared/gpt-speed-engineering-lane/claude-hooks/worker-guard.example.json`
- `advisor-prepared/gpt-speed-engineering-lane/claude-hooks/README.md`
- support-lane README integration notes.

## Enforcement behavior proved

### Session anchor

Claude `SessionStart` verifies the exact expected worker branch, paused SHA, and clean worktree. Only a successful check persists `TF_CLAUDE_GUARD_ANCHOR_OK=1` into the Claude session environment.

Claude Code's SessionStart hook is context-only, so the design does not falsely claim SessionStart itself can block startup. Instead, every guarded mutation/completion requires the successfully persisted session marker.

### Native edit path

`PreToolUse` for `Edit`, `Write`, and `NotebookEdit`:

- denies when SessionStart did not arm the exact worker session;
- resolves the real repository-relative target;
- reuses `lane-boundary-guard`;
- reuses explicit `edit-scope-guard`;
- denies cross-worker ownership;
- denies coordination/unknown ownership;
- denies outside-packet paths;
- denies repository escape;
- does not auto-approve normal Claude permissions when the path is safe.

### Bash bypass defense

`PreToolUse` for Bash keeps ordinary read/test commands available while blocking common direct mutation paths that would bypass inspected Edit/Write targets, including branch/history mutation, common direct file-mutator utilities, output redirection, and obvious scripted file writes.

This is explicitly defense in depth, not a shell sandbox. Separate worktrees, final Git diff review, CI, and GPT review remain authoritative.

### Completion gate

`TaskCompleted` fails closed unless:

- the worker session was anchor-verified;
- finish verification is explicitly armed;
- a real receipt exists in the configured untracked `.git/` path;
- `claude-finish-check` accepts the real commit/diff/scope/lane/evidence/collision state.

Mechanical success remains `PASS_FOR_GPT_REVIEW`, not semantic approval.

## Negative controls proved

The new tests prove at minimum:

- moved/dirty SessionStart does not arm the worker;
- edit before anchor verification is denied;
- Worker 1 cannot edit an obvious Worker 2 path;
- same-lane but unauthorized packet paths are denied;
- outside-repository paths are denied;
- Bash mutation attempts are denied while a normal test command remains available;
- TaskCompleted blocks when finish verification is not armed;
- a real clean commit + mechanically valid receipt can pass to GPT review;
- a false receipt is blocked;
- invalid/malformed guard manifests deny PreToolUse and block TaskCompleted instead of failing open.

## Activation law

**DO NOT install this candidate into the active AR-1138 Worker 1 session.**

The existing two-worker activation sequence remains controlling:

1. AR-1138 completes.
2. Worker commits, pushes, reports evidence.
3. GPT independently grades AR-1138 PASS.
4. Resolve/re-read the canonical installed `worker-execution` skill.
5. Install/verify Worker 1 and Worker 2 identity onboarding + role overlays.
6. Materialize an exact worker packet manifest.
7. Merge the candidate hook fragment into the real Claude settings without overwriting unrelated hooks.
8. Run positive and negative controls in separate worker worktrees.
9. Run Agent Teams identity/message smoke test.
10. GPT independently grades installed behavior before real parallel production execution.

## Preserved gates / safety

- AR-1138 remains first Worker 1 order.
- Worker 2 remains inactive until its existing activation gate.
- compiler/runtime future harness gates remain unchanged.
- PAPER activation remains controlled.
- broker egress remains OFF.
- Topstep live/network path remains OFF.
- no production trading semantics were changed.
- no main-branch production mutation was made.

## Final disposition

**ROBUSTNESS BRIDGE: PASS / HOSTED GREEN / READY FOR LATER GATED INSTALLATION.**

This closes the useful native-hook preparation work. Do not add more generic Claude infrastructure unless real worker execution exposes a measured failure-detection gap or repeated engineering cost.
