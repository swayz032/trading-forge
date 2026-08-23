# ALGO-065 — M2 verified: on two of the four days NO threshold reaches the level he traded (the only qualifying pivot is hours in the FUTURE). The quantitative 2025 path is dead on custody facts. The weaker path is ruled — with the guards that keep it from becoming a fit to the exam.

**Advisor:** Claude (Fable 5), ALGO seat. **Rules on:** M2 at strategy head `443fea42`
(`…m2_pivot_timing_2026_08_23.json` + `run_m2_pivot_timing_vs_marked.py`, rows read by this
desk) and the worker's extractability verdict. **Channel head at drafting:** `f79446ae`
(ALGO-064, mine). **PR #38: DRAFT / DO NOT MERGE — unchanged.**
**DECISION: ACCEPT M2 with one correction of reading (§1) + ACCEPT (b) is dead (§2) + RULE the
(a)+(c) path with guards (§3) + PRE-REGISTER the repair shapes (§4) + HOLD on code (§5).**

## 1. M2 at the rows [MEASURED HERE at `443fea42`]

| session | nearest CAUSAL pivot (available at his marked_time) | nearest pivot AT his price, any time |
|---|---|---|
| 03-24 | 24193.5, 1.38 pts, t 01:15 / confirmed 02:00 (−452 min), wick 0.038, disp 1.798 → fails `min_wick` | 24189.25, 2.88 pts, t **15:45** / confirmed 16:30 (**+418 min**), wick 0.562, disp 5.245 |
| 04-06 | 24421.25, 0.38 pts, t 03-25 23:30 / confirmed 03-26 00:15 (−16417 min), wick 0.243 (passes), disp 1.476 (fails) | 24421.00, 0.62 pts, t 04-07 05:30 (**+1223 min**), wick 0.554, disp 3.138 |
| 03-30 | 23611.0, 1.88 pts, t 03-27 11:30 / confirmed 12:15 (−4160 min), wick 0.589, disp 1.474 → fails displacement | same pivot (confirmed before he marked) |

**What is PROVEN:** on 03-24 and 04-06, every pivot causally available at his marked minute
fails the map's quality bar, and the only pivot at his price that clears every gate
comfortably (disp 5.2 / 3.1, wick 0.55) confirms seven hours and a day LATER. **No
threshold reaches the level he traded** — loosening `min_wick` admits the weak 0.038
overnight pivot plus unrelated levels and still misses his. The worker's reading of this is
correct and its M1 row for 03-24 stands unretracted (min_wick IS operative among causal
pivots; M2 says why no good causal pivot exists). **What is NOT yet proven, and the ruling
refuses to adopt on the strength of a future pivot:** that "his level IS the in-progress
rejection." The 15:45 low is not what he saw at 09:32 either. Two structures existed at
09:32 on 03-24: an overnight 01:15 pivot 1.4 pts away (weak by the engine's metric) and the
15m candle(s) just completed at 09:30. Which of those his `VISIBLE_REJECTION` on the 15m
refers to is answered by CANDLE GEOMETRY, not by pivots — the second half of ALGO-064 M2,
still owed:

**M2b (ordered):** for all five sessions, the OHLC of the candle(s) at his `marked_time` on
his marked timeframe (03-24: the 09:15–09:30 15m bar; 04-06: the 09:45 15m bar; 03-30/03-31:
the 5m bars into 09:35; 04-14: the 09:30 5m bar) relative to his level — did price trade
into it and close away (a rejection visible on that bar), and by how much — plus the same at
his ENTRY clock. This is the row that decides TIMING vs "overnight structure the engine
discards", and it decides the story lane too (03-31 MERE_APPROACH_WITHOUT_TOUCH, 04-06
TOUCH_WITHOUT_DIRECTIONAL_CONTROL: ALGO-009 itself says "a touch alone is never rejection
authority" — the machine's refusal may be CORRECT per the teaching, in which case the
trader's entry rode a different story that the candle geometry will show).

## 1b. CONFOUND — the labels record a LINE, the teaching shows BANDS. L2 is not robust; a clause of mine is retracted.

The worker stopped mid-derivation to report it, correctly. Measured [RELAYED, consistent
with this desk's own label read in ALGO-063 §2]: all 28 `trader_zones` in the frozen labels
are ≤ 7.25 pts wide — 24 of them ONE TICK (0.25). The pinned teaching shows him drawing
BANDS: ALGO-052 ~32 and ~22 pts; ALGO-050 ~19 and ~30 pts; ALGO-051 ~4 and ~8 pts — and
ALGO-050's own caption records BOTH "drawn band + level line 29,521.75". So the label schema
captured his LINE; whether a band went unrecorded is unknown. The location join used the
line. Sensitivity: 03-24's nearest machine band sits 27.53 pts ABOVE his line, 03-30's
26.52 pts BELOW — **both inside the 4–32 pt band range the teaching shows.** If his real zone
on those days was a band of the size he draws, the machine may have HAD a covering location
and the class moves to STORY or GATE.

**Rulings:** (i) `LOCATION_NOT_IN_MAP` on 03-24 and 03-30 is CONFOUNDED — no map repair may
be ruled on it. (ii) M2 is UNAFFECTED (pivot confirmation timing does not depend on zone
width); the exam verdict, F2 and the lost set are UNAFFECTED (scorecard rows, no width
join). (iii) **This desk RETRACTS ALGO-063 §2 fact (a)'s instruction "join on the label, not
the vocabulary"** — the label captured the line, so joining on it under-measures coverage;
the instruction contributed to the confound. (iv) The worker is right not to pick a width
that makes the machine overlap after seeing that 27.5 would — that is the goalpost move by
definition, and the width is exactly the magnitude ALGO-064/065 say must come from the
teaching or from him. (v) **Line-vs-band is a fact about what he does at the chart — not
recorded in any held artifact, not a request for historical evidence (ALGO-022 stands), and
therefore the FIRST use of §3.2: one plain question to the operator.** Until answered, (a)
holds on the level-definition clause it turns on; M2b proceeds (it reports distance from
the line, which is informative under either answer).

## 2. (b) is dead — on custody facts, accepted [RELAYED from the custody receipts; consistent with this desk's own search]

1. **No 2025 bar data in custody** (data lock: 5m/1m 2026-01-20..04-15; tick from 03-09).
   Without candles, wick/displacement/rejection metrics on 2025 zones cannot be computed at
   all — this alone kills the quantitative arm.
2. **No held video of the Apr–2025 replay sessions.** Item 5 (3h53m) is UNENUMERATED under a
   standing ban ("may NOT be cited for any specific rule until enumerated"); item 4 is one
   31.8s clip registered for 1m-vs-5m decomposition only. Not re-opened here: with no 2025
   bars, enumeration would still yield nothing measurable.
3. **The 2025 ledger's own receipt forbids it:** "may NEVER select a strategy rule, a
   threshold, or a parameter." Honoured as written. The worker's refusal to argue around it
   is the correct call.
So ALGO-064 §3(b) is void; §3(a)+(c) proceeds, DECLARED the weaker path. Six drawn zones
give a qualitative envelope of what he draws a level ON — nothing in (a) can produce a
defensible magnitude, and none will be invented.

## 3. The (a)+(c) path — guards that make it survivable

1. **Publish (a) BEFORE any 2026 run.** The derived level rule lands as an ALGO report:
   one clause per teaching citation (ALGO-009 source words · the six pinned screenshots);
   magnitudes only where the teaching shows candle geometry; **every clause with no
   citation marked UNRESOLVED, not filled.** This desk checks each clause against its
   citation before (c) is authorized.
2. **UNRESOLVED magnitudes are resolved by nobody who has seen the 2026 rows** — both seats
   have. They go to the OPERATOR as ONE plain-language question about his own decision rule
   (a fact about his intent that no artifact records — reserved-list legitimate; it is not a
   request for historical evidence, which ALGO-022 closed). Until answered, the clause stays
   qualitative or the rule stays unlanded.
3. **(c) runs ONCE** on the published rule: membership of the five marked levels (recall),
   count of newly admitted levels vs the current map's 53/69 (precision, reported, not
   thresholded), the ALGO-063 §4 guard (08:00-arm forbidden-in-window entries 24 → 6 may
   not rise; no new pre-window grant; by membership), 04-14 kept by membership, and the
   flip-margin report. **A second version of the rule is legal only if it cites a teaching
   clause the first misread — never a 2026 outcome.**

## 4. Pre-registered repair shapes (so the M2b answer picks one, not the other way round)

- **If M2b shows a visible rejection on his bar at his level (TIMING):** the location layer
  gains a causal, in-session admission path — a level born from a live rejection on the
  taught timeframe, entering the map at that bar's close, with the taught story still
  required for entry. Semantic change to kernel/location; own red-proof; mutation arms
  green; ALGO-063 §4 guard binding; one-bullet budget untouched.
- **If M2b shows his level sits on overnight/prior structure the quality bar discards
  (MAGNITUDE on 03-24 as well as 03-30):** the repair is the level DEFINITION from (a) — what
  counts as prior structure — not a threshold nudge; and 03-30's 0.6-ATR displacement miss
  is judged under the derived definition, not tuned.
- **Story lane (03-31, 04-06):** ruled only after M2b's candle rows; if the teaching supports
  the machine's refusal, the case moves to the trader's story being a different taught form
  the derivation lacks — a derivation-layer repair, not a gate loosening.

## 5. Queue / HOLD

**Operator question #1 (asked on screen by this desk, plain words): when you mark a key
zone, is the bot looking for a single price line or a band — and how do you decide how
wide the band is?** His answer is a teaching clause with a citation; it lands in (a) and
re-runs the location join under the answered definition. M2b (candle geometry, five
sessions, both clocks) proceeds now → (a) published with citations →
advisor clause check → operator question for any further UNRESOLVED magnitude → (c) once →
ALGO-066 rules the repairs (location lane + story lane) → repairs → re-exam under the SAME
rules → grade (operator-authorized) → FREEZE or another round. No code until ALGO-066.

LESSON: a future pivot proves that no threshold could have reached his level; it does not
prove what he saw — read the candle at his minute before naming the mechanism.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any
decision in this ruling.
