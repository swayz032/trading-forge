# External Advisor Ruling — P0 Redesign Packet

**Date:** 2026-07-31  
**Ruling:** R-518  
**Scope:** `P0-REDESIGN-PACKET-2026-07-31.md` / local commit `7134bb34`  
**Decision:** **DO NOT IMPLEMENT P0 YET. PUBLISH THE PACKET, THEN RUN EXACTLY ONE INDEPENDENT PRE-IMPLEMENTATION DESIGN GRADE.**

## 1. Publication gate

The GitHub remote does not currently resolve commit `7134bb34`, and `docs/designs/P0-REDESIGN-PACKET-2026-07-31.md` is not present on remote branch `h1-wave4-sealed12-driver`.

Therefore:

- the packet is **LOCALLY COMMITTED, NOT REMOTELY VERIFIED**;
- no external reader may certify its exact contents yet;
- no implementation authorization exists from this ruling.

Publish the exact commit without rewriting it. The external read must grade the object that the implementing worker will receive.

## 2. Pre-build grade is required

The worker offered an optional design grade before implementation. It is **REQUIRED**.

Reason:

- the retired P0 mechanism consumed four implementations and three independent rejections;
- the replacement is allowed one implementation attempt;
- finding an architectural false green in a document is cheaper than finding it after another code delivery;
- this is not green ceremony because the grade decides whether implementation may start.

This is one bounded architecture grade, not a new review loop.

## 3. Grade contract

The independent grader must answer only these questions against the published packet and the cited `c304b098` grade evidence:

1. **Closed schema:** Can an unknown expectation key, missing required key, or extra key pass silently?
2. **Runtime types:** Can a wrong-type value such as `reason_null: "true"` survive parsing or truthiness conversion?
3. **Total semantics:** Can any expectation be satisfied by absence, skip, unresolved lookup, or a missing fixture rather than affirmative verification?
4. **Relationship integrity:** Does deleting or corrupting `reasons_must_differ_from` necessarily make the planned gate red?
5. **Pre-registered red paths:** Does the packet require, before implementation:
   - unknown key → RED;
   - wrong type → RED;
   - deleted relationship → RED;
   - clean unmutated control → GREEN?
6. **Next granularity:** Is the redesign more than a fifth field-validation patch under a new name? It must state the next lower semantic granularity it protects or explicitly refuse the redesign as insufficient.
7. **Authority independence:** Are expectations frozen independently from both TS and Python outputs, rather than copied from either implementation?
8. **Population totality:** Are all authored fixture conditions either adjudicated or explicitly named unadjudicated, with no present-or-skip path?
9. **Scope control:** Is the implementation limited to the packet’s named files, with shared-tree protection measured as a delta from a recorded start baseline rather than an impossible absolute-clean requirement?
10. **Executable completion signal:** Does the planned acceptance require the full run’s exit code and final summary, not grepped presence of expected intermediate lines?

## 4. Grade outcomes

Only three outcomes are valid:

### PASS

The packet closes all known oracle-side false-green paths and specifies executable proof sharply enough to authorize one implementation attempt.

### FAIL — NAMED DESIGN DEFECT

Do not implement. Return the exact defect and the smallest document-level correction to the advisor. No automatic redesign loop is authorized.

### NO SOUND REDESIGN AVAILABLE / UNRESOLVED SOURCE AMBIGUITY

Accept this as an expert result. Do not work around it, relax the gate, infer missing authority, or build a partial mechanism and caption it complete.

## 5. Accepted provisional elements

Subject to remote confirmation, these reported design choices are directionally accepted:

- strict closed-key expectation parsing;
- runtime type validation rather than TypeScript casts over `JSON.parse`;
- absence never satisfying a positive expectation;
- explicit unadjudicated membership rather than silent skips;
- pre-registered mechanism mutations plus a clean control;
- baseline-delta shared-tree protection;
- one implementation attempt followed by one independent adversarial implementation grade.

The worker’s correction from absolute tree cleanliness to a recorded baseline delta is accepted in principle:

> `A GUARD THAT IS ALREADY RED CANNOT DISCRIMINATE.`

## 6. Authorization state

- Packet publication: **REQUIRED**
- Independent packet grade: **AUTHORIZED / REQUIRED**
- P0 implementation: **HOLD**
- Fifth patch to `c304b098`: **FORBIDDEN**
- New redesign implementation after packet PASS: **ONE ATTEMPT ONLY**
- Post-implementation independent grade: **REQUIRED ONCE**
- P1 / P2 freeze: **NOT STARTED**
- P3 ruling: **NOT STARTED**
- Gate B implementation: **NOT AUTHORIZED**
- Merge / deploy / release: **HOLD**

## Control rules

> `GRADE THE ARCHITECTURE BEFORE SPENDING THE ONLY BUILD ATTEMPT.`

> `A LOCAL COMMIT IS NOT AN EXTERNAL-READ OBJECT UNTIL THE REMOTE CAN NAME IT.`

> `THE REDESIGN MUST REMOVE THE FALSE-GREEN MECHANISM, NOT VALIDATE MORE FIELDS INSIDE IT.`

> `A GREP FOR EXPECTED LINES IS NOT PROOF THAT THE RUN FINISHED.`
