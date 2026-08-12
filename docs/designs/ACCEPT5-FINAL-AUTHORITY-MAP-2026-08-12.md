# ACCEPT-5 FINAL POST-CLUSTER-E AUTHORITY MAP

**Produced:** 2026-08-12 · **Pin:** `c59ee2a37a34f51e419166371fd3da523bef3595` · **Tree:** `wt-h1-wave4-20260712`
**Instrument:** the PROMOTED isolated ACCEPT-5 execution authority (`scripts/accept5_isolated_runner.py`), ONE canonical run, no reverse arms, no five-arm campaign.
**Authorized by:** GPT ruling on `AR-1015` §7.

## 1. THE MAP

```
children (governed files)     : 108
nodes collected               : 2419
nodes in the outcome map      : 2419
  passed                      : 2384
  failed                      : 33
  xfailed                     : 2
  xpassed                     : 0
  skipped                     : 0
  error                       : 0
NON-PASS TOTAL                : 35

duplicate node IDs            : 0
collected-but-unexecuted      : 0
invalid / refused children    : 0
missing nodes                 : 0   (map size == collected == 2419)
invented / unauthorized nodes : 0   (node-ID set == the certified set, below)
limited subset                : False
layer-2 isolation active      : True
wall clock, serial            : 6.4 min   (pre-registered ceiling 10.0)
tree head before / after arm  : c59ee2a3 / c59ee2a3
manifest sha256               : 2a49aea9a248698b17902c4d9a9b154a2c47c28e15f4123d89533c9818de9a52
```

## 2. TWO-PATH DERIVATION — AND THE VACUOUS FIRST ATTEMPT

`PATH A` = `aggregate.json['outcomes']` (the plugin's map).
`PATH B` = every child's `acceptance-run.xml` — **pytest's own JUnit output, the raw measurement** — joined to node IDs by document order against that child's `node-sequence.json`.

```
PATH A            2419 nodes   passed 2384 · failed 33 · xfailed 2
PATH B            2419 nodes   passed 2384 · failed 33 · xfailed 2
intersection      2419         in A not B: 0    in B not A: 0
disagreements     0
children whose XML length != node-sequence length : 0 of 108
```

🛑 **RECORDED AGAINST MYSELF: the first `PATH B` reconstructed node IDs from the XML's own `file`/`classname` attributes. Those IDs joined to NOTHING — the intersection was EMPTY, so the `0 disagreements` it printed was VACUOUS.** It was caught by printing the join sizes beside the verdict. ★ `A CROSS-CHECK WITHOUT A JOIN SIZE IS NOT A CROSS-CHECK.` The numbers above are from the repaired join.

## 3. IS IT STILL THE SAME 33? MEASURED, NOT ASSUMED

Compared against the certified pre-Cluster-E arm `A` at pin `f4e9a9d2` (`wt-cert5b-f4e9a9d2/cert-arms-new/A`):

```
node-ID sets identical            : True
  only in PRE-E                   : 0
  only in POST-E                  : 0
NON-PASS set identical BY EXACT ID: True   (35 nodes)
outcome changes on shared nodes   : 0
```

⇒ **The count `33` is the same count AND the same set.** `STOP [37]` is honoured: the claim is exact node-ID identity, never *"still 33"*. **Promotion and Cluster-E are outcome-neutral over the governed population — proven, not asserted.**

## 4. THE 35 NON-PASS NODES, EXACT IDs

| file | count |
|---|---|
| `src/engine/tests/test_a_plus_gate_parity.py` | 18 |
| `src/engine/tests/test_accuracy_fixes.py` | 2 |
| `src/engine/tests/test_apply_trade_management_branching.py` | 1 |
| `src/engine/tests/test_e2e_backtest.py` | 1 |
| `src/engine/tests/test_parameter_jitter_battery.py` | 3 |
| `src/engine/tests/test_pnl_accuracy.py` | 4 |
| `src/engine/tests/test_production_hardening_g2a_g2b.py` | 2 |
| `src/engine/tests/test_session_role_adversarial_fence.py` | 2 |
| `src/engine/tests/test_three_fixes.py` | 1 |
| `src/engine/tests/test_wave_b_intrabar_stops.py` | 1 |

```
failed   src/engine/tests/test_a_plus_gate_parity.py::TestAPlus_Gate_Wiring::test_empty_factors_list_bypasses_gate
failed   src/engine/tests/test_a_plus_gate_parity.py::TestAPlus_Gate_Wiring::test_gate_stats_totals_are_consistent
failed   src/engine/tests/test_a_plus_gate_parity.py::TestAPlus_Gate_Wiring::test_legacy_provenance_bypasses_gate
failed   src/engine/tests/test_a_plus_gate_parity.py::TestAPlus_Gate_Wiring::test_macro_alignment_always_passes
failed   src/engine/tests/test_a_plus_gate_parity.py::TestAPlus_Gate_Wiring::test_min_factors_gate_blocks_when_insufficient
failed   src/engine/tests/test_a_plus_gate_parity.py::TestAPlus_Gate_Wiring::test_min_factors_gate_passes_when_sufficient
failed   src/engine/tests/test_a_plus_gate_parity.py::TestAPlus_Gate_Wiring::test_no_entry_quality_bypasses_gate
failed   src/engine/tests/test_a_plus_gate_parity.py::TestAPlus_Gate_Wiring::test_short_entries_also_evaluated
failed   src/engine/tests/test_a_plus_gate_parity.py::TestAPlus_Gate_Wiring::test_structural_setup_always_satisfies
failed   src/engine/tests/test_a_plus_gate_parity.py::TestAPlus_Gate_Wiring::test_volume_confirmation_blocks_low_volume
failed   src/engine/tests/test_a_plus_gate_parity.py::TestAPlus_Gate_Wiring::test_volume_confirmation_passes_high_volume
failed   src/engine/tests/test_a_plus_gate_parity.py::TestAPlus_Gate_Wiring::test_vp_shape_fail_open_when_no_timestamp
failed   src/engine/tests/test_a_plus_gate_parity.py::TestBackwardCompat::test_StrategyConfig_accepts_entry_quality_dict
failed   src/engine/tests/test_a_plus_gate_parity.py::TestBackwardCompat::test_StrategyConfig_entry_quality_defaults_to_none
failed   src/engine/tests/test_a_plus_gate_parity.py::TestBackwardCompat::test_no_entry_quality_does_not_block_any_entry
failed   src/engine/tests/test_a_plus_gate_parity.py::TestFactorMathParity::test_rolling_volume_mean_at_idx_zero_returns_zero
failed   src/engine/tests/test_a_plus_gate_parity.py::TestFactorMathParity::test_rolling_volume_mean_uses_prior_bars_only
failed   src/engine/tests/test_a_plus_gate_parity.py::TestFactorMathParity::test_volume_confirmation_threshold_is_1_2x_rolling_mean
failed   src/engine/tests/test_accuracy_fixes.py::TestH4DoubleCommissionFix::test_no_double_deduction_same_rate
failed   src/engine/tests/test_accuracy_fixes.py::TestL1BarsPerDay::test_1min_bars_is_globex
failed   src/engine/tests/test_apply_trade_management_branching.py::TestBEOnTP1::test_trail_stop_moves_to_be_on_tp1_hit
failed   src/engine/tests/test_e2e_backtest.py::TestE2EBacktest::test_walk_forward_mode
failed   src/engine/tests/test_parameter_jitter_battery.py::TestComputeRws::test_equity_curve_fallback
failed   src/engine/tests/test_parameter_jitter_battery.py::TestComputeRws::test_stable_monthly_returns_low_rws
failed   src/engine/tests/test_parameter_jitter_battery.py::TestRunB15Battery::test_rws_failure_blocks
failed   src/engine/tests/test_pnl_accuracy.py::TestCommissionImpact::test_commission_per_trade_matches_formula
failed   src/engine/tests/test_pnl_accuracy.py::TestWave1CommissionGoldenFixture::test_mffu_mes_commission_per_trade_contract
failed   src/engine/tests/test_pnl_accuracy.py::TestWave1CommissionGoldenFixture::test_prop_sim_trusts_net_pnl_no_double_deduction
failed   src/engine/tests/test_pnl_accuracy.py::TestWave1CommissionGoldenFixture::test_topstep_mes_commission_per_trade_contract
failed   src/engine/tests/test_production_hardening_g2a_g2b.py::TestG2bClassifierErrorSourceContract::test_exception_handler_does_not_use_indeterminate_as_fallback
failed   src/engine/tests/test_production_hardening_g2a_g2b.py::TestG2bClassifierErrorSourceContract::test_exception_handler_sets_confidence_to_none
xfailed  src/engine/tests/test_session_role_adversarial_fence.py::test_corpus_is_disjoint_from_every_tuning_source
xfailed  src/engine/tests/test_session_role_adversarial_fence.py::test_row[B02]
failed   src/engine/tests/test_three_fixes.py::TestWFIntraMaxDD::test_equity_bars_key_present_in_backtest_result
failed   src/engine/tests/test_wave_b_intrabar_stops.py::TestIntrabarsStopsAndTP::test_long_tp_fires_intrabar_even_if_close_falls_back
```

## 5. NOT CLAIMED

- **No disposition.** These 35 are listed, not classified. Disposition is the next step (GPT `§8`), with the fixed vocabulary and the rule that `UNEXPLAINED` may not enter the successor seal.
- **No seal minted, no census written, no canonical closeout run.**
- **This is ONE arm.** It establishes the map at this pin; it is not a re-certification of execution identity — that was `cb2c5bb0`, band 8, `PASS — BOUNDED`, and its bounds still stand (single-authority key set; boundary-sampled tree stability).
- **The 6 banked external-input sites were not correlated to this map yet** (GPT `§9`); none of them produced a refusal, a skip or an invalid child in this run — `skipped 0`, `invalid_children 0`.
