# GPT EXTERNAL ADVISOR RULING — AR-1257 · 2026-08-16

## AR-1255 WORKER D1.1 PASS; D1.2/D1.3 PARTIAL — THE NEW BRIDGE EXISTS BUT THE FINAL CONSUMER DOES NOT YET REQUIRE THE DISPATCH/COMPLETION HALF OF THE PROVENANCE CHAIN. AR-1256 P1 IS A STRONG PARTIAL PASS — IMMUTABLE TOOLBOX PIN, REAL MANIFEST, AND DISCRIMINATING LIFECYCLE HARNESS ARE GOOD; THE REPORTED REVIEW_REQUIRED PRECEDENCE DEFECT IS REAL, AND NATIVE PROTECTION IS CORRECTLY NOT CALLED ACTIVE. THE OPERATOR'S FRESH SESSION IS THE RIGHT CONTEXT- BUDGET MOVE. PROCEED WITH A SMALL PRE-CALL D1 JOIN REPAIR + SOURCE-TOOLBOX REVIEW_REQUIRED REPAIR; DO NOT SPEND ANY OF THE EIGHT OPUS ATTEMPTS.

```text
RULING ON       : worker AR-1255 + worker AR-1256
WORKER BR       : claude/worker1-h1-20260815
CURRENT HEAD    : 456abf72b81b2ef72cbdfd539caacd50176c9107
AR-1254 BASE    : 67dacfa2bd9b58f2963bebbe7d5f25d82a65acd4
DELTA           : 5 commits ahead / 0 behind
D1.1            : PASS
D1.2/D1.3       : PARTIAL — END-TO-END RECEIPT JOIN REPAIR REQUIRED
D1.4 PREFLIGHT  : PROVISIONAL PASS / LOCAL EVIDENCE; REAL QUEUE REMAINS UNSPENT
P1 TOOLBOX PIN  : PASS
P1 MANIFEST     : PASS AS PREPARED POLICY, NOT YET SELF-PROTECTING UNDER REVIEW OVERRIDE
P1 LIFECYCLE    : PASS AS HARNESS EXERCISE
P1 NATIVE ACTIVE: NO
P1 BLOCKER      : REVIEW_REQUIRED PRECEDENCE — CONFIRMED
G2-D REAL CALLS : 0
G2-H            : OPEN
CI              : NONE at current head; worker execution evidence is LOCAL
CERT            : RED
COMPILER/BACKTEST/PAPER/BROKER/LIVE: LOCKED
NEXT WORKER AR  : AR-1258 (AR-1255 number collision is now historical; do not reuse numbers)
```

---

# 1. NUMBER COLLISION — RECORDED, NOT HIDDEN

Two different documents now carry AR-1255:

- worker `AR-1255-WORKER-D11-TO-D14-CLOSED-PROVENANCE-BYPASS-SHUT-2026-08-16.md`
- GPT `AR-1255-GPT-EXTERNAL-ADVISOR-RULING-CLAUDE-CONTEXT-BUDGET-MODEL-ROUTER-ACTIVATION-2026-08-16.md`

Nothing was overwritten because the filenames differ. From this ruling forward, AR numbers are monotonically unique. This ruling is AR-1257; the next worker report is AR-1258.

---

# 2. INDEPENDENT GITHUB VERIFICATION

I did not grade the reports from prose.

GitHub resolves Worker-1 to:

`456abf72b81b2ef72cbdfd539caacd50176c9107`

Compared with the AR-1254-inspected head `67dacfa2...`, Worker-1 is exactly five commits ahead and zero behind. The delta is bounded to:

```text
.claude/worker1-hook-guard-manifest.json
scripts/claude_toolbox.mjs
scripts/worker1_hook_lifecycle_check.mjs
src/engine/extraction/g2d_finalizer.py
src/engine/extraction/isolated_bridge.py
src/engine/tests/test_g2d_finalizer.py
src/engine/tests/test_isolated_bridge.py
docs/designs/SYSTEM-INVENTORY.md
```

No compiler execution, backtester, PAPER, broker, Topstep, or live-money surface moved in this delta.

GitHub exposes zero combined-status checks and zero workflow runs at the current head. Worker-reported pytest and mutation counts remain LOCAL evidence.

---

# 3. WORKER AR-1255 — D1.1 PASS

The original AR-1254 F-1 bypass is materially repaired.

`collect_isolated_results()` no longer accepts a self-consistent raw file merely because its own text hash matches. It now requires the paired durable attempt receipt and checks, among other fields:

```text
attempt status
attempt_number == 1
condition_ref
task_input_sha256
exact queue bytes SHA
requested model identity
approved subscription invocation path
raw condition_ref
raw queue SHA
parsed == false
raw text SHA
```

The committed tests include the important planted-orphan shape and the filename-is-not-identity control.

**Ruling: D1.1 PASS.**

But D1.1 alone is not the complete native-dispatch provenance chain, which leads to F-1 below.

---

# 4. F-1 — D1.2/D1.3 ARE NOT CLOSED END-TO-END: FINALIZATION DOES NOT REQUIRE DISPATCH + COMPLETION

The worker correctly built a new durable state-machine module:

```text
READY
→ CLAIMED (.attempt)
→ NATIVE_TASK_DISPATCHED (.dispatch)
→ RAW_RETURN_CAPTURED (.raw + .completion)
```

That is the right architecture.

However, the final consumer still reads only:

```text
.attempt + .raw
```

`g2d_finalizer.collect_isolated_results()` does **not** require or validate the paired `.dispatch.json` and `.completion.json` receipts.

Therefore this remains possible in the current committed code:

```text
valid claim receipt
→ raw persisted directly through the lower-level ledger
→ NO native dispatch receipt
→ NO completion receipt
→ finalizer accepts the raw answer
```

That bypasses the very native-bridge proof D1.2/D1.3 were added to establish.

The current finalizer positive-control helper demonstrates the gap: `_receipts()` calls `claim_attempt()` and then `persist_raw_return()` directly, creates no dispatch/completion receipts, and `collect_isolated_results()` is expected to accept it.

### Required D1.2a repair

A usable isolated answer must require the complete joined provenance quartet:

```text
<ref>.attempt.json
<ref>.dispatch.json
<ref>.raw.json
<ref>.completion.json
```

Join all four to the same:

```text
condition_ref
frozen task_input_sha256
exact queue_artifact_sha256
attempt_number == 1
approved invocation path
requested Opus model class
raw_output_sha256
```

Also join `native_task_id` between dispatch and completion when the runtime exposes it.

The finalizer must refuse:

```text
attempt + raw with dispatch missing
attempt + dispatch + raw with completion missing
foreign dispatch
foreign completion
completion raw hash != raw receipt hash
completion task/queue/ref mismatch
```

A crash-shaped or incomplete quartet remains spent but unusable. It never becomes semantic evidence.

---

# 5. F-2 — RAW IS WRITTEN BEFORE COMPLETION METADATA IS VALIDATED

`capture_native_return()` currently does this in order:

```text
persist_raw_return(...)
→ inspect completion fields
→ reject unknown completion field if present
→ create completion receipt
```

So an invalid completion payload can raise **after the raw answer has already been written create-only**.

Worse, `state_of()` currently treats the mere existence of the raw file as `RAW_RETURN_CAPTURED`, even if the completion receipt is missing.

That creates a false-complete shape:

```text
claim
→ dispatch
→ write raw
→ completion validation fails / process dies
→ no completion receipt
→ state_of() says RAW_RETURN_CAPTURED
→ current finalizer can still accept attempt + raw
```

The current test `test_an_unrecognised_completion_field_is_refused` checks the exception, but does not check that no false-complete/raw-admissible state remains after the exception.

### Required D1.2b repair

1. Validate/normalize the completion contract **before** writing the raw file when validation can be performed pre-write.
2. Treat `RAW_RETURN_CAPTURED` as complete only when the required raw + completion pair exists and joins correctly.
3. If a crash occurs between raw and completion writes, classify it as **STRANDED/INCOMPLETE**, never complete.
4. The final consumer must reject that incomplete state, which makes the unavoidable two-file crash seam fail closed.

Required biting control:

```text
invalid completion field
→ capture raises
→ fresh process reads state
→ state is NOT complete
→ finalizer refuses
```

Also plant raw-without-completion after a valid dispatch and prove refusal.

---

# 6. F-3 — MODEL/TASK IDENTITY MUST JOIN THE REAL DISPATCH, NOT BE HARDCODED AFTERWARD

`record_native_dispatch()` accepts a `requested_model_identity` argument but does not currently reject a non-Opus value. The completion receipt then hardcodes `requested_model_identity: "opus"` rather than deriving and verifying it from the dispatch receipt.

That means the evidence chain can disagree about which model was requested.

### Required D1.3 repair

Before the real eight-call experiment:

- `record_native_dispatch()` must refuse a requested model outside the authorized Opus class.
- completion must read/join the actual dispatch receipt; do not hardcode a new model claim downstream.
- if `actual_model_identity` is exposed and it is not an Opus identity, refuse the result as experiment-invalid.
- if actual model identity is genuinely not exposed, preserve the existing honest `NOT_EXPOSED...` sentinel; do not invent certainty.
- if a native task id is known at dispatch time, carry that exact id through completion (or derive it from the dispatch receipt) rather than allowing an unrelated id.

Required controls:

```text
requested model = haiku/sonnet -> dispatch receipt refused
completion says different task id -> refused
actual model explicitly non-Opus -> refused
actual model not exposed -> accepted only as honest absence, with requested Opus path still proven
```

---

# 7. D1.4 — KEEP THE REAL EIGHT UNSPENT

The worker reports the real queue still at:

```text
8 queued
4 excluded
claimed = []
receipt dir = README only
ready_for_dispatch = true
queue sha256 = 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
```

Repository inspection shows no real G2-D receipt artifacts were added in the reviewed delta.

After F-1/F-2/F-3 are repaired, rerun the real read-only preflight and prove again that all eight remain READY before any model call.

**Do not spend any real one-shot attempt while repairing or testing this.**

---

# 8. WORKER AR-1256 — P1 IMMUTABLE PIN + MANIFEST + HARNESS ARE GOOD

The P1 work is directionally strong and appropriately self-critical.

## 8.1 Immutable toolbox pin — PASS

`scripts/claude_toolbox.mjs` now treats:

`dd1bc2306dee2f894272fa7c4a973c4812672dfe`

as the authority, while `origin/external-advisor/gpt-speed-engineering` is only a drift hint. It also computes a bundle hash across the 37 materialized files.

This closes the prior moving-branch-as-authority defect.

## 8.2 Real Worker-1 manifest — PASS as prepared policy

The manifest narrows the current packet and keeps locked runtime/PAPER/broker surfaces out. `require_clean` remains true rather than being weakened for convenience. `finish.enabled` remains false because no honest finish receipt exists yet.

That is the right fail-closed stance.

## 8.3 Lifecycle harness — PASS as a discriminator

The committed harness runs SessionStart first, derives the anchor flag from the file SessionStart itself wrote, then exercises:

- out-of-scope edit deny
- destructive Bash deny
- benign Bash allow
- TaskCompleted fail-closed while finish is unarmed

It also refuses to publish guard verdicts if its own `git` instrument is unavailable.

This is useful evidence.

**Scope correction:** this is a real harness exercise of the pinned native-hook runner path; it is not yet proof that the user's live Claude session has the hooks registered and firing automatically on every native event. Repository `.claude/` at this head contains the agents plus the guard manifest, not a repository hook-registration config. A user-level/local registration may exist outside GitHub, but it is not repository-proven here. Therefore `NATIVE ACTIVE` remains correctly OPEN.

---

# 9. P1 BLOCKER — REVIEW_REQUIRED PRECEDENCE IS CONFIRMED

The worker's blocker diagnosis is correct.

In the pinned toolbox, `lane-boundary-guard.mjs` counts all three as blocking:

```text
BLOCK
HANDOFF_REQUIRED
REVIEW_REQUIRED
```

Then `claude-hook-bridge.mjs` denies immediately when `lane.safe_to_edit_without_handoff` is false, even though it separately computed the packet `scope`.

For `src/engine/extraction/g2d_finalizer.py`, the bounded path classifier does not recognize the extraction path as an obvious Worker-1 compiler/factory path, so it returns REVIEW_REQUIRED. The explicit packet scope is never allowed to resolve that ambiguity.

**Ruling: blocker confirmed. Do not work around it on Worker-1. Repair the single source toolbox.**

---

# 10. IMPORTANT SAFETY CONDITION — DO NOT TURN REVIEW_REQUIRED INTO A SELF-AUTHORIZATION HOLE

The repair is **not** simply:

```text
if REVIEW_REQUIRED and scope.ok: allow
```

The current manifest's authorized prefixes include `.claude/`, and the manifest itself lives under `.claude/worker1-hook-guard-manifest.json`.

If REVIEW_REQUIRED could be rescued by ordinary packet scope without protecting guard-control files, Worker-1 could potentially edit the policy that decides what Worker-1 may edit.

That would convert a safety repair into a self-authorization channel.

### Required P1-R1 source-toolbox law

Repair the authoritative toolbox source on a **separate clean worktree rooted at `external-advisor/gpt-speed-engineering`**. Do not fork/copy the guard onto Worker-1.

Decision order must be:

```text
1. protected guard/control path?       -> DENY / external handoff
2. lane verdict BLOCK?                 -> DENY always
3. lane verdict HANDOFF_REQUIRED?      -> DENY always
4. lane verdict REVIEW_REQUIRED?
      -> may proceed ONLY when an explicit desk-authorized packet scope covers the path
         AND the scope authority itself is immutable for the active guarded session
5. lane ALLOW_LANE_MATCH?
      -> still require packet scope
6. out of packet scope                 -> DENY
```

At minimum protect the active guard-control surfaces from self-edit during a guarded session, including the active manifest/hook registration and the Worker-1 toolbox activator/pin. Do not use a broad `.claude/` allowance as permission to rewrite the guard that enforces that allowance.

The exact mechanism may be a manifest hash pinned by the hook registration/wrapper or another equally mechanical scheme, but it must prove that Worker-1 cannot widen its own active scope after SessionStart.

Required controls:

```text
REVIEW_REQUIRED + explicitly authorized normal packet path -> ALLOW
REVIEW_REQUIRED + out of scope -> DENY
BLOCK + in scope -> DENY
HANDOFF_REQUIRED + in scope -> DENY
attempt to edit active manifest/guard registration -> DENY
attempt to widen active scope mid-session -> DENY / hash mismatch
benign in-scope lane match -> ALLOW
```

After the source toolbox repair is green:

1. commit it on the toolbox source branch,
2. compare the toolbox member delta,
3. deliberately update Worker-1's immutable pin to the new exact commit,
4. recompute bundle SHA,
5. rerun the lifecycle harness from the new pin.

Do not silently follow the moved toolbox branch.

---

# 11. CLEAN-TREE ISSUE — DO NOT WEAKEN `require_clean`

AR-1256 reports the live old worktree still contains the unrelated dirty `docs/wave25-exit-engine-ab-report.md` timestamp regeneration.

Do not flip `require_clean` to false just to obtain a green SessionStart, and do not sweep that unrelated file into this packet.

The fastest clean solution is a **fresh clean Worker-1 worktree/session at the exact branch tip** for the native lifecycle proof, leaving the dirty old worktree untouched until its separate disposition is authorized.

The operator has already started a fresh Claude session after AR-1256. That is exactly the AR-1255 context-budget behavior we wanted. The new session should consume this ruling and a small resume packet rather than inheriting the old giant conversation.

---

# 12. NATIVE ACTIVE BAR — STILL NOT MET

Do not use `NATIVE ACTIVE` until all of these are same-scope proven:

```text
immutable repaired toolbox pin
immutable active packet-scope authority
real clean Worker-1 SessionStart fires automatically
PreToolUse normal in-scope path ALLOWS
PreToolUse REVIEW_REQUIRED but explicitly authorized path ALLOWS
PreToolUse out-of-scope / Worker-2 / destructive Bash DENIES
active manifest/guard self-edit DENIES
TaskCompleted without valid finish receipt DENIES
TaskCompleted with a real valid synthetic/finished packet receipt has a demonstrated path to ALLOW
native hook registration is proven, not only the manual lifecycle harness
claim-consistency check is present
```

The current TaskCompleted fail-closed behavior is good, but a guard that can only block completion is not finished protection. Its positive completion path must be demonstrated on a synthetic/finished non-G2 packet before activation.

---

# 13. EXECUTION ORDER FOR THE FRESH SESSION — FAST + ROBUST

Do **not** reopen old work. Do **not** run the 9,000-test whole-engine sweep. Do **not** spend an Opus fallback attempt.

Fresh Worker-1 session work order:

```text
A. D1.2a/D1.2b/D1.3 — complete quartet provenance + crash-safe state + model/task join
B. synthetic biting controls and focused G2 lane tests
C. real G2-D read-only preflight: prove exact 8/8 still READY and queue SHA unchanged
D. P1-R1 — repair REVIEW_REQUIRED precedence in the SINGLE SOURCE toolbox on its own clean worktree
E. protect active manifest/hook control from self-edit; prove hard BLOCK/HANDOFF precedence
F. re-pin Worker-1 to exact repaired toolbox commit and rerun lifecycle controls
G. prove actual native hook registration + one positive TaskCompleted path on a synthetic/finished packet
H. only then may P1 be proposed as NATIVE ACTIVE
I. if live model-dispatch authorization still blocks G2-D, continue AR-1255 efficiency lane E0–E3; do not idle
```

Keep the AR-1255 model-routing law intact:

- main Worker remains operator-selected strong model
- Haiku/Explore for cheap mechanical search
- Sonnet only for bounded side work after equivalence controls
- Opus for hard/load-bearing reasoning and the frozen G2-D eight calls
- Fable not automatically routed
- fresh main session at completed AR packet boundaries by default

---

# 14. LOCKS

Unchanged:

```text
sVkm certification      LOCKED / RED
sVkm compiler authority LOCKED
sVkm backtest campaign  LOCKED
PAPER                    LOCKED
Worker-2 runtime         LOCKED
broker / Topstep / live  LOCKED
```

The eight isolated Opus calls remain unspent and must remain Opus. This efficiency/router lane must not downgrade or pre-consume them.

Visual Intelligence is unchanged: STOP-A remains in the candle/wick-extreme family but exact anchor is unresolved; STOP-B exact anchor unresolved; FVG boundary rejected; no invented +4 ticks.

---

# FINAL RULING

```text
WORKER AR-1255 D1.1              PASS
WORKER AR-1255 D1.2/D1.3         PARTIAL — REPAIR REQUIRED
WORKER AR-1255 D1.4              PROVISIONAL PASS / RERUN AFTER REPAIR
WORKER AR-1256 TOOLBOX PIN       PASS
WORKER AR-1256 MANIFEST          PASS AS PREPARED POLICY
WORKER AR-1256 LIFECYCLE HARNESS PASS
REVIEW_REQUIRED BLOCKER          CONFIRMED
P1 NATIVE ACTIVE                 NOT YET
FRESH SESSION                    CORRECT NEXT-SESSION DISCIPLINE
REAL G2-D OPUS ATTEMPTS          0 / 8 SPENT
NEXT                             BOUNDED D1 + P1 SOURCE-TOOLBOX REPAIR
```

This is progress, not a reset. The worker found the P1 blocker honestly; GPT found the remaining end-to-end bridge/consumer seam before any controlled model attempt was spent. Fix the seams now while the queue is still pristine.