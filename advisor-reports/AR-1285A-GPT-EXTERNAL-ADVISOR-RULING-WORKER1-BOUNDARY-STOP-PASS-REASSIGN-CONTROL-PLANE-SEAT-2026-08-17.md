# GPT EXTERNAL ADVISOR RULING — AR-1285A

## VERDICT

**AR-1285 WORKER-1 BOUNDARY STOP: PASS AS A SAFE ACTOR-BOUNDARY STOP. THIS IS NOT A PASS OF THE G2 EXECUTION-SEAT REPAIR ITSELF. THE CURRENTLY BOUND WORKER-1 CORRECTLY REFUSED TO SELF-MODIFY THE CONTROL PLANE THAT GOVERNS IT. THE FROZEN EIGHT REMAIN 8 READY / 0 SPENT. THE AR-1285 CONTROL-PLANE CLOSEOUT REMAINS UNEXECUTED AND MUST NOW BE ASSIGNED TO THE GUARD-REPAIR / CONTROL-PLANE-AUTHORIZED ACTOR NAMED IN AR-1284A.**

Worker head graded: `445b48abfd66d813004b6f07d21a684e9148c717`.

Parent: `ee912092cdcc49c6f650f87461aaafa653aa7b88`.

Prior GPT ruling: `d42e3f44effc1fd5c81f597a6fd9b4b1fe2d1fbd` (`AR-1284A`).

Do **not** send the same bound Worker-1 seat back into AR-1285 again. That would create a procedural loop in which the actor is repeatedly asked to perform work the ruling explicitly forbids it to authorize for itself.

---

## 1. INDEPENDENT REPOSITORY CHECK — REPORT-ONLY COMMIT

PASS.

Independent GitHub inspection confirms `445b48ab...` is exactly one commit ahead of `ee912092...` and changes only:

```text
docs/replay-results/AR-1285-WORKER1-BOUNDARY-STOP-ACTOR-EXCLUSION-FROZEN-EIGHT-UNSPENT-2026-08-17.md
docs/replay-results/AR-1285-commit-message.txt
```

No guard manifest, settings, hook doorway, toolbox, frozen queue, receipt namespace, native-call manifest, extraction, certification, compiler, backtest, paper, broker, or live-money file changed in this packet.

Therefore the worker did what the actor boundary required: inspect and report, not self-authorize.

---

## 2. FROZEN ONE-SHOT BUDGET — INDEPENDENT PASS

The actual frozen queue at graded head still contains:

```text
queued unresolved = 8
excluded accepted = 4
max_attempts_per_condition = 1
attempts = {}
```

The queue file's Git blob identity is unchanged from the prior graded state.

The actual isolated receipt directory at graded head still contains only:

```text
README.md
```

There is no committed `.attempt`, `.dispatch`, `.raw`, or `.completion` receipt for any frozen condition.

Therefore:

```text
FROZEN G2 READY = 8
FROZEN G2 SPENT = 0
AR-1285 MODEL/AGENT SPEND = 0
```

The irreversible budget remains intact.

---

## 3. ACTOR EXCLUSION — PASS

AR-1284A explicitly assigned the execution-seat closeout to:

```text
a guard-repair / control-plane-authorized seat
NOT the currently bound Worker-1 seat granting itself permission
```

The real Worker-1 manifest still states that self-protection is evaluated before packet scope and cannot be overridden merely because `.claude/` appears in `edit_scope.allowed_prefixes`.

The same manifest still has:

```text
g2_precall.enabled        = true
g2_precall.strict_session = false
```

So the bound seat does not satisfy the dedicated strict-session precondition and is not authorized to change the manifest that defines its own authority.

The worker's stop is therefore correct by construction, not discretionary caution.

---

## 4. `Agent -> PreToolUse` STATUS — WORDING REMAINS PRECISE

Repository inspection still confirms `.claude/settings.json` registers:

```text
PreToolUse matcher = Edit|Write|NotebookEdit|Bash|Agent|Task
```

Therefore:

```text
Agent registration gap = NO
live Agent -> installed PreToolUse traversal proof gap = YES
```

Do not describe this as a proven fail-open hook defect. The implementation is present and is designed to fail closed if invoked. What remains unproven is the live runtime traversal itself.

The worker was correct not to attempt a discriminating Agent control from the non-strict bound seat.

---

## 5. POWERSHELL GAP — STILL OPEN, WITH ONE EVIDENCE BOUNDARY

The committed hook registration still contains no `PowerShell` matcher.

The worker reports that `PowerShell` is present in the live runtime and discloses read-only/scratchpad use of that surface. GitHub can independently prove the **absence of PowerShell from the committed matcher**; the live runtime presence/use is local runtime evidence from the worker report rather than a GitHub-measurable fact.

Ruling:

```text
committed PowerShell hook coverage = ABSENT
reported live PowerShell surface    = PRESENT
execution-seat disposition          = MUST CLOSE OR PROVE UNAVAILABLE BEFORE FROZEN SPEND
```

The worker did the right thing by not using that gap to bypass the protected-surface fence.

---

## 6. IMPORTANT WORDING CORRECTION — WHICH CALIBRATION IS SPENT?

The AR-1285 report says broadly:

```text
one-shot calibration = UNSPENT
```

That phrase is ambiguous and, read historically, incorrect.

The repository contains AR-1272, whose headline and packet state explicitly record:

```text
THE ONE OPUS CALIBRATION IS SPENT
Subagent calls this packet: exactly 1
```

What is actually true now is:

```text
historical AR-1272 Opus calibration            = SPENT
new AR-1285 cheap traversal-control allowance  = UNSPENT
frozen eight G2 attempts                       = 0/8 SPENT
```

Use those exact distinctions going forward. Never write simply `one-shot calibration unspent` again without naming which authorization is meant.

This wording defect is non-blocking because no frozen receipt or Agent/model call was created in AR-1285.

---

## 7. HEADLINE PRECISION CORRECTION

The report's terminal state names:

```text
head = ee912092 unchanged
```

That is valid only as the **pre-report / session engineering head**. Publishing the report advanced the worker branch to:

```text
445b48abfd66d813004b6f07d21a684e9148c717
```

Correct future wording:

```text
control-plane/code head before report commit = ee912092
final graded/report head                     = 445b48ab
```

No substantive engineering state changed; this is provenance precision only.

---

## 8. NO REOPENING OF AR-1283 / CERTIFICATION

Nothing in this stop invalidates the previously accepted identity seam.

Still accepted:

```text
AR-1283 identity-preserving certification seam = PASS
known current accepted rows                     = 4
known current Tier-1 classifications            = 0/4
known current true Tier-3 residuals              = 4/4
frozen unresolved route rows                    = 8
```

Still unauthorized:

```text
frozen G2 spend while execution seat is unproven
Tier-3 semantic rater calls
compiler execution
backtest
paper
broker / Topstep
live money
```

---

# AR-1286 — CONTROL-PLANE-AUTHORIZED G2 EXECUTION-SEAT CLOSEOUT

## Actor — HARD REQUIREMENT

**A separate guard-repair / control-plane-authorized seat.**

The current bound Worker-1 seat is **not** the actor.

Do not ask Worker-1 to widen its own permissions, edit its own self-protected manifest/settings, or exploit an uncovered shell surface to bootstrap authority.

If the operator cannot launch a seat with control-plane authority, STOP and report that operational limitation. Do not simulate authority inside Worker-1.

## Spend authority

```text
frozen G2 Opus calls       = 0 authorized
Tier-3 calls               = 0 authorized
ordinary engineering calls = 0 authorized
live traversal calibration = exactly 1 conditionally authorized cheap NON-G2 call
```

No frozen condition may be claimed or dispatched in AR-1286.

---

## A. CONSTITUTE THE DEDICATED STRICT SESSION

The effective manifest used by the dedicated execution seat must prove:

```text
g2_precall.enabled        = true
g2_precall.strict_session = true
```

The change must be made by the control-plane-authorized actor, not by the worker governed by that manifest.

If a toolbox/guard re-pin is needed, preserve all existing identity law:

```text
immutable exact toolbox pin
exact bundle hash
activator pin == manifest expected pin
no copied second guard implementation
member diff recorded
old pin ancestor relationship measured where applicable
```

Do not broaden general Worker-1 authority merely to get one execution session running.

---

## B. CLOSE EVERY LIVE MUTABLE SHELL SIDE DOOR

Measure the live tool registry of the dedicated execution seat.

Every shell-like tool capable of mutating repository/control-plane state must be either:

```text
hook-covered under the same protected-surface policy
```

or

```text
absent/unavailable, with the live absence measured
```

At minimum resolve `PowerShell`.

Required discrimination if PowerShell is present:

```text
protected queue path       -> DENY
protected receipt path     -> DENY
protected manifest/settings/toolbox path -> DENY
ordinary allowed non-protected read-only command -> not denied merely for being PowerShell
```

Do not replace categorical path protection with more command-spelling blacklists.

---

## C. MAKE FROZEN PROMPT TRANSPORT EXECUTABLE WITHOUT MANUAL RECONSTRUCTION

Retain `native_call_manifest_t1.json` as authority.

Use the canonical existing emitter/freezer from a control-plane-authorized context to generate transport-only prompt artifacts for all eight rows.

For every condition require at minimum:

```text
condition_ref -> exactly one generated prompt artifact
sha256(prompt bytes) == frozen native_prompt_sha256
model == opus remains frozen
subagent_type == general-purpose remains frozen
task_input_sha256 unchanged
native_call_sha256 unchanged
queue_artifact_sha256 unchanged
```

No prompt may be hand-retyped, copied from a prior answer, amended with hints, or normalized through an uncontrolled CRLF/text round-trip.

The actual live Agent call must still be independently hash-matched by the PreToolUse guard. Transport artifacts are bytes, not authority.

---

## D. CLOSE LIVE `Agent -> PreToolUse` TRAVERSAL WITH THE ONE AUTHORIZED CONTROL

Only after A-C are green, issue exactly one calibration invocation:

```text
purpose          = prove native Agent -> installed PreToolUse traversal
G2 condition     = none
frozen permit    = none
strategy work    = none
model            = cheap non-Opus route, preferably Haiku if live schema permits
strict_session   = true
expected result  = DENY before model execution because no G2 permit exists
```

Interpretation:

```text
DENY from installed G2 PreToolUse law -> PASS traversal witness
model answer returns                  -> RED; hook traversal not proven; discard answer; STOP
hook/internal anomaly                 -> RED; STOP
```

No retry is authorized.

A worker-authored log line alone is not sufficient proof. If an append-only traversal audit is added, it is corroboration; the discriminating native DENY remains the load-bearing witness.

---

## E. ZERO-MODEL GUARD CONTROLS

Through the real pinned implementation prove at minimum:

```text
strict Agent without permit            -> DENY
missing/unreadable queue                -> DENY
missing/unreadable native-call manifest -> DENY
model omitted/inherited for frozen call -> DENY
wrong model                             -> DENY
wrong prompt/hash                       -> DENY
already claimed/spent condition         -> DENY
outstanding uncaptured dispatch         -> DENY
transition failure                      -> DENY
valid frozen-shaped call + STUB transition -> ALLOW in pure control only
protected PowerShell surface if present -> DENY
```

The positive ALLOW control must stub/inject the transition. It may not create a real frozen attempt or dispatch receipt.

Controls must include discriminating mutations/negative witnesses; do not count tests that merely restate fixtures.

---

## F. TERMINAL REAL-QUEUE PROOF

After all control-plane work and the one traversal calibration, re-read the actual frozen queue and receipt namespace.

AR-1286 may pass only if the real state remains:

```text
queued unresolved = 8
excluded accepted = 4
claimed refs       = []
crash-shaped refs  = []
ready              = 8
attempts           = {}
receipt directory  = README.md only
```

Also report:

```text
final dedicated-seat effective manifest identity
toolbox pin + bundle hash
live hook matcher
live mutable-shell registry result
PowerShell disposition
frozen prompt artifact hashes for all 8
one live traversal-control request/result
zero-model control results
all code/config paths changed
exact final commit SHA
CI status honestly as CI or NONE
```

Required end token:

```text
G2_EXECUTION_SEAT_PROVEN_FROZEN_EIGHT_UNSPENT
```

or, on any failure:

```text
G2_EXECUTION_SEAT_NOT_PROVEN
```

with the exact blocking evidence.

---

## 9. WHAT HAPPENS AFTER AR-1286

If and only if AR-1286 independently grades PASS and the frozen queue is still 8/8 unspent:

```text
GPT re-authorizes frozen G2 spend
-> spend each frozen condition exactly once
-> persist raw create-only
-> rebuild complete 12-row route
-> require GREEN_PENDING_CERTIFICATION
-> run AR-1283 identity seam on real rebuilt route
-> deterministic Tier-1 preparation
-> stop before Tier-3 rater dispatch for GPT grading
```

Do not combine AR-1286 seat repair with the frozen spend. Separating them prevents a control-plane defect discovered during repair from burning the evidence budget it is supposed to protect.

---

## OPERATOR DIRECTIVE

**ACCEPT THE WORKER'S AR-1285 BOUNDARY STOP. IT OBEYED THE ACTOR EXCLUSION AND PRESERVED ALL EIGHT FROZEN ATTEMPTS. CORRECT TWO PROVENANCE PHRASES: THE HISTORICAL AR-1272 OPUS CALIBRATION IS ALREADY SPENT; ONLY THE NEW AR-1285/1286 TRAVERSAL CONTROL REMAINS UNSPENT, AND THE FINAL REPORT HEAD IS `445b48ab`, NOT `ee912092`. DO NOT SEND THE SAME BOUND WORKER BACK TO MODIFY ITS OWN GUARD. LAUNCH THE SEPARATE CONTROL-PLANE-AUTHORIZED GUARD-REPAIR SEAT AND EXECUTE AR-1286 A-F WITH ZERO FROZEN-G2 CALLS. ONLY AFTER THAT SEAT IS PROVEN AND THE QUEUE IS STILL 8 READY / 0 SPENT SHOULD GPT RELEASE THE FROZEN EIGHT AGAIN.**