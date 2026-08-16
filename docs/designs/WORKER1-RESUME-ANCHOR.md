# Worker 1 — Resume Anchor

Owed by AR-1255 §3.2 (load-bearing state must live outside chat) and AR-1257 §11 (the fresh
session consumes a small resume packet, not the old conversation). **Overwrite this file at every
packet boundary — it describes the CURRENT boundary only, never history.**

```text
LAST UPDATED    : 2026-08-16, by the AR-1262 seat, at its own session boundary
WORKTREE        : C:\Users\tonio\Projects\wt-claude-worker1-20260815
BRANCH          : claude/worker1-h1-20260815
HEAD            : refs/heads/claude/worker1-h1-20260815 — resolve it, do NOT pin it.
                  Committing this file moves the head it would name, so a SHA here is stale by
                  construction, one commit behind, forever. AR-1256 §3 already paid for that loop
                  with session_anchor.expected_head; the fix was a REF, and it is a ref here too.
LAST GRADED     : 1cc77d12 — AR-1261 graded AR-1260: D1-A/B/D PASS, D1-C PARTIAL.
LAST DELIVERED  : 227533be — AR-1262 (D1-C1, the exact actual-model identity set), pushed.
                  AWAITING GRADE. Evidence pin for that packet is 227533be; the work commit is
                  f73bde88 and 227533be is the guard-ordered SYSTEM-INVENTORY regenerate.
NEWEST RULING   : advisor-reports/AR-1261-GPT-EXTERNAL-ADVISOR-RULING-AR1260-D1-AB-D-PASS-C-MODEL-IDENTITY-NARROW-REPAIR-2026-08-16.md
                  on origin/external-advisor/gpt-rulings
NEWEST WORKER AR: advisor-reports/AR-1262-WORKER-D1-C1-EXACT-ACTUAL-MODEL-IDENTITY-CONTRACT-2026-08-16.md
NEXT WORKER AR  : AR-1263
```

## Your assignment

🛑 **AR-1262 IS DELIVERED AND UNGRADED. Do not redo it, and do not start E1/E2.**
**Read AR-1261's successor first — your assignment is whatever GPT rules on AR-1262.**

If — and only if — that ruling has not landed yet, **AR-1261 §9 already names the fork**, and it
is a genuine fork you must not resolve by guessing:

```text
IF the live G2-D subscription Opus dispatch gate is genuinely available
   -> FRESH SESSION -> controlled real G2-D execution under the frozen 8-call law.
      This is the reserved class. It spends an irreplaceable one-shot budget, so it is
      NOT self-authorized by this card — GPT's ruling plus the dispatch gate, both.
ELSE
   -> the already-queued P1 REVIEW_REQUIRED / native-hook SOURCE repair, on the GPT
      speed-engineering toolbox authority path. NEVER by forking the toolbox into Worker-1.
```

The context-budget / model-routing lane (E1–E3) stays **parked** behind the money path and P1.

## What AR-1260 + AR-1262 closed, so you do not re-derive it

```text
A  the finalizer walks the COMPLETE quartet (.attempt + .dispatch + .raw + .completion), joined
   on condition_ref / frozen task_input_sha256 / queue-artifact bytes / attempt_number == 1.
   AR-1261 §3: PASS. Do NOT reopen this design.
B  .raw without .completion is STRANDED_INCOMPLETE, never RAW_RETURN_CAPTURED. The completion
   contract is validated BEFORE any file is created. No automatic retry.
   AR-1261 §4: PASS. Do NOT reopen this design.
C  record_native_dispatch REFUSES a non-Opus requested model (strict equality). The completion
   JOINS the dispatch instead of restating "opus". Disagreeing exposed native task ids refuse.
   AR-1261 §5: requested-model and task-id joins PASS.
C1 the EXPOSED actual-model check is now an exact frozen set, not a substring —
   APPROVED_ACTUAL_MODEL_IDENTITIES = {"claude-opus-5", "claude-opus-5[1m]"},
   contract version g2d-actual-model-identity-v1. NOT_EXPOSED still accepted.
   🛑 An identity outside that set is a STOP AND REPORT. Do NOT add a member to regain
   green and do NOT retry the one-shot call — only a ruling adds one (AR-1261 §5).
D  scripts/g2d_real_queue_preflight.py — read-only, no delete path, STOPs on any real receipt.
   AR-1261 §6: PASS.
   MEASURED at 227533be: queue_count 8 · claimed/dispatched/completed/crash_shaped/non-README
   all [] · ready 8. ALL EIGHT ONE-SHOT OPUS CALLS UNSPENT.
```

## Open findings you are inheriting

```text
AR-1261 §7  isolated_dispatch.IsolatedDispatcher writes no .dispatch/.completion, so the
            finalizer REFUSES anything it produces. GPT RULED: accept the fail-closed
            deprecation. Do NOT repair that legacy path back in for compatibility. Keep it
            test-only/deprecated unless a later packet proves a distinct legitimate use.
            (This was AR-1260 F-3 — now SETTLED, not open.)
AR-1260 F-4 CLOSED by AR-1262. The substring matcher is gone; see C1 above. The set is
            deliberately SHORT and the bare word "opus" is NOT a member — it is the
            authorized REQUESTED identity only.
AR-1261 §8  the .claude/skills + .gitignore + resume-anchor commits on this branch are NOT
            implicitly GPT-certified just by sitting here. Keep reporting packet base,
            packet commits, evidence pin and documentation tail SEPARATELY. Do not roll
            them back to make a packet look tidy.
AR-1242     the governed canonical_regression_population.txt membership test is ALREADY RED
            (9 files drifted out). Pre-existing disposition question, still unsettled. The
            changed files are NOT members of that population — the blast-radius numbers are a
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
message     changing an error message turns old parametrized cases RED for the WORDING, not the
            behaviour. AR-1262: 9 negative cases went red at the old pin but only 6 were real
            behaviour changes. MEASURE both matchers side by side; never read the pytest
            failure list as a count of caught attacks.
ear         a live gpt_branch_ear.sh process may belong to a DEAD seat and delivers to nobody.
            Only an EAR ARMED line arriving in YOUR chat counts. Never kill one you did not arm.
```

## Locks — unchanged

```text
sVkm certification · sVkm compiler authorization · sVkm backtest campaign
PAPER · Worker-2 runtime activation · broker / Topstep / live
real G2-D calls until GPT rules AR-1262 D1-C1 pass AND the separate live dispatch gate opens
G2-H OPEN · CERT RED · no CI at this head — all execution evidence is LOCAL
```

## Before you touch anything

1. **Arm the 2s ear** (onboarding step 2). An ear you did not see arm in *your own* chat is not
   yours. Then backfill: diff the branch against the head above and read anything newer.
2. Prove `227533be` is an ancestor of your HEAD; if the branch moved past it, read the delta first.
3. Do not trust a SHA pinned in an onboarding file or an old resume card — including this one once
   the branch advances. This file is only as fresh as `LAST UPDATED`.
