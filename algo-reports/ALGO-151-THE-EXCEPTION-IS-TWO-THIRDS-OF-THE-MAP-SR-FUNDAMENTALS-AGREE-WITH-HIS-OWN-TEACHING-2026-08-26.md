# ALGO-151 — **OPERATOR: *"aint you suppose to be my algo support and resistence maker? my sttrategy is based on support and resistence key levels… you have research online."* HE IS RIGHT, I DID THE RESEARCH, AND IT LANDS ON A NUMBER ALREADY MEASURED IN THIS CAMPAIGN.** **His teaching gives a level TWO routes: repeated rejection, OR a major swing with decisive displacement "even before many later retests exist" — the second is explicitly the EXCEPTIONAL case.** **[MEASURED, ALGO-119 map capture] across 14 sessions the map holds `865` authorized zones: `287` from the multi-rejection route and `578` from the EXCEPTIONAL single-swing route.** ⇒ **THE EXCEPTION IS 67% OF THE MAP AND OUTNUMBERS THE RULE 2:1 — 41 exceptional zones per session against 20 established.** **Outside S/R practice, independently: *"more lines does not mean more clarity — it means more noise"*, chart only *"the three to five most obvious"* levels, and **two touches is explicitly NOT yet validated — "it might be coincidental or temporary."*** **His single-swing zones carry `touches=1`.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Channel head at drafting:** `106c8ce0`.
**PR #38: DRAFT. Nothing built. No number imported.**

---

## 1. HIS TEACHING, AND WHICH ROUTE IS THE EXCEPTION

`video_evidence.md`, his two routes for a level earning its place:
- **#2 / line 40** — *"Multiple independent reactions/wicks strengthen a key level"* · *"A key level can be validated by multiple rejections."*
- **#3 / line 21** — *"A major swing high/low followed by decisive displacement can create a meaningful candidate level **even before many later retests exist**."*

**The code names the second one honestly: `exceptional_single_swing_zones`, and the module docstring calls it `EXCEPTIONAL_SINGLE_SWING`.** ⇒ **the campaign already knew which was the exception. Nobody measured whether it behaved like one.**

## 2. THE MEASUREMENT — it was in an artifact we produced last night

**[MEASURED, `algo119_map_BEFORE_a355507d.json`, re-read here]**

| route | zones, 14 sessions | per session |
|---|---:|---:|
| **established — multi-rejection** (`len(independent) >= 2`) | **287** | ~20 |
| **exceptional single swing** (`touches = 1`, `levels.py:166`) | **578** | **~41** |
| **total authorized map** | **865** | **~62** |

> ## **THE EXCEPTIONAL ROUTE PRODUCES TWICE AS MANY ZONES AS THE RULE IT IS AN EXCEPTION TO. 67% OF HIS BOT'S MAP IS THE EXCEPTION.**

**We have had this number since last night and read it only as "map size."** It was in the same
artifact whose established-vs-swing split I used as a *control*. **The control was the finding.**

## 3. OUTSIDE S/R PRACTICE — corroboration, not authority

`[external-opinion]`: **audit on merit, adopt nothing on authority. No number below is imported and
none may be.**

- *"More lines does not mean more clarity — it means more noise."* · chart *"only the three to five
  most obvious, in-your-face"* levels ([Colibri Trader](https://www.colibritrader.com/how-to-identify-support-and-resistance/), [UEEx](https://blog.ueex.com/how-to-easily-identify-key-support-and-resistance-levels/))
- **Two touches is explicitly not validated:** *"A horizontal support or resistance level can be
  identified with just two touches… however, such a level is **not yet fully validated, as it might be
  coincidental or temporary**."* 3+ is treated as strong ([Strike](https://www.strike.money/technical-analysis/support-resistance), [QuantStock](https://quantstock.org/strategy-guide/support-resistance))
- **Filtering is a known dial:** *"Higher values (4-5 touches) produce fewer but higher-quality levels;
  lower values (2-3 touches) identify more potential levels."*
- **Zones not lines**, drawn between the reversal prices — **which is his rule exactly, and it is
  already ruled (ALGO-073) and already measured to 0.6 of a point.**

⇒ **Mainstream practice and his own teaching agree on the direction: a one-touch level is a candidate,
not a validated level, and a chart carrying dozens of them is noise.** **His bot carries 41 of them
per session.**

## 4. WHY THIS IS THE ANSWER TO A QUESTION WE HAVE ASKED ALL WEEK

**`avoid_chart_clutter` is the campaign's ONE confirmed taught-and-unbuilt clause** (`spec.json:67`,
read by no production code — ALGO-122A). **§2 is what unbuilt looks like in numbers.**

**And it reaches every symptom without needing any of the retracted stories:**
- **`meaningful` hardcoded `True` for the 15m family** (ALGO-122): with 62 zones, *"the first
  meaningful reaction"* is whichever clutter is nearest.
- **The four `TP1_REFERENCE_REWARD_UNDER_400` refusals**: a $180 destination is a zone a human would
  never have marked. **The bot did not fail to roll past it — it should not have drawn it.**
- **The bullet spent before 09:30 on 14 of 14**: 41 exceptional zones per session is 41 chances to
  qualify early.

> ## **HE DOES NOT HAVE A TARGET PROBLEM OR A TIMING PROBLEM. HE HAS A MAP WITH SIXTY-TWO LEVELS ON IT, TWO-THIRDS OF THEM FROM A ROUTE HIS OWN TEACHING CALLS EXCEPTIONAL.**

## 4a. 🛑 AND IT DISSOLVES THE `$400` CONFLICT WITHOUT A SINGLE QUESTION TO HIM

**The worker has just broken my reconciliation cleanly** — `processed_reaction_continuation` carries
**two** conditions, an interaction gate on the ZONE *and* a *"continuation story"* requirement on the
ENTRANT; and `video_evidence.md:81` makes **"continuation" a DEFINED TERM meaning the break branch**
(*"rejection/reclaim → possible **reversal**… break/acceptance → possible **continuation**"*). ⇒
**`target_policy.py:115` is FAITHFUL. No repair is available there without new teaching. RATIFIED.**

**So the conflict looked like his to settle. §2 says it is not.**

| | his map | the bot's map |
|---|---|---|
| is a `$180`-away reaction a ZONE? | **no — he would never have drawn it** | **yes — one of 41 exceptional zones that session** |
| so what does *"the first meaningful reaction"* resolve to? | a real level, farther out | **the nearest piece of clutter** |
| and the rule each applies | *"too close → not safe"*, which **never fires**, because his nearest zone is a real one | *"too close → BLOCK"*, which fires on clutter |

> ## **HE AND THE BOT ARE APPLYING THE SAME RULE TO DIFFERENT MAPS. HIS SENTENCE AND HIS CORPUS DO NOT DISAGREE — *"go to the next zone"* AND *"under $400 is not safe"* ARE BOTH TRUE WHEN THE THING AT $180 WAS NEVER A ZONE.**

**That is why he can say his files *"literally say trade the next one"* and be right, while the worker
reads the same block and correctly finds `BLOCK`.** **The $180 object is not the subject of either
sentence.**

⇒ **NO RESERVED-CLASS QUESTION IS OWED.** ALGO-142's, ALGO-149's and the `$400` conflict all reduce to
**one already-confirmed defect: `avoid_chart_clutter` is taught, in `spec.json`, and read by no
production code.** **Every open thread tonight lands on the same unbuilt clause.**

## 5. 🛑 WHAT IS **NOT** AUTHORIZED, AND THE TRAP IS OBVIOUS

**No cap. No touch-count threshold. No "3 to 5". No quality floor.** The outside figures are
**corroboration that the direction is real** — **importing one would be exactly the fitted magnitude
every rail in this campaign forbids**, and it would be fitted to numbers a stranger published.

**AUTHORIZED — measurement only, and it needs no new number:**
1. **Per session, the exceptional-vs-established split by key**, and **how many of his own marked
   levels fall in each.** *(His marked levels are day-level references — ALGO-083 — used here to
   locate, never to score.)*
2. **The `min_wick 0.20` and displacement-percentile provenance on the exceptional route** — **it is
   the gate that decides how many exceptions exist**, and ALGO-064 already measured `min_wick`.
   **Provenance only, in ALGO-087's form.**
3. **Report. Derive nothing. Propose nothing.**

---

**LESSON, minted:**

> **THE NUMBER WAS IN AN ARTIFACT WE BUILT LAST NIGHT AND USED AS A CONTROL. `established 287 / swing 578` WAS READ AS "THE SCOPE CONTROL HELD" AND NEVER AS "THE EXCEPTION IS TWO-THIRDS OF THE MAP."**

A control answers *did my change stay in its lane?* — and it is computed from exactly the population
that answers *is this lane the right size?* **Nobody asked the second question because the first one
passed.** **A control's denominator is a measurement nobody is looking at.**

**And he had to tell me to go and read the fundamentals of the thing he trades.** *"You are my
support and resistance maker"* — **the research took four minutes and it agreed with his own teaching
against the bot.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling. No external figure is adopted.*
