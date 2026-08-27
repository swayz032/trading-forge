# Your MNQ strategy, written out in order — please read it and mark what is wrong

**This is a transcription, not a proposal.** Every line below is something you said, or something
taken from your own screenshots, videos and replay labels. **Nothing here was invented.** Where a
line has no source, it does not appear as a rule — it appears in the **What nobody wrote down**
section at the end, as a question for you.

**Why this document exists.** Everything you have taught is recorded — but it is recorded as
*evidence*. Each file answers *"did he say this?"*. **Nothing until now answered *"what is the
method, in order?"*** So every engineer who worked on the bot rebuilt that order privately in
their head, and several got it wrong in ways nobody could see. This is the order, in one place,
with a source on every line. The five files it was assembled from are listed at the end.

---

## How to read this

| mark | meaning |
|---|---|
| `[source]` | where the line comes from. **A line with no source is not written as a rule.** |
| **UNSPECIFIED** | nobody ever wrote this down. **The bot is doing *something* here and no one can check it.** These are questions for you. |
| **DIVERGENT** | your recorded words and the running code **disagree**. Both are printed. Nobody has resolved it, and this document does not resolve it either. |

**Your words are quoted exactly, misspellings and all.** That is deliberate — it keeps them
checkable against the original.

**If a line is wrong, cross it out.** A wrong line here is worth more to us than a missing one,
because a wrong line can be corrected in one pass and a missing one costs another week.

---

## What you have confirmed — and what you have not

**On 2026-08-26 the method below was read back to you and you said: _"thats correct."_**

**That confirmation is recorded here at the scope it actually had, and no wider.**

| | |
|---|---|
| **RATIFIED 2026-08-26** | this section was represented in the read-back you confirmed |
| **NOT CONFIRMED** | this section was **not** part of that read-back. It is still sourced and still cited — it has simply never been in front of you |

**Three limits on the stamp, stated so nobody later reads it as more than it is:**

1. **What was read to you was a COMPRESSED rendering of the method, not this file.** So the stamp
   marks a **section** as represented — it does **not** mean every sentence inside it was read
   aloud. A detail inside a ratified section may still be wrong, and crossing it out is exactly as
   welcome as before.
2. **NOT REPRESENTED — THE CITATIONS. None of them, anywhere, were read to you.** You confirmed **the rules**.
   You did **not** confirm that each one is sourced where this document says it is. **Every
   `[source]` in this file is unverified by you**, and a rule you confirmed could still be
   attributed to the wrong place.
3. **Confirming section 9 is not answering it.** You confirmed that those seven things are
   genuinely unspecified — which is real information, because it means **they are gaps in what has
   been written down, not gaps in our reading of you.** **You answered none of the seven, and
   nothing here treats them as answered.**

**All three DIVERGENT blocks were read to you with both sides printed.** So where your method and
the running code disagree, **the code is now known to be the wrong one** — not because anyone
argued it, but because you confirmed the method. **Nothing has been changed in the code on the
strength of that**, and no repair has been authorized.

---

## 1. The order of the decision

**RATIFIED 2026-08-26** — represented in the read-back.

This is the spine. Everything else hangs off it.

> `PREMARKET → CAUSAL KEY-LEVEL MAP → PRICE REACHES ZONE → CLASSIFY REJECT / RECLAIM / BREAK /
> RETEST → CANDLE STORY + CONTROL → ROOM TO NEXT MEANINGFUL DESTINATION → FIRST A+ ONLY`
>
> `[video_evidence.md:108]`

The same order appears twice more in your evidence, in the same shape —
`[video_evidence.md`, header`]` and `[unified_fidelity_evidence_registry … semantic_crosswalk]`.

**One trade. The first A+ setup of the session, and no more.**
`[video_evidence.md:100 "first A+ only, and one trade maximum"]` ·
`[trader_fidelity_addendum … preserved_invariants: maximum_one_strategy_trade_per_session]`

**And your setup itself is already frozen, in one line, as three things that must all be there:**

> **location + candle story + sustained force**
> `[trader_fidelity_addendum … preserved_invariants:165
> "location_plus_candle_story_plus_sustained_force_required"]`

Everything in sections 4 to 6 is those three, spelled out. **If that line is wrong, nothing below
it is right** — so it is the first thing to check.

---

## 2. The map — which levels are on the chart

**RATIFIED 2026-08-26** — represented in the read-back.

**Support and resistance key level zones. That is the level family.**
`[semantic_crosswalk.market_map: "Structural support/resistance only as the regular level
family"]`

A level earns its place two ways, and **either** is enough:

1. **Repeated rejection.** *"Multiple independent reactions/wicks strengthen a key level."*
   `[video_evidence.md, principle 2]`
2. **A major swing followed by a decisive move away.** *"A major swing high/low followed by
   decisive displacement can create a meaningful candidate level even before many later retests
   exist."* `[video_evidence.md, principle 3]`

**Not on the map:** previous day high/low and previous week high/low. Forbidden as strategy
levels. `[market_map: "PDH/PDL/PWH/PWL are forbidden"]` ·
`[conflict_resolution … superseded: PDH_PDL_PWH_PWL_as_strategy_levels]`

**Don't cover the chart in levels.** *"Support/resistance should not be drawn everywhere; too many
levels create noise."* `[video_evidence.md, source 6]` — the map should hold the levels near
enough to matter, while keeping farther ones as places price can travel to.
`[video_evidence.md, principle 10]`

**On a ranging morning, don't mark fresh zones tight against the range.** Put them where price has
room to break out and travel before it reaches them. `[gold fixture V24G07]`

**A 15m fair value gap can act as a level** when price is actually treating that band as the
structure — but being an FVG is never by itself a trade, and not every FVG is an entry zone.
`[direct_trader_rules.fvg_support_resistance_interaction]`

> ### ⚠️ DIVERGENT — how wide a zone is
>
> **You said:** *"i take a key zone with a wick and i draw the zone from the top of the wick to
> where the xandle closed"* — the zone runs from the rejection candle's wick tip to that same
> candle's close, on the timeframe you marked it. `[ALGO-073 §1, your words]`
>
> **The bot does:** draws a symmetric band centred on the level instead, a fixed small width
> either side. It has never drawn your shape.
>
> This was checked against your own zone-marking demonstration and your rule matched to **0.6 of
> a point on both edges**, while the rival reading missed by **19 points**. Your shape was built
> once and then removed again for an unrelated reason. **It is still not what the bot draws.**

---

## 3. Price reaches a zone — and the zone is classified

**RATIFIED 2026-08-26** — represented in the read-back.

**This is one question with one answer, not a menu.** When price arrives at a zone, what happened
there is *identified*:

> *"A level is an **inflection point, not a prediction**. The same area can reject, reclaim,
> break, accept, or later flip role."* `[video_evidence.md, principle 5]`
>
> *"after price reaches a zone, the engine must **classify the interaction**: rejection/reclaim →
> possible reversal…; break/acceptance → possible continuation through the zone."*
> `[video_evidence.md, source 7, adopted rule 3]`

**Touching a level does not force a trade.** Touching support does not make it a long; touching
resistance does not make it a short. `[source 7, adopted rule 2]`

**A level only changes role after real acceptance** — a wick poking through does not permanently
turn resistance into support. `[video_evidence.md, principle 6]` · `[source 7, adopted rule 5]`

> ### ⚠️ DIVERGENT — the bot treats this as a contest, not a classification
>
> **Your words:** classify the interaction. One zone, one reading.
>
> **The bot does:** when a rejection and a break both qualify in the same direction at the same
> moment, it **ranks** them and **the break always wins** — your zone rejection is ranked last of
> three. `[kernel.py:205]`
>
> **Nothing in anything you have said ranks one against the other**, because your method never
> puts them in competition. This is being measured now.

---

## 4. Entry — a rejection at the zone

**RATIFIED 2026-08-26** — represented in the read-back.

> *"A key-level rejection entry can be two momentum candles, doji then momentum, pinbar then
> momentum, inside bar then momentum, or shrinking candles heading into the key level, rejection,
> then a reverse momentum candle. **Rejection by itself is not enough.**"* `[gold fixture V24G01]`

Three things must be there: an authorized key zone · a rejection or control story · a directional
momentum trigger. `[V24G01 must_have]`

**Must not:** enter on the rejection alone without momentum · demand displacement on every
rejection entry. `[V24G01 must_not_do]`

**A reclaim needs defence.** Price sweeping below support and closing back above is only the
*start* — buyers must show they are holding it. **A doji reclaim is not an A+ trade.**
`[source 7, adopted rule 4]` · `[video_evidence.md, principle 7]`

**A pattern away from a zone has no authority at all.** `[video_evidence.md, principle 1]`

---

## 5. Entry — a break of the zone

**RATIFIED 2026-08-26** — represented in the read-back.

**The first candle through the level is a setup, not an entry.**

> *"When price first prints beyond a key level, that first print is not the entry by itself; a
> following momentum candle can confirm. If the initial break is weak, price may pull back and the
> trader checks the 15-minute chart for a three-bar continuation entry."* `[gold fixture V24G05]`

In detail, and this is your own clarification:

- the first completed 5m candle beyond the zone is **setup only**
- **long:** the very next forming 5m must trade **above that breakout candle's high** and prove
  sustained bullish force
- **short:** the mirror — **below its low**, sustained bearish force
- momentum **without** taking that extreme → **wait, no entry**
- **do not wait for a 15m close** once a valid 5m continuation is there

`[direct_trader_rules.normal_breakout_second_candle]` · `[semantic_crosswalk.normal_breakout]`

### The two exceptions — and there are exactly two

Both are about **entering early**, before the break has finished printing. Neither is a different
setup. `[preserved_invariants: only_two_prebreak_early_entry_exceptions]`

**Exception 1 — the third candle of a displacement drive.**
> *"One of only two pre-break exceptions: genuine displacement drives toward the key level; the
> trader watches the THIRD candle of that displacement drive while it is forming and may enter
> before its 5-minute close only after sustained directional force is proven near the key level.
> If the third candle loses/reverses control, no early entry. FVG formation is irrelevant and is
> not required."* `[gold fixture V24G03]`

**Exception 2 — a repeat attack on a level already tested.**
> *"The other pre-break exception: after the level has already been tested, price can return and
> attack/test it again with breakout momentum; that momentum attack can authorize entry before a
> completed candle has printed beyond the key level."* `[gold fixture V24G04]`

**Not allowed:** an early entry on an ordinary strong candle · an early entry on a first approach
that has never been tested · continuing when the third candle loses control.
`[V24G03 / V24G04 must_not_do]`

**Break-and-retest is a normal zone interaction** — broken resistance, accepted, retested as
support, becomes a long location, and the mirror for support. `[video_evidence.md, principle 9]` ·
`[source 7, adopted rule 6]`
**NOT REPRESENTED** — this line was left out of the read-back entirely. It is sourced, and you have
not confirmed it.

---

## 6. Pressing the button — force

**RATIFIED 2026-08-26** — represented in the read-back.

> *"I watch the forming momentum candle like a tug of war to see whether the force is real before
> I enter. Price can push up/down while the candle is alive. **If I waited until the 5-minute
> candle closed I would often enter too late.** My stop is 17.25 points, so late entry creates too
> much drawdown risk. Enter while the candle is still forming only after sustained directional
> force is proven; do not enter merely because it temporarily looks like a strong candle."*
> `[gold fixture V24G08]`

- **5m is your chart** for entries and candle patterns. `[direct_trader_rules.execution_chart]`
- **1m is not a pattern timeframe** — the bot uses it only to reconstruct what happened inside a
  5m candle. A 1m pattern gets no vote. `[direct_trader_rules.one_minute_pattern_vote_forbidden]`
  · `[superseded: treating_1m_as_trader_pattern_timeframe]`
- **15m** is higher-timeframe context plus the separate weak-break three-bar continuation path.
  `[direct_trader_rules.fifteen_minute_role]`
- **A temporary burst is not force.** Give-back counts against it. `[V24G08 must_not_do]`
- **Never decide force using the finished candle, or the next one.** Only what was on the screen
  at the moment of entry. `[V24G08 must_not_do]`

**Strong momentum is not the same thing as displacement.** *"Every strong move is not
displacement. There are strong bullish and bearish momentum candles that are not displacement."*
`[gold fixture V24G02]`

---

## 7. The target

**RATIFIED 2026-08-26** — represented in the read-back.

**THERE IS A LADDER. You take more than one target.**
`[trader_fidelity_addendum … direct_trader_rules.tp_ladder.labels = ["TP1", "TP2",
"TP3_OR_NEXT_MEANINGFUL_REACTION"]]` · `[tp_ladder.multiple_directional_tps_allowed: true]` ·
`[three hash-bound multi-target screenshots]`

**NOT REPRESENTED** — this was **not** read to you. Everything below it about TP1 was, and every
line of it was correct, **but the ladder itself was missing from the page, so there was nothing
for you to confirm or correct.** It is written here now so you can.

**How many contracts come off at each rung, and in what proportion, is NOT written down anywhere**
— see section 9. Nothing above says it, and nothing here invents it.

---

**The nearest meaningful reaction owns TP1** — whichever of these physically comes first:
a structural support/resistance reaction · a 5m liquidity/reaction cluster · an active 15m FVG.
`[semantic_crosswalk.target_hierarchy]` · `[direct_trader_rules.tp_ladder.allowed_destination_families]`

> *"The liquidity cluster appeared before the FVG, price reacted there and did not need to trade
> into the farther FVG. **Whichever meaningful reaction area appears first owns TP.**"*
> `[gold fixture V24G06]`
>
> **NOT REPRESENTED — the rule above was read to you; THIS SENTENCE OF YOURS WAS NOT.** You
> confirmed the rule in someone else's words. **Whether these are still your words is unchecked.**

- **A farther target may not be chosen just because it pays more.**
  `[tp_ladder.farther_target_cannot_be_chosen_merely_for_more_profit]` ·
  `[V24G06 must_not_do: skip_nearer_cluster_for_farther_fvg]`
- **If the FVG owns the destination, the target is its midpoint.**
  `[direct_trader_rules.fvg_midpoint_tp]`
- **Under $400 at the reference size, the entry is not safe** — that is 13.33 points at 15 MNQ.
  `[tp_ladder.too_close_rule]` · `[semantic_crosswalk.tp_safe_gap]`
- **A close TP1 is not skipped just because a farther one exists.**
  `[tp_ladder.no_blind_rollover]` · `[superseded: automatic_1_5R_close_TP1_rollover_to_TP2]`
- **It becomes skippable only once that area has actually been worked through** — a repeat-test
  continuation, a completed break follow-through, or a weak-break pullback continuation.
  `[tp_ladder.processed_rollover_rule]`
- **Don't trade into a strong nearby opposing level.** The next meaningful reaction area is the
  natural destination, not a fixed reward multiple. `[video_evidence.md, principle 12]` ·
  `[source 7, adopted rule 7]`

> ### ⚠️ DIVERGENT — the ladder is in your evidence and NOT in the file the bot loads
>
> **Your files say it:** `tp_ladder.labels`, `multiple_directional_tps_allowed: true`, three
> screenshots.
>
> **`current_mnq_strategy_v2_4_spec.json` — the file the code actually reads — says nothing.**
> Measured: `tp_ladder` 0 · `TP2` 0 · `TP3` 0 · `multi_target` 0 · `ladder` 0, against a positive
> control of `target` = 7 in the same file, so the search works.
>
> **This is a different kind of gap from the others in this document.** Elsewhere the code
> disagrees with you. Here **there was never anything for the code to disagree with** — the rule
> never reached the specification the loader reads, so no loader and no test could have missed
> it. **Nothing is proposed. It is recorded so it stops being invisible.**

---

## 8. Risk and limits

**RATIFIED 2026-08-26** — represented in the read-back.

- **Stop: 17.25 points.** `[preserved_invariants: 17.25_point_stop]` · `[V24G08 risk_context]`
- **One strategy trade per session, the first A+.**
  `[preserved_invariants: maximum_one_strategy_trade_per_session]` · `[video_evidence.md:100]`
- **WAIT is not NO TRADE.** If you were still waiting when a replay ended, you were waiting — that
  is not a decision not to trade. `[direct_trader_rules.wait_semantics]`
- **No zone is ever redrawn using candles that had not printed yet.**
  `[video_evidence.md, principle 13]` · `[source 7, adopted rule 8]`

> ### ⚠️ DIVERGENT — the trading window, and it is stale in TWO places
>
> **Your 2026-08-20 evidence says 9:30, in two separate documents:**
> `09_30_to_12_00_America_New_York_execution_window`
> `[trader_fidelity_addendum … preserved_invariants:164]` · *"9:30–12:00 ET window"*
> `[video_evidence.md:100]`
>
> **You then changed it yourself.** On 2026-08-23 you reasserted **08:00–12:00** and showed why —
> a zone rejection firing at 08:50 that a 9:30 start erases entirely. **That is what runs today:**
> `TRADE_START = 08:00`, `LAST_ENTRY = 12:00` `[v2_2_engine.py:43-44]`.
>
> **So the two 08-20 lines are superseded, not contradicted — by you.** They are printed here
> because they are still sitting in your files saying 9:30, and anyone reading those files cold
> would believe them. **Neither file has been edited and neither will be.** Your evidence is kept
> exactly as you said it; the correction is recorded beside it, not over it.
>
> **One thing that is NOT stale, so nobody "fixes" it later:** 9:30 is still in the code, doing a
> different job — it is the moment the day's zone map is drawn. That was left alone on purpose,
> because moving it would change **which zones exist at all** `[v2_2_engine.py:40-42]`. **The
> trading window moved. The map anchor did not.** Two different uses of the same clock time.

---

## 9. What nobody wrote down — UNSPECIFIED

**RATIFIED 2026-08-26 AS A LIST OF OPEN QUESTIONS.** You confirmed these are genuinely unspecified. **You have answered none of them, and none is treated as answered.**

**These are the questions. The bot is doing something in each case and no line of yours decides
it.** No number below was chosen by you; each was chosen by somebody building the bot.

1. **How a level's "quality" is scored.** The bot scores every candidate level with a weighted
   formula — seven ingredients on one path, five on another — and **not one of those weights
   appears in anything you have said.** Your evidence names *what* matters (wick, how far price
   moved away, where the candle closed, how tight the reactions are, how far apart in time, how
   recent, how many touches). **It never says how much each one counts.** That score decides
   which levels are allowed on the chart at all.
2. **How near two reactions must be in time to count as separate.** The bot uses a fixed interval.
   You never named one.
3. **How strong a momentum candle must be.** Two numbers decide whether a candle counts as
   momentum on every break entry. **They were removed from the rejection path once already,
   because you said they were not yours — and they are still deciding every break.**
4. **Which trade wins when two different zones both qualify at the same minute, in the same
   direction.** Your words cover one zone at a time. Nothing says which zone wins.
   `no citation found in the surfaces named`
5. **How many levels is too many.** Your evidence says avoid clutter and it is written into the
   bot's settings as a rule — but **no code reads it.** It is declared in one file and checked by
   one test, and all that test does is confirm the file says so.
   **The bot currently carries about 62 zones per session. You carry a handful.**
   Drawing your wick-to-close zone instead of the bot's own shape cut that to about 37 — the only
   thing that has ever moved it — but that change was undone the same night for an unrelated
   reason, so **62 is what runs today.**
6. **What "meaningful" means for a destination.** It is defined for one kind of target and simply
   assumed true for the other two.
7. **How the ladder is split.** Your files say there are three rungs and that more than one
   directional target is allowed. **They do not say how much comes off at each, or in what order
   the size is reduced.** The bot currently plans one target. **Nobody has written the rest down,
   and nobody should invent it.**
8. **Where the 17.25-point stop is measured from.** The distance is yours and is confirmed. Its
   *placement* relative to the zone is in no artifact — and on several entries a stop that far from
   the fill lands **inside the zone the trade was taken at**, so the zone's own width can take the
   trade out without the read being wrong.

---

## 10. The one thing the bot does that none of the above authorizes

**SUBSTANCE REPRESENTED IN SECTION 3 — THIS SECTION WAS NOT READ.** There was no heading answering your question. But the mechanism below **was** read to you, inside section 3's DIVERGENT block, with `kernel.py:205` named: *"when a rejection and a break both qualify, it ranks them and the break always wins; your zone rejection is ranked last of three."* **So you have seen the finding. You have not seen it written out this way.**

**When your zone rejection and a breakout both qualify at the same moment in the same direction,
the breakout wins — every time — because of a three-line ranking nobody derived from anything you
said.** `[kernel.py:205]`

Measured on your six sessions where the bot traded, **every single one of its entries was a
breakout-family entry.** Not one was a zone rejection.

**Your words:** *"I HAVE THE SAME STRATEGY LITERRALT SUPPORT AND RESISTENT KEY ZONES I TRADE OFF
MY SETUP AND ITS ONLY 2 EXCEPTIONS TO MY SETUP ITS LIKE WE KEEP GOING IN CIRCLES WHY IS THE BOT NOT
GOING OFF MY SETUP."*

**That is the answer to your question.** It is one dictionary in one file, and it has been there
the whole time.

---

*No profit, loss, win/loss outcome or backtest result was used anywhere in producing this
document. Sources: `research/current_mnq_strategy_v2_4_video_evidence.md` ·
`research/current_mnq_strategy_v2_4_user_fidelity_gold.json` ·
`research/current_mnq_strategy_v2_4_trader_fidelity_addendum_2026_08_20.json` ·
`research/current_mnq_strategy_v2_4_unified_fidelity_evidence_registry_2026_08_20.json` ·
`research/current_mnq_strategy_v2_4_kernel.py`.*
