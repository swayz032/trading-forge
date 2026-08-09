# EXTERNAL READ — 2026-08-09 — CORRECTED STEP 2 VERIFIED ON GITHUB; **STEP 3 IS RELEASED**

> **PROVENANCE:** **OPERATOR-RELAYED CHAT**, 2026-08-09, after the desk pushed `8a640850`.
> **CONSUMED BY `R-730`** — banner written BY that ruling, IN its commit (`R-722 §1`).
>
> ⭐ **THE CONDITIONAL RELEASE WAS EVALUATED BY THE READER, NOT BY THE DESK.** `R-729 §4` refused to
> tick the reader's own `10`-item checklist on the ground that **this desk is the beneficiary of the
> release** (`auto-unblock`). **The reader then verified it independently on the remote.** ★★★ **That
> is what a conditional authorization is supposed to look like, and it is the first time this campaign
> has run one end-to-end without the beneficiary grading it.**
>
> 🛑 **TWO ITEMS IN HERE ARE EASY TO MISS AND BOTH BITE `STEP 3`:** the **trigger-vs-definition
> discrimination** and the **CENSUS CONTROL TRANSITION** — the byte-identity census join the worker
> just built **must legitimately break** when `STEP 3` lands, and must be replaced by an exact-delta
> control BEFORE it does. See `R-730 §2`/`§3`.
> **A CHANNEL IS NOT AN AUTHOR** — audited on merit.

---

GPT EXTERNAL ADVISOR RULING — CORRECTED STEP 2 VERIFIED ON GITHUB; STEP 3 IS RELEASED

REMOTE VERIFICATION

Verified commit:

`8a6408500a4b5f251743c8cbe688cda1b0036aa9`

The commit contains only:

- `docs/designs/AGENT-REPORTS.md`
- `src/engine/tests/test_opening_range_conformance.py`

The remote test now genuinely runs:

frozen extraction JSON
→ `produce_spec_artifact()`
→ produced condition graph
→ `compile_binding_plan()`
→ primitive and output contract

The census is comparison evidence only. The skipped control is gone, the permissive field loophole is gone, and the neighboring genuine structure condition remains protected.

VERDICT

B1 STEP 2: ACCEPTED.

Expected result:

`3 failed · 7 passed`

Those three failures correctly prove:

1. production misclassifies the opening-range definition;
2. production routes it to the structure evaluator;
3. production has no typed opening-range output contract.

STEP 3: AUTHORIZED.

STEP 3 CONTRACT

Create the precise typed opening-range representation.

It must preserve:

- `09:30` Eastern session start;
- taught durations `5`, `15`, and `30`;
- timezone;
- market/source scope;
- trading-day rule;
- source provenance;
- high, low, width, midpoint, completion and window status.

Requirements:

- no default duration;
- no silent choice between `5/15/30`;
- no futures portability claim;
- no breakout-trigger decision;
- no adapter or evaluator implementation yet;
- no changes to the other eight conditions.

The canonical type should be explicit, such as:

`OPENING_RANGE_DEFINITION`

Do not classify every sentence mentioning "opening range" as a definition. Require evidence of both:

- a clock/duration window;
- level or range construction.

A sentence merely saying "break above the opening-range high" is a trigger reference, not a range definition.

CENSUS CONTROL TRANSITION

The census contains the known-bad historical classification. Once STEP 3 fixes that classification, current production must no longer equal it.

Replace the equality control with an exact-delta control proving:

- the target condition changed from `WAIT_STRUCTURE` to `OPENING_RANGE_DEFINITION`;
- its source text, role and provenance stayed intact;
- all unrelated conditions stayed unchanged;
- the genuine structure neighbor still routes to `compute_structure_state`;
- no additional classification moved.

ENVIRONMENT-FLAG RULING

Do not environment-gate the semantic correction.

During STEP 3, the new type may temporarily refuse because its adapter does not exist yet. That is safe.

It must never fall back to the known-wrong structure evaluator.

Do not add a narrow guard exemption. Use the proper declaration route and its required parity fixture.

STEP 3 PASS CONDITION

STEP 3 passes when the real frozen extraction produces the explicit opening-range type, preserves every taught alternative, changes no neighboring meaning, and fails closed downstream until STEP 4 supplies the typed adapter.

BABY-SIMPLE STATUS

The alarm is now real and verified.

The worker may begin fixing the first broken wire.

Progress:

- STEP 1: complete;
- STEP 2: complete;
- STEP 3: authorized;
- six B1 steps remain before the opening-range constructor is production-ready.
