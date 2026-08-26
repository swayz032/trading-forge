# ALGO-100D — THE OPERATOR'S OWN DIAGNOSIS, MEASURED AND CONFIRMED AT THE LINE. One defect explains every symptom this campaign has chased: **the level map is chart clutter**, and both the entry layer and the destination layer are drawn from it. Measured today: on 04-09 his LONG was refused because the "first meaningful reaction" was a `LIQUIDITY_CLUSTER` **11.75 points away = $352.50**, under his own $400 floor — while **his actual take-profit was destination #3 at $690**. Same zone, opposite direction, 42 points of clear air: approved. The floor is his rule working correctly on a destination universe he would never recognise. Plus a silent instrument truncation that has shaped every membership number in this campaign.

**Advisor:** Claude (Fable 5), ALGO seat — `trading-forge-49`. **Rules on:** the advisor-owned P409
probe @ `62722a2a` (`…/a96/p409/trace_0409_downstream.{json,md}`, 213.5 s) + the operator's
volunteered teaching (§1) + this desk's own label measurement (§2). **Channel head at drafting:**
`602318c5`. **Main head:** `c62bb561e015`, untouched. **PR #38: DRAFT / DO NOT MERGE.**
**Does NOT disturb the in-flight S3/T3 batch** — ALGO-101 still rules that packet.
**Numbering:** 100D, so ALGO-101 stays reserved for the S3 ruling.

---

## 1. NEW TEACHING, ON THE RECORD, VOLUNTEERED (the reserved class — his own trading)

> *"i trade 15 contracts micros i only risk 517$ which is 17.25 points"* · *"my trades average
> $2,000 and highest days are $3500-5,000"* · *"even at a 38 win rate the bot must not be
> targeting good key levels as support and resistence and not jumping in the trades at good
> times"* · *"make sure dont overfit"* — operator, 2026-08-26, unprompted.

This is **not** a replay marking and ALGO-083 does not bar it: it is a fact about his own trading
that no artifact records, which is exactly the class reserved to him. **It re-opens the TARGET
layer, which ALGO-087 closed as having "no live conviction" — there is now a live conviction, and
it is his own statement.**

## 2. HIS STATEMENT, CORROBORATED FROM FROZEN DATA HE HAS NOT SEEN [MEASURED HERE]

His six marked TP distances (labels joined to his fills): **33.0, 35.5, 57.25, 75.0, 329.25,
454.75 points** → **median 66.1 pts = $1,984 at 15 MNQ**, mean 164 pts. He said **$2,000**. The
median of his own frozen markings agrees with his memory **to within $16**, and the median is
**3.83R** against his 17.25-pt stop. The bot's realized winners: **20.68 pts = $620 (1.16R)**;
its chosen targets average 30.3 pts. **He aims 3.2× farther than the bot exits.** Two independent
sources, one number.

**The arithmetic that reframes the whole EDGE lane:** at 1.16R and 38% wins the bot is
−0.18R/trade — precisely the losing backtest. At his 3.83R geometry the same 38% is +1.3R/trade,
and even a 25% hit rate is positive. **The bot has been taking his setups and banking a quarter
of his trade.**

## 3. WHY — MEASURED AT THE LINE ON 04-09, AND IT IS THE OPERATOR'S DIAGNOSIS

At his 11:37 LONG (entry 25135.00) the destination ladder is:

| # | kind | distance | $ at 15 | clears $400? |
|---|---|---|---|---|
| **1** | **`LIQUIDITY_CLUSTER` on a `WICK_ZONE`** | **11.75 pts** | **$352.50** | **NO — short by $47.50** |
| 2 | `KEY_ZONE_15M_REFINED_LIQUIDITY_CLUSTER_5M` | 19.00 | $570 | yes |
| 3 | `KEY_ZONE_15M_REFINED_LIQUIDITY_CLUSTER_5M` | 23.00 | $690 | yes |
| 4 | `FVG_15M` | 38.75 | $1,162 | yes |

**His own marked TP (25157.25) is destination #3 — 22.25 pts from that fill, inside the frozen
2.0-pt tolerance.** The trade is refused at `target_policy.py:164` with
`TP1_REFERENCE_REWARD_UNDER_400:352.50:LIQUIDITY_CLUSTER:WICK_ZONE`.

**Everything in that chain is his taught rule working correctly.** The $400 floor is his
(ALGO-086/087, `trader_fidelity_addendum:101-144`). "No blind rollover" is his — destination #2
clears $400 and is deliberately NOT taken because `_current_candidate_processed_reaction`
(`target_policy.py:108-119`) grants rollover only to an earned continuation, and a REV story earns
none. `nearby_strong_blocker_may_not_be_silently_skipped` is his. **The rules are right. The
DESTINATION UNIVERSE they are applied to is wrong** — an 11.75-point liquidity cluster on a wick
zone is `low_quality_chart_clutter` (`spec.negative_semantic_fixtures[22]`), and his own spec
refuses using such a thing as an A+ location.

**The contrast is the control** [MEASURED]: the SHORT at 11:27 on the **same zone** has 42 points
of clear air to a real `KEY_ZONE_15M` → **$1,260, 3.15× the floor → APPROVED**. Identical zone,
identical rules; the only difference is whether the direction of travel runs into clutter. **The
plan/direction layer is NOT involved** (`plan_allows_v24` = True; no direction conflict).

**And the same map produces the timing symptom.** At a single 5-minute clock the bot evaluates
**8 / 72 / 269 / 85 / 95 candidate locations** across the convicted sessions; the level map holds
~85-90 authorized locations per side per session. With ninety levels on the chart, *price is
always at a level* — so the bot fires at 08:12 on whichever it touches first (S2: on six of seven
entry days the first approval precedes his clock by **80-187 minutes**; on 04-14, the one day it
agrees with him, the session has **exactly one approval** all day). **ONE DEFECT, BOTH SYMPTOMS:
the map is clutter, so entries are early and destinations are near.**

**Taught, and never implemented** — his spec carries the refusal verbatim:
`negative_semantic_fixtures[22] = low_quality_chart_clutter_level_used_as_A_plus_location` ·
`active_map_policy.avoid_chart_clutter = true` · `prioritize_relevant_nearby_levels = true` ·
`recent_levels_receive_more_relevance_but_recency_alone_is_not_sufficient = true` ·
`primary_quality_evidence = multiple_independent_rejections_or_wick_reactions ·
repeated_support_or_resistance_behavior · clear_reaction_cluster`. **This is the third instance of
the campaign's signature pattern** (after T3 and the momentum-after clause): a taught clause whose
only implementation was an untaught magnitude — here ALGO-064's measured `min_wick 0.20` /
1.0-ATR floor / Q75 on the *exceptional* single-swing admission path, which is what floods the map.

## 4. INSTRUMENT FINDING — a silent horizon truncation under every membership number

`run_approved_entry_membership_capture.py:52` passes **`as_of = manifest replay_end`**; the
candidate-table instrument (`run_algo096_candidate_table_six_clocks.py:104`) passes **`as_of=None`**.
On 04-09 `replay_end = 11:35` = his own entry clock, so the capture **cannot construct** an 11:37
candidate: `decision_times` and `_bucket_starts` both filter `index + 1min <= as_of`, emptying the
bucket (measured: 89 records at `as_of=None`, **0** at `as_of=11:35`, 83 at `as_of=11:37`).
**No refusal literal is emitted — the candidate silently never exists.** So every approval count
in this campaign (40 · 143 · 111) is measured on a **session-dependent horizon that ends when he
stopped watching the replay**, and this desk's ALGO-100C §2 attribution of that zero to S2 alone
is **corrected: S2 reproduced the capture's own convention.** RULED: (a) every membership claim
states its horizon; (b) the two instruments' horizons are named side by side in the S3 packet;
(c) the exam's horizon convention is settled in ALGO-101 — `replay_end` is a property of the
labelling session, not of the market, and a fidelity claim about "his clock" may not be truncated
by it without saying so.

## 5. THE LANE — ORDERED, WITH THE ANTI-OVERFIT PROTOCOL HE DEMANDED

**L1 — LEVEL-MAP CENSUS (advisor-owned, running).** Distinct authorized zones per session at
09:30 and at his clock, by source kind and by **admission path** (established: ≥2 independent
rejections — taught; vs exceptional: single swing + displacement on untaught magnitudes), the
quality/confluence distributions, and how many zones sit within 30 points of price. Counts and
classifications only — no threshold, no rule.
**L2 — TARGET PROVENANCE (advisor-owned, running).** For each of his seven entries: the full
destination ladder, whether his TP is in it and at what rank, **how many destinations he traded
through**, and the feature classification of his TP vs the bot's TP1 (2.0-pt frozen tolerance).
**L3 — THE REPAIR, derived from §3's citations ONLY, ruled after L1/L2 land.** Expected shape,
stated now so it can be wrong: the taught level-quality gate admits a level on *demonstrated
repeated reaction*, the exceptional path stops flooding the map, and the destination universe
inherits the same admission — so TP1 becomes the next real structure rather than the nearest
clutter. **No repair is authorized in this ruling.**

**ANTI-OVERFIT PROTOCOL — operator-ordered *"make sure dont overfit"*, binding on L1-L3:**
1. Every clause derives from a quoted teaching line; **no number without a citation**, and any
   residual magnitude is declared UNTAUGHT in a module-local `UNFROZEN_CHOICES` rather than tuned.
2. **Nothing is selected by how it scores on the 14 sessions or his 7 entries** — those are the
   fidelity *exam*, and choosing against them is fitting to the test.
3. **Out-of-sample validation is the 10-year NQ tape** (2018 + 2020-2026, ~1,650 sessions, already
   running in the EDGE lane), never the 14.
4. Acceptance is **pre-registered before any number is read** (the sequencing that made this
   desk's own `C1∨C2` error cheap on ALGO-100C).
5. The primary observable is **structural, not scored**: the map goes from ~90 levels to a
   handful, and TP1 moves from "nearest of ninety" to the next independent structure. **A win-rate
   or PnL improvement may never be cited as evidence for a fidelity clause** (ALGO-020/064 stand;
   the EDGE lane remains firewalled and advisory).

STOPS unchanged, plus: no change to the $400 floor, to the rollover rule, or to the room rule —
**they measured correct today**; the repair is to what counts as a level and as a destination.

LESSON: the operator looked at a 38% win rate and said the bot must be at bad levels and bad
times. Three measurements — his own TP median, the 04-09 destination ladder, and the level
count — all say he was right, and his own frozen spec already contained the refusal. **The
campaign spent four rounds sharpening predicates over a map nobody had counted.**

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling. The EDGE-lane arithmetic in §2 is reported as CONTEXT for the operator and is cited
by no fidelity clause.
