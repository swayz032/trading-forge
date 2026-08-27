# ALGO-159 — **THE TWO LANES THAT CLOSED THIS CAMPAIGN ARE ONE LANE. `avoid_chart_clutter` (WHICH ~2 OF ~690 HE WOULD DRAW) AND `FIRST_A_PLUS` (WHICH CANDIDATE IS A+) ARE THE SAME MISSING PREDICATE, REACHED INDEPENDENTLY THREE DAYS APART, AND NOBODY HAS JOINED THEM.** **ALGO-099 named it at the ENTRY layer on 08-25 — *"A+ is implemented as 'first'. There is no quality judgment anywhere in the money path."* ALGO-158 named it at the MAP layer on 08-27 without recognising it. ⇒ ONE ABSENT DEFINITION, TWO LAYERS, AND IT EXPLAINS WHY EVERY THRESHOLD REPAIR IN BOTH LAYERS FAILED THE SAME WAY: A MAGNITUDE CANNOT STAND IN FOR A JUDGMENT.** **🛑 AND I CORRECT MY OWN ALGO-158 HEADLINE: *"on 12 of 28 it selects against him"* IS PAD-FRAGILE AND MEASURED AGAINST A WIDTH HE DISOWNED — `24 OF HIS 28 MARKED ZONES ARE EXACTLY ONE TICK WIDE (0.25 pt)`, and his standing instruction says his zone widths are NEVER to be read from these lines.** **[VERIFIED HERE] band-to-band coverage at three pads: `13 / 15 / 21 of 28` ⇒ missing `15 / 13 / 7`. THE SUBTRACTIVE HALF NEARLY HALVES ACROSS TOLERANCE. THE ADDITIVE HALF DOES NOT MOVE.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Channel head at drafting:** `4acb688a`.
**Strategy head `c1e46ae9`.** **PR #38: DRAFT. Nothing built. No repair. No question drafted — standing order in force.**

---

## 1. THE WORKER'S ATTRIBUTION — RATIFIED, WITH BOTH ITS LIMITS  **[VERIFIED HERE at `c1e46ae9`]**

| stage | n |
|---|---:|
| **`EST_CLUSTERING_OR_TOUCHES`** | **6** |
| `EST_QUALITY` (`valid_location`) | 2 |
| `EXC_ESTABLISHED_OVERLAP` | 2 |
| `EXC_GREEDY_DEDUP` | 2 |

**Both limits are the worker's own and both are correct.** (1) The largest share lands on the one
stage it refused to split — *"6 of 12 die at a stage I cannot resolve into its two halves"* — **a
limit, not a hedge, and the refusal to split was right: a re-implementation is not a measurement.**
(2) `n = 12`. **A concentration, not a dominance. No stage is convicted.**

**And its sub-shape stands: 4 of 12 die in DEDUPLICATION — the bot DREW his level and then discarded
it for overlapping a neighbour.** Not a failure to find; a decision to prefer something else.

## 2. 🛑 I RAN THE JOIN THAT COULD HAVE VOIDED IT — AND IT CORRECTS MY OWN HEADLINE

**ALGO-158 is mine and it published *"the collapse discards 12 of his 28"* as terminal. I tested it on
the key it was never measured on: HIS BAND against the SURVIVING map's bands.**

| pad | his zones overlapping a surviving bot zone | ⇒ missing | sessions with NOTHING of his covered |
|---|---:|---:|---:|
| **0.00 pt** | **13 / 28** | **15** | 2 / 14 |
| 2.50 pt | 15 / 28 | 13 | 1 / 14 |
| 10.00 pt | **21 / 28** | **7** | **0 / 14** |

**It reconciles exactly with the trace at 0.00 pt: `15 missing = 12 collapse + 3 no-gate`.** ⇒ the
attribution is arithmetically sound. **And three independent methods now agree at `13`** — ALGO-153's
overlay, ALGO-158's by-key survival, and this band join.

> ## **BUT THE MISSING COUNT GOES `15 → 13 → 7` ACROSS TOLERANCE. IT NEARLY HALVES. BY ALGO-153'S OWN LAW THAT IS A FRAGILE NUMBER, AND I PUBLISHED IT AS THE CAMPAIGN'S TERMINAL FINDING WITHOUT ITS PAD.**

**🛑 AND THE WIDTH IT IS MEASURED AGAINST IS ONE HE EXPLICITLY DISOWNED.** `[MEASURED HERE]` his 28
marked zones: **24 are exactly `0.25` pt — one tick.** Median `0.25`, max `7.25`, and only **4 of 28**
have any width at all. **His standing instruction (2026-08-23, his own reserved answer): key zones are
BANDS, widths taken from held screenshots and video — *never from the labels' one-tick lines*.**

⇒ **"12 of his 28 are discarded" IS A STATEMENT ABOUT ONE-TICK LINES, NOT ABOUT HIS ZONES.** Widen
them to the only real width he ever drew (`7.25`) and the number moves toward the 2.50-pt column.
**I withdraw the strength of ALGO-158's *"on 12 of 28 it selects against him."*** What survives, and
survives every tolerance ALGO-153 tried (`508 / 501 / 479 of 522`), is the other half:

> ## **THE ROBUST DEFECT IS ADDITIVE. THE BOT DRAWS ~37 ZONES A SESSION AGAINST HIS ~2, AND ~500 OF 522 CORRESPOND TO NOTHING HE MARKED, AT EVERY TOLERANCE TRIED. THE SUBTRACTIVE HALF IS PAD-SENSITIVE AND PARTLY AN ARTIFACT OF A WIDTH WE WERE TOLD NOT TO USE.**

**A hypothesis I killed before publishing it:** that his exceptional zones are suppressed by
established candidates that later die — an ordering defect needing no new rule. **Refuted at
`levels.py:293-296`: `established` is filtered by `valid_location` BEFORE being passed to
`exceptional_single_swing_zones`.** The suppressor has already survived. **Measured before it was
said, per ALGO-154.**

## 3. 🛑 I WAS ONE STEP FROM PUBLISHING A REDISCOVERY AS A BREAKTHROUGH

**The 12 killed levels sit `32.4`–`116.0` pt from the zone the bot actually traded (5 of 5 sessions
with a bullet census), and it fired `46`–`187` minutes before his clock every time.** That looked like
a new answer to *"why is the bot not going off my setup."* **It is not. `[prior-art-check]` on the
channel, before writing a word of it:**

| already ruled | when |
|---|---|
| **ALGO-139** — his setup was on the table at all five and something killed it every time | 08-26 |
| **ALGO-140** — his setup survives ranking FIRST on **10 of 14** and is discarded after | 08-26 |
| **ALGO-141** — the bot ALREADY trades his setup on **8 of 14**; `{"REACHED_THE_TRADE": 8, "G3_NO_TARGET": 4}`, and **the four refusals are his own rule** | 08-26 |
| **ALGO-099** — **`FIRST_A_PLUS` HAS NO PREDICATE** | 08-25 |

**`ALGO-138` confirms the mechanism and refutes the tidy version of it:** `A_REFUSED` on **5 of 5**,
`his_setup_EVER_survived_this_session = true` on **5 of 5** — **and the bullet precedes the first
surviving Route-A candidate on only 3 of 5** (`+39`, `+10`, `+7` against `−61`, `−38`). ⇒ **arrival
order is not the whole answer, exactly as that artifact's own pre-registered branch anticipated.**
**And `killed_at = FORCE_NOT_CONFIRMED` is a GATE LABEL over five sub-reasons, already convicted as
misleading at ALGO-096 — it is not a cause and I did not read it as one.**

## 4. 🛑🛑 THE JOIN NOBODY HAS MADE, AND IT IS THE FINDING

**ALGO-099, at the ENTRY layer, 08-25:**

> **"So `A+` is implemented as `first`. THERE IS NO QUALITY JUDGMENT ANYWHERE IN THE MONEY PATH."**
> `FIRST_A_PLUS` is a conjunct of the master equation (`engineer_onboarding:43`) and **the
> definition-shaped grep returns empty.**

**ALGO-158, at the MAP layer, 08-27, reached from the opposite end and three days later:** a repair
needs a rule for **which ~2 of ~690 he would draw**; that rule is `avoid_chart_clutter`; **taught, in
`spec.json`, read by no production code, `UNDERIVABLE`.**

> ## **THESE ARE ONE MISSING TERM. THE MAP DRAWS ALL 37 QUALIFYING ZONES BECAUSE IT HAS NO QUALITY JUDGMENT OVER PIVOTS. THE ENTRY TAKES THE FIRST QUALIFYING CANDIDATE BECAUSE IT HAS NO QUALITY JUDGMENT OVER CANDIDATES. `avoid_chart_clutter` AND `FIRST_A_PLUS` ARE THE SAME ABSENT DEFINITION EXPRESSED AT TWO LAYERS.**

**Two independent lanes, three days apart, neither aware of the other, terminating on one absence.**
⇒ **that convergence is far stronger evidence that this is the real blocker than either lane alone**,
and it was invisible because one lane called it *clutter* and the other called it *A+*.

**AND IT EXPLAINS THE WHOLE CAMPAIGN'S FAILURE PATTERN.** Every repair attempted in both layers was a
magnitude — a percentile, a floor, a rank, a cap, a band width, a tolerance. **All of them failed, and
they failed for one reason: a threshold cannot stand in for a judgment.** ⇒ **the "tune something"
family was never going to work in EITHER layer, and that is now a derived result rather than an
observation.**

## 5. WHERE THIS LEAVES IT — AND IT IS BETTER THAN ALGO-158 SAID

**ALGO-158's end state stands, but it is SINGULAR and DOUBLY-CONFIRMED rather than terminal-and-vague.**

- **Everything else is closed:** the rank · arrival order · lookahead · downstream drop · band shape ·
  the TP ladder · the `$400` floor · `target_policy.py:115` · the one-swing rule · both gates ·
  tighten-the-gate · the replays as a scoreboard · and now the "tune something" family in both layers.
- **Exactly ONE thing is open, and it is one definition, not two.**
- **The bot already trades his setup on 8 of 14 (ALGO-141) and his setup survives ranking first on 10
  of 14 (ALGO-140).** ⇒ **this is not a bot that cannot see him. It is a bot with no way to tell which
  of many qualifying things is the good one — which is the one thing he has never had to write down,
  because he does it by eye.**

**Under the standing order no question is available, so it stays `UNDERIVABLE` rather than becoming an
ask.** **Inventing an A+ predicate at the last stage of a three-day hunt is the one thing this campaign
has spent three days learning not to do** — and it would be fitting to fourteen sessions, which is
precisely the overfitting he named as the thing to avoid.

## 6. AUTHORIZED

1. **HOLD on repair.** Assignee: this desk, pending the one definition. No stage, no threshold, no
   merge/dedup change, no clutter rule, no A+ predicate invented.
2. **AUTHORIZED — one measurement, no new rule, and it is cheap:** re-run the ALGO-153 overlay and the
   ALGO-158 survival split **at his one real band width (`7.25` pt) as a sensitivity arm**, alongside
   the one-tick arm. **Report both. Derive nothing.** ⇒ **this brackets how much of the subtractive
   half is real and how much is the width artifact §2 identifies — and it is the last number that can
   be produced without him.**
3. **RECORDED for the next seat:** `avoid_chart_clutter` ≡ `FIRST_A_PLUS`. **Anyone who reopens either
   lane must open both, or they will re-derive half of a solved problem.**

---

**LESSON, minted:**

> **TWO LANES CLOSED ON THE SAME MISSING DEFINITION THREE DAYS APART AND NEITHER RECOGNISED THE OTHER, BECAUSE ONE CALLED IT `clutter` AND THE OTHER CALLED IT `A+`. THE CAMPAIGN'S OWN VOCABULARY HID ITS OWN ANSWER.**

**`[prior-art-check]` caught this at the last possible moment — I had the rediscovery drafted as a
breakthrough.** The search that saved it was not for my finding; **it was for the OBJECT — a refusal at
the bullet clock — and the channel had already ruled it four times.**

> **SEARCH THE PRIOR ART FOR THE OBJECT, NOT FOR YOUR CONCLUSION ABOUT IT. AND WHEN TWO LANES BOTH END IN `UNDERIVABLE`, CHECK WHETHER THEY ARE UNDERIVING THE SAME THING BEFORE YOU CALL EITHER ONE TERMINAL.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
