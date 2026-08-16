---
name: worktree-session
description: >-
  Use when starting work on the Trading Forge repo while another Claude session
  may be active, when creating or landing any git worktree, when dispatching
  Agent-tool subagents with isolation:"worktree", when verifying (tsc/tests/CI
  gates) inside a worktree, or when a landed commit's diff looks larger than
  the reviewed change. Canonical spec: CLAUDE.md §11b — this skill is the
  operational procedure + the traps.
---

# Worktree Session — start, verify, land (multi-session safe)

## Why this skill exists (real incidents)

Shared working tree = shared `.git` index + `HEAD` + `refs/stash`. That caused
the 2026-05-19 86-file null-byte corruption (weeks of work wiped), cross-session
`git add -A` sweeps, and stash clobbers. A moving-HEAD worktree fork caused a
silent **846-line revert** that was caught only at the landing diff (2026-07-09).
A fresh worktree's missing node_modules made `npx tsc` run a **troll stub that
exits 0 while checking nothing** — two full verification cycles wasted on false
cleans. Every step below is load-bearing.

## START — create the worktree

1. Capture the intended base SHA explicitly:
   `git rev-parse <branch>` → record it.
2. `git worktree add <path> <SHA>` — **pin to the SHA, never a branch name.**
   A branch-name base tracks the moving shared HEAD; a concurrent branch
   switch/rebase reseeds your worktree from the wrong commit.
3. **Agent tool `isolation:"worktree"` hazard:** it forks whatever the shared
   `HEAD` points at AT SPAWN TIME. Writing "pinned to <SHA>" in the agent's
   prompt is COSMETIC — it does not control the base. Confirm the live HEAD
   equals your intended SHA immediately before dispatching, and never dispatch
   worktree agents while a concurrent session is rebasing. If the base cannot
   be guaranteed, use a manual explicit-SHA worktree instead.
4. **NEVER `git stash` in any worktree** — `refs/stash` is shared across all
   worktrees; a stash in one clobbers another's. Use a WIP commit or a patch
   file.

## VERIFY — inside the worktree (the false-clean traps)

A fresh worktree has **NO node_modules** (gitignored). Consequences:
- `npx tsc --noEmit` does NOT type-check — it either fails to resolve or runs
  a troll npm package literally named `tsc` that prints a joke and **exits 0**
  → looks GREEN, checked nothing. `npx tsx` intermittently fails too.
- FIX: junction the main checkout's node_modules:
  `New-Item -ItemType Junction -Path <wt>\node_modules -Target <main>\node_modules`
- Run the REAL binaries directly, bypassing npx:
  - `node node_modules/typescript/bin/tsc --noEmit`
  - `node node_modules/tsx/dist/cli.mjs <script>`
- **Baseline sanity (corrected 2026-07-09):** on the MAIN checkout, a working
  tsc genuinely reports exit 0 / zero errors (`npm run build` is plain `tsc`,
  not `--noCheck` — an earlier ~7036-error baseline pin was stale and has been
  retracted). In a dep-less WORKTREE, the troll `npx tsc` stub ALSO reports
  exit 0 — same symptom, opposite cause. Never trust `$?` through a pipe
  (`tsc | tail` swallows tsc's real exit code); check it immediately after
  tsc. If genuinely unsure which case you're in, inject one deliberate type
  error and confirm tsc catches it before trusting either result.
- Run the relevant vitest/pytest + the 3 CI gates:
  `check:production-isolation`, `check:2026-compliance`, `system-map:check`.
- **`system-map:sync` does NOT reconcile** the hand-maintained SSE inventory
  (System Map v2.md) or `docs/system-subsystem-registry.json` — those need
  manual edits (grep-verify a real `broadcastSSE("<evt>"` emitter before
  adding; zero emitters before removing).
- Junction cleanup BEFORE `git worktree remove`:
  `[System.IO.Directory]::Delete($path, $false)` — reparse-safe.
  **NEVER `Remove-Item -Recurse`** on the junction: it follows the link and
  deletes the REAL node_modules.

## LAND — integrate at the end

1. **Diff-stat tripwire (mandatory before push):** compare the commit's
   `+/−` stat against the reviewed/expected delta. The 846-line revert was
   caught because the stat read `+458/−1285` when the review said `+404/−35`.
   A large unexpected deletion count = wrong-base revert — do NOT push.
2. Rebase/merge onto the current shared tip and land **fast-forward-only**
   (`git merge --ff-only`). If FF is impossible, re-verify the diff still
   applies cleanly — never blind-merge over a concurrent session's work.
3. Commit-and-push per §11a. `git add -A` is safe ONLY inside the isolated
   worktree; on a shared tree it is banned.
4. `git worktree remove <path>` when done.

## RECOVER — wrong-base commit already made (not pushed)

1. Neutralize with compare-and-swap ref move (atomic, ignores merge-state
   races that make `git reset` fail):
   `git update-ref refs/heads/<branch> <good-sha> <bad-sha>`
   — first verify `<bad>^ == <good>` so ONLY the bad commit drops.
2. Re-apply the reviewed logic on the correct base: manual explicit-SHA
   worktree + `git diff <agentbase>^..<agenttip>` → `git apply --3way`.
   Reviewed LOGIC survives; wrong-base FILES don't.
3. Re-verify on the correct base: line counts sane, the change landed at the
   right call site (`--3way` can shift a hunk to a wrong context match),
   gates green.

## Fallback — genuinely cannot isolate (edit shared tree live)

Commit ONLY explicit paths: `git commit -o <paths>`. NEVER `git add -A`,
NEVER a bare `git commit`. `git status -sb` before every push. This is
strictly worse than isolation — last resort only.

## Red flags — stop immediately
- `git worktree add <path> <branch-name>` (base not pinned to SHA)
- Any `git stash` command in a worktree
- `npx tsc` / `npx tsx` inside a worktree
- tsc reporting 0 errors or exit 0 on this repo ("clean" = checker not running)
- Landing diff-stat that doesn't match the reviewed delta
- `Remove-Item -Recurse` on a node_modules junction
- `git add -A` outside an isolated worktree

**Severity: fail-CLOSED** — same tier as skipping commit-and-push.
