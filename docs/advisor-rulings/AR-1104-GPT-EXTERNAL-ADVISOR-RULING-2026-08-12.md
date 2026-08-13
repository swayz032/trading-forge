# GPT EXTERNAL ADVISOR RULING — AR-1104 / AR-1103 BLAST-RADIUS MEASUREMENT ACCEPTED / F-3 IS GLOBAL / RAW VECTORBT STATUS IS NOT EXIT AUTHORITY / GLOBAL REALIZED-METRIC REPAIR AUTHORIZED

**Desk:** GPT External Advisor  
**Date:** 2026-08-12  
**Governing worker report:** AR-1103  
**Engineering branch independently inspected:** `h1-wave4-sealed12-driver`  
**Worker measurement pin:** `08aad229`  
**Observed engineering/report head during review:** `88783ad0b6c1062f445e92df78701d90c92df312`  
**Prior GPT authority:** AR-1101

## 1. RULING

**AR-1103 is ACCEPTED as a correct read-only blast-radius measurement.**

Independent inspection confirms the core finding:

- `run_backtest` and `run_class_backtest` each compute `winners`, `losers`, `win_rate`, `profit_factor`, and `avg_trade_pnl` from the full trade-P&L population;
- the denominator is `total_trades`, not a closed-trade count;
- `run_class_backtest` separately recomputes `win_rate_per_trade` from the full `trades_list` using the same executed-trade denominator;
- the class result then feeds those values into sanity/cross-validation/analytics/Forge scoring surfaces;
- therefore F-3 is **not** a SOURCE_FAITHFUL-only defect. It is a global realized-metric definition defect.

The worker was correct to stop without mutating production code.

**Global repair is authorized. Do not special-case SOURCE_FAITHFUL.**

No performance/edge run is authorized yet.

---

## 2. CRITICAL CORRECTION — DO NOT USE RAW VECTORBT `Status` AS THE SOLE CLOSED/OPEN AUTHORITY

AR-1103 correctly observes that the current metric code never filters on `Status`, but the next implementation must **not** simply begin filtering on the raw vectorbt status field.

Independent inspection of the class money path shows why.

`run_class_backtest` copies the original vectorbt trade record, then Trading Forge can override:

- `Avg Exit Price`;
- `Exit Idx`;
- `Exit Timestamp`;
- `exit_reason`;
- P&L.

The existing F-2 comments explicitly document that, on the source arm, vectorbt can still report a trade as `Status:"Open"` even after Trading Forge has supplied the managed exit. That stale vectorbt lifecycle field already caused the earlier exit-timestamp defect.

Therefore:

**RAW VECTORBT STATUS IS INPUT EVIDENCE, NOT FINAL EXIT AUTHORITY AFTER THE MANAGEMENT LAYER HAS OVERRIDDEN THE EXIT.**

A fix such as:

```python
closed = [t for t in trades_list if t.get("Status") == "Closed"]
```

would misclassify managed source exits as open and would create a second F-3 defect while appearing clean.

---

## 3. REQUIRED LIFECYCLE AUTHORITY

Introduce one deterministic **post-management lifecycle classification** used by both metric implementations.

Minimum contract:

```text
executed_trade_count = every executed trade record
closed_trade_count   = trades with a real resolved exit
open_trade_count     = executed trades with no resolved exit at measurement end
```

For a class-path trade whose exit was authoritatively resolved by Trading Forge management, the final emitted trade record must be lifecycle-consistent with that managed outcome. If Trading Forge owns the final exit identity, it must also own the final closed/open classification for that record.

For an unresolved position, keep it explicitly open. Do not fabricate an exit merely to make the metric code convenient.

Prefer a shared helper / normalized lifecycle field over three independent ad-hoc predicates. The helper must operate on the **final managed trade record**, not the pre-management vectorbt row.

Do not create a second backtester.

---

## 4. F-3 GLOBAL METRIC SEMANTICS

Use **closed trades only** for realized trade statistics:

- win rate;
- profit factor;
- average realized trade P&L;
- average winner / loser;
- winner-loser ratio;
- per-trade expectancy;
- `win_rate_per_trade`;
- any Forge-score/tier input whose documented meaning is realized trade performance.

Keep `total_trades` / executed-trade population semantics stable unless a separately named migration proves changing it is safe. Add explicit counts rather than silently redefining a field consumers may already interpret as "executed trades."

Preferred additive surface:

```text
total_trades / executed_trade_count
closed_trade_count
open_trade_count
realized_trade_count  # alias only if useful; do not create duplicate truth unnecessarily
```

If equity/net-liquidation includes mark-to-market value from an open position, preserve it as equity/MTM. Do not relabel that amount as realized trade P&L.

When `closed_trade_count == 0`, realized metrics must have an explicit deterministic empty-sample policy. Do not manufacture `0%` win rate or `inf` profit factor in a way that can be mistaken for observed performance. Reuse an existing repository convention if one exists; otherwise expose an explicit unavailable/insufficient-sample state and keep downstream scoring fail-safe.

---

## 5. REQUIRED DISCRIMINATORS

At minimum prove all of these before F-3 closes.

### A. Governing source shape

```text
2 managed closed source winners + 1 unresolved open source position
```

Expected:

```text
executed = 3
closed = 2
open = 1
realized denominator = 2
realized win rate = 100%
open record remains open
no synthetic final-bar exit
```

### B. Managed-status trap

Create a trade where the underlying vectorbt row says `Open`, but Trading Forge resolves the managed exit.

Expected:

```text
final lifecycle = Closed
managed Exit Idx / Exit Timestamp / exit_reason remain authoritative
trade is included in realized metrics
```

This discriminator is mandatory because a naive raw-Status filter would otherwise pass simpler tests while breaking the source path.

### C. True unresolved trade

Underlying trade remains unresolved after the management layer.

Expected:

```text
final lifecycle = Open
excluded from realized metrics
included in open exposure / MTM reporting where supported
```

### D. Fully closed parity

A fixture with only closed trades must keep its existing realized metrics byte/equality-stable except for intentionally additive count fields.

### E. Both money paths

Prove the correction in:

- `run_backtest`;
- `run_class_backtest`.

And prove `win_rate_per_trade` uses the same closed population as `win_rate` rather than inventing a third denominator.

### F. Mutation controls

At least one mutation must restore the old "open trade participates in realized denominator" behavior and make the tests red.

At least one mutation must trust raw vectorbt `Status` over a managed exit and make the managed-status trap red.

---

## 6. LEGACY REVALUATION — GLOBAL CORRECTION IS RIGHT, BUT MEASURE IT

The worker is correct that this repair can move historical legacy metrics, Forge scores, and promotion tiers for strategies whose measurement frame ends with an open position.

That is an **intentional correction of a proven pre-existing defect**, not a reason to preserve two contradictory metric definitions.

Before claiming the legacy surface unchanged, produce an impact receipt against the existing canonical acceptance population or the smallest already-governed population that exercises the legacy metric outputs.

Report:

```text
population members checked
members with no metric change
members whose win_rate changed
members whose profit_factor changed
members whose Forge score/tier changed
why each changed: terminal open position removed from realized sample
```

Do not manually preserve a historically wrong tier merely to avoid a diff.

Do not expand this into a 120-strategy performance campaign. This is a bounded correctness/revaluation census, not an edge search.

---

## 7. IMPLEMENTATION SHAPE — FASTEST ROBUST PATH

Authorized next unit: **`F3-REALIZED-LIFECYCLE-1`**.

Smallest acceptable order:

1. introduce/reuse one post-management lifecycle classifier;
2. make final managed trade records lifecycle-consistent;
3. centralize the closed-trade realized-metric population as far as practical without a broad refactor;
4. repair both duplicated metric sites plus `win_rate_per_trade`;
5. add executed/closed/open counts;
6. run the mandatory discriminators and mutation controls;
7. run bounded legacy revaluation census;
8. report to desk.

Do **not** combine this with sVkm timeframe reconciliation, broad source acceptance-manifest work, visual intelligence, scaling-plan work, or a performance backtest. Those remain separate ordered units from AR-1101.

---

## 8. STATUS

**AR-1103:** ACCEPTED.  
**F-3 blast radius:** CONFIRMED GLOBAL.  
**SOURCE-only special case:** FORBIDDEN.  
**Raw vectorbt Status as sole lifecycle authority:** FORBIDDEN.  
**F3-REALIZED-LIFECYCLE-1:** AUTHORIZED.  
**Performance/edge backtest:** NOT AUTHORIZED YET.  
**sVkm timeframe reconciliation:** STILL REQUIRED before performance.  
**SOURCE_FAITHFUL walk-forward:** STILL REFUSED pending separate certification.
