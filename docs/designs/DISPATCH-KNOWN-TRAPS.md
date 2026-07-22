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
> 2b. **THE PROJECT `.venv` IS UNUSABLE FOR THE ENGINE SUITE** — it is missing `filelock`, which
>    fails COLLECTION of `test_cloud_backend.py`, `test_cross_engine_parity.py`, `test_watchdog.py`.
>    **Use system `python`** (3.13 / pytest 9.0.3 collects all 8107 cleanly in ~13s). Collection
>    failures in `.venv` are this, not a real defect.
> 2c. **★ RUNNING THE SUITE IS A WRITE OPERATION.** It MUTATES tracked files under `docs/`
>    (`A12-AUDIT-REPORT.md`, `wave25-exit-engine-ab-report.md`) — proven on FRESH worktree checkouts,
>    which are clean by construction. **So a dirty tree after a run may be your own footprint, not a
>    neighbour’s edit.** (This misattribution ran for a whole session here.) **Attribute unexplained
>    dirt by EVIDENCE, never by assumption.**
> 2d. **★ FRESH WORKTREES CHECK OUT CRLF — a new worktree is NOT byte-identical to an older one.**
>    Any test or check that pins a FILE HASH will differ **for free**, with no code change. Seen
>    here: a fresh arm showed a commit "fixing" 7 unrelated tests; the real cause was 86 line endings
>    (5794 vs 5708 bytes) breaking hash pins the older arm satisfied. **It was caught only because
>    "my commit fixed 7 unrelated tests" is implausible.** Use `core.autocrlf false` when you pin
>    hashes, and **treat a too-good result as a bug report about your instrument.**
> 2e. **★ `engine.X` AND `src.engine.X` ARE DIFFERENT MODULES — and possibly a DIFFERENT REPO.**
>    A global editable-install `.pth` puts another checkout's `src` on system-python's path, so
>    `import engine.foo` can resolve **outside the tree you are measuring**. Enforcement checks the
>    `src.engine` identity. **Always import via `src.engine.*`.** A red-proof once showed a guard
>    "dead" purely from importing the other identity.
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
> 6b. **★ VERIFYING BY CHECKOUT IS A WRITE — and in a shared tree a write is a COLLISION.**
>    `git checkout <sha> -- <files>` is the *safe* way to pin files for a differential **in a private
>    worktree**. In a tree another session commits from, it **silently overwrites their work**, and
>    their next commit **adopts it with no conflict shown**. This happened here: a differential's pin
>    reverted a freshly-landed fix's tripwires; the **code survived and only the TESTS were reverted**,
>    so HEAD carried a live fix with four tests red asserting a defect that no longer existed —
>    **and `git status` was CLEAN throughout, because the revert was already committed.**
>    **A clean status over a committed revert is invisible by construction.** Pin files only inside a
>    worktree you own.
> 6c. **★★ ONE COMMIT FORM IN A SHARED TREE: `git commit -o <paths> -F <msgfile>` — FOR EVERYTHING,
>    including docs and journals.** Never `git add` + bare `git commit`: that commits **the whole
>    staged index**, which in a shared tree contains other agents' work. Here one `-o`-less commit —
>    labelled *"session log"* — carried **−150 lines of another agent's test file**, making its own
>    message a false caption about its own diff. ★ **A habit that does real work must not have
>    exceptions; the exception is exactly where it fails.** **After committing, run
>    `git show --stat HEAD` and confirm the file list is what you named.**
> 6d. **★★★ A GRADER NEVER CHECKS OUT IN THE SHARED TREE — a bare `git checkout <sha>` (no `--`)
>    DETACHES HEAD and reverts EVERY tracked file to that SHA.** For a before/after differential
>    (pre-fix vs post-fix), moving the shared tree's HEAD to `<sha>~1` then `<sha>` **rewrites every
>    working file to the old state** — the newest relay entries VANISH from the files (they stay safe
>    under the branch ref, but the file on disk is reverted), and the grader's own measurement surface
>    changes back underneath it on reattach, so **its verdict cannot carry a clean scope line and does
>    not count.** This happened here: a fifth-attack grade walked `8f0ff2f0~1 → 8f0ff2f0` in the shared
>    tree; AR-256 and R-268 disappeared from the files; recovered ZERO-LOSS only because the branch ref
>    held and the ledger had been committed two hours earlier. **Before/after states come from
>    `git show <sha>:<path>` into a standalone, or from a SEPARATE WORKTREE you own
>    (`git worktree add --detach <tmp> <sha>`) — NEVER from moving the shared tree's HEAD.** cwd-verify
>    was already mandated; this adds NEVER-CHECKOUT.
> 7. **ANY COUNT THAT ENTERS A RECEIPT** (tests, deltas, timings) **must be measured in an isolated
>    worktree pinned to your commit.** A number measured in a shared tree does not reproduce from
>    the SHA. `git worktree add --detach <tmp> <sha>` → measure → `git worktree remove`.
> 8. **★ IF YOU RUN A DIFFERENTIAL, PROVE THE ARMS ARE DISTINCT FIRST.** A before/after suite diff
>    here once reported **identical totals on both arms for a commit that ADDS 14 TESTS** — the same
>    measurement run twice, wearing a comparison's name. Every explicit check was green; **only the
>    arithmetic refusing to reconcile caught it.** Before any outcome-diff: print `git rev-parse HEAD`
>    **from inside each worktree** (never infer it), diff the **collected test-id sets**, and **NAME
>    the ids one arm has and the other lacks.** **If the arms cannot be made to differ, that is your
>    finding — report it.**
> 9. **★ RECONCILE LOAD-BEARING NUMBERS AGAINST SOMETHING OUTSIDE THEIR OWN PIPELINE.** Counts that
>    must add up, invariants that must hold. **Greens are necessary; reconciliation is sufficient.**

> ### ★ YOUR FINAL MESSAGE IS YOUR ONLY DELIVERY CHANNEL
> **Your final message MUST contain the results, or the words NOT RUN.** A promise of future delivery
> in a final message is a **null deliverable — you will not exist to keep it.** One agent here
> declared runs "in flight" and terminated **three times**; all were presumed dead and none delivered,
> including one carrying the best finding on the board. **Finish inside the message, or say NOT RUN.**

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
