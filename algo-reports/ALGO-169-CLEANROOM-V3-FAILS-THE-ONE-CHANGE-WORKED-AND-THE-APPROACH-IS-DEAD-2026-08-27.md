# ALGO-169 — **CLEANROOM-v3 FAILS.** The one change worked. **The approach is dead.**

**Strategy head:** `09421f59` — pushed, remote-verified. **PR #38: DRAFT / DO NOT MERGE.**
**Semantic files modified: NONE.** v2.4 untouched throughout.
**Gate:** `45 passed`, enumerated by `--collect-only` (14 band_shape · 12 levels · 8 sunset_docs ·
6 cleanroom_v2_frozen · 5 cleanroom_v3_frozen).

**v3 frozen with its evaluator at `e37f2417`, before the evaluation ran.**

---

## 1. THE TABLE — and per clause 2 it is the only shape a coverage figure is allowed to appear in

| map | median width | share of session range | zones/session | covers his 28 | its null | **sd above null** |
|---|---|---|---|---|---|---|
| **CLEANROOM-v3** (mutual overlap) | **3.75 pt** | **0%** | 3.00 | **0 of 28** | 0.0 | **−0.12** |
| CLEANROOM-v1 (transitive, RETRACTED) | 912.62 pt | 78% | 3.00 | 17 of 28 | 17.5 | −0.27 |
| v2.4 | 17.75 pt | 29% | 37.29 | 13 of 28 | 9.5 | +1.43 |

| clause, fixed before v3 was written | result |
|---|---|
| **3.** ≤5 zones per session | **PASS** — max 3 |
| **2.** width + range share printed beside coverage, always | **PASS** — structural: `_row()` is the only path that prints a coverage figure and cannot print one without them |
| **1.** coverage ≥ **+2 sd** over its own null | 🛑 **FAIL — −0.12 sd** |

## 2. THE ONE CHANGE WORKED. THAT IS WHAT MAKES THIS CONCLUSIVE.

**Mutual overlap fixed the width completely: `912.62 pt → 3.75 pt`** — **narrower than v2.4's
`17.75`, and the closest any build has come to his `0.25`.** The definitional repair did exactly
what you authorized it to do. **The zone is now the thing his ratified spec says a zone is.**

**And the map still finds nothing of his.**

## 3. THE FAIL IS UNAMBIGUOUS, NOT MARGINAL — and I want that on the record in the strict direction

**With a null mean of `0.0` and sd `0.1`, ONE single overlap would have scored roughly `+10 sd`.**
The `+2 sd` bar was **trivially clearable** at this width. **v3 scored zero.** There is no reading
of this where the clause was too strict or the instrument too blunt.

## 4. WHY — the zones are in the WRONG PLACES, not merely too narrow

Diagnosis run **after** the verdict, on the campaign's own established pads, and it does not reopen
anything:

| | |
|---|---|
| median distance from his 28 levels to the nearest v3 zone edge | **743.1 pt** |
| closest single approach across all 28 | **25.6 pt** |
| 25th percentile | 400.3 pt |
| coverage at pads `0.0` / `2.5` / `10.0` | **0 / 0 / 0** |
| coverage at a deliberately generous pad `25.0` | **1 of 28** |

**These are not near-misses.** Complete linkage takes the INTERSECTION of ≥2 wick-to-close bands —
a precise sliver wherever bands happen to coincide. **Those slivers land hundreds of points from
where he draws.**

⇒ **v1's `17 of 28` was width and nothing else. Remove the width honestly and the underlying
pivot-band-clustering approach finds none of his levels at all.** The family is dead: single
linkage chains into nonsense, complete linkage collapses into precision aimed at the wrong prices,
**and there is nothing between them that is not a tolerance constant.**

## 5. PUBLISHED AS A FAILURE OF THE APPROACH — and there is no fourth build

**Your pre-registration, honoured literally:** *"AT CHANCE IS THE MOST LIKELY OUTCOME and it gets
published as a failure of the approach — not as a reason for a fourth build."* **It came in below
even that — not at chance but at zero — and I am proposing nothing.**

**No repair. No parameter. No fourth build. No adoption decision** — a result and what to do about
it are separate rulings, and this is the result.

## 6. WHERE THAT LEAVES THE LANE, stated plainly and without a proposal

- **The clean-room map lane is exhausted.** Three builds, two linkages, and the only one that
  scored was scoring its own bin width.
- **Nothing here rehabilitates v2.4.** Its `+1.43 sd` is `p = 0.112` and remains **not
  demonstrated**, per your ALGO-167 correction which I have accepted and recorded in ALGO-168.
- **ALGO-168 is the live lane**, as you said before this result existed: **the `08:00–09:30`
  lookahead is a claim about causality, and no null can rescue or destroy it.** Two of the fourteen
  trades entered at `08:07` on a zone stamped `08:45`, and that finding does not depend on any
  coverage metric.

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this packet.*
