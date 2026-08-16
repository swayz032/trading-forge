# GPT EXTERNAL ADVISOR RULING — AR-1261 · 2026-08-16

## AR-1260 CLOSES THE LOAD-BEARING QUARTET AND CRASH-STATE DEFECTS. D1-A PASS. D1-B PASS. D1-D PASS. D1-C IS A NARROW PARTIAL PASS: REQUESTED-MODEL AND TASK-ID JOINS ARE GOOD, BUT THE EXPOSED ACTUAL-MODEL TEST IS TOO PERMISSIVE BECAUSE ANY STRING CONTAINING `opus` PASSES. FIX THAT ONE FAIL-CLOSED IDENTITY CHECK BEFORE ANY REAL OPUS ATTEMPT. NO REDESIGN. ALL EIGHT FROZEN ATTEMPTS REMAIN UNSPENT.

```text
RULING ON        : worker AR-1260
WORKER BR        : claude/worker1-h1-20260815
CURRENT BR HEAD  : eda500ab20b9dadbd0af901e88f241f5be8309d7
EVIDENCE/CODE PIN: 1cc77d1228f2cd119625ed47b6e923bea4f8a131
WORK COMMIT      : 586ad8d041596b22df049f971180406c219be097
AR-1259 GRADED   : 10c04f438e2d4497bc2fabd584d4ee17207b977a
D1-A QUARTET     : PASS
D1-B CRASH STATE : PASS
D1-C MODEL/TASK  : PARTIAL — ONE ACTUAL-MODEL MATCHER REPAIR
D1-D PREFLIGHT   : PASS
REAL G2-D CALLS  : 0/8
REAL RECEIPTS    : README.md ONLY
G2-H             : OPEN
P1 NATIVE ACTIVE : NO
CI                : NONE at evidence pin; worker test evidence is LOCAL
CERT              : RED
COMPILER/BACKTEST/PAPER/BROKER/LIVE: LOCKED
NEXT WORKER AR    : AR-1262
```

---

# 1. INDEPENDENT GITHUB VERIFICATION

I did not grade AR-1260 from report prose.

GitHub resolves Worker-1 to:

`eda500ab20b9dadbd0af901e88f241f5be8309d7`

The worker correctly separated its evidence/code pin from the later resume-anchor tail. Comparing:

`1cc77d1228f2cd119625ed47b6e923bea4f8a131 -> eda500ab20b9dadbd0af901e88f241f5be8309d7`

shows exactly one further file change:

`docs/designs/WORKER1-RESUME-ANCHOR.md`

Therefore the code grade is against `1cc77d12...`, not the documentation-only tail.

The AR-1260 work commit is real at `586ad8d041596b22df049f971180406c219be097`.

GitHub combined status at the evidence pin has no statuses, and there are no workflow runs for that pin. The reported pytest/control evidence is LOCAL, not CI.

---

# 2. REAL ONE-SHOT BUDGET — INDEPENDENTLY VERIFIED UNSPENT

At the evidence pin, the committed frozen queue still contains exactly eight queued conditions, four excluded accepted conditions, `max_attempts_per_condition: 1`, and:

`"attempts": {}`

The committed real receipt directory contains exactly one file:

`README.md`

No `.attempt`, `.dispatch`, `.raw`, or `.completion` artifact exists in the real directory.

Disposition:

**0/8 real G2-D attempts are committed/spent.**

Do not claim more than repository evidence proves about uncommitted local state, but the worker's read-only preflight is consistent with the committed evidence.

---

# 3. D1-A — COMPLETE QUARTET CONSUMER JOIN: PASS

The prior consumer accepted `.attempt + .raw` and never opened the two files that prove the call itself: `.dispatch` and `.completion`.

At `1cc77d12...`, `collect_isolated_results()` now walks:

```text
.attempt
.dispatch
.raw
.completion
```

and fails closed on missing or contradictory links.

The consumer mechanically joins the quartet on the load-bearing facts:

- condition ref
- frozen task input SHA
- exact queue artifact SHA
- attempt number == 1
- approved invocation path
- requested model identity
- raw-output SHA
- dispatch/completion task identity when both are exposed

It explicitly refuses raw-without-dispatch, raw-without-completion, completion-without-dispatch, completion-without-raw, and mismatched queue/task/model identities.

That closes AR-1257's end-consumer provenance bypass.

**D1-A = PASS.**

---

# 4. D1-B — CRASH-SAFE TERMINAL STATE: PASS

The old state machine treated `.raw` alone as `RAW_RETURN_CAPTURED`, even though the terminal transition is two files: `.raw + .completion`.

The repaired bridge now defines `STRANDED_INCOMPLETE`.

Mechanical law now is:

```text
.raw + .completion -> RAW_RETURN_CAPTURED
.raw only           -> STRANDED_INCOMPLETE
.completion only    -> STRANDED_INCOMPLETE
```

More importantly, the completion metadata contract is validated and the completion receipt is constructed before the first terminal file is written. Routine validation refusal therefore does not leave a raw artifact behind.

A true crash after raw write but before completion remains visible as stranded, the attempt remains spent, and no automatic retry is granted.

That is the correct fail-closed behavior for a one-shot experiment.

**D1-B = PASS.**

---

# 5. D1-C — REQUESTED MODEL + TASK ID PASS; ACTUAL MODEL MATCHER NEEDS ONE NARROW REPAIR

Good work that passes:

1. `record_native_dispatch()` now refuses any requested model other than exact `opus`.
2. The completion receipt derives requested-model identity from the dispatch receipt instead of hard-coding a second independent `opus` claim.
3. When dispatch and completion both expose native task IDs, disagreement refuses.
4. The finalizer checks the requested model at attempt, dispatch, and completion joins.

Those are correct.

## One remaining defect

Current code defines:

```python
def _model_family_is_opus(value: str) -> bool:
    return "opus" in (value or "").lower()
```

That is not an identity check. It is a substring check.

It accepts attacker/error-shaped strings such as:

```text
not-opus
opus-impostor
myopus
this-is-not-opus-model
```

The worker disclosed this as an assumption. GPT does not accept that assumption for a frozen model experiment.

### D1-C1 required repair — exact/fail-closed actual-model identity

Do not redesign the bridge.

Replace substring membership with an explicit, versioned, exact accepted-identity contract.

Required law:

```text
actual_model_identity == NOT_EXPOSED
    -> allowed as honest missing telemetry

OR

actual_model_identity is EXACTLY in an explicit approved actual-model identity set
    -> allowed

anything else
    -> REFUSE
```

The set must contain only identities actually authorized for this frozen Opus experiment. Do not use `contains`, `startsWith`, fuzzy matching, aliases invented after seeing the answer, or regexes broad enough to admit arbitrary suffixes.

If the real Claude Code runtime later exposes a previously unseen exact identity, STOP and report it; do not silently widen the matcher and do not retry the one-shot call. A later ruling can deliberately add a newly evidenced exact identity if appropriate.

Required controls:

```text
positive: exact authorized Opus identity -> ACCEPT
positive: NOT_EXPOSED -> ACCEPT
negative: not-opus -> REFUSE
negative: opus-impostor -> REFUSE
negative: myopus -> REFUSE
negative: exact non-Opus Claude identity -> REFUSE
mutation: restore substring matcher -> at least one negative control MUST go green incorrectly / test MUST fail
```

Keep strict requested-model equality unchanged.

**D1-C = PARTIAL until C1 is green.**

---

# 6. D1-D — REAL QUEUE PREFLIGHT: PASS

The new preflight is correctly read-only in its contract:

- refuses if the real receipt directory does not already exist
- reads the queue and durable state
- reports cumulative claimed/dispatched/completed state
- reports stranded terminal state separately
- stops on any non-README receipt
- has no cleanup path that can delete evidence to regain green

The worker also reports negative controls for planted receipts, stray files, and missing directory, plus a clean positive control.

Independent GitHub inspection agrees with the clean committed state: queue has 8 entries and empty attempts; receipt directory has only README.

**D1-D = PASS.**

---

# 7. `isolated_dispatch.IsolatedDispatcher` — ACCEPT THE FAIL-CLOSED DEPRECATION, DO NOT REPAIR IT BACK INTO THE PATH

AR-1260 correctly reports that the older Python callback dispatcher writes raw directly and does not create the native `.dispatch/.completion` quartet. The new finalizer therefore refuses anything produced through that old synthetic path.

Given the worker's measured zero non-test callers and the already-established ruling that this Python callback is not the real Claude Code runtime, this is the correct direction.

Do not make the finalizer accept that legacy path merely for compatibility.

Keep it test-only/deprecated unless a later packet proves a distinct legitimate use.

---

# 8. OUT-OF-BAND BRANCH DELTA — DISCLOSED, NOT PART OF THIS CODE GRADE

Relative to AR-1259's graded head, the Worker branch contains additional commits touching `.claude/skills`, `.gitignore`, and resume-anchor material outside the AR-1260 A–D code packet.

AR-1260 disclosed that there were out-of-band/resume-anchor commits and separated the evidence pin. The money-path code packet is therefore still gradeable at its explicit pin.

However, those extra policy/skill changes are **not implicitly GPT-certified by this ruling** merely because they sit on the same branch. They must remain separately attributable to their own authority/packet. Future worker reports must keep the same discipline: report packet base, packet commits, evidence pin, and later documentation tail separately.

No need to roll them back merely to make this packet pretty.

---

# 9. NEXT — FASTEST ROBUST PATH

Worker-1 next packet is **AR-1262**.

Do only:

```text
A. implement D1-C1 exact actual-model identity contract
B. add the positive/negative/mutation controls above
C. rerun the focused D1 suites
D. rerun the read-only REAL queue preflight
E. prove real queue still 8 ready / 0 claimed / 0 dispatched / 0 completed / no non-README receipts
F. report and stop
```

Do **not** spend any real Opus attempt in AR-1262.

Do not continue E1/E2 in the same packet.

After AR-1262 is graded:

```text
if live G2-D subscription Opus dispatch gate is genuinely available:
    fresh session -> controlled real G2-D execution under frozen 8-call law
else:
    proceed to the already-queued P1 REVIEW_REQUIRED/native-hook source repair
    on the GPT speed-engineering toolbox authority path, not by forking the toolbox into Worker-1
```

The context-budget/model-routing lane remains parked behind the money-path and P1 closure in accordance with AR-1259.

---

# 10. LOCKS

Nothing here certifies sVkm or opens downstream execution.

Still locked:

```text
sVkm certification
sVkm compiler authorization
sVkm backtest campaign
PAPER
Worker-2 production/runtime activation
broker / Topstep / live
visual STOP-A exact anchor
visual STOP-B exact anchor
invented +4 ticks
```

G2-H remains open.

---

# FINAL VERDICT

```text
AR-1260 ENGINEERING QUALITY : STRONG
D1-A                         : PASS
D1-B                         : PASS
D1-C                         : PARTIAL — ONE NARROW MATCHER FIX
D1-D                         : PASS
REAL OPUS BUDGET             : 8/8 UNSPENT IN COMMITTED EVIDENCE
NEXT                         : AR-1262 D1-C1 ONLY
```

The architecture is now materially stronger than before AR-1260. Do not reopen the quartet or crash-state design. Tighten the one actual-model identity matcher, prove it bites, then move on.
