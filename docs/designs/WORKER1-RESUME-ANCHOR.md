# Worker 1 — Resume Anchor

Owed by AR-1255 §3.2 (load-bearing state must live outside chat) and AR-1257 §11 (the fresh
session consumes a small resume packet, not the old conversation). **Overwrite this file at every
packet boundary — it describes the CURRENT boundary only, never history.**

```text
LAST UPDATED    : 2026-08-16, by the THIRD consecutive NOT-guard-bound seat. It ran NO Agent call
                  and spent NOTHING (AR-1271 §10G). It did establish the ROOT CAUSE of the
                  recurrence and de-risk the reseat — see "WHY EVERY DEFAULT SEAT IS UNBOUND".
WORKTREE        : C:\Users\tonio\Projects\wt-claude-worker1-20260815
BRANCH          : claude/worker1-h1-20260815
HEAD            : refs/heads/claude/worker1-h1-20260815 — resolve it, do NOT pin it.
                  Committing this file moves the head it would name, so a SHA here is stale by
                  construction, one commit behind, forever.
TOOLBOX         : claude/worker1-p1-toolbox-20260816 @ 18108039  (pin == branch, no drift)
                  bundle 1d12f61277d8d3c502df9bd7dea5dac541e64335e469fd7176187f4b02144b06, 42 files
LAST DELIVERED  : AR-1270 — GRADED. GPT ruled it **PASS** in AR-1271. No rework ordered.
NEWEST RULING   : advisor-reports/AR-1271-GPT-EXTERNAL-ADVISOR-RULING-AR1270-PASS-WITH-BOUNDED-BASH-CLAIM-ONE-OPUS-CALIBRATION-NEXT-2026-08-16.md
                  GPT branch head 9fe19a95. ⚠️ GPT TOOK THE NUMBER 1271 FOR ITS OWN RULING.
NEWEST WORKER AR: AR-1270 (a882c700)
NEXT WORKER AR  : **AR-1272** — and AR-1271 §10F specifies exactly what AR-1272 must contain.
                  Do NOT publish anything else under that number.
G2 BUDGET       : 0/8 spent. RE-MEASURED HERE at this boundary, by the field that actually bears it:
                  queue sha 5935b1c6… · queue len 8 · excluded 4 · max_attempts_per_condition 1
                  attempts = {}   <- THE spent-ness field. Per-item `state`/`status` DOES NOT EXIST;
                  a guessed key returns None x8 and means nothing. Read `attempts`.
                  receipt dir non-README = [] .
```

## Your assignment — THERE **IS** AN OPEN WORK ORDER NOW: AR-1271 §10, the calibration packet

GPT graded AR-1270 PASS and issued the next work order in the same ruling. **Read AR-1271 §10A–§10G
in full; it is cold-start complete.** The short form:

```text
10A  RESEAT into a session actually BOUND to this worktree. Registration-by-file-presence is NOT
     binding. Capture session-start evidence proving you are on the Worker-1 guard path.
10B  READ-ONLY BEFORE snapshot of the frozen control plane (path · sha · 8 ready · 0 spent ·
     receipt listing · README-only).
10C  Spend EXACTLY ONE benign non-G2 native Agent call, model explicitly `opus`. ONE MEANS ONE —
     no second attempt if the first disappoints.
10D  Witnesses: real dispatch happened · it TRAVERSED the installed PreToolUse · requested model
     was Opus · actual model identity / task id / usage IF exposed.
     🛑 `requested = opus` IS NOT PROOF THAT `actual = opus`. Do not infer either one.
     Anything unexposed -> the existing repo-defined NOT_EXPOSED constant, verbatim. Never inferred.
10E  READ-ONLY AFTER snapshot; prove the calibration created no frozen .attempt/.dispatch/.raw/
     .completion. If it DID touch the frozen plane: STOP and report. Do not clean up — cleanup
     destroys the evidence.
10F  Write AR-1272 with the binding evidence, request metadata, traversal proof, before/after
     frozen state, and whether the authorization is now spent.
10G  HARD STOPS: no frozen G2-D call · no second calibration · no compiler · no backtest campaign ·
     no PAPER · no broker/live · no strict-session flip · no TaskCompleted · no shell parser.
```

🛑 **§10G's escape hatch is the one that applies if you are not bound:** *"If the fresh seat cannot
prove the required hook traversal, do not burn the calibration there. Fix/reseat the session-binding
problem WITHOUT running an Agent call."* **Two seats in a row have now hit exactly this.**

## 🛑 THE ONE THING THE NEXT SEAT MUST GET RIGHT: THE CALIBRATION NEEDS A **GUARD-BOUND** SEAT

AR-1269A authorizes **exactly one** non-G2 Opus calibration. GPT re-confirmed in AR-1271 §9 that it
is **AUTHORIZED AND UNSPENT**. Neither the AR-1270 seat nor this one spent it — both deliberately.

```text
repairing the guard  REQUIRES an UNGUARDED seat   ("a guarded seat cannot repair its own guard")
witnessing the guard REQUIRES a   GUARDED seat    (the hook must actually be installed)
                     -> MUTUALLY EXCLUSIVE IN ONE SESSION.
```

`[MEASURED 2026-08-16, twice, two different seats]` a session whose project dir is the OUTER repo
`C:\Users\tonio\Projects\trading-forge` is **NOT** guard-bound: `grep -c claude_guard_hook` = **0**
across all three settings files that bind it (`.claude/settings.json`, `.claude/settings.local.json`,
user-level), and its PreToolUse matchers are only `Write|Edit|MultiEdit` and `Bash` — **no `Agent`,
no `Task`.** Positive control for those zeros: `grep -c '"hooks"'` = **5** in the same file by the
same instrument, so the zero is a real absence and not a bad path.

⇒ **The calibration must run in a session whose project dir IS
`C:\Users\tonio\Projects\wt-claude-worker1-20260815`.** That worktree's committed settings register
`SessionStart` (`startup|resume|fork`) and `PreToolUse` (`Edit|Write|NotebookEdit|Bash|Agent|Task`)
through `scripts/claude_guard_hook.mjs` — GPT independently confirmed this in AR-1271 §6.
**Measure your own binding before you dispatch anything. Do not assume it in either direction.**

★ `A CAPABILITY AUTHORIZED TO A SEAT THAT CANNOT EXERCISE IT IS NOT YET AUTHORIZED.`

## 🛑 WHY EVERY DEFAULT SEAT IS UNBOUND — THE ROOT CAUSE, MEASURED 2026-08-16 (third seat)

Two prior seats recorded *that* they were unbound. Neither recorded *why it keeps happening*, so
the recurrence read as bad luck. It is not luck — it is structural, and it will repeat on every
single seat that launches from the default directory:

```text
C:\Users\tonio\Projects\trading-forge  IS NOT A GIT REPOSITORY.
  git -C C:\Users\tonio\Projects\trading-forge rev-parse --is-inside-work-tree
  -> fatal: not a git repository (or any of the parent directories): .git
The actual repo is one level DEEPER: C:\Users\tonio\Projects\trading-forge\trading-forge
```

That container folder is where Claude Code is being launched, so:

- its `.claude/settings.json` is the one that binds, and it registers `grading-guard.ps1` /
  `advisor-ruling-guard.ps1` on `Write|Edit|MultiEdit` — **`grep -c claude_guard_hook` = 0**, and
  **no `Agent` and no `Task` matcher anywhere**;
- `scripts/claude_guard_hook.mjs` **does not exist there at all** (`ls` -> No such file);
- the user-level `~/.claude/settings.json` declares **no `hooks` key** at all.

⇒ A seat launched from the default directory can never bind the Worker-1 guard, no matter how
correct the worktree's own committed settings are. **Registration lives in the worktree; binding
lives in the launch directory.** This is the same decoy that makes a bare `git ls-remote` resolve
to nothing there (`[session-cwd-decoy-git]`) — one folder, two victims.

### The remedy is a RESEAT, and it is one command

```bash
cd C:\Users\tonio\Projects\wt-claude-worker1-20260815
claude
```

`[MEASURED]` there is **no** `--project-dir`/`--cwd` flag on this CLI (`claude --help`); `--add-dir`
only widens tool access and `--settings` would not fix `$CLAUDE_PROJECT_DIR` expansion inside the
registered hook command. **The launch directory is the only lever.**

### 🛑 `EnterWorktree` IS NOT A REMEDY — do not burn a turn discovering this again

`[MEASURED]` the tool requires the target to sit under `.claude/worktrees/` of the *current* repo,
and requires the current directory to BE a repo. This worktree is at
`C:\Users\tonio\Projects\wt-claude-worker1-20260815` — not under any `.claude/worktrees/` — and the
launch dir is not a repo at all, so `path` is rejected on both counts. Passing `name` instead would
CREATE a stray worktree in a governed repo, and an untracked/extra tree is exactly what the
SessionStart gate is built to STOP on. **And even on success it switches a working directory, not a
startup binding — §10A asks for the latter.**

### Why the calibration was NOT run headlessly instead

A `claude -p` child launched from the worktree would bind. It was deliberately not used: AR-1269A
is a **one-shot, non-renewable** authorization (§10C "One means one"), §10D demands observed
runtime witnesses, and §10A demands session-start evidence captured *before* the spend. Gambling a
non-renewable authorization inside a nested process this seat cannot fully observe is the wrong
trade. `[irreversible-gap]`: authorize and execute in separate motions.

## ✅ NEW AT THIS BOUNDARY — THE SEAT YOU ARE ABOUT TO TAKE IS **VERIFIED READY**

AR-1270 proved its own seat was wrong. It did not prove the target seat is right. That gap is now
closed, so the reseat should not fail on anything checkable in advance. All `[MEASURED HERE]`:

```text
ARM WITNESS   The REGISTERED command was run with a real SessionStart payload on stdin and it
              ARMED — not inferred from its inputs, observed as its output:
                node scripts/claude_guard_hook.mjs --manifest .claude/worker1-hook-guard-manifest.json
                -> "GPT worker guard: anchor verified on claude/worker1-h1-20260815 at <head>.
                    Governed dirty exception in force: docs/wave25-exit-engine-ab-report.md
                    @ e200765c11e8 (AR-1265 §4)."
DISCRIMINATES Same command, same payload, a scratchpad copy of the manifest with a bogus
              _toolbox_pin -> "GPT worker guard STOP: doorway failed closed: materialized toolbox
              pin 18108039… != manifest _toolbox_pin 0000…. Guard was not armed; do not edit."
              ⇒ the ARM line is a DECISION, not a constant. A green with no path to red is not
              evidence. The tampered manifest lived OUTSIDE the worktree on purpose.
DIRTY GATE    git diff HEAD --binary -- docs/wave25-exit-engine-ab-report.md | sha256sum
              == e200765c11e85aeb9d5f0eb6d04cb04ea3985bfffc0a33e762c9960652547170 (manifest value).
              IDENTICAL, so SessionStart arms instead of STOPping. Untracked files: NONE
              (untracked BLOCKS and cannot be laundered by listing it).
TOOLBOX PIN   git cat-file -e 18108039…^{commit} succeeds, so the doorway can rematerialize.
              Negative control: the same command on an all-zero SHA is refused.
HOOK PAIR     Exactly TWO hooks registered — SessionStart + PreToolUse. TaskCompleted is
              deliberately ABSENT and must stay absent (AR-1271 §10G); registering the prepared
              fragment verbatim BRICKS the seat while finish.enabled is false.
```

🛑 **RE-RUN THE ARM WITNESS YOURSELF AFTER SEATING.** The witness above was taken at this
boundary's head; a head that moves is a measurement that decays. It is one command and it is the
cheapest thing you will do all session.

**`[RE-MEASURED 2026-08-16 at this boundary, third seat]` all four still hold.** The ARM line
resolved live to `anchor verified on claude/worker1-h1-20260815 at <this head>` with the governed
dirty exception `e200765c11e8` in force; the bogus-`_toolbox_pin` copy still produced
`STOP: doorway failed closed: materialized toolbox pin 18108039… != … 0000…`; the dirty-diff hash
recomputed **identical** to the manifest value; untracked files **0**. The doorway also
rematerialized the real toolbox at pin `18108039…`, matching manifest and AR-1271 §5.
⇒ **Nothing checkable in advance is broken. The reseat should arm on the first try.**

### ★ CHEAP BINDING PROBE — use it BEFORE you spend the one Agent call

The registered `PreToolUse` matcher is `Edit|Write|NotebookEdit|Bash|Agent|Task`. **`Bash` is on
that list**, so an ordinary Bash call already traverses the same hook the calibration needs — no
Agent call, nothing spent. Combined with the SessionStart `additionalContext` arriving in your own
chat, that is two independent binding witnesses available for free.
🛑 **Both are negative-capable and that is the point:** this seat saw **no** guard line in its
SessionStart context and ran many Bash calls with no guard involvement — which is what being
unbound looks like from the inside. **Absence of the guard line IS the unbound signal; do not read
a quiet session as a protected one.** `AN UNARMED GUARD AND A PERMISSIVE ONE LOOK IDENTICAL.`

## GPT's AR-1271 dispositions you must not re-litigate

```text
F-5   GREEN. Frozen queue (exact) + receipt namespace (prefix) self-protection ACCEPTED.
      🛑 Keep the bounded framing: the QUEUE half is defence in depth, NOT a newly found auth
      bypass — the native-call manifest already pinned the queue sha. The RECEIPT half was the
      real integrity defect, because capture state was read off fs.existsSync.
F-6   GREEN **FOR THE PROTECTED-REFERENCE CONTRACT ONLY.** Explicitly NOT a general filesystem
      sandbox. GPT: "Do not silently reinterpret AR-1270 as a filesystem sandbox."
§8    The indirect-reference residual (bound variables · symlinks · cd-then-basename) is ACCEPTED
      as an honest scope boundary. It does NOT block the calibration. It REMAINS on the checklist
      before the frozen eight get final GO. **Do not write a shell parser** (§10G).
§3.1  GPT accepted AR-1270 without ordering the uniform fence narrowed to the §6B floor, so the
      widening STANDS — by absence of a narrowing order, not by an explicit approval of it.
      Do not narrow it on your own initiative; do not describe it as explicitly ratified either.
re-pin / stale-cache: PASS. F-2 is NOT reopened.
CI    NONE at either pin. GPT checked GitHub itself and found no checks and no workflow runs.
      **Do not relabel the local suite as CI.**
```

## Traps this boundary paid for

```text
number   🛑 THE EAR EARNED ITS KEEP AGAIN. Mid-turn, while an AR-1271 worker report was being
         drafted, GPT PUBLISHED ITS OWN AR-1271 and took the number. The banked rule fired exactly
         as written: RE-FETCH IMMEDIATELY BEFORE BUILDING THE COMMIT OBJECT AND READ WHAT MOVED.
         Publishing on the stale fetch would have shipped a number collision.
         ★ `THE RULING THAT INVALIDATES YOUR REPORT ARRIVES WHILE YOU ARE WRITING IT.`
noreport That drafted report was then DISCARDED, not renumbered. GPT's ruling had already ordered
         the reseat, so publishing it would have restated GPT's own ruling back at GPT — banned by
         0-CTRL.5. **A report is owed when GPT lacks something. It is not owed as ceremony.**
field    `state`/`status` per queue item DOES NOT EXIST. A guessed key returned None x8 and I
         nearly reported it. Dumping ALL KEYS showed spent-ness lives in top-level `attempts`.
         ★ `THE FIELD YOU READ IS THE CLAIM.`
tmp      Windows `python` and git-bash disagree about `/tmp`: python wrote C:\tmp\…, bash looked in
         its own tmp, and the redirect died with "No such file". A path is an instrument too.
         Use ONE explicit path both interpreters resolve identically — and NEVER write a scratch
         file inside the worktree, where an untracked file BLOCKS SessionStart.
control  A fail-closed control DENIED for the WRONG REASON and nearly passed as the right one: the
         scratchpad path was written msys-style, Windows `python` could not create the file, and
         the guard answered "manifest not found" — a real DENY from a different mechanism than the
         bad-pin one being tested. Caught only by reading the reason string, not the verdict.
         ★ `A CONTROL THAT FAILS FOR THE WRONG REASON IS A GREEN CHECK ON AN UNTESTED PATH.`
         Same `tmp` root cause as the row below; the fix is one explicit Windows path.
orphan   An ear process from a dead seat was found running (parent PID gone from Win32_Process).
         It was NOT killed — you never kill an ear you did not arm — and it was NOT counted as
         mine, because its events reach a session that no longer exists.
         ★ `LIVENESS != OWNERSHIP != DELIVERY.` Arm your own and see the line in YOUR chat.
```

## Still-open inherited items

```text
§9H      calibration — UNSPENT, authorized (AR-1269A, reconfirmed AR-1271 §9). NOW ORDERED as the
         AR-1272 packet. Blocked only on seat binding.
D1-C2    actual_model_identity remains UNWITNESSED. Do NOT widen APPROVED_ACTUAL_MODEL_IDENTITIES.
grader   no independent grade on AR-1270; AR-1271 did not require one. Not owed.
finish   claude-finish-check still carries the old structural REVIEW_REQUIRED problem. It cannot
         bite while finish.enabled is false, and TaskCompleted stays UNREGISTERED.
AR-1242  canonical_regression_population.txt membership test is ALREADY RED (9 files drifted).
AR-1259 §4-6 canonical agent authority = the version-controlled .claude/agents at the governed
         ref; local Sonnet pins are unauthorized deployment drift; 3 paper-parity payloads parked.
         Do not sweep historical worktrees, do not touch Worker-2.
dirty    docs/wave25-exit-engine-ab-report.md stays dirty ON PURPOSE, governed by the hash
         exception e200765c…. Verified intact at this boundary. Do not sweep, clean, commit, or
         flip require_clean.
conditionIsSpent() is CORRECT AS WRITTEN. It reads like it contradicts the durable law and it does
         not — the guard, not the caller, is what claims. Do not "fix" it.
```

## Locks — unchanged, and AR-1271 §13 restates every one of them

```text
sVkm certification · sVkm compiler authorization · sVkm backtest campaign
PAPER · Worker-2 runtime activation · broker / Topstep / live
all eight real frozen G2-D calls (NO-GO through AR-1272) · G2-H OPEN · CERT RED
no CI at either pin — all execution evidence is LOCAL. No G2 attempt is spent to test a guard.
```

## Before you touch anything

1. **Arm the 2s ear** (onboarding step 2). An ear you did not see arm in *your own* chat is not
   yours, however alive its process looks. Then backfill against the GPT head named above.
2. Prove the newest ruling's `CURRENT HEAD` is an ancestor of yours (`merge-base --is-ancestor`).
   Do not trust a SHA pinned in an onboarding file or in this card once the branch advances.
3. **Measure whether YOUR session is guard-bound** — it decides whether you can do AR-1272 at all.
   `grep -c claude_guard_hook` across every settings file that binds you, WITH a positive control,
   and check for an `Agent|Task` matcher. Do not assume it in either direction.
4. Re-run the ARM witness above at your own head, then take the §10B read-only snapshot, and only
   then spend the one call.
