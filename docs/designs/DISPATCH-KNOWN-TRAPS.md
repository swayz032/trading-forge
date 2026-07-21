# DISPATCH KNOWN-TRAPS PREAMBLE — paste into every filesystem-touching brief

**Standing order (R-180 §1).** Every filesystem-touching dispatch brief carries the block below,
verbatim. **Rationale, minted the hard way: a subagent wiped `data_cache` via the junction trap —
and that trap was ALREADY an entry in our memory index. Memory that stays in memory protects nobody.
The brief is the only thing a subagent reads.**

Keep this file short enough that pasting it is never a burden. If a trap stops being real, delete it.

---

## THE BLOCK (copy from here)

> ### ★ KNOWN TRAPS — read before touching the filesystem
>
> These have each cost real time or real data on this project. They are not hypothetical.
>
> 1. **★ `rm -rf` ON A JUNCTION DELETES THE TARGET, NOT THE LINK.** Removing a worktree or a
>    `node_modules` that is a Windows junction **destroys the directory it points at.** A subagent
>    wiped `data_cache` (the campaign's primary market data) exactly this way.
>    **BEFORE deleting any directory you did not create: run `fsutil reparsepoint query <dir>`.**
>    If it does *not* error, it is a reparse point — **do not `rm -rf` it.**
>    Prefer `git worktree remove <path>` over manual deletion, and remove worktrees you created
>    **before** they can be confused with real directories.
> 2. **MEASUREMENT WORKTREES HAVE NO MARKET DATA.** `data_cache/` is gitignored, so a fresh
>    `git worktree add` **cannot** read bars. If a probe needs real data, either run it in the main
>    tree (**and say so**) or mark it COULD-NOT-VERIFY. **Never substitute synthetic data for real
>    bars** — that silently answers a different question.
> 3. **THE ENGINE SUITE IS SLOW, NOT HUNG.** `pytest src/engine/tests/` collects ~7,800 tests in
>    ~5-12s and then takes minutes. A prior wave claimed *"collection hangs"* and skipped coverage on
>    that basis; it was false. **Do not claim an untested limitation** — time it before you assert it.
> 4. **`npx tsc` NEEDS HEAP AND CAN FALSELY PASS.** Use
>    `NODE_OPTIONS=--max-old-space-size=8192`, and prefer a direct invocation
>    (`node node_modules/typescript/bin/tsc`) — a bare `npx` has reported **exit 0 while compiling
>    nothing**.
> 5. **★ THE RELAY LEDGERS ARE OUT OF SCOPE.** Do **not** write to
>    `docs/designs/AGENT-REPORTS.md` or `docs/designs/ADVISOR-RULINGS.md`. Those are written only by
>    the seated agent. **You report in your FINAL MESSAGE — that is the entire delivery channel.**
> 6. **THE PRE-COMMIT HOOK STASHES UNSTAGED FILES ON EVERY COMMIT.** If another agent is working the
>    same tree, its uncommitted work passes through your stash/restore. **Re-read before every edit,
>    and treat `git diff` returning empty where you expect content as evidence your edit was LOST**,
>    not as a no-op.
> 7. **ANY COUNT THAT ENTERS A RECEIPT** (tests, deltas, timings) **must be measured in an isolated
>    worktree pinned to your commit.** A number measured in a shared tree does not reproduce from
>    the SHA. `git worktree add --detach <tmp> <sha>` → measure → `git worktree remove`.

## (copy to here)

---

## STANDING FACTS these traps produced

- **`data_cache` IS NOW A REAL DIRECTORY, NOT A JUNCTION** (converted during the 2026-07-21 restore;
  kept deliberately per R-180 §2 — the trap cannot recur on a real directory, and a documented copy
  beats a silently-converted link).
  **★ CONSEQUENCE: it no longer tracks the canonical copy. When canonical market data updates,
  `data_cache` in this worktree MUST BE REFRESHED MANUALLY.**
  Canonical: `C:/Users/tonio/Projects/trading-forge/trading-forge/data_cache/`
  Verified state at conversion: **56 files · ES 5min = 460,323 rows · ES daily = 2,040 rows.**
- **NAMED CARRY:** `C:/tfg` is git-deregistered but undeletable (*"Device or resource busy"*). It
  holds **no unique data**. Retry `rm -rf /c/tfg` at each lane boundary; if it is still busy when the
  campaign closes, the command goes to the operator to run once the holding process exits.
