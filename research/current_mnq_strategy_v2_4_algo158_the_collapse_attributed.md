# ALGO-158 — The collapse attributed, and his 28 levels traced end to end. Measurement only.

**His marked levels LOCATE, they never SCORE.** No agreement number, percentage or verdict.
Nothing derived, nothing proposed. Production functions called in production order; the trace
**reconciles exactly to the committed map — 287 + 235 = 522.**

---

## 1. WHERE ~690 A SESSION BECOMES 37 — BY STAGE, BY KEY

**ESTABLISHED path**

| stage | in → out | removed |
|---|---|---|
| gate (`wick`, `min_disp_atr`) | 7,841 → **7,802** | 0.5% |
| **clustering + `touches ≥ 2`** | 7,802 → **895** | **88.5%** |
| lifecycle (`zone_state_at_v24`) | 895 → **602** | 32.7% |
| **quality (`valid_location`)** | 602 → **287** | **52.3%** |

**EXCEPTIONAL path**

| stage | in → out | removed |
|---|---|---|
| gate (`Q75`, floor) | 7,841 → **1,958** | 75.0% *(construction-fixed)* |
| established-overlap drop | 1,958 → **912** | 53.4% |
| lifecycle | 912 → **644** | 29.4% |
| **greedy same-side dedup** | 644 → **235** | **63.5%** |

⇒ **287 + 235 = 522.** No stage is unaccounted for.

**THE TWO LARGEST REDUCERS ARE CLUSTERING AND DEDUPLICATION, AND NEITHER IS A QUALITY JUDGEMENT.**
Clustering **merges** many pivots into one zone; dedup **discards** overlapping bands. **Together
they do most of the work of turning 690 into 37 — and neither asks whether he would have drawn it.**

**ONE STAGE I DID NOT SPLIT, AND I AM NAMING IT RATHER THAN ESTIMATING IT:** clustering and
`touches ≥ 2` are measured as **one** step, because separating them requires re-implementing the
union-find inside `build_zones`, and a re-implementation is not a measurement of the thing.

**AND THE QUALITY COMPOSITE IS NOT INERT.** `valid_location` removes **315 of 602** established
zones — **52%**. That is the seven undeclared weights at `v2_2_engine.py:514-515` doing real work,
in sharp contrast to the two uncited displacement floors (`min_disp_atr` removing **39 of 7,841**;
`absolute_displacement_floor_atr` binding **0 of 1,958**). **Uncited does not mean inert, and inert
does not mean uncited. These three are one of each.**

## 2. 🛑 HIS 28 LEVELS, TRACED END TO END

| outcome | n |
|---|---|
| no pivot within 5 pts | **0** |
| pivot exists, passes **no** family gate | **3** |
| passes a gate, **then dies in the collapse stages** | **12** |
| **survives into the final map** | **13** |

> ## THE DETECTOR NEVER LOSES ONE. THE GATES LOSE 3. **THE COLLAPSE STAGES LOSE 12.**

⇒ **The stages that reduce ~690 to 37 discard TWELVE of the levels he actually drew, while keeping
~480 he never drew.**

**That is the campaign's answer stated as a single sentence.** The problem was never detection,
never the rank, never arrival order, never the target layer, never a lookahead, and not either
family's gate. **It is that the reduction from ~690 candidates to ~37 zones is not selecting for
the thing he selects for** — and it is measurably *anti*-correlated with it on 12 of 28.

## 3. WHAT THIS DOES AND DOES NOT SAY

- **It does NOT say clustering, dedup or lifecycle are wrong.** Each is doing what it was built to
  do. **No stage is indicted and no repair is proposed.**
- **It does NOT say a threshold would fix it.** The two largest reducers have no threshold to move
  — they merge and de-overlap.
- **It DOES locate the object precisely**, and for the first time the location is a stage nobody
  has touched rather than a magnitude nobody cited.

**No window, tolerance, count or rule proposed. No number invented. Nothing chosen for what it
does to the fourteen sessions.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision.*
