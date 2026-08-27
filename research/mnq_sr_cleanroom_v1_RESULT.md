# MNQ-SR-CLEANROOM-v1 — RESULT

> # 🛑 RETRACTED IN FULL, 2026-08-27, BY ME, BEFORE ANYONE ASKED.
>
> **THE PASS BELOW IS AN ARTIFACT OF BAND WIDTH AND MEASURES NOTHING.**
>
> | | this map | v2.4 |
> |---|---|---|
> | median band WIDTH | **912.6 pts** | **17.75 pts** |
> | share of each session's price range covered | **78%** | **29%** |
> | covers his 28 | 17 | 13 |
> | **its OWN null** (random one-tick levels, 4,000 draws) | **mean 17.5** | mean 9.5 |
> | **distance from chance** | **−0.27 sd** | **+1.43 sd** |
> | `P(null ≥ observed)` | **0.718** | 0.112 |
>
> **A 912-point band on a chart whose whole session spans a few hundred points contains his
> one-tick level by construction.** The map covers **78% of the session's own range**; a random
> price lands inside it **17.5 times out of 28**, which is MORE than the 17 of his it actually
> caught. **This map is very slightly WORSE than chance at finding his levels.**
>
> **AND THE RANKING REVERSES ONCE EACH MAP IS SCORED AGAINST ITS OWN NULL.** `17 vs 13` was never
> like-for-like: v2.4 draws real zones (median `17.75` pts) and sits `+1.43 sd` above chance;
> this build drew bands `51×` wider and sits AT chance. **v2.4 wins the only comparison that
> controls for width. The clean room did not beat it — it out-blanketed it.**
>
> **ROOT CAUSE — AND IT IS THE THING I CALLED THE BUILD'S ELEGANCE.** §"HOW THIS AVOIDS INVENTING
> NUMBERS" boasts *"CLUSTERING NEEDS NO TOLERANCE … the grouping distance is supplied by the
> candles themselves."* That clustering is a **transitive closure over band overlap**, i.e.
> single-linkage — so A–B overlapping and B–C overlapping merges A with C **even when A and C are
> 900 points apart.** It chains. Median members per "level": **230.** A key level with 230
> independent reactions is not a level, it is the whole market. **Removing a tolerance constant
> did not remove the need for one; it hid it.**
>
> **WHY NO GUARD CAUGHT IT: the pre-registered acceptance measured COUNT and COVERAGE, and neither
> constrains WIDTH.** `≤5 zones` is satisfied by three bands that swallow the chart. Both clauses
> were green **at the assertion** and blind to **what they asserted over** — and `[guard-green-for-
> the-wrong-reason]` was already in my own memory index, naming this exact shape, before I wrote
> the spec.
>
> **A NULL CONTROL WOULD HAVE KILLED THIS ON DAY ONE AND I NEVER RAN ONE.** Every coverage figure
> in ALGO-163 was reported without asking what a random map would score. **The number that makes
> `17 of 28` interpretable is `17.5`, and it cost ninety seconds to compute.**
>
> **WHAT SURVIVES:** the ablation in §3/§4 is unaffected — confluence really did decide 0 of 14
> cuts, and `RECENCY_ONLY 22` really did beat it. **Those were always statements about this map's
> internal ranking, and they remain true of a map that should not be used.**
>
> **WHAT DOES NOT SURVIVE:** clause 2's PASS as evidence of anything · "more of his levels on a
> map 12.4× smaller" · every "clean room vs v2.4" coverage comparison in ALGO-163 · and the
> premise under CLEANROOM-v2, which builds on this map.
>
> *Limit on the instrument, stated: the null draws uniformly over each session's range. His levels
> are not uniform, so a pivot-drawn null would be a stronger test. It is not needed to carry this —
> the width and range-coverage facts stand alone and require no null at all.*

---

## (ORIGINAL DOCUMENT BELOW, UNEDITED — retained as the record of what I claimed)

## MNQ-SR-CLEANROOM-v1 — RESULT. **BOTH CLAUSES PASS. THE STATED MECHANISM IS REFUTED.**

Spec frozen at `1aa85df1`, builder at `55b344cd`, cap correction at `cb8739df` — **every one
committed before the run it governs.** Two runs total. **No parameter was ever changed after
seeing what it did to his sessions.**

> **This document REPLACES the FAIL writeup at `989b4142`.** That verdict was correct for the
> build that produced it and the retraction is recorded in §2, not hidden by the rewrite.

---

## 1. THE VERDICT: **PASS**, and it is not the interesting part

| clause | result | |
|---|---|---|
| **≤ 5 zones per session** | **3 on all 14**, mean **3.00** | ✅ **PASS** |
| **overlaps > 13 of his 28** | **17 of 28** at exact overlap | ✅ **PASS** |

**The advisor pre-registered the adverse branch before this run:** *"cutting 5.9 → ~3 removes about
half the map. Coverage may fall from 17 to at or below 13, in which case clause 2 FAILS … that is a
real and likely outcome."* **It did not fire, and that is stated here so the pass is not read as
luck.** The map halved and coverage did not move by one level: **0 of his 28 were covered only by
the dropped ranks 4–6.**

## 2. THE RETRACTION THAT GOT HERE

Run 1 drew **5.9 zones/session** and FAILED clause 1. The cause was **a build departure, not a
broken criterion**: ALGO-161:110 says *"keep top 2–3 **per session**"*; my spec restated it a fourth
time as *"top 3 **per side**"* and silently doubled the ceiling to six. **I had published the
reading that flattered me** — *broken criterion* — **and the ladder bytes said otherwise.** One line
changed, at `cb8739df`, **committed before the re-run.**

## 3. 🛑 AND NOW THE PART THAT REFUTES MY OWN SPECIFICATION

**`MNQ-SR-CLEANROOM-SPEC.md` §1 says, verbatim: *"Rule 4 is the whole build … Here confluence count
IS the rank."* THAT SENTENCE IS FALSE AND THIS RUN MEASURES IT FALSE.**

| | |
|---|---|
| top-3 boundary decided **by confluence** | **0 of 14 sessions** |
| top-3 boundary decided **by a tiebreak** | **14 of 14 sessions** |
| coverage **as built** (conf → members → recency) | **17 of 28** |
| coverage with **confluence deleted from the rank** | **17 of 28 — identical** |

**Confluence never once decided the cut, and removing it entirely changes nothing.** What actually
selected the map is `members` (how many pivots clustered) and recency — **the tiebreakers.**

**Why it is inert is visible in the family rates**, and was knowable by reading my own spec before
the run — the second such defect in two runs:

| family | fires on |
|---|---|
| **`5M_REACTION_CLUSTER`** | **203 of 203 — 100%** |
| `ROLE_FLIP` | 169 of 203 (83%) |
| `ACTIVE_15M_FVG` | 135 of 203 (67%) |

**A family that fires on everything cannot rank anything.** Forty days of 5m pivots intersect
essentially any 15m band, so that term is a constant `+1`. With one term constant and the other two
common, **62% of candidates sit at the maximum** and the key is flat exactly where it must
discriminate.

⇒ **The PASS stands — it was pre-registered on outputs, and the outputs are what they are. But the
CREDIT does not go where the spec put it.** Rules 1 (cap), 2 (15m structure / 5m refinement) and 3
(≥2 reactions, band-overlap clustering) produced this map. **Rule 4, the one I called "the whole
build", is dead weight.** A worthwhile distinction survives it: *confluence ACROSS independent
families* is inert here, while *repetition WITHIN one family* — the member count — carries the
result.

## 4. 🛑 THE ARM THAT SCORES HIGHEST, PUBLISHED AND **REFUSED**

Cap fixed at 3 in every arm. **Only the sort key varies.**

| arm | covers his 28 |
|---|---|
| `RECENCY_ONLY` | **22** |
| `AS_BUILT` | 17 |
| `NO_CONFLUENCE` | 17 |
| `MEMBERS_ONLY` | 17 |
| `CONFLUENCE_ONLY` | 6 |
| *v2.4 baseline, 37.3 zones/session* | *13* |

**`RECENCY_ONLY` beats my build by five levels and v2.4 by nine, from three zones a session. I am
not adopting it, and the refusal is the point.**

**`research/run_algo163_cleanroom_rank_ablation_2026_08_27.py` carries this, written into the file
BEFORE it was run:** *"no arm of this ablation licenses a change to `mnq_sr_cleanroom_v1.py`. If an
arm scores higher, that is a FINDING ABOUT THE CLAIM, not a candidate build."*

**Recency is not one of ALGO-161's four published rules.** Promoting it because it scored 22 would
be adding a fifth rule chosen by what it does to his fourteen sessions — **the exact contamination
this build exists to exclude, arriving at the last step wearing a result as its credential.**

**And it may well not even be real.** Recent levels are the ones nearest the session he was drawing
for, so "recency" may be a genuine S/R decay principle **or** an artifact of how the labels were
made. **This instrument cannot separate those, and I am not going to pick the reading that hands me
a better number.**

## 5. WHAT THIS DOES AND DOES NOT ESTABLISH

- ✅ **A 3-zone map built only from published practice contains more of his marked levels at exact
  overlap than v2.4's 37-zone map does — 17 vs 13, on a map 12.4× smaller.**
- ⚠️ **AND IT LOSES AT A LOOSE TOLERANCE — 20 vs 25 at pad 10.00.** Both pads are reported together
  from here per ALGO-162; **quoting only pad 0.00 would be cherry-picking by omission.** *"20 vs 25
  is what 37 zones buy"*: a map that blankets the chart catches more of anything at a wide enough
  tolerance. **Precision to the clean room, blanket coverage to v2.4, and both halves are the
  result.**
- ❌ **It does NOT establish that confluence ranking works.** Measured inert, §3.
- ❌ **It does NOT license changing v2.4**, which was not edited and did not move during either run.
- ❌ **No profitability claim.** No PnL was read. The R-geometry is a frozen input and was never
  tested here.

### The full comparison, both arms, both pads

| | **clean-room** | **v2.4** |
|---|---|---|
| zones per session | **3.00** (max 3) | **37.3** |
| his 28, pad 0.00 as-marked | **17** | 13 |
| pad 2.50 | **18** | 17 |
| pad 10.00 | 20 | **25** |
| pad 0.00, 7.25 arm | **17** | 16 |
| pad 2.50, 7.25 arm | 19 | **20** |
| pad 10.00, 7.25 arm | 20 | **25** |

## 6. THE LIMIT THAT DOES NOT GO AWAY

**I am not a clean room and §0 of the spec said so before either run.** Every parameter is cited and
none was tuned — **but a person with three days of exposure to those fourteen sessions, choosing
which published rules to adopt, is a channel no commit order closes. A commit order is evidence
about FILES, not about a MIND.** The four rules came from ALGO-161's external research rather than
from me, which narrows it. **It does not close it, and §4 is the sharpest available evidence that
the discipline is actually load-bearing rather than decorative — the highest-scoring arm is sitting
right there, measured, published and unadopted.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision.*
