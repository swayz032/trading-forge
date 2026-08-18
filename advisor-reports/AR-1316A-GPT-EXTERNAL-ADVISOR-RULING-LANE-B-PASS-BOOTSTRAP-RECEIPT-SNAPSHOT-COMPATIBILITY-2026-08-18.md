# GPT EXTERNAL ADVISOR RULING — AR-1316A

**Date:** 2026-08-18  
**Repository:** `swayz032/trading-forge`  
**Worker branch inspected:** `claude/worker1-h1-20260815`  
**Worker source HEAD:** `5462e70a8bd0cc09de17b7fd88ee42a3d2c49fde`  
**Worker F36 doorway commit:** `56244f44d4cec18da043208e5727b9cda56beedf`  
**Toolbox branch inspected:** `guardfix/ar1304-g2-handshake-repair`  
**Toolbox target commit:** `bbf2e6c2e9ae39a7f0f2be182c9046165eb4b198`  
**AR-1316 report commit inspected:** `e823e80a292ae829f8c77599618818e919426ce9`  
**Prior GPT authority:** AR-1315A  
**Verdict:** **AR-1316 LANE B PASS. F36 LIVE-WIRING PREPARATION IS COMPLETE. EXECUTABLE PROPAGATION KEY IS TEMPORARILY WITHHELD FOR ONE NARROW BOOTSTRAP-COMPATIBILITY DEFECT: THE EXISTING BOOTSTRAP STILL HARD-CODES README-ONLY RECEIPTS, WHICH IS NO LONGER TRUE AFTER THE ALREADY-SPENT EIGHT OPUS LAUNCHES.**

## 1. EXECUTIVE RULING

AR-1316 is accepted for the actual F36 toolbox work.

Independent repository inspection confirms:

- `bbf2e6c2...` is exactly one descendant commit from the currently activated toolbox pin `4c5f9d4a...`;
- the diff is limited to the eight intended toolbox files;
- `PostToolUse(Agent|Task)` for a resolved frozen G2 row no longer calls final capture and instead records the async launch acknowledgement only;
- the row remains `NATIVE_TASK_DISPATCHED` after the launch acknowledgement;
- a separately handled real `SubagentStop` event is the terminal path that invokes the already-accepted Worker-side F36 doorway;
- terminal resolution remains identity-bound through the recorded `agent_id`;
- the `SubagentStop` path does not emit `decision:"block"`, avoiding the inverted Stop/SubagentStop meaning that would force an already-finished subagent to continue;
- the settings fixture adds exactly one `SubagentStop` registration for `general-purpose` while remaining off-live;
- the toolbox branch tip is exactly `bbf2e6c2...`, proving the Lane B commit is pushed rather than local-only.

The target bundle measurement reported by AR-1316 is accepted:

- target toolbox commit: `bbf2e6c2e9ae39a7f0f2be182c9046165eb4b198`;
- `.mjs` member count: `49`;
- target toolbox bundle SHA-256: `ca0b3a708d90017018aa4ac9f4ee1aca205469fbabc418bbbf3f599959da7167`;
- current live positive-control pin remains `4c5f9d4adba5972a051aa845b98809bc2b6c7aa4` / bundle `59d95f3c784f90ed08c20321bbb834ad0009a0167e64cb211168500932efdec0`.

The reported toolbox regression is also consistent with the inspected test shape: **261/261 pass**, including real-process lifecycle witnesses against the real Worker-side Python doorway.

**Do not reopen Lane A, Lane B, F36-A, or F36-B absent new contradictory evidence.**

## 2. NEW BLOCKER IS IN THE BOOTSTRAP, NOT F36

The existing control-plane bootstrap validator still contains a historical precondition from the pre-execution era:

- `require_ready` must equal 8;
- `require_spent` must equal 0;
- `require_receipts` must equal `README_ONLY`;
- measured receipt state must actually be README-only.

That contract was correct before the eight Opus calls existed. It is now stale.

The eight launches already happened and their original receipt evidence is intentionally preserved. The current committed receipt directory is therefore not README-only. Current repository inspection identifies the committed receipt-directory Git tree as:

`c11966868f8a511554e1f26bf6e5555c59833d04`

The validator would mechanically reject any new executable marker today with `receipts_not_readme_only`, even if every F36 byte and target pin is correct.

**This is not permission to delete, move, hide, reset, or rewrite the existing receipts.** Doing that merely to satisfy an obsolete bootstrap condition would destroy forensic evidence and violate the preserve-and-strike history already accepted under AR-1312.

Therefore no executable marker is emitted in this ruling. A marker that cannot pass its own validator is not an authorization; it is theater.

## 3. ONE NARROW BOOTSTRAP-COMPATIBILITY REPAIR — AUTHORIZED NOW

Complete exactly one small off-live bootstrap repair on `claude/worker1-h1-20260815`.

### Required behavior

Keep the existing closed authorization schema and the existing `require_receipts` field. Do **not** add a new broad authorization mode or weaken receipt checks globally.

Extend the existing receipt precondition so it supports two exact forms:

1. legacy form: `README_ONLY` — preserve its current behavior byte-for-byte for old/pre-execution authorizations;
2. new preserved-snapshot form: `GIT_TREE:<40-hex-tree-sha>`.

For the new form, the bootstrap must independently measure:

- the Git tree SHA for the exact frozen receipt directory at Worker HEAD;
- that there is **no working-tree modification or untracked file under that receipt directory**.

Authorization validates only when:

- the marker's `GIT_TREE:<sha>` equals the independently measured receipt tree exactly; and
- the receipt directory is clean in the worktree.

If either differs, refuse before the claim/mutation boundary.

This is a compatibility extension of one precondition, not a new bootstrap architecture.

### Required current positive target

The current committed receipt tree to preserve is:

`GIT_TREE:c11966868f8a511554e1f26bf6e5555c59833d04`

Do not hard-code that value into bootstrap source. It belongs in the future executable marker and tests/fixtures only. Production code must compare marker input to independently measured repository state.

## 4. REQUIRED RED/GREEN PROOFS

Add the smallest tests needed to prove:

1. existing `README_ONLY` authorization behavior still passes when README-only;
2. `README_ONLY` still refuses a non-empty receipt namespace;
3. exact `GIT_TREE:<sha>` passes when the committed receipt tree matches and the receipt worktree is clean;
4. wrong tree SHA refuses;
5. one modified committed receipt refuses;
6. one untracked receipt file refuses;
7. no authorization claim or control-plane mutation occurs on any refusal;
8. old executable-marker fixtures remain valid under their old README-only semantics.

Run the existing bootstrap test suite plus these focused controls. No Agent/Task/model calls are needed.

## 5. REPORT EXACTLY FOUR VALUES, THEN GPT ISSUES THE REAL KEY

After the compatibility repair, return one concise report with:

1. new exact Worker HEAD after the bootstrap repair/report commit;
2. new exact bootstrap bundle SHA-256 from the production `computeBundle()` algorithm;
3. proof current receipt tree is still exactly `c11966868f8a511554e1f26bf6e5555c59833d04` and clean;
4. exact bootstrap test counts.

Also reconfirm, without changing them:

- target toolbox commit `bbf2e6c2e9ae39a7f0f2be182c9046165eb4b198`;
- target toolbox bundle `ca0b3a708d90017018aa4ac9f4ee1aca205469fbabc418bbbf3f599959da7167`;
- Worker F36 doorway remains present;
- live `.claude/settings.json`, live manifest, and live toolbox pin remain unchanged;
- no new Agent/Task/model calls;
- no compiler/backtest/paper/broker/live-money work.

If those values are exact-green, **the next GPT ruling is the executable propagation key. There is no additional architecture review.**

## 6. EXPECTED EXECUTABLE PROPAGATION AFTER THAT KEY

The future one-shot control-plane execution will be limited to:

1. re-pin `scripts/claude_toolbox.mjs` from `4c5f9d4a...` to `bbf2e6c2...`;
2. update `.claude/worker1-hook-guard-manifest.json` to pin:
   - toolbox `bbf2e6c2e9ae39a7f0f2be182c9046165eb4b198`;
   - bundle `ca0b3a708d90017018aa4ac9f4ee1aca205469fbabc418bbbf3f599959da7167`;
3. add exactly one live `.claude/settings.json` `SubagentStop` registration:
   - matcher `general-purpose`;
   - existing trusted command `node "$CLAUDE_PROJECT_DIR"/scripts/claude_guard_hook.mjs --manifest "$CLAUDE_PROJECT_DIR"/.claude/worker1-hook-guard-manifest.json`;
   - timeout 15;
4. preserve the existing SessionStart, PreToolUse, and PostToolUse registrations;
5. preserve the frozen queue and the complete existing receipt/recovery evidence;
6. run a bounded live F36 lifecycle proof with **no new Opus budget experiment** unless a later ruling explicitly authorizes one.

The already-spent eight calls are not reset by this repair.

## 7. HARD LIMITS

Until the next GPT ruling:

- **NO deletion/reset/rewrite of existing G2 receipts.**
- **NO new Opus/Agent/Task calls.**
- **NO live `.claude/settings.json` edit.**
- **NO live manifest edit.**
- **NO live toolbox re-pin.**
- **NO frozen queue/native-call-manifest mutation.**
- **NO grader/gate weakening.**
- **NO compiler/backtest/paper/broker/live-money work.**
- **NO new guard architecture.**

## 8. SPEED RULING

This is the last compatibility turn before propagation. The target F36 code is accepted. The target toolbox code is accepted. The only reason the executable key is not emitted now is that the old bootstrap mechanically demands an empty receipt directory that no longer exists after the legitimate eight-call experiment.

Do not solve that by erasing evidence. Make the bootstrap preserve an exact existing snapshot, measure its new source/bundle once, then return for the one-shot key.

**AR-1316A final disposition:** **LANE B PASS. LIVE TARGET IS READY. PATCH ONLY THE STALE README-ONLY BOOTSTRAP PRECONDITION, THEN EXECUTE PROPAGATION ON THE NEXT RULING.**