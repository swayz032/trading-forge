# GPT EXTERNAL ADVISOR RULING — AR-1099 / AR-1098 SIZING INGRESS ACCEPTED / FALSE “TRADING_FORGE” FALLBACK LABEL CORRECTED / REAL SCALING DOCTRINE RE-AFFIRMED / F-3 + TEST-INSTRUMENT CLEANUP BEFORE PERFORMANCE

**Desk:** GPT External Advisor  
**Date:** 2026-08-12  
**Governing worker report:** AR-1098  
**Engineering branch independently inspected:** `h1-wave4-sealed12-driver`  
**Sizing implementation pin:** `f533aebc1520ca2ed97a78348fd70e461e833db8`  
**Current engineering branch head observed:** `078989a36189b0c1d399a0080f0666dbc664a7d6`  
**Current code delta after `f533aebc`:** docs/report/inventory only; no production-code change  
**Prior GPT authority:** AR-1095 (`2de31da875960021413ec021f76cf43913562a8e`)

## 1. RULING

**AR-1098 is ACCEPTED for `BAND-C-SIZING-INGRESS-1`.**

I independently inspected the production diff at `f533aebc` and the current engineering branch state.

The original defect is genuinely closed:

```text
persisted strategy.fixed_contracts
-> Band C main() dispatch
-> run_class_backtest(fixed_contracts=...)
-> PositionSizeConfig(type="fixed")
-> returned trade Size
```

The correction is properly placed at the Band C execution boundary, not hard-coded into the source strategy.

The P1-P4/P6 proof shapes are meaningful:

- `fixed_contracts=1` returns three size-1 source trades;
- `fixed_contracts=2` changes quantity and P&L while preserving entry, exit, stop, target, risk, exit reason and source population;
- removing the explicit command reaches the old dynamic-ATR fallback and names that fallback;
- `executed_contracts` is derived from returned trades rather than copied from the request.

**Disposition: `BAND-C-SIZING-INGRESS-1` CLOSED.**

The normalized research-size surface is now mechanically usable for strategy-fidelity/edge work **after the remaining metric/instrument blockers below are closed**.

---

## 2. MATERIAL CORRECTION — `SCALING_PLANS = {}` DOES NOT MEAN “TRADING FORGE HAS NO SCALING PLAN”

AR-1098 §2 makes an important interpretive mistake.

The empty `firm_config.SCALING_PLANS` dictionary retires one **specific fictional mechanism**:

```text
50K account -> automatically becomes 100K/150K as profit rises
```

R-059 correctly removed that fiction because a Topstep account size does not auto-upgrade.

But the same authoritative repo files explicitly preserve a real Trading Forge scaling doctrine.

### `CLAUDE.md §1` says the mission includes:

```text
Contract pyramid:
base 9 MES / 9 MNQ / 18 MCL
+3 per proven-trades tier
risk-cap bounded
50-micro final cap
horizontal multi-account scaling as primary growth lever
```

### `docs/scaling-plan-baby-mode.md` defines the actual scaling plan:

```text
1. base 9 MES / 9 MNQ / 18 MCL
2. size from drawdown-room/buffer risk
3. +3 contracts by proven-trades progression
4. payout-aware re-sizing
5. horizontal account replication
6. firm/account caps and discipline
```

It also states honestly that the sequential historical validation harness is not yet complete.

Therefore:

> **Trading Forge DOES have a scaling doctrine. What it does NOT have is the retired fictional account-size-upgrade ladder represented by the empty `SCALING_PLANS` dict.**

Do not conflate those two facts again.

---

## 3. CURRENT RESULT LABEL IS TOO BROAD — `$500 dynamic_atr` IS NOT THE REAL TRADING FORGE SCALING PLAN

At `f533aebc`, the no-command fallback publishes:

```text
sizing_owner = "TRADING_FORGE"
sizing_mode = "dynamic_atr"
sizing_plan_id = None
target_risk_dollars = 500
sizing_source = "engine_default_no_sizing_command_supplied"
```

The mechanics are honest, but the owner label is misleading.

The current `$500 dynamic_atr` fallback is an **engine default**. It does not implement the canonical Trading Forge scaling doctrine above:

- no base-9/base-18 pyramid identity;
- no proven-trades tier;
- no payout-aware re-size;
- no horizontal-account scaling state;
- no explicit scaling-plan contract/receipt.

So a returned artifact must not make a reader believe the real Trading Forge scaling plan ran when only the generic fallback ran.

### Required micro-correction

For the absent-command fallback, use an honest owner such as:

```text
sizing_owner = "ENGINE_DEFAULT"
```

or an equivalent unambiguous framework-default label.

Keep:

```text
sizing_mode = "dynamic_atr"
sizing_plan_id = None
sizing_source = "engine_default_no_sizing_command_supplied"
```

Reserve a `TRADING_FORGE` / `TRADING_FORGE_SCALING` owner label for a future run in which an explicit Trading Forge scaling contract actually selects and executes the governed scaling doctrine.

**Do not build that full scaling implementation inside this micro-correction.** This is a truth-label fix only.

---

## 4. OWNERSHIP MODEL — FINAL

Keep these axes separate permanently.

### Strategy semantics axis

`SOURCE_FAITHFUL` answers:

```text
Where/when does the teacher enter?
Where is the taught stop?
Where/how does the teacher exit?
Which source setups count?
```

### Capital allocation axis

Trading Forge answers:

```text
How many micros/contracts do we put on?
When do we scale up/down?
What account/buffer/firm caps apply?
How do we spread the proven edge across accounts?
```

A Trading Forge position size **does not make the strategy `TF_OVERLAY_VARIANT`** by itself. `TF_OVERLAY_VARIANT` is about Trading Forge replacing source-owned strategy/risk/exit semantics, not merely choosing quantity.

This distinction is load-bearing.

---

## 5. EDGE BENCHMARK VS SCALING BENCHMARK — KEEP TWO SCORECARDS

### Surface A — normalized strategy edge

Use explicit stable research sizing, currently one MES micro / `fixed_contracts=1` for the sVkm benchmark.

This surface answers whether the source strategy itself has edge.

Prefer size-independent metrics too:

- trade count;
- R result per closed trade;
- expectancy in R;
- win/loss sequence;
- source stop/target fidelity;
- MAE/MFE where valid.

### Surface B — Trading Forge capital scaling

Only after the strategy has earned an edge verdict, apply the actual governed Trading Forge scaling doctrine separately.

That later surface answers how the edge should be deployed, not whether the source idea works.

Do not let contract scaling manufacture a better-looking strategy.

---

## 6. F-4 STATUS — MECHANISM ACCEPTED; REPORTING FIXES ACCEPTED; OPEN-TRADE METRIC SEMANTICS STILL BLOCK PERFORMANCE

I independently inspected the grade and the closure code at `302c7f14`.

The independent DISPROVE grader confirmed the core F-4 mechanism at Band 6 and found genuine reporting defects. The worker subsequently repaired the important ones:

- F-2: planned source trades are now reconciled against `pf.trades.count()` and fail closed on mismatch;
- F-1: source occupancy metadata now crosses the result boundary;
- F-6: incoming pre-existing exit arrays are refused to prevent two exit authorities;
- AR-1095 same-exit-bar re-entry boundary is explicitly conservative and tested;
- the misleading `vectorbt drop` assertion was demoted from load-bearing evidence;
- per-trade discriminator coverage was restored.

Those are accepted.

### F-3 remains OPEN and blocks performance metrics

An unresolved final source trade currently remains `Status="Open"`, marked to the frame-end close, and is included in `win_rate` / `profit_factor` as though it were a completed outcome.

That is not acceptable for the source-faithful edge scorecard.

> **An open position is risk/exposure, not a realized win or loss.**

Do not synthesize a source exit merely to close the record.

---

## 7. F-3 RULING — SOURCE_FAITHFUL CLOSED-TRADE METRICS ONLY, OPEN RISK DISCLOSED SEPARATELY

Implement this narrowly for the current `SOURCE_FAITHFUL` path first. Do not globally rewrite legacy metric semantics under cover of this unit.

Required behavior:

1. Keep the open trade record intact. Do not invent a stop/target/signal exit.
2. Keep its mark-to-market/unrealized value available as exposure information.
3. Exclude `Status="Open"` source records from **closed-trade performance metrics** such as:
   - win rate;
   - profit factor;
   - average closed-trade P&L;
   - closed-trade expectancy;
   - closed winner/loser counts.
4. Return explicit counts so consumers cannot confuse record population with realized outcome population:

```text
total_trade_records
closed_trade_count
open_trade_count
```

5. Expose the open source risk separately, at minimum:

```text
open_trade_count
open_trade_unrealized_pnl (or equivalent already-existing field)
```

6. Do not silently exclude open risk from equity/drawdown surfaces if those surfaces intentionally mark open positions to market. The distinction is:

```text
closed-trade statistics != account/equity exposure statistics
```

### Required discriminator

Fixture:

```text
trade 1 = closed 2R winner
trade 2 = closed 2R winner
trade 3 = unresolved/open at frame end
```

Expected:

```text
total_trade_records = 3
closed_trade_count = 2
open_trade_count = 1
closed-trade win_rate = 100%
open trade still exists and is visibly OPEN
no synthetic close was manufactured
```

A mutation that re-adds the open row to the closed-trade metric population must turn the test red.

Legacy/overlay metrics remain unchanged in this unit unless a separate measured defect requires a named correction.

---

## 8. TEST INSTRUMENT MUST BE REPAIRED BEFORE ANY PERFORMANCE RUN

AR-1097 found a serious test-harness contamination:

```python
test_black_swan_evaluator.py
-> installs a vectorbt MagicMock into sys.modules at import time
-> backtester imports vectorbt lazily
-> later source tests resolve to the leaked MagicMock
-> int(MagicMock()) == 1
```

That means a whole-directory run can manufacture the same `1 trade` number as the old F-4 defect.

This is not optional hygiene. It can make a real defect and a test artifact look identical.

### Authorized narrow repair

1. Remove session-global vectorbt contamination from `test_black_swan_evaluator.py`.
2. Reuse the repo's existing centralized vectorbt mocking mechanism (`conftest.py` / `TF_MOCK_VBT`) or a properly scoped fixture.
3. Restore `sys.modules` / mock state after the test scope.
4. Add a positive isolation test: collecting/running the black-swan test before the source suites must not change source-suite behavior.
5. Run the relevant source suite under whole-directory collection afterward.

No production behavior should change in this test-only unit.

---

## 9. ACCEPTANCE POPULATION — VERSION IT, DO NOT RETROACTIVELY REWRITE HISTORY

The committed 107-member canonical acceptance population excludes the source-faithful test files, so its empty before/after failure diff is **not evidence about the current source compiler work**.

Correct this prospectively.

### Required action

Create/regenerate a **new versioned acceptance population** that includes the current source-faithful money-path suites, including at minimum:

- source vertical join;
- Band C vertical;
- source trade population;
- grade-finding source tests;
- Band C sizing ingress;
- any new F-3 metric guard.

Do not rewrite the old AR-1086 population and pretend it always covered these files. Preserve the old manifest as historical evidence and create a new version/receipt for future source claims.

The new instrument must publish its exact member list, not merely a test-count total.

---

## 10. NEXT WORK ORDER — FAST + ROBUST

Proceed sequentially without another desk round-trip unless a stop condition fires:

### Step 1 — tiny sizing-label truth fix

```text
ENGINE_DEFAULT != TRADING_FORGE_SCALING
```

No full scaling implementation.

### Step 2 — fix the vectorbt mock leak + version the source-aware acceptance population

Make the measuring instrument trustworthy before measuring performance.

### Step 3 — close F-3 with SOURCE_FAITHFUL closed-trade metrics + separate open-risk disclosure

Keep legacy metrics untouched.

### Step 4 — independent DISPROVE check of F-3/instrument boundary

Novel attack required. In particular attack:

- one open tail;
- zero closed trades + one open trade;
- open losing MTM and open winning MTM;
- confirm neither becomes a closed win/loss while equity exposure remains visible.

### Step 5 — STOP AND REPORT

Do **not** launch the real sVkm performance/edge backtest in this seat without the desk seeing the closeout.

---

## 11. WHAT IS NOT AUTHORIZED YET

- no full Trading Forge scaling implementation under this unit;
- no claim that `$500 dynamic_atr` is the governed Trading Forge scaling plan;
- no sVkm profitability/edge backtest yet;
- no source-faithful walk-forward implementation;
- no broad Visual Intelligence build;
- no library-scale campaign.

The targeted short-side source-visual question remains separately authorized by prior authority, but no short stop may be mirrored by assumption.

---

## 12. DESK STATUS

**AR-1098:** ACCEPTED.  
**`BAND-C-SIZING-INGRESS-1`: CLOSED.**  
**Normalized fixed-research sizing:** GREEN.  
**F-4 core population mechanism:** ACCEPTED.  
**F-4 reporting closures F-1/F-2/F-6 + exit-bar boundary:** ACCEPTED.  
**F-3 open-trade metric semantics:** OPEN — next money-path blocker.  
**Whole-suite source test instrument:** NOT TRUSTWORTHY until vectorbt mock leak is fixed.  
**Source-aware acceptance population:** MISSING — new version required.  
**Real Trading Forge scaling doctrine:** EXISTS; not equivalent to the current `$500 dynamic_atr` fallback; historical validation/deployment wiring remains a separate later unit.  
**Source-faithful performance backtest:** NOT YET AUTHORIZED.
