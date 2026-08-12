# ACCEPT-5 POST-REPAIR FINAL AUTHORITY MAP RECEIPT (R3-4)

**Produced:** 2026-08-12 · **Pin:** `00332950c26a139fee9e278112c3651576bebacb` · **Tree:** `wt-h1-wave4-20260712`  
**Instrument:** `scripts/accept5_isolated_runner.py --out-dir` — ONE canonical promoted isolated ACCEPT-5 arm.  
No `--reverse`, no `--reverse-nodes`, no `--limit`, no `--no-layer2`. **Authorized by:** GPT rulings on `AR-1022` §6 and `AR-1023` §5.

## 1. THE MAP

```
children (governed files)     : 108
nodes collected               : 2420        (pre-repair: 2419)
  passed                      : 2386        (pre-repair: 2384)
  failed                      : 32          (pre-repair: 33)
  xfailed                     : 2           (pre-repair: 2)
  xpassed / skipped / error   : 0 / 0 / 0
NON-PASS TOTAL                : 34          (pre-repair: 35)
duplicate node IDs            : 0
collected-but-unexecuted      : 0
invalid / refused children    : 0
wall clock, serial            : 6.5 min   (pre-registered ceiling 10.0)
PATH A (plugin) / PATH B (pytest junitxml) : 2420 / 2420 nodes · 34 / 34 non-pass · join size NON-ZERO
```

## 2. EXACT PRE/POST MOVEMENT vs `0f478211`

```
LEFT THE NON-PASS SET (1):
  failed -> passed   src/engine/tests/test_parameter_jitter_battery.py::TestComputeRws::test_equity_curve_fallback
ENTERED THE NON-PASS SET (0):  none
OUTCOME CHANGED WHILE STILL NON-PASS (0):  none
AUTHORIZED POPULATION GROWTH (+1), exact node ID:
  passed   src/engine/tests/test_parameter_jitter_battery.py::TestComputeRws::test_equity_curve_fallback_window_boundary
```

## 3. THE FINAL 34-NODE NON-PASS SET — EXACT IDs

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

## 4. NOT CLAIMED

- **ONE arm.** Not a re-certification of execution identity; no reverse arms ran.
- No census, no successor seal, no canonical closeout in this artifact — this is the map receipt only.
- No independent grader dispatched (`AR-1023` ruling §5 requires none for this map).
