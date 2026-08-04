# EXTERNAL READ — 2026-08-04 — CLEAN HANDOVER / LANE-33 GRADE / GATE-2 FREEZE

> **PROVENANCE:** Arrived as **OPERATOR-RELAYED CHAT**, not on
> `origin/external-advisor/gpt-rulings` (stale at `953a907c`, 2026-08-02, per `R-698`).
> Committed here VERBATIM under `R-700 §1`. Consumed by `R-717`.
> **A CHANNEL IS NOT AN AUTHOR** — adopted on merit; `R-717` records what it changes.

---

GPT EXTERNAL ADVISOR RULING — ACCEPT CLEAN HANDOVER; AUTHORIZE LANE-33 INDEPENDENT GRADE, FREEZE GATE STATUS UNTIL FRESH-SEAT REVIEW

The handover request is accepted.

Both active seats are at a valid swap point:

- Lane 33 is complete and committed.
- No implementation is in flight.
- No sub-agent result is outstanding.
- The handover notes are current.
- The worker is on an explicit hold.
- Multiple recent mistakes were detected by mechanical controls rather than by manual rereading.
- Continuing the same long-running reasoning seat now creates more risk than value.

A fresh advisor seat should take over before any additional architecture or gate decision.

LANE 33

Lane 33 is accepted as:

`DELIVERED AND DURABLE — INDEPENDENT GRADE PENDING`

The reported agreement is meaningful:

- the worker found two missing files through static code analysis;
- the grader found the same two files through observed runtime loading;
- the methods do not share the same primary measurement mechanism.

That is stronger than two searches over the same artifact.

Approved provisional conclusion:

> The two-file omission is likely correctly identified and repaired because independent static and runtime methods converge on the same members.

That conclusion is not yet the final certification of Lane 33.

INDEPENDENT GRADE AUTHORIZED

Run `accuracy-validator` against the pinned Lane-33 closing commit.

Before execution, publish:

- exact commit SHA;
- start timestamp;
- runner identity;
- expected duration;
- durable receipt path;
- files changed by Lane 33;
- pre-repair and post-repair population members;
- the two independently identified missing files.

The grader must independently verify:

1. Both missing files belong in the intended population.
2. The static derivation includes them for the correct dependency reason.
3. Runtime loading reaches them under the relevant test execution.
4. No unrelated files were added merely to match the grader.
5. Removing either file from the population makes a permanent test fail.
6. Adding an unrelated file also makes the manifest or population witness fail.
7. The repair is deterministic from a clean checkout.
8. Current-working-directory changes do not alter the result.
9. The worker's static method and the grader's runtime method are genuinely independent.
10. No shared naming, path-normalization, or import-resolution blind spot can make both methods agree incorrectly.

Required disposition:

- `PASS`
- `PASS_WITH_BOUNDED_FINDINGS`
- `FAIL`
- `UNVERIFIABLE`

GATE 2

The outside reader cannot ratify or overturn Gate 2 from this summary alone.

The packet does not contain:

- the final Gate-2 grade receipt;
- the exact Lane-33 finding;
- the advisor's complete gate-closing reasoning;
- the comparison-tool reports;
- the pinned graph transition or current gate ledger entry.

Therefore:

`GATE-2 OUTSIDE RATIFICATION — PENDING FRESH-SEAT EVIDENCE REVIEW`

Do not silently reopen Gate 2.

Do not advance Gate 3 based only on this summary.

The fresh advisor must read the committed handover file and issue one explicit disposition:

- `GATE 2 RATIFIED CLOSED`
- `GATE 2 REOPENED`
- `GATE 2 STATUS UNVERIFIABLE`

The unchanged closing rule remains controlling:

Gate 2 may be closed only when the independent result is `PASS` or `PASS_WITH_BOUNDED_FINDINGS` with no live finding involving:

- silent substitution;
- partial recognition;
- unused accepted parameters;
- flag-OFF parameter loss.

If Lane 33 concerns only regression-population completeness and does not permit one of those four parameter failures, its bounded repair does not automatically require Gate 2 to reopen.

If either missing file contains a test capable of exposing one of those four categories, Gate 2 must remain conditional until the Lane-33 grade passes.

COMPARISON TOOL

Both comparison-tool reports remain on HOLD.

Do not use that tool as:

- breakthrough evidence;
- compiler-conformance evidence;
- Gate-2 evidence;
- a trade-fidelity oracle;
- or a promotion decision.

The fresh advisor must determine separately:

1. What question the plan expects the tool to answer.
2. What values the implementation actually compares.
3. Whether it compares trades, decisions, condition traces, configuration, or aggregate metrics.
4. A controlled case where the expected and actual questions produce different answers.
5. Whether the mismatch can create a false pass.
6. Whether the mismatch can create a false failure.
7. Which production or qualification stage consumes its result.

Two reports about the same tool should be reconciled by inputs, computation, and outputs—not by which report sounds more persuasive.

SAFETY-CHECK FALSE POSITIVE

The stale-number incident is recorded as another crude-text-search failure.

A four-digit substring inside a hash must not be treated as the numeric state the guard intends to prohibit.

The repair must preserve fail-closed behavior for a real stale number while distinguishing:

- standalone numeric fields;
- structured identifiers;
- hashes;
- quoted historical evidence;
- unrelated prose.

A broad substring search is not an acceptable final implementation for a safety-critical ledger guard.

SEAT-HANDOVER REQUIREMENT

The outgoing advisor should leave exactly one canonical handover artifact containing:

- current gate states;
- pinned commits;
- newest accepted AR and ruling IDs;
- Lane-33 grade status;
- four queued decisions;
- active holds;
- forbidden work;
- known hung or unmeasured surfaces;
- exact next command for the independent grade.

The fresh advisor should read that artifact before issuing any new implementation ruling.

Do not continue Gate 3, producer work, sealed-spec work, parity work, or comparison-tool integration during the seat transition.

CURRENT AUTHORIZED STATE

- Worker: HOLD
- Lane 33: delivered; independent grade authorized
- Gate 2: preserve current ledger status; outside ratification pending
- Gate 3: not authorized by this packet
- Comparison tool: hold pending contract review
- Advisor seat: hand over now

The correct next move is not more implementation. It is a clean context reset, an independent Lane-33 grade, and one fresh-seat ruling that resolves the four queued questions from committed evidence rather than accumulated session memory.
