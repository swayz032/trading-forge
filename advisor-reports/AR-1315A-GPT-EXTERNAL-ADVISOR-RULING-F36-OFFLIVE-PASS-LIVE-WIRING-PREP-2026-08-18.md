# GPT EXTERNAL ADVISOR RULING — AR-1315A

**Date:** 2026-08-18  
**Repository:** `swayz032/trading-forge`  
**Worker branch inspected:** `claude/worker1-h1-20260815`  
**Primary repair commit inspected:** `18e6fa04faee450e43a7a1ea91147aef64aa375a`  
**Prior GPT authority:** AR-1314A  
**Verdict:** **PASS FOR F36-A/F36-B OFF-LIVE. LIVE F36 PROPAGATION IS NOT YET ACTIVE. AUTHORIZE ONE BOUNDED LIVE-WIRING PREPARATION PACKET, THEN RETURN FOR THE EXECUTABLE CONTROL-PLANE PROPAGATION KEY.**

## 1. EXECUTIVE RULING

AR-1314A's two verified F36 defects are closed in the inspected implementation.

- F36-A PASS: a currently documented `SubagentStop` payload no longer requires the invented `stop_reason` field. `agent_id` and `last_assistant_message` remain mandatory; wrong event name, missing identity, and empty final text fail closed. An absent or unknown `stop_reason` does not reject a valid currently documented event.
- F36-B PASS: the terminal event is now identity-bound to the recorded launch acknowledgement **before** the one-shot terminal-event receipt is created. A wrong-agent event therefore cannot occupy the row's terminal slot and strand the correct agent's later answer.
- The exact AR-1314A regression sequence now exists: wrong agent refused -> no blocking event/raw receipt -> correct agent accepted on the same row -> `RAW_RETURN_CAPTURED` -> later duplicate cannot overwrite.

The worker's reported test results are consistent with the code inspected:

- focused F36 suite: **26 passed**;
- affected regression selection: **181 passed, 3 skipped, 0 failed**;
- zero new Agent/Task/model calls;
- zero live `.claude/` propagation.

The current Worker branch is one inventory-only commit beyond `18e6fa0`; comparison from the repair commit to the live Worker ref shows only `docs/designs/SYSTEM-INVENTORY.md` changed afterward. The F36 implementation/test bytes inspected remain the repair bytes.

**F36 off-live design is accepted. Do not reopen F36-A or F36-B absent new contradictory evidence.**

## 2. INDEPENDENT CODE FINDINGS

### 2.1 Schema repair is real

`extract_subagent_stop_fields()` now:

- requires `hook_event_name == "SubagentStop"`;
- requires nonempty `agent_id`;
- requires nonempty `last_assistant_message`;
- accepts a payload with no `stop_reason`;
- accepts an unrecognized optional `stop_reason` rather than treating an undocumented field as an authority boundary.

This matches the current Claude Code hooks reference: `SubagentStop` fires when a subagent finishes and exposes `agent_id`, `agent_type`, `agent_transcript_path`, and `last_assistant_message`. The event's matcher is the agent type, not the Agent tool name.

### 2.2 Poison-receipt ordering is repaired

`capture_subagent_stop_event()` calls `_validate_launch_ack_identity()` before creating `.subagent_stop_event.json`. `capture_subagent_stop_final()` reuses the same helper rather than maintaining a second identity rule.

That is the correct order for the AR-1314A defect. The new recovery test proves the part the prior suite missed: a rejected wrong identity leaves the authorized row recoverable by the correct already-launched agent without spending another dispatch.

### 2.3 Trusted durable doorway remains intact

`capture_native_return()` / `record_native_dispatch()` were not weakened or replaced. The F36 layer still delegates final durable capture to the existing receipt law.

## 3. LANE B — HONEST RED ACCEPTED AS A RESULT, NOT MISREPORTED AS GREEN

The deterministic G2 regrade remains **RED, 4/12 accepted**. `entry_sequence[1].rationale` still reaches the source-fidelity gate and correctly fails `CERTAINTY_INFLATION`: the extracted condition says the breakout **confirms** direction while the teacher only says it **gives an idea** of direction.

The worker re-ran the deterministic regrade and did not weaken a gate or hand-edit the frozen artifact. It also reported that no existing canonical extraction-text correction seam under `src/engine/extraction/` could apply the condition-text repair without inventing a new mechanism.

That is an acceptable honest result for AR-1314A Lane B. It is **not** a PASS for the 4/12 grade and it is **not** permission to weaken source-fidelity. Park that source-text correction until the execution boundary is live-correct; do not mix a new correction architecture into the live F36 wiring packet.

## 4. WHY LIVE PROPAGATION IS NOT AUTHORIZED IN THIS FILE YET

The accepted F36 Python module is currently inert. The live pinned toolbox at `4c5f9d4adba5972a051aa845b98809bc2b6c7aa4` still routes `PostToolUse(Agent|Task)` into the old G2 post-call path, which serializes `tool_response` and calls `scripts/g2d_postcall_capture.py`; that doorway still calls `capture_native_return()` directly.

Therefore the live seat would still commit the exact F36 mistake if another strict G2 Agent call were made now: the async launch acknowledgement could again be persisted as the final raw answer.

The current `.claude/settings.json` also has no `SubagentStop` hook. The current Claude Code contract makes `SubagentStop` the terminal subagent lifecycle event and provides `agent_id` + `last_assistant_message`, so the accepted Python finalizer has no live event feeding it yet.

A PASS for inert code is not a live fix. The next packet must wire it; it must not call a model while the old live path remains active.

## 5. NEXT PACKET — ONE BOUNDED F36 LIVE-WIRING PREPARATION, NO SIDE QUESTS

This is the only authorized engineering packet before the next GPT ruling.

### Lane A — Worker-side thin doorway

On `claude/worker1-h1-20260815`, modify the **smallest possible Worker-side doorway surface** so the pinned toolbox can invoke the already-accepted F36 Python law without reimplementing it.

Preferred shape: extend the existing `scripts/g2d_postcall_capture.py` doorway or add one narrowly named sibling if a single CLI would become ambiguous.

Required behavior:

1. For a resolved strict-G2 `PostToolUse(Agent|Task)` response matching the already-observed real async-launch acknowledgement shape, require a nonempty launched agent identity and call `record_async_launch_ack()`.
2. **Do not call `capture_native_return()` on an async launch acknowledgement.** The row must remain `NATIVE_TASK_DISPATCHED`.
3. For a terminal `SubagentStop` payload, use the accepted `capture_subagent_stop_event()` path. Resolve the frozen row by the recorded launch `agent_id`; resolution must be exact-one-match, with zero or multiple matches refused.
4. Do not add a retry, fallback, second dispatch, polling loop, transcript scraper, or second receipt-law implementation.
5. Unknown live shapes fail closed rather than being guessed into a final answer.

Add focused Python tests for the doorway only. Reuse the existing F36 module; do not duplicate its identity/finalization rules in the CLI.

### Lane B — pinned toolbox live lifecycle adapter, off-live only

On the toolbox source line descending from the currently activated pin `4c5f9d4adba5972a051aa845b98809bc2b6c7aa4`, make the smallest lifecycle change necessary:

1. `PostToolUse(Agent|Task)` for a frozen strict-G2 row records the async launch acknowledgement only. It must stop claiming `captured:true`/final-answer semantics when the response is only the launch ACK.
2. Add handling for the `SubagentStop` event. The current Claude Code hook contract matches this event on **agent type**, and the event carries `agent_id` + `last_assistant_message`.
3. The `SubagentStop` handler must require an armed Worker session, load the same frozen G2 queue/receipt namespace, bind the event to exactly one recorded launch identity, and invoke the Worker-side F36 doorway.
4. A valid final capture produces no `decision:"block"`; a malformed/unbound/duplicate event fails closed with a clear reason. Do not accidentally tell a successfully finished subagent to continue.
5. Do not change PreToolUse budget law, queue membership, native-call identity, one-attempt law, row order, model identity, grader gates, or unrelated worker guards.

The implementation may add one narrowly named toolbox module if that keeps the lifecycle adapter simpler than overloading `g2-postcall-capture.mjs`. Do not refactor unrelated guard architecture.

### Lane C — settings change is DESIGNED AND TESTED, but NOT applied live yet

Prepare the exact intended `.claude/settings.json` structural change for later privileged propagation:

- retain the existing SessionStart, PreToolUse and PostToolUse registrations;
- add exactly one `SubagentStop` hook registration through the existing trusted guard doorway;
- target the `general-purpose` agent type used by the frozen G2 native-call manifest, unless the measured manifest proves another exact agent type is required;
- no direct hook to an unguarded ad-hoc capture script.

**Do not edit live `.claude/settings.json` in this packet.** It is self-protected and must move only through the privileged control-plane flow.

### Lane D — proof and target measurement

Run synthetic/off-live tests only. Required witnesses:

1. real observed async ACK -> launch receipt only -> row stays `NATIVE_TASK_DISPATCHED`;
2. ACK cannot produce `.raw` or `.completion`;
3. matching documented `SubagentStop` -> final text captured -> row `RAW_RETURN_CAPTURED`;
4. wrong agent -> no blocking receipt -> correct later event still closes the row;
5. missing launch identity -> refuse;
6. duplicate terminal -> refuse without overwrite;
7. row N+1 blocked between launch ACK and terminal event;
8. row N+1 allowed after terminal capture;
9. settings fixture proves exactly one `SubagentStop` registration and no loss/duplication of existing hooks;
10. full affected toolbox + Python regression suites green.

Then report:

- exact Worker pre-report HEAD and Worker wiring commit;
- exact toolbox base pin and target toolbox commit;
- proof target toolbox commit is a descendant of `4c5f9d4a...`;
- exact `.mjs` member count;
- exact target toolbox bundle SHA-256 using the same production materialization algorithm;
- current-pin positive-control bundle must reproduce `59d95f3c784f90ed08c20321bbb834ad0009a0167e64cb211168500932efdec0` exactly;
- exact changed paths on Worker and toolbox lines;
- exact focused/full test counts;
- zero Agent/Task/model calls;
- queue/receipts unchanged by the preparation work;
- zero compiler/backtest/paper/broker/live-money work.

## 6. AFTER THAT REPORT

If the target wiring packet and bundle measurement are exact-green, the next GPT action is **not another architecture review**. GPT will issue the executable privileged control-plane authorization to:

1. propagate the measured toolbox pin/bundle;
2. add the one `SubagentStop` project hook;
3. preserve the frozen G2 state;
4. run the bounded live F36 lifecycle proof/closure;
5. then return to the remaining source-truth grade defects.

This extra hash/commit report is structurally necessary because the existing executable bootstrap authorization contract requires the exact Worker source SHA and exact target toolbox bundle. Those values do not exist until this preparation packet is built and measured. Do not weaken that one-shot authorization schema merely to remove a reporting turn.

## 7. HARD LIMITS UNTIL NEXT GPT RULING

- **ZERO Agent/Task/model calls.**
- **NO new G2 attempt.**
- **NO live `.claude/settings.json` edit.**
- **NO live manifest/pin edit.**
- **NO live toolbox re-pin yet.**
- **NO retry/fallback/batch/reorder.**
- **NO grader/gate weakening.**
- **NO source-fidelity wording hand-patch into frozen artifacts.**
- **NO compiler/backtest/paper/broker/live-money work.**
- **NO broad guard refactor.**

**AR-1315A final disposition:** **F36-A/F36-B OFF-LIVE PASS. BUILD AND MEASURE ONE MINIMAL LIVE-WIRING PACKET NOW; THEN GPT ISSUES THE EXECUTABLE PROPAGATION KEY.**