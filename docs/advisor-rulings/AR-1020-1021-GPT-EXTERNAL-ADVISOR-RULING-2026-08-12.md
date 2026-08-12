# GPT EXTERNAL ADVISOR RULING — AR-1020 / AR-1021 / PRODUCT OFF-BY-ONE CONFIRMED / REPAIR FIRST / FINISH REMAINING DISPOSITION BUT NO CENSUS OR SEAL UNTIL POST-REPAIR MAP

**Date:** 2026-08-12  
**Reviewed reports:** `AR-1020-WORKER-STOP-PRODUCT-DEFECT-29-OF-35-2026-08-12.md`, `AR-1021-WORKER-30-OF-35-2026-08-12.md`  
**Evidence pin:** `c59ee2a37a34f51e419166371fd3da523bef3595`

## VERDICT

**AR-1020 = ACCEPTED FOR STOP.**  
**AR-1021 = ACCEPTED AS IN-PROGRESS DISPOSITION.**

The `compute_rws()` equity-curve fallback contains a real production off-by-one. At the evidence pin, production computes:

```python
n_months = len(equity_vals) // 21
for i in range(n_months):
    start_eq = equity_vals[i * 21]
    end_eq = equity_vals[(i + 1) * 21]
```

For an exact multiple of 21, the final iteration reads index `len(equity_vals)`. This is a deterministic `IndexError`, not a test-contract disagreement.

The reachability question is sufficiently answered for policy: `run_b15_battery()` directly calls `compute_rws()`. This is the parameter-robustness battery we expect to rely on during edge qualification. A crash or wrong robustness result here can corrupt the evidence used to decide whether a strategy has edge.

Therefore:

# REPAIR FIRST.

Do **not** seal this as accepted production debt.

## 1. REPAIR SCOPE

Repair only the equity-curve fallback window-boundary defect in `src/engine/parameter_jitter_battery.py`.

Do not redesign RWS. Do not change thresholds. Do not change windowing semantics. Do not alter monthly-return handling unless directly required by the off-by-one correction.

The intended invariant is:

> Every monthly return uses two existing equity observations; no iteration may index beyond the final equity observation.

Choose the smallest implementation that satisfies that invariant. `range(n_months - 1)` is plausible, but the worker must verify expected semantics rather than blindly copy that spelling.

## 2. REQUIRED RED / GREEN / CONTROLS

Before repair, preserve a RED reproduction for at least:

- `len=252` (`21 * 12`) → current `IndexError`.

After repair require:

- `len=252` → no exception;
- produced return count matches the number of complete start/end 21-bar intervals actually available;
- a non-multiple case such as `len=253` remains valid and does not lose a legitimate final interval;
- a shorter non-multiple control such as `len=200` remains behaviorally stable unless the corrected interval definition proves the previous count was itself wrong.

Add/adjust the minimum targeted regression test needed to lock the boundary. Do not create a new checker framework.

## 3. TARGETED TEST ORDER

Run, in order:

1. the exact failing node `TestComputeRws::test_equity_curve_fallback`;
2. the full `test_parameter_jitter_battery.py` file;
3. only the smallest directly-related robustness tests needed if the file exposes another causal root.

If the repair changes unrelated behavior, STOP.

## 4. `test_rws_failure_blocks` REMAINS UNCLASSIFIED

AR-1021 correctly refused to lump it under the test-helper key-collision defect.

Its direct `compute_rws()` value and its `run_b15_battery()` value disagree materially. That is a separate causal question.

Perform **one bounded trace** through `run_b15_battery()` for that node:

`base_backtest_result -> compute_rws input -> compute_rws output -> rws_detail -> returned rws -> threshold decision`.

If the value changes between those stages, name the exact seam.

If a production defect is found, report it before repair unless it is literally the same off-by-one root already authorized here.

If no root is found after that bounded trace, classify `UNEXPLAINED` and STOP.

## 5. REMAINING FOUR DISPOSITIONS

Worker may continue diagnosing the other four currently-unclassified nodes while the STOP is being resolved:

- `apply_trade_management_branching`
- `e2e_backtest::test_walk_forward_mode`
- `three_fixes::max_dd`
- `wave_b_intrabar_stops`

Classification work is authorized.

Production repair is **not** authorized for any new root. Any additional `PRODUCT_OR_ENGINE_DEFECT` returns to GPT before mutation.

## 6. POST-REPAIR AUTHORITY MAP IS REQUIRED

Because this ruling authorizes a production change, the old `35`-node final map cannot be the final sealing authority.

After:

- the off-by-one repair is GREEN;
- all remaining nodes are classified or a new STOP is reported;

run **ONE** new canonical promoted ACCEPT-5 authority map.

Compare it by exact node ID/outcome to the pre-repair map.

Expected minimum change if nothing else moved:

- the repaired `equity_curve_fallback` node should leave the non-pass set.

But do **not** assume the final count. Measure it.

Any unexpected outcome movement is a STOP.

## 7. NO CENSUS / SEAL YET

Until the post-repair final map exists:

- no census 32 finalization;
- no successor disposition seal;
- no canonical closeout declaration;
- no R3-4 closure.

The worker was correct to hold these.

## 8. ACCEPTED DISPOSITIONS SO FAR

The following running classifications remain accepted subject to the post-repair exact map:

- 18 A+ parity nodes → `TEST_CONTRACT_DEFECT`;
- 3 PnL golden fixtures → `TEST_CONTRACT_DEFECT` (entry-bar intrabar-stop-breach fixture geometry; engine guard working as designed);
- 2 G2b source-text tests → `TEST_CONTRACT_DEFECT`, with the underlying behavioral property explicitly still unverified;
- 2 accuracy-fixes nodes → `TEST_CONTRACT_DEFECT` (stale $0.37 rate; theoretical-vs-empirical bars/day premise);
- 2 session-role fence nodes → `INTENTIONAL_NEGATIVE` (strict xfail self-alerting);
- 1 commission-formula node → `TEST_CONTRACT_DEFECT` (monotonic fixture cannot cross SMA);
- 1 jitter n_windows node → `TEST_CONTRACT_DEFECT` (24 values collapsed to 12 dict keys);
- 1 jitter equity fallback node → `PRODUCT_OR_ENGINE_DEFECT`, **repair authorized by this ruling**.

## 9. FAST PATH

Exact next order:

1. advisor-skill preflight this ruling;
2. RED reproduce the off-by-one;
3. smallest production repair;
4. targeted GREEN + boundary controls;
5. bounded `test_rws_failure_blocks` stage trace;
6. finish remaining four dispositions;
7. if no new production STOP, ONE new final canonical authority map;
8. exact pre/post map comparison;
9. then census 32;
10. one successor disposition seal;
11. canonical ACCEPT-5 closeout;
12. close R3-4.

# DO NOT BANK A DEFECT IN THE ROBUSTNESS BATTERY WE PLAN TO TRUST FOR EDGE QUALIFICATION.

Fix this one cleanly, prove the boundary, then finish R3-4 and get back to the money path.
