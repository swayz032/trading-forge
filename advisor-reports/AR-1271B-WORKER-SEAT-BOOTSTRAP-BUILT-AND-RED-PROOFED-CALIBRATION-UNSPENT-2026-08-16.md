# AR-1271B WORKER — SEAT BOOTSTRAP BUILT AND RED-PROOFED; CALIBRATION STILL UNSPENT, 0/8 FROZEN

**Date:** 2026-08-16
**Author:** Claude Code, Worker-1 seat (the third consecutive UNBOUND seat)
**Ruling executed:** `AR-1271A` §4/§5 (bootstrap repair before calibration)
**Prior ruling:** `AR-1271` §10 (AR-1272 calibration packet — NOT executed, correctly)
**Worktree:** `C:\Users\tonio\Projects\wt-claude-worker1-20260815`
**Branch:** `claude/worker1-h1-20260815`
**Head at report:** `9b09fc88361bcbb4439fc31c74889494338275a2`
**Commits in this packet:** `8e1dcf22` (root cause), `6d69f822` (launcher), `9b09fc88` (skill gate)
**Doctrine repo commit:** `a4fc686` on `ops/claude-doctrine` (skill parity copy)

## 0. NUMBERING — PLEASE CORRECT IF WRONG

`AR-1271` §10F reserves **AR-1272** for the calibration packet and says nothing else may be
published under that number. The calibration has **not** run, so this report deliberately takes
**AR-1271B**, as a sibling to GPT's own AR-1271A, leaving AR-1272 free. If GPT wants a different
number, say so and it will be renamed rather than argued.

## 1. WHAT WAS ORDERED AND WHAT LANDED

AR-1271A rejected this seat's handoff (`cd <worktree> && claude`) as an operating procedure and
ordered the smallest durable startup mechanism that removes the operator from seat binding.

**Delivered:**

| Artifact | State |
|---|---|
| `scripts/worker1_seat_launch.ps1` | committed `6d69f822` — checks + launch, fail-closed |
| `scripts/install_worker1_seat_shortcut.ps1` | committed `6d69f822` — re-runnable installer |
| `C:\Users\tonio\Projects\trading-forge\worker1-seat.ps1` | generated resolver |
| `Desktop\Claude Code - Worker 1.lnk` | installed |
| `.claude/skills/worker-1-compiler-onboarding/SKILL.md` step 0 | committed `9b09fc88` + doctrine `a4fc686` |

**No Agent/subagent call was made in this packet. Zero.**

## 2. ROOT CAUSE — MEASURED, AND IT IS STRUCTURAL

The existing Desktop shortcut `Claude Code - Trading Forge` runs, verbatim:

```
-NoExit -ExecutionPolicy Bypass -Command "Set-Location 'C:\Users\tonio\Projects\trading-forge'; claude"
```

`[MEASURED]` that directory **is not a git repository** —
`git rev-parse --is-inside-work-tree` there returns `fatal: not a git repository`. The real repo is
one level deeper at `...\trading-forge\trading-forge`. Its `.claude/settings.json` (which belongs to
a *separate* `ops/claude-doctrine` repo nested at `.claude`) registers `grading-guard.ps1` /
`advisor-ruling-guard.ps1` on `Write|Edit|MultiEdit` — `grep -c claude_guard_hook` = **0**, no
`Agent` matcher, and `scripts/claude_guard_hook.mjs` does not exist there at all. User-level
`~/.claude/settings.json` declares no `hooks` key.

⇒ **Registration lives in the worktree; binding lives in the launch directory.** A correct worktree
cannot rescue a wrong launch directory. This is why three seats in a row were unbound; it was never
bad luck, and it would have recurred indefinitely.

`[MEASURED]` this CLI has no `--project-dir`/`--cwd` flag. `--add-dir` only widens tool access;
`--settings` would not fix `$CLAUDE_PROJECT_DIR` expansion inside the registered hook command. The
launch directory is the only lever, which is why the fix is a launcher and not a flag.

## 3. DESIGN DECISIONS AND WHY (AR-1271A §4 preference order)

1. **Repaired the existing entrypoint class, did not invent a new concept** — a Desktop shortcut is
   already how Worker 1 is started.
2. **ADDED a shortcut rather than repointing the existing one.** `Claude Code - Trading Forge`
   serves every lane; repointing it would silently hijack Worker-2, advisor and general sessions.
   `[VERIFIED]` its arguments are byte-unchanged after this packet.
3. **The seat worktree is RESOLVED, not baked.** `git worktree list --porcelain` filtered by
   `refs/heads/claude/worker1-h1-*`. Only the non-dated primary repo path is baked. The next dated
   worktree needs no edit anywhere. Anything other than exactly one match refuses rather than
   guessing.
4. **No hooks were copied or weakened anywhere** to hide the cwd problem. Nothing outside the two
   new scripts, the generated resolver, the shortcut and the skill was touched.
5. **No repository restructuring.**

## 4. CONTROLS (AR-1271A §5) — ALL `[MEASURED HERE]`

### Positive, through the real entry path (resolver → launcher)

```
guard  : ARMED
         GPT worker guard: anchor verified on claude/worker1-h1-20260815 at 9b09fc88...
         Governed dirty exception in force: docs/wave25-exit-engine-ab-report.md @ e200765c11e8
frozen : 8 queued / 0 spent | receipts+0 | sha 5935b1c6c038
seat OK -- branch claude/worker1-h1-20260815.   exit 0
```

Project identity, branch, guard-registration-with-`Agent`-matcher, doorway presence, an **observed**
SessionStart arm witness, and a read-only frozen snapshot — all before Claude is started.
The arm witness is re-run after every commit, because it names the head and therefore decays.

### Negative

| Control | Result |
|---|---|
| launcher on a non-repo tree | REFUSED exit 1; named C1/C3/C4/C5 |
| launcher on a real repo, wrong branch, no guard | REFUSED exit 1; named C2/C3/C4/C5 |
| resolver, glob matching 0 worktrees | REFUSED exit 1 |
| resolver, glob matching 2 worktrees | REFUSED exit 1, named both |
| installer given a non-parsing / non-ASCII target | REFUSED to install |

**The C5 arm branch is demonstrably not a constant:** during development it refused for three
*distinct genuine* reasons (BOM-corrupted stdin, wrong cwd, untracked files) before it ever went
green.

### No-spend proof — before and after

```
queue sha : 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939  (unchanged)
queue len : 8        attempts : {}        receipts : README.md only
frozen .attempt/.dispatch/.raw/.completion : 0
governed dirty-exception hash : e200765c11e8...  (unchanged, re-verified after every commit)
untracked files : 0
```

**FROZEN G2-D: 0/8 SPENT. AR-1269A CALIBRATION: AUTHORIZED AND UNSPENT.**

## 5. DISCLOSURES (0-CTRL.4)

- **Three instrument failures in this packet, all the same shape — the artifact was fine and the
  measurement lied.** (a) The launcher was written UTF-8-no-BOM; PowerShell 5.1 decoded its
  em-dashes as CP1252, manufacturing smart double-quotes, and the parser reported a *missing brace
  on a line whose braces were correct*. Fixed by making launcher scripts ASCII-only, **enforced by
  the installer**. (b) The arm probe's stdin acquired a BOM;
  `$OutputEncoding`, `BaseStream.Write` and closing `BaseStream` instead of the writer **all failed
  identically** (37 bytes beginning `EF BB BF` where 34 were written) because
  `Process.StandardInput` emits the preamble when first *accessed*. Fixed by letting `cmd.exe` do
  the redirect. (c) The probe ran from the container, so the guard answered *"not a git
  repository"* — the same decoy that caused the whole defect. Fixed with `Push-Location`.
- **An earlier control denied for the WRONG reason and nearly passed as the right one** — a
  msys-style scratch path made the guard answer `manifest not found` instead of the bad-pin
  refusal under test. Caught only by reading the reason string.
- **Commit `8e1dcf22` has a malformed subject** (a stray `@` line, and it lost its
  `Co-Authored-By` trailer) because PowerShell here-string syntax was used inside the Bash tool.
  **It was NOT force-pushed to tidy** — the campaign rule forbids an index operation to fix an
  appearance. Disclosed instead.
- **Two copies of the Worker-1 skill exist** (worktree + `ops/claude-doctrine`), and this packet
  updated both. `[VERIFIED]` byte-identical after the change. This dual-copy arrangement predates
  this packet and remains a drift surface worth a disposition.
- `lane-manifest.md`, `role-overlay.md` and `worker-2-paper-runtime-onboarding/` are **untracked**
  in the doctrine repo. Pre-existing, not touched, not swept — reported only.
- **The launcher's `-CheckOnly` switch does not prove the final `claude` invocation binds.** It
  proves everything up to that point. The first true end-to-end witness is the next seat's own
  SessionStart context, which is why the skill's step 0 measures binding again from inside.

## 6. WHAT IS STILL NOT PROVEN

- **Live native Agent → installed PreToolUse traversal: still OPEN.** Unchanged by this packet;
  that is AR-1272's job.
- **Actual runtime model identity: still UNWITNESSED.**
- The broader Bash indirect-reference residual (AR-1271 §11) is untouched and still deferred.
- **CI: NONE.** All evidence here is local. Do not relabel it.

## 7. NEXT

`AR-1272` exactly as `AR-1271` §10A–§10G specifies, run from a seat started through the new
shortcut, with binding measured from inside before the one call is spent. One means one.
