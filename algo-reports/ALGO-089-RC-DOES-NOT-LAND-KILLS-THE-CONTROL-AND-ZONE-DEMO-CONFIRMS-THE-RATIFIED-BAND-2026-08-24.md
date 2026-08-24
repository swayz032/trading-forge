# ALGO-089 — R-C **DOES NOT LAND** (it kills the control); his zone demo **CONFIRMS** the ratified band

**Strategy head:** `dd0505bd8ac225f6ecf91ca6ab6d9ef89ce824f2` (pushed, `ls-remote` verified)
**PR #38:** DRAFT / DO NOT MERGE · **Nothing landed.** The only production edit is a
**comment-only** provenance correction in `target_policy.py` — value frozen at 400.0, refusal
power intact, no logic touched.
**Numbering:** you assigned ALGO-089 to the R-C ruling and ALGO-090 to the screenshot; this
report carries both results, so those rulings become **ALGO-090** and **ALGO-091**.

---

## 1. R-C fails its own pre-registration

| pre-registered | result |
|---|---|
| (a) 04-14 control's entry survives | **FALSE — 1 → 0. R-C kills the control.** |
| (b) five convicted early trades refused | **1/5** |
| (c) no target-layer change | **TRUE**, 0 changes |

Corpus-wide: **6 approvals removed, 16 refusals, 0 added.** The batch lands whole or not at all,
so **nothing lands.**

| convicted trade | story | outcome |
|---|---|---|
| 03-23 08:14 S | `PREBREAK_REPEAT_TEST` | **exempt** (taught) |
| 03-24 08:17 S | `PREBREAK_REPEAT_TEST` | **exempt** (taught) |
| 03-31 09:03 L | `ACCEPTED_BREAK_RETEST` | **exempt** (taught) |
| 04-06 09:07 S | `FIRST_BREAK_PRINT` | `R_C_ZONE_NOT_FRESH` |
| 04-09 09:37 L | `ACCEPTED_BREAK_RETEST` | **exempt** (taught) |

**Four of five fire on second-visit stories by construction** — repeat-test and accepted-break
retest each have a prior test as their own premise — so any honest exception exempts them. Only
04-06 fires on `FIRST_BREAK_PRINT`, **and the control fires on that same story.** R-C can bite on
exactly one convicted trade, using the one story it shares with the control it must preserve, and
it kills the control doing it.

I did **not** narrow the exceptions to manufacture a pass. Narrowing a taught exception to hit a
target is fitting, and it would have produced a "successful" batch that means nothing.

## 2. The root cause — and it is the useful part

The control's zone was born **09:15**. The single completed bar that "spends" it is **09:30**,
OHLC `[25656.25, 25727.0, 25655.75, 25718.25]` — which is **exactly the rejection candle whose
wick-to-close defines that zone's band** (the same `[25655.75, 25718.25]` L4 derived).

> **R-C counts a zone's own defining rejection as the test that consumes it.**

That is self-defeating for every zone whose significance comes from a rejection candle — which is
all of his. And it inverts the teaching R-C cites: the outside sources say the **first touch is
the highest-probability reaction**, while the predicate as specified refuses precisely that.

**What would have to change** for a freshness predicate to be coherent: freshness would have to
be counted from the **defining rejection forward**, not from the zone's birth, so that the touch
which *creates* significance cannot also be the touch that spends it. That is a different
predicate. **I am not proposing it** — naming it so you can decide whether to specify it.

**The timing conviction is untouched.** The bot still spends its bullet 46 min–3 h early at stale
structure. R-C is simply not the predicate that expresses it.

## 3. His zone-marking demonstration — measured, and it confirms the ratified rule

Custody verified byte-for-byte (`sha fce8834f…`, 113,584 B). MNQ 15m FXReplay, **Fri 11 Jul '25**
— teaching era, lawful predicate source.

Calibration **2.5042 px/point**, max axis residual **0.233 pts**, tolerance **0.63 pts**:

| | measured |
|---|---|
| zone | **23091.41 – 23109.78** (18.37 pts) |
| spike wick extreme | **23110.38** |
| spike body close side | **23090.82** |

| construction | error | verdict |
|---|---|---|
| **A — [wick extreme, close]** *(ratified)* | **0.59 / 0.60 pts**, both edges | **MATCHES** |
| B — band above the wick | 18.97 pts | **REFUTED** |

**Your provisional eyeball is refuted by measurement, and the ratified band rule stands.** No rule
was changed by this.

**Three detector failures came first**, each returning a confident wrong price, and each is now
pinned by a guard: no plot bounds → browser chrome at row 13 (23,189.85); bounds too generous →
the header's green O/H/L/C caption at row 140; and reading the rectangle's **fill** instead of its
**border stroke** → a symmetric ~1.2-pt under-measurement that made the ratified construction look
refuted by about two ticks. The verdict only resolved once the detector measured the edge a human
actually draws to.

## 4. The $400 floor — my UNCITED grade was a wrong-surface control

Verified independently at `trader_fidelity_addendum_2026_08_20.json`,
`direct_trader_tp_gap_clarification`: *"$400 or more is safe; under $400 is not safe"*,
`reference_safe_floor_usd 400.0`, `under_400_immediate_entry BLOCK`, and
`under_400_tp2_behavior: "Do not blindly leapfrog untouched TP1 merely because TP2 is farther
away."`

ALGO-076 published that absence **with a positive control** — ALGO-004's `17.25 × 15 × $2`. That
control proved nothing: ALGO-004 is a **ruling**, so it only showed the rulings branches were
searchable. It never exercised the **research corpus**, where the rule lived.

> **A control in the wrong surface is a *better* false proof than no control, because it makes an
> unsearched surface look searched.**

Standing rule now written into the code: every provenance grade **names its surfaces**, and the
corpus is always among them. This also explains R-A at a deeper level than "too broad" — dropping
a nearby untouched destination so a farther one wins **is** the blind leapfrog the addendum
forbids, and its 18-entry blast radius was the taught rule pushing back.

## 5. Asks

1. R-C as specified: reject, or re-specify freshness from the defining rejection forward?
2. The timing conviction still has no predicate. That is now the open problem.
3. Zone band rule: confirmed — anything to change?

Artifacts at `dd0505bd`: `..._rc_only_batch_report_2026_08_24.json`,
`..._zone_marking_pixel_measure_2026_08_24.json`, `..._tp_sweep_5m_15m_2026_08_24.json`.

---

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in this packet.
