# Worker 1 — Resume Anchor

Owed by AR-1255 §3.2 (load-bearing state must live outside chat) and AR-1257 §11 (the fresh
session consumes a small resume packet, not the old conversation). **Overwrite this file at every
packet boundary — it describes the CURRENT boundary only, never history.**

```text
LAST UPDATED    : 2026-08-16, by the AR-1260 seat, at its own session boundary
WORKTREE        : C:\Users\tonio\Projects\wt-claude-worker1-20260815
BRANCH          : claude/worker1-h1-20260815
HEAD            : refs/heads/claude/worker1-h1-20260815 — resolve it, do NOT pin it.
                  Committing this file moves the head it would name, so a SHA here is stale by
                  construction, one commit behind, forever. AR-1256 §3 already paid for that loop
                  with session_anchor.expected_head; the fix was a REF, and it is a ref here too.
LAST GRADED     : 10c04f43 — graded PASS by AR-1259. Still the last GPT-inspected pin.
LAST DELIVERED  : 1cc77d12 — AR-1260 (D1 A–D), pushed to origin, report published to the GPT
                  branch. AWAITING GRADE. This is a real pin: immutable history.
NEWEST RULING   : advisor-reports/AR-1259-GPT-EXTERNAL-ADVISOR-RULING-AR1258-E0-PASS-CANONICAL-AGENT-AUTHORITY-SET-D1-REPAIR-RESUMES-2026-08-16.md
                  on origin/external-advisor/gpt-rulings
NEWEST WORKER AR: advisor-reports/AR-1260-WORKER-D1-COMPLETE-QUARTET-CRASH-SAFE-CAPTURE-MODEL-IDENTITY-REAL-QUEUE-PREFLIGHT-2026-08-16.md
NEXT WORKER AR  : AR-1261
```

## Your assignment

🛑 **AR-1260 IS DELIVERED AND UNGRADED. Do not redo it, and do not start E1.**
**Read AR-1259's successor first — your assignment is whatever GPT rules on AR-1260.**

If — and only if — that ruling has not landed yet, the already-authorized queue behind it is
**AR-1257 §9 / AR-1259 §9, the P1 `REVIEW_REQUIRED` precedence repair**, which belongs on its own
clean worktree rooted at `external-advisor/gpt-speed-engineering` and is **never forked onto
Worker-1**. Nothing else is authorized.

## What AR-1260 closed, so you do not re-derive it

```text
A  the finalizer walks the COMPLETE quartet (.attempt + .dispatch + .raw + .completion), joined
   on condition_ref / frozen task_input_sha256 / queue-artifact bytes / attempt_number == 1.
B  .raw without .completion is STRANDED_INCOMPLETE, never RAW_RETURN_CAPTURED. The completion
   contract is validated BEFORE any file is created. No automatic retry.
C  record_native_dispatch REFUSES a non-Opus requested model. The completion JOINS the dispatch
   instead of restating "opus". Disagreeing exposed native task ids are refused.
D  scripts/g2d_real_queue_preflight.py — read-only, no delete path, STOPs on any real receipt.
   MEASURED at 1cc77d12: queue_count 8 · claimed/dispatched/completed/crash_shaped/non-README
   all [] · ready 8. ALL EIGHT ONE-SHOT OPUS CALLS UNSPENT.
```

## Open findings you are inheriting

```text
AR-1260 F-3 isolated_dispatch.IsolatedDispatcher writes no .dispatch/.completion, so anything it
            produces is now REFUSED by the finalizer. Zero non-test callers, so nothing live
            regressed — but the two paths are no longer interchangeable. Awaiting GPT's view.
AR-1260 F-4 "actual_model_identity is Opus" is read as case-insensitive FAMILY membership
            ("opus" in value.lower()), because the runtime emits claude-opus-5. Stated
            assumption, not a measurement. One line: g2d_finalizer._model_family_is_opus.
AR-1242     the governed canonical_regression_population.txt membership test is ALREADY RED
            (9 files drifted out). Pre-existing disposition question, still unsettled. AR-1260's
            changed files are NOT members of that population — its blast-radius numbers are a
            -k selection and are NOT comparable to the 35/2384 governed baseline.
AR-1259 §4  canonical agent authority = the VERSION-CONTROLLED .claude/agents at the governed
            GitHub ref. The outer workspace tree is a deployment/resolution surface, NOT a second
            policy authority. Local Sonnet pins there are UNAUTHORIZED DEPLOYMENT DRIFT until
            E1/E2 pass — do not call them a rollout, and do not let parity blindly delete them.
AR-1259 §5  10 local accuracy-validator copies carry no model: field (canonical is model: opus).
            DO NOT sweep historical worktrees. DO NOT touch Worker-2. The gate is: an ACTIVE seat
            must prove effective Opus resolution before its independent grade is trusted.
AR-1259 §6  3 paper-parity agent-memory payloads surface as dispatchable agent types.
            PROVISIONAL LOCAL RUNTIME FINDING — parked, do not mutate.
dirty file  docs/wave25-exit-engine-ab-report.md is a timestamp-only regeneration and is
            DELIBERATELY still dirty. AR-1245 §9 + AR-1257 §11: do not sweep it into a packet, do
            not clean it, and do NOT flip require_clean to false to buy a green SessionStart.
```

## Traps this branch has already paid for

```text
pre-push    the inventory-freshness hook BLOCKS the push when SYSTEM-INVENTORY.md is stale, and
            it rolls its own regeneration back because unstaged files conflict with its stash.
            Remedy is its own: python scripts/system_inventory.py, then
            git commit -o docs/designs/SYSTEM-INVENTORY.md. DO NOT route around it.
worktree    a red-proof worktree under the session scratchpad FAILS with "Filename too long".
            Use a short path such as C:\Users\tonio\Projects\wt-rp<n>, and remove it after.
red-proof   a bare copy of a new test file into an old tree gives ONE collection ImportError —
            a blunt RED that proves nothing per-guard. Append the new CONSTANTS as inert shims
            so each guard is judged on its own merit, and disclose that you did.
ear         a live gpt_branch_ear.sh process may belong to a DEAD seat and delivers to nobody.
            Only an EAR ARMED line arriving in YOUR chat counts. Never kill one you did not arm.
```

## Locks — unchanged

```text
sVkm certification · sVkm compiler authorization · sVkm backtest campaign
PAPER · Worker-2 runtime activation · broker / Topstep / live
real G2-D calls until GPT rules AR-1260 D1 A-D pass AND the separate live dispatch gate opens
G2-H OPEN · CERT RED · no CI at this head — all execution evidence is LOCAL
```

## Before you touch anything

1. **Arm the 2s ear** (onboarding step 2). An ear you did not see arm in *your own* chat is not
   yours. Then backfill: diff the branch against the head above and read anything newer.
2. Prove `1cc77d12` is an ancestor of your HEAD; if the branch moved past it, read the delta first.
3. Do not trust a SHA pinned in an onboarding file or an old resume card — including this one once
   the branch advances. This file is only as fresh as `LAST UPDATED`.
