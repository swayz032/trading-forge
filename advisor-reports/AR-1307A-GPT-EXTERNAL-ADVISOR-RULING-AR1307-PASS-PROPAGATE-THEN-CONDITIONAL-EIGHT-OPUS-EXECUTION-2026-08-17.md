# GPT EXTERNAL ADVISOR RULING — AR-1307A

## VERDICT

**AR-1307 = PASS. AR-1306 F32/F33/F34/F35 REPAIR IS ACCEPTED.**

The previously identified launch blockers are now closed in the actual GitHub implementation:

- **F32 PASS — PostToolUse is now wired through the real runner/bridge path.** `claude-hook-bridge.mjs` handles `PostToolUse`, re-verifies the armed session, loads the same frozen queue/native-call identity, and routes Agent/Task returns through `evaluatePostCallCapture()`.
- **F33 PASS — CLAIMED-only crash shape is now globally blocking.** The guard no longer relies only on `.dispatch`-without-capture detection. It consumes the existing Python `isolated_bridge.bridge_report()/state_of()` law through a read-only doorway and blocks later rows when any row is CLAIMED, NATIVE_TASK_DISPATCHED, or STRANDED_INCOMPLETE.
- **F34 PASS — frozen row order is mechanically enforced.** The next eligible condition is the first queue row not already RAW_RETURN_CAPTURED. Row N+1 cannot materialize a permit or transition while row N is still READY or incomplete.
- **F35 PASS — strict-session PostToolUse anomalies fail closed.** A strict G2 Agent/Task return that cannot join to the frozen native-call identity becomes a blocking anomaly rather than silent pass-through. A resolved frozen row with no dispatch, duplicate capture, or capture failure also blocks.

The full synthetic lifecycle witness now traverses the **real `claude-hook-runner.mjs` process boundary and the real Python doorways**, proving:

`row 2 first DENY -> row 1 permit -> claim -> dispatch -> ALLOW -> row 2 DENY while row 1 uncaptured -> row 1 PostToolUse -> raw+completion -> row 2 ALLOW -> duplicate row 1 PostToolUse BLOCK`.

The real frozen experiment remains untouched: receipt namespace README-only and queue `attempts = {}`.

No GitHub CI/status run exists for the guardfix tip. The reported 247/247 Node and 59/59 Python results are therefore accepted as **LOCAL evidence**, corroborated by inspection of the actual implementation and controls, not mislabeled as CI.

## INDEPENDENT SOURCE CHECK

Official Claude Code hook documentation confirms the architecture AR-1307 now uses:

- `PostToolUse` runs after a successful tool call and receives both `tool_input` and `tool_response`.
- top-level `decision: "block"` / `reason` is the supported PostToolUse structured decision shape.
- `PostToolUseFailure` exists, but it is **not a launch blocker for this packet**: if a real Agent call fails after its pre-call durable dispatch, the row remains spent/incomplete and the new global pre-call interlock prevents the next frozen row from dispatching. Do not widen this packet merely to add optional failure-hook handling.

## SPEED DECISION

**NO AR-1308 REPAIR PACKET. NO MORE SCRATCH ENGINEERING BEFORE PROPAGATION.**

The next action is the already-established privileged guard-repair/control-plane propagation.

## PRIVILEGED PROPAGATION — AUTHORIZED NOW

Use the existing privileged guard-repair/control-plane path. Ordinary Worker-1 must not self-edit its protected live guard.

Minimum live propagation only:

1. Ensure Worker-1 live branch contains the already-reviewed Python doorways:
   - `scripts/g2d_postcall_capture.py`
   - `scripts/g2d_bridge_report.py`
2. Re-pin `scripts/claude_toolbox.mjs` from current toolbox pin `b6c702821bc48281b02e16773c7c277ae17fb03f` to reviewed descendant:
   - `4c5f9d4adba5972a051aa845b98809bc2b6c7aa4`
3. Materialize the toolbox using the existing materializer and COMPUTE the new bundle SHA. Do not hand-type a guessed bundle.
4. Update `.claude/worker1-hook-guard-manifest.json`:
   - `_toolbox_pin = 4c5f9d4adba5972a051aa845b98809bc2b6c7aa4`
   - `_toolbox_bundle_sha256 =` exact computed bundle
   - append the normal pin-history entry
5. Update `.claude/settings.json` with exactly one `PostToolUse` registration for `Agent|Task` using the **existing live doorway**:
   - `node "$CLAUDE_PROJECT_DIR"/scripts/claude_guard_hook.mjs --manifest "$CLAUDE_PROJECT_DIR"/.claude/worker1-hook-guard-manifest.json`
   Do NOT point live settings directly at an unpinned toolbox file.
6. Do not change frozen queue, native-call manifest, prompt transport, receipt schema, model, call order, compiler, backtest, paper, broker, or live-money code.

## FRESH WORKER-1 PRODUCTION PROOF — MANDATORY, ZERO MODEL CALLS

After privileged propagation, launch a genuinely fresh ordinary Worker-1 seat and mechanically verify:

1. exact expected Worker branch/tip;
2. toolbox pin exactly `4c5f9d4adba5972a051aa845b98809bc2b6c7aa4`;
3. toolbox bundle equals the freshly computed propagated bundle;
4. `.claude/settings.json` contains `PostToolUse` matcher `Agent|Task` through `scripts/claude_guard_hook.mjs`;
5. fresh SessionStart arms normally;
6. `g2_precall.enabled = true`;
7. `g2_precall.strict_session = true`;
8. frozen queue SHA remains `5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939`;
9. frozen queue contains the same eight refs in the same order;
10. frozen queue `attempts = {}`;
11. frozen receipt namespace is still exactly README-only;
12. frozen native-call manifest remains byte-identical, eight Opus / general-purpose rows;
13. prompt transport remains byte-identical, eight rows;
14. zero real Agent/Task/model calls occurred during propagation/proof;
15. zero compiler/backtest/paper/broker/live-money work occurred.

If ANY item fails: **STOP. ZERO OPUS CALLS. REPORT THE EXACT FAILURE.**

## CONDITIONAL EXECUTION AUTHORIZATION — REMOVE THE EXTRA ROUND TRIP

If and only if all 15 fresh-seat production checks above pass exactly, **the original eight frozen Opus calls are REAUTHORIZED IMMEDIATELY. NO ADDITIONAL GPT RULING IS REQUIRED BETWEEN THE GREEN PROOF AND ROW 1.**

This conditional authorization is deliberate to remove the unnecessary advisor waiting loop while preserving the same mechanical safety boundary.

Execution law remains:

- exactly 8 original frozen rows;
- exact frozen queue order;
- exact frozen native-call identity per row;
- explicit `model = opus`;
- `subagent_type = general-purpose`;
- exactly one attempt per condition;
- no retries;
- no fallback model;
- no batching;
- no reordering;
- one row must reach RAW_RETURN_CAPTURED before the next row may dispatch;
- first anomaly stops the campaign.

For each row:

`permit -> claim -> dispatch -> Agent/Opus -> PostToolUse -> raw + completion -> next row`

If a call fails after the durable attempt/dispatch, or PostToolUse capture fails, that row is SPENT and the global interlock must stop all later rows. Do not retry and do not clean receipts to regain green.

## AFTER THE EIGHT CALLS

Return one execution report containing:

- exact 8/8 row outcomes or the exact row where STOP fired;
- durable state/receipt evidence for every attempted row;
- confirmation no retry/fallback/batch/reorder occurred;
- raw-return capture identity/hashes;
- resulting isolated substitution/grade outcome required by the existing G2 plan.

GPT will grade the **results**, not insert another pre-execution ceremony if the mechanical green proof passes.

## BOTTOM LINE

**AR-1307 PASS.**

The launch handshake is now sufficiently closed for live propagation. Do not build more guard architecture. Propagate the reviewed repair, run the fresh zero-model production proof, and if all 15 checks are exact-green, execute the original eight frozen Opus calls immediately under the existing one-shot law.