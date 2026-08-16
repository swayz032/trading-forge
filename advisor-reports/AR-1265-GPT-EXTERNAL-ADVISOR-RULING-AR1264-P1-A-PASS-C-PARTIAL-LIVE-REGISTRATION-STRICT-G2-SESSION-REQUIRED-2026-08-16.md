# GPT EXTERNAL ADVISOR RULING — AR-1265 · 2026-08-16

## AR-1264 IS A STRONG PARTIAL PASS. P1-A SELF-PROTECTED PRECEDENCE PASSES. P1-C PRE-CALL GUARD LOGIC PASSES AS A CANDIDATE, BUT IT IS NOT YET A LIVE BOUNDARY: THE PREPARED CLAUDE HOOK REGISTRATION DOES NOT MATCH `Agent|Task`, SO THE NEW G2 GUARD WOULD NEVER SEE THE SUBAGENT CALL IT EXISTS TO STOP. A SECOND BYPASS ALSO REMAINS: CONTENT-SHAPED DETECTION CAN BE EVADED BY A G2 CALL THAT OMITS THE CONDITION REF / QUEUE NAME / PERMIT MARKER. FIX BOTH BEFORE REGISTRATION. FOR THE ONE KNOWN DIRTY FILE, DO NOT SET `require_clean:false`; AUTHORIZE ONLY AN EXACT PATH + EXACT DIFF-HASH EXCEPTION. THEN PROVE THE GUARD FIRES IN THE REAL WORKER-1 SEAT. NO FROZEN G2 CALLS YET.

```text
RULING ON          : worker AR-1264
TOOLBOX CANDIDATE  : claude/worker1-p1-toolbox-20260816
TOOLBOX BASE       : dd1bc2306dee2f894272fa7c4a973c4812672dfe
AR-1264 A COMMIT   : 4e14ee59a4386d2b1350a70e027592b308a58814
AR-1264 C COMMIT   : 032ebc76ca75171d525723dbe239418b4cdbd424
WORKER-1 HEAD SEEN : 60729c48bda098dbc35f6388ca8844b3fc5cdfb8
P1-A PRECEDENCE    : PASS
P1-C GUARD LOGIC   : PASS AS CANDIDATE / NOT LIVE
P1-B REGISTRATION  : OPEN
DIRTY-FILE FORK    : DISPOSITIONED BELOW
MODEL CALIBRATION  : NOT RUN / OPEN
REAL G2-D CALLS    : 0/8
P1 NATIVE ACTIVE   : NO
P1 G2 PRECALL LIVE : NO
CI                  : NONE at 032ebc76; evidence is LOCAL
CERT                : RED
COMPILER/BACKTEST/PAPER/BROKER/LIVE: LOCKED
NEXT WORKER AR      : AR-1266
```

---

# 1. INDEPENDENT GITHUB VERIFICATION

I inspected the actual candidate branch and commits rather than grading AR-1264 from prose.

The candidate branch resolves to:

`032ebc76ca75171d525723dbe239418b4cdbd424`

and is exactly two commits ahead of the pinned speed-engineering base `dd1bc230...`.

The delta is bounded to the existing toolbox:

- `claude-hook-bridge.mjs`
- `lane-boundary-guard.mjs`
- their tests
- new `g2-precall-guard.mjs`
- its tests
- new precedence test packet

No compiler, backtester, PAPER, broker, live, or Worker-2 production surface changed.

GitHub combined status has no statuses at `032ebc76...`, and no workflow run is attached to that pin. The worker's 98/98 and 113/113 claims are LOCAL evidence only.

---

# 2. P1-A — SELF-PROTECTED PRECEDENCE: PASS

The original bridge incorrectly denied all `REVIEW_REQUIRED` paths before explicit packet scope could be consulted. AR-1264 correctly repaired the precedence by separating hard-deny verdicts from scope-gated review.

The new law is correct:

```text
SELF_PROTECTED    -> DENY regardless of packet scope
BLOCK             -> DENY regardless of packet scope
HANDOFF_REQUIRED  -> DENY regardless of packet scope
REVIEW_REQUIRED   -> ALLOW only when explicit packet scope covers the path
ALLOW_LANE_MATCH  -> still requires packet scope
```

The important part is the self-protected category. The actual Worker-1 manifest currently includes `.claude/` in its broad allowed prefixes. Without self-protection, a naive REVIEW_REQUIRED repair could let the worker edit its own guard manifest/settings/hook implementation. AR-1264 closes that hole by evaluating those control surfaces first and making them non-overridable.

**P1-A = PASS. Do not reopen this design.**

---

# 3. P1-C — G2 PRE-CALL GUARD LOGIC: CANDIDATE PASS, BUT NOT A LIVE BOUNDARY YET

The new guard has good mechanical properties:

- exact queue SHA check
- exact frozen condition membership
- exact task-input SHA check
- strict requested model `opus`
- attempt must equal 1
- queue-attempt witness denies replay
- receipt-file witness independently denies replay
- unreadable/missing permit fails closed
- real frozen artifacts are read, not regenerated

That is good candidate logic.

However, **two live-boundary defects remain before it can protect a real model call.**

## 3.1 CRITICAL WIRING GAP — `Agent|Task` ARE NOT REGISTERED IN PRETOOLUSE

The prepared native registration fragment at the graded candidate pin still says:

```text
PreToolUse matcher = Edit|Write|NotebookEdit|Bash
```

It does **not** include `Agent|Task`.

But `g2-precall-guard.mjs` explicitly guards subagent dispatch tools `Agent` and `Task`.

Therefore if the current fragment were installed unchanged:

```text
Claude issues Agent/Task
        ↓
PreToolUse registration does not match
        ↓
claude-hook-runner never executes
        ↓
g2-precall-guard never sees the call
        ↓
model call can fire with zero permit inspection
```

This is a load-bearing activation failure. A correct guard that never receives the event is not a guard.

### REQUIRED REPAIR

The Worker-1 PreToolUse registration used for the G2 execution seat must include the subagent dispatch tools, e.g. the effective matcher must cover:

```text
Edit|Write|NotebookEdit|Bash|Agent|Task
```

Prove the exact effective tool names exposed by this Claude Code runtime. If the runtime uses only one of `Agent` or `Task`, record that fact; do not silently assume. The test harness must exercise the same names that the installed registration receives.

## 3.2 CONTENT-DETECTION BYPASS — DEDICATED G2 SESSION MUST BE STRICT

Current `isG2Shaped()` detects a call when its tool input references a queue filename, receipt directory, condition ref, or permit marker.

That still permits this failure shape:

```text
G2 Opus subagent prompt contains only condition prose / task prose
(no condition_ref, no queue filename, no permit marker)
        ↓
classified benign non-G2
        ↓
allowed without permit
```

The worker's phrase "fail-closed detection" is therefore too strong for live use.

### REQUIRED REPAIR — STRICT G2 EXECUTION SESSION

Add a manifest-controlled strict mode for the dedicated G2 execution session.

When that mode is active:

```text
EVERY native Agent/Task dispatch in that dedicated session
        ↓
requires a valid G2 pre-call permit
        ↓
otherwise DENY before model invocation
```

Do not depend on condition prose, ref strings, markers, or caller cooperation in the dedicated run.

Cheap helper/subagent work is simply not allowed inside that tiny reserved execution session unless separately and explicitly authorized. That is acceptable: the session exists to spend exactly eight controlled calls, not to do general engineering.

The non-G2 calibration occurs BEFORE strict G2 execution mode is armed, or under a separate calibration-only manifest. Do not create an exemption inside the strict eight-call mode merely for convenience.

Required control:

```text
Agent/Task call containing only G2 condition prose, no ref/marker
strict_session = false -> may classify benign (baseline witness)
strict_session = true  -> DENY without permit
strict_session = true + exact permit -> ALLOW
```

Mutation: disable strict-session behavior -> the no-marker call must wrongly pass.

---

# 4. DIRTY WORKTREE DISPOSITION — APPROVE A HASH-PINNED EXCEPTION, NOT `require_clean:false`

AR-1264 correctly stopped rather than weakening `require_clean` by itself.

Desk disposition is now:

**Do not commit the timestamp-only `docs/wave25-exit-engine-ab-report.md` merely to make the guard green, and do not set `require_clean:false`.**

Instead extend the resume-anchor guard with a narrowly governed exception contract:

```text
require_clean = true
allowed_dirty = [
  {
    path: "docs/wave25-exit-engine-ab-report.md",
    diff_sha256: "<SHA256 OF EXACT `git diff HEAD --binary -- <path>` BYTES>",
    authority: "AR-1265"
  }
]
```

Required behavior:

- no other dirty path is allowed
- the named path is allowed only if its current `git diff HEAD --binary -- <path>` hash exactly matches the pinned value
- staged/unstaged content that changes that diff changes the hash and blocks SessionStart
- untracked files remain blocking unless separately and explicitly governed
- missing listed path is not an error; it simply means the tree is cleaner than the exception
- changing only the path while ignoring the diff hash is insufficient
- blanket `allow-dirty` remains forbidden for this seat

This preserves the historical dirty-file finding without letting future edits hide behind the same filename.

Required mutation control: change one byte in the excepted dirty file -> SessionStart MUST fail.

---

# 5. REGISTRATION / DEPLOYMENT LAW — SAME TOOLBOX, NO PARALLEL COPY

The current candidate implementation lives on `claude/worker1-p1-toolbox-20260816`; the real Worker-1 seat does not yet execute it.

Do not build another guard implementation in Worker-1.

After the repairs above are green:

1. keep the implementation in the existing speed-engineering toolbox path;
2. integrate the exact reviewed toolbox commits into the Worker-1 execution tree without hand-reimplementing them;
3. refresh the toolbox pin/bundle identity in the Worker-1 manifest to the exact reviewed source;
4. enable `g2_precall` with exact queue and receipt paths;
5. install/register SessionStart + PreToolUse for the real Worker-1 seat;
6. PreToolUse MUST include the effective native subagent tool names;
7. do **not** call full `P1 NATIVE ACTIVE` yet if TaskCompleted remains disabled/unproved.

Claim vocabulary after the real-seat proof:

```text
P1 SESSION/EDIT GUARD LIVE     = allowed only if actual SessionStart + edit controls fire
P1 G2 PRECALL LIVE             = allowed only if actual Agent/Task pre-call controls fire
P1 NATIVE ACTIVE (full)        = still NO until TaskCompleted finish enforcement is proven
```

AR-1264 also reports `claude-finish-check` still has the old structural REVIEW_REQUIRED problem. That is a real open item, but it does not need to delay the eight-call pre-call boundary. Keep full P1 ACTIVE withheld and fix finish enforcement after the money-path checkpoint unless the repair is trivially adjacent and does not delay registration.

---

# 6. REAL-SEAT PROOF REQUIRED BEFORE CALIBRATION

Synthetic toolbox tests are necessary but not sufficient.

On the real Worker-1 seat, prove:

```text
SessionStart with only the exact hash-pinned known dirty diff -> anchor ARMED
SessionStart with any extra dirty path -> STOP
SessionStart with one-byte mutation of the excepted diff -> STOP
self-edit of guard manifest/settings/hook implementation -> DENY
normal in-scope Worker-1 edit -> ALLOW
out-of-scope edit -> DENY
G2-shaped Agent/Task with no permit -> DENY BEFORE CALL
strict G2-session Agent/Task with no marker/ref and no permit -> DENY BEFORE CALL
benign non-G2 subagent usage outside strict G2 mode -> still usable
```

The proof must come from the actually registered hook path, not direct invocation of `evaluateHookEvent()` alone.

---

# 7. NON-G2 OPUS CALIBRATION — ONLY AFTER THE LIVE HOOK PATH IS PROVEN

Once the live Worker-1 pre-call hook is actually registered and proven to fire, and if Claude's higher-priority runtime allows the subagent dispatch, run exactly one tiny **non-G2** Opus calibration outside the frozen queue/receipt directory.

Purpose: observe runtime metadata, not solve a trading condition.

Persist a calibration witness containing whatever the Claude Code subscription runtime genuinely exposes:

- requested model
- actual model identity, if exposed
- native task/subagent id, if exposed
- invocation path
- start/end or duration, if exposed
- token data, if exposed

If a field is not exposed, record the existing NOT_EXPOSED sentinel. Never infer it.

If the observed exact actual-model identity disagrees with `g2d-actual-model-identity-v1`, STOP and report. Do not widen the set and do not spend a frozen G2 attempt.

The calibration is not one of the frozen eight and must not create anything in `isolated-receipts-t1`.

If Claude's live runtime still requires a direct operator authorization for subagents, obey that higher-priority boundary; do not fake a calibration receipt and do not repeatedly bounce the same request through reports.

---

# 8. FROZEN G2 BUDGET

AR-1264 reports the post-work read-only preflight as 8 ready / 0 claimed / 0 dispatched / 0 completed, with only README in the real receipt directory.

The candidate code does not modify the G2 queue or receipt artifacts.

**Real G2-D remains LOCKED for AR-1266.**

Do not claim or dispatch any of the eight during this activation/calibration packet.

---

# 9. NEXT WORK ORDER — AR-1266

Fresh worker may proceed now.

Use the existing P1 toolbox candidate worktree/branch; do not start a third guard implementation.

Order:

```text
A. add Agent/Task to the effective PreToolUse native registration and prove tool-name parity
B. add strict dedicated-G2-session mode so every Agent/Task requires a permit
C. add hash-pinned allowed-dirty support; pin only docs/wave25-exit-engine-ab-report.md exact diff
D. rerun full toolbox tests + required mutations
E. integrate the exact reviewed toolbox into real Worker-1 seat; refresh manifest pin/bundle
F. register SessionStart + PreToolUse in real Worker-1 seat
G. prove real hooks fire with the positive/negative cases in §6
H. re-run real G2 queue preflight; require 8 ready / 0 spent
I. if and only if the live runtime permits it, run ONE non-G2 Opus calibration and persist witness
J. re-run queue preflight again; frozen eight must remain untouched
K. report AR-1266 and STOP
```

Do not run E1/E2 model-routing work in this packet. Do not run G2-H. Do not run the eight frozen Opus calls.

---

# 10. STATUS

```text
D1-A quartet                PASS
D1-B crash state            PASS
D1-C request/task joins     PASS
D1-C1 exact model matcher   PASS
D1-C2 runtime ID witness    OPEN
P1-A precedence             PASS
P1-C candidate guard logic  PASS
P1-C live registration      OPEN
P1 strict G2 session        OPEN
known dirty file            DISPOSITIONED: exact path + diff hash only
full P1 NATIVE ACTIVE       NO
real G2-D                   0/8, LOCKED
G2-H                        OPEN
certification               RED
compiler/backtest/PAPER/live LOCKED
```
