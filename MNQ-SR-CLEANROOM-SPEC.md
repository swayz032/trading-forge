# MNQ-SR-CLEANROOM-v1 — FROZEN SPECIFICATION

**Committed BEFORE any test is run. The commit order is the evidence that no parameter here was
chosen by looking at what it does to the fourteen replay sessions.**

Authorized by ALGO-161. Operator, 2026-08-27, verbatim:
> *"I want you to creat a algo support and resistance strategy like mines without the 14 replay
> cases and see how it measures against mines"*

---

## 0. 🛑 THE HONEST LIMITATION, STATED FIRST

**I am not a clean room. I have spent three days measuring those fourteen sessions and I cannot
un-see them.** A build written by someone with that exposure can be contaminated in a way no commit
order detects.

**What actually protects this build is therefore NOT my ignorance. It is that every parameter below
is CITED to a source that never saw his chart, and NONE is a free choice.** Where a value could
have been tuned, it is instead taken whole from published practice or from a frozen operator input
that predates this build. **If a reader finds a number here with no citation, this specification
has failed and the result should be discarded.**

## 1. THE SELECTION PREDICATE — derived from published S/R practice, not from his sessions

Four convergent rules from independent published sources (Optimus Futures, NinjaTrader, Daily Price
Action, HYCM, UEEx), **none of which is a magnitude fitted to anything**:

| # | rule | how it is implemented here |
|---|---|---|
| 1 | **Mark only 2–3 key areas. Quality over quantity.** | the map is **truncated to the top 3 per side** |
| 2 | **Structure on the higher timeframe, refined on the execution timeframe** | candidates built on **15m**, refined against **5m** reaction clusters |
| 3 | **A level needs ≥2 prior independent reactions** | **`touches ≥ 2`**, independence enforced by time separation |
| 4 | **Rank by CONFLUENCE COUNT across independent families** | **primary sort key is confluence count**, not a weighted score |

**Rule 4 is the whole build.** v2.4 ranks zones by a five- or seven-term weighted quality composite
whose weights are declared nowhere, and confluence appears only as a secondary tiebreak. **Here
confluence count IS the rank.** This is a *promotion of machinery that already exists*, not an
invention.

**Confluence families counted (each contributes at most 1, so the count is a count of INDEPENDENT
agreements):**
- an active 15m FVG overlapping the level
- a 5m liquidity/reaction cluster overlapping the level
- the level having been tested on **both** sides of its own role (tested as support *and* as
  resistance — a role flip, which published practice treats as strengthening)

## 2. FROZEN INPUTS — all non-replay-derived, all cited

| input | value | source |
|---|---|---|
| stop | **17.25 pts** (`$517.50` at 15 MNQ) | operator, frozen `preserved_invariants: 17.25_point_stop` |
| target geometry | **median 3.83R**, laddered to structural destinations | ALGO-100D §2, from his stated/marked targets — **frozen input, never fitted** |
| trades per session | **one A+** | `preserved_invariants: maximum_one_strategy_trade_per_session` |
| window | **08:00–12:00** | operator reassertion 08-23; `v2_2_engine.py:43-44` |
| zone shape | **rejection wick extreme → that candle's close** | his words, ALGO-073 §1, ruled §2 |
| zone timeframes | **5m / 15m only** | operator; 30m is a cross-teacher error |
| direction | **both, mirrored** | operator |
| **`min_wick`** | **0.20, INHERITED AND NAMED AS A CONSTRAINT** | v2.4 frozen parameter — **ALGO-160 measured it killing 3 of his 28 levels; it is carried unchanged and NOT re-chosen, because re-choosing it would be exactly the fitting this build exists to avoid** |

## 3. FORBIDDEN DURING THE BUILD — and these are absolute

- **Any read of the 14 replay sessions, their labels, his 28 marked levels, the bullet census, or
  anything derived from them.**
- **Any parameter chosen by looking at what it does to those sessions.**
- **Any PnL, win/loss, or realized-outcome input.**
- **Any threshold search of any kind.**

**The builder module reads: pinned OHLC bars only. It does not open the labels file, the manifest,
the scorecard, or any `algo1*` artifact.**

## 4. PRE-REGISTERED ACCEPTANCE — fixed here, before the test runs

> **SUCCESS = the map draws `≤ 5` zones per session **AND** overlaps more of his 28 marked levels
> than v2.4's `13`.**

**Both clauses must hold. Either alone is a failure.** Reported at the same three pads
(`0.00 / 2.50 / 10.00`) and both width arms (as-marked and 7.25) that ALGO-153 and ALGO-160
established, **so the comparison uses the instrument that already exists rather than a new one.**

**A result that draws ≤5 zones and overlaps FEWER of his levels is a FAILURE and will be published
as one** — a smaller map that loses him is worse than a large map that contains him.

## 5. WHAT THIS BUILD IS NOT

- **Not a replacement for v2.4.** v2.4 is the baseline and **is not edited** — it cannot move while
  it is the thing being compared against.
- **Not a repair.** Nothing here is proposed for v2.4, and no v2.4 defect is fixed by it.
- **Not evidence about profitability.** No PnL is read; the R-geometry is a frozen input, not a
  result.

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this specification.*
