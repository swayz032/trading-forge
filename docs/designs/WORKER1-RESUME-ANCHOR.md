# Worker 1 — Resume Anchor

Owed by AR-1255 §3.2 (load-bearing state must live outside chat) and AR-1257 §11 (the fresh
session consumes a small resume packet, not the old conversation). **Overwrite this file at every
packet boundary — it describes the CURRENT boundary only, never history.**

```text
LAST UPDATED    : 2026-08-16, by the AR-1258 seat, at its own session boundary
WORKTREE        : C:\Users\tonio\Projects\wt-claude-worker1-20260815
BRANCH          : claude/worker1-h1-20260815
HEAD            : 3e4da82c825c496d69730de90e536547babac818   (pushed; origin == local)
LAST GRADED     : 10c04f43  — graded PASS by AR-1259
NEWEST RULING   : advisor-reports/AR-1259-GPT-EXTERNAL-ADVISOR-RULING-AR1258-E0-PASS-CANONICAL-AGENT-AUTHORITY-SET-D1-REPAIR-RESUMES-2026-08-16.md
                  on origin/external-advisor/gpt-rulings
NEXT WORKER AR  : AR-1260
```

## Your assignment

**AR-1259 §8 — AR-1260, D1 A–D only. Do not continue E1. Do not spend any of the eight Opus calls.**

```text
A  complete-quartet consumer join : .attempt + .dispatch + .raw + .completion must ALL join to the
   same condition_ref / frozen task_input_sha256 / queue_artifact_sha256 / attempt_number == 1.
   Negative controls: no dispatch -> REFUSE · no completion -> REFUSE · completion without
   dispatch -> REFUSE · mismatched task id/condition/queue -> REFUSE. Positive: exact quartet accepts.
B  crash-safe capture : validate the completion contract BEFORE creating semantic completion state.
   Raw written but completion missing == STRANDED/INCOMPLETE, never RAW_RETURN_CAPTURED. Add the
   failure injection proving a stranded artifact is not later read as complete.
C  model/task identity : record_native_dispatch must REFUSE a requested model != Opus. Completion
   must JOIN the real dispatch receipt, never hard-code "opus". Keep the honest NOT_EXPOSED
   sentinel when the runtime genuinely does not expose actual model identity.
D  real queue preflight, READ-ONLY : prove queue_count 8 · claimed [] · dispatched [] · completed []
   · crash_shaped [] · ready 8 · receipt dir non-README []. If a real receipt appears
   unexpectedly, STOP — do not delete it to regain green.
```

## Open findings you are inheriting

```text
AR-1259 §4  canonical agent authority = the VERSION-CONTROLLED .claude/agents at the governed
            GitHub ref. The outer workspace tree is a deployment/resolution surface, NOT a second
            policy authority. Local Sonnet pins there are UNAUTHORIZED DEPLOYMENT DRIFT until
            E1/E2 pass — do not call them a rollout, and do not let parity blindly delete them.
AR-1259 §5  10 local accuracy-validator copies carry no model: field (canonical is model: opus).
            DO NOT sweep historical worktrees. DO NOT touch Worker-2. The gate is: an ACTIVE seat
            must prove effective Opus resolution before its independent grade is trusted.
AR-1259 §6  3 paper-parity agent-memory payloads surface as dispatchable agent types.
            PROVISIONAL LOCAL RUNTIME FINDING — parked, do not mutate during D1.
AR-1257 §9  P1 REVIEW_REQUIRED precedence defect CONFIRMED. Repair belongs in the SOURCE toolbox on
            its own clean worktree rooted at external-advisor/gpt-speed-engineering — never forked
            onto Worker-1. Comes AFTER AR-1260.
dirty file  docs/wave25-exit-engine-ab-report.md is a timestamp-only regeneration and is
            DELIBERATELY still dirty. AR-1245 §9 + AR-1257 §11: do not sweep it into a packet, do
            not clean it, and do NOT flip require_clean to false to buy a green SessionStart.
```

## ⚠ Out-of-band commit at this HEAD — disclose it in AR-1260

`3e4da82c` is **not** part of any GPT-ordered packet. It is operator-ordered infrastructure, landed
after AR-1259 graded `10c04f43`. If you diff the branch against the AR-1259-inspected head you will
find it, and GPT will too — so name it rather than letting it read as scope creep:

```text
3e4da82c  Track .claude/skills in git (24 files) + un-ignore in .gitignore
          + arming the 2s GPT-branch ear is now required startup step 2 in BOTH
            worker onboardings (it was absent from both — this seat ran a whole
            packet deaf until the operator caught it)
```

Reason: those 24 doctrine files were tracked by **zero** git repositories and lived on one disk.
The container holding them is not a checkout — its `.git` contains only an empty `info/`.

**It creates a second copy.** The tracked copy here and the runtime surface Claude loads from
`C:\Users\tonio\Projects\trading-forge\.claude\skills` can drift — the same defect AR-1258 F-2
reported for the agent trees. The deploy/sync + parity law is **owed under AR-1259 §4.2 and does
not exist yet.** Any parity check written for it must normalize EOL (git normalized CRLF→LF on
`advisor-ruling` and `migration-author`), exactly as `check-agent-parity.mjs` already does.

## Locks — unchanged

```text
sVkm certification · sVkm compiler authorization · sVkm backtest campaign
PAPER · Worker-2 runtime activation · broker / Topstep / live
real G2-D calls until AR-1260 D1 A-D pass AND the separate live dispatch gate opens
G2-H OPEN · CERT RED · no CI at this head — all execution evidence is LOCAL
```

## Before you touch anything

1. **Arm the 2s ear** (onboarding step 2). An ear you did not see arm in *your own* chat is not
   yours. Then backfill: diff the branch against the head above and read anything newer than
   AR-1259.
2. Prove `3e4da82c` is an ancestor of your HEAD; if the branch moved past it, read the delta first.
3. Do not trust a SHA pinned in an onboarding file or an old resume card — including this one once
   the branch advances. This file is only as fresh as `LAST UPDATED`.
