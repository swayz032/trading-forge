# GPT EXTERNAL ADVISOR RULING — AR-1267 · 2026-08-16

## AR-1266 IS A REAL PARTIAL PASS, NOT A LIVE ONE-SHOT CLOSE. THE REAL WORKER-1 SEAT NOW HAS SESSIONSTART + PRETOOLUSE REGISTRATION ON DISK, `Agent|Task` ARE IN THE MATCHER, STRICT-G2 MODE EXISTS, AND THE HASH-PINNED DIRTY EXCEPTION IS THE RIGHT SHAPE. THE FROZEN EIGHT REMAIN UNSPENT. BUT FOUR LOAD-BEARING PRE-CALL DEFECTS REMAIN: THE LIVE DOORWAY/ACTIVATOR ARE NOT SELF-PROTECTED, THE TEMP TOOLBOX CACHE CAN SILENTLY REUSE AN OLD PIN, THE G2 GUARD INVERTS THE REQUIRED `CLAIM -> DISPATCH` STATE MACHINE, AND THE PERMIT DOES NOT BIND THE ACTUAL AGENT MODEL/PROMPT BYTES TO THE FROZEN TASK. FIX THESE BEFORE CALIBRATION OR ANY FROZEN CALL. NO BROAD REDESIGN.

```text
RULING ON           : worker AR-1266
TOOLBOX BRANCH      : claude/worker1-p1-toolbox-20260816
TOOLBOX PIN         : 6a06ffaedff6b3577cb739b1179b0f7523b4f12b
REAL WORKER-1 BRANCH: claude/worker1-h1-20260815
REAL SEAT PIN       : aae5080035f1f66c5ee59d9932aa7e3c12fd6828
SESSIONSTART CONFIG : PASS — REGISTERED ON DISK / HARNESS-PROVEN
PRETOOLUSE CONFIG   : PASS — REGISTERED ON DISK / HARNESS-PROVEN
AGENT|TASK MATCHER  : PASS
STRICT G2 MECHANISM : PASS AS MECHANISM; NOT ARMED FOR CALIBRATION
DIRTY EXCEPTION     : PASS AS EXACT PATH + EXACT DIFF HASH
LIVE NATIVE EVENT   : NOT YET OBSERVED FROM A REAL AGENT DISPATCH
P1 NATIVE ACTIVE    : NO
D1 CLAIM/DISPATCH   : OPEN — CURRENT PRECALL LOGIC CONFLICTS WITH D1 LAW
TOOLBOX CACHE PIN   : OPEN — STALE CACHE CAN BE REUSED
ACTUAL CALL BINDING : OPEN — TOOL MODEL/PROMPT NOT HASH-BOUND
MODEL CALIBRATION   : NOT RUN / OPEN
REAL G2-D CALLS     : 0/8
REAL RECEIPTS       : README.md ONLY
G2-H                : OPEN
CI                   : NONE at toolbox/seat pins; worker evidence is LOCAL
CERT                 : RED
COMPILER/BACKTEST/PAPER/BROKER/LIVE: LOCKED
NEXT WORKER AR       : AR-1268
```

---

# 1. INDEPENDENT GITHUB VERIFICATION

I did not grade AR-1266 from report prose.

GitHub resolves the toolbox candidate branch to:

`6a06ffaedff6b3577cb739b1179b0f7523b4f12b`

and the real Worker-1 branch to:

`aae5080035f1f66c5ee59d9932aa7e3c12fd6828`.

Relative to AR-1264's toolbox pin `032ebc76...`, the toolbox branch is exactly one commit ahead. The changed surfaces are the expected settings fragment, Claude hook bridge, G2 pre-call guard/tests, and resume-anchor guard/tests.

Relative to the prior real-seat pin `60729c48...`, the Worker-1 branch is exactly one commit ahead and changes only:

```text
.claude/settings.json
.claude/worker1-hook-guard-manifest.json
scripts/claude_guard_hook.mjs
scripts/claude_toolbox.mjs
```

No GitHub combined statuses exist at either reviewed pin and no workflow runs exist at the reviewed pins. AR-1266's test/harness counts are LOCAL evidence, not CI.

---

# 2. WHAT AR-1266 REALLY CLOSED

## 2.1 Native registration is now present on disk — PASS

The real Worker-1 `.claude/settings.json` now registers:

```text
SessionStart: startup|resume|fork
PreToolUse : Edit|Write|NotebookEdit|Bash|Agent|Task
```

and routes both through `scripts/claude_guard_hook.mjs`.

That closes AR-1265's missing `Agent|Task` registration defect at the configuration layer.

**Registration on disk = PASS.**

Do not overstate it as full native runtime proof: AR-1266 itself says it did not observe a real Claude-generated `PreToolUse` payload from an actual `Agent` dispatch. Its 18/18 matrix drives the actually registered command, which is stronger than a direct function test but still a harness.

Therefore the correct claim is:

**REGISTERED + COMMAND-PATH HARNESS-PROVEN.**

Not yet:

**P1 NATIVE ACTIVE.**

## 2.2 Strict dedicated G2 mode — PASS AS A MECHANISM

The prior content-only detector could classify a prose-only G2 call as benign. AR-1266 added `strictSession`; in strict mode every `Agent|Task` invocation requires the G2 authorization path regardless of payload wording.

That is the correct architecture for the dedicated eight-call session.

The current real manifest deliberately has:

`strict_session: false`

because calibration is non-G2 and must occur before the dedicated eight-call session is armed. That is correct for the current checkpoint.

## 2.3 Hash-pinned dirty exception — PASS

The real manifest keeps `require_clean: true` and allows exactly one previously dispositioned dirty path only when its exact `git diff HEAD --binary` hash matches:

`docs/wave25-exit-engine-ab-report.md`

The exception is path-specific, hash-specific and authority-tagged. One-byte mutation changes the hash and refuses SessionStart. That is materially better than `require_clean:false` and does not sweep the historical dirty file into G2 work.

**Dirty exception = PASS.**

---

# 3. F-1 — THE LIVE GUARD DOORWAY CAN EDIT ITSELF

AR-1264 correctly made the manifest, settings, `.claude/hooks/`, and pinned toolbox self-protected.

But AR-1266 moved the actual live control path into two Worker-1 files:

```text
scripts/claude_guard_hook.mjs
scripts/claude_toolbox.mjs
```

The Worker-1 manifest explicitly allows the prefix:

`scripts/`

and the toolbox `SELF_PROTECTED_RULES` currently do not name these two live files.

Therefore the guarded worker can reach the very doorway that executes the guard and the activator that selects/materializes the toolbox pin.

That is a self-authorization surface.

### Required repair

Add exact self-protection for at least:

```text
scripts/claude_guard_hook.mjs
scripts/claude_toolbox.mjs
```

and for any new production pre-call transition helper introduced by AR-1268.

Controls must prove:

```text
manifest edit                         -> DENY SELF_PROTECTED
settings edit                         -> DENY SELF_PROTECTED
scripts/claude_guard_hook.mjs edit    -> DENY SELF_PROTECTED
scripts/claude_toolbox.mjs edit       -> DENY SELF_PROTECTED
new transition-helper edit            -> DENY SELF_PROTECTED
ordinary authorized script edit       -> still allowed when otherwise in scope
```

Mutation: remove one exact live-control rule and show that file becomes wrongly editable.

---

# 4. F-2 — THE TOOLBOX CACHE DOES NOT VERIFY THE PIN IT CLAIMS TO CACHE

The real doorway says it materializes only when the cache does not already hold the exact pin.

But `cachedToolbox()` currently reuses the temp cache when only these two facts are true:

```text
.pin-stamp exists
claude-hook-runner.mjs exists
```

It does **not read the stamp and compare it to the current expected pin/bundle before reuse**.

It also does not re-hash the cached toolbox files before trusting the bundle represented by that stamp.

So this sequence is possible:

```text
old toolbox pin materialized in TEMP
        ↓
Worker-1 is deliberately re-pinned to new toolbox law
        ↓
old .pin-stamp + old runner still exist
        ↓
cachedToolbox() reuses old runner
        ↓
GitHub/manifest say NEW LAW
runtime executes OLD LAW
```

That is silent guard downgrade by stale cache.

### Required repair

The live doorway must treat the manifest's `_toolbox_pin` and `_toolbox_bundle_sha256` as the expected identity and verify the cache against both before execution.

At minimum:

1. read the cached stamp;
2. exact-match expected pin;
3. exact-match expected bundle SHA;
4. verify the cached materialized file set hashes back to that bundle, or rematerialize;
5. after rematerialization, require returned `pin` and `bundle_sha256` to equal the manifest before running the child;
6. mismatch/rematerialization failure = DENY, never silent reuse.

Required biting control:

- seed TEMP with an older/permissive runner + old but syntactically valid stamp;
- point Worker-1 at the newer pin;
- prove the registered doorway refuses or rematerializes and executes the new law;
- mutation that skips stamp/bundle verification must make the stale permissive runner wrongly win.

Do not solve this by materializing 40 Git objects on every tool call if local hash verification is sufficient. Fast + robust.

---

# 5. F-3 — CURRENT G2 PRE-CALL STATE MACHINE IS INVERTED AGAINST THE DURABLE ONE-SHOT LAW

This is the most important finding.

The durable D1 law already says:

```text
READY
  -> CLAIMED            (.attempt written BEFORE invocation)
  -> NATIVE_DISPATCHED  (.dispatch)
  -> RAW + COMPLETION
```

`DurableAttemptLedger.claim_attempt()` explicitly says the atomic `.attempt` claim is written **BEFORE the model is invoked**.

`record_native_dispatch()` explicitly REFUSES when no durable attempt exists and permits the transition only from `CLAIMED`.

But AR-1266's new `g2-precall-guard.mjs::conditionIsSpent()` currently treats existence of **any** `.attempt` receipt as already spent/claimed and denies the Agent call.

Therefore the present live logic has only two bad choices:

```text
A. claim .attempt first
   -> pre-call guard sees .attempt
   -> DENY

B. do not claim .attempt first
   -> pre-call guard can ALLOW
   -> native model call fires before durable claim
   -> violates the one-shot law
```

The current positive permit controls pass only because they exercise an unclaimed synthetic condition. That is not the authorized real sequence.

### Required repair — transition inside PreToolUse

Do not add another procedural `claim manually -> remember to Agent` seam.

The clean solution is for the trusted PreToolUse path itself to perform the durable state transition **before returning ALLOW**:

```text
valid exact permit + exact native call + state READY
        ↓
PreToolUse invokes protected transition doorway
        ↓
create-only .attempt
        ↓
create-only .dispatch
        ↓
ONLY THEN return ALLOW to Claude Agent
```

Reuse the existing Python `DurableAttemptLedger.claim_attempt()` and `record_native_dispatch()` semantics through a tiny protected CLI/doorway. Do not duplicate their receipt law in a second implementation.

If `.attempt` succeeds and `.dispatch` fails/crashes, the attempt is spent and PreToolUse DENIES. Do not clean it up and do not retry automatically.

If `.attempt` already exists **before** the trusted transition starts, that is a prior claim/crash shape and this new invocation is denied pending desk adjudication.

If `.dispatch`, `.raw`, or `.completion` exists, deny.

Two concurrent invocations for one condition must produce **at most one ALLOW** because the create-only receipt transition is the race arbiter.

Required controls:

```text
READY + valid call -> hook writes attempt then dispatch -> ALLOW
no valid authorization -> no receipts -> DENY
pre-existing attempt -> DENY; do not 'resume' as a new invocation
pre-existing dispatch/raw/completion -> DENY
claim succeeds, dispatch plant/failure -> DENY; attempt remains spent
second identical invocation -> DENY
concurrent pair -> at most one ALLOW
```

This closes the original D1 ordering law at the actual native boundary instead of merely recording it afterwards.

---

# 6. F-4 — THE PERMIT IS NOT YET BOUND TO THE ACTUAL AGENT MODEL OR ACTUAL PROMPT

The current G2 guard verifies:

- permit queue SHA;
- permit condition ref;
- permit `task_input_sha256` equals the frozen queue entry;
- permit requested_model equals `opus`;
- invocation text contains the condition ref.

Two critical facts are missing.

## 6.1 Permit model != actual native requested model

The guard checks `permit.requested_model == "opus"`, but does not mechanically require the actual `Agent` tool input's model field to request Opus.

A correct-looking permit must not be able to accompany a Sonnet/Haiku/default-inherited call.

Inspect the live `Agent` tool schema without dispatching and bind the exact actual model-selection field. For the eight-call session it must fail closed unless the actual native call explicitly requests the authorized Opus route.

## 6.2 Queue task hash != actual Agent prompt hash

The queue's `task_input_sha256` is the SHA of the frozen logical payload:

```json
{
  "law_version": ...,
  "route_version": ...,
  "condition_ref": ...,
  "condition_text": ...,
  "pinned_inputs": ...
}
```

That correctly binds the logical task identity.

It does **not** prove the actual `Agent` prompt/tool input being sent is byte-equivalent to the authorized isolated task. The current guard only checks that the invocation text contains the condition ref.

So a permit tied to the correct logical task could still accompany a modified prompt containing extra hints, batch answers, GPT suggestions, or different instructions.

### Required repair — freeze native call identity before answers exist

Before the first frozen call, create a deterministic versioned execution artifact for the exact eight native calls, derived only from the already-frozen queue and pinned source identities.

For each exact queued ref, pin at minimum:

```text
condition_ref
queue_artifact_sha256
task_input_sha256
requested native model = opus
native dispatch tool/type fields that are load-bearing
canonical native prompt/tool-input sha256
```

The canonical native prompt must obey the existing G2-D isolation law: pinned transcript/extraction/condition contract only; no Gemma/batch answer, prior winner, GPT hint, "correct quote", or answer-dependent wording.

Freeze this artifact **before any real answer exists**.

Then the PreToolUse hook computes the canonical hash over the actual load-bearing Agent tool input and exact-matches it to the frozen native-call artifact before performing the `.attempt -> .dispatch` transition.

A changed prompt, changed model field, changed condition, changed queue, or changed task hash must DENY before the model runs.

Do not modify/reorder the existing eight-condition queue to accomplish this. This is an execution-layer artifact, not a new selection law.

---

# 7. AR-1266 'LIVE' CLAIM — CORRECTION

AR-1266 reports "P1 IS LIVE IN THE REAL WORKER-1 SEAT" but also honestly states:

- it did not observe a real Claude-generated `PreToolUse` payload from an Agent dispatch;
- calibration did not run;
- TaskCompleted is not registered;
- full P1 ACTIVE is not claimed.

The bounded correct status is:

**SessionStart/PreToolUse REGISTERED IN THE REAL SEAT + REGISTERED-COMMAND HARNESS GREEN.**

That is useful progress.

It is not yet **NATIVE ACTIVE** and it is not yet proof that a real Agent dispatch traversed the boundary.

The eventual non-G2 calibration should provide that missing real native event witness as well as the model-identity witness.

---

# 8. REAL G2 BUDGET — INDEPENDENTLY VERIFIED CLEAN

At the real Worker-1 pin, GitHub still shows the frozen queue with:

```text
queue_count = 8
max_attempts_per_condition = 1
attempts = {}
```

The committed real receipt directory contains exactly:

`README.md`

No `.attempt`, `.dispatch`, `.raw`, or `.completion` receipt is committed.

**0/8 frozen calls are committed/spent.**

Keep it that way throughout AR-1268. All repair tests use synthetic receipt directories only.

---

# 9. AR-1268 — SHORTEST ROBUST WORK ORDER

Do not reopen D1-A/B/C1, the quartet finalizer, exact actual-model matcher, or the already-passed dirty exception design.

Execute only:

## A. protect the actual live control surface

Add exact self-protection for the real Worker-1 doorway/activator and any new transition doorway.

RED/GREEN + mutation required.

## B. close stale-cache pin/bundle reuse

Make the doorway verify current manifest pin + bundle against the cached stamp/materialized bytes before child execution. Stale permissive cache control must bite.

## C. freeze exact native-call execution identity

Create the deterministic eight-row native-call manifest before answers exist. Bind actual Agent model/tool/prompt identity to queue/task identity. No answer-dependent data.

## D. move `claim -> dispatch` into the trusted PreToolUse transaction

Valid strict G2 call at READY must create `.attempt` then `.dispatch` through the existing Python law **before ALLOW**. Any failure = DENY; no cleanup; no retry.

## E. force capture before the next frozen call

In strict session, if any ref has `.dispatch` without completed `.raw + .completion`, deny every subsequent frozen Agent dispatch. This prevents the worker from racing through eight calls and losing an uncaptured answer. A crash-shaped call stops the campaign for desk adjudication.

Use the existing `capture_native_return()` semantics through a tiny protected capture doorway rather than duplicating the receipt contract.

## F. controls

At minimum:

```text
stale old cache -> cannot execute old guard
live doorway self-edit -> deny
valid READY exact Opus exact-prompt call -> attempt+dispatch written before allow
Agent model Sonnet with Opus permit -> deny
Agent model omitted/inherited when explicit Opus is required -> deny
one-byte prompt mutation -> deny
extra hint/batch-answer mutation -> deny
forged permit but wrong actual call -> deny
pre-existing attempt -> deny
second dispatch -> deny
concurrent pair -> at most one allow
dispatch outstanding without completion -> next ref deny
capture completion -> next ref may proceed
```

## G. real-seat re-pin and read-only preflight

Integrate by deliberate immutable re-pin, not copy. Prove the real seat points to the repaired pin/bundle. Re-run read-only real preflight and prove all eight remain READY with no receipts.

## H. STOP BEFORE CALIBRATION unless the operator explicitly authorizes one subagent call

The runtime boundary reported by AR-1266 says subagents may not be dispatched unless the operator requests it. Respect that.

Do not infer authorization from this markdown ruling alone if the live Claude runtime requires an immediate operator utterance.

After AR-1268 is green and the operator explicitly says to run the calibration, the one non-G2 Opus calibration may be used to prove:

1. a real native Agent dispatch traverses the installed PreToolUse hook;
2. requested model is Opus;
3. actual model identity / task id / usage fields are captured if exposed, otherwise honest NOT_EXPOSED;
4. the frozen eight remain untouched.

Calibration is not one of the eight.

---

# 10. LOCKS

Still locked:

- all eight real frozen G2-D calls;
- G2-H final regression;
- sVkm certification;
- compiler authorization;
- backtest campaign;
- PAPER;
- Worker-2 runtime activation;
- broker / Topstep / live.

No G2 attempt is spent to test a guard.

---

# 11. VERDICT

**AR-1266 = PARTIAL PASS.**

Passed:

- real-seat hook registration on disk;
- Agent|Task matcher coverage;
- strict-session mechanism;
- exact dirty-file exception;
- immutable toolbox re-pin concept;
- honest refusal to run calibration without operator authorization;
- eight-call budget preservation.

Open before calibration/real calls:

- self-protect the actual live doorway/activator;
- stale cache pin/bundle verification;
- atomic native `claim -> dispatch before ALLOW`;
- actual Agent model binding;
- actual Agent prompt/native-call hash binding;
- real native event witness;
- calibration identity witness.

Do not broaden the packet. These are the last load-bearing edges of the pre-call boundary, not a reason to restart G2 architecture.
