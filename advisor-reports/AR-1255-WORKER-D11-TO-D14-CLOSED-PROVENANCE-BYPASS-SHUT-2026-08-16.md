# AR-1255 — WORKER · D1.1–D1.4 CLOSED. THE PROVENANCE BYPASS WAS REAL AND IS SHUT · 2026-08-16

```text
AR-1255
RULING : AR-1254 §7 — D1.1 (provenance join), D1.2 (native bridge), D1.3 (invocation metadata),
         D1.4 (rerun controls + real read-only preflight). All four, before any real attempt.
PIN    : branch claude/worker1-h1-20260815
         D1.1      78b273a8
         D1.2/D1.3 3610c998
         head      143954bd (SYSTEM-INVENTORY regenerate for the pre-push gate)
         base      67dacfa2 (the head AR-1254 inspected)
CHANGED: src/engine/extraction/g2d_finalizer.py        (provenance join)
         src/engine/tests/test_g2d_finalizer.py        (32 tests)
         src/engine/extraction/isolated_bridge.py      (new)
         src/engine/tests/test_isolated_bridge.py      (new, 16 tests)
         docs/designs/SYSTEM-INVENTORY.md              (regenerated)
         Queue NOT regenerated. ZERO attempts claimed. Receipt dir still holds only its README.
```

## 1. F-1 CONFIRMED — AND IT WAS A REAL BYPASS, NOT A STYLE POINT

You are right, and I want to state the defect at full strength rather than soften it. The old
`collect_isolated_results` found `<ref>.raw.json`, recomputed `sha256(raw_output)`, and accepted
the file when it matched its own recorded hash. **That proves only that the file agrees with
itself.** A planted orphan with the correct filename and a correctly recomputed hash was accepted.

★ **The durable ledger can be perfect and still be bypassed downstream by a consumer that accepts
an orphan.** D0.1 and D1 were sound; the hole was that nothing downstream demanded they had been
used. **A file that agrees with itself is not provenance — the join key is the attempt receipt.**

A raw return is now admissible only as one half of a matched pair, with **both halves joined to
the exact frozen queue BYTES** — never to the filename, which is attacker-chosen and was the only
thing the old code trusted:

```text
ATTEMPT: status == ATTEMPT_CLAIMED_BEFORE_INVOCATION · attempt_number == 1 · condition_ref
         · task_input_sha256 == that entry's frozen value · queue_artifact_sha256 == sha256(queue
         bytes) · requested_model_identity == opus · invocation_path ∈ approved subscription set
RAW    : condition_ref · queue_artifact_sha256 == the same queue SHA · parsed == false
         · sha256(raw_output) == raw_output_sha256
```

Loading through `DurableAttemptLedger` re-verifies law version, substitution-rule hash and the
pinned 64-hex identities, so **the join key is itself verified rather than assumed.**

Raw-without-attempt **refuses**. Attempt-without-raw is crash-shaped: it yields no result, and
finalization then refuses the whole set rather than grading eleven of twelve.

**Your required mutation, run:** removing the paired-attempt requirement makes the mutant accept
the planted orphan and reddens the two orphan tests; the repaired code rejects it.

## 2. F-2 — THE CALLBACK IS NOT THE RUNTIME, SO THE HANDOFF IS NOW DURABLE

You are right that `Invoker` proves the ordering only inside a Python call boundary. The subagent
dispatch is performed by the agent, not by a Python function, so the callback cannot literally
*be* the live invocation — and a loose human sequence would reintroduce exactly the seam this
packet exists to remove. **A seam a human has to remember is the retry loop with extra steps.**

```text
READY  ->  CLAIMED  ->  NATIVE_TASK_DISPATCHED  ->  RAW_RETURN_CAPTURED
         .attempt       .dispatch                   .raw + .completion
```

Every transition is create-only and **the state is the filesystem**. Every transition refuses
without its predecessor: a dispatch with no claim is an unbudgeted call and cannot even be
*recorded*; a capture with no dispatch is text for a call that was never issued. Second dispatch
and second capture are both refused **across a restart** — every test reads state back through a
FRESH ledger, so each assertion crosses a simulated process boundary. An API-paid path is refused
outright.

Your six §4 facts are now answerable from the directory alone, by anyone, after the fact.

**The module cannot dispatch anything** — no `subprocess`, `requests`, `httpx`, `urllib` or vendor
SDK — checked behaviourally and at runtime on the emitted receipt rather than by grepping source
text, since a source assertion passes on a comment.

## 3. F-3 — INVOCATION METADATA, WITH HONEST ABSENCE

Fixed field contract: `actual_model_identity · native_task_id · invocation_started_at ·
invocation_ended_at · input_tokens · output_tokens`. Anything the runtime does not surface is
recorded as `NOT_EXPOSED_BY_CLAUDE_CODE_SUBSCRIPTION_RUNTIME` — never invented, never a blocking
wait. An **unrecognised** field is refused, because a fixed contract is what lets a reader tell
*absent* from *never asked for*.

**Determinism fence honoured:** timestamps and tokens live in the completion receipt (evidence)
and are asserted **absent** from the raw/semantic artifact, so identical semantic reruns stay
byte-identical.

## 4. D1.4 — THE PRE-CALL PROOF, READ-ONLY, ON THE REAL ARTIFACTS

```text
queue_count            : 8
excluded_count         : 4
claimed                : []
crash_shaped           : []
unclaimed              : 8
all 8 bridge states    : READY
queue bytes sha256     : 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
substitution rule sha  : 6fc9af3587be490430e3b9c0c169aed8a2ab2f833f342999d5c8bd23ac5e57f6
  == queue's recorded  : True
receipt dir non-README : []
ready_for_dispatch     : True
```

The eight refs, in committed order, unchanged:

```text
entry_sequence[0].rationale  REFUSED_RELEVANCE               3f43ec665f18
entry_sequence[1].action     HELD_DUPLICATE_ROLE_AMBIGUITY   01d44c2dcd03
entry_sequence[1].rationale  REFUSED_RELEVANCE               154a24d1a9ae
entry_sequence[2].action     REFUSED_RELEVANCE               389d94a9d97d
entry_sequence[2].rationale  REFUSED_RELEVANCE               f8ec398d88c5
entry_sequence[3].rationale  REFUSED_RELEVANCE               37884f7b6199
confluences[0].description   RED_SOURCE_FIDELITY             22373bdfab54
confluences[1].description   HELD_DUPLICATE_ROLE_AMBIGUITY   a0f8a7e028d3
```

**No real attempt was claimed during any of these repairs or tests**, as §7 required.

## 5. CONTROLS

```text
$ pytest <12 G2 lane suites>                    -> 243 passed
```

Provenance mutations (D1.1):

```text
UNMUTATED                              32 passed
paired-attempt requirement removed      2 failed, 30 passed   <- your required mutation
attempt queue SHA not joined            1 failed, 31 passed
raw queue SHA not joined                1 failed, 31 passed
task hash not joined                    1 failed, 31 passed
model identity not checked              1 failed, 31 passed
invocation path not checked             1 failed, 31 passed
RESTORED                               32 passed
```

Bridge mutations (D1.2/D1.3):

```text
UNMUTATED                              16 passed
dispatch without a claim allowed        1 failed, 15 passed
second dispatch allowed                 1 failed, 15 passed
capture without dispatch allowed        1 failed, 15 passed
API-paid path allowed                   1 failed, 15 passed
missing telemetry invented as 0         2 failed, 14 passed
unrecognised completion field accepted  1 failed, 15 passed
RESTORED                               16 passed
```

All byte-snapshot, hash-verified restore, files verified clean against the commit afterwards.

## 6. YOUR §13 RELIABILITY CORRECTION — ACCEPTED

`D1 AND EFG DETERMINISTIC PACKET COMPLETE` outran the evidence. The body was scoped honestly but
**the headline is what travels**, and I have been convicted on exactly that before. This report's
headline claims only what §7 asked for and nothing about the real run.

## 7. SCOPE — WHAT IS STILL NOT PROVEN

- **Zero Opus calls. Zero attempts claimed. Zero raw returns.** The bridge has never carried a
  real dispatch and the finalizer has never consumed a real isolated result.
- G2-F has emitted no real artifact; the version namespace is prepared, nothing more.
- The bridge records that a dispatch happened; it cannot prove one *did* until a real run writes
  those receipts. It is evidence machinery, not evidence.
- All LOCAL. No CI at this SHA.

```text
STATUS : WAITING_LIVE_RUNTIME_AUTH_FOR_MODEL_DISPATCH — unchanged, not re-litigated, not re-asked.
GRADER : not dispatched. GPT is the grader.
STOP   : none fired on D1.1–D1.4.
NEXT   : per §10, D1.1–D1.4 are closed and the gate is still shut, so I am taking the bounded
         native-protection activation packet rather than idling — exact packet scope, immutable
         toolbox pin, SessionStart / PreToolUse / Bash / TaskCompleted guards, real Worker-1
         manifest, native red/green controls, claim-consistency check. It will NOT be called
         ACTIVE until the real hook lifecycle has been exercised at the same scope, and it will
         not touch compiler/backtester/PAPER/live surfaces.
```
