# External Advisor Ruling — P0 Redesign Packet Grade Failure

**Date:** 2026-07-31  
**Ruling:** R-520  
**Decision:** **GRADE FAILURE ACCEPTED. AUTHORIZE EXACTLY THREE DOCUMENT EDITS. IMPLEMENTATION REMAINS ON HOLD.**

The independent grade found a real design defect:

- the packet rejects an unknown/misspelled expectation key;
- it does not require a known expectation key to be present;
- therefore deleting a valid expectation can silently remove a check and still permit green.

This is the same false-green family at a smaller mutation radius. The grade earned the pre-build gate.

## Authorized edits — document only

Edit `docs/designs/P0-REDESIGN-PACKET-2026-07-31.md` in exactly these three places:

1. **Schema contract**
   - Replace “known keys are typed” with a total presence contract.
   - For every expectation object, the schema must distinguish:
     - required key;
     - explicitly optional key with declared absence semantics;
     - forbidden/unknown key.
   - A missing required expectation must be fatal.
   - No expectation may disappear through optional-property syntax alone.

2. **Pre-registered red paths**
   - Add a scored mutation: delete one known required expectation key from a real fixture → RED, non-zero exit, named missing key.
   - Retain the existing unknown-key, wrong-type, deleted-relationship, and clean-control cases.
   - The deletion mutation must be smaller than the original defect and must fail before any TS/Python plan comparison can mask it.

3. **Acceptance / abort contract**
   - Add an explicit abort condition: if requiredness is inferred from field presence in the same oracle being validated, the design is self-authorizing and must not be implemented.
   - Required-vs-optional membership must come from the frozen schema contract, not from whichever keys happen to exist in `ORACLE.json`.

## Required regrade

After the three edits:

- commit and publish the amended packet;
- run the same independent grader once against the new commit;
- the grader must specifically test deletion of a known required key;
- implementation may begin only on `PASS`.

This is a correction of the design document, not a second redesign loop and not an implementation attempt.

## Authorization state

- Three packet edits: **AUTHORIZED**
- Code changes: **FORBIDDEN**
- P0 implementation: **HOLD**
- Regrade after edits: **REQUIRED ONCE**
- Fifth patch to `c304b098`: **FORBIDDEN**
- P1 / P2 / P3 / Gate B: **NOT AUTHORIZED**
- Merge / deploy / release: **HOLD**

## Control rules

> `A CLOSED KEY SET STOPS TYPOS; A REQUIRED KEY SET STOPS DISAPPEARANCE.`

> `OPTIONAL IN THE TYPE SYSTEM MUST NOT MEAN OPTIONAL IN THE TRADING CLAIM.`

> `THE SCHEMA MUST SAY WHAT MAY BE ABSENT BEFORE THE ORACLE SHOWS WHAT IS PRESENT.`

> `FINDING THIS ON PAPER SAVED THE ONLY BUILD ATTEMPT.`
