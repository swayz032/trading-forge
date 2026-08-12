# AR-1019 — WORKER — THE "ZERO-TRADE CLUSTER" IS TWO DIFFERENT ROOTS · 1 CLASSIFIED · 3 ARE A CANDIDATE `PRODUCT_OR_ENGINE_DEFECT`

```
RULING : GPT ruling on AR-1017 §2/§6. Reporting NOW, mid-cluster, because §6 says
         do not wait when a PRODUCT_OR_ENGINE_DEFECT candidate appears.
PIN    : c59ee2a37a34f51e419166371fd3da523bef3595
STATUS : 23 of 35 classified. 12 remain. Nothing repaired. No seal, no census.
```

## 1. THE CLUSTER I REPORTED AS ONE IS TWO — AND I NEARLY MERGED THEM

In `AR-1018` I listed the 4 `test_pnl_accuracy.py` nodes as one "zero trades" root. **That was
wrong, and only checking the fixtures separately caught it:** one test uses a monotonic ramp, the
other three use `_make_alternating_ohlcv()`. Different data, different root, opposite conclusions.
★ **`A SHARED SYMPTOM IS NOT A SHARED CAUSE — AND "ZERO TRADES" IS A SYMPTOM.`**

## 2. ROOT A — 1 NODE — `TEST_CONTRACT_DEFECT`

**`test_pnl_accuracy.py::TestCommissionImpact::test_commission_per_trade_matches_formula`**

| field | value |
|---|---|
| causal root | The fixture is `_make_controlled_ohlcv([4000 + i*0.5 for i in range(200)])` — a **strictly monotonic ramp** — paired with `entry_long="close crosses_above sma_5"`. **A monotonic series cannot cross its own moving average.** |
| proof `[MEASURED HERE]` | close > sma_5 on **196 of 200** bars, close < sma_5 on **0**. `crosses_above` events: **0**. `crosses_below` events: **0**. **POSITIVE CONTROL:** the same detector on an oscillating series returns **5** crossings ⇒ the zero is a property of the data, not of my instrument. |
| production implicated? | **NO.** The strategy cannot signal on this data; the engine is never asked to open a trade. |
| repair required? | **NO.** |

⚖️ **The RED itself is correct and must not be weakened.** The `assert len(result["trades"]) > 0`
was added by the `F-4` vacuity sweep (`R-630`) precisely because this test previously passed
**vacuously** with zero trades. Prior art is explicit (ledger line 3245): *"`F-4`'s philosophy is
upheld and may NOT be weakened: a commission test that produces zero trades has proven nothing, so
`zero trades → RED` is correct."* **The guard is doing its job; the fixture is the defect.**

🛑 **BOUND:** this explains the non-pass. **It does not verify the commission formula** — that
assertion still never executes. The commission-per-trade contract remains **unexercised by this
node**.

## 3. ROOT B — 3 NODES — **CANDIDATE `PRODUCT_OR_ENGINE_DEFECT`, NOT YET CLASSIFIED**

**`TestWave1CommissionGoldenFixture::{test_topstep_mes_commission_per_trade_contract,
test_mffu_mes_commission_per_trade_contract, test_prop_sim_trusts_net_pnl_no_double_deduction}`**

These use `_make_alternating_ohlcv()` with `entry_long="close crosses_above sma_3"`. **I expected
the same degenerate-fixture answer. It is the opposite.**

```
the fixture is a SQUARE WAVE between exactly two levels (4950.0 / 5050.0),
so close == sma_3 on 72 of 120 bars -- a knife edge:
    crosses_above with prev <  sma  (strict) ->  0 signals
    crosses_above with prev <= sma  (loose)  -> 11 signals

THE ENGINE'S OWN CONVENTION, read at src/engine/signals.py:44-50 (executable line):
    _crosses_above = (a > b) & (a.shift(1) <= b.shift(1))     <- LOOSE

RUNNING THE ENGINE'S OWN _crosses_above / _crosses_below ON THAT EXACT FIXTURE:
    crosses_above : 11 signals
    crosses_below : 12 signals
```

⇒ **THE ENTRY CONDITION DOES FIRE — 23 SIGNALS — AND THE BACKTEST STILL RETURNS
`total_trades == 0`.** The trades are lost **between signal generation and trade creation**. The
fixture is not degenerate and does not explain this.

🛑 **I am NOT yet calling this a product defect.** What is measured: signals fire; trades do not
appear. What is **not** measured: which stage discards them (position sizing, ATR stop
construction, the performance gate, the OOS split, or trade recording). Naming a category now would
be the `probably legacy` shape `§4` forbids.

⚠️ **The test's own text pre-empts the easy escape:** *"in-process fixture produced zero trades, so
the commission-rate contract was never exercised — **fixture or engine regression, not an
environment gap**"*, and `R-815 Cluster B` records that the test **controls** this fixture
in-process with no external dependency. So "it's the environment" is already excluded by prior art.

## 4. §3 — `STOP [44]` REMAINS `UNENUMERATED`

Unchanged from `AR-1018`: the historical 7-node PnL set is not enumerated anywhere in the ledger,
so it is not used as authority over these four. Each of the four is being dispositioned on its own
measured evidence — and that has already produced **two different answers**, which is itself the
argument against inheriting a bulk disposition from a number.

## 5. RUNNING TALLY

```
18  test_a_plus_gate_parity          TEST_CONTRACT_DEFECT    accepted, AR-1017 ruling §1
 2  session_role_adversarial_fence   INTENTIONAL_NEGATIVE    proven strict-xfail
 2  production_hardening_g2a_g2b     TEST_CONTRACT_DEFECT    proven comment-match
 1  pnl_accuracy commission formula  TEST_CONTRACT_DEFECT    monotonic fixture, 0 crossings
--- 23 classified -------------------------------------------------------------
 3  pnl_accuracy golden fixtures     CANDIDATE PRODUCT/ENGINE -- signals fire, trades do not
 3  parameter_jitter_battery          incl. IndexError at src/engine/parameter_jitter_battery.py:422
 2  accuracy_fixes                    $1/day commission delta when rates MATCH; BARS_PER_DAY 860 vs 1380
 1  apply_trade_management_branching  trail_stop 3991.0, expected >= BE 4000.0
 1  e2e_backtest walk_forward_mode    0 windows, expected 3  (SEPARATE root -- windows, not trades)
 1  three_fixes                       max_dd short by 0.0000000000038 against a 0.01 tolerance
 1  wave_b_intrabar_stops             exit bar 3, expected 5
--- 12 remaining ---------------------------------------------------------------
```

## 6. STOPS

**None FIRED.** §7[2] is **one measurement away**: if the 23 lost signals trace to engine
behaviour, that is a `PRODUCT_OR_ENGINE_DEFECT` on a P&L surface and it stops here before census or
seal. Continuing the bounded investigation into which stage discards the signals; the result lands
on this branch either way.
