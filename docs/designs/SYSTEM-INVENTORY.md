<!-- GENERATED FILE - DO NOT HAND-EDIT -->
# SYSTEM INVENTORY

> **GENERATED FILE - DO NOT HAND-EDIT.**
> Regenerate with `python scripts/system_inventory.py`
> Generated at commit `16e0e99d603f87adc099836f67fdceaff6964866`  (worktree DIRTY at generation time)
> Generator: `scripts/system_inventory.py`.  Staleness check: `python scripts/system_inventory.py --check` (exit 1 if stale).
>
> Anyone who hand-edits this file has reintroduced the exact defect it exists to prevent.
> This repo already carries four hand-maintained declaration layers; all four went stale and
> actively misled agents. **Change the generator, not the output.**

**What this file answers:** *is X already built, and is it wired?*  Read it BEFORE building
anything.  This campaign has convicted the same defect seven times - an agent spending hours
building or planning something that was already in the tree.

**Grade of every number below: MEASURED HERE**, by `scripts/system_inventory.py`, over the
surface published in section 1, at the commit named above.  Nothing here is relayed,
remembered, or hand-copied.  Where a number is not measured, it is labelled
`UNENUMERATED` or `NOT MEASURED` rather than estimated.

---

## 1. The swept surface

A census is bounded by its surface as much as by its pattern, so the surface is published
first and its cost is made visible.

### 1.1 Symbol surface - definitions found here become inventory rows

| Root | Language | Files scanned | Files skipped as tests | LOC scanned | Symbols enumerated |
|---|---|---:|---:|---:|---:|
| `src/` | Python | 290 | 357 | 120239 | 1863 |
| `src/` | TypeScript | 461 | 717 | 209177 | 2917 |

Python symbol rule: every **module-level** `def`, `async def` and `class`.
TypeScript symbol rule: every line matching an **exported declaration** pattern
(`export [default] [declare] [abstract] [async] function|class|interface|type|enum|const|let|var NAME`).

### 1.2 Reference surface - a call from here can make a symbol `WIRED`

| Root | Files parsed | Non-test files |
|---|---:|---:|
| `src/` | 1825 | 751 |
| `scripts/` | 209 | 209 |
| `e2e/` | 0 | 0 |
| `tests/` | 35 | 0 |
| **TOTAL** | **2069** | **960** |

Directories never descended into, anywhere: `.git`, `.mypy_cache`, `.next`, `.numba_cache`, `.pytest_cache`, `.ruff_cache`, `.turbo`, `.venv`, `__pycache__`, `build`, `coverage`, `dist`, `lightning_logs`, `node_modules`, `venv`.

### 1.3 What the enumerator DELIBERATELY does not enumerate

Published so that under-inclusion is visible instead of silent.

| Not enumerated | Count | Why |
|---|---:|---|
| Python class methods | 419 | one row per method would swamp the map; a method is reached through its class |
| Python nested / inner functions | 83 | not part of any module's import surface |
| Non-exported TypeScript declarations | UNENUMERATED | module-private by construction |
| `src/` test files | 1074 | tests are the reference surface, never the symbol surface |

---

## 2. The instrument, and its audit

### 2.1 Classification rules - mechanical, no judgement about importance

| State | The rule actually implemented |
|---|---|
| `WIRED` | >=1 reference from a NON-test file, or a non-definition reference inside its own module, **and** the defining module is reachable through the import graph from a measured entry point (2.2). |
| `FLAG-GATED` | Would be `WIRED`, but the definition - or **every** non-test call site - sits lexically inside a block whose condition depends on an environment variable.  Flag name and default recorded. |
| `BUILT-UNREACHABLE` | No non-test reference at all, **or** the defining module is not reachable from any measured entry point. |
| `DECLARED-ABSENT` | Something imports it, or names its path as a string literal, and it does not exist on disk. |
| `UNCLASSIFIED` | **The mandatory residual.**  A file the parser could not read, an `export` line the declaration pattern did not match, or a file that yielded zero symbols.  Never omitted: a taxonomy with no residual forces the classifier to mis-file or stay silent, and both hide findings. |

Reference detection is **AST-based for Python**, so a symbol named only in a comment or a
docstring is correctly NOT counted as a caller (this is control C1 - the
`compute_opening_range_breakout` case that started this file).  For TypeScript, comments,
strings and template literals are blanked before tokenising, which gives the same guarantee
through a weaker parser.

### 2.2 Entry points - MEASURED, not assumed

Reachability is meaningless without a published entry-point set.  These were discovered by
reading `package.json` scripts, by scanning non-test TypeScript for `src/**.py` subprocess
path literals (the real TS->Python seam), and by finding `__main__` guards.

Total entry points: **94**.  Modules reachable from them: **618** of **2069** parsed files.

<details><summary>All 94 entry points and why each was counted</summary>

| Entry point | Discovered because |
|---|---|
| `scripts/check-archetype-lockstep.ts` | package.json script `check:archetype-lockstep` |
| `scripts/check-family-grade-postscript.ts` | package.json script `check:family-grade-postscript` |
| `scripts/check-gate-contract-keys.ts` | package.json script `check:gate-contract-keys` |
| `scripts/check-pglite-ddl-parity.ts` | package.json script `check:pglite-ddl-parity` |
| `scripts/check-spec-binding-plan-parity.ts` | package.json script `check:spec-binding-plan-parity` |
| `scripts/check-ts-python-event-product-scope-parity.ts` | package.json script `check:ts-python-event-scope-parity` |
| `scripts/check-ts-python-firm-rules-version.ts` | package.json script `check:ts-python-firm-rules-version` |
| `scripts/check-ts-python-pm-factor-parity.ts` | package.json script `check:ts-python-pm-factor-parity` |
| `scripts/check-ts-python-tier1-parity.ts` | package.json script `check:ts-python-tier1-parity` |
| `scripts/cli.ts` | package.json script `forge` |
| `scripts/deep-scan.ts` | package.json script `deep-scan` |
| `scripts/pre-vacation-preflight.ts` | package.json script `preflight:vacation` |
| `scripts/system-map.ts` | package.json script `system-map:check` (+1 more) |
| `scripts/wave26-ts-python-exit-parity.ts` | package.json script `check:ts-python-exit-parity` |
| `src/data/scripts/databento_definition_pull.py` | `python -m src.data.scripts.databento_definition_pull` module spec in src/server/services/contract-specs-service.ts |
| `src/data/scripts/databento_imbalance_pull.py` | `python -m src.data.scripts.databento_imbalance_pull` module spec in src/server/services/opening-auction-service.ts |
| `src/data/scripts/databento_statistics_pull.py` | `python -m src.data.scripts.databento_statistics_pull` module spec in src/server/services/settlement-reconciliation-service.ts |
| `src/discord/bot.ts` | package.json script `discord:dev` (+2 more) |
| `src/engine/a_plus_market_auditor.py` | `python -m src.engine.a_plus_market_auditor` module spec in src/server/services/a-plus-auditor-service.ts |
| `src/engine/anti_setups/anti_setup_backtest.py` | `python -m src.engine.anti_setups.anti_setup_backtest` module spec in src/server/routes/anti-setups.ts |
| `src/engine/anti_setups/filter_gate.py` | `python -m src.engine.anti_setups.filter_gate` module spec in src/server/routes/anti-setups.ts |
| `src/engine/anti_setups/miner.py` | `python -m src.engine.anti_setups.miner` module spec in src/server/routes/anti-setups.ts (+1 more) |
| `src/engine/archetype_evaluator.py` | `python -m src.engine.archetype_evaluator` module spec in src/server/routes/live-order.ts (+1 more) |
| `src/engine/archetypes/classifier.py` | `python -m src.engine.archetypes.classifier` module spec in src/server/routes/archetypes.ts |
| `src/engine/archetypes/predictor.py` | `python -m src.engine.archetypes.predictor` module spec in src/server/scheduler.ts |
| `src/engine/archetypes/strategy_mapper.py` | `python -m src.engine.archetypes.strategy_mapper` module spec in src/server/routes/archetypes.ts |
| `src/engine/backtester.py` | `python -m src.engine.backtester` module spec in scripts/cli.ts (+5 more) |
| `src/engine/black_swan_evaluator.py` | `python -m src.engine.black_swan_evaluator` module spec in src/server/services/synthetic-black-swan-service.ts |
| `src/engine/changepoint.py` | `python -m src.engine.changepoint` module spec in src/server/services/drift-detection-service.ts |
| `src/engine/cloud_backend.py` | `python -m src.engine.cloud_backend` module spec in src/server/services/cloud-qmc-service.ts |
| `src/engine/compiler/compiler.py` | `python -m src.engine.compiler.compiler` module spec in src/server/routes/compiler.ts (+2 more) |
| `src/engine/compiler/strategy_schema.py` | subprocess path literal in src/server/routes/strategies.ts |
| `src/engine/compliance/compliance_gate.py` | `python -m src.engine.compliance.compliance_gate` module spec in src/server/services/broker-router.ts (+2 more) |
| `src/engine/context/bias_engine.py` | subprocess path literal in scripts/wave25-pass2-smoke.ts |
| `src/engine/context/htf_narrative.py` | subprocess path literal in scripts/wave25-pass2-smoke.ts |
| `src/engine/context/playbook_router.py` | subprocess path literal in scripts/backfill-playbook-registration.ts (+2 more) |
| `src/engine/context_runner.py` | `python -m src.engine.context_runner` module spec in src/server/routes/context.ts (+1 more) |
| `src/engine/critic_optimizer.py` | `python -m src.engine.critic_optimizer` module spec in src/server/services/critic-optimizer-service.ts |
| `src/engine/decay/decay_gate.py` | `python -m src.engine.decay.decay_gate` module spec in src/server/scheduler.ts |
| `src/engine/decay/half_life.py` | `python -m src.engine.decay.half_life` module spec in src/server/routes/decay.ts (+1 more) |
| `src/engine/decay/quarantine.py` | `python -m src.engine.decay.quarantine` module spec in src/server/routes/decay.ts |
| `src/engine/decay/sub_signals.py` | `python -m src.engine.decay.sub_signals` module spec in src/server/routes/decay.ts |
| `src/engine/deepar_forecaster.py` | `python -m src.engine.deepar_forecaster` module spec in src/server/services/deepar-service.ts |
| `src/engine/economic_calendar.py` | subprocess path literal in scripts/check-ts-python-event-product-scope-parity.ts (+1 more) |
| `src/engine/exits/style_c_handler.py` | `python -m src.engine.exits.style_c_handler` module spec in src/server/services/paper-execution-service.ts |
| `src/engine/exits/style_d_handler.py` | `python -m src.engine.exits.style_d_handler` module spec in src/server/services/paper-execution-service.ts |
| `src/engine/firm_config.py` | subprocess path literal in scripts/check-ts-python-firm-rules-version.ts |
| `src/engine/frankenstein_test.py` | `python -m src.engine.frankenstein_test` module spec in src/server/services/frankenstein-service.ts |
| `src/engine/gate_block_analyzer.py` | subprocess path literal in src/server/lib/carter/carter-recommend.ts |
| `src/engine/governor/governor_backtest.py` | `python -m src.engine.governor.governor_backtest` module spec in src/server/routes/governor.ts |
| `src/engine/governor/governor_config.py` | `python -m src.engine.governor.governor_config` module spec in src/server/routes/governor.ts |
| `src/engine/governor/state_machine.py` | `python -m src.engine.governor.state_machine` module spec in src/server/routes/governor.ts |
| `src/engine/graveyard/cluster.py` | `python -m src.engine.graveyard.cluster` module spec in src/server/services/graveyard-intelligence-service.ts |
| `src/engine/graveyard/embedder.py` | `python -m src.engine.graveyard.embedder` module spec in src/server/routes/graveyard.ts |
| `src/engine/graveyard/failure_tagger.py` | `python -m src.engine.graveyard.failure_tagger` module spec in src/server/routes/graveyard.ts |
| `src/engine/graveyard/graveyard_gate.py` | `python -m src.engine.graveyard.graveyard_gate` module spec in src/server/routes/graveyard.ts |
| `src/engine/graveyard/similarity.py` | `python -m src.engine.graveyard.similarity` module spec in src/server/routes/graveyard.ts |
| `src/engine/indicators/paper_bridge.py` | `python -m src.engine.indicators.paper_bridge` module spec in src/server/services/paper-signal-service.ts |
| `src/engine/indicators/smt_divergence.py` | `python -m src.engine.indicators.smt_divergence` module spec in src/server/services/smt-live-service.ts |
| `src/engine/indicators/volume_profile.py` | `python -m src.engine.indicators.volume_profile` module spec in src/server/services/volume-profile-service.ts |
| `src/engine/mc_confidence.py` | subprocess path literal in scripts/check-gate-contract-keys.ts |
| `src/engine/monte_carlo.py` | `python -m src.engine.monte_carlo` module spec in src/server/services/monte-carlo-service.ts |
| `src/engine/nemo_scenario_designer.py` | `python -m src.engine.nemo_scenario_designer` module spec in src/server/services/nemo-scenario-service.ts |
| `src/engine/optimizer.py` | `python -m src.engine.optimizer` module spec in src/server/services/robustness-service.ts |
| `src/engine/paper_analytics.py` | `python -m src.engine.paper_analytics` module spec in src/server/routes/paper.ts (+1 more) |
| `src/engine/parameter_evolver.py` | `python -m src.engine.parameter_evolver` module spec in src/server/services/evolution-service.ts |
| `src/engine/pine_compiler.py` | `python -m src.engine.pine_compiler` module spec in src/server/services/pine-export-service.ts |
| `src/engine/pm_size_factor.py` | `python -m src.engine.pm_size_factor` module spec in scripts/check-ts-python-pm-factor-parity.ts |
| `src/engine/prop_compliance.py` | subprocess path literal in scripts/check-ts-python-firm-rules-version.ts |
| `src/engine/quantum_adversarial_stress.py` | `python -m src.engine.quantum_adversarial_stress` module spec in src/server/services/adversarial-stress-service.ts |
| `src/engine/quantum_annealing_optimizer.py` | `python -m src.engine.quantum_annealing_optimizer` module spec in src/server/routes/quantum-mc.ts (+1 more) |
| `src/engine/quantum_mc.py` | `python -m src.engine.quantum_mc` module spec in src/server/services/quantum-mc-service.ts |
| `src/engine/quantum_rl_agent.py` | `python -m src.engine.quantum_rl_agent` module spec in src/server/lib/quantum-rl-training-runner.ts (+2 more) |
| `src/engine/qubo_trade_timing.py` | `python -m src.engine.qubo_trade_timing` module spec in src/server/routes/quantum-mc.ts (+1 more) |
| `src/engine/regime.py` | `python -m src.engine.regime` module spec in src/server/services/regime-service.ts |
| `src/engine/replay/quantum_replay.py` | `python -m src.engine.replay.quantum_replay` module spec in src/server/lib/quantum-replay-runner.ts |
| `src/engine/roll_calendar.py` | `python -m src.engine.roll_calendar` module spec in src/server/services/paper-execution-service.ts |
| `src/engine/skip_engine/calendar_filter.py` | `python -m src.engine.skip_engine.calendar_filter` module spec in src/server/services/paper-execution-service.ts (+1 more) |
| `src/engine/skip_engine/historical_skip_stats.py` | `python -m src.engine.skip_engine.historical_skip_stats` module spec in src/server/routes/skip.ts |
| `src/engine/skip_engine/skip_classifier.py` | `python -m src.engine.skip_engine.skip_classifier` module spec in src/server/routes/skip.ts (+1 more) |
| `src/engine/statistics/backtest_inflation_factor.py` | subprocess path literal in scripts/check-gate-contract-keys.ts |
| `src/engine/survival/drawdown_simulator.py` | `python -m src.engine.survival.drawdown_simulator` module spec in src/server/routes/survival.ts |
| `src/engine/survival/firm_profiles.py` | `python -m src.engine.survival.firm_profiles` module spec in src/server/routes/survival.ts |
| `src/engine/survival/survival_comparator.py` | `python -m src.engine.survival.survival_comparator` module spec in src/server/routes/survival.ts |
| `src/engine/survival/survival_scorer.py` | `python -m src.engine.survival.survival_scorer` module spec in src/server/routes/survival.ts |
| `src/engine/synthetic/populate_regime_bank.py` | `python -m src.engine.synthetic.populate_regime_bank` module spec in src/server/services/synthetic-regime-bank-service.ts |
| `src/engine/tensor_signal_model.py` | `python -m src.engine.tensor_signal_model` module spec in src/server/routes/quantum-mc.ts (+2 more) |
| `src/engine/tests/test_cross_engine_parity.py` | package.json script `test:metrics` |
| `src/engine/tests/test_frankenstein.py` | package.json script `test:metrics` |
| `src/engine/tests/test_golden_fixtures.py` | package.json script `test:metrics` |
| `src/engine/tests/test_metric_snapshot.py` | package.json script `test:metrics:fast` (+2 more) |
| `src/engine/validation_runner.py` | `python -m src.engine.validation_runner` module spec in src/server/routes/validation.ts |
| `src/engine/walk_forward.py` | subprocess path literal in scripts/check-gate-contract-keys.ts |
| `src/server/index.ts` | package.json script `dev` (+1 more) |

</details>

### 2.3 Positive controls - the instrument audited before its output is believed

A counter that cannot return non-zero is not evidence of absence, and a uniform result is
almost always a broken probe.  These are known answers.  **A FAIL here invalidates every
table below it.**

| # | Control | Result | Detail |
|---|---|---|---|
| C1 | comment-only mention is not a caller (+ positive witness) | PASS | src/engine/config.py excluded=True; real same-module calls detected=1 (witness that the walker ran) |
| C2 | WIRED is reachable by the classifier | PASS | WIRED=3245 |
| C3 | BUILT-UNREACHABLE is reachable by the classifier | PASS | BUILT-UNREACHABLE=1529 |
| C4 | result is not uniform (broken-probe tell) | PASS | largest bucket = 67.3% of 4823 rows |
| C5 | server entry point discovered | PASS | entry points discovered=94 |
| C6 | a registered route module is reachable | PASS | modules reachable=618 |
| C7 | env-flag extractor fires in both languages | PASS | py files with env reads=128, ts=346 |
| C8 | TS comment blanker removes commented-out code | PASS | ok |
| C9 | blanking preserves offsets exactly | PASS | 97 chars in, 97 out |
| C10 | python env-gate detector fires | PASS | gates=[('TF_PROBE_FLAG', 4, 5)] |
| C11 | TS env-gate detector fires | PASS | gates=[('TF_PROBE_FLAG', 1, 3)] |
| C12 | symbols enumerated in both languages | PASS | py=1863 ts=2917 |
| C13 | DECLARED-ABSENT probe is live | PASS | DECLARED-ABSENT=36 (probe runs; 0 would be a legitimate reading) |
| C14 | TS import specifiers are real text, not blanked whitespace | PASS | 6590/6590 TS import specifiers non-blank |
| C15 | no WIRED row lacks a non-test caller | PASS | violations=0 |
| C16 | TypeScript modules are reachable, not just Python | PASS | reachable TS modules=414 |
| C20 | aliased imports count as references | PASS | walk_forward.py in callers=True (state=WIRED, non-test caller files=1) |
| C19 | `python -m` module-spec entry points are discovered | PASS | pine_compiler is an entry point=True; total entry points=94 |
| C18 | `export { X as Y }` binding form is enumerated | PASS | alertRoutes enumerated=True |

**19 / 19 controls pass.**

### 2.4 Known limits of this instrument

* **Name collision biases toward `WIRED` - and the affected population is MEASURED, not
  merely warned about.**  References are matched by identifier name, not by resolved
  binding, so two symbols sharing a name each see the other's references.
  **217 of 4515 enumerated symbol names (4.8%) are defined in more than one file, covering
  482 of 4780 symbol rows (10.1%).**  Every symbol table below marks those rows `AMBIG`.
  An `AMBIG` row has an unreliable caller count in BOTH directions.  A row WITHOUT the
  mark does not have this problem at all, so the unmarked majority is trustworthy.
* **Dynamic dispatch is invisible.**  Registry lookups, `getattr`, string-keyed handler maps,
  and inbound n8n HTTP calls do not appear in a static import graph.  `BUILT-UNREACHABLE`
  therefore means *this instrument found no static path*, **not** *it is dead*.
* **TypeScript is pattern-matched, not compiled.**  Exported declarations written in unusual
  syntax land in `UNCLASSIFIED` rather than being silently dropped - see section 9.
* **Flag gating detects lexical `if` blocks only.**  A flag consumed as an early `return`, a
  decorator, a config-object lookup, or a database-backed toggle is not detected, so section 5
  is a LOWER BOUND on flag-gated surface.
* **Reachability is not execution.**  `WIRED` says a static path exists, not that the code ran.

---

## 3. Totals

| State | Count | Share |
|---|---:|---:|
| `WIRED` | 3245 | 67.3% |
| `FLAG-GATED` | 6 | 0.1% |
| `BUILT-UNREACHABLE` | 1529 | 31.7% |
| `DECLARED-ABSENT` | 36 | 0.7% |
| `UNCLASSIFIED` | 7 | 0.1% |
| **TOTAL** | **4823** | |

---

## 4. By subsystem

| Subsystem | WIRED | FLAG-GATED | BUILT-UNREACHABLE | DECLARED-ABSENT | UNCLASSIFIED | Total |
|---|---:|---:|---:|---:|---:|---:|
| `scripts/h1-frontier-designpool.ts` | 0 | 0 | 0 | 1 | 0 | 1 |
| `scripts/h1-grant-completion-ticket.ts` | 0 | 0 | 0 | 1 | 0 | 1 |
| `scripts/h1-grant-configpass-burst.ts` | 0 | 0 | 0 | 1 | 0 | 1 |
| `scripts/h1-grant-configpass-v2-burst.ts` | 0 | 0 | 0 | 1 | 0 | 1 |
| `scripts/h1-mini-phaseB-tryout.ts` | 0 | 0 | 0 | 1 | 0 | 1 |
| `scripts/h1-reconcile-and-grant-burst.ts` | 0 | 0 | 0 | 1 | 0 | 1 |
| `scripts/h1-seed-ledger.ts` | 0 | 0 | 0 | 1 | 0 | 1 |
| `src/dashboard/components` | 0 | 0 | 1 | 1 | 0 | 2 |
| `src/data/fetchers` | 2 | 0 | 1 | 1 | 1 | 5 |
| `src/data/loaders` | 9 | 0 | 3 | 0 | 1 | 13 |
| `src/data/macro` | 0 | 0 | 26 | 0 | 0 | 26 |
| `src/data/scripts` | 14 | 0 | 38 | 0 | 0 | 52 |
| `src/discord/bot.ts` | 7 | 0 | 0 | 0 | 0 | 7 |
| `src/discord/commands.ts` | 2 | 0 | 0 | 0 | 0 | 2 |
| `src/discord/utils.ts` | 5 | 0 | 0 | 0 | 0 | 5 |
| `src/engine/a_plus_market_auditor.py` | 10 | 0 | 0 | 0 | 0 | 10 |
| `src/engine/ablation_layers.py` | 1 | 0 | 1 | 0 | 0 | 2 |
| `src/engine/analytics.py` | 19 | 0 | 1 | 0 | 0 | 20 |
| `src/engine/anti_setups` | 25 | 0 | 6 | 0 | 0 | 31 |
| `src/engine/archetype_evaluator.py` | 5 | 0 | 0 | 0 | 0 | 5 |
| `src/engine/archetypes` | 9 | 0 | 3 | 0 | 0 | 12 |
| `src/engine/backtester.py` | 51 | 0 | 1 | 0 | 0 | 52 |
| `src/engine/battery` | 0 | 0 | 17 | 0 | 0 | 17 |
| `src/engine/black_swan_evaluator.py` | 8 | 0 | 0 | 0 | 0 | 8 |
| `src/engine/breakout_confirmation_ambiguity.py` | 2 | 0 | 0 | 0 | 0 | 2 |
| `src/engine/cache_prewarm.py` | 0 | 0 | 1 | 0 | 0 | 1 |
| `src/engine/changepoint.py` | 4 | 0 | 0 | 0 | 0 | 4 |
| `src/engine/cloud_backend.py` | 14 | 0 | 0 | 0 | 0 | 14 |
| `src/engine/compiler` | 13 | 0 | 2 | 0 | 0 | 15 |
| `src/engine/compliance` | 13 | 0 | 1 | 0 | 0 | 14 |
| `src/engine/config.py` | 17 | 0 | 3 | 0 | 0 | 20 |
| `src/engine/context` | 98 | 2 | 10 | 0 | 0 | 110 |
| `src/engine/context_runner.py` | 4 | 0 | 0 | 0 | 0 | 4 |
| `src/engine/critic_optimizer.py` | 7 | 0 | 0 | 0 | 0 | 7 |
| `src/engine/cross_validation.py` | 8 | 0 | 1 | 0 | 0 | 9 |
| `src/engine/cuopt_helpers.py` | 1 | 0 | 0 | 0 | 0 | 1 |
| `src/engine/data_loader.py` | 25 | 0 | 4 | 0 | 0 | 29 |
| `src/engine/decay` | 19 | 0 | 1 | 0 | 0 | 20 |
| `src/engine/deepar_forecaster.py` | 8 | 0 | 0 | 0 | 0 | 8 |
| `src/engine/deepar_regime_classifier.py` | 0 | 0 | 9 | 0 | 0 | 9 |
| `src/engine/determinism.py` | 5 | 0 | 1 | 0 | 0 | 6 |
| `src/engine/economic_calendar.py` | 15 | 0 | 2 | 0 | 0 | 17 |
| `src/engine/entry_eligibility.py` | 2 | 0 | 0 | 0 | 0 | 2 |
| `src/engine/entry_windows.py` | 8 | 0 | 0 | 0 | 0 | 8 |
| `src/engine/evt_tail.py` | 2 | 0 | 1 | 0 | 0 | 3 |
| `src/engine/exits` | 20 | 0 | 2 | 0 | 0 | 22 |
| `src/engine/exportability.py` | 3 | 0 | 0 | 0 | 0 | 3 |
| `src/engine/extraction` | 0 | 0 | 267 | 0 | 0 | 267 |
| `src/engine/family_meta_enforcement.py` | 10 | 0 | 2 | 0 | 0 | 12 |
| `src/engine/fill_model.py` | 9 | 0 | 1 | 0 | 0 | 10 |
| `src/engine/firm_config.py` | 2 | 0 | 1 | 0 | 0 | 3 |
| `src/engine/firm_rules_version.py` | 2 | 0 | 1 | 0 | 0 | 3 |
| `src/engine/forensics` | 0 | 0 | 35 | 0 | 0 | 35 |
| `src/engine/frankenstein_test.py` | 11 | 0 | 0 | 0 | 0 | 11 |
| `src/engine/gap_risk.py` | 4 | 0 | 0 | 0 | 0 | 4 |
| `src/engine/gate_block_analyzer.py` | 19 | 0 | 0 | 0 | 0 | 19 |
| `src/engine/governor` | 5 | 0 | 2 | 0 | 0 | 7 |
| `src/engine/gpu_pipeline.py` | 3 | 0 | 3 | 0 | 0 | 6 |
| `src/engine/graveyard` | 10 | 0 | 2 | 0 | 0 | 12 |
| `src/engine/hardware_profile.py` | 11 | 0 | 0 | 0 | 0 | 11 |
| `src/engine/indicators` | 116 | 0 | 18 | 0 | 0 | 134 |
| `src/engine/invariant_harness` | 22 | 0 | 0 | 0 | 0 | 22 |
| `src/engine/ising_decoder_wrapper.py` | 6 | 0 | 0 | 0 | 0 | 6 |
| `src/engine/jsonb_contracts.py` | 6 | 0 | 2 | 0 | 0 | 8 |
| `src/engine/liquidity.py` | 5 | 0 | 1 | 0 | 0 | 6 |
| `src/engine/macro_data` | 0 | 0 | 7 | 0 | 0 | 7 |
| `src/engine/macro_regime_classifier.py` | 0 | 0 | 10 | 0 | 0 | 10 |
| `src/engine/macro_regime_fusion.py` | 0 | 0 | 3 | 0 | 0 | 3 |
| `src/engine/margin_expansion.py` | 4 | 0 | 0 | 0 | 0 | 4 |
| `src/engine/marker_contract.py` | 1 | 0 | 1 | 0 | 0 | 2 |
| `src/engine/mc_confidence.py` | 6 | 0 | 0 | 0 | 0 | 6 |
| `src/engine/mc_multi_asset.py` | 3 | 1 | 1 | 1 | 0 | 6 |
| `src/engine/mc_regime_resampling.py` | 5 | 1 | 1 | 1 | 0 | 8 |
| `src/engine/monte_carlo.py` | 26 | 0 | 0 | 5 | 0 | 31 |
| `src/engine/nemo_a14_bridge.py` | 0 | 0 | 3 | 0 | 0 | 3 |
| `src/engine/nemo_scenario_designer.py` | 5 | 0 | 1 | 0 | 0 | 6 |
| `src/engine/null_calibration_guard.py` | 0 | 0 | 3 | 0 | 0 | 3 |
| `src/engine/nvtx_markers.py` | 3 | 0 | 1 | 0 | 0 | 4 |
| `src/engine/opening_range_adapter.py` | 4 | 0 | 0 | 0 | 0 | 4 |
| `src/engine/opening_range_candidate.py` | 2 | 0 | 0 | 0 | 0 | 2 |
| `src/engine/opening_range_definition.py` | 6 | 0 | 1 | 0 | 0 | 7 |
| `src/engine/opening_range_execution_fanout.py` | 0 | 0 | 1 | 0 | 0 | 1 |
| `src/engine/opening_range_lowering.py` | 0 | 0 | 10 | 0 | 0 | 10 |
| `src/engine/optimizer.py` | 7 | 0 | 0 | 0 | 0 | 7 |
| `src/engine/paper_analytics.py` | 1 | 0 | 0 | 0 | 0 | 1 |
| `src/engine/parameter_evolver.py` | 6 | 0 | 0 | 0 | 0 | 6 |
| `src/engine/parameter_jitter_battery.py` | 14 | 0 | 1 | 0 | 0 | 15 |
| `src/engine/parity_engine` | 27 | 1 | 0 | 0 | 0 | 28 |
| `src/engine/pbo_gate.py` | 2 | 0 | 0 | 0 | 0 | 2 |
| `src/engine/performance_gate.py` | 3 | 0 | 3 | 0 | 0 | 6 |
| `src/engine/pine_compiler.py` | 36 | 0 | 0 | 0 | 0 | 36 |
| `src/engine/pm_size_factor.py` | 6 | 0 | 0 | 0 | 0 | 6 |
| `src/engine/prop_compliance.py` | 4 | 0 | 3 | 0 | 0 | 7 |
| `src/engine/prop_sim.py` | 3 | 0 | 0 | 0 | 0 | 3 |
| `src/engine/prop_survival_model.py` | 0 | 0 | 7 | 0 | 0 | 7 |
| `src/engine/qmc_sampler.py` | 1 | 0 | 0 | 0 | 0 | 1 |
| `src/engine/quantum_adversarial_stress.py` | 7 | 0 | 0 | 0 | 0 | 7 |
| `src/engine/quantum_annealing_optimizer.py` | 8 | 0 | 2 | 0 | 0 | 10 |
| `src/engine/quantum_bench.py` | 0 | 0 | 6 | 0 | 0 | 6 |
| `src/engine/quantum_device_selector.py` | 2 | 0 | 0 | 0 | 0 | 2 |
| `src/engine/quantum_entropy_filter.py` | 5 | 1 | 0 | 0 | 0 | 6 |
| `src/engine/quantum_mc.py` | 8 | 0 | 4 | 0 | 0 | 12 |
| `src/engine/quantum_models.py` | 5 | 0 | 2 | 0 | 0 | 7 |
| `src/engine/quantum_rl_agent.py` | 21 | 0 | 4 | 0 | 0 | 25 |
| `src/engine/qubo_trade_timing.py` | 9 | 0 | 1 | 0 | 0 | 10 |
| `src/engine/regime.py` | 5 | 0 | 1 | 0 | 0 | 6 |
| `src/engine/regime_survival.py` | 0 | 0 | 3 | 0 | 0 | 3 |
| `src/engine/replay` | 31 | 0 | 10 | 0 | 0 | 41 |
| `src/engine/risk_metrics.py` | 18 | 0 | 0 | 0 | 0 | 18 |
| `src/engine/risk_parity.py` | 0 | 0 | 2 | 0 | 0 | 2 |
| `src/engine/robust_covariance.py` | 1 | 0 | 1 | 0 | 0 | 2 |
| `src/engine/robustness.py` | 3 | 0 | 0 | 0 | 0 | 3 |
| `src/engine/role_demotion_audit.py` | 3 | 0 | 2 | 0 | 0 | 5 |
| `src/engine/roll_calendar.py` | 17 | 0 | 2 | 0 | 0 | 19 |
| `src/engine/roll_spread_cost.py` | 7 | 0 | 0 | 0 | 0 | 7 |
| `src/engine/sanity_checks.py` | 1 | 0 | 0 | 0 | 0 | 1 |
| `src/engine/session_windows.py` | 11 | 0 | 2 | 0 | 0 | 13 |
| `src/engine/signals.py` | 8 | 0 | 0 | 0 | 0 | 8 |
| `src/engine/sizing.py` | 8 | 0 | 1 | 0 | 0 | 9 |
| `src/engine/skip_engine` | 38 | 0 | 10 | 0 | 0 | 48 |
| `src/engine/slippage.py` | 4 | 0 | 0 | 0 | 0 | 4 |
| `src/engine/spec_condition_compiler.py` | 8 | 0 | 0 | 0 | 0 | 8 |
| `src/engine/spec_family_bindings.py` | 46 | 0 | 0 | 0 | 0 | 46 |
| `src/engine/statistics` | 15 | 0 | 19 | 0 | 0 | 34 |
| `src/engine/strategies` | 29 | 0 | 0 | 0 | 0 | 29 |
| `src/engine/strategy_base.py` | 1 | 0 | 1 | 0 | 0 | 2 |
| `src/engine/strategy_memory.py` | 1 | 0 | 0 | 0 | 0 | 1 |
| `src/engine/stress_test.py` | 4 | 0 | 0 | 0 | 0 | 4 |
| `src/engine/surface_code_encoder.py` | 3 | 0 | 1 | 0 | 0 | 4 |
| `src/engine/survival` | 15 | 0 | 0 | 0 | 0 | 15 |
| `src/engine/synthetic` | 8 | 0 | 1 | 0 | 0 | 9 |
| `src/engine/synthetic_market_simulator.py` | 0 | 0 | 13 | 0 | 0 | 13 |
| `src/engine/tensor_signal_model.py` | 12 | 0 | 1 | 0 | 0 | 13 |
| `src/engine/validation` | 16 | 0 | 1 | 0 | 0 | 17 |
| `src/engine/validation_runner.py` | 5 | 0 | 0 | 0 | 0 | 5 |
| `src/engine/walk_forward.py` | 8 | 0 | 0 | 1 | 0 | 9 |
| `src/engine/walk_forward_regime_context.py` | 7 | 0 | 0 | 0 | 0 | 7 |
| `src/server/__tests__` | 0 | 0 | 0 | 14 | 0 | 14 |
| `src/server/db` | 127 | 0 | 187 | 0 | 0 | 314 |
| `src/server/index.ts` | 3 | 0 | 0 | 0 | 0 | 3 |
| `src/server/integrations` | 11 | 0 | 1 | 0 | 0 | 12 |
| `src/server/lib` | 690 | 0 | 460 | 1 | 0 | 1151 |
| `src/server/load-env.ts` | 0 | 0 | 0 | 0 | 1 | 1 |
| `src/server/middleware` | 8 | 0 | 5 | 0 | 1 | 14 |
| `src/server/production` | 29 | 0 | 4 | 0 | 1 | 34 |
| `src/server/routes` | 156 | 0 | 9 | 1 | 1 | 167 |
| `src/server/scheduler.ts` | 11 | 0 | 1 | 0 | 0 | 12 |
| `src/server/services` | 903 | 0 | 199 | 3 | 0 | 1105 |
| `src/server/slumdawg-hmac.ts` | 0 | 0 | 4 | 0 | 0 | 4 |
| `src/server/types` | 0 | 0 | 2 | 0 | 1 | 3 |
| `src/shared/db-types.ts` | 0 | 0 | 20 | 0 | 0 | 20 |
| `src/shared/firm-config.ts` | 27 | 0 | 13 | 0 | 0 | 40 |
| `src/shared/marker-contract.ts` | 5 | 0 | 0 | 0 | 0 | 5 |
| `src/shared/utils.ts` | 1 | 0 | 0 | 0 | 0 | 1 |
| `src/shared/walk-forward-schema.ts` | 5 | 0 | 6 | 0 | 0 | 11 |

---

## 5. FLAG-GATED - built, reachable, and OFF unless a flag says otherwise

**Read the `Default` column.**  A default-off flag is exactly how a finished subsystem stays
invisible for weeks.

| Symbol | Kind | Defined at | Flag | Default | Why |
|---|---|---|---|---|---|
| `run_multi_asset_correlation_bootstrap` | function | `src/engine/mc_multi_asset.py:255` | `MC_MULTI_ASSET_CORRELATION_ENABLED` | `'false'` | every non-test call site is inside an env-conditional block (e.g. src/engine/monte_carlo.py) |
| `run_regime_block_bootstrap` | function | `src/engine/mc_regime_resampling.py:254` | `MC_REGIME_AWARE_BOOTSTRAP_ENABLED` | `'false'` | every non-test call site is inside an env-conditional block (e.g. src/engine/monte_carlo.py) |
| `run_parity_shadow` | function | `src/engine/parity_engine/shadow_runner.py:356` | `PARITY_SHADOW_ENABLED` | `'false'` | every non-test call site is inside an env-conditional block (e.g. src/engine/backtester.py) |
| `collect_quantum_noise` | function | `src/engine/quantum_entropy_filter.py:235` | `QUANTUM_ENTROPY_FILTER_ENABLED` | `(no default)` | every non-test call site is inside an env-conditional block (e.g. src/engine/skip_engine/premarket_analyzer.py) |
| `attach_structure_column` | function | `src/engine/context/htf_columns.py:61` | `TF_WIRE1_HTF_COLUMNS` | `''` | every non-test call site is inside an env-conditional block (e.g. src/engine/backtester.py) |
| `attach_htf_columns` | function | `src/engine/context/htf_columns.py:134` | `TF_WIRE1_HTF_COLUMNS` | `''` | every non-test call site is inside an env-conditional block (e.g. src/engine/backtester.py) |

### 5.1 Every environment flag read anywhere in `src/`

**467 distinct flags.**  `Defaults observed` is the literal that follows the read
(`os.environ.get(X, default)`, `process.env.X ?? default`, or the value it is compared to).

<details><summary>All 467 flags</summary>

| Flag | Defaults observed | Read in N files |
|---|---|---:|
| `ADMIN_OVERRIDE_HMAC_SECRET` | `(no default)` | 3 |
| `ADMIN_PROMOTE_HMAC_SECRET` | `(no default)` | 2 |
| `ADMIN_RESTART_HMAC_SECRET` | `(no default)` | 7 |
| `ALLOW_RAW_DATA` | `'false'`, `(REQUIRED - no default)` | 2 |
| `ALPHA_PROBE_URL` | `"https://api.alphafutures.io/v1/account"` | 1 |
| `ALPHA_VANTAGE_API_KEY` | `(no default)` | 1 |
| `ANAM_API_KEY` | `(no default)` | 1 |
| `APEX_PROBE_URL` | `"https://api.apextraderfunding.com/v1/account"` | 1 |
| `APIFY_API_KEY` | `(no default)` | 3 |
| `APIFY_REDDIT_TOKEN` | `(no default)`, `process.env.APIFY_API_KEY` | 2 |
| `APIFY_USER_ID` | `(no default)` | 1 |
| `API_KEY` | `""`, `''`, `(no default)`, `process.env.OPENAI_API_KEY` | 21 |
| `AUTH_DEV_BYPASS` | `(no default)`, `(no default; compared to "true")` | 2 |
| `AWS_ACCESS_KEY_ID` | `''`, `(no default)` | 4 |
| `AWS_DEFAULT_REGION` | `''`, `'us-east-1'` | 1 |
| `AWS_REGION` | `"us-east-1"`, `''`, `'us-east-1'` | 4 |
| `AWS_SECRET_ACCESS_KEY` | `(no default)` | 3 |
| `B14_HARD_GATE_ENABLED` | `"true"` | 1 |
| `B14_PAYOUT_DENIAL_THRESHOLD` | `(no default)` | 2 |
| `B14_RUIN_CI_HIGH_THRESHOLD` | `'0.20'`, `(no default)` | 6 |
| `B14_SURVIVAL_TWIN_REPLAY_FAIL_GRADES` | `"F"` | 1 |
| `B14_SURVIVAL_TWIN_REPLAY_MIN_SCORE` | `(no default)` | 1 |
| `B14_SURVIVAL_TWIN_REPLAY_TIMEOUT_MS` | `(no default)` | 1 |
| `B15_BATTERY_ENABLED` | `"false"`, `"true"`, `(no default)` | 4 |
| `BACKTEST_CACHE_BUST` | `'0'` | 1 |
| `BACKTEST_COMPLIANCE_MODE` | `''`, `(REQUIRED - no default)`, `(no default)` | 4 |
| `BACKTEST_EXIT_SLIPPAGE_SYMMETRIC` | `'true'` | 1 |
| `BACKTEST_MAX_HOLD_BARS` | `'200'` | 1 |
| `BACKTEST_PARTIAL_FILL_ENABLED` | `'true'`, `(REQUIRED - no default)` | 2 |
| `BACKTEST_PARTIAL_FILL_VOLUME_THRESHOLD` | `'0.1'`, `(REQUIRED - no default)` | 2 |
| `BACKTEST_ROLL_SPREAD_ITEMIZED` | `'true'` | 1 |
| `BACKTEST_SEED` | `'42'` | 1 |
| `BACKTEST_STALENESS_DAYS` | `"30"`, `(no default)` | 3 |
| `BACKTEST_STATIC_C_PARTIALS_ENABLED` | `'1'`, `(REQUIRED - no default)`, `(no default)` | 2 |
| `BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED` | `'false'` | 1 |
| `BACKTEST_WINDOW_SEED` | `(REQUIRED - no default)` | 1 |
| `BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD` | `'true'` | 1 |
| `BIAS_ABLATION_COST_MULT` | `"2.0"` | 1 |
| `BIAS_CALIBRATION_WINDOW` | `"90"` | 1 |
| `BIAS_CLASSIFIER_VERSION` | `"1.0.0"` | 1 |
| `BIAS_ENGINE_MODE` | `"SHADOW"`, `'SHADOW'` | 2 |
| `BIF_BLOCK_THRESHOLD` | `(no default)`, `str(_BIF_BLOCK_DEFAULT)` | 3 |
| `BIF_WARN_THRESHOLD` | `(no default)`, `str(_BIF_WARN_DEFAULT)` | 3 |
| `BLACKOUT_PARQUET_DIR` | `''` | 1 |
| `BLIS_NUM_THREADS` | `(no default)` | 1 |
| `BLS_API_KEY` | `(no default)` | 2 |
| `BOOT_LAUNCHER_AUTO_APPLY_ENABLED` | `(no default; compared to "false")` | 1 |
| `BOOT_MIGRATION_ALLOW_NO_BACKUP` | `"false"`, `(no default)` | 2 |
| `BOOT_MIGRATION_BACKUP_DIR` | `(no default)`, `os.tmpdir` | 2 |
| `BOOT_MIGRATION_ENABLED` | `"true"`, `(no default)` | 3 |
| `BOOT_MIGRATION_FAIL_ON_MISSING_SQL` | `"false"` | 1 |
| `BOOT_MIGRATION_TIMEOUT_MS` | `"300000"`, `(no default)` | 2 |
| `BRAKET_BUDGET_DOLLARS` | `"30"` | 1 |
| `BRAKET_REGION` | `"us-east-1"` | 1 |
| `BRAKET_S3_BUCKET` | `"amazon-braket-trading-forge"` | 1 |
| `BRAVE_API_KEY` | `""`, `(no default)`, `null` | 4 |
| `BRAVE_GOGGLE_INLINE` | `(no default; compared to "1")` | 1 |
| `BRAVE_QUANT_GOGGLE_PATH` | `(no default)` | 1 |
| `BRAVE_QUANT_GOGGLE_URL` | `(no default)` | 1 |
| `BRAVE_SEARCH_API_KEY` | `(no default)`, `process.env.BRAVE_API_KEY` | 4 |
| `BROKER_FILL_HMAC_SECRET` | `(no default)`, `(no default; compared to "string")`, `process.env.BROKER_FILL_HMAC_SECRET.length` | 6 |
| `BW_SESSION` | `(no default)` | 2 |
| `BYPASS_PRE_MARKET_HEALTH_CHECK` | `(no default)`, `(no default; compared to "true")` | 2 |
| `CALENDAR_FAILURE_THRESHOLD` | `"3"`, `(no default)` | 2 |
| `CALENDAR_FAILURE_WINDOW_MS` | `"600000"`, `(no default)` | 2 |
| `CARTER_AGENT_ID` | `(no default)` | 3 |
| `CARTER_POST_CALL_WEBHOOK_SECRET` | `(no default)` | 2 |
| `CARTER_RESEARCH_MODEL` | `"(default)"`, `"gemma4:e4b-it-qat"` | 2 |
| `CARTER_RESEARCH_SINCE` | `"2025-01-01"` | 1 |
| `CARTER_TOOLS_HMAC_SECRET` | `(no default)` | 5 |
| `CME_STATUS_URL` | `"https://www.cmegroup.com/CmeWS/mvc/Venue/GLOBEX/status"` | 1 |
| `COMPLIANCE_CACHE_TTL_MS` | `"60000"`, `(no default)` | 2 |
| `COMPOSITE_MAX_AGE_HOURS` | `(no default)` | 2 |
| `CONFLUENCE_SCORE_WEIGHTS` | `(no default)` | 1 |
| `CONSISTENCY_RULE_ENFORCED` | `"false"`, `(no default)` | 2 |
| `CORPUS_FDR_POPULATION` | `str(default)` | 1 |
| `CORPUS_FDR_Q_PROMOTION` | `'0.05'` | 1 |
| `CORPUS_FDR_Q_RESEARCH` | `'0.10'` | 1 |
| `COVERAGE_ENUM_MAX_ITEMS` | `(no default)` | 1 |
| `COVERAGE_ENUM_OVERLAP_CHARS` | `(no default)` | 1 |
| `COVERAGE_ENUM_PER_WINDOW_CAP` | `(no default)` | 1 |
| `COVERAGE_ENUM_WINDOW_CHARS` | `(no default)` | 1 |
| `COVERAGE_MIN_MECHANIC_TOKENS` | `(no default)` | 1 |
| `COVERAGE_PASS_PCT` | `(no default)` | 1 |
| `COVERAGE_REPAIR_ACCEPT_PCT` | `(no default)` | 1 |
| `COVERAGE_REPAIR_CALL_BATCH` | `(no default)` | 1 |
| `COVERAGE_REPAIR_MAX_ROUNDS` | `(no default)` | 1 |
| `COVERAGE_REPAIR_MAX_TARGETS` | `(no default)` | 1 |
| `CPCV_MIN_PATHS` | `(no default)` | 1 |
| `CRITIC_FPR_LOOKBACK_DAYS` | `(no default)` | 1 |
| `CRITIC_MODEL_VERSION` | `"gemma4:e4b-it-qat"` | 1 |
| `CRITIQUE_FAITHFULNESS_CHECK` | `(no default; compared to "true")` | 1 |
| `CRITIQUE_RAG_ENABLED` | `(no default; compared to "true")` | 1 |
| `DATABASE_URL` | `""`, `''`, `(REQUIRED - no default)`, `(no default)` | 28 |
| `DATABENTO_API_KEY` | `''`, `(no default)` | 6 |
| `DATABENTO_REFRESH_TIMEOUT_MS` | `20` | 1 |
| `DATA_CACHE_DIR` | `Path(__file__).resolve().parent.parent.p` | 1 |
| `DATA_CACHE_TTL_SECONDS` | `str(24 * 3600)` | 1 |
| `DATA_COVERAGE_HARD_FAIL_PCT` | `'30'` | 1 |
| `DATA_COVERAGE_WARN_PCT` | `'80'` | 1 |
| `DB_POOL_MAX` | `(no default)` | 1 |
| `DD_VELOCITY_AUTOPAUSE_PCT` | `(no default)` | 1 |
| `DD_VELOCITY_WARNING_PCT` | `(no default)` | 1 |
| `DECAY_GRACE_DAYS` | `'14'` | 1 |
| `DECAY_TELEMETRY_THRESHOLD` | `(no default)` | 2 |
| `DETERMINISM_MODE` | `''` | 3 |
| `DISCORD_ALERT_PORT` | `"4100"`, `(no default)` | 8 |
| `DISCORD_APPLICATION_ID` | `(no default)` | 3 |
| `DISCORD_BOT_TOKEN` | `(no default)` | 3 |
| `DISCORD_CB_COOLDOWN_MS` | `"60000"` | 1 |
| `DISCORD_CB_FAILURE_THRESHOLD` | `"3"` | 1 |
| `DISCORD_CH_ALERTS` | `"1482525035921936537"` | 1 |
| `DISCORD_CH_COMPLIANCE` | `"1482525024484069397"` | 1 |
| `DISCORD_CH_CRITICAL_ALERTS` | `""` | 1 |
| `DISCORD_CH_GOVERNOR` | `"1482525038417674322"` | 1 |
| `DISCORD_CH_MACRO` | `"1482525030280855713"` | 1 |
| `DISCORD_CH_N8N_DAILY_REPORT` | `""` | 1 |
| `DISCORD_CH_SKIP` | `"1482525027416150057"` | 1 |
| `DISCORD_CH_SLUMDAWG_FEED` | `"1482571931222937642"`, `(no default)` | 3 |
| `DISCORD_CH_STRATEGY_FINDS` | `""`, `"strategy-finds"` | 2 |
| `DISCORD_CH_TOURNAMENT` | `"1482525032973336636"` | 1 |
| `DISCORD_CH_WORKFLOW_ERRORS` | `""` | 1 |
| `DISCORD_CLIENT_ID` | `(no default)`, `process.env.DISCORD_APPLICATION_ID`, `required` | 4 |
| `DISCORD_CLIENT_SECRET` | `(no default)` | 2 |
| `DISCORD_REDIRECT_URI` | `(no default)` | 3 |
| `DISCORD_WEBHOOK_URL` | `(no default)` | 3 |
| `DLL_FORCE_CLOSE_PCT` | `"0.95"`, `'0.95'`, `null` | 4 |
| `DLL_HALT_PCT` | `"0.67"`, `'0.67'`, `null` | 6 |
| `DLL_WARN_PCT` | `"0.80"` | 1 |
| `DLQ_MAX_AGE_HOURS` | `(no default)`, `48` | 2 |
| `DRAWDOWN_ROOM_RISK_PCT` | `"0.08"`, `'0.08'`, `(no default)` | 3 |
| `DSR_HONEST_THRESHOLD` | `"1.645"`, `'1.645'` | 2 |
| `DSR_USE_NTOTAL` | `'true'` | 1 |
| `EARN2TRADE_PROBE_URL` | `"https://api.earn2trade.com/v1/account"` | 1 |
| `EIA_API_KEY` | `''` | 1 |
| `ELEVENLABS_API_KEY` | `(no default)` | 3 |
| `EMBED_MODEL` | `'gemma4:e4b-it-qat'` | 1 |
| `EXA_API_KEY` | `""`, `(no default)`, `null` | 5 |
| `EXIT_DELTA_DIVERGENCE_THRESHOLD` | `'0.6'` | 1 |
| `EXIT_HANDLER_CB_COOLDOWN_MS` | `300_000` | 1 |
| `FADE_EXCLUDE_DEATH_REASONS` | `(no default)` | 1 |
| `FADE_MAX_PROFIT_FACTOR` | `(no default)` | 1 |
| `FADE_MIN_TRADES` | `(no default)` | 1 |
| `FEED_SILENCE_EMERGENCY_CLOSE_THRESHOLD_MS` | `(no default)` | 1 |
| `FEED_SILENCE_MAX_BAR_INTERVAL_MS` | `(no default)` | 1 |
| `FEED_SILENCE_MIN_BAR_INTERVAL_MS` | `(no default)` | 1 |
| `FEED_SILENCE_THRESHOLD_MULTIPLIER` | `(no default)` | 1 |
| `FFN_PROBE_URL` | `"https://api.fundednext.com/v1/account"` | 1 |
| `FILL_RECON_DRIFT_TOLERANCE_CONTRACTS` | `1` | 1 |
| `FILL_RECON_DRIFT_TOLERANCE_PRICE_POINTS` | `2` | 1 |
| `FIRM_SNAPSHOT_DIR` | `path.join` | 1 |
| `FORCE_CLOSE_TIMEOUT_MS` | `"10000"`, `(no default)` | 2 |
| `FORCE_CLOUD_COMPUTE` | `(no default)`, `(no default; compared to "true")` | 2 |
| `FORCE_USB_TETHERING` | `(no default)`, `(no default; compared to "true")` | 2 |
| `FORGE_GIT_SHA` | `"unknown"` | 4 |
| `FRED_API_KEY` | `''`, `(no default)` | 4 |
| `FRONTEND_BASE_URL` | `""` | 1 |
| `FRONTEND_ORIGIN` | `process.env.TRADING_FORGE_PUBLIC_URL` | 1 |
| `GATE_BLOCK_BIG_MOVE_MIN_R` | `'2.0'` | 1 |
| `GATE_BLOCK_BIG_MOVE_POINTS_MCL` | `'25'` | 1 |
| `GATE_BLOCK_BIG_MOVE_POINTS_MES` | `'14'` | 1 |
| `GATE_BLOCK_BIG_MOVE_POINTS_MNQ` | `'40'` | 1 |
| `GH_TOKEN` | `""` | 1 |
| `GITHUB_TOKEN` | `process.env.GH_TOKEN` | 1 |
| `GOVERNANCE_MIN_SAMPLE_DAYS` | `"63"`, `'63'`, `(REQUIRED - no default)` | 3 |
| `GRADUATION_DAILY_CAP` | `(no default)` | 1 |
| `H1_PILOT_AXIS3_CEILING` | `(no default)` | 1 |
| `HMAC_CANONICAL_V2` | `(no default; compared to "false")` | 1 |
| `HMAC_ENCRYPTION_KEY` | `(no default)` | 2 |
| `HMAC_PLAINTEXT_FALLBACK` | `(no default; compared to "true")` | 1 |
| `HMM_CONFIRM_THRESHOLD` | `"0.6"`, `'0.6'`, `(no default)` | 3 |
| `HMM_DISAGREE_THRESHOLD` | `"0.3"`, `'0.3'`, `(no default)` | 3 |
| `HMM_N_STATES` | `'3'` | 1 |
| `HMM_OVERLAY_ENABLED` | `"true"`, `'true'`, `(no default)`, `(no default; compared to "0")` (+1) | 4 |
| `IBM_QUANTUM_BUDGET_SECONDS` | `"600"` | 1 |
| `IBM_QUANTUM_CHANNEL` | `'ibm_cloud'` | 2 |
| `IBM_QUANTUM_CRN` | `os.environ.get('IBM_QUANTUM_INSTANCE', '`, `os.environ.get('IBM_QUANTUM_INSTANCE', i` | 2 |
| `IBM_QUANTUM_INSTANCE` | `"open-instance"`, `'open-instance'`, `instance` | 3 |
| `IBM_QUANTUM_TOKEN` | `""`, `''`, `null` | 6 |
| `KILL_SWITCH_CACHE_TTL_MS` | `"5000"`, `(no default)` | 2 |
| `LEAK_ALLOCATION_ZSCORE_HIGH` | `"2.0"` | 1 |
| `LEAK_ALLOCATION_ZSCORE_WARN` | `"1.0"` | 1 |
| `LEAK_COMPOSITE_DROP_THRESHOLD` | `"0.15"` | 1 |
| `LEAK_ENABLED` | `(no default)`, `(no default; compared to "false")` | 2 |
| `LEAK_LOOKBACK_DAYS` | `"60"` | 1 |
| `LEAK_MC_DD_SEVERE_MULT` | `"1.5"`, `(no default)` | 2 |
| `LEAK_MC_MIN_TRADES` | `"20"`, `(no default)` | 2 |
| `LEAK_MIN_REGRESSED_SUBSYSTEMS` | `"3"` | 1 |
| `LEAK_OPACITY_HIGH_PCT` | `"0.50"` | 1 |
| `LEAK_OPACITY_WARN_PCT` | `"0.25"` | 1 |
| `LEAK_SLIPPAGE_ZSCORE_HIGH` | `"2.0"` | 1 |
| `LEAK_SLIPPAGE_ZSCORE_WARN` | `"1.0"` | 1 |
| `LEARNING_LOOP_READY_NUDGE_DAYS` | `(no default)` | 1 |
| `LIFECYCLE_GATE_FAIL_GRAVEYARD_THRESHOLD` | `"3"`, `(no default)` | 2 |
| `LIQUIDITY_MAP_BATCH_SECRET` | `(no default)` | 2 |
| `LIQUIDITY_SWEEP_LOOKBACK_DEFAULT` | `(no default)` | 1 |
| `LIQUIDITY_SWEEP_VOLUME_MULT_DEFAULT` | `(no default)` | 1 |
| `LIVE_ORDER_GATEWAY_URL` | `(no default)` | 7 |
| `LIVE_ORDER_HMAC_SECRET` | `(no default)` | 5 |
| `LOG_LEVEL` | `"info"` | 3 |
| `LOOKAHEAD_GUARD_HARD` | `'true'` | 1 |
| `LUNCH_BLACKOUT_END_ET` | `(no default)` | 3 |
| `LUNCH_BLACKOUT_START_ET` | `(no default)` | 3 |
| `MARGIN_VIX_MULTIPLIER_30` | `'0.5'` | 2 |
| `MARGIN_VIX_MULTIPLIER_50` | `'0.25'` | 2 |
| `MARGIN_VIX_THRESHOLD_30` | `'30.0'` | 2 |
| `MARGIN_VIX_THRESHOLD_50` | `'50.0'` | 2 |
| `MASSIVE_API_KEY` | `(no default)` | 2 |
| `MASSIVE_FETCH_TIMEOUT_MS` | `"15000"`, `(no default)` | 2 |
| `MAX_CONCURRENT_BACKTESTS` | `"3"`, `(no default)` | 3 |
| `MAX_JOB_DURATION_MS` | `(no default)`, `String` | 2 |
| `MAX_PYTHON_SUBPROCESSES` | `"6"` | 2 |
| `MAX_PYTHON_SUBPROCESSES_EXECUTION` | `"2"` | 1 |
| `MC_BCA_MAX_SAMPLE` | `'5000'` | 2 |
| `MC_IID_AC_THRESHOLD` | `'0.05'` | 1 |
| `MC_LO_AC_SAMPLE` | `'1000'` | 1 |
| `MC_MULTI_ASSET_CORRELATION_ENABLED` | `'false'` | 2 |
| `MC_REGIME_AWARE_BOOTSTRAP_ENABLED` | `'false'` | 2 |
| `MC_RETURN_BOOTSTRAP_HARD_FAIL_MULTIPLIER` | `'2.0'` | 2 |
| `MC_RETURN_BOOTSTRAP_MAX_EXTRAPOLATION` | `'5.0'` | 2 |
| `MC_TRIM_OUTLIER_MULTIPLIER` | `''` | 1 |
| `MFFU_API_KEY_REF_TEST` | `(no default)` | 1 |
| `MFFU_DASHBOARD_URL` | `"https://app.myforexfunds.com/dashboard"` | 1 |
| `MFFU_PROBE_URL` | `"https://api.myforexfunds.com/v1/account"` | 1 |
| `MIGRATIONS_DIR` | `(no default)` | 3 |
| `MIN_COMPOSITE_SUBSYSTEMS` | `(no default)` | 2 |
| `MIN_CPCV_FOLD_BARS` | `'60'` | 1 |
| `MKL_CBWR` | `(no default)` | 2 |
| `N8N_API_KEY` | `(no default)` | 4 |
| `N8N_BASE_URL` | `"http://localhost:5678"`, `(no default)` | 13 |
| `N8N_BEARER_TOKEN` | `(no default)` | 1 |
| `N8N_CV1_BEARER` | `(no default)`, `process.env.N8N_BEARER_TOKEN` | 2 |
| `N8N_WEBHOOK_SECRET` | `(no default)` | 1 |
| `NAKED_POC_SYNC_TIMEOUT_MS` | `5` | 1 |
| `NEMO_DEFAULT_COUNT` | `'500'` | 1 |
| `NEWS_REDUCE_SIZE_FACTOR` | `(no default)` | 2 |
| `NODE_ENV` | `(no default)`, `(no default; compared to "development")`, `(no default; compared to "production")`, `(no default; compared to "test")` (+1) | 24 |
| `NUMBA_CACHE_DIR` | `(REQUIRED - no default)`, `(no default)` | 1 |
| `NVIDIA_API_KEY` | `''` | 1 |
| `OLLAMA_BASE_URL` | `"http://localhost:11434"` | 5 |
| `OLLAMA_DSL_CRITIC_FALLBACK` | `(no default)`, `(no default; compared to "true")` | 2 |
| `OLLAMA_HOST` | `process.env.OLLAMA_BASE_URL` | 3 |
| `OLLAMA_STREAM_CHUNK_TIMEOUT_MS` | `"30000"`, `(no default)` | 2 |
| `OLLAMA_UNHEALTHY_NOTIFY_COOLDOWN_MS` | `30` | 1 |
| `OLLAMA_URL` | `'http://127.0.0.1:11434/api/generate'` | 1 |
| `OMP_NUM_THREADS` | `(no default)` | 2 |
| `OOH_STALE_THRESHOLD_MS` | `String` | 1 |
| `OPENAI_API_KEY` | `""`, `(no default)` | 3 |
| `OPENAI_DAILY_BUDGET_TOKENS` | `process.env.TRADING_FORGE_DAILY_TOKEN_BUDGET` | 1 |
| `OPENAI_PROXY_BASE_URL` | `(no default)` | 1 |
| `OPENAI_USE_RESPONSES_API_CRITIC_EVALUATOR` | `(no default)` | 1 |
| `OPENAI_USE_RESPONSES_API_DSL_QUALITY_CRITIC` | `(no default)` | 1 |
| `OPENAI_USE_RESPONSES_API_FAST_CRITIQUE` | `(no default)` | 1 |
| `OPENAI_USE_RESPONSES_API_SCOUT_AUDITOR` | `(no default)` | 1 |
| `OPENAI_USE_RESPONSES_API_STRATEGY_PROPOSER` | `(no default)` | 1 |
| `OPENBLAS_NUM_THREADS` | `(no default)` | 2 |
| `OPERATOR_API_KEY` | `(no default)`, `DEV_AUTO_KEY` | 1 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `(no default)` | 2 |
| `PARALLEL_API_KEY` | `(no default)`, `null` | 3 |
| `PARAMETER_EVOLVER_MODEL` | `'gemma4:e4b-it-qat'` | 1 |
| `PARAM_DRIFT_CV_THRESHOLD` | `'0.30'`, `(REQUIRED - no default)` | 2 |
| `PARAM_DRIFT_OVERFIT_CONFIDENCE` | `'0.85'`, `(REQUIRED - no default)` | 2 |
| `PARAM_DRIFT_RHO_THRESHOLD` | `'0.30'`, `(REQUIRED - no default)` | 2 |
| `PARITY_SHADOW_ENABLED` | `'false'` | 2 |
| `PARITY_TOLERANCE_PNL_PCT` | `str(_DEFAULT_PNL_TOL_PCT)` | 1 |
| `PARITY_TOLERANCE_SHARPE` | `str(_DEFAULT_SHARPE_TOL)` | 1 |
| `PARITY_TOLERANCE_TRADE_COUNT` | `str(_DEFAULT_TRADE_COUNT_TOL)` | 1 |
| `PATTERN_AGGREGATOR_MIN_CRITIQUES` | `(no default)` | 2 |
| `PATTERN_AGGREGATOR_WINDOW` | `(no default)` | 1 |
| `PAUSE_SNAPSHOT_ENABLED` | `(no default; compared to "true")` | 1 |
| `PBO_OVERFIT_THRESHOLD` | `'0.5'`, `str(_PBO_OVERFIT_THRESHOLD_DEFAULT)` | 2 |
| `PBO_OVERFIT_THRESHOLD_PCT` | `(no default)` | 3 |
| `PBO_PROMOTION_THRESHOLD` | `"0.5"`, `'0.5'` | 2 |
| `PERFORMANCE_GATE_PF_THRESHOLD` | `'1.7'` | 1 |
| `PINE_DELIVERY_DISCORD_WEBHOOK` | `(no default)` | 1 |
| `PINE_DELIVERY_EMAIL_TO` | `(no default)` | 1 |
| `PINE_EXPORT_ALLOW_UNAUTH` | `(no default; compared to "true")` | 1 |
| `PINE_MAX_SUBPROCESSES` | `"3"` | 1 |
| `PINE_RECON_STALENESS_DAYS` | `"7"` | 1 |
| `PM_LAST_ENTRY_ET` | `"15:30"`, `(no default)` | 3 |
| `PM_SESSION_START_ET` | `"13:30"`, `(no default)` | 3 |
| `PM_SIZE_FACTOR_AT_13_30` | `(no default)` | 4 |
| `PM_SIZE_FACTOR_AT_15_00` | `(no default)` | 4 |
| `PM_SIZE_FACTOR_FLOOR_AT_ET` | `"15:00"`, `(no default)` | 3 |
| `PORT` | `"4000"`, `'4000'`, `(no default)` | 5 |
| `PORTFOLIO_DRIFT_DEMOTION_ENABLED` | `(no default)` | 1 |
| `PORTFOLIO_DRIFT_SHARPE_FLOOR` | `(no default)` | 1 |
| `PRICE_LOCK_LIMIT_PCT_ES` | `(no default)` | 1 |
| `PRICE_LOCK_PROXIMITY_PCT` | `(no default)` | 2 |
| `PROMOTION_GRANDFATHER_PRE_PASS_E` | `"false"`, `(no default)` | 5 |
| `PROVEN_TRADES_PER_TIER` | `"10"`, `'10'` | 2 |
| `PYTHONPATH` | `""` | 4 |
| `PYTHON_BIN` | `(no default)` | 1 |
| `QUANTUM_ADVERSARIAL_STRESS_ENABLED` | `'false'`, `(no default)` | 2 |
| `QUANTUM_AMARKET_AUDITOR_ENABLED` | `(no default)`, `(no default; compared to "true")` | 3 |
| `QUANTUM_CLOUD_ENABLED` | `""`, `''`, `(no default; compared to "true")` | 8 |
| `QUANTUM_CUQUANTUM_GPU_ENABLED` | `'false'` | 2 |
| `QUANTUM_ENTROPY_FILTER_ENABLED` | `(no default)` | 1 |
| `QUANTUM_PROP_FIRM_UCI_THRESHOLD` | `(no default)` | 2 |
| `QUANTUM_QAE_GATE_PHASE` | `"0"` | 1 |
| `QUANTUM_REPLAY_AUTO_FIRE_ENABLED` | `(no default)` | 2 |
| `QUANTUM_REPLAY_CIRCUIT_BREAKER_COOLDOWN_MS` | `"3600000"` | 1 |
| `QUANTUM_REPLAY_FAILURE_THRESHOLD` | `"5"` | 2 |
| `QUANTUM_REPLAY_TIMEOUT_MS` | `(no default)` | 1 |
| `QUANTUM_REPLAY_WEEKLY_TIMEOUT_MS` | `(no default)` | 1 |
| `QUANTUM_RL_CIRCUIT_BREAKER_COOLDOWN_MS` | `"3600000"` | 1 |
| `QUANTUM_RL_DSR_FLOOR` | `"0.5"`, `'0.5'` | 4 |
| `QUANTUM_RL_IBM_CLOUD_OPT_IN` | `''` | 2 |
| `QUANTUM_RL_KILL_SWITCH_THRESHOLD_PCT` | `"30.0"`, `'30.0'` | 2 |
| `QUANTUM_RL_REWARD_ALPHA` | `str(_RL_REWARD_ALPHA_DEFAULT)` | 1 |
| `QUANTUM_RL_REWARD_BETA` | `str(_RL_REWARD_BETA_DEFAULT)` | 1 |
| `QUANTUM_RL_TRAINING_EPOCHS` | `"200"` | 1 |
| `QUANTUM_RL_TRAINING_FAILURE_THRESHOLD` | `"5"`, `'5'` | 3 |
| `QUANTUM_RL_TRAINING_TIMEOUT_MS` | `(no default)` | 2 |
| `RAILWAY_COMPUTE_URL` | `(no default)`, `null` | 2 |
| `RAILWAY_N8N_API_KEY` | `(no default)` | 3 |
| `RECON_TRADERSPOST_CONFIRM_INDEPENDENT` | `(no default)`, `(no default; compared to "true")` | 4 |
| `REGIME_SURVIVAL_PHASE` | `'advisory'` | 1 |
| `RISK_GATE_HOUSEHOLD_LOSS_SCOPE` | `(no default)`, `(no default; compared to "true")` | 2 |
| `RISK_VIX_TARGET` | `"18"`, `'18'` | 2 |
| `RISK_VOL_SCALE_MAX` | `"1.5"`, `'1.5'` | 2 |
| `RISK_VOL_SCALE_MIN` | `"0.5"`, `'0.5'` | 2 |
| `RITHMIC_STATUS_URL` | `"https://rithmic.com/status"` | 1 |
| `ROLL_SPREAD_CL_TICKS` | `'2.0'` | 1 |
| `ROLL_SPREAD_ES_TICKS` | `'3.0'` | 1 |
| `ROLL_SPREAD_MCL_TICKS` | `'2.0'` | 1 |
| `ROLL_SPREAD_MES_TICKS` | `'3.0'` | 1 |
| `ROLL_SPREAD_MNQ_TICKS` | `'4.0'` | 1 |
| `ROLL_SPREAD_NQ_TICKS` | `'4.0'` | 1 |
| `RULESET_MAX_AGE_HOURS_ACTIVE` | `(no default)` | 1 |
| `RULESET_MAX_AGE_HOURS_RESEARCH` | `(no default)` | 1 |
| `S3_BUCKET` | `"trading-forge-data"`, `'trading-forge-data'` | 9 |
| `SCOUT_KEYWORD_SUBSET_SIZE` | `(no default)` | 1 |
| `SCOUT_TARGET_CONCEPTS` | `(no default)` | 1 |
| `SERVER_MEDIATED_EXECUTION_ENABLED` | `(no default)`, `(no default; compared to "true")` | 4 |
| `SHADOW_DIVERGENCE_MIN_SAMPLE` | `(no default)` | 1 |
| `SHADOW_DIVERGENCE_THRESHOLD_PCT` | `"0.05"`, `(no default)` | 2 |
| `SHADOW_RERUN_CONCURRENCY` | `(no default)` | 1 |
| `SIGNAL_CORRELATION_THRESHOLD` | `(no default)` | 1 |
| `SLIPPAGE_SURVIVAL_BLOCK_MULT` | `(no default)` | 2 |
| `SLIPPAGE_SURVIVAL_GATE_ENABLED` | `(no default)` | 2 |
| `SLIPPAGE_SURVIVAL_MIN_PF` | `'1.0'`, `(no default)` | 3 |
| `SLIPPAGE_SURVIVAL_MIN_TRADES` | `'20'`, `(no default)` | 3 |
| `SLIPPAGE_SURVIVAL_MULTIPLES` | `'1,2,3'`, `(no default)` | 3 |
| `SLIPPAGE_TICK_ROUNDING_MODE` | `'ceil'`, `(no default)` | 2 |
| `SLUMDAWG_FEED_PROXY_URL` | `(no default)` | 2 |
| `SLUMDAWG_WEBHOOK_SECRET` | `""`, `(no default)` | 3 |
| `SLUMHOUSE_ADMIN_PASSCODE` | `(no default)` | 3 |
| `SLUMHOUSE_ALLOWED_ORIGINS` | `""`, `(no default)` | 2 |
| `SLUMHOUSE_SESSION_SECRET` | `(no default)` | 8 |
| `SMTP_HOST` | `(no default)` | 1 |
| `SNAPSHOT_UPDATE` | `''` | 1 |
| `SOURCE_VERIFIER_DISABLED` | `(no default; compared to "true")` | 1 |
| `SPA_P_VALUE_THRESHOLD` | `(REQUIRED - no default)`, `(no default)`, `str(_SPA_P_VALUE_THRESHOLD_DEFAULT)` | 2 |
| `STATIC_TP2_LIQ_BAND_HIGH_R` | `'2.6'` | 1 |
| `STATIC_TP2_LIQ_BAND_LOW_R` | `'1.4'` | 1 |
| `STOP_BUFFER_TICKS_MCL` | `(no default)` | 1 |
| `STOP_BUFFER_TICKS_MES` | `(no default)` | 1 |
| `STOP_BUFFER_TICKS_MNQ` | `(no default)` | 1 |
| `STOP_CEILING_PTS_MCL` | `"1.00"`, `'1.00'` | 3 |
| `STOP_CEILING_PTS_MES` | `"14"`, `'14'` | 3 |
| `STOP_CEILING_PTS_MNQ` | `"62"`, `'62'` | 3 |
| `STOP_CHANDELIER_MULTIPLIER_TRENDING` | `'2.5'`, `2.5` | 2 |
| `STOP_FLOOR_PTS_MES` | `"6.0"` | 1 |
| `STRATEGY_DSL_LOOKBACK` | `"50"` | 1 |
| `STRATEGY_DSL_SIMILARITY_THRESHOLD` | `"0.85"` | 1 |
| `STRATEGY_REVALIDATION_FORCE_DAYS` | `(no default)` | 1 |
| `STRATEGY_REVALIDATION_WARN_DAYS` | `(no default)` | 1 |
| `STYLE_C_EXIT_TS_NATIVE` | `(no default)`, `(no default; compared to "true")` | 2 |
| `TAVILY_API_KEY` | `(no default)` | 3 |
| `TF_A12_REPORT_PATH` | `(no default)` | 1 |
| `TF_ALLOW_FIXED_1` | `'false'` | 1 |
| `TF_BACKEND_PUBLIC_URL` | `"http://localhost:4000"` | 1 |
| `TF_BACKEND_URL` | `process.env.TF_BACKEND_PUBLIC_URL` | 1 |
| `TF_BACKTEST_ANTI_SETUP_MODE` | `"off"`, `'enforce'` | 2 |
| `TF_BACKTEST_COMPLIANCE_MODE` | `''`, `(REQUIRED - no default)` | 2 |
| `TF_BACKTEST_SKIP_MODE` | `"off"`, `'enforce'` | 2 |
| `TF_CLASS_WF_ELIGIBILITY_GATE_ENABLED` | `''` | 1 |
| `TF_COMPOSITION_BUNDLE_ENABLED` | `'false'`, `(REQUIRED - no default)`, `(no default)` | 2 |
| `TF_CONFLUENCE_OVERLAY_DISABLED` | `''` | 1 |
| `TF_DECAY_FULL_SUBSIGNALS` | `'false'` | 1 |
| `TF_DISABLE_SCHEDULER` | `(no default; compared to "true")` | 1 |
| `TF_ENABLE_CV1_WEBHOOK` | `""` | 1 |
| `TF_EXTRACTION_DAILY_TOKEN_CAP` | `(no default)` | 1 |
| `TF_FAIL_CLOSED_EXECUTION` | `(no default; compared to "0")` | 1 |
| `TF_FVG_IDENTITY_ENABLED` | `'false'`, `(REQUIRED - no default)`, `(no default)` | 2 |
| `TF_HOST_TAG` | `"local"` | 1 |
| `TF_LAUNCHED_VIA_BOOT_WRAPPER` | `(no default; compared to "1")` | 1 |
| `TF_LEVELZONE_RESOLVER_ENABLED` | `'false'`, `(REQUIRED - no default)`, `(no default)` | 2 |
| `TF_LEVELZONE_ROUTING_ENABLED` | `'false'`, `(REQUIRED - no default)`, `(no default)` | 3 |
| `TF_MAX_TRADES_PER_DAY` | `(no default)` | 4 |
| `TF_MOCK_VBT` | `(no default)` | 2 |
| `TF_N8N_API_KEY` | `(no default)`, `process.env.RAILWAY_N8N_API_KEY` | 3 |
| `TF_NSSM_PATH` | `(no default)` | 1 |
| `TF_OR_BRANCHES_ENABLED` | `'false'`, `(REQUIRED - no default)`, `(no default)` | 2 |
| `TF_OVERLAY_DISABLE_LAYERS` | `''` | 1 |
| `TF_PAPER_SKIP_MODE` | `(no default)` | 1 |
| `TF_PHASE_5_ENABLED` | `'false'` | 1 |
| `TF_POSITION_LOCKING` | `(no default; compared to "1")` | 1 |
| `TF_PYTHON_USER_SITE` | `(no default)` | 4 |
| `TF_ROLE_DEMOTION_AUDIT_PATH` | `(REQUIRED - no default)`, `(no default)`, `DEFAULT_AUDIT_PATH` | 2 |
| `TF_ROLE_DEMOTION_MODE` | `'off'`, `(REQUIRED - no default)`, `(no default)` | 2 |
| `TF_RUNTIME_STAGE` | `(no default)` | 1 |
| `TF_SESSION_ROLE_RESOLVER_ENABLED` | `'false'`, `(REQUIRED - no default)`, `(no default)` | 4 |
| `TF_SPEC_TRACE` | `''` | 1 |
| `TF_STRESS_TEST_MODE` | `"pipeline"`, `'full'` | 3 |
| `TF_SURVIVAL_IN_FORGE_SCORE` | `'false'` | 1 |
| `TF_TOWER_BOOT_LAUNCHER_PATH` | `(no default)` | 1 |
| `TF_VAULT_FOLDER_ID` | `(no default)` | 2 |
| `TF_VAULT_MODE` | `(no default)` | 2 |
| `TF_VERIFY_DETERMINISM` | `'0'` | 1 |
| `TF_WIRE1_HTF_COLUMNS` | `''` | 2 |
| `TIME_STOP_FLATTEN_ET` | `"15:55"`, `'15:55'` | 2 |
| `TOPSTEP_CONSISTENCY_RULE_ENFORCED` | `(no default)`, `process.env.CONSISTENCY_RULE_ENFORCED` | 2 |
| `TOPSTEP_DASHBOARD_URL` | `"https://trader.topstep.com/dashboard"` | 1 |
| `TOPSTEP_PAYOUT_LANE` | `'standard'`, `(REQUIRED - no default)`, `(no default)` | 3 |
| `TOPSTEP_PROBE_URL` | `"https://api.topstep.com/v1/account"` | 1 |
| `TPT_PROBE_URL` | `"https://api.theprofit.trade/v1/account"` | 1 |
| `TRADEIFY_PROBE_URL` | `"https://api.tradeify.com/v1/account"` | 1 |
| `TRADERSPOST_CB_COOLDOWN_MS` | `"30000"` | 1 |
| `TRADERSPOST_CB_FAILURE_THRESHOLD` | `"3"` | 1 |
| `TRADERSPOST_CONFIRM_SECRET` | `(no default)` | 2 |
| `TRADERSPOST_WEBHOOK_URL` | `"https://traderspost.io/trading/webhook"` | 2 |
| `TRADE_CRITIQUE_CONCURRENCY` | `""` | 1 |
| `TRADING_FORGE_API_URL` | `"http://localhost:4000"`, `'http://localhost:4000'` | 2 |
| `TRADING_FORGE_DAILY_TOKEN_BUDGET` | `500_000` | 1 |
| `TRADING_FORGE_PUBLIC_URL` | `""`, `(no default)` | 2 |
| `TRADOVATE_STATUS_URL` | `(no default)` | 2 |
| `TRANSCRIPT_EXTRACTOR_BOOT_PROBE_MS` | `(no default)` | 1 |
| `TRANSCRIPT_EXTRACTOR_FORCE_CLOUD` | `"false"`, `(no default)` | 5 |
| `TRANSCRIPT_EXTRACTOR_KEEP_ALIVE` | `"-1"` | 1 |
| `TRANSCRIPT_EXTRACTOR_LOCAL_MODEL` | `"gemma4:e2b"`, `"gemma4:e4b-it-qat"`, `'gemma4:e4b-it-qat'`, `(no default)` | 7 |
| `TRANSCRIPT_EXTRACTOR_NUM_CTX` | `(no default)` | 3 |
| `TRANSCRIPT_EXTRACTOR_OLLAMA_KEEP_ALIVE` | `"30m"` | 1 |
| `TRANSCRIPT_EXTRACTOR_OLLAMA_SEED` | `"42"` | 1 |
| `TRANSCRIPT_EXTRACTOR_OLLAMA_TIMEOUT_MS` | `(no default)` | 1 |
| `TRANSCRIPT_EXTRACTOR_STRICT_SCHEMA` | `(no default)` | 3 |
| `TRANSCRIPT_EXTRACTOR_THINKING_MODE` | `thinkingDefault` | 1 |
| `TRANSCRIPT_EXTRACTOR_USE_LEGACY` | `"false"`, `'false'` | 2 |
| `VALIDATION_CADENCE_MIN_STRATEGIES_PER_MONTH` | `"1"` | 1 |
| `VALIDATION_CADENCE_RED_THRESHOLD_DAYS` | `"7"` | 1 |
| `VITEST` | `(no default)`, `(no default; compared to "true")` | 3 |
| `VIX_ATR_MULT_HIGH` | `'2.5'`, `'3.0'` | 2 |
| `VIX_ATR_MULT_LOW` | `'1.5'` | 1 |
| `VIX_ATR_MULT_MID` | `'2.0'` | 1 |
| `VIX_ATR_TIER_HIGH` | `"2.5"` | 1 |
| `VIX_ATR_TIER_LOW` | `"1.5"`, `'15.0'`, `'20.0'` | 3 |
| `VIX_ATR_TIER_MID` | `"2.0"`, `'25.0'`, `'30.0'` | 3 |
| `VIX_MARGIN_ROLLING_WINDOW` | `'30'` | 1 |
| `VIX_TIERED_ATR_ENABLED` | `'false'`, `(no default; compared to "true")` | 2 |
| `VP_NODE_THRESHOLD_PCT_DEFAULT` | `(no default)` | 1 |
| `VP_PROFILE_WINDOW_DEFAULT` | `(no default)` | 1 |
| `VP_SYMBOLS` | `"MES,MNQ,MCL"` | 2 |
| `WFE_HARD_FLOOR` | `(REQUIRED - no default)`, `(no default)`, `str(_WFE_HARD_FLOOR_DEFAULT)` | 4 |
| `WFE_PROMOTION_FLOOR` | `(no default)` | 1 |
| `WFE_WARN_FLOOR` | `(REQUIRED - no default)`, `(no default)`, `str(_WFE_WARN_FLOOR_DEFAULT)` | 4 |
| `WF_EMBARGO_PCT` | `'0.01'` | 1 |
| `WF_MAX_WORKERS` | `'2'` | 1 |
| `WF_MODE` | `'cpcv'` | 2 |
| `WF_PARALLEL` | `"1"`, `'1'` | 3 |
| `WF_PURGE_WINDOW` | `'0'`, `'20'` | 1 |
| `WORKFLOW_BACKUP_SECRET` | `(no default)` | 2 |
| `WRC_P_VALUE_THRESHOLD` | `(REQUIRED - no default)`, `(no default)`, `str(_WRC_P_VALUE_THRESHOLD_DEFAULT)` | 2 |
| `YOUTUBE_DAILY_QUOTA_BUDGET` | `(no default)` | 1 |
| `YOUTUBE_DATA_API_KEY` | `""`, `(no default)` | 3 |
| `ZOMBIE_DECLINING_THRESHOLD_MS` | `"90000000"`, `(no default)`, `String` | 2 |
| `npm_package_version` | `"dev"` | 1 |

</details>

---

## 6. DECLARED-ABSENT - referenced, but not on disk

**36 rows.**  Two probes feed this: unresolvable internal import specifiers, and
repo-relative path literals (`src/**.py`, `scripts/**`) naming a file that does not exist -
the latter is the TS->Python subprocess seam, where a typo fails only at runtime.

| Referenced as | Kind | Referenced from | Why flagged |
|---|---|---|---|
| `scripts/frontier-daily-ledger.json` | path-literal | `scripts/h1-frontier-designpool.ts:99` | repo-relative path literal with no file on disk |
| `scripts/frontier-daily-ledger.json` | path-literal | `scripts/h1-grant-completion-ticket.ts:3` | repo-relative path literal with no file on disk |
| `scripts/frontier-daily-ledger.json` | path-literal | `scripts/h1-grant-configpass-burst.ts:2` | repo-relative path literal with no file on disk |
| `scripts/frontier-daily-ledger.json` | path-literal | `scripts/h1-grant-configpass-v2-burst.ts:2` | repo-relative path literal with no file on disk |
| `scripts/frontier-daily-ledger.json` | path-literal | `scripts/h1-mini-phaseB-tryout.ts:58` | repo-relative path literal with no file on disk |
| `scripts/frontier-daily-ledger.json` | path-literal | `scripts/h1-reconcile-and-grant-burst.ts:3` | repo-relative path literal with no file on disk |
| `scripts/frontier-daily-ledger.json` | path-literal | `scripts/h1-seed-ledger.ts:4` | repo-relative path literal with no file on disk |
| `src/components/forge/ValidationCadencePanel.ts` | path-literal | `src/dashboard/components/ValidationCadencePanel.tsx:19` | repo-relative path literal with no file on disk |
| `scripts/databento_download.py` | path-literal | `src/data/fetchers/databento.ts:19` | repo-relative path literal with no file on disk |
| `src.engine.audit_writer` | module | `src/engine/mc_multi_asset.py:304` | import specifier resolves to no file on disk |
| `src.engine.audit_writer` | module | `src/engine/mc_regime_resampling.py:302` | import specifier resolves to no file on disk |
| `src.engine.audit_writer` | module | `src/engine/monte_carlo.py:420` | import specifier resolves to no file on disk |
| `src.engine.audit_writer` | module | `src/engine/monte_carlo.py:1511` | import specifier resolves to no file on disk |
| `src.engine.audit_writer` | module | `src/engine/monte_carlo.py:1596` | import specifier resolves to no file on disk |
| `src.engine.audit_writer` | module | `src/engine/monte_carlo.py:1668` | import specifier resolves to no file on disk |
| `src.engine.audit_writer` | module | `src/engine/monte_carlo.py:2194` | import specifier resolves to no file on disk |
| `src.engine.audit_writer` | module | `src/engine/walk_forward.py:1198` | import specifier resolves to no file on disk |
| `src/server/db/migrations/0058_audit_log_append_only.down.sql` | path-literal | `src/server/__tests__/audit-log-append-only.test.ts:56` | repo-relative path literal with no file on disk |
| `src/types/sse-events.ts` | path-literal | `src/server/__tests__/deepscan12-track-r-sse-safety-gate.test.ts:21` | repo-relative path literal with no file on disk |
| `src/hooks/useSSE.ts` | path-literal | `src/server/__tests__/deepscan12-track-r-sse-safety-gate.test.ts:26` | repo-relative path literal with no file on disk |
| `src/components/ServerStatusBanner.ts` | path-literal | `src/server/__tests__/deepscan12-track-r-sse-safety-gate.test.ts:31` | repo-relative path literal with no file on disk |
| `src/server/services/brand-new-service.ts` | path-literal | `src/server/__tests__/g1-backtest-caller-disposition-guard.test.ts:71` | repo-relative path literal with no file on disk |
| `src/server/services/unrelated-service.ts` | path-literal | `src/server/__tests__/g1-backtest-caller-disposition-guard.test.ts:139` | repo-relative path literal with no file on disk |
| `src/server/services/commented-service.ts` | path-literal | `src/server/__tests__/g1-backtest-caller-disposition-guard.test.ts:153` | repo-relative path literal with no file on disk |
| `./broker-router.js` | module | `src/server/__tests__/paper-signal-b1-routeorder-lifecycle-guard.test.ts:40` | import specifier resolves to no file on disk |
| `./paper-execution-service.js` | module | `src/server/__tests__/paper-signal-service-deepscan-findings.test.ts:79` | import specifier resolves to no file on disk |
| `./paper-execution-service.js` | module | `src/server/__tests__/paper-signal-service-deepscan-findings.test.ts:82` | import specifier resolves to no file on disk |
| `src/types/sse-events.ts` | path-literal | `src/server/__tests__/wave11-sse-inventory-drift-checker.test.ts:29` | repo-relative path literal with no file on disk |
| `src/types/sse-events.ts` | path-literal | `src/server/__tests__/wave13-backtest-scored.test.ts:51` | repo-relative path literal with no file on disk |
| `./pipeline-control-service.js` | module | `src/server/__tests__/wave26-pass-g-pass-f-dd-velocity.test.ts:50` | import specifier resolves to no file on disk |
| `../routes/composite-health.js?v=` | module | `src/server/__tests__/wave28-pass-a-composite-health-routes.test.ts:155` | import specifier resolves to no file on disk |
| `src/types/sse-events.ts` | path-literal | `src/server/lib/system-topology.ts:2291` | repo-relative path literal with no file on disk |
| `scripts/run_pipeline.py` | path-literal | `src/server/routes/data.ts:157` | repo-relative path literal with no file on disk |
| `./broker-router.js` | module | `src/server/services/__tests__/pass6-ab-routing.test.ts:52` | import specifier resolves to no file on disk |
| `./broker-router.js` | module | `src/server/services/__tests__/pass6-ab-routing.test.ts:64` | import specifier resolves to no file on disk |
| `./broker-router.js` | module | `src/server/services/__tests__/pass6-ab-routing.test.ts:129` | import specifier resolves to no file on disk |

---

## 7. BUILT-UNREACHABLE - the re-build trap

**This is the section that exists to stop an agent re-authoring something already in the**
**tree.**  Everything here is written, present, and often tested - it simply has no static
caller.  This is a MAP entry, not a work order: it does not mean delete it, and it does not
mean wire it.  Acting on anything here is a separate, authorized decision.

Of **1529** `BUILT-UNREACHABLE` symbols, **771 have test coverage but no production caller**.
Those are the highest-confidence *already built, just not plugged in* finds: someone wrote it,
someone proved it works, and nothing calls it.

### 7.1 Built AND tested, but no non-test caller

Unambiguous names are listed FIRST: their test-caller counts cannot be inflated by a
same-named symbol elsewhere, so they are the rows to trust.  `AMBIG` rows are listed after
and their counts are name-matched only - the large blocks of them come from
`src/server/db/migrations/schema.ts`, a generated introspection dump that duplicates every
table name in `src/server/db/schema.ts`.  Nothing imports the dump, which is why it is here.

| Symbol | Kind | Defined at | Test files referencing it | Name |
|---|---|---|---:|---|
| `require` | function | `src/engine/battery/mapping_guard.py:32` | 16 | unique |
| `AuditRow` | interface | `src/server/lib/shadow-evidence-analyzer.ts:51` | 11 | unique |
| `selectModel` | function | `src/server/services/model-router.ts:806` | 11 | unique |
| `loadCredentials` | function | `src/server/lib/credential-loader.ts:323` | 9 | unique |
| `flushNotifications` | function | `src/server/services/notification-service.ts:356` | 8 | unique |
| `ExpressionStrategy` | class | `src/engine/strategy_base.py:72` | 6 | unique |
| `__setOllamaHealthyForTests` | function | `src/server/services/model-router.ts:411` | 6 | unique |
| `DEFAULT_ACCOUNT_TYPE` | const | `src/shared/firm-config.ts:366` | 6 | unique |
| `_synthetic_dry_run_propose_fn` | function | `src/engine/extraction/pilot_conveyor.py:1794` | 5 | unique |
| `certified_reader_identity` | function | `src/engine/extraction/sealed_read_driver.py:288` | 5 | unique |
| `produce_spec_artifact` | function | `src/engine/extraction/spec_producer.py:580` | 5 | unique |
| `_resetForTest` | function | `src/server/lib/carter/carter-issues-store.ts:231` | 5 | unique |
| `_testOnly` | const | `src/server/scheduler.ts:746` | 5 | unique |
| `__clearPromptCacheForTests` | function | `src/server/services/model-router.ts:933` | 5 | unique |
| `getAppendixCacheSize` | function | `src/server/services/model-router.ts:862` | 5 | unique |
| `getNotificationServiceStatus` | function | `src/server/services/notification-service.ts:368` | 5 | unique |
| `stripMarkdown` | function | `src/server/services/scout-formatter.ts:89` | 5 | unique |
| `tier1RegexFilter` | function | `src/server/services/scout-formatter.ts:40` | 5 | unique |
| `run_leg_a_phase1` | function | `src/engine/forensics/compile_fidelity.py:332` | 4 | unique |
| `computeSpearman` | function | `src/server/lib/replay/quantum-disagreement.ts:84` | 4 | unique |
| `__clearAppendixCacheForTests` | function | `src/server/services/model-router.ts:942` | 4 | unique |
| `onboardSpecArtifact` | function | `src/server/services/spec-onboarding-service.ts:425` | 4 | unique |
| `TrialCounter` | class | `src/engine/battery/trial_counter.py:70` | 3 | unique |
| `assemble_certificate` | function | `src/engine/extraction/cert_assembler.py:299` | 3 | unique |
| `terminal_read_grade` | function | `src/engine/extraction/cert_assembler.py:186` | 3 | unique |
| `LintResult` | class | `src/engine/extraction/compile_lints.py:165` | 3 | unique |
| `aggregate` | function | `src/engine/extraction/pilot_conveyor.py:1678` | 3 | unique |
| `_spec_hash` | function | `src/engine/extraction/spec_producer.py:693` | 3 | unique |
| `produce_spec_artifact_from_record` | function | `src/engine/extraction/spec_producer.py:959` | 3 | unique |
| `Tier1Detection` | class | `src/engine/extraction/tier1_detectors.py:54` | 3 | unique |
| `produce_topology` | function | `src/engine/extraction/topology_producer.py:146` | 3 | unique |
| `CheckResult` | class | `src/engine/forensics/compile_fidelity.py:98` | 3 | unique |
| `run_leg_a` | function | `src/engine/forensics/compile_fidelity.py:859` | 3 | unique |
| `run_prop_compliance` | function | `src/engine/prop_compliance.py:232` | 3 | unique |
| `compute_rl_kill_switch_state` | function | `src/engine/quantum_rl_agent.py:2098` | 3 | unique |
| `emitArchetypeEvaluatorFailed` | function | `src/server/lib/archetype-routing-observability.ts:266` | 3 | unique |
| `emitArchetypeSignalReceived` | function | `src/server/lib/archetype-routing-observability.ts:182` | 3 | unique |
| `emitArchetypeSignalResolved` | function | `src/server/lib/archetype-routing-observability.ts:217` | 3 | unique |
| `_resetUsedConfirmations` | function | `src/server/lib/carter/carter-confirm.ts:74` | 3 | unique |
| `BIDIR_SENTINEL` | const | `src/server/lib/fade-inverter.ts:44` | 3 | unique |
| `registerStrategiesInPlaybook` | function | `src/server/lib/playbook-registration.ts:287` | 3 | unique |
| `_resetCircuitBreakerForTests` | function | `src/server/lib/quantum-replay-runner.ts:244` | 3 | unique |
| `checkPurgeViolation` | function | `src/server/lib/replay/quantum-disagreement.ts:319` | 3 | unique |
| `EQUAL_WEIGHTS` | const | `src/server/lib/score-normalization.ts:115` | 3 | unique |
| `__resetDslCriticBudgetForTests` | function | `src/server/services/agent-service.ts:135` | 3 | unique |
| `_invalidateConsistencyCache` | function | `src/server/services/consistency-tracker-service.ts:736` | 3 | unique |
| `__resetCorrelationMatrixForTests` | function | `src/server/services/correlated-position-guard.ts:132` | 3 | unique |
| `__injectEquitySamplesForTests` | function | `src/server/services/dd-velocity-gate.ts:309` | 3 | unique |
| `__resetEquityWindowsForTests` | function | `src/server/services/dd-velocity-gate.ts:292` | 3 | unique |
| `__resetInternalsForTests` | function | `src/server/services/market-internals-service.ts:274` | 3 | unique |
| `__getOllamaHealthyForTests` | function | `src/server/services/model-router.ts:418` | 3 | unique |
| `__resetEnabledFirmsCache` | function | `src/server/services/strategy-assignment-service.ts:197` | 3 | unique |
| `_result` | function | `src/engine/anti_setups/regime_filter.py:156` | 2 | unique |
| `PassageLedger` | class | `src/engine/battery/passage_ledger.py:137` | 2 | unique |
| `list_patterns` | function | `src/engine/compiler/pattern_library.py:233` | 2 | unique |
| `naive_leaky_slice` | function | `src/engine/context/htf_availability.py:73` | 2 | unique |
| `Tier3Verdict` | class | `src/engine/extraction/cert_assembler.py:72` | 2 | unique |
| `RealExtractorError` | class | `src/engine/extraction/extractor_bridge.py:75` | 2 | unique |
| `_build_tier3_packet` | function | `src/engine/extraction/pilot_conveyor.py:961` | 2 | unique |
| `blinding_leak_scan` | function | `src/engine/extraction/pilot_conveyor.py:670` | 2 | unique |
| `finalize_certificate` | function | `src/engine/extraction/pilot_conveyor.py:1502` | 2 | unique |
| `prepare_strategy` | function | `src/engine/extraction/pilot_conveyor.py:1133` | 2 | unique |
| `_rater_output_contract` | function | `src/engine/extraction/sealed_read_driver.py:2662` | 2 | unique |
| `run_verdict_stage` | function | `src/engine/extraction/sealed_read_driver.py:3225` | 2 | unique |
| `verify_sealed_manifest` | function | `src/engine/extraction/sealed_read_gate.py:94` | 2 | unique |
| `coverage` | function | `src/engine/extraction/tier1_coverage_report.py:86` | 2 | unique |
| `run_tier1` | function | `src/engine/extraction/tier1_detectors.py:586` | 2 | unique |
| `LegAInputs` | class | `src/engine/forensics/calibration_battery.py:57` | 2 | unique |
| `MutationCase` | class | `src/engine/forensics/calibration_battery.py:73` | 2 | unique |
| `A14ConditioningVector` | class | `src/engine/nemo_a14_bridge.py:24` | 2 | unique |
| `nemo_to_a14_conditioning` | function | `src/engine/nemo_a14_bridge.py:77` | 2 | unique |
| `refused_state` | function | `src/engine/opening_range_definition.py:253` | 2 | unique |
| `lower_opening_range_definition` | function | `src/engine/opening_range_lowering.py:367` | 2 | unique |
| `rank_firms_for_strategy` | function | `src/engine/prop_compliance.py:372` | 2 | unique |
| `should_strategy_trade` | function | `src/engine/regime.py:138` | 2 | unique |
| `is_in_lunch_blackout` | function | `src/engine/session_windows.py:177` | 2 | unique |
| `collect_premarket_signals` | function | `src/engine/skip_engine/premarket_analyzer.py:77` | 2 | unique |
| `StrategyRowForBackfill` | interface | `src/server/lib/playbook-registration-backfill.ts:43` | 2 | unique |
| `classifyStrategyForBackfill` | function | `src/server/lib/playbook-registration-backfill.ts:92` | 2 | unique |
| `readAllRegisteredNames` | function | `src/server/lib/playbook-registration.ts:248` | 2 | unique |
| `buildLegacyProvenanceStamp` | function | `src/server/lib/provenance-stamp.ts:364` | 2 | unique |
| `buildProvenanceStamp` | function | `src/server/lib/provenance-stamp.ts:263` | 2 | unique |
| `_resetRlCircuitBreakerForTests` | function | `src/server/lib/quantum-rl-training-runner.ts:257` | 2 | unique |
| `ConfluenceReplayRow` | interface | `src/server/lib/replay/confluence-disagreement.ts:97` | 2 | unique |
| `evaluateConfluenceDisagreement` | function | `src/server/lib/replay/confluence-disagreement.ts:400` | 2 | unique |
| `checkCpcvPurge` | function | `src/server/lib/replay/harness-base.ts:179` | 2 | unique |
| `MIN_FOLDS_FOR_FULL_ANALYSIS` | const | `src/server/lib/replay/quantum-disagreement.ts:29` | 2 | unique |
| `applyDecisionRule` | function | `src/server/lib/replay/quantum-disagreement.ts:390` | 2 | unique |
| `binomialTestPValue` | function | `src/server/lib/replay/quantum-disagreement.ts:245` | 2 | unique |
| `SUPPORTED_FIRMS` | const | `src/server/lib/replay/survival-twin-disagreement.ts:49` | 2 | unique |
| `MIN_AVAILABLE_FOR_COMPOSITE` | const | `src/server/lib/score-normalization.ts:66` | 2 | unique |
| `computeComposite` | function | `src/server/lib/score-normalization.ts:398` | 2 | unique |
| `DEFAULT_MIN_SAMPLE` | const | `src/server/lib/shadow-evidence-analyzer.ts:118` | 2 | unique |
| `analyzeShadowEvidence` | function | `src/server/lib/shadow-evidence-analyzer.ts:131` | 2 | unique |
| `assembleDeployReady` | function | `src/server/lib/slumhouse/menu-data.ts:120` | 2 | unique |
| `assembleGraveyardMenu` | function | `src/server/lib/slumhouse/menu-data.ts:144` | 2 | unique |
| `assembleKitchenMenu` | function | `src/server/lib/slumhouse/menu-data.ts:127` | 2 | unique |
| `assembleNowServing` | function | `src/server/lib/slumhouse/menu-data.ts:106` | 2 | unique |
| `_getForceCloseInFlightForTests` | function | `src/server/production/kill-switch.ts:1549` | 2 | unique |
| `_setForceCloseInFlightForTests` | function | `src/server/production/kill-switch.ts:1531` | 2 | unique |
| `__injectInternalsReading` | function | `src/server/services/market-internals-service.ts:287` | 2 | unique |
| `__resetCalendarCacheForTests` | function | `src/server/services/paper-execution-service.ts:380` | 2 | unique |
| `__resetDailyLossCacheForTests` | function | `src/server/services/paper-risk-gate.ts:135` | 2 | unique |
| `__collectVariantMetricsForTest` | const | `src/server/services/prompt-evolution-service.ts:843` | 2 | unique |
| `computeSurvivalProbability` | function | `src/server/services/prop-firm-survival-service.ts:307` | 2 | unique |
| `runDrainStallCheck` | function | `src/server/services/scout-watchdog-service.ts:158` | 2 | unique |
| `runRejectDistributionCheck` | function | `src/server/services/scout-watchdog-service.ts:350` | 2 | unique |
| `runRejectSpikeCheck` | function | `src/server/services/scout-watchdog-service.ts:442` | 2 | unique |
| `runStrategyProductionCheck` | function | `src/server/services/strategy-production-check-service.ts:23` | 2 | unique |
| `_resetActiveCount` | function | `src/server/services/trade-critique-service.ts:113` | 2 | unique |
| `isUnconfiguredSlumdawgSecret` | function | `src/server/slumdawg-hmac.ts:45` | 2 | unique |
| `verifySlumdawgHmac` | function | `src/server/slumdawg-hmac.ts:90` | 2 | unique |
| `buildS3Key` | function | `src/data/loaders/s3-client.ts:44` | 1 | unique |
| `parseS3Key` | function | `src/data/loaders/s3-client.ts:53` | 1 | unique |
| `fetch_all_bls` | function | `src/data/macro/bls_client.py:183` | 1 | unique |
| `fetch_bls_series` | function | `src/data/macro/bls_client.py:80` | 1 | unique |
| `fetch_all_eia` | function | `src/data/macro/eia_client.py:163` | 1 | unique |
| `fetch_eia_series` | function | `src/data/macro/eia_client.py:89` | 1 | unique |
| `event_proximity` | function | `src/data/macro/event_calendar.py:132` | 1 | unique |
| `get_upcoming_events` | function | `src/data/macro/event_calendar.py:105` | 1 | unique |
| `fetch_all_macro` | function | `src/data/macro/fred_client.py:139` | 1 | unique |
| `fetch_series` | function | `src/data/macro/fred_client.py:72` | 1 | unique |
| `get_latest_values` | function | `src/data/macro/fred_client.py:182` | 1 | unique |
| `classify_macro_regime` | function | `src/data/macro/macro_tagger.py:109` | 1 | unique |
| `tag_bars` | function | `src/data/macro/macro_tagger.py:234` | 1 | unique |
| `composite_regime` | function | `src/data/macro/regime_graph.py:109` | 1 | unique |
| `complete_sync_job` | function | `src/data/scripts/_data_sync_tracking.py:113` | 1 | unique |
| `fail_sync_job` | function | `src/data/scripts/_data_sync_tracking.py:176` | 1 | unique |
| `start_sync_job` | function | `src/data/scripts/_data_sync_tracking.py:63` | 1 | unique |
| `detect_roll_dates` | function | `src/data/scripts/adjust_continuous.py:22` | 1 | unique |
| `panama_adjust` | function | `src/data/scripts/adjust_continuous.py:96` | 1 | unique |
| `ratio_adjust` | function | `src/data/scripts/adjust_continuous.py:62` | 1 | unique |
| `_migrate_legacy_flat_cache` | function | `src/data/scripts/refresh_local_cache.py:106` | 1 | unique |
| `_write_refresh_sidecar` | function | `src/data/scripts/refresh_local_cache.py:291` | 1 | unique |
| `get_parquet_path` | function | `src/data/scripts/refresh_local_cache.py:98` | 1 | unique |
| `resample_1m_to_tf` | function | `src/data/scripts/refresh_local_cache.py:147` | 1 | unique |
| `is_layer_disabled` | function | `src/engine/ablation_layers.py:53` | 1 | unique |
| `backtest_with_filters` | function | `src/engine/anti_setups/anti_setup_backtest.py:12` | 1 | unique |
| `cluster_losing_conditions` | function | `src/engine/anti_setups/condition_analyzer.py:9` | 1 | unique |
| `archetype_distribution` | function | `src/engine/archetypes/historical_labeler.py:19` | 1 | unique |
| `label_history` | function | `src/engine/archetypes/historical_labeler.py:8` | 1 | unique |
| `map_strategy_to_archetypes` | function | `src/engine/archetypes/strategy_mapper.py:10` | 1 | unique |
| `MappingSchemaError` | class | `src/engine/battery/mapping_guard.py:24` | 1 | unique |
| `_print_boundary` | function | `src/engine/battery/selection_deflation.py:198` | 1 | unique |
| `run_selection_deflation_check` | function | `src/engine/battery/selection_deflation.py:115` | 1 | unique |
| `undispositioned_gaps` | function | `src/engine/battery/tooth2.py:25` | 1 | unique |
| `get_pattern` | function | `src/engine/compiler/pattern_library.py:190` | 1 | unique |
| `check_correlated_position_guard` | function | `src/engine/compliance/compliance_gate.py:777` | 1 | unique |
| `RunReceipt` | class | `src/engine/config.py:698` | 1 | unique |
| `resolve_contract_spec` | function | `src/engine/config.py:167` | 1 | unique |
| `HmmRegimeModel` | class | `src/engine/context/hmm_regime.py:55` | 1 | unique |
| `_label_to_prob_key` | function | `src/engine/context/hmm_regime.py:269` | 1 | unique |
| `_uniform_probs` | function | `src/engine/context/hmm_regime.py:278` | 1 | unique |
| `evaluate_hmm_agreement` | function | `src/engine/context/hmm_regime.py:298` | 1 | unique |
| `fit_hmm_regimes` | function | `src/engine/context/hmm_regime.py:120` | 1 | unique |
| `rule_label_to_hmm_key` | function | `src/engine/context/hmm_regime.py:283` | 1 | unique |
| `build_s3_glob` | function | `src/engine/data_loader.py:320` | 1 | unique |
| `resample_daily_to_weekly` | function | `src/engine/data_loader.py:1212` | 1 | unique |
| `evaluate_decay_gate` | function | `src/engine/decay/decay_gate.py:67` | 1 | unique |
| `assert_deterministic` | function | `src/engine/determinism.py:171` | 1 | unique |
| `_warn_if_calendar_incomplete` | function | `src/engine/economic_calendar.py:1058` | 1 | unique |
| `generate_size_reduction` | function | `src/engine/economic_calendar.py:1268` | 1 | unique |
| `compare_normal_vs_evt` | function | `src/engine/evt_tail.py:115` | 1 | unique |
| `validate_style_c_base_contracts` | function | `src/engine/exits/style_c_handler.py:39` | 1 | unique |
| `_resolves_as_anchor` | function | `src/engine/extraction/anchor_locator.py:211` | 1 | unique |
| `_verify_and_locate` | function | `src/engine/extraction/anchor_locator.py:225` | 1 | unique |
| `locate_anchor` | function | `src/engine/extraction/anchor_locator.py:259` | 1 | unique |
| `ConditionTopology` | class | `src/engine/extraction/cert_assembler.py:89` | 1 | unique |
| `_condition_entry` | function | `src/engine/extraction/cert_assembler.py:119` | 1 | unique |
| `CompiledSpine` | class | `src/engine/extraction/compile_lints.py:135` | 1 | unique |
| `SpineCondition` | class | `src/engine/extraction/compile_lints.py:117` | 1 | unique |
| `causality_lint` | function | `src/engine/extraction/compile_lints.py:371` | 1 | unique |
| `direction_conflation_lint` | function | `src/engine/extraction/compile_lints.py:202` | 1 | unique |
| `f2_coverage_gate` | function | `src/engine/extraction/compile_lints.py:333` | 1 | unique |
| `or_alternatives_honored` | function | `src/engine/extraction/compile_lints.py:292` | 1 | unique |
| `unsat_sat_check` | function | `src/engine/extraction/compile_lints.py:253` | 1 | unique |
| `enumeration_consistency_check` | function | `src/engine/extraction/enumeration_consistency.py:109` | 1 | unique |
| `ScreenResult` | class | `src/engine/extraction/enumeration_guard.py:58` | 1 | unique |
| `evaluate_guard1` | function | `src/engine/extraction/enumeration_guard.py:91` | 1 | unique |
| `screen_enumeration_count` | function | `src/engine/extraction/enumeration_guard.py:64` | 1 | unique |
| `EnumeratorError` | class | `src/engine/extraction/extractor_bridge.py:83` | 1 | unique |
| `build_phase_b_scope` | function | `src/engine/extraction/extractor_bridge.py:215` | 1 | unique |
| `get_or_extract` | function | `src/engine/extraction/extractor_bridge.py:368` | 1 | unique |
| `invoke_real_extractor` | function | `src/engine/extraction/extractor_bridge.py:89` | 1 | unique |
| `load_cached_extraction` | function | `src/engine/extraction/extractor_bridge.py:333` | 1 | unique |
| `run_two_phase_extraction` | function | `src/engine/extraction/extractor_bridge.py:227` | 1 | unique |
| `save_extraction` | function | `src/engine/extraction/extractor_bridge.py:343` | 1 | unique |
| `LeakScanFailure` | class | `src/engine/extraction/pilot_conveyor.py:663` | 1 | unique |
| `SpineConditionText` | class | `src/engine/extraction/pilot_conveyor.py:292` | 1 | unique |
| `content_tokens` | function | `src/engine/extraction/pilot_conveyor.py:417` | 1 | unique |
| `extract_spine_condition_texts` | function | `src/engine/extraction/pilot_conveyor.py:303` | 1 | unique |
| `extractor_anchor_availability_report` | function | `src/engine/extraction/pilot_conveyor.py:496` | 1 | unique |
| `extractor_version_pin` | function | `src/engine/extraction/pilot_conveyor.py:538` | 1 | unique |
| `fetch_transcript` | function | `src/engine/extraction/pilot_conveyor.py:1104` | 1 | unique |
| `locate_condition_anchors` | function | `src/engine/extraction/pilot_conveyor.py:459` | 1 | unique |
| `prepare_video` | function | `src/engine/extraction/pilot_conveyor.py:1315` | 1 | unique |
| `run_dry_run_synthetic` | function | `src/engine/extraction/pilot_conveyor.py:1811` | 1 | unique |
| `support_verdict_from_stage2_response` | function | `src/engine/extraction/pilot_conveyor.py:1398` | 1 | unique |
| `verdict_from_rater_response` | function | `src/engine/extraction/pilot_conveyor.py:1354` | 1 | unique |
| `write_dry_run_artifact` | function | `src/engine/extraction/pilot_conveyor.py:1869` | 1 | unique |
| `ArtifactsMissingError` | class | `src/engine/extraction/sealed_read_driver.py:166` | 1 | unique |
| `ExtractionNotReady` | class | `src/engine/extraction/sealed_read_driver.py:1255` | 1 | unique |
| `ExtractionSourceMissing` | class | `src/engine/extraction/sealed_read_driver.py:176` | 1 | unique |
| `RaterLayerNotReady` | class | `src/engine/extraction/sealed_read_driver.py:1987` | 1 | unique |
| `ReaderIdentityMismatch` | class | `src/engine/extraction/sealed_read_driver.py:182` | 1 | unique |
| `RehearsalManifestMismatch` | class | `src/engine/extraction/sealed_read_driver.py:3455` | 1 | unique |
| `SealedReadDriver` | class | `src/engine/extraction/sealed_read_driver.py:1610` | 1 | unique |
| `VerdictNotReady` | class | `src/engine/extraction/sealed_read_driver.py:2950` | 1 | unique |
| `_collect_phase_a_draws` | function | `src/engine/extraction/sealed_read_driver.py:815` | 1 | unique |
| `_dispatch_phase_b` | function | `src/engine/extraction/sealed_read_driver.py:904` | 1 | unique |
| `_dispatch_two_stage_packet` | function | `src/engine/extraction/sealed_read_driver.py:2104` | 1 | unique |
| `_draw_refs` | function | `src/engine/extraction/sealed_read_driver.py:805` | 1 | unique |
| `_enum_stability` | function | `src/engine/extraction/sealed_read_driver.py:519` | 1 | unique |
| `_stage1_view` | function | `src/engine/extraction/sealed_read_driver.py:2034` | 1 | unique |
| `_stage_receipts` | function | `src/engine/extraction/sealed_read_driver.py:3539` | 1 | unique |
| `_write_spent_rehearsal_manifest` | function | `src/engine/extraction/sealed_read_driver.py:3466` | 1 | unique |
| `assert_dispatch_identity` | function | `src/engine/extraction/sealed_read_driver.py:396` | 1 | unique |
| `assert_reader_identity` | function | `src/engine/extraction/sealed_read_driver.py:347` | 1 | unique |
| `classify_source_attrition` | function | `src/engine/extraction/sealed_read_driver.py:2807` | 1 | unique |
| `rehearsal_drift_guard` | function | `src/engine/extraction/sealed_read_driver.py:3624` | 1 | unique |
| `rehearsal_instrument_shas` | function | `src/engine/extraction/sealed_read_driver.py:3605` | 1 | unique |
| `require_artifacts_on_disk` | function | `src/engine/extraction/sealed_read_driver.py:610` | 1 | unique |
| `run_extraction_stage` | function | `src/engine/extraction/sealed_read_driver.py:1029` | 1 | unique |
| `run_full_dress_rehearsal` | function | `src/engine/extraction/sealed_read_driver.py:3781` | 1 | unique |
| `run_panels_and_certify_stage` | function | `src/engine/extraction/sealed_read_driver.py:1500` | 1 | unique |
| `run_rater_layer_stage` | function | `src/engine/extraction/sealed_read_driver.py:2227` | 1 | unique |
| `SpentManifestRejected` | class | `src/engine/extraction/sealed_read_gate.py:66` | 1 | unique |
| `gate_sealed_read` | function | `src/engine/extraction/sealed_read_gate.py:249` | 1 | unique |
| `operator_gate` | function | `src/engine/extraction/sealed_read_gate.py:213` | 1 | unique |
| `reject_if_spent16` | function | `src/engine/extraction/sealed_read_gate.py:181` | 1 | unique |
| `verify_transcripts_present` | function | `src/engine/extraction/sealed_read_gate.py:155` | 1 | unique |
| `RecordCompileResult` | class | `src/engine/extraction/spec_producer.py:871` | 1 | unique |
| `_approximation_metrics` | function | `src/engine/extraction/spec_producer.py:698` | 1 | unique |
| `_classify_family` | function | `src/engine/extraction/spec_producer.py:356` | 1 | unique |
| `_family_evidence` | function | `src/engine/extraction/spec_producer.py:264` | 1 | unique |
| `_spec_role` | function | `src/engine/extraction/spec_producer.py:558` | 1 | unique |
| `_untaught_exit` | function | `src/engine/extraction/spec_producer.py:436` | 1 | unique |
| `dispose_inventory` | function | `src/engine/extraction/spec_producer.py:783` | 1 | unique |
| `materialize_sets` | function | `src/engine/extraction/tier1_coverage_report.py:52` | 1 | unique |
| `run_layer_reliability` | function | `src/engine/extraction/tier1_coverage_report.py:142` | 1 | unique |
| `Tier1FallThrough` | class | `src/engine/extraction/tier1_detectors.py:76` | 1 | unique |
| `ConditionEntry` | class | `src/engine/extraction/topology_producer.py:87` | 1 | unique |
| `enforcement_status` | function | `src/engine/family_meta_enforcement.py:536` | 1 | unique |
| `reset_enforcement_cache` | function | `src/engine/family_meta_enforcement.py:613` | 1 | unique |
| `compute_fill_probabilities` | function | `src/engine/fill_model.py:70` | 1 | unique |
| `get_payout_cap` | function | `src/engine/firm_config.py:275` | 1 | unique |
| `compute_firm_rules_version_from_dicts` | function | `src/engine/firm_rules_version.py:73` | 1 | unique |
| `run_calibration` | function | `src/engine/forensics/calibration_battery.py:215` | 1 | unique |
| `Phase1Seal` | class | `src/engine/forensics/compile_fidelity.py:133` | 1 | unique |
| `_cert_key_invalid` | function | `src/engine/forensics/compile_fidelity.py:570` | 1 | unique |
| `_has_visible_content` | function | `src/engine/forensics/compile_fidelity.py:255` | 1 | unique |
| `_is_default_ignorable` | function | `src/engine/forensics/compile_fidelity.py:245` | 1 | unique |
| `countersign_phase2` | function | `src/engine/forensics/compile_fidelity.py:809` | 1 | unique |
| `get_config` | function | `src/engine/governor/governor_config.py:50` | 1 | unique |
| `SessionTracker` | class | `src/engine/governor/session_tracker.py:8` | 1 | unique |
| `tag_failure` | function | `src/engine/graveyard/failure_tagger.py:103` | 1 | unique |
| `corpse_check` | function | `src/engine/graveyard/graveyard_gate.py:7` | 1 | unique |
| `compute_multi_htf_indicators` | function | `src/engine/indicators/core.py:806` | 1 | unique |
| `auto_swing_fib` | function | `src/engine/indicators/fibonacci.py:93` | 1 | unique |
| `detect_raid` | function | `src/engine/indicators/liquidity.py:293` | 1 | unique |
| `compute_equilibrium` | function | `src/engine/indicators/market_structure.py:272` | 1 | unique |
| `join_n_timeframes_to_exec` | function | `src/engine/indicators/mtf_join.py:139` | 1 | unique |
| `detect_propulsion` | function | `src/engine/indicators/order_flow.py:370` | 1 | unique |
| `compute_consequent_encroachment` | function | `src/engine/indicators/price_delivery.py:108` | 1 | unique |
| `detect_opening_gap` | function | `src/engine/indicators/price_delivery.py:194` | 1 | unique |
| `ascii_profile` | function | `src/engine/indicators/profile_shape_classifier.py:210` | 1 | unique |
| `day_of_week_profile` | function | `src/engine/indicators/sessions.py:148` | 1 | unique |
| `quarterly_theory` | function | `src/engine/indicators/sessions.py:169` | 1 | unique |
| `dxy_eurusd_smt` | function | `src/engine/indicators/smt.py:189` | 1 | unique |
| `es_nq_smt` | function | `src/engine/indicators/smt.py:184` | 1 | unique |
| `compute_session_shape_score_from_bars` | function | `src/engine/indicators/volume_profile.py:657` | 1 | unique |
| `MacroObservation` | class | `src/engine/macro_data/fred_ingestion.py:46` | 1 | unique |
| `compute_rrp_tga_stress_signal` | function | `src/engine/macro_data/h41_ingestion.py:111` | 1 | unique |
| `compute_auction_stress_signal` | function | `src/engine/macro_data/treasury_auction_ingestion.py:155` | 1 | unique |
| `build_feature_matrix` | function | `src/engine/macro_regime_classifier.py:77` | 1 | unique |
| `classify_daily_regime` | function | `src/engine/macro_regime_classifier.py:303` | 1 | unique |
| `check_hard_gates` | function | `src/engine/macro_regime_fusion.py:174` | 1 | unique |
| `compute_fomc_size_reduction` | function | `src/engine/macro_regime_fusion.py:145` | 1 | unique |
| `fuse_macro_deepar` | function | `src/engine/macro_regime_fusion.py:29` | 1 | unique |
| `multi_asset_correlation_enabled` | function | `src/engine/mc_multi_asset.py:47` | 1 | unique |
| `regime_aware_bootstrap_enabled` | function | `src/engine/mc_regime_resampling.py:54` | 1 | unique |
| `batch_nemo_to_a14` | function | `src/engine/nemo_a14_bridge.py:110` | 1 | unique |
| `build_null_calibration_labels` | function | `src/engine/null_calibration_guard.py:34` | 1 | unique |
| `is_null_calibration_row` | function | `src/engine/null_calibration_guard.py:101` | 1 | unique |
| `validate_null_calibration_labels` | function | `src/engine/null_calibration_guard.py:63` | 1 | unique |
| `build_execution_instances` | function | `src/engine/opening_range_execution_fanout.py:53` | 1 | unique |
| `OpeningRangeLoweringDisposition` | class | `src/engine/opening_range_lowering.py:74` | 1 | unique |
| `OpeningRangeSourceRefusal` | class | `src/engine/opening_range_lowering.py:297` | 1 | unique |
| `run_b15_ablation` | function | `src/engine/parameter_jitter_battery.py:625` | 1 | unique |
| `check_ffn_express_consistency` | function | `src/engine/prop_compliance.py:172` | 1 | unique |
| `compare_vs_optuna` | function | `src/engine/quantum_annealing_optimizer.py:311` | 1 | unique |
| `decode_solution` | function | `src/engine/quantum_annealing_optimizer.py:306` | 1 | unique |
| `BenchmarkResult` | class | `src/engine/quantum_bench.py:28` | 1 | unique |
| `ToleranceConfig` | class | `src/engine/quantum_bench.py:21` | 1 | unique |
| `benchmark_against_classical` | function | `src/engine/quantum_bench.py:46` | 1 | unique |
| `build_reproducibility_hash` | function | `src/engine/quantum_bench.py:113` | 1 | unique |
| `persist_benchmark` | function | `src/engine/quantum_bench.py:119` | 1 | unique |
| `validate_tolerance` | function | `src/engine/quantum_bench.py:108` | 1 | unique |
| `QuantumRunConfig` | class | `src/engine/quantum_mc.py:177` | 1 | unique |
| `run_hybrid_compare` | function | `src/engine/quantum_mc.py:633` | 1 | unique |

_...471 more omitted from this table._

### 7.2 All BUILT-UNREACHABLE, by subsystem

<details><summary><code>src/dashboard/components</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `VALIDATION_CADENCE_PANEL_LIVE_PATH` | const | `src/dashboard/components/ValidationCadencePanel.tsx:18` | no non-test reference outside its own definition |

</details>

<details><summary><code>src/data/fetchers</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `createDatabentoFetcher` | function | `src/data/fetchers/databento.ts:85` | defining module is not reachable from any measured entry point |

</details>

<details><summary><code>src/data/loaders</code> - 3 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `buildS3Key` | function | `src/data/loaders/s3-client.ts:44` | defining module is not reachable from any measured entry point |
| `parseS3Key` | function | `src/data/loaders/s3-client.ts:53` | defining module is not reachable from any measured entry point |
| `createS3Service` | function | `src/data/loaders/s3-client.ts:73` | defining module is not reachable from any measured entry point |

</details>

<details><summary><code>src/data/macro</code> - 26 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `_rate_limit` | function | `src/data/macro/bls_client.py:42` | defining module is not reachable from any measured entry point |
| `_get_api_key` | function | `src/data/macro/bls_client.py:52` | defining module is not reachable from any measured entry point |
| `_bls_period_to_date` | function | `src/data/macro/bls_client.py:57` | defining module is not reachable from any measured entry point |
| `fetch_bls_series` | function | `src/data/macro/bls_client.py:80` | defining module is not reachable from any measured entry point |
| `fetch_all_bls` | function | `src/data/macro/bls_client.py:183` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `_rate_limit` | function | `src/data/macro/eia_client.py:41` | defining module is not reachable from any measured entry point |
| `_get_api_key` | function | `src/data/macro/eia_client.py:51` | defining module is not reachable from any measured entry point |
| `_parse_series_id` | function | `src/data/macro/eia_client.py:62` | no non-test reference outside its own definition |
| `fetch_eia_series` | function | `src/data/macro/eia_client.py:89` | defining module is not reachable from any measured entry point |
| `fetch_all_eia` | function | `src/data/macro/eia_client.py:163` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `_build_event_list` | function | `src/data/macro/event_calendar.py:77` | defining module is not reachable from any measured entry point |
| `get_upcoming_events` | function | `src/data/macro/event_calendar.py:105` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `event_proximity` | function | `src/data/macro/event_calendar.py:132` | defining module is not reachable from any measured entry point |
| `_rate_limit` | function | `src/data/macro/fred_client.py:51` | defining module is not reachable from any measured entry point |
| `_get_api_key` | function | `src/data/macro/fred_client.py:61` | defining module is not reachable from any measured entry point |
| `fetch_series` | function | `src/data/macro/fred_client.py:72` | defining module is not reachable from any measured entry point |
| `fetch_all_macro` | function | `src/data/macro/fred_client.py:139` | defining module is not reachable from any measured entry point |
| `get_latest_values` | function | `src/data/macro/fred_client.py:182` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `_check_threshold` | function | `src/data/macro/macro_tagger.py:68` | defining module is not reachable from any measured entry point |
| `_detect_trend` | function | `src/data/macro/macro_tagger.py:90` | no non-test reference outside its own definition |
| `classify_macro_regime` | function | `src/data/macro/macro_tagger.py:109` | defining module is not reachable from any measured entry point |
| `tag_bars` | function | `src/data/macro/macro_tagger.py:234` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `_determine_alignment` | function | `src/data/macro/regime_graph.py:49` | defining module is not reachable from any measured entry point |
| `_alignment_confidence` | function | `src/data/macro/regime_graph.py:61` | defining module is not reachable from any measured entry point |
| `_recommend_sizing` | function | `src/data/macro/regime_graph.py:86` | defining module is not reachable from any measured entry point |
| `composite_regime` | function | `src/data/macro/regime_graph.py:109` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/data/scripts</code> - 38 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `_get_connection` | function | `src/data/scripts/_data_sync_tracking.py:44` | defining module is not reachable from any measured entry point |
| `start_sync_job` | function | `src/data/scripts/_data_sync_tracking.py:63` | defining module is not reachable from any measured entry point |
| `complete_sync_job` | function | `src/data/scripts/_data_sync_tracking.py:113` | defining module is not reachable from any measured entry point |
| `fail_sync_job` | function | `src/data/scripts/_data_sync_tracking.py:176` | defining module is not reachable from any measured entry point |
| `detect_roll_dates` | function | `src/data/scripts/adjust_continuous.py:22` | defining module is not reachable from any measured entry point |
| `ratio_adjust` | function | `src/data/scripts/adjust_continuous.py:62` | defining module is not reachable from any measured entry point |
| `panama_adjust` | function | `src/data/scripts/adjust_continuous.py:96` | defining module is not reachable from any measured entry point |
| `main` | function | `src/data/scripts/adjust_continuous.py:128` | defining module is not reachable from any measured entry point |
| `get_client` | function | `src/data/scripts/crisis_data_download.py:53` | defining module is not reachable from any measured entry point |
| `check_cost` | function | `src/data/scripts/crisis_data_download.py:62` | defining module is not reachable from any measured entry point |
| `download_period` | function | `src/data/scripts/crisis_data_download.py:78` | defining module is not reachable from any measured entry point |
| `run_pipeline_step` | function | `src/data/scripts/crisis_data_download.py:108` | defining module is not reachable from any measured entry point |
| `process_file` | function | `src/data/scripts/crisis_data_download.py:128` | defining module is not reachable from any measured entry point |
| `main` | function | `src/data/scripts/crisis_data_download.py:188` | defining module is not reachable from any measured entry point |
| `run_step` | function | `src/data/scripts/crisis_pipeline.py:27` | defining module is not reachable from any measured entry point |
| `main` | function | `src/data/scripts/crisis_pipeline.py:40` | defining module is not reachable from any measured entry point |
| `get_client` | function | `src/data/scripts/databento_download.py:48` | defining module is not reachable from any measured entry point |
| `check_cost` | function | `src/data/scripts/databento_download.py:56` | defining module is not reachable from any measured entry point |
| `download` | function | `src/data/scripts/databento_download.py:72` | defining module is not reachable from any measured entry point |
| `main` | function | `src/data/scripts/databento_download.py:115` | defining module is not reachable from any measured entry point |
| `get_cache_dir` | function | `src/data/scripts/refresh_local_cache.py:93` | defining module is not reachable from any measured entry point |
| `get_parquet_path` | function | `src/data/scripts/refresh_local_cache.py:98` | defining module is not reachable from any measured entry point |
| `_migrate_legacy_flat_cache` | function | `src/data/scripts/refresh_local_cache.py:106` | defining module is not reachable from any measured entry point |
| `get_latest_ts` | function | `src/data/scripts/refresh_local_cache.py:125` | defining module is not reachable from any measured entry point |
| `resample_1m_to_tf` | function | `src/data/scripts/refresh_local_cache.py:147` | defining module is not reachable from any measured entry point |
| `fetch_1m_bars` | function | `src/data/scripts/refresh_local_cache.py:212` | defining module is not reachable from any measured entry point |
| `atomic_write_parquet` | function | `src/data/scripts/refresh_local_cache.py:283` | defining module is not reachable from any measured entry point |
| `_write_refresh_sidecar` | function | `src/data/scripts/refresh_local_cache.py:291` | defining module is not reachable from any measured entry point |
| `refresh_symbol_timeframe` | function | `src/data/scripts/refresh_local_cache.py:319` | defining module is not reachable from any measured entry point |
| `main` | function | `src/data/scripts/refresh_local_cache.py:608` | defining module is not reachable from any measured entry point |
| `resample` | function | `src/data/scripts/resample_timeframes.py:30` | defining module is not reachable from any measured entry point |
| `main` | function | `src/data/scripts/resample_timeframes.py:46` | defining module is not reachable from any measured entry point |
| `run_script` | function | `src/data/scripts/run_pipeline.py:22` | defining module is not reachable from any measured entry point |
| `main` | function | `src/data/scripts/run_pipeline.py:46` | defining module is not reachable from any measured entry point |
| `get_s3_client` | function | `src/data/scripts/upload_to_s3.py:23` | defining module is not reachable from any measured entry point |
| `upload_partitioned` | function | `src/data/scripts/upload_to_s3.py:32` | defining module is not reachable from any measured entry point |
| `upload_json` | function | `src/data/scripts/upload_to_s3.py:81` | defining module is not reachable from any measured entry point |
| `main` | function | `src/data/scripts/upload_to_s3.py:89` | defining module is not reachable from any measured entry point |

</details>

<details><summary><code>src/engine/ablation_layers.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `is_layer_disabled` | function | `src/engine/ablation_layers.py:53` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/analytics.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `compute_portfolio_correlation` | function | `src/engine/analytics.py:1272` | no non-test reference outside its own definition |

</details>

<details><summary><code>src/engine/anti_setups</code> - 6 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `backtest_with_filters` | function | `src/engine/anti_setups/anti_setup_backtest.py:12` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `cluster_losing_conditions` | function | `src/engine/anti_setups/condition_analyzer.py:9` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `_bin_by_feature` | function | `src/engine/anti_setups/condition_analyzer.py:42` | defining module is not reachable from any measured entry point |
| `check_regime_anti_setup` | function | `src/engine/anti_setups/regime_filter.py:22` | no non-test reference outside its own definition |
| `_count_regime_persistence` | function | `src/engine/anti_setups/regime_filter.py:138` | defining module is not reachable from any measured entry point |
| `_result` | function | `src/engine/anti_setups/regime_filter.py:156` | defining module is not reachable from any measured entry point |

</details>

<details><summary><code>src/engine/archetypes</code> - 3 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `label_history` | function | `src/engine/archetypes/historical_labeler.py:8` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `archetype_distribution` | function | `src/engine/archetypes/historical_labeler.py:19` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `map_strategy_to_archetypes` | function | `src/engine/archetypes/strategy_mapper.py:10` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/backtester.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `shift_higher_tf_columns` | function | `src/engine/backtester.py:2197` | no non-test reference outside its own definition |

</details>

<details><summary><code>src/engine/battery</code> - 17 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `MappingSchemaError` | class | `src/engine/battery/mapping_guard.py:24` | defining module is not reachable from any measured entry point |
| `require` | function | `src/engine/battery/mapping_guard.py:32` | no non-test reference outside its own definition; 16 test file(s) do reference it |
| `GateClass` | class | `src/engine/battery/passage_ledger.py:55` | defining module is not reachable from any measured entry point |
| `_now_iso` | function | `src/engine/battery/passage_ledger.py:119` | defining module is not reachable from any measured entry point |
| `_atomic_write` | function | `src/engine/battery/passage_ledger.py:123` | defining module is not reachable from any measured entry point |
| `PassageLedger` | class | `src/engine/battery/passage_ledger.py:137` | no non-test reference outside its own definition; 2 test file(s) do reference it |
| `_now_iso` | function | `src/engine/battery/selection_deflation.py:59` | defining module is not reachable from any measured entry point |
| `_sha256_file` | function | `src/engine/battery/selection_deflation.py:63` | defining module is not reachable from any measured entry point |
| `_atomic_append_check` | function | `src/engine/battery/selection_deflation.py:76` | defining module is not reachable from any measured entry point |
| `_prior_latched` | function | `src/engine/battery/selection_deflation.py:105` | defining module is not reachable from any measured entry point |
| `run_selection_deflation_check` | function | `src/engine/battery/selection_deflation.py:115` | defining module is not reachable from any measured entry point |
| `_print_boundary` | function | `src/engine/battery/selection_deflation.py:198` | defining module is not reachable from any measured entry point |
| `_main` | function | `src/engine/battery/selection_deflation.py:213` | defining module is not reachable from any measured entry point |
| `undispositioned_gaps` | function | `src/engine/battery/tooth2.py:25` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `_now_iso` | function | `src/engine/battery/trial_counter.py:51` | defining module is not reachable from any measured entry point |
| `_atomic_write` | function | `src/engine/battery/trial_counter.py:55` | defining module is not reachable from any measured entry point |
| `TrialCounter` | class | `src/engine/battery/trial_counter.py:70` | defining module is not reachable from any measured entry point |

</details>

<details><summary><code>src/engine/cache_prewarm.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `prewarm_cache` | function | `src/engine/cache_prewarm.py:45` | defining module is not reachable from any measured entry point |

</details>

<details><summary><code>src/engine/compiler</code> - 2 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `get_pattern` | function | `src/engine/compiler/pattern_library.py:190` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `list_patterns` | function | `src/engine/compiler/pattern_library.py:233` | no non-test reference outside its own definition; 2 test file(s) do reference it |

</details>

<details><summary><code>src/engine/compliance</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `check_correlated_position_guard` | function | `src/engine/compliance/compliance_gate.py:777` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/config.py</code> - 3 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `get_contract_spec` | function | `src/engine/config.py:150` | no non-test reference outside its own definition |
| `resolve_contract_spec` | function | `src/engine/config.py:167` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `RunReceipt` | class | `src/engine/config.py:698` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/context</code> - 10 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `_compute_atr_percentile_from_bars` | function | `src/engine/context/bias_engine.py:87` | no non-test reference outside its own definition |
| `HmmRegimeModel` | class | `src/engine/context/hmm_regime.py:55` | defining module is not reachable from any measured entry point |
| `_build_label_map` | function | `src/engine/context/hmm_regime.py:100` | defining module is not reachable from any measured entry point |
| `fit_hmm_regimes` | function | `src/engine/context/hmm_regime.py:120` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `predict_regime_probabilities` | function | `src/engine/context/hmm_regime.py:211` | defining module is not reachable from any measured entry point |
| `_label_to_prob_key` | function | `src/engine/context/hmm_regime.py:269` | defining module is not reachable from any measured entry point |
| `_uniform_probs` | function | `src/engine/context/hmm_regime.py:278` | defining module is not reachable from any measured entry point |
| `rule_label_to_hmm_key` | function | `src/engine/context/hmm_regime.py:283` | defining module is not reachable from any measured entry point |
| `evaluate_hmm_agreement` | function | `src/engine/context/hmm_regime.py:298` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `naive_leaky_slice` | function | `src/engine/context/htf_availability.py:73` | no non-test reference outside its own definition; 2 test file(s) do reference it |

</details>

<details><summary><code>src/engine/cross_validation.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `determinism_test` | function | `src/engine/cross_validation.py:262` | no non-test reference outside its own definition |

</details>

<details><summary><code>src/engine/data_loader.py</code> - 4 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `build_s3_glob` | function | `src/engine/data_loader.py:320` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `load_with_htf` | function | `src/engine/data_loader.py:1103` | no non-test reference outside its own definition |
| `resample_daily_to_weekly` | function | `src/engine/data_loader.py:1212` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `_third_friday` | function | `src/engine/data_loader.py:1262` | no non-test reference outside its own definition |

</details>

<details><summary><code>src/engine/decay</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `evaluate_decay_gate` | function | `src/engine/decay/decay_gate.py:67` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/deepar_regime_classifier.py</code> - 9 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `RegimeClassification` | class | `src/engine/deepar_regime_classifier.py:41` | defining module is not reachable from any measured entry point |
| `ClassificationResult` | class | `src/engine/deepar_regime_classifier.py:65` | defining module is not reachable from any measured entry point |
| `classify_regime` | function | `src/engine/deepar_regime_classifier.py:102` | defining module is not reachable from any measured entry point |
| `compute_correlation_stress` | function | `src/engine/deepar_regime_classifier.py:180` | defining module is not reachable from any measured entry point |
| `_vol_regime_label` | function | `src/engine/deepar_regime_classifier.py:240` | defining module is not reachable from any measured entry point |
| `_vol_regime_from_prob` | function | `src/engine/deepar_regime_classifier.py:252` | defining module is not reachable from any measured entry point |
| `_trend_label` | function | `src/engine/deepar_regime_classifier.py:264` | defining module is not reachable from any measured entry point |
| `_stress_label` | function | `src/engine/deepar_regime_classifier.py:274` | defining module is not reachable from any measured entry point |
| `main` | function | `src/engine/deepar_regime_classifier.py:286` | defining module is not reachable from any measured entry point |

</details>

<details><summary><code>src/engine/determinism.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `assert_deterministic` | function | `src/engine/determinism.py:171` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/economic_calendar.py</code> - 2 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `_warn_if_calendar_incomplete` | function | `src/engine/economic_calendar.py:1058` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `generate_size_reduction` | function | `src/engine/economic_calendar.py:1268` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/evt_tail.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `compare_normal_vs_evt` | function | `src/engine/evt_tail.py:115` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/exits</code> - 2 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `compute_pre_lunch_decision` | function | `src/engine/exits/adaptive_exits.py:451` | no non-test reference outside its own definition |
| `validate_style_c_base_contracts` | function | `src/engine/exits/style_c_handler.py:39` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/extraction</code> - 267 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `AnchorResult` | class | `src/engine/extraction/anchor_locator.py:76` | defining module is not reachable from any measured entry point |
| `_build_user_message` | function | `src/engine/extraction/anchor_locator.py:126` | defining module is not reachable from any measured entry point |
| `_default_propose_fn` | function | `src/engine/extraction/anchor_locator.py:134` | defining module is not reachable from any measured entry point |
| `_propose_quote` | function | `src/engine/extraction/anchor_locator.py:161` | defining module is not reachable from any measured entry point |
| `_normalize_with_spans` | function | `src/engine/extraction/anchor_locator.py:174` | defining module is not reachable from any measured entry point |
| `_normalize_query` | function | `src/engine/extraction/anchor_locator.py:202` | defining module is not reachable from any measured entry point |
| `_resolves_as_anchor` | function | `src/engine/extraction/anchor_locator.py:211` | defining module is not reachable from any measured entry point |
| `_verify_and_locate` | function | `src/engine/extraction/anchor_locator.py:225` | defining module is not reachable from any measured entry point |
| `locate_anchor` | function | `src/engine/extraction/anchor_locator.py:259` | defining module is not reachable from any measured entry point |
| `Tier3Verdict` | class | `src/engine/extraction/cert_assembler.py:72` | defining module is not reachable from any measured entry point |
| `ConditionTopology` | class | `src/engine/extraction/cert_assembler.py:89` | defining module is not reachable from any measured entry point |
| `Provenance` | class | `src/engine/extraction/cert_assembler.py:104` | defining module is not reachable from any measured entry point |
| `_condition_entry` | function | `src/engine/extraction/cert_assembler.py:119` | defining module is not reachable from any measured entry point |
| `_spine_condition` | function | `src/engine/extraction/cert_assembler.py:138` | defining module is not reachable from any measured entry point |
| `terminal_read_grade` | function | `src/engine/extraction/cert_assembler.py:186` | defining module is not reachable from any measured entry point |
| `assemble_certificate` | function | `src/engine/extraction/cert_assembler.py:299` | defining module is not reachable from any measured entry point |
| `SpineCondition` | class | `src/engine/extraction/compile_lints.py:117` | defining module is not reachable from any measured entry point |
| `CompiledSpine` | class | `src/engine/extraction/compile_lints.py:135` | defining module is not reachable from any measured entry point |
| `LintResult` | class | `src/engine/extraction/compile_lints.py:165` | defining module is not reachable from any measured entry point |
| `direction_conflation_lint` | function | `src/engine/extraction/compile_lints.py:202` | defining module is not reachable from any measured entry point |
| `_parse_comparator` | function | `src/engine/extraction/compile_lints.py:244` | defining module is not reachable from any measured entry point |
| `unsat_sat_check` | function | `src/engine/extraction/compile_lints.py:253` | defining module is not reachable from any measured entry point |
| `or_alternatives_honored` | function | `src/engine/extraction/compile_lints.py:292` | defining module is not reachable from any measured entry point |
| `f2_coverage_gate` | function | `src/engine/extraction/compile_lints.py:333` | defining module is not reachable from any measured entry point |
| `causality_lint` | function | `src/engine/extraction/compile_lints.py:371` | defining module is not reachable from any measured entry point |
| `run_all_lints` | function | `src/engine/extraction/compile_lints.py:449` | defining module is not reachable from any measured entry point |
| `EnumConsistencyResult` | class | `src/engine/extraction/enumeration_consistency.py:59` | defining module is not reachable from any measured entry point |
| `_norm_dir` | function | `src/engine/extraction/enumeration_consistency.py:83` | defining module is not reachable from any measured entry point |
| `_variant_name` | function | `src/engine/extraction/enumeration_consistency.py:90` | defining module is not reachable from any measured entry point |
| `_variant_search_text` | function | `src/engine/extraction/enumeration_consistency.py:98` | defining module is not reachable from any measured entry point |
| `enumeration_consistency_check` | function | `src/engine/extraction/enumeration_consistency.py:109` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `ScreenResult` | class | `src/engine/extraction/enumeration_guard.py:58` | defining module is not reachable from any measured entry point |
| `screen_enumeration_count` | function | `src/engine/extraction/enumeration_guard.py:64` | defining module is not reachable from any measured entry point |
| `Guard1Verdict` | class | `src/engine/extraction/enumeration_guard.py:75` | defining module is not reachable from any measured entry point |
| `evaluate_guard1` | function | `src/engine/extraction/enumeration_guard.py:91` | defining module is not reachable from any measured entry point |
| `RealExtractorError` | class | `src/engine/extraction/extractor_bridge.py:75` | defining module is not reachable from any measured entry point |
| `EnumeratorError` | class | `src/engine/extraction/extractor_bridge.py:83` | defining module is not reachable from any measured entry point |
| `invoke_real_extractor` | function | `src/engine/extraction/extractor_bridge.py:89` | defining module is not reachable from any measured entry point |
| `_run_node_cli_json` | function | `src/engine/extraction/extractor_bridge.py:160` | defining module is not reachable from any measured entry point |
| `build_phase_b_scope` | function | `src/engine/extraction/extractor_bridge.py:215` | defining module is not reachable from any measured entry point |
| `run_two_phase_extraction` | function | `src/engine/extraction/extractor_bridge.py:227` | defining module is not reachable from any measured entry point |
| `invoke_strategy_enumerator` | function | `src/engine/extraction/extractor_bridge.py:300` | defining module is not reachable from any measured entry point |
| `VaultRecord` | class | `src/engine/extraction/extractor_bridge.py:320` | no non-test reference outside its own definition |
| `_vault_path` | function | `src/engine/extraction/extractor_bridge.py:328` | defining module is not reachable from any measured entry point |
| `load_cached_extraction` | function | `src/engine/extraction/extractor_bridge.py:333` | defining module is not reachable from any measured entry point |
| `save_extraction` | function | `src/engine/extraction/extractor_bridge.py:343` | defining module is not reachable from any measured entry point |
| `get_or_extract` | function | `src/engine/extraction/extractor_bridge.py:368` | defining module is not reachable from any measured entry point |
| `run_dry_run_real_extractor` | function | `src/engine/extraction/extractor_bridge.py:414` | defining module is not reachable from any measured entry point |
| `main` | function | `src/engine/extraction/extractor_bridge.py:490` | defining module is not reachable from any measured entry point |
| `SpineConditionText` | class | `src/engine/extraction/pilot_conveyor.py:292` | defining module is not reachable from any measured entry point |
| `extract_spine_condition_texts` | function | `src/engine/extraction/pilot_conveyor.py:303` | defining module is not reachable from any measured entry point |
| `_tier1_surface_signature` | function | `src/engine/extraction/pilot_conveyor.py:355` | defining module is not reachable from any measured entry point |
| `_ts_f2_normalize` | function | `src/engine/extraction/pilot_conveyor.py:400` | defining module is not reachable from any measured entry point |
| `content_tokens` | function | `src/engine/extraction/pilot_conveyor.py:417` | defining module is not reachable from any measured entry point |
| `UnanchoredCondition` | class | `src/engine/extraction/pilot_conveyor.py:441` | defining module is not reachable from any measured entry point |
| `locate_condition_anchors` | function | `src/engine/extraction/pilot_conveyor.py:459` | defining module is not reachable from any measured entry point |
| `extractor_anchor_availability_report` | function | `src/engine/extraction/pilot_conveyor.py:496` | defining module is not reachable from any measured entry point |
| `extractor_version_pin` | function | `src/engine/extraction/pilot_conveyor.py:538` | defining module is not reachable from any measured entry point |
| `LeakScanResult` | class | `src/engine/extraction/pilot_conveyor.py:658` | defining module is not reachable from any measured entry point |
| `LeakScanFailure` | class | `src/engine/extraction/pilot_conveyor.py:663` | defining module is not reachable from any measured entry point |
| `blinding_leak_scan` | function | `src/engine/extraction/pilot_conveyor.py:670` | defining module is not reachable from any measured entry point |
| `_item_json_excluding_quote` | function | `src/engine/extraction/pilot_conveyor.py:822` | defining module is not reachable from any measured entry point |
| `_sections_json_excluding_quotes` | function | `src/engine/extraction/pilot_conveyor.py:836` | defining module is not reachable from any measured entry point |
| `_normalize_ws` | function | `src/engine/extraction/pilot_conveyor.py:854` | defining module is not reachable from any measured entry point |
| `_load_wave1_control_section` | function | `src/engine/extraction/pilot_conveyor.py:870` | defining module is not reachable from any measured entry point |
| `axis3_adjudication_ceiling` | function | `src/engine/extraction/pilot_conveyor.py:892` | defining module is not reachable from any measured entry point |
| `_axis3_seed` | function | `src/engine/extraction/pilot_conveyor.py:910` | defining module is not reachable from any measured entry point |
| `_select_axis3_audit_fire` | function | `src/engine/extraction/pilot_conveyor.py:923` | defining module is not reachable from any measured entry point |
| `_build_tier3_packet` | function | `src/engine/extraction/pilot_conveyor.py:961` | defining module is not reachable from any measured entry point |
| `fetch_transcript` | function | `src/engine/extraction/pilot_conveyor.py:1104` | defining module is not reachable from any measured entry point |
| `prepare_strategy` | function | `src/engine/extraction/pilot_conveyor.py:1133` | defining module is not reachable from any measured entry point |
| `prepare_video` | function | `src/engine/extraction/pilot_conveyor.py:1315` | defining module is not reachable from any measured entry point |
| `verdict_from_rater_response` | function | `src/engine/extraction/pilot_conveyor.py:1354` | defining module is not reachable from any measured entry point |
| `Tier3SupportVerdict` | class | `src/engine/extraction/pilot_conveyor.py:1386` | defining module is not reachable from any measured entry point |
| `support_verdict_from_stage2_response` | function | `src/engine/extraction/pilot_conveyor.py:1398` | defining module is not reachable from any measured entry point |
| `diagnose_certificate` | function | `src/engine/extraction/pilot_conveyor.py:1439` | defining module is not reachable from any measured entry point |
| `finalize_certificate` | function | `src/engine/extraction/pilot_conveyor.py:1502` | defining module is not reachable from any measured entry point |
| `aggregate` | function | `src/engine/extraction/pilot_conveyor.py:1678` | no non-test reference outside its own definition; 3 test file(s) do reference it |
| `_synthetic_dry_run_propose_fn` | function | `src/engine/extraction/pilot_conveyor.py:1794` | defining module is not reachable from any measured entry point |
| `run_dry_run_synthetic` | function | `src/engine/extraction/pilot_conveyor.py:1811` | defining module is not reachable from any measured entry point |
| `write_dry_run_artifact` | function | `src/engine/extraction/pilot_conveyor.py:1869` | defining module is not reachable from any measured entry point |
| `main` | function | `src/engine/extraction/pilot_conveyor.py:1882` | defining module is not reachable from any measured entry point |
| `ArtifactsMissingError` | class | `src/engine/extraction/sealed_read_driver.py:166` | defining module is not reachable from any measured entry point |
| `ExtractionSourceMissing` | class | `src/engine/extraction/sealed_read_driver.py:176` | defining module is not reachable from any measured entry point |
| `ReaderIdentityMismatch` | class | `src/engine/extraction/sealed_read_driver.py:182` | defining module is not reachable from any measured entry point |
| `_sha256_file` | function | `src/engine/extraction/sealed_read_driver.py:198` | defining module is not reachable from any measured entry point |
| `_read_frozen_text` | function | `src/engine/extraction/sealed_read_driver.py:210` | defining module is not reachable from any measured entry point |
| `_read_frozen_model_id` | function | `src/engine/extraction/sealed_read_driver.py:220` | defining module is not reachable from any measured entry point |
| `_read_frozen_k` | function | `src/engine/extraction/sealed_read_driver.py:234` | defining module is not reachable from any measured entry point |
| `_read_frozen_params` | function | `src/engine/extraction/sealed_read_driver.py:246` | defining module is not reachable from any measured entry point |
| `_read_frozen_channel_class` | function | `src/engine/extraction/sealed_read_driver.py:267` | defining module is not reachable from any measured entry point |
| `certified_reader_identity` | function | `src/engine/extraction/sealed_read_driver.py:288` | defining module is not reachable from any measured entry point |
| `assert_reader_identity` | function | `src/engine/extraction/sealed_read_driver.py:347` | defining module is not reachable from any measured entry point |
| `_claimed_reader_identity` | function | `src/engine/extraction/sealed_read_driver.py:370` | defining module is not reachable from any measured entry point |
| `assert_dispatch_identity` | function | `src/engine/extraction/sealed_read_driver.py:396` | defining module is not reachable from any measured entry point |
| `_mode_of` | function | `src/engine/extraction/sealed_read_driver.py:503` | defining module is not reachable from any measured entry point |
| `_enum_stability` | function | `src/engine/extraction/sealed_read_driver.py:519` | defining module is not reachable from any measured entry point |
| `_default_adjudicate` | function | `src/engine/extraction/sealed_read_driver.py:582` | defining module is not reachable from any measured entry point |
| `require_artifacts_on_disk` | function | `src/engine/extraction/sealed_read_driver.py:610` | defining module is not reachable from any measured entry point |
| `_atomic_write` | function | `src/engine/extraction/sealed_read_driver.py:622` | defining module is not reachable from any measured entry point |
| `_load_phase_a` | function | `src/engine/extraction/sealed_read_driver.py:645` | defining module is not reachable from any measured entry point |
| `_load_staging_strategies` | function | `src/engine/extraction/sealed_read_driver.py:658` | defining module is not reachable from any measured entry point |
| `_build_rehearsal_artifact` | function | `src/engine/extraction/sealed_read_driver.py:681` | defining module is not reachable from any measured entry point |
| `_parse_payload` | function | `src/engine/extraction/sealed_read_driver.py:760` | defining module is not reachable from any measured entry point |
| `_assert_one_dispatch` | function | `src/engine/extraction/sealed_read_driver.py:773` | defining module is not reachable from any measured entry point |
| `_draw_count` | function | `src/engine/extraction/sealed_read_driver.py:794` | defining module is not reachable from any measured entry point |
| `_draw_refs` | function | `src/engine/extraction/sealed_read_driver.py:805` | defining module is not reachable from any measured entry point |
| `_collect_phase_a_draws` | function | `src/engine/extraction/sealed_read_driver.py:815` | defining module is not reachable from any measured entry point |
| `_consensus_strategy_refs` | function | `src/engine/extraction/sealed_read_driver.py:840` | defining module is not reachable from any measured entry point |
| `_consensus_strategy_objects` | function | `src/engine/extraction/sealed_read_driver.py:876` | defining module is not reachable from any measured entry point |
| `_project_consensus_scopes` | function | `src/engine/extraction/sealed_read_driver.py:896` | defining module is not reachable from any measured entry point |
| `_dispatch_phase_b` | function | `src/engine/extraction/sealed_read_driver.py:904` | defining module is not reachable from any measured entry point |
| `_build_sealed_artifact` | function | `src/engine/extraction/sealed_read_driver.py:942` | defining module is not reachable from any measured entry point |
| `_video_ids_from_verified` | function | `src/engine/extraction/sealed_read_driver.py:1010` | defining module is not reachable from any measured entry point |
| `run_extraction_stage` | function | `src/engine/extraction/sealed_read_driver.py:1029` | defining module is not reachable from any measured entry point |
| `ExtractionNotReady` | class | `src/engine/extraction/sealed_read_driver.py:1255` | defining module is not reachable from any measured entry point |
| `_load_conflation_verdict` | function | `src/engine/extraction/sealed_read_driver.py:1269` | defining module is not reachable from any measured entry point |
| `_load_enum_verdict` | function | `src/engine/extraction/sealed_read_driver.py:1285` | defining module is not reachable from any measured entry point |
| `_load_completeness_verdict` | function | `src/engine/extraction/sealed_read_driver.py:1310` | defining module is not reachable from any measured entry point |
| `_coerce_conflation` | function | `src/engine/extraction/sealed_read_driver.py:1333` | defining module is not reachable from any measured entry point |
| `_coerce_enum` | function | `src/engine/extraction/sealed_read_driver.py:1340` | defining module is not reachable from any measured entry point |
| `_coerce_completeness` | function | `src/engine/extraction/sealed_read_driver.py:1354` | defining module is not reachable from any measured entry point |
| `_obtain_panels` | function | `src/engine/extraction/sealed_read_driver.py:1368` | defining module is not reachable from any measured entry point |
| `_panel_prepare_output` | function | `src/engine/extraction/sealed_read_driver.py:1414` | defining module is not reachable from any measured entry point |
| `_certify_one_strategy` | function | `src/engine/extraction/sealed_read_driver.py:1443` | defining module is not reachable from any measured entry point |
| `_mechanical_floor_record` | function | `src/engine/extraction/sealed_read_driver.py:1461` | defining module is not reachable from any measured entry point |
| `_strategy_pairs` | function | `src/engine/extraction/sealed_read_driver.py:1478` | defining module is not reachable from any measured entry point |
| `run_panels_and_certify_stage` | function | `src/engine/extraction/sealed_read_driver.py:1500` | defining module is not reachable from any measured entry point |
| `SealedReadDriver` | class | `src/engine/extraction/sealed_read_driver.py:1610` | defining module is not reachable from any measured entry point |
| `RaterLayerNotReady` | class | `src/engine/extraction/sealed_read_driver.py:1987` | defining module is not reachable from any measured entry point |
| `_control_gate` | function | `src/engine/extraction/sealed_read_driver.py:1994` | defining module is not reachable from any measured entry point |
| `_agreed_role` | function | `src/engine/extraction/sealed_read_driver.py:2009` | defining module is not reachable from any measured entry point |
| `_agreed_support` | function | `src/engine/extraction/sealed_read_driver.py:2019` | defining module is not reachable from any measured entry point |
| `_stage1_view` | function | `src/engine/extraction/sealed_read_driver.py:2034` | defining module is not reachable from any measured entry point |
| `_stage2_view` | function | `src/engine/extraction/sealed_read_driver.py:2044` | defining module is not reachable from any measured entry point |
| `_deterministic_rehearsal_rater` | function | `src/engine/extraction/sealed_read_driver.py:2056` | defining module is not reachable from any measured entry point |
| `_load_cached_rater` | function | `src/engine/extraction/sealed_read_driver.py:2085` | defining module is not reachable from any measured entry point |
| `_dispatch_two_stage_packet` | function | `src/engine/extraction/sealed_read_driver.py:2104` | defining module is not reachable from any measured entry point |
| `_normalize_rater_input` | function | `src/engine/extraction/sealed_read_driver.py:2211` | defining module is not reachable from any measured entry point |
| `run_rater_layer_stage` | function | `src/engine/extraction/sealed_read_driver.py:2227` | defining module is not reachable from any measured entry point |
| `_hash_phase_a_draws` | function | `src/engine/extraction/sealed_read_driver.py:2473` | defining module is not reachable from any measured entry point |
| `compute_phase_a_consensus` | function | `src/engine/extraction/sealed_read_driver.py:2487` | defining module is not reachable from any measured entry point |
| `build_panel_requests` | function | `src/engine/extraction/sealed_read_driver.py:2547` | defining module is not reachable from any measured entry point |
| `build_rater_packets` | function | `src/engine/extraction/sealed_read_driver.py:2577` | defining module is not reachable from any measured entry point |
| `_rater_output_contract` | function | `src/engine/extraction/sealed_read_driver.py:2662` | defining module is not reachable from any measured entry point |
| `classify_source_attrition` | function | `src/engine/extraction/sealed_read_driver.py:2807` | defining module is not reachable from any measured entry point |
| `_source_attrition_block` | function | `src/engine/extraction/sealed_read_driver.py:2879` | defining module is not reachable from any measured entry point |
| `_source_attrition_scope_lines` | function | `src/engine/extraction/sealed_read_driver.py:2921` | defining module is not reachable from any measured entry point |
| `VerdictNotReady` | class | `src/engine/extraction/sealed_read_driver.py:2950` | defining module is not reachable from any measured entry point |
| `_normalize_verdict_input` | function | `src/engine/extraction/sealed_read_driver.py:2963` | defining module is not reachable from any measured entry point |
| `_row_is_clean` | function | `src/engine/extraction/sealed_read_driver.py:2976` | defining module is not reachable from any measured entry point |
| `_row_adjudications` | function | `src/engine/extraction/sealed_read_driver.py:2986` | defining module is not reachable from any measured entry point |
| `_row_content_clean` | function | `src/engine/extraction/sealed_read_driver.py:3002` | defining module is not reachable from any measured entry point |
| `_cert_to_video_rollup` | function | `src/engine/extraction/sealed_read_driver.py:3023` | defining module is not reachable from any measured entry point |
| `_economics_rider` | function | `src/engine/extraction/sealed_read_driver.py:3058` | defining module is not reachable from any measured entry point |
| `_content_axis_record` | function | `src/engine/extraction/sealed_read_driver.py:3088` | defining module is not reachable from any measured entry point |
| `_instrument_sha_stamps_verified` | function | `src/engine/extraction/sealed_read_driver.py:3123` | defining module is not reachable from any measured entry point |
| `_element_verified` | function | `src/engine/extraction/sealed_read_driver.py:3144` | defining module is not reachable from any measured entry point |
| `_validity_block` | function | `src/engine/extraction/sealed_read_driver.py:3162` | defining module is not reachable from any measured entry point |
| `_assemble_instrument_stamps` | function | `src/engine/extraction/sealed_read_driver.py:3186` | defining module is not reachable from any measured entry point |
| `run_verdict_stage` | function | `src/engine/extraction/sealed_read_driver.py:3225` | defining module is not reachable from any measured entry point |
| `RehearsalManifestMismatch` | class | `src/engine/extraction/sealed_read_driver.py:3455` | defining module is not reachable from any measured entry point |
| `_write_spent_rehearsal_manifest` | function | `src/engine/extraction/sealed_read_driver.py:3466` | defining module is not reachable from any measured entry point |
| `_write_witness_extraction_artifact` | function | `src/engine/extraction/sealed_read_driver.py:3484` | defining module is not reachable from any measured entry point |
| `_module_d_stage` | function | `src/engine/extraction/sealed_read_driver.py:3501` | defining module is not reachable from any measured entry point |
| `_make_live_call_spies` | function | `src/engine/extraction/sealed_read_driver.py:3518` | defining module is not reachable from any measured entry point |
| `_stage_receipts` | function | `src/engine/extraction/sealed_read_driver.py:3539` | defining module is not reachable from any measured entry point |
| `_per_video_clean_map` | function | `src/engine/extraction/sealed_read_driver.py:3598` | defining module is not reachable from any measured entry point |
| `rehearsal_instrument_shas` | function | `src/engine/extraction/sealed_read_driver.py:3605` | defining module is not reachable from any measured entry point |
| `rehearsal_drift_guard` | function | `src/engine/extraction/sealed_read_driver.py:3624` | defining module is not reachable from any measured entry point |
| `_thread_iyf_witness` | function | `src/engine/extraction/sealed_read_driver.py:3666` | defining module is not reachable from any measured entry point |
| `_thread_fused_witness` | function | `src/engine/extraction/sealed_read_driver.py:3721` | defining module is not reachable from any measured entry point |
| `run_full_dress_rehearsal` | function | `src/engine/extraction/sealed_read_driver.py:3781` | defining module is not reachable from any measured entry point |
| `_iyf_rejected_rows` | function | `src/engine/extraction/sealed_read_driver.py:4049` | defining module is not reachable from any measured entry point |
| `SpentManifestRejected` | class | `src/engine/extraction/sealed_read_gate.py:66` | defining module is not reachable from any measured entry point |
| `_video_ids_sorted` | function | `src/engine/extraction/sealed_read_gate.py:71` | defining module is not reachable from any measured entry point |
| `_recompute_seal_sha` | function | `src/engine/extraction/sealed_read_gate.py:88` | defining module is not reachable from any measured entry point |
| `verify_sealed_manifest` | function | `src/engine/extraction/sealed_read_gate.py:94` | defining module is not reachable from any measured entry point |
| `verify_transcripts_present` | function | `src/engine/extraction/sealed_read_gate.py:155` | defining module is not reachable from any measured entry point |
| `reject_if_spent16` | function | `src/engine/extraction/sealed_read_gate.py:181` | defining module is not reachable from any measured entry point |
| `_token_present` | function | `src/engine/extraction/sealed_read_gate.py:204` | defining module is not reachable from any measured entry point |
| `operator_gate` | function | `src/engine/extraction/sealed_read_gate.py:213` | defining module is not reachable from any measured entry point |
| `gate_sealed_read` | function | `src/engine/extraction/sealed_read_gate.py:249` | defining module is not reachable from any measured entry point |
| `_stem_pattern` | function | `src/engine/extraction/spec_producer.py:235` | defining module is not reachable from any measured entry point |
| `_norm` | function | `src/engine/extraction/spec_producer.py:255` | defining module is not reachable from any measured entry point |
| `_slug` | function | `src/engine/extraction/spec_producer.py:259` | defining module is not reachable from any measured entry point |
| `_family_evidence` | function | `src/engine/extraction/spec_producer.py:264` | defining module is not reachable from any measured entry point |
| `_classify_family` | function | `src/engine/extraction/spec_producer.py:356` | defining module is not reachable from any measured entry point |
| `_direction` | function | `src/engine/extraction/spec_producer.py:423` | defining module is not reachable from any measured entry point |
| `_condition_text` | function | `src/engine/extraction/spec_producer.py:428` | defining module is not reachable from any measured entry point |
| `_untaught_exit` | function | `src/engine/extraction/spec_producer.py:436` | defining module is not reachable from any measured entry point |
| `_anchor_grounds` | function | `src/engine/extraction/spec_producer.py:479` | defining module is not reachable from any measured entry point |
| `_cert_span_for` | function | `src/engine/extraction/spec_producer.py:492` | defining module is not reachable from any measured entry point |
| `_entry_condition` | function | `src/engine/extraction/spec_producer.py:524` | defining module is not reachable from any measured entry point |
| `_spec_role` | function | `src/engine/extraction/spec_producer.py:558` | defining module is not reachable from any measured entry point |
| `produce_spec_artifact` | function | `src/engine/extraction/spec_producer.py:580` | defining module is not reachable from any measured entry point |
| `_spec_hash` | function | `src/engine/extraction/spec_producer.py:693` | defining module is not reachable from any measured entry point |
| `_approximation_metrics` | function | `src/engine/extraction/spec_producer.py:698` | defining module is not reachable from any measured entry point |
| `_all_strings` | function | `src/engine/extraction/spec_producer.py:767` | defining module is not reachable from any measured entry point |
| `dispose_inventory` | function | `src/engine/extraction/spec_producer.py:783` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `RecordCompileResult` | class | `src/engine/extraction/spec_producer.py:871` | defining module is not reachable from any measured entry point |
| `produce_spec_artifact_from_record` | function | `src/engine/extraction/spec_producer.py:959` | no non-test reference outside its own definition; 3 test file(s) do reference it |
| `_opening_range_condition_id` | function | `src/engine/extraction/spec_producer.py:1046` | defining module is not reachable from any measured entry point |
| `materialize_sets` | function | `src/engine/extraction/tier1_coverage_report.py:52` | defining module is not reachable from any measured entry point |
| `_fires_by_family` | function | `src/engine/extraction/tier1_coverage_report.py:75` | defining module is not reachable from any measured entry point |
| `coverage` | function | `src/engine/extraction/tier1_coverage_report.py:86` | defining module is not reachable from any measured entry point |
| `run_birth_gate` | function | `src/engine/extraction/tier1_coverage_report.py:105` | defining module is not reachable from any measured entry point |
| `run_layer_reliability` | function | `src/engine/extraction/tier1_coverage_report.py:142` | defining module is not reachable from any measured entry point |
| `precision_spotcheck` | function | `src/engine/extraction/tier1_coverage_report.py:169` | defining module is not reachable from any measured entry point |
| `build_report` | function | `src/engine/extraction/tier1_coverage_report.py:192` | defining module is not reachable from any measured entry point |
| `main` | function | `src/engine/extraction/tier1_coverage_report.py:237` | defining module is not reachable from any measured entry point |
| `Tier1Detection` | class | `src/engine/extraction/tier1_detectors.py:54` | defining module is not reachable from any measured entry point |
| `Tier1FallThrough` | class | `src/engine/extraction/tier1_detectors.py:76` | defining module is not reachable from any measured entry point |
| `Tier1Result` | class | `src/engine/extraction/tier1_detectors.py:87` | defining module is not reachable from any measured entry point |
| `_ActionMatch` | class | `src/engine/extraction/tier1_detectors.py:178` | defining module is not reachable from any measured entry point |
| `_ActionRe` | class | `src/engine/extraction/tier1_detectors.py:194` | defining module is not reachable from any measured entry point |
| `_clause_bounds` | function | `src/engine/extraction/tier1_detectors.py:252` | defining module is not reachable from any measured entry point |
| `_intent_governs_action` | function | `src/engine/extraction/tier1_detectors.py:268` | defining module is not reachable from any measured entry point |
| `_forecast_trigger` | function | `src/engine/extraction/tier1_detectors.py:287` | defining module is not reachable from any measured entry point |
| `_detect_exclusion_contrast` | function | `src/engine/extraction/tier1_detectors.py:298` | defining module is not reachable from any measured entry point |
| `_pole_anchor_start` | function | `src/engine/extraction/tier1_detectors.py:351` | defining module is not reachable from any measured entry point |
| `_pole_anchor_end` | function | `src/engine/extraction/tier1_detectors.py:364` | defining module is not reachable from any measured entry point |
| `_detect_conditional_action` | function | `src/engine/extraction/tier1_detectors.py:379` | defining module is not reachable from any measured entry point |
| `_detect_imperative` | function | `src/engine/extraction/tier1_detectors.py:464` | defining module is not reachable from any measured entry point |
| `detect_tier1` | function | `src/engine/extraction/tier1_detectors.py:510` | defining module is not reachable from any measured entry point |
| `run_tier1` | function | `src/engine/extraction/tier1_detectors.py:586` | defining module is not reachable from any measured entry point |
| `_load_quote_index` | function | `src/engine/extraction/tier2_design_report.py:60` | defining module is not reachable from any measured entry point |
| `materialize_design` | function | `src/engine/extraction/tier2_design_report.py:74` | defining module is not reachable from any measured entry point |
| `materialize_ambiguous_reference` | function | `src/engine/extraction/tier2_design_report.py:93` | no non-test reference outside its own definition |
| `_CachedGemma` | class | `src/engine/extraction/tier2_design_report.py:113` | defining module is not reachable from any measured entry point |
| `_siblings_for` | function | `src/engine/extraction/tier2_design_report.py:137` | defining module is not reachable from any measured entry point |
| `run_birth_gate` | function | `src/engine/extraction/tier2_design_report.py:142` | defining module is not reachable from any measured entry point |
| `classify_design_pool` | function | `src/engine/extraction/tier2_design_report.py:185` | defining module is not reachable from any measured entry point |
| `tabulate_per_class` | function | `src/engine/extraction/tier2_design_report.py:209` | defining module is not reachable from any measured entry point |
| `_empty` | function | `src/engine/extraction/tier2_design_report.py:237` | defining module is not reachable from any measured entry point |
| `economics` | function | `src/engine/extraction/tier2_design_report.py:242` | defining module is not reachable from any measured entry point |
| `two_path_check` | function | `src/engine/extraction/tier2_design_report.py:260` | defining module is not reachable from any measured entry point |
| `segmentation_is_exact` | function | `src/engine/extraction/tier2_design_report.py:278` | defining module is not reachable from any measured entry point |
| `llm_margin_agreement` | function | `src/engine/extraction/tier2_design_report.py:285` | defining module is not reachable from any measured entry point |
| `build_report` | function | `src/engine/extraction/tier2_design_report.py:322` | defining module is not reachable from any measured entry point |
| `_print_summary` | function | `src/engine/extraction/tier2_design_report.py:357` | defining module is not reachable from any measured entry point |
| `main` | function | `src/engine/extraction/tier2_design_report.py:394` | defining module is not reachable from any measured entry point |
| `class_of` | function | `src/engine/extraction/tier2_discourse.BROKEN-a52-checkpoint.py:77` | defining module is not reachable from any measured entry point |
| `Tier2Decision` | class | `src/engine/extraction/tier2_discourse.BROKEN-a52-checkpoint.py:82` | defining module is not reachable from any measured entry point |
| `segment_frame` | function | `src/engine/extraction/tier2_discourse.BROKEN-a52-checkpoint.py:231` | defining module is not reachable from any measured entry point |
| `is_rule_or_exclusion_frame` | function | `src/engine/extraction/tier2_discourse.BROKEN-a52-checkpoint.py:262` | defining module is not reachable from any measured entry point |
| `_build_user_message` | function | `src/engine/extraction/tier2_discourse.BROKEN-a52-checkpoint.py:369` | defining module is not reachable from any measured entry point |
| `_derive_label` | function | `src/engine/extraction/tier2_discourse.BROKEN-a52-checkpoint.py:385` | defining module is not reachable from any measured entry point |
| `gemma_classify_call` | function | `src/engine/extraction/tier2_discourse.BROKEN-a52-checkpoint.py:406` | defining module is not reachable from any measured entry point |
| `classify_item` | function | `src/engine/extraction/tier2_discourse.BROKEN-a52-checkpoint.py:449` | defining module is not reachable from any measured entry point |
| `ConceptPass` | class | `src/engine/extraction/tier2_discourse.BROKEN-a52-checkpoint.py:512` | defining module is not reachable from any measured entry point |
| `classify_concept` | function | `src/engine/extraction/tier2_discourse.BROKEN-a52-checkpoint.py:517` | no non-test reference outside its own definition |
| `class_of` | function | `src/engine/extraction/tier2_discourse.py:84` | defining module is not reachable from any measured entry point |
| `Tier2Decision` | class | `src/engine/extraction/tier2_discourse.py:89` | defining module is not reachable from any measured entry point |
| `segment_frame` | function | `src/engine/extraction/tier2_discourse.py:238` | defining module is not reachable from any measured entry point |
| `is_rule_or_exclusion_frame` | function | `src/engine/extraction/tier2_discourse.py:269` | defining module is not reachable from any measured entry point |
| `_build_user_message` | function | `src/engine/extraction/tier2_discourse.py:389` | defining module is not reachable from any measured entry point |
| `_derive_label` | function | `src/engine/extraction/tier2_discourse.py:405` | defining module is not reachable from any measured entry point |
| `gemma_classify_call` | function | `src/engine/extraction/tier2_discourse.py:438` | defining module is not reachable from any measured entry point |
| `classify_item` | function | `src/engine/extraction/tier2_discourse.py:481` | defining module is not reachable from any measured entry point |
| `ConceptPass` | class | `src/engine/extraction/tier2_discourse.py:566` | defining module is not reachable from any measured entry point |
| `classify_concept` | function | `src/engine/extraction/tier2_discourse.py:571` | no non-test reference outside its own definition |
| `ConditionEntry` | class | `src/engine/extraction/topology_producer.py:87` | defining module is not reachable from any measured entry point |
| `_role_for` | function | `src/engine/extraction/topology_producer.py:116` | defining module is not reachable from any measured entry point |
| `_extract_comparator` | function | `src/engine/extraction/topology_producer.py:120` | defining module is not reachable from any measured entry point |
| `_direction_for` | function | `src/engine/extraction/topology_producer.py:136` | defining module is not reachable from any measured entry point |
| `produce_topology` | function | `src/engine/extraction/topology_producer.py:146` | no non-test reference outside its own definition; 3 test file(s) do reference it |

</details>

<details><summary><code>src/engine/family_meta_enforcement.py</code> - 2 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `enforcement_status` | function | `src/engine/family_meta_enforcement.py:536` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `reset_enforcement_cache` | function | `src/engine/family_meta_enforcement.py:613` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/fill_model.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `compute_fill_probabilities` | function | `src/engine/fill_model.py:70` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/firm_config.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `get_payout_cap` | function | `src/engine/firm_config.py:275` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/firm_rules_version.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `compute_firm_rules_version_from_dicts` | function | `src/engine/firm_rules_version.py:73` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/forensics</code> - 35 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `LegAInputs` | class | `src/engine/forensics/calibration_battery.py:57` | defining module is not reachable from any measured entry point |
| `MutationCase` | class | `src/engine/forensics/calibration_battery.py:73` | defining module is not reachable from any measured entry point |
| `CaseResult` | class | `src/engine/forensics/calibration_battery.py:96` | defining module is not reachable from any measured entry point |
| `SlotResult` | class | `src/engine/forensics/calibration_battery.py:126` | defining module is not reachable from any measured entry point |
| `BatteryResult` | class | `src/engine/forensics/calibration_battery.py:158` | defining module is not reachable from any measured entry point |
| `_normalize_slot` | function | `src/engine/forensics/calibration_battery.py:175` | defining module is not reachable from any measured entry point |
| `_evaluate_case` | function | `src/engine/forensics/calibration_battery.py:185` | defining module is not reachable from any measured entry point |
| `run_calibration` | function | `src/engine/forensics/calibration_battery.py:215` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `CheckResult` | class | `src/engine/forensics/compile_fidelity.py:98` | defining module is not reachable from any measured entry point |
| `ConditionVerdict` | class | `src/engine/forensics/compile_fidelity.py:107` | defining module is not reachable from any measured entry point |
| `Phase1Seal` | class | `src/engine/forensics/compile_fidelity.py:133` | defining module is not reachable from any measured entry point |
| `Phase2Result` | class | `src/engine/forensics/compile_fidelity.py:157` | defining module is not reachable from any measured entry point |
| `LegAResult` | class | `src/engine/forensics/compile_fidelity.py:165` | defining module is not reachable from any measured entry point |
| `_norm` | function | `src/engine/forensics/compile_fidelity.py:194` | defining module is not reachable from any measured entry point |
| `_is_default_ignorable` | function | `src/engine/forensics/compile_fidelity.py:245` | defining module is not reachable from any measured entry point |
| `_has_visible_content` | function | `src/engine/forensics/compile_fidelity.py:255` | defining module is not reachable from any measured entry point |
| `_spec_body` | function | `src/engine/forensics/compile_fidelity.py:301` | defining module is not reachable from any measured entry point |
| `_taught_conditions` | function | `src/engine/forensics/compile_fidelity.py:308` | defining module is not reachable from any measured entry point |
| `_binding_index` | function | `src/engine/forensics/compile_fidelity.py:322` | defining module is not reachable from any measured entry point |
| `run_leg_a_phase1` | function | `src/engine/forensics/compile_fidelity.py:332` | defining module is not reachable from any measured entry point |
| `_finish_phase1` | function | `src/engine/forensics/compile_fidelity.py:380` | defining module is not reachable from any measured entry point |
| `_verdict_for_condition` | function | `src/engine/forensics/compile_fidelity.py:409` | defining module is not reachable from any measured entry point |
| `_is_provenance_only` | function | `src/engine/forensics/compile_fidelity.py:492` | defining module is not reachable from any measured entry point |
| `_honest_approximation` | function | `src/engine/forensics/compile_fidelity.py:503` | defining module is not reachable from any measured entry point |
| `_check_concretely_bound` | function | `src/engine/forensics/compile_fidelity.py:535` | defining module is not reachable from any measured entry point |
| `_session_scope_path` | function | `src/engine/forensics/compile_fidelity.py:557` | defining module is not reachable from any measured entry point |
| `_cert_key_invalid` | function | `src/engine/forensics/compile_fidelity.py:570` | defining module is not reachable from any measured entry point |
| `_check_provenance_chain` | function | `src/engine/forensics/compile_fidelity.py:609` | defining module is not reachable from any measured entry point |
| `_token_boundary_contains` | function | `src/engine/forensics/compile_fidelity.py:667` | defining module is not reachable from any measured entry point |
| `_max_bipartite_matching` | function | `src/engine/forensics/compile_fidelity.py:677` | defining module is not reachable from any measured entry point |
| `_check_no_certificate_drops` | function | `src/engine/forensics/compile_fidelity.py:700` | defining module is not reachable from any measured entry point |
| `_check_house_exit_stamp` | function | `src/engine/forensics/compile_fidelity.py:784` | defining module is not reachable from any measured entry point |
| `countersign_phase2` | function | `src/engine/forensics/compile_fidelity.py:809` | defining module is not reachable from any measured entry point |
| `run_leg_a` | function | `src/engine/forensics/compile_fidelity.py:859` | defining module is not reachable from any measured entry point |
| `_cli` | function | `src/engine/forensics/compile_fidelity.py:900` | defining module is not reachable from any measured entry point |

</details>

<details><summary><code>src/engine/governor</code> - 2 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `get_config` | function | `src/engine/governor/governor_config.py:50` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `SessionTracker` | class | `src/engine/governor/session_tracker.py:8` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/gpu_pipeline.py</code> - 3 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `to_gpu_df` | function | `src/engine/gpu_pipeline.py:25` | no non-test reference outside its own definition |
| `regime_cluster_gpu` | function | `src/engine/gpu_pipeline.py:32` | no non-test reference outside its own definition |
| `batch_correlation_gpu` | function | `src/engine/gpu_pipeline.py:51` | no non-test reference outside its own definition |

</details>

<details><summary><code>src/engine/graveyard</code> - 2 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `tag_failure` | function | `src/engine/graveyard/failure_tagger.py:103` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `corpse_check` | function | `src/engine/graveyard/graveyard_gate.py:7` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/indicators</code> - 18 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `compute_multi_htf_indicators` | function | `src/engine/indicators/core.py:806` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `auto_swing_fib` | function | `src/engine/indicators/fibonacci.py:93` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `detect_raid` | function | `src/engine/indicators/liquidity.py:293` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `compute_equilibrium` | function | `src/engine/indicators/market_structure.py:272` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `join_n_timeframes_to_exec` | function | `src/engine/indicators/mtf_join.py:139` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `detect_propulsion` | function | `src/engine/indicators/order_flow.py:370` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `compute_consequent_encroachment` | function | `src/engine/indicators/price_delivery.py:108` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `detect_opening_gap` | function | `src/engine/indicators/price_delivery.py:194` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `ascii_profile` | function | `src/engine/indicators/profile_shape_classifier.py:210` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `day_of_week_profile` | function | `src/engine/indicators/sessions.py:148` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `quarterly_theory` | function | `src/engine/indicators/sessions.py:169` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `es_nq_smt` | function | `src/engine/indicators/smt.py:184` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `dxy_eurusd_smt` | function | `src/engine/indicators/smt.py:189` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `nq_es_smt` | function | `src/engine/indicators/smt.py:194` | no non-test reference outside its own definition |
| `gc_dxy_smt` | function | `src/engine/indicators/smt.py:199` | no non-test reference outside its own definition |
| `ym_es_smt` | function | `src/engine/indicators/smt.py:208` | no non-test reference outside its own definition |
| `indices_bonds_smt` | function | `src/engine/indicators/smt.py:217` | no non-test reference outside its own definition |
| `compute_session_shape_score_from_bars` | function | `src/engine/indicators/volume_profile.py:657` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/jsonb_contracts.py</code> - 2 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `PaperSessionConfig` | class | `src/engine/jsonb_contracts.py:115` | no non-test reference outside its own definition |
| `PaperSessionGovernorState` | class | `src/engine/jsonb_contracts.py:127` | no non-test reference outside its own definition |

</details>

<details><summary><code>src/engine/liquidity.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `get_event_adjusted_multipliers` | function | `src/engine/liquidity.py:171` | no non-test reference outside its own definition |

</details>

<details><summary><code>src/engine/macro_data</code> - 7 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `pull_bls_release` | function | `src/engine/macro_data/bls_ingestion.py:43` | defining module is not reachable from any measured entry point |
| `MacroObservation` | class | `src/engine/macro_data/fred_ingestion.py:46` | defining module is not reachable from any measured entry point |
| `pull_fred_daily` | function | `src/engine/macro_data/fred_ingestion.py:57` | defining module is not reachable from any measured entry point |
| `pull_h41_rrp_tga` | function | `src/engine/macro_data/h41_ingestion.py:48` | defining module is not reachable from any measured entry point |
| `compute_rrp_tga_stress_signal` | function | `src/engine/macro_data/h41_ingestion.py:111` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `pull_treasury_auctions` | function | `src/engine/macro_data/treasury_auction_ingestion.py:44` | defining module is not reachable from any measured entry point |
| `compute_auction_stress_signal` | function | `src/engine/macro_data/treasury_auction_ingestion.py:155` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/macro_regime_classifier.py</code> - 10 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `build_feature_matrix` | function | `src/engine/macro_regime_classifier.py:77` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `_extract_series` | function | `src/engine/macro_regime_classifier.py:169` | defining module is not reachable from any measured entry point |
| `_rolling_std` | function | `src/engine/macro_regime_classifier.py:179` | defining module is not reachable from any measured entry point |
| `_rate_of_change` | function | `src/engine/macro_regime_classifier.py:190` | defining module is not reachable from any measured entry point |
| `_forward_fill` | function | `src/engine/macro_regime_classifier.py:201` | defining module is not reachable from any measured entry point |
| `_backward_fill` | function | `src/engine/macro_regime_classifier.py:217` | defining module is not reachable from any measured entry point |
| `fit_hmm_classifier` | function | `src/engine/macro_regime_classifier.py:235` | defining module is not reachable from any measured entry point |
| `predict_regime_probabilities` | function | `src/engine/macro_regime_classifier.py:275` | defining module is not reachable from any measured entry point |
| `classify_daily_regime` | function | `src/engine/macro_regime_classifier.py:303` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `_FallbackClassifier` | class | `src/engine/macro_regime_classifier.py:354` | defining module is not reachable from any measured entry point |

</details>

<details><summary><code>src/engine/macro_regime_fusion.py</code> - 3 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `fuse_macro_deepar` | function | `src/engine/macro_regime_fusion.py:29` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `compute_fomc_size_reduction` | function | `src/engine/macro_regime_fusion.py:145` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `check_hard_gates` | function | `src/engine/macro_regime_fusion.py:174` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/marker_contract.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `build_webhook_canonical` | function | `src/engine/marker_contract.py:30` | no non-test reference outside its own definition |

</details>

<details><summary><code>src/engine/mc_multi_asset.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `multi_asset_correlation_enabled` | function | `src/engine/mc_multi_asset.py:47` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/mc_regime_resampling.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `regime_aware_bootstrap_enabled` | function | `src/engine/mc_regime_resampling.py:54` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/nemo_a14_bridge.py</code> - 3 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `A14ConditioningVector` | class | `src/engine/nemo_a14_bridge.py:24` | defining module is not reachable from any measured entry point |
| `nemo_to_a14_conditioning` | function | `src/engine/nemo_a14_bridge.py:77` | defining module is not reachable from any measured entry point |
| `batch_nemo_to_a14` | function | `src/engine/nemo_a14_bridge.py:110` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/nemo_scenario_designer.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `NeMoNotAvailableError` | class | `src/engine/nemo_scenario_designer.py:639` | no non-test reference outside its own definition |

</details>

<details><summary><code>src/engine/null_calibration_guard.py</code> - 3 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `build_null_calibration_labels` | function | `src/engine/null_calibration_guard.py:34` | defining module is not reachable from any measured entry point |
| `validate_null_calibration_labels` | function | `src/engine/null_calibration_guard.py:63` | defining module is not reachable from any measured entry point |
| `is_null_calibration_row` | function | `src/engine/null_calibration_guard.py:101` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/nvtx_markers.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `timed_range` | function | `src/engine/nvtx_markers.py:58` | no non-test reference outside its own definition |

</details>

<details><summary><code>src/engine/opening_range_definition.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `refused_state` | function | `src/engine/opening_range_definition.py:253` | no non-test reference outside its own definition; 2 test file(s) do reference it |

</details>

<details><summary><code>src/engine/opening_range_execution_fanout.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `build_execution_instances` | function | `src/engine/opening_range_execution_fanout.py:53` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/opening_range_lowering.py</code> - 10 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `OpeningRangeLoweringDisposition` | class | `src/engine/opening_range_lowering.py:74` | defining module is not reachable from any measured entry point |
| `_duration_minutes` | function | `src/engine/opening_range_lowering.py:122` | defining module is not reachable from any measured entry point |
| `_timezone_in` | function | `src/engine/opening_range_lowering.py:131` | defining module is not reachable from any measured entry point |
| `_clock` | function | `src/engine/opening_range_lowering.py:143` | defining module is not reachable from any measured entry point |
| `_taught_spans` | function | `src/engine/opening_range_lowering.py:159` | defining module is not reachable from any measured entry point |
| `_VariantProblem` | class | `src/engine/opening_range_lowering.py:195` | defining module is not reachable from any measured entry point |
| `_taught_variants` | function | `src/engine/opening_range_lowering.py:200` | defining module is not reachable from any measured entry point |
| `OpeningRangeSourceRefusal` | class | `src/engine/opening_range_lowering.py:297` | defining module is not reachable from any measured entry point |
| `OpeningRangeLoweringResult` | class | `src/engine/opening_range_lowering.py:352` | defining module is not reachable from any measured entry point |
| `lower_opening_range_definition` | function | `src/engine/opening_range_lowering.py:367` | defining module is not reachable from any measured entry point |

</details>

<details><summary><code>src/engine/parameter_jitter_battery.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `run_b15_ablation` | function | `src/engine/parameter_jitter_battery.py:625` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/performance_gate.py</code> - 3 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `compute_kill_signal` | function | `src/engine/performance_gate.py:543` | no non-test reference outside its own definition |
| `get_refinement_stage` | function | `src/engine/performance_gate.py:609` | no non-test reference outside its own definition |
| `get_stage_prompt` | function | `src/engine/performance_gate.py:623` | no non-test reference outside its own definition |

</details>

<details><summary><code>src/engine/prop_compliance.py</code> - 3 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `check_ffn_express_consistency` | function | `src/engine/prop_compliance.py:172` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `run_prop_compliance` | function | `src/engine/prop_compliance.py:232` | no non-test reference outside its own definition; 3 test file(s) do reference it |
| `rank_firms_for_strategy` | function | `src/engine/prop_compliance.py:372` | no non-test reference outside its own definition; 2 test file(s) do reference it |

</details>

<details><summary><code>src/engine/prop_survival_model.py</code> - 7 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `RiskEvent` | class | `src/engine/prop_survival_model.py:22` | defining module is not reachable from any measured entry point |
| `PropSurvivalResult` | class | `src/engine/prop_survival_model.py:32` | defining module is not reachable from any measured entry point |
| `build_breach_event` | function | `src/engine/prop_survival_model.py:40` | defining module is not reachable from any measured entry point |
| `build_target_event` | function | `src/engine/prop_survival_model.py:61` | defining module is not reachable from any measured entry point |
| `build_tail_loss_event` | function | `src/engine/prop_survival_model.py:81` | defining module is not reachable from any measured entry point |
| `build_risk_band_scenarios` | function | `src/engine/prop_survival_model.py:94` | defining module is not reachable from any measured entry point |
| `estimate_classical_survival` | function | `src/engine/prop_survival_model.py:147` | defining module is not reachable from any measured entry point |

</details>

<details><summary><code>src/engine/quantum_annealing_optimizer.py</code> - 2 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `decode_solution` | function | `src/engine/quantum_annealing_optimizer.py:306` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `compare_vs_optuna` | function | `src/engine/quantum_annealing_optimizer.py:311` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/quantum_bench.py</code> - 6 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `ToleranceConfig` | class | `src/engine/quantum_bench.py:21` | defining module is not reachable from any measured entry point |
| `BenchmarkResult` | class | `src/engine/quantum_bench.py:28` | defining module is not reachable from any measured entry point |
| `benchmark_against_classical` | function | `src/engine/quantum_bench.py:46` | defining module is not reachable from any measured entry point |
| `validate_tolerance` | function | `src/engine/quantum_bench.py:108` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `build_reproducibility_hash` | function | `src/engine/quantum_bench.py:113` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `persist_benchmark` | function | `src/engine/quantum_bench.py:119` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/quantum_mc.py</code> - 4 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `QuantumRunConfig` | class | `src/engine/quantum_mc.py:177` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `run_quantum_target_hit_estimation` | function | `src/engine/quantum_mc.py:291` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `run_quantum_tail_loss_estimation` | function | `src/engine/quantum_mc.py:304` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `run_hybrid_compare` | function | `src/engine/quantum_mc.py:633` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/quantum_models.py</code> - 2 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `serialize_uncertainty_model` | function | `src/engine/quantum_models.py:191` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `deserialize_uncertainty_model` | function | `src/engine/quantum_models.py:196` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/quantum_rl_agent.py</code> - 4 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `_load_production_state_at` | function | `src/engine/quantum_rl_agent.py:159` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `export_agent_signals` | function | `src/engine/quantum_rl_agent.py:1334` | no non-test reference outside its own definition |
| `should_use_static_router_epsilon_greedy` | function | `src/engine/quantum_rl_agent.py:1513` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `compute_rl_kill_switch_state` | function | `src/engine/quantum_rl_agent.py:2098` | no non-test reference outside its own definition; 3 test file(s) do reference it |

</details>

<details><summary><code>src/engine/qubo_trade_timing.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `compare_vs_classical_timing` | function | `src/engine/qubo_trade_timing.py:365` | no non-test reference outside its own definition |

</details>

<details><summary><code>src/engine/regime.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `should_strategy_trade` | function | `src/engine/regime.py:138` | no non-test reference outside its own definition; 2 test file(s) do reference it |

</details>

<details><summary><code>src/engine/regime_survival.py</code> - 3 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `_compute_regime_stats` | function | `src/engine/regime_survival.py:53` | defining module is not reachable from any measured entry point |
| `run_harsh_regime_survival` | function | `src/engine/regime_survival.py:139` | defining module is not reachable from any measured entry point |
| `_error_result` | function | `src/engine/regime_survival.py:273` | defining module is not reachable from any measured entry point |

</details>

<details><summary><code>src/engine/replay</code> - 10 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `_get_survival_scorer_git_sha` | function | `src/engine/replay/survival_twin_replay.py:108` | defining module is not reachable from any measured entry point |
| `compute_reproducibility_hash` | function | `src/engine/replay/survival_twin_replay.py:130` | defining module is not reachable from any measured entry point |
| `_load_pass_a_ruin_ci_high` | function | `src/engine/replay/survival_twin_replay.py:149` | defining module is not reachable from any measured entry point |
| `_compute_disagreement` | function | `src/engine/replay/survival_twin_replay.py:216` | defining module is not reachable from any measured entry point |
| `SurvivalReplayResult` | class | `src/engine/replay/survival_twin_replay.py:235` | defining module is not reachable from any measured entry point |
| `_run_single_survival_replay` | function | `src/engine/replay/survival_twin_replay.py:286` | defining module is not reachable from any measured entry point |
| `_result_to_db_row` | function | `src/engine/replay/survival_twin_replay.py:427` | defining module is not reachable from any measured entry point |
| `replay_survival_on_backtest` | function | `src/engine/replay/survival_twin_replay.py:496` | defining module is not reachable from any measured entry point |
| `replay_survival_on_all_backtests` | function | `src/engine/replay/survival_twin_replay.py:583` | defining module is not reachable from any measured entry point |
| `main` | function | `src/engine/replay/survival_twin_replay.py:640` | defining module is not reachable from any measured entry point |

</details>

<details><summary><code>src/engine/risk_parity.py</code> - 2 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `allocate_risk_parity` | function | `src/engine/risk_parity.py:34` | defining module is not reachable from any measured entry point |
| `compute_portfolio_risk_parity` | function | `src/engine/risk_parity.py:127` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/robust_covariance.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `portfolio_risk_decomposition` | function | `src/engine/robust_covariance.py:74` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/role_demotion_audit.py</code> - 2 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `get_classification` | function | `src/engine/role_demotion_audit.py:80` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `is_demotable` | function | `src/engine/role_demotion_audit.py:115` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/roll_calendar.py</code> - 2 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `_next_business_day` | function | `src/engine/roll_calendar.py:91` | no non-test reference outside its own definition |
| `_last_business_day_of_month` | function | `src/engine/roll_calendar.py:108` | no non-test reference outside its own definition |

</details>

<details><summary><code>src/engine/session_windows.py</code> - 2 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `is_in_any_killzone` | function | `src/engine/session_windows.py:172` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `is_in_lunch_blackout` | function | `src/engine/session_windows.py:177` | no non-test reference outside its own definition; 2 test file(s) do reference it |

</details>

<details><summary><code>src/engine/sizing.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `compute_profit_tier_mes` | function | `src/engine/sizing.py:794` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/engine/skip_engine</code> - 10 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `backtest_skip_engine` | function | `src/engine/skip_engine/historical_skip_stats.py:10` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `_get_event_proximity` | function | `src/engine/skip_engine/premarket_analyzer.py:15` | defining module is not reachable from any measured entry point |
| `_calculate_consecutive_losses` | function | `src/engine/skip_engine/premarket_analyzer.py:46` | defining module is not reachable from any measured entry point |
| `_calculate_monthly_dd_usage` | function | `src/engine/skip_engine/premarket_analyzer.py:60` | defining module is not reachable from any measured entry point |
| `collect_premarket_signals` | function | `src/engine/skip_engine/premarket_analyzer.py:77` | no non-test reference outside its own definition; 2 test file(s) do reference it |
| `SessionMonitor` | class | `src/engine/skip_engine/session_monitor.py:8` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `_build_feature_vector` | function | `src/engine/skip_engine/weight_trainer.py:95` | defining module is not reachable from any measured entry point |
| `_coeff_to_multiplier` | function | `src/engine/skip_engine/weight_trainer.py:120` | defining module is not reachable from any measured entry point |
| `train_weights` | function | `src/engine/skip_engine/weight_trainer.py:145` | defining module is not reachable from any measured entry point |
| `main` | function | `src/engine/skip_engine/weight_trainer.py:268` | defining module is not reachable from any measured entry point |

</details>

<details><summary><code>src/engine/statistics</code> - 19 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `_get_default_q_research` | function | `src/engine/statistics/corpus_fdr.py:83` | defining module is not reachable from any measured entry point |
| `_get_default_q_promotion` | function | `src/engine/statistics/corpus_fdr.py:92` | defining module is not reachable from any measured entry point |
| `_get_default_population` | function | `src/engine/statistics/corpus_fdr.py:101` | no non-test reference outside its own definition |
| `_std_normal_cdf` | function | `src/engine/statistics/corpus_fdr.py:115` | defining module is not reachable from any measured entry point |
| `_std_normal_sf` | function | `src/engine/statistics/corpus_fdr.py:120` | defining module is not reachable from any measured entry point |
| `_probit` | function | `src/engine/statistics/corpus_fdr.py:125` | defining module is not reachable from any measured entry point |
| `_expected_max_sharpe` | function | `src/engine/statistics/corpus_fdr.py:150` | defining module is not reachable from any measured entry point |
| `PValueDerivation` | class | `src/engine/statistics/corpus_fdr.py:168` | defining module is not reachable from any measured entry point |
| `derive_pvalue_for_strategy` | function | `src/engine/statistics/corpus_fdr.py:183` | defining module is not reachable from any measured entry point |
| `BHResult` | class | `src/engine/statistics/corpus_fdr.py:242` | defining module is not reachable from any measured entry point |
| `benjamini_hochberg` | function | `src/engine/statistics/corpus_fdr.py:251` | defining module is not reachable from any measured entry point |
| `compute_sharpe_haircut` | function | `src/engine/statistics/corpus_fdr.py:321` | defining module is not reachable from any measured entry point |
| `FamilyFDRResult` | class | `src/engine/statistics/corpus_fdr.py:394` | defining module is not reachable from any measured entry point |
| `compute_family_grouped_fdr` | function | `src/engine/statistics/corpus_fdr.py:402` | defining module is not reachable from any measured entry point |
| `_bh_to_dict` | function | `src/engine/statistics/corpus_fdr.py:462` | defining module is not reachable from any measured entry point |
| `_family_result_to_dict` | function | `src/engine/statistics/corpus_fdr.py:473` | defining module is not reachable from any measured entry point |
| `expected_false_discoveries` | function | `src/engine/statistics/corpus_fdr.py:485` | defining module is not reachable from any measured entry point |
| `attach_regime_breakdown` | function | `src/engine/statistics/corpus_fdr.py:564` | defining module is not reachable from any measured entry point |
| `build_corpus_report` | function | `src/engine/statistics/corpus_fdr.py:624` | defining module is not reachable from any measured entry point |

</details>

<details><summary><code>src/engine/strategy_base.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `ExpressionStrategy` | class | `src/engine/strategy_base.py:72` | no non-test reference outside its own definition; 6 test file(s) do reference it |

</details>

<details><summary><code>src/engine/surface_code_encoder.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `circuit_to_qasm` | function | `src/engine/surface_code_encoder.py:223` | no non-test reference outside its own definition |

</details>

<details><summary><code>src/engine/synthetic</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `_simulate_garch_variance` | function | `src/engine/synthetic/stochastic_regime_generator.py:483` | no non-test reference outside its own definition |

</details>

<details><summary><code>src/engine/synthetic_market_simulator.py</code> - 13 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `SyntheticSimulatorConfig` | class | `src/engine/synthetic_market_simulator.py:148` | defining module is not reachable from any measured entry point |
| `compute_stylized_facts` | function | `src/engine/synthetic_market_simulator.py:177` | defining module is not reachable from any measured entry point |
| `run_stylized_fact_tests` | function | `src/engine/synthetic_market_simulator.py:245` | defining module is not reachable from any measured entry point |
| `check_tail_scenario_severity` | function | `src/engine/synthetic_market_simulator.py:293` | no non-test reference outside its own definition |
| `compute_kl_divergence` | function | `src/engine/synthetic_market_simulator.py:370` | defining module is not reachable from any measured entry point |
| `check_mode_collapse` | function | `src/engine/synthetic_market_simulator.py:412` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `calibrate_batch` | function | `src/engine/synthetic_market_simulator.py:439` | defining module is not reachable from any measured entry point |
| `vae_loss` | function | `src/engine/synthetic_market_simulator.py:582` | defining module is not reachable from any measured entry point |
| `_prepare_sequences` | function | `src/engine/synthetic_market_simulator.py:598` | defining module is not reachable from any measured entry point |
| `_condition_latent` | function | `src/engine/synthetic_market_simulator.py:682` | defining module is not reachable from any measured entry point |
| `_tensor_to_bars` | function | `src/engine/synthetic_market_simulator.py:715` | defining module is not reachable from any measured entry point |
| `SyntheticMarketSimulator` | class | `src/engine/synthetic_market_simulator.py:782` | defining module is not reachable from any measured entry point |
| `main` | function | `src/engine/synthetic_market_simulator.py:1057` | defining module is not reachable from any measured entry point |

</details>

<details><summary><code>src/engine/tensor_signal_model.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `MPSModelConfig` | class | `src/engine/tensor_signal_model.py:79` | no non-test reference outside its own definition |

</details>

<details><summary><code>src/engine/validation</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `get_unvalidated_concepts` | function | `src/engine/validation/cross_validator.py:87` | no non-test reference outside its own definition |

</details>

<details><summary><code>src/server/db</code> - 187 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `paperTradesRelations` | const | `src/server/db/migrations/relations.ts:4` | no non-test reference outside its own definition |
| `paperSessionsRelations` | const | `src/server/db/migrations/relations.ts:11` | no non-test reference outside its own definition |
| `accountStrategyAssignmentsRelations` | const | `src/server/db/migrations/relations.ts:24` | no non-test reference outside its own definition |
| `brokerAccountsRelations` | const | `src/server/db/migrations/relations.ts:35` | no non-test reference outside its own definition |
| `strategiesRelations` | const | `src/server/db/migrations/relations.ts:40` | no non-test reference outside its own definition |
| `paperPositionsRelations` | const | `src/server/db/migrations/relations.ts:76` | no non-test reference outside its own definition |
| `strategyDslFeaturesRelations` | const | `src/server/db/migrations/relations.ts:83` | no non-test reference outside its own definition |
| `tradingviewMarkersRelations` | const | `src/server/db/migrations/relations.ts:90` | no non-test reference outside its own definition |
| `strategyLockoutsRelations` | const | `src/server/db/migrations/relations.ts:101` | no non-test reference outside its own definition |
| `complianceReviewsRelations` | const | `src/server/db/migrations/relations.ts:108` | no non-test reference outside its own definition |
| `complianceRulesetsRelations` | const | `src/server/db/migrations/relations.ts:119` | no non-test reference outside its own definition |
| `backtestProvenanceRelations` | const | `src/server/db/migrations/relations.ts:124` | no non-test reference outside its own definition |
| `backtestsRelations` | const | `src/server/db/migrations/relations.ts:131` | no non-test reference outside its own definition |
| `strategyPendingBucketsRelations` | const | `src/server/db/migrations/relations.ts:165` | no non-test reference outside its own definition |
| `strategyPendingMentionsRelations` | const | `src/server/db/migrations/relations.ts:173` | no non-test reference outside its own definition |
| `langchainPgEmbeddingRelations` | const | `src/server/db/migrations/relations.ts:180` | no non-test reference outside its own definition |
| `langchainPgCollectionRelations` | const | `src/server/db/migrations/relations.ts:187` | no non-test reference outside its own definition |
| `quboTimingRunsRelations` | const | `src/server/db/migrations/relations.ts:191` | no non-test reference outside its own definition |
| `strategyFirmEligibilityRelations` | const | `src/server/db/migrations/relations.ts:202` | no non-test reference outside its own definition |
| `skipDecisionsRelations` | const | `src/server/db/migrations/relations.ts:209` | no non-test reference outside its own definition |
| `strategyGraveyardRelations` | const | `src/server/db/migrations/relations.ts:216` | no non-test reference outside its own definition |
| `pilotSessionsRelations` | const | `src/server/db/migrations/relations.ts:223` | no non-test reference outside its own definition |
| `biasStateRelations` | const | `src/server/db/migrations/relations.ts:234` | no non-test reference outside its own definition |
| `quantumMcBenchmarksRelations` | const | `src/server/db/migrations/relations.ts:241` | no non-test reference outside its own definition |
| `quantumMcRunsRelations` | const | `src/server/db/migrations/relations.ts:252` | no non-test reference outside its own definition |
| `monteCarloRunsRelations` | const | `src/server/db/migrations/relations.ts:260` | no non-test reference outside its own definition |
| `promptAbTestsRelations` | const | `src/server/db/migrations/relations.ts:268` | no non-test reference outside its own definition |
| `promptVersionsRelations` | const | `src/server/db/migrations/relations.ts:281` | no non-test reference outside its own definition |
| `strategyNamesRelations` | const | `src/server/db/migrations/relations.ts:290` | no non-test reference outside its own definition |
| `systemParameterHistoryRelations` | const | `src/server/db/migrations/relations.ts:297` | no non-test reference outside its own definition |
| `systemParametersRelations` | const | `src/server/db/migrations/relations.ts:310` | no non-test reference outside its own definition |
| `backtestMatrixRelations` | const | `src/server/db/migrations/relations.ts:319` | no non-test reference outside its own definition |
| `systemJournalRelations` | const | `src/server/db/migrations/relations.ts:327` | no non-test reference outside its own definition |
| `rlTrainingRunsRelations` | const | `src/server/db/migrations/relations.ts:338` | no non-test reference outside its own definition |
| `mutationOutcomesRelations` | const | `src/server/db/migrations/relations.ts:345` | no non-test reference outside its own definition |
| `paperSessionFeedbackRelations` | const | `src/server/db/migrations/relations.ts:352` | no non-test reference outside its own definition |
| `shadowSignalsRelations` | const | `src/server/db/migrations/relations.ts:363` | no non-test reference outside its own definition |
| `paperSignalLogsRelations` | const | `src/server/db/migrations/relations.ts:370` | no non-test reference outside its own definition |
| `complianceDriftLogRelations` | const | `src/server/db/migrations/relations.ts:377` | no non-test reference outside its own definition |
| `backtestTradesRelations` | const | `src/server/db/migrations/relations.ts:384` | no non-test reference outside its own definition |
| `cloudQmcRunsRelations` | const | `src/server/db/migrations/relations.ts:395` | no non-test reference outside its own definition |
| `criticOptimizationRunsRelations` | const | `src/server/db/migrations/relations.ts:407` | no non-test reference outside its own definition |
| `criticCandidatesRelations` | const | `src/server/db/migrations/relations.ts:432` | no non-test reference outside its own definition |
| `frankensteinTestRunsRelations` | const | `src/server/db/migrations/relations.ts:451` | no non-test reference outside its own definition |
| `quantumRunCostsRelations` | const | `src/server/db/migrations/relations.ts:462` | no non-test reference outside its own definition |
| `shadowRerunFindingsRelations` | const | `src/server/db/migrations/relations.ts:473` | no non-test reference outside its own definition |
| `sqaOptimizationRunsRelations` | const | `src/server/db/migrations/relations.ts:484` | no non-test reference outside its own definition |
| `stressTestRunsRelations` | const | `src/server/db/migrations/relations.ts:495` | no non-test reference outside its own definition |
| `syntheticBlackSwanRunsRelations` | const | `src/server/db/migrations/relations.ts:502` | no non-test reference outside its own definition |
| `syntheticRegimeBankRelations` | const | `src/server/db/migrations/relations.ts:517` | no non-test reference outside its own definition |
| `tensorPredictionsRelations` | const | `src/server/db/migrations/relations.ts:521` | no non-test reference outside its own definition |
| `tournamentResultsRelations` | const | `src/server/db/migrations/relations.ts:532` | no non-test reference outside its own definition |
| `walkForwardWindowsRelations` | const | `src/server/db/migrations/relations.ts:539` | no non-test reference outside its own definition |
| `strategyExportsRelations` | const | `src/server/db/migrations/relations.ts:546` | no non-test reference outside its own definition |
| `lifecycleTransitionsRelations` | const | `src/server/db/migrations/relations.ts:558` | no non-test reference outside its own definition |
| `adversarialStressRunsRelations` | const | `src/server/db/migrations/relations.ts:573` | no non-test reference outside its own definition |
| `strategySignalVectorsRelations` | const | `src/server/db/migrations/relations.ts:584` | no non-test reference outside its own definition |
| `strategyExportArtifactsRelations` | const | `src/server/db/migrations/relations.ts:595` | no non-test reference outside its own definition |
| `productionTradesRelations` | const | `src/server/db/migrations/relations.ts:602` | no non-test reference outside its own definition |
| `biasDecisionsRelations` | const | `src/server/db/migrations/relations.ts:609` | no non-test reference outside its own definition |
| `paperTrades` | const | `src/server/db/migrations/schema.ts:6` | defining module is not reachable from any measured entry point |
| `accountStrategyAssignments` | const | `src/server/db/migrations/schema.ts:47` | defining module is not reachable from any measured entry point |
| `auditLog` | const | `src/server/db/migrations/schema.ts:75` | defining module is not reachable from any measured entry point |
| `paperPositions` | const | `src/server/db/migrations/schema.ts:96` | defining module is not reachable from any measured entry point |
| `strategyDslFeatures` | const | `src/server/db/migrations/schema.ts:125` | defining module is not reachable from any measured entry point |
| `tradingviewMarkers` | const | `src/server/db/migrations/schema.ts:144` | defining module is not reachable from any measured entry point |
| `strategies` | const | `src/server/db/migrations/schema.ts:170` | defining module is not reachable from any measured entry point |
| `paperSessions` | const | `src/server/db/migrations/schema.ts:200` | defining module is not reachable from any measured entry point |
| `aPlusMarketScans` | const | `src/server/db/migrations/schema.ts:233` | defining module is not reachable from any measured entry point |
| `strategyLockouts` | const | `src/server/db/migrations/schema.ts:254` | defining module is not reachable from any measured entry point |
| `complianceReviews` | const | `src/server/db/migrations/schema.ts:270` | defining module is not reachable from any measured entry point |
| `macroFeatures` | const | `src/server/db/migrations/schema.ts:300` | defining module is not reachable from any measured entry point |
| `complianceRulesets` | const | `src/server/db/migrations/schema.ts:315` | defining module is not reachable from any measured entry point |
| `macroRegimeStates` | const | `src/server/db/migrations/schema.ts:336` | defining module is not reachable from any measured entry point |
| `vectors5AStrategyGen` | const | `src/server/db/migrations/schema.ts:354` | no non-test reference outside its own definition |
| `backtestProvenance` | const | `src/server/db/migrations/schema.ts:361` | defining module is not reachable from any measured entry point |
| `contractSpecsAuthoritative` | const | `src/server/db/migrations/schema.ts:382` | defining module is not reachable from any measured entry point |
| `paperSignalLog` | const | `src/server/db/migrations/schema.ts:397` | no non-test reference outside its own definition |
| `dailyStatistics` | const | `src/server/db/migrations/schema.ts:411` | defining module is not reachable from any measured entry point |
| `openingAuctionImbalance` | const | `src/server/db/migrations/schema.ts:428` | defining module is not reachable from any measured entry point |
| `strategyPendingBuckets` | const | `src/server/db/migrations/schema.ts:445` | defining module is not reachable from any measured entry point |
| `memory5AStrategyGen` | const | `src/server/db/migrations/schema.ts:476` | no non-test reference outside its own definition |
| `strategyPendingMentions` | const | `src/server/db/migrations/schema.ts:482` | defining module is not reachable from any measured entry point |
| `dataIntegrityFindings` | const | `src/server/db/migrations/schema.ts:504` | defining module is not reachable from any measured entry point |
| `n8NChatHistories` | const | `src/server/db/migrations/schema.ts:520` | no non-test reference outside its own definition |
| `syntheticRegimeBank` | const | `src/server/db/migrations/schema.ts:529` | defining module is not reachable from any measured entry point |
| `firmAdversarialPriors` | const | `src/server/db/migrations/schema.ts:548` | defining module is not reachable from any measured entry point |
| `langchainPgCollection` | const | `src/server/db/migrations/schema.ts:567` | defining module is not reachable from any measured entry point |
| `langchainPgEmbedding` | const | `src/server/db/migrations/schema.ts:575` | defining module is not reachable from any measured entry point |
| `quboTimingRuns` | const | `src/server/db/migrations/schema.ts:591` | defining module is not reachable from any measured entry point |
| `backtests` | const | `src/server/db/migrations/schema.ts:620` | defining module is not reachable from any measured entry point |
| `strategyFirmEligibility` | const | `src/server/db/migrations/schema.ts:670` | defining module is not reachable from any measured entry point |
| `scoutDrainSamples` | const | `src/server/db/migrations/schema.ts:693` | defining module is not reachable from any measured entry point |
| `skipDecisions` | const | `src/server/db/migrations/schema.ts:702` | defining module is not reachable from any measured entry point |
| `strategyGraveyard` | const | `src/server/db/migrations/schema.ts:729` | defining module is not reachable from any measured entry point |
| `pilotSessions` | const | `src/server/db/migrations/schema.ts:757` | defining module is not reachable from any measured entry point |
| `llmInjectionAttempts` | const | `src/server/db/migrations/schema.ts:785` | defining module is not reachable from any measured entry point |
| `biasState` | const | `src/server/db/migrations/schema.ts:801` | defining module is not reachable from any measured entry point |
| `quantumMcBenchmarks` | const | `src/server/db/migrations/schema.ts:824` | defining module is not reachable from any measured entry point |
| `promptVersions` | const | `src/server/db/migrations/schema.ts:863` | defining module is not reachable from any measured entry point |
| `promptAbTests` | const | `src/server/db/migrations/schema.ts:876` | defining module is not reachable from any measured entry point |
| `strategyNames` | const | `src/server/db/migrations/schema.ts:903` | defining module is not reachable from any measured entry point |
| `systemParameters` | const | `src/server/db/migrations/schema.ts:927` | defining module is not reachable from any measured entry point |
| `systemParameterHistory` | const | `src/server/db/migrations/schema.ts:944` | defining module is not reachable from any measured entry point |
| `backtestMatrix` | const | `src/server/db/migrations/schema.ts:967` | defining module is not reachable from any measured entry point |
| `systemJournal` | const | `src/server/db/migrations/schema.ts:988` | defining module is not reachable from any measured entry point |
| `rlTrainingRuns` | const | `src/server/db/migrations/schema.ts:1025` | defining module is not reachable from any measured entry point |
| `mutationOutcomes` | const | `src/server/db/migrations/schema.ts:1053` | defining module is not reachable from any measured entry point |
| `paperSessionFeedback` | const | `src/server/db/migrations/schema.ts:1079` | defining module is not reachable from any measured entry point |
| `shadowSignals` | const | `src/server/db/migrations/schema.ts:1121` | defining module is not reachable from any measured entry point |
| `harshRegimePhase` | const | `src/server/db/migrations/schema.ts:1144` | defining module is not reachable from any measured entry point |
| `paperSignalLogs` | const | `src/server/db/migrations/schema.ts:1155` | defining module is not reachable from any measured entry point |
| `agentHealthReports` | const | `src/server/db/migrations/schema.ts:1177` | defining module is not reachable from any measured entry point |
| `subsystemMetrics` | const | `src/server/db/migrations/schema.ts:1192` | defining module is not reachable from any measured entry point |
| `alerts` | const | `src/server/db/migrations/schema.ts:1207` | defining module is not reachable from any measured entry point |
| `deadLetterQueue` | const | `src/server/db/migrations/schema.ts:1221` | defining module is not reachable from any measured entry point |
| `deeparForecasts` | const | `src/server/db/migrations/schema.ts:1242` | defining module is not reachable from any measured entry point |
| `deeparTrainingRuns` | const | `src/server/db/migrations/schema.ts:1267` | defining module is not reachable from any measured entry point |
| `deeparModelRegistry` | const | `src/server/db/migrations/schema.ts:1284` | no non-test reference outside its own definition |
| `macroSnapshots` | const | `src/server/db/migrations/schema.ts:1299` | defining module is not reachable from any measured entry point |
| `dayArchetypes` | const | `src/server/db/migrations/schema.ts:1323` | defining module is not reachable from any measured entry point |
| `complianceDriftLog` | const | `src/server/db/migrations/schema.ts:1339` | defining module is not reachable from any measured entry point |
| `schedulerJobRuns` | const | `src/server/db/migrations/schema.ts:1362` | no non-test reference outside its own definition |
| `circuitBreakerEvents` | const | `src/server/db/migrations/schema.ts:1377` | no non-test reference outside its own definition |
| `n8NExecutionLog` | const | `src/server/db/migrations/schema.ts:1388` | no non-test reference outside its own definition |
| `dataQualityChecks` | const | `src/server/db/migrations/schema.ts:1408` | no non-test reference outside its own definition |
| `pythonExecutionLog` | const | `src/server/db/migrations/schema.ts:1420` | no non-test reference outside its own definition |
| `idempotencyKeys` | const | `src/server/db/migrations/schema.ts:1435` | defining module is not reachable from any measured entry point |
| `dataSyncJobs` | const | `src/server/db/migrations/schema.ts:1442` | defining module is not reachable from any measured entry point |
| `aiInferenceLog` | const | `src/server/db/migrations/schema.ts:1461` | no non-test reference outside its own definition |
| `contractRolls` | const | `src/server/db/migrations/schema.ts:1484` | defining module is not reachable from any measured entry point |
| `exchangeOutages` | const | `src/server/db/migrations/schema.ts:1503` | defining module is not reachable from any measured entry point |
| `propFirmHealthChecks` | const | `src/server/db/migrations/schema.ts:1517` | defining module is not reachable from any measured entry point |
| `systemHealthHeartbeat` | const | `src/server/db/migrations/schema.ts:1530` | no non-test reference outside its own definition |
| `operatorAbsentPeriods` | const | `src/server/db/migrations/schema.ts:1539` | defining module is not reachable from any measured entry point |
| `backtestTrades` | const | `src/server/db/migrations/schema.ts:1549` | defining module is not reachable from any measured entry point |
| `cloudQmcRuns` | const | `src/server/db/migrations/schema.ts:1592` | defining module is not reachable from any measured entry point |
| `criticOptimizationRuns` | const | `src/server/db/migrations/schema.ts:1631` | defining module is not reachable from any measured entry point |
| `frankensteinTestRuns` | const | `src/server/db/migrations/schema.ts:1673` | defining module is not reachable from any measured entry point |
| `monteCarloRuns` | const | `src/server/db/migrations/schema.ts:1705` | defining module is not reachable from any measured entry point |
| `quantumMcRuns` | const | `src/server/db/migrations/schema.ts:1734` | defining module is not reachable from any measured entry point |
| `quantumRunCosts` | const | `src/server/db/migrations/schema.ts:1768` | defining module is not reachable from any measured entry point |
| `shadowRerunFindings` | const | `src/server/db/migrations/schema.ts:1794` | defining module is not reachable from any measured entry point |
| `sqaOptimizationRuns` | const | `src/server/db/migrations/schema.ts:1829` | defining module is not reachable from any measured entry point |
| `stressTestRuns` | const | `src/server/db/migrations/schema.ts:1861` | defining module is not reachable from any measured entry point |
| `syntheticBlackSwanRuns` | const | `src/server/db/migrations/schema.ts:1878` | defining module is not reachable from any measured entry point |
| `tensorPredictions` | const | `src/server/db/migrations/schema.ts:1916` | defining module is not reachable from any measured entry point |
| `tournamentResults` | const | `src/server/db/migrations/schema.ts:1946` | defining module is not reachable from any measured entry point |
| `walkForwardWindows` | const | `src/server/db/migrations/schema.ts:1973` | defining module is not reachable from any measured entry point |
| `strategyExports` | const | `src/server/db/migrations/schema.ts:1996` | defining module is not reachable from any measured entry point |
| `criticCandidates` | const | `src/server/db/migrations/schema.ts:2028` | defining module is not reachable from any measured entry point |
| `lifecycleTransitions` | const | `src/server/db/migrations/schema.ts:2074` | defining module is not reachable from any measured entry point |
| `adversarialStressRuns` | const | `src/server/db/migrations/schema.ts:2113` | defining module is not reachable from any measured entry point |
| `strategySignalVectors` | const | `src/server/db/migrations/schema.ts:2146` | defining module is not reachable from any measured entry point |
| `strategyExportArtifacts` | const | `src/server/db/migrations/schema.ts:2170` | defining module is not reachable from any measured entry point |
| `dailyVolumeProfileLevels` | const | `src/server/db/migrations/schema.ts:2190` | defining module is not reachable from any measured entry point |
| `nemoScenarioBank` | const | `src/server/db/migrations/schema.ts:2210` | defining module is not reachable from any measured entry point |
| `biasDecisions` | const | `src/server/db/migrations/schema.ts:2230` | defining module is not reachable from any measured entry point |
| `biasCalibrationCurves` | const | `src/server/db/migrations/schema.ts:2254` | defining module is not reachable from any measured entry point |
| `biasAblationResults` | const | `src/server/db/migrations/schema.ts:2266` | defining module is not reachable from any measured entry point |
| `systemState` | const | `src/server/db/migrations/schema.ts:2283` | defining module is not reachable from any measured entry point |
| `productionTrades` | const | `src/server/db/migrations/schema.ts:2293` | defining module is not reachable from any measured entry point |
| `dailyReconciliation` | const | `src/server/db/migrations/schema.ts:2322` | defining module is not reachable from any measured entry point |
| `weeklyDriftReports` | const | `src/server/db/migrations/schema.ts:2338` | defining module is not reachable from any measured entry point |
| `instanceConfig` | const | `src/server/db/migrations/schema.ts:2354` | defining module is not reachable from any measured entry point |
| `brokerAccounts` | const | `src/server/db/migrations/schema.ts:2365` | defining module is not reachable from any measured entry point |
| `BiasStateRow` | type | `src/server/db/schema.ts:2415` | no non-test reference outside its own definition |
| `BiasStateInsert` | type | `src/server/db/schema.ts:2416` | no non-test reference outside its own definition |
| `RegimeHmmModelRow` | type | `src/server/db/schema.ts:2440` | no non-test reference outside its own definition |
| `RegimeHmmModelInsert` | type | `src/server/db/schema.ts:2441` | no non-test reference outside its own definition |
| `HarshRegimePhaseValue` | type | `src/server/db/schema.ts:2457` | no non-test reference outside its own definition |
| `HarshRegimePhaseRow` | type | `src/server/db/schema.ts:2458` | no non-test reference outside its own definition |
| `HarshRegimePhaseInsert` | type | `src/server/db/schema.ts:2459` | no non-test reference outside its own definition |
| `SystemStateRow` | type | `src/server/db/schema.ts:2496` | no non-test reference outside its own definition |
| `SystemStateInsert` | type | `src/server/db/schema.ts:2497` | no non-test reference outside its own definition |
| `FirmAdversarialPriorInsert` | type | `src/server/db/schema.ts:2875` | no non-test reference outside its own definition |
| `NewSlumhouseUser` | type | `src/server/db/schema.ts:3342` | no non-test reference outside its own definition |
| `AgentJob` | type | `src/server/db/schema.ts:3402` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `NewAgentJob` | type | `src/server/db/schema.ts:3403` | no non-test reference outside its own definition |
| `WorkflowBackup` | type | `src/server/db/schema.ts:3431` | no non-test reference outside its own definition |
| `NewWorkflowBackup` | type | `src/server/db/schema.ts:3432` | no non-test reference outside its own definition |
| `LiveOrderPineDedup` | type | `src/server/db/schema.ts:3467` | no non-test reference outside its own definition |
| `NewLiveOrderPineDedup` | type | `src/server/db/schema.ts:3468` | no non-test reference outside its own definition |
| `CarterIssueRow` | type | `src/server/db/schema.ts:3495` | no non-test reference outside its own definition |
| `NewCarterIssueRow` | type | `src/server/db/schema.ts:3496` | no non-test reference outside its own definition |
| `CarterMemoryRow` | type | `src/server/db/schema.ts:3520` | no non-test reference outside its own definition |
| `NewCarterMemoryRow` | type | `src/server/db/schema.ts:3521` | no non-test reference outside its own definition |

</details>

<details><summary><code>src/server/integrations</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `buildPineAlertTemplate` | function | `src/server/integrations/traderspost/webhook-builder.ts:179` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/server/lib</code> - 460 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `API_VERSIONS` | const | `src/server/lib/api-contracts.ts:41` | defining module is not reachable from any measured entry point |
| `ApiVersion` | type | `src/server/lib/api-contracts.ts:42` | defining module is not reachable from any measured entry point |
| `API_VERSION_HEADER` | const | `src/server/lib/api-contracts.ts:45` | no non-test reference outside its own definition |
| `Shapes` | const | `src/server/lib/api-contracts.ts:48` | no non-test reference outside its own definition |
| `versioned` | function | `src/server/lib/api-contracts.ts:68` | no non-test reference outside its own definition |
| `setDeprecationHeaders` | function | `src/server/lib/api-contracts.ts:82` | no non-test reference outside its own definition |
| `ResolvedAction` | type | `src/server/lib/archetype-routing-observability.ts:88` | defining module is not reachable from any measured entry point |
| `ArchetypeSignalReceivedPayload` | interface | `src/server/lib/archetype-routing-observability.ts:103` | defining module is not reachable from any measured entry point |
| `ArchetypeSignalResolvedPayload` | interface | `src/server/lib/archetype-routing-observability.ts:123` | defining module is not reachable from any measured entry point |
| `ArchetypeEvaluatorFailedPayload` | interface | `src/server/lib/archetype-routing-observability.ts:147` | defining module is not reachable from any measured entry point |
| `emitArchetypeSignalReceived` | function | `src/server/lib/archetype-routing-observability.ts:182` | defining module is not reachable from any measured entry point |
| `emitArchetypeSignalResolved` | function | `src/server/lib/archetype-routing-observability.ts:217` | defining module is not reachable from any measured entry point |
| `emitArchetypeEvaluatorFailed` | function | `src/server/lib/archetype-routing-observability.ts:266` | defining module is not reachable from any measured entry point |
| `RefusalDisposition` | type | `src/server/lib/backtest-caller-registry.ts:31` | defining module is not reachable from any measured entry point |
| `ApprovedCaller` | interface | `src/server/lib/backtest-caller-registry.ts:39` | defining module is not reachable from any measured entry point |
| `APPROVED_BACKTEST_CALLERS` | const | `src/server/lib/backtest-caller-registry.ts:48` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `GUARDED_CALLEE` | const | `src/server/lib/backtest-caller-scan.ts:27` | defining module is not reachable from any measured entry point |
| `CallerIdentity` | interface | `src/server/lib/backtest-caller-scan.ts:37` | defining module is not reachable from any measured entry point |
| `identityKey` | function | `src/server/lib/backtest-caller-scan.ts:43` | defining module is not reachable from any measured entry point |
| `scanBacktestCallers` | function | `src/server/lib/backtest-caller-scan.ts:121` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `CallerAuditResult` | interface | `src/server/lib/backtest-caller-scan.ts:151` | defining module is not reachable from any measured entry point |
| `auditBacktestCallers` | function | `src/server/lib/backtest-caller-scan.ts:171` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `buildElevenLabsSignature` | function | `src/server/lib/carter/carter-auth.ts:127` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `_resetUsedConfirmations` | function | `src/server/lib/carter/carter-confirm.ts:74` | no non-test reference outside its own definition; 3 test file(s) do reference it |
| `__test` | const | `src/server/lib/carter/carter-introspect.ts:597` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `_resetForTest` | function | `src/server/lib/carter/carter-issues-store.ts:231` | no non-test reference outside its own definition; 5 test file(s) do reference it |
| `RememberKind` | type | `src/server/lib/carter/carter-memory-store.ts:32` | no non-test reference outside its own definition |
| `getCmeHolidayTable` | function | `src/server/lib/cme-holidays.ts:118` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `getDefaultComplianceMode` | function | `src/server/lib/compliance-mode.ts:47` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `_resetRateLimitForTest` | function | `src/server/lib/composite-shadow-discord-router.ts:76` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `startComputeFailoverMonitor` | function | `src/server/lib/compute-failover.ts:187` | no non-test reference outside its own definition |
| `submitToCloud` | function | `src/server/lib/compute-failover.ts:298` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `obDecay` | function | `src/server/lib/confluence-decay.ts:182` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `AUTO_FLOOR_FACTORS` | export-binding | `src/server/lib/confluence-quality-audit.ts:59` | defining module is not reachable from any measured entry point |
| `tagFactorSources` | export-binding | `src/server/lib/confluence-quality-audit.ts:59` | defining module is not reachable from any measured entry point |
| `evidenceBackedFactorCount` | export-binding | `src/server/lib/confluence-quality-audit.ts:59` | defining module is not reachable from any measured entry point |
| `FactorSource` | export-binding | `src/server/lib/confluence-quality-audit.ts:59` | defining module is not reachable from any measured entry point |
| `FactorQuality` | type | `src/server/lib/confluence-quality-audit.ts:77` | defining module is not reachable from any measured entry point |
| `classifyFactorQuality` | function | `src/server/lib/confluence-quality-audit.ts:90` | defining module is not reachable from any measured entry point |
| `_clearThinConfluenceDiscordState` | function | `src/server/lib/confluence-quality-audit.ts:110` | no non-test reference outside its own definition |
| `BidirectionalIncompleteRejectedPayload` | interface | `src/server/lib/confluence-quality-audit.ts:116` | defining module is not reachable from any measured entry point |
| `FactorQualityClassifiedPayload` | interface | `src/server/lib/confluence-quality-audit.ts:137` | defining module is not reachable from any measured entry point |
| `ThinConfluenceWarningPayload` | interface | `src/server/lib/confluence-quality-audit.ts:163` | defining module is not reachable from any measured entry point |
| `emitBidirectionalIncompleteRejected` | function | `src/server/lib/confluence-quality-audit.ts:202` | defining module is not reachable from any measured entry point |
| `emitFactorQualityClassified` | function | `src/server/lib/confluence-quality-audit.ts:265` | defining module is not reachable from any measured entry point |
| `emitThinConfluenceWarning` | function | `src/server/lib/confluence-quality-audit.ts:326` | defining module is not reachable from any measured entry point |
| `ExtractionParityTestPayload` | interface | `src/server/lib/confluence-quality-audit.ts:494` | defining module is not reachable from any measured entry point |
| `emitExtractionParityTestRun` | function | `src/server/lib/confluence-quality-audit.ts:516` | no non-test reference outside its own definition |
| `loadCredentials` | function | `src/server/lib/credential-loader.ts:323` | no non-test reference outside its own definition; 9 test file(s) do reference it |
| `getVaultLoadResult` | function | `src/server/lib/credential-loader.ts:453` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `getActiveVaultMode` | function | `src/server/lib/credential-loader.ts:460` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `getVaultHealth` | function | `src/server/lib/credential-loader.ts:468` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `_setVaultModeForTests` | function | `src/server/lib/credential-loader.ts:557` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `__resetEconomicCalendarCacheForTests` | function | `src/server/lib/economic-calendar-loader.ts:63` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `normalizeStrategyName` | function | `src/server/lib/eligibility-registration.ts:20` | defining module is not reachable from any measured entry point |
| `normalizeAllStratsEntry` | function | `src/server/lib/eligibility-registration.ts:24` | no non-test reference outside its own definition |
| `isStrategyRegistered` | function | `src/server/lib/eligibility-registration.ts:30` | defining module is not reachable from any measured entry point |
| `loadAllStratsNormalized` | function | `src/server/lib/eligibility-registration.ts:40` | defining module is not reachable from any measured entry point |
| `RegistrationExposure` | interface | `src/server/lib/eligibility-registration.ts:56` | defining module is not reachable from any measured entry point |
| `classifyRegistrationExposure` | function | `src/server/lib/eligibility-registration.ts:69` | defining module is not reachable from any measured entry point |
| `promptHash` | function | `src/server/lib/extraction-result-cache.ts:29` | defining module is not reachable from any measured entry point |
| `cacheKey` | function | `src/server/lib/extraction-result-cache.ts:33` | defining module is not reachable from any measured entry point |
| `CachedResult` | interface | `src/server/lib/extraction-result-cache.ts:38` | defining module is not reachable from any measured entry point |
| `ExtractionResultCache` | class | `src/server/lib/extraction-result-cache.ts:51` | defining module is not reachable from any measured entry point |
| `EXTRACTION_DAILY_PARTITION_DEFAULT` | const | `src/server/lib/extraction-token-governor.ts:25` | defining module is not reachable from any measured entry point |
| `PoolConfig` | interface | `src/server/lib/extraction-token-governor.ts:39` | defining module is not reachable from any measured entry point |
| `POOLS` | const | `src/server/lib/extraction-token-governor.ts:51` | defining module is not reachable from any measured entry point |
| `resolvePoolPartition` | function | `src/server/lib/extraction-token-governor.ts:59` | defining module is not reachable from any measured entry point |
| `ExtractionBudgetInput` | interface | `src/server/lib/extraction-token-governor.ts:73` | defining module is not reachable from any measured entry point |
| `ExtractionBudgetResult` | interface | `src/server/lib/extraction-token-governor.ts:82` | defining module is not reachable from any measured entry point |
| `resolveExtractionPartition` | function | `src/server/lib/extraction-token-governor.ts:94` | defining module is not reachable from any measured entry point |
| `evaluateExtractionBudget` | function | `src/server/lib/extraction-token-governor.ts:114` | defining module is not reachable from any measured entry point |
| `assertExtractionBudgetOrThrow` | function | `src/server/lib/extraction-token-governor.ts:147` | defining module is not reachable from any measured entry point |
| `startOfUtcDay` | function | `src/server/lib/extraction-token-governor.ts:156` | defining module is not reachable from any measured entry point |
| `getExtractionTokensSpentToday` | function | `src/server/lib/extraction-token-governor.ts:167` | defining module is not reachable from any measured entry point |
| `readTodaySpend` | function | `src/server/lib/extraction-token-governor.ts:200` | defining module is not reachable from any measured entry point |
| `recordSpend` | function | `src/server/lib/extraction-token-governor.ts:206` | defining module is not reachable from any measured entry point |
| `seedTodaySpend` | function | `src/server/lib/extraction-token-governor.ts:215` | defining module is not reachable from any measured entry point |
| `BurstTicket` | interface | `src/server/lib/extraction-token-governor.ts:234` | defining module is not reachable from any measured entry point |
| `BurstEval` | interface | `src/server/lib/extraction-token-governor.ts:250` | defining module is not reachable from any measured entry point |
| `evaluateWithBurst` | function | `src/server/lib/extraction-token-governor.ts:263` | defining module is not reachable from any measured entry point |
| `fetchOrgCostsUsd` | function | `src/server/lib/extraction-token-governor.ts:306` | defining module is not reachable from any measured entry point |
| `ASPIRE_CITY_PROJECT_ID` | const | `src/server/lib/extraction-token-governor.ts:328` | defining module is not reachable from any measured entry point |
| `remainingBalanceUsd` | function | `src/server/lib/extraction-token-governor.ts:331` | no non-test reference outside its own definition |
| `readBurstTicket` | function | `src/server/lib/extraction-token-governor.ts:337` | defining module is not reachable from any measured entry point |
| `grantBurstTicket` | function | `src/server/lib/extraction-token-governor.ts:344` | defining module is not reachable from any measured entry point |
| `TwoPathBudgetReport` | interface | `src/server/lib/extraction-token-governor.ts:352` | defining module is not reachable from any measured entry point |
| `measured7DayPull` | function | `src/server/lib/extraction-token-governor.ts:366` | defining module is not reachable from any measured entry point |
| `BIDIR_SENTINEL` | const | `src/server/lib/fade-inverter.ts:44` | defining module is not reachable from any measured entry point |
| `FADE_SOURCE` | const | `src/server/lib/fade-inverter.ts:47` | defining module is not reachable from any measured entry point |
| `FadeInverterInput` | interface | `src/server/lib/fade-inverter.ts:51` | defining module is not reachable from any measured entry point |
| `FadeSkipReason` | type | `src/server/lib/fade-inverter.ts:60` | defining module is not reachable from any measured entry point |
| `InvertResult` | type | `src/server/lib/fade-inverter.ts:66` | defining module is not reachable from any measured entry point |
| `invertStrategyConfig` | function | `src/server/lib/fade-inverter.ts:155` | defining module is not reachable from any measured entry point |
| `expectedBrokerTypeForFirm` | function | `src/server/lib/firm-broker-topology.ts:35` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `assertFirmBrokerTopology` | function | `src/server/lib/firm-broker-topology.ts:102` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `FORGE_CODENAME_POOL` | const | `src/server/lib/forge-names.ts:8` | defining module is not reachable from any measured entry point |
| `ForgeCodename` | type | `src/server/lib/forge-names.ts:49` | no non-test reference outside its own definition |
| `generateSeedSQL` | function | `src/server/lib/forge-names.ts:55` | no non-test reference outside its own definition |
| `FrozenPolicySlice` | interface | `src/server/lib/frozen-policy-hash.ts:54` | defining module is not reachable from any measured entry point |
| `computeFrozenPolicyHash` | function | `src/server/lib/frozen-policy-hash.ts:88` | defining module is not reachable from any measured entry point |
| `FrozenPolicyDriftResult` | interface | `src/server/lib/frozen-policy-hash.ts:106` | defining module is not reachable from any measured entry point |
| `evaluateFrozenPolicyDriftAtPromotion` | function | `src/server/lib/frozen-policy-hash.ts:129` | defining module is not reachable from any measured entry point |
| `applyParamDefaults` | function | `src/server/lib/indicator-params.ts:205` | no non-test reference outside its own definition |
| `paramsSatisfyTrigger` | function | `src/server/lib/indicator-params.ts:218` | no non-test reference outside its own definition |
| `isInKillzone` | function | `src/server/lib/killzone.ts:157` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `LeakSeverity` | type | `src/server/lib/leak-metrics.ts:20` | defining module is not reachable from any measured entry point |
| `computeZScore` | function | `src/server/lib/leak-metrics.ts:34` | defining module is not reachable from any measured entry point |
| `computeSharpeFromPnls` | function | `src/server/lib/leak-metrics.ts:63` | defining module is not reachable from any measured entry point |
| `computeWinRate` | function | `src/server/lib/leak-metrics.ts:83` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `classifyZScoreSeverity` | function | `src/server/lib/leak-metrics.ts:101` | defining module is not reachable from any measured entry point |
| `computeRegimeSurvivalFailureRate` | function | `src/server/lib/leak-metrics.ts:124` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `computeB14CiHighDrift` | function | `src/server/lib/leak-metrics.ts:151` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `splitWindows` | function | `src/server/lib/leak-metrics.ts:169` | defining module is not reachable from any measured entry point |
| `classifyFractionSeverity` | function | `src/server/lib/leak-metrics.ts:184` | defining module is not reachable from any measured entry point |
| `computeMaxDrawdownFromPnls` | function | `src/server/lib/leak-metrics.ts:208` | defining module is not reachable from any measured entry point |
| `McDistributionBreachInput` | interface | `src/server/lib/leak-metrics.ts:228` | defining module is not reachable from any measured entry point |
| `McBreachDimension` | type | `src/server/lib/leak-metrics.ts:260` | defining module is not reachable from any measured entry point |
| `McDistributionBreachResult` | interface | `src/server/lib/leak-metrics.ts:263` | defining module is not reachable from any measured entry point |
| `computeMcDistributionBreach` | function | `src/server/lib/leak-metrics.ts:311` | defining module is not reachable from any measured entry point |
| `KNOWN_OUT_OF_BAND_APPLIED_WHENS` | const | `src/server/lib/migration-journal-utils.ts:44` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `getOverlayAplusRetentionFloor` | function | `src/server/lib/mode-ab-guard.ts:42` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `OVERLAY_APLUS_RETENTION_FLOOR_DEFAULT` | const | `src/server/lib/mode-ab-guard.ts:50` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `OVERLAY_CONFIG_HASH_OMITS_MODE_TOGGLE` | const | `src/server/lib/mode-ab-guard.ts:61` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `ModeAbMode` | type | `src/server/lib/mode-ab-guard.ts:65` | defining module is not reachable from any measured entry point |
| `ModeAbLabels` | interface | `src/server/lib/mode-ab-guard.ts:67` | defining module is not reachable from any measured entry point |
| `buildModeAbLabels` | function | `src/server/lib/mode-ab-guard.ts:88` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `ModeAbValidationResult` | interface | `src/server/lib/mode-ab-guard.ts:101` | defining module is not reachable from any measured entry point |
| `validateModeAbLabels` | function | `src/server/lib/mode-ab-guard.ts:114` | defining module is not reachable from any measured entry point |
| `ModeAbValidationError` | class | `src/server/lib/mode-ab-guard.ts:141` | defining module is not reachable from any measured entry point |
| `assertModeAbLabels` | function | `src/server/lib/mode-ab-guard.ts:151` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `isTetherActive` | function | `src/server/lib/network-failover.ts:102` | no non-test reference outside its own definition |
| `confirmTethering` | function | `src/server/lib/network-failover.ts:111` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `clearTetherConfirmation` | function | `src/server/lib/network-failover.ts:129` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `startNetworkFailoverMonitor` | function | `src/server/lib/network-failover.ts:347` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `_resetNetworkFailoverForTests` | function | `src/server/lib/network-failover.ts:452` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `isEiaWindow` | function | `src/server/lib/news-policy.ts:47` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `PayoutAuditPacketOptions` | interface | `src/server/lib/payout-audit-packet.ts:38` | defining module is not reachable from any measured entry point |
| `ManifestEntry` | interface | `src/server/lib/payout-audit-packet.ts:45` | defining module is not reachable from any measured entry point |
| `PacketManifest` | interface | `src/server/lib/payout-audit-packet.ts:51` | defining module is not reachable from any measured entry point |
| `PacketSummary` | interface | `src/server/lib/payout-audit-packet.ts:59` | defining module is not reachable from any measured entry point |
| `resolveFirmIdFromAccountId` | function | `src/server/lib/payout-audit-packet.ts:76` | defining module is not reachable from any measured entry point |
| `gatherTrades` | function | `src/server/lib/payout-audit-packet.ts:90` | defining module is not reachable from any measured entry point |
| `gatherAuditLog` | function | `src/server/lib/payout-audit-packet.ts:118` | defining module is not reachable from any measured entry point |
| `gatherBiasState` | function | `src/server/lib/payout-audit-packet.ts:150` | defining module is not reachable from any measured entry point |
| `gatherSizingAudits` | function | `src/server/lib/payout-audit-packet.ts:169` | defining module is not reachable from any measured entry point |
| `gatherKillSwitchEvents` | function | `src/server/lib/payout-audit-packet.ts:199` | defining module is not reachable from any measured entry point |
| `gatherStrategyDsls` | function | `src/server/lib/payout-audit-packet.ts:226` | defining module is not reachable from any measured entry point |
| `gatherLifecycleTransitions` | function | `src/server/lib/payout-audit-packet.ts:268` | defining module is not reachable from any measured entry point |
| `gatherBrokerEvents` | function | `src/server/lib/payout-audit-packet.ts:309` | defining module is not reachable from any measured entry point |
| `generatePayoutAuditPacket` | function | `src/server/lib/payout-audit-packet.ts:550` | defining module is not reachable from any measured entry point |
| `PineCompileRequest` | type | `src/server/lib/pine-artifact-schema.ts:27` | no non-test reference outside its own definition |
| `PineExportResponse` | type | `src/server/lib/pine-artifact-schema.ts:28` | no non-test reference outside its own definition |
| `TesterTrade` | interface | `src/server/lib/pine-broker-reconcile.ts:24` | defining module is not reachable from any measured entry point |
| `BrokerTrade` | interface | `src/server/lib/pine-broker-reconcile.ts:37` | defining module is not reachable from any measured entry point |
| `MatchedPair` | interface | `src/server/lib/pine-broker-reconcile.ts:48` | defining module is not reachable from any measured entry point |
| `MatchResult` | interface | `src/server/lib/pine-broker-reconcile.ts:54` | defining module is not reachable from any measured entry point |
| `TradeReconciliation` | interface | `src/server/lib/pine-broker-reconcile.ts:61` | defining module is not reachable from any measured entry point |
| `ReconcileReport` | interface | `src/server/lib/pine-broker-reconcile.ts:81` | defining module is not reachable from any measured entry point |
| `ReconcileOpts` | interface | `src/server/lib/pine-broker-reconcile.ts:97` | defining module is not reachable from any measured entry point |
| `MatchOpts` | interface | `src/server/lib/pine-broker-reconcile.ts:104` | defining module is not reachable from any measured entry point |
| `TickSpec` | interface | `src/server/lib/pine-broker-reconcile.ts:109` | defining module is not reachable from any measured entry point |
| `getTickSpec` | function | `src/server/lib/pine-broker-reconcile.ts:131` | defining module is not reachable from any measured entry point |
| `parseStrategyTesterCsv` | function | `src/server/lib/pine-broker-reconcile.ts:224` | defining module is not reachable from any measured entry point |
| `matchTrades` | function | `src/server/lib/pine-broker-reconcile.ts:369` | defining module is not reachable from any measured entry point |
| `reconcile` | function | `src/server/lib/pine-broker-reconcile.ts:438` | defining module is not reachable from any measured entry point |
| `normalizeStrategyNamePy` | function | `src/server/lib/playbook-registration-backfill.ts:25` | defining module is not reachable from any measured entry point |
| `normalizeRegistryEntry` | function | `src/server/lib/playbook-registration-backfill.ts:37` | defining module is not reachable from any measured entry point |
| `BackfillStatus` | type | `src/server/lib/playbook-registration-backfill.ts:41` | defining module is not reachable from any measured entry point |
| `StrategyRowForBackfill` | interface | `src/server/lib/playbook-registration-backfill.ts:43` | defining module is not reachable from any measured entry point |
| `BackfillClassification` | interface | `src/server/lib/playbook-registration-backfill.ts:53` | defining module is not reachable from any measured entry point |
| `classifyStrategyForBackfill` | function | `src/server/lib/playbook-registration-backfill.ts:92` | defining module is not reachable from any measured entry point |
| `PlaybookCategory` | type | `src/server/lib/playbook-registration.ts:28` | defining module is not reachable from any measured entry point |
| `PLAYBOOK_CATEGORIES` | const | `src/server/lib/playbook-registration.ts:34` | defining module is not reachable from any measured entry point |
| `deriveCategoryFromArchetype` | function | `src/server/lib/playbook-registration.ts:53` | defining module is not reachable from any measured entry point |
| `ConditionSpecForCategory` | interface | `src/server/lib/playbook-registration.ts:78` | defining module is not reachable from any measured entry point |
| `deriveCategoryFromConditionSpec` | function | `src/server/lib/playbook-registration.ts:92` | defining module is not reachable from any measured entry point |
| `RegisterResult` | interface | `src/server/lib/playbook-registration.ts:108` | defining module is not reachable from any measured entry point |
| `RegistryReadCode` | type | `src/server/lib/playbook-registration.ts:133` | defining module is not reachable from any measured entry point |
| `RegistryRead` | interface | `src/server/lib/playbook-registration.ts:135` | defining module is not reachable from any measured entry point |
| `PlaybookRegistryReadError` | class | `src/server/lib/playbook-registration.ts:150` | defining module is not reachable from any measured entry point |
| `parseRegistry` | function | `src/server/lib/playbook-registration.ts:170` | defining module is not reachable from any measured entry point |
| `assertExactRead` | function | `src/server/lib/playbook-registration.ts:230` | defining module is not reachable from any measured entry point |
| `readAllRegisteredNames` | function | `src/server/lib/playbook-registration.ts:248` | defining module is not reachable from any measured entry point |
| `registerStrategiesInPlaybook` | function | `src/server/lib/playbook-registration.ts:287` | defining module is not reachable from any measured entry point |
| `ENGINE_VERSION` | const | `src/server/lib/provenance-stamp.ts:50` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `GATE_BATTERY_VERSION` | const | `src/server/lib/provenance-stamp.ts:68` | defining module is not reachable from any measured entry point |
| `computeOverlayConfigHash` | function | `src/server/lib/provenance-stamp.ts:184` | defining module is not reachable from any measured entry point |
| `buildDataSnapshotId` | function | `src/server/lib/provenance-stamp.ts:198` | defining module is not reachable from any measured entry point |
| `ProvenanceStamp` | interface | `src/server/lib/provenance-stamp.ts:211` | defining module is not reachable from any measured entry point |
| `ProvenanceStampOptions` | interface | `src/server/lib/provenance-stamp.ts:234` | defining module is not reachable from any measured entry point |
| `buildProvenanceStamp` | function | `src/server/lib/provenance-stamp.ts:263` | defining module is not reachable from any measured entry point |
| `ProvenanceValidationResult` | interface | `src/server/lib/provenance-stamp.ts:289` | defining module is not reachable from any measured entry point |
| `validateProvenanceStamp` | function | `src/server/lib/provenance-stamp.ts:311` | defining module is not reachable from any measured entry point |
| `isProvenanceEnforced` | function | `src/server/lib/provenance-stamp.ts:341` | defining module is not reachable from any measured entry point |
| `isLegacyBackfillAllowed` | function | `src/server/lib/provenance-stamp.ts:353` | defining module is not reachable from any measured entry point |
| `buildLegacyProvenanceStamp` | function | `src/server/lib/provenance-stamp.ts:364` | defining module is not reachable from any measured entry point |
| `ProvenanceStampError` | class | `src/server/lib/provenance-stamp.ts:394` | defining module is not reachable from any measured entry point |
| `assertProvenanceStamp` | function | `src/server/lib/provenance-stamp.ts:420` | defining module is not reachable from any measured entry point |
| `deriveSpecProvenanceRef` | function | `src/server/lib/provenance-stamp.ts:455` | defining module is not reachable from any measured entry point |
| `_resetCircuitBreakerForTests` | function | `src/server/lib/quantum-replay-runner.ts:244` | no non-test reference outside its own definition; 3 test file(s) do reference it |
| `_resetRlCircuitBreakerForTests` | function | `src/server/lib/quantum-rl-training-runner.ts:257` | no non-test reference outside its own definition; 2 test file(s) do reference it |
| `QuantumRunRequest` | type | `src/server/lib/quantum-run-schema.ts:20` | no non-test reference outside its own definition |
| `HybridCompareRequest` | type | `src/server/lib/quantum-run-schema.ts:21` | no non-test reference outside its own definition |
| `RankingEligibleTier` | type | `src/server/lib/replay-outcome.ts:73` | no non-test reference outside its own definition |
| `CONFLUENCE_THRESHOLD_CANDIDATES` | const | `src/server/lib/replay/confluence-disagreement.ts:58` | defining module is not reachable from any measured entry point |
| `ConfluenceThresholdCandidate` | type | `src/server/lib/replay/confluence-disagreement.ts:59` | no non-test reference outside its own definition |
| `DEFAULT_CONFLUENCE_THRESHOLD_UNDER_TEST` | const | `src/server/lib/replay/confluence-disagreement.ts:65` | defining module is not reachable from any measured entry point |
| `WINNER_REALIZED_R_FLOOR` | const | `src/server/lib/replay/confluence-disagreement.ts:71` | defining module is not reachable from any measured entry point |
| `IS_POSITIVE_RATE_SWEET_SPOT_LO` | const | `src/server/lib/replay/confluence-disagreement.ts:77` | defining module is not reachable from any measured entry point |
| `IS_POSITIVE_RATE_SWEET_SPOT_HI` | const | `src/server/lib/replay/confluence-disagreement.ts:78` | defining module is not reachable from any measured entry point |
| `CURVE_FIT_SDR_WARN_THRESHOLD` | const | `src/server/lib/replay/confluence-disagreement.ts:84` | defining module is not reachable from any measured entry point |
| `WEIGHT_PERTURBATION_PCT` | const | `src/server/lib/replay/confluence-disagreement.ts:89` | defining module is not reachable from any measured entry point |
| `ConfluenceReplayRow` | interface | `src/server/lib/replay/confluence-disagreement.ts:97` | defining module is not reachable from any measured entry point |
| `ConfluenceFoldMetrics` | interface | `src/server/lib/replay/confluence-disagreement.ts:118` | defining module is not reachable from any measured entry point |
| `ConfluenceThresholdResult` | interface | `src/server/lib/replay/confluence-disagreement.ts:137` | defining module is not reachable from any measured entry point |
| `CurveFitCheckResult` | interface | `src/server/lib/replay/confluence-disagreement.ts:147` | defining module is not reachable from any measured entry point |
| `ConfluenceAnalysisResult` | interface | `src/server/lib/replay/confluence-disagreement.ts:163` | defining module is not reachable from any measured entry point |
| `EvaluateConfluenceOptions` | interface | `src/server/lib/replay/confluence-disagreement.ts:182` | defining module is not reachable from any measured entry point |
| `CANONICAL_FACTOR_WEIGHTS` | const | `src/server/lib/replay/confluence-disagreement.ts:202` | defining module is not reachable from any measured entry point |
| `selectConfluenceThresholdFromIS` | function | `src/server/lib/replay/confluence-disagreement.ts:227` | defining module is not reachable from any measured entry point |
| `computeCurveFitCheck` | function | `src/server/lib/replay/confluence-disagreement.ts:291` | defining module is not reachable from any measured entry point |
| `evaluateConfluenceDisagreement` | function | `src/server/lib/replay/confluence-disagreement.ts:400` | defining module is not reachable from any measured entry point |
| `buildConfluenceMarkdownReport` | function | `src/server/lib/replay/confluence-disagreement.ts:615` | defining module is not reachable from any measured entry point |
| `DEFAULT_WARN_THRESHOLD_PCT` | const | `src/server/lib/replay/consistency-disagreement.ts:24` | defining module is not reachable from any measured entry point |
| `DEFAULT_BLOCK_THRESHOLD_PCT` | const | `src/server/lib/replay/consistency-disagreement.ts:27` | defining module is not reachable from any measured entry point |
| `FORWARD_LOOK_DAYS` | const | `src/server/lib/replay/consistency-disagreement.ts:33` | defining module is not reachable from any measured entry point |
| `MIN_OBSERVATIONS_FOR_FULL_ANALYSIS` | const | `src/server/lib/replay/consistency-disagreement.ts:36` | defining module is not reachable from any measured entry point |
| `THRESHOLD_STEP_PCT` | const | `src/server/lib/replay/consistency-disagreement.ts:42` | no non-test reference outside its own definition |
| `WARN_SWEEP_VALUES` | const | `src/server/lib/replay/consistency-disagreement.ts:44` | defining module is not reachable from any measured entry point |
| `BLOCK_SWEEP_VALUES` | const | `src/server/lib/replay/consistency-disagreement.ts:45` | defining module is not reachable from any measured entry point |
| `ConsistencyVerdict` | type | `src/server/lib/replay/consistency-disagreement.ts:47` | defining module is not reachable from any measured entry point |
| `DayAccountState` | interface | `src/server/lib/replay/consistency-disagreement.ts:59` | defining module is not reachable from any measured entry point |
| `ConsistencyConfusionMatrix` | interface | `src/server/lib/replay/consistency-disagreement.ts:82` | defining module is not reachable from any measured entry point |
| `ThresholdSweepResult` | interface | `src/server/lib/replay/consistency-disagreement.ts:96` | defining module is not reachable from any measured entry point |
| `ConsistencyAnalysisResult` | interface | `src/server/lib/replay/consistency-disagreement.ts:109` | defining module is not reachable from any measured entry point |
| `gateFiresAtThreshold` | function | `src/server/lib/replay/consistency-disagreement.ts:152` | defining module is not reachable from any measured entry point |
| `buildConsistencyMatrix` | function | `src/server/lib/replay/consistency-disagreement.ts:164` | defining module is not reachable from any measured entry point |
| `computePrecision` | function | `src/server/lib/replay/consistency-disagreement.ts:192` | defining module is not reachable from any measured entry point |
| `computeRecall` | function | `src/server/lib/replay/consistency-disagreement.ts:201` | defining module is not reachable from any measured entry point |
| `computeF1` | function | `src/server/lib/replay/consistency-disagreement.ts:210` | defining module is not reachable from any measured entry point |
| `computeThresholdSensitivity` | function | `src/server/lib/replay/consistency-disagreement.ts:225` | defining module is not reachable from any measured entry point |
| `selectOptimalThresholds` | function | `src/server/lib/replay/consistency-disagreement.ts:266` | defining module is not reachable from any measured entry point |
| `applyConsistencyDecisionRule` | function | `src/server/lib/replay/consistency-disagreement.ts:307` | defining module is not reachable from any measured entry point |
| `evaluateConsistencyGateSignal` | function | `src/server/lib/replay/consistency-disagreement.ts:328` | defining module is not reachable from any measured entry point |
| `buildConsistencyMarkdownReport` | function | `src/server/lib/replay/consistency-disagreement.ts:436` | defining module is not reachable from any measured entry point |
| `computeCorrelationBase` | function | `src/server/lib/replay/correlation-base.ts:38` | defining module is not reachable from any measured entry point |
| `GRADE_ORDER` | const | `src/server/lib/replay/critique-disagreement.ts:25` | defining module is not reachable from any measured entry point |
| `CritiqueGrade` | type | `src/server/lib/replay/critique-disagreement.ts:26` | defining module is not reachable from any measured entry point |
| `HIGH_GRADES` | const | `src/server/lib/replay/critique-disagreement.ts:28` | defining module is not reachable from any measured entry point |
| `LOW_GRADES` | const | `src/server/lib/replay/critique-disagreement.ts:29` | defining module is not reachable from any measured entry point |
| `MIN_CRITIQUES_FOR_FULL_ANALYSIS` | const | `src/server/lib/replay/critique-disagreement.ts:30` | defining module is not reachable from any measured entry point |
| `TRADING_DAYS_PER_YEAR` | const | `src/server/lib/replay/critique-disagreement.ts:33` | defining module is not reachable from any measured entry point |
| `PaperPositionRow` | interface | `src/server/lib/replay/critique-disagreement.ts:38` | defining module is not reachable from any measured entry point |
| `TradeCritiqueRow` | interface | `src/server/lib/replay/critique-disagreement.ts:46` | defining module is not reachable from any measured entry point |
| `ParameterHint` | interface | `src/server/lib/replay/critique-disagreement.ts:57` | defining module is not reachable from any measured entry point |
| `GradeStats` | interface | `src/server/lib/replay/critique-disagreement.ts:70` | defining module is not reachable from any measured entry point |
| `ParameterHintStats` | interface | `src/server/lib/replay/critique-disagreement.ts:78` | defining module is not reachable from any measured entry point |
| `CritiqueAnalysisResult` | interface | `src/server/lib/replay/critique-disagreement.ts:85` | defining module is not reachable from any measured entry point |
| `computeRollingSharpAfter` | function | `src/server/lib/replay/critique-disagreement.ts:110` | defining module is not reachable from any measured entry point |
| `computeSharpeFromRs` | function | `src/server/lib/replay/critique-disagreement.ts:130` | defining module is not reachable from any measured entry point |
| `aggregateByGrade` | function | `src/server/lib/replay/critique-disagreement.ts:146` | defining module is not reachable from any measured entry point |
| `mannWhitneyU` | function | `src/server/lib/replay/critique-disagreement.ts:220` | defining module is not reachable from any measured entry point |
| `normalCDF` | function | `src/server/lib/replay/critique-disagreement.ts:297` | defining module is not reachable from any measured entry point |
| `aggregateParameterHints` | function | `src/server/lib/replay/critique-disagreement.ts:311` | defining module is not reachable from any measured entry point |
| `applyCritiqueDecisionRule` | function | `src/server/lib/replay/critique-disagreement.ts:347` | defining module is not reachable from any measured entry point |
| `evaluateCritiqueGradeSignal` | function | `src/server/lib/replay/critique-disagreement.ts:366` | defining module is not reachable from any measured entry point |
| `buildCritiqueMarkdownReport` | function | `src/server/lib/replay/critique-disagreement.ts:430` | defining module is not reachable from any measured entry point |
| `ALL_TOOL_NAMES` | const | `src/server/lib/replay/harness-base.ts:27` | defining module is not reachable from any measured entry point |
| `ToolName` | type | `src/server/lib/replay/harness-base.ts:37` | defining module is not reachable from any measured entry point |
| `ReplayVerdict` | type | `src/server/lib/replay/harness-base.ts:40` | no non-test reference outside its own definition |
| `EXIT_SUCCESS` | const | `src/server/lib/replay/harness-base.ts:49` | no non-test reference outside its own definition |
| `EXIT_FAILURE` | const | `src/server/lib/replay/harness-base.ts:50` | no non-test reference outside its own definition |
| `ParsedArgs` | interface | `src/server/lib/replay/harness-base.ts:54` | defining module is not reachable from any measured entry point |
| `parseCLIArgs` | function | `src/server/lib/replay/harness-base.ts:75` | defining module is not reachable from any measured entry point |
| `validateToolName` | function | `src/server/lib/replay/harness-base.ts:102` | defining module is not reachable from any measured entry point |
| `resolveRepoRoot` | function | `src/server/lib/replay/harness-base.ts:120` | no non-test reference outside its own definition |
| `buildOutputPath` | function | `src/server/lib/replay/harness-base.ts:143` | defining module is not reachable from any measured entry point |
| `checkCpcvPurge` | function | `src/server/lib/replay/harness-base.ts:179` | defining module is not reachable from any measured entry point |
| `buildMarkdownHeader` | function | `src/server/lib/replay/harness-base.ts:209` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `buildMarkdownFooter` | function | `src/server/lib/replay/harness-base.ts:236` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `ToolSummary` | interface | `src/server/lib/replay/harness-base.ts:254` | defining module is not reachable from any measured entry point |
| `buildCombinedMarkdownReport` | function | `src/server/lib/replay/harness-base.ts:272` | defining module is not reachable from any measured entry point |
| `writeMarkdownReport` | function | `src/server/lib/replay/harness-base.ts:390` | defining module is not reachable from any measured entry point |
| `extractToolSummary` | function | `src/server/lib/replay/harness-base.ts:401` | defining module is not reachable from any measured entry point |
| `MIN_VERSIONS_FOR_FULL_ANALYSIS` | const | `src/server/lib/replay/pattern-aggregator-disagreement.ts:36` | defining module is not reachable from any measured entry point |
| `MIN_STRATEGIES_PER_VERSION` | const | `src/server/lib/replay/pattern-aggregator-disagreement.ts:39` | defining module is not reachable from any measured entry point |
| `SPEARMAN_SIGNAL_RHO` | const | `src/server/lib/replay/pattern-aggregator-disagreement.ts:42` | defining module is not reachable from any measured entry point |
| `SPEARMAN_SIGNAL_P` | const | `src/server/lib/replay/pattern-aggregator-disagreement.ts:45` | defining module is not reachable from any measured entry point |
| `MW_IMPROVEMENT_RATE_SIGNAL` | const | `src/server/lib/replay/pattern-aggregator-disagreement.ts:48` | defining module is not reachable from any measured entry point |
| `PatternAggregatorVerdict` | type | `src/server/lib/replay/pattern-aggregator-disagreement.ts:50` | defining module is not reachable from any measured entry point |
| `AppendixVersion` | interface | `src/server/lib/replay/pattern-aggregator-disagreement.ts:58` | defining module is not reachable from any measured entry point |
| `GeneratedStrategy` | interface | `src/server/lib/replay/pattern-aggregator-disagreement.ts:72` | defining module is not reachable from any measured entry point |
| `StrategySharpePnl` | interface | `src/server/lib/replay/pattern-aggregator-disagreement.ts:84` | no non-test reference outside its own definition |
| `VersionStats` | interface | `src/server/lib/replay/pattern-aggregator-disagreement.ts:95` | defining module is not reachable from any measured entry point |
| `ConsecutivePairResult` | interface | `src/server/lib/replay/pattern-aggregator-disagreement.ts:114` | defining module is not reachable from any measured entry point |
| `PatternAggregatorAnalysisResult` | interface | `src/server/lib/replay/pattern-aggregator-disagreement.ts:131` | defining module is not reachable from any measured entry point |
| `computeSharpe` | function | `src/server/lib/replay/pattern-aggregator-disagreement.ts:173` | defining module is not reachable from any measured entry point |
| `computeStd` | function | `src/server/lib/replay/pattern-aggregator-disagreement.ts:193` | defining module is not reachable from any measured entry point |
| `stdNormalCdf` | function | `src/server/lib/replay/pattern-aggregator-disagreement.ts:204` | defining module is not reachable from any measured entry point |
| `mannWhitneyU` | function | `src/server/lib/replay/pattern-aggregator-disagreement.ts:221` | defining module is not reachable from any measured entry point |
| `attributeStrategiesToVersions` | function | `src/server/lib/replay/pattern-aggregator-disagreement.ts:257` | defining module is not reachable from any measured entry point |
| `buildVersionStats` | function | `src/server/lib/replay/pattern-aggregator-disagreement.ts:290` | defining module is not reachable from any measured entry point |
| `computeConsecutivePairs` | function | `src/server/lib/replay/pattern-aggregator-disagreement.ts:332` | defining module is not reachable from any measured entry point |
| `applyPatternDecisionRule` | function | `src/server/lib/replay/pattern-aggregator-disagreement.ts:373` | defining module is not reachable from any measured entry point |
| `evaluatePatternAggregatorSignal` | function | `src/server/lib/replay/pattern-aggregator-disagreement.ts:403` | defining module is not reachable from any measured entry point |
| `buildPatternAggregatorMarkdownReport` | function | `src/server/lib/replay/pattern-aggregator-disagreement.ts:510` | defining module is not reachable from any measured entry point |
| `THRESHOLD_CANDIDATES` | const | `src/server/lib/replay/quantum-disagreement.ts:23` | defining module is not reachable from any measured entry point |
| `ThresholdCandidate` | type | `src/server/lib/replay/quantum-disagreement.ts:24` | no non-test reference outside its own definition |
| `SHARPE_DEGRADATION_FLOOR` | const | `src/server/lib/replay/quantum-disagreement.ts:26` | defining module is not reachable from any measured entry point |
| `IS_POSITIVE_RATE_SWEET_SPOT_LO` | const | `src/server/lib/replay/quantum-disagreement.ts:27` | defining module is not reachable from any measured entry point |
| `IS_POSITIVE_RATE_SWEET_SPOT_HI` | const | `src/server/lib/replay/quantum-disagreement.ts:28` | defining module is not reachable from any measured entry point |
| `MIN_FOLDS_FOR_FULL_ANALYSIS` | const | `src/server/lib/replay/quantum-disagreement.ts:29` | defining module is not reachable from any measured entry point |
| `EMBARGO_TRADING_DAYS` | const | `src/server/lib/replay/quantum-disagreement.ts:30` | defining module is not reachable from any measured entry point |
| `FoldMetrics` | interface | `src/server/lib/replay/quantum-disagreement.ts:34` | defining module is not reachable from any measured entry point |
| `ThresholdResult` | interface | `src/server/lib/replay/quantum-disagreement.ts:50` | defining module is not reachable from any measured entry point |
| `AnalysisResult` | interface | `src/server/lib/replay/quantum-disagreement.ts:57` | defining module is not reachable from any measured entry point |
| `computeSpearman` | function | `src/server/lib/replay/quantum-disagreement.ts:84` | defining module is not reachable from any measured entry point |
| `tDistributionPValue` | function | `src/server/lib/replay/quantum-disagreement.ts:151` | defining module is not reachable from any measured entry point |
| `regularizedIncompleteBeta` | function | `src/server/lib/replay/quantum-disagreement.ts:161` | defining module is not reachable from any measured entry point |
| `logGamma` | function | `src/server/lib/replay/quantum-disagreement.ts:214` | defining module is not reachable from any measured entry point |
| `binomialTestPValue` | function | `src/server/lib/replay/quantum-disagreement.ts:245` | defining module is not reachable from any measured entry point |
| `selectThresholdFromIS` | function | `src/server/lib/replay/quantum-disagreement.ts:262` | defining module is not reachable from any measured entry point |
| `checkPurgeViolation` | function | `src/server/lib/replay/quantum-disagreement.ts:319` | defining module is not reachable from any measured entry point |
| `applyEmbargo` | function | `src/server/lib/replay/quantum-disagreement.ts:334` | defining module is not reachable from any measured entry point |
| `computeSharpeFromTrades` | function | `src/server/lib/replay/quantum-disagreement.ts:360` | defining module is not reachable from any measured entry point |
| `computeProfitFactor` | function | `src/server/lib/replay/quantum-disagreement.ts:372` | defining module is not reachable from any measured entry point |
| `applyDecisionRule` | function | `src/server/lib/replay/quantum-disagreement.ts:390` | defining module is not reachable from any measured entry point |
| `buildMarkdownReport` | function | `src/server/lib/replay/quantum-disagreement.ts:419` | defining module is not reachable from any measured entry point |
| `B15_SDR_THRESHOLD` | const | `src/server/lib/replay/robustness-disagreement.ts:17` | defining module is not reachable from any measured entry point |
| `B15_PSI_THRESHOLD` | const | `src/server/lib/replay/robustness-disagreement.ts:18` | defining module is not reachable from any measured entry point |
| `B15_RWS_THRESHOLD` | const | `src/server/lib/replay/robustness-disagreement.ts:19` | defining module is not reachable from any measured entry point |
| `SENSITIVITY_MULTIPLIERS` | const | `src/server/lib/replay/robustness-disagreement.ts:25` | defining module is not reachable from any measured entry point |
| `MIN_STRATEGIES_FOR_FULL_ANALYSIS` | const | `src/server/lib/replay/robustness-disagreement.ts:28` | defining module is not reachable from any measured entry point |
| `FAILURE_STATES` | const | `src/server/lib/replay/robustness-disagreement.ts:34` | defining module is not reachable from any measured entry point |
| `SUCCESS_STATES` | const | `src/server/lib/replay/robustness-disagreement.ts:40` | defining module is not reachable from any measured entry point |
| `DEMOTION_WINDOW_DAYS` | const | `src/server/lib/replay/robustness-disagreement.ts:45` | defining module is not reachable from any measured entry point |
| `BacktestRow` | interface | `src/server/lib/replay/robustness-disagreement.ts:49` | defining module is not reachable from any measured entry point |
| `LifecycleOutcomeRow` | interface | `src/server/lib/replay/robustness-disagreement.ts:67` | defining module is not reachable from any measured entry point |
| `ConfusionMatrix` | interface | `src/server/lib/replay/robustness-disagreement.ts:77` | defining module is not reachable from any measured entry point |
| `PerThresholdResult` | interface | `src/server/lib/replay/robustness-disagreement.ts:88` | defining module is not reachable from any measured entry point |
| `RobustnessAnalysisResult` | interface | `src/server/lib/replay/robustness-disagreement.ts:105` | defining module is not reachable from any measured entry point |
| `classifyOutcome` | function | `src/server/lib/replay/robustness-disagreement.ts:146` | defining module is not reachable from any measured entry point |
| `isBlockedByB15` | function | `src/server/lib/replay/robustness-disagreement.ts:159` | defining module is not reachable from any measured entry point |
| `buildConfusionMatrix` | function | `src/server/lib/replay/robustness-disagreement.ts:179` | defining module is not reachable from any measured entry point |
| `computePrecision` | function | `src/server/lib/replay/robustness-disagreement.ts:225` | defining module is not reachable from any measured entry point |
| `computeRecall` | function | `src/server/lib/replay/robustness-disagreement.ts:231` | defining module is not reachable from any measured entry point |
| `computeF1` | function | `src/server/lib/replay/robustness-disagreement.ts:237` | defining module is not reachable from any measured entry point |
| `computeThresholdSensitivity` | function | `src/server/lib/replay/robustness-disagreement.ts:252` | defining module is not reachable from any measured entry point |
| `selectOptimalThresholds` | function | `src/server/lib/replay/robustness-disagreement.ts:298` | defining module is not reachable from any measured entry point |
| `applyB15DecisionRule` | function | `src/server/lib/replay/robustness-disagreement.ts:335` | defining module is not reachable from any measured entry point |
| `deriveRecommendation` | function | `src/server/lib/replay/robustness-disagreement.ts:352` | defining module is not reachable from any measured entry point |
| `evaluateRobustnessGateSignal` | function | `src/server/lib/replay/robustness-disagreement.ts:382` | defining module is not reachable from any measured entry point |
| `buildRobustnessMarkdownReport` | function | `src/server/lib/replay/robustness-disagreement.ts:466` | defining module is not reachable from any measured entry point |
| `SUPPORTED_FIRMS` | const | `src/server/lib/replay/survival-twin-disagreement.ts:49` | defining module is not reachable from any measured entry point |
| `SupportedFirm` | type | `src/server/lib/replay/survival-twin-disagreement.ts:50` | defining module is not reachable from any measured entry point |
| `CROSS_METHOD_AGREEMENT_MIN_R` | const | `src/server/lib/replay/survival-twin-disagreement.ts:53` | no non-test reference outside its own definition |
| `MW_MIN_N_PER_FIRM` | const | `src/server/lib/replay/survival-twin-disagreement.ts:56` | defining module is not reachable from any measured entry point |
| `SurvivalVerdict` | type | `src/server/lib/replay/survival-twin-disagreement.ts:59` | defining module is not reachable from any measured entry point |
| `SurvivalFoldMetrics` | interface | `src/server/lib/replay/survival-twin-disagreement.ts:63` | defining module is not reachable from any measured entry point |
| `FirmDistribution` | interface | `src/server/lib/replay/survival-twin-disagreement.ts:90` | defining module is not reachable from any measured entry point |
| `MannWhitneyResult` | interface | `src/server/lib/replay/survival-twin-disagreement.ts:97` | defining module is not reachable from any measured entry point |
| `CrossMethodAgreementResult` | interface | `src/server/lib/replay/survival-twin-disagreement.ts:107` | defining module is not reachable from any measured entry point |
| `SurvivalTwinAnalysisResult` | interface | `src/server/lib/replay/survival-twin-disagreement.ts:121` | defining module is not reachable from any measured entry point |
| `computePearson` | function | `src/server/lib/replay/survival-twin-disagreement.ts:159` | defining module is not reachable from any measured entry point |
| `mannWhitneyU` | function | `src/server/lib/replay/survival-twin-disagreement.ts:192` | defining module is not reachable from any measured entry point |
| `stdNormalCdf` | function | `src/server/lib/replay/survival-twin-disagreement.ts:234` | defining module is not reachable from any measured entry point |
| `computeCrossMethodAgreement` | function | `src/server/lib/replay/survival-twin-disagreement.ts:255` | defining module is not reachable from any measured entry point |
| `computePerFirmMannWhitney` | function | `src/server/lib/replay/survival-twin-disagreement.ts:345` | defining module is not reachable from any measured entry point |
| `applySurvivalDecisionRule` | function | `src/server/lib/replay/survival-twin-disagreement.ts:388` | defining module is not reachable from any measured entry point |
| `buildSurvivalTwinReport` | function | `src/server/lib/replay/survival-twin-disagreement.ts:405` | defining module is not reachable from any measured entry point |
| `RlTrainingRow` | interface | `src/server/lib/rl-training-cpcv-gate.ts:38` | defining module is not reachable from any measured entry point |
| `OosFold` | interface | `src/server/lib/rl-training-cpcv-gate.ts:52` | defining module is not reachable from any measured entry point |
| `RlCpcvGateResult` | interface | `src/server/lib/rl-training-cpcv-gate.ts:64` | defining module is not reachable from any measured entry point |
| `validateRlTrainingCpcvPurge` | function | `src/server/lib/rl-training-cpcv-gate.ts:144` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `SubsystemName` | type | `src/server/lib/score-normalization.ts:27` | defining module is not reachable from any measured entry point |
| `SubsystemScores` | type | `src/server/lib/score-normalization.ts:43` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `CompositeResult` | interface | `src/server/lib/score-normalization.ts:45` | defining module is not reachable from any measured entry point |
| `VerdictLabel` | type | `src/server/lib/score-normalization.ts:58` | defining module is not reachable from any measured entry point |
| `MIN_AVAILABLE_FOR_COMPOSITE` | const | `src/server/lib/score-normalization.ts:66` | defining module is not reachable from any measured entry point |
| `VERDICT_HEALTHY_THRESHOLD` | const | `src/server/lib/score-normalization.ts:69` | defining module is not reachable from any measured entry point |
| `VERDICT_MARGINAL_THRESHOLD` | const | `src/server/lib/score-normalization.ts:72` | defining module is not reachable from any measured entry point |
| `VERDICT_UNHEALTHY_THRESHOLD` | const | `src/server/lib/score-normalization.ts:75` | defining module is not reachable from any measured entry point |
| `B14_CI_HIGH_DOMAIN_MAX` | const | `src/server/lib/score-normalization.ts:79` | no non-test reference outside its own definition |
| `WFE_CLIP_MAX` | const | `src/server/lib/score-normalization.ts:83` | defining module is not reachable from any measured entry point |
| `B15_PSI_SCALE` | const | `src/server/lib/score-normalization.ts:87` | defining module is not reachable from any measured entry point |
| `B15_RWS_SCALE` | const | `src/server/lib/score-normalization.ts:89` | defining module is not reachable from any measured entry point |
| `DEEPAR_DEFAULT_THRESHOLD` | const | `src/server/lib/score-normalization.ts:93` | defining module is not reachable from any measured entry point |
| `CONSISTENCY_LOWER_BOUND` | const | `src/server/lib/score-normalization.ts:97` | defining module is not reachable from any measured entry point |
| `CONSISTENCY_UPPER_BOUND` | const | `src/server/lib/score-normalization.ts:99` | defining module is not reachable from any measured entry point |
| `EQUAL_WEIGHTS` | const | `src/server/lib/score-normalization.ts:115` | defining module is not reachable from any measured entry point |
| `normalizeB14SurvivalTwin` | function | `src/server/lib/score-normalization.ts:138` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `normalizeWfe` | function | `src/server/lib/score-normalization.ts:150` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `normalizeParameterDrift` | function | `src/server/lib/score-normalization.ts:166` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `normalizeB15Robustness` | function | `src/server/lib/score-normalization.ts:193` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `normalizeCompliance` | function | `src/server/lib/score-normalization.ts:209` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `normalizeTradeCritique` | function | `src/server/lib/score-normalization.ts:234` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `normalizePatternAggregator` | function | `src/server/lib/score-normalization.ts:252` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `normalizeConsistencyTracker` | function | `src/server/lib/score-normalization.ts:274` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `normalizeDeepAr` | function | `src/server/lib/score-normalization.ts:290` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `normalizeBlackSwan` | function | `src/server/lib/score-normalization.ts:304` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `normalizeNemo` | function | `src/server/lib/score-normalization.ts:316` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `normalizeQuantumReplay` | function | `src/server/lib/score-normalization.ts:341` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `normalizeRLConfidence` | function | `src/server/lib/score-normalization.ts:370` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `computeComposite` | function | `src/server/lib/score-normalization.ts:398` | defining module is not reachable from any measured entry point |
| `computeWeightsVersionId` | function | `src/server/lib/score-normalization.ts:492` | defining module is not reachable from any measured entry point |
| `EQUAL_WEIGHTS_VERSION_ID` | const | `src/server/lib/score-normalization.ts:508` | defining module is not reachable from any measured entry point |
| `verdictFromComposite` | function | `src/server/lib/score-normalization.ts:529` | defining module is not reachable from any measured entry point |
| `AuditRow` | interface | `src/server/lib/shadow-evidence-analyzer.ts:51` | defining module is not reachable from any measured entry point |
| `ShadowVerdict` | type | `src/server/lib/shadow-evidence-analyzer.ts:58` | defining module is not reachable from any measured entry point |
| `AgreementCounts` | interface | `src/server/lib/shadow-evidence-analyzer.ts:64` | defining module is not reachable from any measured entry point |
| `ConfusionMatrix` | interface | `src/server/lib/shadow-evidence-analyzer.ts:73` | defining module is not reachable from any measured entry point |
| `PerStrategyStats` | interface | `src/server/lib/shadow-evidence-analyzer.ts:84` | defining module is not reachable from any measured entry point |
| `AnalysisResult` | interface | `src/server/lib/shadow-evidence-analyzer.ts:91` | defining module is not reachable from any measured entry point |
| `DEFAULT_WINDOW_DAYS` | const | `src/server/lib/shadow-evidence-analyzer.ts:117` | defining module is not reachable from any measured entry point |
| `DEFAULT_MIN_SAMPLE` | const | `src/server/lib/shadow-evidence-analyzer.ts:118` | defining module is not reachable from any measured entry point |
| `AGREEMENT_ACTIVATE_THRESHOLD` | const | `src/server/lib/shadow-evidence-analyzer.ts:119` | defining module is not reachable from any measured entry point |
| `AGREEMENT_INCONCLUSIVE_THRESHOLD` | const | `src/server/lib/shadow-evidence-analyzer.ts:120` | defining module is not reachable from any measured entry point |
| `analyzeShadowEvidence` | function | `src/server/lib/shadow-evidence-analyzer.ts:131` | defining module is not reachable from any measured entry point |
| `buildMarkdownReport` | function | `src/server/lib/shadow-evidence-analyzer.ts:352` | defining module is not reachable from any measured entry point |
| `getSlippageSurvivalMultiples` | function | `src/server/lib/slippage-survival-gate.ts:131` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `getSlippageSurvivalMinPf` | function | `src/server/lib/slippage-survival-gate.ts:153` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `getSlippageSurvivalMinTrades` | function | `src/server/lib/slippage-survival-gate.ts:172` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `MenuChampion` | interface | `src/server/lib/slumhouse/menu-data.ts:32` | defining module is not reachable from any measured entry point |
| `KitchenVariant` | interface | `src/server/lib/slumhouse/menu-data.ts:44` | defining module is not reachable from any measured entry point |
| `KitchenMenuFamily` | interface | `src/server/lib/slumhouse/menu-data.ts:49` | defining module is not reachable from any measured entry point |
| `GraveyardVariant` | interface | `src/server/lib/slumhouse/menu-data.ts:56` | defining module is not reachable from any measured entry point |
| `GraveyardFamily` | interface | `src/server/lib/slumhouse/menu-data.ts:60` | defining module is not reachable from any measured entry point |
| `assembleNowServing` | function | `src/server/lib/slumhouse/menu-data.ts:106` | defining module is not reachable from any measured entry point |
| `assembleDeployReady` | function | `src/server/lib/slumhouse/menu-data.ts:120` | defining module is not reachable from any measured entry point |
| `assembleKitchenMenu` | function | `src/server/lib/slumhouse/menu-data.ts:127` | defining module is not reachable from any measured entry point |
| `assembleGraveyardMenu` | function | `src/server/lib/slumhouse/menu-data.ts:144` | defining module is not reachable from any measured entry point |
| `NamedStrategyRow` | interface | `src/server/lib/slumhouse/premium-names.ts:1` | defining module is not reachable from any measured entry point |
| `PREMIUM_NAMES` | const | `src/server/lib/slumhouse/premium-names.ts:10` | defining module is not reachable from any measured entry point |
| `familyKeyFor` | function | `src/server/lib/slumhouse/premium-names.ts:38` | defining module is not reachable from any measured entry point |
| `resolvePremiumName` | function | `src/server/lib/slumhouse/premium-names.ts:47` | defining module is not reachable from any measured entry point |
| `LIFECYCLE_ORDER` | const | `src/server/lib/slumhouse/strategy-families.ts:3` | defining module is not reachable from any measured entry point |
| `FamilyRow` | interface | `src/server/lib/slumhouse/strategy-families.ts:7` | defining module is not reachable from any measured entry point |
| `Variant` | interface | `src/server/lib/slumhouse/strategy-families.ts:8` | defining module is not reachable from any measured entry point |
| `Family` | interface | `src/server/lib/slumhouse/strategy-families.ts:9` | defining module is not reachable from any measured entry point |
| `groupIntoFamilies` | function | `src/server/lib/slumhouse/strategy-families.ts:11` | defining module is not reachable from any measured entry point |
| `betSize` | function | `src/server/lib/slumhouse/translate.ts:69` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `KNOWN_ARCHETYPE_KEYS` | const | `src/server/lib/spec-archetype-matcher.ts:31` | defining module is not reachable from any measured entry point |
| `KnownArchetypeKey` | type | `src/server/lib/spec-archetype-matcher.ts:73` | defining module is not reachable from any measured entry point |
| `SpecEntryConditionLike` | interface | `src/server/lib/spec-archetype-matcher.ts:123` | defining module is not reachable from any measured entry point |
| `ArchetypeMatchResult` | interface | `src/server/lib/spec-archetype-matcher.ts:129` | defining module is not reachable from any measured entry point |
| `matchArchetype` | function | `src/server/lib/spec-archetype-matcher.ts:145` | defining module is not reachable from any measured entry point |
| `SpecTimeframeRecovery` | interface | `src/server/lib/spec-timeframe-recovery.ts:19` | defining module is not reachable from any measured entry point |
| `extractTimeframeMinutes` | function | `src/server/lib/spec-timeframe-recovery.ts:95` | defining module is not reachable from any measured entry point |
| `recoverSpecTimeframe` | function | `src/server/lib/spec-timeframe-recovery.ts:231` | defining module is not reachable from any measured entry point |
| `stopBootConfigReminderMonitor` | function | `src/server/lib/startup-config-check.ts:1207` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `StyleCCbTelemetry` | interface | `src/server/lib/style-c-exit-evaluator.ts:232` | no non-test reference outside its own definition |
| `SystemMapCheckResult` | interface | `src/server/lib/system-topology.ts:340` | no non-test reference outside its own definition |
| `renderGeneratedTopologySection` | function | `src/server/lib/system-topology.ts:2091` | no non-test reference outside its own definition |
| `extractClaimsDeterministically` | function | `src/server/lib/transcript-extractor-recall.ts:200` | no non-test reference outside its own definition |
| `getAuctionDates` | function | `src/server/lib/treasury-auction-calendar.ts:137` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `Wave23fTraceRow` | interface | `src/server/lib/wave23f-trace.ts:20` | defining module is not reachable from any measured entry point |
| `traceWave23fCycle` | function | `src/server/lib/wave23f-trace.ts:45` | defining module is not reachable from any measured entry point |
| `summarizeWave23fCycle` | function | `src/server/lib/wave23f-trace.ts:77` | no non-test reference outside its own definition |
| `deriveBiasTimeframe` | function | `src/server/lib/wave25-strategy-defaults.ts:123` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/server/middleware</code> - 5 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `_clearEpochCacheForTests` | function | `src/server/middleware/auth.ts:25` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `getSloMetrics` | function | `src/server/middleware/request-logger.ts:23` | no non-test reference outside its own definition |
| `requestLogger` | function | `src/server/middleware/request-logger.ts:40` | no non-test reference outside its own definition |
| `validateBody` | function | `src/server/middleware/validate.ts:34` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `validateQuery` | function | `src/server/middleware/validate.ts:55` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/server/production</code> - 4 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `LAYER7_AUDIT_GENERATES_CORRELATION_ID` | const | `src/server/production/kill-switch.ts:90` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `ALL_LAYERS_ENFORCED_ON_SIGNAL_PATH` | const | `src/server/production/kill-switch.ts:94` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `_setForceCloseInFlightForTests` | function | `src/server/production/kill-switch.ts:1531` | no non-test reference outside its own definition; 2 test file(s) do reference it |
| `_getForceCloseInFlightForTests` | function | `src/server/production/kill-switch.ts:1549` | no non-test reference outside its own definition; 2 test file(s) do reference it |

</details>

<details><summary><code>src/server/routes</code> - 9 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `_invalidateStatusCacheForTests` | function | `src/server/routes/production-status.ts:108` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `PaperExitEventName` | type | `src/server/routes/sse.ts:301` | no non-test reference outside its own definition |
| `FactoryEventName` | type | `src/server/routes/sse.ts:339` | no non-test reference outside its own definition |
| `FactoryGraduationEntryQualityPayload` | interface | `src/server/routes/sse.ts:344` | no non-test reference outside its own definition |
| `FactoryMultiMarketBucketPayload` | interface | `src/server/routes/sse.ts:355` | no non-test reference outside its own definition |
| `Wave29EventName` | type | `src/server/routes/sse.ts:405` | no non-test reference outside its own definition |
| `ArchetypeRoutingEventName` | type | `src/server/routes/sse.ts:440` | no non-test reference outside its own definition |
| `LifecycleGateEventName` | type | `src/server/routes/sse.ts:524` | no non-test reference outside its own definition |
| `PineEventName` | type | `src/server/routes/sse.ts:564` | no non-test reference outside its own definition |

</details>

<details><summary><code>src/server/scheduler.ts</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `_testOnly` | const | `src/server/scheduler.ts:746` | no non-test reference outside its own definition; 5 test file(s) do reference it |

</details>

<details><summary><code>src/server/services</code> - 199 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `getAdvisoryContext` | function | `src/server/services/a-plus-auditor-service.ts:373` | no non-test reference outside its own definition |
| `computeDeltaDivDecision` | function | `src/server/services/adaptive-exit-engine.ts:476` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `auditDeltaDivEarlyExit` | function | `src/server/services/adaptive-exit-engine.ts:680` | no non-test reference outside its own definition |
| `auditPreLunchExit` | function | `src/server/services/adaptive-exit-engine.ts:704` | no non-test reference outside its own definition |
| `__resetScoutAuditorBudgetForTests` | function | `src/server/services/agent-service.ts:54` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `__resetRejectSpikeStateForTests` | function | `src/server/services/agent-service.ts:113` | no non-test reference outside its own definition |
| `__resetDslCriticBudgetForTests` | function | `src/server/services/agent-service.ts:135` | no non-test reference outside its own definition; 3 test file(s) do reference it |
| `__resetCriticFailOpenDiscordForTests` | function | `src/server/services/agent-service.ts:152` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `populateAntiSetupCache` | function | `src/server/services/anti-setup-gate-service.ts:256` | no non-test reference outside its own definition |
| `TITLE_SCORE_ELIGIBILITY_THRESHOLD` | const | `src/server/services/autonomous-scout-runner.ts:643` | no non-test reference outside its own definition |
| `BIAS_HARNESS_CONFIG` | const | `src/server/services/bias-calibration-harness.ts:27` | defining module is not reachable from any measured entry point |
| `CalibrationCurve` | interface | `src/server/services/bias-calibration-harness.ts:36` | defining module is not reachable from any measured entry point |
| `AblationResult` | interface | `src/server/services/bias-calibration-harness.ts:45` | defining module is not reachable from any measured entry point |
| `fitCalibration` | function | `src/server/services/bias-calibration-harness.ts:69` | defining module is not reachable from any measured entry point |
| `runAblation` | function | `src/server/services/bias-calibration-harness.ts:194` | defining module is not reachable from any measured entry point |
| `computePbo` | function | `src/server/services/bias-calibration-harness.ts:278` | defining module is not reachable from any measured entry point |
| `BiasSymbol` | type | `src/server/services/bias-state-service.ts:126` | no non-test reference outside its own definition |
| `__resetDailyBiasCacheForTests` | function | `src/server/services/bias-state-service.ts:158` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `_resetAnalystLockForTest` | function | `src/server/services/carter-analyst-service.ts:110` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `_resetWatcherForTest` | function | `src/server/services/carter-issue-watcher.ts:237` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `_handleSseEventForTest` | function | `src/server/services/carter-issue-watcher.ts:242` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `CloudQmcRunStatus` | interface | `src/server/services/cloud-qmc-service.ts:91` | no non-test reference outside its own definition |
| `getLatestCloudQmcRun` | function | `src/server/services/cloud-qmc-service.ts:734` | no non-test reference outside its own definition |
| `_TEST_ONLY_buildReportFromRows` | function | `src/server/services/cohort-audit-report-service.ts:412` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `clearInstanceConfigCache` | function | `src/server/services/compliance-gate-service.ts:36` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `getInstanceEnabledFirms` | function | `src/server/services/compliance-gate-service.ts:55` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `validateEnabledFirms` | function | `src/server/services/compliance-gate-service.ts:132` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `warnMissingThresholds` | function | `src/server/services/confirming-indicator-evaluator.ts:29` | no non-test reference outside its own definition |
| `W_CROSS_ASSET_ALIGNED_MCL` | const | `src/server/services/confluence-score.ts:68` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `evalMarketStructureAligned_TEST_ONLY` | const | `src/server/services/confluence-score.ts:511` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `_invalidateConsistencyCache` | function | `src/server/services/consistency-tracker-service.ts:736` | no non-test reference outside its own definition; 3 test file(s) do reference it |
| `clearDailyCache` | function | `src/server/services/context-gate-service.ts:350` | no non-test reference outside its own definition |
| `getAllContractSpecs` | function | `src/server/services/contract-specs-service.ts:114` | no non-test reference outside its own definition |
| `__resetCorrelationMatrixForTests` | function | `src/server/services/correlated-position-guard.ts:132` | no non-test reference outside its own definition; 3 test file(s) do reference it |
| `triggerCriticOptimizerAsync` | function | `src/server/services/critic-optimizer-service.ts:569` | no non-test reference outside its own definition |
| `__clearCritiqueKbCacheForTests` | function | `src/server/services/critique-knowledge-retriever.ts:85` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `PRIOR_OBSERVATIONS_HEADER` | const | `src/server/services/critique-knowledge-retriever.ts:180` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `DLL_WARN_80PCT` | const | `src/server/services/cross-symbol-pnl.ts:301` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `getSnapshotDirSummary` | function | `src/server/services/dashboard-snapshot-service.ts:235` | no non-test reference outside its own definition |
| `getSessionPeakEquity` | function | `src/server/services/dd-velocity-gate.ts:284` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `__resetEquityWindowsForTests` | function | `src/server/services/dd-velocity-gate.ts:292` | no non-test reference outside its own definition; 3 test file(s) do reference it |
| `__injectEquitySamplesForTests` | function | `src/server/services/dd-velocity-gate.ts:309` | no non-test reference outside its own definition; 3 test file(s) do reference it |
| `getLastAlertFiredAt` | function | `src/server/services/dead-mans-heartbeat-service.ts:882` | no non-test reference outside its own definition |
| `getDeepARWeightAsync` | function | `src/server/services/deepar-service.ts:876` | no non-test reference outside its own definition |
| `getDiscordAuditLastRanAt` | function | `src/server/services/discord-fanout-audit-service.ts:126` | no non-test reference outside its own definition |
| `detectStructuralBreaks` | function | `src/server/services/drift-detection-service.ts:177` | no non-test reference outside its own definition |
| `calculateRollingSharpe` | function | `src/server/services/drift-detection-service.ts:328` | no non-test reference outside its own definition |
| `isPythonStrategy` | function | `src/server/services/dsl-translator.ts:108` | no non-test reference outside its own definition |
| `checkBrokerConnectivity` | function | `src/server/services/exchange-status-service.ts:80` | no non-test reference outside its own definition |
| `getActiveOutages` | function | `src/server/services/exchange-status-service.ts:341` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `simulateOutage` | function | `src/server/services/exchange-status-service.ts:350` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `resolveOutage` | function | `src/server/services/exchange-status-service.ts:412` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `ParameterProvenance` | type | `src/server/services/executable-parameter-contract.ts:38` | defining module is not reachable from any measured entry point |
| `ParameterBlockCode` | type | `src/server/services/executable-parameter-contract.ts:51` | defining module is not reachable from any measured entry point |
| `UpstreamParameterStatus` | type | `src/server/services/executable-parameter-contract.ts:73` | defining module is not reachable from any measured entry point |
| `ContractMode` | type | `src/server/services/executable-parameter-contract.ts:91` | defining module is not reachable from any measured entry point |
| `SourceParameter` | interface | `src/server/services/executable-parameter-contract.ts:96` | defining module is not reachable from any measured entry point |
| `ParameterSpec` | interface | `src/server/services/executable-parameter-contract.ts:112` | defining module is not reachable from any measured entry point |
| `ContractResult` | type | `src/server/services/executable-parameter-contract.ts:119` | defining module is not reachable from any measured entry point |
| `resolveExecutableParameters` | function | `src/server/services/executable-parameter-contract.ts:162` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `isOutsideAdvisoryRange` | function | `src/server/services/executable-parameter-contract.ts:309` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `CohortMetrics` | interface | `src/server/services/fade-the-losers-service.ts:198` | defining module is not reachable from any measured entry point |
| `extractCohortMetrics` | function | `src/server/services/fade-the-losers-service.ts:204` | defining module is not reachable from any measured entry point |
| `classifyDirectionality` | function | `src/server/services/fade-the-losers-service.ts:260` | defining module is not reachable from any measured entry point |
| `SkipReason` | type | `src/server/services/fade-the-losers-service.ts:284` | defining module is not reachable from any measured entry point |
| `CohortMember` | interface | `src/server/services/fade-the-losers-service.ts:290` | defining module is not reachable from any measured entry point |
| `CohortSkip` | interface | `src/server/services/fade-the-losers-service.ts:303` | defining module is not reachable from any measured entry point |
| `CohortSelection` | interface | `src/server/services/fade-the-losers-service.ts:310` | defining module is not reachable from any measured entry point |
| `SymbolCode` | type | `src/server/services/fade-the-losers-service.ts:316` | defining module is not reachable from any measured entry point |
| `selectFadeCohort` | function | `src/server/services/fade-the-losers-service.ts:356` | defining module is not reachable from any measured entry point |
| `CreateStatus` | type | `src/server/services/fade-the-losers-service.ts:456` | defining module is not reachable from any measured entry point |
| `FadeCreateResult` | interface | `src/server/services/fade-the-losers-service.ts:466` | defining module is not reachable from any measured entry point |
| `RunFadeOptions` | interface | `src/server/services/fade-the-losers-service.ts:476` | defining module is not reachable from any measured entry point |
| `RunFadeResult` | interface | `src/server/services/fade-the-losers-service.ts:488` | defining module is not reachable from any measured entry point |
| `runFadeTheLosers` | function | `src/server/services/fade-the-losers-service.ts:725` | defining module is not reachable from any measured entry point |
| `loadSeedPriorsIfEmpty` | function | `src/server/services/firm-adversarial-event-service.ts:366` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `listAllPriors` | function | `src/server/services/firm-adversarial-event-service.ts:437` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `__frameworkDefaults` | const | `src/server/services/framework-overlay.ts:533` | no non-test reference outside its own definition |
| `DriftSummary` | interface | `src/server/services/graduated-strategy-drift-checker.ts:23` | defining module is not reachable from any measured entry point |
| `runGraduatedStrategyDriftCheck` | function | `src/server/services/graduated-strategy-drift-checker.ts:31` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `getAvoidancePatterns` | function | `src/server/services/graveyard-intelligence-service.ts:154` | no non-test reference outside its own definition |
| `getPromotedAtFromTransitions` | function | `src/server/services/lifecycle-service.ts:8045` | no non-test reference outside its own definition |
| `markLevelTouched` | function | `src/server/services/liquidity-map-service.ts:576` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `expireOldLevels` | function | `src/server/services/liquidity-map-service.ts:605` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `startInternalsSubscription` | function | `src/server/services/market-internals-service.ts:154` | no non-test reference outside its own definition |
| `__resetInternalsForTests` | function | `src/server/services/market-internals-service.ts:274` | no non-test reference outside its own definition; 3 test file(s) do reference it |
| `__injectInternalsReading` | function | `src/server/services/market-internals-service.ts:287` | no non-test reference outside its own definition; 2 test file(s) do reference it |
| `setOllamaUnhealthy` | function | `src/server/services/model-router.ts:376` | no non-test reference outside its own definition |
| `__setOllamaHealthyForTests` | function | `src/server/services/model-router.ts:411` | no non-test reference outside its own definition; 6 test file(s) do reference it |
| `__getOllamaHealthyForTests` | function | `src/server/services/model-router.ts:418` | no non-test reference outside its own definition; 3 test file(s) do reference it |
| `selectModel` | function | `src/server/services/model-router.ts:806` | no non-test reference outside its own definition; 11 test file(s) do reference it |
| `getAppendixCacheSize` | function | `src/server/services/model-router.ts:862` | no non-test reference outside its own definition; 5 test file(s) do reference it |
| `__clearPromptCacheForTests` | function | `src/server/services/model-router.ts:933` | no non-test reference outside its own definition; 5 test file(s) do reference it |
| `__clearAppendixCacheForTests` | function | `src/server/services/model-router.ts:942` | no non-test reference outside its own definition; 4 test file(s) do reference it |
| `isCloudModel` | function | `src/server/services/model-router.ts:1194` | no non-test reference outside its own definition |
| `__emitLocalLlmDownSignalForTests` | const | `src/server/services/model-router.ts:3160` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `getLatestFirmEligibility` | function | `src/server/services/multi-firm-promotion-service.ts:415` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `_internal` | const | `src/server/services/n8n-execution-scraper-service.ts:270` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `PartialUpdateFn` | type | `src/server/services/n8n-workflow-deployer.ts:45` | defining module is not reachable from any measured entry point |
| `GetWorkflowFn` | type | `src/server/services/n8n-workflow-deployer.ts:51` | defining module is not reachable from any measured entry point |
| `SetActiveFn` | type | `src/server/services/n8n-workflow-deployer.ts:54` | defining module is not reachable from any measured entry point |
| `WorkflowDefinition` | interface | `src/server/services/n8n-workflow-deployer.ts:57` | defining module is not reachable from any measured entry point |
| `WorkflowNode` | interface | `src/server/services/n8n-workflow-deployer.ts:64` | defining module is not reachable from any measured entry point |
| `DeployerOptions` | interface | `src/server/services/n8n-workflow-deployer.ts:76` | defining module is not reachable from any measured entry point |
| `DeployResult` | interface | `src/server/services/n8n-workflow-deployer.ts:97` | defining module is not reachable from any measured entry point |
| `N8nWorkflowDeployer` | class | `src/server/services/n8n-workflow-deployer.ts:111` | defining module is not reachable from any measured entry point |
| `getN8nWorkflowDeployer` | function | `src/server/services/n8n-workflow-deployer.ts:417` | no non-test reference outside its own definition |
| `_resetN8nWorkflowDeployerForTests` | function | `src/server/services/n8n-workflow-deployer.ts:423` | no non-test reference outside its own definition |
| `flushNotifications` | function | `src/server/services/notification-service.ts:356` | no non-test reference outside its own definition; 8 test file(s) do reference it |
| `getNotificationServiceStatus` | function | `src/server/services/notification-service.ts:368` | no non-test reference outside its own definition; 5 test file(s) do reference it |
| `invalidateOiCache` | function | `src/server/services/oi-liquidity-filter.ts:39` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `checkAllSymbolsOi` | function | `src/server/services/oi-liquidity-filter.ts:141` | no non-test reference outside its own definition |
| `getAllAuctionBiases` | function | `src/server/services/opening-auction-service.ts:122` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `getHistoricalImbalance` | function | `src/server/services/opening-auction-service.ts:241` | no non-test reference outside its own definition |
| `recordAbsenceStart` | function | `src/server/services/operator-absent-mode-service.ts:288` | no non-test reference outside its own definition |
| `recordAbsenceEnd` | function | `src/server/services/operator-absent-mode-service.ts:311` | no non-test reference outside its own definition |
| `clearComplianceCache` | function | `src/server/services/paper-execution-service.ts:351` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `__resetCalendarCacheForTests` | function | `src/server/services/paper-execution-service.ts:380` | no non-test reference outside its own definition; 2 test file(s) do reference it |
| `__resetCalendarFailureTrackerForTests` | function | `src/server/services/paper-execution-service.ts:413` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `resetExitHandlerCircuitBreaker` | function | `src/server/services/paper-execution-service.ts:3047` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `getExitHandlerCbTelemetry` | function | `src/server/services/paper-execution-service.ts:3059` | no non-test reference outside its own definition |
| `clearRollCalendarCache` | function | `src/server/services/paper-execution-service.ts:4704` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `__resetDailyLossCacheForTests` | function | `src/server/services/paper-risk-gate.ts:135` | no non-test reference outside its own definition; 2 test file(s) do reference it |
| `__resetCalendarFailLogForTests` | function | `src/server/services/paper-signal-service.ts:189` | no non-test reference outside its own definition |
| `__resetSignalCalendarCacheForTests` | function | `src/server/services/paper-signal-service.ts:199` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `__resetSkipClassifierCacheForTests` | function | `src/server/services/paper-signal-service.ts:237` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `__clearPendingEntryQueueForTests` | function | `src/server/services/paper-signal-service.ts:634` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `governorOnSessionEnd` | function | `src/server/services/paper-signal-service.ts:843` | no non-test reference outside its own definition |
| `invalidateSessionCache` | function | `src/server/services/paper-signal-service.ts:947` | no non-test reference outside its own definition |
| `clearSessionCache` | function | `src/server/services/paper-signal-service.ts:981` | no non-test reference outside its own definition |
| `computeMedianTrueRangeFromWindow` | function | `src/server/services/paper-trading-stream.ts:71` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `_testClearPocCache` | function | `src/server/services/paper-trading-stream.ts:97` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `_testGetPocCacheSize` | function | `src/server/services/paper-trading-stream.ts:98` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `_testGetPocCacheValue` | function | `src/server/services/paper-trading-stream.ts:99` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `_testSetBarBuffer` | function | `src/server/services/paper-trading-stream.ts:102` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `DeliveryBundle` | interface | `src/server/services/pine-delivery-service.ts:37` | defining module is not reachable from any measured entry point |
| `DeliveryResult` | interface | `src/server/services/pine-delivery-service.ts:50` | defining module is not reachable from any measured entry point |
| `deliverPineBundle` | function | `src/server/services/pine-delivery-service.ts:214` | no non-test reference outside its own definition |
| `getPipelineStatus` | function | `src/server/services/pipeline-control-service.ts:109` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `computeFirst30minVolumeRatio` | function | `src/server/services/pre-market-routine.ts:584` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `getPromptAppendix` | function | `src/server/services/prompt-evolution-service.ts:106` | no non-test reference outside its own definition |
| `getActivePromptContentForStrategy` | function | `src/server/services/prompt-evolution-service.ts:150` | no non-test reference outside its own definition |
| `runPromptEvolution` | function | `src/server/services/prompt-evolution-service.ts:216` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `__collectVariantMetricsForTest` | const | `src/server/services/prompt-evolution-service.ts:843` | no non-test reference outside its own definition; 2 test file(s) do reference it |
| `redactSensitiveEnv` | function | `src/server/services/prop-firm-cookie-refresh-service.ts:61` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `getSuspendedFirms` | function | `src/server/services/prop-firm-health-service.ts:320` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `simulateSuspension` | function | `src/server/services/prop-firm-health-service.ts:352` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `clearSimulatedSuspension` | function | `src/server/services/prop-firm-health-service.ts:386` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `computeSurvivalProbability` | function | `src/server/services/prop-firm-survival-service.ts:307` | no non-test reference outside its own definition; 2 test file(s) do reference it |
| `fitFirmPriorsFromHealthChecks` | function | `src/server/services/prop-firm-survival-service.ts:472` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `getAdversarialStressRunsForBacktest` | function | `src/server/services/quantum-mc-service.ts:606` | no non-test reference outside its own definition |
| `RegimeName` | type | `src/server/services/regime-coverage-monitor-service.ts:45` | no non-test reference outside its own definition |
| `_resetDetectorLockForTest` | function | `src/server/services/regime-drift-detector-service.ts:115` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `analyzeMarketHMM` | function | `src/server/services/regime-service.ts:49` | no non-test reference outside its own definition |
| `hydrateRegimeStateFromLatestForecasts` | function | `src/server/services/regime-state-service.ts:208` | no non-test reference outside its own definition |
| `clearRegimeState` | function | `src/server/services/regime-state-service.ts:218` | no non-test reference outside its own definition |
| `getMacroFusedRegimeState` | function | `src/server/services/regime-state-service.ts:258` | no non-test reference outside its own definition |
| `Tier1Decision` | interface | `src/server/services/scout-formatter.ts:16` | defining module is not reachable from any measured entry point |
| `tier1RegexFilter` | function | `src/server/services/scout-formatter.ts:40` | defining module is not reachable from any measured entry point |
| `stripMarkdown` | function | `src/server/services/scout-formatter.ts:89` | defining module is not reachable from any measured entry point |
| `DrainStallResult` | interface | `src/server/services/scout-watchdog-service.ts:77` | defining module is not reachable from any measured entry point |
| `RejectDistributionResult` | interface | `src/server/services/scout-watchdog-service.ts:85` | defining module is not reachable from any measured entry point |
| `RejectSpikeResult` | interface | `src/server/services/scout-watchdog-service.ts:93` | defining module is not reachable from any measured entry point |
| `runDrainStallCheck` | function | `src/server/services/scout-watchdog-service.ts:158` | no non-test reference outside its own definition; 2 test file(s) do reference it |
| `runRejectDistributionCheck` | function | `src/server/services/scout-watchdog-service.ts:350` | no non-test reference outside its own definition; 2 test file(s) do reference it |
| `runRejectSpikeCheck` | function | `src/server/services/scout-watchdog-service.ts:442` | no non-test reference outside its own definition; 2 test file(s) do reference it |
| `__test__` | const | `src/server/services/scout-watchdog-service.ts:517` | defining module is not reachable from any measured entry point |
| `RejectAction` | export-binding-type | `src/server/services/scout-watchdog-service.ts:531` | defining module is not reachable from any measured entry point |
| `getDailyStats` | function | `src/server/services/settlement-reconciliation-service.ts:172` | no non-test reference outside its own definition |
| `_resetSmtCacheForTest` | function | `src/server/services/smt-live-service.ts:293` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `SpecEntryCondition` | interface | `src/server/services/spec-onboarding-service.ts:166` | defining module is not reachable from any measured entry point |
| `SpecArtifactBody` | interface | `src/server/services/spec-onboarding-service.ts:175` | defining module is not reachable from any measured entry point |
| `SpecArtifact` | interface | `src/server/services/spec-onboarding-service.ts:185` | defining module is not reachable from any measured entry point |
| `ParseResult` | interface | `src/server/services/spec-onboarding-service.ts:196` | defining module is not reachable from any measured entry point |
| `parseSpecArtifact` | function | `src/server/services/spec-onboarding-service.ts:205` | defining module is not reachable from any measured entry point |
| `deriveConfluenceFactors` | function | `src/server/services/spec-onboarding-service.ts:264` | defining module is not reachable from any measured entry point |
| `ConceptNameResult` | interface | `src/server/services/spec-onboarding-service.ts:284` | defining module is not reachable from any measured entry point |
| `deriveConceptName` | function | `src/server/services/spec-onboarding-service.ts:290` | defining module is not reachable from any measured entry point |
| `buildDirectionalEntries` | function | `src/server/services/spec-onboarding-service.ts:331` | defining module is not reachable from any measured entry point |
| `SymbolCode` | type | `src/server/services/spec-onboarding-service.ts:359` | defining module is not reachable from any measured entry point |
| `OnboardSpecOptions` | interface | `src/server/services/spec-onboarding-service.ts:361` | defining module is not reachable from any measured entry point |
| `PerSymbolStatus` | type | `src/server/services/spec-onboarding-service.ts:381` | defining module is not reachable from any measured entry point |
| `PerSymbolOnboardResult` | interface | `src/server/services/spec-onboarding-service.ts:390` | defining module is not reachable from any measured entry point |
| `OnboardSpecResult` | interface | `src/server/services/spec-onboarding-service.ts:401` | defining module is not reachable from any measured entry point |
| `onboardSpecArtifact` | function | `src/server/services/spec-onboarding-service.ts:425` | defining module is not reachable from any measured entry point |
| `__resetEnabledFirmsCache` | function | `src/server/services/strategy-assignment-service.ts:197` | no non-test reference outside its own definition; 3 test file(s) do reference it |
| `getActiveAssignments` | function | `src/server/services/strategy-assignment-service.ts:620` | no non-test reference outside its own definition |
| `unreleaseFromFamily` | function | `src/server/services/strategy-assignment-service.ts:697` | no non-test reference outside its own definition |
| `getAssignmentHistory` | function | `src/server/services/strategy-assignment-service.ts:705` | no non-test reference outside its own definition |
| `runStrategyProductionCheck` | function | `src/server/services/strategy-production-check-service.ts:23` | no non-test reference outside its own definition; 2 test file(s) do reference it |
| `STALE_ELIGIBLE_STATES` | const | `src/server/services/strategy-stale-detector.ts:80` | no non-test reference outside its own definition |
| `setNeedsArchetype` | function | `src/server/services/strategy-stale-detector.ts:540` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `setNeedsRevision` | function | `src/server/services/strategy-stale-detector.ts:620` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `recordMetric` | function | `src/server/services/subsystem-metrics-service.ts:11` | no non-test reference outside its own definition |
| `_resetActiveCount` | function | `src/server/services/trade-critique-service.ts:113` | no non-test reference outside its own definition; 2 test file(s) do reference it |
| `getRecentMarkers` | function | `src/server/services/tradingview-marker-service.ts:146` | no non-test reference outside its own definition |
| `reconcileMarkersVsFills` | function | `src/server/services/tradingview-marker-service.ts:222` | no non-test reference outside its own definition |
| `VP_CONFIG` | const | `src/server/services/volume-profile-service.ts:32` | no non-test reference outside its own definition |
| `dailyVolumeProfileCron` | function | `src/server/services/volume-profile-service.ts:263` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/server/slumdawg-hmac.ts</code> - 4 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `SLUMDAWG_PLACEHOLDER_SECRET` | const | `src/server/slumdawg-hmac.ts:36` | defining module is not reachable from any measured entry point |
| `isUnconfiguredSlumdawgSecret` | function | `src/server/slumdawg-hmac.ts:45` | defining module is not reachable from any measured entry point |
| `signSlumdawgRequest` | function | `src/server/slumdawg-hmac.ts:66` | defining module is not reachable from any measured entry point |
| `verifySlumdawgHmac` | function | `src/server/slumdawg-hmac.ts:90` | defining module is not reachable from any measured entry point |

</details>

<details><summary><code>src/server/types</code> - 2 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `TranscriptSegment` | interface | `src/server/types/youtube-transcript.d.ts:6` | defining module is not reachable from any measured entry point |
| `YoutubeTranscript` | class | `src/server/types/youtube-transcript.d.ts:12` | defining module is not reachable from any measured entry point |

</details>

<details><summary><code>src/shared/db-types.ts</code> - 20 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `Strategy` | type | `src/shared/db-types.ts:51` | defining module is not reachable from any measured entry point |
| `Backtest` | type | `src/shared/db-types.ts:52` | no non-test reference outside its own definition |
| `PaperSession` | type | `src/shared/db-types.ts:53` | no non-test reference outside its own definition |
| `PaperTrade` | type | `src/shared/db-types.ts:54` | no non-test reference outside its own definition |
| `PaperPosition` | type | `src/shared/db-types.ts:55` | no non-test reference outside its own definition |
| `MonteCarloRun` | type | `src/shared/db-types.ts:56` | no non-test reference outside its own definition |
| `CriticOptimizationRun` | type | `src/shared/db-types.ts:57` | no non-test reference outside its own definition |
| `Alert` | type | `src/shared/db-types.ts:58` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `AuditLogEntry` | type | `src/shared/db-types.ts:59` | no non-test reference outside its own definition |
| `StrategyExport` | type | `src/shared/db-types.ts:60` | no non-test reference outside its own definition |
| `StrategyInsert` | type | `src/shared/db-types.ts:63` | no non-test reference outside its own definition |
| `BacktestInsert` | type | `src/shared/db-types.ts:64` | no non-test reference outside its own definition |
| `PaperSessionInsert` | type | `src/shared/db-types.ts:65` | no non-test reference outside its own definition |
| `PaperTradeInsert` | type | `src/shared/db-types.ts:66` | no non-test reference outside its own definition |
| `PaperPositionInsert` | type | `src/shared/db-types.ts:67` | no non-test reference outside its own definition |
| `MonteCarloRunInsert` | type | `src/shared/db-types.ts:68` | no non-test reference outside its own definition |
| `CriticOptimizationRunInsert` | type | `src/shared/db-types.ts:69` | no non-test reference outside its own definition |
| `AlertInsert` | type | `src/shared/db-types.ts:71` | no non-test reference outside its own definition |
| `AuditLogEntryInsert` | type | `src/shared/db-types.ts:72` | no non-test reference outside its own definition |
| `StrategyExportInsert` | type | `src/shared/db-types.ts:73` | no non-test reference outside its own definition |

</details>

<details><summary><code>src/shared/firm-config.ts</code> - 13 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `resolveContractSpec` | function | `src/shared/firm-config.ts:270` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `DEFAULT_ACCOUNT_TYPE` | const | `src/shared/firm-config.ts:366` | no non-test reference outside its own definition; 6 test file(s) do reference it |
| `MFFU_HFT_MAX_TRADES_PER_DAY` | const | `src/shared/firm-config.ts:487` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `MFFU_TWO_PERCENT_RULE_PCT` | const | `src/shared/firm-config.ts:490` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `MFFU_BASELINE_SLIPPAGE_TICKS_MES` | const | `src/shared/firm-config.ts:493` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `MFFU_PAYOUT_CYCLE_DAYS` | const | `src/shared/firm-config.ts:496` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `MFFU_PAYOUT_SPLIT` | const | `src/shared/firm-config.ts:499` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `TOPSTEP_PLATFORM_LOCKDOWN_DATE` | const | `src/shared/firm-config.ts:505` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `TOPSTEP_REQUIRED_PLATFORM` | const | `src/shared/firm-config.ts:508` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `TOPSTEP_ALLOWS_CLOUD_FAILOVER` | const | `src/shared/firm-config.ts:511` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `TOPSTEPX_API_MONTHLY_FEE_USD` | const | `src/shared/firm-config.ts:514` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `TOPSTEPX_PROMO_CODE` | const | `src/shared/firm-config.ts:517` | no non-test reference outside its own definition; 1 test file(s) do reference it |
| `getPayoutCap` | function | `src/shared/firm-config.ts:606` | no non-test reference outside its own definition; 1 test file(s) do reference it |

</details>

<details><summary><code>src/shared/walk-forward-schema.ts</code> - 6 symbols</summary>

| Symbol | Kind | Defined at | Reason |
|---|---|---|---|
| `WFWindowOosMetricsSchema` | const | `src/shared/walk-forward-schema.ts:53` | no non-test reference outside its own definition |
| `WFWindowOosMetrics` | type | `src/shared/walk-forward-schema.ts:54` | no non-test reference outside its own definition |
| `WFEResult` | type | `src/shared/walk-forward-schema.ts:81` | no non-test reference outside its own definition |
| `PBOResult` | type | `src/shared/walk-forward-schema.ts:101` | no non-test reference outside its own definition |
| `ParamDriftClassification` | type | `src/shared/walk-forward-schema.ts:124` | no non-test reference outside its own definition |
| `WalkForwardResultSchema` | const | `src/shared/walk-forward-schema.ts:135` | no non-test reference outside its own definition |

</details>

---

## 8. WIRED - has a non-test caller and a static path from an entry point

This is the *we already have this* list.  Check it before writing anything.

<details><summary><code>src/data/fetchers</code> - 2 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `createAlphaVantageFetcher` | function | `src/data/fetchers/alphavantage.ts:98` | 2 | unique |
| `createMassiveFetcher` | function | `src/data/fetchers/massive.ts:49` | 3 | unique |

</details>

<details><summary><code>src/data/loaders</code> - 9 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `OhlcvQueryParams` | interface | `src/data/loaders/duckdb-service.ts:5` | 1 | unique |
| `ALLOWED_SYMBOLS` | const | `src/data/loaders/duckdb-service.ts:14` | 0 | unique |
| `ALLOWED_TIMEFRAMES` | const | `src/data/loaders/duckdb-service.ts:15` | 0 | unique |
| `buildOhlcvQuery` | function | `src/data/loaders/duckdb-service.ts:17` | 1 | unique |
| `OhlcvBar` | interface | `src/data/loaders/duckdb-service.ts:92` | 3 | unique |
| `queryOhlcv` | function | `src/data/loaders/duckdb-service.ts:101` | 4 | unique |
| `SymbolInfo` | interface | `src/data/loaders/duckdb-service.ts:108` | 1 | unique |
| `queryInfo` | function | `src/data/loaders/duckdb-service.ts:115` | 3 | unique |
| `listAvailableSymbols` | function | `src/data/loaders/duckdb-service.ts:144` | 2 | unique |

</details>

<details><summary><code>src/data/scripts</code> - 14 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `get_cache_dir` | function | `src/data/scripts/databento_definition_pull.py:80` | 1 | AMBIG |
| `get_client` | function | `src/data/scripts/databento_definition_pull.py:85` | 4 | AMBIG |
| `pull_definition` | function | `src/data/scripts/databento_definition_pull.py:92` | 0 | unique |
| `check_against_expected` | function | `src/data/scripts/databento_definition_pull.py:179` | 0 | unique |
| `save_to_cache` | function | `src/data/scripts/databento_definition_pull.py:213` | 0 | unique |
| `main` | function | `src/data/scripts/databento_definition_pull.py:231` | 182 | AMBIG |
| `get_client` | function | `src/data/scripts/databento_imbalance_pull.py:64` | 4 | AMBIG |
| `et_to_utc_window` | function | `src/data/scripts/databento_imbalance_pull.py:72` | 0 | unique |
| `pull_imbalance_for_date` | function | `src/data/scripts/databento_imbalance_pull.py:98` | 0 | unique |
| `get_trading_dates` | function | `src/data/scripts/databento_imbalance_pull.py:185` | 0 | unique |
| `main` | function | `src/data/scripts/databento_imbalance_pull.py:197` | 182 | AMBIG |
| `get_client` | function | `src/data/scripts/databento_statistics_pull.py:66` | 4 | AMBIG |
| `pull_statistics` | function | `src/data/scripts/databento_statistics_pull.py:74` | 0 | unique |
| `main` | function | `src/data/scripts/databento_statistics_pull.py:177` | 182 | AMBIG |

</details>

<details><summary><code>src/discord/bot.ts</code> - 7 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `TYPED_CHANNEL_SCHEMAS` | export-binding | `src/discord/bot.ts:487` | 0 | unique |
| `DailyN8nReportSchema` | export-binding | `src/discord/bot.ts:487` | 0 | unique |
| `StrategyFindSchema` | export-binding | `src/discord/bot.ts:487` | 0 | unique |
| `WorkflowErrorSchema` | export-binding | `src/discord/bot.ts:487` | 0 | unique |
| `CriticalAlertSchema` | export-binding | `src/discord/bot.ts:487` | 0 | unique |
| `client` | export-binding | `src/discord/bot.ts:692` | 22 | AMBIG |
| `CHANNEL_MAP` | export-binding | `src/discord/bot.ts:692` | 0 | unique |

</details>

<details><summary><code>src/discord/commands.ts</code> - 2 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `commands` | const | `src/discord/commands.ts:151` | 2 | unique |
| `handleCommand` | function | `src/discord/commands.ts:164` | 1 | unique |

</details>

<details><summary><code>src/discord/utils.ts</code> - 5 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `fetchForge` | function | `src/discord/utils.ts:9` | 1 | unique |
| `errorEmbed` | function | `src/discord/utils.ts:36` | 1 | unique |
| `statusColor` | function | `src/discord/utils.ts:48` | 1 | unique |
| `truncate` | function | `src/discord/utils.ts:62` | 1 | unique |
| `infoEmbed` | function | `src/discord/utils.ts:70` | 1 | unique |

</details>

<details><summary><code>src/engine/a_plus_market_auditor.py</code> - 10 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `AuditInput` | class | `src/engine/a_plus_market_auditor.py:109` | 1 | AMBIG |
| `MarketEvidence` | class | `src/engine/a_plus_market_auditor.py:129` | 0 | unique |
| `AuditResult` | class | `src/engine/a_plus_market_auditor.py:142` | 1 | AMBIG |
| `compute_edge_score` | function | `src/engine/a_plus_market_auditor.py:158` | 0 | unique |
| `_build_entanglement_circuit` | function | `src/engine/a_plus_market_auditor.py:201` | 0 | unique |
| `_fallback_classical_entanglement` | function | `src/engine/a_plus_market_auditor.py:296` | 0 | unique |
| `run_cross_market_entanglement` | function | `src/engine/a_plus_market_auditor.py:330` | 0 | unique |
| `run_market_audit` | function | `src/engine/a_plus_market_auditor.py:390` | 0 | unique |
| `run_full_scan` | function | `src/engine/a_plus_market_auditor.py:462` | 0 | unique |
| `_cli_main` | function | `src/engine/a_plus_market_auditor.py:553` | 4 | AMBIG |

</details>

<details><summary><code>src/engine/ablation_layers.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `reason_to_layer` | function | `src/engine/ablation_layers.py:41` | 1 | unique |

</details>

<details><summary><code>src/engine/analytics.py</code> - 19 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_utc_to_et_hour` | function | `src/engine/analytics.py:28` | 0 | unique |
| `compute_calendar_patterns` | function | `src/engine/analytics.py:43` | 0 | unique |
| `enrich_daily_pnl_records` | function | `src/engine/analytics.py:194` | 0 | unique |
| `compute_event_markers` | function | `src/engine/analytics.py:227` | 0 | unique |
| `compute_streak_overlay` | function | `src/engine/analytics.py:245` | 0 | unique |
| `compute_firm_limit_markers` | function | `src/engine/analytics.py:271` | 0 | unique |
| `tag_trade_session_fields` | function | `src/engine/analytics.py:311` | 0 | unique |
| `_parse_entry_hour_et` | function | `src/engine/analytics.py:353` | 0 | unique |
| `_classify_session_extended` | function | `src/engine/analytics.py:367` | 0 | unique |
| `compute_session_analysis` | function | `src/engine/analytics.py:382` | 0 | unique |
| `compute_mae_mfe_analysis` | function | `src/engine/analytics.py:511` | 0 | unique |
| `compute_win_loss_patterns` | function | `src/engine/analytics.py:657` | 0 | unique |
| `compute_regime_performance` | function | `src/engine/analytics.py:856` | 0 | unique |
| `compute_trade_autocorrelation` | function | `src/engine/analytics.py:948` | 0 | unique |
| `compute_playbook_analytics` | function | `src/engine/analytics.py:1016` | 0 | unique |
| `compute_named_session_analytics` | function | `src/engine/analytics.py:1065` | 0 | unique |
| `compute_bias_regime_analytics` | function | `src/engine/analytics.py:1140` | 0 | unique |
| `compute_rejection_quality` | function | `src/engine/analytics.py:1203` | 0 | unique |
| `compute_full_analytics` | function | `src/engine/analytics.py:1369` | 1 | unique |

</details>

<details><summary><code>src/engine/anti_setups</code> - 25 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_compute_stats` | function | `src/engine/anti_setups/anti_setup_backtest.py:104` | 0 | unique |
| `_trade_to_context` | function | `src/engine/anti_setups/anti_setup_backtest.py:130` | 0 | unique |
| `should_filter` | function | `src/engine/anti_setups/filter_gate.py:8` | 2 | unique |
| `_matches_condition` | function | `src/engine/anti_setups/filter_gate.py:54` | 0 | unique |
| `_z_for_bonferroni` | function | `src/engine/anti_setups/miner.py:22` | 0 | unique |
| `mine_anti_setups` | function | `src/engine/anti_setups/miner.py:38` | 0 | unique |
| `_is_loser` | function | `src/engine/anti_setups/miner.py:85` | 0 | unique |
| `_failure_rate` | function | `src/engine/anti_setups/miner.py:89` | 0 | unique |
| `_avg_loss` | function | `src/engine/anti_setups/miner.py:95` | 0 | unique |
| `_confidence` | function | `src/engine/anti_setups/miner.py:100` | 0 | unique |
| `_pnl_impact` | function | `src/engine/anti_setups/miner.py:117` | 0 | unique |
| `_get_hour` | function | `src/engine/anti_setups/miner.py:125` | 0 | unique |
| `_get_day_of_week` | function | `src/engine/anti_setups/miner.py:141` | 0 | unique |
| `_mine_time_of_day` | function | `src/engine/anti_setups/miner.py:161` | 0 | unique |
| `_mine_volatility` | function | `src/engine/anti_setups/miner.py:194` | 0 | unique |
| `_mine_volume` | function | `src/engine/anti_setups/miner.py:251` | 0 | unique |
| `_mine_day_of_week` | function | `src/engine/anti_setups/miner.py:298` | 0 | unique |
| `_mine_regime` | function | `src/engine/anti_setups/miner.py:331` | 0 | unique |
| `_mine_archetype` | function | `src/engine/anti_setups/miner.py:363` | 0 | unique |
| `_mine_event_proximity` | function | `src/engine/anti_setups/miner.py:395` | 0 | unique |
| `_mine_streak` | function | `src/engine/anti_setups/miner.py:431` | 0 | unique |
| `_get_miner_db_connection` | function | `src/engine/anti_setups/miner.py:481` | 0 | unique |
| `_load_closed_trades_for_strategy` | function | `src/engine/anti_setups/miner.py:507` | 0 | unique |
| `_load_bars_with_atr_for_symbol` | function | `src/engine/anti_setups/miner.py:583` | 0 | unique |
| `run_miner_cli` | function | `src/engine/anti_setups/miner.py:621` | 0 | unique |

</details>

<details><summary><code>src/engine/archetype_evaluator.py</code> - 5 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_get_archetype_class_map` | function | `src/engine/archetype_evaluator.py:100` | 0 | unique |
| `_build_synthetic_df` | function | `src/engine/archetype_evaluator.py:191` | 0 | unique |
| `evaluate_archetype` | function | `src/engine/archetype_evaluator.py:262` | 0 | unique |
| `main` | function | `src/engine/archetype_evaluator.py:374` | 182 | AMBIG |
| `_emit_error` | function | `src/engine/archetype_evaluator.py:453` | 0 | unique |

</details>

<details><summary><code>src/engine/archetypes</code> - 9 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_close_position` | function | `src/engine/archetypes/classifier.py:31` | 0 | unique |
| `_day_range` | function | `src/engine/archetypes/classifier.py:39` | 0 | unique |
| `classify_day` | function | `src/engine/archetypes/classifier.py:43` | 0 | unique |
| `_compute_atr` | function | `src/engine/archetypes/classifier.py:156` | 0 | unique |
| `classify_day_series` | function | `src/engine/archetypes/classifier.py:186` | 1 | unique |
| `extract_features` | function | `src/engine/archetypes/feature_extractor.py:36` | 1 | unique |
| `_normalize_features` | function | `src/engine/archetypes/predictor.py:12` | 1 | AMBIG |
| `_euclidean_distance` | function | `src/engine/archetypes/predictor.py:46` | 0 | unique |
| `predict_archetype` | function | `src/engine/archetypes/predictor.py:50` | 0 | unique |

</details>

<details><summary><code>src/engine/backtester.py</code> - 51 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_dst_us_rule_offset` | function | `src/engine/backtester.py:123` | 0 | unique |
| `_dst_correct_et_hour` | function | `src/engine/backtester.py:162` | 0 | unique |
| `_et_time_ge_flatten` | function | `src/engine/backtester.py:220` | 0 | unique |
| `apply_eligibility_gate` | function | `src/engine/backtester.py:247` | 0 | unique |
| `_build_eligibility_gate_mode_disclosure` | function | `src/engine/backtester.py:545` | 0 | unique |
| `_backtest_skip_signals_for_day` | function | `src/engine/backtester.py:594` | 0 | unique |
| `_load_anti_setups_for_strategy` | function | `src/engine/backtester.py:635` | 0 | unique |
| `_apply_backtest_parity_gates` | function | `src/engine/backtester.py:640` | 0 | unique |
| `_apply_naked_management` | function | `src/engine/backtester.py:938` | 0 | unique |
| `_apply_stop_only_management` | function | `src/engine/backtester.py:1047` | 0 | unique |
| `_apply_trade_management` | function | `src/engine/backtester.py:1188` | 1 | unique |
| `_apply_static_styleC_management` | function | `src/engine/backtester.py:1285` | 0 | unique |
| `_apply_adaptive_management` | function | `src/engine/backtester.py:1796` | 0 | unique |
| `_resolve_freq` | function | `src/engine/backtester.py:2248` | 0 | unique |
| `_extract_atr_period` | function | `src/engine/backtester.py:2253` | 0 | unique |
| `_compute_daily_pnls` | function | `src/engine/backtester.py:2261` | 0 | unique |
| `_compute_monthly_returns` | function | `src/engine/backtester.py:2402` | 0 | unique |
| `_aggregate_equity_daily` | function | `src/engine/backtester.py:2453` | 0 | unique |
| `_detect_dst_transitions` | function | `src/engine/backtester.py:2531` | 0 | unique |
| `_wilson_ci` | function | `src/engine/backtester.py:2567` | 0 | unique |
| `_compute_long_short_split` | function | `src/engine/backtester.py:2578` | 0 | unique |
| `_validate_bar_count` | function | `src/engine/backtester.py:2660` | 0 | unique |
| `_build_run_receipt` | function | `src/engine/backtester.py:2691` | 0 | unique |
| `_apply_max_trades_per_day` | function | `src/engine/backtester.py:2756` | 0 | unique |
| `_symbol_of_spec` | function | `src/engine/backtester.py:2909` | 0 | unique |
| `_get_stop_ceiling_for_symbol` | function | `src/engine/backtester.py:2921` | 1 | unique |
| `_structural_stop_parity_enabled` | function | `src/engine/backtester.py:2969` | 0 | unique |
| `_resolve_stop_risk_points` | function | `src/engine/backtester.py:2984` | 0 | unique |
| `_get_stop_floor_for_symbol` | function | `src/engine/backtester.py:3047` | 0 | unique |
| `_parse_slippage_survival_multiples` | function | `src/engine/backtester.py:3084` | 0 | unique |
| `_parse_slippage_survival_min_pf` | function | `src/engine/backtester.py:3104` | 0 | unique |
| `_parse_slippage_survival_min_trades` | function | `src/engine/backtester.py:3120` | 0 | unique |
| `_compute_slippage_survival_block` | function | `src/engine/backtester.py:3135` | 1 | unique |
| `_apply_dsl_stop_loss_and_time_stop` | function | `src/engine/backtester.py:3206` | 0 | unique |
| `_apply_dll_halt_to_entries` | function | `src/engine/backtester.py:3487` | 0 | unique |
| `run_backtest` | function | `src/engine/backtester.py:3625` | 10 | unique |
| `_build_expected_signals_from_trades` | function | `src/engine/backtester.py:6184` | 0 | unique |
| `_execution_was_refused` | function | `src/engine/backtester.py:6258` | 0 | unique |
| `_emit_validated_result` | function | `src/engine/backtester.py:6296` | 0 | unique |
| `_compute_recovery_days_from_max_dd` | function | `src/engine/backtester.py:6366` | 0 | unique |
| `_compute_monthly_survival_stats` | function | `src/engine/backtester.py:6414` | 0 | unique |
| `_compute_tier` | function | `src/engine/backtester.py:6451` | 0 | unique |
| `_compute_forge_score` | function | `src/engine/backtester.py:6475` | 0 | unique |
| `compute_recency_weighted_score` | function | `src/engine/backtester.py:6502` | 0 | unique |
| `_empty_result` | function | `src/engine/backtester.py:6588` | 1 | AMBIG |
| `run_class_backtest` | function | `src/engine/backtester.py:6619` | 7 | unique |
| `_compute_decay_analysis` | function | `src/engine/backtester.py:8081` | 0 | unique |
| `_load_strategy_class` | function | `src/engine/backtester.py:8106` | 1 | unique |
| `_unevaluated_crisis_sentinel` | function | `src/engine/backtester.py:8125` | 0 | unique |
| `_rescore_with_crisis` | function | `src/engine/backtester.py:8155` | 0 | unique |
| `main` | function | `src/engine/backtester.py:8219` | 182 | AMBIG |

</details>

<details><summary><code>src/engine/black_swan_evaluator.py</code> - 8 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `RegimeRecord` | class | `src/engine/black_swan_evaluator.py:160` | 0 | unique |
| `RegimeSurvivalResult` | class | `src/engine/black_swan_evaluator.py:177` | 0 | unique |
| `score_survival` | function | `src/engine/black_swan_evaluator.py:209` | 0 | unique |
| `_fetch_ohlcv_from_s3` | function | `src/engine/black_swan_evaluator.py:231` | 0 | unique |
| `_build_backtest_request` | function | `src/engine/black_swan_evaluator.py:260` | 0 | unique |
| `evaluate_strategy` | function | `src/engine/black_swan_evaluator.py:428` | 0 | unique |
| `_query_regime_bank` | function | `src/engine/black_swan_evaluator.py:619` | 0 | unique |
| `_load_strategy_config_from_db` | function | `src/engine/black_swan_evaluator.py:767` | 0 | unique |

</details>

<details><summary><code>src/engine/breakout_confirmation_ambiguity.py</code> - 2 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `BreakoutAmbiguityVerdict` | class | `src/engine/breakout_confirmation_ambiguity.py:123` | 0 | unique |
| `classify_breakout_confirmation_ambiguity` | function | `src/engine/breakout_confirmation_ambiguity.py:159` | 1 | unique |

</details>

<details><summary><code>src/engine/changepoint.py</code> - 4 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `detect_changepoints` | function | `src/engine/changepoint.py:16` | 0 | unique |
| `_fallback_changepoint` | function | `src/engine/changepoint.py:93` | 0 | unique |
| `detect_strategy_edge_death` | function | `src/engine/changepoint.py:133` | 0 | unique |
| `_find_coincident_breaks` | function | `src/engine/changepoint.py:166` | 0 | unique |

</details>

<details><summary><code>src/engine/cloud_backend.py</code> - 14 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `CloudBackendConfig` | class | `src/engine/cloud_backend.py:69` | 2 | unique |
| `CloudBudgetTracker` | class | `src/engine/cloud_backend.py:88` | 2 | unique |
| `_params_hash` | function | `src/engine/cloud_backend.py:320` | 0 | unique |
| `QuantumResultCache` | class | `src/engine/cloud_backend.py:330` | 0 | unique |
| `get_ibm_sampler` | function | `src/engine/cloud_backend.py:453` | 0 | unique |
| `get_braket_device` | function | `src/engine/cloud_backend.py:491` | 0 | unique |
| `resolve_backend` | function | `src/engine/cloud_backend.py:517` | 3 | unique |
| `JobMetadata` | class | `src/engine/cloud_backend.py:682` | 0 | unique |
| `CloudJobRegistry` | class | `src/engine/cloud_backend.py:693` | 0 | unique |
| `tick` | function | `src/engine/cloud_backend.py:929` | 12 | unique |
| `_check_cloud_gates` | function | `src/engine/cloud_backend.py:974` | 0 | unique |
| `submit_surface_code_iae` | function | `src/engine/cloud_backend.py:995` | 0 | unique |
| `poll_ibm_job` | function | `src/engine/cloud_backend.py:1163` | 0 | unique |
| `build_cloud_run_metadata` | function | `src/engine/cloud_backend.py:1371` | 1 | unique |

</details>

<details><summary><code>src/engine/compiler</code> - 13 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `validate_dsl` | function | `src/engine/compiler/compiler.py:17` | 0 | unique |
| `compile_to_backtest` | function | `src/engine/compiler/compiler.py:41` | 0 | unique |
| `_build_exit_rule` | function | `src/engine/compiler/compiler.py:117` | 0 | unique |
| `diff_strategies` | function | `src/engine/compiler/compiler.py:135` | 0 | unique |
| `_cli_main` | function | `src/engine/compiler/compiler.py:160` | 4 | AMBIG |
| `validate_entry_params` | function | `src/engine/compiler/pattern_library.py:195` | 1 | unique |
| `Timeframe` | class | `src/engine/compiler/strategy_schema.py:11` | 0 | unique |
| `Direction` | class | `src/engine/compiler/strategy_schema.py:21` | 1 | unique |
| `EntryType` | class | `src/engine/compiler/strategy_schema.py:27` | 0 | unique |
| `ExitType` | class | `src/engine/compiler/strategy_schema.py:36` | 1 | AMBIG |
| `ChartConstruction` | class | `src/engine/compiler/strategy_schema.py:44` | 0 | unique |
| `ProfitScalingTier` | class | `src/engine/compiler/strategy_schema.py:68` | 0 | unique |
| `StrategyDSL` | class | `src/engine/compiler/strategy_schema.py:91` | 1 | unique |

</details>

<details><summary><code>src/engine/compliance</code> - 13 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `check_freshness` | function | `src/engine/compliance/compliance_gate.py:25` | 0 | unique |
| `check_strategy_compliance` | function | `src/engine/compliance/compliance_gate.py:109` | 1 | unique |
| `pre_session_gate` | function | `src/engine/compliance/compliance_gate.py:265` | 0 | unique |
| `compute_content_hash` | function | `src/engine/compliance/compliance_gate.py:369` | 0 | unique |
| `detect_drift` | function | `src/engine/compliance/compliance_gate.py:374` | 0 | unique |
| `check_violation` | function | `src/engine/compliance/compliance_gate.py:399` | 0 | unique |
| `check_kill_switch` | function | `src/engine/compliance/compliance_gate.py:565` | 0 | unique |
| `_load_correlation_matrix` | function | `src/engine/compliance/compliance_gate.py:719` | 0 | unique |
| `_pair_key` | function | `src/engine/compliance/compliance_gate.py:757` | 0 | unique |
| `_get_correlation` | function | `src/engine/compliance/compliance_gate.py:763` | 0 | unique |
| `check_two_percent_rule` | function | `src/engine/compliance/compliance_gate.py:894` | 0 | unique |
| `check_hft_limit` | function | `src/engine/compliance/compliance_gate.py:960` | 0 | unique |
| `check_simultaneous_limit_price` | function | `src/engine/compliance/compliance_gate.py:1005` | 0 | unique |

</details>

<details><summary><code>src/engine/config.py</code> - 17 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `ContractSpec` | class | `src/engine/config.py:61` | 5 | AMBIG |
| `_Track3Config` | class | `src/engine/config.py:292` | 0 | unique |
| `IndicatorConfig` | class | `src/engine/config.py:320` | 4 | unique |
| `StopConfig` | class | `src/engine/config.py:349` | 1 | unique |
| `PositionSizeConfig` | class | `src/engine/config.py:362` | 4 | unique |
| `StrategyConfig` | class | `src/engine/config.py:440` | 8 | unique |
| `EconomicEventPolicy` | class | `src/engine/config.py:510` | 0 | unique |
| `EventCalendarConfig` | class | `src/engine/config.py:516` | 1 | unique |
| `FillProbabilityConfig` | class | `src/engine/config.py:523` | 1 | unique |
| `LiquidityLevelSnapshot` | class | `src/engine/config.py:571` | 1 | unique |
| `AdaptiveExitContext` | class | `src/engine/config.py:585` | 1 | unique |
| `BacktestRequest` | class | `src/engine/config.py:610` | 11 | unique |
| `BacktestResult` | class | `src/engine/config.py:671` | 1 | unique |
| `DataQualityReport` | class | `src/engine/config.py:714` | 1 | unique |
| `MonteCarloRequest` | class | `src/engine/config.py:731` | 3 | unique |
| `CrisisScenario` | class | `src/engine/config.py:801` | 1 | unique |
| `StressTestRequest` | class | `src/engine/config.py:819` | 2 | unique |

</details>

<details><summary><code>src/engine/context</code> - 98 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `RegimeEvidence` | class | `src/engine/context/bias_engine.py:56` | 0 | unique |
| `_compute_session_health` | function | `src/engine/context/bias_engine.py:71` | 0 | unique |
| `_compute_volume_ratio` | function | `src/engine/context/bias_engine.py:115` | 0 | unique |
| `_compute_range_vs_atr` | function | `src/engine/context/bias_engine.py:137` | 0 | unique |
| `_compute_price_displacement` | function | `src/engine/context/bias_engine.py:170` | 0 | unique |
| `classify_institutional_regime` | function | `src/engine/context/bias_engine.py:205` | 0 | unique |
| `detect_late_cycle_overheating` | function | `src/engine/context/bias_engine.py:321` | 0 | unique |
| `DailyBiasState` | class | `src/engine/context/bias_engine.py:467` | 3 | unique |
| `_score_htf_trend` | function | `src/engine/context/bias_engine.py:533` | 0 | unique |
| `_score_pd_location` | function | `src/engine/context/bias_engine.py:561` | 0 | unique |
| `_score_overnight` | function | `src/engine/context/bias_engine.py:590` | 0 | unique |
| `_score_liquidity_context` | function | `src/engine/context/bias_engine.py:604` | 0 | unique |
| `_score_vwap_state` | function | `src/engine/context/bias_engine.py:616` | 0 | unique |
| `_score_event_risk` | function | `src/engine/context/bias_engine.py:625` | 0 | unique |
| `_score_session_regime` | function | `src/engine/context/bias_engine.py:642` | 0 | unique |
| `_score_deepar_regime` | function | `src/engine/context/bias_engine.py:654` | 0 | unique |
| `_bars_ready` | function | `src/engine/context/bias_engine.py:710` | 0 | unique |
| `compute_synthetic_cvd` | function | `src/engine/context/bias_engine.py:718` | 1 | unique |
| `detect_absorption` | function | `src/engine/context/bias_engine.py:749` | 1 | unique |
| `detect_exhaustion` | function | `src/engine/context/bias_engine.py:769` | 1 | unique |
| `confirm_sweep_with_delta` | function | `src/engine/context/bias_engine.py:801` | 1 | unique |
| `_compute_order_flow_features` | function | `src/engine/context/bias_engine.py:840` | 0 | unique |
| `_score_profile_shape` | function | `src/engine/context/bias_engine.py:907` | 0 | unique |
| `_score_initial_balance` | function | `src/engine/context/bias_engine.py:928` | 0 | unique |
| `_score_open_relative_to_value` | function | `src/engine/context/bias_engine.py:957` | 0 | unique |
| `VPLevels` | class | `src/engine/context/bias_engine.py:981` | 1 | AMBIG |
| `compute_bias` | function | `src/engine/context/bias_engine.py:1011` | 3 | unique |
| `_maybe_persist_bias_decision` | function | `src/engine/context/bias_engine.py:1290` | 0 | unique |
| `BlackoutWindow` | class | `src/engine/context/blackout_gate.py:25` | 1 | AMBIG |
| `parse_blackout_windows` | function | `src/engine/context/blackout_gate.py:42` | 0 | unique |
| `should_block_for_blackout` | function | `src/engine/context/blackout_gate.py:69` | 0 | unique |
| `apply_blackout_mask_to_entries` | function | `src/engine/context/blackout_gate.py:107` | 1 | unique |
| `load_blackouts_from_env_or_config` | function | `src/engine/context/blackout_gate.py:149` | 1 | unique |
| `CrossSymbolDllState` | class | `src/engine/context/cross_symbol_dll.py:34` | 0 | unique |
| `evaluate_cross_symbol_dll` | function | `src/engine/context/cross_symbol_dll.py:55` | 0 | unique |
| `apply_cross_symbol_dll_to_bar` | function | `src/engine/context/cross_symbol_dll.py:90` | 0 | unique |
| `build_cs_dll_disclosure` | function | `src/engine/context/cross_symbol_dll.py:155` | 1 | unique |
| `apply_cross_symbol_dll_to_entries` | function | `src/engine/context/cross_symbol_dll.py:193` | 1 | unique |
| `EligibilityDecision` | class | `src/engine/context/eligibility_gate.py:25` | 1 | unique |
| `_kill_zone_active` | function | `src/engine/context/eligibility_gate.py:40` | 0 | unique |
| `evaluate_signal` | function | `src/engine/context/eligibility_gate.py:45` | 3 | unique |
| `htf_period` | function | `src/engine/context/htf_availability.py:37` | 1 | unique |
| `ts_col_of` | function | `src/engine/context/htf_availability.py:49` | 1 | unique |
| `completed_htf_slice` | function | `src/engine/context/htf_availability.py:56` | 1 | unique |
| `daily_ts_col` | function | `src/engine/context/htf_cache_builder.py:33` | 0 | unique |
| `day_key_of` | function | `src/engine/context/htf_cache_builder.py:39` | 1 | unique |
| `build_htf_cache` | function | `src/engine/context/htf_cache_builder.py:44` | 1 | unique |
| `exec_ts_col` | function | `src/engine/context/htf_columns.py:49` | 0 | unique |
| `HTFContext` | class | `src/engine/context/htf_context.py:19` | 3 | unique |
| `_classify_trend` | function | `src/engine/context/htf_context.py:36` | 1 | AMBIG |
| `_premium_discount` | function | `src/engine/context/htf_context.py:45` | 0 | unique |
| `compute_htf_context` | function | `src/engine/context/htf_context.py:58` | 5 | unique |
| `_compute_weekly_range` | function | `src/engine/context/htf_context.py:208` | 0 | unique |
| `AsianRange` | class | `src/engine/context/htf_narrative.py:49` | 1 | AMBIG |
| `LondonBias` | class | `src/engine/context/htf_narrative.py:62` | 1 | AMBIG |
| `NYBias` | class | `src/engine/context/htf_narrative.py:79` | 1 | AMBIG |
| `DailyDealing` | class | `src/engine/context/htf_narrative.py:96` | 1 | AMBIG |
| `HtfNarrative` | class | `src/engine/context/htf_narrative.py:116` | 3 | AMBIG |
| `_get_session_bars` | function | `src/engine/context/htf_narrative.py:132` | 0 | unique |
| `_classify_quadrant` | function | `src/engine/context/htf_narrative.py:169` | 0 | unique |
| `_safe_float` | function | `src/engine/context/htf_narrative.py:190` | 2 | AMBIG |
| `compute_htf_narrative` | function | `src/engine/context/htf_narrative.py:204` | 1 | unique |
| `_compute_asian_range` | function | `src/engine/context/htf_narrative.py:247` | 0 | unique |
| `_compute_london_bias` | function | `src/engine/context/htf_narrative.py:292` | 0 | unique |
| `_compute_ny_bias` | function | `src/engine/context/htf_narrative.py:342` | 0 | unique |
| `_compute_daily_dealing` | function | `src/engine/context/htf_narrative.py:390` | 0 | unique |
| `LocationScore` | class | `src/engine/context/location_score.py:20` | 1 | unique |
| `compute_location_score` | function | `src/engine/context/location_score.py:31` | 2 | unique |
| `OpenRelativeClassification` | class | `src/engine/context/open_relative_to_value.py:37` | 0 | unique |
| `classify_open_relative_to_value` | function | `src/engine/context/open_relative_to_value.py:46` | 1 | unique |
| `PlaybookDecision` | class | `src/engine/context/playbook_router.py:50` | 1 | unique |
| `_compute_router_hash` | function | `src/engine/context/playbook_router.py:216` | 0 | unique |
| `_check_no_trade_conditions` | function | `src/engine/context/playbook_router.py:230` | 0 | unique |
| `route_playbook` | function | `src/engine/context/playbook_router.py:263` | 3 | unique |
| `_to_et` | function | `src/engine/context/session_context.py:22` | 0 | unique |
| `SessionContext` | class | `src/engine/context/session_context.py:51` | 5 | unique |
| `_get_session` | function | `src/engine/context/session_context.py:67` | 1 | AMBIG |
| `_is_macro_time` | function | `src/engine/context/session_context.py:102` | 0 | unique |
| `_trading_date_et` | function | `src/engine/context/session_context.py:107` | 0 | unique |
| `compute_session_context` | function | `src/engine/context/session_context.py:124` | 3 | unique |
| `_load_env_buffer_ticks` | function | `src/engine/context/structural_stops.py:74` | 0 | unique |
| `_get_effective_ceiling` | function | `src/engine/context/structural_stops.py:125` | 0 | unique |
| `get_sweep_buffer_ticks` | function | `src/engine/context/structural_stops.py:147` | 0 | unique |
| `get_sweep_buffer_points` | function | `src/engine/context/structural_stops.py:152` | 0 | unique |
| `_compute_buffer` | function | `src/engine/context/structural_stops.py:160` | 0 | unique |
| `StopPlan` | class | `src/engine/context/structural_stops.py:181` | 1 | unique |
| `compute_structural_stop` | function | `src/engine/context/structural_stops.py:194` | 4 | unique |
| `TargetPlan` | class | `src/engine/context/structural_targets.py:20` | 1 | unique |
| `compute_targets` | function | `src/engine/context/structural_targets.py:33` | 2 | unique |
| `compute_single_tp` | function | `src/engine/context/structural_targets.py:167` | 2 | unique |
| `select_exit_style` | function | `src/engine/context/structural_targets.py:287` | 1 | unique |
| `StructureState` | class | `src/engine/context/structure_engine.py:94` | 3 | AMBIG |
| `_derive_prior_bos_direction` | function | `src/engine/context/structure_engine.py:118` | 0 | unique |
| `_last_swing_prices` | function | `src/engine/context/structure_engine.py:131` | 0 | unique |
| `_find_last_break` | function | `src/engine/context/structure_engine.py:152` | 0 | unique |
| `_is_displacement_active` | function | `src/engine/context/structure_engine.py:193` | 0 | unique |
| `compute_structure_state` | function | `src/engine/context/structure_engine.py:210` | 3 | unique |
| `_compute_structure_state_inner` | function | `src/engine/context/structure_engine.py:247` | 0 | unique |

</details>

<details><summary><code>src/engine/context_runner.py</code> - 4 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_load_bars` | function | `src/engine/context_runner.py:25` | 1 | unique |
| `run_bias` | function | `src/engine/context_runner.py:35` | 0 | unique |
| `run_evaluate` | function | `src/engine/context_runner.py:141` | 0 | unique |
| `main` | function | `src/engine/context_runner.py:317` | 182 | AMBIG |

</details>

<details><summary><code>src/engine/critic_optimizer.py</code> - 7 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `CompositeObjective` | class | `src/engine/critic_optimizer.py:28` | 0 | unique |
| `EvidenceAggregator` | class | `src/engine/critic_optimizer.py:91` | 0 | unique |
| `PennyLaneRefiner` | class | `src/engine/critic_optimizer.py:318` | 0 | unique |
| `_compute_rl_modifier` | function | `src/engine/critic_optimizer.py:520` | 0 | unique |
| `CandidateGenerator` | class | `src/engine/critic_optimizer.py:552` | 0 | unique |
| `check_kill_signals` | function | `src/engine/critic_optimizer.py:809` | 0 | unique |
| `run_critic_optimizer` | function | `src/engine/critic_optimizer.py:846` | 0 | unique |

</details>

<details><summary><code>src/engine/cross_validation.py</code> - 8 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `get_wfe_hard_floor` | function | `src/engine/cross_validation.py:35` | 1 | unique |
| `get_wfe_warn_floor` | function | `src/engine/cross_validation.py:43` | 1 | unique |
| `compute_wfe` | function | `src/engine/cross_validation.py:51` | 1 | unique |
| `bootstrap_ci` | function | `src/engine/cross_validation.py:107` | 0 | unique |
| `deflated_sharpe_ratio` | function | `src/engine/cross_validation.py:158` | 1 | unique |
| `compute_sortino_ratio` | function | `src/engine/cross_validation.py:300` | 0 | unique |
| `run_cross_validation` | function | `src/engine/cross_validation.py:317` | 2 | unique |
| `_verify_metrics` | function | `src/engine/cross_validation.py:376` | 0 | unique |

</details>

<details><summary><code>src/engine/cuopt_helpers.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `CandidateSelector` | class | `src/engine/cuopt_helpers.py:27` | 1 | unique |

</details>

<details><summary><code>src/engine/data_loader.py</code> - 25 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_get_connection` | function | `src/engine/data_loader.py:38` | 2 | AMBIG |
| `DataLoadConfigError` | class | `src/engine/data_loader.py:92` | 0 | unique |
| `_check_s3_read_config` | function | `src/engine/data_loader.py:98` | 0 | unique |
| `_write_cache_sidecar` | function | `src/engine/data_loader.py:172` | 0 | unique |
| `_check_cache_sidecar` | function | `src/engine/data_loader.py:216` | 0 | unique |
| `_cache_path` | function | `src/engine/data_loader.py:267` | 1 | unique |
| `_is_cache_fresh` | function | `src/engine/data_loader.py:277` | 1 | unique |
| `_maybe_bust_cache` | function | `src/engine/data_loader.py:286` | 0 | unique |
| `_consolidated_s3_path` | function | `src/engine/data_loader.py:308` | 0 | unique |
| `_legacy_s3_glob` | function | `src/engine/data_loader.py:314` | 0 | unique |
| `_verify_ratio_adjusted_source` | function | `src/engine/data_loader.py:350` | 0 | unique |
| `sync_from_s3` | function | `src/engine/data_loader.py:383` | 1 | unique |
| `_validate_data_quality` | function | `src/engine/data_loader.py:419` | 0 | unique |
| `compute_dataset_hash` | function | `src/engine/data_loader.py:441` | 1 | unique |
| `ZeroVolumeOnTradeCriticalBar` | class | `src/engine/data_loader.py:477` | 1 | unique |
| `check_zero_volume_trade_critical` | function | `src/engine/data_loader.py:496` | 1 | unique |
| `validate_bars` | function | `src/engine/data_loader.py:560` | 0 | unique |
| `load_ohlcv` | function | `src/engine/data_loader.py:746` | 15 | unique |
| `load_n_timeframes` | function | `src/engine/data_loader.py:1161` | 1 | unique |
| `_dl_nth_weekday` | function | `src/engine/data_loader.py:1273` | 0 | unique |
| `_second_thursday_before_third_friday` | function | `src/engine/data_loader.py:1289` | 0 | unique |
| `_equity_index_rollover_dates` | function | `src/engine/data_loader.py:1308` | 0 | unique |
| `_crude_oil_rollover_dates` | function | `src/engine/data_loader.py:1322` | 0 | unique |
| `compute_rollover_dates` | function | `src/engine/data_loader.py:1354` | 0 | unique |
| `flag_rollover_days` | function | `src/engine/data_loader.py:1397` | 1 | unique |

</details>

<details><summary><code>src/engine/decay</code> - 19 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_within_grace_period` | function | `src/engine/decay/half_life.py:20` | 2 | unique |
| `fit_decay` | function | `src/engine/decay/half_life.py:62` | 2 | unique |
| `_detect_decay` | function | `src/engine/decay/half_life.py:185` | 0 | unique |
| `_linear_fit` | function | `src/engine/decay/half_life.py:200` | 0 | unique |
| `_classify_trend` | function | `src/engine/decay/half_life.py:229` | 1 | AMBIG |
| `QuarantineLevel` | class | `src/engine/decay/quarantine.py:11` | 1 | unique |
| `evaluate_quarantine` | function | `src/engine/decay/quarantine.py:50` | 1 | unique |
| `_escalation_key` | function | `src/engine/decay/quarantine.py:155` | 0 | unique |
| `_recovery_key` | function | `src/engine/decay/quarantine.py:165` | 0 | unique |
| `_next_level` | function | `src/engine/decay/quarantine.py:174` | 0 | unique |
| `_prev_level` | function | `src/engine/decay/quarantine.py:181` | 0 | unique |
| `sharpe_decay` | function | `src/engine/decay/sub_signals.py:12` | 0 | unique |
| `mfe_decay` | function | `src/engine/decay/sub_signals.py:55` | 0 | unique |
| `slippage_growth` | function | `src/engine/decay/sub_signals.py:96` | 0 | unique |
| `win_size_decay` | function | `src/engine/decay/sub_signals.py:126` | 0 | unique |
| `regime_mismatch` | function | `src/engine/decay/sub_signals.py:164` | 4 | unique |
| `fill_rate_decay` | function | `src/engine/decay/sub_signals.py:207` | 0 | unique |
| `composite_decay_score` | function | `src/engine/decay/sub_signals.py:257` | 2 | unique |
| `_slope` | function | `src/engine/decay/sub_signals.py:316` | 0 | unique |

</details>

<details><summary><code>src/engine/deepar_forecaster.py</code> - 8 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `DeepARConfig` | class | `src/engine/deepar_forecaster.py:84` | 0 | unique |
| `TrainingResult` | class | `src/engine/deepar_forecaster.py:100` | 1 | unique |
| `RegimeForecast` | class | `src/engine/deepar_forecaster.py:115` | 1 | unique |
| `PredictionResult` | class | `src/engine/deepar_forecaster.py:136` | 0 | unique |
| `_load_parquet_data` | function | `src/engine/deepar_forecaster.py:147` | 0 | unique |
| `_prepare_series` | function | `src/engine/deepar_forecaster.py:195` | 0 | unique |
| `DeepARForecaster` | class | `src/engine/deepar_forecaster.py:291` | 0 | unique |
| `main` | function | `src/engine/deepar_forecaster.py:571` | 182 | AMBIG |

</details>

<details><summary><code>src/engine/determinism.py</code> - 5 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_apply_env_vars` | function | `src/engine/determinism.py:48` | 0 | unique |
| `_apply_numba_cache_dir` | function | `src/engine/determinism.py:54` | 0 | unique |
| `enable_determinism` | function | `src/engine/determinism.py:93` | 5 | unique |
| `canonicalize_result` | function | `src/engine/determinism.py:194` | 0 | unique |
| `result_hash` | function | `src/engine/determinism.py:229` | 1 | unique |

</details>

<details><summary><code>src/engine/economic_calendar.py</code> - 15 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `symbol_passes_event_scope` | function | `src/engine/economic_calendar.py:86` | 0 | unique |
| `_federal_monday_holidays` | function | `src/engine/economic_calendar.py:117` | 0 | unique |
| `generate_eia_dates_for_year` | function | `src/engine/economic_calendar.py:176` | 0 | unique |
| `_parse_event_datetime` | function | `src/engine/economic_calendar.py:1069` | 0 | unique |
| `_load_authoritative_events` | function | `src/engine/economic_calendar.py:1090` | 0 | unique |
| `_events_for_type` | function | `src/engine/economic_calendar.py:1121` | 0 | unique |
| `_get_events_for_policies` | function | `src/engine/economic_calendar.py:1129` | 0 | unique |
| `_timestamps_to_et_date_and_minutes` | function | `src/engine/economic_calendar.py:1189` | 0 | unique |
| `_check_in_window` | function | `src/engine/economic_calendar.py:1212` | 0 | unique |
| `generate_event_mask` | function | `src/engine/economic_calendar.py:1231` | 1 | unique |
| `get_event_slippage_multipliers` | function | `src/engine/economic_calendar.py:1306` | 1 | unique |
| `EmptyCalendarError` | class | `src/engine/economic_calendar.py:1353` | 0 | unique |
| `count_events_in_window` | function | `src/engine/economic_calendar.py:1363` | 0 | unique |
| `assert_events_present_in_window` | function | `src/engine/economic_calendar.py:1407` | 0 | unique |
| `apply_class_event_mask` | function | `src/engine/economic_calendar.py:1433` | 1 | unique |

</details>

<details><summary><code>src/engine/entry_eligibility.py</code> - 2 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `EligibilityConversionRefused` | class | `src/engine/entry_eligibility.py:54` | 0 | unique |
| `EntryEligibility` | class | `src/engine/entry_eligibility.py:59` | 1 | unique |

</details>

<details><summary><code>src/engine/entry_windows.py</code> - 8 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `resolve_timezone` | function | `src/engine/entry_windows.py:52` | 0 | unique |
| `EntryWindow` | class | `src/engine/entry_windows.py:60` | 2 | AMBIG |
| `parse_entry_window` | function | `src/engine/entry_windows.py:77` | 1 | unique |
| `parse_entry_windows` | function | `src/engine/entry_windows.py:160` | 1 | unique |
| `to_minutes_of_day_in_tz` | function | `src/engine/entry_windows.py:169` | 0 | unique |
| `is_bar_in_window` | function | `src/engine/entry_windows.py:181` | 0 | unique |
| `is_bar_in_any_window` | function | `src/engine/entry_windows.py:187` | 1 | unique |
| `window_to_pine_time_string` | function | `src/engine/entry_windows.py:201` | 1 | unique |

</details>

<details><summary><code>src/engine/evt_tail.py</code> - 2 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `fit_generalized_pareto` | function | `src/engine/evt_tail.py:17` | 1 | unique |
| `_fallback_tail_estimate` | function | `src/engine/evt_tail.py:87` | 0 | unique |

</details>

<details><summary><code>src/engine/exits</code> - 20 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `ExitTarget` | class | `src/engine/exits/adaptive_exits.py:127` | 1 | AMBIG |
| `ScalingSchedule` | class | `src/engine/exits/adaptive_exits.py:140` | 1 | AMBIG |
| `ExitPlan` | class | `src/engine/exits/adaptive_exits.py:153` | 3 | AMBIG |
| `_compute_r_multiple` | function | `src/engine/exits/adaptive_exits.py:175` | 0 | unique |
| `_snapshot_field` | function | `src/engine/exits/adaptive_exits.py:196` | 0 | unique |
| `_compute_rank_score` | function | `src/engine/exits/adaptive_exits.py:207` | 0 | unique |
| `_build_liquidity_targets` | function | `src/engine/exits/adaptive_exits.py:228` | 0 | unique |
| `_get_scaling_schedule` | function | `src/engine/exits/adaptive_exits.py:389` | 0 | unique |
| `_get_runner_trail_method` | function | `src/engine/exits/adaptive_exits.py:407` | 0 | unique |
| `_is_at_or_after_pre_lunch_et` | function | `src/engine/exits/adaptive_exits.py:418` | 1 | unique |
| `compute_exit_plan_python` | function | `src/engine/exits/adaptive_exits.py:506` | 1 | unique |
| `StyleCState` | class | `src/engine/exits/style_c_handler.py:90` | 0 | unique |
| `evaluate_exit` | function | `src/engine/exits/style_c_handler.py:134` | 1 | AMBIG |
| `ExitDecision` | class | `src/engine/exits/style_d_handler.py:42` | 2 | unique |
| `ExitState` | class | `src/engine/exits/style_d_handler.py:51` | 0 | unique |
| `_is_time_stop` | function | `src/engine/exits/style_d_handler.py:75` | 2 | unique |
| `_compute_chandelier_stop` | function | `src/engine/exits/style_d_handler.py:87` | 0 | unique |
| `_compute_swing_trail` | function | `src/engine/exits/style_d_handler.py:108` | 0 | unique |
| `_tighter_trail` | function | `src/engine/exits/style_d_handler.py:120` | 0 | unique |
| `evaluate_exit` | function | `src/engine/exits/style_d_handler.py:145` | 1 | AMBIG |

</details>

<details><summary><code>src/engine/exportability.py</code> - 3 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `ExportabilityResult` | class | `src/engine/exportability.py:70` | 1 | unique |
| `_pine_inexpressible_notes` | function | `src/engine/exportability.py:86` | 0 | unique |
| `score_exportability` | function | `src/engine/exportability.py:129` | 1 | unique |

</details>

<details><summary><code>src/engine/family_meta_enforcement.py</code> - 10 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `FamilyMetaEnforcementError` | class | `src/engine/family_meta_enforcement.py:155` | 1 | unique |
| `family_meta_enforced` | function | `src/engine/family_meta_enforcement.py:173` | 2 | unique |
| `active_pins` | function | `src/engine/family_meta_enforcement.py:180` | 0 | unique |
| `Violation` | class | `src/engine/family_meta_enforcement.py:318` | 0 | unique |
| `resolve_primitive` | function | `src/engine/family_meta_enforcement.py:328` | 0 | unique |
| `verify_primitives` | function | `src/engine/family_meta_enforcement.py:360` | 0 | unique |
| `verify_emit_subset_covered` | function | `src/engine/family_meta_enforcement.py:411` | 0 | unique |
| `verify_dispatch_coverage` | function | `src/engine/family_meta_enforcement.py:453` | 0 | unique |
| `collect_violations` | function | `src/engine/family_meta_enforcement.py:506` | 0 | unique |
| `ensure_enforced` | function | `src/engine/family_meta_enforcement.py:588` | 1 | unique |

</details>

<details><summary><code>src/engine/fill_model.py</code> - 9 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_get_partial_fill_enabled` | function | `src/engine/fill_model.py:59` | 0 | unique |
| `_get_partial_fill_volume_threshold` | function | `src/engine/fill_model.py:65` | 0 | unique |
| `apply_fill_model` | function | `src/engine/fill_model.py:120` | 1 | unique |
| `estimate_spread_ticks` | function | `src/engine/fill_model.py:170` | 0 | unique |
| `compute_fill_probabilities_v2` | function | `src/engine/fill_model.py:195` | 1 | unique |
| `compute_volume_based_fill_ratios` | function | `src/engine/fill_model.py:274` | 0 | unique |
| `apply_volume_partial_fills` | function | `src/engine/fill_model.py:373` | 1 | unique |
| `_combine_partial_fill_audits` | function | `src/engine/fill_model.py:478` | 0 | unique |
| `apply_fill_model_and_roll_signals` | function | `src/engine/fill_model.py:512` | 1 | unique |

</details>

<details><summary><code>src/engine/firm_config.py</code> - 2 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `get_commission_per_side` | function | `src/engine/firm_config.py:333` | 2 | unique |
| `get_contract_cap` | function | `src/engine/firm_config.py:359` | 1 | unique |

</details>

<details><summary><code>src/engine/firm_rules_version.py</code> - 2 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_canonical_json` | function | `src/engine/firm_rules_version.py:34` | 0 | unique |
| `compute_firm_rules_version` | function | `src/engine/firm_rules_version.py:44` | 1 | unique |

</details>

<details><summary><code>src/engine/frankenstein_test.py</code> - 11 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `FrankensteinResult` | class | `src/engine/frankenstein_test.py:56` | 0 | unique |
| `_shuffle_bars` | function | `src/engine/frankenstein_test.py:73` | 0 | unique |
| `_synthetic_gbm` | function | `src/engine/frankenstein_test.py:142` | 0 | unique |
| `_signal_ema_crossover` | function | `src/engine/frankenstein_test.py:214` | 0 | unique |
| `_signal_atr_breakout` | function | `src/engine/frankenstein_test.py:242` | 0 | unique |
| `_signal_bb_breakout` | function | `src/engine/frankenstein_test.py:283` | 0 | unique |
| `_signal_orb` | function | `src/engine/frankenstein_test.py:312` | 0 | unique |
| `_signal_sma_crossover_fallback` | function | `src/engine/frankenstein_test.py:343` | 0 | unique |
| `_build_signal` | function | `src/engine/frankenstein_test.py:389` | 0 | unique |
| `_simulate_shuffled` | function | `src/engine/frankenstein_test.py:431` | 0 | unique |
| `run_frankenstein_test` | function | `src/engine/frankenstein_test.py:539` | 0 | unique |

</details>

<details><summary><code>src/engine/gap_risk.py</code> - 4 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `compute_overnight_gaps` | function | `src/engine/gap_risk.py:25` | 1 | unique |
| `tag_trades_overnight` | function | `src/engine/gap_risk.py:59` | 1 | unique |
| `compute_gap_adjusted_mae` | function | `src/engine/gap_risk.py:112` | 1 | unique |
| `compute_gap_adjusted_drawdown` | function | `src/engine/gap_risk.py:218` | 1 | unique |

</details>

<details><summary><code>src/engine/gate_block_analyzer.py</code> - 19 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `normalize_gate_key` | function | `src/engine/gate_block_analyzer.py:130` | 0 | unique |
| `BlockedSignal` | class | `src/engine/gate_block_analyzer.py:152` | 0 | unique |
| `CounterfactualResult` | class | `src/engine/gate_block_analyzer.py:170` | 0 | unique |
| `GateVerdict` | class | `src/engine/gate_block_analyzer.py:188` | 0 | unique |
| `_compute_pnl` | function | `src/engine/gate_block_analyzer.py:206` | 0 | unique |
| `_get_point_value` | function | `src/engine/gate_block_analyzer.py:224` | 0 | unique |
| `_get_tick_size` | function | `src/engine/gate_block_analyzer.py:230` | 1 | AMBIG |
| `_get_tick_value` | function | `src/engine/gate_block_analyzer.py:235` | 0 | unique |
| `_get_big_move_threshold` | function | `src/engine/gate_block_analyzer.py:240` | 0 | unique |
| `_compute_slippage_dollars` | function | `src/engine/gate_block_analyzer.py:244` | 0 | unique |
| `simulate_counterfactual` | function | `src/engine/gate_block_analyzer.py:260` | 0 | unique |
| `_compute_verdict` | function | `src/engine/gate_block_analyzer.py:526` | 1 | unique |
| `load_blocked_signals` | function | `src/engine/gate_block_analyzer.py:625` | 0 | unique |
| `load_forward_bars` | function | `src/engine/gate_block_analyzer.py:713` | 0 | unique |
| `_find_entry_bar_idx` | function | `src/engine/gate_block_analyzer.py:790` | 0 | unique |
| `_compute_median_atr` | function | `src/engine/gate_block_analyzer.py:845` | 0 | unique |
| `_verdict_pill` | function | `src/engine/gate_block_analyzer.py:857` | 1 | unique |
| `generate_report` | function | `src/engine/gate_block_analyzer.py:868` | 0 | unique |
| `run_gate_block_analysis` | function | `src/engine/gate_block_analyzer.py:996` | 0 | unique |

</details>

<details><summary><code>src/engine/governor</code> - 5 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `backtest_governor` | function | `src/engine/governor/governor_backtest.py:11` | 1 | unique |
| `_get_session` | function | `src/engine/governor/governor_backtest.py:162` | 1 | AMBIG |
| `GovernorState` | class | `src/engine/governor/state_machine.py:21` | 0 | unique |
| `Governor` | class | `src/engine/governor/state_machine.py:67` | 1 | unique |
| `filter_trade` | function | `src/engine/governor/trade_filter.py:9` | 2 | unique |

</details>

<details><summary><code>src/engine/gpu_pipeline.py</code> - 3 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `find_similar_gpu` | function | `src/engine/gpu_pipeline.py:60` | 1 | unique |
| `block_bootstrap_gpu` | function | `src/engine/gpu_pipeline.py:89` | 1 | unique |
| `gpu_risk_metrics` | function | `src/engine/gpu_pipeline.py:170` | 1 | unique |

</details>

<details><summary><code>src/engine/graveyard</code> - 10 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `cluster_graveyard` | function | `src/engine/graveyard/cluster.py:19` | 0 | unique |
| `_aggregate_failure_modes` | function | `src/engine/graveyard/cluster.py:97` | 0 | unique |
| `_aggregate_categories` | function | `src/engine/graveyard/cluster.py:106` | 0 | unique |
| `main` | function | `src/engine/graveyard/cluster.py:119` | 182 | AMBIG |
| `embed_strategy` | function | `src/engine/graveyard/embedder.py:21` | 2 | unique |
| `embed_text` | function | `src/engine/graveyard/embedder.py:71` | 0 | unique |
| `FailureTag` | class | `src/engine/graveyard/failure_tagger.py:22` | 0 | unique |
| `_enrich_tag` | function | `src/engine/graveyard/failure_tagger.py:81` | 0 | unique |
| `cosine_similarity` | function | `src/engine/graveyard/similarity.py:11` | 0 | unique |
| `find_similar` | function | `src/engine/graveyard/similarity.py:21` | 1 | unique |

</details>

<details><summary><code>src/engine/hardware_profile.py</code> - 11 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `HardwareProfile` | class | `src/engine/hardware_profile.py:17` | 0 | unique |
| `detect_gpu` | function | `src/engine/hardware_profile.py:39` | 0 | unique |
| `get_max_qubits_statevector` | function | `src/engine/hardware_profile.py:72` | 0 | unique |
| `get_max_qubits_cpu` | function | `src/engine/hardware_profile.py:93` | 0 | unique |
| `detect_cloud_backends` | function | `src/engine/hardware_profile.py:115` | 0 | unique |
| `select_backend` | function | `src/engine/hardware_profile.py:199` | 2 | unique |
| `detect_wsl2` | function | `src/engine/hardware_profile.py:260` | 0 | unique |
| `get_hardware_profile` | function | `src/engine/hardware_profile.py:271` | 0 | unique |
| `_probe_via_pynvml` | function | `src/engine/hardware_profile.py:370` | 0 | unique |
| `_probe_via_nvidia_smi` | function | `src/engine/hardware_profile.py:390` | 0 | unique |
| `probe_vram` | function | `src/engine/hardware_profile.py:417` | 3 | unique |

</details>

<details><summary><code>src/engine/indicators</code> - 116 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `BiasResult` | class | `src/engine/indicators/bias_native.py:56` | 0 | unique |
| `_find_swings` | function | `src/engine/indicators/bias_native.py:68` | 0 | unique |
| `compute_bias_signal` | function | `src/engine/indicators/bias_native.py:88` | 1 | unique |
| `ConfirmationResult` | class | `src/engine/indicators/confirmation_native.py:47` | 0 | unique |
| `compute_confirmation_signal` | function | `src/engine/indicators/confirmation_native.py:58` | 1 | unique |
| `compute_sma` | function | `src/engine/indicators/core.py:22` | 2 | unique |
| `compute_ema` | function | `src/engine/indicators/core.py:27` | 5 | unique |
| `_wilder_rma` | function | `src/engine/indicators/core.py:33` | 0 | unique |
| `compute_rsi` | function | `src/engine/indicators/core.py:57` | 1 | unique |
| `compute_atr` | function | `src/engine/indicators/core.py:76` | 33 | unique |
| `compute_donchian` | function | `src/engine/indicators/core.py:94` | 0 | unique |
| `compute_adx` | function | `src/engine/indicators/core.py:102` | 2 | unique |
| `compute_adr` | function | `src/engine/indicators/core.py:145` | 0 | unique |
| `compute_macd` | function | `src/engine/indicators/core.py:154` | 1 | unique |
| `compute_bbands` | function | `src/engine/indicators/core.py:169` | 1 | unique |
| `compute_vwap` | function | `src/engine/indicators/core.py:182` | 0 | unique |
| `_assign_globex_session_id` | function | `src/engine/indicators/core.py:218` | 0 | unique |
| `compute_vwap_with_bands` | function | `src/engine/indicators/core.py:271` | 0 | unique |
| `compute_anchored_vwap` | function | `src/engine/indicators/core.py:379` | 0 | unique |
| `compute_opening_range_breakout` | function | `src/engine/indicators/core.py:467` | 1 | unique |
| `compute_indicators` | function | `src/engine/indicators/core.py:579` | 2 | unique |
| `compute_htf_indicators` | function | `src/engine/indicators/core.py:667` | 1 | unique |
| `fib_retracement` | function | `src/engine/indicators/fibonacci.py:34` | 0 | unique |
| `ote_zone` | function | `src/engine/indicators/fibonacci.py:52` | 2 | unique |
| `fib_extensions` | function | `src/engine/indicators/fibonacci.py:74` | 0 | unique |
| `FVGZone` | class | `src/engine/indicators/fvg_native.py:47` | 0 | unique |
| `FVGResult` | class | `src/engine/indicators/fvg_native.py:65` | 0 | unique |
| `detect_fvg_zones` | function | `src/engine/indicators/fvg_native.py:77` | 0 | unique |
| `_fill_scan` | function | `src/engine/indicators/fvg_native.py:99` | 0 | unique |
| `_active_signal` | function | `src/engine/indicators/fvg_native.py:138` | 0 | unique |
| `compute_fvg_signal` | function | `src/engine/indicators/fvg_native.py:153` | 1 | unique |
| `InitialBalance` | class | `src/engine/indicators/initial_balance.py:42` | 0 | unique |
| `_to_et_minute_of_day` | function | `src/engine/indicators/initial_balance.py:57` | 1 | AMBIG |
| `compute_initial_balance` | function | `src/engine/indicators/initial_balance.py:70` | 1 | unique |
| `_cluster_swings_causal` | function | `src/engine/indicators/liquidity.py:13` | 0 | unique |
| `detect_buyside_liquidity` | function | `src/engine/indicators/liquidity.py:85` | 7 | unique |
| `detect_sellside_liquidity` | function | `src/engine/indicators/liquidity.py:115` | 7 | unique |
| `detect_equal_highs` | function | `src/engine/indicators/liquidity.py:145` | 2 | unique |
| `detect_equal_lows` | function | `src/engine/indicators/liquidity.py:186` | 2 | unique |
| `detect_sweep` | function | `src/engine/indicators/liquidity.py:223` | 6 | unique |
| `detect_inducement` | function | `src/engine/indicators/liquidity.py:258` | 1 | unique |
| `detect_swings` | function | `src/engine/indicators/market_structure.py:22` | 23 | unique |
| `detect_bos` | function | `src/engine/indicators/market_structure.py:86` | 9 | unique |
| `detect_choch` | function | `src/engine/indicators/market_structure.py:125` | 3 | unique |
| `detect_mss` | function | `src/engine/indicators/market_structure.py:187` | 10 | unique |
| `compute_premium_discount` | function | `src/engine/indicators/market_structure.py:216` | 6 | unique |
| `detect_choch_with_context` | function | `src/engine/indicators/market_structure.py:324` | 1 | unique |
| `detect_mss_with_context` | function | `src/engine/indicators/market_structure.py:424` | 1 | unique |
| `premium_discount_zone` | function | `src/engine/indicators/market_structure.py:486` | 3 | unique |
| `MSSResult` | class | `src/engine/indicators/mss_native.py:53` | 0 | unique |
| `_true_range` | function | `src/engine/indicators/mss_native.py:59` | 0 | unique |
| `_sma` | function | `src/engine/indicators/mss_native.py:74` | 0 | unique |
| `_persist` | function | `src/engine/indicators/mss_native.py:86` | 3 | AMBIG |
| `compute_mss_signal` | function | `src/engine/indicators/mss_native.py:96` | 1 | unique |
| `forward_fill_htf_to_exec` | function | `src/engine/indicators/mtf_join.py:32` | 1 | unique |
| `_find_bullish_obs` | function | `src/engine/indicators/order_flow.py:16` | 0 | unique |
| `_find_bearish_obs` | function | `src/engine/indicators/order_flow.py:37` | 0 | unique |
| `_find_breakers` | function | `src/engine/indicators/order_flow.py:58` | 0 | unique |
| `_compute_breaker_signals` | function | `src/engine/indicators/order_flow.py:100` | 0 | unique |
| `detect_bullish_ob` | function | `src/engine/indicators/order_flow.py:139` | 6 | unique |
| `detect_bearish_ob` | function | `src/engine/indicators/order_flow.py:170` | 6 | unique |
| `detect_breaker` | function | `src/engine/indicators/order_flow.py:201` | 3 | unique |
| `compute_breaker_signals` | function | `src/engine/indicators/order_flow.py:234` | 1 | unique |
| `detect_mitigation` | function | `src/engine/indicators/order_flow.py:275` | 1 | unique |
| `detect_rejection` | function | `src/engine/indicators/order_flow.py:331` | 1 | unique |
| `_bars_to_df` | function | `src/engine/indicators/paper_bridge.py:136` | 0 | unique |
| `_last_scalar` | function | `src/engine/indicators/paper_bridge.py:176` | 0 | unique |
| `_compute_indicator` | function | `src/engine/indicators/paper_bridge.py:207` | 0 | unique |
| `detect_fvg` | function | `src/engine/indicators/price_delivery.py:12` | 13 | unique |
| `detect_ifvg` | function | `src/engine/indicators/price_delivery.py:56` | 1 | unique |
| `detect_displacement` | function | `src/engine/indicators/price_delivery.py:122` | 10 | unique |
| `detect_volume_imbalance` | function | `src/engine/indicators/price_delivery.py:153` | 1 | unique |
| `detect_liquidity_void` | function | `src/engine/indicators/price_delivery.py:208` | 1 | unique |
| `ProfileShapeClassification` | class | `src/engine/indicators/profile_shape_classifier.py:49` | 0 | unique |
| `_vol_in_range` | function | `src/engine/indicators/profile_shape_classifier.py:59` | 0 | unique |
| `classify_profile_shape` | function | `src/engine/indicators/profile_shape_classifier.py:64` | 1 | unique |
| `_thin_confidence` | function | `src/engine/indicators/profile_shape_classifier.py:178` | 0 | unique |
| `_bp_confidence` | function | `src/engine/indicators/profile_shape_classifier.py:186` | 0 | unique |
| `_d_confidence` | function | `src/engine/indicators/profile_shape_classifier.py:198` | 0 | unique |
| `_to_et_components` | function | `src/engine/indicators/sessions.py:34` | 0 | unique |
| `is_asia_killzone` | function | `src/engine/indicators/sessions.py:52` | 4 | unique |
| `is_london_killzone` | function | `src/engine/indicators/sessions.py:63` | 8 | unique |
| `is_nyam_killzone` | function | `src/engine/indicators/sessions.py:73` | 7 | unique |
| `is_ny_lunch` | function | `src/engine/indicators/sessions.py:83` | 2 | unique |
| `is_nypm_killzone` | function | `src/engine/indicators/sessions.py:97` | 3 | unique |
| `is_silver_bullet_nyam` | function | `src/engine/indicators/sessions.py:111` | 3 | unique |
| `is_silver_bullet_nypm` | function | `src/engine/indicators/sessions.py:117` | 3 | unique |
| `is_silver_bullet_london` | function | `src/engine/indicators/sessions.py:123` | 3 | unique |
| `is_macro_time` | function | `src/engine/indicators/sessions.py:129` | 1 | unique |
| `true_day_open` | function | `src/engine/indicators/sessions.py:197` | 1 | unique |
| `midnight_open` | function | `src/engine/indicators/sessions.py:221` | 2 | unique |
| `smt_divergence` | function | `src/engine/indicators/smt.py:18` | 1 | unique |
| `custom_smt` | function | `src/engine/indicators/smt.py:99` | 0 | unique |
| `SmtDivergence` | class | `src/engine/indicators/smt_divergence.py:65` | 0 | unique |
| `_compute_atr14` | function | `src/engine/indicators/smt_divergence.py:101` | 0 | unique |
| `_time_align_nq_to_es` | function | `src/engine/indicators/smt_divergence.py:137` | 0 | unique |
| `_find_lookback_swing_low` | function | `src/engine/indicators/smt_divergence.py:196` | 0 | unique |
| `_find_lookback_swing_high` | function | `src/engine/indicators/smt_divergence.py:211` | 0 | unique |
| `_clamp` | function | `src/engine/indicators/smt_divergence.py:226` | 0 | unique |
| `compute_smt_divergence` | function | `src/engine/indicators/smt_divergence.py:230` | 0 | unique |
| `SweepResult` | class | `src/engine/indicators/sweep_native.py:45` | 0 | unique |
| `_persist` | function | `src/engine/indicators/sweep_native.py:55` | 3 | AMBIG |
| `compute_sweep_signal` | function | `src/engine/indicators/sweep_native.py:67` | 1 | unique |
| `VolumeProfileLevels` | class | `src/engine/indicators/volume_profile.py:43` | 2 | unique |
| `_get_tick_size` | function | `src/engine/indicators/volume_profile.py:63` | 1 | AMBIG |
| `_build_bin_map` | function | `src/engine/indicators/volume_profile.py:70` | 0 | unique |
| `_find_poc` | function | `src/engine/indicators/volume_profile.py:130` | 0 | unique |
| `_compute_value_area` | function | `src/engine/indicators/volume_profile.py:137` | 0 | unique |
| `compute_volume_profile` | function | `src/engine/indicators/volume_profile.py:189` | 0 | unique |
| `compute_naked_pocs` | function | `src/engine/indicators/volume_profile.py:250` | 0 | unique |
| `NakedPocRecord` | class | `src/engine/indicators/volume_profile.py:362` | 0 | unique |
| `extract_naked_pocs_for_persistence` | function | `src/engine/indicators/volume_profile.py:373` | 1 | unique |
| `HodLodRecord` | class | `src/engine/indicators/volume_profile.py:523` | 0 | unique |
| `extract_hod_lod_for_persistence` | function | `src/engine/indicators/volume_profile.py:533` | 1 | unique |
| `compute_session_shape_score` | function | `src/engine/indicators/volume_profile.py:640` | 0 | unique |
| `_cli_main` | function | `src/engine/indicators/volume_profile.py:712` | 4 | AMBIG |

</details>

<details><summary><code>src/engine/invariant_harness</code> - 22 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `InvariantCheck` | class | `src/engine/invariant_harness/core.py:86` | 2 | AMBIG |
| `InvariantReport` | class | `src/engine/invariant_harness/core.py:105` | 1 | unique |
| `_is_finite` | function | `src/engine/invariant_harness/core.py:130` | 0 | unique |
| `_safe_float` | function | `src/engine/invariant_harness/core.py:138` | 2 | AMBIG |
| `_aggregate_metric_raw` | function | `src/engine/invariant_harness/core.py:146` | 0 | unique |
| `_aggregate_metric` | function | `src/engine/invariant_harness/core.py:161` | 0 | unique |
| `_check_balance_arithmetic` | function | `src/engine/invariant_harness/core.py:185` | 0 | unique |
| `_check_trade_pnl_sum` | function | `src/engine/invariant_harness/core.py:212` | 0 | unique |
| `_check_daily_pnl_sum` | function | `src/engine/invariant_harness/core.py:238` | 0 | unique |
| `_check_long_short_split_sum` | function | `src/engine/invariant_harness/core.py:283` | 0 | unique |
| `_check_long_short_count` | function | `src/engine/invariant_harness/core.py:323` | 0 | unique |
| `_check_win_rate_in_range` | function | `src/engine/invariant_harness/core.py:360` | 0 | unique |
| `_check_max_drawdown_non_negative` | function | `src/engine/invariant_harness/core.py:383` | 0 | unique |
| `_check_peak_equity_at_least_starting` | function | `src/engine/invariant_harness/core.py:465` | 0 | unique |
| `_check_sharpe_finite` | function | `src/engine/invariant_harness/core.py:505` | 0 | unique |
| `_check_profit_factor_finite` | function | `src/engine/invariant_harness/core.py:595` | 0 | unique |
| `_check_avg_trade_pnl_consistent` | function | `src/engine/invariant_harness/core.py:683` | 0 | unique |
| `_check_commission_per_trade_reasonable` | function | `src/engine/invariant_harness/core.py:721` | 0 | unique |
| `_check_per_firm_endings` | function | `src/engine/invariant_harness/core.py:761` | 0 | unique |
| `_check_equity_curve_continuous` | function | `src/engine/invariant_harness/core.py:849` | 0 | unique |
| `InvariantHarness` | class | `src/engine/invariant_harness/core.py:932` | 1 | unique |
| `run_invariants` | function | `src/engine/invariant_harness/core.py:990` | 2 | unique |

</details>

<details><summary><code>src/engine/ising_decoder_wrapper.py</code> - 6 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `IsingDecoderWrapper` | class | `src/engine/ising_decoder_wrapper.py:76` | 0 | unique |
| `_cuda_available` | function | `src/engine/ising_decoder_wrapper.py:284` | 0 | unique |
| `_syndromes_to_matrix` | function | `src/engine/ising_decoder_wrapper.py:298` | 0 | unique |
| `_run_onnx_inference` | function | `src/engine/ising_decoder_wrapper.py:320` | 0 | unique |
| `_run_pymatching` | function | `src/engine/ising_decoder_wrapper.py:335` | 0 | unique |
| `create_decoder` | function | `src/engine/ising_decoder_wrapper.py:372` | 1 | unique |

</details>

<details><summary><code>src/engine/jsonb_contracts.py</code> - 6 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `InvariantCheck` | class | `src/engine/jsonb_contracts.py:62` | 2 | AMBIG |
| `Invariants` | class | `src/engine/jsonb_contracts.py:68` | 0 | unique |
| `ParityShadow` | class | `src/engine/jsonb_contracts.py:73` | 0 | unique |
| `DslGuards` | class | `src/engine/jsonb_contracts.py:79` | 0 | unique |
| `GovernorSnapshot` | class | `src/engine/jsonb_contracts.py:85` | 0 | unique |
| `BacktestResultExtras` | class | `src/engine/jsonb_contracts.py:92` | 1 | unique |

</details>

<details><summary><code>src/engine/liquidity.py</code> - 5 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_to_et_hours_minutes` | function | `src/engine/liquidity.py:43` | 0 | unique |
| `_time_in_range` | function | `src/engine/liquidity.py:62` | 0 | unique |
| `classify_session` | function | `src/engine/liquidity.py:77` | 3 | AMBIG |
| `get_session_multipliers` | function | `src/engine/liquidity.py:114` | 1 | unique |
| `compute_fill_probability_by_volume` | function | `src/engine/liquidity.py:134` | 1 | unique |

</details>

<details><summary><code>src/engine/margin_expansion.py</code> - 4 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_get_vix_expansion_env` | function | `src/engine/margin_expansion.py:42` | 0 | unique |
| `apply_vix_margin_expansion` | function | `src/engine/margin_expansion.py:56` | 1 | unique |
| `get_vix_expansion_audit` | function | `src/engine/margin_expansion.py:100` | 1 | unique |
| `apply_vix_atr_multiplier` | function | `src/engine/margin_expansion.py:168` | 1 | unique |

</details>

<details><summary><code>src/engine/marker_contract.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `build_export_canonical` | function | `src/engine/marker_contract.py:21` | 1 | unique |

</details>

<details><summary><code>src/engine/mc_confidence.py</code> - 6 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `compute_mc_confidence_intervals` | function | `src/engine/mc_confidence.py:56` | 1 | unique |
| `survival_rate_stat` | function | `src/engine/mc_confidence.py:153` | 0 | unique |
| `max_drawdown_p5_stat` | function | `src/engine/mc_confidence.py:158` | 0 | unique |
| `probability_of_ruin_stat` | function | `src/engine/mc_confidence.py:175` | 0 | unique |
| `cvar95_stat` | function | `src/engine/mc_confidence.py:180` | 0 | unique |
| `compute_all_mc_cis` | function | `src/engine/mc_confidence.py:188` | 1 | unique |

</details>

<details><summary><code>src/engine/mc_multi_asset.py</code> - 3 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_create_rng` | function | `src/engine/mc_multi_asset.py:56` | 1 | AMBIG |
| `compute_correlation_matrix` | function | `src/engine/mc_multi_asset.py:64` | 0 | unique |
| `multi_asset_block_bootstrap` | function | `src/engine/mc_multi_asset.py:129` | 0 | unique |

</details>

<details><summary><code>src/engine/mc_regime_resampling.py</code> - 5 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_create_rng` | function | `src/engine/mc_regime_resampling.py:46` | 1 | AMBIG |
| `segment_trades_by_regime` | function | `src/engine/mc_regime_resampling.py:63` | 0 | unique |
| `estimate_regime_transition_matrix` | function | `src/engine/mc_regime_resampling.py:100` | 0 | unique |
| `compute_regime_distribution` | function | `src/engine/mc_regime_resampling.py:138` | 0 | unique |
| `regime_aware_block_bootstrap` | function | `src/engine/mc_regime_resampling.py:151` | 0 | unique |

</details>

<details><summary><code>src/engine/monte_carlo.py</code> - 26 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `ExtrapolationExceededError` | class | `src/engine/monte_carlo.py:61` | 0 | unique |
| `create_authoritative_rng` | function | `src/engine/monte_carlo.py:87` | 3 | unique |
| `adjust_p_value_bonferroni` | function | `src/engine/monte_carlo.py:100` | 0 | unique |
| `get_array_module` | function | `src/engine/monte_carlo.py:109` | 0 | unique |
| `_to_numpy` | function | `src/engine/monte_carlo.py:116` | 0 | unique |
| `trade_resample` | function | `src/engine/monte_carlo.py:127` | 0 | unique |
| `return_bootstrap` | function | `src/engine/monte_carlo.py:168` | 0 | unique |
| `_safe_autocorrelation` | function | `src/engine/monte_carlo.py:316` | 0 | unique |
| `optimal_block_length` | function | `src/engine/monte_carlo.py:385` | 0 | unique |
| `_block_bootstrap_python` | function | `src/engine/monte_carlo.py:456` | 0 | unique |
| `block_bootstrap` | function | `src/engine/monte_carlo.py:471` | 0 | unique |
| `arch_stationary_bootstrap` | function | `src/engine/monte_carlo.py:557` | 0 | unique |
| `stress_test_trades` | function | `src/engine/monte_carlo.py:611` | 0 | unique |
| `inject_synthetic_stress` | function | `src/engine/monte_carlo.py:659` | 1 | unique |
| `_get_stress_params` | function | `src/engine/monte_carlo.py:705` | 0 | unique |
| `trim_trade_outliers` | function | `src/engine/monte_carlo.py:726` | 0 | unique |
| `simulate_firm_survival` | function | `src/engine/monte_carlo.py:825` | 1 | unique |
| `compute_drawdown_stats` | function | `src/engine/monte_carlo.py:1255` | 0 | unique |
| `check_convergence` | function | `src/engine/monte_carlo.py:1367` | 0 | unique |
| `_compute_max_drawdowns` | function | `src/engine/monte_carlo.py:1393` | 0 | unique |
| `_compute_sharpe_ratios` | function | `src/engine/monte_carlo.py:1401` | 0 | unique |
| `_compute_percentiles` | function | `src/engine/monte_carlo.py:1416` | 0 | unique |
| `_sample_paths` | function | `src/engine/monte_carlo.py:1426` | 0 | unique |
| `_compute_risk_metrics` | function | `src/engine/monte_carlo.py:1448` | 0 | unique |
| `run_monte_carlo` | function | `src/engine/monte_carlo.py:1467` | 4 | unique |
| `main` | function | `src/engine/monte_carlo.py:2219` | 182 | AMBIG |

</details>

<details><summary><code>src/engine/nemo_scenario_designer.py</code> - 5 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_try_import_data_designer` | function | `src/engine/nemo_scenario_designer.py:94` | 0 | unique |
| `GenerationResult` | class | `src/engine/nemo_scenario_designer.py:125` | 0 | unique |
| `NeMoScenarioDesigner` | class | `src/engine/nemo_scenario_designer.py:156` | 1 | unique |
| `NeMoScenario` | class | `src/engine/nemo_scenario_designer.py:617` | 1 | unique |
| `_cli_main` | function | `src/engine/nemo_scenario_designer.py:654` | 4 | AMBIG |

</details>

<details><summary><code>src/engine/nvtx_markers.py</code> - 3 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `annotate` | function | `src/engine/nvtx_markers.py:35` | 4 | unique |
| `range_push` | function | `src/engine/nvtx_markers.py:46` | 3 | unique |
| `range_pop` | function | `src/engine/nvtx_markers.py:52` | 3 | unique |

</details>

<details><summary><code>src/engine/opening_range_adapter.py</code> - 4 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `OpeningRangeBar` | class | `src/engine/opening_range_adapter.py:96` | 1 | unique |
| `_window_bounds` | function | `src/engine/opening_range_adapter.py:133` | 1 | unique |
| `_aggregate_levels` | function | `src/engine/opening_range_adapter.py:184` | 0 | unique |
| `compute_opening_range_state` | function | `src/engine/opening_range_adapter.py:237` | 1 | unique |

</details>

<details><summary><code>src/engine/opening_range_candidate.py</code> - 2 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `OpeningRangeExecutionCandidate` | class | `src/engine/opening_range_candidate.py:78` | 3 | unique |
| `expand_execution_candidates` | function | `src/engine/opening_range_candidate.py:170` | 1 | unique |

</details>

<details><summary><code>src/engine/opening_range_definition.py</code> - 6 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `OpeningRangeWindowStatus` | class | `src/engine/opening_range_definition.py:65` | 1 | unique |
| `OpeningRangeProvenance` | class | `src/engine/opening_range_definition.py:88` | 1 | unique |
| `OpeningRangeVariant` | class | `src/engine/opening_range_definition.py:105` | 3 | unique |
| `OpeningRangeDefinition` | class | `src/engine/opening_range_definition.py:125` | 3 | unique |
| `OpeningRangeState` | class | `src/engine/opening_range_definition.py:189` | 1 | unique |
| `classify_opening_range_definition` | function | `src/engine/opening_range_definition.py:384` | 1 | unique |

</details>

<details><summary><code>src/engine/optimizer.py</code> - 7 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_build_search_space` | function | `src/engine/optimizer.py:25` | 1 | unique |
| `_apply_params` | function | `src/engine/optimizer.py:61` | 1 | unique |
| `_update_expression` | function | `src/engine/optimizer.py:93` | 0 | unique |
| `optimize_strategy` | function | `src/engine/optimizer.py:113` | 1 | unique |
| `run_robustness_test` | function | `src/engine/optimizer.py:184` | 0 | unique |
| `_get_optimizer_cache_dir` | function | `src/engine/optimizer.py:281` | 0 | unique |
| `_write_optimizer_cache` | function | `src/engine/optimizer.py:287` | 0 | unique |

</details>

<details><summary><code>src/engine/paper_analytics.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `generate_session_report` | function | `src/engine/paper_analytics.py:22` | 0 | unique |

</details>

<details><summary><code>src/engine/parameter_evolver.py</code> - 6 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_validate_lookahead_guard` | function | `src/engine/parameter_evolver.py:81` | 0 | unique |
| `_summarise_mutation_outcomes` | function | `src/engine/parameter_evolver.py:95` | 0 | unique |
| `build_mutation_prompt` | function | `src/engine/parameter_evolver.py:122` | 0 | unique |
| `call_ollama` | function | `src/engine/parameter_evolver.py:223` | 0 | unique |
| `validate_mutations` | function | `src/engine/parameter_evolver.py:259` | 0 | unique |
| `evolve` | function | `src/engine/parameter_evolver.py:402` | 0 | unique |

</details>

<details><summary><code>src/engine/parameter_jitter_battery.py</code> - 14 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_extract_numeric_params` | function | `src/engine/parameter_jitter_battery.py:82` | 0 | unique |
| `_set_nested` | function | `src/engine/parameter_jitter_battery.py:107` | 0 | unique |
| `_apply_jitter` | function | `src/engine/parameter_jitter_battery.py:132` | 0 | unique |
| `_get_nested` | function | `src/engine/parameter_jitter_battery.py:166` | 0 | unique |
| `_run_backtest_for_dsl` | function | `src/engine/parameter_jitter_battery.py:182` | 0 | unique |
| `compute_sdr` | function | `src/engine/parameter_jitter_battery.py:206` | 0 | unique |
| `compute_psi` | function | `src/engine/parameter_jitter_battery.py:282` | 0 | unique |
| `compute_rws` | function | `src/engine/parameter_jitter_battery.py:367` | 0 | unique |
| `_sharpe_from_monthly_returns` | function | `src/engine/parameter_jitter_battery.py:473` | 0 | unique |
| `run_b15_battery` | function | `src/engine/parameter_jitter_battery.py:488` | 1 | unique |
| `_extract_pf` | function | `src/engine/parameter_jitter_battery.py:580` | 0 | unique |
| `_extract_sharpe` | function | `src/engine/parameter_jitter_battery.py:591` | 0 | unique |
| `_extract_max_dd` | function | `src/engine/parameter_jitter_battery.py:602` | 0 | unique |
| `_build_ablation_metrics` | function | `src/engine/parameter_jitter_battery.py:613` | 0 | unique |

</details>

<details><summary><code>src/engine/parity_engine</code> - 27 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `BTTrade` | class | `src/engine/parity_engine/backtrader_adapter.py:40` | 1 | unique |
| `_StratCfg` | class | `src/engine/parity_engine/backtrader_adapter.py:58` | 0 | unique |
| `_validate_dsl` | function | `src/engine/parity_engine/backtrader_adapter.py:74` | 0 | unique |
| `_TradeMixin` | class | `src/engine/parity_engine/backtrader_adapter.py:85` | 0 | unique |
| `EMACrossoverStrategy` | class | `src/engine/parity_engine/backtrader_adapter.py:184` | 0 | unique |
| `ATRBreakoutStrategy` | class | `src/engine/parity_engine/backtrader_adapter.py:255` | 0 | unique |
| `run_backtrader` | function | `src/engine/parity_engine/backtrader_adapter.py:321` | 1 | unique |
| `VBTTrade` | class | `src/engine/parity_engine/diff_harness.py:40` | 0 | unique |
| `ParityResult` | class | `src/engine/parity_engine/diff_harness.py:53` | 1 | unique |
| `_compute_ema` | function | `src/engine/parity_engine/diff_harness.py:78` | 0 | unique |
| `_compute_atr_ewm` | function | `src/engine/parity_engine/diff_harness.py:97` | 0 | unique |
| `_sharpe_from_pnls` | function | `src/engine/parity_engine/diff_harness.py:118` | 0 | unique |
| `_run_vbt_ema_crossover` | function | `src/engine/parity_engine/diff_harness.py:136` | 0 | unique |
| `_run_vbt_atr_breakout` | function | `src/engine/parity_engine/diff_harness.py:309` | 0 | unique |
| `run_parity_diff` | function | `src/engine/parity_engine/diff_harness.py:458` | 1 | unique |
| `parity_supported` | function | `src/engine/parity_engine/shadow_runner.py:50` | 0 | unique |
| `_reconstruct_dsl` | function | `src/engine/parity_engine/shadow_runner.py:66` | 0 | unique |
| `_detect_entry_indicator` | function | `src/engine/parity_engine/shadow_runner.py:99` | 0 | unique |
| `_extract_entry_params` | function | `src/engine/parity_engine/shadow_runner.py:119` | 0 | unique |
| `_extract_stop_multiple` | function | `src/engine/parity_engine/shadow_runner.py:163` | 0 | unique |
| `_extract_tp_multiple` | function | `src/engine/parity_engine/shadow_runner.py:184` | 0 | unique |
| `_detect_direction` | function | `src/engine/parity_engine/shadow_runner.py:200` | 0 | unique |
| `_extract_production_data` | function | `src/engine/parity_engine/shadow_runner.py:223` | 0 | unique |
| `_load_tolerances` | function | `src/engine/parity_engine/shadow_runner.py:265` | 0 | unique |
| `_disabled_report` | function | `src/engine/parity_engine/shadow_runner.py:287` | 0 | unique |
| `_skipped_report` | function | `src/engine/parity_engine/shadow_runner.py:309` | 0 | unique |
| `_error_report` | function | `src/engine/parity_engine/shadow_runner.py:331` | 0 | unique |

</details>

<details><summary><code>src/engine/pbo_gate.py</code> - 2 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `compute_pbo_from_cpcv_paths` | function | `src/engine/pbo_gate.py:48` | 1 | unique |
| `_build_cpcv_paths_from_window_results` | function | `src/engine/pbo_gate.py:213` | 1 | unique |

</details>

<details><summary><code>src/engine/performance_gate.py</code> - 3 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `check_performance_gate` | function | `src/engine/performance_gate.py:57` | 1 | unique |
| `classify_tier` | function | `src/engine/performance_gate.py:227` | 1 | unique |
| `compute_forge_score` | function | `src/engine/performance_gate.py:257` | 1 | unique |

</details>

<details><summary><code>src/engine/pine_compiler.py</code> - 36 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `PineCompileError` | class | `src/engine/pine_compiler.py:68` | 0 | unique |
| `_build_archetype_alert_pine` | function | `src/engine/pine_compiler.py:101` | 0 | unique |
| `PineArtifact` | class | `src/engine/pine_compiler.py:322` | 0 | unique |
| `CompilerResult` | class | `src/engine/pine_compiler.py:329` | 0 | unique |
| `_build_pine_indicator_var` | function | `src/engine/pine_compiler.py:337` | 0 | unique |
| `_build_entry_condition` | function | `src/engine/pine_compiler.py:489` | 0 | unique |
| `_build_exit_condition` | function | `src/engine/pine_compiler.py:525` | 0 | unique |
| `_build_exit_signal_pine` | function | `src/engine/pine_compiler.py:541` | 0 | unique |
| `_build_time_stop_block` | function | `src/engine/pine_compiler.py:591` | 0 | unique |
| `_build_strategy_time_stop_close` | function | `src/engine/pine_compiler.py:610` | 0 | unique |
| `_build_indicator_time_stop_alert` | function | `src/engine/pine_compiler.py:619` | 0 | unique |
| `_build_state_machine` | function | `src/engine/pine_compiler.py:632` | 0 | unique |
| `_build_prop_overlay` | function | `src/engine/pine_compiler.py:687` | 0 | unique |
| `_build_strategy_risk_tracking` | function | `src/engine/pine_compiler.py:756` | 0 | unique |
| `_build_indicator_risk_lockout_warning` | function | `src/engine/pine_compiler.py:796` | 0 | unique |
| `_build_risk_intelligence_overlay` | function | `src/engine/pine_compiler.py:826` | 0 | unique |
| `_build_alerts` | function | `src/engine/pine_compiler.py:895` | 0 | unique |
| `_build_session_filter` | function | `src/engine/pine_compiler.py:923` | 0 | unique |
| `_build_visualization` | function | `src/engine/pine_compiler.py:990` | 0 | unique |
| `_resolve_archetype_prefix` | function | `src/engine/pine_compiler.py:1037` | 0 | unique |
| `_build_archetype_alerts_json` | function | `src/engine/pine_compiler.py:1059` | 0 | unique |
| `_compile_archetype_only` | function | `src/engine/pine_compiler.py:1107` | 0 | unique |
| `compile_strategy` | function | `src/engine/pine_compiler.py:1158` | 0 | unique |
| `DualArtifactResult` | class | `src/engine/pine_compiler.py:1548` | 0 | unique |
| `_build_indicator_alert_messages` | function | `src/engine/pine_compiler.py:1568` | 0 | unique |
| `_build_marker_alertcondition` | function | `src/engine/pine_compiler.py:1623` | 0 | unique |
| `_build_strategy_webhook_alerts` | function | `src/engine/pine_compiler.py:1697` | 0 | unique |
| `_build_atr_qty_block` | function | `src/engine/pine_compiler.py:1849` | 0 | unique |
| `_build_regime_block` | function | `src/engine/pine_compiler.py:1888` | 0 | unique |
| `_build_event_blackout_block` | function | `src/engine/pine_compiler.py:1925` | 0 | unique |
| `_build_anti_setup_block` | function | `src/engine/pine_compiler.py:2008` | 0 | unique |
| `_build_shared_preamble` | function | `src/engine/pine_compiler.py:2067` | 0 | unique |
| `_build_indicator_artifact` | function | `src/engine/pine_compiler.py:2144` | 0 | unique |
| `_build_strategy_artifact` | function | `src/engine/pine_compiler.py:2185` | 0 | unique |
| `_compile_dual_archetype_only` | function | `src/engine/pine_compiler.py:2304` | 0 | unique |
| `compile_dual_artifacts` | function | `src/engine/pine_compiler.py:2390` | 0 | unique |

</details>

<details><summary><code>src/engine/pm_size_factor.py</code> - 6 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `PmSizeFactorResult` | class | `src/engine/pm_size_factor.py:37` | 1 | AMBIG |
| `_parse_hh_mm` | function | `src/engine/pm_size_factor.py:45` | 0 | unique |
| `_to_et_minute_of_day` | function | `src/engine/pm_size_factor.py:62` | 1 | AMBIG |
| `get_pm_size_factor_env_defaults` | function | `src/engine/pm_size_factor.py:70` | 0 | unique |
| `compute_pm_size_factor` | function | `src/engine/pm_size_factor.py:97` | 0 | unique |
| `compute_pm_size_factor_vec` | function | `src/engine/pm_size_factor.py:196` | 1 | unique |

</details>

<details><summary><code>src/engine/prop_compliance.py</code> - 4 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `simulate_trailing_drawdown_eod` | function | `src/engine/prop_compliance.py:79` | 0 | unique |
| `simulate_trailing_drawdown_realtime` | function | `src/engine/prop_compliance.py:117` | 0 | unique |
| `check_tpt_consistency` | function | `src/engine/prop_compliance.py:151` | 0 | unique |
| `_compute_net_daily_pnls` | function | `src/engine/prop_compliance.py:188` | 0 | unique |

</details>

<details><summary><code>src/engine/prop_sim.py</code> - 3 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_get_all_firm_configs` | function | `src/engine/prop_sim.py:27` | 0 | unique |
| `simulate_prop_firm` | function | `src/engine/prop_sim.py:32` | 0 | unique |
| `simulate_all_firms` | function | `src/engine/prop_sim.py:517` | 2 | unique |

</details>

<details><summary><code>src/engine/qmc_sampler.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `QMCSampler` | class | `src/engine/qmc_sampler.py:19` | 1 | unique |

</details>

<details><summary><code>src/engine/quantum_adversarial_stress.py</code> - 7 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `TradeRecord` | class | `src/engine/quantum_adversarial_stress.py:68` | 1 | AMBIG |
| `PropFirmRules` | class | `src/engine/quantum_adversarial_stress.py:77` | 0 | unique |
| `AdversarialStressResult` | class | `src/engine/quantum_adversarial_stress.py:84` | 0 | unique |
| `_compute_breach_prob_classical` | function | `src/engine/quantum_adversarial_stress.py:109` | 0 | unique |
| `_grover_circuit` | function | `src/engine/quantum_adversarial_stress.py:201` | 0 | unique |
| `_run_grover` | function | `src/engine/quantum_adversarial_stress.py:319` | 0 | unique |
| `run_adversarial_stress` | function | `src/engine/quantum_adversarial_stress.py:454` | 0 | unique |

</details>

<details><summary><code>src/engine/quantum_annealing_optimizer.py</code> - 8 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `ParamRange` | class | `src/engine/quantum_annealing_optimizer.py:46` | 0 | unique |
| `QUBOFormulation` | class | `src/engine/quantum_annealing_optimizer.py:54` | 0 | unique |
| `SQAResult` | class | `src/engine/quantum_annealing_optimizer.py:62` | 0 | unique |
| `ComparisonResult` | class | `src/engine/quantum_annealing_optimizer.py:83` | 1 | AMBIG |
| `_decode_binary` | function | `src/engine/quantum_annealing_optimizer.py:97` | 0 | unique |
| `build_parameter_qubo` | function | `src/engine/quantum_annealing_optimizer.py:125` | 0 | unique |
| `run_sqa_optimization` | function | `src/engine/quantum_annealing_optimizer.py:184` | 0 | unique |
| `find_robust_plateau` | function | `src/engine/quantum_annealing_optimizer.py:345` | 0 | unique |

</details>

<details><summary><code>src/engine/quantum_device_selector.py</code> - 2 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `select_quantum_device` | function | `src/engine/quantum_device_selector.py:33` | 4 | unique |
| `_select` | function | `src/engine/quantum_device_selector.py:63` | 0 | unique |

</details>

<details><summary><code>src/engine/quantum_entropy_filter.py</code> - 5 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_get_cost_endpoint` | function | `src/engine/quantum_entropy_filter.py:52` | 0 | unique |
| `_post_cost_telemetry` | function | `src/engine/quantum_entropy_filter.py:60` | 0 | unique |
| `_normalize_features` | function | `src/engine/quantum_entropy_filter.py:149` | 1 | AMBIG |
| `_build_qcnn_circuit` | function | `src/engine/quantum_entropy_filter.py:180` | 0 | unique |
| `run_quantum_entropy_filter` | function | `src/engine/quantum_entropy_filter.py:309` | 1 | unique |

</details>

<details><summary><code>src/engine/quantum_mc.py</code> - 8 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_run_iae_with_watchdog` | function | `src/engine/quantum_mc.py:101` | 0 | unique |
| `QuantumRunResult` | class | `src/engine/quantum_mc.py:189` | 1 | unique |
| `HybridCompareResult` | class | `src/engine/quantum_mc.py:209` | 0 | unique |
| `_build_probability_oracle` | function | `src/engine/quantum_mc.py:220` | 0 | unique |
| `_compute_classical_probability` | function | `src/engine/quantum_mc.py:251` | 1 | unique |
| `run_quantum_breach_estimation` | function | `src/engine/quantum_mc.py:265` | 1 | unique |
| `run_quantum_ruin_estimation` | function | `src/engine/quantum_mc.py:278` | 1 | unique |
| `_run_estimation` | function | `src/engine/quantum_mc.py:317` | 0 | unique |

</details>

<details><summary><code>src/engine/quantum_models.py</code> - 5 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `UncertaintyModel` | class | `src/engine/quantum_models.py:27` | 2 | unique |
| `fit_truncated_normal` | function | `src/engine/quantum_models.py:40` | 1 | unique |
| `fit_mixture_model` | function | `src/engine/quantum_models.py:82` | 0 | unique |
| `fit_regime_bucket_model` | function | `src/engine/quantum_models.py:137` | 0 | unique |
| `build_empirical_binned_distribution` | function | `src/engine/quantum_models.py:171` | 2 | unique |

</details>

<details><summary><code>src/engine/quantum_rl_agent.py</code> - 21 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_safe_float` | function | `src/engine/quantum_rl_agent.py:405` | 2 | AMBIG |
| `_safe_int` | function | `src/engine/quantum_rl_agent.py:415` | 0 | unique |
| `_classify_session_phase` | function | `src/engine/quantum_rl_agent.py:425` | 0 | unique |
| `_classify_killzone` | function | `src/engine/quantum_rl_agent.py:445` | 0 | unique |
| `_try_compute_noise_score` | function | `src/engine/quantum_rl_agent.py:467` | 0 | unique |
| `serialize_state_to_numpy` | function | `src/engine/quantum_rl_agent.py:516` | 0 | unique |
| `VQCConfig` | class | `src/engine/quantum_rl_agent.py:574` | 0 | unique |
| `TrainConfig` | class | `src/engine/quantum_rl_agent.py:587` | 0 | unique |
| `AgentResult` | class | `src/engine/quantum_rl_agent.py:595` | 0 | unique |
| `ComparisonResult` | class | `src/engine/quantum_rl_agent.py:607` | 1 | AMBIG |
| `TradingEnv` | class | `src/engine/quantum_rl_agent.py:620` | 0 | unique |
| `ClassicalAgent` | class | `src/engine/quantum_rl_agent.py:866` | 0 | unique |
| `build_vqc_policy` | function | `src/engine/quantum_rl_agent.py:897` | 0 | unique |
| `QuantumAgent` | class | `src/engine/quantum_rl_agent.py:1030` | 0 | unique |
| `train_quantum_agent` | function | `src/engine/quantum_rl_agent.py:1089` | 0 | unique |
| `evaluate_agent` | function | `src/engine/quantum_rl_agent.py:1221` | 0 | unique |
| `compare_vs_classical_rl` | function | `src/engine/quantum_rl_agent.py:1261` | 0 | unique |
| `_build_vqc_policy_ibm` | function | `src/engine/quantum_rl_agent.py:1385` | 0 | unique |
| `compute_effective_confidence` | function | `src/engine/quantum_rl_agent.py:1490` | 0 | unique |
| `_emit_audit_row` | function | `src/engine/quantum_rl_agent.py:1544` | 0 | unique |
| `train_regime_conditioned_policies` | function | `src/engine/quantum_rl_agent.py:1584` | 0 | unique |

</details>

<details><summary><code>src/engine/qubo_trade_timing.py</code> - 9 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `SessionBlock` | class | `src/engine/qubo_trade_timing.py:75` | 0 | unique |
| `TimingSchedule` | class | `src/engine/qubo_trade_timing.py:85` | 0 | unique |
| `TimingBacktestResult` | class | `src/engine/qubo_trade_timing.py:103` | 0 | unique |
| `TimingComparisonResult` | class | `src/engine/qubo_trade_timing.py:115` | 0 | unique |
| `discretize_session` | function | `src/engine/qubo_trade_timing.py:124` | 0 | unique |
| `build_timing_qubo` | function | `src/engine/qubo_trade_timing.py:149` | 0 | unique |
| `solve_timing` | function | `src/engine/qubo_trade_timing.py:208` | 0 | unique |
| `decode_timing_schedule` | function | `src/engine/qubo_trade_timing.py:265` | 0 | unique |
| `backtest_timing_schedule` | function | `src/engine/qubo_trade_timing.py:307` | 0 | unique |

</details>

<details><summary><code>src/engine/regime.py</code> - 5 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `classify_regime` | function | `src/engine/regime.py:45` | 1 | AMBIG |
| `fit_hmm_regime` | function | `src/engine/regime.py:187` | 0 | unique |
| `_compute_avg_duration` | function | `src/engine/regime.py:259` | 0 | unique |
| `_compute_regime_persistence` | function | `src/engine/regime.py:275` | 0 | unique |
| `main` | function | `src/engine/regime.py:293` | 182 | AMBIG |

</details>

<details><summary><code>src/engine/replay</code> - 31 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `SchemaContractMismatch` | class | `src/engine/replay/db_loader.py:79` | 1 | unique |
| `WalkForwardFold` | class | `src/engine/replay/db_loader.py:97` | 1 | unique |
| `BacktestForReplay` | class | `src/engine/replay/db_loader.py:109` | 1 | unique |
| `_get_db_connection` | function | `src/engine/replay/db_loader.py:153` | 0 | unique |
| `_normalise_daily_pnls` | function | `src/engine/replay/db_loader.py:181` | 0 | unique |
| `_check_pnl_balance_invariant` | function | `src/engine/replay/db_loader.py:254` | 0 | unique |
| `_apply_oos_embargo` | function | `src/engine/replay/db_loader.py:315` | 0 | unique |
| `_load_walk_forward_folds` | function | `src/engine/replay/db_loader.py:366` | 0 | unique |
| `_load_oos_trades` | function | `src/engine/replay/db_loader.py:442` | 0 | unique |
| `load_backtest_with_folds` | function | `src/engine/replay/db_loader.py:528` | 2 | unique |
| `load_all_backtests_with_folds` | function | `src/engine/replay/db_loader.py:606` | 2 | unique |
| `load_classical_baseline` | function | `src/engine/replay/db_loader.py:664` | 1 | unique |
| `load_backtest_bar_data` | function | `src/engine/replay/db_loader.py:729` | 1 | unique |
| `_safe_float_bar` | function | `src/engine/replay/db_loader.py:945` | 0 | unique |
| `write_replay_row` | function | `src/engine/replay/db_loader.py:955` | 2 | unique |
| `_StubBacktestForReplay` | class | `src/engine/replay/quantum_replay.py:95` | 0 | unique |
| `_stub_load_backtest_with_folds` | function | `src/engine/replay/quantum_replay.py:107` | 0 | unique |
| `_stub_load_all_backtests_with_folds` | function | `src/engine/replay/quantum_replay.py:112` | 0 | unique |
| `_stub_load_classical_baseline` | function | `src/engine/replay/quantum_replay.py:117` | 0 | unique |
| `_stub_write_replay_row` | function | `src/engine/replay/quantum_replay.py:122` | 0 | unique |
| `_get_db_fns` | function | `src/engine/replay/quantum_replay.py:133` | 0 | unique |
| `ReplayResult` | class | `src/engine/replay/quantum_replay.py:158` | 0 | unique |
| `_compute_quantum_mc_git_sha` | function | `src/engine/replay/quantum_replay.py:192` | 0 | unique |
| `compute_reproducibility_hash` | function | `src/engine/replay/quantum_replay.py:215` | 1 | AMBIG |
| `_run_single_replay` | function | `src/engine/replay/quantum_replay.py:239` | 0 | unique |
| `replay_quantum_on_backtest` | function | `src/engine/replay/quantum_replay.py:438` | 0 | unique |
| `replay_quantum_on_all_backtests` | function | `src/engine/replay/quantum_replay.py:540` | 0 | unique |
| `_result_to_db_row` | function | `src/engine/replay/quantum_replay.py:583` | 1 | AMBIG |
| `_print_result` | function | `src/engine/replay/quantum_replay.py:623` | 0 | unique |
| `_print_summary` | function | `src/engine/replay/quantum_replay.py:637` | 1 | AMBIG |
| `_build_parser` | function | `src/engine/replay/quantum_replay.py:666` | 0 | unique |

</details>

<details><summary><code>src/engine/risk_metrics.py</code> - 18 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `compute_max_drawdown_distribution` | function | `src/engine/risk_metrics.py:13` | 0 | unique |
| `compute_probability_of_ruin` | function | `src/engine/risk_metrics.py:40` | 0 | unique |
| `compute_sharpe_distribution` | function | `src/engine/risk_metrics.py:61` | 0 | unique |
| `compute_calmar_ratio` | function | `src/engine/risk_metrics.py:98` | 0 | unique |
| `compute_ulcer_index` | function | `src/engine/risk_metrics.py:132` | 0 | unique |
| `compute_time_to_recovery` | function | `src/engine/risk_metrics.py:153` | 0 | unique |
| `compute_var` | function | `src/engine/risk_metrics.py:196` | 0 | unique |
| `compute_cvar` | function | `src/engine/risk_metrics.py:222` | 0 | unique |
| `compute_drawdown_duration` | function | `src/engine/risk_metrics.py:247` | 0 | unique |
| `compute_lo_sharpe_distribution` | function | `src/engine/risk_metrics.py:318` | 0 | unique |
| `compute_omega_ratio` | function | `src/engine/risk_metrics.py:382` | 0 | unique |
| `compute_tail_ratio` | function | `src/engine/risk_metrics.py:407` | 0 | unique |
| `compute_kelly_fraction` | function | `src/engine/risk_metrics.py:423` | 0 | unique |
| `compute_permutation_test` | function | `src/engine/risk_metrics.py:448` | 1 | unique |
| `compute_deflated_sharpe_ratio` | function | `src/engine/risk_metrics.py:505` | 4 | unique |
| `compute_information_ratio` | function | `src/engine/risk_metrics.py:604` | 1 | unique |
| `compute_pbo` | function | `src/engine/risk_metrics.py:659` | 2 | unique |
| `compute_all_risk_metrics` | function | `src/engine/risk_metrics.py:804` | 1 | unique |

</details>

<details><summary><code>src/engine/robust_covariance.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `estimate_covariance` | function | `src/engine/robust_covariance.py:17` | 1 | unique |

</details>

<details><summary><code>src/engine/robustness.py</code> - 3 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `analyze_optuna_study` | function | `src/engine/robustness.py:15` | 1 | unique |
| `compute_param_importance` | function | `src/engine/robustness.py:79` | 1 | unique |
| `extract_robust_range` | function | `src/engine/robustness.py:94` | 1 | unique |

</details>

<details><summary><code>src/engine/role_demotion_audit.py</code> - 3 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_resolve_audit_path` | function | `src/engine/role_demotion_audit.py:48` | 0 | unique |
| `_load_classification_table` | function | `src/engine/role_demotion_audit.py:62` | 0 | unique |
| `get_classifications_for_video` | function | `src/engine/role_demotion_audit.py:94` | 2 | unique |

</details>

<details><summary><code>src/engine/roll_calendar.py</code> - 17 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_is_weekday` | function | `src/engine/roll_calendar.py:79` | 0 | unique |
| `_prev_business_day` | function | `src/engine/roll_calendar.py:84` | 0 | unique |
| `_nth_weekday` | function | `src/engine/roll_calendar.py:99` | 0 | unique |
| `_nth_to_last_business_day` | function | `src/engine/roll_calendar.py:118` | 0 | unique |
| `_equity_quarterly_roll_day` | function | `src/engine/roll_calendar.py:138` | 0 | unique |
| `_equity_quarterly_expiry` | function | `src/engine/roll_calendar.py:143` | 0 | unique |
| `_crude_roll_day` | function | `src/engine/roll_calendar.py:148` | 0 | unique |
| `_gold_roll_day` | function | `src/engine/roll_calendar.py:162` | 0 | unique |
| `_next_equity_quarterly_roll` | function | `src/engine/roll_calendar.py:169` | 0 | unique |
| `_next_crude_roll` | function | `src/engine/roll_calendar.py:179` | 0 | unique |
| `_next_gold_roll` | function | `src/engine/roll_calendar.py:191` | 0 | unique |
| `get_next_roll_date` | function | `src/engine/roll_calendar.py:209` | 0 | unique |
| `is_roll_day` | function | `src/engine/roll_calendar.py:228` | 0 | unique |
| `days_until_roll` | function | `src/engine/roll_calendar.py:250` | 0 | unique |
| `get_active_contract` | function | `src/engine/roll_calendar.py:258` | 0 | unique |
| `get_roll_info` | function | `src/engine/roll_calendar.py:310` | 0 | unique |
| `_main` | function | `src/engine/roll_calendar.py:358` | 1 | AMBIG |

</details>

<details><summary><code>src/engine/roll_spread_cost.py</code> - 7 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_get_roll_spread_itemized` | function | `src/engine/roll_spread_cost.py:53` | 0 | unique |
| `_get_default_roll_ticks` | function | `src/engine/roll_spread_cost.py:61` | 0 | unique |
| `_deterministic_noise` | function | `src/engine/roll_spread_cost.py:95` | 0 | unique |
| `_get_roll_ticks` | function | `src/engine/roll_spread_cost.py:111` | 0 | unique |
| `_ticks_to_usd` | function | `src/engine/roll_spread_cost.py:120` | 0 | unique |
| `compute_roll_spread_cost` | function | `src/engine/roll_spread_cost.py:127` | 1 | unique |
| `build_roll_spread_audit` | function | `src/engine/roll_spread_cost.py:163` | 1 | unique |

</details>

<details><summary><code>src/engine/sanity_checks.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `run_sanity_checks` | function | `src/engine/sanity_checks.py:16` | 2 | unique |

</details>

<details><summary><code>src/engine/session_windows.py</code> - 11 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_to_et_minutes_of_day` | function | `src/engine/session_windows.py:101` | 1 | unique |
| `_is_london` | function | `src/engine/session_windows.py:118` | 0 | unique |
| `_is_ny_am` | function | `src/engine/session_windows.py:122` | 0 | unique |
| `_is_ny_pm` | function | `src/engine/session_windows.py:126` | 0 | unique |
| `_is_silver_bullet` | function | `src/engine/session_windows.py:130` | 0 | unique |
| `_is_macro_window` | function | `src/engine/session_windows.py:138` | 0 | unique |
| `is_in_killzone` | function | `src/engine/session_windows.py:155` | 2 | unique |
| `active_killzones` | function | `src/engine/session_windows.py:164` | 0 | unique |
| `_phrase_hit` | function | `src/engine/session_windows.py:236` | 0 | unique |
| `resolve_session_keyword` | function | `src/engine/session_windows.py:244` | 1 | AMBIG |
| `refused_session_zone` | function | `src/engine/session_windows.py:261` | 1 | AMBIG |

</details>

<details><summary><code>src/engine/signals.py</code> - 8 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_resolve_operand` | function | `src/engine/signals.py:27` | 0 | unique |
| `_crosses_above` | function | `src/engine/signals.py:44` | 0 | unique |
| `_crosses_below` | function | `src/engine/signals.py:53` | 0 | unique |
| `_count_cmp_operators_at_depth0` | function | `src/engine/signals.py:71` | 0 | unique |
| `_eval_simple_expr` | function | `src/engine/signals.py:108` | 0 | unique |
| `_split_at_depth0` | function | `src/engine/signals.py:160` | 0 | unique |
| `evaluate_expression` | function | `src/engine/signals.py:202` | 1 | unique |
| `generate_signals` | function | `src/engine/signals.py:259` | 1 | unique |

</details>

<details><summary><code>src/engine/sizing.py</code> - 8 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `compute_vol_scale` | function | `src/engine/sizing.py:119` | 1 | unique |
| `compute_liquidity_haircut` | function | `src/engine/sizing.py:134` | 1 | unique |
| `RiskSizingResult` | class | `src/engine/sizing.py:160` | 1 | AMBIG |
| `_compute_topstep_trailing_floor` | function | `src/engine/sizing.py:197` | 0 | unique |
| `compute_risk_derived_contracts` | function | `src/engine/sizing.py:215` | 0 | unique |
| `compute_profit_tier` | function | `src/engine/sizing.py:741` | 0 | unique |
| `kelly_optimal_contracts` | function | `src/engine/sizing.py:855` | 0 | unique |
| `compute_position_sizes` | function | `src/engine/sizing.py:946` | 1 | unique |

</details>

<details><summary><code>src/engine/skip_engine</code> - 38 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_nth_weekday_of_month` | function | `src/engine/skip_engine/calendar_filter.py:63` | 0 | unique |
| `_good_friday` | function | `src/engine/skip_engine/calendar_filter.py:88` | 0 | unique |
| `_observed_holiday` | function | `src/engine/skip_engine/calendar_filter.py:108` | 0 | unique |
| `_compute_federal_holidays` | function | `src/engine/skip_engine/calendar_filter.py:122` | 0 | unique |
| `_compute_triple_witching` | function | `src/engine/skip_engine/calendar_filter.py:169` | 0 | unique |
| `_get_holidays_for_year` | function | `src/engine/skip_engine/calendar_filter.py:177` | 0 | unique |
| `_get_triple_witching_for_year` | function | `src/engine/skip_engine/calendar_filter.py:182` | 0 | unique |
| `is_holiday` | function | `src/engine/skip_engine/calendar_filter.py:187` | 2 | unique |
| `_build_extended_events` | function | `src/engine/skip_engine/calendar_filter.py:327` | 0 | unique |
| `_first_friday_of_month` | function | `src/engine/skip_engine/calendar_filter.py:387` | 0 | unique |
| `_second_wednesday_of_month` | function | `src/engine/skip_engine/calendar_filter.py:398` | 0 | unique |
| `_third_wednesday_of_month` | function | `src/engine/skip_engine/calendar_filter.py:403` | 0 | unique |
| `_generate_economic_events_for_year` | function | `src/engine/skip_engine/calendar_filter.py:408` | 0 | unique |
| `_is_us_dst` | function | `src/engine/skip_engine/calendar_filter.py:440` | 0 | unique |
| `_event_minutes_et` | function | `src/engine/skip_engine/calendar_filter.py:454` | 0 | unique |
| `_build_event_date_index` | function | `src/engine/skip_engine/calendar_filter.py:460` | 0 | unique |
| `_get_generated_year_index` | function | `src/engine/skip_engine/calendar_filter.py:481` | 0 | unique |
| `_get_events_for_date` | function | `src/engine/skip_engine/calendar_filter.py:493` | 0 | unique |
| `check_economic_event` | function | `src/engine/skip_engine/calendar_filter.py:503` | 0 | unique |
| `_nearest_distance` | function | `src/engine/skip_engine/calendar_filter.py:547` | 0 | unique |
| `_is_roll_week` | function | `src/engine/skip_engine/calendar_filter.py:554` | 0 | unique |
| `_is_month_end` | function | `src/engine/skip_engine/calendar_filter.py:573` | 0 | unique |
| `_is_quarter_end` | function | `src/engine/skip_engine/calendar_filter.py:586` | 0 | unique |
| `calendar_check` | function | `src/engine/skip_engine/calendar_filter.py:593` | 1 | unique |
| `_score_event_proximity` | function | `src/engine/skip_engine/skip_classifier.py:46` | 1 | unique |
| `_score_vix_level` | function | `src/engine/skip_engine/skip_classifier.py:73` | 1 | unique |
| `_score_overnight_gap` | function | `src/engine/skip_engine/skip_classifier.py:89` | 1 | unique |
| `_score_premarket_volume` | function | `src/engine/skip_engine/skip_classifier.py:103` | 1 | unique |
| `_score_day_of_week` | function | `src/engine/skip_engine/skip_classifier.py:117` | 1 | unique |
| `_score_loss_streak` | function | `src/engine/skip_engine/skip_classifier.py:137` | 1 | unique |
| `_score_monthly_budget` | function | `src/engine/skip_engine/skip_classifier.py:151` | 1 | unique |
| `_score_correlation_spike` | function | `src/engine/skip_engine/skip_classifier.py:165` | 1 | unique |
| `_score_calendar_filter` | function | `src/engine/skip_engine/skip_classifier.py:179` | 1 | unique |
| `_score_qubo_timing` | function | `src/engine/skip_engine/skip_classifier.py:204` | 0 | unique |
| `_score_regime_bias` | function | `src/engine/skip_engine/skip_classifier.py:221` | 0 | unique |
| `_score_quantum_entropy` | function | `src/engine/skip_engine/skip_classifier.py:257` | 0 | unique |
| `_scale_signal_score` | function | `src/engine/skip_engine/skip_classifier.py:285` | 0 | unique |
| `classify_session` | function | `src/engine/skip_engine/skip_classifier.py:309` | 2 | AMBIG |

</details>

<details><summary><code>src/engine/slippage.py</code> - 4 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_get_rounding_mode` | function | `src/engine/slippage.py:43` | 0 | unique |
| `_ceil_ticks` | function | `src/engine/slippage.py:59` | 0 | unique |
| `_round_ticks_by_mode` | function | `src/engine/slippage.py:70` | 0 | unique |
| `compute_slippage` | function | `src/engine/slippage.py:89` | 1 | unique |

</details>

<details><summary><code>src/engine/spec_condition_compiler.py</code> - 8 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_htf_fully_covers` | function | `src/engine/spec_condition_compiler.py:289` | 0 | unique |
| `retest_touch_check` | function | `src/engine/spec_condition_compiler.py:350` | 0 | unique |
| `_ffill_level_series` | function | `src/engine/spec_condition_compiler.py:378` | 0 | unique |
| `population_a_bullish_leaning` | function | `src/engine/spec_condition_compiler.py:398` | 0 | unique |
| `candle_confirmation_check` | function | `src/engine/spec_condition_compiler.py:438` | 0 | unique |
| `_bars_to_ts_list` | function | `src/engine/spec_condition_compiler.py:466` | 0 | unique |
| `SpecConditionStrategy` | class | `src/engine/spec_condition_compiler.py:482` | 1 | unique |
| `from_compiled_spec` | function | `src/engine/spec_condition_compiler.py:2364` | 8 | unique |

</details>

<details><summary><code>src/engine/spec_family_bindings.py</code> - 46 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `fvg_identity_enabled` | function | `src/engine/spec_family_bindings.py:106` | 0 | unique |
| `resolve_fvg_object` | function | `src/engine/spec_family_bindings.py:115` | 1 | unique |
| `levelzone_routing_enabled` | function | `src/engine/spec_family_bindings.py:171` | 0 | unique |
| `resolve_levelzone_object` | function | `src/engine/spec_family_bindings.py:178` | 0 | unique |
| `classify_population_a_kind` | function | `src/engine/spec_family_bindings.py:283` | 1 | unique |
| `levelzone_resolver_enabled` | function | `src/engine/spec_family_bindings.py:302` | 0 | unique |
| `composition_bundle_enabled` | function | `src/engine/spec_family_bindings.py:353` | 0 | unique |
| `or_branches_enabled` | function | `src/engine/spec_family_bindings.py:370` | 2 | unique |
| `role_demotion_mode` | function | `src/engine/spec_family_bindings.py:428` | 1 | unique |
| `struct_demotes` | function | `src/engine/spec_family_bindings.py:437` | 0 | unique |
| `resolve_sweep_object` | function | `src/engine/spec_family_bindings.py:449` | 0 | unique |
| `resolve_mss_object` | function | `src/engine/spec_family_bindings.py:456` | 0 | unique |
| `resolve_bundle_primitive` | function | `src/engine/spec_family_bindings.py:463` | 0 | unique |
| `session_refusal_reason` | function | `src/engine/spec_family_bindings.py:528` | 0 | unique |
| `FamilyMeta` | class | `src/engine/spec_family_bindings.py:550` | 1 | unique |
| `ConditionBinding` | class | `src/engine/spec_family_bindings.py:812` | 3 | AMBIG |
| `_session_phrase_hit` | function | `src/engine/spec_family_bindings.py:918` | 0 | unique |
| `resolve_session_keyword` | function | `src/engine/spec_family_bindings.py:926` | 0 | AMBIG |
| `refused_session_zone` | function | `src/engine/spec_family_bindings.py:940` | 0 | AMBIG |
| `session_zone_window_repr` | function | `src/engine/spec_family_bindings.py:967` | 1 | unique |
| `resolve_session_name_to_window` | function | `src/engine/spec_family_bindings.py:977` | 0 | unique |
| `_session_clock_token_parts` | function | `src/engine/spec_family_bindings.py:1112` | 0 | unique |
| `_session_text_is_constituted_by` | function | `src/engine/spec_family_bindings.py:1176` | 0 | unique |
| `_session_clock_does_work` | function | `src/engine/spec_family_bindings.py:1411` | 0 | unique |
| `_session_noun_qualifier_is_market_compatible` | function | `src/engine/spec_family_bindings.py:1500` | 0 | unique |
| `_session_has_trading_action` | function | `src/engine/spec_family_bindings.py:1689` | 0 | unique |
| `_session_strip_governed_filler` | function | `src/engine/spec_family_bindings.py:1840` | 0 | unique |
| `_session_government_licensed_action_edges` | function | `src/engine/spec_family_bindings.py:1855` | 0 | unique |
| `_session_action_governed_clock` | function | `src/engine/spec_family_bindings.py:1918` | 0 | unique |
| `_session_is_about_markets` | function | `src/engine/spec_family_bindings.py:1958` | 0 | unique |
| `_session_interval_overlap_minutes` | function | `src/engine/spec_family_bindings.py:2027` | 0 | unique |
| `_session_best_real_zone_for_range` | function | `src/engine/spec_family_bindings.py:2031` | 0 | unique |
| `_session_anchor_phrase_is_governed_endpoint` | function | `src/engine/spec_family_bindings.py:2060` | 0 | unique |
| `_session_anchor_sequence_wraps_midnight` | function | `src/engine/spec_family_bindings.py:2115` | 0 | unique |
| `_session_clock_token_minutes` | function | `src/engine/spec_family_bindings.py:2139` | 0 | unique |
| `SessionRoleResult` | class | `src/engine/spec_family_bindings.py:2164` | 0 | unique |
| `classify_session_role` | function | `src/engine/spec_family_bindings.py:2222` | 0 | unique |
| `session_role_resolver_enabled` | function | `src/engine/spec_family_bindings.py:2446` | 0 | unique |
| `resolve_exact_clock_span` | function | `src/engine/spec_family_bindings.py:2470` | 0 | unique |
| `_derive_session_zone_window_by_execution` | function | `src/engine/spec_family_bindings.py:2532` | 0 | unique |
| `_session_keyword_fidelity_approximation` | function | `src/engine/spec_family_bindings.py:2582` | 0 | unique |
| `_bind_condition_dispatch` | function | `src/engine/spec_family_bindings.py:2601` | 0 | unique |
| `bind_condition` | function | `src/engine/spec_family_bindings.py:2995` | 0 | unique |
| `BindingPlan` | class | `src/engine/spec_family_bindings.py:3028` | 4 | AMBIG |
| `_refuse_ambiguous_breakout_trigger` | function | `src/engine/spec_family_bindings.py:3057` | 0 | unique |
| `compile_binding_plan` | function | `src/engine/spec_family_bindings.py:3137` | 8 | unique |

</details>

<details><summary><code>src/engine/statistics</code> - 15 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_get_warn_threshold` | function | `src/engine/statistics/backtest_inflation_factor.py:69` | 0 | unique |
| `_get_block_threshold` | function | `src/engine/statistics/backtest_inflation_factor.py:77` | 0 | unique |
| `compute_bif` | function | `src/engine/statistics/backtest_inflation_factor.py:87` | 2 | unique |
| `get_spa_p_threshold` | function | `src/engine/statistics/hansens_spa.py:46` | 0 | unique |
| `hansens_spa` | function | `src/engine/statistics/hansens_spa.py:54` | 2 | unique |
| `hansens_spa_multi` | function | `src/engine/statistics/hansens_spa.py:184` | 1 | unique |
| `_format_multiple_key` | function | `src/engine/statistics/slippage_survival.py:89` | 0 | unique |
| `_derive_r_unit` | function | `src/engine/statistics/slippage_survival.py:97` | 0 | unique |
| `_empty_result` | function | `src/engine/statistics/slippage_survival.py:114` | 1 | AMBIG |
| `compute_slippage_survival` | function | `src/engine/statistics/slippage_survival.py:133` | 2 | unique |
| `get_wrc_p_threshold` | function | `src/engine/statistics/whites_reality_check.py:46` | 0 | unique |
| `_stationary_bootstrap_resample` | function | `src/engine/statistics/whites_reality_check.py:54` | 0 | unique |
| `_stationary_bootstrap_indices` | function | `src/engine/statistics/whites_reality_check.py:92` | 1 | unique |
| `whites_reality_check` | function | `src/engine/statistics/whites_reality_check.py:127` | 2 | unique |
| `whites_reality_check_multi` | function | `src/engine/statistics/whites_reality_check.py:223` | 1 | unique |

</details>

<details><summary><code>src/engine/strategies</code> - 29 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `BounceOffLevelStrategy` | class | `src/engine/strategies/bounce_off_level.py:59` | 1 | unique |
| `_apply_exits` | function | `src/engine/strategies/breaker.py:25` | 1 | AMBIG |
| `BreakerStrategy` | class | `src/engine/strategies/breaker.py:103` | 1 | unique |
| `EqhlRaidStrategy` | class | `src/engine/strategies/eqhl_raid.py:24` | 1 | unique |
| `GannBox4HContinuationStrategy` | class | `src/engine/strategies/gann_box_4h_continuation.py:80` | 1 | unique |
| `ICT2022Strategy` | class | `src/engine/strategies/ict_2022.py:37` | 1 | unique |
| `_build_killzone_mask` | function | `src/engine/strategies/ict_bias_aligned_continuation.py:75` | 0 | unique |
| `ICTBiasAlignedContinuationStrategy` | class | `src/engine/strategies/ict_bias_aligned_continuation.py:92` | 1 | unique |
| `ICTScalpStrategy` | class | `src/engine/strategies/ict_scalp.py:28` | 1 | unique |
| `ICTSwingStrategy` | class | `src/engine/strategies/ict_swing.py:28` | 1 | unique |
| `IOFEDStrategy` | class | `src/engine/strategies/iofed.py:21` | 1 | unique |
| `JudasSwingStrategy` | class | `src/engine/strategies/judas_swing.py:24` | 1 | unique |
| `LondonRaidStrategy` | class | `src/engine/strategies/london_raid.py:25` | 1 | unique |
| `MidnightOpenStrategy` | class | `src/engine/strategies/midnight_open.py:21` | 1 | unique |
| `_apply_exits` | function | `src/engine/strategies/mitigation.py:26` | 1 | AMBIG |
| `MitigationStrategy` | class | `src/engine/strategies/mitigation.py:95` | 1 | unique |
| `_find_mitigation_blocks` | function | `src/engine/strategies/mitigation.py:209` | 0 | unique |
| `_compute_mb_signals` | function | `src/engine/strategies/mitigation.py:330` | 0 | unique |
| `NYLunchReversalStrategy` | class | `src/engine/strategies/ny_lunch_reversal.py:17` | 1 | unique |
| `OTEStrategy` | class | `src/engine/strategies/ote_strategy.py:18` | 1 | unique |
| `PowerOf3Strategy` | class | `src/engine/strategies/power_of_3.py:30` | 1 | unique |
| `PropulsionStrategy` | class | `src/engine/strategies/propulsion.py:17` | 1 | unique |
| `_daily_quarter_phase` | function | `src/engine/strategies/quarterly_swing.py:37` | 0 | unique |
| `_compute_true_open` | function | `src/engine/strategies/quarterly_swing.py:59` | 0 | unique |
| `QuarterlySwingStrategy` | class | `src/engine/strategies/quarterly_swing.py:106` | 1 | unique |
| `SilverBulletStrategy` | class | `src/engine/strategies/silver_bullet.py:26` | 1 | unique |
| `SMTReversalStrategy` | class | `src/engine/strategies/smt_reversal.py:27` | 1 | unique |
| `TurtleSoupStrategy` | class | `src/engine/strategies/turtle_soup.py:31` | 1 | unique |
| `UnicornStrategy` | class | `src/engine/strategies/unicorn.py:26` | 1 | unique |

</details>

<details><summary><code>src/engine/strategy_base.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `BaseStrategy` | class | `src/engine/strategy_base.py:20` | 25 | unique |

</details>

<details><summary><code>src/engine/strategy_memory.py</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `StrategyMemory` | class | `src/engine/strategy_memory.py:19` | 1 | unique |

</details>

<details><summary><code>src/engine/stress_test.py</code> - 4 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `get_default_scenarios` | function | `src/engine/stress_test.py:26` | 0 | unique |
| `_run_crisis_backtest` | function | `src/engine/stress_test.py:96` | 0 | unique |
| `run_stress_test` | function | `src/engine/stress_test.py:142` | 1 | unique |
| `main` | function | `src/engine/stress_test.py:191` | 182 | AMBIG |

</details>

<details><summary><code>src/engine/surface_code_encoder.py</code> - 3 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `EncoderResult` | class | `src/engine/surface_code_encoder.py:59` | 0 | unique |
| `_build_d3_surface_code_syndrome_circuit` | function | `src/engine/surface_code_encoder.py:78` | 0 | unique |
| `encode_iae_for_surface_code` | function | `src/engine/surface_code_encoder.py:161` | 1 | unique |

</details>

<details><summary><code>src/engine/survival</code> - 15 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `concentration_analysis` | function | `src/engine/survival/concentration_analyzer.py:8` | 1 | unique |
| `_normal_cdf` | function | `src/engine/survival/daily_breach_model.py:17` | 0 | unique |
| `daily_breach_probability` | function | `src/engine/survival/daily_breach_model.py:22` | 1 | unique |
| `mc_drawdown_breach` | function | `src/engine/survival/drawdown_simulator.py:8` | 1 | unique |
| `get_firm_profile` | function | `src/engine/survival/firm_profiles.py:65` | 2 | unique |
| `list_firms` | function | `src/engine/survival/firm_profiles.py:73` | 1 | unique |
| `compare_strategies` | function | `src/engine/survival/survival_comparator.py:12` | 0 | unique |
| `main` | function | `src/engine/survival/survival_comparator.py:124` | 182 | AMBIG |
| `_recovery_speed_score` | function | `src/engine/survival/survival_scorer.py:51` | 0 | unique |
| `_worst_month_score` | function | `src/engine/survival/survival_scorer.py:109` | 0 | unique |
| `_commission_drag_score` | function | `src/engine/survival/survival_scorer.py:160` | 0 | unique |
| `_eval_speed_score` | function | `src/engine/survival/survival_scorer.py:205` | 0 | unique |
| `_assign_grade` | function | `src/engine/survival/survival_scorer.py:246` | 0 | unique |
| `survival_score` | function | `src/engine/survival/survival_scorer.py:260` | 6 | unique |
| `main` | function | `src/engine/survival/survival_scorer.py:379` | 182 | AMBIG |

</details>

<details><summary><code>src/engine/synthetic</code> - 8 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_make_result_record` | function | `src/engine/synthetic/populate_regime_bank.py:105` | 0 | unique |
| `run_populate` | function | `src/engine/synthetic/populate_regime_bank.py:144` | 0 | unique |
| `main` | function | `src/engine/synthetic/populate_regime_bank.py:382` | 182 | AMBIG |
| `_emit_output` | function | `src/engine/synthetic/populate_regime_bank.py:467` | 0 | unique |
| `ScenarioSpec` | class | `src/engine/synthetic/stochastic_regime_generator.py:126` | 1 | unique |
| `_returns_to_ohlcv` | function | `src/engine/synthetic/stochastic_regime_generator.py:379` | 0 | unique |
| `_simulate_garch_vol_path` | function | `src/engine/synthetic/stochastic_regime_generator.py:524` | 0 | unique |
| `StochasticRegimeGenerator` | class | `src/engine/synthetic/stochastic_regime_generator.py:572` | 1 | unique |

</details>

<details><summary><code>src/engine/tensor_signal_model.py</code> - 12 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `FeatureConfig` | class | `src/engine/tensor_signal_model.py:63` | 0 | unique |
| `MPSPrediction` | class | `src/engine/tensor_signal_model.py:100` | 0 | unique |
| `TrainResult` | class | `src/engine/tensor_signal_model.py:114` | 0 | unique |
| `encode_features` | function | `src/engine/tensor_signal_model.py:126` | 0 | unique |
| `MPSModel` | class | `src/engine/tensor_signal_model.py:164` | 0 | unique |
| `build_mps_model` | function | `src/engine/tensor_signal_model.py:300` | 0 | unique |
| `train_mps` | function | `src/engine/tensor_signal_model.py:313` | 0 | unique |
| `predict_trade_outcome` | function | `src/engine/tensor_signal_model.py:452` | 0 | unique |
| `evaluate_mps` | function | `src/engine/tensor_signal_model.py:512` | 0 | unique |
| `serialize_mps` | function | `src/engine/tensor_signal_model.py:546` | 0 | unique |
| `load_mps` | function | `src/engine/tensor_signal_model.py:557` | 0 | unique |
| `compute_fragility_score` | function | `src/engine/tensor_signal_model.py:572` | 0 | unique |

</details>

<details><summary><code>src/engine/validation</code> - 16 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `TimeWindow` | class | `src/engine/validation/__init__.py:27` | 0 | unique |
| `ConceptSpec` | class | `src/engine/validation/__init__.py:45` | 3 | unique |
| `ValidationResult` | class | `src/engine/validation/__init__.py:59` | 4 | unique |
| `load_spec` | function | `src/engine/validation/__init__.py:79` | 3 | unique |
| `list_specs` | function | `src/engine/validation/__init__.py:111` | 1 | unique |
| `CrossValidationResult` | class | `src/engine/validation/cross_validator.py:19` | 0 | unique |
| `cross_validate_concept` | function | `src/engine/validation/cross_validator.py:28` | 1 | unique |
| `_check_entries_in_windows` | function | `src/engine/validation/runtime_validator.py:16` | 0 | unique |
| `_check_signal_density` | function | `src/engine/validation/runtime_validator.py:79` | 0 | unique |
| `validate_runtime` | function | `src/engine/validation/runtime_validator.py:118` | 3 | unique |
| `_extract_imports` | function | `src/engine/validation/static_validator.py:17` | 0 | unique |
| `_extract_numeric_literals` | function | `src/engine/validation/static_validator.py:36` | 0 | unique |
| `_extract_string_literals` | function | `src/engine/validation/static_validator.py:45` | 0 | unique |
| `_check_time_windows` | function | `src/engine/validation/static_validator.py:54` | 0 | unique |
| `validate_static` | function | `src/engine/validation/static_validator.py:96` | 3 | unique |
| `validate_static_from_code` | function | `src/engine/validation/static_validator.py:114` | 2 | unique |

</details>

<details><summary><code>src/engine/validation_runner.py</code> - 5 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `run_static` | function | `src/engine/validation_runner.py:23` | 0 | unique |
| `run_runtime` | function | `src/engine/validation_runner.py:46` | 0 | unique |
| `run_cross` | function | `src/engine/validation_runner.py:71` | 0 | unique |
| `run_list_specs` | function | `src/engine/validation_runner.py:91` | 0 | unique |
| `main` | function | `src/engine/validation_runner.py:97` | 182 | AMBIG |

</details>

<details><summary><code>src/engine/walk_forward.py</code> - 8 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_compute_wf_slippage_survival` | function | `src/engine/walk_forward.py:92` | 0 | unique |
| `_run_wf_window` | function | `src/engine/walk_forward.py:151` | 0 | unique |
| `split_walk_forward_windows` | function | `src/engine/walk_forward.py:182` | 0 | unique |
| `_cpcv_fold_embargo_strips` | function | `src/engine/walk_forward.py:236` | 0 | unique |
| `_run_walk_forward_cpcv` | function | `src/engine/walk_forward.py:297` | 0 | unique |
| `run_walk_forward` | function | `src/engine/walk_forward.py:1107` | 5 | unique |
| `_default_class_wf_skip_eligibility_gate` | function | `src/engine/walk_forward.py:2437` | 0 | unique |
| `run_walk_forward_class` | function | `src/engine/walk_forward.py:2476` | 2 | unique |

</details>

<details><summary><code>src/engine/walk_forward_regime_context.py</code> - 7 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `_get_cv_threshold` | function | `src/engine/walk_forward_regime_context.py:41` | 0 | unique |
| `_get_rho_threshold` | function | `src/engine/walk_forward_regime_context.py:50` | 0 | unique |
| `_get_overfit_confidence` | function | `src/engine/walk_forward_regime_context.py:59` | 0 | unique |
| `ParameterDriftClassification` | class | `src/engine/walk_forward_regime_context.py:68` | 1 | AMBIG |
| `_regime_to_ordinal` | function | `src/engine/walk_forward_regime_context.py:113` | 0 | unique |
| `_spearman_rho` | function | `src/engine/walk_forward_regime_context.py:131` | 0 | unique |
| `classify_parameter_drift` | function | `src/engine/walk_forward_regime_context.py:175` | 1 | unique |

</details>

<details><summary><code>src/server/db</code> - 127 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `client` | const | `src/server/db/index.ts:19` | 22 | AMBIG |
| `db` | const | `src/server/db/index.ts:34` | 271 | unique |
| `runDbHealthProbe` | function | `src/server/db/index.ts:60` | 0 | unique |
| `PaperSessionConfigShape` | interface | `src/server/db/jsonb-shapes.ts:22` | 2 | unique |
| `ExitStyle` | type | `src/server/db/jsonb-shapes.ts:65` | 1 | unique |
| `RunnerTrailMethod` | type | `src/server/db/jsonb-shapes.ts:74` | 1 | unique |
| `RegimeScalingTuple` | type | `src/server/db/jsonb-shapes.ts:80` | 0 | unique |
| `ExitPlanRuntimeState` | interface | `src/server/db/jsonb-shapes.ts:114` | 0 | unique |
| `ExitPlanWithRuntimeState` | interface | `src/server/db/jsonb-shapes.ts:135` | 2 | unique |
| `EntryDecisionContext` | interface | `src/server/db/jsonb-shapes.ts:197` | 2 | unique |
| `BacktestResultExtrasShape` | interface | `src/server/db/jsonb-shapes.ts:219` | 1 | unique |
| `PaperSessionGovernorStateShape` | interface | `src/server/db/jsonb-shapes.ts:268` | 2 | unique |
| `ExitPlanConfig` | interface | `src/server/db/jsonb-shapes.ts:277` | 4 | unique |
| `strategies` | const | `src/server/db/schema.ts:58` | 147 | AMBIG |
| `BACKTEST_STATUS_REFUSED` | const | `src/server/db/schema.ts:163` | 5 | unique |
| `backtests` | const | `src/server/db/schema.ts:165` | 53 | AMBIG |
| `backtestMatrix` | const | `src/server/db/schema.ts:301` | 5 | AMBIG |
| `backtestTrades` | const | `src/server/db/schema.ts:323` | 11 | AMBIG |
| `monteCarloRuns` | const | `src/server/db/schema.ts:363` | 20 | AMBIG |
| `stressTestRuns` | const | `src/server/db/schema.ts:392` | 6 | AMBIG |
| `alerts` | const | `src/server/db/schema.ts:414` | 10 | AMBIG |
| `systemJournal` | const | `src/server/db/schema.ts:434` | 14 | AMBIG |
| `auditLog` | const | `src/server/db/schema.ts:469` | 114 | AMBIG |
| `dataSyncJobs` | const | `src/server/db/schema.ts:511` | 1 | AMBIG |
| `complianceRulesets` | const | `src/server/db/schema.ts:535` | 8 | AMBIG |
| `complianceReviews` | const | `src/server/db/schema.ts:565` | 5 | AMBIG |
| `complianceDriftLog` | const | `src/server/db/schema.ts:592` | 5 | AMBIG |
| `skipDecisions` | const | `src/server/db/schema.ts:615` | 8 | AMBIG |
| `macroSnapshots` | const | `src/server/db/schema.ts:643` | 4 | AMBIG |
| `macroFeatures` | const | `src/server/db/schema.ts:675` | 4 | AMBIG |
| `macroRegimeStates` | const | `src/server/db/schema.ts:698` | 5 | AMBIG |
| `strategyGraveyard` | const | `src/server/db/schema.ts:722` | 10 | AMBIG |
| `dayArchetypes` | const | `src/server/db/schema.ts:750` | 3 | AMBIG |
| `tournamentResults` | const | `src/server/db/schema.ts:771` | 4 | AMBIG |
| `paperSessions` | const | `src/server/db/schema.ts:798` | 40 | AMBIG |
| `paperPositions` | const | `src/server/db/schema.ts:850` | 19 | AMBIG |
| `paperTrades` | const | `src/server/db/schema.ts:919` | 29 | AMBIG |
| `paperSignalLogs` | const | `src/server/db/schema.ts:967` | 8 | AMBIG |
| `shadowSignals` | const | `src/server/db/schema.ts:996` | 10 | AMBIG |
| `walkForwardWindows` | const | `src/server/db/schema.ts:1021` | 5 | AMBIG |
| `quantumMcRuns` | const | `src/server/db/schema.ts:1045` | 11 | AMBIG |
| `quantumMcBenchmarks` | const | `src/server/db/schema.ts:1081` | 3 | AMBIG |
| `strategyNames` | const | `src/server/db/schema.ts:1102` | 7 | AMBIG |
| `strategyExports` | const | `src/server/db/schema.ts:1122` | 8 | AMBIG |
| `strategyExportArtifacts` | const | `src/server/db/schema.ts:1150` | 5 | AMBIG |
| `sqaOptimizationRuns` | const | `src/server/db/schema.ts:1169` | 5 | AMBIG |
| `quboTimingRuns` | const | `src/server/db/schema.ts:1192` | 5 | AMBIG |
| `tensorPredictions` | const | `src/server/db/schema.ts:1213` | 5 | AMBIG |
| `rlTrainingRuns` | const | `src/server/db/schema.ts:1236` | 7 | AMBIG |
| `criticOptimizationRuns` | const | `src/server/db/schema.ts:1262` | 8 | AMBIG |
| `criticCandidates` | const | `src/server/db/schema.ts:1294` | 4 | AMBIG |
| `researchTrialCounter` | const | `src/server/db/schema.ts:1353` | 2 | unique |
| `deeparForecasts` | const | `src/server/db/schema.ts:1361` | 8 | AMBIG |
| `deeparTrainingRuns` | const | `src/server/db/schema.ts:1390` | 4 | AMBIG |
| `agentHealthReports` | const | `src/server/db/schema.ts:1416` | 3 | AMBIG |
| `systemParameters` | const | `src/server/db/schema.ts:1434` | 20 | AMBIG |
| `systemParameterHistory` | const | `src/server/db/schema.ts:1451` | 4 | AMBIG |
| `paperSessionFeedback` | const | `src/server/db/schema.ts:1470` | 4 | AMBIG |
| `mutationOutcomes` | const | `src/server/db/schema.ts:1508` | 3 | AMBIG |
| `contractRolls` | const | `src/server/db/schema.ts:1534` | 2 | AMBIG |
| `deadLetterQueue` | const | `src/server/db/schema.ts:1557` | 5 | AMBIG |
| `n8nExecutionLog` | const | `src/server/db/schema.ts:1581` | 3 | unique |
| `idempotencyKeys` | const | `src/server/db/schema.ts:1602` | 3 | AMBIG |
| `subsystemMetrics` | const | `src/server/db/schema.ts:1611` | 6 | AMBIG |
| `promptVersions` | const | `src/server/db/schema.ts:1629` | 6 | AMBIG |
| `promptAbTests` | const | `src/server/db/schema.ts:1643` | 4 | AMBIG |
| `lifecycleTransitions` | const | `src/server/db/schema.ts:1673` | 15 | AMBIG |
| `aPlusMarketScans` | const | `src/server/db/schema.ts:1711` | 2 | AMBIG |
| `quantumRunCosts` | const | `src/server/db/schema.ts:1746` | 4 | AMBIG |
| `cloudQmcRuns` | const | `src/server/db/schema.ts:1776` | 4 | AMBIG |
| `adversarialStressRuns` | const | `src/server/db/schema.ts:1806` | 5 | AMBIG |
| `strategyLockouts` | const | `src/server/db/schema.ts:1836` | 3 | AMBIG |
| `backtestProvenance` | const | `src/server/db/schema.ts:1868` | 4 | AMBIG |
| `frankensteinTestRuns` | const | `src/server/db/schema.ts:1907` | 7 | AMBIG |
| `strategySignalVectors` | const | `src/server/db/schema.ts:1953` | 4 | AMBIG |
| `shadowRerunFindings` | const | `src/server/db/schema.ts:1993` | 3 | AMBIG |
| `dataIntegrityFindings` | const | `src/server/db/schema.ts:2051` | 3 | AMBIG |
| `strategyFirmEligibility` | const | `src/server/db/schema.ts:2079` | 3 | AMBIG |
| `pilotSessions` | const | `src/server/db/schema.ts:2117` | 3 | AMBIG |
| `exchangeOutages` | const | `src/server/db/schema.ts:2144` | 2 | AMBIG |
| `llmInjectionAttempts` | const | `src/server/db/schema.ts:2165` | 2 | AMBIG |
| `strategyDslFeatures` | const | `src/server/db/schema.ts:2195` | 3 | AMBIG |
| `propFirmHealthChecks` | const | `src/server/db/schema.ts:2221` | 3 | AMBIG |
| `contractSpecsAuthoritative` | const | `src/server/db/schema.ts:2242` | 2 | AMBIG |
| `dailyStatistics` | const | `src/server/db/schema.ts:2266` | 3 | AMBIG |
| `openingAuctionImbalance` | const | `src/server/db/schema.ts:2292` | 2 | AMBIG |
| `dailyVolumeProfileLevels` | const | `src/server/db/schema.ts:2319` | 2 | AMBIG |
| `biasState` | const | `src/server/db/schema.ts:2347` | 12 | AMBIG |
| `regimeHmmModels` | const | `src/server/db/schema.ts:2422` | 1 | unique |
| `harshRegimePhase` | const | `src/server/db/schema.ts:2448` | 3 | AMBIG |
| `ProductionMode` | type | `src/server/db/schema.ts:2478` | 2 | AMBIG |
| `systemState` | const | `src/server/db/schema.ts:2480` | 8 | AMBIG |
| `weeklyDriftReports` | const | `src/server/db/schema.ts:2500` | 5 | AMBIG |
| `productionTrades` | const | `src/server/db/schema.ts:2523` | 8 | AMBIG |
| `serverMediatedOrders` | const | `src/server/db/schema.ts:2569` | 1 | unique |
| `dailyReconciliation` | const | `src/server/db/schema.ts:2617` | 3 | AMBIG |
| `biasDecisions` | const | `src/server/db/schema.ts:2645` | 4 | AMBIG |
| `biasCalibrationCurves` | const | `src/server/db/schema.ts:2678` | 2 | AMBIG |
| `biasAblationResults` | const | `src/server/db/schema.ts:2696` | 2 | AMBIG |
| `brokerAccounts` | const | `src/server/db/schema.ts:2719` | 16 | AMBIG |
| `instanceConfig` | const | `src/server/db/schema.ts:2764` | 4 | AMBIG |
| `nemoScenarioBank` | const | `src/server/db/schema.ts:2774` | 3 | AMBIG |
| `accountStrategyAssignments` | const | `src/server/db/schema.ts:2796` | 6 | AMBIG |
| `tradingviewMarkers` | const | `src/server/db/schema.ts:2821` | 5 | AMBIG |
| `firmAdversarialPriors` | const | `src/server/db/schema.ts:2851` | 2 | AMBIG |
| `FirmAdversarialPriorRow` | type | `src/server/db/schema.ts:2874` | 1 | unique |
| `strategyPendingBuckets` | const | `src/server/db/schema.ts:2878` | 11 | AMBIG |
| `strategyPendingMentions` | const | `src/server/db/schema.ts:2904` | 8 | AMBIG |
| `scoutDrainSamples` | const | `src/server/db/schema.ts:2926` | 2 | AMBIG |
| `syntheticRegimeBank` | const | `src/server/db/schema.ts:2940` | 3 | AMBIG |
| `syntheticBlackSwanRuns` | const | `src/server/db/schema.ts:2955` | 4 | AMBIG |
| `transcriptFetchOutcomes` | const | `src/server/db/schema.ts:2986` | 1 | unique |
| `preMarketSessions` | const | `src/server/db/schema.ts:3009` | 5 | unique |
| `tradeCritique` | const | `src/server/db/schema.ts:3068` | 6 | unique |
| `liquidityLevels` | const | `src/server/db/schema.ts:3100` | 3 | unique |
| `quantumRlRuns` | const | `src/server/db/schema.ts:3147` | 1 | unique |
| `lifecycleShadowSignals` | const | `src/server/db/schema.ts:3204` | 4 | unique |
| `needsArchetypeQueue` | const | `src/server/db/schema.ts:3250` | 3 | unique |
| `strategyHealthScores` | const | `src/server/db/schema.ts:3276` | 4 | unique |
| `slumhouseUsers` | const | `src/server/db/schema.ts:3322` | 5 | unique |
| `SlumhouseUser` | type | `src/server/db/schema.ts:3341` | 1 | unique |
| `operatorAbsentPeriods` | const | `src/server/db/schema.ts:3348` | 2 | AMBIG |
| `agentJobs` | const | `src/server/db/schema.ts:3376` | 2 | unique |
| `workflowBackups` | const | `src/server/db/schema.ts:3411` | 1 | unique |
| `liveOrderPineDedup` | const | `src/server/db/schema.ts:3440` | 0 | unique |
| `carterIssues` | const | `src/server/db/schema.ts:3476` | 2 | unique |
| `carterMemory` | const | `src/server/db/schema.ts:3503` | 1 | unique |

</details>

<details><summary><code>src/server/index.ts</code> - 3 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `app` | export-binding | `src/server/index.ts:171` | 3 | unique |
| `logger` | const | `src/server/index.ts:174` | 322 | AMBIG |
| `server` | const | `src/server/index.ts:706` | 1 | unique |

</details>

<details><summary><code>src/server/integrations</code> - 11 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `IdempotencyKeyInputs` | interface | `src/server/integrations/traderspost/client.ts:43` | 1 | unique |
| `buildDeterministicIdempotencyKey` | function | `src/server/integrations/traderspost/client.ts:64` | 2 | unique |
| `submitWebhookOrder` | function | `src/server/integrations/traderspost/client.ts:87` | 1 | unique |
| `TradersPostAction` | type | `src/server/integrations/traderspost/types.ts:10` | 1 | unique |
| `TradersPostOrderType` | type | `src/server/integrations/traderspost/types.ts:14` | 1 | unique |
| `TradersPostPositionType` | type | `src/server/integrations/traderspost/types.ts:18` | 1 | unique |
| `TradersPostWebhookPayload` | interface | `src/server/integrations/traderspost/types.ts:27` | 2 | unique |
| `TradersPostSubmitResult` | interface | `src/server/integrations/traderspost/types.ts:61` | 1 | unique |
| `WebhookSignal` | interface | `src/server/integrations/traderspost/webhook-builder.ts:16` | 3 | unique |
| `buildWebhookPayload` | function | `src/server/integrations/traderspost/webhook-builder.ts:78` | 1 | unique |
| `PineGatewayOptions` | interface | `src/server/integrations/traderspost/webhook-builder.ts:134` | 0 | unique |

</details>

<details><summary><code>src/server/lib</code> - 690 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `ARCHETYPE_IMPLIED_FACTORS` | const | `src/server/lib/archetype-implied-factors.ts:59` | 1 | unique |
| `inferFactorsFromArchetype` | function | `src/server/lib/archetype-implied-factors.ts:231` | 2 | unique |
| `RAW_ARCHETYPES_RESPECTED` | const | `src/server/lib/archetype-registry-keys.ts:24` | 1 | unique |
| `RESOLVABLE_ARCHETYPES` | const | `src/server/lib/archetype-registry-keys.ts:60` | 0 | unique |
| `entryIndicatorResolvesToArchetype` | function | `src/server/lib/archetype-registry-keys.ts:70` | 1 | unique |
| `BounceOffLevelSignalPayload` | interface | `src/server/lib/archetype-signal-audit.ts:56` | 0 | unique |
| `IctBiasAlignedContinuationSignalPayload` | interface | `src/server/lib/archetype-signal-audit.ts:77` | 0 | unique |
| `emitBounceOffLevelSignal` | function | `src/server/lib/archetype-signal-audit.ts:128` | 1 | unique |
| `emitIctBiasAlignedContinuationSignal` | function | `src/server/lib/archetype-signal-audit.ts:175` | 1 | unique |
| `AuditRowValues` | type | `src/server/lib/audit-log-helper.ts:37` | 0 | unique |
| `insertAuditRowSafe` | function | `src/server/lib/audit-log-helper.ts:52` | 52 | unique |
| `insertAuditRow` | function | `src/server/lib/audit-log-helper.ts:86` | 39 | unique |
| `WalkForwardDsrInput` | interface | `src/server/lib/b14-ci-gate.ts:44` | 2 | unique |
| `DsrGateStatus` | type | `src/server/lib/b14-ci-gate.ts:62` | 0 | unique |
| `DsrWalkForwardGateResult` | interface | `src/server/lib/b14-ci-gate.ts:68` | 0 | unique |
| `evaluateDsrWalkForwardGate` | function | `src/server/lib/b14-ci-gate.ts:121` | 2 | unique |
| `RuinCiDict` | interface | `src/server/lib/b14-ci-gate.ts:219` | 2 | unique |
| `B14CiGateResult` | interface | `src/server/lib/b14-ci-gate.ts:228` | 0 | unique |
| `getB14CiHighThreshold` | function | `src/server/lib/b14-ci-gate.ts:260` | 6 | unique |
| `getB14PayoutDenialThreshold` | function | `src/server/lib/b14-ci-gate.ts:284` | 0 | unique |
| `evaluateB14CiGate` | function | `src/server/lib/b14-ci-gate.ts:334` | 3 | unique |
| `buildBacktestArgs` | function | `src/server/lib/backtest-args.ts:24` | 1 | AMBIG |
| `isExecutionRefused` | function | `src/server/lib/backtest-refusal.ts:35` | 6 | unique |
| `refusalEvidence` | function | `src/server/lib/backtest-refusal.ts:50` | 6 | unique |
| `getBifWarnThreshold` | function | `src/server/lib/bif-gate.ts:50` | 0 | unique |
| `getBifBlockThreshold` | function | `src/server/lib/bif-gate.ts:69` | 0 | unique |
| `BifGateResult` | interface | `src/server/lib/bif-gate.ts:85` | 0 | unique |
| `evaluateBifGate` | function | `src/server/lib/bif-gate.ts:132` | 2 | unique |
| `JournalEntry` | interface | `src/server/lib/boot-migration-runner.ts:65` | 1 | unique |
| `shouldAlertBootFailure` | function | `src/server/lib/boot-migration-runner.ts:121` | 0 | unique |
| `checkPgDumpAvailable` | function | `src/server/lib/boot-migration-runner.ts:205` | 1 | AMBIG |
| `takePgDumpBackup` | function | `src/server/lib/boot-migration-runner.ts:218` | 0 | unique |
| `takeInformationSchemaBackup` | function | `src/server/lib/boot-migration-runner.ts:247` | 0 | unique |
| `fireDiscordCritical` | function | `src/server/lib/boot-migration-runner.ts:297` | 0 | unique |
| `readJournalOrAlert` | function | `src/server/lib/boot-migration-runner.ts:370` | 0 | unique |
| `extractCreatedTables` | function | `src/server/lib/boot-migration-runner.ts:484` | 0 | unique |
| `AlteredColumn` | interface | `src/server/lib/boot-migration-runner.ts:528` | 0 | unique |
| `extractAlteredColumns` | function | `src/server/lib/boot-migration-runner.ts:533` | 0 | unique |
| `findOrphanSqlFiles` | function | `src/server/lib/boot-migration-runner.ts:586` | 0 | unique |
| `checkForOrphanSqlFiles` | function | `src/server/lib/boot-migration-runner.ts:603` | 0 | unique |
| `runPendingMigrations` | function | `src/server/lib/boot-migration-runner.ts:654` | 2 | unique |
| `CARTER_ACTION_HANDLERS` | const | `src/server/lib/carter/carter-actions.ts:721` | 1 | unique |
| `CARTER_CONFIRM_HANDLERS` | const | `src/server/lib/carter/carter-actions.ts:1212` | 1 | unique |
| `ElevenLabsSignatureResult` | interface | `src/server/lib/carter/carter-auth.ts:24` | 0 | unique |
| `verifyElevenLabsSignature` | function | `src/server/lib/carter/carter-auth.ts:39` | 1 | unique |
| `CarterToolAuthResult` | interface | `src/server/lib/carter/carter-auth.ts:85` | 0 | unique |
| `verifyCarterToolAuth` | function | `src/server/lib/carter/carter-auth.ts:101` | 1 | unique |
| `CARTER_CODE_HANDLERS` | const | `src/server/lib/carter/carter-code.ts:213` | 1 | unique |
| `CONFIRMATION_TTL_SECONDS` | const | `src/server/lib/carter/carter-confirm.ts:34` | 0 | unique |
| `IssuedConfirmation` | interface | `src/server/lib/carter/carter-confirm.ts:80` | 0 | unique |
| `issueConfirmation` | function | `src/server/lib/carter/carter-confirm.ts:92` | 1 | unique |
| `VerifyConfirmationResult` | interface | `src/server/lib/carter/carter-confirm.ts:122` | 0 | unique |
| `verifyConfirmation` | function | `src/server/lib/carter/carter-confirm.ts:133` | 1 | unique |
| `CARTER_INSIGHTS_READ_HANDLERS` | const | `src/server/lib/carter/carter-insights.ts:58` | 1 | unique |
| `CARTER_INTROSPECT_HANDLERS` | const | `src/server/lib/carter/carter-introspect.ts:586` | 2 | unique |
| `IssueSeverity` | type | `src/server/lib/carter/carter-issues-store.ts:25` | 0 | unique |
| `CarterIssue` | interface | `src/server/lib/carter/carter-issues-store.ts:27` | 0 | unique |
| `UpsertIssueParams` | interface | `src/server/lib/carter/carter-issues-store.ts:39` | 0 | unique |
| `upsertIssue` | function | `src/server/lib/carter/carter-issues-store.ts:122` | 1 | unique |
| `resolveIssue` | function | `src/server/lib/carter/carter-issues-store.ts:150` | 1 | unique |
| `listOpenIssues` | function | `src/server/lib/carter/carter-issues-store.ts:174` | 3 | unique |
| `hydrateFromDb` | function | `src/server/lib/carter/carter-issues-store.ts:195` | 1 | unique |
| `REMEMBER_KINDS` | const | `src/server/lib/carter/carter-memory-store.ts:31` | 0 | unique |
| `InsertMemoryParams` | interface | `src/server/lib/carter/carter-memory-store.ts:43` | 0 | unique |
| `QueryMemoriesParams` | interface | `src/server/lib/carter/carter-memory-store.ts:51` | 0 | unique |
| `insertMemory` | function | `src/server/lib/carter/carter-memory-store.ts:63` | 3 | unique |
| `queryMemories` | function | `src/server/lib/carter/carter-memory-store.ts:87` | 3 | unique |
| `CARTER_MEMORY_ACTION_HANDLERS` | const | `src/server/lib/carter/carter-memory-store.ts:193` | 1 | unique |
| `CARTER_MEMORY_READ_HANDLERS` | const | `src/server/lib/carter/carter-memory-store.ts:198` | 1 | unique |
| `CARTER_READ_HANDLERS` | const | `src/server/lib/carter/carter-reads.ts:643` | 1 | unique |
| `CARTER_RECOMMEND_HANDLERS` | const | `src/server/lib/carter/carter-recommend.ts:533` | 2 | unique |
| `ResearchSource` | interface | `src/server/lib/carter/carter-research.ts:61` | 0 | unique |
| `InstitutionalResearchResult` | interface | `src/server/lib/carter/carter-research.ts:69` | 0 | unique |
| `ResearchDeps` | interface | `src/server/lib/carter/carter-research.ts:80` | 0 | unique |
| `braveWebSearch` | function | `src/server/lib/carter/carter-research.ts:127` | 1 | unique |
| `exaResearchSearch` | function | `src/server/lib/carter/carter-research.ts:161` | 1 | unique |
| `tavilyWebSearch` | function | `src/server/lib/carter/carter-research.ts:211` | 1 | unique |
| `redditResearchSource` | function | `src/server/lib/carter/carter-research.ts:248` | 1 | unique |
| `parallelGeneralResearch` | function | `src/server/lib/carter/carter-research.ts:270` | 1 | unique |
| `ollamaSynthesize` | function | `src/server/lib/carter/carter-research.ts:365` | 1 | unique |
| `institutionalResearch` | function | `src/server/lib/carter/carter-research.ts:418` | 1 | unique |
| `CarterTier` | type | `src/server/lib/carter/tool-registry.ts:18` | 0 | unique |
| `CarterTool` | interface | `src/server/lib/carter/tool-registry.ts:20` | 1 | unique |
| `CARTER_TOOLS` | const | `src/server/lib/carter/tool-registry.ts:43` | 1 | unique |
| `CARTER_PARAMS_SCHEMAS` | const | `src/server/lib/carter/tool-registry.ts:488` | 0 | unique |
| `getCarterTool` | function | `src/server/lib/carter/tool-registry.ts:819` | 1 | unique |
| `CircuitState` | type | `src/server/lib/circuit-breaker.ts:21` | 0 | unique |
| `CircuitOpenError` | class | `src/server/lib/circuit-breaker.ts:23` | 8 | unique |
| `CircuitBreakerOptions` | interface | `src/server/lib/circuit-breaker.ts:41` | 0 | unique |
| `CircuitBreaker` | class | `src/server/lib/circuit-breaker.ts:46` | 0 | unique |
| `CircuitBreakerRegistry` | class | `src/server/lib/circuit-breaker.ts:207` | 14 | unique |
| `CmeHolidayCheckResult` | interface | `src/server/lib/cme-holidays.ts:75` | 0 | unique |
| `checkCmeHolidayFallback` | function | `src/server/lib/cme-holidays.ts:92` | 1 | unique |
| `ComplianceMode` | type | `src/server/lib/compliance-mode.ts:37` | 0 | unique |
| `resolveComplianceMode` | function | `src/server/lib/compliance-mode.ts:70` | 1 | unique |
| `isResearchBacktest` | function | `src/server/lib/compliance-mode.ts:118` | 1 | unique |
| `AgreementLabel` | type | `src/server/lib/composite-shadow-discord-router.ts:41` | 2 | unique |
| `ShadowAuditPayload` | interface | `src/server/lib/composite-shadow-discord-router.ts:48` | 0 | unique |
| `routeShadowDisagreementAlert` | function | `src/server/lib/composite-shadow-discord-router.ts:132` | 1 | unique |
| `ShadowAvailability` | type | `src/server/lib/composite-shadow-gate.ts:41` | 0 | unique |
| `ShadowDecision` | type | `src/server/lib/composite-shadow-gate.ts:47` | 0 | unique |
| `ShadowResult` | interface | `src/server/lib/composite-shadow-gate.ts:53` | 2 | unique |
| `getCompositeMaxAgeHours` | function | `src/server/lib/composite-shadow-gate.ts:68` | 0 | unique |
| `deriveShadowDecision` | function | `src/server/lib/composite-shadow-gate.ts:88` | 1 | unique |
| `evaluateCompositeShadow` | function | `src/server/lib/composite-shadow-gate.ts:140` | 1 | unique |
| `ComputeState` | type | `src/server/lib/compute-failover.ts:23` | 0 | unique |
| `ComputeTarget` | type | `src/server/lib/compute-failover.ts:28` | 0 | unique |
| `stopComputeFailoverMonitor` | function | `src/server/lib/compute-failover.ts:227` | 0 | unique |
| `getComputeState` | function | `src/server/lib/compute-failover.ts:239` | 0 | unique |
| `getComputeTarget` | function | `src/server/lib/compute-failover.ts:249` | 0 | unique |
| `ComputeFailoverStatus` | interface | `src/server/lib/compute-failover.ts:258` | 1 | unique |
| `getComputeFailoverStatus` | function | `src/server/lib/compute-failover.ts:271` | 1 | unique |
| `_resetForTests` | function | `src/server/lib/compute-failover.ts:353` | 4 | AMBIG |
| `DecayInput` | interface | `src/server/lib/confluence-decay.ts:49` | 0 | unique |
| `DecayResult` | interface | `src/server/lib/confluence-decay.ts:60` | 1 | unique |
| `DECAY_TELEMETRY_THRESHOLD_DEFAULT` | const | `src/server/lib/confluence-decay.ts:106` | 0 | unique |
| `getDecayTelemetryThreshold` | export-binding | `src/server/lib/confluence-decay.ts:117` | 2 | unique |
| `fvgDecay` | function | `src/server/lib/confluence-decay.ts:148` | 0 | unique |
| `chochDecay` | function | `src/server/lib/confluence-decay.ts:216` | 0 | unique |
| `mssDecay` | function | `src/server/lib/confluence-decay.ts:238` | 0 | unique |
| `smtDecay` | function | `src/server/lib/confluence-decay.ts:263` | 0 | unique |
| `vpLevelDecay` | function | `src/server/lib/confluence-decay.ts:287` | 0 | unique |
| `genericDecay` | function | `src/server/lib/confluence-decay.ts:313` | 0 | unique |
| `DecayStructureState` | interface | `src/server/lib/confluence-decay.ts:377` | 0 | unique |
| `deriveFactorDecay` | function | `src/server/lib/confluence-decay.ts:407` | 1 | unique |
| `FactorSource` | type | `src/server/lib/confluence-provenance.ts:10` | 2 | AMBIG |
| `AUTO_FLOOR_FACTORS` | const | `src/server/lib/confluence-provenance.ts:13` | 3 | AMBIG |
| `tagFactorSources` | function | `src/server/lib/confluence-provenance.ts:24` | 2 | AMBIG |
| `evidenceBackedFactorCount` | function | `src/server/lib/confluence-provenance.ts:37` | 2 | AMBIG |
| `RecoveredConfluence` | interface | `src/server/lib/confluence-recovery.ts:19` | 1 | AMBIG |
| `IdeaLike` | interface | `src/server/lib/confluence-recovery.ts:48` | 1 | unique |
| `recoverConfluences` | function | `src/server/lib/confluence-recovery.ts:59` | 1 | unique |
| `ConsistencyLaneConfig` | interface | `src/server/lib/consistency-lane.ts:19` | 0 | unique |
| `resolveConsistencyEnforced` | function | `src/server/lib/consistency-lane.ts:25` | 1 | unique |
| `ContractClass` | type | `src/server/lib/contract-class.ts:57` | 0 | unique |
| `getContractClass` | function | `src/server/lib/contract-class.ts:81` | 0 | unique |
| `DEFAULT_MICRO_COMMISSION_PER_SIDE` | const | `src/server/lib/contract-class.ts:93` | 0 | unique |
| `DEFAULT_MINI_COMMISSION_PER_SIDE` | const | `src/server/lib/contract-class.ts:101` | 0 | unique |
| `AuditEmitter` | type | `src/server/lib/contract-class.ts:146` | 0 | unique |
| `getCommissionPerSide` | function | `src/server/lib/contract-class.ts:164` | 2 | AMBIG |
| `getStopCeilingPts` | function | `src/server/lib/contract-class.ts:265` | 2 | unique |
| `A7_CORRELATION_THRESHOLD` | const | `src/server/lib/correlation-constants.ts:20` | 2 | unique |
| `VaultMode` | type | `src/server/lib/credential-loader.ts:49` | 0 | unique |
| `VaultLoadResult` | type | `src/server/lib/credential-loader.ts:52` | 0 | unique |
| `getVaultMode` | function | `src/server/lib/credential-loader.ts:145` | 1 | unique |
| `checkBitwarden` | function | `src/server/lib/credential-loader.ts:187` | 0 | unique |
| `checkVaultUnlocked` | function | `src/server/lib/credential-loader.ts:203` | 0 | unique |
| `VaultUnavailableError` | class | `src/server/lib/credential-loader.ts:297` | 0 | unique |
| `loadBrokerCredentials` | function | `src/server/lib/credential-loader.ts:506` | 1 | unique |
| `_resetForTests` | function | `src/server/lib/credential-loader.ts:549` | 4 | AMBIG |
| `symbolToUnderlying` | function | `src/server/lib/cross-account-hedge-gate.ts:25` | 1 | unique |
| `CrossAccountHedgeResult` | interface | `src/server/lib/cross-account-hedge-gate.ts:41` | 0 | unique |
| `checkCrossAccountHedge` | function | `src/server/lib/cross-account-hedge-gate.ts:60` | 1 | unique |
| `checkIntraAccountHedge` | function | `src/server/lib/cross-account-hedge-gate.ts:114` | 1 | unique |
| `DailyTradeCapInput` | interface | `src/server/lib/daily-trade-cap.ts:62` | 0 | unique |
| `DailyTradeCapResult` | interface | `src/server/lib/daily-trade-cap.ts:71` | 0 | unique |
| `resolveEffectiveCap` | function | `src/server/lib/daily-trade-cap.ts:89` | 0 | unique |
| `evaluateDailyTradeCap` | function | `src/server/lib/daily-trade-cap.ts:107` | 1 | unique |
| `getDailyTradeCapEnvDefault` | function | `src/server/lib/daily-trade-cap.ts:147` | 1 | unique |
| `withSessionLock` | function | `src/server/lib/db-locks.ts:11` | 1 | unique |
| `StrategyWithDirection` | interface | `src/server/lib/direction-coercion.ts:42` | 0 | unique |
| `CoercionResult` | interface | `src/server/lib/direction-coercion.ts:47` | 0 | unique |
| `inspectDirection` | function | `src/server/lib/direction-coercion.ts:57` | 0 | unique |
| `coerceDirectionsInPlace` | function | `src/server/lib/direction-coercion.ts:130` | 2 | unique |
| `DirectionClass` | type | `src/server/lib/direction-parity.ts:17` | 0 | unique |
| `DirectionEvidence` | interface | `src/server/lib/direction-parity.ts:25` | 0 | unique |
| `DirectionMetadata` | interface | `src/server/lib/direction-parity.ts:37` | 0 | unique |
| `extractDirectionEvidence` | function | `src/server/lib/direction-parity.ts:68` | 0 | unique |
| `classifyDirection` | function | `src/server/lib/direction-parity.ts:116` | 0 | unique |
| `classifyDirectionFromTranscript` | function | `src/server/lib/direction-parity.ts:147` | 1 | unique |
| `captureToDLQ` | function | `src/server/lib/dlq-service.ts:11` | 6 | unique |
| `registerRetryHandler` | function | `src/server/lib/dlq-service.ts:46` | 1 | unique |
| `retryDLQItem` | function | `src/server/lib/dlq-service.ts:57` | 1 | unique |
| `retryAllUnresolved` | function | `src/server/lib/dlq-service.ts:106` | 1 | unique |
| `escalateDLQ` | function | `src/server/lib/dlq-service.ts:136` | 1 | unique |
| `escalateDLQByAge` | function | `src/server/lib/dlq-service.ts:177` | 1 | unique |
| `getDLQMetrics` | function | `src/server/lib/dlq-service.ts:217` | 1 | unique |
| `PrimitiveIndicator` | interface | `src/server/lib/dsl-compiler.ts:54` | 0 | unique |
| `ConfirmingIndicator` | interface | `src/server/lib/dsl-compiler.ts:72` | 3 | AMBIG |
| `CompiledStrategy` | interface | `src/server/lib/dsl-compiler.ts:79` | 0 | unique |
| `DslCompileInput` | interface | `src/server/lib/dsl-compiler.ts:95` | 0 | unique |
| `compileDslToEngine` | function | `src/server/lib/dsl-compiler.ts:271` | 2 | unique |
| `applyConfluenceToCompiled` | function | `src/server/lib/dsl-compiler.ts:464` | 0 | unique |
| `compileDslWithConfluence` | function | `src/server/lib/dsl-compiler.ts:692` | 1 | unique |
| `isUsDst` | function | `src/server/lib/dst-utils.ts:33` | 5 | unique |
| `getEtOffsetMinutes` | function | `src/server/lib/dst-utils.ts:56` | 1 | unique |
| `T1WindowResult` | interface | `src/server/lib/economic-calendar-loader.ts:68` | 0 | unique |
| `getT1ReleaseWindow` | function | `src/server/lib/economic-calendar-loader.ts:80` | 1 | unique |
| `EiaEvent` | interface | `src/server/lib/eia-dates.ts:14` | 0 | unique |
| `EIA_EVENTS` | const | `src/server/lib/eia-dates.ts:19` | 4 | unique |
| `EntryWindow` | interface | `src/server/lib/entry-windows.ts:47` | 2 | AMBIG |
| `parseEntryWindow` | function | `src/server/lib/entry-windows.ts:69` | 1 | unique |
| `parseEntryWindows` | function | `src/server/lib/entry-windows.ts:142` | 1 | unique |
| `isBarInWindow` | function | `src/server/lib/entry-windows.ts:180` | 1 | unique |
| `isBarInAnyWindow` | function | `src/server/lib/entry-windows.ts:193` | 1 | unique |
| `isIncompleteEvidenceStatus` | function | `src/server/lib/evidence-completeness.ts:47` | 2 | unique |
| `slippageEvidenceBucket` | function | `src/server/lib/evidence-completeness.ts:69` | 1 | unique |
| `bifEvidenceBucket` | function | `src/server/lib/evidence-completeness.ts:86` | 2 | unique |
| `EXECUTION_MODE_PARAM` | const | `src/server/lib/execution-mode.ts:30` | 0 | unique |
| `isLiveExecutionConfigured` | function | `src/server/lib/execution-mode.ts:42` | 1 | unique |
| `getExecutionMode` | function | `src/server/lib/execution-mode.ts:64` | 2 | unique |
| `setExecutionMode` | function | `src/server/lib/execution-mode.ts:96` | 1 | unique |
| `SpeakerItem` | interface | `src/server/lib/extraction-coverage-gate.ts:72` | 2 | unique |
| `ExtractionSnapshot` | interface | `src/server/lib/extraction-coverage-gate.ts:90` | 2 | unique |
| `CoverageVerdict` | interface | `src/server/lib/extraction-coverage-gate.ts:107` | 2 | unique |
| `normalize` | function | `src/server/lib/extraction-coverage-gate.ts:120` | 4 | unique |
| `contentTokens` | function | `src/server/lib/extraction-coverage-gate.ts:142` | 1 | unique |
| `runCoverageEnumeration` | function | `src/server/lib/extraction-coverage-gate.ts:315` | 0 | unique |
| `computeCoverageVerdict` | function | `src/server/lib/extraction-coverage-gate.ts:457` | 1 | unique |
| `runCoverageGate` | function | `src/server/lib/extraction-coverage-gate.ts:555` | 1 | unique |
| `RepairResult` | interface | `src/server/lib/extraction-coverage-repair.ts:75` | 0 | unique |
| `RecoveredStep` | interface | `src/server/lib/extraction-coverage-repair.ts:86` | 0 | unique |
| `RecoveredConfluence` | interface | `src/server/lib/extraction-coverage-repair.ts:91` | 1 | AMBIG |
| `selectRepairTargets` | function | `src/server/lib/extraction-coverage-repair.ts:103` | 0 | unique |
| `mergeRepairResult` | function | `src/server/lib/extraction-coverage-repair.ts:133` | 0 | unique |
| `runCoverageTargetedRecall` | function | `src/server/lib/extraction-coverage-repair.ts:237` | 0 | unique |
| `runCoverageRepairLoop` | function | `src/server/lib/extraction-coverage-repair.ts:291` | 1 | unique |
| `GroundingResult` | interface | `src/server/lib/extraction-grounding.ts:33` | 0 | unique |
| `checkNumericGrounding` | function | `src/server/lib/extraction-grounding.ts:148` | 1 | unique |
| `Step` | interface | `src/server/lib/extraction-quality-gate.ts:23` | 0 | unique |
| `StrategyForQuality` | interface | `src/server/lib/extraction-quality-gate.ts:29` | 0 | unique |
| `QualityWarning` | interface | `src/server/lib/extraction-quality-gate.ts:35` | 0 | unique |
| `QualityReport` | interface | `src/server/lib/extraction-quality-gate.ts:42` | 0 | unique |
| `CompilabilityInput` | interface | `src/server/lib/extraction-quality-gate.ts:131` | 0 | unique |
| `CompilabilityResult` | interface | `src/server/lib/extraction-quality-gate.ts:176` | 0 | unique |
| `PLACEHOLDER_CONCEPT_NAMES` | const | `src/server/lib/extraction-quality-gate.ts:193` | 0 | unique |
| `checkCompilabilityGate` | function | `src/server/lib/extraction-quality-gate.ts:209` | 1 | unique |
| `checkExtractionQuality` | function | `src/server/lib/extraction-quality-gate.ts:333` | 1 | unique |
| `normalizeFirmKey` | function | `src/server/lib/firm-broker-topology.ts:27` | 2 | AMBIG |
| `FirmBrokerTopologyResult` | interface | `src/server/lib/firm-broker-topology.ts:39` | 0 | unique |
| `validateFirmBrokerTopology` | function | `src/server/lib/firm-broker-topology.ts:56` | 1 | unique |
| `FirmBrokerTopologyError` | class | `src/server/lib/firm-broker-topology.ts:83` | 0 | unique |
| `FIRM_CONFIGS_TS` | const | `src/server/lib/firm-rules-version.ts:36` | 1 | unique |
| `FIRM_RULES_TS` | const | `src/server/lib/firm-rules-version.ts:82` | 1 | unique |
| `computeFirmRulesVersionFromDicts` | function | `src/server/lib/firm-rules-version.ts:173` | 0 | unique |
| `computeFirmRulesVersion` | function | `src/server/lib/firm-rules-version.ts:190` | 3 | unique |
| `computeFrozenPolicyHash` | export-binding | `src/server/lib/frozen-policy-contract.ts:33` | 2 | AMBIG |
| `evaluateFrozenPolicyDriftAtPromotion` | export-binding | `src/server/lib/frozen-policy-contract.ts:33` | 3 | AMBIG |
| `FrozenPolicySlice` | export-binding-type | `src/server/lib/frozen-policy-contract.ts:37` | 1 | AMBIG |
| `FrozenPolicyDriftResult` | export-binding-type | `src/server/lib/frozen-policy-contract.ts:37` | 2 | AMBIG |
| `freezePolicyForStrategy` | function | `src/server/lib/frozen-policy-contract.ts:58` | 1 | unique |
| `synthesizeV11FromGemmaProse` | function | `src/server/lib/gemma-prose-to-v11.ts:387` | 1 | unique |
| `isHandlerDrivenEntry` | function | `src/server/lib/handler-driven-entry.ts:68` | 3 | unique |
| `ParamSource` | type | `src/server/lib/indicator-params.ts:18` | 0 | unique |
| `IndicatorParams` | interface | `src/server/lib/indicator-params.ts:20` | 0 | unique |
| `detectIndicator` | function | `src/server/lib/indicator-params.ts:46` | 0 | unique |
| `scanIndicatorParams` | function | `src/server/lib/indicator-params.ts:157` | 1 | unique |
| `ParamMode` | type | `src/server/lib/indicator-params.ts:199` | 0 | unique |
| `KillzoneName` | type | `src/server/lib/killzone.ts:59` | 0 | unique |
| `activeKillzones` | function | `src/server/lib/killzone.ts:184` | 1 | unique |
| `isInAnyKillzone` | function | `src/server/lib/killzone.ts:203` | 1 | unique |
| `LEARNING_LOOP_MODE_PARAM` | const | `src/server/lib/learning-loop-mode.ts:43` | 3 | unique |
| `MODE_OFF` | const | `src/server/lib/learning-loop-mode.ts:45` | 0 | unique |
| `MODE_OBSERVE` | const | `src/server/lib/learning-loop-mode.ts:46` | 2 | unique |
| `MODE_AUTOPILOT` | const | `src/server/lib/learning-loop-mode.ts:47` | 3 | unique |
| `LearningLoopMode` | type | `src/server/lib/learning-loop-mode.ts:49` | 1 | unique |
| `LearningLoopModeState` | interface | `src/server/lib/learning-loop-mode.ts:51` | 0 | unique |
| `parseLearningLoopMode` | function | `src/server/lib/learning-loop-mode.ts:73` | 3 | unique |
| `learningLoopModeLabel` | function | `src/server/lib/learning-loop-mode.ts:84` | 1 | unique |
| `readLearningLoopMode` | function | `src/server/lib/learning-loop-mode.ts:106` | 2 | unique |
| `MAX_GENERATIONS` | const | `src/server/lib/lifecycle-constants.ts:11` | 2 | unique |
| `COOLDOWN_DAYS` | const | `src/server/lib/lifecycle-constants.ts:14` | 1 | unique |
| `logger` | const | `src/server/lib/logger.ts:5` | 322 | AMBIG |
| `LunchBlackoutGateInput` | interface | `src/server/lib/lunch-blackout-gate.ts:50` | 0 | unique |
| `LunchBlackoutGateResult` | interface | `src/server/lib/lunch-blackout-gate.ts:61` | 0 | unique |
| `getLunchBlackoutStartEnvDefault` | function | `src/server/lib/lunch-blackout-gate.ts:79` | 1 | unique |
| `getLunchBlackoutEndEnvDefault` | function | `src/server/lib/lunch-blackout-gate.ts:91` | 1 | unique |
| `evaluateLunchBlackoutGate` | function | `src/server/lib/lunch-blackout-gate.ts:110` | 1 | unique |
| `MechanicRejectClass` | type | `src/server/lib/mechanic-portability.ts:27` | 0 | unique |
| `MechanicPortabilityResult` | interface | `src/server/lib/mechanic-portability.ts:34` | 0 | unique |
| `classifyMechanicPortability` | function | `src/server/lib/mechanic-portability.ts:138` | 1 | unique |
| `explainRejectClass` | function | `src/server/lib/mechanic-portability.ts:206` | 1 | unique |
| `promRegistry` | const | `src/server/lib/metrics-registry.ts:26` | 1 | unique |
| `httpRequestDurationMs` | const | `src/server/lib/metrics-registry.ts:35` | 1 | unique |
| `circuitBreakerState` | const | `src/server/lib/metrics-registry.ts:46` | 1 | unique |
| `circuitBreakerFailures` | const | `src/server/lib/metrics-registry.ts:53` | 1 | unique |
| `pythonSubprocessActive` | const | `src/server/lib/metrics-registry.ts:63` | 1 | unique |
| `pythonSubprocessQueued` | const | `src/server/lib/metrics-registry.ts:69` | 1 | unique |
| `strategyPromotions` | const | `src/server/lib/metrics-registry.ts:83` | 1 | unique |
| `backtestRuns` | const | `src/server/lib/metrics-registry.ts:90` | 1 | unique |
| `paperTrades` | const | `src/server/lib/metrics-registry.ts:97` | 29 | AMBIG |
| `backtestScoredTotal` | const | `src/server/lib/metrics-registry.ts:108` | 1 | unique |
| `crossValidatorCallsTotal` | const | `src/server/lib/metrics-registry.ts:118` | 1 | unique |
| `crossValidatorLatencySeconds` | const | `src/server/lib/metrics-registry.ts:127` | 1 | unique |
| `pendingBucketsGraduatedTotal` | const | `src/server/lib/metrics-registry.ts:136` | 1 | unique |
| `pendingBucketsTotal` | const | `src/server/lib/metrics-registry.ts:145` | 1 | unique |
| `cronJobsConcurrent` | const | `src/server/lib/metrics-registry.ts:155` | 1 | unique |
| `archetypeSignalsTotal` | const | `src/server/lib/metrics-registry.ts:169` | 1 | unique |
| `strategySourceResolutionTotal` | const | `src/server/lib/metrics-registry.ts:181` | 1 | unique |
| `graduationFactorQualityTotal` | const | `src/server/lib/metrics-registry.ts:196` | 1 | unique |
| `graduationBidirectionalRejectionTotal` | const | `src/server/lib/metrics-registry.ts:206` | 1 | unique |
| `extractionConfluenceDepthHistogram` | const | `src/server/lib/metrics-registry.ts:218` | 1 | unique |
| `ddVelocityAutopauseTotal` | const | `src/server/lib/metrics-registry.ts:232` | 1 | unique |
| `regimeTransitionTotal` | const | `src/server/lib/metrics-registry.ts:243` | 2 | unique |
| `pboBlocksTotal` | const | `src/server/lib/metrics-registry.ts:273` | 1 | unique |
| `shadowSignalsTotal` | const | `src/server/lib/metrics-registry.ts:298` | 1 | unique |
| `rlTrainingEpochsTotal` | const | `src/server/lib/metrics-registry.ts:318` | 1 | unique |
| `rlKillSwitchTotal` | const | `src/server/lib/metrics-registry.ts:329` | 1 | unique |
| `rlAbSharpeDelta` | const | `src/server/lib/metrics-registry.ts:341` | 1 | unique |
| `rlAbPnlDelta` | const | `src/server/lib/metrics-registry.ts:351` | 1 | unique |
| `frozenPolicyOverridesTotal` | const | `src/server/lib/metrics-registry.ts:361` | 1 | unique |
| `regimeDriftDetectionsTotal` | const | `src/server/lib/metrics-registry.ts:372` | 1 | unique |
| `portfolioDriftDemotionsTotal` | const | `src/server/lib/metrics-registry.ts:386` | 1 | unique |
| `lifecycleShadowPromotionsTotal` | const | `src/server/lib/metrics-registry.ts:397` | 1 | unique |
| `warningSeverityDiscordRoutedTotal` | const | `src/server/lib/metrics-registry.ts:425` | 1 | unique |
| `traderspostRejectsTotal` | const | `src/server/lib/metrics-registry.ts:452` | 1 | unique |
| `archetypeSignalsRoutedTotal` | const | `src/server/lib/metrics-registry.ts:480` | 1 | unique |
| `pineShadowRefusalsTotal` | const | `src/server/lib/metrics-registry.ts:507` | 1 | unique |
| `layer15LeakDetectionsTotal` | const | `src/server/lib/metrics-registry.ts:544` | 1 | unique |
| `b14GateTotal` | const | `src/server/lib/metrics-registry.ts:573` | 1 | unique |
| `wfeGateTotal` | const | `src/server/lib/metrics-registry.ts:580` | 1 | unique |
| `parameterDriftGateTotal` | const | `src/server/lib/metrics-registry.ts:587` | 1 | unique |
| `dslGuardsGateTotal` | const | `src/server/lib/metrics-registry.ts:610` | 1 | unique |
| `backtestCompletionWriteFailedTotal` | const | `src/server/lib/metrics-registry.ts:646` | 1 | unique |
| `quantumMcRunsTotal` | const | `src/server/lib/metrics-registry.ts:679` | 2 | unique |
| `backtestDslGuardsFailedTotal` | const | `src/server/lib/metrics-registry.ts:704` | 1 | unique |
| `trackG2SilentFailuresTotal` | const | `src/server/lib/metrics-registry.ts:731` | 4 | unique |
| `layer15RunDurationMs` | const | `src/server/lib/metrics-registry.ts:775` | 1 | unique |
| `candidateConveyorEnqueuedTotal` | const | `src/server/lib/metrics-registry.ts:790` | 1 | unique |
| `candidateConveyorRejectionsTotal` | const | `src/server/lib/metrics-registry.ts:806` | 1 | unique |
| `criticOptimizerRecoveryForceFailTotal` | const | `src/server/lib/metrics-registry.ts:823` | 1 | unique |
| `paperStreamLifecycleTotal` | const | `src/server/lib/metrics-registry.ts:845` | 1 | unique |
| `bifGateEvaluationsTotal` | const | `src/server/lib/metrics-registry.ts:879` | 1 | unique |
| `slippageSurvivalBlocksTotal` | const | `src/server/lib/metrics-registry.ts:902` | 1 | unique |
| `autoGraveyardTotal` | const | `src/server/lib/metrics-registry.ts:918` | 1 | unique |
| `auditWriteFailuresTotal` | const | `src/server/lib/metrics-registry.ts:942` | 7 | unique |
| `sseClientsConnected` | const | `src/server/lib/metrics-registry.ts:952` | 1 | unique |
| `dllHaltTotal` | const | `src/server/lib/metrics-registry.ts:1036` | 2 | unique |
| `JournalWhenEntry` | interface | `src/server/lib/migration-journal-utils.ts:5` | 0 | unique |
| `findDuplicateJournalWhens` | function | `src/server/lib/migration-journal-utils.ts:21` | 1 | unique |
| `KNOWN_OUT_OF_BAND_APPLIED_HASHES` | const | `src/server/lib/migration-journal-utils.ts:60` | 0 | unique |
| `MigrationPlan` | interface | `src/server/lib/migration-journal-utils.ts:73` | 0 | unique |
| `computeMigrationPlan` | function | `src/server/lib/migration-journal-utils.ts:97` | 1 | unique |
| `NetworkState` | type | `src/server/lib/network-failover.ts:51` | 0 | unique |
| `checkPrimaryConnectivity` | function | `src/server/lib/network-failover.ts:176` | 0 | unique |
| `stopNetworkFailoverMonitor` | function | `src/server/lib/network-failover.ts:386` | 0 | unique |
| `getNetworkState` | function | `src/server/lib/network-failover.ts:398` | 0 | unique |
| `isConnectivityDegraded` | function | `src/server/lib/network-failover.ts:412` | 2 | unique |
| `NetworkFailoverStatus` | interface | `src/server/lib/network-failover.ts:420` | 1 | unique |
| `getNetworkFailoverStatus` | function | `src/server/lib/network-failover.ts:433` | 1 | unique |
| `NewsAction` | type | `src/server/lib/news-policy.ts:28` | 0 | unique |
| `NEWS_ENTRY_BLOCK_BEFORE_MIN` | const | `src/server/lib/news-policy.ts:32` | 1 | unique |
| `NEWS_ENTRY_BLOCK_AFTER_MIN` | const | `src/server/lib/news-policy.ts:33` | 1 | unique |
| `getNewsReduceSizeFactor` | function | `src/server/lib/news-policy.ts:88` | 0 | unique |
| `normalizeFirmKey` | function | `src/server/lib/news-policy.ts:99` | 2 | AMBIG |
| `resolveNewsAction` | function | `src/server/lib/news-policy.ts:112` | 1 | unique |
| `eventAffectsSymbol` | function | `src/server/lib/news-policy.ts:150` | 2 | unique |
| `appendFamilyGradePostscript` | function | `src/server/lib/notification-helpers.ts:28` | 62 | unique |
| `requireOfficeControlAuthority` | function | `src/server/lib/office-control-guard.ts:34` | 2 | unique |
| `B15BatteryInput` | interface | `src/server/lib/paper-to-deploy-ready-gates.ts:67` | 1 | unique |
| `WalkForwardResultsInput` | interface | `src/server/lib/paper-to-deploy-ready-gates.ts:78` | 0 | unique |
| `McRuinCiInput` | interface | `src/server/lib/paper-to-deploy-ready-gates.ts:103` | 0 | unique |
| `FrozenPolicyInput` | interface | `src/server/lib/paper-to-deploy-ready-gates.ts:115` | 0 | unique |
| `CompositeShadowInput` | interface | `src/server/lib/paper-to-deploy-ready-gates.ts:128` | 0 | unique |
| `SurvivalTwinPerFirm` | interface | `src/server/lib/paper-to-deploy-ready-gates.ts:143` | 0 | unique |
| `OnDemandSurvivalReplayResult` | interface | `src/server/lib/paper-to-deploy-ready-gates.ts:162` | 1 | unique |
| `SurvivalTwinGateStatus` | type | `src/server/lib/paper-to-deploy-ready-gates.ts:171` | 0 | unique |
| `SurvivalTwinVerdict` | interface | `src/server/lib/paper-to-deploy-ready-gates.ts:177` | 0 | unique |
| `B14SurvivalTwinInput` | interface | `src/server/lib/paper-to-deploy-ready-gates.ts:185` | 1 | unique |
| `OrchGatesInput` | interface | `src/server/lib/paper-to-deploy-ready-gates.ts:202` | 0 | unique |
| `PaperToDeployReadyGateInput` | interface | `src/server/lib/paper-to-deploy-ready-gates.ts:220` | 1 | unique |
| `PaperToDeployReadyFailedGate` | type | `src/server/lib/paper-to-deploy-ready-gates.ts:275` | 0 | unique |
| `PaperToDeployReadyGateStatus` | type | `src/server/lib/paper-to-deploy-ready-gates.ts:289` | 0 | unique |
| `PaperToDeployReadyGateResult` | interface | `src/server/lib/paper-to-deploy-ready-gates.ts:296` | 0 | unique |
| `evaluatePaperToDeployReadyGates` | function | `src/server/lib/paper-to-deploy-ready-gates.ts:366` | 2 | unique |
| `resolveSurvivalTwinOnDemand` | function | `src/server/lib/paper-to-deploy-ready-gates.ts:1193` | 1 | unique |
| `RangeMap` | type | `src/server/lib/param-ranges.ts:22` | 0 | unique |
| `CANONICAL_PARAM_RANGES` | const | `src/server/lib/param-ranges.ts:24` | 3 | unique |
| `ParameterDriftClassification` | type | `src/server/lib/parameter-drift-gate.ts:42` | 1 | AMBIG |
| `ParameterDriftGateStatus` | type | `src/server/lib/parameter-drift-gate.ts:50` | 0 | unique |
| `ParameterDriftGateResult` | interface | `src/server/lib/parameter-drift-gate.ts:59` | 0 | unique |
| `evaluateParameterDriftGate` | function | `src/server/lib/parameter-drift-gate.ts:94` | 2 | unique |
| `PBO_LIFECYCLE_THRESHOLD_DEFAULT` | const | `src/server/lib/pbo-gate.ts:34` | 0 | unique |
| `PboGateInput` | interface | `src/server/lib/pbo-gate.ts:38` | 0 | unique |
| `PboGateResult` | interface | `src/server/lib/pbo-gate.ts:54` | 0 | unique |
| `getPboLifecycleThreshold` | function | `src/server/lib/pbo-gate.ts:87` | 4 | unique |
| `evaluatePboGate` | function | `src/server/lib/pbo-gate.ts:119` | 1 | unique |
| `pineCompileRequestSchema` | const | `src/server/lib/pine-artifact-schema.ts:3` | 1 | unique |
| `pineExportResponseSchema` | const | `src/server/lib/pine-artifact-schema.ts:9` | 0 | unique |
| `PineExportShadowError` | class | `src/server/lib/pine-export-shadow-guard.ts:37` | 3 | unique |
| `assertNotShadow` | function | `src/server/lib/pine-export-shadow-guard.ts:79` | 3 | unique |
| `GatewayOptions` | interface | `src/server/lib/pine-gateway-options.ts:19` | 1 | AMBIG |
| `deriveGatewayOptions` | function | `src/server/lib/pine-gateway-options.ts:36` | 1 | AMBIG |
| `BlockedAtSite` | type | `src/server/lib/pine-shadow-observability.ts:69` | 0 | unique |
| `PineShadowRefusedPayload` | interface | `src/server/lib/pine-shadow-observability.ts:82` | 0 | unique |
| `emitPineShadowRefused` | function | `src/server/lib/pine-shadow-observability.ts:119` | 3 | unique |
| `PmSizeFactorInput` | interface | `src/server/lib/pm-size-factor.ts:45` | 0 | unique |
| `PmSizeFactorResult` | interface | `src/server/lib/pm-size-factor.ts:60` | 1 | AMBIG |
| `getPmSizeFactorEnvDefaults` | function | `src/server/lib/pm-size-factor.ts:111` | 0 | unique |
| `computePmSizeFactor` | function | `src/server/lib/pm-size-factor.ts:141` | 2 | unique |
| `PRICE_LOCK_PROXIMITY_PCT` | const | `src/server/lib/price-lock-limit-gate.ts:39` | 0 | unique |
| `PriceLockResult` | interface | `src/server/lib/price-lock-limit-gate.ts:58` | 0 | unique |
| `checkPriceLockLimit` | function | `src/server/lib/price-lock-limit-gate.ts:82` | 1 | unique |
| `GateName` | type | `src/server/lib/promotion-gate-orchestrator.ts:77` | 0 | unique |
| `GateResult` | interface | `src/server/lib/promotion-gate-orchestrator.ts:79` | 1 | unique |
| `PromotionGateOrchestratorResult` | interface | `src/server/lib/promotion-gate-orchestrator.ts:92` | 0 | unique |
| `StrategyPromotionData` | interface | `src/server/lib/promotion-gate-orchestrator.ts:104` | 1 | unique |
| `getWfePromotionFloor` | function | `src/server/lib/promotion-gate-orchestrator.ts:122` | 1 | unique |
| `getCpcvMinPaths` | function | `src/server/lib/promotion-gate-orchestrator.ts:137` | 1 | unique |
| `evaluatePromotionGates` | function | `src/server/lib/promotion-gate-orchestrator.ts:295` | 2 | unique |
| `registerExternalPythonSubprocess` | function | `src/server/lib/python-runner.ts:98` | 2 | unique |
| `gracefullyShutdownPythonSubprocesses` | function | `src/server/lib/python-runner.ts:113` | 1 | unique |
| `acquireExternalPythonSlot` | function | `src/server/lib/python-runner.ts:161` | 2 | unique |
| `releaseExternalPythonSlot` | function | `src/server/lib/python-runner.ts:165` | 2 | unique |
| `getPythonSubprocessStats` | function | `src/server/lib/python-runner.ts:173` | 6 | unique |
| `PythonRunnerOptions` | interface | `src/server/lib/python-runner.ts:190` | 0 | unique |
| `PARITY_SHADOW_SENTINEL` | const | `src/server/lib/python-runner.ts:218` | 0 | unique |
| `INVARIANT_FAILURE_SENTINEL` | const | `src/server/lib/python-runner.ts:219` | 0 | unique |
| `B15_BATTERY_SENTINEL` | const | `src/server/lib/python-runner.ts:223` | 0 | unique |
| `TruthinessSentinelEvent` | interface | `src/server/lib/python-runner.ts:225` | 0 | unique |
| `parseTruthinessSentinel` | function | `src/server/lib/python-runner.ts:234` | 0 | unique |
| `runPythonModule` | function | `src/server/lib/python-runner.ts:282` | 45 | unique |
| `AgreementResult` | interface | `src/server/lib/quantum-agreement.ts:33` | 0 | unique |
| `computeAgreement` | function | `src/server/lib/quantum-agreement.ts:63` | 1 | unique |
| `STALE_PENDING_SENTINEL_ID` | const | `src/server/lib/quantum-cost-tracker.ts:36` | 1 | unique |
| `CostOpts` | interface | `src/server/lib/quantum-cost-tracker.ts:40` | 0 | unique |
| `CompleteOpts` | interface | `src/server/lib/quantum-cost-tracker.ts:53` | 0 | unique |
| `recordCost` | function | `src/server/lib/quantum-cost-tracker.ts:74` | 5 | unique |
| `completeCost` | function | `src/server/lib/quantum-cost-tracker.ts:123` | 5 | unique |
| `pruneStalePendingCosts` | function | `src/server/lib/quantum-cost-tracker.ts:176` | 1 | unique |
| `withCostTracking` | function | `src/server/lib/quantum-cost-tracker.ts:222` | 1 | unique |
| `_getConsecutiveFailuresForTests` | function | `src/server/lib/quantum-replay-runner.ts:252` | 1 | unique |
| `isQuantumReplayEnabled` | function | `src/server/lib/quantum-replay-runner.ts:262` | 1 | unique |
| `QuantumReplayResult` | interface | `src/server/lib/quantum-replay-runner.ts:277` | 0 | unique |
| `deriveReplaySeed` | function | `src/server/lib/quantum-replay-runner.ts:299` | 0 | unique |
| `runQuantumReplayForBacktest` | function | `src/server/lib/quantum-replay-runner.ts:401` | 1 | unique |
| `isOffRthTrainingWindow` | function | `src/server/lib/quantum-rl-training-runner.ts:83` | 2 | unique |
| `_getRlConsecutiveFailuresForTests` | function | `src/server/lib/quantum-rl-training-runner.ts:266` | 1 | unique |
| `deriveRlTrainingSeed` | function | `src/server/lib/quantum-rl-training-runner.ts:279` | 1 | unique |
| `_writeStderrAuditEvents` | function | `src/server/lib/quantum-rl-training-runner.ts:327` | 0 | unique |
| `RlTrainingAutoFireResult` | interface | `src/server/lib/quantum-rl-training-runner.ts:371` | 0 | unique |
| `runRlTrainingForStrategy` | function | `src/server/lib/quantum-rl-training-runner.ts:417` | 1 | unique |
| `quantumRunRequestSchema` | const | `src/server/lib/quantum-run-schema.ts:3` | 1 | unique |
| `hybridCompareRequestSchema` | const | `src/server/lib/quantum-run-schema.ts:13` | 1 | unique |
| `QuarantineExtractionOpts` | interface | `src/server/lib/quarantine-extraction.ts:34` | 0 | unique |
| `quarantineExtraction` | function | `src/server/lib/quarantine-extraction.ts:51` | 2 | unique |
| `ReconSeverity` | type | `src/server/lib/recon-severity.ts:1` | 2 | AMBIG |
| `deriveReconSeverity` | function | `src/server/lib/recon-severity.ts:15` | 1 | unique |
| `ReplayOutcomePatch` | interface | `src/server/lib/replay-outcome.ts:46` | 0 | unique |
| `InvalidReason` | type | `src/server/lib/replay-outcome.ts:59` | 0 | unique |
| `RECOGNIZED_TIERS` | const | `src/server/lib/replay-outcome.ts:68` | 0 | unique |
| `RecognizedTier` | type | `src/server/lib/replay-outcome.ts:69` | 0 | unique |
| `RANKING_ELIGIBLE_TIERS` | const | `src/server/lib/replay-outcome.ts:72` | 0 | unique |
| `BACKTEST_STATUS_COMPLETED` | const | `src/server/lib/replay-outcome.ts:84` | 0 | unique |
| `ReplayOutcome` | type | `src/server/lib/replay-outcome.ts:86` | 0 | unique |
| `REPLAY_STATUS_INVALID` | const | `src/server/lib/replay-outcome.ts:117` | 0 | unique |
| `classifyReplayOutcome` | function | `src/server/lib/replay-outcome.ts:133` | 1 | unique |
| `canonicalizeResult` | function | `src/server/lib/result-hasher.ts:74` | 0 | unique |
| `computeResultHash` | function | `src/server/lib/result-hasher.ts:84` | 3 | unique |
| `computeDataHash` | function | `src/server/lib/result-hasher.ts:101` | 2 | unique |
| `computeStrategyHash` | function | `src/server/lib/result-hasher.ts:124` | 2 | AMBIG |
| `FirmId` | type | `src/server/lib/risk-sizing.ts:62` | 0 | unique |
| `DEFAULT_CONFLUENCE_MULTIPLIER` | const | `src/server/lib/risk-sizing.ts:83` | 0 | unique |
| `resolveConfluenceMultiplier` | function | `src/server/lib/risk-sizing.ts:94` | 0 | unique |
| `RiskSizingInputs` | interface | `src/server/lib/risk-sizing.ts:102` | 1 | unique |
| `ConfluenceAuditPayload` | interface | `src/server/lib/risk-sizing.ts:252` | 0 | unique |
| `RiskSizingResult` | interface | `src/server/lib/risk-sizing.ts:260` | 1 | AMBIG |
| `computeVolScale` | function | `src/server/lib/risk-sizing.ts:360` | 0 | unique |
| `computeVixAtrMultiplier` | function | `src/server/lib/risk-sizing.ts:386` | 0 | unique |
| `computeLiquidityHaircut` | function | `src/server/lib/risk-sizing.ts:405` | 0 | unique |
| `computeRiskDerivedContracts` | function | `src/server/lib/risk-sizing.ts:459` | 1 | unique |
| `DEFAULT_DSR_THRESHOLD` | const | `src/server/lib/rl-dsr-gate.ts:52` | 0 | unique |
| `MIN_TRAINING_ITERATIONS` | const | `src/server/lib/rl-dsr-gate.ts:57` | 0 | unique |
| `probit` | function | `src/server/lib/rl-dsr-gate.ts:81` | 0 | unique |
| `DsrComponents` | interface | `src/server/lib/rl-dsr-gate.ts:91` | 0 | unique |
| `computeDsrComponents` | function | `src/server/lib/rl-dsr-gate.ts:111` | 0 | unique |
| `RlDsrGateResult` | interface | `src/server/lib/rl-dsr-gate.ts:154` | 0 | unique |
| `evaluateRlDsrGate` | function | `src/server/lib/rl-dsr-gate.ts:191` | 1 | unique |
| `RlSignalResult` | interface | `src/server/lib/rl-signal-fetcher.ts:41` | 0 | unique |
| `fetchRlSignal` | function | `src/server/lib/rl-signal-fetcher.ts:193` | 1 | unique |
| `RollDate` | interface | `src/server/lib/roll-calendar-data.ts:30` | 0 | unique |
| `rollCalendar` | const | `src/server/lib/roll-calendar-data.ts:47` | 1 | unique |
| `RollSpreadCost` | interface | `src/server/lib/roll-calendar-loader.ts:26` | 0 | unique |
| `computeRollSpreadCost` | function | `src/server/lib/roll-calendar-loader.ts:54` | 1 | unique |
| `findUnscheduledJobs` | function | `src/server/lib/scheduler-drift.ts:11` | 1 | unique |
| `SessionRegion` | type | `src/server/lib/session-filter.ts:19` | 0 | unique |
| `SessionSubtype` | type | `src/server/lib/session-filter.ts:20` | 0 | unique |
| `SessionFilter` | interface | `src/server/lib/session-filter.ts:22` | 0 | unique |
| `normalizeSessionPhrase` | function | `src/server/lib/session-filter.ts:89` | 0 | unique |
| `extractSessionFromTranscript` | function | `src/server/lib/session-filter.ts:168` | 1 | unique |
| `sessionFilterLabel` | function | `src/server/lib/session-filter.ts:221` | 1 | unique |
| `ShadowDivergenceWriteResult` | interface | `src/server/lib/shadow-divergence-writer.ts:41` | 0 | unique |
| `writeShadowDivergence` | function | `src/server/lib/shadow-divergence-writer.ts:137` | 1 | unique |
| `ShadowSignal` | interface | `src/server/lib/shadow-signal-divergence-checker.ts:50` | 3 | unique |
| `ExpectedSignal` | interface | `src/server/lib/shadow-signal-divergence-checker.ts:76` | 3 | unique |
| `PerSignalViolation` | interface | `src/server/lib/shadow-signal-divergence-checker.ts:90` | 0 | unique |
| `DivergenceResult` | interface | `src/server/lib/shadow-signal-divergence-checker.ts:107` | 0 | unique |
| `MIN_SAMPLE_SIZE` | const | `src/server/lib/shadow-signal-divergence-checker.ts:125` | 1 | unique |
| `DIVERGENCE_THRESHOLD` | const | `src/server/lib/shadow-signal-divergence-checker.ts:128` | 1 | unique |
| `DEFAULT_BAR_SECONDS` | const | `src/server/lib/shadow-signal-divergence-checker.ts:131` | 0 | unique |
| `SIZE_TOLERANCE_PCT` | const | `src/server/lib/shadow-signal-divergence-checker.ts:134` | 0 | unique |
| `compareShadowToBacktest` | function | `src/server/lib/shadow-signal-divergence-checker.ts:167` | 3 | unique |
| `loadShadowSignalsForStrategy` | function | `src/server/lib/shadow-signal-divergence-loader.ts:44` | 0 | unique |
| `loadBacktestExpectedSignalsForPeriod` | function | `src/server/lib/shadow-signal-divergence-loader.ts:104` | 0 | unique |
| `loadDivergenceInputs` | function | `src/server/lib/shadow-signal-divergence-loader.ts:191` | 1 | unique |
| `getDivergenceThreshold` | function | `src/server/lib/shadow-to-paper-gate.ts:54` | 0 | unique |
| `getMinSampleSize` | function | `src/server/lib/shadow-to-paper-gate.ts:68` | 0 | unique |
| `ShadowToPaperGateInput` | interface | `src/server/lib/shadow-to-paper-gate.ts:94` | 0 | unique |
| `ShadowToPaperGateStatus` | type | `src/server/lib/shadow-to-paper-gate.ts:114` | 0 | unique |
| `ShadowToPaperGateResult` | interface | `src/server/lib/shadow-to-paper-gate.ts:128` | 0 | unique |
| `evaluateShadowToPaperGate` | function | `src/server/lib/shadow-to-paper-gate.ts:178` | 1 | unique |
| `getSlippageSurvivalGateEnabled` | function | `src/server/lib/slippage-survival-gate.ts:100` | 0 | unique |
| `getSlippageSurvivalBlockMult` | function | `src/server/lib/slippage-survival-gate.ts:110` | 0 | unique |
| `SlippageSurvivalDict` | interface | `src/server/lib/slippage-survival-gate.ts:193` | 1 | unique |
| `SlippageSurvivalGateStatus` | type | `src/server/lib/slippage-survival-gate.ts:207` | 0 | unique |
| `SlippageSurvivalGateResult` | interface | `src/server/lib/slippage-survival-gate.ts:216` | 0 | unique |
| `evaluateSlippageSurvivalGate` | function | `src/server/lib/slippage-survival-gate.ts:248` | 1 | unique |
| `ADMIN_COOKIE_NAME` | const | `src/server/lib/slumhouse/admin-session.ts:28` | 1 | unique |
| `ADMIN_SESSION_TTL_SEC` | const | `src/server/lib/slumhouse/admin-session.ts:31` | 1 | unique |
| `isAdminConfigured` | function | `src/server/lib/slumhouse/admin-session.ts:49` | 1 | unique |
| `checkPasscode` | function | `src/server/lib/slumhouse/admin-session.ts:62` | 1 | unique |
| `signAdminSession` | function | `src/server/lib/slumhouse/admin-session.ts:79` | 1 | unique |
| `verifyAdminSession` | function | `src/server/lib/slumhouse/admin-session.ts:91` | 0 | unique |
| `adminSessionFromCookie` | function | `src/server/lib/slumhouse/admin-session.ts:138` | 6 | unique |
| `adminDiscordUserIdFromCookie` | function | `src/server/lib/slumhouse/admin-session.ts:154` | 1 | unique |
| `CribData` | type | `src/server/lib/slumhouse/crib-data.ts:15` | 0 | unique |
| `assembleCribData` | function | `src/server/lib/slumhouse/crib-data.ts:209` | 2 | unique |
| `exchangeCodeForToken` | function | `src/server/lib/slumhouse/discord-oauth.ts:12` | 1 | unique |
| `DiscordUser` | interface | `src/server/lib/slumhouse/discord-oauth.ts:41` | 0 | unique |
| `fetchDiscordUser` | function | `src/server/lib/slumhouse/discord-oauth.ts:47` | 1 | unique |
| `GateStatus` | type | `src/server/lib/slumhouse/gate-journey.ts:1` | 0 | unique |
| `Gate` | interface | `src/server/lib/slumhouse/gate-journey.ts:2` | 2 | unique |
| `GateSignals` | interface | `src/server/lib/slumhouse/gate-journey.ts:3` | 1 | unique |
| `JourneyInput` | interface | `src/server/lib/slumhouse/gate-journey.ts:7` | 0 | unique |
| `GATE_DEFS` | const | `src/server/lib/slumhouse/gate-journey.ts:9` | 0 | unique |
| `coarseJourneyForStage` | function | `src/server/lib/slumhouse/gate-journey.ts:38` | 1 | unique |
| `resolveGateJourney` | function | `src/server/lib/slumhouse/gate-journey.ts:51` | 1 | unique |
| `KitchenStage` | interface | `src/server/lib/slumhouse/kitchen-data.ts:14` | 0 | unique |
| `KitchenData` | interface | `src/server/lib/slumhouse/kitchen-data.ts:21` | 0 | unique |
| `assembleKitchenData` | function | `src/server/lib/slumhouse/kitchen-data.ts:42` | 2 | unique |
| `MenuDish` | interface | `src/server/lib/slumhouse/kitchen-data.ts:73` | 0 | unique |
| `assembleTodaysMenu` | function | `src/server/lib/slumhouse/kitchen-data.ts:83` | 3 | unique |
| `RecipeData` | interface | `src/server/lib/slumhouse/recipe-data.ts:22` | 0 | unique |
| `assembleRecipeData` | function | `src/server/lib/slumhouse/recipe-data.ts:60` | 1 | unique |
| `GptReport` | interface | `src/server/lib/slumhouse/reports-data.ts:16` | 0 | unique |
| `ReportsPayload` | interface | `src/server/lib/slumhouse/reports-data.ts:40` | 0 | unique |
| `assembleGptReports` | function | `src/server/lib/slumhouse/reports-data.ts:65` | 1 | unique |
| `SlumhouseRequest` | interface | `src/server/lib/slumhouse/require-session.ts:28` | 6 | unique |
| `requireSlumhouseUser` | function | `src/server/lib/slumhouse/require-session.ts:32` | 6 | unique |
| `requireSlumhouseUserOrAdmin` | function | `src/server/lib/slumhouse/require-session.ts:99` | 1 | unique |
| `requireAdminSession` | function | `src/server/lib/slumhouse/require-session.ts:122` | 3 | unique |
| `checkSlumhouseOrigin` | function | `src/server/lib/slumhouse/require-session.ts:149` | 2 | unique |
| `COOKIE_NAME` | const | `src/server/lib/slumhouse/session.ts:22` | 4 | unique |
| `VerifyResult` | type | `src/server/lib/slumhouse/session.ts:31` | 2 | AMBIG |
| `signSession` | function | `src/server/lib/slumhouse/session.ts:46` | 1 | unique |
| `verifySession` | function | `src/server/lib/slumhouse/session.ts:58` | 5 | unique |
| `symbolToStreet` | function | `src/server/lib/slumhouse/translate.ts:22` | 1 | unique |
| `lifecycleToStation` | function | `src/server/lib/slumhouse/translate.ts:39` | 1 | unique |
| `formatBag` | function | `src/server/lib/slumhouse/translate.ts:53` | 3 | unique |
| `oddsOuttaHundred` | function | `src/server/lib/slumhouse/translate.ts:84` | 1 | unique |
| `unmappedAccountDisclosure` | function | `src/server/lib/slumhouse/translate.ts:98` | 1 | unique |
| `liveModeDataDisclosure` | function | `src/server/lib/slumhouse/translate.ts:110` | 1 | unique |
| `SpecConditionLike` | interface | `src/server/lib/spec-family-bindings.ts:23` | 0 | unique |
| `ConditionBinding` | interface | `src/server/lib/spec-family-bindings.ts:30` | 3 | AMBIG |
| `QueueReason` | interface | `src/server/lib/spec-family-bindings.ts:43` | 0 | unique |
| `BindingPlan` | interface | `src/server/lib/spec-family-bindings.ts:50` | 4 | AMBIG |
| `SESSION_KEYWORDS` | const | `src/server/lib/spec-family-bindings.ts:69` | 3 | unique |
| `REFUSED_SESSION_KEYWORDS` | const | `src/server/lib/spec-family-bindings.ts:83` | 2 | unique |
| `sessionRefusalReason` | function | `src/server/lib/spec-family-bindings.ts:88` | 0 | unique |
| `MIN_SPINE_BOUND_RATIO` | const | `src/server/lib/spec-family-bindings.ts:92` | 1 | unique |
| `FAMILY_META` | const | `src/server/lib/spec-family-bindings.ts:132` | 3 | unique |
| `resolveSessionKeyword` | function | `src/server/lib/spec-family-bindings.ts:224` | 0 | unique |
| `refusedSessionZone` | function | `src/server/lib/spec-family-bindings.ts:233` | 0 | unique |
| `bindCondition` | function | `src/server/lib/spec-family-bindings.ts:241` | 0 | unique |
| `SpecArtifactBodyLike` | interface | `src/server/lib/spec-family-bindings.ts:327` | 0 | unique |
| `compileBindingPlan` | function | `src/server/lib/spec-family-bindings.ts:333` | 3 | unique |
| `SQA_AWAIT_TIMEOUT_MS` | const | `src/server/lib/sqa-promise-registry.ts:27` | 0 | unique |
| `SQA_TTL_MS` | const | `src/server/lib/sqa-promise-registry.ts:28` | 0 | unique |
| `SQA_CB_WINDOW_MS` | const | `src/server/lib/sqa-promise-registry.ts:29` | 0 | unique |
| `SQA_CB_THRESHOLD` | const | `src/server/lib/sqa-promise-registry.ts:30` | 0 | unique |
| `SQA_CB_COOLDOWN_MS` | const | `src/server/lib/sqa-promise-registry.ts:31` | 0 | unique |
| `SqaRegistryEntry` | interface | `src/server/lib/sqa-promise-registry.ts:35` | 0 | unique |
| `SqaCircuitState` | type | `src/server/lib/sqa-promise-registry.ts:41` | 0 | unique |
| `AuditWriter` | type | `src/server/lib/sqa-promise-registry.ts:44` | 0 | unique |
| `SqaPromiseRegistry` | class | `src/server/lib/sqa-promise-registry.ts:56` | 0 | unique |
| `sqaRegistry` | const | `src/server/lib/sqa-promise-registry.ts:304` | 2 | unique |
| `isBootLauncherCheckApplicable` | function | `src/server/lib/startup-config-check.ts:95` | 0 | unique |
| `isBootLauncherActive` | function | `src/server/lib/startup-config-check.ts:103` | 0 | unique |
| `BootLauncherAutoApplyState` | interface | `src/server/lib/startup-config-check.ts:167` | 0 | unique |
| `shouldAutoApplyLauncher` | function | `src/server/lib/startup-config-check.ts:191` | 0 | unique |
| `NssmCommandSpec` | interface | `src/server/lib/startup-config-check.ts:204` | 0 | unique |
| `buildNssmSetCommand` | function | `src/server/lib/startup-config-check.ts:214` | 0 | unique |
| `buildNssmGetCommand` | function | `src/server/lib/startup-config-check.ts:229` | 0 | unique |
| `attemptBootLauncherAutoApply` | function | `src/server/lib/startup-config-check.ts:403` | 0 | unique |
| `isLocalOrPrivateGatewayUrl` | function | `src/server/lib/startup-config-check.ts:608` | 0 | unique |
| `checkStartupSecrets` | function | `src/server/lib/startup-config-check.ts:670` | 1 | unique |
| `runBootConfigReminderCheck` | function | `src/server/lib/startup-config-check.ts:1137` | 0 | unique |
| `startBootConfigReminderMonitor` | function | `src/server/lib/startup-config-check.ts:1189` | 1 | unique |
| `stripMarketSuffix` | function | `src/server/lib/strategy-source-resolver.ts:61` | 1 | unique |
| `getStrategySourceUrl` | function | `src/server/lib/strategy-source-resolver.ts:293` | 1 | unique |
| `getStrategySourceUrls` | function | `src/server/lib/strategy-source-resolver.ts:371` | 1 | unique |
| `getAllStrategiesWithUrls` | function | `src/server/lib/strategy-source-resolver.ts:392` | 1 | unique |
| `STYLE_C_EVALUATOR_VERSION` | const | `src/server/lib/style-c-exit-evaluator.ts:30` | 0 | unique |
| `TP1_FRACTION_C` | const | `src/server/lib/style-c-exit-evaluator.ts:32` | 2 | unique |
| `TP2_FRACTION_C` | const | `src/server/lib/style-c-exit-evaluator.ts:33` | 2 | unique |
| `RUNNER_FRACTION_C` | const | `src/server/lib/style-c-exit-evaluator.ts:34` | 2 | unique |
| `TP1_AT_R_C` | const | `src/server/lib/style-c-exit-evaluator.ts:36` | 2 | unique |
| `TP2_AT_R_C` | const | `src/server/lib/style-c-exit-evaluator.ts:37` | 2 | unique |
| `StyleCEvalState` | interface | `src/server/lib/style-c-exit-evaluator.ts:44` | 0 | unique |
| `StyleCEvalResult` | interface | `src/server/lib/style-c-exit-evaluator.ts:78` | 0 | unique |
| `evaluateStyleCExit` | function | `src/server/lib/style-c-exit-evaluator.ts:132` | 1 | unique |
| `WorkflowState` | type | `src/server/lib/system-topology.ts:5` | 0 | unique |
| `WorkflowHealthStatus` | type | `src/server/lib/system-topology.ts:10` | 0 | unique |
| `WorkflowSourceStatus` | type | `src/server/lib/system-topology.ts:11` | 0 | unique |
| `WorkflowLiveSyncStatus` | type | `src/server/lib/system-topology.ts:12` | 0 | unique |
| `WorkflowInventoryItem` | interface | `src/server/lib/system-topology.ts:14` | 0 | unique |
| `WorkflowInventorySummary` | interface | `src/server/lib/system-topology.ts:29` | 0 | unique |
| `SubsystemProofMode` | type | `src/server/lib/system-topology.ts:63` | 0 | unique |
| `OwnershipBoundary` | type | `src/server/lib/system-topology.ts:64` | 0 | unique |
| `LearningBoundary` | type | `src/server/lib/system-topology.ts:65` | 0 | unique |
| `CurrentSubsystemState` | type | `src/server/lib/system-topology.ts:66` | 0 | unique |
| `LaunchTargetState` | type | `src/server/lib/system-topology.ts:71` | 0 | unique |
| `ProductionTargetState` | type | `src/server/lib/system-topology.ts:75` | 0 | unique |
| `ClosedLoopStatus` | type | `src/server/lib/system-topology.ts:80` | 0 | unique |
| `AutomationStatus` | type | `src/server/lib/system-topology.ts:86` | 0 | unique |
| `CoverageStatus` | type | `src/server/lib/system-topology.ts:87` | 0 | unique |
| `LearningStatus` | type | `src/server/lib/system-topology.ts:88` | 0 | unique |
| `FailureVisibilityStatus` | type | `src/server/lib/system-topology.ts:94` | 0 | unique |
| `LearningMode` | type | `src/server/lib/system-topology.ts:95` | 0 | unique |
| `SubsystemOperatingClass` | type | `src/server/lib/system-topology.ts:100` | 0 | unique |
| `AuthorityStatus` | type | `src/server/lib/system-topology.ts:104` | 0 | unique |
| `DeploymentAuthority` | type | `src/server/lib/system-topology.ts:105` | 0 | unique |
| `SubsystemCriticality` | type | `src/server/lib/system-topology.ts:111` | 0 | unique |
| `SubsystemProofStatus` | type | `src/server/lib/system-topology.ts:112` | 0 | unique |
| `SystemSubsystemRegistryEntry` | interface | `src/server/lib/system-topology.ts:119` | 0 | unique |
| `RegistrySubsystemSummary` | interface | `src/server/lib/system-topology.ts:169` | 2 | unique |
| `EngineSubsystemSummary` | interface | `src/server/lib/system-topology.ts:215` | 0 | unique |
| `RegistryCoverageReport` | interface | `src/server/lib/system-topology.ts:228` | 0 | unique |
| `ProductionRuntimeControls` | interface | `src/server/lib/system-topology.ts:307` | 0 | unique |
| `SystemTopologySnapshot` | interface | `src/server/lib/system-topology.ts:315` | 1 | unique |
| `StaticReadinessSubsystem` | interface | `src/server/lib/system-topology.ts:353` | 0 | unique |
| `StaticReadinessReport` | interface | `src/server/lib/system-topology.ts:366` | 1 | unique |
| `resolveWorkflowStaleMaxAgeHours` | function | `src/server/lib/system-topology.ts:410` | 0 | unique |
| `getProjectRoot` | function | `src/server/lib/system-topology.ts:430` | 0 | unique |
| `canonicalizeWorkflowStem` | function | `src/server/lib/system-topology.ts:513` | 0 | unique |
| `classifyWorkflowState` | function | `src/server/lib/system-topology.ts:519` | 0 | unique |
| `normalizeWorkflowHealth` | function | `src/server/lib/system-topology.ts:540` | 0 | unique |
| `buildWorkflowInventoryFromStems` | function | `src/server/lib/system-topology.ts:696` | 0 | unique |
| `evaluateProductionRuntimeControls` | function | `src/server/lib/system-topology.ts:1294` | 0 | unique |
| `evaluateRegistryCoverage` | function | `src/server/lib/system-topology.ts:1331` | 0 | unique |
| `collectSystemTopology` | function | `src/server/lib/system-topology.ts:1849` | 1 | unique |
| `buildStaticReadinessReport` | function | `src/server/lib/system-topology.ts:1893` | 1 | unique |
| `toWindows` | function | `src/server/lib/text-windows.ts:16` | 1 | unique |
| `TIER1_BLACKOUT_MINUTES` | const | `src/server/lib/tier1-event-blackout.ts:44` | 0 | unique |
| `Tier1Event` | interface | `src/server/lib/tier1-event-blackout.ts:47` | 0 | unique |
| `buildNfpEvents` | function | `src/server/lib/tier1-event-blackout.ts:154` | 0 | unique |
| `TIER1_EVENTS` | const | `src/server/lib/tier1-event-blackout.ts:206` | 2 | unique |
| `Tier1CheckResult` | interface | `src/server/lib/tier1-event-blackout.ts:215` | 0 | unique |
| `checkInProcessTier1EventWindow` | function | `src/server/lib/tier1-event-blackout.ts:235` | 1 | unique |
| `Span` | interface | `src/server/lib/tracing.ts:35` | 0 | unique |
| `Tracer` | interface | `src/server/lib/tracing.ts:40` | 0 | unique |
| `tracer` | export-binding | `src/server/lib/tracing.ts:110` | 8 | unique |
| `OTEL_AVAILABLE` | export-binding | `src/server/lib/tracing.ts:110` | 1 | unique |
| `DEFAULT_CHUNK_CHARS` | const | `src/server/lib/transcript-chunker.ts:59` | 0 | unique |
| `DEFAULT_OVERLAP_CHARS` | const | `src/server/lib/transcript-chunker.ts:61` | 0 | unique |
| `DEFAULT_CHUNK_NUM_CTX` | const | `src/server/lib/transcript-chunker.ts:63` | 0 | unique |
| `CHUNKING_THRESHOLD_CHARS` | const | `src/server/lib/transcript-chunker.ts:68` | 2 | unique |
| `ChunkerOptions` | interface | `src/server/lib/transcript-chunker.ts:70` | 0 | unique |
| `ChunkedExtractOptions` | interface | `src/server/lib/transcript-chunker.ts:75` | 0 | unique |
| `RawChunkResult` | interface | `src/server/lib/transcript-chunker.ts:84` | 0 | unique |
| `chunkTranscript` | function | `src/server/lib/transcript-chunker.ts:112` | 3 | unique |
| `mergeChunkResults` | function | `src/server/lib/transcript-chunker.ts:248` | 1 | unique |
| `extractTranscriptChunked` | function | `src/server/lib/transcript-chunker.ts:318` | 2 | unique |
| `shouldChunk` | function | `src/server/lib/transcript-chunker.ts:376` | 2 | unique |
| `RecallField` | interface | `src/server/lib/transcript-extractor-recall.ts:30` | 0 | unique |
| `RecallAnswer` | interface | `src/server/lib/transcript-extractor-recall.ts:37` | 0 | unique |
| `PrimaryStrategyShape` | interface | `src/server/lib/transcript-extractor-recall.ts:47` | 1 | unique |
| `RecallResult` | interface | `src/server/lib/transcript-extractor-recall.ts:57` | 0 | unique |
| `preScanNumericClaims` | function | `src/server/lib/transcript-extractor-recall.ts:152` | 1 | unique |
| `DeterministicClaims` | interface | `src/server/lib/transcript-extractor-recall.ts:195` | 0 | unique |
| `verifyQuoteInTranscript` | function | `src/server/lib/transcript-extractor-recall.ts:292` | 2 | unique |
| `runRecallPass` | function | `src/server/lib/transcript-extractor-recall.ts:327` | 1 | unique |
| `runRecallPassOnStrategies` | function | `src/server/lib/transcript-extractor-recall.ts:576` | 1 | unique |
| `extractSpeakerConceptsFromTranscript` | function | `src/server/lib/transcript-speaker-concepts.ts:93` | 3 | unique |
| `toEtDate` | function | `src/server/lib/treasury-auction-calendar.ts:98` | 0 | unique |
| `isBondAuctionToday` | function | `src/server/lib/treasury-auction-calendar.ts:124` | 1 | unique |
| `runPass1VocabularyExtraction` | function | `src/server/lib/two-pass-vocab-extractor.ts:199` | 2 | unique |
| `DEFAULT_CONFLUENCE_THRESHOLD` | const | `src/server/lib/wave25-strategy-defaults.ts:32` | 3 | AMBIG |
| `buildDefaultConfluenceWeights` | function | `src/server/lib/wave25-strategy-defaults.ts:49` | 0 | unique |
| `inferMtfHierarchy` | function | `src/server/lib/wave25-strategy-defaults.ts:58` | 0 | unique |
| `inferSymbolSet` | function | `src/server/lib/wave25-strategy-defaults.ts:98` | 1 | unique |
| `buildDefaultExitPlanConfig` | function | `src/server/lib/wave25-strategy-defaults.ts:132` | 0 | unique |
| `Wave25DefaultsInput` | interface | `src/server/lib/wave25-strategy-defaults.ts:142` | 0 | unique |
| `Wave25DefaultsOutput` | interface | `src/server/lib/wave25-strategy-defaults.ts:150` | 0 | unique |
| `applyWave25Defaults` | function | `src/server/lib/wave25-strategy-defaults.ts:168` | 2 | unique |
| `WfeGateStatus` | type | `src/server/lib/wfe-gate.ts:49` | 0 | unique |
| `WfeGateResult` | interface | `src/server/lib/wfe-gate.ts:58` | 0 | unique |
| `getWfeHardFloor` | function | `src/server/lib/wfe-gate.ts:96` | 5 | unique |
| `getWfeWarnFloor` | function | `src/server/lib/wfe-gate.ts:101` | 0 | unique |
| `evaluateWfeGate` | function | `src/server/lib/wfe-gate.ts:122` | 3 | unique |

</details>

<details><summary><code>src/server/middleware</code> - 8 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `authMiddleware` | function | `src/server/middleware/auth.ts:52` | 2 | unique |
| `correlationMiddleware` | function | `src/server/middleware/correlation.ts:17` | 1 | unique |
| `idempotencyMiddleware` | function | `src/server/middleware/idempotency.ts:23` | 8 | unique |
| `rateLimit` | function | `src/server/middleware/rate-limit.ts:11` | 1 | unique |
| `strictRateLimit` | const | `src/server/middleware/rate-limit.ts:38` | 5 | unique |
| `standardRateLimit` | const | `src/server/middleware/rate-limit.ts:40` | 1 | unique |
| `computeLiveActiveWorkflowHash` | function | `src/server/middleware/require-live-n8n.ts:32` | 0 | unique |
| `requireLiveN8n` | function | `src/server/middleware/require-live-n8n.ts:66` | 1 | unique |

</details>

<details><summary><code>src/server/production</code> - 29 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `DRIFT_CONFIG` | const | `src/server/production/drift-detector.ts:44` | 1 | unique |
| `DriftSeverity` | type | `src/server/production/drift-detector.ts:53` | 1 | unique |
| `DriftReport` | interface | `src/server/production/drift-detector.ts:55` | 2 | AMBIG |
| `runWeeklyDriftDetection` | function | `src/server/production/drift-detector.ts:222` | 2 | unique |
| `ProductionMode` | export-binding-type | `src/server/production/kill-switch.ts:313` | 2 | AMBIG |
| `SystemState` | interface | `src/server/production/kill-switch.ts:315` | 0 | unique |
| `HaltDecision` | interface | `src/server/production/kill-switch.ts:323` | 0 | unique |
| `KillSwitchLayerStatus` | interface | `src/server/production/kill-switch.ts:330` | 1 | unique |
| `KillSwitchStatusReport` | interface | `src/server/production/kill-switch.ts:337` | 2 | unique |
| `killSwitch` | const | `src/server/production/kill-switch.ts:1507` | 13 | unique |
| `PAPER_RECON_CONFIG` | const | `src/server/production/paper-journal-recon.ts:79` | 0 | unique |
| `PaperReconStrategyResult` | interface | `src/server/production/paper-journal-recon.ts:101` | 0 | unique |
| `PaperJournalReconResult` | interface | `src/server/production/paper-journal-recon.ts:116` | 0 | unique |
| `ShadowSignalReconResult` | interface | `src/server/production/paper-journal-recon.ts:143` | 0 | unique |
| `QuantumReplayReconResult` | interface | `src/server/production/paper-journal-recon.ts:154` | 0 | unique |
| `AbRoutingReconResult` | interface | `src/server/production/paper-journal-recon.ts:162` | 0 | unique |
| `computePnlTolerance` | function | `src/server/production/paper-journal-recon.ts:179` | 0 | unique |
| `runPaperJournalRecon` | function | `src/server/production/paper-journal-recon.ts:649` | 1 | unique |
| `RECON_CONFIG` | const | `src/server/production/reconciliation-service.ts:47` | 1 | unique |
| `ReconSeverity` | type | `src/server/production/reconciliation-service.ts:56` | 2 | AMBIG |
| `MismatchDetail` | interface | `src/server/production/reconciliation-service.ts:58` | 1 | unique |
| `ReconciliationResult` | interface | `src/server/production/reconciliation-service.ts:65` | 2 | AMBIG |
| `ReconciliationStatus` | interface | `src/server/production/reconciliation-service.ts:82` | 1 | unique |
| `INDEPENDENT_SOURCE_COUNT` | const | `src/server/production/reconciliation-service.ts:174` | 0 | unique |
| `MIN_INDEPENDENT_SOURCES_FOR_RED` | const | `src/server/production/reconciliation-service.ts:176` | 0 | unique |
| `PROXY_COUNT_LEGS_INDEPENDENT` | const | `src/server/production/reconciliation-service.ts:190` | 0 | unique |
| `isTraderspostConfirmIndependent` | function | `src/server/production/reconciliation-service.ts:212` | 0 | unique |
| `runDailyReconciliation` | function | `src/server/production/reconciliation-service.ts:350` | 2 | unique |
| `getDailyReconciliationStatus` | function | `src/server/production/reconciliation-service.ts:803` | 2 | unique |

</details>

<details><summary><code>src/server/routes</code> - 156 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `abComparisonRoutes` | const | `src/server/routes/ab-comparison.ts:47` | 1 | unique |
| `SubAccountMetrics` | interface | `src/server/routes/ab-comparison.ts:57` | 0 | unique |
| `ABComparisonDelta` | interface | `src/server/routes/ab-comparison.ts:64` | 0 | unique |
| `KillSwitchStatus` | interface | `src/server/routes/ab-comparison.ts:70` | 0 | unique |
| `ABComparisonPayload` | interface | `src/server/routes/ab-comparison.ts:76` | 0 | unique |
| `computeRolling20SessionSharpe` | function | `src/server/routes/ab-comparison.ts:105` | 0 | unique |
| `buildABComparisonData` | function | `src/server/routes/ab-comparison.ts:279` | 1 | unique |
| `adminFrozenPolicyOverrideRoutes` | const | `src/server/routes/admin-frozen-policy-override.ts:41` | 1 | unique |
| `adminRecoveryRoutes` | const | `src/server/routes/admin-recovery.ts:65` | 1 | unique |
| `adminWorkflowBackupRoutes` | const | `src/server/routes/admin-workflow-backup.ts:33` | 1 | unique |
| `handleWorkflowBackup` | function | `src/server/routes/admin-workflow-backup.ts:43` | 0 | unique |
| `adminRoutes` | const | `src/server/routes/admin.ts:31` | 1 | unique |
| `adversarialStressRoutes` | const | `src/server/routes/adversarial-stress.ts:33` | 1 | unique |
| `STRUCTURAL_ARCHETYPE_PATTERNS` | const | `src/server/routes/agent.ts:78` | 0 | unique |
| `detectStructuralArchetype` | function | `src/server/routes/agent.ts:89` | 0 | unique |
| `agentRoutes` | const | `src/server/routes/agent.ts:102` | 1 | unique |
| `alertRoutes` | export-binding | `src/server/routes/alerts.ts:86` | 1 | unique |
| `antiSetupRoutes` | const | `src/server/routes/anti-setups.ts:17` | 1 | unique |
| `archetypeRoutes` | const | `src/server/routes/archetypes.ts:16` | 1 | unique |
| `auditorRoutes` | const | `src/server/routes/auditor.ts:20` | 1 | unique |
| `b15RobustnessRoutes` | const | `src/server/routes/b15-robustness.ts:19` | 1 | unique |
| `getBacktestConcurrencyStats` | function | `src/server/routes/backtests.ts:60` | 3 | unique |
| `backtestRoutes` | const | `src/server/routes/backtests.ts:77` | 1 | unique |
| `BacktestSubmitResponse` | interface | `src/server/routes/backtests.ts:85` | 0 | unique |
| `biasDecisionsRoutes` | const | `src/server/routes/bias-decisions.ts:21` | 1 | unique |
| `biasStateRoutes` | const | `src/server/routes/bias-state.ts:25` | 1 | unique |
| `brokerAccountRoutes` | const | `src/server/routes/broker-accounts.ts:24` | 1 | unique |
| `brokerErrorBudgetRoutes` | const | `src/server/routes/broker-error-budget.ts:13` | 1 | unique |
| `carterToolsRouter` | const | `src/server/routes/carter-tools.ts:33` | 1 | unique |
| `postCarterWebhook` | function | `src/server/routes/carter-webhook.ts:38` | 0 | unique |
| `carterWebhookRouter` | const | `src/server/routes/carter-webhook.ts:132` | 1 | unique |
| `cloudQmcRoutes` | const | `src/server/routes/cloud-qmc.ts:38` | 1 | unique |
| `compilerRoutes` | const | `src/server/routes/compiler.ts:18` | 1 | unique |
| `ComplianceVerifyResponse` | interface | `src/server/routes/compliance.ts:26` | 0 | unique |
| `ComplianceReviewSubmitResponse` | interface | `src/server/routes/compliance.ts:31` | 0 | unique |
| `compositeHealthRoutes` | const | `src/server/routes/composite-health.ts:38` | 1 | unique |
| `HealthVerdict` | type | `src/server/routes/composite-health.ts:42` | 2 | AMBIG |
| `LatestHealthPayload` | interface | `src/server/routes/composite-health.ts:45` | 0 | unique |
| `SubsystemDetail` | interface | `src/server/routes/composite-health.ts:58` | 0 | unique |
| `SummaryPayload` | interface | `src/server/routes/composite-health.ts:67` | 0 | unique |
| `buildCompositeHealthSummary` | function | `src/server/routes/composite-health.ts:129` | 1 | unique |
| `consistencyRoutes` | const | `src/server/routes/consistency.ts:20` | 1 | unique |
| `contextRoutes` | const | `src/server/routes/context.ts:19` | 1 | unique |
| `criticOptimizerRoutes` | const | `src/server/routes/critic-optimizer.ts:28` | 1 | unique |
| `dataRoutes` | const | `src/server/routes/data.ts:12` | 1 | unique |
| `decayRoutes` | const | `src/server/routes/decay.ts:22` | 1 | unique |
| `deeparRoutes` | const | `src/server/routes/deepar.ts:13` | 1 | unique |
| `deployedStrategyStarvationRoutes` | const | `src/server/routes/deployed-strategy-starvation.ts:14` | 1 | unique |
| `dlqRoutes` | const | `src/server/routes/dlq.ts:6` | 1 | unique |
| `fillCallbackRoutes` | const | `src/server/routes/fill-callback.ts:64` | 1 | unique |
| `frankensteinRoutes` | const | `src/server/routes/frankenstein.ts:31` | 1 | unique |
| `governorRoutes` | const | `src/server/routes/governor.ts:17` | 1 | unique |
| `graveyardRoutes` | const | `src/server/routes/graveyard.ts:14` | 1 | unique |
| `healthDashboardRoutes` | export-binding | `src/server/routes/health-dashboard.ts:632` | 1 | unique |
| `indicatorRoutes` | const | `src/server/routes/indicators.ts:6` | 1 | unique |
| `journalRoutes` | const | `src/server/routes/journal.ts:8` | 1 | unique |
| `leakDetectionRoutes` | const | `src/server/routes/leak-detection.ts:57` | 1 | unique |
| `libraryDiversityRoutes` | const | `src/server/routes/library-diversity.ts:15` | 1 | unique |
| `liveOrderRoutes` | const | `src/server/routes/live-order.ts:97` | 1 | unique |
| `macroRoutes` | const | `src/server/routes/macro.ts:36` | 1 | unique |
| `metricsRoutes` | const | `src/server/routes/metrics.ts:12` | 1 | unique |
| `monteCarloRoutes` | const | `src/server/routes/monte-carlo.ts:11` | 1 | unique |
| `n8nTrackingRoutes` | const | `src/server/routes/n8n-tracking.ts:9` | 1 | unique |
| `nemoScenarioRoutes` | const | `src/server/routes/nemo-scenarios.ts:23` | 1 | unique |
| `openaiProxyRoutes` | const | `src/server/routes/openai-proxy.ts:22` | 1 | unique |
| `openclawDailyReportRoutes` | const | `src/server/routes/openclaw-daily-report.ts:17` | 1 | unique |
| `PaperStartResponse` | type | `src/server/routes/paper.ts:29` | 0 | unique |
| `paperRoutes` | export-binding | `src/server/routes/paper.ts:1052` | 1 | unique |
| `pineExportRecipientRoutes` | const | `src/server/routes/pine-export-recipient.ts:21` | 1 | unique |
| `pineExportRoutes` | const | `src/server/routes/pine-export.ts:22` | 1 | unique |
| `portfolioRoutes` | const | `src/server/routes/portfolio.ts:18` | 1 | unique |
| `preMarketRoutes` | const | `src/server/routes/pre-market.ts:22` | 1 | unique |
| `prevalidatorRoutes` | const | `src/server/routes/prevalidator.ts:13` | 1 | unique |
| `productionStatusRoutes` | const | `src/server/routes/production-status.ts:33` | 1 | unique |
| `DrawdownStatus` | interface | `src/server/routes/production-status.ts:46` | 0 | unique |
| `ProductionStatusResponse` | interface | `src/server/routes/production-status.ts:94` | 0 | unique |
| `buildDrawdownDistance` | function | `src/server/routes/production-status.ts:189` | 1 | unique |
| `buildProductionStatus` | function | `src/server/routes/production-status.ts:415` | 1 | unique |
| `propFirmRoutes` | const | `src/server/routes/prop-firm.ts:25` | 1 | unique |
| `FirmSurvivalAugmentation` | interface | `src/server/routes/prop-firm.ts:39` | 0 | unique |
| `quantumCostRoutes` | const | `src/server/routes/quantum-cost.ts:30` | 1 | unique |
| `quantumMcRoutes` | const | `src/server/routes/quantum-mc.ts:10` | 1 | unique |
| `quantumPreFlightRoutes` | const | `src/server/routes/quantum-pre-flight.ts:56` | 1 | unique |
| `computeStrategyHash` | function | `src/server/routes/quantum-pre-flight.ts:85` | 2 | AMBIG |
| `riskRoutes` | const | `src/server/routes/risk.ts:4` | 1 | unique |
| `scoutHealthRoutes` | const | `src/server/routes/scout-health.ts:18` | 1 | unique |
| `searchRouterRoutes` | const | `src/server/routes/search-router.ts:14` | 1 | unique |
| `shadowRerunRoutes` | const | `src/server/routes/shadow-rerun.ts:26` | 1 | unique |
| `signalCorrelationRoutes` | const | `src/server/routes/signal-correlation.ts:32` | 1 | unique |
| `signalRoutes` | const | `src/server/routes/signals.ts:5` | 1 | unique |
| `skipRoutes` | const | `src/server/routes/skip.ts:19` | 1 | unique |
| `slumdawgRoutes` | const | `src/server/routes/slumdawg.ts:32` | 1 | unique |
| `postSlumhouseUser` | function | `src/server/routes/slumhouse/admin-mapping.ts:49` | 0 | unique |
| `listSlumhouseUsers` | function | `src/server/routes/slumhouse/admin-mapping.ts:85` | 0 | unique |
| `adminMappingRouter` | const | `src/server/routes/slumhouse/admin-mapping.ts:92` | 2 | AMBIG |
| `adminOfficeRouter` | const | `src/server/routes/slumhouse/admin.ts:62` | 1 | unique |
| `SwitchStates` | interface | `src/server/routes/slumhouse/admin.ts:238` | 0 | unique |
| `computeSwitchStates` | function | `src/server/routes/slumhouse/admin.ts:246` | 1 | unique |
| `getSwitchStates` | function | `src/server/routes/slumhouse/admin.ts:340` | 0 | unique |
| `postSwitch` | function | `src/server/routes/slumhouse/admin.ts:348` | 0 | unique |
| `postRevokeSessions` | function | `src/server/routes/slumhouse/admin.ts:588` | 0 | unique |
| `postAnamSession` | function | `src/server/routes/slumhouse/api/anam-session.ts:16` | 0 | unique |
| `anamSessionRouter` | const | `src/server/routes/slumhouse/api/anam-session.ts:47` | 1 | unique |
| `getCarterInbox` | function | `src/server/routes/slumhouse/api/carter-inbox.ts:48` | 0 | unique |
| `carterInboxRouter` | const | `src/server/routes/slumhouse/api/carter-inbox.ts:120` | 1 | unique |
| `postCarterSession` | function | `src/server/routes/slumhouse/api/carter-session.ts:29` | 0 | unique |
| `carterSessionRouter` | const | `src/server/routes/slumhouse/api/carter-session.ts:59` | 1 | unique |
| `getCrib` | function | `src/server/routes/slumhouse/api/crib.ts:8` | 0 | unique |
| `cribApiRouter` | const | `src/server/routes/slumhouse/api/crib.ts:14` | 1 | unique |
| `getKitchen` | function | `src/server/routes/slumhouse/api/kitchen.ts:9` | 0 | unique |
| `getMenu` | function | `src/server/routes/slumhouse/api/kitchen.ts:13` | 0 | unique |
| `kitchenApiRouter` | const | `src/server/routes/slumhouse/api/kitchen.ts:17` | 1 | unique |
| `menuApiRouter` | const | `src/server/routes/slumhouse/api/menu.ts:16` | 1 | unique |
| `getRecipe` | function | `src/server/routes/slumhouse/api/recipe.ts:8` | 0 | unique |
| `recipeApiRouter` | const | `src/server/routes/slumhouse/api/recipe.ts:26` | 1 | unique |
| `reportsApiRouter` | const | `src/server/routes/slumhouse/api/reports.ts:10` | 1 | unique |
| `handleLogin` | function | `src/server/routes/slumhouse/auth.ts:34` | 0 | unique |
| `handleCallback` | function | `src/server/routes/slumhouse/auth.ts:51` | 0 | unique |
| `handleLogout` | function | `src/server/routes/slumhouse/auth.ts:151` | 0 | unique |
| `handleLaunch` | function | `src/server/routes/slumhouse/auth.ts:170` | 1 | unique |
| `authRouter` | const | `src/server/routes/slumhouse/auth.ts:189` | 1 | unique |
| `deployApprovalsRouter` | const | `src/server/routes/slumhouse/deploy-approvals.ts:45` | 1 | unique |
| `EvidenceMetric` | interface | `src/server/routes/slumhouse/deploy-approvals.ts:70` | 0 | unique |
| `CertifiedGates` | interface | `src/server/routes/slumhouse/deploy-approvals.ts:99` | 0 | unique |
| `DeployApprovalEntry` | interface | `src/server/routes/slumhouse/deploy-approvals.ts:119` | 0 | unique |
| `buildDeployEvidence` | function | `src/server/routes/slumhouse/deploy-approvals.ts:158` | 0 | unique |
| `slumhouseRouter` | const | `src/server/routes/slumhouse/index.ts:29` | 1 | unique |
| `handleSlumhouseFallback` | function | `src/server/routes/slumhouse/index.ts:31` | 0 | unique |
| `adminMappingRouter` | export-binding | `src/server/routes/slumhouse/index.ts:142` | 2 | AMBIG |
| `onSseBroadcast` | function | `src/server/routes/sse.ts:161` | 1 | unique |
| `broadcastSSE` | function | `src/server/routes/sse.ts:175` | 69 | unique |
| `closeAllSseClients` | function | `src/server/routes/sse.ts:274` | 1 | unique |
| `sseRoutes` | export-binding | `src/server/routes/sse.ts:286` | 1 | unique |
| `PAPER_EXIT_EVENTS` | const | `src/server/routes/sse.ts:292` | 1 | unique |
| `FACTORY_EVENTS` | const | `src/server/routes/sse.ts:308` | 4 | unique |
| `WAVE29_EVENTS` | const | `src/server/routes/sse.ts:390` | 1 | unique |
| `ARCHETYPE_ROUTING_EVENTS` | const | `src/server/routes/sse.ts:423` | 1 | unique |
| `LIFECYCLE_GATE_EVENTS` | const | `src/server/routes/sse.ts:472` | 2 | unique |
| `PINE_EVENTS` | const | `src/server/routes/sse.ts:550` | 1 | unique |
| `strategyRoutes` | const | `src/server/routes/strategies.ts:14` | 1 | unique |
| `DeployStrategyResponse` | interface | `src/server/routes/strategies.ts:22` | 0 | unique |
| `strategyAssignmentRoutes` | const | `src/server/routes/strategy-assignments.ts:35` | 1 | unique |
| `strategyNameRoutes` | const | `src/server/routes/strategy-names.ts:14` | 1 | unique |
| `survivalRoutes` | const | `src/server/routes/survival.ts:14` | 1 | unique |
| `syntheticBlackSwanRoutes` | const | `src/server/routes/synthetic-black-swan.ts:36` | 1 | unique |
| `tournamentRoutes` | const | `src/server/routes/tournament.ts:14` | 1 | unique |
| `tradeJournalRoutes` | const | `src/server/routes/trade-journal.ts:32` | 1 | unique |
| `extractWebhookId` | function | `src/server/routes/traderspost-confirm.ts:39` | 0 | unique |
| `traderspostConfirmSecretRequired` | function | `src/server/routes/traderspost-confirm.ts:51` | 0 | unique |
| `handleTradersPostOrderStatus` | function | `src/server/routes/traderspost-confirm.ts:63` | 0 | unique |
| `tradersPostConfirmRouter` | const | `src/server/routes/traderspost-confirm.ts:186` | 1 | unique |
| `tradingViewWebhookRoutes` | const | `src/server/routes/tradingview-webhook.ts:44` | 1 | unique |
| `validationCadenceRoutes` | const | `src/server/routes/validation-cadence.ts:22` | 1 | unique |
| `validationRoutes` | const | `src/server/routes/validation.ts:20` | 1 | unique |
| `volumeProfileRoutes` | const | `src/server/routes/volume-profile.ts:14` | 1 | unique |
| `webhookLatencyRoutes` | const | `src/server/routes/webhook-latency.ts:13` | 1 | unique |

</details>

<details><summary><code>src/server/scheduler.ts</code> - 11 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `SchedulerHealthEntry` | interface | `src/server/scheduler.ts:104` | 0 | unique |
| `getSchedulerHealth` | function | `src/server/scheduler.ts:109` | 3 | unique |
| `getSchedulerHealthExtended` | function | `src/server/scheduler.ts:114` | 1 | unique |
| `JobHealth` | interface | `src/server/scheduler.ts:129` | 0 | unique |
| `getAllJobHealth` | function | `src/server/scheduler.ts:372` | 1 | unique |
| `enableJob` | function | `src/server/scheduler.ts:376` | 2 | unique |
| `SchedulerJobMeta` | interface | `src/server/scheduler.ts:390` | 0 | unique |
| `getSchedulerJobs` | function | `src/server/scheduler.ts:395` | 2 | unique |
| `reconcileMissedRuns` | function | `src/server/scheduler.ts:790` | 0 | unique |
| `initScheduler` | function | `src/server/scheduler.ts:928` | 1 | unique |
| `onPaperTradeClose` | function | `src/server/scheduler.ts:7825` | 1 | unique |

</details>

<details><summary><code>src/server/services</code> - 903 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `AuditorScanInput` | interface | `src/server/services/a-plus-auditor-service.ts:72` | 0 | unique |
| `EdgeScoreDetail` | interface | `src/server/services/a-plus-auditor-service.ts:78` | 0 | unique |
| `AuditorScanResult` | interface | `src/server/services/a-plus-auditor-service.ts:88` | 0 | unique |
| `estimatePTargetHit` | function | `src/server/services/a-plus-auditor-service.ts:137` | 0 | unique |
| `enrichWithRealAtr` | function | `src/server/services/a-plus-auditor-service.ts:203` | 0 | unique |
| `enrichWithPTargetHit` | function | `src/server/services/a-plus-auditor-service.ts:290` | 0 | unique |
| `enrichWithPerMarketNoise` | function | `src/server/services/a-plus-auditor-service.ts:427` | 0 | unique |
| `runAuditScan` | function | `src/server/services/a-plus-auditor-service.ts:496` | 2 | unique |
| `getLatestScan` | function | `src/server/services/a-plus-auditor-service.ts:713` | 1 | unique |
| `DigestStatus` | type | `src/server/services/ab-comparison-weekly-digest-service.ts:33` | 1 | AMBIG |
| `RegimeEdge` | interface | `src/server/services/ab-comparison-weekly-digest-service.ts:38` | 0 | unique |
| `AbWeeklyMetrics` | interface | `src/server/services/ab-comparison-weekly-digest-service.ts:44` | 0 | unique |
| `DigestResult` | interface | `src/server/services/ab-comparison-weekly-digest-service.ts:62` | 1 | AMBIG |
| `_getEtHour` | function | `src/server/services/ab-comparison-weekly-digest-service.ts:89` | 3 | AMBIG |
| `_getEtWeekday` | function | `src/server/services/ab-comparison-weekly-digest-service.ts:102` | 0 | unique |
| `_resetDigestLockForTest` | function | `src/server/services/ab-comparison-weekly-digest-service.ts:124` | 1 | AMBIG |
| `runAbComparisonWeeklyDigest` | function | `src/server/services/ab-comparison-weekly-digest-service.ts:415` | 1 | unique |
| `ExitTarget` | interface | `src/server/services/adaptive-exit-engine.ts:158` | 1 | AMBIG |
| `ScalingSchedule` | interface | `src/server/services/adaptive-exit-engine.ts:170` | 1 | AMBIG |
| `ExitPlan` | interface | `src/server/services/adaptive-exit-engine.ts:181` | 3 | AMBIG |
| `ExitPlanInput` | interface | `src/server/services/adaptive-exit-engine.ts:214` | 1 | unique |
| `LiquidityFetcher` | type | `src/server/services/adaptive-exit-engine.ts:259` | 1 | unique |
| `PreLunchDecision` | interface | `src/server/services/adaptive-exit-engine.ts:410` | 0 | unique |
| `computePreLunchDecision` | function | `src/server/services/adaptive-exit-engine.ts:425` | 1 | unique |
| `DeltaDivDecision` | interface | `src/server/services/adaptive-exit-engine.ts:465` | 0 | unique |
| `computeExitPlan` | function | `src/server/services/adaptive-exit-engine.ts:524` | 2 | unique |
| `AdversarialStressPythonResult` | interface | `src/server/services/adversarial-stress-service.ts:49` | 0 | unique |
| `AdversarialStressRunOutput` | interface | `src/server/services/adversarial-stress-service.ts:66` | 0 | unique |
| `runAdversarialStress` | function | `src/server/services/adversarial-stress-service.ts:164` | 1 | unique |
| `getLatestAdversarialStressRun` | function | `src/server/services/adversarial-stress-service.ts:413` | 2 | unique |
| `HealthSweepResult` | interface | `src/server/services/agent-audit-service.ts:345` | 0 | unique |
| `runAgentHealthSweep` | function | `src/server/services/agent-audit-service.ts:356` | 1 | unique |
| `AgentEvent` | type | `src/server/services/agent-coordinator-service.ts:17` | 0 | unique |
| `agentCoordinator` | const | `src/server/services/agent-coordinator-service.ts:127` | 3 | unique |
| `initAgentCoordination` | function | `src/server/services/agent-coordinator-service.ts:135` | 1 | unique |
| `DslQualityCriticResult` | interface | `src/server/services/agent-service.ts:156` | 0 | unique |
| `runDslQualityCriticOllama` | function | `src/server/services/agent-service.ts:170` | 0 | unique |
| `runDslQualityCritic` | function | `src/server/services/agent-service.ts:250` | 3 | unique |
| `tier2AuditorFilter` | export-binding | `src/server/services/agent-service.ts:416` | 0 | unique |
| `RunStrategyInput` | interface | `src/server/services/agent-service.ts:421` | 0 | unique |
| `CritiqueInput` | interface | `src/server/services/agent-service.ts:433` | 0 | unique |
| `ScoutIdea` | interface | `src/server/services/agent-service.ts:439` | 1 | unique |
| `assertCrossValidatedSource` | function | `src/server/services/agent-service.ts:469` | 3 | unique |
| `AgentOutcomeKind` | type | `src/server/services/agent-service.ts:501` | 0 | unique |
| `AgentOutcome` | interface | `src/server/services/agent-service.ts:503` | 0 | unique |
| `mapAgentOutcome` | function | `src/server/services/agent-service.ts:515` | 0 | unique |
| `AgentService` | class | `src/server/services/agent-service.ts:545` | 3 | unique |
| `AlertSeverity` | type | `src/server/services/alert-service.ts:9` | 0 | unique |
| `AlertType` | type | `src/server/services/alert-service.ts:10` | 0 | unique |
| `createAlert` | function | `src/server/services/alert-service.ts:12` | 4 | unique |
| `AlertFactory` | const | `src/server/services/alert-service.ts:110` | 16 | unique |
| `AntiSetupEffectivenessScore` | interface | `src/server/services/anti-setup-effectiveness-service.ts:32` | 0 | unique |
| `EffectivenessReport` | interface | `src/server/services/anti-setup-effectiveness-service.ts:53` | 0 | unique |
| `runAntiSetupEffectivenessAnalysis` | function | `src/server/services/anti-setup-effectiveness-service.ts:82` | 1 | unique |
| `AntiSetupRule` | interface | `src/server/services/anti-setup-gate-service.ts:30` | 0 | unique |
| `AntiSetupGateResult` | interface | `src/server/services/anti-setup-gate-service.ts:39` | 1 | unique |
| `checkAntiSetupGate` | function | `src/server/services/anti-setup-gate-service.ts:159` | 1 | unique |
| `invalidateAntiSetupCache` | function | `src/server/services/anti-setup-gate-service.ts:244` | 1 | unique |
| `ResearchPlatform` | type | `src/server/services/apify-research-service.ts:90` | 0 | unique |
| `InstagramSearchType` | type | `src/server/services/apify-research-service.ts:91` | 0 | unique |
| `ResearchItem` | interface | `src/server/services/apify-research-service.ts:93` | 0 | unique |
| `StartResearchResult` | interface | `src/server/services/apify-research-service.ts:101` | 0 | unique |
| `ApifyDeps` | interface | `src/server/services/apify-research-service.ts:111` | 0 | unique |
| `PollArgs` | interface | `src/server/services/apify-research-service.ts:120` | 0 | unique |
| `buildActorInput` | function | `src/server/services/apify-research-service.ts:166` | 0 | unique |
| `instagramDirectUrl` | function | `src/server/services/apify-research-service.ts:200` | 0 | unique |
| `normalizeItems` | function | `src/server/services/apify-research-service.ts:211` | 0 | unique |
| `pollRunAndStore` | function | `src/server/services/apify-research-service.ts:321` | 0 | unique |
| `startAndStoreResearch` | function | `src/server/services/apify-research-service.ts:464` | 0 | unique |
| `getLatestResearch` | function | `src/server/services/apify-research-service.ts:544` | 0 | unique |
| `CARTER_APIFY_RESEARCH_ACTION_HANDLERS` | const | `src/server/services/apify-research-service.ts:654` | 1 | unique |
| `CARTER_APIFY_RESEARCH_READ_HANDLERS` | const | `src/server/services/apify-research-service.ts:660` | 1 | unique |
| `MES_QUERY_TEMPLATES` | const | `src/server/services/autonomous-scout-runner.ts:159` | 0 | unique |
| `MNQ_QUERY_TEMPLATES` | const | `src/server/services/autonomous-scout-runner.ts:259` | 0 | unique |
| `MCL_QUERY_TEMPLATES` | const | `src/server/services/autonomous-scout-runner.ts:298` | 0 | unique |
| `OPERATOR_QUERY_TEMPLATES` | const | `src/server/services/autonomous-scout-runner.ts:349` | 0 | unique |
| `SymbolGroup` | type | `src/server/services/autonomous-scout-runner.ts:387` | 0 | unique |
| `pickSymbolGroupForCycle` | function | `src/server/services/autonomous-scout-runner.ts:394` | 0 | unique |
| `getQueryTemplatesForGroup` | function | `src/server/services/autonomous-scout-runner.ts:402` | 0 | unique |
| `resolveCycleIndex` | function | `src/server/services/autonomous-scout-runner.ts:427` | 0 | unique |
| `getRotatingQuerySubset` | function | `src/server/services/autonomous-scout-runner.ts:478` | 0 | unique |
| `TranscriptQualityCheck` | interface | `src/server/services/autonomous-scout-runner.ts:549` | 0 | unique |
| `checkTranscriptQuality` | function | `src/server/services/autonomous-scout-runner.ts:565` | 0 | unique |
| `scoreVideoTitle` | function | `src/server/services/autonomous-scout-runner.ts:607` | 0 | unique |
| `scoreVideoContent` | function | `src/server/services/autonomous-scout-runner.ts:664` | 0 | unique |
| `fetchYouTubeTopVideos` | function | `src/server/services/autonomous-scout-runner.ts:1059` | 1 | unique |
| `runAutonomousScoutCycle` | function | `src/server/services/autonomous-scout-runner.ts:1374` | 3 | unique |
| `buildBacktestArgs` | export-binding | `src/server/services/backtest-service.ts:54` | 1 | AMBIG |
| `normalizeDecayAnalysis` | function | `src/server/services/backtest-service.ts:186` | 0 | unique |
| `PYTHON_EXECUTION_STATUS_REFUSED` | const | `src/server/services/backtest-service.ts:442` | 0 | unique |
| `runBacktest` | function | `src/server/services/backtest-service.ts:460` | 9 | unique |
| `StructureState` | interface | `src/server/services/bias-state-service.ts:56` | 3 | AMBIG |
| `AsianRange` | interface | `src/server/services/bias-state-service.ts:85` | 1 | AMBIG |
| `LondonBias` | interface | `src/server/services/bias-state-service.ts:92` | 1 | AMBIG |
| `NYBias` | interface | `src/server/services/bias-state-service.ts:98` | 1 | AMBIG |
| `DailyDealing` | interface | `src/server/services/bias-state-service.ts:104` | 1 | AMBIG |
| `HtfNarrative` | interface | `src/server/services/bias-state-service.ts:116` | 3 | AMBIG |
| `BIAS_SYMBOLS` | const | `src/server/services/bias-state-service.ts:125` | 2 | unique |
| `barTimestampToTradingDay` | function | `src/server/services/bias-state-service.ts:168` | 1 | unique |
| `BiasStateForSignal` | interface | `src/server/services/bias-state-service.ts:173` | 1 | unique |
| `getOrComputeBiasStateForDay` | function | `src/server/services/bias-state-service.ts:361` | 2 | unique |
| `computeBiasForAllSymbols` | function | `src/server/services/bias-state-service.ts:1319` | 2 | unique |
| `estimateBwSessionExpiryHours` | function | `src/server/services/bitwarden-session-refresh-service.ts:51` | 0 | unique |
| `refreshBwSession` | function | `src/server/services/bitwarden-session-refresh-service.ts:86` | 0 | unique |
| `BwRefreshResult` | interface | `src/server/services/bitwarden-session-refresh-service.ts:127` | 0 | unique |
| `runBwSessionRefreshCheck` | function | `src/server/services/bitwarden-session-refresh-service.ts:144` | 1 | unique |
| `BraveDiscoveredStrategy` | interface | `src/server/services/brave-search-broker.ts:30` | 0 | unique |
| `runBraveDiscovery` | function | `src/server/services/brave-search-broker.ts:107` | 1 | unique |
| `RejectionClassStats` | interface | `src/server/services/broker-error-budget-service.ts:24` | 0 | unique |
| `BrokerBudgetEntry` | interface | `src/server/services/broker-error-budget-service.ts:29` | 0 | unique |
| `BrokerErrorBudgetResult` | interface | `src/server/services/broker-error-budget-service.ts:36` | 0 | unique |
| `ALARM_THRESHOLD_PCT` | const | `src/server/services/broker-error-budget-service.ts:45` | 0 | unique |
| `computeBrokerErrorBudget` | function | `src/server/services/broker-error-budget-service.ts:143` | 1 | unique |
| `computeAlarmedBrokers` | function | `src/server/services/broker-error-budget-service.ts:238` | 1 | unique |
| `runBrokerErrorBudgetCheck` | function | `src/server/services/broker-error-budget-service.ts:255` | 1 | unique |
| `TRADERSPOST_CIRCUIT_BREAKER_KEY` | const | `src/server/services/broker-router.ts:60` | 0 | unique |
| `TRADERSPOST_CIRCUIT_OPEN_REASON` | const | `src/server/services/broker-router.ts:61` | 0 | unique |
| `probeTradersPostApiKeys` | function | `src/server/services/broker-router.ts:268` | 0 | unique |
| `BrokerResultReason` | type | `src/server/services/broker-router.ts:342` | 0 | unique |
| `BrokerResult` | interface | `src/server/services/broker-router.ts:355` | 1 | unique |
| `BROKER_ORDER_ROUTED_EVENT` | const | `src/server/services/broker-router.ts:368` | 0 | unique |
| `writeProductionTradeRow` | function | `src/server/services/broker-router.ts:492` | 0 | unique |
| `routeOrder` | function | `src/server/services/broker-router.ts:584` | 3 | unique |
| `runCandidateBacktestConveyor` | function | `src/server/services/candidate-backtest-conveyor-service.ts:53` | 1 | unique |
| `AnalystSweepStatus` | type | `src/server/services/carter-analyst-service.ts:53` | 0 | unique |
| `InsightBundle` | interface | `src/server/services/carter-analyst-service.ts:59` | 0 | unique |
| `AnalystSweepResult` | interface | `src/server/services/carter-analyst-service.ts:67` | 0 | unique |
| `runCarterAnalystSweep` | function | `src/server/services/carter-analyst-service.ts:198` | 1 | unique |
| `_pollHealth` | function | `src/server/services/carter-issue-watcher.ts:155` | 0 | unique |
| `startCarterIssueWatcher` | function | `src/server/services/carter-issue-watcher.ts:210` | 1 | unique |
| `CloudQmcEnqueueInput` | interface | `src/server/services/cloud-qmc-service.ts:82` | 0 | unique |
| `PollResult` | interface | `src/server/services/cloud-qmc-service.ts:104` | 0 | unique |
| `enqueueCloudQmcRun` | function | `src/server/services/cloud-qmc-service.ts:277` | 2 | unique |
| `pollPendingJobs` | function | `src/server/services/cloud-qmc-service.ts:501` | 2 | unique |
| `listCloudQmcRunsForStrategy` | function | `src/server/services/cloud-qmc-service.ts:794` | 1 | unique |
| `CohortReportOpts` | interface | `src/server/services/cohort-audit-report-service.ts:27` | 0 | unique |
| `CohortReportSummary` | interface | `src/server/services/cohort-audit-report-service.ts:33` | 0 | unique |
| `CohortReportResult` | interface | `src/server/services/cohort-audit-report-service.ts:43` | 0 | unique |
| `_TestRows` | interface | `src/server/services/cohort-audit-report-service.ts:137` | 0 | unique |
| `buildCohortAuditReport` | function | `src/server/services/cohort-audit-report-service.ts:349` | 1 | unique |
| `DriftCheckResult` | interface | `src/server/services/compliance-refresh-service.ts:33` | 2 | AMBIG |
| `checkComplianceRuleDrift` | function | `src/server/services/compliance-refresh-service.ts:45` | 1 | unique |
| `DigestStatus` | type | `src/server/services/composite-health-digest-service.ts:31` | 1 | AMBIG |
| `DigestVerdictCounts` | interface | `src/server/services/composite-health-digest-service.ts:37` | 0 | unique |
| `DigestResult` | interface | `src/server/services/composite-health-digest-service.ts:45` | 1 | AMBIG |
| `_resetDigestLockForTest` | function | `src/server/services/composite-health-digest-service.ts:104` | 1 | AMBIG |
| `runCompositeHealthDailyDigest` | function | `src/server/services/composite-health-digest-service.ts:155` | 1 | unique |
| `ConfirmingIndicator` | interface | `src/server/services/confirming-indicator-evaluator.ts:45` | 3 | AMBIG |
| `FactorResult` | interface | `src/server/services/confirming-indicator-evaluator.ts:54` | 0 | unique |
| `EvalBar` | interface | `src/server/services/confirming-indicator-evaluator.ts:64` | 0 | unique |
| `IndicatorMap` | type | `src/server/services/confirming-indicator-evaluator.ts:78` | 0 | unique |
| `evaluateConfirmingIndicator` | function | `src/server/services/confirming-indicator-evaluator.ts:116` | 0 | unique |
| `evaluateConfirmingIndicators` | function | `src/server/services/confirming-indicator-evaluator.ts:416` | 1 | unique |
| `W_MARKET_STRUCTURE_ALIGNED` | const | `src/server/services/confluence-score.ts:53` | 0 | unique |
| `W_LIQUIDITY_TARGET_CLEAR` | const | `src/server/services/confluence-score.ts:54` | 0 | unique |
| `W_SMT_CONFIRMATION` | const | `src/server/services/confluence-score.ts:55` | 0 | unique |
| `W_VWAP_ALIGNMENT` | const | `src/server/services/confluence-score.ts:56` | 0 | unique |
| `W_KILLZONE_ACTIVE` | const | `src/server/services/confluence-score.ts:57` | 0 | unique |
| `W_DELTA_OR_VOLUME` | const | `src/server/services/confluence-score.ts:58` | 0 | unique |
| `W_VP_LEVEL_PROXIMITY` | const | `src/server/services/confluence-score.ts:59` | 0 | unique |
| `W_MACRO_ALIGNMENT` | const | `src/server/services/confluence-score.ts:60` | 0 | unique |
| `W_INTERNALS_ALIGNED` | const | `src/server/services/confluence-score.ts:61` | 0 | unique |
| `W_CROSS_ASSET_ALIGNED` | const | `src/server/services/confluence-score.ts:62` | 0 | unique |
| `W_REGIME_MATCH` | const | `src/server/services/confluence-score.ts:63` | 0 | unique |
| `W_INTERNALS_ALIGNED_MCL` | const | `src/server/services/confluence-score.ts:67` | 0 | unique |
| `DEFAULT_CONFLUENCE_THRESHOLD` | const | `src/server/services/confluence-score.ts:71` | 3 | AMBIG |
| `FACTOR_MARKET_STRUCTURE_ALIGNED` | const | `src/server/services/confluence-score.ts:77` | 0 | unique |
| `FACTOR_LIQUIDITY_TARGET_CLEAR` | const | `src/server/services/confluence-score.ts:78` | 0 | unique |
| `FACTOR_SMT_CONFIRMATION` | const | `src/server/services/confluence-score.ts:79` | 0 | unique |
| `FACTOR_VWAP_ALIGNMENT` | const | `src/server/services/confluence-score.ts:80` | 0 | unique |
| `FACTOR_KILLZONE_ACTIVE` | const | `src/server/services/confluence-score.ts:81` | 0 | unique |
| `FACTOR_DELTA_OR_VOLUME` | const | `src/server/services/confluence-score.ts:82` | 0 | unique |
| `FACTOR_VP_LEVEL_PROXIMITY` | const | `src/server/services/confluence-score.ts:83` | 0 | unique |
| `FACTOR_MACRO_ALIGNMENT` | const | `src/server/services/confluence-score.ts:84` | 1 | unique |
| `FACTOR_INTERNALS_ALIGNED` | const | `src/server/services/confluence-score.ts:85` | 0 | unique |
| `FACTOR_CROSS_ASSET_ALIGNED` | const | `src/server/services/confluence-score.ts:86` | 0 | unique |
| `FACTOR_REGIME_MATCH` | const | `src/server/services/confluence-score.ts:87` | 0 | unique |
| `FactorConfig` | interface | `src/server/services/confluence-score.ts:98` | 0 | unique |
| `CODE_DEFAULTS` | const | `src/server/services/confluence-score.ts:103` | 0 | unique |
| `BarSnapshot` | interface | `src/server/services/confluence-score.ts:122` | 0 | unique |
| `StructureState` | interface | `src/server/services/confluence-score.ts:145` | 3 | AMBIG |
| `SignalContext` | interface | `src/server/services/confluence-score.ts:169` | 2 | unique |
| `FactorContribution` | interface | `src/server/services/confluence-score.ts:303` | 0 | unique |
| `WeightedScoreResult` | interface | `src/server/services/confluence-score.ts:337` | 2 | unique |
| `ScoringStrategy` | interface | `src/server/services/confluence-score.ts:361` | 2 | unique |
| `evaluateWeightedConfluence` | function | `src/server/services/confluence-score.ts:1069` | 2 | unique |
| `CONSISTENCY_RULE_FIRMS` | const | `src/server/services/consistency-tracker-service.ts:55` | 2 | unique |
| `GateState` | type | `src/server/services/consistency-tracker-service.ts:59` | 0 | unique |
| `ConsistencyState` | interface | `src/server/services/consistency-tracker-service.ts:61` | 0 | unique |
| `StrategyContext` | interface | `src/server/services/consistency-tracker-service.ts:79` | 0 | unique |
| `getConsistencyState` | function | `src/server/services/consistency-tracker-service.ts:154` | 3 | unique |
| `shouldBlockNewEntry` | function | `src/server/services/consistency-tracker-service.ts:536` | 1 | unique |
| `runConsistencyDailyDigest` | function | `src/server/services/consistency-tracker-service.ts:655` | 1 | unique |
| `ContextGateResult` | interface | `src/server/services/context-gate-service.ts:21` | 0 | unique |
| `evaluateContextGate` | function | `src/server/services/context-gate-service.ts:219` | 1 | unique |
| `CONTRACT_SPECS_HARDCODED` | const | `src/server/services/contract-specs-service.ts:32` | 0 | unique |
| `ContractSpec` | interface | `src/server/services/contract-specs-service.ts:44` | 5 | AMBIG |
| `getContractSpec` | function | `src/server/services/contract-specs-service.ts:63` | 0 | unique |
| `DefinitionPullResult` | interface | `src/server/services/contract-specs-service.ts:119` | 0 | unique |
| `runDefinitionPull` | function | `src/server/services/contract-specs-service.ts:142` | 1 | unique |
| `KILL_REASON_CORRELATED_POSITION_OPEN` | const | `src/server/services/correlated-position-guard.ts:22` | 2 | unique |
| `DEFAULT_CORRELATION_THRESHOLD` | const | `src/server/services/correlated-position-guard.ts:23` | 0 | unique |
| `CorrelatedPositionGuardResult` | interface | `src/server/services/correlated-position-guard.ts:27` | 0 | unique |
| `pairKey` | function | `src/server/services/correlated-position-guard.ts:56` | 0 | unique |
| `getCorrelationMatrix` | function | `src/server/services/correlated-position-guard.ts:124` | 0 | unique |
| `checkCorrelatedPositionGuard` | function | `src/server/services/correlated-position-guard.ts:149` | 1 | unique |
| `CorrelationResult` | interface | `src/server/services/correlation-service.ts:8` | 2 | AMBIG |
| `calculateCorrelation` | function | `src/server/services/correlation-service.ts:40` | 1 | unique |
| `portfolioCorrelationMatrix` | function | `src/server/services/correlation-service.ts:97` | 1 | unique |
| `computeCosts` | function | `src/server/services/cost-tracker.ts:11` | 1 | unique |
| `evaluateCriticAccuracy` | function | `src/server/services/critic-feedback-service.ts:58` | 1 | unique |
| `checkDeclingAndTriggerRegen` | function | `src/server/services/critic-feedback-service.ts:269` | 1 | unique |
| `LOOKAHEAD_GUARD_INSTRUCTION` | const | `src/server/services/critic-optimizer-service.ts:235` | 0 | unique |
| `buildCandidateGovernanceMeta` | function | `src/server/services/critic-optimizer-service.ts:261` | 0 | unique |
| `EvidenceCollector` | class | `src/server/services/critic-optimizer-service.ts:434` | 0 | unique |
| `getEvidenceCollector` | function | `src/server/services/critic-optimizer-service.ts:546` | 0 | unique |
| `triggerCriticOptimizer` | function | `src/server/services/critic-optimizer-service.ts:1009` | 3 | unique |
| `replayCandidatesAsync` | function | `src/server/services/critic-optimizer-service.ts:2170` | 0 | unique |
| `manualReplayCandidates` | function | `src/server/services/critic-optimizer-service.ts:2865` | 1 | unique |
| `getCriticRun` | function | `src/server/services/critic-optimizer-service.ts:3260` | 1 | unique |
| `getCriticHistory` | function | `src/server/services/critic-optimizer-service.ts:3283` | 1 | unique |
| `getCriticCandidates` | function | `src/server/services/critic-optimizer-service.ts:3305` | 1 | unique |
| `MATERIAL_WEIGHT_THRESHOLD` | const | `src/server/services/critique-faithfulness-check.ts:25` | 0 | unique |
| `PARAMETER_HINT_WHITELIST` | const | `src/server/services/critique-faithfulness-check.ts:44` | 0 | unique |
| `FaithfulnessResult` | interface | `src/server/services/critique-faithfulness-check.ts:91` | 0 | unique |
| `checkCritiqueFaithfulness` | function | `src/server/services/critique-faithfulness-check.ts:103` | 1 | unique |
| `ArchetypeKey` | type | `src/server/services/critique-knowledge-retriever.ts:128` | 0 | unique |
| `deriveArchetypeKey` | function | `src/server/services/critique-knowledge-retriever.ts:157` | 0 | unique |
| `retrieveCritiqueKnowledge` | function | `src/server/services/critique-knowledge-retriever.ts:267` | 1 | unique |
| `DLL_AGGREGATE_SESSION_STATUSES` | const | `src/server/services/cross-symbol-pnl.ts:39` | 0 | unique |
| `AccountSessionPnL` | interface | `src/server/services/cross-symbol-pnl.ts:41` | 0 | unique |
| `resolveAccountKey` | function | `src/server/services/cross-symbol-pnl.ts:90` | 4 | unique |
| `resolvePersonalDllDollars` | function | `src/server/services/cross-symbol-pnl.ts:136` | 2 | unique |
| `getAccountSessionCumulativePnL` | function | `src/server/services/cross-symbol-pnl.ts:166` | 2 | unique |
| `DEFAULT_PERSONAL_DLL_DOLLARS` | const | `src/server/services/cross-symbol-pnl.ts:277` | 0 | unique |
| `DLL_HALT_PCT` | const | `src/server/services/cross-symbol-pnl.ts:284` | 3 | unique |
| `DLL_FORCE_CLOSE_PCT` | const | `src/server/services/cross-symbol-pnl.ts:291` | 2 | unique |
| `DLL_REDUCE_SIZE_PCT` | const | `src/server/services/cross-symbol-pnl.ts:311` | 0 | unique |
| `DLL_REDUCE_SIZE_FACTOR` | const | `src/server/services/cross-symbol-pnl.ts:318` | 0 | unique |
| `CrossSymbolDllResult` | interface | `src/server/services/cross-symbol-pnl.ts:327` | 0 | unique |
| `evaluateCrossSymbolDll` | function | `src/server/services/cross-symbol-pnl.ts:343` | 2 | unique |
| `AccountKeyUniquenessWarning` | interface | `src/server/services/cross-symbol-pnl.ts:387` | 0 | unique |
| `checkAccountKeyUniquenessSanity` | function | `src/server/services/cross-symbol-pnl.ts:398` | 0 | unique |
| `runAccountKeyUniquenessSanityCheck` | function | `src/server/services/cross-symbol-pnl.ts:424` | 1 | unique |
| `SnapshotResult` | interface | `src/server/services/dashboard-snapshot-service.ts:59` | 0 | unique |
| `runDashboardSnapshots` | function | `src/server/services/dashboard-snapshot-service.ts:166` | 2 | unique |
| `CheckType` | type | `src/server/services/data-integrity-service.ts:31` | 0 | unique |
| `Severity` | type | `src/server/services/data-integrity-service.ts:32` | 1 | unique |
| `Finding` | interface | `src/server/services/data-integrity-service.ts:34` | 1 | unique |
| `computePSI` | function | `src/server/services/data-integrity-service.ts:61` | 0 | unique |
| `runReconciliationChecks` | function | `src/server/services/data-integrity-service.ts:371` | 0 | unique |
| `runDriftDetection` | function | `src/server/services/data-integrity-service.ts:415` | 0 | unique |
| `runFullDataIntegritySuite` | function | `src/server/services/data-integrity-service.ts:692` | 1 | unique |
| `getLocalDir` | function | `src/server/services/db-backup-service.ts:95` | 0 | unique |
| `getRetentionDays` | function | `src/server/services/db-backup-service.ts:99` | 0 | unique |
| `getOfftowerTarget` | function | `src/server/services/db-backup-service.ts:106` | 0 | unique |
| `getBackupBucket` | function | `src/server/services/db-backup-service.ts:119` | 0 | unique |
| `checkPgDumpAvailable` | function | `src/server/services/db-backup-service.ts:125` | 1 | AMBIG |
| `buildDumpFilename` | function | `src/server/services/db-backup-service.ts:143` | 0 | unique |
| `runPgDump` | function | `src/server/services/db-backup-service.ts:155` | 0 | unique |
| `pushToS3` | function | `src/server/services/db-backup-service.ts:186` | 0 | unique |
| `pruneOldLocalDumps` | function | `src/server/services/db-backup-service.ts:225` | 0 | unique |
| `isOfftowerConfigured` | function | `src/server/services/db-backup-service.ts:267` | 0 | unique |
| `DbBackupResult` | interface | `src/server/services/db-backup-service.ts:279` | 0 | unique |
| `runDbBackup` | function | `src/server/services/db-backup-service.ts:299` | 1 | unique |
| `getDDVelocityConfig` | function | `src/server/services/dd-velocity-gate.ts:65` | 0 | unique |
| `DDVelocityConfig` | interface | `src/server/services/dd-velocity-gate.ts:74` | 0 | unique |
| `DDVelocityCheckResult` | interface | `src/server/services/dd-velocity-gate.ts:107` | 0 | unique |
| `recordEquityAndCheck` | function | `src/server/services/dd-velocity-gate.ts:133` | 0 | unique |
| `batchCheckActiveSessions` | function | `src/server/services/dd-velocity-gate.ts:256` | 1 | unique |
| `VacationAutoRecoveryOptions` | interface | `src/server/services/dd-velocity-gate.ts:508` | 0 | unique |
| `checkVacationAutoRecovery` | function | `src/server/services/dd-velocity-gate.ts:523` | 1 | unique |
| `writeHeartbeat` | function | `src/server/services/dead-mans-heartbeat-service.ts:282` | 1 | unique |
| `getLastHeartbeatAt` | function | `src/server/services/dead-mans-heartbeat-service.ts:327` | 1 | unique |
| `runHeartbeatStaleCheck` | function | `src/server/services/dead-mans-heartbeat-service.ts:408` | 1 | unique |
| `runOffRthHeartbeatCheck` | function | `src/server/services/dead-mans-heartbeat-service.ts:542` | 1 | unique |
| `runScheduledRefreshStalenessCheck` | function | `src/server/services/dead-mans-heartbeat-service.ts:930` | 1 | unique |
| `getLastOperatorActivityAt` | function | `src/server/services/dead-mans-heartbeat-service.ts:1057` | 0 | unique |
| `runOperatorAbsenceAutoDetect` | function | `src/server/services/dead-mans-heartbeat-service.ts:1110` | 1 | unique |
| `clearOperatorAbsenceMarkers` | function | `src/server/services/dead-mans-heartbeat-service.ts:1232` | 3 | unique |
| `DeepARDeferredResponse` | interface | `src/server/services/deepar-service.ts:84` | 0 | unique |
| `isDeepARDeferred` | function | `src/server/services/deepar-service.ts:93` | 2 | unique |
| `DeepARRuntimeStatus` | interface | `src/server/services/deepar-service.ts:108` | 0 | unique |
| `inferPredictedRegime` | function | `src/server/services/deepar-service.ts:259` | 0 | unique |
| `inferRealizedRegimeFromBars` | function | `src/server/services/deepar-service.ts:323` | 0 | unique |
| `calculateRollingHitRate` | function | `src/server/services/deepar-service.ts:376` | 0 | unique |
| `trainDeepAR` | function | `src/server/services/deepar-service.ts:408` | 2 | unique |
| `predictRegime` | function | `src/server/services/deepar-service.ts:560` | 2 | unique |
| `validatePastForecasts` | function | `src/server/services/deepar-service.ts:673` | 1 | unique |
| `getLatestForecast` | function | `src/server/services/deepar-service.ts:845` | 2 | unique |
| `getDeepARWeight` | function | `src/server/services/deepar-service.ts:866` | 4 | unique |
| `getDeepARRuntimeStatus` | function | `src/server/services/deepar-service.ts:881` | 2 | unique |
| `StarvationCheckResult` | interface | `src/server/services/deployed-strategy-starvation-watchdog.ts:46` | 0 | unique |
| `StarvationRunResult` | interface | `src/server/services/deployed-strategy-starvation-watchdog.ts:56` | 0 | unique |
| `runDeployedStrategyStarvationCheck` | function | `src/server/services/deployed-strategy-starvation-watchdog.ts:127` | 1 | unique |
| `StarvationStatus` | interface | `src/server/services/deployed-strategy-starvation-watchdog.ts:353` | 0 | unique |
| `getStarvationStatus` | function | `src/server/services/deployed-strategy-starvation-watchdog.ts:368` | 1 | unique |
| `__test__` | const | `src/server/services/deployed-strategy-starvation-watchdog.ts:439` | 4 | AMBIG |
| `BidirectionalAuditResult` | interface | `src/server/services/direct-bucket-graduator.ts:320` | 0 | unique |
| `auditBidirectionalCompleteness` | function | `src/server/services/direct-bucket-graduator.ts:325` | 2 | unique |
| `FactorSourceLabel` | type | `src/server/services/direct-bucket-graduator.ts:371` | 1 | unique |
| `EntryQualityWithSources` | interface | `src/server/services/direct-bucket-graduator.ts:373` | 0 | unique |
| `classifyFactorSources` | function | `src/server/services/direct-bucket-graduator.ts:409` | 3 | unique |
| `DirectGraduationResult` | interface | `src/server/services/direct-bucket-graduator.ts:488` | 0 | unique |
| `deriveEntryIndicator` | function | `src/server/services/direct-bucket-graduator.ts:595` | 1 | unique |
| `deriveEntryType` | function | `src/server/services/direct-bucket-graduator.ts:1083` | 1 | unique |
| `graduateBucketDirectly` | function | `src/server/services/direct-bucket-graduator.ts:1275` | 2 | unique |
| `DiscordWebhookHealth` | type | `src/server/services/discord-fanout-audit-service.ts:21` | 1 | unique |
| `runDiscordFanoutAudit` | function | `src/server/services/discord-fanout-audit-service.ts:46` | 3 | unique |
| `getDiscordWebhookHealth` | function | `src/server/services/discord-fanout-audit-service.ts:122` | 1 | unique |
| `DriftReport` | interface | `src/server/services/drift-detection-service.ts:12` | 2 | AMBIG |
| `detectDrift` | function | `src/server/services/drift-detection-service.ts:32` | 2 | unique |
| `cascadeRevalidation` | function | `src/server/services/drift-detection-service.ts:220` | 1 | unique |
| `DSL_SIMILARITY_THRESHOLD` | const | `src/server/services/dsl-diversity-service.ts:64` | 0 | unique |
| `DslRecord` | type | `src/server/services/dsl-diversity-service.ts:129` | 0 | unique |
| `extractDslFeatureVector` | function | `src/server/services/dsl-diversity-service.ts:137` | 0 | unique |
| `computeDslFingerprint` | function | `src/server/services/dsl-diversity-service.ts:215` | 0 | unique |
| `compressFeatureVector` | function | `src/server/services/dsl-diversity-service.ts:237` | 0 | unique |
| `decompressFeatureVector` | function | `src/server/services/dsl-diversity-service.ts:248` | 0 | unique |
| `cosineSimilarity` | function | `src/server/services/dsl-diversity-service.ts:263` | 2 | AMBIG |
| `DslDiversityCheckResult` | interface | `src/server/services/dsl-diversity-service.ts:283` | 1 | unique |
| `checkDslDiversity` | function | `src/server/services/dsl-diversity-service.ts:316` | 1 | unique |
| `persistDslFeatureVector` | function | `src/server/services/dsl-diversity-service.ts:483` | 1 | unique |
| `auditDslDiversityRejection` | function | `src/server/services/dsl-diversity-service.ts:529` | 1 | unique |
| `getDslDiversityReport` | function | `src/server/services/dsl-diversity-service.ts:596` | 1 | unique |
| `ENTRY_PATTERN_ALLOWLIST` | const | `src/server/services/dsl-sanitizer.ts:39` | 0 | unique |
| `SanitizeResult` | interface | `src/server/services/dsl-sanitizer.ts:58` | 1 | AMBIG |
| `sanitizeEntryParams` | function | `src/server/services/dsl-sanitizer.ts:82` | 0 | unique |
| `sanitizeDsl` | function | `src/server/services/dsl-sanitizer.ts:166` | 1 | unique |
| `isDSLStrategy` | function | `src/server/services/dsl-translator.ts:104` | 1 | unique |
| `isLegacyStrategy` | function | `src/server/services/dsl-translator.ts:112` | 1 | unique |
| `translateDSLToPaperConfig` | function | `src/server/services/dsl-translator.ts:116` | 1 | unique |
| `FOMC_ANNOUNCE_DATES` | const | `src/server/services/economic-calendar-sync-service.ts:43` | 0 | unique |
| `addDays` | function | `src/server/services/economic-calendar-sync-service.ts:72` | 0 | unique |
| `runEconomicCalendarSync` | function | `src/server/services/economic-calendar-sync-service.ts:110` | 1 | unique |
| `resolveLineageRootByWalking` | function | `src/server/services/evolution-service.ts:55` | 0 | unique |
| `evolveStrategy` | function | `src/server/services/evolution-service.ts:91` | 2 | unique |
| `ExaDiscoveredStrategy` | interface | `src/server/services/exa-broker.ts:23` | 0 | unique |
| `runExaDiscovery` | function | `src/server/services/exa-broker.ts:117` | 1 | unique |
| `registerOutageChangeCallback` | function | `src/server/services/exchange-status-service.ts:52` | 1 | unique |
| `BrokerConnectivityResult` | interface | `src/server/services/exchange-status-service.ts:67` | 0 | unique |
| `ExchangeStatusResult` | interface | `src/server/services/exchange-status-service.ts:122` | 0 | unique |
| `checkCmeStatus` | function | `src/server/services/exchange-status-service.ts:134` | 0 | unique |
| `pollCmeStatus` | function | `src/server/services/exchange-status-service.ts:197` | 1 | unique |
| `isExchangeHalted` | function | `src/server/services/exchange-status-service.ts:334` | 2 | unique |
| `reconcileOutageState` | function | `src/server/services/exchange-status-service.ts:458` | 1 | unique |
| `_silenceAlertedFor` | const | `src/server/services/feed-silence-service.ts:108` | 0 | unique |
| `_silenceEmergencyClosedFor` | const | `src/server/services/feed-silence-service.ts:109` | 0 | unique |
| `timeframeToMs` | function | `src/server/services/feed-silence-service.ts:146` | 0 | unique |
| `isEtRth` | function | `src/server/services/feed-silence-service.ts:184` | 1 | unique |
| `StrategyFeedStatus` | interface | `src/server/services/feed-silence-service.ts:207` | 0 | unique |
| `FeedSilenceRunResult` | interface | `src/server/services/feed-silence-service.ts:220` | 0 | unique |
| `runFeedSilenceCheck` | function | `src/server/services/feed-silence-service.ts:633` | 1 | unique |
| `__test__` | const | `src/server/services/feed-silence-service.ts:726` | 4 | AMBIG |
| `DRIFT_TOLERANCE_CONTRACTS` | const | `src/server/services/fill-reconciliation-service.ts:70` | 0 | unique |
| `DRIFT_TOLERANCE_PRICE_POINTS` | const | `src/server/services/fill-reconciliation-service.ts:78` | 0 | unique |
| `OrderStatus` | type | `src/server/services/fill-reconciliation-service.ts:84` | 0 | unique |
| `FillEvent` | interface | `src/server/services/fill-reconciliation-service.ts:104` | 1 | unique |
| `BrokerFillSource` | interface | `src/server/services/fill-reconciliation-service.ts:154` | 0 | unique |
| `TradersPostFillSource` | class | `src/server/services/fill-reconciliation-service.ts:177` | 0 | unique |
| `TopstepXFillSource` | class | `src/server/services/fill-reconciliation-service.ts:222` | 0 | unique |
| `FILL_SOURCES` | const | `src/server/services/fill-reconciliation-service.ts:238` | 1 | unique |
| `FillIngestResult` | type | `src/server/services/fill-reconciliation-service.ts:245` | 0 | unique |
| `DriftCheckResult` | interface | `src/server/services/fill-reconciliation-service.ts:253` | 2 | AMBIG |
| `persistOrderAtRouted` | function | `src/server/services/fill-reconciliation-service.ts:299` | 1 | unique |
| `updateOrderToAcked` | function | `src/server/services/fill-reconciliation-service.ts:363` | 1 | unique |
| `updateOrderToNeedsReconcile` | function | `src/server/services/fill-reconciliation-service.ts:406` | 1 | unique |
| `ingestFillEvent` | function | `src/server/services/fill-reconciliation-service.ts:539` | 1 | unique |
| `checkPositionDrift` | function | `src/server/services/fill-reconciliation-service.ts:832` | 0 | unique |
| `isAccountBlockedForReconcile` | function | `src/server/services/fill-reconciliation-service.ts:996` | 1 | unique |
| `clearAccountReconcileBlock` | function | `src/server/services/fill-reconciliation-service.ts:1056` | 1 | unique |
| `getBrokerPositionSnapshot` | function | `src/server/services/fill-reconciliation-service.ts:1128` | 0 | unique |
| `DriftSweepResult` | interface | `src/server/services/fill-reconciliation-service.ts:1162` | 0 | unique |
| `runPositionDriftReconciliation` | function | `src/server/services/fill-reconciliation-service.ts:1191` | 1 | unique |
| `UpsertPriorInput` | interface | `src/server/services/firm-adversarial-event-service.ts:109` | 0 | unique |
| `getCurrentPriors` | function | `src/server/services/firm-adversarial-event-service.ts:127` | 2 | unique |
| `upsertPrior` | function | `src/server/services/firm-adversarial-event-service.ts:234` | 1 | unique |
| `refitPriorsForAllFirms` | function | `src/server/services/firm-priors-fitter.ts:62` | 1 | unique |
| `StrategySource` | type | `src/server/services/framework-overlay.ts:33` | 2 | unique |
| `applyFrameworkOverlay` | function | `src/server/services/framework-overlay.ts:220` | 6 | unique |
| `FrankensteinPythonResult` | interface | `src/server/services/frankenstein-service.ts:38` | 0 | unique |
| `FrankensteinRunOutput` | interface | `src/server/services/frankenstein-service.ts:52` | 0 | unique |
| `runFrankensteinTest` | function | `src/server/services/frankenstein-service.ts:204` | 1 | unique |
| `getLatestFrankensteinRun` | function | `src/server/services/frankenstein-service.ts:403` | 2 | unique |
| `computeFunnelMetrics` | function | `src/server/services/funnel-metrics-service.ts:14` | 1 | unique |
| `recordFunnelSnapshot` | function | `src/server/services/funnel-metrics-service.ts:63` | 1 | unique |
| `DefectCode` | type | `src/server/services/graduated-strategy-auditor.ts:33` | 0 | unique |
| `WarningCode` | type | `src/server/services/graduated-strategy-auditor.ts:47` | 0 | unique |
| `AuditFinding` | interface | `src/server/services/graduated-strategy-auditor.ts:62` | 0 | unique |
| `AuditResult` | interface | `src/server/services/graduated-strategy-auditor.ts:67` | 1 | AMBIG |
| `AuditInput` | interface | `src/server/services/graduated-strategy-auditor.ts:115` | 1 | AMBIG |
| `auditGraduatedConfig` | function | `src/server/services/graduated-strategy-auditor.ts:124` | 6 | unique |
| `formatAuditResult` | function | `src/server/services/graduated-strategy-auditor.ts:322` | 5 | unique |
| `GraveyardCheckResult` | interface | `src/server/services/graveyard-gate.ts:41` | 0 | unique |
| `RelevantFailure` | interface | `src/server/services/graveyard-gate.ts:57` | 0 | unique |
| `GraveyardGate` | class | `src/server/services/graveyard-gate.ts:66` | 2 | unique |
| `extractFailurePatterns` | function | `src/server/services/graveyard-intelligence-service.ts:24` | 1 | unique |
| `generateFailureModeReport` | function | `src/server/services/graveyard-intelligence-service.ts:169` | 1 | unique |
| `PhaseValue` | type | `src/server/services/harsh-regime-phase-service.ts:29` | 1 | unique |
| `HarshRegimePhaseRecord` | interface | `src/server/services/harsh-regime-phase-service.ts:31` | 0 | unique |
| `PhaseFlipResult` | interface | `src/server/services/harsh-regime-phase-service.ts:39` | 0 | unique |
| `getPhase` | function | `src/server/services/harsh-regime-phase-service.ts:52` | 1 | unique |
| `getPhaseRecord` | function | `src/server/services/harsh-regime-phase-service.ts:82` | 1 | unique |
| `flipPhaseToHard` | function | `src/server/services/harsh-regime-phase-service.ts:115` | 1 | unique |
| `setPhaseOverride` | function | `src/server/services/harsh-regime-phase-service.ts:202` | 1 | unique |
| `LeakCategory` | type | `src/server/services/leak-detection-service.ts:102` | 0 | unique |
| `LeakFinding` | interface | `src/server/services/leak-detection-service.ts:110` | 0 | unique |
| `LeakDetectionResult` | interface | `src/server/services/leak-detection-service.ts:125` | 0 | unique |
| `runLeakDetection` | function | `src/server/services/leak-detection-service.ts:169` | 1 | unique |
| `School` | type | `src/server/services/library-diversity-service.ts:23` | 0 | unique |
| `LifecycleStage` | type | `src/server/services/library-diversity-service.ts:33` | 0 | unique |
| `LibraryDiversity` | interface | `src/server/services/library-diversity-service.ts:44` | 0 | unique |
| `computeLibraryDiversity` | function | `src/server/services/library-diversity-service.ts:199` | 1 | unique |
| `classifySchool` | export-binding | `src/server/services/library-diversity-service.ts:250` | 0 | unique |
| `passingFirmNamesFromCompliance` | function | `src/server/services/lifecycle-service.ts:364` | 1 | unique |
| `findFirmsWithComplianceDrift` | function | `src/server/services/lifecycle-service.ts:395` | 1 | unique |
| `resolveComplianceDriftForPromotion` | function | `src/server/services/lifecycle-service.ts:428` | 0 | unique |
| `runComplianceGateForFirms` | function | `src/server/services/lifecycle-service.ts:456` | 1 | unique |
| `EVIDENCE_AUTO_BACKTEST_ENQUEUED_ACTION` | const | `src/server/services/lifecycle-service.ts:561` | 0 | unique |
| `EVIDENCE_AUTO_BACKTEST_REFUSED_ACTION` | const | `src/server/services/lifecycle-service.ts:562` | 0 | unique |
| `LifecycleService` | class | `src/server/services/lifecycle-service.ts:564` | 14 | unique |
| `LevelType` | type | `src/server/services/liquidity-map-service.ts:42` | 2 | unique |
| `RankedLevel` | interface | `src/server/services/liquidity-map-service.ts:73` | 2 | unique |
| `LiquidityMapDAL` | interface | `src/server/services/liquidity-map-service.ts:87` | 1 | unique |
| `UpsertLevelInput` | interface | `src/server/services/liquidity-map-service.ts:96` | 0 | unique |
| `ActiveLevelRow` | interface | `src/server/services/liquidity-map-service.ts:106` | 1 | unique |
| `PreMarketRow` | interface | `src/server/services/liquidity-map-service.ts:119` | 0 | unique |
| `computeSweepProbability` | function | `src/server/services/liquidity-map-service.ts:149` | 1 | unique |
| `computeRankScore` | function | `src/server/services/liquidity-map-service.ts:169` | 0 | unique |
| `makeProductionDAL` | function | `src/server/services/liquidity-map-service.ts:229` | 0 | unique |
| `refreshSessionLevels` | function | `src/server/services/liquidity-map-service.ts:374` | 1 | unique |
| `getNearestLiquidity` | function | `src/server/services/liquidity-map-service.ts:501` | 3 | unique |
| `SanitizeOptions` | interface | `src/server/services/llm-input-sanitizer.ts:273` | 0 | unique |
| `SanitizeResult` | interface | `src/server/services/llm-input-sanitizer.ts:279` | 1 | AMBIG |
| `sanitizeExternalContent` | function | `src/server/services/llm-input-sanitizer.ts:301` | 1 | unique |
| `sanitizeBatch` | function | `src/server/services/llm-input-sanitizer.ts:385` | 1 | unique |
| `ValidateOutputResult` | interface | `src/server/services/llm-output-validator.ts:86` | 0 | unique |
| `validateRawLLMResponse` | function | `src/server/services/llm-output-validator.ts:98` | 1 | unique |
| `validateDSLOutput` | function | `src/server/services/llm-output-validator.ts:123` | 1 | unique |
| `SandboxResult` | interface | `src/server/services/llm-sandbox-service.ts:173` | 0 | unique |
| `astScanCode` | function | `src/server/services/llm-sandbox-service.ts:187` | 0 | unique |
| `sandboxCheckCode` | function | `src/server/services/llm-sandbox-service.ts:258` | 1 | unique |
| `MacroGateResult` | interface | `src/server/services/macro-gate-service.ts:38` | 0 | unique |
| `evaluateMacroGates` | function | `src/server/services/macro-gate-service.ts:133` | 3 | unique |
| `MacroRegimeState` | interface | `src/server/services/macro-regime-service.ts:35` | 0 | unique |
| `getLatestMacroRegimeState` | function | `src/server/services/macro-regime-service.ts:57` | 3 | unique |
| `invalidateMacroRegimeCache` | function | `src/server/services/macro-regime-service.ts:100` | 1 | unique |
| `runFredDailyIngestion` | function | `src/server/services/macro-regime-service.ts:113` | 2 | unique |
| `runH41Ingestion` | function | `src/server/services/macro-regime-service.ts:190` | 2 | unique |
| `runBlsIngestion` | function | `src/server/services/macro-regime-service.ts:250` | 1 | unique |
| `runTreasuryAuctionIngestion` | function | `src/server/services/macro-regime-service.ts:309` | 1 | unique |
| `runMacroRegimeClassification` | function | `src/server/services/macro-regime-service.ts:372` | 2 | unique |
| `getMacroSeriesHistory` | function | `src/server/services/macro-regime-service.ts:566` | 1 | unique |
| `InternalsSnapshot` | interface | `src/server/services/market-internals-service.ts:72` | 0 | unique |
| `recordInternalsBar` | function | `src/server/services/market-internals-service.ts:102` | 0 | unique |
| `getInternalsSnapshot` | function | `src/server/services/market-internals-service.ts:113` | 2 | unique |
| `runMatrix` | function | `src/server/services/matrix-backtest-service.ts:265` | 3 | unique |
| `getMatrixStatus` | function | `src/server/services/matrix-backtest-service.ts:571` | 1 | unique |
| `TighteningDecision` | interface | `src/server/services/mcl-pre-eia-stop-tighten-service.ts:73` | 0 | unique |
| `computeMclTighteningDecision` | function | `src/server/services/mcl-pre-eia-stop-tighten-service.ts:82` | 0 | unique |
| `PreEiaTightenSummary` | interface | `src/server/services/mcl-pre-eia-stop-tighten-service.ts:154` | 0 | unique |
| `runMclPreEiaStopTighten` | function | `src/server/services/mcl-pre-eia-stop-tighten-service.ts:162` | 1 | unique |
| `runMetaParameterReview` | function | `src/server/services/meta-optimizer-service.ts:298` | 1 | unique |
| `TradeRecord` | interface | `src/server/services/metrics-aggregator.ts:16` | 1 | AMBIG |
| `SessionMetrics` | interface | `src/server/services/metrics-aggregator.ts:21` | 0 | unique |
| `metricsAggregator` | const | `src/server/services/metrics-aggregator.ts:233` | 4 | unique |
| `setChunkedNumCtxOverride` | function | `src/server/services/model-router.ts:187` | 1 | unique |
| `checkTranscriptExtractorOllamaHealth` | function | `src/server/services/model-router.ts:239` | 2 | unique |
| `recheckOllamaHealth` | function | `src/server/services/model-router.ts:311` | 2 | unique |
| `ModelConfig` | interface | `src/server/services/model-router.ts:422` | 0 | unique |
| `ModelRole` | type | `src/server/services/model-router.ts:454` | 1 | AMBIG |
| `setAppendixCache` | function | `src/server/services/model-router.ts:841` | 2 | unique |
| `warmAppendixCache` | function | `src/server/services/model-router.ts:873` | 1 | unique |
| `PromptTaskContext` | interface | `src/server/services/model-router.ts:905` | 0 | unique |
| `loadSystemPrompt` | function | `src/server/services/model-router.ts:1152` | 5 | unique |
| `getFallback` | function | `src/server/services/model-router.ts:1179` | 4 | unique |
| `ParsedLLMResponse` | interface | `src/server/services/model-router.ts:1205` | 0 | unique |
| `isResponsesApiEnabled` | function | `src/server/services/model-router.ts:1227` | 0 | unique |
| `parseChatCompletionsResponse` | function | `src/server/services/model-router.ts:1236` | 0 | unique |
| `parseResponsesApiResponse` | function | `src/server/services/model-router.ts:1266` | 0 | unique |
| `loadStrictSchemaForRole` | function | `src/server/services/model-router.ts:1320` | 0 | unique |
| `getOpenAIProxyBearer` | function | `src/server/services/model-router.ts:1640` | 0 | unique |
| `callOpenAI` | function | `src/server/services/model-router.ts:1786` | 7 | unique |
| `callOpenAIOrFallback` | function | `src/server/services/model-router.ts:1913` | 3 | unique |
| `LlmRetryReason` | type | `src/server/services/model-router.ts:2028` | 0 | unique |
| `ScoutExtractRetryResult` | interface | `src/server/services/model-router.ts:2036` | 0 | unique |
| `classifyLlmError` | function | `src/server/services/model-router.ts:2049` | 0 | unique |
| `withScoutExtractRetry` | function | `src/server/services/model-router.ts:2102` | 0 | unique |
| `TranscriptExtractorAuditResult` | interface | `src/server/services/model-router.ts:2254` | 0 | unique |
| `buildGemmaFewShotMessages` | function | `src/server/services/model-router.ts:2373` | 0 | unique |
| `callScoutExtractLlm` | function | `src/server/services/model-router.ts:2952` | 10 | unique |
| `MODEL_CONFIGS` | export-binding | `src/server/services/model-router.ts:3162` | 0 | unique |
| `KB_MANIFEST` | export-binding | `src/server/services/model-router.ts:3162` | 0 | unique |
| `FEWSHOT_ROLES` | export-binding | `src/server/services/model-router.ts:3162` | 0 | unique |
| `runMonteCarlo` | function | `src/server/services/monte-carlo-service.ts:68` | 4 | unique |
| `FirmEligibilityResult` | interface | `src/server/services/multi-firm-promotion-service.ts:51` | 0 | unique |
| `ComplianceCheckResult` | interface | `src/server/services/multi-firm-promotion-service.ts:58` | 0 | unique |
| `MultiFirmEligibilityOutput` | interface | `src/server/services/multi-firm-promotion-service.ts:66` | 0 | unique |
| `evaluateMultiFirmEligibility` | function | `src/server/services/multi-firm-promotion-service.ts:288` | 1 | unique |
| `runN8nExecutionScrape` | function | `src/server/services/n8n-execution-scraper-service.ts:79` | 1 | unique |
| `NarrativePhase` | type | `src/server/services/narrative-state-service.ts:47` | 0 | unique |
| `NarrativeState` | interface | `src/server/services/narrative-state-service.ts:54` | 1 | unique |
| `computeNarrativeState` | function | `src/server/services/narrative-state-service.ts:106` | 1 | unique |
| `persistNarrativeState` | function | `src/server/services/narrative-state-service.ts:359` | 1 | unique |
| `loadLatestNarrativeState` | function | `src/server/services/narrative-state-service.ts:471` | 1 | unique |
| `NeMoScenarioJson` | interface | `src/server/services/nemo-scenario-service.ts:51` | 0 | unique |
| `NeMoBatchResult` | interface | `src/server/services/nemo-scenario-service.ts:76` | 0 | unique |
| `generateNeMoBatch` | function | `src/server/services/nemo-scenario-service.ts:95` | 1 | unique |
| `getRecentNeMoScenarios` | function | `src/server/services/nemo-scenario-service.ts:309` | 1 | unique |
| `runNightlyCritique` | function | `src/server/services/nightly-critique-service.ts:59` | 1 | unique |
| `NotificationSeverity` | type | `src/server/services/notification-service.ts:28` | 0 | unique |
| `NotifyOptions` | interface | `src/server/services/notification-service.ts:30` | 0 | unique |
| `notify` | function | `src/server/services/notification-service.ts:295` | 5 | unique |
| `notifyCritical` | function | `src/server/services/notification-service.ts:334` | 35 | unique |
| `notifyWarning` | function | `src/server/services/notification-service.ts:341` | 41 | unique |
| `notifyInfo` | function | `src/server/services/notification-service.ts:348` | 12 | unique |
| `_resetForTests` | function | `src/server/services/notification-service.ts:388` | 4 | AMBIG |
| `OiFilterResult` | interface | `src/server/services/oi-liquidity-filter.ts:27` | 0 | unique |
| `checkOiLiquidity` | function | `src/server/services/oi-liquidity-filter.ts:54` | 1 | unique |
| `GenerateResponse` | interface | `src/server/services/ollama-client.ts:1` | 0 | unique |
| `ChatMessage` | interface | `src/server/services/ollama-client.ts:6` | 1 | unique |
| `ChatResponse` | interface | `src/server/services/ollama-client.ts:11` | 0 | unique |
| `OllamaOptions` | interface | `src/server/services/ollama-client.ts:16` | 0 | unique |
| `EmbedResponse` | interface | `src/server/services/ollama-client.ts:23` | 0 | unique |
| `ModelRole` | type | `src/server/services/ollama-client.ts:54` | 1 | AMBIG |
| `OllamaClient` | class | `src/server/services/ollama-client.ts:58` | 11 | unique |
| `AuctionBias` | type | `src/server/services/opening-auction-service.ts:25` | 1 | unique |
| `AuctionImbalanceRecord` | interface | `src/server/services/opening-auction-service.ts:27` | 0 | unique |
| `AuctionPullResult` | interface | `src/server/services/opening-auction-service.ts:37` | 0 | unique |
| `invalidateAuctionBiasCache` | function | `src/server/services/opening-auction-service.ts:56` | 0 | unique |
| `getOpeningAuctionBias` | function | `src/server/services/opening-auction-service.ts:68` | 1 | AMBIG |
| `runAuctionImbalancePull` | function | `src/server/services/opening-auction-service.ts:140` | 1 | unique |
| `operatorAbsentModeActive` | function | `src/server/services/operator-absent-mode-service.ts:33` | 2 | unique |
| `checkAutopilotGates` | function | `src/server/services/operator-absent-mode-service.ts:67` | 0 | unique |
| `AutoPromoteResult` | interface | `src/server/services/operator-absent-mode-service.ts:146` | 0 | unique |
| `runOperatorAbsentAutoPromote` | function | `src/server/services/operator-absent-mode-service.ts:163` | 1 | unique |
| `CONTRACT_SPECS` | export-binding | `src/server/services/paper-execution-service.ts:54` | 11 | AMBIG |
| `clearKillSwitchCache` | function | `src/server/services/paper-execution-service.ts:217` | 1 | unique |
| `clearStuckSessionId` | function | `src/server/services/paper-execution-service.ts:238` | 1 | unique |
| `recoverOrphanedPositionsAtStartup` | function | `src/server/services/paper-execution-service.ts:258` | 1 | unique |
| `ExecutionResult` | interface | `src/server/services/paper-execution-service.ts:492` | 0 | unique |
| `toSlippageSession` | function | `src/server/services/paper-execution-service.ts:550` | 0 | unique |
| `computeFillProbabilityByVolume` | function | `src/server/services/paper-execution-service.ts:575` | 0 | unique |
| `PriceBarUpdate` | interface | `src/server/services/paper-execution-service.ts:624` | 1 | unique |
| `PositionPriceUpdate` | type | `src/server/services/paper-execution-service.ts:631` | 0 | unique |
| `classifySessionType` | function | `src/server/services/paper-execution-service.ts:663` | 0 | unique |
| `openPosition` | function | `src/server/services/paper-execution-service.ts:681` | 2 | unique |
| `closePosition` | function | `src/server/services/paper-execution-service.ts:2324` | 3 | unique |
| `StyleExitBarContext` | interface | `src/server/services/paper-execution-service.ts:3072` | 1 | unique |
| `updatePositionPrices` | function | `src/server/services/paper-execution-service.ts:4114` | 2 | unique |
| `getExecutionQuality` | function | `src/server/services/paper-execution-service.ts:4585` | 1 | unique |
| `getTcaReport` | function | `src/server/services/paper-execution-service.ts:4607` | 1 | unique |
| `getRollingMetrics` | function | `src/server/services/paper-execution-service.ts:4654` | 1 | unique |
| `RollCheckResult` | interface | `src/server/services/paper-execution-service.ts:4708` | 0 | unique |
| `checkRollAndFlatten` | function | `src/server/services/paper-execution-service.ts:4728` | 0 | unique |
| `runSessionEndRollSweep` | function | `src/server/services/paper-execution-service.ts:4969` | 1 | unique |
| `ForceCloseScope` | interface | `src/server/services/paper-execution-service.ts:5042` | 0 | unique |
| `forceCloseAllPositions` | function | `src/server/services/paper-execution-service.ts:5049` | 2 | unique |
| `toEasternDateString` | function | `src/server/services/paper-risk-gate.ts:53` | 2 | unique |
| `toFuturesTradingDayString` | function | `src/server/services/paper-risk-gate.ts:64` | 3 | unique |
| `invalidateDailyLossCache` | function | `src/server/services/paper-risk-gate.ts:124` | 1 | unique |
| `RiskGateResult` | interface | `src/server/services/paper-risk-gate.ts:139` | 0 | unique |
| `checkRiskGate` | function | `src/server/services/paper-risk-gate.ts:172` | 1 | unique |
| `SessionFeedback` | interface | `src/server/services/paper-session-feedback-service.ts:47` | 0 | unique |
| `computeSessionFeedback` | function | `src/server/services/paper-session-feedback-service.ts:73` | 0 | unique |
| `computeAndPersistSessionFeedback` | function | `src/server/services/paper-session-feedback-service.ts:329` | 2 | unique |
| `Bar` | interface | `src/server/services/paper-signal-service.ts:367` | 3 | AMBIG |
| `TrailStopConfig` | interface | `src/server/services/paper-signal-service.ts:398` | 0 | unique |
| `TICK_SIZES` | const | `src/server/services/paper-signal-service.ts:410` | 0 | unique |
| `TrailStopExtendedInput` | interface | `src/server/services/paper-signal-service.ts:421` | 0 | unique |
| `checkTrailStopExtended` | function | `src/server/services/paper-signal-service.ts:465` | 0 | unique |
| `updateGovernorOnTrade` | function | `src/server/services/paper-signal-service.ts:681` | 1 | unique |
| `restoreGovernorState` | function | `src/server/services/paper-signal-service.ts:808` | 1 | unique |
| `invalidateSessionCacheForStrategy` | function | `src/server/services/paper-signal-service.ts:973` | 1 | unique |
| `cleanupSession` | function | `src/server/services/paper-signal-service.ts:989` | 2 | unique |
| `SMA` | function | `src/server/services/paper-signal-service.ts:1010` | 2 | unique |
| `EMA` | function | `src/server/services/paper-signal-service.ts:1016` | 3 | unique |
| `RSI` | function | `src/server/services/paper-signal-service.ts:1027` | 3 | unique |
| `ATR` | function | `src/server/services/paper-signal-service.ts:1058` | 5 | unique |
| `VWAP` | function | `src/server/services/paper-signal-service.ts:1079` | 3 | unique |
| `filterToGlobexSession` | function | `src/server/services/paper-signal-service.ts:1111` | 0 | unique |
| `BollingerBands` | function | `src/server/services/paper-signal-service.ts:1121` | 0 | unique |
| `computeIndicators` | function | `src/server/services/paper-signal-service.ts:1153` | 0 | unique |
| `evaluateExpression` | function | `src/server/services/paper-signal-service.ts:1234` | 0 | unique |
| `checkStopLoss` | function | `src/server/services/paper-signal-service.ts:1542` | 0 | unique |
| `restorePositionState` | function | `src/server/services/paper-signal-service.ts:1716` | 1 | unique |
| `initializePositionStateMaps` | function | `src/server/services/paper-signal-service.ts:1748` | 1 | unique |
| `evaluateSignals` | function | `src/server/services/paper-signal-service.ts:1868` | 1 | unique |
| `updateStateOnly` | function | `src/server/services/paper-signal-service.ts:6123` | 1 | unique |
| `Bar` | interface | `src/server/services/paper-trading-stream.ts:16` | 3 | AMBIG |
| `toGlobexSessionDateString` | function | `src/server/services/paper-trading-stream.ts:147` | 0 | unique |
| `buildExitBarContext` | function | `src/server/services/paper-trading-stream.ts:200` | 0 | unique |
| `startStream` | function | `src/server/services/paper-trading-stream.ts:552` | 3 | unique |
| `stopStream` | function | `src/server/services/paper-trading-stream.ts:590` | 3 | unique |
| `stopAllStreams` | function | `src/server/services/paper-trading-stream.ts:624` | 2 | unique |
| `getActiveStreams` | function | `src/server/services/paper-trading-stream.ts:650` | 4 | unique |
| `isStreaming` | function | `src/server/services/paper-trading-stream.ts:669` | 2 | unique |
| `getBarBuffer` | function | `src/server/services/paper-trading-stream.ts:676` | 3 | unique |
| `getStreamHealth` | function | `src/server/services/paper-trading-stream.ts:691` | 1 | unique |
| `ParallelDiscoveredStrategy` | interface | `src/server/services/parallel-broker.ts:24` | 0 | unique |
| `runParallelDiscovery` | function | `src/server/services/parallel-broker.ts:317` | 1 | unique |
| `PatternAggregatorResult` | interface | `src/server/services/pattern-aggregator-service.ts:181` | 0 | unique |
| `runPatternAggregator` | function | `src/server/services/pattern-aggregator-service.ts:237` | 1 | unique |
| `PickerScoreComponents` | interface | `src/server/services/picker-metrics.ts:62` | 0 | unique |
| `StrategyNameRow` | interface | `src/server/services/picker-metrics.ts:79` | 0 | unique |
| `BacktestRow` | interface | `src/server/services/picker-metrics.ts:84` | 2 | AMBIG |
| `LatestBacktestIdRow` | interface | `src/server/services/picker-metrics.ts:90` | 0 | unique |
| `TradeRow` | interface | `src/server/services/picker-metrics.ts:95` | 0 | unique |
| `BiasStatePickRow` | interface | `src/server/services/picker-metrics.ts:100` | 0 | unique |
| `DiversificationPickRow` | interface | `src/server/services/picker-metrics.ts:105` | 0 | unique |
| `PickerDataAccessLayer` | interface | `src/server/services/picker-metrics.ts:111` | 0 | unique |
| `PickerMetricOpts` | interface | `src/server/services/picker-metrics.ts:120` | 0 | unique |
| `computePickerScores` | function | `src/server/services/picker-metrics.ts:385` | 1 | unique |
| `RecipientExportRequest` | interface | `src/server/services/pine-export-recipient-service.ts:54` | 0 | unique |
| `RecipientExportResult` | interface | `src/server/services/pine-export-recipient-service.ts:66` | 0 | unique |
| `generateRecipientExport` | function | `src/server/services/pine-export-recipient-service.ts:465` | 1 | unique |
| `GatewayOptions` | export-binding-type | `src/server/services/pine-export-service.ts:20` | 1 | AMBIG |
| `deriveGatewayOptions` | export-binding | `src/server/services/pine-export-service.ts:21` | 1 | AMBIG |
| `checkExportability` | function | `src/server/services/pine-export-service.ts:142` | 2 | unique |
| `compileDualPineExport` | function | `src/server/services/pine-export-service.ts:406` | 4 | unique |
| `compilePineExport` | function | `src/server/services/pine-export-service.ts:1010` | 5 | unique |
| `getExport` | function | `src/server/services/pine-export-service.ts:1361` | 1 | unique |
| `getExportArtifacts` | function | `src/server/services/pine-export-service.ts:1369` | 1 | unique |
| `getArtifact` | function | `src/server/services/pine-export-service.ts:1376` | 1 | unique |
| `PipelineMode` | type | `src/server/services/pipeline-control-service.ts:20` | 1 | unique |
| `N8nPipelineControlStatus` | type | `src/server/services/pipeline-control-service.ts:21` | 0 | unique |
| `getMode` | function | `src/server/services/pipeline-control-service.ts:77` | 11 | unique |
| `isActive` | function | `src/server/services/pipeline-control-service.ts:95` | 53 | unique |
| `setMode` | function | `src/server/services/pipeline-control-service.ts:123` | 8 | unique |
| `PORTFOLIO_DRIFT_SHARPE_FLOOR` | const | `src/server/services/portfolio-drift-demotion-service.ts:81` | 0 | unique |
| `isPortfolioDriftDemotionEnabled` | function | `src/server/services/portfolio-drift-demotion-service.ts:92` | 0 | unique |
| `PortfolioDriftStrategyResult` | interface | `src/server/services/portfolio-drift-demotion-service.ts:98` | 0 | unique |
| `PortfolioDriftDemotionResult` | interface | `src/server/services/portfolio-drift-demotion-service.ts:107` | 0 | unique |
| `runPortfolioDriftDemotion` | function | `src/server/services/portfolio-drift-demotion-service.ts:130` | 1 | unique |
| `pearsonCorrelation` | function | `src/server/services/portfolio-optimizer-service.ts:23` | 2 | unique |
| `CorrelationPair` | interface | `src/server/services/portfolio-optimizer-service.ts:119` | 0 | unique |
| `PortfolioSnapshot` | interface | `src/server/services/portfolio-optimizer-service.ts:129` | 0 | unique |
| `computeCorrelationSnapshot` | function | `src/server/services/portfolio-optimizer-service.ts:141` | 0 | unique |
| `runPortfolioCorrelationCheck` | function | `src/server/services/portfolio-optimizer-service.ts:246` | 1 | unique |
| `PreMarketSessionRow` | interface | `src/server/services/pre-market-briefing-service.ts:27` | 0 | unique |
| `BriefingDataAccessLayer` | interface | `src/server/services/pre-market-briefing-service.ts:54` | 0 | unique |
| `SendPreMarketBriefingResult` | interface | `src/server/services/pre-market-briefing-service.ts:75` | 0 | unique |
| `composeBriefingMarkdown` | function | `src/server/services/pre-market-briefing-service.ts:209` | 0 | unique |
| `__resetLiveDalForTests` | function | `src/server/services/pre-market-briefing-service.ts:333` | 1 | AMBIG |
| `sendPreMarketBriefing` | function | `src/server/services/pre-market-briefing-service.ts:352` | 1 | unique |
| `DailyBar` | interface | `src/server/services/pre-market-routine.ts:42` | 0 | unique |
| `IntraBar` | interface | `src/server/services/pre-market-routine.ts:51` | 0 | unique |
| `SkipDecisionRow` | interface | `src/server/services/pre-market-routine.ts:59` | 0 | unique |
| `UpsertPreMarketInput` | interface | `src/server/services/pre-market-routine.ts:66` | 0 | unique |
| `ExtendedCalendarEvent` | interface | `src/server/services/pre-market-routine.ts:104` | 0 | unique |
| `NakedPocLevel` | interface | `src/server/services/pre-market-routine.ts:111` | 0 | unique |
| `BlackoutWindow` | interface | `src/server/services/pre-market-routine.ts:118` | 1 | AMBIG |
| `PreMarketDataAccessLayer` | interface | `src/server/services/pre-market-routine.ts:125` | 0 | unique |
| `__resetLiveDalForTests` | function | `src/server/services/pre-market-routine.ts:398` | 1 | AMBIG |
| `computeAtrStats` | function | `src/server/services/pre-market-routine.ts:408` | 0 | unique |
| `computeIsoWeekPwhPwl` | function | `src/server/services/pre-market-routine.ts:484` | 0 | unique |
| `computePriorMonthHl` | function | `src/server/services/pre-market-routine.ts:532` | 0 | unique |
| `computeLondonRange` | function | `src/server/services/pre-market-routine.ts:565` | 0 | unique |
| `extractExtendedCalendarEvents` | function | `src/server/services/pre-market-routine.ts:613` | 0 | unique |
| `computeDirectionFromDailyBars` | function | `src/server/services/pre-market-routine.ts:643` | 0 | unique |
| `computeCrossAssetAligned` | function | `src/server/services/pre-market-routine.ts:671` | 0 | unique |
| `composeWrittenBias` | function | `src/server/services/pre-market-routine.ts:717` | 0 | unique |
| `PreMarketRoutineResult` | interface | `src/server/services/pre-market-routine.ts:745` | 0 | unique |
| `runPreMarketRoutine` | function | `src/server/services/pre-market-routine.ts:761` | 1 | unique |
| `getActivePromptContent` | function | `src/server/services/prompt-evolution-service.ts:115` | 0 | unique |
| `resolveAbTests` | function | `src/server/services/prompt-evolution-service.ts:380` | 1 | unique |
| `getActiveVersionIdForGeneration` | function | `src/server/services/prompt-evolution-service.ts:814` | 1 | unique |
| `loadCookiesFromRuntimeFiles` | function | `src/server/services/prop-firm-cookie-refresh-service.ts:115` | 0 | unique |
| `CookieStatus` | type | `src/server/services/prop-firm-cookie-refresh-service.ts:200` | 0 | unique |
| `getCookieStatus` | function | `src/server/services/prop-firm-cookie-refresh-service.ts:210` | 1 | unique |
| `getCookieLastRefreshedAt` | function | `src/server/services/prop-firm-cookie-refresh-service.ts:214` | 1 | unique |
| `FirmRefreshResult` | interface | `src/server/services/prop-firm-cookie-refresh-service.ts:220` | 0 | unique |
| `CookieRefreshReport` | interface | `src/server/services/prop-firm-cookie-refresh-service.ts:444` | 0 | unique |
| `runPropFirmCookieRefresh` | function | `src/server/services/prop-firm-cookie-refresh-service.ts:455` | 1 | unique |
| `registerSuspensionChangeCallback` | function | `src/server/services/prop-firm-health-service.ts:41` | 1 | unique |
| `FirmHealthResult` | interface | `src/server/services/prop-firm-health-service.ts:133` | 0 | unique |
| `pollPropFirmHealth` | function | `src/server/services/prop-firm-health-service.ts:202` | 1 | unique |
| `isFirmSuspended` | function | `src/server/services/prop-firm-health-service.ts:313` | 2 | unique |
| `reconcileSuspensionState` | function | `src/server/services/prop-firm-health-service.ts:328` | 1 | unique |
| `AdversarialPriors` | interface | `src/server/services/prop-firm-survival-service.ts:47` | 1 | unique |
| `StrategyProfile` | interface | `src/server/services/prop-firm-survival-service.ts:65` | 1 | unique |
| `SurvivalCurve` | interface | `src/server/services/prop-firm-survival-service.ts:77` | 1 | unique |
| `SURVIVAL_MODULATORS` | const | `src/server/services/prop-firm-survival-service.ts:90` | 0 | unique |
| `applyModulators` | function | `src/server/services/prop-firm-survival-service.ts:151` | 0 | unique |
| `SimulateOptions` | interface | `src/server/services/prop-firm-survival-service.ts:353` | 0 | unique |
| `simulateSurvivalCurve` | function | `src/server/services/prop-firm-survival-service.ts:372` | 1 | unique |
| `deriveStrategyProfile` | function | `src/server/services/prop-firm-survival-service.ts:548` | 1 | unique |
| `QuantumRuntimeStatus` | interface | `src/server/services/quantum-mc-service.ts:43` | 0 | unique |
| `runQuantumMC` | function | `src/server/services/quantum-mc-service.ts:117` | 4 | unique |
| `runHybridCompare` | function | `src/server/services/quantum-mc-service.ts:458` | 1 | unique |
| `getQuantumRun` | function | `src/server/services/quantum-mc-service.ts:537` | 1 | unique |
| `getBenchmark` | function | `src/server/services/quantum-mc-service.ts:542` | 1 | unique |
| `getQuantumRuntimeStatus` | function | `src/server/services/quantum-mc-service.ts:547` | 1 | unique |
| `WeeklyVerdict` | type | `src/server/services/quantum-replay-weekly-service.ts:33` | 0 | unique |
| `WeeklyAnalysisStatus` | type | `src/server/services/quantum-replay-weekly-service.ts:35` | 0 | unique |
| `WeeklyAnalysisResult` | interface | `src/server/services/quantum-replay-weekly-service.ts:42` | 0 | unique |
| `parseScriptOutput` | function | `src/server/services/quantum-replay-weekly-service.ts:154` | 0 | unique |
| `runQuantumReplayWeeklyAnalysis` | function | `src/server/services/quantum-replay-weekly-service.ts:293` | 1 | unique |
| `RedditEnrichmentResult` | interface | `src/server/services/reddit-cross-extract.ts:23` | 0 | unique |
| `RedditEnrichmentOpts` | interface | `src/server/services/reddit-cross-extract.ts:32` | 0 | unique |
| `fetchRedditEnrichment` | function | `src/server/services/reddit-cross-extract.ts:49` | 2 | unique |
| `DEPLOYED_REGIME_LIST` | const | `src/server/services/regime-coverage-monitor-service.ts:34` | 0 | unique |
| `RegimeCoverageEntry` | interface | `src/server/services/regime-coverage-monitor-service.ts:48` | 0 | unique |
| `RegimeCoverageMap` | type | `src/server/services/regime-coverage-monitor-service.ts:53` | 0 | unique |
| `RegimeCoverageResult` | interface | `src/server/services/regime-coverage-monitor-service.ts:55` | 0 | unique |
| `computeRegimeCoverage` | function | `src/server/services/regime-coverage-monitor-service.ts:94` | 0 | unique |
| `evaluateCoverageGaps` | function | `src/server/services/regime-coverage-monitor-service.ts:152` | 0 | unique |
| `runRegimeCoverageCheck` | function | `src/server/services/regime-coverage-monitor-service.ts:160` | 1 | unique |
| `RegimeCoverageStatus` | interface | `src/server/services/regime-coverage-monitor-service.ts:244` | 0 | unique |
| `getRegimeCoverageStatus` | function | `src/server/services/regime-coverage-monitor-service.ts:255` | 1 | unique |
| `__test__` | const | `src/server/services/regime-coverage-monitor-service.ts:272` | 4 | AMBIG |
| `DRIFT_CONSECUTIVE_DAYS` | const | `src/server/services/regime-drift-detector-service.ts:44` | 0 | unique |
| `ZOMBIE_DECLINING_THRESHOLD_MS` | const | `src/server/services/regime-drift-detector-service.ts:51` | 0 | unique |
| `DriftDetectorStrategyResult` | interface | `src/server/services/regime-drift-detector-service.ts:61` | 0 | unique |
| `DriftDetectorResult` | interface | `src/server/services/regime-drift-detector-service.ts:71` | 0 | unique |
| `_getEtHour` | function | `src/server/services/regime-drift-detector-service.ts:90` | 3 | AMBIG |
| `_tryAcquireDetectorLock` | function | `src/server/services/regime-drift-detector-service.ts:104` | 0 | unique |
| `_releaseDetectorLock` | function | `src/server/services/regime-drift-detector-service.ts:110` | 0 | unique |
| `runRegimeDriftDetector` | function | `src/server/services/regime-drift-detector-service.ts:140` | 1 | unique |
| `RegimeResult` | interface | `src/server/services/regime-service.ts:8` | 0 | unique |
| `analyzeMarket` | function | `src/server/services/regime-service.ts:19` | 1 | unique |
| `HMMRegimeResult` | interface | `src/server/services/regime-service.ts:36` | 0 | unique |
| `RegimeWeights` | interface | `src/server/services/regime-state-service.ts:31` | 0 | unique |
| `RegimeState` | interface | `src/server/services/regime-state-service.ts:42` | 0 | unique |
| `setRegimeWeights` | function | `src/server/services/regime-state-service.ts:91` | 1 | unique |
| `getRegimeState` | function | `src/server/services/regime-state-service.ts:139` | 1 | unique |
| `getAllRegimeState` | function | `src/server/services/regime-state-service.ts:223` | 1 | unique |
| `MacroFusedRegimeState` | interface | `src/server/services/regime-state-service.ts:238` | 0 | unique |
| `getOpeningAuctionBias` | function | `src/server/services/regime-state-service.ts:348` | 1 | AMBIG |
| `triggerRemotePowerCycle` | function | `src/server/services/remote-power-cycle-service.ts:77` | 1 | unique |
| `collectResourceMetrics` | function | `src/server/services/resource-tracker.ts:43` | 1 | unique |
| `RobustnessResult` | interface | `src/server/services/robustness-service.ts:10` | 0 | unique |
| `runRobustnessTest` | function | `src/server/services/robustness-service.ts:84` | 1 | unique |
| `SearchOptions` | interface | `src/server/services/search-router.ts:37` | 0 | unique |
| `SearchResult` | interface | `src/server/services/search-router.ts:50` | 0 | unique |
| `strategyHunt` | function | `src/server/services/search-router.ts:428` | 2 | unique |
| `LIVE_EXECUTION_STATES` | const | `src/server/services/server-mediated-executor.ts:70` | 1 | unique |
| `isServerMediatedExecutionEnabled` | function | `src/server/services/server-mediated-executor.ts:79` | 4 | unique |
| `LiveExecutionContext` | interface | `src/server/services/server-mediated-executor.ts:86` | 1 | unique |
| `RoutingOutcome` | interface | `src/server/services/server-mediated-executor.ts:101` | 0 | unique |
| `routeLiveEntry` | function | `src/server/services/server-mediated-executor.ts:347` | 1 | unique |
| `routeLiveExitPartial` | function | `src/server/services/server-mediated-executor.ts:410` | 1 | unique |
| `routeLiveExitModify` | function | `src/server/services/server-mediated-executor.ts:466` | 1 | unique |
| `routeLiveFlatten` | function | `src/server/services/server-mediated-executor.ts:519` | 1 | unique |
| `computeSessionAnalytics` | function | `src/server/services/session-analytics-service.ts:6` | 0 | unique |
| `recordSessionAnalyticsRollup` | function | `src/server/services/session-analytics-service.ts:49` | 1 | unique |
| `DailyStatRow` | interface | `src/server/services/settlement-reconciliation-service.ts:27` | 0 | unique |
| `StatisticsPullResult` | interface | `src/server/services/settlement-reconciliation-service.ts:37` | 0 | unique |
| `ReconciliationResult` | interface | `src/server/services/settlement-reconciliation-service.ts:49` | 2 | AMBIG |
| `runStatisticsPull` | function | `src/server/services/settlement-reconciliation-service.ts:71` | 1 | unique |
| `getSettlementPrice` | function | `src/server/services/settlement-reconciliation-service.ts:158` | 0 | unique |
| `runSettlementReconciliation` | function | `src/server/services/settlement-reconciliation-service.ts:210` | 1 | unique |
| `PAPER_PLUS_STATES` | const | `src/server/services/shadow-rerun-service.ts:50` | 4 | unique |
| `ShadowRerunStrategyInput` | interface | `src/server/services/shadow-rerun-service.ts:72` | 0 | unique |
| `ShadowRerunFinding` | interface | `src/server/services/shadow-rerun-service.ts:77` | 0 | unique |
| `ShadowRerunRefusal` | interface | `src/server/services/shadow-rerun-service.ts:103` | 0 | unique |
| `ShadowRerunReport` | interface | `src/server/services/shadow-rerun-service.ts:116` | 0 | unique |
| `runShadowRerun` | function | `src/server/services/shadow-rerun-service.ts:439` | 1 | unique |
| `getShadowRerunFindings` | function | `src/server/services/shadow-rerun-service.ts:640` | 1 | unique |
| `logShadowSignal` | function | `src/server/services/shadow-service.ts:27` | 1 | unique |
| `getShadowReport` | function | `src/server/services/shadow-service.ts:95` | 1 | unique |
| `SignalConfirmation` | interface | `src/server/services/signal-confirmation-service.ts:6` | 0 | unique |
| `checkSignalConfirmation` | function | `src/server/services/signal-confirmation-service.ts:17` | 1 | unique |
| `SIGNAL_CORRELATION_THRESHOLD` | const | `src/server/services/signal-correlation-service.ts:49` | 1 | unique |
| `compressSignalVector` | function | `src/server/services/signal-correlation-service.ts:64` | 0 | unique |
| `decompressSignalVector` | function | `src/server/services/signal-correlation-service.ts:73` | 0 | unique |
| `cosineSimilarity` | function | `src/server/services/signal-correlation-service.ts:89` | 2 | AMBIG |
| `persistSignalVector` | function | `src/server/services/signal-correlation-service.ts:114` | 1 | unique |
| `loadLatestSignalVector` | function | `src/server/services/signal-correlation-service.ts:155` | 0 | unique |
| `CorrelationResult` | interface | `src/server/services/signal-correlation-service.ts:182` | 2 | AMBIG |
| `computePairwiseCorrelation` | function | `src/server/services/signal-correlation-service.ts:200` | 0 | unique |
| `checkSignalCorrelationGate` | function | `src/server/services/signal-correlation-service.ts:285` | 1 | unique |
| `MatrixEntry` | interface | `src/server/services/signal-correlation-service.ts:378` | 0 | unique |
| `buildCorrelationMatrix` | function | `src/server/services/signal-correlation-service.ts:395` | 1 | unique |
| `initSmtBarBufferProvider` | function | `src/server/services/smt-live-service.ts:48` | 1 | unique |
| `SmtLiveSnapshot` | interface | `src/server/services/smt-live-service.ts:73` | 0 | unique |
| `getSmtLiveSnapshot` | function | `src/server/services/smt-live-service.ts:236` | 1 | unique |
| `VerifyArgs` | interface | `src/server/services/source-url-verifier.ts:29` | 0 | unique |
| `VerifyResult` | interface | `src/server/services/source-url-verifier.ts:37` | 2 | AMBIG |
| `verifySourceUrl` | function | `src/server/services/source-url-verifier.ts:77` | 1 | unique |
| `AssignmentRecord` | interface | `src/server/services/strategy-assignment-service.ts:37` | 0 | unique |
| `AssignStrategyOptions` | interface | `src/server/services/strategy-assignment-service.ts:48` | 0 | unique |
| `CollaborativeTradingWarning` | interface | `src/server/services/strategy-assignment-service.ts:61` | 0 | unique |
| `PipelinePausedError` | export-binding | `src/server/services/strategy-assignment-service.ts:84` | 1 | unique |
| `getEnabledFirms` | function | `src/server/services/strategy-assignment-service.ts:121` | 1 | unique |
| `assignStrategyToAccount` | function | `src/server/services/strategy-assignment-service.ts:283` | 1 | unique |
| `unassignStrategy` | function | `src/server/services/strategy-assignment-service.ts:486` | 1 | unique |
| `releaseStrategyToFamily` | function | `src/server/services/strategy-assignment-service.ts:536` | 1 | unique |
| `getActiveAssignment` | function | `src/server/services/strategy-assignment-service.ts:640` | 1 | unique |
| `getAllAssignments` | function | `src/server/services/strategy-assignment-service.ts:666` | 1 | unique |
| `getFamilyPublishedStrategies` | function | `src/server/services/strategy-assignment-service.ts:679` | 1 | unique |
| `EntryArchetype` | type | `src/server/services/strategy-fingerprint.ts:55` | 0 | unique |
| `ExitType` | type | `src/server/services/strategy-fingerprint.ts:65` | 1 | AMBIG |
| `computeFingerprintHash` | function | `src/server/services/strategy-fingerprint.ts:84` | 1 | unique |
| `normalizeConceptName` | function | `src/server/services/strategy-fingerprint.ts:110` | 1 | unique |
| `canonicalConceptName` | function | `src/server/services/strategy-fingerprint.ts:325` | 2 | unique |
| `computeConceptFingerprintHash` | function | `src/server/services/strategy-fingerprint.ts:414` | 3 | unique |
| `computeWideConceptFingerprintHash` | function | `src/server/services/strategy-fingerprint.ts:451` | 1 | unique |
| `computeQuarantineFingerprintHash` | function | `src/server/services/strategy-fingerprint.ts:510` | 2 | unique |
| `extractVideoId` | function | `src/server/services/strategy-fingerprint.ts:526` | 3 | unique |
| `extractEntryArchetype` | function | `src/server/services/strategy-fingerprint.ts:541` | 2 | unique |
| `normalizeExitType` | function | `src/server/services/strategy-fingerprint.ts:592` | 2 | unique |
| `SubsystemResult` | interface | `src/server/services/strategy-health-aggregator.ts:69` | 0 | unique |
| `HealthVerdict` | type | `src/server/services/strategy-health-aggregator.ts:78` | 2 | AMBIG |
| `AggregatorResult` | interface | `src/server/services/strategy-health-aggregator.ts:80` | 0 | unique |
| `computeWeightsVersionId` | function | `src/server/services/strategy-health-aggregator.ts:130` | 1 | AMBIG |
| `classifyVerdict` | function | `src/server/services/strategy-health-aggregator.ts:174` | 0 | unique |
| `fetchB14SurvivalTwin` | function | `src/server/services/strategy-health-aggregator.ts:201` | 0 | unique |
| `fetchWfe` | function | `src/server/services/strategy-health-aggregator.ts:257` | 0 | unique |
| `fetchParameterDrift` | function | `src/server/services/strategy-health-aggregator.ts:292` | 0 | unique |
| `fetchB15Robustness` | function | `src/server/services/strategy-health-aggregator.ts:343` | 0 | unique |
| `fetchComplianceBlockRate` | function | `src/server/services/strategy-health-aggregator.ts:389` | 0 | unique |
| `fetchTradeCritique` | function | `src/server/services/strategy-health-aggregator.ts:428` | 0 | unique |
| `fetchPatternAggregator` | function | `src/server/services/strategy-health-aggregator.ts:476` | 0 | unique |
| `fetchConsistencyTracker` | function | `src/server/services/strategy-health-aggregator.ts:511` | 0 | unique |
| `fetchDeeparForecast` | function | `src/server/services/strategy-health-aggregator.ts:533` | 0 | unique |
| `fetchBlackSwan` | function | `src/server/services/strategy-health-aggregator.ts:580` | 0 | unique |
| `fetchNemo` | function | `src/server/services/strategy-health-aggregator.ts:626` | 0 | unique |
| `fetchQuantumReplay` | function | `src/server/services/strategy-health-aggregator.ts:656` | 0 | unique |
| `fetchRlAgent` | function | `src/server/services/strategy-health-aggregator.ts:730` | 0 | unique |
| `aggregateStrategyHealth` | function | `src/server/services/strategy-health-aggregator.ts:777` | 1 | unique |
| `LOCKOUT_DURATION_HOURS` | const | `src/server/services/strategy-lockout-service.ts:33` | 0 | unique |
| `LockoutRow` | interface | `src/server/services/strategy-lockout-service.ts:37` | 0 | unique |
| `WriteLockoutParams` | interface | `src/server/services/strategy-lockout-service.ts:46` | 0 | unique |
| `writeLockoutFromKillEvent` | function | `src/server/services/strategy-lockout-service.ts:64` | 1 | unique |
| `getActiveLockout` | function | `src/server/services/strategy-lockout-service.ts:134` | 1 | unique |
| `CandidateInput` | interface | `src/server/services/strategy-prevalidator.ts:28` | 0 | unique |
| `PrevalidationResult` | interface | `src/server/services/strategy-prevalidator.ts:40` | 0 | unique |
| `prevalidateCandidate` | function | `src/server/services/strategy-prevalidator.ts:135` | 2 | unique |
| `RevalidationResult` | interface | `src/server/services/strategy-revalidation-service.ts:35` | 0 | unique |
| `runStrategyAgeRevalidation` | function | `src/server/services/strategy-revalidation-service.ts:42` | 1 | unique |
| `STALE_THRESHOLD_DAYS` | const | `src/server/services/strategy-stale-detector.ts:71` | 0 | unique |
| `DEMOTION_THRESHOLD_DAYS` | const | `src/server/services/strategy-stale-detector.ts:74` | 0 | unique |
| `DEMOTION_EXEMPT_STATES` | const | `src/server/services/strategy-stale-detector.ts:88` | 0 | unique |
| `StrategyStaleRow` | interface | `src/server/services/strategy-stale-detector.ts:92` | 0 | unique |
| `StaleDetectorResult` | interface | `src/server/services/strategy-stale-detector.ts:99` | 0 | unique |
| `runStrategyStaleDetector` | function | `src/server/services/strategy-stale-detector.ts:414` | 1 | unique |
| `collectAllMetrics` | function | `src/server/services/subsystem-metrics-service.ts:150` | 1 | unique |
| `queryMetrics` | function | `src/server/services/subsystem-metrics-service.ts:172` | 1 | unique |
| `getDashboardMetrics` | function | `src/server/services/subsystem-metrics-service.ts:186` | 1 | unique |
| `BlackSwanPythonResult` | interface | `src/server/services/synthetic-black-swan-service.ts:46` | 0 | unique |
| `BlackSwanResult` | interface | `src/server/services/synthetic-black-swan-service.ts:61` | 0 | unique |
| `BlackSwanRunOptions` | interface | `src/server/services/synthetic-black-swan-service.ts:79` | 0 | unique |
| `runBlackSwanTest` | function | `src/server/services/synthetic-black-swan-service.ts:97` | 2 | unique |
| `getLatestBlackSwanRun` | function | `src/server/services/synthetic-black-swan-service.ts:256` | 1 | unique |
| `RegimePythonRecord` | interface | `src/server/services/synthetic-regime-bank-service.ts:124` | 0 | unique |
| `PopulateRegimeBankPythonResult` | interface | `src/server/services/synthetic-regime-bank-service.ts:136` | 0 | unique |
| `PopulateRegimeBankResult` | interface | `src/server/services/synthetic-regime-bank-service.ts:147` | 0 | unique |
| `runSyntheticRegimeBankPopulate` | function | `src/server/services/synthetic-regime-bank-service.ts:253` | 1 | unique |
| `ensureRegimeBankPopulated` | function | `src/server/services/synthetic-regime-bank-service.ts:519` | 1 | unique |
| `TradeCritiqueStatus` | type | `src/server/services/trade-critique-service.ts:49` | 0 | unique |
| `TechnicalDiagnosis` | interface | `src/server/services/trade-critique-service.ts:51` | 0 | unique |
| `PlainEnglishSummary` | interface | `src/server/services/trade-critique-service.ts:78` | 0 | unique |
| `TradeCritiqueResult` | interface | `src/server/services/trade-critique-service.ts:86` | 0 | unique |
| `runTradeCritique` | function | `src/server/services/trade-critique-service.ts:424` | 2 | unique |
| `MarkerRow` | interface | `src/server/services/tradingview-marker-service.ts:33` | 0 | unique |
| `MarkerMismatch` | interface | `src/server/services/tradingview-marker-service.ts:45` | 0 | unique |
| `buildHmacCanonical` | function | `src/server/services/tradingview-marker-service.ts:72` | 0 | unique |
| `validateHmac` | function | `src/server/services/tradingview-marker-service.ts:96` | 1 | unique |
| `getMarkerCountForDate` | function | `src/server/services/tradingview-marker-service.ts:183` | 1 | unique |
| `lookupHmacSecret` | function | `src/server/services/tradingview-marker-service.ts:276` | 2 | unique |
| `TranscriptFetchAttempt` | interface | `src/server/services/transcript-fetch-queue.ts:33` | 0 | unique |
| `TranscriptFetchResult` | interface | `src/server/services/transcript-fetch-queue.ts:41` | 0 | unique |
| `fetchTranscriptWithRetry` | function | `src/server/services/transcript-fetch-queue.ts:101` | 2 | unique |
| `VALIDATION_CADENCE_RED_THRESHOLD_DAYS` | const | `src/server/services/validation-cadence-service.ts:46` | 0 | unique |
| `VALIDATION_CADENCE_MIN_STRATEGIES_PER_MONTH` | const | `src/server/services/validation-cadence-service.ts:52` | 0 | unique |
| `DaysSinceLastLiveBacktestResult` | interface | `src/server/services/validation-cadence-service.ts:64` | 0 | unique |
| `getDaysSinceLastLiveBacktest` | function | `src/server/services/validation-cadence-service.ts:84` | 0 | unique |
| `StrategiesTestedThisMonthResult` | interface | `src/server/services/validation-cadence-service.ts:115` | 0 | unique |
| `getStrategiesTestedEndToEndThisMonth` | function | `src/server/services/validation-cadence-service.ts:135` | 0 | unique |
| `RealityCheckScoreResult` | interface | `src/server/services/validation-cadence-service.ts:159` | 0 | unique |
| `getRealityCheckScore` | function | `src/server/services/validation-cadence-service.ts:189` | 0 | unique |
| `RealityCheckReport` | interface | `src/server/services/validation-cadence-service.ts:306` | 0 | unique |
| `StrategyComparison` | interface | `src/server/services/validation-cadence-service.ts:321` | 0 | unique |
| `runMonthlyRealityCheckReport` | function | `src/server/services/validation-cadence-service.ts:347` | 2 | unique |
| `ValidationCadenceDashboard` | interface | `src/server/services/validation-cadence-service.ts:547` | 0 | unique |
| `getValidationCadenceDashboard` | function | `src/server/services/validation-cadence-service.ts:558` | 1 | unique |
| `NakedPoc` | interface | `src/server/services/volume-profile-service.ts:81` | 0 | unique |
| `VPLevels` | interface | `src/server/services/volume-profile-service.ts:86` | 0 | AMBIG |
| `updateDevelopingPoc` | function | `src/server/services/volume-profile-service.ts:124` | 0 | unique |
| `getDevelopingSessionPoc` | function | `src/server/services/volume-profile-service.ts:129` | 1 | unique |
| `getLatestVPLevels` | function | `src/server/services/volume-profile-service.ts:294` | 2 | unique |
| `getVPLevelsHistory` | function | `src/server/services/volume-profile-service.ts:318` | 1 | unique |
| `triggerVPCompute` | function | `src/server/services/volume-profile-service.ts:340` | 1 | unique |
| `SessionShapeScoreResult` | interface | `src/server/services/volume-profile-service.ts:350` | 0 | unique |
| `getSessionShapeScore` | function | `src/server/services/volume-profile-service.ts:379` | 1 | unique |
| `LatencyPercentiles` | interface | `src/server/services/webhook-latency-monitor-service.ts:39` | 0 | unique |
| `LatencyMonitorRunResult` | interface | `src/server/services/webhook-latency-monitor-service.ts:46` | 0 | unique |
| `computePercentiles` | function | `src/server/services/webhook-latency-monitor-service.ts:57` | 0 | unique |
| `computeRolling1hLatencyP95` | function | `src/server/services/webhook-latency-monitor-service.ts:102` | 1 | unique |
| `runWebhookLatencyCheck` | function | `src/server/services/webhook-latency-monitor-service.ts:144` | 1 | unique |
| `__test__` | const | `src/server/services/webhook-latency-monitor-service.ts:205` | 4 | AMBIG |
| `WeeklyDriftHaltReport` | interface | `src/server/services/weekly-drift-halt-service.ts:264` | 0 | unique |
| `runWeeklyDriftHaltCheck` | function | `src/server/services/weekly-drift-halt-service.ts:277` | 1 | unique |
| `HealthCheckResult` | interface | `src/server/services/windows-health-check-service.ts:33` | 0 | unique |
| `REBOOT_PAUSE_PROVENANCE_PARAM` | const | `src/server/services/windows-health-check-service.ts:53` | 0 | unique |
| `classifyExitCode` | function | `src/server/services/windows-health-check-service.ts:60` | 0 | unique |
| `buildReason` | function | `src/server/services/windows-health-check-service.ts:81` | 0 | unique |
| `runHealthCheckScript` | function | `src/server/services/windows-health-check-service.ts:125` | 0 | unique |
| `runPreTradingDayHealthCheck` | function | `src/server/services/windows-health-check-service.ts:181` | 2 | unique |
| `setRebootPauseProvenance` | function | `src/server/services/windows-health-check-service.ts:381` | 0 | unique |
| `AutoResumeOutcome` | type | `src/server/services/windows-health-check-service.ts:398` | 0 | unique |
| `maybeAutoResumeAfterReboot` | function | `src/server/services/windows-health-check-service.ts:418` | 1 | unique |

</details>

<details><summary><code>src/shared/firm-config.ts</code> - 27 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `FirmAccountConfig` | interface | `src/shared/firm-config.ts:30` | 1 | unique |
| `FirmConfig` | interface | `src/shared/firm-config.ts:76` | 1 | unique |
| `FIRMS` | const | `src/shared/firm-config.ts:93` | 5 | unique |
| `PHASE_5_ENABLED` | const | `src/shared/firm-config.ts:189` | 1 | unique |
| `ContractSpec` | interface | `src/shared/firm-config.ts:196` | 5 | AMBIG |
| `CONTRACT_SPECS` | const | `src/shared/firm-config.ts:233` | 11 | AMBIG |
| `CONTRACT_CAP_MIN` | const | `src/shared/firm-config.ts:360` | 3 | unique |
| `CONTRACT_CAP_MAX` | const | `src/shared/firm-config.ts:361` | 4 | unique |
| `DEFAULT_ACCOUNT_SIZE` | const | `src/shared/firm-config.ts:365` | 1 | unique |
| `getFirmAccount` | function | `src/shared/firm-config.ts:371` | 5 | unique |
| `getFirmLimit` | function | `src/shared/firm-config.ts:378` | 4 | unique |
| `getAllFirms` | function | `src/shared/firm-config.ts:393` | 1 | unique |
| `getMacroBlackoutMode` | function | `src/shared/firm-config.ts:403` | 1 | unique |
| `getTightestDrawdown` | function | `src/shared/firm-config.ts:410` | 1 | unique |
| `DEFAULT_COMMISSION_PER_SIDE` | const | `src/shared/firm-config.ts:425` | 0 | unique |
| `getCommissionPerSide` | function | `src/shared/firm-config.ts:433` | 2 | AMBIG |
| `getBufferAmount` | function | `src/shared/firm-config.ts:443` | 1 | unique |
| `getTotalHurdle` | function | `src/shared/firm-config.ts:450` | 1 | unique |
| `LIQUIDITY_COMFORT_CAPS` | const | `src/shared/firm-config.ts:461` | 1 | unique |
| `LIQUIDITY_COMFORT_CAP_DEFAULT` | const | `src/shared/firm-config.ts:467` | 1 | unique |
| `TOPSTEP_TRAILING_DD_BY_SIZE` | const | `src/shared/firm-config.ts:474` | 3 | unique |
| `TOPSTEP_XFA_PAYOUT_CAPS` | const | `src/shared/firm-config.ts:536` | 1 | unique |
| `TOPSTEP_LFA_PAYOUT_CAP` | const | `src/shared/firm-config.ts:548` | 1 | unique |
| `MFFU_PAYOUT_CAP` | const | `src/shared/firm-config.ts:551` | 1 | unique |
| `TOPSTEP_MIN_PAYOUT_USD` | const | `src/shared/firm-config.ts:554` | 1 | unique |
| `TOPSTEP_MIN_PAYOUT_BALANCE_RULE` | const | `src/shared/firm-config.ts:562` | 1 | unique |
| `TOPSTEP_LFA_RESERVE` | const | `src/shared/firm-config.ts:577` | 1 | unique |

</details>

<details><summary><code>src/shared/marker-contract.ts</code> - 5 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `MARKER_CONTRACT_VERSION` | const | `src/shared/marker-contract.ts:27` | 1 | unique |
| `buildExportCanonical` | function | `src/shared/marker-contract.ts:34` | 1 | unique |
| `buildWebhookCanonical` | function | `src/shared/marker-contract.ts:45` | 1 | unique |
| `MARKER_EXPORT_SUFFIX` | const | `src/shared/marker-contract.ts:60` | 1 | unique |
| `MARKER_FIELD_SEPARATOR` | const | `src/shared/marker-contract.ts:61` | 1 | unique |

</details>

<details><summary><code>src/shared/utils.ts</code> - 1 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `parsePythonJson` | function | `src/shared/utils.ts:6` | 8 | unique |

</details>

<details><summary><code>src/shared/walk-forward-schema.ts</code> - 5 symbols</summary>

| Symbol | Kind | Defined at | Non-test caller files | Name |
|---|---|---|---:|---|
| `WFWindowMetricsSchema` | const | `src/shared/walk-forward-schema.ts:23` | 1 | unique |
| `WFWindowMetrics` | type | `src/shared/walk-forward-schema.ts:45` | 0 | unique |
| `WFEResultSchema` | const | `src/shared/walk-forward-schema.ts:68` | 0 | unique |
| `PBOResultSchema` | const | `src/shared/walk-forward-schema.ts:90` | 0 | unique |
| `ParamDriftClassificationSchema` | const | `src/shared/walk-forward-schema.ts:109` | 0 | unique |

</details>

---

## 9. UNCLASSIFIED - the mandatory residual

Everything the instrument could not place.  This section is never allowed to be empty by
omission: if the classifier could not decide, the row appears **here** rather than being
dropped, or force-fitted into a state it does not belong in.  Every one of these is a place
where the map may be under-reporting.

| Reason | Count |
|---|---:|
| line begins with `export` but did not match the declaration pattern | 1 |
| no exported declaration matched; file contributes 0 symbols | 6 |

<details><summary>Individual unclassified items (first 300)</summary>

| Item | At | Reason |
|---|---|---|
| `src/data/fetchers/index.ts` | `src/data/fetchers/index.ts:1` | no exported declaration matched; file contributes 0 symbols |
| `src/data/loaders/index.ts` | `src/data/loaders/index.ts:1` | no exported declaration matched; file contributes 0 symbols |
| `src/server/load-env.ts` | `src/server/load-env.ts:1` | no exported declaration matched; file contributes 0 symbols |
| `src/server/middleware/strict-rate-limit.ts` | `src/server/middleware/strict-rate-limit.ts:1` | no exported declaration matched; file contributes 0 symbols |
| `src/server/production/index.ts` | `src/server/production/index.ts:1` | no exported declaration matched; file contributes 0 symbols |
| `export default router;` | `src/server/routes/compliance.ts:484` | line begins with `export` but did not match the declaration pattern |
| `src/server/types/express.d.ts` | `src/server/types/express.d.ts:1` | no exported declaration matched; file contributes 0 symbols |

</details>

---

## 10. Non-symbol surfaces

### 10.1 API routes (`src/server/routes/`)

`Registered` = the module is imported by `src/server/index.ts`.  A route file that exists but
is not registered serves no traffic.

**83 of 94 route modules are imported by `src/server/index.ts`.**

| Route module | Registered in `index.ts` | Reachable | Exported symbols |
|---|---|---|---:|
| `src/server/routes/ab-comparison.ts` | yes | yes | 7 |
| `src/server/routes/admin-frozen-policy-override.ts` | yes | yes | 1 |
| `src/server/routes/admin-recovery.ts` | yes | yes | 1 |
| `src/server/routes/admin-workflow-backup.ts` | yes | yes | 2 |
| `src/server/routes/admin.ts` | yes | yes | 1 |
| `src/server/routes/adversarial-stress.ts` | yes | yes | 1 |
| `src/server/routes/agent.ts` | yes | yes | 3 |
| `src/server/routes/alerts.ts` | yes | yes | 1 |
| `src/server/routes/anti-setups.ts` | yes | yes | 1 |
| `src/server/routes/archetypes.ts` | yes | yes | 1 |
| `src/server/routes/auditor.ts` | yes | yes | 1 |
| `src/server/routes/b15-robustness.ts` | yes | yes | 1 |
| `src/server/routes/backtests.ts` | yes | yes | 3 |
| `src/server/routes/bias-decisions.ts` | yes | yes | 1 |
| `src/server/routes/bias-state.ts` | yes | yes | 1 |
| `src/server/routes/broker-accounts.ts` | yes | yes | 1 |
| `src/server/routes/broker-error-budget.ts` | yes | yes | 1 |
| `src/server/routes/carter-tools.ts` | yes | yes | 1 |
| `src/server/routes/carter-webhook.ts` | yes | yes | 2 |
| `src/server/routes/cloud-qmc.ts` | yes | yes | 1 |
| `src/server/routes/compiler.ts` | yes | yes | 1 |
| `src/server/routes/compliance.ts` | yes | yes | 2 |
| `src/server/routes/composite-health.ts` | yes | yes | 6 |
| `src/server/routes/consistency.ts` | yes | yes | 1 |
| `src/server/routes/context.ts` | yes | yes | 1 |
| `src/server/routes/critic-optimizer.ts` | yes | yes | 1 |
| `src/server/routes/data.ts` | yes | yes | 1 |
| `src/server/routes/decay.ts` | yes | yes | 1 |
| `src/server/routes/deepar.ts` | yes | yes | 1 |
| `src/server/routes/deployed-strategy-starvation.ts` | yes | yes | 1 |
| `src/server/routes/dlq.ts` | yes | yes | 1 |
| `src/server/routes/fill-callback.ts` | yes | yes | 1 |
| `src/server/routes/frankenstein.ts` | yes | yes | 1 |
| `src/server/routes/governor.ts` | yes | yes | 1 |
| `src/server/routes/graveyard.ts` | yes | yes | 1 |
| `src/server/routes/health-dashboard.ts` | yes | yes | 1 |
| `src/server/routes/indicators.ts` | yes | yes | 1 |
| `src/server/routes/journal.ts` | yes | yes | 1 |
| `src/server/routes/leak-detection.ts` | yes | yes | 1 |
| `src/server/routes/library-diversity.ts` | yes | yes | 1 |
| `src/server/routes/live-order.ts` | yes | yes | 1 |
| `src/server/routes/macro.ts` | yes | yes | 1 |
| `src/server/routes/metrics.ts` | yes | yes | 1 |
| `src/server/routes/monte-carlo.ts` | yes | yes | 1 |
| `src/server/routes/n8n-tracking.ts` | yes | yes | 1 |
| `src/server/routes/nemo-scenarios.ts` | yes | yes | 1 |
| `src/server/routes/openai-proxy.ts` | yes | yes | 1 |
| `src/server/routes/openclaw-daily-report.ts` | yes | yes | 1 |
| `src/server/routes/paper.ts` | yes | yes | 2 |
| `src/server/routes/pine-export-recipient.ts` | yes | yes | 1 |
| `src/server/routes/pine-export.ts` | yes | yes | 1 |
| `src/server/routes/portfolio.ts` | yes | yes | 1 |
| `src/server/routes/pre-market.ts` | yes | yes | 1 |
| `src/server/routes/prevalidator.ts` | yes | yes | 1 |
| `src/server/routes/production-status.ts` | yes | yes | 6 |
| `src/server/routes/prop-firm.ts` | yes | yes | 2 |
| `src/server/routes/quantum-cost.ts` | yes | yes | 1 |
| `src/server/routes/quantum-mc.ts` | yes | yes | 1 |
| `src/server/routes/quantum-pre-flight.ts` | yes | yes | 2 |
| `src/server/routes/risk.ts` | yes | yes | 1 |
| `src/server/routes/scout-health.ts` | yes | yes | 1 |
| `src/server/routes/search-router.ts` | yes | yes | 1 |
| `src/server/routes/shadow-rerun.ts` | yes | yes | 1 |
| `src/server/routes/signal-correlation.ts` | yes | yes | 1 |
| `src/server/routes/signals.ts` | yes | yes | 1 |
| `src/server/routes/skip.ts` | yes | yes | 1 |
| `src/server/routes/slumdawg.ts` | yes | yes | 1 |
| `src/server/routes/slumhouse/admin-mapping.ts` | **NO** | yes | 3 |
| `src/server/routes/slumhouse/admin.ts` | yes | yes | 6 |
| `src/server/routes/slumhouse/api/anam-session.ts` | **NO** | yes | 2 |
| `src/server/routes/slumhouse/api/carter-inbox.ts` | **NO** | yes | 2 |
| `src/server/routes/slumhouse/api/carter-session.ts` | **NO** | yes | 2 |
| `src/server/routes/slumhouse/api/crib.ts` | **NO** | yes | 2 |
| `src/server/routes/slumhouse/api/kitchen.ts` | **NO** | yes | 3 |
| `src/server/routes/slumhouse/api/menu.ts` | **NO** | yes | 1 |
| `src/server/routes/slumhouse/api/recipe.ts` | **NO** | yes | 2 |
| `src/server/routes/slumhouse/api/reports.ts` | **NO** | yes | 1 |
| `src/server/routes/slumhouse/auth.ts` | **NO** | yes | 5 |
| `src/server/routes/slumhouse/deploy-approvals.ts` | **NO** | yes | 5 |
| `src/server/routes/slumhouse/index.ts` | yes | yes | 3 |
| `src/server/routes/sse.ts` | yes | yes | 18 |
| `src/server/routes/strategies.ts` | yes | yes | 2 |
| `src/server/routes/strategy-assignments.ts` | yes | yes | 1 |
| `src/server/routes/strategy-names.ts` | yes | yes | 1 |
| `src/server/routes/survival.ts` | yes | yes | 1 |
| `src/server/routes/synthetic-black-swan.ts` | yes | yes | 1 |
| `src/server/routes/tournament.ts` | yes | yes | 1 |
| `src/server/routes/trade-journal.ts` | yes | yes | 1 |
| `src/server/routes/traderspost-confirm.ts` | yes | yes | 4 |
| `src/server/routes/tradingview-webhook.ts` | yes | yes | 1 |
| `src/server/routes/validation-cadence.ts` | yes | yes | 1 |
| `src/server/routes/validation.ts` | yes | yes | 1 |
| `src/server/routes/volume-profile.ts` | yes | yes | 1 |
| `src/server/routes/webhook-latency.ts` | yes | yes | 1 |

### 10.2 SQL migrations (`src/server/db/`)

**201 `.sql` files.**  Grade: MEASURED HERE - file count only.  Whether each has been APPLIED
to any database is **NOT MEASURED** by this generator; a migration journal row saying
`applied` is not proof the DDL ran.

First: `src/server/db/migrations/0000_previous_nuke.sql`
Last:  `src/server/db/migrations/rollbacks/0058_audit_log_append_only.down.sql`

<details><summary>All 201 migration files</summary>

- `src/server/db/migrations/0000_previous_nuke.sql`
- `src/server/db/migrations/0001_flashy_hercules.sql`
- `src/server/db/migrations/0002_equal_nova.sql`
- `src/server/db/migrations/0003_tournament_expires_at.sql`
- `src/server/db/migrations/0004_paper_trading.sql`
- `src/server/db/migrations/0005_paper_signal_log.sql`
- `src/server/db/migrations/0006_deep_analysis_pipeline.sql`
- `src/server/db/migrations/0007_matrix_correlations.sql`
- `src/server/db/migrations/0008_decay_analysis_column.sql`
- `src/server/db/migrations/0009_strategy_evolution.sql`
- `src/server/db/migrations/0010_top1_engine_upgrade.sql`
- `src/server/db/migrations/0011_paper_full_potential.sql`
- `src/server/db/migrations/0012_paper_execution_realism.sql`
- `src/server/db/migrations/0013_paper_pause_resume.sql`
- `src/server/db/migrations/0014_paper_trailing_drawdown.sql`
- `src/server/db/migrations/0015_schema_sync.sql`
- `src/server/db/migrations/0016_sanity_cross_validation.sql`
- `src/server/db/migrations/0017_add_indexes.sql`
- `src/server/db/migrations/0018_quantum_pine_export.sql`
- `src/server/db/migrations/0019_strategy_names.sql`
- `src/server/db/migrations/0020_strategy_names_fix.sql`
- `src/server/db/migrations/0021_add_performance_indexes.sql`
- `src/server/db/migrations/0022_quantum_persistence_critic.sql`
- `src/server/db/migrations/0023_paper_trades_commission.sql`
- `src/server/db/migrations/0024_paper_position_state_persistence.sql`
- `src/server/db/migrations/0025_backtest_gate_result_columns.sql`
- `src/server/db/migrations/0026_wave2_status_columns.sql`
- `src/server/db/migrations/0027_deepar_cloud_quantum.sql`
- `src/server/db/migrations/0028_quantum_mc_cloud_columns.sql`
- `src/server/db/migrations/0029_paper_trades_journal_enrichment.sql`
- `src/server/db/migrations/0030_graveyard_failure_taxonomy.sql`
- `src/server/db/migrations/0031_mutation_outcomes_regret_scoring.sql`
- `src/server/db/migrations/0032_audit_log_enrichment.sql`
- `src/server/db/migrations/0033_artifact_content_hash.sql`
- `src/server/db/migrations/0034_paper_positions_mae_mfe.sql`
- `src/server/db/migrations/0035_sqa_qubo_seed.sql`
- `src/server/db/migrations/0036_sqa_comparison_critic_regret.sql`
- `src/server/db/migrations/0037_paper_session_feedback.sql`
- `src/server/db/migrations/0038_export_config_hash.sql`
- `src/server/db/migrations/0038a_referential_integrity_pine_version.sql`
- `src/server/db/migrations/0039_wave1_enterprise_observability.sql`
- `src/server/db/migrations/0040_wave2_self_evolution.sql`
- `src/server/db/migrations/0041_wave3_observability.sql`
- `src/server/db/migrations/0042_wave4_automation.sql`
- `src/server/db/migrations/0043_wave5_resilience.sql`
- `src/server/db/migrations/0044_wave6_self_learning.sql`
- `src/server/db/migrations/0044a_system_parameters_tables.sql`
- `src/server/db/migrations/0045_strategy_cleanup_and_source.sql`
- `src/server/db/migrations/0046_dlq_escalated.sql`
- `src/server/db/migrations/0047_idempotency_keys.sql`
- `src/server/db/migrations/0048_subsystem_metrics.sql`
- `src/server/db/migrations/0049_prompt_versions.sql`
- `src/server/db/migrations/0050_quantum_benchmark_graduation.sql`
- `src/server/db/migrations/0051_contract_rolls.sql`
- `src/server/db/migrations/0052_fk_cascade_hardening.sql`
- `src/server/db/migrations/0053_backtest_result_extras.sql`
- `src/server/db/migrations/0054_audit_log_correlation_id.sql`
- `src/server/db/migrations/0055_drop_orphan_tables.sql`
- `src/server/db/migrations/0056_roll_spread_cost.sql`
- `src/server/db/migrations/0057_critic_candidates_model_version.sql`
- `src/server/db/migrations/0058_audit_log_append_only.sql`
- `src/server/db/migrations/0059_paper_position_prev_unrealized.sql`
- `src/server/db/migrations/0060_pine_export_content_hash.sql`
- `src/server/db/migrations/0061_paper_session_governor_state.sql`
- `src/server/db/migrations/0062_pine_version_default.sql`
- `src/server/db/migrations/0063_critic_survivor_fk.sql`
- `src/server/db/migrations/0064_lifecycle_transitions_table.sql`
- `src/server/db/migrations/0065_quantum_cost_telemetry.sql`
- `src/server/db/migrations/0066_adversarial_stress_runs.sql`
- `src/server/db/migrations/0067_a_plus_market_scans.sql`
- `src/server/db/migrations/0068_cloud_qmc_runs.sql`
- `src/server/db/migrations/0069_strategy_lockouts.sql`
- `src/server/db/migrations/0070_backtest_provenance.sql`
- `src/server/db/migrations/0071_frankenstein_test_runs.sql`
- `src/server/db/migrations/0072_strategy_signal_vectors.sql`
- `src/server/db/migrations/0073_data_integrity_findings.sql`
- `src/server/db/migrations/0074_shadow_rerun_findings.sql`
- `src/server/db/migrations/0075_realized_peak_equity.sql`
- `src/server/db/migrations/0076_strategy_firm_eligibility.sql`
- `src/server/db/migrations/0077_lifecycle_pilot_state.sql`
- `src/server/db/migrations/0078_mrp_sharpe_column.sql`
- `src/server/db/migrations/0079_exchange_outages.sql`
- `src/server/db/migrations/0080_prop_firm_health.sql`
- `src/server/db/migrations/0081_llm_injection_attempts.sql`
- `src/server/db/migrations/0082_strategy_dsl_features.sql`
- `src/server/db/migrations/0083_information_ratio.sql`
- `src/server/db/migrations/0084_macro_features.sql`
- `src/server/db/migrations/0085_contract_specs_authoritative.sql`
- `src/server/db/migrations/0086_daily_statistics.sql`
- `src/server/db/migrations/0087_opening_auction_imbalance.sql`
- `src/server/db/migrations/0088_synthetic_black_swan_runs.sql`
- `src/server/db/migrations/0089_prop_firm_survival.sql`
- `src/server/db/migrations/0090_scout_drain_samples.sql`
- `src/server/db/migrations/0091_responses_api_telemetry.sql`
- `src/server/db/migrations/0092_paper_position_exit_state.sql`
- `src/server/db/migrations/0093_volume_profile_levels.sql`
- `src/server/db/migrations/0094_nemo_scenario_bank.sql`
- `src/server/db/migrations/0095_bias_engine_shadow.sql`
- `src/server/db/migrations/0096_production_path.sql`
- `src/server/db/migrations/0097_legacy_firm_data_cleanup.sql`
- `src/server/db/migrations/0098_broker_accounts.sql`
- `src/server/db/migrations/0099_instance_config.sql`
- `src/server/db/migrations/0100_account_strategy_assignments.sql`
- `src/server/db/migrations/0100b_assignment_hmac_secret.sql`
- `src/server/db/migrations/0101_autopilot_tables.sql`
- `src/server/db/migrations/0102_tradingview_markers.sql`
- `src/server/db/migrations/0103_cross_source_validation.sql`
- `src/server/db/migrations/0104_concept_fingerprint.sql`
- `src/server/db/migrations/0105_wide_fingerprint.sql`
- `src/server/db/migrations/0106_lifecycle_transitions_correlation_id.sql`
- `src/server/db/migrations/0107_n8n_execution_log_unique_execution.sql`
- `src/server/db/migrations/0108_n8n_execution_log_full_unique_index.sql`
- `src/server/db/migrations/0109_archive_zombie_strategies.sql`
- `src/server/db/migrations/0110_wave22_firm_agnostic_position_size.sql`
- `src/server/db/migrations/0111_strategies_symbols_array.sql`
- `src/server/db/migrations/0112_wave23_bias_state.sql`
- `src/server/db/migrations/0113_wave23_hwm_tracking.sql`
- `src/server/db/migrations/0114_bias_state_multi_symbol.sql`
- `src/server/db/migrations/0115_harsh_regime_phase.sql`
- `src/server/db/migrations/0116_recover_daily_vp_levels.sql`
- `src/server/db/migrations/0117_recover_missing_tables.sql`
- `src/server/db/migrations/0118_transcript_fetch_outcomes.sql`
- `src/server/db/migrations/0119_confluence_mtf_dsl.sql`
- `src/server/db/migrations/0120_multi_regime_strategies.sql`
- `src/server/db/migrations/0121_pre_market_sessions.sql`
- `src/server/db/migrations/0122_bias_state_position_lock.sql`
- `src/server/db/migrations/0123_broker_account_enabled_symbols.sql`
- `src/server/db/migrations/0124_compliance_firm_lowercase.sql`
- `src/server/db/migrations/0125_schema_invariants_fk_unique_indexes.sql`
- `src/server/db/migrations/0126_critical_path_timestamptz.sql`
- `src/server/db/migrations/0127_generation_check.sql`
- `src/server/db/migrations/0128_hmac_secret_encryption.sql`
- `src/server/db/migrations/0129_hmac_rotation_runbook.sql`
- `src/server/db/migrations/0130_paper_position_partials.sql`
- `src/server/db/migrations/0131_operator_absent_pending.sql`
- `src/server/db/migrations/0132_hmm_regime_overlay.sql`
- `src/server/db/migrations/0133_webhook_latency_audit.sql`
- `src/server/db/migrations/0134_bias_state_structure_state.sql`
- `src/server/db/migrations/0135_strategies_confluence_scoring.sql`
- `src/server/db/migrations/0136_b15_parameter_robustness.sql`
- `src/server/db/migrations/0137_bias_state_htf_narrative.sql`
- `src/server/db/migrations/0138_strategies_5tf_hierarchy.sql`
- `src/server/db/migrations/0139_pre_market_institutional_expansion.sql`
- `src/server/db/migrations/0140_liquidity_levels.sql`
- `src/server/db/migrations/0141_trade_critique.sql`
- `src/server/db/migrations/0142_regime_expansion.sql`
- `src/server/db/migrations/0143_bias_state_narrative.sql`
- `src/server/db/migrations/0144_strategies_adaptive_exits.sql`
- `src/server/db/migrations/0145_paper_positions_exit_plan.sql`
- `src/server/db/migrations/0146_backtests_firm_rules_version.sql`
- `src/server/db/migrations/0147_quantum_mc_runs_replay_uniqueness.sql`
- `src/server/db/migrations/0148_backtests_compliance_mode.sql`
- `src/server/db/migrations/0149_strategy_health_scores.sql`
- `src/server/db/migrations/0150_multi_confluence_archetype_migration.sql`
- `src/server/db/migrations/0151_bounce_off_level_archetype_reroute.sql`
- `src/server/db/migrations/0152_strategies_needs_revision_states.sql`
- `src/server/db/migrations/0153_pipeline_modes_autopause.sql`
- `src/server/db/migrations/0154_regime_late_cycle_overheating.sql`
- `src/server/db/migrations/0155_wrc_spa_promotion_gates.sql`
- `src/server/db/migrations/0156_cpcv_min_paths.sql`
- `src/server/db/migrations/0157_normalize_factor_quality_strings.sql`
- `src/server/db/migrations/0158_quantum_rl_runs.sql`
- `src/server/db/migrations/0159_broker_accounts_ab_paper_routing.sql`
- `src/server/db/migrations/0160_shadow_signals.sql`
- `src/server/db/migrations/0161_frozen_policy_contract.sql`
- `src/server/db/migrations/0162_needs_archetype_queue.sql`
- `src/server/db/migrations/0164_slumhouse_users.sql`
- `src/server/db/migrations/0165_quantum_rl_runs_seed.sql`
- `src/server/db/migrations/0166_agent_jobs.sql`
- `src/server/db/migrations/0167_broker_accounts_dll_opted_in.sql`
- `src/server/db/migrations/0168_broker_accounts_dll_opted_in_default_true.sql`
- `src/server/db/migrations/0169_golive_schema_reconcile.sql`
- `src/server/db/migrations/0170_live_order_pine_dedup.sql`
- `src/server/db/migrations/0171_server_mediated_orders.sql`
- `src/server/db/migrations/0172_economic_release_dates.sql`
- `src/server/db/migrations/0173_tradingview_markers_unique.sql`
- `src/server/db/migrations/0174_paper_sessions_proven_trades.sql`
- `src/server/db/migrations/0175_seed_auto_patch_loop_disabled.sql`
- `src/server/db/migrations/0176_system_journal_generation_prompt_version_id.sql`
- `src/server/db/migrations/0177_backtests_bif.sql`
- `src/server/db/migrations/0178_research_trial_counter.sql`
- `src/server/db/migrations/0179_paper_positions_stop_ohlc.sql`
- `src/server/db/migrations/0180_paper_trades_correlation_id.sql`
- `src/server/db/migrations/0181_carter_issues.sql`
- `src/server/db/migrations/0182_enabled_firms_topstep_primary.sql`
- `src/server/db/migrations/0183_agent_jobs_started_at.sql`
- `src/server/db/migrations/0184_workflow_backups.sql`
- `src/server/db/migrations/0185_carter_memory.sql`
- `src/server/db/migrations/0186_backtest_provenance_stamp.sql`
- `src/server/db/migrations/0187_slumhouse_session_epoch.sql`
- `src/server/db/migrations/0188_backtests_idempotency_lineage_root.sql`
- `src/server/db/migrations/0189_backtests_slippage_survival.sql`
- `src/server/db/migrations/0190_broker_accounts_firm_broker_topology.sql`
- `src/server/db/migrations/0191_pilot_sessions_rolling_sharpe_rename.sql`
- `src/server/db/migrations/0192_agent_health_reports.sql`
- `src/server/db/migrations/0193_compliance_reviews_invalidation.sql`
- `src/server/db/migrations/0194_production_trades_writer_idempotency.sql`
- `src/server/db/migrations/0195_daily_reconciliation_severity.sql`
- `src/server/db/migrations/0196_paper_signal_logs_correlation_id.sql`
- `src/server/db/migrations/0197_production_trades_traderspost_confirmed_at.sql`
- `src/server/db/migrations/rollbacks/0058_audit_log_append_only.down.sql`

</details>

### 10.3 n8n workflows (`workflows/`)

**41 workflow JSON files.**  `active: true` in the file: 40.  `active: false`: 0.  No
`active` key: 1.

The `active` value is what the exported JSON **declares**.  It is ARTIFACT-SOURCED, not a live
reading of the n8n instance - this generator never calls n8n.

| Workflow file | `active` in JSON | Nodes |
|---|---|---:|
| `workflows/n8n/0A-health-monitor_DGEk1D478xWJClKD.json` | yes | 14 |
| `workflows/n8n/10A-master-orchestration_LTH2vot3Mv9B5AHb.json` | yes | 8 |
| `workflows/n8n/11A-critic-optimization_MXTkxH5x8yjpLNXS.json` | yes | 7 |
| `workflows/n8n/14A-master-nightly-intelligence_Nk4pmHP6c0VOEOaT.json` | yes | 28 |
| `workflows/n8n/3A-workflow-backup_5bfT33w0TylM0Hbk.json` | yes | 8 |
| `workflows/n8n/5A-weekly-tournament_iGjDyKYpxNFzoXCw.json` | yes | 7 |
| `workflows/n8n/5P-nemo-scenario-generator.json` | yes | 5 |
| `workflows/n8n/5P-nemo-scenario-generator_0ooxmt74fCtHiTo6.json` | yes | 5 |
| `workflows/n8n/6D-compliance-gate_UJUSRydbOZHDq7LB.json` | yes | 10 |
| `workflows/n8n/7A-auto-evolution_eEt2dJrZbV6C7TRL.json` | yes | 10 |
| `workflows/n8n/9A-nightly-self-critique_cN2IPq27NeEsOCiu.json` | yes | 8 |
| `workflows/n8n/Anti-Setup_Refresh_9KY6ixHP47mP7k0y.json` | yes | 12 |
| `workflows/n8n/Daily_Compliance_Check_b8CSc84wQzJ4lEGH.json` | yes | 9 |
| `workflows/n8n/Daily_Portfolio_Monitor_eZSbajXAi7v7tGPx.json` | yes | 14 |
| `workflows/n8n/Macro_Data_Sync_-_Evening_7pm_Regime_Summary__pSKkMAYwaV0GzBUq.json` | yes | 12 |
| `workflows/n8n/Macro_Data_Sync_-_Morning_7am_Skip_Classifier__hhGHmV0JSlpI5raC.json` | yes | 8 |
| `workflows/n8n/Monthly_Robustness_Check_RIK5eQ0rFEG78Vtd.json` | yes | 14 |
| `workflows/n8n/Post-Session_Skip_Review_ao1OK1SCNVMQbCPK.json` | yes | 8 |
| `workflows/n8n/Pre-Session_Compliance_Gate_VB3PLAMAJ4q9gthk.json` | yes | 9 |
| `workflows/n8n/Pre-Session_Skip_Check_flOq70zNhT3Umemt.json` | yes | 13 |
| `workflows/n8n/Slumdawg-Analyst---Anam-Tools-Gateway_4mlEUCez5FJ90GiT.json` | yes | 15 |
| `workflows/n8n/TF-Health-Watchdog---auto-restart---Discord-alert_pajWJxqX37zKkooV.json` | yes | 6 |
| `workflows/n8n/Weekly_Compliance_Re-Parse_rNcIEbpUQkm3p4Jp.json` | yes | 10 |
| `workflows/n8n/_live-snapshot-2026-06-29.json` | (absent) | ? |
| `workflows/n8n/_archived/5G-brave-search-scout_51vtQf8XwXuWFt6G.json` | yes | 6 |
| `workflows/n8n/_archived/5H-reddit-scout_xXt5uAIAAxBvsD1c.json` | yes | 16 |
| `workflows/n8n/_archived/5I-tavily-scout_TMT3g7HenJ5etiwv.json` | yes | 6 |
| `workflows/n8n/_archived/8A-idea-to-strategy_vvNevHjP9PE8nioR.json` | yes | 11 |
| `workflows/n8n/_archived/8B-source-quality-review_yhKnxushfe0Q3FKk.json` | yes | 7 |
| `workflows/n8n/_archived/Nightly_Self-Correction_7qd92chhmrK2xXtz.json` | yes | 12 |
| `workflows/n8n/_archived/Nightly_Strategy_Research_Loop_MTnzkeGMAEeE7HQu.json` | yes | 26 |
| `workflows/n8n/_archived/Strategy_Deep_Analysis_Pipeline_40q1SdSjUxyZ9Jux.json` | yes | 18 |
| `workflows/n8n/_archived/Strategy_Generation_Loop_1N8GcmcMKvQH4GRG.json` | yes | 37 |
| `workflows/n8n/_archived/Strategy_Tournament_7BSvnyQEky84DXwl.json` | yes | 27 |
| `workflows/n8n/_archived/Weekly_Strategy_Hunt_TaRpu6HwVsVB3XgY.json` | yes | 29 |
| `workflows/n8n-prefix/5bfT33w0TylM0Hbk.json` | yes | 8 |
| `workflows/n8n-prefix/LTH2vot3Mv9B5AHb.json` | yes | 8 |
| `workflows/n8n-prefix/Nk4pmHP6c0VOEOaT.json` | yes | 28 |
| `workflows/n8n-prefix/RIK5eQ0rFEG78Vtd.json` | yes | 14 |
| `workflows/n8n-prefix/eZSbajXAi7v7tGPx.json` | yes | 14 |
| `workflows/n8n-prefix/pajWJxqX37zKkooV.json` | yes | 6 |

---

## 11. What this inventory does NOT cover

Honest partial coverage, named, beats false completeness.

| Not covered | Status |
|---|---|
| Frontend (`Trading_forge_frontend/`) | UNENUMERATED - separate npm project, outside the swept surface |
| `prototypes/`, `bin/`, `infra/`, `railway-relay/`, `ollama/`, `config/`, `assets/`, `public/` | UNENUMERATED - outside the published symbol and reference surface |
| Python class methods and inner functions | UNENUMERATED by choice - counted in 1.3, not listed individually |
| Non-exported TypeScript declarations | UNENUMERATED - module-private |
| Whether a migration ever ran against a database | NOT MEASURED - file presence only |
| Whether an n8n workflow is live on the n8n instance | NOT MEASURED - the JSON `active` key only |
| Whether a `WIRED` symbol is ever executed at runtime | NOT MEASURED - static reachability is not execution |
| Dynamic dispatch: registries, `getattr`, string-keyed handlers, HTTP-in | NOT MEASURED - invisible to a static import graph |
| Symbols reached only through a name collision | NOT CORRECTED FOR - biases toward `WIRED`, see 2.4 |
| Correctness, quality, test strength, or importance of anything listed | OUT OF SCOPE - this is a map, not a grade |
| `.mts` / `.mjs` / `.cjs` sources (e.g. `e2e/office-test-server.mts`, many `scripts/*.mjs`) | UNENUMERATED - only `.py`, `.ts`, `.tsx` are parsed |
| `export default <expr>` bindings | UNCLASSIFIED by design - the external name is anonymous; see section 9 |
| `docs/`, `skills/`, `.claude/`, `.github/` | UNENUMERATED - not code surfaces |

---

_End of generated inventory._

