# Trading Forge — Project Conventions

## Mission
Trading Forge is a fully autonomous strategy research lab. The System Map
(`Trading Forge System Map v2.md`) is the source of truth for all subsystems.

The mission:
1. Enterprise-grade automation — every step collects data, every handoff is tracked
2. Self-evolving — the system gets smarter as data accumulates (DeepAR auto-graduates,
   critic loop improves strategies, strategy memory learns from failures)
3. Zero loop leaks — the lifecycle pipeline has no bugs, errors, or silent failures
4. Human controls deployment ONLY — you decide what strategies go to TradingView.
   Everything else is autonomous.
5. The system map must always be current. After architecture changes, run
   `npm run system-map:sync` and keep CI passing with `npm run system-map:check`.
6. n8n is part of Trading Forge automation. Current Trading Forge workflows in
   live n8n are first-class automation components, not external/non-core.
   Archived Trading Forge workflows are excluded from the active inventory.

Agents: reference the System Map for architecture details. CLAUDE.md covers
conventions, constraints, and patterns.

## What This Is
Autonomous futures/derivatives strategy research lab. Single user (swayz032).
Fully automated research -> validation -> paper trading pipeline.
Human controls TradingView deployment only. Not a SaaS product.

## Strategy Lifecycle (Automated)
CANDIDATE -> TESTING -> PAPER -> DEPLOY_READY -> DEPLOYED -> DECLINING -> RETIRED -> GRAVEYARD

Automated transitions (every 6h scheduler check):
- CANDIDATE -> TESTING: forgeScore >= 50, tier 1/2/3, backtest + WF complete
- TESTING -> PAPER: MC survival > 70%, prop compliance >= 1 firm
- PAPER -> DEPLOY_READY: 30+ days paper, rolling Sharpe >= 1.5
- DEPLOY_READY -> DEPLOYED: **HUMAN ONLY** (POST /api/strategies/:id/deploy)
- DEPLOYED -> DECLINING: Rolling Sharpe < 1.0 (inline check every 4h)
- DECLINING -> RETIRED: Evolution fails or max attempts
- Any -> GRAVEYARD: Catastrophic failure, compliance violation, kill signal

The system NEVER auto-deploys. You choose what goes to TradingView.

## Tech Stack
- **API Server**: Express.js 5 + TypeScript (src/server/)
- **Database**: PostgreSQL + Drizzle ORM
- **Backtest Engine**: Python + vectorbt + Polars + DuckDB (src/engine/)
- **AI Agents**: TypeScript + Ollama (src/server/services/agent-service.ts, src/server/routes/agent.ts)
- **AI Models**: Ollama (qwen3-coder:30b, deepseek-r1:14b, nomic-embed-text) + GPT-5-mini (cloud)
- **DeepAR**: GluonTS PyTorch (regime forecasting, local)
- **Cloud Quantum**: IBM Quantum Platform + AWS Braket (autonomous pre-deploy validation with automatic classical fallback)
- **Dashboard**: React + Vite + TailwindCSS (src/dashboard/)
- **Data Lake**: AWS S3 (Parquet files)
- **Data Providers**:
  - **Databento** -- Institutional-grade historical tick/futures data ($125 credits)
  - **Massive** -- Free real-time WebSocket streaming (currencies, indices, options, stocks)
  - **Alpha Vantage** -- 60+ technical indicators, news/sentiment API, MCP support
- **Orchestration**: n8n (external, local, Docker Compose in `docker-compose.local-ai.yml`)
- **n8n automation rule**: Current Trading Forge workflows in live n8n are part
  of the autonomous system surface and must be reflected in the system map.
  Do not classify them as external/non-core. Exclude archived Trading Forge
  workflows from the active workflow inventory.
- **Strategy Scout**: OpenClaw + Ollama (autonomous research -- Brave Search, Reddit MCP, Tavily, YouTube MCP, Academic MCP)
- **AI Lab**: Ollama + n8n + OpenClaw + Trading Forge loop (see System Map section 2-3)
  - Custom Modelfile: `ollama/Modelfile.trading-quant` (Qwen2.5-Coder:14b tuned for vectorbt)
  - Critic model: deepseek-r1:14b (fast analysis loop), GPT-5-mini (depth critique)
  - Webhooks: `/api/agent/run-strategy`, `/api/agent/critique`, `/api/agent/batch`, `/api/agent/scout-ideas`

## Commands
- `npm run dev` -- Start Express server with hot reload
- `npm run db:generate` -- Generate Drizzle migrations
- `npm run db:migrate` -- Run Drizzle migrations (0027+ for DeepAR + cloud)
- `npm run db:studio` -- Open Drizzle Studio
- `npm test` -- Run vitest
- `npm run lint` -- ESLint

## Code Conventions
- TypeScript strict mode, ES modules
- Use Drizzle query builder, not raw SQL
- All API routes return JSON
- Auth: simple Bearer token (API_KEY env var), skip in dev
- Logging: pino (structured JSON in prod, pretty in dev)
- Python: type hints, pydantic for configs

## Project Structure
```
src/
+-- server/           # Express API
|   +-- index.ts      # Entry point
|   +-- routes/       # Route handlers (one file per domain)
|   +-- db/           # Drizzle schema + migrations
|   +-- services/     # Business logic
|   +-- middleware/    # Auth, logging, etc.
|   +-- scheduler.ts  # Cron jobs (lifecycle, decay, DeepAR, pre-market)
+-- engine/           # Python backtest + Monte Carlo + DeepAR + quantum
+-- data/             # Data pipeline scripts
+-- agents/           # AI research agents + prompt files
+-- dashboard/        # React frontend
models/               # Trained ML models (DeepAR, gitignored)
```

## DeepAR Regime Forecaster
- **Engine:** GluonTS DeepAR (PyTorch, local, $0/month)
- **Files:** `src/engine/deepar_forecaster.py`, `deepar_regime_classifier.py`
- **Service:** `src/server/services/deepar-service.ts`
- **Routes:** `/api/deepar/*` (forecast, accuracy, train, predict)
- **Schedule:** Train 2:30 AM ET, Predict 6:00 AM ET, Validate 6:30 AM ET
- **Governance:** `challenger_only` -- weight starts 0.0, auto-graduates
- **Graduation:** Shadow (60d) -> Challenger 0.05 -> Validated 0.10
- **Demotion:** hit_rate < 0.50 for 30d -> weight 0.0
- **Feeds into:** Bias engine, skip engine (#11), structural targets, critic optimizer
- Agents MUST treat DeepAR output as experimental until weight > 0

## Cloud Quantum Integration
- **IBM Quantum:** 4 backends (133-156 qubits), free tier (10 min/month QPU)
- **AWS Braket:** IonQ Forte 1 QPU, SV1/TN1/dm1 simulators, $30/month cap
- **Abstraction:** `src/engine/cloud_backend.py` (budget tracker, fallback chain)
- **Two-gate safety:** `QUANTUM_CLOUD_ENABLED=true` in env AND `opt_in_cloud=true` per request
- **Budget:** Hard-stops prevent overspend (IBM 600s, Braket $30)
- **Governance:** Cloud doesn't change authority -- all quantum remains `challenger_only`
- Auto-triggered backtest quantum runs stay LOCAL. Cloud is opt-in only.

## DSL Archetype Fixtures (W5a / Tier 5.5)

Three human-authored strategy archetypes expressed as JSON config consumed by the existing
DSL compiler. Located at `src/engine/strategies/dsl_fixtures/`. These are config-as-data,
not Python modules.

### DSL Fixture Pattern
- Fixtures must conform exactly to `StrategyDSL` (Pydantic, `extra="forbid"`)
- Valid fields: `name`, `symbol`, `timeframe`, `direction`, `entry_type`, `entry_indicator`,
  `entry_params`, `entry_condition`, `exit_type`, `exit_params`, `stop_loss_atr_multiple`,
  `take_profit_atr_multiple`, `max_contracts`, `preferred_regime`, `session_filter`,
  `chart_construction`, `source`, `tags`, `schema_version`, `description`,
  `profit_scaling_tier`, `daily_target_dollars`
- `profit_scaling_tier` -- W5a Team A sizing integration, **wired** as
  `Optional[ProfitScalingTier]` in `strategy_schema.py`. Fixtures emit
  `{"increment": 2, "threshold": 3000}`; `account_pnl_total` is injected at
  backtest-run time, never in the fixture. The legacy
  `profit_scaling_tier_pending` placeholder tag has been retired.
- `daily_target_dollars` -- archetype-level daily P&L target (informational),
  optional Optional[float] >= 0. Currently consumed by paper automation
  telemetry only (no gate logic).
- `hard_sl_points` / `trail_config` / `contracts` are not first-class DSL
  fields -- use `stop_loss_atr_multiple`, `exit_params`, and `max_contracts`
  as the schema equivalents. Trail-stop W5b extensions (`break_even_at_r`,
  `time_decay_minutes`, `time_decay_multiplier`) belong inside `exit_params`
  and are translated through to `paper-signal-service.ts:TrailStopConfig`
  by `dsl-translator.ts`.

### Archetype Descriptions

**scalper_mes.json** -- Fast scalp, MES, 5m, both directions
- Target regime: `RANGE_BOUND` (choppy, intraday oscillation)
- Entry: `atr_breakout` (period=14, multiplier=1.5)
- Exit: `atr_multiple` (1.8x), tight stop at 1.2x ATR
- Max contracts: 5 | RTH only

**trend_mnq.json** -- Trend-follow workhorse, MNQ, 15m, both directions
- Target regime: `TRENDING` (directional momentum)
- Entry: `ema_crossover` (fast=9, slow=21, confirmation=2 bars)
- Exit: `trailing_stop` (2.0x ATR trail, break-even at 1:1R, 20-min time-decay to 0.75x)
- Max contracts: 10 | RTH only
- Gemini blueprint "outside predatory hunt zone" stop (1.8x ATR), 10-contract size per blueprint

**heavy_mcl.json** -- Heavier trend-follow, MCL crude oil, 15m, both directions
- Target regime: `TRENDING` (directional with expansion)
- Entry: `keltner_squeeze` (bb_period=20, kc_period=20, kc_multiplier=1.5)
- Exit: `trailing_stop` (2.5x ATR trail -- wider for oil session noise)
- Max contracts: 8 | RTH only
- Wider trail (2.5x) per Gemini ATR analysis for crude oil intraday noise

### Market Correlation Note
MES (S&P micro), MNQ (Nasdaq micro), MCL (crude oil micro) chosen for correlation < 0.3
on daily returns (equity vs energy). Aggregate max_contracts: 5+10+8 = 23, within 50K
account composite ceiling. Safe to deploy all three simultaneously.

### Schema Extension (SHIPPED — Cleanup Team D)
`ProfitScalingTier` and `daily_target_dollars` are now first-class fields on
`StrategyDSL`. See `src/engine/compiler/strategy_schema.py`. Field name
`profit_scaling_tier` matches Team A's `compute_position_sizes()` parameter.
`account_pnl_total` is intentionally NOT a fixture field — it is injected at
backtest-run time from live single-account PnL.

## Gemini Quantum Blueprint Feature Flags (W1 / Tier 0.3)
All flags default OFF (shadow). They control phased rollout of quantum
modules built in W2-W4. Kill switch: `unset $VAR && systemctl restart`.

- **`QUANTUM_QAE_GATE_PHASE`** -- 0/1/2 (default 0). Phase 0 = shadow (read both
  classical + quantum, log agreement, gate is 100% classical). Phase 1 =
  advisory disagreement alerts. Phase 2 = quantum participates in the gate.
  Wave 7 graduation flips the value after 30+ days of agreement data.
- **`QUANTUM_ENTROPY_FILTER_ENABLED`** -- default false. Enables Tier 3.1 QCNN
  noise score in skip engine. When false, `noise_score` is None and skip
  engine ignores the slot. **SHIPPED W3a.** Module: `src/engine/quantum_entropy_filter.py`.
  Architecture: 8-qubit QCNN (2 conv layers + 1 pooling layer, 37 gate ops).
  Output: `noise_score ∈ [0,1]`. Integrated into `premarket_analyzer.py` —
  adds `quantum_noise_score` to signals dict when flag is true.
  PennyLane 0.44.1 required; classical fallback returns None (skip engine
  continues with score 0.0 via `_score_quantum_entropy`).
  Performance: ~6ms wall-clock on CPU (default.qubit).
  **Cost telemetry (W3a deferred, SHIPPED):** Each `collect_quantum_noise()` call
  POSTs to `POST /api/quantum/cost` (1s timeout, fire-and-forget, never raises).
  This writes a `quantum_run_costs` row with `moduleName="entropy_filter"`, enabling
  Tier 7 graduation queries. Route: `src/server/routes/quantum-cost.ts`.
  The `requests` import is lazy (inside the helper) to preserve module isolation.
  W3b dependency: A+ Market Auditor reads `skip_decisions.signals.quantum_noise_score`
  per market per day — **WIRED (W3b deferred, SHIPPED):** `enrichWithPerMarketNoise()`
  in `a-plus-auditor-service.ts` queries `skip_decisions JOIN strategies WHERE symbol=?
  AND created_at > NOW()-6h` before each Python auditor call. Caller-provided
  `noise_score` is preserved (no DB query). Falls back to null per market on DB error.

  **Tier 3.1 Threshold Calibration Plan:**
  Placeholder threshold: `QUANTUM_NOISE_THRESHOLD = 0.5` (in `quantum_entropy_filter.py`).
  TODO (calibrate after 30 days of skip_decisions data):
    1. Query `skip_decisions.signals` for rows where `quantum_noise_score IS NOT NULL`.
    2. Label each row as "wick-out day" (price spiked + reversed within 1 ATR that session)
       by joining against intraday Parquet from S3.
    3. Build precision/recall curve over threshold range [0.3, 0.7] in 0.05 steps.
    4. Pick threshold that maximizes precision at >= 80% recall.
    5. Update `QUANTUM_NOISE_THRESHOLD` in `quantum_entropy_filter.py` and rerun
       `src/engine/tests/test_quantum_entropy_filter.py` to confirm no regressions.
    6. Also refit `_FEATURE_STATS` normalization means/stds using the 30-day sample.
  Target calibration date: ~2026-06-01 (30 days after entropy filter goes live).
- **`QUANTUM_COUNTERFACTUAL_ENABLED`** -- default false. Tier 3.2 deferred per
  architect review; flag reserved for future revival.
- **`QUANTUM_GRAVEYARD_QUBO_ENABLED`** -- default false. Enables Tier 2 SQA
  graveyard-aware penalty in `quantum_annealing_optimizer.build_parameter_qubo()`.
- **`QUANTUM_AMARKET_AUDITOR_ENABLED`** -- default false. Enables Tier 3.3
  A+ Market Auditor cron + cross-market lead-lag entanglement.
  **SHIPPED W3b.** Module: `src/engine/a_plus_market_auditor.py`.
  Service: `src/server/services/a-plus-auditor-service.ts`.
  Route: `POST /api/auditor/scan`, `GET /api/auditor/latest`.
  Schedule: 8:00 AM ET daily (Mon-Fri), cron job `a-plus-auditor-scan`.
  DB table: `a_plus_market_scans` (migration 0067). Pending-row contract.
  Cost telemetry: `quantum_run_costs` with `moduleName="a_plus_auditor"`.
  Architecture:
    - Per-market: volatility audit (ATR ratio) + P(hit 1:2 reward) + noise score (W3a)
    - Cross-market: 4-qubit VQC {MES=q0, MNQ=q1, MCL=q2, DXY=q3}
      Encoding: 60-min rolling correlation matrix → RY + CNOT fan-out
      CNOT topology: MES→MNQ (equity lead-lag), MNQ→DXY (tech-dollar), MES→MCL (risk)
      Readout: PauliZ on each qubit → lead_market (highest Z), entanglement_strength
    - Edge Score: 0.40*vol + 0.40*p_target + 0.10*(1-noise) + 0.10*entanglement
    - Winner: highest edge_score AND p_target_hit > 0.75 AND noise_score < 0.50
    - OBSERVATION_MODE: no winner → skip all strategies for the day
    - Lead-lag bonus: if winner is lagging market AND entanglement_strength > 0.70,
      publish lead_market field; strategies opt-in via DSL `require_lead_market_confirmation`
  Fallbacks: PennyLane unavailable → entanglement falls back to classical correlation
    proxy; noise unavailable → neutral 0.5; edge score always computes.
  Performance: full 3-market scan ~8-15ms wall-clock on CPU (default.qubit).
  **PROP FIRM COMPLIANCE HANDOFF (CLOSED — W5b Tier 5.3.1 SHIPPED):**
    Tier 3.3 produces the SIGNAL only. Cross-market lead-lag signal source ≠ traded
    instrument. Prop firms BAN simultaneous correlated positions (MNQ + MES together
    = position-limit-bypass violation). Enforcement is now LIVE in:
    - `src/engine/compliance/compliance_gate.py:check_correlated_position_guard()` (Python)
    - `src/server/services/correlated-position-guard.ts:checkCorrelatedPositionGuard()` (TS)
    - `src/engine/compliance/correlation_matrix.yaml` — threshold 0.70, pairs MES/MNQ/MCL/etc.
    paper-signal-service.ts queries ALL open positions cross-session and calls the TS guard
    BEFORE anti-setup gate on every new entry signal. Blocked signals are logged to
    paper_signal_logs with signalType="correlated_position_blocked".
    Sequential rule: lead-market position must be CLOSED before lagging-market entry fires.
    The `complianceHandoff` key in POST /api/auditor/scan response surfaces this note.
    Tests: 20 TS + 19 Python covering symmetry, sequential close, empty positions, unknown pairs.
  SSE event: `a-plus-auditor:scan-complete` on every completed scan.
- **`QUANTUM_ADVERSARIAL_STRESS_ENABLED`** -- default false. Enables Tier 3.4
  Grover worst-case sequencer pre-PAPER promotion check. **SHIPPED W3b.**
  Module: `src/engine/quantum_adversarial_stress.py`.
  Algorithm: Grover search over N trade orderings (N qubits, 8-15 max).
  Oracle: marks orderings where any rolling loss window exceeds daily_loss_limit.
  Outputs: `worst_case_breach_prob ∈ [0,1]`, `breach_minimal_n_trades`,
  `worst_sequence_examples` (top-K breach orderings).
  Classical fallback: N <= 12 -> brute-force 2^N; N > 12 -> 10K random samples.
  PennyLane 0.44.1 required; falls back to classical on import failure.
  Cost ceiling: 30s hard wall-clock abort (ThreadPoolExecutor TimeoutError).
  Scope: TIER_1 and TIER_2 strategies only (TIER_3 skipped — too noisy).
  Table: `adversarial_stress_runs` (migration 0066).
  Service: `src/server/services/adversarial-stress-service.ts`.
  Route: POST /api/adversarial-stress/run (pipeline pause guard: 423 when paused).
  Lifecycle: TESTING->PAPER gate reads adversarial stress evidence (Phase 0 shadow).

  **Phase 0 (W3b, current):** Shadow only. Runs and persists results.
  Lifecycle gate is 100% classical. Phase 1 block rule is evaluated and logged
  but NEVER enforced. Disagreement always logged at WARN level.

  **Phase 1 decision rule (W7b Day 52 — NOT NOW):**
  If `worst_case_breach_prob > 0.5` AND `breach_minimal_n_trades < 4` ->
  BLOCK TESTING->PAPER promotion. Meaning: strategy can be killed by 3 losses
  in a row -> prop firm `maximum_consecutive_losers: 4` gate fires.
  Graduation from Phase 0 -> Phase 1 requires 30+ days of shadow data and
  explicit W7b graduation review.

  **W7b Grover graduation (Day 52, not Day 30):**
  Day 52 (not Day 30 like QAE) because adversarial stress runs are more expensive
  and the graduation evidence window must cover a full month of TESTING->PAPER
  transitions. Canonical query and decision rule:
  see "Tier 7 W7b Graduation Query Pattern" section below.

  **Worst-case vs average-case distinction:**
  QAE (Tier 1.1) answers average-case breach probability. Adversarial stress
  (Tier 3.4) answers worst-case: can an adversary with full ordering knowledge
  engineer a breach? A strategy passing both is robust to both market noise
  AND trade-sequence luck. Strategies that only pass QAE may still be vulnerable
  to the prop firm failure mode of 5 losers in a row in the worst order.
- **`QUANTUM_CUQUANTUM_GPU_ENABLED`** -- default false. Enables Tier 4 cuQuantum
  GPU acceleration. **SHIPPED W4.** Default OFF — no behavior change unless
  explicitly enabled. When true, modules use `select_quantum_device()` to
  probe VRAM before selecting `lightning.gpu`; CPU fallback is mandatory and
  automatic when VRAM is insufficient or the GPU is unavailable.

  **Modules:**
  - `src/engine/quantum_device_selector.py` — `select_quantum_device(n_qubits, prefer_gpu=True) -> str`
    Returns `"lightning.gpu"` or `"default.qubit"`. Advisory only. No execution authority.
  - `src/engine/hardware_profile.py` — `probe_vram(required_mb) -> bool`
    Probes GPU 0 via pynvml (primary) or nvidia-smi (fallback). Never raises.

  **VRAM formula (per plan):** `required_mb = int(2 ** (n_qubits - 3) + 200)`
  Safety margin of +500 MB is applied inside `probe_vram`, not by callers.

  **RTX 5060 cap:** n_qubits > 25 always falls back to CPU. State-vector for
  25+ qubits requires ~4 GB+ and would OOM the 5060's 8 GB frame buffer.

  **Fallback chain (in order):**
  1. `prefer_gpu=False` → `"default.qubit"`
  2. `QUANTUM_CUQUANTUM_GPU_ENABLED != true` → `"default.qubit"`
  3. `n_qubits > 25` → `"default.qubit"` + WARNING log
  4. `probe_vram(required_mb)` returns False → `"default.qubit"`
  5. All checks pass → `"lightning.gpu"`

  **Wired modules (W4):**
  - `quantum_entropy_filter.py` (8 qubits) — replaces W3a CPU-only stub
  - `quantum_adversarial_stress.py` (8-15 qubits) — replaces raw try/except
  - `a_plus_market_auditor.py` (4 qubits VQC) — replaces hardcoded "default.qubit"
  - `quantum_mc.py` (AerSampler) — GPU backend_options when probe passes

  **Performance (env flag false):** output IDENTICAL to pre-W4. No behavior
  change when flag is off — all quantum module outputs are deterministic and
  reproducible on CPU as before.

  **Tests:**
  - `src/engine/tests/test_quantum_device_selector.py` — 26 tests (isolation,
    schema, GPU path, qubit cap, prefer_gpu override, VRAM fallback)
  - `src/engine/tests/test_hardware_profile.py` — 18 tests (probe_vram coverage)

- **`QUANTUM_CLOUD_ENABLED`** -- default false. Master gate for all IBM QPU submissions.
  Must be set to `"true"` to enable Tier 4.5 cloud_qmc enrichment. Without this flag,
  all cloud submissions are silently skipped and lifecycle promotion is unaffected.
  **SHIPPED W4 (Tier 4.5).** Kill switch: `unset QUANTUM_CLOUD_ENABLED && restart`.

## IBM Quantum Cloud Integration (Tier 4.5 W4 — Ising Decoder)
**Shadow-only. Never blocks promotion. Challenger evidence only.**

Architecture:
  - Strategy passes classical TESTING→PAPER gate → Lifecycle promotes to PAPER IMMEDIATELY
  - AFTER promotion commits, async fire-and-forget: `enqueueCloudQmcRun()` writes
    a `cloud_qmc_runs` row (status="queued") and submits to IBM Heron QPU
  - Async cloud worker polls IBM job status every 5 min via `cloud-qmc-poll` cron
  - On completion: Ising decoder decodes syndromes → persists to cloud_qmc_runs
  - Tier 7 measurement loop reads cloud_qmc_runs over 90 days to evaluate predictive value

**IBM Backend credentials (required to enable):**
```bash
export IBM_QUANTUM_TOKEN=<your-token>       # From https://quantum.ibm.com/account
export QUANTUM_CLOUD_ENABLED=true           # Master gate — both must be set
```
Without these, all cloud submissions are skipped and promotion is unaffected.

**Budget allocation:**
- 600s/month total IBM QPU budget — ALL reserved for Ising-encoded IAE runs
- Pessimism factor 2x: each 60s estimated run consumes 120s of budget capacity
- Allows ~5 runs/month before budget_exhausted
- `GET /api/cloud-qmc/budget` — check remaining budget

**IBM backends (156-qubit Heron R2):**
- ibm_fez (primary), ibm_kingston (fallback), ibm_marrakesh (fallback)
- Backend rotation: fez → kingston → marrakesh on errors
- 5-minute hard cap per job (prevents stuck queue from consuming budget)

**Surface code:**
- d=3 rotated surface code: 9 data + 8 ancilla = 17 physical qubits per logical
- 5 logical qubits → 85 physical (fits 156-qubit Heron with margin)
- Circuit: syndrome extraction only (tractable NISQ proxy — not full fault-tolerant simulation)

**Ising decoder:**
- Primary: `Ising-Decoder-SurfaceCode-1-Fast` (HuggingFace, ONNX → TensorRT FP8 on RTX 5060)
- Fallback: PyMatching (classical MWPM, always available)
- If model not downloaded: automatic PyMatching fallback, no error

**Files (W4 Tier 4.5):**
- `src/engine/surface_code_encoder.py` — d=3 rotated surface code circuit builder
- `src/engine/ising_decoder_wrapper.py` — Ising ONNX + TensorRT + PyMatching fallback
- `src/server/services/cloud-qmc-service.ts` — orchestrator (enqueue, poll, query helpers)
- `src/server/routes/cloud-qmc.ts` — POST /api/cloud-qmc/trigger, GET /status/:id, GET /budget
- `src/server/db/migrations/0068_cloud_qmc_runs.sql` — cloud_qmc_runs table + FK to lifecycle_transitions

**Governance:**
- cloud_qmc_runs.governance_labels.decision_role = "challenger_only" on ALL rows
- Promotion is never held for IBM job completion
- QUANTUM_CLOUD_ENABLED=false (default) → zero IBM submissions, classical promotion unchanged
- Lifecycle transitions.cloud_qmc_run_id links enrichment rows to promotion events for Tier 7

**Routes:**
- `POST /api/cloud-qmc/trigger` — manual trigger (pipeline pause guard: 423 when paused)
- `GET /api/cloud-qmc/status/:strategyId` — list recent cloud_qmc_runs
- `GET /api/cloud-qmc/budget` — IBM QPU budget status
- `POST /api/cloud-qmc/poll` — manual poll trigger (normally run by cloud-qmc-poll cron)

**Tests:**
- `src/engine/tests/test_surface_code_encoder.py` — isolation, geometry, reproducibility, failure
- `src/engine/tests/test_ising_decoder_wrapper.py` — isolation, fallback, schema, edge cases
- `src/server/__tests__/cloud-qmc-service.test.ts` — governance, budget guard, backend rotation,
  lifecycle integration, pipeline guard, pending-row contract, golden-file regression

## Lifecycle Telemetry Tables (W1 / Tier 0)
Two new tables ship in W1 to unblock Tier 7 quantum graduation queries:

- **`lifecycle_transitions`** (migration 0064) -- typed lifecycle history with
  first-class quantum challenger evidence columns
  (`quantum_agreement_score`, `quantum_advantage_delta`,
  `quantum_classical_disagreement_pct`, `quantum_fallback_triggered`,
  `cloud_qmc_run_id`). Dual-written alongside `audit_log` rows by
  `lifecycle-service.ts` inside the same transaction. Indexed for
  high-volume "low-agreement strategies over 30 days" queries.
- **`quantum_run_costs`** (migration 0065) -- per-run wall-clock + (if cloud)
  QPU-seconds + dollars for every quantum module
  (quantum_mc, sqa, rl_agent, entropy_filter, adversarial_stress,
  cloud_qmc, ising_decoder). Pending-row contract: status starts "pending",
  updated to "completed"/"failed" on resolve.

  Cost-benefit query for Tier 7 graduation:
  ```sql
  SELECT module_name,
         count(*) AS runs,
         avg(wall_clock_ms) AS avg_ms,
         sum(cost_dollars::numeric) AS total_dollars,
         sum(qpu_seconds::numeric) AS total_qpu_sec,
         count(*) FILTER (WHERE status = 'completed') AS completed,
         count(*) FILTER (WHERE status = 'failed') AS failed,
         count(*) FILTER (WHERE cache_hit) AS cache_hits
  FROM quantum_run_costs
  WHERE created_at > now() - interval '30 days'
  GROUP BY module_name
  ORDER BY module_name;
  ```

  Pruning: hourly cron `quantum-cost-prune` (registered in scheduler) +
  on-startup one-shot. Pending rows older than 1 hour are flipped to
  `status="failed"`, `errorMessage="stale_pending_pruned"`.

## Tier 7 W7b Graduation Query Pattern

The Phase 0 → Phase 1 graduation review for the Grover adversarial-stress gate
(W7b Day 52) is **a query, not a code change**. The query joins
`adversarial_stress_runs` (the shadow predictions) through `backtests`
(the strategy/run linkage) into `lifecycle_transitions` (the actual
TESTING→PAPER promotions), then left-joins `paper_sessions` to read the
real-world outcome that followed each promotion.

If the strategies the Phase 1 rule **would have blocked** show worse paper
outcomes than the strategies it **would have passed**, the Grover prediction
correlates with reality and we graduate. Graduation is mechanical: flip
`governance_state.grover_weight` from 0.0 → 0.05 and let the lifecycle gate
honor it.

**Phase 1 block rule:** `worst_case_breach_prob > 0.5` AND
`breach_minimal_n_trades < 4`. Background and rationale are in the
`QUANTUM_ADVERSARIAL_STRESS_ENABLED` flag block above (Worst-case vs
average-case distinction).

```sql
-- W7b Day 52: Grover Phase 0 → 1 graduation evaluation.
-- Joins adversarial_stress_runs through backtests through lifecycle_transitions
-- so we can compare each shadow prediction to the paper outcome that followed.
SELECT
  s.name AS strategy_name,
  asr.worst_case_breach_prob,
  asr.breach_minimal_n_trades,
  lt.from_state,
  lt.to_state,
  lt.created_at AS promotion_date,
  -- Phase 1 recommendation (would-have, never enforced in Phase 0)
  CASE
    WHEN asr.worst_case_breach_prob > 0.5
     AND asr.breach_minimal_n_trades < 4 THEN 'WOULD_HAVE_BLOCKED'
    ELSE 'WOULD_HAVE_PASSED'
  END AS phase1_recommendation,
  ps.outcome AS actual_paper_outcome
FROM adversarial_stress_runs asr
JOIN backtests bt              ON asr.backtest_id = bt.id
JOIN lifecycle_transitions lt  ON lt.backtest_id = bt.id
JOIN strategies s              ON lt.strategy_id = s.id
LEFT JOIN paper_sessions ps    ON ps.strategy_id = s.id
                              AND ps.created_at > lt.created_at
WHERE lt.from_state = 'TESTING'
  AND lt.to_state   = 'PAPER'
  AND lt.created_at > NOW() - INTERVAL '30 days';
```

**Graduation decision:**
- Compute `bad_outcome_rate(WOULD_HAVE_BLOCKED)` vs `bad_outcome_rate(WOULD_HAVE_PASSED)`.
- "Bad outcome" = `paper_sessions.outcome IN ('killed', 'rule_breach', 'drawdown_breach')`.
- If `bad_rate(BLOCKED) > bad_rate(PASSED) + 0.10` AND sample size ≥ 20
  promotions per bucket → the gate would have improved outcomes → graduate.
- Set `governance_state.grover_weight = 0.05` in the same transaction that
  flips `QUANTUM_ADVERSARIAL_STRESS_ENABLED` Phase 0 → Phase 1.
- If sample size is too small or the rate gap is < 0.10, leave the gate in
  Phase 0 and re-run the query in 30 days.

**Cost gate (read alongside this query, not in it):**
Use the `quantum_run_costs` cost-benefit query (above, in this section) with
`module_name = 'adversarial_stress'`. If average wall-clock >
`adversarial_stress.timeout_ms` per run or budget burn-rate is unsustainable,
graduation is **blocked regardless of predictive value** — the gate has to
both work AND fit the cost envelope.

**Why this is documentation, not a script:**
Day 52 graduation is a deliberate, human-reviewed event. Encoding it as an
auto-cron risks flipping the gate during a low-data window or under a
regime shift. The query is canonical, the decision is not.

## Profit-Based Position Scaling (W5a / Tier 5.4)
Gemini "Forge-Tested" 2026 Edition: every $3,000 of cumulative profit = +2 micro
contracts added to the position size. Single-account compounding only.

**CLAUDE.md constraint:** ONE account must be profitable. `compute_profit_tier()`
is single-account only — do NOT aggregate PnL across multiple accounts.

**Module:** `src/engine/sizing.py`
- `compute_profit_tier(account_pnl_total, base_contracts, increment=2, threshold=3000, firm_max=None) -> int`
- Formula: `tier_count = floor(pnl / threshold); extra = tier_count * increment; final = min(base + extra, firm_max)`
- Negative PnL -> tier_count=0 (no scaling). Zero PnL -> no scaling.
- Result is always an int, always >= base_contracts, always <= CONTRACT_CAP_MAX (20).
- `compute_position_sizes()` now accepts optional `profit_scaling_tier: dict | None = None`.
  When None (default) -> behavior is 100% identical to pre-Tier-5.4 (backwards-compatible).
  When provided: `{"increment": 2, "threshold": 3000, "account_pnl_total": <float>}`

**Per-firm cap behavior:**
- All 8 main production firms: base cap 15, scale up to max 20 (CONTRACT_CAP_MAX)
- 3 conservative firms (top_one, yrm_prop, fundingpips): base cap 5, clamped min 10
- Profit tier never pushes result above firm's `max_contracts` (clamped to CONTRACT_CAP_MAX=20)
- Scaling applied after ATR base sizing, before return

**Audit log:** `logger.debug("sizing.profit_tier_applied ...")` fires on every
bar where extra_contracts > 0. Includes base, extra, final, firm_cap, pnl.

**Tests:** `src/engine/tests/test_profit_tier.py` (27 tests: 18 unit + 2 constraint + 7 integration)

**Team B coordination (DSL fixtures):** DSL JSON fixtures that include profit scaling
should use: `"profit_scaling_tier": {"increment": 2, "threshold": 3000}` (without
`account_pnl_total` — that is injected at backtest-run time from live account PnL).

## Quantum Pre-Flight Cache for n8n (Tier 6 / W6)

n8n workflows call this CACHE-READ-ONLY endpoint between "Parse Output" and
"Submit Backtest" to short-circuit strategies whose DSL hash already failed a
prop-firm UCI test in a prior `quantum_mc_runs` row.

- **Route:** `POST /api/quantum/pre-flight` (mounted in `src/server/index.ts`).
  Standard rate-limited only (NOT strict) because n8n submits per generated
  strategy in burst.
- **Module:** `src/server/routes/quantum-pre-flight.ts` (also exports
  `computeStrategyHash` for tests).
- **Tests:** `src/server/__tests__/quantum-pre-flight.test.ts` (14 tests).

**CRITICAL CONSTRAINTS — do not violate:**
1. This route MUST NEVER spawn quantum compute. The backtest auto-fire path at
   `backtest-service.ts:1022-1041` remains the SOLE quantum-compute trigger.
   Spawning here would cause double quantum work per logical strategy event.
2. Cache MISS returns `{cached: false, passed: true}` — proceed without
   blocking. Do NOT auto-fire QMC from this path.
3. Pipeline pause guard MANDATORY — `isActive() === false` returns
   `{cached: false, passed: true, reason: "pipeline_paused"}` so paused
   pipelines never appear as "blocked by stale cache".
4. NEVER import `runQuantumMC`, `runQuantumBreachEstimation`,
   `enqueueCloudQmcRun`, or any compute helper from this route file. The test
   suite asserts these mocks are never invoked across all code paths.

**Strategy hash:**
- `sha256(canonicalJson(dsl))` → 64-char hex
- Canonical JSON sorts object keys recursively so n8n payload-shape variations
  do NOT fragment the cache.

**UCI formula:** `UCI = estimated_value + confidence_interval.upper`
**Threshold:** env `QUANTUM_PROP_FIRM_UCI_THRESHOLD` default 0.01 (1% breach
probability ceiling).

**Cache lookup query:**
```sql
SELECT q.id, q.backtest_id, q.estimated_value, q.confidence_interval
FROM quantum_mc_runs q
JOIN backtests b ON b.id = q.backtest_id
WHERE q.status = 'completed'
  AND b.config->>'strategy_hash' = $1
ORDER BY q.created_at DESC
LIMIT 1
```

Backtests written before backtest-service starts embedding `strategy_hash`
into config produce cache misses — that's correct behavior (proceed without
blocking, do not spawn).

**Response shapes:**
```json
{ "cached": false, "passed": true,  "score": null,    "reason": "pipeline_paused" }
{ "cached": false, "passed": true,  "score": null,    "reason": "no_prior_quantum_run" }
{ "cached": false, "passed": true,  "score": null,    "reason": "cache_lookup_error" }
{ "cached": true,  "passed": true,  "score": 0.0073, "qmcRunId": "...", "reason": "uci_within_threshold" }
{ "cached": true,  "passed": false, "score": 0.0234, "qmcRunId": "...", "reason": "uci_above_threshold" }
```

**n8n workflows touched (W6):**
- `eCr7cyb0aPArFCZc` (Strategy Generation Loop) — inserted between
  "Concept Validated?" and "Submit Backtest". Block path returns to
  "Check Iteration Limit" so the AI can refine.
- `Z4NcOCDbet8KzjDd` (Nightly Strategy Research Loop) — inserted between
  "Parse Ollama Strategy Output" and "Submit Strategies for Backtest".
  Block path emits a no-op record for journaling.
- HTTP node config: `onError: continueRegularOutput`, `retryOnFail: true`,
  `maxTries: 2`, `waitBetweenTries: 1000`, `timeout: 5000`. n8n must NEVER
  hard-fail the workflow when pre-flight is unavailable — proceed to backtest.
- IF node gate: `{{ $json.cached === true && $json.passed === false }}` —
  output[0] (TRUE) = blocked, output[1] (FALSE) = proceed to Submit Backtest.

**Performance budget:**
- Cache hit p95: <200ms (single indexed JOIN query).
- Cache miss p95: <5s (same query, empty result).

**Backtest-service backlink (FUTURE — not required for Tier 6):**
For pre-flight cache HITS to start populating, `backtest-service.ts` should
embed `strategy_hash` into `backtests.config` JSONB when persisting a new
backtest. Until then, every pre-flight call returns `cached: false` and the
n8n workflow always proceeds to backtest — this is the SAFE default.

## SQA Promise Registry (W2 / Tier 1.2)
SQA fire-and-forget at `backtest-service.ts:598` is now observable to the
critic via `src/server/lib/sqa-promise-registry.ts`. Critic calls
`sqaRegistry.awaitWithTimeout(backtestId, 30s)` instead of polling DB.

- **Hard timeout:** 30s. Critic falls back to no-Optuna-seed if SQA
  hasn't completed (classical search proceeds).
- **Circuit breaker:** 3 timeouts in 10 min -> OPEN. Skips
  `awaitWithTimeout` calls entirely. Auto-closes after 1 hour cooldown.
  No HALF_OPEN probe (SQA is fire-and-forget; no probe call to send).
- **Audit log:** state changes write `quantum.sqa_circuit_breaker_open`
  and `quantum.sqa_circuit_breaker_closed` entries.
- **Restart behavior:** session-local Map cleared on restart. Critic falls
  through to existing DB single-read on registry miss. No correctness
  regression -- only loses the "race-condition optimization" for runs
  spawned before restart.

## Strategy Philosophy -- SIMPLE WINS, HIGH EARNERS
- **Max 3-5 parameters per strategy.** More = overfitting. No exceptions.
- **One-sentence rule:** If you can't describe the strategy in one sentence, it's too complex. Reject it.
- **Proven edges only:** Trend following, mean reversion, volatility expansion, session patterns. No exotic ML signals.
- **Robustness > optimization.** A strategy that works with MA=15-25 is better than one that only works with MA=17.
- **Walk-forward validation is mandatory.** No strategy passes without out-of-sample testing.
- **Signal generation is method-agnostic.** ML, tensor networks, and quantum-inspired methods are permitted IF they pass the full walk-forward + MC + OOS pipeline. The gates decide, not the method.
- Agents must REJECT strategies that require tight parameter optimization to be profitable.
- **ICT/SMC concepts are fully codified.** 54 ICT indicators and 15 ICT strategies are implemented in `src/engine/indicators/` and `src/engine/strategies/`. Agents CAN generate, test, and optimize ICT-based strategies. ICT constructs (order blocks, FVGs, breakers, sweeps, market structure) are subject to the same robustness rules as any other codified strategy.
- **ONE account must be profitable.** Agents REJECT any strategy that requires multi-account scaling to be worth trading. If a strategy can't earn serious money on a single $50K prop firm account, it's not good enough.

## Strategy Performance Requirements -- HARD MINIMUMS

> A strategy that needs 20 accounts to matter is not an edge. Every strategy Forge approves
> must be profitable enough to trade on ONE account and survive most trading days in a month.

### Minimum Performance Gates (agents MUST enforce these)

```yaml
# All metrics measured on walk-forward out-of-sample data, NOT in-sample backtests.
# ~20 trading days per month assumed.

minimum_avg_daily_pnl: $250        # $250/day x 20 days = $5,000/month gross on 1 account
minimum_monthly_gross: $5,000      # Must clear this on a single 50K account
minimum_win_rate_by_days: 0.60     # Profitable on 12+ out of 20 trading days
minimum_profit_factor: 1.75        # Winners must significantly outweigh losers
minimum_sharpe_ratio: 1.5          # Risk-adjusted returns must be strong
maximum_max_drawdown: $2,000       # Must survive tightest prop firm (Topstep 50K = $2K)
maximum_consecutive_losers: 4      # Max 4 losing days in a row (mental + drawdown survival)
minimum_expectancy_per_trade: $75  # Every trade must be worth taking
minimum_avg_winner_to_loser: 2.0   # Avg win must be 2x avg loss minimum (1:2 R:R)
```

### Performance Tiers (for ranking strategies)

```yaml
# TIER 1 -- "Bread and Butter" (deploy immediately)
tier_1:
  avg_daily_pnl: ">= $500"        # $10K+/month on one account
  win_days_per_month: ">= 14"     # 70%+ winning days
  max_drawdown: "< $1,500"        # Comfortable buffer at every firm
  profit_factor: ">= 2.5"
  sharpe: ">= 2.0"

# TIER 2 -- "Solid Edge" (deploy with monitoring)
tier_2:
  avg_daily_pnl: ">= $350"        # $7K+/month
  win_days_per_month: ">= 13"     # 65%+ winning days
  max_drawdown: "< $2,000"
  profit_factor: ">= 2.0"
  sharpe: ">= 1.75"

# TIER 3 -- "Minimum Viable" (deploy on best-fit firm only)
tier_3:
  avg_daily_pnl: ">= $250"        # $5K+/month
  win_days_per_month: ">= 12"     # 60%+ winning days
  max_drawdown: "< $2,500"
  profit_factor: ">= 1.75"
  sharpe: ">= 1.5"

# BELOW TIER 3 -- REJECT. Not worth the trader's time or prop firm fees.
```

### Why These Numbers

```
MFFU 50K account costs $77/month to evaluate.
If strategy makes $5,000/month gross:
  - Pass evaluation in ~12-15 trading days (< 1 month)
  - Funded payout: $5,000 x 0.80 = $4,000/month to you
  - ROI on $77 eval fee = 5,194% annualized
  - One account. No scaling needed. No 20-account Apex games.

If strategy only makes $500/month (the kind we REJECT):
  - Takes 6+ months to pass evaluation = $462 in fees before funding
  - Funded payout: $500 x 0.80 = $400/month
  - Barely covers the eval cost in year one
  - You'd need 10 accounts to make $4,000/month = complexity, risk, headache
```

### Daily Survival Requirement

```
20 trading days/month. Strategy must be GREEN on 12+ of them.
The trader sits down, executes the signal, and walks away profitable most days.
Not "profitable over a 3-month window" -- profitable THIS WEEK.

Agents track:
  - worst_month_win_days: Minimum winning days in any single month
  - avg_daily_pnl_on_losing_days: How bad are the red days?
  - recovery_days: After a losing day, how many days to recover?

Rules:
  - If worst_month_win_days < 10 in any month -> REJECT (too inconsistent)
  - If avg_loss_on_red_days > avg_win_on_green_days -> REJECT (losers too big)
  - If recovery after max_drawdown > 5 days -> FLAG for review
```

## Institutional Edge -- Monitoring & Risk (Top 1% Practices)
- **Regime detection is mandatory.** Every strategy must have a "preferred regime" tag. Regime filter pauses strategies when their preferred regime is NOT active. Use ADX + ATR percentile for classification.
- **Dynamic position sizing.** Scale position size inversely to trailing ATR: `contracts = target_risk / (ATR * tick_value)`. Never use fixed position sizes in production.
- **Stress test against historical crises.** Every strategy must survive 2008, COVID crash, 2022 rate shock with 3x spreads and 50% reduced fill rates. If any scenario exceeds prop firm max drawdown -> FAIL.
- **Track execution quality.** Log expected vs actual fill price on every trade. If average slippage > backtest assumptions -> strategy is NOT actually profitable. Use stop-limit orders, never stop-market.
- **Monitor for alpha decay.** Track 30-day rolling Sharpe. Shrinking average wins (before win rate drops) is the earliest decay signal. Reduce allocation gradually to decaying strategies.
- **Detect live vs backtest drift.** If live 30-day rolling metrics deviate > 1 std dev from backtest expectations -> investigate. > 2 std dev -> ALERT.
- **Multi-strategy portfolio.** Target 2-3 uncorrelated strategies (correlation < 0.3 on returns). Track total portfolio heat, not just per-trade risk. If correlation > 0.5 -> treat as one strategy for sizing.
- **Strategy pipeline.** Always have at least 1 strategy in development while others are deployed. Strategies have lifespans -- plan to replace them, not run forever.
- **Build execution cost as a VARIABLE** in backtests, not a constant. Slippage increases during volatility spikes and around news events.

## Key Patterns
- **Audit Log**: Every significant action (backtest, MC run, strategy change) gets an audit_log entry -- borrowed from Aspire's Trust Spine pattern
- **Forge Score**: 0-100 composite score for strategy quality (Sharpe + Drawdown + MC survival + Walk-forward)
- **Node<->Python bridge**: Node spawns Python subprocess, passes JSON config, receives JSON results
- **DeepAR Auto-Graduation**: weight 0.0 -> 0.05 -> 0.10 based on rolling hit rate. Agents must respect current weight.
- **Cloud Quantum Two-Gate**: env flag + per-request opt-in. Never auto-trigger cloud QPU.
- **Fire-and-Forget Tracking**: All async runs (MC, SQA, QUBO, Tensor, RL, Quantum MC) write pending row BEFORE Python call, update to completed/failed after.
- **Post-Close SSE Resilience**: broadcastSSE("paper:trade") always fires after transaction, even if post-processing fails.

## Database
- PostgreSQL on Railway
- Schema in src/server/db/schema.ts
- Migrations via drizzle-kit
- All IDs are UUIDs

## Prop Firm Integration
- **Full rules reference:** `docs/prop-firm-rules.md` -- agents MUST load this when simulating strategies
- 8 firms tracked: MFFU, Topstep, TPT, Apex, FFN, Alpha Futures, Tradeify, Earn2Trade
- Agents simulate strategies against each firm's exact rules (drawdown, consistency, contract limits)
- Agents rank firms by expected ROI given a strategy's profile
- Agents calculate payout projections after splits, fees, and ongoing costs
- User trades manually -- Forge provides strategy signals and firm rule compliance tracking

## Prop Firm Compliance (Live Rule Enforcement)
- **Architecture:** `docs/PROP-FIRM-COMPLIANCE.md` -- three-layer compliance architecture
- **OpenClaw Compliance Guard:** `src/agents/OPENCLAW_COMPLIANCE_GUARD.md` -- system prompt for compliance sidecar
- **Rule Engine:** `src/engine/compliance/compliance_gate.py` -- deterministic enforcement (no AI judgment)
- **API Routes:** `src/server/routes/compliance.ts` -- `/api/compliance/*`
- **Three layers:** OpenClaw monitors -> Rule engine enforces -> Human approves
- **Freshness gate:** `ruleset_max_age_hours` -- 24h for active trading, 72h for research, 0h after drift
- **Drift detection:** Content hash comparison on every doc fetch -- blocks approvals until human revalidates
- **Tables:** `compliance_rulesets`, `compliance_reviews`, `compliance_drift_log`
- **Critical rule:** No strategy runs if current rules are stale, ambiguous, or violated. Compliance beats profit.

## System Journal (AI Self-Learning Loop)
- **Table:** `system_journal` -- logs every AI-generated strategy's full backtest results, equity curve, daily P&Ls, and prop compliance
- **Purpose:** AI reviews its own past generations nightly via n8n and self-critiques. The system gets smarter every day.
- **Routes:**
  - `GET /api/journal` -- List entries (filter by `?status=`, `?tier=`, `?source=`, `?limit=`)
  - `GET /api/journal/:id` -- Single entry
  - `POST /api/journal` -- Log new entry (called by n8n after backtest)
  - `PATCH /api/journal/:id` -- Update (AI adds self-critique notes)
  - `GET /api/journal/stats/summary` -- Aggregate stats (total, pass rate, by tier/source)

## Prop Risk Calculator
- **Routes:**
  - `POST /api/risk/max-contracts` -- Given symbol, ATR, firm, account size, returns safe max contracts
  - `POST /api/risk/portfolio-heat` -- Given all open positions, returns total exposure, unrealized P&L, drawdown usage per account, and heat percentage
- **Purpose:** Call before every live session to ensure you never breach drawdown limits across multiple prop accounts
- Supports all 8 firms and contract specs (MES, MNQ, MCL)

## Data Provider Roles
- **Databento** -> Historical bulk downloads (backfill). Download once to S3, never re-pay.
- **Massive** -> Real-time streaming for paper/live trading. Free WebSocket.
- **Alpha Vantage** -> Server-side indicators + sentiment for AI agents. MCP-enabled.
- All three are free ($0/mo). Databento has $125 one-time credits.

## Data Layer Rules
- **Polars is the primary data library** -- use for all Parquet loading, transforms, and filtering. 5-10x faster than Pandas.
- **DuckDB for S3 queries** -- query Parquet on S3 directly with SQL, no download needed for selective date ranges.
- **Pandas only at the vectorbt boundary** -- convert Polars -> Pandas with `.to_pandas()` only when passing data to vectorbt.
- **ALWAYS use ratio-adjusted continuous contracts for backtesting** -- never raw Databento prices. Roll gaps create fake signals.
- Raw prices stored in S3 for reference, but all backtests run on `ratio_adj/` data.
- **Optuna for parameter robustness testing** -- Bayesian search (TPE) to map stable plateaus, not find "best" params. ~800 trials vs 100K+ grid search.

## Tournament Gating (n8n-canonical)

The 4-role tournament gate (Proposer → Critic → Prosecutor → Promoter) lives in n8n workflows, NOT in the in-process Node loop. This is intentional.

- `src/server/routes/tournament.ts` is a read-only metrics API — it does not gate anything.
- `agent-service.runStrategy()` does NOT call tournament checks before backtest. It calls the graveyard gate (cosine similarity) and proceeds directly to backtest.
- The 4-role tournament evaluation runs as part of the n8n Strategy_Generation_Loop workflow which orchestrates: scout → tournament gate → POST /api/agent/run-strategy → backtest.

**Implication for non-n8n deployments:** if the in-process Node loop is run without n8n (e.g., dev environments invoking POST /api/agent/run-strategy directly), the tournament gate is BYPASSED. Strategies will reach the backtest without the 4-role adversarial filter.

**Decision history:** This was deliberately scoped to n8n during Phase 4 to avoid duplicating LLM orchestration logic in Node. If we ever decommission n8n or want a tournament gate inside the Node loop, port the workflow to a Node service (not a top priority — graveyard + backtest gates are doing most of the filtering work).

## Don't
- Don't add Supabase or complex auth -- it's just one user
- Don't over-engineer -- MVP each phase, iterate
- Don't generate complex strategies -- max 5 parameters, one-sentence logic, proven edges only
- Don't optimize parameters to find "the best" -- test robustness across a wide range instead
- Don't trigger cloud quantum on auto-triggered backtest runs -- cloud is opt-in only
- Don't treat DeepAR output as authoritative until weight > 0 -- it starts in shadow mode
- Don't bypass lifecycle service for state transitions -- all promotions/demotions go through promoteStrategy()
- Don't create fire-and-forget runs without a pending DB row -- silent loss on restart
- Signal generation methods (including ML, tensor networks, quantum-inspired) are permitted IF validated through the same walk-forward + Monte Carlo + OOS pipeline as any other strategy. No method gets a free pass -- the gates decide, not the method.
- Don't store secrets in code -- use .env
- Don't commit the data/ directory -- it's gitignored (lives in S3)
- Don't waste Databento credits on data you can get from Massive/Alpha Vantage for free
- Don't simulate strategies against a firm without loading `docs/prop-firm-rules.md` first
- Don't ignore consistency rules (TPT 50%, FFN Express 15%) -- these disqualify many strategies
- Don't use Pandas for data loading -- use Polars (only convert to Pandas at vectorbt boundary)
- Don't backtest on raw/unadjusted continuous contracts -- always use ratio-adjusted data
- Don't use grid search for parameter testing -- use Optuna (Bayesian/TPE) for 100x fewer trials
- Don't use fixed position sizes in production -- scale inversely to volatility (ATR-based)
- Don't deploy a strategy without a preferred regime tag -- regime filter must gate every strategy
- Don't use stop-market orders -- use stop-limit orders (stop-market can cause catastrophic slippage)
- Don't ignore execution quality -- if slippage > backtest assumptions, the strategy isn't profitable
- Don't run just one strategy -- target 2-3 uncorrelated strategies (correlation < 0.3 on returns)
- Don't treat strategies as permanent -- they have lifespans, always be developing replacements
- Don't model slippage as a constant -- it's a function of volatility (higher during vol spikes)
- Don't ignore time-of-day liquidity -- overnight ES has 2x spreads vs RTH core; slippage multipliers by session are mandatory
- Don't trade through FOMC/CPI/NFP without explicit event handling -- default is SIT_OUT +/-30 min
- Don't assume limit orders always fill -- model fill probability, especially for mean reversion entries at extremes
- Don't use gross P&L for performance gates -- use net P&L per firm (commissions differ: Topstep $0.37/side, Alpha $0.00/side, Tradeify $1.29/side, others $0.62/side)
- Don't ignore firm contract caps in backtests -- ATR sizing capped to `min(ATR_size, firm_max_contracts)`
- Don't ignore overnight gap risk -- strategies holding across sessions need gap-adjusted MAE and drawdown
- Don't pass slippage/fees to vectorbt for futures -- compute P&L manually (futures math, not equity math)
