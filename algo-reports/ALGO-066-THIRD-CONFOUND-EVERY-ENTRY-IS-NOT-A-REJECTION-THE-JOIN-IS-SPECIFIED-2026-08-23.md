# ALGO-066 — Third confound, accepted: the join assumed every entry is a REJECTION; the plan of record says reject OR BREAK. Three of five rows are void — including the control and two findings of mine. The join is now SPECIFIED, not picked.

**Advisor:** Claude (Fable 5), ALGO seat. **Rules on:** the worker's M2b message (artifact
committed; no re-run yet). **Channel head at drafting:** `82195054` (ALGO-065, mine).
**PR #38: DRAFT / DO NOT MERGE — unchanged.** **DECISION: VOID (§1) + RETRACT (§2) + SPECIFY
the join (§3) + ORDER the re-run (§4) + HOLD on code (§5).**

## 1. What M2b showed, and what it voids [RELAYED — the artifact is committed; this desk will
re-derive the entry-bar distances on the re-run]

M2b's raw output: price never reached his marked line on 03-30 (96–216 pts away), 03-31
(70–219), or 04-14 the CONTROL (35–98). A trader does not mark a level 200 points from
where he is trading and then trade it — instrument error, and the worker tested it
mapping-free: distance from his ENTRY-clock bar to BOTH marked zones:

| session | dir | zone the join picked | distance | the OTHER zone | distance |
|---|---|---|---|---|---|
| 03-24 | L | SUPPORT 24192.125 | INSIDE bar ✓ | — | — |
| 03-30 | S | RESISTANCE 23609.125 | 183.6 pts ✗ | SUPPORT 23436.625 | 11.1 pts — price was HERE |
| 03-31 | L | SUPPORT 23311.875 | 104.9 pts ✗ | RESISTANCE 23436.625 | INSIDE bar |
| 04-06 | S | RESISTANCE 24421.625 | INSIDE bar ✓ | — | — |
| 04-14 | L | SUPPORT 25620.625 | 82.9 pts ✗ | RESISTANCE 25716.625 | INSIDE bar |

Cause: `ROLE_FOR_DIRECTION = {L: SUPPORT, S: RESISTANCE}` — an unstated assumption that
every entry is a rejection. ALGO-009's first contract line: *"price either genuinely REJECTS
the authorized key level or genuinely BREAKS the authorized key level."* On a break a LONG
interacts with RESISTANCE and a SHORT with SUPPORT. Half the taught strategy was
hard-coded out of the join.

**VOID:** 03-30 `LOCATION_NOT_IN_MAP` (measured 183 pts from his trade) · 03-31
`STORY_NOT_RECOGNIZED` (wrong zone) · the 04-14 control row, its `L3a` resolution and the
0.006-ATR margin (the band the machine had was under a level he was not trading) · M2/M2b
for those three. **STANDS:** 03-24 and 04-06 (correct zone, price inside the entry bar) — so
M2's TIMING finding (pivot at his level confirms +418 / +1223 min, disp 5.2 / 3.1) is
unaffected on exactly the two sessions it flagged; the exam verdict, A1/F2 and the lost set
(no zone join enters them); the line-vs-band question, still open with the operator.

**And M2b is now a FINDING, not a null:** 03-30 he SHORTED 11 pts below his SUPPORT; 03-31
and 04-14 he LONGED with price INSIDE his RESISTANCE. Three of five are BREAK entries —
the Route B/D family — while the whole location lane tested them as rejections, and the
story lane asked the machine for a rejection story at a level he was breaking.

## 2. Retractions by this desk

- ALGO-064 §1 / ALGO-065 §1: **"the 04-14 control's band is a pre-market 07:45 swing that
  happened to sit under his rejection level — the accident shape"** — RETRACTED. The
  covered level was one he was not trading.
- ALGO-064 §4: **"the lone agreement is fragile (0.023 wick / 0.006 ATR)"** — RETRACTED as
  stated; whether 04-14's REAL level (RESISTANCE 25716.625, a break-long) is covered, and by
  what margin, is unmeasured until §4 runs.
- ALGO-063 §2(a) was already retracted in ALGO-065 §1b. Two retractions in two rulings on
  one join are the reason §3 exists.

## 3. THE JOIN IS SPECIFIED — J1–J6, no seat picks a fourth assumption

- **J1 Level selection by geometry, not by role.** For each session, at his labelled
  entry clock, test BOTH `trader_zones` against the entry bar's [low, high] on his marked
  timeframe: a zone INSIDE the bar range is selected; if neither is inside, the nearest by
  points is selected AND the distance is reported; if BOTH are inside or both within the
  frozen 17.25 pts, **report both — ambiguity is a row state, never a pick.**
- **J2 Record the role of the selected zone** (SUPPORT/RESISTANCE) as data.
- **J3 Derive the interaction from role × direction, never assume it:** LONG@SUPPORT and
  SHORT@RESISTANCE = REJECT; LONG@RESISTANCE and SHORT@SUPPORT = BREAK. This is ALGO-009's
  own dichotomy applied mechanically; a row that fits neither (e.g. entry far from both
  zones) is `UNCLASSIFIED_INTERACTION`, published, not forced.
- **J4 The story lane asks the matching family:** REJECT rows are read against Route A's
  rejection story; BREAK rows against the B/C/D breakout family (and the BRK15 variant) at
  his clock — with `routes_asked` / `route_refusals` recorded. A refusal of the wrong family
  is not a refusal.
- **J5 The location lane uses the SELECTED zone's line for now** and carries the distance
  from the nearest machine band on every row, so the operator's pending line-vs-band answer
  can be applied by arithmetic without re-running the mapping.
- **J6 Controls, both directions:** 04-14 re-run under its selected zone (RESISTANCE,
  break-long) is the positive control for "the map covered his level"; 03-24 (no covering
  band, price inside bar) is the negative control. If 04-14's real level is NOT covered, the
  lane has no positive control — say so; do not promote another row into one.

## 4. ORDER — re-run the location lane, the story lane and M2/M2b under J1–J6, one artifact

For all five sessions: selected zone + role + derived interaction + distance-to-bar ·
map coverage at 09:30 and at marked_time with nearest band + gap · nearest causal pivot and
nearest pivot-at-price (M2) · candle geometry at marked_time and at entry clock (M2b) · the
story-lane verdict against the MATCHING family with sub-reasons · the census-vs-at-clock
disagreement flag. Classifier fixture from ALGO-062 §2.2 extended with a BREAK-entry
witness (a long at resistance must not be classified against Route A). Nothing else changes;
no code; ALGO-063 §4 guard and ALGO-065 §3 guards stand; the operator's line-vs-band answer
is applied to J5 when it lands.

## 5. HOLD / queue

Re-run under J1–J6 (one committed artifact) → advisor re-derives the entry-bar distances
and reads 04-14 under the correct zone → operator's line-vs-band answer applied → (a)
level-rule derivation resumes on the corrected rows → ALGO-067 rules the repairs
(location and/or story, per family) → repairs → re-exam under the SAME rules → grade →
FREEZE or another round.

LESSON: an unstated mapping is an unchallengeable assumption — write every join key as data
in the row, and let ALGO-009's own dichotomy (reject OR break) be the classifier, not a
default.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any
decision in this ruling.
