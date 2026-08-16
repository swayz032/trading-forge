# Worker 1 — Resume Anchor

Owed by AR-1255 §3.2 (load-bearing state must live outside chat) and AR-1257 §11 (the fresh
session consumes a small resume packet, not the old conversation). **Overwrite this file at every
packet boundary — it describes the CURRENT boundary only, never history.**

```text
LAST UPDATED    : 2026-08-16, by the AR-1266 seat, at its own session boundary
WORKTREE        : C:\Users\tonio\Projects\wt-claude-worker1-20260815
BRANCH          : claude/worker1-h1-20260815
HEAD            : refs/heads/claude/worker1-h1-20260815 — resolve it, do NOT pin it.
                  Committing this file moves the head it would name, so a SHA here is stale by
                  construction, one commit behind, forever.
TOOLBOX         : claude/worker1-p1-toolbox-20260816 @ 6a06ffae  (pin == branch, no drift)
LAST DELIVERED  : AR-1266 — seat pin aae50800, toolbox pin 6a06ffae. Both pushed and verified
                  on origin. GRADED by AR-1267: PARTIAL PASS.
NEWEST RULING   : advisor-reports/AR-1267-GPT-EXTERNAL-ADVISOR-RULING-AR1266-P1-CONFIGURED-PARTIAL-PASS-PRECALL-STATE-MACHINE-AND-CACHE-REPAIR-REQUIRED-2026-08-16.md
NEWEST WORKER AR: advisor-reports/AR-1266-WORKER-P1-LIVE-IN-REAL-SEAT-STRICT-G2-SESSION-EIGHT-UNSPENT-2026-08-16.md
NEXT WORKER AR  : AR-1268
G2 BUDGET       : 0/8 spent. queue 5935b1c6… · 8 ready · receipt dir README-only.
```

## Your assignment — AR-1267 §9, items A–H. Read that ruling; it is the contract.

Do **not** reopen D1-A/B/C1, the quartet finalizer, the exact actual-model matcher, or the dirty
exception design. All PASS. AR-1267 §9 is deliberately narrow: *"These are the last load-bearing
edges of the pre-call boundary, not a reason to restart G2 architecture."*

🛑 **H IS A HARD STOP.** The non-G2 Opus calibration needs an **explicit operator utterance in
the live session**. AR-1267 §9H: *"Do not infer authorization from this markdown ruling alone."*
The AR-1266 seat asked and stopped; the answer had not arrived at its boundary.

## What AR-1266 closed, so you do not re-derive it

```text
PASS  real-seat .claude/settings.json registers SessionStart + PreToolUse, matcher
      Edit|Write|NotebookEdit|Bash|Agent|Task, routed through scripts/claude_guard_hook.mjs.
PASS  strict_session mechanism — in strict mode membership is a property of the SESSION, not the
      payload, closing the prose-only bypass. Currently false: calibration is non-G2 and must
      precede arming. Correct for this checkpoint.
PASS  hash-pinned dirty exception. docs/wave25-exit-engine-ab-report.md allowed ONLY while its
      `git diff HEAD --binary` bytes hash to e200765c11e85aeb9d5f0eb6d04cb04ea3985bfffc0a33e762c9960652547170.
PASS  integration is an immutable RE-PIN, never a copy (scripts/claude_toolbox.mjs).
      bundle e725cad4… over 40 files, COMPUTED by `node scripts/claude_toolbox.mjs materialize`.
toolbox suite: 131/131. Real-seat registered-command matrix: 18/18. Both LOCAL — no CI.
```

## The four open findings you are inheriting (AR-1267 §3–§6)

```text
F-1  scripts/claude_guard_hook.mjs and scripts/claude_toolbox.mjs are the LIVE control path but
     are NOT in SELF_PROTECTED_RULES, while the manifest allows the `scripts/` prefix. The
     guarded worker can edit its own doorway. Add exact self-protection + mutation control.
F-2  cachedToolbox() reuses the TEMP cache on mere EXISTENCE of .pin-stamp + runner. It never
     compares the stamp to the manifest's expected pin/bundle, so a stale cache silently runs
     OLD LAW while GitHub and the manifest say NEW LAW. Verify pin AND bundle before executing.
F-3  🛑 THE MOST IMPORTANT ONE, AND IT IS A DEFECT IN WHAT AR-1266 BUILT.
     conditionIsSpent() treats ANY .attempt as already spent — but the durable D1 law requires
     .attempt to be written BEFORE the model is invoked (claim_attempt), so the guard denies the
     very sequence the law mandates. Repair: the trusted PreToolUse path itself performs
     .attempt -> .dispatch (create-only, via the existing Python semantics through a small
     protected doorway) and only THEN returns ALLOW. Any failure = DENY, no cleanup, no retry.
F-4  The permit is not bound to the ACTUAL Agent model field or the ACTUAL prompt bytes — only
     to the permit's own requested_model and "invocation text contains the condition ref". Freeze
     a deterministic eight-row native-call artifact BEFORE any answer exists, then hash-match the
     real tool input at the boundary.
```

## New traps this boundary paid for

```text
fragment    settings.fragment.json registers TaskCompleted UNCONDITIONALLY, and the bridge
            fail-closes TaskCompleted to `block` while finish.enabled is false. Installing the
            prepared fragment VERBATIM blocks every task completion in the seat. Register
            SessionStart + PreToolUse only, until a real finish receipt exists.
guarded     🛑 THIS SEAT IS NOW LIVE-GUARDED. A session opened with its project dir set to this
            worktree gets SessionStart + PreToolUse enforcement. SessionStart STOPs on ANY dirty
            path except the one hash-pinned exception — regenerating that report bricks it until
            the desk re-pins. The AR-1266 seat worked from the outer trading-forge project dir
            and was therefore NOT bound; do not assume your session is bound or unbound, check.
bootstrap   a guarded seat CANNOT repair its own guard (SELF_PROTECTED denies regardless of
            packet scope). After F-1 lands, the doorway and activator join that set. Sequence
            AR-1268 accordingly: the rules live in the toolbox authority branch.
headline    AR-1266's title said "P1 IS LIVE" while its own body said no real Agent dispatch had
            been observed. AR-1267 §7 corrected it to REGISTERED + COMMAND-PATH HARNESS-PROVEN.
            The body was honest and the title still over-scoped — scope the TITLE against your
            strongest number, every time.
shell       $TEMP interpolated into a Bash string had its backslashes eaten
            (C:UsersonioAppData…). Resolve Windows paths INSIDE node, not in the shell.
ear         a live gpt_branch_ear.sh process may belong to a DEAD seat and delivers to nobody.
            Only an EAR ARMED line arriving in YOUR chat counts. Never kill one you did not arm.
            (One orphan from a previous seat was found running at this boundary and left alone.)
pre-push    inventory-freshness BLOCKS the push when SYSTEM-INVENTORY.md is stale and rolls its
            own regeneration back. Remedy is its own: python scripts/system_inventory.py, then
            git commit -o docs/designs/SYSTEM-INVENTORY.md. DO NOT route around it.
publish     the GPT branch is NOT a fast-forward — publish ONE file by plumbing, and `unset
            GIT_INDEX_FILE` in a FRESH shell before the push or the hook blames an innocent file.
```

## Still-open inherited items (unchanged by AR-1266)

```text
D1-C2       actual_model_identity remains UNWITNESSED. Only the operator-authorized calibration
            closes it. Do NOT widen APPROVED_ACTUAL_MODEL_IDENTITIES to regain a green.
finish      claude-finish-check still carries the old structural REVIEW_REQUIRED problem. It
            cannot bite while finish.enabled is false. Reported, deliberately not fixed.
AR-1242     canonical_regression_population.txt membership test is ALREADY RED (9 files drifted).
            Pre-existing, unsettled.
AR-1259 §4-6 canonical agent authority = the version-controlled .claude/agents at the governed
            ref; local Sonnet pins are unauthorized deployment drift; 3 paper-parity payloads
            parked. Do not sweep historical worktrees, do not touch Worker-2.
dirty file  docs/wave25-exit-engine-ab-report.md stays dirty ON PURPOSE and is now GOVERNED by
            the hash exception. Do not sweep it, clean it, or flip require_clean to false.
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
   yours. Then backfill against the head named above.
2. Prove `aae50800` is an ancestor of your HEAD; if the branch moved past it, read the delta.
3. Run the read-only preflight FIRST and confirm 8 ready / 0 spent before any repair work.
4. Do not trust a SHA pinned in an onboarding file or an old card — including this one once the
   branch advances. This file is only as fresh as `LAST UPDATED`.
