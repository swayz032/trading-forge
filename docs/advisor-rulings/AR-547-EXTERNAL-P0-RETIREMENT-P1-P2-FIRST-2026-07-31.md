# External Advisor Ruling — P0 Final Stop and Critical-Path Inversion

**Date:** 2026-07-31  
**Ruling:** R-520  
**Scope:** second and final P0 redesign grade at `615d2d755afbc9df6224346f233f34196135766d`  
**Decision:** **THE STOP FIRES. NO SEVENTH P0 ATTEMPT. P0 IS RETIRED AS A STANDALONE FIRST STEP. AUTHORIZE P1 + P2 FIRST.**

## 1. Regrade accepted

The second and final redesign grade is accepted as **FAIL — NAMED DESIGN DEFECT**.

The decisive independently reproduced facts are:

- `30` oracle rows across `12` fixtures;
- `7` expectation axes;
- live presence counts:
  - `bindable 29`;
  - `reason_null 29`;
  - `primitive_null 26`;
  - `session_zone 26`;
  - `approximation 22`;
  - `reason_names 4`;
  - `reason_excludes 4`;
- `140` live expectations total;
- the proposed required-set rule has exactly one viable non-empty instantiation, `{bindable}`;
- that instantiation protects `29` expectations and leaves `111` live expectations silently deletable;
- `reason_names: ""` remains a vacuous, well-typed false green;
- the expectation-key namespace and gap-name namespace are not identical.

The pre-committed stop is binding. No third packet round and no seventh combined code/document attempt is authorized.

## 2. Engineering diagnosis

This is not evidence that parity is impossible.

It is evidence that the dependency order was wrong.

P0 attempted to answer:

> “Did an expected truth disappear?”

while its authority was a sparse optional object in which omission can mean either:

- intentionally not applicable;
- honestly unadjudicated;
- accidentally deleted.

No parser, closed-key rule, type checker, or mutation suite can infer which meaning an omission had after the fact.

**The missing component is not another P0 validator. The missing component is a complete truth-membership authority. That is P2.**

P1 provides the frozen observed baseline. P2 defines the complete intended membership. Only after both exist can a parity/correctness gate distinguish deletion from intentional absence without guessing.

> `P0 CANNOT PROVE COMPLETENESS BEFORE P2 DEFINES COMPLETENESS.`

## 3. Critical-path inversion

The prior order:

1. P0 parity correction;
2. grade P0;
3. freeze P1 + P2;

is retired.

The operative order is now:

1. **P1 — freeze the additive observed baseline.**
2. **P2 — freeze complete typed truth membership.**
3. **P0-vNext — derive the parity/correctness gate mechanically from P1/P2.**
4. **P3 — rule producer proof, runtime integration, and transfer receipt.**
5. **Gate B and the source-keyed treatment sweep.**

This is a dependency correction, not a bypass. P0 remains required before compiler promotion, but it no longer blocks starting P1/P2.

## 4. Authorized next task — P1/P2 truth freeze

Authorize one bounded worker task producing exactly:

- `docs/designs/P1-P2-TRUTH-FREEZE-PACKET-2026-07-31.md`
- `docs/designs/P1-P2-TOTAL-MEMBERSHIP-2026-07-31.json`
- the worker report entry.

No implementation code, engine code, runtime code, migrations, database writes, extraction changes, corpus changes, or HOLDOUT-26 use.

### P1 — observed baseline

Freeze the current object without claiming it correct:

- exact source commit and blob identities;
- all `12` fixture identities;
- all `30` row identities;
- all `140` currently present expectations;
- per-axis presence counts `29 / 29 / 26 / 26 / 22 / 4 / 4`;
- deterministic content digest;
- duplicate and unresolved identity census.

P1 answers only:

> “What exists now?”

It must not convert current presence into intended truth.

### P2 — total truth membership

Represent the complete Cartesian membership:

`30 rows × 7 expectation axes = 210 cells`.

Every cell must exist exactly once and carry exactly one explicit state:

- `ASSERT` — with a typed, non-vacuous expected value and authority;
- `NOT_APPLICABLE` — with an authority-backed reason;
- `UNADJUDICATED` — with a named missing authority/reason.

**Omission is not a state.**

The ledger must reconcile:

- `210` total cells;
- `140` currently asserted/live expectations;
- `70` cells explicitly classified as `NOT_APPLICABLE` or `UNADJUDICATED` after evidence review;
- zero missing cells;
- zero duplicate cells;
- zero unknown states.

Do not force the `140/70` split if evidence shows a currently present expectation is invalid or a currently absent expectation should be asserted. In that case publish the measured correction and reconciliation rather than preserving the old count. The `210` total is the invariant; the state distribution is evidence-dependent.

### Identity contract

Each cell key must be stable and explicit:

`fixture identity × row identity × expectation axis`.

Where the fixture is source-backed, include the source-video/transcript/span authority. Where it is synthetic, label it `INSTRUMENT_CONTROL` and use the frozen fixture blob plus row identity. Do not invent source provenance for synthetic controls.

### Typed assertion contract

Use axis-specific assertion types rather than one open bag of optional fields. At minimum:

- booleans remain booleans;
- nullable assertions distinguish `EXPECT_NULL` from absence;
- `reason_names` and `reason_excludes` require non-empty, non-vacuous operands;
- relationship assertions name both endpoints and cannot default to an empty collection;
- gap names and expectation axes are joined through one explicit versioned mapping, never token coincidence.

## 5. Acceptance gates for the freeze

The packet is acceptable only if it proves:

1. `210` unique cell keys are enumerated mechanically.
2. Every cell has exactly one state.
3. No state is inferred from key absence.
4. P1 observation and P2 intended truth are separate objects.
5. Every `ASSERT` has a non-vacuous typed predicate.
6. Every `NOT_APPLICABLE` and `UNADJUDICATED` entry has a named authority/reason.
7. Deleting any cell changes membership and must be mechanically detectable by exact set equality.
8. Adding an unknown cell or duplicating a cell is mechanically detectable.
9. The ledger is deterministic across repeated generation/serialization.
10. The final summary and exit status are checked, not grepped intermediate lines.

If the source authority cannot determine a cell, preserve `UNADJUDICATED`. Do not guess merely to make the matrix complete.

## 6. P0-vNext boundary

No P0-vNext implementation is authorized in this ruling.

After P1/P2 freeze and one independent membership census, P0-vNext may be designed as a thin consumer that checks two distinct claims:

- **agreement:** TS and Python projections agree;
- **correctness:** both projections satisfy the independently frozen P2 assertion ledger.

P0-vNext must not infer requiredness from the sparse legacy `ORACLE.json`. It must consume the total ledger.

The legacy `c304b098` design remains preserved as NOT-SOUND evidence and is not patched.

## 7. Project state

- P0 legacy design: **RETIRED / NOT-SOUND**
- P0 redesign lane: **CLOSED — NO SOUND STANDALONE REDESIGN**
- P1: **AUTHORIZED TO FREEZE**
- P2: **AUTHORIZED TO FREEZE**
- P0-vNext: **BLOCKED ON P1/P2**
- P3: **NOT STARTED**
- Gate B: **BLOCKED**
- HOLDOUT-26: **UNTOUCHED**
- Merge / deploy / release: **HOLD**

## Control laws

> `A SPARSE OBJECT CANNOT PROVE THAT AN OMITTED TRUTH WAS DELETED.`

> `COMPLETENESS MUST BE AN ENUMERATED MEMBERSHIP SET, NOT AN INFERENCE FROM PRESENCE.`

> `OBSERVED BASELINE AND INTENDED TRUTH ARE DIFFERENT OBJECTS.`

> `THE RIGHT RESPONSE TO SIX FAILED P0 ATTEMPTS IS NOT A SEVENTH VALIDATOR; IT IS TO BUILD THE AUTHORITY P0 WAS MISSING.`
