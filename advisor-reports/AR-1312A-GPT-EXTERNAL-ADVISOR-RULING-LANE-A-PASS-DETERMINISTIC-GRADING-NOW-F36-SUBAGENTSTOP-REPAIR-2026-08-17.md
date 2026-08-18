# GPT EXTERNAL ADVISOR RULING — AR-1312 LANE A PASS / DETERMINISTIC GRADING NOW / F36 FINAL-CAPTURE REPAIR VIA SUBAGENTSTOP

**Date:** 2026-08-17

## VERDICT

**AR-1312 LANE A = PASS WITH AN EXPLICIT EVIDENCE QUALIFIER.**

The eight spent G2D Opus outputs are accepted as **RECOVERED_SINGLE_SOURCE** evidence. They are **not** to be relabeled as pristine `NATIVE_FINAL_RECEIPT` evidence because the original final-return capture was defective and the independently checked local `output_file` route was reported empty for all eight agents.

**DO NOT rerun any of the eight Opus calls. The one-shot attempts remain spent.**

AR-1312 content commit accepted for grading: `315352b5cf9f57b309509c4f1ce4d55bcdf40eca`.

The later branch-tip commit `f3d80f2b338b844554ae37c78a635d608a1c5f91` is only the generated `docs/designs/SYSTEM-INVENTORY.md` freshness update and changes the AR-1312 verdict by zero.

## WHAT GPT INDEPENDENTLY VERIFIED

1. Commit `315352b5` exists and contains the AR-1312 recovery packet.
2. Exactly eight `.recovered.json` artifacts exist under `docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-recovery-t1/`.
3. Their eight `condition_ref` values are exactly the eight frozen rows from `isolated_fallback_queue_t1.json`.
4. Their `task_input_sha256` values match the frozen queue row-for-row:
   - `entry_sequence[0].rationale` -> `3f43ec665f18308c159bef681affcbdaaa67600895b0c112974d8cd51b259241`
   - `entry_sequence[1].action` -> `01d44c2dcd03caf54f348108ce79ca70762df2578494d5ed0d8478ad29d30d21`
   - `entry_sequence[1].rationale` -> `154a24d1a9aec620efd4bedbffb25b0d634b22c909d24ac4a9f44b8083e248d8`
   - `entry_sequence[2].action` -> `389d94a9d97d49407d35e9e6059d3b4a814c9d5e4f6faed15baf5671be461a2a`
   - `entry_sequence[2].rationale` -> `f8ec398d88c594b22cdcb22d01a1e6e3c3dbe7f4bb03281808bec6e16148f27d`
   - `entry_sequence[3].rationale` -> `37884f7b6199dbceafbd8b240ba5b92f8b8817433556bde802436ae9ddd25aae`
   - `confluences[0].description` -> `22373bdfab5415c573a370f3f6ce7e416361214e674b4383c54b2e6976bacf8f`
   - `confluences[1].description` -> `a0f8a7e028d369ac3ac5994f84cd73783b93cbcd9cc1985fc7d9f9a80cf23ba6`
5. The recovery commit adds a preserve-and-strike correction notice to `G2D-EXECUTION-RESULTS-t1.md`; it does not rewrite the historical body to conceal F36.
6. No path under the original `isolated-receipts-t1/` namespace appears in the AR-1312 commit diff. Original launch/receipt evidence is preserved.
7. The recovered literal quote content is present in the pinned `sVkmZklJDHI` transcript. The recovered answers therefore carry useful source-grounding evidence even though the final notification event itself was not durably captured.
8. Original launch evidence checked by GPT shows the frozen row, the matching recovered `agent_id`, and `resolvedModel: claude-opus-5[1m]` for inspected rows. This is consistent with the eight-call execution report.

## REQUIRED EVIDENCE QUALIFIER

GitHub cannot independently prove two local-runtime claims after the fact:

- that each recorded subagent `output_file` was exactly 0 bytes on the worker machine at recovery time;
- that zero Agent/Task/model calls occurred locally during the recovery pass.

Those remain worker testimony. They do **not** justify rerunning the eight calls and do **not** invalidate the recovered set, but the recovered set must remain labeled **single-source recovery** rather than being laundered into pristine dual-source/native-final evidence.

## IMPORTANT PAYLOAD FINDINGS FROM THE RECOVERED OPUS OUTPUTS

The eight calls did useful work. They did not merely reproduce green-looking anchors.

At minimum, the recovered outputs expose these source-fidelity issues for the deterministic grader to adjudicate under the already-frozen law:

- `entry_sequence[2].rationale`: the extracted phrase **"high-probability"** is not grounded by the trader's source statement; the mechanical FVG entry rule is grounded.
- `entry_sequence[3].rationale`: the extracted justification **"minimizes entry risk"** is not grounded; third-candle-close entry / FVG confirmation is grounded.
- `confluences[0].description`: the source says the strategy needs to be traded **at 9:30 a.m. Eastern time**; an extracted condition that widens that point into a broader "during the 9:30 session" window must not be silently accepted.
- `entry_sequence[1].action` and `confluences[1].description` still describe the same breakout requirement and must go through the frozen final-set collision rule; do not silently deduplicate or pick whichever disposition is greener.

## FASTEST CORRECT NEXT PATH — NO GPT ROUND-TRIP BETWEEN THESE STEPS

### LANE 1 — RUN THE FROZEN DETERMINISTIC SUBSTITUTION / GRADING PIPELINE NOW

This is authorized **immediately** using the eight `RECOVERED_SINGLE_SOURCE` artifacts.

Constraints:

1. **Zero new Agent/Task/model calls.** This is deterministic grading only.
2. Apply the frozen `isolated_fallback_queue_t1.json.substitution_rule` exactly.
3. For each row: isolated/recovered return replaces the batch candidate only through the existing law; do not compare old-vs-new and keep the greener answer.
4. Run the gates in the frozen order: literal verification -> final-set collision -> primary relevance -> mechanically authorized antecedent composition -> fidelity.
5. Preserve negative results. If Opus exposed unsupported wording, the grader must be allowed to remain RED rather than weakening the gate to rescue the extraction.
6. Produce one eight-row disposition table showing old disposition, recovered anchor, final disposition, exact deciding gate/reason, and whether the extracted condition itself requires correction.
7. Do not perform semantic compiler repairs in this grading step. Measure/classify first.

**This lane is not blocked by F36 Lane B. Continue the compiler money path now.**

### LANE 2 — F36 NARROW ASYNC FINAL-CAPTURE REPAIR

AR-1312 correctly left this open. The repair target is now made precise from the current Claude Code hook contract.

**Do not design Lane B around `PostToolUse(Agent)` as the final-return event.** For an async Agent call that hook observes the launch acknowledgement. The official Claude Code hook contract provides the actual completion event:

- `SubagentStop` fires when a subagent finishes;
- it carries `agent_id`;
- it carries `agent_transcript_path`;
- most importantly, it carries `last_assistant_message`, the subagent's final response text.

Therefore the target state is:

`PreToolUse Agent -> permit/claim/dispatch -> PostToolUse Agent records launch ACK only -> row remains NATIVE_TASK_DISPATCHED -> matching SubagentStop(agent_id) captures last_assistant_message -> raw+completion final receipts -> row COMPLETE -> next row may unlock.`

#### F36 mandatory behavior

1. `isAsync:true` and/or `status:"async_launched"` can never satisfy final-return capture.
2. PostToolUse launch ACK may be recorded as launch telemetry, but must not create the final `.raw.json` / `.completion.json` state that unlocks the next row.
3. A `SubagentStop` must bind by `agent_id` to exactly one already-dispatched frozen condition.
4. Unknown, wrong-row, missing, or already-consumed `agent_id` -> fail closed; never unlock a later row.
5. `last_assistant_message` is the final-answer payload to hash/capture. Do not guess nested PostToolUse output fields again.
6. Capture failure leaves the condition unresolved / dispatched and preserves the global sequential interlock.
7. Duplicate SubagentStop for an already-captured agent must not overwrite the first durable final return.
8. No fallback model, no retries, no row reorder.

#### F36 required proof before any future live propagation

Off-live/scratch first. At minimum prove:

- RED before repair: async Agent PostToolUse ACK is incorrectly capable of finalizing a row.
- GREEN after repair: same ACK leaves row dispatched and next row denied.
- Correct matching SubagentStop captures `last_assistant_message`, writes final receipts, and only then unlocks next row.
- Wrong `agent_id` SubagentStop cannot unlock.
- Duplicate final event cannot mutate first capture.
- Capture exception/failure cannot unlock.
- Real hook-runner lifecycle test exercises SessionStart -> PreToolUse -> PostToolUse async ACK -> SubagentStop final -> next PreToolUse.
- Mutation/control proves removing the SubagentStop/interlock rule reintroduces the failure.
- Existing G2 hook regression suite remains green.

**Worker-1 may build/test this on the non-live guardfix/scratch surface. Worker-1 is NOT authorized by this ruling to mutate protected live `.claude` control files.**

When the F36 repair packet lands, GPT will inspect the exact repair commit/bundle and, if green, issue the single minimum privileged propagation decision. Do not expand this into another architecture project.

## SPEED LAW

If the same Worker must do both lanes, execute in this order:

1. deterministic eight-row substitution/grading now;
2. F36 off-live repair/tests;
3. report both results.

**Do not stop between 1 and 2 merely to ask GPT whether the already-authorized Lane B may begin.**

The current compiler grading is allowed to advance even while F36 remains unfixed, because no further Agent/model calls are needed for the recovered eight-row set. F36 becomes a hard blocker only before the **next** async Agent batch.

## FINAL RULING

**AR-1312 LANE A: PASS — recovered 8/8 as RECOVERED_SINGLE_SOURCE.**

**Eight Opus calls remain spent. NO RETRIES.**

**Proceed immediately to deterministic substitution/grading.**

**F36: OPEN, narrow repair authorized off-live; correct final event is `SubagentStop`, not Agent PostToolUse.**

**No new architecture, no ceremony, no waiting for another GPT approval between the two already-authorized work items.**
