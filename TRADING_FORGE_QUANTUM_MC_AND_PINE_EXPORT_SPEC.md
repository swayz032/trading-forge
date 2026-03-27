# Trading Forge — Quantum Monte Carlo Risk Lab + Pine Export Compiler

**Document type:** Implementation spec sheet for Claude Code  
**Project:** Trading Forge (private/personal futures strategy research engine)  
**Status:** New build specification  
**Priority:** High  
**Scope:** Add a quantum Monte Carlo challenger lane for prop-firm survival/risk analysis and add a Pine export compiler for passed strategies.

---

## 1. Executive Summary

Trading Forge already has a classical research stack:

- historical data ingestion
- Python backtesting
- walk-forward
- Monte Carlo
- prop-firm compliance logic
- robustness/scoring/gating
- strategy lifecycle management

This spec adds **two new post-research deployment layers**:

1. **Quantum Monte Carlo Risk Lab**  
   A challenger subsystem attached to Monte Carlo that estimates prop-firm survival, breach risk, tail-loss risk, and target-hit probability using explicit uncertainty models and quantum-style amplitude-estimation workflows. This is **not** the source of truth at first. Classical Monte Carlo remains authoritative.

2. **Forge-to-Pine Export Compiler**  
   A deployment compiler that turns eligible passed strategies into TradingView artifacts for personal use:
   - private indicator
   - alert pack
   - optional strategy shell
   - prop-risk overlay

These additions are intended to improve **decision quality**, **deployment portability**, and **prop-firm survivability intelligence**. They are **not** a claim of magical alpha generation.

---

## 2. Core Product Thesis

Trading Forge is not only a backtester. It is a **strategy qualification engine** for futures trading under prop-firm constraints.

The system should answer:

- Can this strategy survive path randomness?
- Can it survive prop-firm rules?
- What is the breach probability?
- What is the target-hit probability?
- What is the safe risk band?
- Should this strategy be promoted, sandboxed, reduced in size, or rejected?

The new quantum layer supports this by acting as a **challenger estimator** for selected Monte Carlo-style risk problems.

The new Pine export layer supports this by turning passed strategies into **portable TradingView execution interfaces** for manual or alert-driven use.

---

## 3. Goals

### 3.1 Primary goals

1. Keep **classical Monte Carlo** as the baseline source of truth.
2. Add **quantum Monte Carlo challenger methods** for bounded risk/payoff estimation.
3. Make **prop-firm rules first-class simulation boundaries** in both classical and quantum risk analysis.
4. Add **benchmark persistence** so every classical vs quantum comparison is auditable.
5. Add a **Pine compiler** that converts eligible passed strategies into TradingView deployment artifacts.
6. Ensure the TradingView layer is **derived from qualified strategies**, not invented independently.

### 3.2 Secondary goals

1. Add a long-term R&D moat through a hybrid risk lab.
2. Allow visual/manual deployment through TradingView without making Pine the research source of truth.
3. Create a cleaner promotion path from research -> qualification -> deployment.

---

## 4. Non-Goals

1. Do **not** replace the existing classical Monte Carlo engine.
2. Do **not** make quantum estimation the primary gating path in phase 1.
3. Do **not** port the full Trading Forge research engine into Pine Script.
4. Do **not** claim quantum directly improves entries, exits, or predictive alpha.
5. Do **not** let TradingView become the authoritative backtest engine.
6. Do **not** export every strategy to Pine. Only export strategies that pass explicit exportability gates.

---

## 5. High-Level Architecture

```text
Historical Data
    -> Backtester
    -> Walk-Forward
    -> Robustness / Scoring / Gates
    -> Prop Compliance
    -> Classical Monte Carlo (authoritative)
    -> Quantum MC Challenger (experimental)
    -> Strategy Qualification Decision
    -> Eligible Strategy Export Compiler
    -> Pine Indicator / Alert Pack / Optional Strategy Shell
```

### 5.1 Source-of-truth hierarchy

**Authoritative layers**
- Python backtester
- walk-forward
- classical Monte Carlo
- prop-firm rules engine
- scoring / gating / lifecycle

**Experimental challenger layer**
- quantum MC risk estimation

**Deployment layer**
- Pine compiler
- private TradingView artifacts

---

## 6. New Subsystems

### 6.1 Quantum Monte Carlo Risk Lab

Purpose:
- estimate specific risk/payoff probabilities under explicit uncertainty models
- compare those estimates against classical Monte Carlo baselines
- persist benchmark and reproducibility data

Key outputs:
- breach probability
- target-hit probability
- ruin probability
- tail-loss probability
- CVaR challenger estimate
- regime-conditioned survival estimate
- estimate error vs classical baseline
- runtime/cost/depth/qubit metadata

### 6.2 Forge-to-Pine Export Compiler

Purpose:
- convert passed strategies into TradingView-compatible artifacts for personal prop workflows
- generate chart-native decision aids from already-qualified strategy logic
- allow visual/manual or alert-driven deployment on TradingView-supported firm setups

Key outputs:
- Pine indicator script
- alert definitions
- optional Pine strategy shell
- prop-risk overlay
- export metadata

---

## 7. Repository Additions

Add the following modules and directories.

### 7.1 Python engine

```text
src/engine/
  quantum_models.py
  quantum_mc.py
  quantum_bench.py
  prop_survival_model.py
  pine_compiler.py
  pine_templates/
    indicator_base.pine
    strategy_shell_base.pine
    prop_overlay_base.pine
  exportability.py
```

### 7.2 TypeScript server

```text
src/server/routes/
  quantum-mc.ts
  pine-export.ts

src/server/services/
  quantum-mc-service.ts
  pine-export-service.ts

src/server/lib/
  pine-artifact-schema.ts
  quantum-run-schema.ts
```

### 7.3 Database / migrations

```text
db/migrations/
  add_quantum_mc_runs.sql
  add_quantum_mc_benchmarks.sql
  add_strategy_exports.sql
  add_strategy_export_artifacts.sql
```

### 7.4 Tests

```text
tests/python/
  test_quantum_models.py
  test_quantum_mc.py
  test_quantum_bench.py
  test_pine_compiler.py
  test_exportability.py

src/server/__tests__/
  quantum-mc-routes.test.ts
  pine-export-routes.test.ts
```

---

## 8. Data Model Changes

### 8.1 `quantum_mc_runs`

Purpose: persist each quantum challenger run.

Suggested fields:

- `id`
- `strategy_id`
- `backtest_run_id`
- `classical_mc_run_id`
- `problem_type`  
  - `ruin_probability`
  - `breach_probability`
  - `tail_loss_probability`
  - `target_hit_probability`
  - `cvar_estimate`
- `uncertainty_model_type`  
  - `truncated_normal`
  - `mixture_normal`
  - `regime_bucketed`
  - `empirical_binned`
- `prop_rule_profile_json`
- `regime_profile_json`
- `quantum_algorithm`  
  - `iae`
  - `mlae`
  - `fae`
- `backend_type`  
  - `aer_statevector`
  - `aer_qasm`
  - `aer_noisy`
  - `mock_backend`
- `state_prep_method`
- `num_qubits`
- `circuit_depth`
- `shots`
- `grover_powers_json`
- `estimate_value`
- `confidence_interval_json`
- `abs_error_vs_classical`
- `rel_error_vs_classical`
- `runtime_ms`
- `status`
- `error_message`
- `created_at`

### 8.2 `quantum_mc_benchmarks`

Purpose: store benchmark comparisons and reproducibility metadata.

Suggested fields:

- `id`
- `quantum_mc_run_id`
- `benchmark_name`
- `classical_method`
- `classical_value`
- `quantum_value`
- `delta`
- `benchmark_pass`
- `tolerance_json`
- `simulator_noise_profile_json`
- `reproducibility_hash`
- `notes`
- `created_at`

### 8.3 `strategy_exports`

Purpose: store export attempts and results.

Suggested fields:

- `id`
- `strategy_id`
- `qualification_run_id`
- `export_type`  
  - `pine_indicator`
  - `pine_alert_pack`
  - `pine_strategy_shell`
  - `pine_bundle`
- `export_status`
- `exportability_score`
- `exportability_notes_json`
- `artifact_version`
- `created_at`

### 8.4 `strategy_export_artifacts`

Purpose: store actual compiled artifact payloads and metadata.

Suggested fields:

- `id`
- `strategy_export_id`
- `artifact_name`
- `artifact_type`
- `pine_version`
- `script_body`
- `alert_definitions_json`
- `overlay_config_json`
- `input_schema_json`
- `limitations_json`
- `checksum`
- `created_at`

---

## 9. Quantum Monte Carlo Design

## 9.1 Philosophy

Quantum MC is **not** a drop-in replacement for historical resampling.

Current classical Monte Carlo likely works by:
- trade resampling
- return bootstrapping
- path randomization
- risk metric aggregation

Quantum Monte Carlo should instead be used for **bounded expectation / event estimation** under a compact uncertainty model.

### 9.2 First supported problem families

Phase 1 should support only these problem classes:

1. `breach_probability`
   - probability strategy violates prop-firm daily or trailing drawdown constraints before target

2. `ruin_probability`
   - probability equity falls below hard threshold under modeled return distribution

3. `target_hit_probability`
   - probability target is reached before breach under bounded simulation horizon

4. `tail_loss_probability`
   - probability loss exceeds tail threshold under modeled distribution

5. `cvar_estimate` (later phase)
   - conditional expected loss in tail under bounded discrete loss model

### 9.3 Required modeling bridge

Quantum workflows need a compact uncertainty model. Add a model-fitting bridge from classical outputs to discrete distributions.

Supported model types:

1. `truncated_normal`
2. `mixture_normal`
3. `regime_bucketed`
4. `empirical_binned`

### 9.4 Prop-rule integration

Quantum MC must be aware of the same rule boundaries used by classical prop Monte Carlo.

Required rule inputs:

- starting balance
- profit target
- max daily loss
- max trailing drawdown
- max overall drawdown
- evaluation days/minimum days if applicable
- per-trade risk assumption
- maximum trades/day if relevant
- session eligibility rules
- lockout logic after breach

The quantum estimator should answer questions like:

- probability of breaching daily loss before recovery
- probability of reaching target before trailing breach
- probability of surviving X sessions under current risk sizing
- probability of entering kill zone under stress regime

### 9.5 Required modules

#### `quantum_models.py`
Responsibilities:
- fit discrete uncertainty models from backtest/MC data
- bound distributions to finite domains
- create discretized bins for quantum estimation problems
- emit metadata needed for reproducibility

Functions:
- `fit_truncated_normal(...)`
- `fit_mixture_model(...)`
- `fit_regime_bucket_model(...)`
- `build_empirical_binned_distribution(...)`
- `serialize_uncertainty_model(...)`

#### `prop_survival_model.py`
Responsibilities:
- translate prop-firm rules into risk-event definitions
- formalize breach conditions and target conditions
- produce binary event functions and bounded payoff functions

Functions:
- `build_breach_event(...)`
- `build_target_event(...)`
- `build_tail_loss_event(...)`
- `build_risk_band_scenarios(...)`

#### `quantum_mc.py`
Responsibilities:
- build estimation problems
- run supported algorithms
- normalize outputs into Trading Forge schema
- never hide simulator/backend metadata

Functions:
- `run_quantum_ruin_estimation(...)`
- `run_quantum_breach_estimation(...)`
- `run_quantum_target_hit_estimation(...)`
- `run_quantum_tail_loss_estimation(...)`
- `run_hybrid_compare(...)`

#### `quantum_bench.py`
Responsibilities:
- compare quantum output vs classical baseline
- validate tolerance bands
- store benchmark result objects
- compute reproducibility hashes

Functions:
- `benchmark_against_classical(...)`
- `validate_tolerance(...)`
- `build_reproducibility_hash(...)`
- `persist_benchmark(...)`

---

## 10. Quantum Algorithm Support

## 10.1 Allowed phase-1 algorithms

Support these algorithm identifiers even if implementation starts with one:

- `iae` = Iterative Amplitude Estimation
- `mlae` = Maximum Likelihood Amplitude Estimation
- `fae` = Faster Amplitude Estimation

Default phase-1 algorithm:
- `iae`

## 10.2 Allowed backends

- exact simulator
- qasm simulator
- noisy simulator
- mock backend

No live hardware dependency in phase 1.

## 10.3 Governance labels

Every quantum run must carry:

- `experimental: true`
- `authoritative: false`
- `decision_role: challenger_only`

This remains true until explicit promotion criteria are met.

---

## 11. Classical vs Quantum Comparison Policy

### 11.1 Baseline

Classical Monte Carlo remains authoritative for:
- qualification gates
- promotion decisions
- risk approval
- lifecycle changes

### 11.2 Quantum role

Quantum is used to:
- benchmark alternative estimators
- stress-test bounded risk questions
- identify cases where the classical estimate may be fragile or expensive
- support R&D and future upgrade paths

### 11.3 Promotion criteria for future phases

Quantum estimation can be considered for semi-authoritative use only if:

1. repeated parity against classical baseline is demonstrated
2. tolerance breaches are rare and explained
3. simulator-noise performance is documented
4. reproducibility hashes are stable
5. state-preparation assumptions are fully logged

Until then, it never overrides classical gating.

---

## 12. Pine Export Compiler Design

## 12.1 Philosophy

Passed strategies should be exportable into a chart-native shell for TradingView use.

The Pine layer is a **deployment interface**, not a research truth engine.

Trading Forge must compile strategy logic into a simplified, bounded, visual form suitable for TradingView.

## 12.2 Export artifact types

### A. Pine Indicator

Purpose:
- display bias, zones, confirmations, invalidation, and risk overlays

Required features:
- long/short bias state
- entry zone visualization
- no-trade zone visualization
- confirmation state
- invalidation/stop band
- optional target bands
- regime/day-type label
- prop-risk status label
- alert hooks

### B. Alert Pack

Purpose:
- create TradingView alerts from passed strategy conditions

Required alerts:
- long setup armed
- short setup armed
- entry confirmed
- invalidated
- prop-risk lockout
- no-trade day/session
- high breach risk warning

### C. Optional Strategy Shell

Purpose:
- allow chart-level visualization/testing for personal forward use

Constraints:
- must be labeled non-authoritative
- must include comment banner that authoritative research lives in Trading Forge Python engine
- must not implement unsupported deep logic if Pine limitations make it unreliable

### D. Prop-Risk Overlay

Purpose:
- surface risk intelligence on the TradingView chart

Required overlay values:
- breach probability bucket
- target-hit probability bucket
- safe risk band
- session eligibility
- kill-zone warning
- risk-reduction recommendation
- stress fragility state

## 12.3 Exportability gate

Not every passed strategy is Pine-exportable.

Create `exportability.py` with checks such as:

- strategy logic is representable with Pine-safe state
- no dependency on unavailable external services
- no dependency on heavy model inference at chart runtime
- no dependency on unavailable tick-level detail
- no dependency on excessively large historical context
- signal rules can be simplified without invalidating thesis

### Exportability score bands

- `90-100` = clean Pine deployment candidate
- `70-89` = Pine deployment possible with reductions
- `50-69` = alert-only export recommended
- `<50` = do not export

## 12.4 Pine compiler outputs

Each export should produce:

1. `indicator.pine`
2. `alerts.json`
3. `strategy_shell.pine` (optional)
4. `README_export.md`

The README must document:
- what the artifact represents
- what was simplified
- what was omitted
- which Trading Forge run it came from
- which prop profile it targets
- which sessions/instruments it supports

---

## 13. Pine Compiler Inputs and Contracts

## 13.1 Required inputs from qualified strategy

The compiler should take a normalized qualified-strategy object.

Suggested fields:

```json
{
  "strategy_id": "...",
  "name": "...",
  "market": "ES",
  "timeframe": "5m",
  "session_profile": "rth",
  "directionality": "both",
  "entry_logic": {...},
  "exit_logic": {...},
  "filters": {...},
  "risk_model": {...},
  "regime_model": {...},
  "prop_profile": {...},
  "qualification_summary": {
    "forge_score": 0,
    "walk_forward_pass": true,
    "mc_pass": true,
    "prop_pass": true,
    "quantum_challenger_status": "optional"
  },
  "exportability_notes": []
}
```

## 13.2 Compiler stages

1. Normalize strategy object
2. Run exportability checks
3. Select artifact template set
4. Convert strategy logic into Pine-safe state machine
5. Inject prop-risk overlay values
6. Build alert definitions
7. Emit artifacts
8. Persist export metadata

---

## 14. API Changes

## 14.1 Quantum MC routes

### `POST /api/quantum-mc/run`

Purpose:
- run a single quantum MC challenger job

Request body:

```json
{
  "strategyId": "string",
  "backtestRunId": "string",
  "classicalMcRunId": "string",
  "problemType": "breach_probability",
  "uncertaintyModelType": "regime_bucketed",
  "algorithm": "iae",
  "backendType": "aer_statevector",
  "propProfile": {...},
  "regimeProfile": {...},
  "tolerance": {...}
}
```

Response:
- job accepted
- run id
- status

### `POST /api/quantum-mc/hybrid-compare`

Purpose:
- run classical baseline comparison plus challenger estimate

Response should include:
- classical value
- quantum value
- abs delta
- relative delta
- benchmark pass/fail
- metadata

### `GET /api/quantum-mc/:id`

Purpose:
- fetch a persisted run

### `GET /api/quantum-mc/benchmarks/:id`

Purpose:
- fetch comparison details

## 14.2 Pine export routes

### `POST /api/pine-export/compile`

Purpose:
- compile a passed strategy into Pine artifacts

Request body:

```json
{
  "strategyId": "string",
  "qualificationRunId": "string",
  "exportTypes": ["pine_indicator", "pine_alert_pack", "pine_strategy_shell"],
  "propOverlay": true,
  "targetTradingViewUse": "private_personal"
}
```

Response:
- export job id
- exportability score
- warnings

### `GET /api/pine-export/:id`

Purpose:
- fetch compiled artifact set

### `GET /api/pine-export/:id/artifacts`

Purpose:
- fetch actual artifact bodies and metadata

---

## 15. Service-Layer Responsibilities

## 15.1 `quantum-mc-service.ts`

Responsibilities:
- validate incoming payloads
- ensure classical MC baseline exists
- ensure strategy/backtest references exist
- dispatch Python run
- persist run metadata
- return normalized response

## 15.2 `pine-export-service.ts`

Responsibilities:
- validate qualification status
- check exportability
- dispatch Python compiler
- persist artifacts
- return bundle metadata

---

## 16. Python CLI / Invocation Contracts

If the current architecture uses Python subprocess execution, add stable CLI entrypoints.

### Quantum MC CLI

```bash
python -m src.engine.quantum_mc \
  --strategy-id ... \
  --backtest-run-id ... \
  --classical-mc-run-id ... \
  --problem-type breach_probability \
  --uncertainty-model regime_bucketed \
  --algorithm iae \
  --backend aer_statevector \
  --input-json /tmp/job.json
```

### Pine compiler CLI

```bash
python -m src.engine.pine_compiler \
  --strategy-id ... \
  --qualification-run-id ... \
  --export-types pine_indicator,pine_alert_pack,pine_strategy_shell \
  --input-json /tmp/export.json
```

All CLI tools must emit normalized JSON to stdout and non-zero exit codes on failure.

---

## 17. Strategy Qualification Flow Changes

Current qualification likely ends around:
- backtest
- walk-forward
- Monte Carlo
- compliance
- scoring

New flow:

1. strategy passes classical qualification engines
2. optional quantum challenger run is attached
3. strategy receives deployment eligibility status
4. if exportable, compiler generates Pine artifacts
5. artifact metadata is linked to the strategy record

### New status fields

Add to strategy qualification summary:

- `quantum_challenger_run_status`
- `quantum_challenger_benchmark_status`
- `pine_export_eligible`
- `pine_export_status`

---

## 18. Prop-Firm Risk Intelligence Outputs

Both the classical and quantum layers should normalize into product-facing risk outputs.

Required normalized values:

- `breach_probability`
- `target_hit_probability`
- `safe_risk_band`
- `kill_zone_risk`
- `stress_survival_probability`
- `fragility_score`
- `promotion_confidence`

### Interpretation buckets

Recommended display buckets:

- `very_low`
- `low`
- `moderate`
- `high`
- `critical`

These are what the Pine overlay and any later UI should show.

---

## 19. Pine Overlay Design

The prop-risk overlay should be visual and simple.

Required overlay labels/graphics:

1. **Risk Mode**
   - safe
   - reduced
   - danger
   - lockout

2. **Breach Probability Bucket**
   - low / moderate / high / critical

3. **Target Probability Bucket**
   - weak / fair / strong / elite

4. **Session Eligibility**
   - tradable
   - avoid
   - reduced size only

5. **Strategy State**
   - armed
   - confirmed
   - invalidated
   - no-trade

6. **Safe Risk Band**
   - e.g. `0.25% to 0.40%`

The overlay must support turning components on/off to stay within Pine complexity limits.

---

## 20. Template Strategy for Pine Compilation

Compiler should use a normalized finite-state-machine approach instead of trying to directly reproduce the full Python engine.

### State machine example

States:
- `neutral`
- `watch_long`
- `watch_short`
- `long_confirmed`
- `short_confirmed`
- `invalidated`
- `risk_lockout`

Transitions should be based on exported simplified logic only.

If the strategy cannot be represented as a bounded Pine state machine, it should fail exportability.

---

## 21. Testing Requirements

## 21.1 Unit tests — quantum

Must test:
- uncertainty model fitting
- bad input handling
- unsupported distributions
- event construction correctness
- tolerance comparison correctness
- reproducibility hash stability

## 21.2 Unit tests — Pine compiler

Must test:
- exportability scoring
- state-machine generation
- alert generation
- artifact checksum stability
- unsupported strategy rejection

## 21.3 Integration tests

### Quantum
- route -> service -> Python -> DB persistence
- classical vs quantum compare flow
- failure path with simulator/backend errors

### Pine
- strategy qualification -> export compile -> artifact persistence
- export rejection on non-Pine-safe strategy

## 21.4 Golden tests

Use snapshot/golden tests for:
- compiled Pine artifacts
- alert JSON output
- export README output

---

## 22. Logging and Observability

Every quantum run must log:

- strategy id
- problem type
- uncertainty model type
- algorithm
- backend
- num qubits
- depth
- runtime
- benchmark result
- tolerance result

Every Pine export must log:

- strategy id
- exportability score
- chosen export types
- warning count
- artifact checksums

Use structured logs with stable event names.

Suggested event names:

- `quantum_mc.run_started`
- `quantum_mc.run_completed`
- `quantum_mc.benchmark_failed`
- `pine_export.compile_started`
- `pine_export.compile_completed`
- `pine_export.exportability_rejected`

---

## 23. Error Handling

## 23.1 Quantum MC errors

Handle explicitly:
- missing classical baseline
- unsupported problem type
- unsupported uncertainty model
- invalid rule profile
- backend unavailable
- state-preparation failure
- tolerance comparison failure

## 23.2 Pine export errors

Handle explicitly:
- strategy not qualified
- strategy not exportable
- unsupported logic depth
- missing session profile
- missing risk model
- template generation failure

Errors must be normalized and persisted in status records.

---

## 24. Phase Plan

## Phase 1 — Minimum viable build

### Quantum MC
- add uncertainty model bridge
- support `breach_probability`
- support `ruin_probability`
- implement `iae`
- exact simulator only
- add benchmark persistence
- challenger-only governance labels

### Pine
- add exportability scoring
- add indicator export
- add alert pack export
- add prop-risk overlay export
- no strategy shell unless simple

### Acceptance criteria
- one qualified strategy can run classical vs quantum breach comparison
- one qualified strategy can export a private TradingView indicator + alerts
- artifacts persist in DB

## Phase 2 — Expanded risk lab

### Quantum MC
- add `target_hit_probability`
- add `tail_loss_probability`
- add noisy simulator mode
- add regime-bucket model

### Pine
- add optional strategy shell
- add more overlay modes
- add multi-session templates

## Phase 3 — Hardening

### Quantum MC
- add reproducibility dashboards/logging improvements
- add benchmark trend analysis
- add optional GPU-accelerated circuit simulation if environment supports it

### Pine
- improve template library
- add instrument-specific packs
- add artifact versioning rules

---

## 25. Acceptance Criteria

## 25.1 Quantum MC

A build is acceptable only if:

1. classical Monte Carlo still runs unchanged
2. quantum run can be attached to a classical MC result
3. quantum output is benchmarked against classical baseline
4. run metadata is persisted completely
5. unsupported jobs fail cleanly and visibly
6. governance labels prevent accidental authoritative use

## 25.2 Pine export

A build is acceptable only if:

1. only qualified strategies can be exported
2. exportability score is computed and persisted
3. indicator artifacts compile from template without manual editing for supported strategies
4. alert definitions are generated automatically
5. prop-risk overlay values are present in output
6. export README explains reductions and limitations

---

## 26. Security and Safety Constraints

1. Trading Forge is private/personal; all exported Pine scripts should default to **private use assumptions**.
2. Never embed secrets, keys, or private DB identifiers in artifacts.
3. Never imply Pine strategy shell results are equivalent to authoritative Forge backtests.
4. Never let experimental quantum outputs silently drive live decisions.
5. All artifact generation must be deterministic for identical normalized input where possible.

---

## 27. Implementation Priorities for Claude Code

### Priority 1
- add DB tables
- add normalized request/response schemas
- add `quantum_models.py`
- add `prop_survival_model.py`
- add `quantum_mc.py` phase-1 problems
- add route/service wiring

### Priority 2
- add `exportability.py`
- add `pine_compiler.py`
- add base Pine templates
- add route/service wiring for export

### Priority 3
- add benchmarks
- add snapshots/golden tests
- add README export output
- add structured logs and status persistence hardening

---

## 28. Deliverables Required from Claude Code

Claude Code should return:

1. all new migrations
2. all new Python modules
3. all new TypeScript route/service/schema files
4. tests for both subsystems
5. sample compiled Pine artifact for one dummy qualified strategy
6. one sample hybrid classical vs quantum benchmark JSON
7. implementation notes listing assumptions and any blocked areas

---

## 29. Explicit Build Rules

1. Do not remove or degrade existing classical Monte Carlo flows.
2. Do not create vague placeholders without real schemas.
3. Do not silently simplify strategy logic during Pine export; log all reductions.
4. Do not make quantum results authoritative by default.
5. Do not create UI-first code. This build is backend and artifact first.
6. Do not hardcode one prop firm only; use normalized prop profiles.
7. Keep the architecture modular so additional estimators/export targets can be added later.

---

## 30. Simple Internal Positioning

### What this is
- hybrid risk intelligence layer
- prop survival challenger lab
- Pine deployment compiler for passed strategies

### What this is not
- magic alpha engine
- quantum prediction system
- Pine-native source of truth

---

## 31. Final Build Intent

The end state should look like this:

1. Trading Forge generates and qualifies a futures strategy.
2. The strategy passes backtest, walk-forward, classical Monte Carlo, and prop-compliance gates.
3. A quantum challenger can estimate breach/ruin/tail-risk on top of the same prop boundaries.
4. The system stores benchmark evidence.
5. If the strategy is exportable, Trading Forge compiles a private Pine indicator + alert pack + risk overlay.
6. The user can deploy the strategy visually in TradingView while Trading Forge remains the research authority.

That is the target system.

