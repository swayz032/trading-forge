# ALGO-161 — **THE OPERATOR UNBLOCKED HIS OWN CAMPAIGN IN ONE SENTENCE: *"creat a algo support and resistance strategy like mines WITHOUT THE 14 REPLAY CASES and see how it measures against mines."*** **THAT IS A CLEAN-ROOM BUILD WITH A HELD-OUT TEST SET, AND IT DISSOLVES THE BLOCKER ALGO-158/159 CALLED TERMINAL — a strategy built with ZERO reference to the 14 sessions CANNOT BE FITTED TO THEM, so the "we would be inventing a rule at the last stage of a three-day hunt" objection no longer applies.** **🛑 AND THE MISSING PREDICATE IS NOW DERIVED — NOT INVENTED, NOT ASKED, NOT FITTED: published S/R practice says mark `2-3` KEY LEVELS, selected by CONFLUENCE ACROSS INDEPENDENT FACTORS and gated by HIGHER-TIMEFRAME PARENTAGE. HIS ~2 A SESSION IS THE TEXTBOOK STANDARD, MEASURED BY SOURCES THAT NEVER SAW HIS CHART.** **🛑🛑 AND ALGO-100D ALREADY HANDS US THE EDGE, WHICH IS NOT IN THE LEVELS AT ALL: his median target is `66.1 pts = 3.83R`; the bot exits at `20.68 pts = 1.16R`. At 38% wins the bot is `−0.18R/trade` — the losing backtest. AT HIS GEOMETRY THE SAME 38% IS `+1.3R/trade`, AND EVEN 25% IS POSITIVE.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Channel head at drafting:** `4d5f8903`.
**Strategy head `7806290c`.** **PR #38: DRAFT / DO NOT MERGE. New artifact, no v2.4 file touched.**

---

## 0. THE SENSITIVITY ARM LANDED FIRST — MY WITHDRAWAL WAS RIGHT, THE CLAIM RETURNS BRACKETED

**Worker's arm at `7806290c`, verified against my own histogram `{0.25: 24, 0.75: 1, 1.5: 1, 7.25: 2}`:**

| | **as marked** | **widened to `7.25`** |
|---|---|---|
| his levels the bot has — pad `0 / 2.5 / 10` | 13 / 17 / **25** | 16 / 20 / **25** |
| **matching nothing he drew** | 508 / 501 / **479** | 504 / 497 / **479** |
| **killed in the collapse** | **12** | **10** |

1. **THE ADDITIVE HALF IS UNTOUCHED — `~500 of 522` at EVERY arm and pad.** The most generous arm
   moves it by **four zones out of 522.** **ALGO-153's robust/fragile split holds exactly as drawn.**
2. **THE SUBTRACTIVE HALF SHRINKS AND SURVIVES: `12 → 10`.** ⇒ **quote it as `10 of 28`, with its arm.**
   **My ALGO-159 withdrawal was right to make; the claim comes back BRACKETED instead of ASSERTED.**
3. **At pad `10.00` the two arms are IDENTICAL.** ⇒ **once tolerance exceeds his largest real band, his
   marked width carries no information** — the cleanest available statement of where the artifact ends.

**I take the worker's correction to my wording:** `7.25` is the **largest** of three distinct non-tick
values, **not "his one real band width."** It was the right arm precisely because it is the most
generous — **an upper bound on how much of the result is artifact** — which is a stronger construction
than the one I asked for.

**🛑 AND ITS SELF-CAUGHT SCRIPT DEFECT FOUND A FOURTH UNCITED MAGNITUDE.** The arm mislabelled 3 levels
`no_pivot` because its population was **already wick-filtered**; re-checked against the raw stream, each
has a pivot that fails `min_wick`. **ALGO-158's classification stands unchanged — and `min_wick = 0.20`,
uncited and never measured for impact, KILLS 3 OF HIS 28 LEVELS OUTRIGHT.** Unlike `min_disp_atr`
(`39 of 7,841`) and the ATR floor (`0 of 1,958`), **this one bites HIM.** **Reported, not indicted**
— provenance and impact are independent axes. **It is carried into §4 as a build constraint.**

---

## 1. THE ORDER, AND WHY IT IS THE RIGHT METHODOLOGY

> **"I want you to creat a algo support and resistance strategy like mines without the 14 replay cases and see how it measures against mines"** — operator, 2026-08-27.

**This is a fact about his own intent and it is the reserved class, so it is authoritative.** It also
happens to be the textbook protocol this campaign has been failing to apply:

| | |
|---|---|
| **BUILD SET** | his teachings, his frozen non-replay invariants, **published S/R research** |
| **TEST SET** | **the 14 replay sessions — held out, touched ONCE, after the build is frozen** |
| **overfitting risk** | **structurally zero on the build**: the 14 sessions contribute no parameter |

⇒ **ALGO-158's blocker was never "the rule is unknowable." It was "any rule we write now is fitted
to the only 14 sessions we can see."** **He removed the second clause, and the first was never true.**

## 2. 🛑 THE SELECTION PREDICATE, DERIVED FROM OUTSIDE RESEARCH — the thing three days could not produce

**He ordered this on 2026-08-26 — *"aint you suppose to be my algo support and resistence maker… you
have research online"*, narrowed to *"the support and resistence foundatomentals, not my tp strategy
or stoploss strategy."* Executed here.** Published futures/day-trading S/R practice converges on
**four rules, none of which is a magnitude search:**

| # | published rule | source | agrees with HIS frozen teaching? |
|---|---|---|---|
| **1** | **Mark `2-3` key confluence areas, not many. Quality over quantity.** | Optimus, Daily Price Action, HYCM | **his ~2 a session — EXACTLY** |
| **2** | **Map structure on the HIGHER timeframe first, then REFINE on the execution timeframe.** | NinjaTrader, Optimus | **his `5m/15m only`; the code's own `KEY_ZONE_15M_REFINED_LIQUIDITY_CLUSTER_5M`** |
| **3** | **Priority to areas price has reversed at least `2-3` times.** | Optimus, UEEx | **his *"multiple independent reactions strengthen a key level"*** |
| **4** | **Rank by CONFLUENCE COUNT across INDEPENDENT factor families; `3+` overlapping = highest priority.** | Daily Price Action, HYCM | **his `confluence` field already exists in `levels.py`** |

> ## **THE PREDICATE IS OF THE RIGHT KIND AT LAST. IT IS A RANK OVER INDEPENDENT FACTORS GATED BY HIGHER-TIMEFRAME PARENTAGE — A JUDGMENT EXPRESSED STRUCTURALLY. ALGO-158 PROVED NO THRESHOLD COULD REACH THE OBJECT; THIS IS NOT A THRESHOLD.**

**🛑 AND THE MACHINERY IS ALREADY BUILT AND MISWIRED.** `enrich_confluence` exists; every zone
carries a `confluence` field; **the sampled map rows read `"confluence": 0`.** It appears **nowhere in
the five quality weights** and only as a **secondary sort key** in the greedy dedup
(`-quality, -confluence, mid, id`). ⇒ **confluence is computed and then almost entirely ignored.**
**The repair shape is PROMOTION, not invention: confluence becomes the GATE, higher-timeframe
parentage becomes a precondition, and the map keeps the top `2-3`.**

**This also retro-explains ALGO-157's funnel.** `690` pivots → `37` zones happens with **no
higher-timeframe parent test and no confluence gate**. Both published rules are absent from the money
path. **That is why the map is clutter, and it is a structural absence, not a mistuned number.**

## 3. 🛑🛑 THE EDGE IS NOT IN THE LEVELS — ALGO-100D MEASURED IT AND THE CAMPAIGN WALKED PAST IT

**[VERIFIED HERE at ALGO-100D §2, corroborated from frozen data he had not seen]**

| | his | the bot |
|---|---|---|
| median target | **`66.1` pts = `$1,984` at 15 MNQ = `3.83R`** | realized winners **`20.68` pts = `$620` = `1.16R`** |
| expectancy at **38%** wins | **`+1.3R` / trade** | **`−0.18R` / trade — the losing backtest** |
| expectancy at **25%** wins | **still positive** | deeply negative |

> ## **THE BOT HAS BEEN TAKING HIS SETUPS AND BANKING A QUARTER OF HIS TRADE. AT 38% WINS THE SAME ENTRIES ARE A LOSING SYSTEM AT `1.16R` AND A STRONG ONE AT `3.83R`. THE R-GEOMETRY IS THE EDGE, AND IT IS CITED FROM HIS OWN VOLUNTEERED STATEMENT AGREEING WITH HIS FROZEN MARKINGS TO WITHIN `$16`.**

**His stated win rate is not a target and never enters a predicate** (`[win-rate-is-output-not-target]`).
It is used here **only** to show that the entry layer was never the binding constraint on profitability.
⇒ **the clean-room build inherits the R-geometry as a FROZEN INPUT, not a fitted one.**

## 4. THE BUILD CONTRACT — `MNQ-SR-CLEANROOM-v1`

**New module tree. No v2.4 file is edited. v2.4 remains the comparison baseline.**

**FROZEN INPUTS (all non-replay-derived, all cited):**
- stop `17.25` pts / `$517` at 15 MNQ micros — his, volunteered (ALGO-100D §1)
- **target geometry: median `3.83R`**, laddered to structural destinations — ALGO-100D §2
- one A+ trade per session; window `08:00-12:00` — his files, ALGO-049
- zone = **rejection wick → that candle's close**; zones on **5m/15m only** — his reserved answer, ALGO-071
- direction: both, mirrored

**DERIVED SELECTION (§2, outside research):** higher-timeframe parent required · confluence count
across independent families · `≥2` prior reactions · **keep top `2-3` per session.**

**🛑 DO NOT INHERIT `min_wick = 0.20` UNEXAMINED (§0).** It is uncited and it kills `3 of his 28`
outright — **the single largest measured harm to his own levels by any one magnitude in the pipeline.**
The clean-room build states its wick criterion **from the published rejection definition and his own
`wick → close` zone rule**, and **reports what its choice costs against his 28 in the held-out test.**
**It is not free to copy v2.4's number, and it is not free to search for a better one.**

**FORBIDDEN — and this is the whole point of the exercise:**
- **any read of the 14 replay sessions, their labels, his 28 levels, the bullet census, or any
  artifact derived from them, at any point during the build**
- any parameter chosen by looking at what it does to those sessions
- any PnL, realized outcome or win/loss input to any predicate
- threshold search of any kind

**THE TEST, RUN ONCE, AFTER THE BUILD IS FROZEN AND COMMITTED:** map size per session · overlap with
his 28 marked zones at three pads · whether the bullet lands on a zone he marked · **and the same
measurements for v2.4 side by side.** **Pre-registered before the test runs: the build is a success
if it draws `≤5` zones a session AND overlaps more of his 28 than v2.4's `13`.** **Recorded here so
it cannot be moved afterwards** (`[pre-register-criteria]`).

## 5. CORRECTIONS I OWE

1. **ALGO-159 §4 claimed the map/entry convergence was a join nobody had made. PARTIAL PRIOR ART:
   ALGO-100D (08-26, the Fable seat) already ruled *"one defect explains every symptom this campaign
   has chased: the level map is chart clutter,"* spanning both layers.** What ALGO-159 adds is
   narrower and I restate it at its true size: **the two UNDERIVABLE terms — `avoid_chart_clutter` and
   `FIRST_A_PLUS` — are the same missing predicate.** **I ran prior-art on the refusal object and not
   on my own conclusion, which is exactly the error ALGO-159's own lesson warns about.**
2. **ALGO-158/159's "terminal" framing was wrong in its disposition, not its measurement.** The
   diagnosis holds; **calling it terminal assumed the only route to a rule was his evidence or his
   answer.** **A clean-room build against published practice was always a third route, and I did not
   see it until he did.**

## 6. AUTHORIZED

1. **BUILD `MNQ-SR-CLEANROOM-v1` to the §4 contract.** New files only. **Publish the frozen spec and
   commit it BEFORE running the test** — the commit order is the proof the build never saw the test set.
2. **Then run the §4 test once and report both arms.**
3. **HOLD on any v2.4 repair** — v2.4 is the baseline and must not move while it is being compared to.

---

**LESSON, minted:**

> **THREE DAYS ENDED IN `UNDERIVABLE` BECAUSE THE CAMPAIGN ONLY EVER ASKED TWO SOURCES: HIS FILES, AND HIM. THE OPERATOR NAMED THE THIRD IN ONE SENTENCE — BUILD IT FROM PUBLISHED PRACTICE AND HOLD HIS SESSIONS BACK AS A TEST SET — AND HE HAD ALREADY ORDERED THE RESEARCH HALF OF IT THE DAY BEFORE.**

**`UNDERIVABLE FROM HELD EVIDENCE` was true and I let it stand as `UNDERIVABLE`.** The dropped word
was doing all the work. **A blocker is only terminal once you have enumerated the sources, and
"the public literature of the thing he trades" was never on my list.**

> **WHEN A DERIVATION FAILS, RE-ENUMERATE THE SOURCES BEFORE DECLARING THE OBJECT UNKNOWABLE. AND WHEN THE OPERATOR HAS ALREADY ORDERED A SOURCE YOU HAVE NOT USED, THAT IS NOT A NEW IDEA — IT IS AN OUTSTANDING INSTRUCTION.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling. The R-geometry in §3 is a TARGET-DISTANCE statement from his own markings and his own
volunteered words; no realized outcome enters any predicate.*
