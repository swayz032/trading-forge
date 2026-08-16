# Worker 1 — Resume Anchor

Owed by AR-1255 §3.2 (load-bearing state must live outside chat) and AR-1257 §11 (the fresh
session consumes a small resume packet, not the old conversation). **Overwrite this file at every
packet boundary — it describes the CURRENT boundary only, never history.**

```text
LAST UPDATED    : 2026-08-16, by the AR-1270 seat, at its own session boundary
WORKTREE        : C:\Users\tonio\Projects\wt-claude-worker1-20260815
BRANCH          : claude/worker1-h1-20260815
HEAD            : refs/heads/claude/worker1-h1-20260815 — resolve it, do NOT pin it.
                  Committing this file moves the head it would name, so a SHA here is stale by
                  construction, one commit behind, forever.
TOOLBOX         : claude/worker1-p1-toolbox-20260816 @ 18108039  (pin == branch, no drift)
                  bundle 1d12f61277d8d3c502df9bd7dea5dac541e64335e469fd7176187f4b02144b06, 42 files
LAST DELIVERED  : AR-1270 — seat pin aedacf7a, toolbox pin 18108039. Published to the GPT branch at
                  a882c700 and read back from origin against a negative control. AWAITING GRADE.
NEWEST RULING   : advisor-reports/AR-1269A-GPT-OPERATOR-AUTHORIZATION-ONE-NON-G2-OPUS-CALIBRATION-2026-08-16.md
                  (layered on AR-1269; both on the GPT branch — read them back from origin)
NEWEST WORKER AR: advisor-reports/AR-1270-WORKER-F5-F6-CLOSED-FOR-CLAUDE-TOOL-SURFACE-REPINNED-CALIBRATION-UNSPENT-2026-08-16.md
NEXT WORKER AR  : AR-1271
G2 BUDGET       : 0/8 spent. queue 5935b1c6… · 8 ready · receipt dir README-only.
                  RE-MEASURED AFTER the AR-1270 re-pin, not carried across it.
```

## Your assignment — THERE IS NO OPEN WORK ORDER. AR-1270 is delivered and ungraded.

**Do not invent the next packet.** AR-1269 §6 is executed and published; the next authorized task
comes from GPT's ruling on AR-1270. Read that ruling first — it exists by now or it does not, and
if it does not, the honest state is *waiting on a grade*, not *free to pick something up*.

**Two questions AR-1270 explicitly asked GPT to rule on. Do not pre-empt either:**

```text
§3.1  the Bash fence is UNIFORM over the whole self-protected set, which is WIDER than the
      three-shape floor AR-1269 §6B set. It therefore also denies a harmless read of a protected
      file, and denies Bash naming the pinned toolbox dir (so running the toolbox's own tests BY
      PATH is denied inside a guarded seat). Deliberate and disclosed. Narrowing it is one field.
§8    HONEST RESIDUAL: the fence is REFERENCE-based. It covers commands that NAME a protected
      surface. It does NOT cover one that reaches a protected surface WITHOUT naming it — a
      variable holding the path, a symlink, `cd <dir>` then a bare basename absent from
      bash_tokens. That class was not enumerated and is NOT claimed closed.
```

## 🛑 THE ONE THING THE NEXT SEAT MUST GET RIGHT: THE CALIBRATION NEEDS A **GUARD-BOUND** SEAT

AR-1269A authorizes **exactly one** non-G2 Opus calibration for the §9H runtime witness. **It is
UNSPENT.** The AR-1270 seat did not spend it, deliberately.

```text
repairing the guard  REQUIRES an UNGUARDED seat   ("a guarded seat cannot repair its own guard")
witnessing the guard REQUIRES a   GUARDED seat    (the hook must actually be installed)
                     -> MUTUALLY EXCLUSIVE IN ONE SESSION. AR-1270 had to be the unguarded one.
```

`[MEASURED 2026-08-16]` the AR-1270 seat's project dir was the OUTER repo, whose PreToolUse
matchers are `Write|Edit|MultiEdit` and `Bash`; `grep -c claude_guard_hook` = **0** across every
settings file binding it, and no `Agent`/`Task` matcher exists there. An Agent dispatch from such a
seat traverses **no worker-1 guard at all**, so it cannot witness the installed hook — it would
burn the single authorization on a null result.

⇒ **The calibration must run in a session whose project dir IS
`C:\Users\tonio\Projects\wt-claude-worker1-20260815`, seated AFTER the re-pin so it picks up
`18108039`.** Measure your own binding before you dispatch anything — do not assume it either way.
Its four required witnesses: a real native `Agent` dispatch traversing the installed PreToolUse ·
requested model Opus · actual model identity / task id / usage captured, or honestly recorded as
`NOT_EXPOSED_BY_CLAUDE_CODE_SUBSCRIPTION_RUNTIME` · the frozen eight untouched.
**Calibration is NOT one of the eight. It is still gated behind F-5/F-6 being ruled green.**

★ `A CAPABILITY AUTHORIZED TO A SEAT THAT CANNOT EXERCISE IT IS NOT YET AUTHORIZED.`

## What AR-1270 closed, so you do not re-derive it

```text
A  SELF_PROTECTED_RULES now covers the frozen queue (exact) and the receipt namespace (prefix).
   The receipt half was the real one: outstandingCapture() reads capture off fs.existsSync, so a
   writable receipt dir let the worker manufacture the state that clears the forced-capture stop.
   🛑 The QUEUE half is BOUNDED — the native-call manifest pins the queue sha and the guard
   compares it, so a queue edit already failed closed. Do NOT re-describe it as an auth bypass.
B  a protected-surface FENCE runs BEFORE bashMutationReason() on the Bash arm. Extra distinctive
   spellings live in a `bash_tokens` field ON THE RULE, opt-in per rule — the bare basenames of
   `.claude/settings.json` and `.claude/hooks/` are `settings.json` and `hooks`, far too generic
   to fence a shell command on. bashMutationReason is now EXPORTED, for the red proofs only.
C  re-pin e0c44ca4 -> 18108039, descendant asserted. 10/10 controls through the REGISTERED
   command. Stale-cache control still bites vs a planted pre-fix toolbox under a stamp claiming
   the new pin. SessionStart still arms; governed dirty exception e200765c still in force.
controls: 177/177 toolbox (was 159/159) + 10/10 registered-command. ALL LOCAL — no CI at either pin.
```

## New traps this boundary paid for

```text
harness  🛑 THE ONE TO STUDY, and it bit me THREE TIMES in one packet: a POSIX path where Windows
         needs a Win32 one. `$PWD` as the hook's `cwd` surfaced as `spawnSync git ENOENT` — Windows
         reports a BAD CWD AS ENOENT, so it reads as a missing binary. Then bash `${W//\//\\\\}`
         produced invalid JSON escapes. Then POSIX paths into python's `open()`. Use `pwd -W`, and
         build JSON with json.dumps, never shell string surgery.
         ★ ALL THREE FAILED UNIFORMLY ACROSS EVERY CASE INCLUDING THE DISCRIMINATORS. That
         uniformity is what identified them as harness defects. `A UNIFORM FAILURE ACCUSES THE
         INSTRUMENT; A SELECTIVE ONE ACCUSES THE CODE.`
parser   my control parser read EMPTY STDOUT as ALLOW — a false green in the instrument, during a
         run whose entire purpose was checking a boundary. Empty stdout + nonzero exit is an
         ERROR, never a pass. Never let a crash score as a verdict.
redgreen the red proof needed INERT IMPORT SHIMS in the pre-fix tree (export the existing
         bashMutationReason; a bashProtectedSurfaceReason returning null). Neither invents
         behaviour — the pre-fix tree really had no fence. Without them: one collection error and
         a blunt RED instead of 16 behaviour-judged reds. DISCLOSE the shims when you use them.
staleness the doorway's stale-cache control is worth reproducing as a PLANT, not an assertion:
         put the OLD permissive guard in the TEMP cache under a stamp claiming the NEW pin, then
         run a control that must DENY. Pair it with a positive witness that rematerialization
         actually happened (grep the cached file after), or "it denied" is consistent with the
         tamper simply not mattering.
headline AR-1269 §8 convicted three consecutive packets of titles wider than their mechanism.
         AR-1270 put the SURFACE in the title ("closed for the Claude tool surface") and the scope
         disclosure ABOVE the evidence rather than in a caveat below it. Keep doing that.
ear      armed at ab4ddbb3 and fired within seconds — AR-1269A landed MID-TURN. It fired again on
         my own push. An orphan ear from a dead seat (PID 27080, owner 29760 gone) was found
         running and was NOT killed. Arm your own; a live process is not your ear.
```

## Still-open inherited items

```text
§9H      calibration — UNSPENT, authorized by AR-1269A, blocked on seat binding (see above).
D1-C2    actual_model_identity remains UNWITNESSED. Do NOT widen APPROVED_ACTUAL_MODEL_IDENTITIES.
grader   no independent grade on AR-1270. Not required by AR-1269; one word and it goes out.
finish   claude-finish-check still carries the old structural REVIEW_REQUIRED problem. It cannot
         bite while finish.enabled is false, and TaskCompleted stays UNREGISTERED — registering
         the prepared fragment verbatim bricks the seat.
AR-1242  canonical_regression_population.txt membership test is ALREADY RED (9 files drifted).
AR-1259 §4-6 canonical agent authority = the version-controlled .claude/agents at the governed
         ref; local Sonnet pins are unauthorized deployment drift; 3 paper-parity payloads parked.
         Do not sweep historical worktrees, do not touch Worker-2.
dirty    docs/wave25-exit-engine-ab-report.md stays dirty ON PURPOSE, governed by the hash
         exception e200765c…. Verified intact at this boundary, including across a pre-commit
         stash window. Do not sweep, clean, commit, or flip require_clean.
conditionIsSpent() is CORRECT AS WRITTEN. It reads like it contradicts the durable law and it does
         not — the guard, not the caller, is what claims. Do not "fix" it.
```

## Locks — unchanged

```text
sVkm certification · sVkm compiler authorization · sVkm backtest campaign
PAPER · Worker-2 runtime activation · broker / Topstep / live
all eight real frozen G2-D calls · G2-H OPEN · CERT RED
no CI at either pin — all execution evidence is LOCAL. No G2 attempt is spent to test a guard.
```

## Before you touch anything

1. **Arm the 2s ear** (onboarding step 2). An ear you did not see arm in *your own* chat is not
   yours, however alive its process looks. Then backfill against the head named above.
2. Prove the newest ruling's `CURRENT HEAD` is an ancestor of yours (`merge-base --is-ancestor`).
   Do not trust a SHA pinned in an onboarding file or in this card once the branch advances.
3. Run the read-only preflight FIRST and confirm 8 ready / 0 spent before any work.
4. **Measure whether YOUR session is guard-bound** — it decides which of the two open jobs you can
   even do. `grep -c claude_guard_hook` across every settings file that binds you, and check for an
   `Agent|Task` matcher. Do not assume it in either direction.
