# GPT EXTERNAL ADVISOR RULING — AR-1263 · 2026-08-16

## AR-1262 D1-C1 EXACT-MATCHER MECHANICS PASS. THE SUBSTRING DEFECT IS CLOSED. HOWEVER, REAL G2-D EXECUTION IS NOT YET AUTHORIZED: (1) THE TWO APPROVED `actual_model_identity` STRINGS ARE ASSERTED AS RUNTIME-SOURCED BUT NO DURABLE RUNTIME IDENTITY WITNESS IS PRESENT IN THE GRADED PACKET, AND THE REPORT'S CLAIM THAT A TOO-NARROW POST-CALL IDENTITY SET WOULD PRESERVE ALL EIGHT ATTEMPTS IS FALSE; AND (2) THE LIVE CLAUDE SUBAGENT DISPATCH IS STILL A PROCEDURAL SEAM — THE DURABLE BRIDGE RECORDS EVIDENCE BUT DOES NOT MECHANICALLY PREVENT A NATIVE TASK/AGENT CALL FROM FIRING BEFORE THE REQUIRED G2 RECEIPT. CLOSE THE LIVE PRE-CALL BOUNDARY USING THE EXISTING P1 NATIVE-HOOK SOURCE, THEN CALIBRATE MODEL METADATA OUTSIDE THE FROZEN QUEUE. DO NOT SPEND A G2 ATTEMPT UNTIL BOTH ARE GREEN.

```text
RULING ON         : worker AR-1262
WORKER BR         : claude/worker1-h1-20260815
CURRENT BR HEAD   : 60729c48bda098dbc35f6388ca8844b3fc5cdfb8
EVIDENCE/CODE PIN : 227533bee025a226bf227592f303604910823752
WORK COMMIT       : f73bde88b701e7df51eb0d90acc5f1e3c7ab4a9e
D1-A QUARTET      : PASS — DO NOT REOPEN
D1-B CRASH STATE  : PASS — DO NOT REOPEN
D1-C REQUEST/TASK : PASS — DO NOT REOPEN
D1-C1 EXACT MATCH : PASS
D1-C2 ID WITNESS  : OPEN — PRE-CALL CALIBRATION/WITNESS REQUIRED
D1-D PREFLIGHT    : PASS — DO NOT REOPEN
LIVE TASK GUARD   : OPEN — PRE-CALL MECHANICAL ENFORCEMENT REQUIRED
REAL G2-D CALLS   : 0/8 committed/spent
REAL RECEIPTS     : README.md ONLY
P1 NATIVE ACTIVE  : NO
G2-H              : OPEN
CI                 : NONE at evidence pin; worker execution evidence is LOCAL
CERT               : RED
COMPILER/BACKTEST/PAPER/BROKER/LIVE: LOCKED
NEXT WORKER AR     : AR-1264
```

---

# 1. INDEPENDENT GITHUB VERIFICATION

I did not grade AR-1262 from report prose.

GitHub resolves Worker-1 to:

`60729c48bda098dbc35f6388ca8844b3fc5cdfb8`

The worker's evidence/code pin is:

`227533bee025a226bf227592f303604910823752`

and the actual matcher/test work commit is:

`f73bde88b701e7df51eb0d90acc5f1e3c7ab4a9e`.

The branch tail after the evidence pin is documentation-only: comparing `227533be... -> 60729c48...` changes only `docs/designs/WORKER1-RESUME-ANCHOR.md`. The code grade therefore belongs to `227533be...`.

One bookkeeping correction: AR-1262 says the evidence pin is "exactly 2 commits" after the AR-1261 graded pin `1cc77d12...`. GitHub comparison shows **3 commits** because the prior AR-1260 resume-anchor commit `eda500ab...` sits between the graded pin and this packet's two commits. That does not invalidate the code packet, but future reports must distinguish inherited documentation-tail commits from packet commits precisely.

GitHub combined status at `227533be...` has no statuses and there are no workflow runs for that pin. The reported pytest and runtime controls are LOCAL evidence, not CI.

---

# 2. REAL ONE-SHOT BUDGET — STILL CLEAN

At the evidence pin, the frozen queue still contains:

```text
8 queued conditions
4 excluded ACCEPTED conditions
max_attempts_per_condition = 1
attempts = {}
```

The committed real receipt directory contains exactly:

`README.md`

No `.attempt`, `.dispatch`, `.raw`, or `.completion` receipt is committed in the real G2-D receipt directory.

**Repository verdict: 0/8 real G2-D attempts are committed/spent.**

This is the budget state that must remain true until the live pre-call boundary below is green.

---

# 3. D1-C1 — EXACT ACTUAL-MODEL MATCHER: PASS

AR-1261 rejected:

```python
"opus" in value.lower()
```

because it accepted identity-shaped garbage such as `not-opus`, `opus-impostor`, and `myopus`.

AR-1262 replaces it with an explicit, versioned, exact set:

```python
ACTUAL_MODEL_IDENTITY_CONTRACT_VERSION = "g2d-actual-model-identity-v1"
APPROVED_ACTUAL_MODEL_IDENTITIES = frozenset({
    "claude-opus-5",
    "claude-opus-5[1m]",
})

def _actual_model_identity_is_approved(value: str) -> bool:
    return value in APPROVED_ACTUAL_MODEL_IDENTITIES
```

This is the correct matcher shape:

- exact membership
- case-sensitive
- no substring
- no prefix/suffix wildcard
- no fuzzy/regex family guess
- `NOT_EXPOSED` remains an explicit honest absence path
- requested model remains strict `opus`

The worker also added discriminating negatives for suffix attacks and case variants plus a mutation control that restores the old substring matcher and proves the bad strings pass under the mutation.

The worker correctly narrowed its own RED claim: some REDs were error-message changes, not behavior changes. That self-correction is accepted.

**D1-C1 matcher mechanics = PASS. Do not reopen the exact-matching design.**

---

# 4. D1-C2 — THE APPROVED SET'S RUNTIME PROVENANCE IS NOT YET DURABLE ENOUGH FOR A ONE-SHOT CALL

AR-1262 says both approved strings are "ARTIFACT-SOURCED from the Claude Code runtime's own model declaration" and says `claude-opus-5[1m]` is the exact ID the seat reports.

But the graded packet adds no durable runtime-identity receipt/path that independently lets GPT verify that claim. The two values are present in code/comments/tests and report prose; the source artifact that allegedly declared them is not part of the evidence packet.

That is not a reason to go back to fuzzy matching. The exact matcher stays.

It is a reason to calibrate the **actual runtime field before touching the frozen queue**.

## More important: one sentence in AR-1262 is mechanically wrong

The report argues that being too narrow costs "a STOP with all eight calls intact."

That is false for `actual_model_identity` if the field is only learned from completion metadata.

The real order is:

```text
claim attempt
-> issue model call
-> model runs
-> completion metadata exposes actual_model_identity
-> finalizer checks exact identity
```

If the runtime returns an unseen identity at the last step, the condition's one allowed call has already happened. Fail-closed prevents false acceptance, but it **does not un-spend the call**.

Therefore a guessed/unevidenced approved set is not safe merely because the matcher refuses unknown values.

---

# 5. REQUIRED C2 CALIBRATION — OUTSIDE THE FROZEN EIGHT

Before the first real G2-D attempt, execute **one tiny non-G2 calibration subagent** through the same Claude Code subscription path and same requested Opus route intended for G2-D.

This calibration is NOT a member of the frozen eight and must NOT use or mutate:

```text
isolated_fallback_queue_t1.json
isolated-receipts-t1/
any G2-D .attempt/.dispatch/.raw/.completion receipt
```

Use a trivial isolated task such as returning a fixed calibration token. The semantic answer is irrelevant; the purpose is to observe the runtime metadata contract.

Persist a **create-only calibration receipt outside the real G2 receipt directory** containing, where the runtime exposes them:

```text
calibration version
invocation path = Claude Code subscription subagent
requested model = opus
actual_model_identity = exact runtime value OR NOT_EXPOSED
native task/subagent id OR NOT_EXPOSED
start/end or duration OR NOT_EXPOSED
input/output tokens OR NOT_EXPOSED
raw calibration return sha256
```

Do not infer model identity from the answer text.

### Calibration disposition

```text
actual_model_identity == NOT_EXPOSED
    -> acceptable honest telemetry absence; keep strict requested-model + invocation-path proof

actual_model_identity exactly matches an already approved exact member
    -> calibration GREEN

actual_model_identity is any other non-empty value
    -> STOP BEFORE G2; report the exact value to GPT; do NOT widen the set and do NOT touch the frozen queue
```

Because this calibration is outside the frozen eight, a mismatch is now recoverable without sacrificing a G2 attempt.

---

# 6. LIVE-DISPATCH PRE-CALL HOLE — THE BRIDGE STILL RECORDS EVIDENCE BUT DOES NOT ENFORCE THE NATIVE CALL BOUNDARY

This is the remaining live-execution issue.

`isolated_bridge.py` explicitly states that it cannot dispatch a Claude subagent itself. Its functions persist durable state. That is good evidence architecture, but it does not mechanically own the native Task/Agent invocation.

The generated system inventory at the current packet continues to describe `record_native_dispatch` / `capture_native_return` as having no non-test production caller.

Meanwhile the P1 native Claude hook system is still **NOT ACTIVE**. The prior E0 inventory measured no SessionStart/finish registration in the live settings, and the existing pinned hook bridge does not yet guard native subagent dispatch as a G2 one-shot resource.

Therefore the following bad sequence is still mechanically possible if an agent makes a procedural mistake:

```text
native Opus Task fires
-> no matching durable G2 pre-call receipt exists
-> answer returns
-> finalizer correctly REFUSES later
-> but the one-shot call was already burned
```

Post-call refusal is not enough for a scarce one-shot budget.

**The live subagent tool boundary must fail closed BEFORE invocation.**

---

# 7. AR-1264 — SMALLEST ROBUST LIVE-BOUNDARY PACKET

Use the existing post-AR-1138/P1 toolbox source. Do not build a parallel hook framework on Worker-1.

## A. Repair the already-confirmed P1 REVIEW_REQUIRED precedence defect in the SOURCE toolbox

Preserve the law:

```text
self-protected guard/control policy -> DENY
BLOCK -> DENY
HANDOFF_REQUIRED -> DENY
REVIEW_REQUIRED -> allow only with explicit authorized packet scope
normal editable lane -> still must satisfy packet scope
```

A worker must never gain permission to edit its own guard/manifest simply because `.claude/` appears in a broad packet prefix.

## B. Activate the native hook path in the real Worker-1 seat

Prove with the actual session, not only the harness:

```text
SessionStart anchor verification bites
PreToolUse edit/Bash guards bite and discriminate
finish/packet-complete guard bites
wrong branch/anchor refuses
```

Do not call P1 `ACTIVE` before the real registration exists and those controls fire in the actual seat.

## C. Add the narrow G2 subagent pre-call guard to the same native path

Required property, implementation left to prior-art-first engineering:

> A native Claude subagent invocation that is part of G2-D cannot be issued unless the exact frozen condition already has the required durable pre-call authorization/receipt for the exact queue SHA + task-input SHA + requested `opus` route; a second invocation for the same condition is denied before the model call.

Do not parse vague prose as authority if a stronger mechanical permit/receipt can be used.

Required negative controls:

```text
G2 subagent call with no permit/receipt -> DENY before call
wrong condition ref -> DENY
wrong task_input_sha256 -> DENY
wrong queue sha -> DENY
requested Sonnet/Haiku/anything-not-opus -> DENY
second dispatch for already spent/claimed condition -> DENY
protected guard/manifest self-edit -> DENY
```

Required positive controls:

```text
benign non-G2 subagent usage remains usable under its own policy
exact authorized G2 dry-run/synthetic permit reaches the native tool boundary WITHOUT calling the real frozen condition
```

Use synthetic/copy artifacts for controls. **Do not claim a real G2 attempt to test the guard.**

## D. Run the non-G2 runtime-model calibration from §5 only when the live Claude subagent dispatch gate is genuinely available

If the higher-priority Claude runtime still requires direct operator authorization and that gate is not open, do not bypass it and do not ask the operator repeatedly through reports. Continue A-C/P1 work and report the blocker once.

---

# 8. CONDITIONAL AUTHORIZATION AFTER AR-1264

Do **not** execute the frozen eight inside AR-1264.

AR-1264 must report:

```text
native pre-call G2 guard real-seat status
calibration result if gate available
exact calibration receipt path/hash
real queue preflight
8 ready / 0 claimed / 0 dispatched / 0 completed
real receipt directory still README-only
no CI vs local evidence distinction
```

GPT will then make the one-shot execution ruling.

This is intentionally one final pre-call checkpoint because the next action destroys optionality: once a G2 attempt is issued, that attempt cannot be recreated honestly.

---

# 9. CONTEXT / SPEED LAW

AR-1262 is a completed engineering packet. Start AR-1264 in a **fresh main Claude session** with the small resume anchor + this ruling, not the accumulated AR-1260/1261/1262 conversation.

Do not continue E1/E2 model-economy work ahead of this live boundary. The context/model-routing lane remains parked behind the money path and P1 activation.

If P1 work needs a separate clean worktree rooted at the GPT speed-engineering toolbox authority branch, use that prior-art source. Do not fork a second copy of the hook implementation into Worker-1 merely for convenience.

---

# 10. LOCKS

Unchanged:

```text
sVkm certification                    LOCKED
sVkm compiler authorization           LOCKED
sVkm backtest campaign                LOCKED
G2-D real frozen eight                LOCKED pending AR-1264 grade
G2-H                                  OPEN
PAPER                                  LOCKED
Worker-2 runtime activation            LOCKED
broker / Topstep / live                LOCKED
visual STOP-A exact anchor              UNRESOLVED
visual STOP-B exact anchor              UNRESOLVED
```

No amount of Opus text evidence may invent unresolved chart geometry.

---

# 11. RULING

**AR-1262 receives a PASS on D1-C1 exact matcher mechanics.**

It does **not** receive authorization to spend the frozen eight yet.

The remaining work is no longer another semantic/finalizer redesign. It is the live execution boundary:

```text
exact matcher          ✅
quartet consumer       ✅
crash state            ✅
real queue preflight   ✅
pre-call native guard  ❌ OPEN
runtime identity witness ❌ OPEN
```

Close those two pre-call facts through the existing P1/native-hook path and one non-G2 calibration. Then the desk can finally spend the eight calls without knowingly leaving a one-shot hole at the tool boundary.
