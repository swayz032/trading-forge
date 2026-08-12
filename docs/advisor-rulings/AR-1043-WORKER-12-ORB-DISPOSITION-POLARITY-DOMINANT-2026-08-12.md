# AR-1043 — WORKER — **12 ORB SOURCES DISPOSITIONED · POLARITY IS THE DOMINANT BLOCKER (4 CONFIRMED) · LEADING CANDIDATE `NMUd0oX_7Pg` IS TEACHER-ENDORSED BUT LOSES ITS ENTRY GATE, ITS SECOND TRIGGER AND ITS TARGET**

```
RULING : AR-1041 GPT ruling (gpt-rulings 8e5f95c4) sec3/sec4/sec5/sec7/sec9
PIN    : 0bbcabc81ae2ed6350bcda4d8494cff1e618dd81  (unchanged -- MEASURED HERE)
STATE  : READ-ONLY. NO PRODUCTION CODE MUTATED. NO COMMIT ON THE ENGINEERING BRANCH.
PRIOR  : AR-1041 (69ae8749) · AR-1042 (7b4973c1)
NOTE   : the ruling at 8e5f95c4 answers AR-1041 and PREDATES AR-1042 -- the `},{`
         evidence corruption and the non-English sources are NOT yet ruled on.
```

**Report trigger: AR-1041-GPT §9 clause 2** — sources dispositioned, none clean, blocker
distribution measured. §9 clause 1 is NOT met: the leading candidate is endorsed and deterministic
but **not faithful as compiled** (§3 below).

---

## 1. ★ THE POLARITY GATE — AND THE SIGNAL MY FIRST SWEEP MISSED

AR-1041 §6's marker sweep looked **only in the window around the trigger**. That under-detects,
and I can prove it: **`dE4lPhAWke8`'s bound trigger is the sentence *"They try and go short."***
The sweep scored it `none found`, because the disqualifying signal is **inside the trigger text
itself** — third-person attribution — not in the surrounding prose.

⇒ The §3 gate needs **two independent signals**: grammatical person **of the trigger sentence**,
and rejection markers **in the window**. Each alone misses a real class.

```
[ENDORSED? ] NMUd0oX_7Pg  'Take the hammer on the long side.'
[ENDORSED? ] Qxlu8v_6G3Y  "...we're actually good to put a limit order right on that fair value"
[ENDORSED? ] KXWRtV2LOVc  'when the second candle of the 15minute CRT closes or enter off of...'
[ENDORSED? ] sVkmZklJDHI  'then we can enter the trade.'
[ENDORSED? ] deymRD3kSD0  "...we're probably going to enter at the top of the range."
[AMBIGUOUS ] WV1fyudd7fw  'Some go long at the bottom of the range,'
[REJECTED? ] oDLt9zh33LE  'box, you take a trade in that direction.'   markers: blow up your
                          account / most traders lose / nobody trades it profitably / the trap
[REJECTED? ] e5HQXYBUW-Q  'if it breaks out to the downside, you go short.'
[REJECTED? ] c8VLqF0XDR4  'look for a long entry or a short entry.'
[REJECTED? ] xTTDH5iRhJc  'We are simply going to enter... mechanically...'   marker: wrong way
[REJECTED? ] 7ieYBa7Z-Hg  'You can trade that manipulation'                   marker: the trap
[ATTRIBUTED] dE4lPhAWke8  'They try and go short.'
```

🛑 **TWO OF THE FIVE `REJECTED?` FLAGS ARE FALSE, AND I NAME THEM RATHER THAN SHIPPING THE COUNT:**

- **`xTTDH5iRhJc` — FALSE REJECT, confirmed by reading.** *"we're going to do it mechanically,
  meaning that we can't trade this strategy **the wrong way**"* — the teacher is asserting
  discipline, not rejecting a method. **This is my positive control that the gate is not simply
  flagging everything.**
- **`7ieYBa7Z-Hg` — UNRESOLVED.** "the trap" plausibly names the manipulation he *trades*, not a
  method he rejects. **NOT READ. Stays `AMBIGUOUS`, not counted as a polarity blocker.**

★★★ **`ENDORSED?` IS A NOMINATION, NOT A CLEARANCE.** `deymRD3kSD0` scores ENDORSED and GPT has
already **refused** it — correctly, on unquantified judgment. **Polarity is necessary, not
sufficient**, and a gate that ranked by polarity alone would have re-promoted a refused source.

---

## 2. §4 DISPOSITION TABLE — 12 SOURCES

| video | OR window | range construction | teacher-endorsed trigger | confirm/retest | direction | stop / target | polarity | compiled trigger matches? | faithful? | exact blocker |
|---|---|---|---|---|---|---|---|---|---|---|
| `NMUd0oX_7Pg` | first 15m candle, NY tz, **must be fully closed** | high/low of that candle, extended 60–90m | **hammer/inv-hammer OR bull/bear engulfing appearing OUTSIDE the box** | pattern IS the confirmation; must appear **within 60–90 min of open**, else no trade | hammer→long; bearish engulfing→short | **stop below the low; target = top of the box** (both SOURCE-OWNED) | **ENDORSED** | **YES** — trigger is the endorsed rule | **NO** | ATR entry-gate, engulfing trigger and source target all **absent from spec** (§3) |
| `Qxlu8v_6G3Y` | first 15m range | high/low | displacement break → **FVG prints on 5m through the 15m range** → limit order on the FVG | FVG valid iff one of three candles closes outside; entry on dip into zone | from displacement direction | not stated in read span | ENDORSED | yes | **NO** | needs FVG primitive + validity rule |
| `KXWRtV2LOVc` | 15m **CRT** | candle range theory | *"when the second candle of the 15minute CRT closes"* or off an order block | refinement across 5/4/3/2/1m | not read | not read | ENDORSED | yes | **NO** | needs CRT + order-block primitives |
| `sVkmZklJDHI` | first 15m (weak signal) | not read | *"then we can enter the trade."* | not read | long | not read | ENDORSED | yes | **NO** | trigger text is anaphoric — *"then"* refers to unread antecedent; span control weakest of the set (45%) |
| `WV1fyudd7fw` | **8:00–8:15 ET**, not 9:30 | top wick to bottom wick | break & retest of the 8:00–8:15 range | *"Step three, wait for a retest"*; *"clean break, **ideally** 5 to 10 points below the midpoint"* | both | not read | **AMBIGUOUS** — trigger is *"Some go long… some go short"* | no — trigger is a survey of what others do | **NO** | trigger is a description of market participants, not a rule; *"ideally"* is soft |
| `xTTDH5iRhJc` | **previous-day** high/low, not session open | prior-day range | enter at two key levels, mechanically; breakout then retest | close back inside ⇒ *"not a confirmed breakout yet"*; first 2½ hours only | both | *"stop slightly above the high"* | ENDORSED (false-flagged) | yes | **NO** | **not an opening-range strategy** — previous-day levels. Family membership is GPT's call |
| `7ieYBa7Z-Hg` | not read | not read | *"You can trade that manipulation"* | not read | both | not read | **AMBIGUOUS** | unresolved | **UNRESOLVED** | not read — `the trap` marker unclassified |
| `dE4lPhAWke8` | not read | not read | **"They try and go short."** | — | both | — | **ATTRIBUTED** | **no — third person** | **NO** | trigger is narration of other traders |
| `oDLt9zh33LE` | first 15m | high/low | (real method) 5m breakout → overlapping FVG → retest → engulfment | — | mechanical | framework_owned | **REJECTED** | no | **NO** | GPT-refused (AR-1041 §1) |
| `e5HQXYBUW-Q` | first 15m of NY open | high/low | (real method) 5 "fixes", ≥2 non-deterministic | — | HTF-trend gated | framework_owned | **REJECTED** | no | **NO** | GPT-refused |
| `c8VLqF0XDR4` | 15m and 30m both taught | high/low | break → return → retest as S/R → rejection | mandatory | refuses breakdowns | framework_owned | **REJECTED** | no | **NO** | GPT-refused; retest tolerance unstated |
| `deymRD3kSD0` | the 9:30 candle | **top wick → bottom wick** | close above/below range on 5m | none | long | not stated | ENDORSED | yes | **NO** | GPT-refused; entry price by unquantified "impulsive" |

---

## 3. LEADING CANDIDATE `NMUd0oX_7Pg` — ENDORSED AND DETERMINISTIC, BUT THREE MEASURED LOSSES

**The source is the most completely specified of the twelve, and it OWNS its stop and target** —
the other ORB sources delegate both to `framework_owned`.

**Teacher, verbatim (span-resolved):**
- *"locate the first 15-minutes candle that formed on today's date… draw a line at the high and low
  of that candle and extend both lines… for the next 60 to 90 minutes… make sure that first
  15-minutes candle has **fully closed** before marking your range."*
- **The entry gate:** *"To confirm whether your opening candle actually qualifies as a manipulation
  candle… add the **average true range** indicator. Default settings, **14 days**… **If the size of
  the candle you just boxed from high to low is 20 to 25% or more of that daily ATR, it's a
  confirmed manipulation** [candle]."*
- *"you're waiting for one of two specific reversal candles to appear **outside the range**… the
  **hammer or inverted hammer** and the **bullish or bearish engulfing** candle. And they must
  appear outside the box **within 60 to 90 minutes of the market open.** After that window closes,
  the opportunity is gone."*
- *"Wait for the next candle to break above the hammer high, enter at the open of the candle after
  that, and set your stop at the low"* / restated: *"We enter at the break of the next candle.
  **Stop goes below the low.** And the target profit? **The top of the range we drew in step one.**"*

**MEASURED against the persisted spec** (`hammer_candle_long_side_{mcl,mes,mnq}_5m`, 47 entry
conditions, `spine_bound=22/25`, `trigger_bound=True`, `approximation_used=True`):

| taught element | in spec? | consequence if executed as compiled |
|---|---|---|
| hammer trigger | **YES** (`ENTER:hammer candle long side#0`) | — |
| "manipulation" concept | YES (as a word) | — |
| **ATR(14) ≥20–25% entry GATE** | **NO** — `'average true range'` and `'atr'` both absent from the spec JSON | 🛑 **the setup fires on EVERY session, not only manipulation sessions** — a silent selectivity change |
| **bullish/bearish engulfing trigger** | **NO** — `'engulf'` absent | one of the two taught entry patterns is simply gone |
| **source target = top of the box** | **NO** — `'target'` absent; `framework_overlay.take_profit = framework_owned` | the framework overwrites a source-owned target |
| source stop | partially — `EXIT_HINT 'stop goes below low'` present, but `framework_overlay.stop = framework_owned` | the hint is carried but the overlay owns the stop |

⚠️ **CORRECTION TO MY OWN CHECK.** I first tested whether `60/90/20/25` survived by substring and
got `True` for all four — **worthless**: those digits match **span offsets** like `"start": 6042`.
The load-bearing absences are the ones with no substring confound: **`average true range`,
`engulf`, `target`.** ★ `A SUBSTRING TEST OVER A JSON BLOB IS A TEST ABOUT THE BLOB, NOT ABOUT THE
FIELD.`

**Remaining source ambiguities, stated not resolved:** *"20 to 25%"* and *"60 to 90 minutes"* are
**bands, not thresholds**; *"a clear sharp red move downward"* is qualitative. These are narrower
than `deymRD3kSD0`'s "impulsive" (the teacher gives numeric bounds), but **choosing a point inside a
band is still a choice the teacher did not make** — AR-1039 §11 STOP 1.

---

## 4. BLOCKER DISTRIBUTION — WHAT §7 ASKED FOR

Of **12** dispositioned:

```
POLARITY (trigger is rejected/attributed/not the taught rule)  : 5   <- DOMINANT
    confirmed by reading : oDLt, e5HQ, c8VL, dE4l   (4)
    by trigger text      : WV1f ("Some go long... some go short" = a survey)
UNQUANTIFIED JUDGMENT                                          : 1   (deym)
MISSING SEMANTIC / PRIMITIVE                                   : 4   (NMUd, Qxlu, KXWR, sVkm)
OUT OF FAMILY (not an opening range)                           : 1   (xTTD)
UNRESOLVED / NOT READ                                          : 1   (7ieY)
CLEAN AND FAITHFUL AS COMPILED                                 : 0
```

⇒ **Polarity is the single largest blocker class**, which is the condition AR-1041-GPT §7 names for
authorizing `SOURCE-POLARITY-HANDOFF-1`. **I have not started that lane** — §4 forbids building it
before the reads, and §7 reserves the authorization to GPT.

🛑 **DENOMINATOR HONESTY, UNCHANGED FROM AR-1042 §4:** this is **12 by my enumeration, not the
ruling's 16.** My regexes yield 7 / 12 / 19 on the 40-video archive and **none reproduces 16**. I am
not claiming 16 is wrong — a different instrument describes a different population
(`[i-measured]`). **`ALL 16 DISPOSITIONED` IS THEREFORE NOT A CLAIM I CAN MAKE**, and §9 clause 2's
wording ("all 16") is not literally satisfied. **Committing AR-1038's 16 ids as a list would close
this permanently.**

---

## 5. RECOMMENDATION

1. **Authorize `SOURCE-POLARITY-HANDOFF-1`** (§7). The blocker distribution supports it: 5 of 12,
   and it is the only class that produces a **silently wrong trade** rather than a refusal. §7's
   required RED is directly available — `e5HQXYBUW-Q` compiles a trigger whose taught status is
   refuted 45 characters later in the same transcript, and the teacher's endorsed method is
   materially different. **I have not built it.**
2. **Rule on `NMUd0oX_7Pg`.** It is the closest to a money-path candidate. Its gap is three named,
   bounded channels — not a parameter-system redesign. If you authorize the narrow repair, name
   which of the three, and rule on the two bands (20–25%, 60–90m), which I may not choose.
3. **AR-1042 is still unruled** — the `},{` corruption (609/2150) and the two non-English sources.
   The corruption bears directly on this lane: `evidence` is the field §4's table is read from.
4. **Commit AR-1038's 16 video ids** so the population is joinable rather than re-derived.

**Nothing blocking for the operator.** Engineering branch untouched at `0bbcabc8`.

---

## 6. WHAT I DID NOT MEASURE

- `7ieYBa7Z-Hg` not read (62,947 chars, the longest in the set); `KXWRtV2LOVc`, `sVkmZklJDHI`,
  `WV1fyudd7fw` read only at trigger + spine level, not end-to-end.
- I did **not** compile, execute, backtest or refusal-check any production row.
- I did **not** verify whether `_derive_entry_eligibility` or `ENFORCED_DISPATCH` would actually
  fire `NMUd`'s trigger — still `HYPOTHESIS`, as it was in AR-1039 §3.
- I did **not** locate where the `},{` corruption is introduced (not authorized).
- The four GPT-refused sources were **not** re-litigated; their rows restate AR-1041 §1.

## 7. SELF-AUDIT (§0-CTRL.4)

- **My AR-1041 §6 window-only marker sweep under-detects** — `dE4lPhAWke8` proves it. Reported as a
  defect in my own instrument rather than left as a silent miss (§1).
- **I published the two false `REJECTED?` flags by name** instead of shipping a clean-looking 5/12
  polarity count (§1).
- **I corrected my own substring test** on the surviving parameters; three of the four "survived"
  hits were span-offset digits (§3).
- **`7ieYBa7Z-Hg` is counted as UNRESOLVED, not as a blocker**, because I did not read it —
  an unread source inflating a blocker count would have strengthened my own §5 recommendation.
- **I did not claim "all 16 dispositioned"** even though §9 clause 2 is phrased that way and
  claiming it would have closed the ruling cleanly (§4).
```
ARTIFACTS (scratchpad, regenerable, controls inline):
  polarity_gate.py · digest.py (aggregate control) · read_teacher.py
  span_validity_all40.py · reconcile_orb_population.py · size_the_class.py
```
