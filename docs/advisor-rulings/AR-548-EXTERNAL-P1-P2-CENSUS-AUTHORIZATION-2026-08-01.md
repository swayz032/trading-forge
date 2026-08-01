# External Advisor Ruling — P1/P2 Truth Freeze

**Date:** 2026-08-01  
**Ruling:** R-521  
**Object:** `c80c8df7f06eba8a925fe678b5320251967189c2`  
**Decision:** **P1/P2 DELIVERY ACCEPTED FOR INDEPENDENT CENSUS. RUN ONE CENSUS NOW. DO NOT INVENT ANSWERS FOR THE 43 UNDECLARED CELLS.**

## 1. Delivery accepted as a real advance

The delivery establishes the missing authority shape that six P0 attempts lacked:

- `12` fixtures;
- `30` row identities;
- `7` frozen expectation axes;
- `210` total cell identities;
- `140 ASSERTED`;
- `9 NOT-APPLICABLE`;
- `61 UNADJUDICATED`;
- `43` absent and declared nowhere;
- `3` cells joined through the explicit `primitive` → `primitive_null` alias;
- zero guessed cells;
- deterministic serialization;
- clean-control plus duplicate/unknown/deleted-cell red proofs.

The two summaries are consistent:

- `70` cells are absent from the sparse oracle;
- of those, `9` are classified `NOT-APPLICABLE` and `61` remain `UNADJUDICATED`;
- within the `61`, `43` have no declaration anywhere.

## 2. The desk does not adjudicate the 43 by intuition

The worker states that closing the 43 is a desk authority act. That is too broad.

The desk may rule process and evidence requirements. It may not manufacture trading truth where the authority is silent.

Therefore:

- the `43` remain `UNADJUDICATED`;
- no blanket authority amendment is authorized;
- no cell may be promoted to `ASSERTED` or `NOT-APPLICABLE` without named source authority;
- unresolved cells are an honest result, not a defect to hide.

> `UNKNOWN IS A VALID TRUTH STATE. INVENTED CERTAINTY IS NOT.`

## 3. Independent census authorized now

Dispatch exactly one independent `accuracy-validator` census against commit `c80c8df7` and write a durable receipt:

`docs/designs/GRADE-P1-P2-TRUTH-FREEZE-2026-08-01.md`

The census must independently re-derive rather than trust packet captions.

### Required checks

1. Recompute the `30 × 7 = 210` Cartesian membership from frozen row identities and frozen axes.
2. Verify exactly one cell per identity and exactly one state per cell.
3. Recompute `140 / 9 / 61` and the `43` undeclared subset.
4. Recompute the strict-join alternative count `46` and verify the exact three alias-dependent cells.
5. Verify all `140 ASSERTED` cells correspond to fields actually present in the pinned oracle blob.
6. Verify every `NOT-APPLICABLE` cell is one of the nine and is supported by the cited authority text; do not accept a summary sentence as the authority.
7. Verify every non-undeclared `UNADJUDICATED` cell has the exact cited row or fixture declaration.
8. Verify no `ASSERTED` operand is vacuous where a value is meant to discriminate, including empty or generic `reason_names` operands.
9. Re-run determinism from the embedded generator source and confirm byte identity and declared digests.
10. Re-run the independent verifier on clean, duplicate, unknown, and deleted-cell cases; require final summary and exit status.
11. Verify the axis list and expected Cartesian set are not derived from the ledger or sparse oracle under test.
12. Verify the packet and ledger blobs published at `c80c8df7` are the exact objects graded.

## 4. Valid census outcomes

### PASS — SOUND ENUMERATED MEMBERSHIP WITH DECLARED UNKNOWNS

This closes P1 and P2 as a versioned truth ledger. It does **not** convert the 61 unknown cells into known truth.

### FAIL — NAMED MEMBERSHIP OR AUTHORITY DEFECT

Return the smallest artifact-level correction. No code implementation begins.

### UNRESOLVED AUTHORITY

Preserve the affected cells as `UNADJUDICATED`; do not fail the ledger merely because the source truth is unavailable. Fail only if the ledger misrepresents that uncertainty.

## 5. Breakthrough path after census PASS

A PASS authorizes the next ruling to design **P0-vNext** as a thin total-ledger consumer:

- TS/Python agreement is checked for every projected cell;
- correctness is checked only for `ASSERTED` cells;
- `NOT-APPLICABLE` cells must produce no assertion and no accidental predicate;
- `UNADJUDICATED` cells force a named `INCOMPLETE_AUTHORITY` / fail-closed status, never a correctness green;
- deleting any ledger cell, projection cell, or assertion must turn the gate red by exact set equality.

This means the campaign does **not** need to invent answers for all 43 before engineering can continue. It needs to preserve them honestly and refuse any completeness claim that depends on them.

## 6. State

- P1/P2 artifacts: **DELIVERED, PENDING ONE INDEPENDENT CENSUS**
- Independent census: **AUTHORIZED NOW**
- 43 undeclared cells: **REMAIN UNADJUDICATED**
- Blanket authority amendment: **NOT AUTHORIZED**
- P0-vNext implementation: **NOT YET AUTHORIZED**
- P0-vNext design after census PASS: **NEXT STEP**
- P3 / Gate B / merge / deploy / release: **HOLD**

> `THE LEDGER DOES NOT NEED TO KNOW EVERYTHING. IT MUST KNOW EXACTLY WHAT IT DOES NOT KNOW.`
