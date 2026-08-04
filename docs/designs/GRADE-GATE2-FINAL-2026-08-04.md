# GATE 2 — FINAL INDEPENDENT GRADE

**Grader:** `accuracy-validator`, fresh background instance, dispatched by the advisor desk
**Date:** 2026-08-04
**Pin graded:** `a3f75aa7efff54b3d555ea660dda51e7fa3ce50e` (2026-08-04T11:28:24-04:00)
**Lane commits spanned:** Lane 28 `556122b7` · Lane 29 `d9684c64` · Lane 30 `b8321dc9` · Lane 32 `a3f75aa7`

## VERDICT

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| Gate 2 parameter-refusal + census + canonical population | **7** | **VERIFIED** | 19 real mutations run in an isolated checkout; 19/19 caught by a permanent test. 4 gate categories attacked directly and all 4 clear. Population re-derived by 3 non-overlapping instruments incl. runtime `sys.modules`. | F-1 (population blind to bare relative imports, 2 members missing, uncatchable) · F-2 (module-tail join semantically ambiguous, latent) |

**OVERALL VERDICT: `PASS_WITH_BOUNDED_FINDINGS`** — **VERIFIED band 7**.

**GATE-2 CLOSING RULE — DOES MY VERDICT HIT ANY OF THE FOUR?**
**NO. All four gate-disqualifying categories are CLEAR, each attacked directly and each caught by a permanent test:**

| Disqualifying category | Attack | Result |
|---|---|---|
| silent substitution | A17 collapse `_h_wait_bias` cache key so different periods share one slot | **RED — 9 tests** |
| partial recognition | A5 honour fast/default slow · A6 honour slow/default fast | **RED — 9 / 12 tests** |
| unused accepted parameters | A1 restore `_h_structure` accept-and-discard | **RED — 9 tests** |
| flag-OFF parameter loss | A3 move acknowledgement below the short-frame return | **RED — 26 tests** |

**On the vacuity clause** ("a finding that lets the canonical population OR a parameter guard pass VACUOUSLY must be repaired before Gate 2 closes"): my measured answer is that **F-1 is NOT vacuity**. The population guard demonstrably discriminates — it went red on 8 independent perturbations (drop, add, reorder, recursion deletion, empty derivation, empty manifest, cwd change, tail-collision). F-1 is **under-inclusion of a correct-but-incomplete rule**, bounded and measured at **2 of 97** members. I record it as `UNCOVERED_HOLE` and recommend repair, but on the pre-registered wording it does not block. **The desk owns that ruling; I am not softening it — I am naming which clause it does and does not meet.**

---

## 1. PIN AND ARTIFACT INTEGRITY `[MEASURED HERE]`

Both dispatch hashes reproduce exactly:

| Artifact | Dispatch claim | Measured at pin | Measured in isolated checkout |
|---|---|---|---|
| `src/engine/spec_condition_compiler.py` | `621302a56987f19b` | `621302a56987f19b` | `621302a56987f19b` |
| `src/engine/tests/canonical_regression_population.txt` | `26975e6838c938e9` | `26975e6838c938e9` | `26975e6838c938e9` |

- Tree `C:/Users/tonio/Projects/wt-h1-wave4-20260712`, branch `h1-wave4-sealed12-driver`. `rev-parse --git-common-dir` → `C:/Users/tonio/Projects/trading-forge/trading-forge/.git`, confirming a **linked worktree**, not a standalone repo (law 10).
- **HEAD was `1e8611bb`, NOT the pin, and it MOVED AGAIN mid-grade to `23bdbc9d`.** Re-measured at the end rather than recalled: `git diff --stat a3f75aa7 23bdbc9d -- src/` is **EMPTY**, and the two intervening commits touch only `docs/designs/*`. **All 8 graded blobs are byte-identical at pin and at the moved HEAD:**

| sha256 (first 12) | file |
|---|---|
| `621302a56987` | `spec_condition_compiler.py` |
| `26975e6838c9` | `canonical_regression_population.txt` |
| `e9577f7b74b8` | `test_flag_off_parameterized_refusal.py` |
| `30d7dda169bc` | `test_bias_refusal_surface.py` |
| `e8e38291595c` | `test_parameter_collision.py` |
| `5c53ff757314` | `test_short_frame_parameter_acknowledgement.py` |
| `64ac16f86695` | `test_bias_parameter_transmission.py` |
| `40c518576f22` | `test_parameter_acceptance_guard.py` |

  So this verdict describes live source, not only a frozen hash. I read pinned blobs throughout, never the working tree.
- Manifest member count: `grep -c '^[^#].*\.py$'` → **95** (110 lines total). The dispatch's warned trap reproduces: `grep -c '\.py'` → **96**. `[MEASURED HERE]`

---

## 2. MUTATION BATTERY — 19 REAL MUTATIONS, 19 CAUGHT

All mutations applied in an **isolated checkout**, never the shared tree (§Coverage). Every mutation restored and sha256-verified after each run. Baseline lane surface = **112 passed** (7 files).

| # | Mutation | Verdict | Reddened |
|---|---|---|---|
| A1 | restore `_h_structure` accept-and-discard (`REFUSES_ALL` → `CONSUMES_SUPPORTED`) | **RED** | 9 |
| A2 | parameters used ONLY in cache key (`_eval_wait_bias` gets engine defaults) | **RED** | 12 |
| A3 | acknowledgement moved BELOW the short-frame return | **RED** | 26 |
| A4 | refusal truly MOVED below `candle_confirmation_check` | **RED** | 9 |
| A5 | honour `fast_period`, silently default `slow_period` | **RED** | 9 |
| A6 | honour `slow_period`, silently default `fast_period` (mirror) | **RED** | 12 |
| A7 | unknown alias treated as an ABSENT parameter | **RED** | 7 |
| A8 | census scan root made cwd-relative | **RED** | 2 |
| A9 | census made to scan zero files | **RED** | 8 |
| A10 | DELETE the recursive branch from population derivation | **RED** | 2 |
| A11 | DROP one canonical member | **RED** | 1 |
| A12 | ADD one unexpected member | **RED** | 1 |
| A13 | REORDER two members | **RED** | 1 |
| A14 | each of the 6 producer forms planted as a PRODUCTION writer | **RED ×6** | 1 each |
| A15 | LOAD-BEARING module-tail collision | **RED** | 1 |
| A16a | derivation returns an empty population | **RED** | 5 |
| A16b | committed manifest emptied | **RED** | 2 |
| A17 | collapse `_h_wait_bias` cache key (silent substitution) | **RED** | 9 |

### 2.1 TWO OF MY OWN MUTATIONS WERE BROKEN AND READ AS HOLES — DISCLOSED

`A GREEN FROM A MUTATION THAT DID NOT MUTATE IS NOT A HOLE.` I hit this **twice** and both times the first reading was a false hole:

- **A4 (first attempt) reported GREEN.** I had *appended* a second `_acknowledge_parameters(n, enforced)` call after `candle_confirmation_check` **without removing the original at the top of `compute()`**. The refusal still fired first, so the mutation was a no-op. Redone as a true move (delete at top + insert after confirmation): **RED, 9 tests**, including `test_ff_refusal_precedes_the_confirmation_evaluator_on_the_flag_off_path` and `test_refusal_precedes_confirmation_evaluator_and_cache_on_a_full_frame`.
- **A15 (first attempt) reported GREEN.** My insert anchored on the file's first `\n`, which lands **inside the module docstring** of `src/engine/invariant_harness/core.py` — it became prose, not an import. Redone as an end-of-file append and **AST-verified as a real `ImportFrom` node before measuring**: **RED**.

Had I reported either as `UNCOVERED_HOLE` the grade would have carried two fabricated findings. Every remaining green in this report is accompanied by a positive control proving the mutation was live.

### 2.2 A18 — A GREEN THAT IS GENUINELY VACUOUS, PROVEN BY MEASUREMENT

Collapsing `_h_structure`'s `cache_key = b.parameters` to a constant produced **89 passed, 0 red**. This is **not** an uncovered hole: `_h_structure` is classified `REFUSES_ALL_PARAMETERS`, so `_acknowledge_parameters` refuses any parameterized binding routed to it *before dispatch*, and the handler can only ever be reached with `parameters=None`.

`[MEASURED HERE, runtime instrumentation]` I wrapped `_h_structure` across the lane surface and dumped every key it observed:

```
@@@ DISTINCT _h_structure cache keys observed: ['None']
```

One distinct key, `None`. The mutation cannot change behaviour, so no test can be expected to catch it. This **corroborates the prior grade's F-4 LOW**: the original accept-and-discard *shape* survives at `spec_condition_compiler.py:639` and is defanged only from upstream (see F-4 below).

---

## 3. FINDINGS

### Discrepancy F-1: the canonical population is blind to bare relative imports — 2 genuine members are missing and nothing can detect it
**Severity: MEDIUM — `UNCOVERED_HOLE`**
**Claim:** `_regression_population` docstring, `test_flag_off_parameterized_refusal.py:488-489` — *"Test files that transitively import any target module."* Manifest header: *"CANONICAL REGRESSION POPULATION - COMPUTED, NEVER HAND-EDITED."*
**Reality:** The derivation records `ImportFrom` dependencies only when `node.module` is truthy (`:506`). A **bare relative import** — `from . import X` — has `node.module is None` and is **silently skipped**. Two test files that genuinely reach `spec_family_bindings` at runtime are therefore absent from the canonical 95.

**Sources compared:**
- **Source A — the shipped instrument** (`_regression_population`, tail-name join): **95** members.
- **Source B — an independent static closure** I wrote, resolving relative imports via `node.level` against the module's package and joining on **real file paths, never tail names**: **97** members, a strict superset. Delta = `engine/tests/test_extractor_bridge.py`, `engine/tests/test_wave6_pass2_orchestration.py`; `only_in_manifest = 0`.
- **Source C — runtime `sys.modules`**, the non-static path: importing each disputed module and asking which targets actually loaded.

```
src.engine.tests.test_extractor_bridge           -> targets loaded: ['spec_family_bindings']
src.engine.tests.test_wave6_pass2_orchestration  -> targets loaded: ['spec_family_bindings']
src.engine.extraction.extractor_bridge           -> targets loaded: ['spec_family_bindings']
src.engine.extraction.pilot_conveyor             -> targets loaded: ['spec_family_bindings']
```

**Source of truth:** Sources B and C agree against A. The chain is `test_extractor_bridge → src/engine/extraction/extractor_bridge.py:68 (from . import pilot_conveyor) → pilot_conveyor → spec_family_bindings`. Hop 1 is invisible to the derivation.
**Enumerated surface — all 8 bare relative imports in `src/`, every one in `src/engine/extraction/`:**
```
anchor_locator.py:64      from . import compile_lints
cert_assembler.py:64      from . import compile_lints
extractor_bridge.py:68    from . import pilot_conveyor
pilot_conveyor.py:256     from . import anchor_locator
pilot_conveyor.py:257     from . import compile_lints
sealed_read_driver.py:2263/2598/2676  from . import pilot_conveyor
```
**Fix point:** `src/engine/tests/test_flag_off_parameterized_refusal.py:506` — `elif isinstance(node, ast.ImportFrom) and node.module:` must also handle `node.module is None` (and ideally resolve `node.level` properly rather than tail-joining).
**Why no permanent test can catch this:** the manifest is generated by the same blind rule, so it agrees with the derivation by construction. `test_the_population_derivation_follows_a_two_hop_chain` plants an **absolute** import (`from src.engine.intermediate_hop import X`) — the one shape that *is* visible. **No fixture in the repo exercises `from . import X`.**
**Blast radius:** 2 of 97 (2.1%) test files that genuinely exercise `spec_family_bindings` are outside the canonical scoped-regression surface. A change to `spec_family_bindings` that breaks `test_extractor_bridge` or `test_wave6_pass2_orchestration` would not be run by the canonical population.
**Repro:** apply the corrected closure instrument and diff against the manifest; or import either module and inspect `sys.modules`.

### Discrepancy F-2: the module-tail join is semantically ambiguous — currently harmless, one import from a 64-member swing
**Severity: MEDIUM (latent)**
**Claim:** Derivation resolves a dependency to a module by matching the **last path segment** (`:520-521`, `if tail == parts[-1]`).
**Reality:** Two unrelated modules sharing a basename are **one node** to the walk. `[MEASURED HERE]` the tree contains 4 colliding modules — `engine.indicators.core`, `engine.invariant_harness.core`, `engine.indicators.liquidity`, `engine.liquidity` — and **all four currently reach no target**, so the collision is harmless *today*. That is a property of the data, not of the rule.
**Positive-control witness / measured swing:** I appended a real (AST-verified) target import to `src/engine/invariant_harness/core.py`. **The population moved 95 → 159, +64 spurious members** — every test importing the entirely unrelated `src.engine.indicators.core` (`test_anchored_vwap`, `test_backtester`, `test_firm_config`, `test_fibonacci`, …) was dragged in.
**Verdict on the dispatch's conditional:** the manifest guard **turned RED** (`test_the_canonical_population_matches_its_committed_manifest_by_member`). **This is NOT `UNCOVERED_HOLE — AMBIGUOUS MODULE-TAIL JOIN`.** The pin catches *any* population move.
**Residual risk, and it is real:** the guard catches the *move*, not the *wrongness*. A maintainer who sees this red and regenerates the manifest "deliberately", as the file's own header instructs, would embalm **64 semantically spurious members**. The pin protects against drift, not against a wrong rule.
**Fix point:** same as F-1 — `:520-521`; resolve imports to real module paths rather than tail names.

### Discrepancy F-3: scope item 20 has no implementation to guard
**Severity: LOW**
**Claim:** Scope item 20 — *"An empty resolved test-path list cannot launch pytest silently."*
**Reality:** `[MEASURED HERE, positive-controlled search]` **no component in this repository resolves a test-path list and launches pytest.** The only pytest launchers are four `pytest.main([__file__, "-v"])` self-runners (`test_d7_class_partial_fill_parity.py:590`, `test_deepscan14_anti_setup_cli.py:137`, `test_deepscan14_anti_setup_db_wiring.py:271`, `test_wave29_pass_c1_trading_env.py:935`). None takes a computed list.
**Positive control for this absence claim:** I planted `src/engine/_probe_launcher.py` containing `subprocess.run(["pytest", *paths])`; my search **found it** (`./src/engine/_probe_launcher.py:3`) and I then removed it. The method can report a launcher; there is none to report.
**What IS guarded:** the two source-side non-empty assertions both go red — A16a (derivation returns `[]`) → **5 red**; A16b (manifest emptied) → **2 red**. So an empty list cannot be *produced*. Whether it could be *consumed* silently is moot, and is recorded as **not applicable rather than passing**.

### Discrepancy F-4: `_h_structure`'s parameter-keyed cache survives, defanged only from upstream
**Severity: LOW**
**Claim:** Handler contract table — `_h_structure: REFUSES_ALL_PARAMETERS`.
**Reality:** `spec_condition_compiler.py:639` still reads `cache_key = b.parameters` and then calls `_eval_wait_structure(ctx["n"], ctx["df"])`, an evaluator that cannot honour a period. The original accept-and-discard *shape* is intact; only the upstream refusal in `_acknowledge_parameters` makes it unreachable. Measured: the only key ever observed is `None` (§2.2), and A18 confirms collapsing it changes nothing today. **Independently re-derived here; corroborates the prior grade's F-4 LOW.**
**Blast radius:** zero today. Non-zero the moment `_h_structure` is reclassified — which A1 proves is loudly caught (9 red).

---

## 4. THE PRIOR GRADE'S FINDINGS, RE-DERIVED NOT INHERITED

I was directed to re-derive rather than inherit `GRADE-LANES-28-30-2026-08-04.md` (band 7, whose author disclosed it minted `F-A/F-B/F-E/M3/M5` itself).

| Prior finding | My independent result |
|---|---|
| **F-1 HIGH** — population's transitive property has no path to red; deleting the recursion drops 95 → 23 with 0 new red | **NO LONGER REPRODUCIBLE — repaired at Lane 32.** A10 (delete the recursive branch) now goes **RED on 2 tests**, incl. the new `test_the_population_derivation_follows_a_two_hop_chain`. `[MEASURED HERE]` |
| **F-2 MEDIUM** — no committed member manifest; order unpinned | **CLOSED.** Manifest committed (95 members) and order pinned; A11/A12/A13 each go RED. |
| **F-3 MEDIUM** — census catches 6/6 enumerated shapes but unenumerated shapes evade | **6/6 CONFIRMED independently** (A14, each form planted as a *production* writer, each RED). The evasion residue is unchanged and out of my measured scope — see "What I did NOT verify". |
| **F-4 LOW** — original accept-and-discard shape survives at `:639` | **CONFIRMED** — see F-4 above, re-derived with a runtime witness the prior grade did not use. |
| **F-5 LOW** — `MINUS test_cloud_backend.py` inoperative | **CONFIRMED.** `test_cloud_backend` is a test file, reaches **no** target, and is correctly absent from the 95. The dispatch's declaration is TRUE. |

---

## 5. THE 31 INHERITED FAILURES — RECORDED, AND THEIR PROVENANCE MEASURED

`[MEASURED HERE]` The canonical 95-file population at the pin: **31 failed, 2194 passed, 13 skipped, 2 xfailed, 0 errors, 105s.** The count `31` matches the declared figure. **Per the dispatch I do NOT join these to any earlier population merely because an integer matches.** Full node IDs, from the pinned commit:

```
test_a_plus_gate_parity.py::TestAPlus_Gate_Wiring::test_empty_factors_list_bypasses_gate
test_a_plus_gate_parity.py::TestAPlus_Gate_Wiring::test_gate_stats_totals_are_consistent
test_a_plus_gate_parity.py::TestAPlus_Gate_Wiring::test_legacy_provenance_bypasses_gate
test_a_plus_gate_parity.py::TestAPlus_Gate_Wiring::test_macro_alignment_always_passes
test_a_plus_gate_parity.py::TestAPlus_Gate_Wiring::test_min_factors_gate_blocks_when_insufficient
test_a_plus_gate_parity.py::TestAPlus_Gate_Wiring::test_min_factors_gate_passes_when_sufficient
test_a_plus_gate_parity.py::TestAPlus_Gate_Wiring::test_no_entry_quality_bypasses_gate
test_a_plus_gate_parity.py::TestAPlus_Gate_Wiring::test_short_entries_also_evaluated
test_a_plus_gate_parity.py::TestAPlus_Gate_Wiring::test_structural_setup_always_satisfies
test_a_plus_gate_parity.py::TestAPlus_Gate_Wiring::test_volume_confirmation_blocks_low_volume
test_a_plus_gate_parity.py::TestAPlus_Gate_Wiring::test_volume_confirmation_passes_high_volume
test_a_plus_gate_parity.py::TestAPlus_Gate_Wiring::test_vp_shape_fail_open_when_no_timestamp
test_a_plus_gate_parity.py::TestBackwardCompat::test_StrategyConfig_accepts_entry_quality_dict
test_a_plus_gate_parity.py::TestBackwardCompat::test_StrategyConfig_entry_quality_defaults_to_none
test_a_plus_gate_parity.py::TestBackwardCompat::test_no_entry_quality_does_not_block_any_entry
test_a_plus_gate_parity.py::TestFactorMathParity::test_rolling_volume_mean_at_idx_zero_returns_zero
test_a_plus_gate_parity.py::TestFactorMathParity::test_rolling_volume_mean_uses_prior_bars_only
test_a_plus_gate_parity.py::TestFactorMathParity::test_volume_confirmation_threshold_is_1_2x_rolling_mean
test_accuracy_fixes.py::TestH4DoubleCommissionFix::test_no_double_deduction_same_rate
test_accuracy_fixes.py::TestL1BarsPerDay::test_1min_bars_is_globex
test_apply_trade_management_branching.py::TestBEOnTP1::test_trail_stop_moves_to_be_on_tp1_hit
test_backtester.py::TestBacktesterOutput::test_zero_trade_backtest_does_not_crash
test_compile_lints.py::test_no_lint_imports_vectorbt_or_backtester
test_e2e_backtest.py::TestE2EBacktest::test_walk_forward_mode
test_parameter_jitter_battery.py::TestComputeRws::test_equity_curve_fallback
test_parameter_jitter_battery.py::TestComputeRws::test_stable_monthly_returns_low_rws
test_parameter_jitter_battery.py::TestRunB15Battery::test_rws_failure_blocks
test_pnl_accuracy.py::TestEdgeCases::test_no_trades_returns_zero_metrics
test_production_hardening_g2a_g2b.py::TestG2bClassifierErrorSourceContract::test_exception_handler_does_not_use_indeterminate_as_fallback
test_production_hardening_g2a_g2b.py::TestG2bClassifierErrorSourceContract::test_exception_handler_sets_confidence_to_none
test_wave_b_intrabar_stops.py::TestIntrabarsStopsAndTP::test_long_tp_fires_intrabar_even_if_close_falls_back
```
(all under `src/engine/tests/`)

**Provenance, measured — not assumed `[MEASURED HERE]`:** I extracted the **pre-lane** commit `9484c161` (= `556122b7~1`, compiler sha `977438afc2af7e08` ≠ the pin's `621302a5…`) into a second isolated checkout and ran **the same 95-member population** (94 of 95 files exist pre-lane; the sole absentee is `test_short_frame_parameter_acknowledgement.py`, added by Lane 29 `d9684c64` itself). Pre-lane: **35 failed, 2155 passed, 13 skipped, 2 xfailed**. **Joined by FULL NODE ID:**

| Direction | Count | Members |
|---|---|---|
| only at pin — **introduced by lanes 28-32** | **0** | `comm -13` returned empty |
| identical in both — **inherited** | **31 / 31** | the list above |
| only pre-lane — **repaired by the lanes** | **4** | all four in `test_parameter_collision.py` |

**Conclusion: none of the 31 was introduced by lanes 28-32.** `[MEASURED HERE, same population, joined by full node ID]`

The 4 repaired tests are a **positive witness that the lane surface genuinely moved**, and they are precisely the regression witnesses for mandatory scope items 5-7:
```
test_parameter_collision.py::test_two_same_family_conditions_with_different_periods_must_evaluate_differently   (item 5)
test_parameter_collision.py::test_identical_periods_still_share_one_computation                                 (item 6)
test_parameter_collision.py::test_reversing_condition_order_changes_the_shared_value                            (item 7)
test_parameter_collision.py::test_both_conditions_are_actually_dispatched
```

**A superseded intermediate result, disclosed:** an earlier 10-file run showed 3 `test_pnl_accuracy.py::TestCommissionImpact` failures as "only pre-lane". Under the **same** 95-file population those 3 pass in **both** arms. They were population-interaction artifacts of my own narrower run, not lane repairs. I flagged that risk before measuring it and the fuller run resolved it — the 10-file figure is withdrawn.

---

## 6. MANDATORY COVERAGE SECTION

### 6.1 Every data path used
1. **Pinned git blobs** — `git show a3f75aa7:<path>`, `git cat-file -t`, `git diff --stat a3f75aa7 1e8611bb -- src/`.
2. **Isolated checkout** — `git archive a3f75aa7 | tar -x`, sha256-verified against the pin on both key blobs.
3. **pytest execution** — baselines and 19 mutation runs.
4. **Static instrument A** — the shipped `_regression_population`, re-executed standalone outside pytest, in a separate process, from a different cwd.
5. **Static instrument B** — my own closure resolving `node.level` relative imports and joining on **real file paths**, deliberately *not* reproducing the tail-name join.
6. **Runtime instrument C** — real `importlib.import_module` + `sys.modules` inspection (non-static; shares no code with A or B).
7. **Runtime monkeypatch probe** — wrapping `_h_structure` to record observed cache keys.
8. **AST census** — independent enumeration of every bare relative import and every `core`/`liquidity`-tail importer.
9. **Second isolated checkout at pre-lane `9484c161`** for the provenance A/B.

### 6.2 Two-plus non-overlapping paths, per claim
| Claim | Path 1 | Path 2 | Path 3 |
|---|---|---|---|
| Population = 95 and matches the manifest | shipped derivation via pytest | same derivation re-executed standalone, different process + cwd | — *(these two share an algorithm; see limitation below)* |
| **2 members are missing** (F-1) | independent path-based closure (B) → 97 | runtime `sys.modules` (C) → both load `spec_family_bindings` | AST enumeration of all 8 bare relative imports |
| All 4 gate categories clear | mutation → red on a permanent test | the reddened tests named individually per mutation | baseline green before each mutation |
| `_h_structure` only ever sees `None` | runtime monkeypatch probe | A18 no-op result + A1's 9 reds proving the upstream refusal is live | source read at `:163`, `:639` |
| 31 failures are inherited | 95-file run at the pin | 10-file run at pre-lane `9484c161`, joined by full node ID | compiler sha differs across the two trees (`621302a5` vs `977438af`) |

**Stated limitation (law 1):** for the *agreement* between derivation and manifest, my re-execution **reproduces the shipped algorithm** and is therefore the same path wearing a second hat. The genuinely independent check on the population is instrument B + runtime C — **and it disagreed**, which is F-1.

### 6.3 Positive-control witnesses for every absence claim
| Absence claim | Positive control | Outcome |
|---|---|---|
| "No pytest launcher takes a resolved path list" | planted `src/engine/_probe_launcher.py` with `subprocess.run(["pytest", *paths])` | **search found the plant**, then removed it — method proven live |
| "A15 tail collision changes nothing" | **REFUTED my own first attempt** — re-planted at EOF and AST-verified the import node exists before measuring | population moved 95 → 159 |
| "A4 refusal ordering is unguarded" | **REFUTED my own first attempt** — original mutation left the top-of-`compute()` call in place | true move → 9 red |
| "`_h_structure` never sees a parameter" | runtime probe that records *every* key, not only non-`None` ones | one key: `None` |
| "No new failures caused by the lanes" | pre-lane tree with a *different* compiler sha; 3 failures present pre-lane but absent at pin prove the comparison can report a difference | 0 only-at-pin |
| "Mutations were live, not silently unapplied" | every mutation asserted its anchor matched **exactly once** or was skipped and reported | 0 silent skips |

### 6.4 Join keys for claimed correspondences
- **pin ↔ isolated checkout:** sha256 of both key blobs (`621302a56987f19b`, `26975e6838c938e9`).
- **pin ↔ live HEAD:** `git diff --stat a3f75aa7 1e8611bb -- src/` empty.
- **pin failures ↔ pre-lane failures:** **full pytest node ID** (`file::Class::test`), not test name, not count.
- **derivation ↔ manifest:** ordered list of repo-relative POSIX paths (order is load-bearing; A13 confirms).
- **derived population ↔ independent closure:** repo-relative POSIX path.
- **mutation ↔ restoration:** sha256 (first 16) of every mutated file, asserted after every run.

### 6.5 Where each plant physically lived — ISOLATION
**Every one of the ~30 plants lived in an isolated checkout. The shared worktree received ZERO mutations.**
- Primary isolated checkout: `…\scratchpad\iso` (from `git archive a3f75aa7 | tar -x`).
- Second isolated checkout: `…\scratchpad\pre` (from `git archive 9484c161`).
- Files mutated (all in `iso`, all restored + sha256-verified): `spec_condition_compiler.py`, `test_flag_off_parameterized_refusal.py`, `canonical_regression_population.txt`, `invariant_harness/core.py`.
- Files **created then deleted** (all in `iso`): `planted_production_writer.py` ×6 forms, `_probe_launcher.py`, `probe_plugin.py`.
- Final restore check on every mutated file: **True**. Plants removed: **True**.
- **I never wrote to `C:/Users/tonio/Projects/wt-h1-wave4-20260712` except this receipt**, which the dispatch requires. I did **not** commit it. I never touched `test_synthetic_market_simulator.py`.
- Because no plant existed in the shared tree, the pre-commit stash hazard had nothing to corrupt.

### 6.6 WHAT I DID NOT VERIFY
1. **No TypeScript.** No `tsc`, no `vitest`, no `npm`. **This is NOT a pass on the TS contract.** TS↔Python parity remains `UNENUMERATED`.
2. **Whole-suite regression not run.** I ran the canonical 95 at both the pin (2194 passed) and pre-lane (2155 passed), plus the 7-file lane surface. The wider suite beyond the canonical population is `UNENUMERATED` by me.
3. **Why the pre-lane arm ran 94 files, not 95.** `test_short_frame_parameter_acknowledgement.py` did not exist pre-lane. The A/B is therefore not a perfectly symmetric population; the asymmetry is one file, it is a lane-29 addition, and it cannot manufacture a "0 introduced" result (a file absent from the pre-lane arm could only *hide* a pre-existing failure, never suppress a new one at the pin).
4. **`test_cloud_backend.py` not executed** — declared HUNG upstream, and I confirmed it is not a member of the 95. I did not attempt it and cannot speak to it.
5. **The 7 env-gated handlers** (`_h_fvg`, `_h_levelzone`, `_h_levelzone_resolver`, `_h_bias_native`, `_h_confirmation_native`, `_h_sweep_native`, `_h_mss_native`) — I verified only their *classification* fails closed by reading the table. Whether their evaluators *could* consume a parameter is `UNENUMERATED`; reaching them needs experiment flags I did not exercise.
6. **Census evasion beyond the 6 enumerated forms.** I confirmed 6/6 detected. I did **not** re-derive the prior grade's 8 unenumerated evasions (`**{...}`, `*args`, `setattr`, `object.__setattr__`, factory-forward, …). That residue is `RELAYED`, not measured here.
7. **`runtime-production` tree unmeasured** — per the dispatch's known-unmeasured list; I did not visit it.
8. **`TF_FAMILY_META_ENFORCED` live blast radius.** I confirmed the flag defaults OFF and that the census finds zero production parameter writers, but I did not measure any deployed process. "Live blast radius ZERO" is `CORROBORATED`, not `MEASURED HERE`.
9. **Producer and sealed spec untouched** — I did not test whether a spec JSON could produce a parameterized binding beyond re-confirming the census result.
10. **F-1's blast radius beyond the 2 files.** I measured the delta between my closure and the manifest as exactly 2. I did **not** verify that my instrument B is itself complete — it may have its own blind spots (e.g. dynamic `importlib` calls, `__getattr__` module hooks). The claim "exactly 2 missing" is bounded by instrument B's own coverage, which I did not independently audit.

### 6.7 LINEAGE DECLARATION
**I did not design, build, or previously grade any artifact in this pin.** I am a fresh instance with no prior involvement in Lanes 28/29/30/32. I read `GRADE-LANES-28-30-2026-08-04.md` for leads only and **re-derived every finding I report**, including the two where I now disagree with it (its F-1 is repaired and no longer reproducible; its F-3 6/6 result I confirm independently). My agent memory records prior audits by earlier instances of this agent type on adjacent lanes; **none of those artifacts is under grade here**, and every measurement in this receipt was taken in this session.
