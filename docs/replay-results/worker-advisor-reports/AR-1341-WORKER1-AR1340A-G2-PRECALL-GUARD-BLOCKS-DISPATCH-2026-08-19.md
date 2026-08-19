# AR-1341

RULING : AR-1340A S3 (Stage-1/Stage-2 single-pass dispatch, "use the existing item-granular
         contract")
PIN    : working tree `claude/worker1-h1-20260815` @ `76972096`
CHANGED: `scripts/strategy_factory_prepare_and_finalize.py` (new); `scripts/strategy_factory_probe_
         certification.py` (updated, fixed a bad import); prep artifacts under
         `docs/replay-results/strategy-factory-census/extraction-vault/preps/` for all 3 pilot
         videos (`75DJN5UVQnw`, `E8Wg6tFPYjo` prepped+finalized; `FqxEKDxemtI` refused at
         extraction, no prep needed)

## PROGRESS (mechanical, no judgment call)

- Video 2/3 (`FqxEKDxemtI`): extractor itself REFUSED -- `fixed_point_stop_not_supported` ("20
  Pips below the swing low" violates the framework's fixed-point-stop ban). Clean, evidenced,
  no certification needed.
- Video 3/3 (`E8Wg6tFPYjo`): prepared + finalized with an empty verdict set -- 9/16 conditions
  unanchored (`proposed_quote_not_literal_substring`), which unconditionally forces
  `pilot_grade=False` regardless of any tier-3 outcome (finalize_certificate's own unanchored
  rule). Correctly refused at ZERO dispatch cost -- no adjudication could have changed this
  result, so none was spent.
- Video 1/3 (`75DJN5UVQnw`): prepared -- 13/13 conditions anchored but fell through to tier-3,
  genuinely needs adjudication to resolve one way or the other.

## BLOCKER

Attempted the Stage-1 dispatch AR-1340A authorized (one Agent-tool call, the blind role-taxonomy
packet, 10 Set-A + 13 Set-B items). It was refused BEFORE the model call:

```
G2 pre-call guard: G2-shaped subagent dispatch (strict dedicated G2 execution session: every
subagent dispatch requires a permit) carries no durable pre-call permit; refusing before the
model call
```

Read `.claude/worker1-hook-guard-manifest.json` (self-protected; I did not and cannot edit it --
`AR-1263 §7A self-protection is evaluated FIRST and is never scope-overridable... regardless of
what this list says`). The relevant block:

```json
"g2_precall": {
  "enabled": true,
  "strict_session": true,
  "queue_path": ".../svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json",
  ...
  "_why_strict_session_is_true_now": "AR-1299A §4 authorizes cpb-2026-08-17-0004 for packet
  AR-1278, the dedicated G2 execution packet. strict_session=true means every Agent/Task dispatch
  requires a valid frozen-queue permit -- no unguarded model calls. Armed by the Phase 1
  control-plane seat as the final configuration step before the G2 execution session begins."
}
```

`strict_session: true` was armed for a SPECIFIC, DIFFERENT, already-closed packet (AR-1278, the
G2-D sVkm source-truth adjudication session) and requires every Agent/Task dispatch on this
worktree to carry a permit hash-bound to THAT packet's frozen 8-item queue
(`isolated_fallback_queue_t1.json`). It has no relationship to AR-1338A's 40-video upgrade
factory and was never re-scoped or disabled after G2-D closed. Per AR-1327A's own "CLOSED /
DO-NOT-REOPEN LIST": *"G2 model calls"* is explicitly listed as closed -- this stale gate is a
leftover from that closed lane, not a currently-intended restriction on my current lane's work.

I am not self-authorizing a change here: this is a self-protected control-plane file, and even
if I could edit it, unilaterally deciding a security gate is "stale" and loosening it myself is
exactly what CLAUDE.md §0.3 forbids ("never weaken a gate... merely to obtain green").

## OPTIONS (not self-selected)

**Option A** -- operator/control-plane updates `g2_precall` (disable `strict_session`, or scope
it explicitly to the closed AR-1278 packet only) so AR-1340A's authorized single-pass Agent
dispatch can actually run.

**Option B** -- GPT authorizes ME (the worker, already holding full context on this packet) to
perform the Stage-1/Stage-2 blind-role and support adjudication directly in my own reasoning,
without an Agent-tool dispatch, since this is not a doer/grader conflict in the sense that law
exists to prevent (I am judging the EXTRACTOR's raw output, an artifact I did not author; I am
not grading my own certification work). This is a real quality tradeoff worth naming
transparently: I am not "blind" in the strict pre-reg sense (I have seen the source video's
subject matter while building this packet, though I was never shown any answer key or prior
adjudication result for these specific items), and it removes the independent-actor property the
original two-rater design was built around.

**Option C** -- some other adjudication path GPT names.

**Recommendation:** Option A if the operator can update the manifest quickly (this is
infrastructure housekeeping, not a scope decision); Option B only if A is not readily available
and GPT judges the reduced independence acceptable for this factory tier specifically (distinct
from, and a further step down from, the "no G2D replay" bar AR-1340A already set for the
correction-round question).

NEXT   : Holding. All 3 pilot videos' mechanical work (extraction, prep, and the 2/3 videos whose
         outcome does not depend on adjudication) is done and committed. Only video 1's Stage-1/
         Stage-2 dispatch is blocked.
STOP   : yes -- infrastructure/permission blocker, not a judgment call I can resolve or bypass.
GRADER : not dispatched (blocked by the same gate).
