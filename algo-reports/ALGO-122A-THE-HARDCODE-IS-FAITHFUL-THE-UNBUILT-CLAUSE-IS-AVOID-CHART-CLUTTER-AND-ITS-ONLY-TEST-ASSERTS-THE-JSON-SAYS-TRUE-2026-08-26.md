# ALGO-122A — **I WAS RIGHT ABOUT THE LINES AND WRONG ABOUT WHAT THEY MEAN, AND THE CORRECTED VERSION IS SHARPER.** ALGO-122 framed `meaningful=True` on `KEY_ZONE_15M` as a defect. **It is faithful.** The teaching gives **two** routes to a meaningful level — *"multiple independent reactions/wicks strengthen a key level"* **and** *"a major swing high/low followed by decisive displacement can create a meaningful candidate level **even before many later retests exist**"* — and **every** 15m primary satisfies one of them. So `touches >= 2` as a destination filter is not merely uncited (ALGO-122 §3), **it is CONTRADICTED at the line.** The actually-unbuilt clause is elsewhere and it is held in the spec: **`active_map_policy.avoid_chart_clutter = true` (`current_mnq_strategy_v2_4_spec.json:67`) — and [MEASURED HERE] NO PRODUCTION CODE READS IT. Its only reader is a test asserting that the JSON field says `True`.** And the conclusion this all serves — *the map is clutter, so entries are early and destinations are near* — **was already ruled this morning at ALGO-100D**, which I credit here because my first prior-art pass missed it.

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Corrects:** ALGO-122 @ `3b8391bd`
(framing of §1/§3), and credits **ALGO-100D**. **Channel head at drafting:** `3b8391bd`.
**Nothing lands. No repair ordered. The worker's contract is untouched — the band build owns the tree.**

---

## 1. PRIOR ART I MISSED, credited — ALGO-100D ruled the conclusion this morning

> *"One defect explains every symptom this campaign has chased: **the level map is chart clutter**
> ... **the map is clutter, so entries are early and destinations are near.**"* — ALGO-100D

**That is ALGO-122's conclusion, twelve hours earlier.** What ALGO-122 adds is **not** the conclusion
but the **mechanism at four executable lines** — `meaningful` computed for one family (`targets.py:286`),
asserted for two (`:193`, `:213`, `:309`), fed unfiltered (`:258-263`), first-past-$400 wins
(`target_policy.py:135-186`). ALGO-100D said *destinations are near*; ALGO-122 says *by exactly which
lines*. **Framed as a new conclusion it was overreach; framed as the mechanism under a ruled
conclusion it is the useful half.**

**And I found it only because I obeyed my own ALGO-120A law and searched BOTH surfaces.** The blob
grep for `clutter` returns seven files; **ALGO-100D's headline lives in its commit subject**
(`a99dd87e`), which is where the sentence above is stated most plainly. **The law I minted this
morning caught my own omission this afternoon** — that is the only kind of evidence a process law
ever really gets.

## 2. THE CORRECTION — the hardcode is faithful, and `touches >= 2` is contradicted

`research/current_mnq_strategy_v2_4_video_evidence.md`, adopted rules, verbatim:

> **#2 (line 20):** *"**Repeated rejection matters.** Multiple independent reactions/wicks
> strengthen a key level."* · **(line 40)** *"A key level can be validated by multiple rejections."*
>
> **#3 (line 21):** *"**Strong displacement away from a swing matters.** A major swing high/low
> followed by decisive displacement can create a **meaningful candidate level EVEN BEFORE MANY LATER
> RETESTS EXIST.**"*

**TWO ROUTES, and route 2 is the exceptional single-swing family, named as meaningful with the
retest requirement explicitly waived.** Every `KEY_ZONE_15M` primary reaches the destination list by
one route or the other: **established** zones through `len(independent) >= 2`
(`v2_2_engine.py:479`) = route 1; **single-swing** zones through `disp >= threshold`
(`levels.py:146`, pin) = route 2.

⇒ **`meaningful=True` for `KEY_ZONE_15M` is CORRECT, and ALGO-122 §1's "the predicate cannot reach
the family that supplies the destinations" is the wrong reading of a set of facts that are
themselves all verified.** ⇒ **ALGO-122 §3 declined the `touches>=2` repair for "no citation". The
true reason is stronger and I record it as the binding one: the teaching CONTRADICTS it** —
*"even before many later retests exist"* is a direct refusal of a retest-count gate on
meaningfulness. **A repair declined for a weak reason is one good argument away from being adopted;
declined for the right reason it is closed.**

## 3. THE CLAUSE THAT IS ACTUALLY UNBUILT — and the test that made it look built

`current_mnq_strategy_v2_4_spec.json:65-67`:

```json
"active_map_policy": {
  "prioritize_relevant_nearby_levels": true,
  "avoid_chart_clutter": true,
  "do_not_delete_farther_meaningful_destination": true
}
```

Taught at `video_evidence.md` **#10** — *"Nearby meaningful levels matter more than chart clutter.
The active execution map should focus on relevant current-price inflection areas **while preserving
farther levels that remain meaningful destinations/targets**"* — and **#4** — *"'nearby' must be
CAUSAL and may not delete a farther zone if that farther zone is the next meaningful destination."*

🛑 **[MEASURED HERE] Grep of every `.py` under `research/` and `tests/`: the only reader of
`active_map_policy` is `tests/test_current_mnq_strategy_v2_4_key_level_spec.py:26-28`, and what it
asserts is that the JSON field equals `True`. NO PRODUCTION CODE READS IT.**

> ## **A TEST THAT ASSERTS A SPEC FLAG IS `True` IS A TEST THAT THE FILE SAYS `True`.**
> **It is a green check over a literal, and it is worse than no test at all — because its existence
> is the reason nobody noticed the clause was never built.**

ALGO-117 §4(a) ruled that *"no step in this process ever asked whether a ruled clause got built."*
**This is the darker variant: a step that appears to ask, passes, and asks nothing.** It belongs
beside the five ruled-but-unbuilt clauses in the ruled-clause register, **flagged as the case the
register would itself miss if the register only asks "is there a test?"** — the register must ask
**"is there a test that goes RED when the BEHAVIOUR is removed?"**

## 4. THE CONVERGENCE — the unbuilt clause is what the worker is building tonight

`avoid_chart_clutter` has never had an implementation. **[MEASURED, ALGO-121 §2]** tonight's band
build, taken from one sentence of his with **no magnitude added**, moves the authorized map
**865 → 522 (−39.7%)** across fourteen sessions with the established set **identical by key 14/14**.

> **The clause this campaign ruled and never built is the clause the worker is building right now,
> arriving from a completely different direction — from the shape of a zone rather than from a
> policy flag.** Nobody planned that. It is worth writing down, because it is the strongest available
> argument that a fidelity repair is not a fit: **two independent taught clauses, built separately,
> converge on the same correction.**

**Not claimed:** that the band alone satisfies `avoid_chart_clutter`. **37.3 zones/session is still
not "a handful."** Whether anything further is needed is a question to be asked **after** re-exam #5
reports, from the structural observables — **not tonight, and not by adding a policy knob.**

## 5. MY OWN INSTRUMENT RETURNED A FALSE ZERO, AND THE POSITIVE CONTROL CAUGHT IT

Searching `video_evidence.md` for the meaningfulness concept, a single `grep` with ten `-e` terms
returned **zero hits**. I ran a positive control on a string I had already read from that same file;
it returned 8. Re-run term by term: **`major` 1 · `strong` 6 · `key level` 4 · `clutter` 2.**
**§2's entire derivation sits on line 21 — inside the file the compound grep had just declared
empty.**

> **A COMPOUND SEARCH THAT RETURNS ZERO IS AN ACCUSATION AGAINST THE SEARCH BEFORE IT IS A FACT
> ABOUT THE CORPUS — AND ITS FALSE-ZERO WEARS THE EXACT COSTUME OF THE HONEST ANSWER
> `no citation found in the surfaces named`.**

Had I trusted it, I would have published ALGO-087's blessed null over a citation that was one line
away, and the `touches>=2` repair would have stayed merely uncited instead of refuted. **Every
absence claim gets a positive control in the same command** — this campaign has known that since
`[absence-claim]`; what is new is that **the instrument that lies is now my own one-line grep, not a
build system.**

## 6. QUEUE — narrowed again, and nothing is added

1. **ACTIVE, worker, unchanged:** band build · five-bucket partition · **(d) empty** · re-exam #5 ·
   ALGO-121 §3a lifecycle count · entry-displacement re-run. **Nothing in this ruling touches it.**
2. **`meaningful` census — NARROWED to near-nothing by §2.** The predicate is faithful on all three
   families. What remains is the provenance of `min_zone_quality` and `touches>=2` **as applied to
   the 5m cluster family only**, and it joins the existing magnitude census rather than standing alone.
3. **NEW, advisor-owned, after re-exam #5 reports — a QUESTION, not a build:** does
   `avoid_chart_clutter` require anything beyond the band, measured against the structural
   observables? **No policy knob, no top-N, no threshold may be proposed as the answer.**
4. **HOLD, unchanged:** established-path band · magnitude census · **the two reserved-class asks.**

**STOPS unchanged:** no TopstepX of any kind · no magnitude under the frozen contract · no width cap ·
`kernel.py:207` untouched · `targets.py` / `target_policy.py` untouched tonight.

---

**LESSON, minted, and it is the shape of this whole afternoon:**

> **THREE TIMES TODAY THE DEEPER READ REVERSED MY CONCLUSION WHILE LEAVING EVERY MEASURED FACT
> STANDING. THE FACTS WERE NEVER THE PROBLEM — THE STORY JOINING THEM WAS, AND A STORY IS THE ONE
> PART OF A RULING THAT NOTHING MEASURES.**

`kernel.py` was the exit half (wrong, ALGO-121) → `meaningful` was missing (wrong, ALGO-122) →
`meaningful` is unreachable (wrong, here) → **`avoid_chart_clutter` was ruled and never built, and
its test only reads the JSON.** Each correction cost one file read and **each one removed a lever
from the queue rather than adding one.** That direction — **findings that shrink the authorized
surface** — is the signature of converging on a real defect. **The opposite direction is the
signature of an overfit, and the operator asked for exactly this discrimination four hours ago.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
