# ALGO-159 — Which stage kills each of his 12 levels. Measurement only. Terminal.

**His marked levels LOCATE, they never SCORE.** No agreement number, percentage or verdict.
Nothing derived, nothing proposed. Production functions, production order.

**Population: the 12 levels of his 28 that pass a family gate and do not reach the final map.**
The other 16 are excluded and named: **13 reach the map · 3 pass no gate · 0 have no pivot.**

---

## THE ATTRIBUTION, BY KEY

| stage | n |
|---|---|
| **`EST_CLUSTERING_OR_TOUCHES`** | **6** |
| `EST_QUALITY` (`valid_location`) | 2 |
| `EXC_ESTABLISHED_OVERLAP` | 2 |
| `EXC_GREEDY_DEDUP` | 2 |

| session | his level | killed at |
|---|---|---|
| 03-23 | 24,343.62 | `EST_QUALITY_valid_location` |
| 03-26 | 24,241.62 | `EST_CLUSTERING_OR_TOUCHES` |
| 03-26 | 24,068.38 | `EST_CLUSTERING_OR_TOUCHES` |
| 03-30 | 23,609.12 | `EST_QUALITY_valid_location` |
| 03-31 | 23,311.88 | `EXC_ESTABLISHED_OVERLAP` |
| 04-01 | 24,244.88 | `EST_CLUSTERING_OR_TOUCHES` |
| 04-02 | 23,665.62 | `EST_CLUSTERING_OR_TOUCHES` |
| 04-06 | 24,248.12 | `EST_CLUSTERING_OR_TOUCHES` |
| 04-07 | 24,302.12 | `EXC_ESTABLISHED_OVERLAP` |
| 04-08 | 24,615.12 | `EXC_GREEDY_DEDUP` |
| 04-09 | 25,112.12 | `EXC_GREEDY_DEDUP` |
| 04-14 | 25,716.62 | `EST_CLUSTERING_OR_TOUCHES` |

## WHAT IT SAYS — AND THE TWO LIMITS THAT COME WITH IT

**THEY CONCENTRATE, BUT NOT OVERWHELMINGLY. `EST_CLUSTERING_OR_TOUCHES` takes 6 of 12 — the single
largest share — and the remaining 6 split EVENLY across three other stages, 2 / 2 / 2.**

**⚠️ LIMIT 1 — THE LARGEST SHARE LANDS ON THE ONE STAGE I DELIBERATELY DID NOT SPLIT.**
`EST_CLUSTERING_OR_TOUCHES` is clustering **and** `touches ≥ 2` measured together, because
separating them requires re-implementing the union-find inside `build_zones` (ALGO-158 §1).
⇒ **The best-supported result of this measurement is "6 of 12 die at a stage I cannot resolve into
its two halves."** That is an honest limit, not a hedge, and it is exactly where the next
measurement would go if one were authorized.

**⚠️ LIMIT 2 — `n = 12`.** Six is half of twelve and twelve is small. **This is a concentration, not
a dominance**, and no stage here is convicted on it.

**AND ONE SUB-SHAPE WORTH NAMING: 4 of the 12 die in DEDUPLICATION** — 2 at
`EXC_ESTABLISHED_OVERLAP`, 2 at `EXC_GREEDY_DEDUP`. **In those four the bot DID draw his level and
then discarded it for overlapping a neighbour.** Not a failure to find it; a decision to prefer
something else.

## THE END STATE, STATED PLAINLY

**The object is located and the repair is not derivable from held evidence.**

A fix requires a rule for **which ~2 of ~690 he would draw**. That rule is `avoid_chart_clutter` —
**taught, declared in `spec.json`, read by no production code, and `UNDERIVABLE` in magnitude.**
Under the standing order **no question is available**, so it stays `UNDERIVABLE` rather than
becoming an ask.

> **A COMPLETE DIAGNOSIS WITH A NAMED BLOCKER IS THE CORRECT PLACE TO STOP. It is not a failure and
> it is not a repair.** Inventing a clutter rule at the last stage of a three-day hunt would be the
> one thing this campaign has spent three days learning not to do.

**No stage indicted. No rule proposed. No number invented. No tolerance tuned. Nothing chosen for
what it does to the fourteen sessions.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision.*
