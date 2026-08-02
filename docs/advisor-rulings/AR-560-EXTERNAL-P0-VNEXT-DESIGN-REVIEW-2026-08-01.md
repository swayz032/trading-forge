# External GPT Advisor Response — AR-556/559/560 `P0-vNext` Design

**Date:** 2026-08-01  
**Design reviewed:** `docs/designs/P0-VNEXT-DESIGN-2026-08-01.md`, commit `c26947b548365e97e8a5103344ca7c44c2d3ab7c`, blob `1f30eb07857026ec251cd591d0ae51d864f00ca3`  
**Newest report reviewed:** AR-560  
**Decision:** **REVISE. Do not authorize implementation yet. The design has the right architectural split, but three interfaces still allow a clean-looking result to outrun what was proved: caller-authored completeness scope, both-lanes-absent projection, and “correctness” over values the design admits were never checked against their citations.**

## 1. What is accepted

AR-560's two corrections are valid and do not move the design:

```text
0379d5fa  author/commit time 2026-08-01 21:45:07-04:00
  P0-vNext design review executed; +42 lines to ADVISOR-RULINGS.md

c26947b5  author/commit time 2026-08-01 21:47:18-04:00
  corrected design committed
```

Therefore AR-558's “uncommitted” statement was stale when published, and the cited `21:48` label was not the commit time. The corrected object identity is `0379d5fa`; the design blob at `c26947b5` remains the current blob.

The design's strongest decisions should remain:

- membership comes from pinned source specs, not the ledger or oracle;
- agreement, expectation comparison, and completeness are separate claims;
- every parsed object must have a closed schema;
- `NOT-APPLICABLE` creates no correctness predicate and emits a positive skip witness;
- depended-on `UNADJUDICATED` cells deny completeness;
- summary counts are recomputed from cells;
- the scratch generator becomes a committed, durable module;
- out-of-frame surfaces remain named P3 debt.

Those are the correct bones for a thin `P0-vNext` consumer.

## 2. F-1 — claim B is not correctness

The design calls claim B **CORRECTNESS** and emits `INCORRECT` when a lane differs from the frozen ledger (`P0-VNEXT-DESIGN:21`). The same design later states:

> “It does not make the `140` asserted values CORRECT against the authority document. They are frozen as observed; a correctly-cited but mis-transcribed value survives every check here.” (`:157`)

Both statements cannot hold under one meaning of “correct.” Matching an unverified transcription proves **conformance to the frozen ledger**, not correctness against the teacher/authority.

The provenance path confirms the distinction. The frozen generator reads `ORACLE.json` (`P1-P2-TRUTH-FREEZE-PACKET:375-377`) and copies `row[axis]` directly into cells classified `ASSERTED` (`:432-436`). The later ledger freeze does not erase that provenance.

Required correction:

- rename claim B to **FROZEN-LEDGER CONFORMANCE**;
- rename `INCORRECT` to `LEDGER_DIVERGENCE`;
- print `AUTHORITY_SEMANTICS_UNVERIFIED` beside every green aggregate until the 140 values are independently re-derived from their citations;
- reserve the word **correctness** for that later authority check.

This is not cosmetic. Blueprint Phase 1 may not cite ledger conformance as compiler fidelity.

## 3. F-2 — the caller still defines its own completeness denominator

The design says completeness covers **“any scope a caller asks about”** (`:22`) and prevents only **silent** narrowing by printing the requested scope (`:73`). That makes an overclaim visible to a careful reader but does not prevent it.

A caller can explicitly request:

```text
scope = []
```

or a cherry-picked subset containing no unadjudicated cells. The completeness predicate then has no unknowns and can return green exactly as designed. Printing `scope=[]` is disclosure, not enforcement. A downstream consumer checking only status still receives a false-ready signal.

Required correction:

- callers may request a **registered `scope_id`**, never supply arbitrary cell membership;
- each scope is a committed exact member set plus a digest, independent of the caller;
- unknown scope, empty unregistered scope, added member, removed member, or digest mismatch fails closed;
- every consumer must name the exact `scope_id` and digest it requires and reject a result for any other scope;
- the Phase-1 admission scope is pre-registered before implementation results exist.

The denominator must be independent of the caller for the same reason ledger membership had to be independent of the ledger.

## 4. F-3 — projection totality is a design contract, not an implementation detail

The document explicitly leaves TS/Python projection mechanics unspecified (`:160`) while claim A depends entirely on them. That is the interface most capable of recreating a diff-of-two-empty-sets false green.

The agreement contract describes one-lane absence, but does not publish a complete presence matrix. Implementation must define all four cases before code exists:

| TS | Python | required outcome |
|---|---|---|
| present | present | compare typed canonical values |
| present | absent | `DISAGREEMENT`, path and values named |
| absent | present | `DISAGREEMENT`, path and values named |
| absent | absent | **`PROJECTION_MISSING_BOTH` unless that exact cell is authority-classified `NOT-APPLICABLE`** |

For every projection, record:

- raw lane path;
- raw presence state, with `MISSING` distinct from JSON `null`;
- raw value;
- canonical type and normalized value;
- the pure transformation used for derived axes such as `primitive_null`, `reason_names`, and `reason_excludes`.

Without this contract, both lanes can emit nothing and “agree.” The extraction campaign has already paid for this law: parity over two dead lanes is vacuous.

## 5. F-4 — `ORACLE.json` is not authoritative for “nothing”

The corrected design labels `ORACLE.json` **AUTHORITATIVE FOR NOTHING** (`:92`, `:169`). That is too broad.

Measured provenance:

```text
gen_p1p2.build()
  -> reads pinned ORACLE.json
  -> row = fixtures[fixture].conditions[condition_id]
  -> cell.value = row[axis]
  -> classification = ASSERTED
```

The accurate statement is:

- `ORACLE.json` is authoritative for **no membership, requiredness, or completeness decision**;
- it is the historical source of the frozen observed values now carried by the ledger;
- the authority document is the intended semantic authority, but the 140 oracle-to-authority transcriptions remain unverified.

Calling the oracle authoritative for nothing launders its historical role and makes claim B's caption easier to overread.

## 6. Required design revision before implementation

Revise only the design document and report. No implementation yet.

The revision must add:

1. **Claim names and status model** — `AGREEMENT`, `FROZEN_LEDGER_CONFORMANCE`, `AUTHORITY_COMPLETENESS`; no umbrella PASS that lets one green borrow another's authority.
2. **Registered scope contracts** — exact set, digest, consumer-required scope identity, and no caller-authored membership.
3. **Projection contract** — typed per-axis extraction plus the four-case presence matrix above.
4. **Honest oracle provenance** — no membership authority, but historical observation-source role named.
5. **Invocation profiles and exit semantics** — an invocation declares required claims through a committed profile; any required `FAIL`, `INCOMPLETE`, unknown scope, or projection gap exits non-zero. `NOT_REQUESTED` can never be rendered as PASS.

Add these pre-registered red proofs:

- empty caller scope → RED;
- cherry-picked subset under the Phase-1 profile → RED, missing cells named;
- correct cell set under the wrong scope id/digest → RED;
- both lanes absent on a required projected cell → RED;
- one lane emits JSON `null` while the other is absent → RED, proving `null != MISSING`;
- a run with agreement and ledger conformance green but authority completeness incomplete must not emit an overall PASS;
- a report must label the 140 values `AUTHORITY_SEMANTICS_UNVERIFIED`, proving conformance is not captioned correctness.

## 7. Architecture disposition

- **AR-560 corrections:** accept.
- **P0-vNext design:** promising but **not implementation-ready**.
- **P0-vNext implementation:** remain blocked until the bounded design revision receives an external read.
- **P1/P2:** remain substantively closed; none of these findings changes their 43-row/301-cell membership.
- **Phase 1 exit:** not yet. A parity/conformance gate is necessary infrastructure, but the compiler cannot be declared faithful until at least the load-bearing asserted values for a Tier-A candidate are semantically re-derived from authority and the required scope is complete.
- **P3 / Gate B / merge / deploy / release:** unchanged hold.

## 8. Monitor correction

The 2-second local watcher was functioning: it logged AR-553 through AR-560. The external GPT failure was that the watcher only wrote a JSONL event log; after the prior response I ended the turn, and no mechanism injected those events back into the conversation. “Detected” was incorrectly treated as “received.” The monitor must be consumed by a foreground wait loop while this advisor seat is active.

> `A PRINTED SCOPE MAKES A FALSE GREEN AUDITABLE. AN INDEPENDENT SCOPE CONTRACT MAKES IT IMPOSSIBLE.`

> `CONFORMANCE TO AN UNVERIFIED TRANSCRIPTION IS NOT COMPILER CORRECTNESS.`

> `TWO ABSENT PROJECTIONS ARE NOT AGREEMENT; THEY ARE AN UNPROVEN MEASUREMENT PATH.`
