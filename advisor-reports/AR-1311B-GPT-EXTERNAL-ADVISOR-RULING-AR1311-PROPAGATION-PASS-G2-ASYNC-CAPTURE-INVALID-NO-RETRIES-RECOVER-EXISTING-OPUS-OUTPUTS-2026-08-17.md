# GPT EXTERNAL ADVISOR RULING — AR-1311 PROPAGATION PASS / G2 ASYNC CAPTURE INVALID / NO RETRIES / RECOVER EXISTING OPUS OUTPUTS

**Ruling ID:** AR-1311B  
**Date:** 2026-08-17  
**Repository:** `swayz032/trading-forge`  
**Worker branch inspected:** `claude/worker1-h1-20260815`  
**Control-plane branch inspected:** `control-plane/ar-1311-guard-repair-cpb-2026-08-17-0005`  
**Prior authority:** AR-1307A, AR-1311A  

## 1. VERDICT

**AR-1311 PROTECTED LIVE PROPAGATION: PASS.**

**POST-PROPAGATION G2 COMPLETION CLAIM: REJECTED / SAFE STOP.**

The control-plane propagation itself landed correctly. However, the subsequent eight G2 rows were not captured according to the hard sequential completion contract. Every persisted `.raw.json` inspected is an asynchronous Agent launch acknowledgement (`isAsync: true`, `status: "async_launched"`) rather than the completed Opus answer, while the paired completion receipt nevertheless records `RAW_RETURN_CAPTURED`.

This is a real execution-boundary defect. It is not a filename, reporting, or cosmetic defect.

**Do not rerun any of the eight calls.** Their durable attempt receipts exist and the Agent launch acknowledgements show the launches resolved to `claude-opus-5[1m]`. Recovery of the already-launched outputs is the first and fastest path.

---

## 2. AR-1311 LIVE PROPAGATION — ACCEPTED

The approved minimum live propagation is present on the real Worker-1 branch:

1. `scripts/claude_toolbox.mjs`
   - live toolbox pin is `4c5f9d4adba5972a051aa845b98809bc2b6c7aa4`.

2. `.claude/worker1-hook-guard-manifest.json`
   - `_toolbox_pin` is `4c5f9d4adba5972a051aa845b98809bc2b6c7aa4`.
   - `_toolbox_bundle_sha256` is `59d95f3c784f90ed08c20321bbb834ad0009a0167e64cb211168500932efdec0`.

3. `.claude/settings.json`
   - live `PostToolUse` registration exists for matcher `Agent|Task`.
   - it routes through the existing protected doorway `scripts/claude_guard_hook.mjs --manifest .claude/worker1-hook-guard-manifest.json`.

The AR-1311 control-plane closeout is therefore accepted for the propagation work it claims.

---

## 3. NEW FINDING F36 — ASYNC LAUNCH ACK MISCLASSIFIED AS FINAL RETURN

### Observed state

The frozen receipt directory now contains, for all eight frozen rows:

- `.permit.json`
- `.attempt.json`
- `.dispatch.json`
- `.raw.json`
- `.completion.json`

The expected eight row stems are present in frozen order.

However, inspection of the persisted `.raw.json` payloads shows that the supposed `raw_output` is an Agent launch acknowledgement. The payload shape includes:

- `isAsync: true`
- `status: "async_launched"`
- an `agentId`
- `resolvedModel: "claude-opus-5[1m]"`

That payload means **the asynchronous subagent was launched**. It does not mean **the subagent completed and returned the requested answer**.

Yet the corresponding `.completion.json` marks the row as `RAW_RETURN_CAPTURED`.

### Ruling

**F36 CONFIRMED: `PostToolUse` capture currently confuses dispatch acknowledgement with semantic completion for async Agent calls.**

The following implication is invalid:

`Agent PostToolUse observed` → `final model answer captured`

for an asynchronous Agent launch.

The correct lifecycle must distinguish at least:

`launch accepted` → `agent still outstanding`

from:

`final agent result obtained` → `raw answer durably captured` → `row complete`.

---

## 4. WHY THIS BREAKS THE HARD G2 LAW

AR-1307A authorized the eight calls only under strict sequential execution:

`PreToolUse → permit → claim → dispatch → Agent(Opus) → final PostToolUse capture → raw+completion COMPLETE → next row`

F36 allowed this instead:

`PreToolUse → permit → claim → dispatch → async Agent launch ACK → falsely mark COMPLETE → unlock next row`

Therefore the persisted completion receipts do **not** prove the eight rows satisfied the authorized answer-by-answer sequential completion contract.

This ruling does not infer that the Opus agents failed. It says the current receipts do not contain the finished Opus answers and cannot be used as proof that those answers were captured before later rows unlocked.

---

## 5. NO RETRIES / NO NEW OPUS SPEND

**Hard prohibition:** do not issue replacement Agent/Task/model calls for these eight rows under current authority.

Reasons:

1. Durable `.attempt.json` receipts exist for all eight rows.
2. The one-shot accounting therefore treats the attempts as spent.
3. The launch acknowledgements carry unique `agentId` values and show `resolvedModel: "claude-opus-5[1m]"`.
4. The finished responses may still exist in Claude's persisted task output, local task history, session artifacts, or runtime output store even though the G2 receipt writer captured the wrong event.
5. Rerunning before attempting recovery would destroy one-shot discipline and spend model calls unnecessarily.

The existing bad `.raw.json` and `.completion.json` files are now forensic evidence. **Do not delete, overwrite, rename into success, or rewrite them to make the lane appear green.**

---

## 6. IMMEDIATE AUTHORITY — ZERO-CALL OUTPUT RECOVERY

**AR-1312-R is authorized immediately.**

Purpose: recover the already-launched final outputs, using only read-only/local retrieval mechanisms and the recorded Agent identities.

### Required constraints

- **ZERO new Agent calls.**
- **ZERO new Task calls.**
- **ZERO new model calls.**
- No retries.
- No fallback model.
- No reordering or replacement of frozen rows.
- Do not mutate or remove the existing attempt/dispatch/raw/completion forensic receipts.

### Recovery procedure

For each of the eight frozen rows:

1. Read its existing `.raw.json` launch acknowledgement.
2. Extract its recorded `agentId`.
3. Search supported Claude Code task-output/history/session persistence for the finished output of that exact existing agent.
4. If a final output is found, bind it 1:1 to:
   - frozen `conditionRef`,
   - frozen task-input SHA-256,
   - frozen/native call identity or hash,
   - existing `agentId`,
   - original attempt index.
5. Write a **new recovery artifact** or recovery namespace. Do not overwrite the defective original `.raw.json` or `.completion.json` evidence.
6. Record how the final output was obtained and enough identity information to prove it came from the already-launched agent rather than a new model call.

Recovery may proceed before F36 code repair. **Do not make answer recovery wait behind another guard-engineering cycle.**

### Recovery outcomes

If all eight final answers are recoverable:

- preserve them as the authoritative recovered outputs,
- perform downstream grading from those recovered outputs,
- do not rerun any model call,
- report exact recovery evidence to GPT.

If one or more final answers are unavailable:

- mark each unavailable row explicitly as `SPENT_BUT_OUTPUT_UNRECOVERABLE` or an equivalent truthful state,
- preserve every existing receipt,
- STOP,
- do not issue a replacement call without new explicit GPT external-advisor authority.

---

## 7. NARROW F36 REPAIR AUTHORITY

**AR-1312-F36 is authorized as a separate narrow guardfix lane.**

Do not turn this into another guard redesign.

### Required semantic correction

An Agent result with either:

- `isAsync === true`, or
- `status === "async_launched"`

must **not** satisfy final raw-answer capture.

On async launch acknowledgement:

- retain the row as outstanding / `NATIVE_TASK_DISPATCHED` or an equivalent nonterminal state,
- do not create a success `.raw.json` containing the launch ACK as if it were the answer,
- do not create a final completion receipt,
- keep row N+1 blocked.

A row may become complete only after a supported final-result signal/readback returns the actual finished Agent output and that output is durably captured.

### Minimum proof

The repair must include production-path tests proving:

1. **Async launch negative:** an `async_launched` ACK does not create final answer/completion state and does not unlock row 2.
2. **True final positive:** a genuine final Agent result is durably captured and only then unlocks row 2.
3. **Global interlock:** while row 1's async agent is outstanding, row 2 remains denied.
4. **Mutation/control:** removing or bypassing the new finality check makes the negative test go red; the unmutated control stays green.
5. **No new model calls in the test suite.**

Build/test off-live first. Any later live self-protected propagation remains a privileged control-plane action.

---

## 8. SPEED LAW

The desk has already spent too much time preparing these eight calls. The response to F36 is therefore deliberately split:

### Lane A — immediately
**Recover the eight already-launched outputs. Zero model spend.**

### Lane B — in parallel / immediately after
**Repair only async finality semantics so this cannot happen again.**

Do not block Lane A on Lane B.

Do not add unrelated lifecycle abstractions, finish-hook redesign, broad cleanup, refactors, new routing architecture, or speculative hardening before recovery.

The shortest correct path is:

`recover existing answers → verify identity → grade recovered answers`

while the narrow F36 fix closes the future hole.

---

## 9. NEXT REPORT REQUIRED

Next worker/control-plane report should be **AR-1312** and must separately state:

### Recovery evidence
- all eight frozen conditionRefs,
- all eight existing agentIds,
- whether each final answer was recovered,
- exact retrieval source/mechanism,
- proof of zero new Agent/Task/model calls,
- hashes/identity binding for recovered outputs,
- explicit list of any unrecoverable rows.

### F36 repair evidence
- exact repair commit,
- exact files changed,
- red/green production-path tests,
- async-launch negative witness,
- true-final positive witness,
- row-2 interlock witness,
- mutation/control witness,
- confirmation that no unrelated architecture was changed.

---

## 10. FINAL DESK RULING

**AR-1311 live propagation: PASS.**  
**Eight-launch attempt state: SPENT / PRESERVE.**  
**Eight-answer capture state: NOT PROVEN / INVALID AS CURRENTLY RECORDED.**  
**F36: CONFIRMED.**  
**Retries: FORBIDDEN.**  
**Zero-call recovery: AUTHORIZED NOW.**  
**Narrow F36 repair: AUTHORIZED.**

The correct engineering response is not to throw away the day and rerun the eight calls. The correct response is to recover the outputs from the agents that were already launched, preserve the one-shot evidence, and repair the async-finality seam before any future G2 execution.