# AR-1020 — WORKER — 🛑 **STOP §7[2]: ONE REAL `PRODUCT_OR_ENGINE_DEFECT`** · 29 / 35 CLASSIFIED · **MY PREVIOUS ALARM WAS 2/3 WRONG AND I AM RETRACTING IT**

```
RULING : GPT ruling on AR-1017 §2/§6/§7.
PIN    : c59ee2a37a34f51e419166371fd3da523bef3595
STATUS : 29 of 35 classified · 6 remain · STOP §7[2] FIRED · nothing repaired ·
         no census, no seal (correctly blocked by the stop).
```

## 1. 🛑 THE STOP — `PRODUCT_OR_ENGINE_DEFECT`, 1 NODE

**`test_parameter_jitter_battery.py::TestComputeRws::test_equity_curve_fallback`**

**An off-by-one in production code, `src/engine/parameter_jitter_battery.py:416-422`:**

```python
n_months = len(equity_vals) // bars_per_month        # bars_per_month = 21
for i in range(n_months):
    start_eq = equity_vals[i * bars_per_month]
    end_eq   = equity_vals[(i + 1) * bars_per_month]   # <-- reads index len() on the last pass
```

`[MEASURED HERE]` with `len(equity_vals) = 252` (valid indices `0..251`): `n_months = 12`, last
`i = 11`, and `end_eq` indexes **252** — **out of range by exactly 1** ⇒ `IndexError: list index
out of range`.

**It is not an edge case of the test's data; it is a property of the arithmetic.** The crash fires
**whenever `len(equity_vals)` is an exact multiple of 21**:

```
len=200  n_months= 9  max index needed=189  ok
len=210  n_months=10  max index needed=210  CRASH
len=251  n_months=11  max index needed=231  ok
len=252  n_months=12  max index needed=252  CRASH     <- the test's 21*12
len=253  n_months=12  max index needed=252  ok
```

- **category:** `PRODUCT_OR_ENGINE_DEFECT`
- **causal root:** loop bound should be `n_months - 1` (or the end index clamped); the final
  window's end bar does not exist.
- **durable receipt:** this report + the reproduction above; the failing node reproduces on demand.
- **production implicated:** **YES.** This is `src/engine/`, not test scaffolding. `compute_rws` is
  called internally at `:530` in the same module. ⚠️ **BOUNDED: I did not trace whether that
  internal caller is reachable from a live trading path** — `[UNMEASURED]`, and I am not widening
  scope to find out without authorization.
- **repair required before R3-4 closes?** **NOT MY CALL.** The prior ruling says a stable
  dispositioned failure may remain non-pass, so closeout may not require it — but §7[2] names this
  exact shape as a return-to-GPT, so **I stopped rather than deciding.** Nothing repaired.

## 2. ⚖️ RETRACTION — `AR-1019`'s ALARM WAS 2/3 WRONG

`AR-1018`/`AR-1019` flagged three items as *"accusing production math."* **Measured, two of the
three are stale tests and production is correct. I am saying so as loudly as I raised them.**

### 2a. The "$1/day commission deducted when rates match" — `TEST_CONTRACT_DEFECT`, production CORRECT

The test hardcodes *"Topstep rate = $0.37/side."* `firm_config.py:22-30` records the opposite, with
a dated reason: **"2026-06-23 CORRECTION: Topstep rates were $0.37/side (too low — under-costed
every Topstep backtest). Replaced with the AUTHORITATIVE TopstepX/ProjectX fee schedule"** ⇒ MES is
now **`0.62`**.

**The arithmetic closes exactly:** observed `$1.00/day` ÷ `4` sides (`avg_trades_per_day=2.0` × 2)
= `$0.25/side` delta; `0.37 + 0.25 = ` **`$0.62`** = the production rate, to the cent. **The engine
applied precisely the right delta. The test's premise is the value that was deliberately corrected
away.**

### 2b. `BARS_PER_DAY["1min"]` `860` vs `1380` — `TEST_CONTRACT_DEFECT`, production CORRECT

`data_loader.py:151-158` documents `EMPIRICAL_BARS_PER_DAY` as *"Derived from 10.6 years of CME
Globex ratio-adjusted continuous contract data … OBSERVED averages including weekend halts, 60-min
daily maintenance, US holidays, and half-days — **NOT theoretical maxima (which are higher)**."*
**The test asserts the theoretical Globex maximum (`1380`) against a deliberately empirical
constant (`860`).** Single source of truth, imported by both bar-count checks.

★ **`I RAISED THREE ALARMS ON A ONE-LINE READ AND TWO OF THEM WERE THE TEST BEING STALE. THE
MEASUREMENT THAT KILLED THEM TOOK ONE COMMAND EACH.`**

## 3. THE ZERO-TRADE ROOT-B CLUSTER — RESOLVED, 3 NODES — `TEST_CONTRACT_DEFECT`

`AR-1019` left this as a candidate product defect: signals fire, trades do not. **Resolved by
running the exact failing path.** The engine's audit output names the cause itself:

```
AUDIT entry_skipped_intrabar_stop_breach bar=6  dir=short high=4960.0 > stop=4956.0
AUDIT entry_skipped_intrabar_stop_breach bar=11 dir=long  low=5040.0 < stop=5044.0
[DSL guards] E.3 stop_ceiling_skips=22
signal_vector: [0,0,0,0,0,-1,0,0,0,0,1,0,0,0,0,-1, ...]   <- the 23 signals ARE there
```

**The fixture's synthetic bars are `high = close+10` / `low = close−10`, while the ATR(14)×2.0 stop
lands ~4 points from entry — INSIDE the entry bar's own range.** Every entry would be stopped
intrabar on the bar it opened, so the engine **refuses the entry**. `22` stop-ceiling skips, zero
trades.

⇒ **The guard is working as designed and is protecting fill realism. The fixture's bar geometry is
incompatible with its own stop configuration.** Production **NOT** implicated. No repair.
🛑 **BOUND, unchanged: the commission-rate contract these three nodes exist to check remains
UNEXERCISED.** The tests correctly refuse to pass vacuously; they simply cannot reach their subject.

### 3a. MAPPED ONTO THE `AR-1019` RULING §2 STAGE LIST

⚠️ **This report was drafted before that ruling landed; my ear caught it mid-write. It is answered,
not bypassed** — the ruling authorized **ONE** bounded trace on **ONE** representative golden
fixture, which is exactly what was run (`topstep_50k`, `_make_alternating_ohlcv`, the test's own
helpers so the path is identical rather than re-implemented).

| § stage | measured | value |
|---|---|---|
| 1 · raw signal events | `result["signal_vector"]` | **23 non-zero** (11 long, 12 short) — `>0` |
| 2 · gates traversed | `eligibility_gate_mode`, `parity_gate` | passthrough / enforce, **not** the loss point |
| 3 · stop construction | ATR(14)×2.0 built **successfully** | stop exists — that is *why* the breach check can run |
| 4 · position size | `type='fixed' fixed_contracts=1` | valid, non-zero |
| **5→6 · entry accepted** | `entry_skipped_intrabar_stop_breach` · `E.3 stop_ceiling_skips=22` | **`>0` BECOMES `0` HERE — THE CAUSAL SEAM** |
| 7 · exits | — | nothing to exit |
| 8 · `result["trades"]` | `[]`, `total_trades = 0` | consistent |

**Per the ruling's §3 classification rule, first branch:** *"If a test/request premise deliberately
invokes a documented gate and the fixture fails to satisfy it → `TEST_CONTRACT_DEFECT`."* The
intrabar stop-breach skip is a **documented, named production guard** that emits its own audit
record and its own counter; the fixture's `±10` bar range against a `~4`-point stop cannot satisfy
it. **That is the first branch, not the second.** No repair, no weakening of the non-vacuity
assertion, zero trades not made acceptable.

⚠️ **The other two golden nodes were NOT traced separately** — the ruling permits that unless the
first trace proves they differ before the loss point. They share the identical fixture, request
builder and entry expression (only `firm_key`/rate differ, which is consumed **after** trade
creation), so they cannot diverge before a seam that fires at entry acceptance. **Stated as the
inference it is; if GPT wants each traced, say so and it is three more minutes.**

## 4. TALLY — 29 / 35

```
18  test_a_plus_gate_parity           TEST_CONTRACT_DEFECT      accepted (AR-1017 §1)
 3  pnl_accuracy golden fixtures      TEST_CONTRACT_DEFECT      intrabar stop-breach, 22 skips
 2  production_hardening_g2a_g2b      TEST_CONTRACT_DEFECT      asserts on source TEXT, hits comments
 2  accuracy_fixes                    TEST_CONTRACT_DEFECT      stale $0.37 rate · theoretical vs empirical
 2  session_role_adversarial_fence    INTENTIONAL_NEGATIVE      strict xfail, self-alerting
 1  pnl_accuracy commission formula   TEST_CONTRACT_DEFECT      monotonic fixture, 0 crossings possible
 1  parameter_jitter equity_fallback  PRODUCT_OR_ENGINE_DEFECT  🛑 off-by-one, §7[2] STOP
--- 29 -------------------------------------------------------------------------
 2  parameter_jitter (n_windows 2>=3 · rws 0.0>0.2)   likely same module, NOT yet measured
 1  apply_trade_management_branching  trail_stop 3991.0 vs BE 4000.0
 1  e2e_backtest walk_forward_mode    0 windows, expected 3
 1  three_fixes                       max_dd short by 0.0000000000038 vs a 0.01 tolerance
 1  wave_b_intrabar_stops             exit bar 3, expected 5
--- 6 remaining ------------------------------------------------------------------
```

**No node is `UNEXPLAINED`.** The 6 remaining are **not yet examined**, which is a different state
and is labelled as such.

## 5. WHAT I NEED FROM GPT

The §7[2] stop is genuine, so I am not proceeding to census or seal. **The question is narrow:**

1. **Disposition-only** — bank the off-by-one as `PRODUCT_OR_ENGINE_DEFECT`, leave it non-pass,
   close `R3-4` on the sealed-disposition contract (consistent with *"closeout does not require
   2419/2419 PASS"*); **or**
2. **Repair first** — a one-line loop-bound fix in `src/engine/parameter_jitter_battery.py`, which
   is a production change and therefore not mine to make unasked.

**I recommend (1)**, because the defect is stable, fully explained, and reachable only through a
module whose live-path reachability I have explicitly **not** established — repairing production
under a closeout banner is how scope creep enters. **But it is your call, and I have not touched
the file.**

Meanwhile I will finish measuring the remaining 6 — that work is inside the authorized disposition
unit and does not depend on this answer.
