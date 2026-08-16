# Worker 1 — Resume Anchor

Owed by AR-1255 §3.2 (load-bearing state must live outside chat) and AR-1257 §11 (the fresh
session consumes a small resume packet, not the old conversation). **Overwrite this file at every
packet boundary — it describes the CURRENT boundary only, never history.**

```text
LAST UPDATED    : 2026-08-16, by the AR-1268 seat, at its own session boundary
WORKTREE        : C:\Users\tonio\Projects\wt-claude-worker1-20260815
BRANCH          : claude/worker1-h1-20260815
HEAD            : refs/heads/claude/worker1-h1-20260815 — resolve it, do NOT pin it.
                  Committing this file moves the head it would name, so a SHA here is stale by
                  construction, one commit behind, forever.
TOOLBOX         : claude/worker1-p1-toolbox-20260816 @ e0c44ca4  (pin == branch, no drift)
LAST DELIVERED  : AR-1268 — seat pin d62b9b88, toolbox pin e0c44ca4. Both pushed and verified on
                  origin by ls-remote. AWAITING GRADE.
NEWEST RULING   : advisor-reports/AR-1267-GPT-EXTERNAL-ADVISOR-RULING-AR1266-P1-CONFIGURED-PARTIAL-PASS-PRECALL-STATE-MACHINE-AND-CACHE-REPAIR-REQUIRED-2026-08-16.md
NEWEST WORKER AR: advisor-reports/AR-1268-WORKER-PRECALL-BOUNDARY-CLOSED-STALE-CACHE-CLAIM-DISPATCH-NATIVE-CALL-IDENTITY-2026-08-16.md
                  (GPT branch head 05682688 — read it back from origin, it is not local)
NEXT WORKER AR  : AR-1269
G2 BUDGET       : 0/8 spent. queue 5935b1c6… · 8 ready · receipt dir README-only.
                  Re-measured AFTER the re-pin, not carried across it.
```

## Your assignment — READ AR-1267's SUCCESSOR FIRST. It is whatever GPT rules on AR-1268.

AR-1267 §9 A–G are **delivered and ungraded**. Do not redo them, and do not start anything new
until you have read the ruling on AR-1268.

🛑 **THE ONE THING STILL OPEN IS §9H, AND IT IS NOT YOURS TO SELF-AUTHORIZE.** The single non-G2
Opus calibration needs an **explicit operator utterance in the live session** — AR-1267 §9H:
*"Do not infer authorization from this markdown ruling alone."* The AR-1268 seat asked in plain
English and the answer had not arrived at its boundary. **If the operator says the word, the
calibration must produce all four witnesses: a real native `Agent` dispatch traversing the
installed PreToolUse hook · requested model Opus · actual model identity / task id / usage
captured or honestly NOT_EXPOSED · the frozen eight untouched.** Calibration is NOT one of the
eight.

## What AR-1268 closed, so you do not re-derive it

```text
F-1  EXACT self-protection for scripts/claude_guard_hook.mjs, scripts/claude_toolbox.mjs,
     scripts/g2d_precall_transition.py, scripts/g2d_freeze_native_calls.py and any path
     containing `native_call_manifest`. EXACT on purpose: a `scripts/` PREFIX passes every
     protection assertion and silently freezes the whole lane. The DISCRIMINATES control
     (system_inventory.py must stay editable) is what separates those two — keep it.
F-2  the doorway verifies the TEMP cache against the MANIFEST's _toolbox_pin +
     _toolbox_bundle_sha256: stamp pin, stamp bundle, and a re-hash of the cached bytes. The
     expected identity lives in the manifest because the manifest is self-protected.
F-3  the trusted PreToolUse path performs create-only .attempt then .dispatch through
     scripts/g2d_precall_transition.py (which calls the EXISTING Python law, adding none of its
     own) and only then returns ALLOW. Failed dispatch => attempt SPENT, no cleanup, no retry.
     🛑 conditionIsSpent() is CORRECT AS WRITTEN. It reads like it contradicts the durable law
     and it does not — the guard, not the caller, is what claims now. Do not "fix" it.
F-4  the actual call is hash-bound: canonical sha256 over {model, subagent_type, prompt} matched
     against docs/replay-results/svkm-extraction-certified/grade/opus-v2/native_call_manifest_t1.json.
     Omitted `model` DENIES (inherited != requested). subagent_type 'fork' DENIES (fork ignores
     model and inherits parent context). Permit rides in `description`, never in the prompt,
     because the Agent schema is additionalProperties:false.
§9E  a .dispatch without BOTH .raw and .completion denies every subsequent frozen dispatch.
controls: 159/159 toolbox · 20/20 seat node · 143/143 python. ALL LOCAL — no CI at either pin.
```

## New traps this boundary paid for

```text
CRLF     🛑 THE ONE TO STUDY. `--emit-prompt` wrote through TEXT-MODE stdout, so all 15 newlines
         left as CRLF: 25948 chars in, 25963 bytes out. The JS guard hashed a prompt this repo
         never authorized and ALL EIGHT calls would have been DENIED. It survived because
         PYTHON's own round-trip said EQUAL — text=True re-applies universal newlines, so THE
         INSTRUMENT HID THE DEFECT FROM ITSELF. Only the cross-language control saw it. Under
         time pressure the plausible "fix" is loosening the guard. Write bytes.
         `A SAME-LANGUAGE ROUND-TRIP IS NOT A PARITY CHECK.`
failclose fail-closed must be AIMED. The bridge first loaded the G2 artifacts on EVERY PreToolUse
         event, so one unreadable G2 file would have denied ordinary Edit/Write work — the same
         brick-the-seat shape as the prepared fragment's unconditional TaskCompleted. Scope the
         load to subagent dispatches.
redgreen a bare copy of a new suite into an old tree gives ONE collection error and a blunt RED.
         Append INERT import shims (re-export the old constant; add the new helpers as pure
         functions the old gate never calls) so each guard is judged on behaviour — and DISCLOSE
         that you did. Result here: 20 RED / 8 GREEN, the 8 green being the discriminators.
harness  ROOT computed three levels up instead of four killed every child process identically
         (exit 2, empty stdout). A UNIFORM failure across every case accuses the harness first.
memory   I asserted `attempt_status == "CLAIMED"` and `native_task_id == "NOT_EXPOSED"` from
         memory; the real values are ATTEMPT_CLAIMED_BEFORE_INVOCATION and
         NOT_EXPOSED_BY_CLAUDE_CODE_SUBSCRIPTION_RUNTIME. IMPORT constants, never restate them.
tests    two previously-PASSING tests went RED on the model binding — the call they blessed
         carried no `model` field. That is the defect caught by its own suite. Update them to the
         new contract and KEEP the old shape as negative controls; never delete them.
ear      the ear fired on this seat's OWN push to the GPT branch. That is the live delivery proof
         a throwaway red-proof cannot give you. Arm yours; an orphan from a dead seat delivers to
         nobody, and one was found running here again.
```

## Still-open inherited items

```text
§9H      calibration — operator utterance only. Blocks the real native event witness AND D1-C2.
D1-C2    actual_model_identity remains UNWITNESSED. Do NOT widen APPROVED_ACTUAL_MODEL_IDENTITIES.
grader   the independent grade on d62b9b88 is OWED and unspent. AR-1267 required none, and the
         runtime boundary that gates §9H gates subagents generally. One word and it goes out.
queue    🛑 REPORTED, NOT FIXED (AR-1268 §1): the frozen QUEUE and the real RECEIPT DIRECTORY sit
         under docs/replay-results/, an ALLOWED prefix, and are NOT self-protected — the same
         species as F-1 one level over. Pre-existing; §9 forbids broadening. Desk question.
subagent the frozen rows pin subagent_type 'general-purpose'. That is a reading of the live
         schema's isolation semantics, falsifiable in one calibration call. If the desk wants a
         different type the artifact must be RE-FROZEN BEFORE the first call, never after.
finish   claude-finish-check still carries the old structural REVIEW_REQUIRED problem. It cannot
         bite while finish.enabled is false, and TaskCompleted stays UNREGISTERED — registering
         the prepared fragment verbatim bricks the seat.
AR-1242  canonical_regression_population.txt membership test is ALREADY RED (9 files drifted).
AR-1259 §4-6 canonical agent authority = the version-controlled .claude/agents at the governed
         ref; local Sonnet pins are unauthorized deployment drift; 3 paper-parity payloads parked.
         Do not sweep historical worktrees, do not touch Worker-2.
dirty    docs/wave25-exit-engine-ab-report.md stays dirty ON PURPOSE, governed by the hash
         exception e200765c…. Verified intact at this boundary. Do not sweep, clean, commit, or
         flip require_clean.
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
3. Run the read-only preflight FIRST and confirm 8 ready / 0 spent before any repair work.
4. Check whether YOUR session is guard-bound: the P1 hooks live in this worktree's
   `.claude/settings.json`, so a session whose project dir is the outer `trading-forge` is NOT
   bound (both the AR-1266 and AR-1268 seats ran unbound). Measure it, do not assume it —
   and remember a guarded seat cannot repair its own guard.
