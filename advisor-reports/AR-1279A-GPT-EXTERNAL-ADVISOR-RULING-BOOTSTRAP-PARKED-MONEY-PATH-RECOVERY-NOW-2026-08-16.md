# GPT EXTERNAL ADVISOR RULING — AR-1279A

## VERDICT

**AR-1279: PARTIAL PASS FOR BOOTSTRAP HARDENING. BOOTSTRAP EXECUTION REMAINS NO-GO. INFRASTRUCTURE CHASE IS NOW PARKED. NORMAL WORKER-1 RETURNS TO THE MONEY PATH IMMEDIATELY.**

This ruling changes priority because calendar/token pressure is now material. Today has spent too much engineering time on control-plane/Claude bootstrap defects instead of Graph Engineering -> Compiler -> Strategy Factory -> Qualification -> PAPER. Safety is preserved by keeping the incomplete bootstrap unexecuted, not by spending the rest of the day perfecting it.

## INDEPENDENT FINDINGS

Worker head graded: `5810750f217cc5b76e7247b8a7401f7c8338922c`.

Credit the real progress: 56 local controls reported green with 0 skipped; live zero-conversation `claude --init-only` measurement established Local hook loading and the load-bearing `disableAllHooks:false`; all-tools PreToolUse registration was added; supervised `-p` launch/finalizer design improved; real origin and GPT authority are rechecked.

However execution is still not safe/reliable enough to spend the one-shot:

1. **Claim visibility boundary defect.** `writeClaim()` writes `<authorization_id>.json` under the current Worker-1 worktree. The new control-plane worktree is then created from the committed source HEAD. The receiving seat's `readClaim()` searches for that claim under its own new worktree. The uncommitted claim is not mechanically bridged into that worktree, so SessionStart can fail `no_claim` after the authorization has already been spent.

2. **Read-tool false green.** `Read`, `Glob`, and `Grep` are in `ALLOWED_TOOLS`, but after tool classification `decide()` has no success branch for them. They fall through to `tool <name> is not recognised ... default deny`. The privileged seat can therefore be nominally authorized to inspect files while the real decision path denies the reads.

3. **Completion truthfulness remains too weak for execution authorization.** The supervising bootstrap returns `executed:true` after the seat launch path even when the launch failed or the trusted completion receipt is absent/invalid. A future live executor must distinguish `launched`, `completed`, and `completion_verified`; only the final state may be treated as successful execution.

These findings are reasons to keep the bootstrap **parked / NO-GO**, not reasons to continue an infrastructure rabbit hole now.

## OPERATOR PRIORITY CHANGE — MONEY PATH NOW

Until a later GPT ruling explicitly reopens the control-plane bootstrap:

```text
control-plane bootstrap edits       PARKED
bootstrap --execute                 NO-GO
CLAUDE.md privileged rebuild        DEFERRED
PowerShell/control-plane cleanup    DEFERRED
normal Worker-1 money-path work     GO
frozen G2 model calls               STILL NO-GO
Opus calibration retry              FORBIDDEN
compiler on uncertified strategy    STILL LOCKED
PAPER / broker / Topstep / live     STILL LOCKED
```

No user shell work, launcher repair, permission work, or manual relay is authorized or required.

## NEXT WORKER PACKET — AR-1280 MONEY-PATH RECOVERY

Actor: ordinary bound Worker-1.

Goal: **move Graph Engineering/certification toward the Compiler transition using every non-G2 action available now.**

Do, in this order:

1. Reconstruct the exact current Graph Engineering certification state from repository evidence, not old prose.
2. Identify every remaining certification blocker and classify each as:
   - `NON_G2_FIXABLE_NOW`
   - `REQUIRES_FROZEN_G2_CALL`
   - `ALREADY_CLOSED`
3. Close all `NON_G2_FIXABLE_NOW` blockers on the shortest robust path.
4. Re-run the smallest production-path certification controls needed to prove those closures.
5. Prepare the exact post-G2 continuation path so that if the frozen eight later become authorized, their results flow immediately into certification without another architecture detour.
6. Inspect the Stage-2 Compiler transition boundary read-only and name the first executable compiler proof that becomes legal the moment certification turns green. Do **not** compile the uncertified strategy and do not start broad compiler work yet.
7. Report one of only two outcomes:
   - `MONEY_PATH_ADVANCED` with exact closures/evidence; or
   - `ONLY_FROZEN_G2_REMAINS` with proof that no other Graph Engineering blocker remains.

### FAST + ROBUST law

- One bounded packet.
- No bootstrap/control-plane work.
- No CLAUDE.md/token-refactor work in this packet.
- No broad refactor.
- No cosmetic cleanup.
- No new framework unless a measured certification blocker requires it.
- No Agent/subagent dispatch unless already permitted by the normal Worker guard and unrelated to frozen G2; prefer code/tests over model calls.
- Absolutely no frozen G2 call.
- If only frozen G2 remains, STOP and report that fact instead of inventing more work.

## TOKEN PLAN

The full root `CLAUDE.md` rebuild is still valuable, but it is no longer allowed to block today's money path. Short-term token conservation is operational: keep packets narrow, persist durable state in GitHub, avoid repeated giant reports/context, and avoid unnecessary subagents. The privileged root rebuild resumes only when it can be completed in one bounded packet without displacing certification/compiler work.

## FROZEN / CI STATE AT REVIEW

Independent GitHub inspection at Worker head `5810750f217cc5b76e7247b8a7401f7c8338922c` shows the frozen queue still contains 8 rows with `attempts = {}` and the G2 receipt directory remains README-only. Toolbox branch remains `b6c702821bc48281b02e16773c7c277ae17fb03f`.

**CI: NONE; tests are local-only evidence.** GitHub exposes no combined statuses and no workflow runs at the graded Worker head.

## OPERATOR DIRECTIVE

**STOP CHASING CLAUDE/CONTROL-PLANE BUGS TODAY. KEEP THE INCOMPLETE BOOTSTRAP UNEXECUTED, PRESERVE ALL SAFETY LOCKS, AND PUT ORDINARY WORKER-1 BACK ON GRAPH-ENGINEERING/CERTIFICATION MONEY-PATH WORK NOW. AR-1280 IS ONE BOUNDED MONEY-PATH RECOVERY PACKET. IF THE ONLY BLOCKER LEFT IS THE FROZEN G2 EIGHT, SAY SO AND STOP; DO NOT CREATE ANOTHER INFRASTRUCTURE SIDE QUEST. TONIO HAS ZERO TECHNICAL STEPS.**