# Claude Native Guard Hooks — GPT Candidate

Status: **implemented and tested on the isolated GPT speed-engineering branch; NOT authorized for active AR-1138 installation.**

Purpose: make the existing worker laws mechanically enforceable by Claude Code instead of relying only on remembered instructions.

## What is enforced

1. **SessionStart anchor check**
   - exact expected worker branch;
   - exact paused commit;
   - clean worktree by default;
   - only a successful anchor check writes `TF_CLAUDE_GUARD_ANCHOR_OK=1` into the Claude session environment.
   - SessionStart itself is context-only in Claude Code, so every guarded edit/completion independently requires that marker.

2. **PreToolUse for Edit / Write / NotebookEdit**
   - refuses if the session anchor was not armed;
   - resolves the real repository-relative target path;
   - runs the existing lane-boundary guard;
   - runs the existing explicit packet edit-scope guard;
   - denies cross-lane, shared/unknown, out-of-scope, and outside-repository paths;
   - a safe result does **not** auto-approve Claude permissions. It simply adds no extra denial.

3. **PreToolUse for Bash**
   - normal read/test commands remain available;
   - blocks branch/history mutations such as checkout/switch/reset/clean/rebase/merge/cherry-pick/force-push;
   - blocks common direct file mutation and output-redirection paths so Claude cannot trivially bypass native Edit/Write path enforcement;
   - this is defense in depth, not a shell sandbox. Worker worktree isolation and Git review remain required.

4. **TaskCompleted**
   - blocks if the session anchor was not armed;
   - blocks unless packet finish verification is explicitly armed;
   - loads a receipt from an untracked `.git/` path;
   - runs the existing one-command finish check: real diff, explicit scope, lane ownership, receipt/commit identity, clean tree, and optional other-worker collision check;
   - a mechanical pass is only `PASS_FOR_GPT_REVIEW`, never semantic approval.

## Files

- `settings.fragment.json` — candidate Claude Code hook configuration. Do not copy into `.claude/settings.json` until activation is authorized.
- `worker-guard.example.json` — per-worker/per-packet manifest shape. Installed runtime target is `.claude/gpt-worker-guard.json`.
- `../tooling/claude-hook-runner.mjs` — fail-closed command entrypoint used by Claude Code.
- `../tooling/claude-hook-bridge.mjs` — hook policy/evaluation library.

## Activation gate

Do not install this candidate into the active Worker 1 session while AR-1138 is unfinished.

Activation sequence remains:

1. AR-1138 completed, committed, pushed, reported.
2. GPT independently grades AR-1138 PASS.
3. Resolve the real installed canonical `worker-execution` skill and Worker 1/2 onboarding paths.
4. Materialize one exact worker manifest per active packet.
5. Merge the candidate hook fragment with any already-installed Claude settings; do not overwrite unrelated hooks.
6. Run positive + negative controls in both isolated worktrees.
7. Run the Agent Teams identity/message smoke test.
8. GPT grades the installed behavior before parallel production implementation starts.

## Robustness limitations intentionally preserved

- Hooks do not replace Git worktrees, branch isolation, CI, or GPT semantic review.
- The Bash mutation screen is deliberately conservative but is not a complete shell parser/sandbox.
- SessionStart cannot itself block startup under Claude Code's hook contract; the session marker makes subsequent guarded mutations fail closed instead.
- No broker egress, Topstep network, PAPER activation, compiler semantics, or Worker 2 activation is changed by this bundle.
