# ALGO-170 — **v3's FAIL IS RATIFIED AND THE WHOLE PIVOT-BAND-CLUSTERING FAMILY IS CLOSED. THIS IS A CONCLUSIVE NEGATIVE RESULT, NOT A THIRD DISAPPOINTMENT: SINGLE LINKAGE CHAINS INTO `912`-POINT NONSENSE, COMPLETE LINKAGE COLLAPSES TO `3.75`-POINT SLIVERS AT THE WRONG PRICES, AND EVERYTHING BETWEEN THEM IS A TOLERANCE CONSTANT.** **[VERIFIED HERE at `057428dd`] `0 of 28` · `−0.12 sd` · median distance from his levels to the nearest v3 zone edge `743.1 pt` · **share of session range `0%`**. With a null of `0.0 ± 0.1`, ONE overlap scores `+10 sd` — the bar was trivially clearable and v3 scored ZERO. There is no reading in which the clause was too strict.** **🛑 AND I AM HOLDING MY OWN PRE-REGISTRATION: ALGO-167 §6 said at-chance would be published as a failure of the approach AND NOT AS A REASON FOR A FOURTH BUILD. I HAVE A POST-HOC HYPOTHESIS THAT WOULD JUSTIFY ONE. I AM PUBLISHING IT AND NOT ACTING ON IT, BECAUSE A PRE-REGISTRATION THAT BINDS ONLY UNTIL IT COSTS SOMETHING IS NOT ONE.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Channel head at drafting:** `057428dd`.
**Strategy head `09421f59`; v3 frozen with its evaluator at `e37f2417`, before the evaluation ran.**
**PR #38: DRAFT / DO NOT MERGE.**

---

## 1. THE FAIL IS RATIFIED, AND THE ONE CHANGE WORKING IS WHAT MAKES IT CONCLUSIVE

| map | median width | share of range | covers his 28 | null | sd |
|---|---:|---:|---:|---:|---:|
| **CLEANROOM-v3** | **`3.75` pt** | **`0%`** | **`0 of 28`** | `0.0` | **`−0.12`** |
| CLEANROOM-v1 *(retracted)* | `912.62` pt | `78%` | `17` | `17.5` | `−0.27` |
| v2.4 | `17.75` pt | `29%` | `13` | `9.5` | `+1.43` |

**Mutual overlap did exactly what it was supposed to: `912.62 → 3.75` pt, narrower than v2.4 and the
closest any build has come to his `0.25`. The zone is now the thing his ratified spec says a zone is.
And the map finds nothing of his at all.**

> ## **THE REPAIR SUCCEEDED AND THE HYPOTHESIS DIED. THAT IS THE CLEANEST NEGATIVE RESULT THIS CAMPAIGN HAS PRODUCED — v1's `17 of 28` WAS WIDTH AND NOTHING ELSE, AND WHEN THE WIDTH IS HONEST THE FAMILY FINDS ZERO.**

**And I ratify the strict framing you insisted on:** at a null of `0.0 ± 0.1` **one single overlap
scores ~`+10 sd`.** ⇒ **the `+2 sd` bar was not a demanding test; it was nearly the weakest test that
could exist, and v3 could not clear it.** **Recording that in the strict direction, unprompted, is the
opposite of the instinct that produced ALGO-163.**

## 2. THE FAMILY IS CLOSED — and closing a FAMILY is worth more than closing an instance

**Two extremes measured, and the space between them named:** single linkage **chains** · complete
linkage **collapses** · **anything between is a tolerance constant, which is the one thing forbidden.**

> ## **HIS LEVELS ARE NOT RECOVERABLE FROM THE GEOMETRY OF PIVOT REJECTION-BANDS ALONE, AT ANY LINKAGE. THAT IS AN ENUMERATION OVER A MECHANISM AND NOT A CLOSED INSTANCE** — `[instance-not-condition]` run forwards for once.

**Three builds in one day, all published, none rescued.** ⇒ **the campaign now knows something it did
not know this morning, and it is a fact about the world rather than about a parameter.**

## 3. 🛑 THE POST-HOC OBSERVATION — PUBLISHED, DELIBERATELY NOT ACTED ON

**`share of session range = 0%` and `median distance 743.1 pt` are the two most informative numbers in
the packet and they say something the retraction does not.** **v3's zones are not merely at the wrong
prices — they are outside the price region the session ever visits.** A `40`-day lookback with **no
term of any kind for where price actually is** will site its slivers wherever bands historically
coincided, which on MNQ in 2026 is hundreds of points from today's tape.

**And the clean-room has no such term because I forbade the one it had.** ALGO-164 declined
`RECENCY_ONLY` — **which scored `22 of 28`, the best arm ever measured.** ⇒ **a plausible reading is
that v3 failed for a reason I introduced.**

**AND THE DISTINCTION THAT MAKES IT MORE THAN AN EXCUSE:** *recency* is **when a level FORMED**;
*proximity* is **where a level SITS relative to current price.** **They are different quantities, and
`RECENCY_ONLY`'s `22` may have been a proximity effect wearing recency's clothes** — recent levels sit
near current price because price was recently there. **That also dissolves your labelling-artifact
worry: it is not an artifact, it is the mechanism.** Published S/R practice is unanimous that levels
are marked **near where price is trading**, which would make proximity derivable without any score.

**🛑 AND I AM NOT ACTING ON ANY OF IT.**

**ALGO-167 §6, committed at `2d08bb65` before v3 was built:** *"AT CHANCE IS THE MOST LIKELY OUTCOME
AND IT WILL BE PUBLISHED AS A FAILURE OF THE APPROACH, NOT AS A REASON FOR A FOURTH BUILD."*
**The result is at chance. The clause binds.**

> ## **THE HYPOTHESIS ARRIVED BY READING THE FAILURE TABLE OF THE RUN IT WOULD JUSTIFY OVERTURNING. THAT IS THE EXACT SHAPE OF EVERY GOALPOST MOVE I HAVE POLICED FOR THREE DAYS, AND IT DOES NOT STOP BEING ONE BECAUSE THE REASONING IS GOOD. A PRE-REGISTRATION THAT BINDS ONLY UNTIL IT COSTS SOMETHING IS NOT A PRE-REGISTRATION.**

**Recorded for whoever holds this seat next, explicitly labelled POST-HOC and UNTESTED. Not
authorized. Not a lane.** **The operator's own standing constraint is `NO OVERFITTING`, and a fourth
build chasing a hypothesis generated from the third build's failure table is precisely how that
happens.** ⇒ **holding the line here IS the deliverable, not a refusal to deliver one.**

## 4. THE TWO PROCESS NOTES — BOTH RATIFIED, AND THE FIRST IS A REAL INSTRUMENT FINDING

**1. Two guards read GREEN under mutation and the guards were not blind — THE HARNESS WAS.**
`MIN_WICK = 0.20` also appears in the docstring, so a first-occurrence replace **planted the mutation
in PROSE.**

> **A MUTATION PLANTED IN A DOCSTRING PROVES NOTHING AND READS EXACTLY LIKE A BLIND GUARD.** ⇒ **a
> red-proof can fail in the direction that ACCUSES A HEALTHY GUARD**, and `[guard-green-for-the-wrong-reason]`
> now has a fifth place to be blind: **the MUTATOR**, alongside the population, scope, filter and unit.

**Re-parsing and refusing any mutation that does not change the code tree with docstrings stripped is
the correct fix — it validates the INSTRUMENT rather than trusting it.** All 5 then RED, byte-exact.

**2. The width guard caught its own first version being wrong** — a no-floats rule flagged
`(lo+hi)/2.0`, an arithmetic divisor. **Widening the allowlist would have been the move that lets a
real constant in later; tightening the predicate instead — module floats exactly `{MIN_WICK}`, and no
float inside any comparison — is right, because a float in a comparison IS what a threshold is.**
**A guard repaired by loosening is a guard retired quietly.**

## 5. AUTHORIZED — THE LIVE LANE, AND IT IS NOW THE ONLY ONE

1. **`ALGO-168`, the v2.4 map-anchor lookahead trace, with its positive control.** **It is unaffected
   by everything above** — a claim about causality that no null can rescue or destroy, and the only
   open question whose answer changes what we already believe.
2. **REPORT AND HOLD.** No fourth map build · no proximity term · no recency · no tolerance · no
   linkage change · no v2.4 edit · no Monte Carlo · no adoption decision inside a result message.

**And the honest campaign position, stated for the operator without varnish:** **the map lane has
produced no demonstrated result and the family that was going to produce one is now closed.** **The
single measurement that has survived every instrument all week is `[the-edge-is-target-geometry-not-levels]`
— his median target `3.83R` against the bot's realised `1.16R` — and it was never a map question.**
**It remains untested, and it is the only thing left that the evidence actually points at.**

---

**LESSON, minted:**

> **THE FIX WORKED PERFECTLY AND THE IDEA DIED. WIDTH `912.62 → 3.75`, EXACTLY AS ORDERED, AND COVERAGE WENT FROM `17` TO `0`. A SUCCESSFUL REPAIR IS NOT EVIDENCE FOR THE THING IT WAS REPAIRING.**

**v1 was believed because it scored well while being absurd; v3 was disbelieved despite being correct
in every respect the spec names.** ⇒ **conformance to a ratified definition and agreement with the
operator's chart are independent, and this campaign has been treating them as one thing.**

> **WHEN A REPAIR SUCCEEDS AND THE RESULT COLLAPSES, THE REPAIR WAS NEVER THE HYPOTHESIS — IT WAS HOLDING THE HYPOTHESIS UP. CLOSE THE FAMILY, NOT THE INSTANCE.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
