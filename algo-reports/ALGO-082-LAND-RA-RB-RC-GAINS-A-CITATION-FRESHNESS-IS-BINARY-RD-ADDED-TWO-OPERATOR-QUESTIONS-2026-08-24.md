# ALGO-082 — R-A and R-B are authorized to LAND. R-C gains its missing citation from outside teachings: freshness is BINARY (untested-since-birth), no threshold needed. R-D (targets are KEY ZONES, not clusters) added — without it R-B covers 03-30 but cannot select it. Two questions go to the operator. Tolerance widening is FORBIDDEN.

**Advisor:** Claude (Fable 5), ALGO seat. **Rules on:** ALGO-081 @ `531113b3`, strategy head
`a19a1c49` (ls-remote verified; chain `e7537e98 → a19a1c49`). **Channel head at drafting:**
`531113b3`. **Main-channel head:** `c62bb561e015`, untouched. **PR #38: DRAFT / DO NOT MERGE.**
**DECISION: O1/O2 RATIFIED (§1) + R-A/R-B LAND (§2) + R-D ADDED (§3) + R-C CITED, DESIGN
AUTHORIZED (§4) + OPERATOR QUESTIONS (§5) + ORDERS (§6).** Newest ladder entry: ALGO-081.

## 1. Verification and ratification [MEASURED HERE unless graded]

- Heads verified; **21/21 lane tests in this desk's arena at `a19a1c49`**; suite 1645/7
  [RELAYED]. No production file touched (diff stat re-read).
- O1 artifact re-read: 03-24 SPENT with 18 completed 1m bars, 03-30/03-31 zero, control
  FRESH — **`NO_SEPARATION` accepted; both pre-registered controls held; either answer was
  acceptable and this is the answer.** The worker verified this desk's audit before
  accepting it — correct order of operations.
- O2 artifact re-read: `PROSPECTIVE_MARKING_DEMONSTRATED_ON: []`, capability control
  re-found the 03-24 TP band. The containment-vs-tolerance correction (second catch of the
  labelling class, pre-publication) is accepted. **RULED: the 2.0-pt tolerance is FROZEN.
  The recurring 0.375 quantisation offset (lines ending `.625` = midpoints of 0.25-wide
  zones vs band edges on `.25`/`.75`) is an encoding artefact and may never justify a
  widening. Any future tolerance change requires a teaching citation, not a near-miss.**
- Design doc read in full: red-proof plans include planting O1's exact bar-start defect and
  requiring RED; membership guards by membership, not count. Sound.

## 2. R-A and R-B — AUTHORIZED TO LAND (the first repairs since R1/R1b)

As designed, with their citations, red-proofs, membership guards, and pre-registered
expectations verbatim from the design doc: R-A (spent filter, completed-bar clause, 03-24
scope — any other day moving falsifies it); R-B (30m HTF rejection-band destinations, 30m
CITED / 60m PROVISIONAL-UNCITED never carrying a verdict, 03-31 recovery = automatic
rejection of R-B). **Landing is not the exam:** no exam runs until the full batch of this
round has landed (§6), so the headline is measured once, not churned.

## 3. R-D — ADDED TO THE DESIGN, because R-B alone covers 03-30 but cannot SELECT it

[MEASURED HERE from the committed artifacts] 03-30's machine winner `23373.75`
(LIQUIDITY_CLUSTER, 14.5 pts) is **NOT spent** (O1) — so after R-A + R-B land, nearest-first
still picks the cluster, and his TP's 30m band (near edge ~30 pts) still loses. **Coverage
without selection changes nothing.**

**R-D: the TARGET destination universe is restricted to KEY LEVEL ZONE bands (his
wick-to-close rule, taught timeframes). Liquidity clusters and FVGs leave the TARGET
universe only — entry/location logic untouched.** Citation: all three held teachings state
the target in the same words — *"targeted the **next key zone**"* (ALGO-051; ALGO-052
measured 110 pts to the upper key zone band; ALGO-050 ~290 pts to the next key zone) — and
ALGO-051 uses "liquidity reaction zone" as the place a reaction HAPPENS, never as a target.
Outside teachings corroborate targeting significant S/R levels (next key level) rather than
micro-features. Nearest-first is untouched: it ranks the corrected universe.

**Pre-registered expectations:** 03-30's selected target becomes a destination containing
his TP (the tightest cited 30m band `[23345.5, 23357.75]` or a nearer key zone if one is
fresh and cited); 03-24 under R-A+R-D moves to the nearest FRESH key zone — whether that is
his TP band `[24627.85, 24660.35]` or an intermediate fresh key zone is REPORTED, not
assumed; **04-14 control must retain a valid approved target** (its current FVG choice
leaves the universe — if no key-zone destination exists for it, R-D as designed FAILS the
control and is rejected as scoped). R-D runs first as a REPORT (full per-session selection
table, before/after, all 14 sessions), and lands only if ALGO-083 ratifies the table.

## 4. R-C — the missing citation now EXISTS, and it removes the threshold problem

The design correctly refused to invent a staleness number. **Outside-teachings research
(ordered under HIS vocabulary — key level zones, support and resistance) returns a
consistent doctrine: UNTESTED ("fresh") levels are the strong ones; each touch consumes the
resting orders; first touch of a fresh level is the highest-probability reaction; prior-day
and higher-timeframe levels outweigh old minor intraday structure.** (Sources recorded:
AlgoStorm S/R zones guide; PrecisionLevels day-trader S/R guide; NinjaTrader intraday S/R;
For Traders key-levels identification — retrieved 2026-08-24.) This matches his held
teachings exactly: same-session rejection zones marked live, first-touch rejections,
pre-existing HTF bands.

**Therefore R-C's predicate is BINARY, not a threshold: a zone is FRESH at the decision
clock iff NO completed bar has traded into its band between the zone's birth and the clock.
An entry bullet may only be spent at a FRESH zone (or a taught exception — e.g., Route D's
accepted-break retest, which by construction revisits a tested level and stays governed by
its own taught story).** No number is invented; the same structural machinery as R-A; origin
is outside teachings + his first-touch examples, not the 2026 labels — the labels only score
it. **AUTHORIZED AS DESIGN + REPORT (no landing):** apply R-C hypothetically over all 14
sessions and publish — which of the five early trades would be refused and why; whether the
04-14 control grant survives (its zone was born 09:15 same session — pre-registered: it must
survive); the full membership delta of in-window grants. If the report kills the control or
guts the lawful grant set, R-C fails honestly and is published as failed.

## 5. Two questions are the OPERATOR'S — asked this turn, on screen, in plain words

1. **Prospective marking:** on 03-24 and 04-06 no completed candle had rejected at his line
   when he entered, and no held prior structure explains either line (O2, capability
   control passed). Does he draw those levels in advance — from something he sees forming,
   or structure not in our data (e.g., a finer timeframe than 5m)?
2. The standing tape question (ALGO-078 §6) remains open and is re-asked in the same turn.

No worker task blocks on these; the R-A/R-B/R-D/R-C work proceeds regardless.

## 6. ORDERS

1. **Land R-A, then R-B** (shared file: `target_policy.py` — a real edge; serial, R-A
   first), each with its red-proof (RED on the planted bar-start defect mandatory) and
   membership guard at both pins.
2. **R-D report** (full selection table, all 14 sessions, before/after) and **R-C report**
   (hypothetical grant filter, membership delta, control survival) — independent of each
   other (fake-edge: distinct artifacts, R-D reads target layer, R-C reads entry layer);
   parallel after the landings.
3. **ALGO-083 rules the two reports**; R-D/R-C land only on ratification; **re-exam #3 runs
   only after the full batch is resolved** — one exam, one verdict, membership vs the F2
   anchor, pre-registered: 03-30 is the only plausible join this round (its census block was
   S5 alone); nothing leaves; 04-14 stays.

**STOP CONDITIONS unchanged:** no number moves without a citation · nothing from 2026
labels becomes a parameter · video untouched · R2 in the worktree · tolerance widening
forbidden (§1).

LESSON: when the evidence got weaker, the packet said so — and the reward for that honesty
is that the missing citation was findable in one research pass under the right vocabulary.
The penalty for inventing a threshold last week would have been carrying a fitted number
into a frozen brain forever.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any
decision in this ruling.
