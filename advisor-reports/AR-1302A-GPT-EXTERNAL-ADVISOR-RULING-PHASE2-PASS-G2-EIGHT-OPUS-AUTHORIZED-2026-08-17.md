# GPT EXTERNAL ADVISOR RULING — AR-1302A

## VERDICT

**AR-1302 / Phase 2 = PASS. The real ordinary Worker-1 Agent → PreToolUse traversal is now proven fail-closed with `g2_precall.strict_session=true`. Exactly one clearly NON-G2 Haiku Agent dispatch was attempted; the live guard DENIED it before subagent model execution, no model answer returned, there was no retry, and the frozen G2 state remained 8 READY / 0 SPENT.**

The control-plane/bootstrap engineering phase is CLOSED unless the actual frozen execution exposes a direct execution failure.

**AR-1303 IS AUTHORIZED TO EXECUTE EXACTLY THE EIGHT ORIGINAL FROZEN OPUS CALLS, SEQUENTIALLY, ONE-SHOT EACH, UNDER THEIR FROZEN NATIVE IDENTITIES.**

No compiler, backtest, paper, broker, production, or live-money work is authorized in AR-1303.

---

## 1. INDEPENDENT GITHUB EVIDENCE — PHASE 2 PASS

Current Worker-1 source-of-truth tip graded:

`7a1f78d9968c93f66b66fdf0b3a77cc1c7a4c7d1`

The only repository change from the previously graded propagated Worker-1 state to this tip is the AR-1302 worker report. No guard/config/frozen execution artifact changed during the calibration report commit.

At this tip GitHub independently shows:

- `.claude/worker1-hook-guard-manifest.json`:
  - `g2_precall.enabled = true`
  - `g2_precall.strict_session = true`
- `.claude/settings.json` still registers `Agent|Task|PowerShell` through PreToolUse.
- frozen queue SHA256 remains:
  `5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939`
- frozen queue still contains the original 8 unresolved rows.
- `attempts = {}`.
- `max_attempts_per_condition = 1`.
- isolated receipt directory is still README-only.
- prompt-transport index remains `row_count = 8` with the reviewed prompt/native-call hashes.
- native call manifest remains `call_count = 8`.
- all eight native calls remain:
  - `model = opus`
  - `subagent_type = general-purpose`.

The AR-1302 report records the required one-shot calibration:

- exactly one Agent dispatch;
- model = Haiku;
- clearly NON-G2 prompt/description identity;
- no frozen prompt transport payload;
- no `G2D-PERMIT:` identity;
- live PreToolUse DENY before model execution;
- no model answer returned;
- no retry;
- no frozen attempt or receipt mutation.

This is the missing live traversal proof. Phase 2 is therefore closed.

GitHub exposes no CI statuses or workflow runs for the graded Worker tip. Any reported local tests remain local execution evidence, not CI.

---

# AR-1303 — FROZEN G2 EIGHT-CALL EXECUTION AUTHORIZATION

## 2. EXECUTION PURPOSE

Run the already-frozen isolated fallback experiment exactly as designed. This packet is not allowed to improve, reinterpret, optimize, reroute, batch, or repair the eight tasks.

The experiment asks the pinned Opus locator to return literal transcript grounding for each unresolved condition under the frozen task/prompt/native-call identity.

The point of this packet is **execution of frozen evidence**, not engineering.

---

## 3. REQUIRED START STATE — ZERO SPEND BEFORE CALL 1

AR-1303 must begin from a genuinely fresh ordinary Worker-1 session on:

`claude/worker1-h1-20260815`

Before any durable spend claim or model invocation, re-measure and require all of the following:

1. Worker-1 branch is the expected branch and its live tip contains graded AR-1302 tip `7a1f78d9968c93f66b66fdf0b3a77cc1c7a4c7d1` as the current starting state or a report-only descendant with no semantic/config/frozen-artifact divergence.
2. newest GPT authority ruling is this `AR-1302A` ruling.
3. `g2_precall.enabled = true`.
4. `g2_precall.strict_session = true`.
5. PreToolUse matcher includes `Agent|Task|PowerShell`.
6. frozen queue SHA256 is exactly:
   `5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939`.
7. queue contains exactly the original eight unresolved refs listed below.
8. queue `attempts = {}`.
9. receipt directory contains only `README.md`; specifically no prior `.attempt.json`, `.raw.json`, or G2 permit artifact exists for any of the eight.
10. native-call manifest is byte-identical to the frozen manifest and has `call_count = 8`.
11. all eight manifest rows still specify `model = opus` and `subagent_type = general-purpose`.
12. prompt-transport index has exactly eight rows and every prompt SHA/native-call SHA matches the frozen manifest.
13. no Agent/Task/model dispatch has occurred in this fresh execution session before the first canonical G2 call.

**If any required start-state proof fails or contradicts the frozen state, STOP before any spend. Do not repair inside AR-1303. Return to GPT with the contradiction.**

---

## 4. EXACT FROZEN QUEUE ORDER

Execute in this exact order only:

1. `entry_sequence[0].rationale`
2. `entry_sequence[1].action`
3. `entry_sequence[1].rationale`
4. `entry_sequence[2].action`
5. `entry_sequence[2].rationale`
6. `entry_sequence[3].rationale`
7. `confluences[0].description`
8. `confluences[1].description`

No parallel dispatch. No reordering. No skipping ahead after an execution anomaly.

---

## 5. FROZEN NATIVE IDENTITIES

### 1 — `entry_sequence[0].rationale`

- prompt SHA256:
  `def6539072ea927a1ecf073fea13959092a3a7a46586a28b4b52096f2fc40adc`
- native-call SHA256:
  `a4f06b01aeef41c071262f7d3e54a9cde0b8615efb80826f6314ac3b96289039`
- model: `opus`
- subagent type: `general-purpose`

### 2 — `entry_sequence[1].action`

- prompt SHA256:
  `d7db358c3226d47327131154588474e0307244c58dbcb2ce1b811858ead029c7`
- native-call SHA256:
  `ff8e95a3688228093c930f130363a6ced95f1017c0ea894239df75570a8cd6fc`
- model: `opus`
- subagent type: `general-purpose`

### 3 — `entry_sequence[1].rationale`

- prompt SHA256:
  `23a786f07fd2029cadd10cb75a579f0d8099304f986baad696ecbea3142fc502`
- native-call SHA256:
  `b705e4091698f71468166daec23d30b7a4f8630e193d49d9ace2d61b5aea7ff6`
- model: `opus`
- subagent type: `general-purpose`

### 4 — `entry_sequence[2].action`

- prompt SHA256:
  `3c57e4740c81487d8060f085ebb512745747a3d7995baa2c05e6414eb5ca411d`
- native-call SHA256:
  `666235bd70e257bde2f50846ea59e9aa7edfde652a2b7d6774f413f84c271205`
- model: `opus`
- subagent type: `general-purpose`

### 5 — `entry_sequence[2].rationale`

- prompt SHA256:
  `a91752c29ee77eea206af17acb33b07bdeccfb4c037485df5214edf31147c102`
- native-call SHA256:
  `22278a8f3fe92121e0a03133597a0e983596c1e554327fbdf0896ad9b10f57a6`
- model: `opus`
- subagent type: `general-purpose`

### 6 — `entry_sequence[3].rationale`

- prompt SHA256:
  `95599ce8784d73b4e4b9c83768530f80bff1f8f93e26191725cdb8b9afbc1fde`
- native-call SHA256:
  `e8295cde9647e0933f99c0af608d62f97b21074c77b93b817be167b3b511837e`
- model: `opus`
- subagent type: `general-purpose`

### 7 — `confluences[0].description`

- prompt SHA256:
  `cf2d192c8eadb50717b653d7f30c135d77862591d09909c2df7a5f51a8b26b99`
- native-call SHA256:
  `678b0e82e7c29124d6d6e714d4da2917fcd94975553b70f4bccee9ccb023a59f`
- model: `opus`
- subagent type: `general-purpose`

### 8 — `confluences[1].description`

- prompt SHA256:
  `905cac9b90dade5f86b539088ab53b21dd4233a574202662a74f8f07ef26c4f3`
- native-call SHA256:
  `a650c158aeb712e656053da4b0bf110979d5cfb2e1e1b527ade54205ade62145`
- model: `opus`
- subagent type: `general-purpose`

These identities are immutable for AR-1303.

---

## 6. PER-ROW ONE-SHOT PROCEDURE

For each row, in the exact queue order above:

### A. Re-verify identity before spending

Before touching the row's spend ledger, verify:

- exact condition ref;
- exact `task_input_sha256` from the frozen queue;
- exact materialized prompt file for that condition;
- exact prompt SHA256 listed above;
- exact native-call SHA256 listed above;
- exact `model = opus`;
- exact `subagent_type = general-purpose`;
- exact canonical permit path / `G2D-PERMIT:` description requirements from the frozen native-call manifest.

If any identity differs, STOP before spending that row.

### B. Use the existing canonical G2 guard/receipt protocol — do not invent a replacement

The repository already defines two load-bearing execution concepts and AR-1303 must use the existing implementation/tooling exactly:

1. the canonical durable one-shot spend receipt described by the isolated-receipts README, using create-only semantics before invocation; and
2. the canonical G2 pre-call permit identity required by the frozen native-call manifest / live guard.

Do **not** hand-author a new execution protocol, alternate ledger, new permit schema, or new guard bypass.

### C. Durable spend MUST happen before invocation

Before invoking Opus for that row, durably create the canonical create-only attempt/spend receipt:

`<sanitized_condition_ref>.<task_hash12>.attempt.json`

using the repository's canonical receipt semantics.

The durable attempt receipt is the spend point.

**Once that `.attempt.json` exists, the row is permanently SPENT regardless of what happens next.**

A timeout, tool error, guard refusal, empty model result, malformed result, raw-receipt failure, process crash, or downstream grading failure does NOT restore the row to READY.

Never delete, overwrite, rename away, or recreate the durable attempt receipt to obtain a retry.

### D. Canonical guard permit / description identity

Use the frozen native manifest's exact per-row `permit_path` and exact description requirements, including the required:

`G2D-PERMIT: <permit_path>`

identity and exact condition ref.

The live guard must validate the exact frozen native call. No forged bypass, no relaxed description, no alternate permit path.

### E. Invoke exactly once

Invoke the Agent exactly once for that row with:

- exact frozen materialized prompt bytes;
- `model = opus`;
- `subagent_type = general-purpose`;
- exact frozen permit/description identity.

The prompt must remain byte-identical to the frozen transport artifact.

Do not inject:

- GPT advice or hints;
- expected answer text;
- batch output;
- prior winners;
- prior isolated answers;
- scores;
- correctness labels;
- rewritten wording;
- additional examples;
- any instruction not already part of the frozen prompt.

### F. Persist the raw terminal result create-only

After the single invocation returns or terminates, persist the canonical sibling raw receipt create-only:

`<sanitized_condition_ref>.<task_hash12>.raw.json`

Record the actual terminal outcome honestly, including model error/refusal/empty result if that is what occurred.

Do not transform an error into success and do not fabricate a model return.

### G. Zero-model terminal verification before advancing

Before moving to the next row, verify with zero-model/read-only controls:

- current row has exactly one durable attempt spend;
- no duplicate spend receipt exists;
- raw terminal receipt exists when the canonical protocol requires it;
- frozen queue/native manifest/prompt transport bytes are unchanged;
- no unrelated G2 row was spent;
- strict session remains armed;
- there was no second Agent invocation for the current row.

Only then may execution advance to the next frozen queue row.

---

## 7. STOP-ON-ANOMALY LAW

AR-1303 stops the entire packet immediately on any execution anomaly.

Examples include:

- durable attempt receipt collision before the intended call;
- a row already appears spent unexpectedly;
- wrong condition ref;
- wrong prompt SHA;
- wrong native-call SHA;
- wrong model or subagent type;
- guard DENY on an otherwise intended frozen call;
- permit mismatch;
- unexpected model/tool exception;
- timeout;
- empty/unparseable terminal result when the protocol cannot safely persist it;
- raw receipt write failure;
- unexpected frozen artifact mutation;
- duplicate invocation evidence;
- any attempt to execute out of queue order;
- any evidence that a different model or task ran.

If the row's durable `.attempt.json` was already created when the anomaly occurs, that row remains **SPENT**.

**Do not retry the spent row. Do not continue to later rows after an anomaly. Stop and report the exact terminal state to GPT.**

No self-repair or mutation loop is authorized inside AR-1303.

---

## 8. SUCCESS TERMINAL STATE

If all eight one-shot calls complete without execution anomaly, require and report:

- exactly 8 durable attempt/spend receipts for the eight frozen rows;
- exactly one invocation per row;
- 8 SPENT / 0 READY by durable receipt semantics;
- canonical raw terminal receipt/evidence for each attempted row;
- no retry of any row;
- frozen queue file remains byte-identical, including its frozen selection-law contents;
- frozen native-call manifest remains byte-identical;
- prompt transport remains byte-identical;
- strict session remains armed through execution;
- no Haiku/Sonnet fallback;
- no extra Agent/Task dispatches;
- no compiler/backtest/paper/broker/live-money work.

Commit and push the execution evidence/report through the normal Worker-1 path permitted by the guard.

Then STOP for GPT grade.

**Do not perform final certification, substitution, compiler binding, backtest, or downstream money-path work in the same packet.** Those begin only after GPT grades the actual eight returns and receipts.

---

## 9. FORBIDDEN

AR-1303 forbids:

- retrying any spent frozen row;
- parallel or batched G2 dispatch;
- reordering the frozen queue;
- changing any frozen prompt byte;
- changing native-call identity;
- rerouting any frozen call to Sonnet or Haiku;
- Opus fallback to another model;
- creating a ninth G2 call;
- using GPT hints/answers as model input;
- overwriting/deleting an attempt or raw receipt;
- rewriting the frozen queue to mark spends;
- rewriting the native-call manifest;
- rewriting prompt transport;
- changing guard semantics;
- new control-plane/bootstrap hardening;
- permanent model-router work;
- compiler execution;
- backtesting;
- paper trading;
- broker/Topstep work;
- production/live-money work;
- cleanup/deletion of historical bootstrap forensic state.

---

## 10. SPEED LAW

**The control-plane proof phase is over. Execute the frozen experiment.**

Do not reopen architecture merely because more hardening could theoretically be imagined.

Only a direct execution anomaly in AR-1303 can stop progress, and if one occurs the worker returns the evidence to GPT without retrying or self-repairing.

If all eight complete, the next GPT job is to grade the eight raw returns against the frozen literal/relevance/collision/fidelity/certification law and determine the resulting certified strategy state.

---

## END STATE

- AR-1302 / Phase 2 = **PASS**
- live Agent → PreToolUse fail-closed proof = **PASS**
- non-G2 Haiku calibration model execution = **BLOCKED before invocation**
- model answer from calibration = **NONE**
- Phase-2 retry = **NONE**
- frozen G2 before AR-1303 = **8 READY / 0 SPENT**
- frozen queue attempts object = **{}**
- frozen receipt directory before AR-1303 = **README-only**
- frozen native model = **Opus**
- frozen native subagent = **general-purpose**
- AR-1303 = **AUTHORIZED**
- authorized work = **exactly eight frozen Opus calls, sequential, one-shot each**
- next after AR-1303 = **STOP FOR GPT GRADE**
