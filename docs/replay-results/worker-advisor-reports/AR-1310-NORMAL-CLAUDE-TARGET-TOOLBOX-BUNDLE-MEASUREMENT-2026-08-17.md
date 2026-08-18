# AR-1310 — Normal Claude session report: target toolbox bundle measurement

## Authority

AR-1310A (GPT external advisor ruling, commit `4c6b893ea4bb70430b71d8abc36fae6b83b6bfde` on
`origin/external-advisor/gpt-rulings`). This is the one bounded read-only measurement task it
authorized for "the current normal top-level Claude session" — not ordinary Worker-1 through its
self-protected guard, not a control-plane seat.

## Source Worker branch and HEAD before this report commit

- branch: `claude/worker1-h1-20260815`
- HEAD before this commit: `ed224b7cdbd2b8e454a1ca4319af5f7623b5e0ba` (AR-1309)

## Method

Reproduced `scripts/claude_toolbox.mjs::materialize()`'s bundle algorithm in a standalone
read-only script (not committed, not importing or editing the real toolbox file), run from this
worktree so `git` resolves against this repository:

1. `git ls-tree -r --name-only <commit> -- advisor-prepared/gpt-speed-engineering-lane/tooling`,
   filtered to paths ending `.mjs`.
2. For each path, `body = git show <commit>:<path>`; `name = basename(path)`;
   `sha256 = sha256(body)`.
3. `bundle_sha256 = sha256(manifest.map(m => \`${m.file}:${m.sha256}\`).join('\n'))` — single `\n`
   join, no trailing delimiter.

Verified against the actual source at `scripts/claude_toolbox.mjs:103-141` line by line before
running; matches exactly (same `TOOLBOX_DIR`, same `path.basename`, same join/hash construction).

## Target commit

- full SHA: `4c5f9d4adba5972a051aa845b98809bc2b6c7aa4` (verified reachable: `git cat-file -t` → `commit`)
- `.mjs` file count: **47**
- `bundle_sha256`: **`59d95f3c784f90ed08c20321bbb834ad0009a0167e64cb211168500932efdec0`**
  (64 hex chars, confirmed by direct length check)

## Positive control — current pin `b6c702821bc48281b02e16773c7c277ae17fb03f`

- observed `bundle_sha256`: `c8b7cec408b017ce6d2c04dcc4ad705726c3bfadbd9e9f4afb0a9d0c6aee894e`
- observed file count: 44
- expected (AR-1310A): `c8b7cec408b017ce6d2c04dcc4ad705726c3bfadbd9e9f4afb0a9d0c6aee894e`
- **PASS — exact match.** The reproduction is faithful; the target hash above is reported as
  authoritative.

## Frozen state reconfirmed (read-only, via `bootstrap.mjs --plan`)

- `frozen_queue_sha256`: `5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939` (unchanged)
- `ready`: 8
- `spent`: 0
- `receipts_readme_only`: true
- `agent_model_executions`: 0

## Confirmations

- **Zero Agent/Task/model calls** were made during this measurement.
- **Zero protected-file mutations.** No edit to `scripts/claude_toolbox.mjs`,
  `.claude/settings.json`, `.claude/worker1-hook-guard-manifest.json`, any
  `scripts/control-plane-bootstrap/*` source, or the frozen G2 plane. The only filesystem write in
  the repo tree is this report file. The standalone measurement script lives outside the repo
  (session scratchpad) and was never imported into or copied over the real toolbox module.
- `git status --short` was empty immediately before this report was written, and the only change
  staged/committed here is this file.

## Report commit SHA

This report's own commit SHA is recorded in the git log for this path
(`git log -1 --format=%H -- docs/replay-results/worker-advisor-reports/AR-1310-NORMAL-CLAUDE-TARGET-TOOLBOX-BUNDLE-MEASUREMENT-2026-08-17.md`)
on `claude/worker1-h1-20260815`, and is stated in the worker chat message accompanying this push
since a commit cannot embed its own hash without an amend (avoided per standing git protocol).
