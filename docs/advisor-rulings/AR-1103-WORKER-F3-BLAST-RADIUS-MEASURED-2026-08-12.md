# AR-1103 (worker) — F-3 BLAST RADIUS MEASURED. THE METRIC DEFINITION IS GLOBALLY WRONG, EXACTLY AS YOU SUSPECTED.

**Governing:** AR-1101 §4 (*"measure the blast radius before mutation … do not special-case
SOURCE_FAITHFUL if the underlying metric definition is globally wrong"*) · **Pin:** `08aad229`
**READ-ONLY. Nothing was built, nothing mutated. Unit B remains UNSTARTED.**

---

## 1. WHY THIS EXISTS

Your §4 made blast radius a precondition of the F-3 mutation, and I am out of context to implement
B safely. So I spent the remainder on the one part that **cannot leave the tree half-wired** — the
measurement — so the next seat starts from evidence instead of re-deriving it. **A partial metric
mutation on a money-path surface is the worst thing a nearly-exhausted seat can leave behind.**

---

## 2. WHERE REALIZED METRICS ARE COMPUTED — TWO INDEPENDENT COPIES

`[MEASURED HERE @ 08aad229]`

| path | function | win_rate | profit_factor |
|---|---|---|---|
| DSL / legacy | `run_backtest` (`:4262`) | `:5987` | `:5992` |
| class / Band C | `run_class_backtest` (`:7350`) | **`:8509`** | **`:8514`** |

They are **separate, duplicated implementations of the same formula**, not one shared helper:

```python
winners = trade_pnls_arr[trade_pnls_arr > 0]
losers  = trade_pnls_arr[trade_pnls_arr < 0]
win_rate      = float(len(winners) / total_trades)
profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf")
```

⇒ **F-3 is NOT a SOURCE_FAITHFUL defect and it is not even a class-path defect. It is the metric
definition, and it exists twice.** Your §4 anticipated this precisely; it is now measured rather
than suspected.

---

## 3. THE DECISIVE MEASUREMENT — NOTHING FILTERS ON `Status`

```
$ grep -c '"Status"' src/engine/backtester.py
0
```

**Zero.** `trade_pnls_list` appends **every** trade record, the open one included, and
`total_trades` is the realized denominator. There is no closed/open distinction anywhere in the
file — so an unresolved position is counted as a completed loss on **every** class backtest that
ends holding a position, legacy and source alike.

★ **`THE OPEN TRADE IS NOT MISCLASSIFIED — IT WAS NEVER CLASSIFIED AT ALL. THERE IS NO CODE THAT
KNOWS THE DIFFERENCE.`**

Consequences for the next seat's contract:

- `closed_trade_count` / `open_trade_count` do not exist and must be **introduced**, not derived
  from an existing field;
- the realized denominator is currently `total_trades` at `:8509` — that is the exact line the
  ruling's "realized-performance denominator" refers to;
- `win_rate_per_trade` (`:8806`) has the **same** defect independently, computed from
  `trades_list` with `max(total_trades, 1)` — **a second site in the same function**, easy to miss;
- `_compute_forge_score(sharpe, max_dd, profit_factor, win_rate, …)` (`:8746`) and the tier
  thresholds (`:7101`–`:7107`) **consume** these values, so the correction propagates into scoring
  and promotion tiers. That is a feature, not a side effect — but it must be stated, not discovered.

---

## 4. WHAT THIS MEANS FOR YOUR §4 INSTRUCTION

You wrote: *"Do not special-case SOURCE_FAITHFUL if the underlying metric definition is globally
wrong."* **It is globally wrong, in two duplicated implementations, with a third site
(`win_rate_per_trade`) sharing the flaw.**

⚠️ **THE SCOPE QUESTION IS THEREFORE YOURS, NOT MINE, AND I AM NOT ASSUMING IT.** A globally correct
fix changes realized `win_rate` / `profit_factor` / forge score / tier for **every legacy strategy
whose backtest ends holding a position** — a large, silent revaluation of historical numbers. That
is squarely your §9.5 territory (*"the fix changes legacy … without a separately proven
pre-existing defect"*) — except here the pre-existing defect **is** proven, above.

**My recommendation, offered as a recommendation:** fix the definition in **both** paths (it is one
formula in two places), introduce the counts, and **pre-measure the legacy revaluation** by running
the canonical population and reporting exactly which members' metrics move — before landing. The
alternative (source-only special-casing) would leave the identical bug live on the legacy arm while
the source arm reports differently, which is two truths from one formula.

---

## 5. HANDOFF STATE — UNCHANGED FROM AR-1102 §6, PLUS THIS

`A` DONE · **`B` UNSTARTED but now de-risked by §2–§4 above** · `C` UNSTARTED · `D` UNSTARTED.

**Nothing is half-written. No sub-agent outstanding. No production file touched in this AR.**
**No performance/edge run executed; none authorized.**

**Pin `08aad229`.**
