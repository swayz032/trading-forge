# AR-1084 (worker) — REGRESSION NUMBER, CLOSING THE GAP AR-1083 LEFT OPEN

**Pin:** `162e6fa1` (published) · **Baseline:** `b609f039` (published) · Governing: AR-1082

AR-1083 said the full-engine regression was still running and deliberately excluded it. This closes that, and corrects how I got the number.

---

## 1. THE FULL-ENGINE RUN DID NOT COMPLETE — IT HUNG

`python -m pytest src/engine/tests/ -q` sat at **9%** for roughly fifteen minutes with no further progress and was killed. I am reporting it as a HANG rather than as slowness, and I am **not** claiming a full-suite result. It also predated `162e6fa1`, so even had it finished it would have measured a stale tree.

`[UNENUMERATED]` which test hangs. I did not chase it — it is not on this unit's path and chasing it would be the side quest `0-CTRL.8` forbids. Flagging it because a suite nobody can run to completion is a standing hole in every future regression claim, including mine.

---

## 2. WHAT I MEASURED INSTEAD — THE POPULATION THAT CAN ACTUALLY DISAGREE WITH ME

Every test file referencing any symbol this unit touched (`spec_family_bindings` · `spec_condition_compiler` · `source_entry_events` · `structural_targets` · `_resolve_stop_risk_points` · `_apply_trade_management` · `run_class_backtest` · `compile_binding_plan` · `_eval_fvg` · `_h_opening_range`) — selected by grep, not by judgement:

```
POPULATION: 63 files
7 failed, 1640 passed, 2 xfailed  in 52.00s
```

## 3. ALL SEVEN ARE PRE-EXISTING — MEASURED, NOT ASSERTED

I did **not** eyeball them for plausibility. I created a detached worktree at the pre-change pin `b609f039` and ran the same six files there:

```
7 failed, 148 passed in 37.91s
```

**The failure set is IDENTICAL BY NAME on both sides:**

```
test_accuracy_fixes.py::TestH4DoubleCommissionFix::test_no_double_deduction_same_rate
test_accuracy_fixes.py::TestL1BarsPerDay::test_1min_bars_is_globex
test_apply_trade_management_branching.py::TestBEOnTP1::test_trail_stop_moves_to_be_on_tp1_hit
test_compile_lints.py::test_no_lint_imports_vectorbt_or_backtester
test_flag_off_parameterized_refusal.py::test_the_canonical_population_matches_its_committed_manifest_by_member
test_opening_range_grammar_firebreak.py::test_existing_parameter_acceptance_guards_stay_green
test_wave_b_intrabar_stops.py::TestIntrabarsStopsAndTP::test_long_tp_fires_intrabar_even_if_close_falls_back
```

**Why I ran the baseline at all rather than reasoning about it.** Three of those names are exactly the shape my change COULD have caused and I could not have ruled out by inspection: `test_the_canonical_population_matches_its_committed_manifest_by_member` is a population/denominator guard and I added two test FILES; `test_existing_parameter_acceptance_guards_stay_green` guards the handler-parameter classification I threaded a new argument through; `test_no_lint_imports_vectorbt_or_backtester` is an import-graph guard and my new test imports `_build_source_stop_map` from `backtester`. Each was a live hypothesis. All three are red at `b609f039` too.

★ `A FAILURE THAT LOOKS LIKE MINE IS EXACTLY THE ONE I MAY NOT REASON ABOUT.`

**Instrument note, since a worktree is a second tree:** the baseline ran in `/c/tf-base-b609` at `b609f039`, verified by `git rev-parse HEAD` inside it, and it was removed after. My first attempt at creating it failed with `Could not reset index file to revision 'HEAD'` — a leaked `GIT_INDEX_FILE` from the AR-publish plumbing — and I re-created it with `env -u GIT_INDEX_FILE` rather than trusting the half-made tree.

---

## 4. NET

**No regression is attributable to `001c1758` or `162e6fa1`.** Combined with AR-1083's 102 green at the production default and 563 green across the binding-plan suites, that is what I hold.

Your §5 status is unchanged from AR-1083: steps 1–3 DONE, steps 4–6 NOT DONE, step 7 not dispatched. **Pin `162e6fa1`.**
