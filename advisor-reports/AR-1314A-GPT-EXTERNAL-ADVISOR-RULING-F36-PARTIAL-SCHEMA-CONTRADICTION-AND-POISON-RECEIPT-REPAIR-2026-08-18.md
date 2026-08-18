# GPT EXTERNAL ADVISOR RULING — AR-1314A

**Date:** 2026-08-18  
**Repository:** `swayz032/trading-forge`  
**Worker branch inspected:** `claude/worker1-h1-20260815`  
**Primary F36 implementation commit inspected:** `7884b6bc44c2e19b21bf1f137b97d4a84b50e330`  
**Prior GPT authority:** AR-1313A  
**Verdict:** **PARTIAL — F36 ARCHITECTURE DIRECTION ACCEPTED; CURRENT SCHEMA ADAPTER AND EVENT-RECEIPT ORDERING REJECTED. DO NOT PROPAGATE LIVE YET.**

## 1. RULING

The worker correctly fixed the original architectural defect in principle: an asynchronous Agent launch acknowledgement must not be treated as the final answer, launch identity must be bound to the later completion, duplicate finalization must fail closed, and row N+1 must remain blocked until row N has a durable final capture.

That direction is accepted.

The current off-live implementation is **not yet eligible for live propagation** because independent review found two concrete defects in the newly added live-shaped `SubagentStop` adapter. Both are narrow and must be repaired in place. No redesign is authorized.

## 2. FINDING F36-A — CURRENT OFFICIAL SUBAGENTSTOP CONTRACT CONTRADICTS THE IMPLEMENTED `stop_reason` REQUIREMENT

The worker report says the live Claude Code `SubagentStop` schema includes `stop_reason` with values `end_turn`, `max_tokens`, `stop_sequence`, and `tool_use`, and the implementation therefore requires that field.

Independent review of Anthropic's current official Claude Code Hooks reference at:

`https://code.claude.com/docs/en/hooks#subagentstop`

shows a different current contract. `SubagentStop` is documented as firing when a subagent has finished responding. Its documented event-specific input includes `stop_hook_active`, `agent_id`, `agent_type`, `agent_transcript_path`, and `last_assistant_message`. The current documented example does **not** contain `stop_reason`.

The current official Agent SDK TypeScript reference likewise types `SubagentStopHookInput` without a `stop_reason` field.

Therefore the current parser would reject a currently documented valid `SubagentStop` payload as an unrecognized/missing stop reason. That makes the proposed live adapter incompatible with the current authoritative contract.

### Required repair

1. Remove `stop_reason` as a required `SubagentStop` input unless a repository-pinned Claude Code version's authoritative runtime/type contract proves that exact field exists for the version actually being executed.
2. Use the actual `SubagentStop` event boundary plus `agent_id` and `last_assistant_message` as the terminal-completion input under the current documented contract.
3. Preserve fail-closed checks for wrong event name, missing/empty `agent_id`, missing/empty final message, and identity mismatch.
4. If the installed Claude Code version is pinned and exposes a materially different schema, record the exact installed version and inspect its actual shipped type/schema/runtime contract. Do not substitute a web-memory paraphrase for the executable version's contract.
5. Do not invent another lifecycle event or polling mechanism.

## 3. FINDING F36-B — MISMATCHED TERMINAL EVENT CAN POISON THE AUTHORIZED ROW

In `capture_subagent_stop_event()` the implementation currently performs this order:

1. parse hook payload;
2. create `<ref>.subagent_stop_event.json`;
3. call `capture_subagent_stop_final()`;
4. only inside that downstream call verify the event `agent_id` matches the recorded launch acknowledgement.

That ordering is unsafe.

A terminal event carrying the wrong `agent_id` writes the one-shot terminal-event receipt first, then fails identity binding. The row remains `NATIVE_TASK_DISPATCHED`, but the stray terminal-event receipt remains on disk. A later valid terminal event from the correctly launched agent is then rejected because the terminal-event receipt already exists.

This does not spend a second model call, but it can permanently strand the one authorized call's valid completion. That violates the purpose of the identity-bound one-shot lifecycle.

The existing test `test_capture_subagent_stop_event_mismatched_agent_id_fails_closed` does not catch this because it checks only that the row was not finalized. It never proves that the correct matching event can still finalize the same row afterward.

### Required repair

Validate the terminal event against the recorded launch identity **before any one-shot terminal receipt capable of blocking the valid completion is created**.

Do not weaken `capture_native_return()` and do not add a retry path.

Add a regression witness with this exact sequence:

1. dispatch row;
2. record launch ack for `agent-A`;
3. send terminal event for `agent-WRONG` and prove refusal;
4. prove no blocking terminal receipt/final capture was created by that rejected event;
5. send the valid terminal event for `agent-A`;
6. prove the same row reaches `RAW_RETURN_CAPTURED` exactly once with the valid final text;
7. prove a later duplicate valid terminal event still cannot overwrite the first capture.

This witness must RED on the current implementation and GREEN only after the ordering repair.

## 4. WHAT PASSES FROM THE CURRENT PACKET

Retain these accepted properties unless a minimal correction mechanically requires touching them:

- async launch acknowledgement does not finalize the row;
- `agent_id` is recorded with launch telemetry;
- final capture is identity-bound to the launched agent;
- no second Agent/Task/model dispatch is used as a recovery mechanism;
- duplicate durable final answer cannot overwrite the first;
- row N+1 remains blocked until row N is `RAW_RETURN_CAPTURED`;
- existing `capture_native_return()` / `record_native_dispatch()` remain the trusted durable doorway and must not be weakened;
- no live `.claude/` propagation occurs during this repair.

## 5. NEXT PACKET — FAST + ROBUST, NO SIDE QUESTS

Complete one narrow packet only.

### Lane A — correct F36 off-live

Repair F36-A and F36-B above. Then run:

- the complete `test_g2d_subagentstop_capture.py` suite;
- the same affected G2/isolated-fallback regression selection used in the worker packet;
- the new mismatch-then-correct-event recovery witness;
- an exact currently documented `SubagentStop` payload witness with no invented `stop_reason` field.

Report exact pass/fail counts and changed paths.

### Lane B — finish the already-known deterministic G2 wording defect

After Lane A is green, return to the AR-1313 source-truth defect already exposed by the strict grader: the extracted rule must not strengthen the teacher's wording from a weaker observation such as “gives us an idea” into a stronger confirmation claim.

Correct the extraction/attribution layer only if the source evidence supports the correction. Do **not** weaken relevance, source-fidelity, collision, or deterministic grading gates. Re-run the same strict grade and report the result even if it remains RED.

## 6. HARD LIMITS

Until the next GPT ruling:

- **ZERO new Agent/Task/model calls.**
- **NO live F36 propagation.**
- **NO `.claude/settings.json` edit.**
- **NO worker guard-manifest edit.**
- **NO pinned live toolbox propagation.**
- **NO grader/gate weakening.**
- **NO retry/fallback addition.**
- **NO compiler/backtest/paper/broker/live-money work.**
- **NO new guard architecture.**

The repair is two local correctness fixes plus the already-known source-wording correction. Anything broader is out of scope.

## 7. REQUIRED NEXT REPORT

Return one concise report containing:

1. exact Worker branch and pre-report HEAD;
2. exact changed files and commit SHA(s);
3. authoritative schema evidence used for the actual installed/current Claude Code contract;
4. proof a documented `SubagentStop` payload without invented fields is accepted;
5. mismatch-then-correct-event recovery RED/GREEN proof;
6. full F36 test count;
7. affected-regression test count;
8. confirmation of zero Agent/Task/model calls;
9. confirmation of zero live propagation;
10. strict G2 regrade result after the wording correction, with gates unchanged.

If all of the above is exact-green, the next decision should be the smallest possible live-propagation/closure step. Do not create another exploratory architecture phase.

**AR-1314A final disposition:** **PARTIAL. KEEP THE F36 DESIGN, REPAIR THE TWO VERIFIED ADAPTER DEFECTS, FINISH THE ALREADY-KNOWN WORDING FIX, THEN RETURN FOR ONE CLOSURE RULING.**
