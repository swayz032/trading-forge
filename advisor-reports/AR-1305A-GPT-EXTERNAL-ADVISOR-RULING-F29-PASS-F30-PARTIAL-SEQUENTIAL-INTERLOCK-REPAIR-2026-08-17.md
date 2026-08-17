# GPT EXTERNAL ADVISOR RULING — AR-1305A

## VERDICT

**AR-1305 = PARTIAL PASS / LIVE PROPAGATION NOT YET AUTHORIZED.**

The worker obeyed the actor boundary, did not self-elevate, did not spend any frozen model call, and produced real F29/F30 repair code rather than report-only prose.

Independent GitHub inspection confirms:

- Worker-1 contains the AR-1305 handoff plus the new Python post-call doorway/tests.
- The frozen receipt directory remains GitHub-visible **README-only**.
- The frozen queue still has exactly eight rows, `max_attempts_per_condition = 1`, and `attempts = {}`.
- Toolbox repair tip `d35634e29187b74857c01c9249923db411862e61` is exactly two commits ahead of prior pin `b6c702821bc48281b02e16773c7c277ae17fb03f` and changes only the focused F29/F30 toolbox files.
- F29 permit materialization is genuinely wired into `evaluateG2PreCall()` before the existing permit validation and trusted `claim -> dispatch` transition.
- `scripts/g2d_postcall_capture.py` genuinely reuses the existing `capture_native_return()` law rather than implementing a second receipt state machine.

However, AR-1305 is **not ready for privileged propagation**. Three execution-blocking gaps remain in the exact handshake that AR-1304 ordered closed.

---

## 1. F29 — PASS, BOUNDED

The F29 repair is materially correct.

The guard now:

1. derives the permit identity from the frozen native-call match rather than trusting a caller-provided condition;
2. requires the actual call to match the frozen `{model, subagent_type, prompt}` hash;
3. requires actual `model = opus`;
4. derives the only allowed permit path from the receipt directory + frozen condition;
5. refuses an arbitrary permit path;
6. refuses an already-spent condition;
7. creates the permit create-only;
8. reads and validates the permit through the pre-existing checks;
9. invokes the existing `g2d_precall_transition.py` trusted doorway;
10. returns ALLOW only after the trusted durable transition succeeds.

The F29 focused tests are meaningful and include negative/mutation controls.

**F29 itself does not need redesign.** Preserve it while closing the remaining direct blockers below.

---

# 2. F32 — F30 EXISTS AS A HELPER, BUT THE POSTTOOLUSE WIRE DOES NOT EXIST

**BLOCKER.**

`g2-postcall-capture.mjs` is a real helper and `g2d_postcall_capture.py` is a real trusted doorway, but the actual pinned hook bridge does not currently route a `PostToolUse` event into that helper.

Independent inspection of the repair tip shows:

- `claude-hook-bridge.mjs` does **not** import `evaluatePostCallCapture`;
- `claude-hook-bridge.mjs` has no `event === 'PostToolUse'` branch;
- the repair branch's `settings.fragment.json` still registers SessionStart, PreToolUse, and TaskCompleted only;
- `g2-postcall-capture.test.mjs` calls `evaluatePostCallCapture()` directly rather than proving that a synthetic PostToolUse event traverses the same real runner/bridge doorway that will be live.

This is the same class of failure already caught earlier in this campaign: two green halves are not a handshake.

### Required repair

Before any live propagation:

1. Integrate F30 into the non-live/scratch `claude-hook-bridge.mjs`.
2. Add an explicit `PostToolUse` path for `Agent` and `Task`.
3. Run that path through the same armed-session + frozen G2 context + frozen native-call manifest boundary.
4. Invoke `evaluatePostCallCapture()` from the bridge — do not duplicate its receipt law.
5. Add `PostToolUse` `Agent|Task` registration to the non-live settings fragment.
6. Add **registration-parity proof** so deleting/narrowing that matcher makes the test RED.
7. Add a real lifecycle test using synthetic hook input through the actual `claude-hook-runner.mjs` / bridge process boundary:

`SessionStart -> PreToolUse exact G2 call -> synthetic PostToolUse same call -> RAW_RETURN_CAPTURED`

with scratch/temp artifacts only and zero model calls.

The test must prove the surviving terminal files are the real `.raw + .completion` pair produced through the existing Python law.

**Do not propagate live until that complete wire is green.**

---

# 3. F33 — GLOBAL SEQUENTIAL INTERLOCK IS INCOMPLETE

**BLOCKER.**

AR-1303A required the next row to be blocked when any prior row is at:

- `CLAIMED`;
- `NATIVE_TASK_DISPATCHED`; or
- `STRANDED_INCOMPLETE`.

The current JS `outstandingCapture()` only detects a row that already has `.dispatch` but lacks `.raw` and/or `.completion`.

It does **not** detect the important crash shape:

`.attempt exists + .dispatch does not exist`

That is `CLAIMED` under the existing Python state law.

Therefore this sequence is currently not proven impossible:

1. row A claim lands;
2. row A dispatch transition fails;
3. row A is permanently SPENT at CLAIMED;
4. row B arrives;
5. current `outstandingCapture()` sees no `.dispatch` for row A;
6. row B may continue toward permit materialization / claim.

That violates the one-shot campaign stop law.

### Required repair

Use the **existing durable state law** as the authority. Do not invent a competing receipt-state machine.

Before a new row may materialize a permit or claim an attempt, prove globally that there is no other row at `CLAIMED`, `NATIVE_TASK_DISPATCHED`, or `STRANDED_INCOMPLETE`.

Add a direct red/green control:

- scratch row A: `.attempt` only;
- exact valid row B call submitted;
- expected: **DENY before row-B permit/claim/transition**;
- assert no row-B `.permit`, `.attempt`, or `.dispatch` exists;
- assert transition callback was never invoked.

Do not clean the row-A claim to regain green.

---

# 4. F34 — FROZEN ROW ORDER IS NOT MECHANICALLY ENFORCED

**DIRECT BLOCKER, SAME INTERLOCK REPAIR.**

The frozen queue has an explicit eight-row order and the governing rulings forbid row reordering.

The current F29 guard matches whichever frozen native-call row the actual input names. With a completely READY receipt directory, nothing in the inspected path proves that row 2 cannot be submitted before row 1.

Do not leave this as a worker-memory rule immediately before eight one-shot calls.

### Required repair

Make the next authorized row deterministic from durable state:

- initially: only queue row 1 is eligible;
- after row N reaches `RAW_RETURN_CAPTURED`: row N+1 becomes eligible;
- any earlier row incomplete/spent-abnormally: STOP;
- any later row submitted early: DENY;
- no batching;
- no parallel row advancement;
- no skip/reorder.

Use the existing queue order + existing durable state law. Keep this inside the same narrow G2 handshake; do not build a generic scheduler.

Required tests:

1. all READY + row 2 exact call => DENY, zero new receipts;
2. row 1 complete + row 2 exact call => permit/claim/dispatch may proceed;
3. row 1 CLAIMED only + row 2 => DENY;
4. row 1 NATIVE_TASK_DISPATCHED + row 2 => DENY;
5. row 1 STRANDED_INCOMPLETE + row 2 => DENY;
6. row 1 complete + row 3 => DENY;
7. mutation removing the order/interlock check => at least one required test RED.

This closes F33 and F34 together; do not make two architectures.

---

# 5. F35 — POST-CALL FAIL-CLOSED SEMANTICS MUST MATCH THE STRICT G2 SESSION

The current `evaluatePostCallCapture()` returns `handled:false` when:

- no native-call manifest is loaded;
- manifest queue SHA does not match; or
- the Agent call matches no frozen row.

That behavior is acceptable for ordinary non-G2 subagent use **outside** the dedicated G2 session.

Inside `strict_session = true`, a successful Agent/Task post-tool event that cannot be joined back to exactly one authorized frozen dispatch is an anomaly. It must not silently become "not this doorway's business."

### Required repair

Thread strict-session context into the post-call gate.

Inside the dedicated G2 session:

- Agent/Task PostToolUse + no manifest => BLOCK/STOP;
- queue mismatch => BLOCK/STOP;
- no exact frozen native-call match => BLOCK/STOP;
- no prior dispatch => BLOCK/STOP;
- duplicate capture => BLOCK/STOP;
- row/call mismatch => BLOCK/STOP;
- capture failure => BLOCK/STOP;
- successful exact join => capture then allow continuation.

Outside strict G2, unrelated Agent use remains untouched.

Add synthetic controls for both modes.

---

# 6. PAYLOAD-SHAPE GAP — RESOLVE READ-ONLY, DO NOT SPEND A MODEL TO PROBE IT

AR-1305 correctly disclosed that the exact live Agent `PostToolUse.tool_response` shape was not observed during this packet.

Do **not** solve that by making a cheap Agent/Task call. AR-1304 still authorizes zero model calls.

Resolve it by the narrowest zero-model source available to the repair seat, such as the installed Claude Code/runtime schema/type definition or an already-existing captured real Agent hook payload if one already exists from prior authorized work.

The post-call code must preserve the actual returned answer supplied by the hook. Do not depend on a speculative `text/content/result/output` guess without a production-shape proof.

If the installed runtime/schema cannot establish an extraction that preserves the answer, STOP and report the exact unresolved shape. Do not wire a guessed parser live.

---

# 7. AR-1306 — FINISH THE HANDSHAKE IN SCRATCH; DO NOT PROPAGATE YET

**Actor/model:** same bounded guard-repair implementation path, Sonnet 5 HIGH. No Agent/Task/Opus/Haiku model call.

AR-1306 scope is only:

1. wire F30 through the actual non-live bridge + settings fragment;
2. close F33/F34 global state/order interlock using the existing durable state authority;
3. make F30 fail-closed in strict G2 mode;
4. resolve the Agent PostToolUse output shape through read-only evidence;
5. add lifecycle + parity + mutation controls;
6. run focused + full affected guard/toolbox/Python regressions;
7. return exact evidence.

### Required final synthetic lifecycle witness

On scratch/temp artifacts, through the real runner/bridge boundary:

- fresh armed session;
- eight-row-shaped queue with at least two rows represented;
- row 2 first => DENY;
- row 1 PreToolUse => exact permit materialized -> claim -> dispatch -> ALLOW;
- row 2 while row 1 uncaptured => DENY;
- row 1 PostToolUse => actual synthetic runtime-shaped response -> `.raw + .completion` -> complete;
- row 2 PreToolUse => now ALLOW only after its own permit -> claim -> dispatch;
- duplicate row 1 PostToolUse => BLOCK/STOP;
- zero real model calls.

### Required mutation controls

At minimum:

- remove PostToolUse registration => lifecycle/parity test RED;
- bypass PostToolUse bridge branch => lifecycle test RED;
- remove CLAIMED/global outstanding check => row-2-after-row-1-claim test RED;
- remove row-order check => row-2-first test RED;
- convert strict post-call mismatch to handled:false => strict mismatch test RED.

---

# 8. AUTHORITY / NEXT STEP

**Privileged live propagation is NOT authorized yet.**

Do not modify live:

- `.claude/settings.json`;
- live Worker guard manifest;
- live toolbox pin/bundle;
- real frozen receipt namespace.

Do not run any frozen Opus call.

When AR-1306 returns green and GitHub inspection confirms the complete synthetic lifecycle wire, GPT will grade it. If clean, the same grading turn should authorize the already-established privileged control-plane path to perform the minimal live propagation, followed by the fresh Worker-1 read-only proof, followed by reauthorization of the original eight frozen Opus calls if all evidence remains green.

---

## SOURCE-OF-TRUTH END STATE

- AR-1305 worker discipline = **PASS**
- F29 implementation = **PASS**
- F30 Python `capture_native_return()` doorway reuse = **PASS**
- F30 standalone JS helper = **PASS AS COMPONENT / NOT YET A LIVE-CAPABLE WIRE**
- F30 actual PostToolUse bridge route = **MISSING**
- CLAIMED-without-dispatch global stop = **MISSING**
- frozen row-order enforcement = **MISSING**
- strict-session post-call mismatch fail-closed = **INCOMPLETE**
- frozen queue GitHub state = **8 rows / attempts {}**
- frozen receipt directory GitHub state = **README-only**
- real model calls authorized in AR-1306 = **0**
- privileged propagation = **NOT YET AUTHORIZED**
- frozen eight Opus calls = **STILL LOCKED**

## SPEED RULING

Do not reopen broad control-plane engineering.

These are not new architecture projects. They are the last mechanical wires of the same G2 one-shot handshake:

**PRE-CALL exact next row -> PERMIT -> CLAIM -> DISPATCH -> POST-CALL CAPTURE -> NEXT ROW.**

Make that one chain bite end-to-end in scratch. Then propagate once.
