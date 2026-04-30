
===============================================================================
  Trading Forge — Full System Map v2 (2026-03-29)
===============================================================================

  MISSION STATEMENT

  The Trading Forge system map is the source of truth. The mission is:

  1. Full production enterprise-grade system — every subsystem collects data
     at every step.
  2. Self-evolving — the system gets smarter as more data is collected
     (DeepAR auto-graduates, critic loop improves, strategy memory learns).
  3. Full automation — the entire lifecycle/pipeline is autonomous EXCEPT
     TradingView deploy approval (human determines what strategies get
     deployed).
  4. Zero tolerance for bugs, errors, incidents, blockers, and issues in
     the lifecycle/pipeline.
  5. Every data handoff is tracked, every decision is auditable, every
     failure is visible.

  NOTE: n8n orchestration workflows are ONLINE in shadow pre-production mode.
  They collect runtime evidence, retries, and health signals now, but they do
  not widen release authority. TradingView deployment approval remains manual.

  CURRENT-STATE RULE

  Active claims in this map must reflect repo-enforced behavior, tests, and
  generated topology evidence. Anything built but not production-ready must be
  labeled inactive, broken, or experimental instead of being described as live.

===============================================================================

  1. STRATEGY LIFECYCLE

  CANDIDATE → TESTING → PAPER → DEPLOY_READY → DEPLOYED → DECLINING → RETIRED
      ↑                              ↑   ↓                      ↓
      │                              └───┘                      │
      └──── GRAVEYARD (dead strategies) ←───────────────────────┘
                ↑
      Strategy Memory (cuVS) feeds next generation

  GRAVEYARD is a valid lifecycle state. Any state can transition to GRAVEYARD
  on catastrophic failure, compliance violation, or kill signal.

  How strategies enter:
    OpenClaw Scout (n8n) → Ollama/GPT-5-mini writes DSL
    → Compiler validates → Backtester scores → Gates grade → CANDIDATE

  How strategies advance (automated transitions):
    CANDIDATE → TESTING:       Auto (forgeScore >= 50, tier 1/2/3,
                               backtest + WF complete). Runs every 6h.
                               (src/server/services/lifecycle-service.ts)
    TESTING → PAPER:           Auto (MC survival > 70%, prop compliance
                               >= 1 firm). Runs every 6h.
    PAPER → DEPLOY_READY:      Auto (30+ days paper, rolling Sharpe >= 1.5)
    DEPLOY_READY → DEPLOYED:   HUMAN APPROVAL ONLY (POST /api/strategies/:id/deploy)
    DEPLOY_READY → PAPER:      Human rejects (POST /api/strategies/:id/reject-deploy)
    DEPLOYED → DECLINING:      Drift + change-point detection flags decay
    PAPER → DECLINING:         Auto (drift detection > 2 sigma, or rolling
                               Sharpe drop)
    TESTING → DECLINING:       Auto (catastrophic failure)
    DECLINING → RETIRED:       Fails recovery OR max evolution attempts
    Any stage → GRAVEYARD:     Auto (catastrophic failure, compliance
                               violation, kill signal)

  Inline demotion check:
    Rolling Sharpe update (every 4h) immediately demotes
    DEPLOYED → DECLINING if Sharpe < 1.0.
    (src/server/services/lifecycle-service.ts → checkDemotions())

  Evolution service routes retirements through lifecycle service
    (audit trail, graveyard burial, SSE broadcast).
    (src/server/services/evolution-service.ts → lifecycle.promoteStrategy())

  Strategy Library: GET /api/strategies/library
    Browse all DEPLOY_READY strategies with backtest, MC, and paper metrics.
    You choose what deploys. The system NEVER auto-deploys.

===============================================================================

  2. AI MODEL LAYER

  ┌─────────────────────────────────────────────────────────────────────┐
  │  LOCAL MODELS (Volume — runs 24/7, zero cost)                      │
  │                                                                     │
  │  qwen3-coder:30b     — Primary DSL writer (strategy proposer)      │
  │  deepseek-r1:14b     — Fast critique, tournament, inline analysis  │
  │  nomic-embed-text    — Embeddings for similarity/graveyard search  │
  │  GluonTS DeepAR      — Probabilistic regime forecasting (PyTorch,  │
  │                         local, $0/month)                            │
  ├─────────────────────────────────────────────────────────────────────┤
  │  CLOUD MODEL (Depth — frontier reasoning, ~185K tokens/day)        │
  │                                                                     │
  │  GPT-5-mini          — Three roles:                                │
  │    Critic Evaluator     temp 0.2  Finds multi-dimensional flaws    │
  │    Strategy Proposer    temp 0.7  Novel concepts after easy ones   │
  │    Nightly Self-Critique temp 0.4 Synthesizes journal patterns     │
  │                                                                     │
  │  Every cloud call has local fallback. API down → local model.      │
  │  Circuit breakers on Ollama and OpenAI (3-failure threshold,       │
  │  30s cooldown). Breaker open → immediate local fallback.           │
  │  Models propose/evaluate/summarize. Gates decide. Never the LLM.   │
  └─────────────────────────────────────────────────────────────────────┘

  GPT-5-mini Critic Evaluator is wired into the critic optimizer:
    evaluates evidence packets before candidate generation.
    Verdict "fail" kills the run immediately.

  DeepAR Regime Forecaster:
    Trains nightly at 2:30 AM ET on NQ/ES/CL OHLCV + VIX + volume
    Predicts at 6:00 AM ET pre-market:
      P(high_vol), P(trending), P(mean_revert), P(correlation_stress)
    Auto-graduation:
      shadow (0.0 weight, 60 days) → challenger (0.05) → validated (0.10)
    Auto-demotion:
      hit_rate < 0.50 for 30 days → weight back to 0.0
    Governance: experimental, challenger_only
    Files: src/engine/deepar_forecaster.py
           src/engine/deepar_regime_classifier.py
           src/server/services/deepar-service.ts
           src/server/routes/deepar.ts

  Model Router: src/server/services/model-router.ts
  Prompt Files: src/agents/critic-evaluator.md
                src/agents/strategy-proposer.md
                src/agents/nightly-self-critique.md

===============================================================================

  3. RESEARCH & GENERATION PIPELINE

  n8n Strategy Generation Loop
      │
      ├─ 1. OpenClaw Scout (Brave/Tavily/Reddit/YouTube/Academic)
      ├─ 2. Ollama deepseek-r1:14b OR GPT-5-mini critiques concept
      ├─ 3. Ollama qwen3-coder:30b OR GPT-5-mini writes DSL JSON
      ├─ 4. POST /api/compiler/compile → Python AST compilation
      ├─ 5. POST /api/validation/cross → Cross-validate concept spec
      ├─ 6. POST /api/backtests → Run backtest with slippage model
      ├─ 7. Performance gate scores results
      ├─ 8. POST /api/strategies → Store if passes all gates
      └─ 9. Loop: up to N iterations per concept

  Gates:
    Compiler gate:     Does the DSL parse? All indicators valid?
    Validation gate:   Concept matches known spec? Static + runtime checks
    Performance gate:  Win rate >= 55%, R:R >= 2.0, PF >= 1.5, DD within limits
    Tier assignment:   _compute_tier() grades TIER_1/2/3/REJECTED

===============================================================================

  4. BACKTESTING ENGINE (Python)

  src/engine/backtester.py
      │
      ├─ DSL Path: Parse JSON strategy definition
      │   ├─ Load indicators (8 modules, 50+ indicators)
      │   ├─ Evaluate entry/exit conditions per bar
      │   ├─ Apply position sizing (Kelly, fixed, ATR-based)
      │   ├─ Simulate fills with variable slippage model
      │   ├─ Track equity curve, drawdowns, trades
      │   └─ _compute_tier() → TIER_1/2/3/REJECTED
      │
      ├─ Class Path: Strategy class instances (same flow)
      │
      ├─ Walk-Forward (walk_forward.py)
      │   ├─ Rolling anchored windows: train IS, test OOS
      │   ├─ Optuna TPE optimization (800 trials per window)
      │   ├─ 20-bar embargo between IS/OOS
      │   └─ OOS-only metrics count (per CLAUDE.md)
      │
      ├─ Monte Carlo (monte_carlo.py) — GPU-ACCELERATED
      │   ├─ Trade shuffling (IID, block, arch stationary)
      │   ├─ Return bootstrapping (PCG64DXSM reproducible RNG)
      │   ├─ Block bootstrap (Numba JIT + CuPy GPU path)
      │   ├─ arch StationaryBootstrap ("arch_stationary" method, dependence-aware)
      │   ├─ "both" method = three-way split (trade_resample + return_bootstrap
      │   │                                    + arch_stationary)
      │   ├─ Stress testing (3 severity levels + synthetic catastrophic)
      │   ├─ Per-firm survival simulation (8 firms)
      │   ├─ BCa confidence intervals on all metrics (live)
      │   ├─ QMC scenario coverage (Sobol/Halton/LHS)
      │   └─ Convergence checking at 1st percentile
      │
      ├─ SQA Alternative Optimizer (quantum_annealing_optimizer.py)
      │   ├─ QUBO formulation of parameter search space
      │   ├─ dwave-samplers SimulatedAnnealingSampler
      │   ├─ Results persisted to sqa_optimization_runs table
      │   └─ Governance: experimental, challenger_only
      │
      └─ Supporting modules:
          ├─ fill_model.py — V1 (RSI) + V2 (spread-aware) fill simulation
          ├─ slippage.py — Variable ATR-scaled, session multipliers, order-type
          ├─ gap_risk.py — Overnight gap exposure (EVT fat-tail model via genpareto)
          ├─ liquidity.py — Volume-based fill probability
          ├─ stress_test.py — 8 historical crisis scenarios
          ├─ qmc_sampler.py — Sobol/Halton/LHS quasi-Monte Carlo
          └─ mc_confidence.py — BCa confidence intervals

  Additional modules not shown:
    config.py, data_loader.py, firm_config.py, signals.py, sizing.py,
    strategy_base.py, optimizer.py, cross_validation.py, analytics.py (27 functions),
    prop_sim.py, prop_compliance.py, regime.py, risk_metrics.py (21 functions),
    robustness.py, performance_gate.py, changepoint.py, evt_tail.py,
    economic_calendar.py, gpu_pipeline.py, cuopt_helpers.py, nvtx_markers.py

  Additional subsystems:
    anti_setups/   — Anti-pattern detection & filtering (5 files, incl. regime_filter.py)
    archetypes/    — Strategy classification (6 files)
    decay/         — Exponential decay fitting & quarantine (4 files, incl. decay_gate.py)
    graveyard/     — Failed strategy archive & similarity search (5 files)
    survival/      — Firm-specific survival modeling (6 files)

  Backtest completion writes are TRANSACTIONAL (atomic DB commit).

===============================================================================

  5. CONTEXT ENGINE (Python → Node bridge)

  Signal arrives
      │
      ├─ Layer 0: Data Collection (src/engine/context/)
      │   ├─ context/htf_context.py — Daily bars from DuckDB/S3 Parquet
      │   └─ context/session_context.py — Intraday session analysis
      │
      ├─ Layer 1: Bias Computation
      │   └─ context/bias_engine.py — 8 signals → net bias (-100 to +100)
      │       Signal #8: DeepAR regime forecast (weight starts 0.0,
      │       active only after auto-graduation to challenger/validated)
      │
      ├─ Layer 2: Playbook + Location
      │   ├─ context/playbook_router.py — Maps bias → playbook name
      │   └─ context/location_score.py — ATR-normalized price location
      │
      ├─ Layer 3: Eligibility Decision
      │   └─ context/eligibility_gate.py → TAKE / REDUCE / SKIP
      │
      ├─ Layer 4: Tensor Network Signal
      │   └─ context-gate-service.ts → evaluateTensorSignal()
      │       ├─ Runs in PARALLEL (zero added latency)
      │       ├─ MPS model returns P(profitable) [0,1]
      │       ├─ Fragility score across regimes
      │       ├─ regime_breakdown consumed (variance penalizes fragility)
      │       ├─ Informational only — does NOT change eligibility
      │       └─ Governance: experimental, challenger_only
      │
      └─ Layer 5: DeepAR Regime Forecast
          └─ src/engine/deepar_forecaster.py → regime probabilities
              src/engine/deepar_regime_classifier.py → regime labels
              ├─ Feeds into bias engine (signal #8, weight starts 0.0)
              ├─ Feeds into skip engine (signal #11: deepar_regime_risk,
              │   weight 1.5 — only active when DeepAR weight > 0.0)
              ├─ Feeds into structural targets
              │   (src/engine/context/structural_targets.py — continuous
              │    regime_mult applied when DeepAR reaches validated tier)
              └─ Feeds into critic optimizer (±0.01 composite modifier
                  based on 60+ day rolling hit rate)

===============================================================================

  6. CRITIC OPTIMIZATION SERVICE (The Missing Bridge)

  ┌─────────────────────────────────────────────────────────────────────┐
  │  CLOSED-LOOP CRITIC REPLAY SYSTEM                                   │
  │                                                                     │
  │  Backtest completes                                                 │
  │    → SQA fire-and-forget → sqa_optimization_runs                   │
  │    → MC fire-and-forget → monte_carlo_runs (GPU-accelerated)       │
  │    → Quantum MC auto-trigger → quantum_mc_runs                     │
  │    → QUBO timing auto-trigger → qubo_timing_runs                   │
  │    → Tensor evaluation auto-trigger → tensor_predictions           │
  │                                                                     │
  │  Evidence arrives (poll DB, 5 min max)                              │
  │    │                                                                │
  │    ▼                                                                │
  │  CRITIC OPTIMIZER (Python: critic_optimizer.py)                     │
  │    │                                                                │
  │    ├─ Stage A: Classical Consensus                                  │
  │    │   └─ Optuna × SQA intersection → robust regions               │
  │    │                                                                │
  │    ├─ Stage B: PennyLane Local Refinement                           │
  │    │   └─ Real VQC circuit (AngleEmbedding + StronglyEntanglingLayers)│
  │    │                                                                │
  │    ├─ Stage C: cuOpt Constrained Selection (threshold: n<3)         │
  │    │   └─ LP/MIP: maximize composite subject to constraints         │
  │    │                                                                │
  │    ├─ Evidence Sources:                                             │
  │    │   Classical: Optuna ranges, walk-forward stability             │
  │    │   SQA: robust plateau regions                                  │
  │    │   Quantum MC: breach/ruin as risk penalty                      │
  │    │   Tensor: fragility score + regime disagreement                │
  │    │   QUBO: timing schedule improvement                            │
  │    │   RL: candidate scores feed composite (±0.02 modifier)          │
  │    │   DeepAR: rolling hit rate + days tracked (±0.01 modifier,     │
  │    │     requires 60+ days of tracking data)                        │
  │    │   Strategy Memory: cuVS loop functional (historical runs       │
  │    │     queried, index built, memory_similar used in scoring)      │
  │    │                                                                │
  │    └─ Kill Signals: catastrophic_risk | no_improvement | disagrees  │
  │       Kill threshold: 95% of parent composite (not 50%)             │
  │                                                                     │
  │  MC gate null bypass FIXED: survivalRate === null → bestCandidate   │
  │    nulled (prevents candidates from bypassing MC gate entirely).    │
  │  Param application warning: unrecognized keys logged, not silently  │
  │    ignored.                                                         │
  │  Replay completion validation: stuck pending candidates cleaned up  │
  │    (try/finally + outer catch).                                     │
  │                                                                     │
  │  Top 3 candidates → REPLAY QUEUE                                   │
  │    → runBacktest(walkforward) for each                              │
  │    → Auto MC + auto SQA + auto QUBO + auto tensor                  │
  │    → Classical gates decide survival                                │
  │                                                                     │
  │  Survivor must pass: TIER_1/2/3, MC > 70%, prop compliance,        │
  │                      composite > parent                             │
  │    → Accept: creates child strategy version                         │
  │      (parentStrategyId + generation+1, MAX_GENERATIONS = 3)         │
  │    → OR reject (parent survives)                                    │
  │                                                                     │
  │  Auto-trigger fires on any qualifying backtest (not just SQA)       │
  │  Replay stuck-state fix (try/finally + outer catch)                 │
  │  compositeWeights written to DB for audit reproducibility           │
  │  Rate limit: 1 run/strategy/24h                                    │
  │  GPT-5-mini evaluator: evaluates evidence, can kill run on "fail"  │
  └─────────────────────────────────────────────────────────────────────┘

  Composite Objective Weights:
    oos_return:         +0.15    payout_feasibility: +0.10
    survival_rate:      +0.15    breach_probability: -0.10
    profit_factor:      +0.15    param_instability:  -0.10
    max_drawdown:       -0.15    regime_fragility:   -0.05
                                 timing_fragility:   -0.05

  API Routes: /api/critic-optimizer
    POST /analyze — Trigger analysis for a strategy
    GET  /candidates/:strategyId — List candidates (supports ?status= filter)
    POST /replay — Manual replay trigger
    GET  /history — Runs list (?strategy_id= optional filter)
    GET  /run/:runId — Full detail

===============================================================================

  7. PAPER TRADING (Real-Time Execution)

  Market Data (Massive.io WebSocket)
      │
      └─ paper-trading-stream.ts — Per-symbol OHLCV streaming
          │
          └─ paper-signal-service.ts — Signal detection + execution
              │
              ├─ 1. Bar buffer fills (200-bar rolling, VWAP resets at ET session boundary)
              ├─ 2. Calendar check (holidays, early close, FOMC/CPI/NFP ±30min sit-out)
              │     64 events loaded (2026-2027)
              ├─ 3. Indicators computed on buffer
              ├─ 4. ICT indicator bridge (paper_bridge.py subprocess)
              ├─ 5. Strategy conditions evaluated
              ├─ 6. SIGNAL DETECTED
              │
              ├─ 7. Risk Gate (paper-risk-gate.ts)
              │   ├─ Daily loss limit (firm-specific)
              │   ├─ Max concurrent positions
              │   ├─ Trailing drawdown check
              │   ├─ Contract cap per symbol
              │   └─ Global daily loss ($5K cap)
              │
              ├─ 8. Context Gate (context-gate-service.ts)
              │   ├─ Fetches daily bars (cached per symbol/day)
              │   ├─ Calls Python context engine subprocess
              │   ├─ Tensor signal P(profitable) + fragility
              │   ├─ SKIP → reject signal, log reasoning
              │   │   SKIP decisions journaled to paper_signal_logs
              │   ├─ REDUCE → halve contracts
              │   └─ TAKE → proceed full size
              │
              ├─ 9. Position OPEN
              │   ├─ Variable slippage: base × (ATR/medianATR) × orderType × session
              │   ├─ V2 fill probability: RSI + spread + order-type + partial fills
              │   ├─ Volume-based fill probability (liquidity.py)
              │   ├─ Latency simulation: 150ms drift model
              │   ├─ TCA: arrivalPrice, implementationShortfall, fillRatio
              │   ├─ Auto shadow signal entry
              │   └─ SSE event → frontend
              │
              ├─ 10. Position MANAGEMENT (per bar)
              │   ├─ Stop loss / take profit check
              │   ├─ Trail stop (ATR-based HWM tracking)
              │   ├─ Time-based exit (max_hold_bars)
              │   └─ Update unrealized P&L
              │
              └─ 11. Position CLOSE
                  ├─ Exit slippage ATR-scaled (symmetric with entry)
                  ├─ Commission deduction per firm (net P&L per firm)
                  ├─ Compute realized P&L (our math, NOT vectorbt)
                  ├─ UPDATE paper_sessions equity/drawdown
                  ├─ QuantStats analytics on session stop
                  ├─ Drift detection: compare live vs backtest
                  ├─ SSE event → frontend (broadcastSSE always fires
                  │   even if post-transaction calls fail — resilience
                  │   contract enforced)
                  └─ Trigger post-trade analytics

  OpenTelemetry Spans (all 6 implemented):
    paper.signal_evaluation   — paper-signal-service.ts
    paper.context_gate        — context-gate-service.ts
    paper.risk_gate           — paper-risk-gate.ts
    paper.fill_check          — paper-execution-service.ts
    paper.position_open       — paper-execution-service.ts
    paper.position_close      — paper-execution-service.ts

===============================================================================

  8. PROP FIRM INTEGRATION

  8 Supported Firms:
    MFFU, Topstep, TPT, Apex, FFN, Alpha Futures, Tradeify, Earn2Trade

  Each firm has:
    Account sizes, max drawdown (trailing/EOD), daily loss limits,
    profit targets, contract caps, scaling plan, payout rules,
    consistency rules, commission rates

  Routes: /api/prop-firm
    GET  /firms — List all firms + configs
    GET  /simulate/:backtestId — Run prop sim for a backtest
    POST /rank — Rank firms for a strategy
    POST /timeline — Estimate payout timeline
    POST /payout — Calculate payout projections
    (Compliance lives at /api/compliance/* — separate module)

  Compliance (3 layers):
    OpenClaw monitors → Rule engine enforces → Human approves

===============================================================================

  9. QUANTUM RISK LAB

  ┌─────────────────────────────────────────────────────────────────────┐
  │  GOVERNANCE MODEL                                                   │
  │                                                                     │
  │  Authoritative (ground truth):     Experimental Challenger:         │
  │  ├─ Classical Monte Carlo          ├─ Quantum MC (IAE)              │
  │  ├─ Walk-forward validation        ├─ Tensor Network (MPS)          │
  │  ├─ Prop-firm rules engine         ├─ SQA Optimizer                 │
  │  ├─ Performance gate scoring       ├─ QUBO Trade Timing             │
  │  └─ Critic Optimizer (authority)   └─ PennyLane VQC RL Agent        │
  │                                                                     │
  │  Every quantum run: experimental=true, authoritative=false,         │
  │                      decision_role=challenger_only                   │
  │                                                                     │
  │  Challengers contribute evidence to the authoritative critic.       │
  │  They cannot mutate parameters directly.                            │
  └─────────────────────────────────────────────────────────────────────┘

  9a. Quantum Engines (all experimental, challenger_only)

  quantum_mc.py           — IAE Amplitude Estimation (Qiskit 2.3.1, executes
                            EstimationProblem + IterativeAmplitudeEstimation,
                            classical_fallback flag surfaced in raw_result)
                            IBM SamplerV2 path (drop-in for cloud QPU)
  quantum_annealing_optimizer.py — SQA Parameter Search (dwave-samplers 1.7)
  tensor_signal_model.py  — MPS Tensor Network + Fragility Scoring (quimb 1.13)
                            Braket TN1 stub for bond_dim >= 8 (planned)
  qubo_trade_timing.py    — QUBO Session Block Optimization (dwave-samplers 1.7)
  quantum_rl_agent.py     — VQC RL Agent (PennyLane, WSL2 GPU)
                            PennyLane-Braket device routing
                            (braket.aws.sv1, braket.aws.ionq)
                            max_cloud_evaluations=100

  9b. Quantum Persistence (6 first-class tables)

  sqa_optimization_runs   — Params, plateaus, solutions, governance
  qubo_timing_runs        — Session schedules, improvement metrics
  tensor_predictions      — P(profitable), fragility, regime breakdown
  rl_training_runs        — Policy weights, comparison results (route persists after training)
  quantum_mc_runs         — IAE estimates, tolerance, reproducibility hash
                            + Cloud metadata: provider, backend, job_id,
                              qpu_time_ms, estimated_cost, region
  quantum_mc_benchmarks   — Quantum vs classical delta, tolerance gate
                            + backendType (cloud_qpu | cloud_sim |
                              local_gpu | local_cpu | classical)

  Status columns on all fire-and-forget tables (MC, quantum MC, SQA,
  QUBO, tensor, RL) for tracking pending/complete/failed runs.

  9c. Quantum API Endpoints

  POST /api/quantum-mc/run              → IAE breach/ruin/target estimation
  POST /api/quantum-mc/hybrid-compare   → Classical + quantum side-by-side
  POST /api/quantum-mc/tensor-train     → Train MPS model
  POST /api/quantum-mc/tensor-predict   → MPS P(profitable) prediction
  POST /api/quantum-mc/sqa-optimize     → SQA parameter search
  POST /api/quantum-mc/qubo-timing      → QUBO session block optimization
  POST /api/quantum-mc/rl-train         → Train VQC RL agent
  POST /api/quantum-mc/rl-evaluate      → Evaluate/compare RL agent

  9d. Quantum Hardware

  ┌──────────────────────────────┬──────────────────────────────────────┐
  │  Windows Native (CPU)        │  WSL2 Ubuntu 22.04 (GPU)             │
  ├──────────────────────────────┼──────────────────────────────────────┤
  │  qiskit 2.3.1                │  qiskit 2.3.1                        │
  │  dwave-samplers 1.7.0        │  pennylane 0.42.3                    │
  │  quimb 1.13.0                │  pennylane-lightning[gpu] 0.42.0     │
  │  scipy, numpy                │  cupy-cuda12x, cuquantum-cu12        │
  ├──────────────────────────────┼──────────────────────────────────────┤
  │  CPU statevector: ~30 qubits │  GPU statevector: ~27 qubits         │
  └──────────────────────────────┴──────────────────────────────────────┘

  9e. Cloud QPU Integration

  src/engine/cloud_backend.py — Provider abstraction + budget tracker

  ┌─────────────────────────────────────────────────────────────────────┐
  │  IBM Quantum Platform                                               │
  │    4 backends: ibm_fez (156q), ibm_kingston (156q),                │
  │                ibm_marrakesh (156q), ibm_torino (133q)              │
  │    SamplerV2 drop-in replacement in quantum_mc.py                  │
  │    Budget: 600 seconds QPU time/month                               │
  ├─────────────────────────────────────────────────────────────────────┤
  │  AWS Braket                                                         │
  │    QPU: IonQ Forte 1                                                │
  │    Simulators: SV1, TN1, dm1                                       │
  │    Budget: $30/month hard cap                                       │
  │    S3 bucket: amazon-braket-trading-forge                           │
  │    Braket SV1 fallback path (planned)                               │
  ├─────────────────────────────────────────────────────────────────────┤
  │  Two-Gate Safety                                                    │
  │    Gate 1: QUANTUM_CLOUD_ENABLED env var must be true               │
  │    Gate 2: opt_in_cloud=true per-request flag                       │
  │    Both gates must pass — either false → local immediately          │
  ├─────────────────────────────────────────────────────────────────────┤
  │  CloudBudgetTracker                                                 │
  │    Persistent JSON file, monthly auto-reset                         │
  │    2x pessimism factor on cost estimates                            │
  │    Hard-stop when budget exhausted (no silent overrun)              │
  └─────────────────────────────────────────────────────────────────────┘

===============================================================================

  10. GPU ACCELERATION PIPELINE

  NVIDIA RTX 5060 (8GB VRAM, 32GB RAM)

  ┌─────────────────────────────────────────────────────────────────────┐
  │  TOOL              │  WHERE                 │  SPEEDUP              │
  ├────────────────────┼────────────────────────┼───────────────────────┤
  │  CuPy              │  MC cumsum (accumulate  │  5-20x (accumulate    │
  │                    │  falls back to numpy)  │  reverts to CPU)      │
  │  RAPIDS cuDF       │  Evidence assembly     │  2-5x                 │
  │  RAPIDS cuML       │  Regime clustering     │  3-10x                │
  │  cuOpt             │  Candidate selection   │  Constrained LP/MIP   │
  │  cuVS              │  Strategy memory       │  GPU vector search    │
  │  Nsight + NVTX     │  Full pipeline         │  Profiling/visibility │
  └─────────────────────────────────────────────────────────────────────┘

  Ollama Modelfile: num_ctx 8192 (was 32768), MAX_LOADED_MODELS=1

  Profiling: nsys profile --trace=cuda,nvtx,osrt from WSL2
  NVTX markers on: data_load, indicators, signals (backtester),
                   mc_trade_resample, mc_return_bootstrap, mc_block_bootstrap,
                   mc_stress_test (monte_carlo), wf_window (walk_forward),
                   sqa_optimize (quantum_annealing_optimizer),
                   tensor_train, tensor_predict (tensor_signal_model),
                   critic_optimizer, critic_evidence, critic_consensus,
                   critic_pennylane, critic_candidates (critic_optimizer)

===============================================================================

  11. STATISTICAL MATH STACK

  ┌─────────────────────────────────────────────────────────────────────┐
  │  COMPONENT          │  LIBRARY             │  REPLACES              │
  ├─────────────────────┼──────────────────────┼────────────────────────┤
  │  Robust Covariance  │  sklearn LedoitWolf  │  np.corrcoef Pearson   │
  │                     │  MinCovDet           │                        │
  │                     │  GraphicalLassoCV    │                        │
  ├─────────────────────┼──────────────────────┼────────────────────────┤
  │  Change-Point       │  ruptures PELT       │  2-sigma retrospective │
  │  Detection          │  Binseg, KernelCPD   │  heuristic             │
  ├─────────────────────┼──────────────────────┼────────────────────────┤
  │  EVT Tail Modeling  │  scipy genpareto     │  Normal assumption     │
  │                     │  Peak-Over-Threshold │                        │
  ├─────────────────────┼──────────────────────┼────────────────────────┤
  │  Regime Detection   │  hmmlearn GaussianHMM│  Rule-based ADX/ATR    │
  │                     │  + existing rules    │  (rules stay as fast   │
  │                     │                      │   path)                │
  ├─────────────────────┼──────────────────────┼────────────────────────┤
  │  RNG Discipline     │  NumPy PCG64DXSM     │  default_rng(seed)     │
  │                     │  SeedSequence.spawn() │                       │
  ├─────────────────────┼──────────────────────┼────────────────────────┤
  │  QMC Sampling       │  scipy.stats.qmc     │  IID random sampling   │
  │                     │  Sobol/Halton/LHS    │                        │
  ├─────────────────────┼──────────────────────┼────────────────────────┤
  │  Bootstrap          │  arch Stationary     │  Custom block only     │
  │                     │  CircularBlock       │                        │
  ├─────────────────────┼──────────────────────┼────────────────────────┤
  │  Confidence         │  scipy.stats.bootstrap│ Percentile only       │
  │  Intervals          │  BCa method          │                        │
  ├─────────────────────┼──────────────────────┼────────────────────────┤
  │  Risk Decomposition │  Euler decomposition │  Simple correlation    │
  │                     │  Component/marginal  │  scoring               │
  └─────────────────────────────────────────────────────────────────────┘

===============================================================================

  12. SKIP ENGINE (Pre-Market Gate)

  POST /api/skip/classify — 11 signals:

    1. event_proximity    (3.0) — FOMC/CPI/NFP ±30 min = SIT_OUT (minute-precision)
    2. vix_level          (2.5) — >30 = SKIP, 25-30 = REDUCE
    3. overnight_gap      (2.0) — >1.5 ATR = SKIP
    4. premarket_volume   (1.5) — <30% normal = SKIP
    5. day_of_week        (1.0) — Historically bad days
    6. loss_streak        (2.0) — >3 days = REDUCE, >5 = SKIP
    7. monthly_budget     (2.5) — >60% DD used = REDUCE, >80% = SKIP
    8. correlation_spike  (1.5) — Portfolio corr >0.7 = REDUCE
    9. calendar_filter    (2.0) — Holiday (2026+2027), triple witching, roll week
   10. qubo_timing        (1.5) — SQA session block says skip
   11. deepar_regime_risk (1.5) — DeepAR regime forecast risk
       P(high_vol) > 0.85 → SKIP (3.0 points)
       P(high_vol) > 0.70 → REDUCE (1.5 points)
       P(correlation_stress) > 0.60 → +1.0 point
       Only active when DeepAR weight > 0.0 (after auto-graduation)
       (src/engine/skip_engine/premarket_analyzer.py)

  Thresholds: score >= 6.0 → SKIP, >= 3.0 → REDUCE, else → TRADE

===============================================================================

  13. MONITORING & DECAY DETECTION

  Scheduler (src/server/scheduler.ts):

    Rolling Sharpe        (every 4 hours)  — Recompute for active strategies
                                             Inline demotion: DEPLOYED →
                                             DECLINING if Sharpe < 1.0
    Pre-Market Prep       (6:00 AM ET)     — Skip classifier + QUBO timing
    Drift Detection       (event-driven)   — PELT change-point on trade close
    Decay Monitor         (daily, 2:00 AM ET) — Equity slope, DD duration
    Lifecycle Check       (every 6 hours)  — Auto promote/demote
    Graveyard Gate        (on DECLINING)   — Archive + cause of death
    Stale Session Check   (every 5 min)    — 2+ hours inactive → auto-stop
                                             + QuantStats analytics generated
                                             Registered via registerJob()
                                             (missed-run reconciliation)
    DeepAR Train          (2:30 AM ET)     — Nightly model training
    DeepAR Predict        (6:00 AM ET)     — Pre-market regime forecast
    DeepAR Validate       (6:30 AM ET)     — Hit rate + auto-graduation check

  Drift Detection (UPGRADED):
    PELT structural break on: daily P&L, rolling Sharpe (event-driven on trade close)
    Coincident breakpoints (2+ signals in 5-day window) = edge death confirmed
    HMM regime detection available via analyzeMarketHMM() (on-demand, not scheduled)
    EVT tail estimates → breach/ruin risk updated with fat-tail model

  Audit Log Events:
    paper.session_stop        — Manual or auto session stop (src/server/routes/paper.ts)
    paper.session_auto_stop   — Stale session auto-stop (src/server/scheduler.ts)
    strategy.graveyard_burial — Strategy buried in graveyard
                                (src/server/services/lifecycle-service.ts)

===============================================================================

  14. GOVERNOR (Position-Level Risk)

  Routes: /api/governor
    POST /backtest — Backtest-time risk check
    POST /trade    — Live trade risk check
    POST /session-end — End-of-session reconciliation
    GET  /status/:strategyId — Current governor state
    GET  /configs  — All governor configs

  Python modules (src/engine/governor/):
    governor_backtest.py   — Backtest-integrated risk checks
    governor_config.py     — Governor configuration + thresholds
    session_tracker.py     — Session state tracking
    state_machine.py       — Governor state transitions
    trade_filter.py        — Pre-trade filtering rules

  Robust Covariance (robust_covariance.py):
    LedoitWolf shrinkage, MinCovDet, GraphicalLassoCV
    Used by analytics.py for portfolio correlation matrix

  Risk Decomposition (robust_covariance.py):
    Euler decomposition: marginal risk, component risk, % contribution

===============================================================================

  15. PINE EXPORT COMPILER (DSL → TradingView)

  Strategy (passes all gates)
      │
      ├─ Exportability Check (0-100 score)
      ├─ Pine v6 Compilation (indicator mapping + state machine)
      ├─ exportType enum: alert_only, pine_strategy, pine_indicator
      ├─ Prop-risk overlay (firm-specific commission, risk_lockout declared
      │   in no-firm path so TradingView loads correctly)
      ├─ Risk intelligence wired end-to-end (TS→Python)
      ├─ Alert definitions JSON
      └─ DB Persistence (strategy_exports + artifacts)

  Auto-trigger: MC survival > 80% → auto Pine compile

===============================================================================

  16. DATA LAYER

  Database: PostgreSQL (Drizzle ORM, 38+ tables)

    Core:       strategies, backtests, backtest_trades, walk_forward_windows
    Paper:      paper_sessions, paper_positions, paper_trades, paper_signal_logs
    Monitoring: graveyard, skip_decisions
    Risk:       stress_test_runs, monte_carlo_runs
    Quantum:    quantum_mc_runs, quantum_mc_benchmarks,
                sqa_optimization_runs, qubo_timing_runs,
                tensor_predictions, rl_training_runs
                (Cloud metadata columns on quantum_mc_runs: provider,
                 backend, job_id, qpu_time_ms, estimated_cost, region)
                (backendType on quantum_mc_benchmarks: cloud_qpu |
                 cloud_sim | local_gpu | local_cpu | classical)
                (Status columns on all fire-and-forget tables)
    Critic:     critic_optimization_runs, critic_candidates
    Pine:       strategy_exports, strategy_export_artifacts
    Compliance: compliance_rulesets, compliance_reviews, compliance_drift_log
    DeepAR:     deepar_forecasts — regime predictions per symbol per day
                deepar_training_runs — nightly training history
    Other:      alerts, tournament_results, journal_entries, audit_log,
                shadow_signals, strategy_names, watchlist, data_sync_jobs,
                day_archetypes, backtest_matrix, walk_forward_windows

  Market Data:
    Databento    — Historical bulk (OHLCV-1m, S3 Parquet, $125 credits)
    Massive.io   — Real-time WebSocket (paper trading, free)
    Alpha Vantage— Indicators + sentiment (MCP, free)
    DuckDB       — S3 Parquet queries (no download needed)

  Local AI:
    Ollama       — qwen3-coder:30b, deepseek-r1:14b, nomic-embed-text
    GPT-5-mini   — Critic evaluator, strategy proposer, nightly review
    OpenClaw     — Autonomous research agent

  DeepAR Routes:
    GET  /api/deepar/forecast/:symbol  — Latest forecast for symbol
    GET  /api/deepar/forecast/all      — All current forecasts
    GET  /api/deepar/accuracy          — Rolling hit rate + graduation status
    GET  /api/deepar/training-history  — Nightly training run history
    POST /api/deepar/train             — Trigger manual training run
    POST /api/deepar/predict           — Trigger manual prediction

  Additional Routes (not shown above):
    /api/data         — Data provider integration (Databento, Massive, Alpha Vantage)
    /api/indicators   — Technical indicators API (54 ICT + standard)
    /api/signals      — Signal aggregation & analysis
    /api/context      — Context gate eligibility evaluation

  Additional Services (src/server/services/):
    alert-service.ts, backtest-service.ts, correlation-service.ts,
    critic-optimizer-service.ts, deepar-service.ts, evolution-service.ts,
    graveyard-gate.ts, lifecycle-service.ts, monte-carlo-service.ts,
    ollama-client.ts, pine-export-service.ts, regime-service.ts,
    robustness-service.ts, shadow-service.ts, signal-confirmation-service.ts

===============================================================================

  17. PORTFOLIO & CORRELATION

  /api/portfolio:
    Portfolio-level metrics (all active strategies)
    Correlation matrix (LedoitWolf shrinkage covariance)
    Euler risk decomposition (component/marginal risk)
    Diversification scoring
    Combined equity curve
    Risk-adjusted returns (Sharpe, Sortino, Calmar)

  Routes:
    GET /api/portfolio/decomposition  — Euler risk decomposition
    GET /api/portfolio/equity-curve   — Combined equity curve
    GET /api/portfolio/diversification — Diversification scoring

===============================================================================

  18. SSE REAL-TIME EVENTS

  /api/sse/events:
    Events have sequence numbers.
    Last-Event-ID reconnect replay (100-event ring buffer).

    position:open/close/update    signal:detected/rejected
    alert:triggered               session:update
    drift:detected                strategy:promoted
    critic:started                critic:candidates_ready
    critic:replay_complete        critic:completed
    paper:session_stop            paper:auto_stopped

===============================================================================

  19. n8n ORCHESTRATION WORKFLOWS

  Strategy Generation:
    Strategy Generation Loop    — Scout → Critique → Compile → Validate → Backtest
    Nightly Strategy Research   — Deep concept research loop
    Weekly Strategy Hunt        — Broader concept search
    8A Idea-to-Strategy         — Concept → DSL pipeline
    5G/5H/5I Scouts             — Brave/Reddit/Tavily research agents

  Validation & Tournament:
    Strategy Tournament         — Head-to-head strategy comparison
    5A Weekly Tournament        — Weekly tournament bracket
    Monthly Robustness Check    — Parameter robustness sweep

  Compliance:
    Daily Compliance Check      — Prop firm rule compliance
    Weekly Compliance Re-Parse  — Rule document freshness
    Pre-Session Compliance Gate — Compliance before trading
    6D Compliance Gate          — Compliance enforcement

  Pre/Post Session:
    Pre-Session Skip Check      — Daily skip decision + context bias
    Post-Session Skip Review    — Post-session outcome tracking

  Monitoring & Maintenance:
    Daily Portfolio Monitor     — Portfolio health check
    Anti-Setup Refresh          — Anti-setup pattern updates
    Macro Data Sync             — Economic data sync
    0A Health Monitor           — System health check
    3A Workflow Backup          — n8n workflow versioning
    8B Source Quality Review    — Source quality scoring

  Optimization & Learning:
    9A Nightly Self-Critique    — Ollama/GPT-5-mini reviews journal
    7A Auto-Evolution           — Strategy mutation when declining
    11A Critic Optimization     — Evidence → Candidates → Replay → Survivor
    10A Master Orchestration    — Coordinates all workflows

  Internal Services (Python/TS, not n8n):
    Critic Optimizer            — POST /api/critic-optimizer/analyze
    Drift Detection             — Event-driven in drift-detection-service.ts
    Decay Monitoring            — Scheduled in scheduler.ts

  Production Readiness Fixes (all workflows):
    - Error alerting fixed (port 4100 → 4000, route /alert/alerts → /api/alerts)
    - 5H Reddit Scout merge bug fixed
    - 11A Critic Optimization journal format fixed (form-encoded → JSON)
    - Strategy Gen Loop expression syntax fixed (optional chaining → ternary guards)
    - Nightly Research symbol enum fixed (ES → MES)
    - 9A Self-Critique journal writeback added
    - 11A schedule conflict resolved (moved to 3 AM)
    - Error handling added to 5G Brave + 5I Tavily scouts
    - All workflows remain INACTIVE until production launch

===============================================================================

  20. COMPLETE DATA FLOW (End-to-End)

                    ┌──────────────────────────────────────────────┐
                    │           n8n + AI ORCHESTRATION              │
                    │  Scout → Critique (GPT-5-mini) → Compile     │
                    │  → Validate → Backtest → Gates → Store       │
                    └──────────────────┬───────────────────────────┘
                                       │ New strategy (CANDIDATE)
                                       ▼
                    ┌──────────────────────────────────────────────┐
                    │     MULTI-GATE VALIDATION PIPELINE            │
                    │  Walk-Forward → Monte Carlo (GPU, arch, BCa) │
                    │  → Prop Sim → Tournament → Paper Assignment   │
                    └──────────────────┬───────────────────────────┘
                                       │
                    ┌──────────────────┼───────────────────────────┐
                    │                  ▼                            │
                    │  Auto Quantum Challengers (fire-and-forget)  │
                    │    ├─ SQA → sqa_optimization_runs            │
                    │    ├─ QUBO → qubo_timing_runs                │
                    │    ├─ Tensor → tensor_predictions             │
                    │    ├─ Quantum MC → quantum_mc_runs            │
                    │    └─ Pine Export (if survival > 80%)         │
                    │                                              │
                    │  ┌────────────────────────────────────────┐  │
                    │  │  CRITIC OPTIMIZER (GPT-5-mini + math)  │  │
                    │  │  Evidence → Consensus → PennyLane      │  │
                    │  │  → cuOpt Selection → Replay Queue      │  │
                    │  │  → MC gate → Classical Gates            │  │
                    │  │  → Child strategy version (LOOP CLOSES) │  │
                    │  └────────────────────────────────────────┘  │
                    └──────────────────┬───────────────────────────┘
                                       │ Strategy enters PAPER
                                       ▼
┌──────────────┐   ┌──────────────────────────────────────────────┐
│  PRE-MARKET  │──▶│           PAPER TRADING ENGINE                │
│  Skip Engine │   │  Massive.io → Bars → Calendar Check           │
│ (11 signals) │   │  → Indicators → Signal → Risk Gate            │
│  + QUBO      │   │  → Context Gate → Variable Slippage           │
│  + DeepAR    │   │  → V2 Fills → Position → P&L → Analytics     │
│    regime    │   │  OpenTelemetry traced end-to-end              │
└──────────────┘   └──────────────────┬───────────────────────────┘
                                       │ Trade results
                                       ▼
                    ┌──────────────────────────────────────────────┐
                    │     MONITORING & DECAY (UPGRADED)             │
                    │  PELT Change-Point │ HMM Regime Detection    │
                    │  EVT Tail Risk     │ LedoitWolf Covariance   │
                    │  Rolling Sharpe    │ Graveyard + cuVS Memory │
                    └──────────────────┬───────────────────────────┘
                                       │ Metrics feed back
                                       ▼
                    ┌──────────────────────────────────────────────┐
                    │     PROP FIRM OPTIMIZATION                    │
                    │  Simulate → Rank Firms → Compliance          │
                    │  → Payout Timeline → Best Fit Selection      │
                    └──────────────────┬───────────────────────────┘
                                       │
                                       ▼
                    ┌──────────────────────────────────────────────┐
                    │     DEPLOYMENT (TradingView)                  │
                    │  Pine v6 Indicator │ Alert JSON               │
                    │  Prop Risk Overlay │ Risk Intelligence        │
                    └──────────────────┬───────────────────────────┘
                                       │
                                       ▼
                    ┌──────────────────────────────────────────────┐
                    │     NIGHTLY SELF-CRITIQUE                     │
                    │  GPT-5-mini reviews journal entries           │
                    │  → What concepts fail? What params rejected?  │
                    │  → Meta-learning feeds next generation        │
                    │  → Strategy Memory (cuVS) updated             │
                    └──────────────────┬───────────────────────────┘
                                       │
                                       ▼
                    ┌──────────────────────────────────────────────┐
                    │     DeepAR SELF-EVOLVING FEEDBACK LOOP        │
                    │                                              │
                    │  Nightly (2:30 AM ET):                       │
                    │    DeepAR trains on NQ/ES/CL + VIX + volume  │
                    │    → deepar_training_runs (loss, epochs)      │
                    │                                              │
                    │  Pre-Market (6:00 AM ET):                    │
                    │    DeepAR predicts regime probabilities       │
                    │    → deepar_forecasts (per symbol per day)    │
                    │                                              │
                    │  Validation (6:30 AM ET):                    │
                    │    Compare predictions vs actual outcomes     │
                    │    → Rolling hit rate updated                 │
                    │    → Auto-graduation check:                   │
                    │      shadow (0.0) → challenger (0.05)         │
                    │      → validated (0.10)                       │
                    │    → Auto-demotion: hit_rate < 0.50           │
                    │      for 30 days → weight 0.0                 │
                    │                                              │
                    │  When validated:                              │
                    │    → Bias engine signal #8 active             │
                    │    → Skip engine signal #11 active            │
                    │    → Structural targets regime_mult active    │
                    │    → Critic optimizer ±0.01 modifier active   │
                    │                                              │
                    │  The system gets smarter as data accumulates  │
                    └──────────────────────────────────────────────┘

===============================================================================

  21. GOVERNANCE (12 Gates)

  1.  All quantum output = challenger_only (Python output dicts)
  2.  Candidates = proposals, never direct mutations (TS enforcement)
  3.  Replay = full backtest pipeline (runBacktest triggers MC + prop)
  4.  Survivor must pass classical gates (tier + MC + prop + composite)
  5.  Full audit trail (audit_log for every action)
  6.  Kill signals halt optimization (Python returns zero candidates)
  7.  Rate limit: 1 critic run/strategy/24h (DB recency check)
  8.  Version lineage tracked (parentStrategyId + generation, max 3)
  9.  compositeWeights written to every run for reproducibility
  10. DeepAR auto-graduation: shadow → challenger → validated,
      with auto-demotion (hit_rate < 0.50 for 30 days → weight 0.0)
  11. Cloud quantum two-gate safety: QUANTUM_CLOUD_ENABLED env flag
      + opt_in_cloud per-request flag (both required)
  12. Cloud budget hard-stops: IBM 600s QPU/month, Braket $30/month
      (CloudBudgetTracker with 2x pessimism factor)
  13. Live execution: human start + auto-flatten on risk (Phase 13, deferred)

  LLMs propose/evaluate/summarize. Gates decide. Never the model.

===============================================================================

  22. TEST COVERAGE

  Unified pytest runner (both test directories).
  82+ Python tests (existing) + new test suites:

  ┌──────────────────────────────────────┬───────────────────────────┐
  │  Test File                           │ Coverage Area             │
  ├──────────────────────────────────────┼───────────────────────────┤
  │  test_quantum_mc.py                  │ IAE estimation            │
  │  test_quantum_models.py              │ Distribution fitting      │
  │  test_quantum_bench.py               │ Tolerance validation      │
  │  test_quantum_rl_agent.py            │ VQC RL training           │
  │  test_quantum_annealing_optimizer.py │ SQA optimization          │
  │  test_qubo_trade_timing.py           │ Session QUBO              │
  │  test_tensor_signal_model.py         │ MPS prediction + fragility│
  │  test_cloud_backend.py (43 tests)    │ Governance, budget,       │
  │                                      │ fallback chain            │
  │  test_exportability.py               │ Export scoring            │
  │  test_pine_compiler.py (30 tests)    │ Pine transpilation +      │
  │                                      │ 5 alert alignment tests   │
  │                                      │ + golden snapshot regen   │
  │  test_hardware_profile.py            │ GPU detection             │
  │  test_golden_snapshots.py            │ Regression snapshots      │
  │  verify_all_phases.py                │ 37 functional tests       │
  │  check_plan_deliverables.sh          │ 67-point deliverable check│
  ├──────────────────────────────────────┼───────────────────────────┤
  │  TS integration smoke tests (6)      │ Service health            │
  │  Circuit breaker tests (14)          │ Breaker states + recovery │
  │  Observability tests (16)            │ OTel + correlation IDs    │
  │  Paper parity tests:                 │                           │
  │    TS parity (34), slippage (8),     │ Paper trading accuracy    │
  │    volume fill (12), VWAP (8),       │ + 13 new (ICT bridge,     │
  │    calendar (16),                    │   post-close resilience)  │
  │    ICT bridge (5), post-close (8)    │                           │
  │  Pine tests (26+5 alert alignment)   │ Export correctness        │
  └──────────────────────────────────────┴───────────────────────────┘

===============================================================================

  23. INFRASTRUCTURE & OBSERVABILITY

  Circuit Breaker: src/server/lib/circuit-breaker.ts
    3-failure threshold, 30s cooldown. Used on Ollama and OpenAI calls.

  Request Correlation ID: src/server/middleware/correlation.ts
    Every request gets a unique correlation ID propagated through logs and spans.

  OpenTelemetry Spans:
    Paper trading (6):
      paper.signal_evaluation   — paper-signal-service.ts
      paper.context_gate        — context-gate-service.ts
      paper.risk_gate           — paper-risk-gate.ts
      paper.fill_check          — paper-execution-service.ts
      paper.position_open       — paper-execution-service.ts
      paper.position_close      — paper-execution-service.ts
    Pipeline spans (4):
      backtest.run              — backtest-service.ts
      monte_carlo.run           — monte-carlo-service.ts
      quantum_mc.run            — quantum-mc-service.ts
      critic.analyze            — critic-optimizer-service.ts

  Health Endpoint: GET /api/health
    Reports "degraded" for Ollama outage + circuit breaker status per provider.
    Python runtime health check included (python --version with 3s timeout).

  Audit Trail Events:
    paper.session_start         — Paper session started
    paper.session_stop          — Manual session stop
    paper.session_auto_stop     — Stale session auto-stop (2+ hours inactive)
    paper.trade_open            — Paper trade opened
    paper.trade_close           — Paper trade closed
    strategy.deploy_approved    — Human approved deployment
    strategy.graveyard_burial   — Strategy buried in graveyard
    backtest.run                — Backtest completed
    mc.run                      — Monte Carlo completed

  Post-Close SSE Resilience:
    broadcastSSE always fires even if post-transaction calls fail.
    Contract enforced by paper parity tests.

  Stale Session Auto-Stop:
    Registered as proper scheduler job via registerJob()
    (missed-run reconciliation supported).
    2+ hours inactive → auto-stop + QuantStats analytics.

===============================================================================

<!-- BEGIN GENERATED: topology -->
## Current Enforced Pre-Production State

Updated automatically from the repo on `2026-04-30T08:59:02.484Z`.

- Platform lifecycle stage: `pre-production`
- Runtime-proven means `proven in pre-production`, not production released.
- Production runtime controls: `ready` (strict)

- TradingView deployment gate: `manual-only`
- Manual gates declared: `tradingview_deploy`
- API routes tracked: `45`
- Scheduler jobs tracked: `42`
- Current live Trading Forge n8n workflows tracked: `28`
- Canonical workflows tracked: `28`
- Duplicate workflow variants collapsed: `0`
- Engine subsystems tracked: `22`
- Database tables tracked: `55`

### Subsystem Runtime States
- `active`: `11`
- `experimental`: `3`

### Current Pre-Production States
- `active_preprod`: `11`
- `experimental_preprod`: `3`
- `inactive_preprod`: `0`
- `partially_active_preprod`: `0`

### Launch Target States
- `experimental_challenger`: `3`
- `runtime_proven_autonomous`: `9`
- `runtime_proven_manual_gate`: `2`

### Production Target States
- `production_autonomous`: `9`
- `production_experimental`: `3`
- `production_manual_gate`: `2`
- `production_not_intended`: `0`

### Subsystem Operating Classes
- `adaptive`: `5`
- `deterministic_instrumented`: `7`
- `manual_gated`: `2`

### Learning Modes
- `active_learning`: `5`
- `deterministic_instrumented`: `4`
- `manual_gate_only`: `2`
- `shadow_experimental`: `3`

### Registry Coverage
- Registry subsystems tracked: `14`
- Route coverage: `45/45`
- Scheduler coverage: `42/42`
- Engine coverage: `22/22`
- Database coverage: `55/55`
- Autonomous subsystems with audit coverage: `14/14`
- Autonomous subsystems with audit actions: `14/14`
- Autonomous subsystems with telemetry evidence: `14/14`
- Active-runtime subsystems with freshness signals: `14/14`
- Runtime/experimental subsystems with evidence queries: `14/14`
- Self-evolving subsystems with learning inputs: `6/6`
- Self-evolving subsystems with learning persistence: `6/6`
- Failure visibility complete: `14/14`

### Proof Status
- `runtime-proven`: `11`
- `partially-proven`: `0`
- `offline-by-design`: `0`
- `experimental`: `3`
- `drifted`: `0`

### Pre-Production Integrity
- Integrity status: `complete`
- Automation complete: `11/14`
- Data collection complete: `14/14`
- Auditability complete: `14/14`
- Failure visibility complete: `14/14`
- Authority correct: `14/14`
- Learning active: `6/6`
- Incomplete subsystems: `0`

### Production Convergence
- Convergence status: `blocked`
- Ready subsystem targets: `11`
- Blocked subsystem targets: `0`
- Experimental subsystem targets: `3`
- Shadow workflow candidates: `0`
- Inactive workflow candidates: `0`
- Broken workflow blockers: `0`
- Failing workflow blockers: `0`
- Source-missing workflow blockers: `2`
- Awaiting redeploy workflow blockers: `0`
- Stale workflow blockers: `0`
- Runtime control blockers: `0`

### Readiness Summary
- Launch ready: `false`
- Only TradingView manual at launch: `true`
- Launch-blocked subsystems: `3`
- Inactive by design: `0`
- Collecting only: `0`
- Learning blocked: `0`
- Runtime control blockers: `0`

### Closed-Loop Status
- `collecting_only`: `0`
- `learning_active`: `6`
- `learning_blocked`: `0`
- `not_collecting`: `5`
- `shadow_experimental`: `3`

### Workflow States
- `production-active`: `28`
- `built-inactive`: `0`
- `broken`: `0`
- `external-non-core`: `0`
- health `healthy`: `23`
- health `failing`: `0`
- health `stale`: `0`
- health `unknown`: `5`

### Subsystem Coverage Gaps
- `a_plus_market_auditor` class=`deterministic_instrumented` learningMode=`shadow_experimental` current=`experimental_preprod` target=`production_experimental` automation=`experimental` data=`complete` audit=`complete` failureVisibility=`complete` learning=`experimental` authority=`correct` ready=`false` preprodBlockers=experimental_governance productionBlockers=experimental_governance gaps=none
- `backtest_qualification` class=`deterministic_instrumented` learningMode=`deterministic_instrumented` current=`active_preprod` target=`production_autonomous` automation=`complete` data=`complete` audit=`complete` failureVisibility=`complete` learning=`not_applicable` authority=`correct` ready=`true` preprodBlockers=none productionBlockers=none gaps=none
- `cloud_qmc_ising` class=`deterministic_instrumented` learningMode=`shadow_experimental` current=`experimental_preprod` target=`production_experimental` automation=`experimental` data=`complete` audit=`complete` failureVisibility=`complete` learning=`experimental` authority=`correct` ready=`false` preprodBlockers=experimental_governance productionBlockers=experimental_governance gaps=none
- `compliance_governance` class=`deterministic_instrumented` learningMode=`deterministic_instrumented` current=`active_preprod` target=`production_autonomous` automation=`complete` data=`complete` audit=`complete` failureVisibility=`complete` learning=`not_applicable` authority=`correct` ready=`true` preprodBlockers=none productionBlockers=none gaps=none
- `context_execution` class=`adaptive` learningMode=`active_learning` current=`active_preprod` target=`production_autonomous` automation=`complete` data=`complete` audit=`complete` failureVisibility=`complete` learning=`active` authority=`correct` ready=`true` preprodBlockers=none productionBlockers=none gaps=none
- `critic_evolution` class=`adaptive` learningMode=`active_learning` current=`active_preprod` target=`production_autonomous` automation=`complete` data=`complete` audit=`complete` failureVisibility=`complete` learning=`active` authority=`correct` ready=`true` preprodBlockers=none productionBlockers=none gaps=none
- `deepar_regime` class=`adaptive` learningMode=`active_learning` current=`active_preprod` target=`production_autonomous` automation=`complete` data=`complete` audit=`complete` failureVisibility=`complete` learning=`active` authority=`correct` ready=`true` preprodBlockers=none productionBlockers=none gaps=none
- `observability_reliability` class=`deterministic_instrumented` learningMode=`deterministic_instrumented` current=`active_preprod` target=`production_autonomous` automation=`complete` data=`complete` audit=`complete` failureVisibility=`complete` learning=`not_applicable` authority=`correct` ready=`true` preprodBlockers=none productionBlockers=none gaps=none
- `pine_export_preparation` class=`manual_gated` learningMode=`manual_gate_only` current=`active_preprod` target=`production_manual_gate` automation=`complete` data=`complete` audit=`complete` failureVisibility=`complete` learning=`not_applicable` authority=`correct` ready=`true` preprodBlockers=none productionBlockers=none gaps=none
- `quantum_adversarial_stress` class=`deterministic_instrumented` learningMode=`shadow_experimental` current=`experimental_preprod` target=`production_experimental` automation=`experimental` data=`complete` audit=`complete` failureVisibility=`complete` learning=`experimental` authority=`correct` ready=`false` preprodBlockers=experimental_governance productionBlockers=experimental_governance gaps=none
- `quantum_experimental` class=`deterministic_instrumented` learningMode=`deterministic_instrumented` current=`active_preprod` target=`production_autonomous` automation=`complete` data=`complete` audit=`complete` failureVisibility=`complete` learning=`not_applicable` authority=`correct` ready=`true` preprodBlockers=none productionBlockers=none gaps=none
- `research_orchestration` class=`adaptive` learningMode=`active_learning` current=`active_preprod` target=`production_autonomous` automation=`complete` data=`complete` audit=`complete` failureVisibility=`complete` learning=`active` authority=`correct` ready=`true` preprodBlockers=none productionBlockers=none gaps=none
- `strategy_lifecycle` class=`manual_gated` learningMode=`manual_gate_only` current=`active_preprod` target=`production_manual_gate` automation=`complete` data=`complete` audit=`complete` failureVisibility=`complete` learning=`active` authority=`correct` ready=`true` preprodBlockers=none productionBlockers=none gaps=none
- `workflow_orchestration` class=`adaptive` learningMode=`active_learning` current=`active_preprod` target=`production_autonomous` automation=`complete` data=`complete` audit=`complete` failureVisibility=`complete` learning=`active` authority=`correct` ready=`true` preprodBlockers=none productionBlockers=none gaps=none

### Engine Subsystem Deep Scan
- `anti_setups` owner=`backtest_qualification` status=`runtime-proven` state=`active` gaps=none
- `archetypes` owner=`backtest_qualification` status=`runtime-proven` state=`active` gaps=none
- `backtester` owner=`backtest_qualification` status=`runtime-proven` state=`active` gaps=none
- `compiler` owner=`research_orchestration` status=`runtime-proven` state=`active` gaps=none
- `compliance` owner=`compliance_governance` status=`runtime-proven` state=`active` gaps=none
- `context` owner=`context_execution` status=`runtime-proven` state=`active` gaps=none
- `critic_optimizer` owner=`critic_evolution` status=`runtime-proven` state=`active` gaps=none
- `decay` owner=`compliance_governance` status=`runtime-proven` state=`active` gaps=none
- `deepar_forecaster` owner=`deepar_regime` status=`runtime-proven` state=`active` gaps=none
- `deepar_regime_classifier` owner=`deepar_regime` status=`runtime-proven` state=`active` gaps=none
- `governor` owner=`compliance_governance` status=`runtime-proven` state=`active` gaps=none
- `graveyard` owner=`strategy_lifecycle` status=`runtime-proven` state=`active` gaps=none
- `monte_carlo` owner=`backtest_qualification` status=`runtime-proven` state=`active` gaps=none
- `parameter_evolver` owner=`critic_evolution` status=`runtime-proven` state=`active` gaps=none
- `pine_compiler` owner=`pine_export_preparation` status=`runtime-proven` state=`active` gaps=none
- `quantum_mc` owner=`quantum_experimental` status=`runtime-proven` state=`active` gaps=none
- `skip_engine` owner=`context_execution` status=`runtime-proven` state=`active` gaps=none
- `strategy_memory` owner=`research_orchestration` status=`runtime-proven` state=`active` gaps=none
- `survival` owner=`backtest_qualification` status=`runtime-proven` state=`active` gaps=none
- `validation` owner=`research_orchestration` status=`runtime-proven` state=`active` gaps=none
- `validation_runner` owner=`research_orchestration` status=`runtime-proven` state=`active` gaps=none
- `walk_forward` owner=`backtest_qualification` status=`runtime-proven` state=`active` gaps=none

### API Routes
- `/api/admin`
- `/api/adversarial-stress`
- `/api/agent`
- `/api/alerts`
- `/api/anti-setups`
- `/api/archetypes`
- `/api/auditor`
- `/api/backtests`
- `/api/cloud-qmc`
- `/api/compiler`
- `/api/compliance`
- `/api/context`
- `/api/critic-optimizer`
- `/api/data`
- `/api/decay`
- `/api/deepar`
- `/api/dlq`
- `/api/governor`
- `/api/graveyard`
- `/api/health`
- `/api/indicators`
- `/api/journal`
- `/api/macro`
- `/api/metrics`
- `/api/monte-carlo`
- `/api/n8n`
- `/api/openai-proxy`
- `/api/openclaw/daily-report`
- `/api/paper`
- `/api/pine-export`
- `/api/portfolio`
- `/api/prevalidate`
- `/api/prop-firm`
- `/api/quantum-mc`
- `/api/risk`
- `/api/search`
- `/api/signals`
- `/api/skip`
- `/api/sse`
- `/api/strategies`
- `/api/strategy-names`
- `/api/supadata`
- `/api/survival`
- `/api/tournament`
- `/api/validation`

### Scheduler Jobs
- `a-plus-auditor-scan`
- `agent-health-sweep`
- `anti-setup-effectiveness`
- `anti-setup-mine`
- `archetype-daily-classify`
- `cloud-qmc-poll`
- `compliance-rule-drift`
- `contract-roll-sweep`
- `critic-feedback`
- `decay-monitor`
- `deepar-predict`
- `deepar-train`
- `deepar-validate`
- `disabled-job-probe`
- `dlq-escalation`
- `dlq-retry`
- `drain-scouted-ideas-periodic`
- `funnel-snapshot`
- `graveyard-pattern-extraction`
- `idempotency-cleanup`
- `lifecycle-auto-check`
- `macro-data-sync`
- `meta-parameter-review`
- `metrics-collector`
- `metrics-heartbeat`
- `n8n-health-check`
- `n8n-workflow-sync`
- `paper-vs-backtest`
- `pipeline-resume-drain`
- `portfolio-correlation`
- `pre-market-prep`
- `prompt-ab-resolution`
- `python-pool-saturation-check`
- `quantum-cost-prune`
- `regret-score-fill`
- `resource-snapshot`
- `rolling-sharpe`
- `session-analytics-rollup`
- `stale-pending-sweeper`
- `stale-session-check`
- `system-map-drift`
- `tournament-staleness-check`

### Engine Subsystems
- `anti_setups`
- `archetypes`
- `backtester`
- `compiler`
- `compliance`
- `context`
- `critic_optimizer`
- `decay`
- `deepar_forecaster`
- `deepar_regime_classifier`
- `governor`
- `graveyard`
- `monte_carlo`
- `parameter_evolver`
- `pine_compiler`
- `quantum_mc`
- `skip_engine`
- `strategy_memory`
- `survival`
- `validation`
- `validation_runner`
- `walk_forward`

### Workflow Inventory
- `0A_health_monitor_66HEjQavpvirY6g5`
- `10A_master_orchestration_8HKXzNmo9KF59SBu`
- `11A_critic_optimization_pVT6svNTljjBoQbW`
- `3A_workflow_backup_J0p8oYkONmN7pYn6`
- `5A_weekly_tournament_2rVOEn4LnMAubTmW`
- `5G_brave_search_scout_z2c7zJmSx5dNle6P`
- `5H_reddit_scout_ZMgHYjcTq4YTRQXh`
- `5I_tavily_scout_TMT3g7HenJ5etiwv`
- `6D_compliance_gate_RumAJUp4iS1TYlNm`
- `7A_auto_evolution_MIIxmilbgZv3SUBh`
- `8A_idea_to_strategy_vlCaiWM7F0AH1RRY`
- `8B_source_quality_review_LQtqeWAcNOlkqROH`
- `9A_nightly_self_critique_26ruSYvIjqHGOhsd`
- `Anti_Setup_Refresh_PHcD2tFZpzr7kQGF`
- `Daily_Compliance_Check_WT9sVMzG83rg1L29`
- `Daily_Portfolio_Monitor_u0RcmfuClgRinXAX`
- `Daily_Scout_5E_7GCDtSCifGgdpeuq`
- `Macro_Data_Sync_X2IjKuYseGukxKDj`
- `Monthly_Robustness_Check_m6aD7X4ioWfhWaS9`
- `Nightly_Strategy_Research_Loop_Z4NcOCDbet8KzjDd`
- `Post_Session_Skip_Review_LayXj1mbHh4aGSM9`
- `Pre_Session_Compliance_Gate_gFwNlA3eCHbSb7en`
- `Pre_Session_Skip_Check_eaq72MwKwCjv7g7F`
- `Strategy_Generation_Loop_eCr7cyb0aPArFCZc`
- `Strategy_Tournament_hPXhUaSC3ScznZE9`
- `Weekly_Compliance_Re_Parse_YuDGQkuej7qybPAB`
- `Weekly_Deep_Research_5F_zmjj1mqjSbeVcWZg`
- `Weekly_Strategy_Hunt_sAIrnCVB4iOsodsy`

### Database Tables
- `a_plus_market_scans`
- `adversarial_stress_runs`
- `agent_health_reports`
- `alerts`
- `audit_log`
- `backtest_matrix`
- `backtest_trades`
- `backtests`
- `cloud_qmc_runs`
- `compliance_drift_log`
- `compliance_reviews`
- `compliance_rulesets`
- `contract_rolls`
- `critic_candidates`
- `critic_optimization_runs`
- `data_sync_jobs`
- `day_archetypes`
- `dead_letter_queue`
- `deepar_forecasts`
- `deepar_training_runs`
- `idempotency_keys`
- `lifecycle_transitions`
- `macro_snapshots`
- `monte_carlo_runs`
- `mutation_outcomes`
- `n8n_execution_log`
- `paper_positions`
- `paper_session_feedback`
- `paper_sessions`
- `paper_signal_logs`
- `paper_trades`
- `prompt_ab_tests`
- `prompt_versions`
- `quantum_mc_benchmarks`
- `quantum_mc_runs`
- `quantum_run_costs`
- `qubo_timing_runs`
- `rl_training_runs`
- `shadow_signals`
- `skip_decisions`
- `sqa_optimization_runs`
- `strategies`
- `strategy_export_artifacts`
- `strategy_exports`
- `strategy_graveyard`
- `strategy_lockouts`
- `strategy_names`
- `stress_test_runs`
- `subsystem_metrics`
- `system_journal`
- `system_parameter_history`
- `system_parameters`
- `tensor_predictions`
- `tournament_results`
- `walk_forward_windows`
<!-- END GENERATED: topology -->
