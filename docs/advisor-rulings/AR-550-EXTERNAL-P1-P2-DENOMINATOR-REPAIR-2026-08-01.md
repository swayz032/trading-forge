# External Advisor Ruling — P1/P2 Census Failure

**Date:** 2026-08-01  
**Ruling:** R-523  
**Object:** census receipt `7677393933750a82f10aa193b221c985eb4b66ab`; desk confirmation `047d60e2fe14011a24e60546b5b22ac18a27cc03`  
**Decision:** **FAIL ACCEPTED. AUTHORIZE ONE BOUNDED P1/P2 ARTIFACT REPAIR AND ONE RE-CENSUS. P0-vNext REMAINS BLOCKED.**

## 1. What survived

The independent census could not break any of the `210` published cells:

- `140 / 9 / 61` reconciles exactly;
- the `43` undeclared cells are real and honestly represented;
- the strict-name count `46` and the three alias cells are correct;
- all `140 ASSERTED` values match the pinned oracle on their exact joins;
- zero cells were guessed;
- generation is byte-deterministic;
- the advertised cell-level duplicate, unknown, and deletion mutations discriminate.

Those results stand. The repair must preserve all existing `210` cells byte-for-byte in semantic content and keep the `43` undeclared cells exactly `43`.

## 2. The census failure is binding

The completeness denominator is wrong:

- real entry-condition membership across the twelve pinned fixture specs: `43` rows;
- ledger membership: `30` rows;
- omitted membership: `13` declared rows;
- omitted cells: `13 × 7 = 91`;
- corrected condition-axis universe: `43 × 7 = 301` cells.

All thirteen omitted rows are in `00-control-shipped.spec.json`. The oracle names them through `conditions_unadjudicated_ids`, but the generator selected rows only from `fixtures[].conditions`, so absence removed each row from the universe that was supposed to detect absence.

> `A FROZEN AXIS SET WITH A PRESENCE-DERIVED ROW SET IS STILL SELF-AUTHORIZING.`

## 3. The proposed three-line union is necessary but not sufficient

Adding:

```python
_present = set(...conditions.keys())
_declared = set(...conditions_unadjudicated_ids)
for cid in sorted(_present | _declared):
```

correctly restores the thirteen rows in today’s artifact. It does **not**, by itself, establish an independent row universe: both sets still live in the oracle being checked. A self-consistent deletion of a row from both locations would shrink the universe again.

The repaired design must therefore derive or freeze the row universe independently from the sparse expectation surface.

## 4. Authorized repair — exactly four obligations

Update only:

- `docs/designs/P1-P2-TRUTH-FREEZE-PACKET-2026-07-31.md`
- `docs/designs/P1-P2-TOTAL-MEMBERSHIP-2026-07-31.json`
- the worker report entry.

No engine, runtime, extraction, corpus, database, migration, HOLDOUT-26, P0-vNext, P3, or Gate B code.

### A. Independent row universe

Freeze the `43` condition-row identities from the twelve pinned **source fixture specs** at `c304b098`, using:

`fixture filename × spec.entry_conditions[].id`.

The oracle’s `conditions` keys and `conditions_unadjudicated_ids` may be compared against this universe, but neither may define it.

Publish:

- the exact 43-row manifest;
- its deterministic digest;
- present-in-oracle rows: `30`;
- declared-absent rows: `13`;
- unresolved/unexpected row identities in both directions.

Regenerate the ledger to `301` cells. The new `91` cells must be `UNADJUDICATED` with basis `fixture-declared-id` or an equally explicit source-fixture basis. Do not fabricate assertions for them.

Expected state after this repair, unless evidence disproves it:

- `ASSERTED 140`;
- `NOT-APPLICABLE 9`;
- `UNADJUDICATED 152`;
- `UNDECLARED 43` unchanged;
- `301` total cells;
- zero existing semantic cells altered or lost.

### B. Declare the completeness frame

Correct every unbounded “complete truth membership” caption to state precisely:

> complete over the pinned **entry-condition × seven-axis** frame.

The following fixture-level surfaces are explicitly outside this ledger’s frame and remain unenumerated here:

- `compiled`;
- `spine_bound`;
- `spine_total`;
- `reasons_must_differ_from`;
- `scalars_unadjudicated`;
- other fixture-level scalar or relational expectations.

This is a scope declaration, not permission to delete those truths. Record them as a named downstream surface for P0-vNext/P3 design.

### C. Make the verifier independent of the ledger’s denominator

The verifier may not compute its expected product from `ledger.P1.row_ids` and `ledger.P2.axes` alone.

It must independently reconstruct or receive:

- the frozen 43-row manifest from pinned source fixtures;
- the frozen seven-axis contract from code/packet constants independent of the ledger under test.

It must turn all of these RED:

1. delete one cell;
2. delete one complete row plus its seven cells and repair ledger counts/digests;
3. delete one complete axis plus its cells and repair ledger counts/digests;
4. add an unknown row or axis;
5. duplicate a cell.

Require a clean unmodified control, final summary, and exit status.

### D. Protect ledger content, not only membership

Verify the canonical full-document digest from an independently canonicalized representation, excluding only the digest field itself. Also reject duplicate JSON keys in the ledger before normal parsing.

This must make the following mutations RED:

- change `UNADJUDICATED` to `ASSERTED`;
- change `NOT-APPLICABLE` to `ASSERTED`;
- forge `basis` or `declared_reason`;
- null or empty an asserted discriminating value;
- remove declaration reasons;
- erase the `primitive` → `primitive_null` alias disclosure;
- inject a duplicate JSON key.

After the pinned census is complete, fill the nine previously disclosed missing in-ledger authority citations during this regeneration. Cite the exact authority location; do not invent new authority.

## 5. Re-census contract

After the repaired artifacts are committed and published, run exactly one fresh independent census. It must independently verify:

- `43 × 7 = 301` from pinned source fixtures and frozen axes;
- exact `140 / 9 / 152` reconciliation, or publish the evidence-backed corrected distribution;
- `43` undeclared remains unchanged;
- all original 210 semantic cells are unchanged;
- the thirteen restored rows and ninety-one cells are present and honestly unknown;
- fixture-level scope is explicitly bounded;
- row-, axis-, cell-, and content-level mutations all discriminate;
- generation and verification use pinned inputs only.

Valid outcomes:

- `PASS — SOUND CONDITION-AXIS MEMBERSHIP WITH DECLARED UNKNOWNS`;
- `FAIL — NAMED MEMBERSHIP/VERIFIER DEFECT`;
- `UNRESOLVED AUTHORITY`, preserving affected cells as unknown.

## 6. State

- Current P1/P2 pin `c80c8df7`: **FAIL — DENOMINATOR UNSOUND**
- Current 210 cells: **CONTENT FINDINGS PRESERVED**
- 43 undeclared cells: **REMAIN UNADJUDICATED**
- Bounded artifact repair: **AUTHORIZED ONCE**
- Fresh re-census after repair: **REQUIRED ONCE**
- P0-vNext design/implementation: **HOLD**
- P3 / Gate B / merge / deploy / release: **HOLD**

> `THE UNIVERSE USED TO DETECT MISSING MEMBERS MAY NOT BE DEFINED BY THE MEMBERS THAT HAPPEN TO BE PRESENT.`

> `FIX THE DENOMINATOR AND THE INDEPENDENT CHECKER TOGETHER; OTHERWISE THE SAME FALSE GREEN MOVES ONE FILE OVER.`
