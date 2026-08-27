# ALGO-186 — **THE BACKTEST PRE-REGISTRATION, PUBLISHED BEFORE ANY NUMBER EXISTS AND BEFORE THE RUN IS EVEN POSSIBLE. THIS COMMIT'S SHA IS THE PROOF OF ORDERING.** **🛑 FIRST AND LOUDEST: `-$21,075 / 42%` IS **VOID, NOT A BASELINE**. IT WAS MEASURED ON AN ENGINE WHOSE MAP CONTAINED INFORMATION THE BOT COULD NOT HAVE HAD, ON A TRADE SET THAT HAS SINCE MOVED. ANY DELTA COMPUTED AGAINST IT IS MEANINGLESS, AND THE SENTENCE *"THE REPAIR GAINED/COST `$X`"* IS FORBIDDEN IN ADVANCE BECAUSE IT WILL BE THE FIRST THING EVERYONE REACHES FOR.** **🛑🛑 AND ONE TRAP IS ALREADY LIVE AND MUST BE SETTLED BEFORE ANY DRAWDOWN NUMBER IS PUBLISHED: `v2_2_engine.py:1054` COMPUTES `mae_cash = float(r.mae_points) * POINT_VALUE * CONTRACTS` — **UN-NEGATED, ON AN ALREADY-SIGNED-NEGATIVE FIELD THAT CARRIES THE EXIT BAR'S FULL EXTREME AFTER THE STOP HAS ALREADY FILLED.** WORST OBSERVED `−79.8` PTS ON A `17.25` STOP. THIS ONE FIELD MOVES `P(daily breach)` FROM `0.0%` TO `~57-63%`.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Channel head at drafting:** `5cc2ed23`.
**Strategy head `031dfc29`.** **PR #38: DRAFT / DO NOT MERGE. NOTHING HAS RUN. NO RESULT EXISTS.**

---

## 1. WHY THIS IS PUBLISHED NOW

**The operator's constraint has been the same since the first hour: *"we need to make sure we find a
EGDE but NO OVER FITTING."*** **Every guard this campaign has built protects against fitting a
PARAMETER. None of them protects against fitting an INTERPRETATION** — and a backtest result is the
single richest opportunity for that this project will ever produce.

> ## **A PRE-REGISTRATION WRITTEN AFTER A NUMBER EXISTS IS A COMMENTARY. THIS ONE IS ON THE LADDER BEFORE THE RUN IS EVEN TECHNICALLY POSSIBLE, AND ITS COMMIT SHA IS THE PROOF.**

## 2. 🛑 THE VOID BASELINE — the reading that must be foreclosed before it is available

**`-$21,075 / 42%` was measured against a map anchored at `09:30` while decisions began at `08:00`,
with `plan.primary` leaking on `10 of 56` anchor-pairs.** **`3 of 12` in-window bullets traded levels
that did not causally exist. The trade set has since moved on `4 of 14` sessions.**

| forbidden reading | why |
|---|---|
| *"the repair improved it by `$X`"* | **two different engines on two different trade sets** |
| *"the repair cost `$X`"* | same |
| *"we are `$X` from breakeven"* | measured from a void origin |

> ## **THE OLD NUMBER IS NOT A WORSE MEASUREMENT OF THE SAME THING. IT IS A MEASUREMENT OF A DIFFERENT THING. `MEASURED AGAINST A NON-CAUSAL MAP` IS A STAMP, NOT A CAVEAT — AND IT MEANS THE NUMBER HAS NO SUCCESSOR.**

**The new run establishes a FIRST measurement, not a SECOND.**

## 3. 🛑 THE MAE TRAP — settle it BEFORE any drawdown or breach figure is published

**[VERIFIED HERE at `031dfc29`]** `:1054` `mae_cash = float(r.mae_points) * POINT_VALUE * CONTRACTS`
· `:25` `STOP_POINTS = 17.25`.

- **`mae_points` is already signed-negative and is added un-negated.**
- **It carries the exit bar's FULL extreme AFTER the stop has already filled** — a stop that filled at
  `−17.25` can report `−79.8`.
- **Every STOP realises exactly `−17.5`** ⇒ **the one-bullet daily-loss cap is STRUCTURAL, not
  statistical**, and a raw-MAE drawdown figure destroys that fact.

**RULED, in advance:**
1. **Publish BOTH:** the **raw** MAE figure as the **pessimistic bound**, and the **clamped** figure
   `min(pts, max(mae, −(stop + slip)))` as the **account-equity** figure. **Neither alone.**
2. **The clamp fires ONLY on stop-family rows.** **Control required: the stop-family set must contain
   zero winners** (previously `68 stops, 0 winners`). **If a winner appears in it, the clamp is wrong
   and no drawdown number is published.**
3. **No `P(daily breach)`, no max-drawdown and no prop-firm figure is published until 1 and 2 hold.**
   **`0.0%` and `57-63%` are the same data through two lenses, and shipping either alone is a
   choice about what the reader concludes.**

## 4. THE PRE-REGISTERED BRANCHES — every outcome, and what each does NOT license

| branch | reading | what it LICENSES | what it does NOT |
|---|---|---|---|
| **A — profitable** | must still survive Monte Carlo | **an MC run, nothing else** | **NOT adoption. NOT "the repair created the edge"** — the trade set moved for causality reasons, and ~1,925 trades at 1/session is well inside luck's reach |
| **B — still losing** | **THE EXPECTED OUTCOME, and I am recording that prediction now** | **testing the R-geometry hypothesis** | **NOT a parameter change. NOT a re-run with a variation** |
| **C — profitable on very few trades / wide variance** | report as such, with `n` and the R-distribution beside it | an MC run | **NOT a headline** |
| **D — the run exposes a new fidelity defect** | fidelity precedes edge, always | **stop, report, repair at source** | **NOT "finish the run first"** |
| **RESIDUAL — fits none of the above** | **required branch.** Report the shape and rule before interpreting | nothing | **NOT a forced fit into A-D** |

**🛑 WHY `B` IS THE PREDICTION AND WHY IT WOULD NOT BE A FAILURE.** **ALGO-100D's arithmetic already
says the entry layer is not the binding constraint:** at the bot's realised `1.16R` and a `38%` hit
rate the expectancy is `−0.18R`/trade **no matter how good the entries are**, and at his `3.83R` the
same `38%` is `+1.3R`. ⇒ **a causal, fidelity-repaired bot that still loses at `1.16R` CONFIRMS the
diagnosis rather than refuting the repair.**

## 5. WHAT THE RESULT MAY NEVER DO — the overfitting gate

1. **NO PARAMETER MAY BE CHANGED BECAUSE OF THIS RESULT.** Not a threshold, not a weight, not the
   stop, not `PRE_END`, not the budget, not the map.
2. **NO RE-RUN WITH A VARIATION "to see if it improves."** **The second run of a backtest with one
   thing changed is the first step of a parameter search, and it never feels like one.**
3. **`3.83R` REMAINS A FROZEN INPUT AND HIS `$1,000`/`$2,000` FIGURES ENTER NO PREDICATE** —
   `[operator-target-tiers-oracle-never-a-rule]`, and the AST guard stays in force.
4. **WIN RATE IS AN OUTPUT.** It is reported and it enters nothing.
5. **THE 14 REPLAY SESSIONS STAY OUT OF SCOPE** — not as a filter, a sanity check, or a tie-breaker.

## 6. WHAT GETS REPORTED, FIXED IN ADVANCE

**Window `2020-01-01..2026-03-08`, `1,925` sessions, stated with the parquet holes** (`2016`, `2017`,
`2019` absent; `2015`/`2018` excluded — a 40-day lookback cannot cross a gap).
**Then: trade count · win rate · the FULL R-distribution, not just the mean · total P&L · both MAE
figures per §3 · the count of sessions with no trade · and the achieved wall-clock with worker count.**

**No summary statistic is published without `n` beside it.** **And any coverage-shaped or
proportion-shaped figure carries its null** — `[coverage-number-needs-a-null]`.

## 7. AUTHORIZED

1. **On the ALGO-185 §4 obligations passing — independence PROVEN and determinism PROVEN by key — RUN
   THE BACKTEST.** No further ruling needed; this one is the authorisation.
2. **Report against §6 and answer every §4 branch explicitly, including the ones that did not fire.**
   **A pre-registration is only worth something if the unfired branches get reported too** — you
   established that at ALGO-179 and it is now standing practice.
3. **THEN STOP.** **Monte Carlo is a separate ruling** and §4 says which branches even permit one.
4. **STILL NOT AUTHORIZED:** any parameter change · any variation run · any adoption decision inside a
   result message · any map work · the 14 sessions.

---

**LESSON, minted:**

> **THIS CAMPAIGN BUILT SIX WAYS TO CATCH A GUARD THAT LIED, A LAW FOR RED-PROOFS, A NULL CONTROL DISCIPLINE AND AN AST TAINT TRACKER — ALL OF THEM AIMED AT PROTECTING A NUMBER. NOT ONE OF THEM PROTECTS THE SENTENCE SOMEONE WRITES UNDERNEATH IT.**

**A fitted parameter is caught by a guard. A fitted INTERPRETATION is caught by nothing, because it
adds no degrees of freedom to any file** — **it just chooses, after the fact, which of several true
readings to lead with.** ⇒ **the only instrument that works is a reading committed before the number
exists, in a place with a timestamp.**

> **PRE-REGISTER THE INTERPRETATION, NOT ONLY THE CRITERION. NAME THE READING YOU EXPECT, NAME THE READING THAT WOULD EMBARRASS YOU, AND NAME THE ONE YOU ARE FORBIDDEN FROM REACHING FOR — WHILE ALL THREE ARE STILL EQUALLY AVAILABLE.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling. No such result exists.*
