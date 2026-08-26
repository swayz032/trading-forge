# ALGO-102 — The map is measured, and the taught clause it violates is quoted at the line: **`STRONG_DISPLACEMENT_AWAY_FROM_SWING` is SECONDARY evidence that "cannot bypass all other quality/context checks"** — yet in code it is an independent admission path supplying **54–84% (median 66%)** of the structural entry map. And T-A is **REFUTED with a better answer**: his take-profit is **not made of different material** — it is a destination the bot itself enumerated, sitting at **rank 4, 7, or 17** while the bot always takes **rank 0**. He trades through a **median of 5.5 destinations (max 21)**. The operative word in his own TP rule is **MEANINGFUL**, and the machine's notion of it is over-inclusive for the same reason the map is.

**Advisor:** Claude (Fable 5), ALGO seat — `trading-forge-49`. **Rules on:** the advisor-owned
T-lane measurement @ `6888112d` (`…/a96/tlane/target_provenance_2026_08_26.{json,md}` +
`level_map_census_2026_08_26.json`, 97.1 s), read in full here; its citations re-verified at the
line at this desk. **Channel head at drafting:** `28951b8c`. **Main head:** `c62bb561e015`,
untouched. **PR #38: DRAFT / DO NOT MERGE.** **Does not disturb the in-flight T3″ guard**
(ALGO-101A); this lane is queued behind it and ALGO-103 rules that packet.

---

## 1. THE MAP, MEASURED [ARTIFACT-SOURCED; citations MEASURED HERE]

| what | measured |
|---|---|
| entry-authorized locations per session | **50–69**, median **64** |
| distinct bands once intraday FVG interaction bands count | **61–90**, median **84** |
| share of the structural map admitted by the **EXCEPTIONAL single-swing** path | **54–84%, median 66%** |
| quality score: fraction of all 1,114 pooled locations in `[0.62, 0.86]` | **89.9%** (median 0.7306, floor 0.5628) |
| locations with confluence 0 | **966 of 1,114 (86.7%)** |
| RTH 5m bars intersecting ≥1 live authorized level | median **76%** (range 19–94%); ≥2 levels: median **33%** |
| `_range_room_authorization` deauthorizations across all 14 sessions | **0** — a taught rule that never fires |

**The operator's "price is always at a level" is confirmed at the bar:** three quarters of every
five-minute bar in the session is standing inside at least one authorized zone. **And quality does
not discriminate** — nine tenths of the map scores inside a 0.24-wide band on a 0–1 scale, which
is a membership test wearing a sort key's clothes (`[self-certifying-collections]`).

## 2. THE TAUGHT CLAUSE IT VIOLATES — quoted, and violated at the line

> `video_evidence.md`, *"Adopted into v2.4 because it agrees with the trader's own rules"*:
> **1.** *"`REPEATED_REJECTION` is **primary** evidence of a 15m S/R zone."*
> **2.** *"`STRONG_DISPLACEMENT_AWAY_FROM_SWING` is allowed as **secondary** evidence for a
> candidate zone, **but cannot bypass all other quality/context checks**."*

`spec.key_level_semantics` says the same in structure: `primary_quality_evidence` =
*multiple_independent_rejections_or_wick_reactions · repeated_support_or_resistance_behavior ·
clear_reaction_cluster*; `strong_displacement_away_from_swing_high_or_low` is listed under
**`secondary_quality_evidence`**.

**In code these are two INDEPENDENT admission paths.** The established path requires
`len(independent) >= 2` (`v2_2_engine.py:479-480`) then `core.valid_location`. The exceptional
path (`levels.exceptional_single_swing_zones`) admits a location on **a single swing plus
displacement**, gated by `min_wick`, an absolute-ATR floor and a Q75 percentile — the three
values ALGO-064 measured as **UNTAUGHT constructions**. **Secondary evidence is not merely
bypassing "all other quality/context checks"; it is supplying two thirds of the map by itself.**
This is the campaign's signature pattern for the fourth time: a taught clause whose only
implementation is an untaught magnitude — and here the clause is not weakly implemented, it is
**inverted**.

## 3. T-A REFUTED — and the replacement finding is stronger

| clause | measured | verdict |
|---|---|---|
| (ii) the bot's TP1 is a refinement kind | **2 of 6**; the rest `KEY_ZONE_15M` ×2, `FVG_15M`, `LIQUIDITY_CLUSTER` | **REFUTED** |
| mechanism: the pick is inside/adjacent to the entry structure | the bot's TP1 is **never inside his entry zone** | **REFUTED** |
| (iii) he trades through ≥1 destination | **6 of 6** — min 1, **median 5.5**, max **21** | SUPPORTED |
| (i) his TP is a distinctive feature class | 4 of 6 match (a)/(c)/(e) — **but the null control voids the read** | UNDER-DETERMINED |

**The null control is the methodological save of this report:** calibrated against a 1-tick price
grid, a prior swing sits within 2.0 pts of the **bot's own TP1 on 5 of 5** sessions. Feature class
cannot discriminate anything on this instrument, and a report that had skipped the calibration
would have "found" that his targets are swings.

**What is true instead — the single most important row:** *on every session where the bot chose a
TP1 it chose the **rank-0** destination, the physically nearest reaction ahead of the fill*, while
**his TP is rank 4, rank 7, rank 17** — a destination **the bot itself enumerated**. His TP is not
made of different material. **The question was never WHAT counts as a destination; it is WHICH one
is TP1.** His median $1,984 vs the bot's $1,268 on the five it priced.

**And that is not a contradiction of his own taught rule — it is the word `MEANINGFUL`.** His rule
reads *"The nearest **meaningful** physical S/R reaction, liquidity/reaction cluster, or active FVG
owns TP1. No farther feature may leapfrog it merely for more room."* Both halves are his. The bot
honours the second half exactly (`no blind rollover`, measured correct on 04-09) and fails the
first, because **its notion of "meaningful" is the same over-inclusive admission that built the
map.** One defect, both layers — ALGO-100D's thesis, now measured on both sides.

**The $400 floor is not the constraint:** it binds on **1 of 6** sessions (04-09, rank-0 worth
$382.50). ALGO-100D's 04-09 case stands as a case; it is not the general mechanism.

## 4. THE LANE — L3, and the pre-registration is written before anything is built

**AUTHORIZED, report-first, after the T3″ packet resolves (ALGO-103 rules that; this is ALGO-104's
subject):**

**L3a — DERIVATION (worker main seat, teachings only).** Express, from §2's citations alone, what
it means for secondary evidence not to bypass the primary checks. The plain reading, stated now so
it can be refuted like every other clause has been: **a location admitted ONLY by secondary
evidence is not ENTRY-authorized; it may remain as context and as a target destination.** One
clause per citation; **no number is chosen** — if the derivation cannot be expressed without a
new magnitude, it says so and the lane closes to a reserved-class operator ask.
**Required a-priori check before any guard, on fixtures written from the words:** a level with two
independent rejections is admitted · a level with one swing + displacement and no rejection
history is NOT entry-admitted but survives as a destination · a level with one swing that later
earns a second independent rejection IS admitted · the 04-14 control's own entry zone
(`SWING:R:2026-04-14T09:15…102865`) is checked and its admission path reported **before** any
guard runs. **If the control's zone is admitted only by secondary evidence, say so in the
derivation — that is a finding about the control, not a reason to soften the clause.**

**L3b — GUARD, pre-registered conjunctively, and the primary observable is STRUCTURAL:**
1. **Map size is the headline**: distinct authorized locations per session, before → after,
   all 14 sessions. Expected direction: a large reduction. **No target size is set** — a specific
   number would be a fitted number.
2. Control 04-14 by key **and** target; its decision clock reported.
3. Sessions silenced: **reported, not required** — a smaller map may legitimately silence a
   session, and any silenced session is listed with the level that vanished and its admission path.
4. His seven entry sessions: does a level survive at the zone each of his entries actually used?
   **Reported by key, never required** — L3 is a map repair, not an entry-recovery repair.
5. TP1 movement: for all seven, the chosen TP1 before → after, with its rank in the surviving
   universe. **Expected direction only**: TP1 moves outward. **No distance target is set.**
6. Every number states its horizon (ALGO-100D §4). No PnL, no EDGE artifact, no 2026-label input.
7. **Out-of-sample structural validation on the 10-year NQ tape** (ALGO-100D §5): the map-size
   distribution per session across ~1,650 sessions, before → after. The 14 sessions may falsify
   L3; they may never select it.

**THE ANTI-OVERFIT RAIL, restated because this lane is where it matters most:** the operator
ordered *"make sure dont overfit"*. **This clause is chosen from §2's two sentences and from
nothing else.** Not from map size, not from his seven trades, not from any backtest number, and
not from what would make the exam pass. If the derivation and the a-priori fixtures do not force
it, it does not land.

## 5. Also recorded

The T-lane's `_range_room_authorization` finding (**0 deauthorizations in 14 sessions**) is a
second taught rule with no measured effect — **named, not opened**; it is not this lane's subject
and no seat may repair it without its own derivation. The T-lane's honest limit is adopted as this
ruling's: **nothing here establishes that any particular level is one the operator would not
recognise** — that needs his eye or a cited machine-checkable predicate, and §2's citation is the
first such predicate this campaign has found for the map.

LESSON: three lanes hunted for a *difference in kind* between his choices and the machine's — a
different form, a different feature class, a different destination family — and the measurement
says there is none. **He picks the same objects, further down the same list.** The defect was
never in what the machine can see; it is in what the machine is willing to call meaningful.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.
