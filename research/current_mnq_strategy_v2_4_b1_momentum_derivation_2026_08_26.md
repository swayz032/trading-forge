# B1a — `_momentum` without `body_frac` and `close_loc`. Derivation, committed BEFORE any measurement.

**ALGO-106.** This is not a new derivation. It **extends ALGO-071 §3 to the surface it never
reached**: the operator's own answer retired `body_frac 0.62` and `close_loc 0.78` from Route A,
and the census at `1a44ff79` measured them **still live in every break-family trigger** — deciding
two of the five bullet-spends by hundredths.

**No guard has been run. No number below was chosen for its effect on any trade.**

---

## 1. What is in scope, exactly

`_momentum(row, direction, body_frac, close_loc)` — `breakout_derivation.py:124` — and nothing
else. It is confined to that module; nine call sites, no external caller.

**IN** (named by ALGO-106 §2): `normal_breakout` · `break_retest` · `prebreak_repeat_test` ·
`prebreak_displacement` (including `is_true_displacement`, which it calls).

**NAMED AND OUT:** `reject_wick`, `acceptance_bars`, `range_ratio`, and M1's admission
magnitudes (`min_wick`, the ATR floor, the Q75 percentile). None is touched.

**ONE SCOPE FACT THE RULING DID NOT NAME, flagged rather than resolved.** `_momentum` is also
called by **`weak_break_continuation`** (the BRK15 variant) at three sites — and at
`:330` it is used **INVERTED**: `if _momentum(bar1, …)` returns `BREAK_WAS_NOT_WEAK`, i.e.
momentum being TRUE *refuses* that route. Replacing the shared predicate therefore reaches BRK15
too, in both directions. I have **not** split it into two functions: two competing definitions of
"momentum" in one module is precisely the kind of drift this ladder keeps convicting, and the
taught sentence is one sentence. **The effect on BRK15 is reported, not hidden**, and if the
advisor rules BRK15 out of scope the split is one commit.

## 2. The taught content, and why no invention is required

> *"momentum = directional body / control geometry; range expansion not required"*
> — `engineer_onboarding.md:98`, `spec.entry_trigger_semantics.momentum_candle`

Two named components: a **directional body**, and **control geometry**. `_momentum`'s current
form is exactly two magnitude conjuncts (`body_frac` = the body is substantial; `close_loc` = the
close is near the extreme) plus a direction test. So the mapping is one-for-one, and **both
replacements are already ratified in this codebase**:

| taught component | current magnitude | magnitude-free expression | ratified as |
|---|---|---|---|
| there IS a directional body | `bullish` / `bearish` | `close beyond open in the direction` | **F1** `_directional_body` (ALGO-098) |
| the body DOMINATES the bar | `body_frac >= 0.62` | `body > max(upper_wick, lower_wick)` | **T3′′** `body_small` conjunct, negated (ALGO-101A) |
| control geometry | `close_loc >= 0.78` | `close finishes past the bar's own midpoint` | **T3′′** `NO_DIRECTIONAL_CONTROL`, negated (ALGO-101A) |

Each has already been through an a-priori fixture table and a mutation battery. **B1 composes
ratified parts; it invents nothing and introduces no constant.**

## 3. THE COMMITTED CLAUSE

> **`_momentum` holds iff** — for a LONG (mirrored for a SHORT):
> 1. **`close > open`** — there is a directional body;
> 2. **`body > max(upper_wick, lower_wick)`** — the body dominates the bar, rather than the bar
>    being wick-driven;
> 3. **`close > (high + low) / 2`** — the close finished on the directional side of the bar's own
>    centre.
>
> **Ties refuse on all three**, consistent with T3′′. `body = |close − open|`,
> `upper_wick = high − max(open, close)`, `lower_wick = min(open, close) − low`.

**OHLC against OHLC. No constant, no fraction, no threshold.** The midpoint is the bar's own
geometric centre — no free parameter and no search range — the same argument ratified for T3′′.
Conjunct 2 is why a doji cannot pass: `close > open` alone would admit a bar with a 0.1 body on a
6-point range if it happened to close above its midpoint.

## 4. A-PRIORI FIXTURES, published before the guard

Required by ALGO-106 §3, written from the taught words:

| fixture | required | measured, and which conjunct decides |
|---|---|---|
| decisive directional trigger `(100, 105, 99.5, 104.5)` L | **PASS** | body 4.5 > max wick 0.5 · close 104.5 > mid 102.25 · all three hold |
| closing AGAINST the direction `(104, 105, 99, 100)` L | **REFUSE** | conjunct 1 fails: `close > open` is false |
| doji / indecisive `(102.4, 105, 99, 102.5)` L | **REFUSE** | **conjunct 2**: body 0.1 ≯ max wick 3.4 (1 and 3 both hold — so conjunct 2 is what refuses it) |
| wick-driven bar closing high `(103.5, 105, 99, 104)` L | **REFUSE** | **conjunct 2**: body 0.5 ≯ max wick 4.5 (1 and 3 both hold) |
| ALGO-071 §5.3 bar `(101.6, 103.5, 101.5, 103.2)` L | **PASS** | body 1.6 > max wick 0.3 · close 103.2 > mid 102.5 — decisive **as a trigger**, which is what §5.3's own clause requires of it |
| SHORT mirror, decisive `(105, 105.5, 100, 100.5)` S | **PASS** | body 4.5 > max wick 0.5 · close 100.5 < mid 102.75 |

**A fixture defect of my own, caught by computing the table before committing it.** I first
drafted the wick-driven case as `(99.5, 105, 99, 104)` and asserted it must REFUSE. Computed, it
**PASSES** — body 4.5 against a max wick of 1.0 makes it a *decisive* bar, not a wick-driven one.
The fixture did not match its own description. Replaced with `(103.5, 105, 99, 104)`, which is
genuinely wick-driven (body 0.5, lower wick 4.5). **Two of the five refusals are decided by
conjunct 2 alone**, which is the evidence that it is load-bearing rather than decoration.

**If any required fixture conflicts a priori, B1 CLOSES** — no second expression, and the residual
is stated for GPT.

## 5. ACCEPTANCE — ALGO-105's public prediction, made before the census existed

> **The 08:00 arm reaches 3/8 with 03-24 and 03-30 in its agreeing set.**

**CONFIRMED or REFUTED**, and a refusal goes in my subject line with no re-explanation. Binding
alongside it: **NOTHING LEAVES** on both arms, and the **04-14 control identical by key and
target**. If A3 passes, freeze becomes reachable for the first time — and only then.

## 6. ANTI-OVERFIT — the sharpest rail here

**The 04-06 margin of `+0.0116` is evidence about PROVENANCE, not a target.** The clause above was
derived from the taught sentence and from expressions already ratified for other surfaces; it was
**not** chosen for what it does to any of the five bullet-spends. **If the derived clause admits
04-06 anyway, that is the honest result and it will be published as such.** A packet arguing B1
succeeded *because* the early trades vanished is refused exactly as the count argument was.

## 7. What this does NOT do

No repair to the admission map (M1 is deferred). No target-layer change. `entries.momentum_bar`
untouched. `reject_wick`, `acceptance_bars`, `range_ratio` untouched. The 17.25-pt stop, targets
and exam rules untouched. R2c stays unmerged. The engine-crash defect stays carried and unfixed.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in this derivation.
