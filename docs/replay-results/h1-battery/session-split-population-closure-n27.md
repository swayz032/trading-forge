# WAIT_SESSION split — population closure over n=27

**Status:** COMPUTED this wave. Production flags OFF. Every figure below is a labeled hypothetical
about the labeled corpus; nothing here is a live-trading number. The 77 sealed corpus untouched.

## 1. The population, and why 26 was never an accident

| quantity | value | source | how obtained |
|---|---|---|---|
| corpus `WAIT_SESSION` rows | **27** | `h1-scripts/claude-rung-v32/shakedown_specs/*.spec.json` | COMPUTED (16 spec files, `spec.entry_conditions`, `type == "WAIT_SESSION"`) |
| rows in the ratified blind grade | **26** | `session-ab-blind-grade-RESULT.json` (`n=26`) | COMPUTED (row count) |
| difference | **1** | — | 27 − 26 |

The blind grade's own sample file states its population verbatim:

> `"population": "all WAIT_SESSION conditions that resolve to NO session zone (26 of 27)"`

So the 26 is a **defined** population, not a dropped row. The excluded row is the one that *did*
resolve to a zone. The grade instrument is self-consistent. **The defect is downstream of it.**

## 2. The ungraded row — identity and key

`WAIT_SESSION:overnight-pre-market-range-we-are-going#6`
(spec `W7nlnHTUZQU__s0.spec.json`, `entry_conditions[6]`, role `confluence`)

Two independent keys, both COMPUTED:

- **Key A — family-stripped condition id (`slug#index`).** The raw `condition_id` embeds the family
  name, which is the variable under test, so the family prefix is stripped before joining. The
  remaining slug is derived from the sentence text and the index from ordinal position in
  `entry_conditions`; both are invariant under re-typing. Result: 26/26 graded rows matched,
  **0 orphans on either side**, exactly 1 corpus row unmatched.
- **Key B — no ids at all.** Normalized containment of each graded `quoted_span` into the corpus
  row's `object`/`evidence`. Result: **0 ambiguous, 0 zero-match**, same single row unmatched.

A prior wave named this row. It is **confirmed by independent measurement, not inherited.**

## 3. The grade (locked blind, commit `2349388b`)

Full verdict record: `session-ab-blind-grade-ROW27.json`.

- **ANCHOR:** the 16:00 → 09:30 EST overnight/pre-market window.
- **TAUGHT OBJECT:** the overnight **high** and overnight **low** — two price levels.
- **Verdict: (B) mis-type.** `WAIT_SESSION` compiles to a session-window gate. That gate carries no
  high, no low, and no extremum extraction — the taught object is discarded entirely. The clock is
  load-bearing, but load-bearingness never owns the type: it spawns a sibling session condition
  (recorded, not built).
- **Additional finding, from the text alone:** the compiled gate is not merely lossy, it is
  **inverted** — true during 16:00–09:30, which is exactly the interval this strategy does *not*
  trade. It trades the RTH breakout of levels *built* during that window.

## 4. The correction chain

**COMPUTED arithmetic, airtight and assumption-free:** any bucketing of a 26-row population sums to
26. The governing split is declared **A=2 · B=21 · C=4 = 27**. Therefore the declared split exceeds
its sourced population by **exactly one unit** — one of the 27 declared units had **no graded row
behind it**. This holds regardless of how R-214's re-bucketing distributed the 26.

| | A genuine | B mis-type | C undecidable | sum | sourced rows |
|---|---|---|---|---|---|
| Blind grade as locked (AR-203) | 17 | 9 | 0 (no such bucket) | 26 | 26 |
| Governing split after R-214 §1 criterion swap | 2 | 21 | 4 | **27** | **26 — one unit unsourced** |
| **After this wave's grading** | **2** | **21** | **4** | **27** | **27 — fully sourced** |

**Derivation:** 26 sourced (blind grade) + 1 sourced (this wave) = **27**.
**Which bucket moved: B**, from 20 sourced + 1 assumed → **21 sourced**.

**★ The value of the constant does not move. Its epistemic status does.** R-214 had already
*assumed* the 27th row into the mis-type bucket so the split would close on the corpus; this wave
**grades** it and the assumption is confirmed. Per the standing pre-registration, a *movement* of
`2/21/4` escalates — **there is no movement to escalate.** No instrument constant is edited here.

## 5. Two false-green findings this closure surfaced

**(a) The closure guard could not have caught the omission.**
`dual_denominator_remeasure.py:3770` asserts
`graded_teachings + graded_mis_types + graded_undecidable == ws_taught`, billed as detecting whether
"the corpus moved under the grade". It compares a **declared** constant (27) against a **measured**
corpus count (27) and passes. Because the missing row was already baked into the declared constant,
**the guard was satisfied by the very padding it would need to detect.** Green by construction.

**(b) The instrument's own 26-vs-27 reconciliation is aimed at the wrong 26.**
The `THE_26_VS_27_ACCOUNTING` block explains the discrepancy as *"an earlier note recorded 26
corpus-wide `WAIT_SESSION` rows; this generator counts 27"* and declares `"closes_exactly": true`.
But the operative 26 is **the blind grade's sample size** — 26 of 27, zone-resolving row excluded —
not a stale corpus count. The block names the right numerals for the wrong reason and then declares
closure on that basis. Two true facts, no true link.

Both are **read-only findings**. Correcting either touches instrument surface and owes a packet
under the standing launch protocol; neither is corrected here.

## 6. A pre-existing verdict on this row exists, under the REJECTED criterion

`session-9v2-adjudication/verdicts-LOCKED.json` grades this row **A**, reasoning *"Remove the clock
and there is no range at all. The window IS the teaching."* That is the sentence-level
**is-the-clock-load-bearing** discriminator, which R-214 §1 explicitly rejected — a fact that
adjudication's own dispatch record (AR-027) already owns.

It is not a competing session-teaching grade: that instrument adjudicated a **different question**
over a **different population** (the 9 resolver-bound rows, `tally_over_the_9`). Under the governing
compile-semantics criterion the row is **B**. That same file independently recorded the row's zone as
*"WRONG AND INVERTED … the taught window WRAPS MIDNIGHT"* — reached here from the text alone,
without reading it.
