# GPT EXTERNAL ADVISOR RULING — AR-1312B

**Subject:** AR-1312A Lane 1 deterministic grading at Worker content commit `089e0373742b716e6dec030d18696c3c7aa67217`

## VERDICT

**PASS — LANE 1 EXECUTION AND NEGATIVE RESULT ACCEPTED.**

The worker correctly consumed the eight AR-1312 `RECOVERED_SINGLE_SOURCE` artifacts with **zero new Agent/Task/model calls**, reused the production `g2d_finalizer.finalize()` → `opus_phase1_route.run_route()` path rather than creating a second grader, preserved historical artifacts, and emitted a new deterministic result. The result is legitimately **RED / 4 accepted of 12**, with `provenance_counts = {isolated: 8, batch: 4}`. Do not weaken gates, retry Opus, or choose a greener prior candidate merely to change that result.

The eight original Opus attempts remain spent. **NO rerun of those eight calls is authorized.**

## IMPORTANT CORRECTION TO THE WORKER'S INTERPRETATION

The report's statement that the five relevance failures are broadly a previously-known frozen-gate false-reject limitation is **too broad and is not accepted as the causal conclusion**.

Current repository truth matters:

1. `evidence_relevance.py` already contains the AR-1239 relevance-input normalization repair specifically motivated by AR-1225 false rejects.
2. `term_equivalence.py` already provides deterministic timeframe normalization and reviewed canonical equivalence such as `FVG ↔ fair value gap`.
3. Therefore the desk must not reopen a generic synonym-map debate, weaken the `0.10` floor, add per-video aliases, or label every remaining relevance rejection a gate defect.
4. The AR-1312A grading adapter intentionally extracts only the returned `quote` field. Several recovered Opus responses also carried nearby/secondary grounding notes. Those notes were correctly excluded by the existing finalizer contract, but their existence means a failure can be caused by **evidence packaging that is too narrow**, not necessarily by a bad gate or a bad condition.

The next job is to distinguish those causes using repository/source evidence, not opinion.

## FINDINGS ACCEPTED NOW

### F37 — REAL UPSTREAM DUPLICATION

`entry_sequence[1].action` and `confluences[1].description` encode the same breakout requirement and remain `HELD_DUPLICATE_ROLE_AMBIGUITY` after isolated recovery. Treat this as an upstream extraction-authoring/representation problem. **Do not silently deduplicate it inside the route.** Use an existing canonical/role-link seam if one exists; if none exists, report that absence rather than inventing a new architecture in this packet.

### F38 — REAL SOURCE-FIDELITY OVERCLAIM

`confluences[0].description` widens the source's point-in-time statement — “at 9:30 a.m. Eastern time” — into a duration/window formulation. That is correctly `RED_SOURCE_FIDELITY`. Repair the extracted condition semantics to the exact source meaning; do not relax the fidelity guard.

### F39 — TWO EXTRACTOR-ADDED RATIONALES ARE NOT SOURCE TRUTH

The recovered Opus evidence independently identified two unsupported clauses:

- `entry_sequence[2].rationale`: **“high-probability”** is not supported by the trader's source words.
- `entry_sequence[3].rationale`: **“minimizes entry risk”** is not supported by the trader's source words.

Those unsupported rationales must not survive merely because the mechanical entry rule is grounded. Preserve the source-grounded mechanical meaning and remove/repair the unsupported strengthening through the existing extraction-authoring path.

## AR-1313 — FAST SOURCE-TRUTH ATTRIBUTION / CORRECTION LANE AUTHORIZED

Proceed immediately with **zero new model calls**.

For the eight rows, produce a small deterministic attribution table using the pinned transcript, recovered artifacts, current condition text, and current gate output. Every row must be assigned exactly one primary class:

1. `UPSTREAM_DUPLICATE`
2. `SOURCE_FIDELITY_OVERCLAIM`
3. `EVIDENCE_PACKAGING_TOO_NARROW`
4. `TRUE_RELEVANCE_GATE_LIMITATION`
5. `OTHER_EXPLICIT_BLOCKER`

Rules:

- Do **not** add synonyms/aliases because they improve this grade.
- Do **not** lower or bypass relevance/fidelity/collision gates.
- Do **not** turn model grounding-note prose into truth without literal verification against the pinned transcript.
- Do **not** mutate historical AR-1312 receipts or recovered artifacts.
- For a claimed `EVIDENCE_PACKAGING_TOO_NARROW` row, show the exact adjacent/secondary literal transcript text that supplies the missing subject matter and state whether the existing production evidence-composition/antecedent seam can represent it without a new semantic special case.
- For a claimed `TRUE_RELEVANCE_GATE_LIMITATION`, prove that the condition itself is source-faithful and the existing approved equivalence normalization is insufficient; do not merely point to a RED disposition.

### Apply only unambiguous source-truth corrections in this same lane

The desk is authorized to correct generated/extraction artifacts through the **existing** source-faithful authoring path for defects proven directly by the transcript, including F38 and F39. Preserve the prior artifact and emit a new revision; do not hand-edit historical evidence in place.

For F37 duplication, use only an existing representation/authoring seam. If none exists, leave the HOLD intact and report the missing seam; do not create a generic deduplication subsystem here.

After those bounded corrections, rerun the exact existing `g2d_finalizer.finalize()` → `run_route()` path with no second grader. Report the exact remaining dispositions. **A RED result is allowed.** More Opus is not the default next move.

If the corrected route becomes mechanically acceptable under the existing gates and no new architecture/scope/safety decision is introduced, continue the existing G2 certification sequence without inserting another pre-execution GPT micro-approval. If it remains RED, stop only on the exact remaining blocker set and report it.

## F36 LANE 2 — OFF-LIVE REPAIR REMAINS AUTHORIZED IN PARALLEL

The current live Agent completion evidence bug is still real: `PostToolUse` observes the asynchronous Agent **launch acknowledgement**, not the final subagent answer. The repair target is the actual final subagent completion event.

Implement off-live, with **zero real Agent/Task/model calls**, using Claude Code's `SubagentStop` completion semantics:

1. `PostToolUse` for Agent with `isAsync=true` / `status="async_launched"` is launch-only. It must **not** create a final `.raw` or `.completion` receipt.
2. Persist/bind the launched `agent_id` to the already-frozen condition/attempt identity without marking the row complete.
3. Matching `SubagentStop` is the finalization boundary. Capture its final assistant message into the existing durable raw/completion pathway only after exact `agent_id` / frozen-row validation.
4. Row N+1 remains blocked while row N is launched but lacks a valid matching `SubagentStop` finalization.
5. Unknown/mismatched agent IDs fail closed.
6. Duplicate finalization cannot overwrite the first accepted final answer.
7. Preserve the existing one-shot/no-retry law.

Required test witnesses before any live propagation:

- async-launch ACK negative control: launched ≠ complete;
- true matching SubagentStop positive control;
- row-N+1 interlock while N is launched/unfinalized;
- unknown/mismatched agent ID fail-closed;
- duplicate SubagentStop preserves first completion / blocks duplicate;
- mutation/control witness proving removal of the finality check makes the test fail;
- full affected hook/toolbox regression suite green.

**No live protected propagation is authorized by this ruling.** Build and prove the repair off-live first. Future real Agent batches remain blocked on F36 closure, but current deterministic compiler/source-truth work is **not** blocked by F36.

## SPEED / SCOPE LAW

This is not permission to build another locator framework, relevance framework, semantic synonym layer, deduplicator, or generic orchestration system. The shortest robust path is:

`accept the truthful RED → correct proven extraction overclaims/duplication through existing seams → regrade deterministically` **in parallel with** `fix async final capture off-live → prove it`.

No new Opus spend. No gate weakening. No architecture detour.
