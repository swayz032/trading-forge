
  ═══════════════════════════════════════════════════════════════════════════
    Trading Forge — Full End-to-End System Map (Updated 2026-03-23)
  ═══════════════════════════════════════════════════════════════════════════

    1. STRATEGY LIFECYCLE (The Core Loop)

    CANDIDATE → TESTING → PAPER → DEPLOYED → DECLINING → RETIRED
        ↑                                         ↓
        └──── GRAVEYARD (dead strategies) ←───────┘

    How strategies enter: OpenClaw Scout (n8n) generates ICT concepts → Ollama trading-quant writes DSL
    → Compiler validates → Backtester scores → Performance Gate grades → CANDIDATE

    How strategies advance:
    - CANDIDATE → TESTING: Passes performance gate (win rate, R:R, profit factor, max DD)
    - TESTING → PAPER: Walk-forward validation + Monte Carlo survival
    - PAPER → DEPLOYED: Paper trading proves real-time edge (rolling Sharpe > threshold)
    - DEPLOYED → DECLINING: Drift detection flags decay (rolling metrics below thresholds)
    - DECLINING → RETIRED: Fails to recover within grace period
    - Any stage → GRAVEYARD: Catastrophic failure, compliance violation, or manual kill

    2. RESEARCH & GENERATION PIPELINE

    n8n Strategy Generation Loop (eCr7cyb0aPArFCZc)
        │
        ├─ 1. Brave/Tavily search for ICT concepts
        ├─ 2. Ollama deepseek-r1:14b critiques concept
        ├─ 3. Ollama trading-quant writes DSL JSON
        ├─ 4. POST /api/compiler → Python AST compilation
        ├─ 5. POST /api/validation/cross → Cross-validate concept spec
        ├─ 6. POST /api/backtests → Run backtest with slippage model
        ├─ 7. Performance gate scores results
        ├─ 8. POST /api/strategies → Store if passes all gates
        └─ 9. Loop: up to N iterations per concept

    Key gates in this pipeline:
    - Compiler gate: Does the DSL parse? Are all indicators/conditions valid?
    - Validation gate: Does the concept match a known spec? Static + runtime checks
    - Performance gate: Win rate ≥ 55%, R:R ≥ 2.0, profit factor ≥ 1.5, max DD within limits
    - Tier assignment: _compute_tier() grades S/A/B/C/F

    3. BACKTESTING ENGINE (Python)

    src/engine/backtester.py
        │
        ├─ DSL Path (line ~1200): Parse JSON strategy definition
        │   ├─ Load indicators (8 modules, 50+ indicators)
        │   ├─ Evaluate entry/exit conditions per bar
        │   ├─ Apply position sizing (Kelly, fixed, risk-based)
        │   ├─ Simulate fills with slippage model
        │   ├─ Track equity curve, drawdowns, trades
        │   └─ _compute_tier() → S/A/B/C/F grade
        │
        ├─ Class Path (line ~2200): Strategy class instances
        │   └─ Same flow as DSL but using Python class methods
        │
        ├─ Walk-Forward (walk_forward.py)
        │   ├─ Rolling window: train on N bars, test on M bars
        │   ├─ Anchored or sliding window modes
        │   └─ Out-of-sample performance validation
        │
        ├─ Monte Carlo (monte_carlo.py)
        │   ├─ Trade shuffling (order independence)
        │   ├─ Return bootstrapping
        │   ├─ Drawdown probability distributions
        │   └─ Survival probability at various DD levels
        │
        ├─ NEW — SQA Alternative Optimizer (quantum_annealing_optimizer.py)
        │   ├─ API option: optimizer: "sqa" in POST /api/backtests
        │   ├─ Fire-and-forget: runs after backtest completes
        │   ├─ QUBO formulation of parameter search space
        │   ├─ dwave-samplers SimulatedAnnealingSampler
        │   ├─ Results stored under walkForwardResults.sqa_optimization
        │   └─ Governance: experimental, challenger_only
        │
        └─ Supporting modules:
            ├─ fill_model.py — Realistic fill simulation
            ├─ slippage.py — Per-instrument slippage estimates
            ├─ gap_risk.py — Overnight gap exposure
            ├─ liquidity.py — Volume-based fill probability
            └─ stress_test.py — Regime-specific performance

    4. CONTEXT ENGINE (Python → Node bridge)

    Signal arrives
        │
        ├─ Layer 0: Data Collection
        │   ├─ htf_context.py — Daily bars from DuckDB/S3 Parquet
        │   │   └─ HTF trend, key levels, ATR regime, volume profile
        │   └─ session_context.py — Intraday session analysis
        │       └─ Session type (London/NY/Asia), time-of-day filters
        │
        ├─ Layer 1: Bias Computation
        │   └─ bias_engine.py — Aggregates 6+ signals into net bias (-100 to +100)
        │       ├─ HTF trend alignment
        │       ├─ Key level proximity
        │       ├─ Volume confirmation
        │       ├─ Session timing
        │       ├─ Momentum alignment
        │       └─ Volatility regime
        │
        ├─ Layer 2: Playbook + Location
        │   ├─ playbook_router.py — Maps bias + conditions → playbook name
        │   │   └─ e.g., "Trend Continuation", "Mean Reversion", "Breakout"
        │   └─ location_score.py — Price location relative to structure
        │       └─ Distance from key levels, ATR-normalized
        │
        ├─ Layer 3: Eligibility Decision
        │   └─ eligibility_gate.py → TAKE / REDUCE / SKIP
        │       ├─ TAKE: Full size, proceed
        │       ├─ REDUCE: Half contracts (bias alignment weak)
        │       └─ SKIP: Don't trade (bias opposition, bad location)
        │
        └─ NEW — Layer 4: Tensor Network Signal (tensor_signal_model.py)
            └─ context-gate-service.ts → evaluateTensorSignal()
                ├─ Runs in PARALLEL with context engine (zero added latency)
                ├─ Spawns MPS model in predict mode
                ├─ Returns P(profitable) [0,1] on ContextGateResult
                ├─ Informational only — does NOT change TAKE/REDUCE/SKIP
                └─ Governance: experimental, challenger_only

    API endpoints:
    - POST /api/context/bias — Pre-signal context (bias + playbook)
    - POST /api/context/evaluate — Full eligibility (now includes tensorSignalProbability)

    5. PAPER TRADING (Real-Time Execution)

    Market Data (Databento WebSocket)
        │
        └─ paper-trading-stream.ts — Per-symbol OHLCV streaming
            │
            └─ paper-signal-service.ts — Signal detection + execution
                │
                ├─ 1. Bar buffer fills (configurable lookback)
                ├─ 2. Indicators computed on buffer
                ├─ 3. Strategy conditions evaluated
                ├─ 4. SIGNAL DETECTED
                │
                ├─ 5. Risk Gate (paper-risk-gate.ts)
                │   ├─ Daily loss limit check
                │   ├─ Max concurrent positions check
                │   ├─ Prop firm rule compliance (if firmId set)
                │   ├─ Trailing drawdown check
                │   └─ Contract cap per symbol
                │
                ├─ 6. Context Gate (context-gate-service.ts)
                │   ├─ Fetches daily bars (cached per symbol/day)
                │   ├─ Calls Python context engine subprocess
                │   ├─ NEW — Tensor signal P(profitable) runs in parallel
                │   ├─ SKIP → reject signal, log reasoning
                │   ├─ REDUCE → halve contracts
                │   └─ TAKE → proceed full size
                │
                ├─ 7. Position OPEN
                │   ├─ INSERT into paper_positions
                │   ├─ Record entry price, contracts, strategy
                │   ├─ Set stop loss + take profit levels
                │   └─ SSE event → frontend
                │
                ├─ 8. Position MANAGEMENT (per bar)
                │   ├─ Check stop loss hit
                │   ├─ Check take profit hit
                │   ├─ Trail stop if configured
                │   ├─ Time-based exit (max hold duration)
                │   └─ Update unrealized P&L
                │
                └─ 9. Position CLOSE
                    ├─ Compute realized P&L (our math, NOT vectorbt)
                    ├─ UPDATE paper_positions with exit data
                    ├─ UPDATE paper_sessions equity/drawdown
                    ├─ Record in paper_trades journal
                    ├─ SSE event → frontend
                    └─ Trigger post-trade analytics

    Execution services:
    - paper-execution-service.ts — Position open/close DB operations, equity tracking
    - paper-risk-gate.ts — Pre-trade risk checks (daily loss, drawdown, firm rules)
    - paper-trading-stream.ts — WebSocket management, start/stop per symbol

    6. PROP FIRM INTEGRATION

    8 Supported Firms (src/shared/firm-config.ts + src/engine/firm_config.py):
        ├─ Topstep
        ├─ Apex
        ├─ TradeDay
        ├─ MyFundedFutures (MFF)
        ├─ FastTrackTrading (FTT)
        ├─ Tradeify
        ├─ TheFundedTrader (TFN/FFN)
        └─ Bulenox

    Each firm has:
        ├─ Account sizes (50K, 100K, 150K, etc.)
        ├─ Max drawdown (trailing or EOD)
        ├─ Daily loss limits
        ├─ Profit targets
        ├─ Contract caps per instrument
        ├─ Scaling plan (gradual contract increase)
        ├─ Payout rules (buffer phase, payout tiers)
        └─ Consistency rules (no single day > X% of total profit)

    Routes: /api/prop-firm
        ├─ GET /firms — List all firms + configs
        ├─ GET /firms/:firm/accounts — Account sizes for a firm
        ├─ POST /simulate — Run prop sim (prop_sim.py)
        ├─ POST /rank — Rank firms for a strategy (which firm is best fit?)
        ├─ POST /compliance — Check a trade history against firm rules
        ├─ POST /payout — Estimate payout timeline
        └─ GET /timeline — Days to funded estimate

    Prop Compliance (prop_compliance.py):
        ├─ Drawdown tracking (trailing vs EOD)
        ├─ Daily loss limit enforcement
        ├─ Consistency checks (TPT = no day > 40-50% of profits)
        ├─ Scaling plan validation
        └─ Payout eligibility

    7. QUANTUM RISK LAB (NEW — 7 Python engines + 2 TS services)

    ┌─────────────────────────────────────────────────────────────────────┐
    │  GOVERNANCE MODEL                                                   │
    │                                                                     │
    │  Authoritative (ground truth):     Experimental Challenger:         │
    │  ├─ Classical Monte Carlo          ├─ Quantum MC (IAE)              │
    │  ├─ Walk-forward validation        ├─ Tensor Network (MPS)          │
    │  ├─ Prop-firm rules engine         ├─ SQA Optimizer                 │
    │  └─ Performance gate scoring       ├─ QUBO Trade Timing             │
    │                                    └─ Quantum RL Agent              │
    │                                                                     │
    │  Every quantum run: experimental=true, authoritative=false,         │
    │                      decision_role=challenger_only                   │
    └─────────────────────────────────────────────────────────────────────┘

    7a. Quantum Infrastructure (Python)

    src/engine/quantum_models.py — Fit distributions from MC data
        ├─ fit_truncated_normal(data, bounds)
        ├─ fit_mixture_model(data, n_components)
        ├─ fit_regime_bucket_model(data, regime_labels)
        ├─ build_empirical_binned_distribution(data, n_bins)
        └─ serialize_uncertainty_model(model)

    src/engine/prop_survival_model.py — Prop-firm risk event definitions
        ├─ build_breach_event(firm_rules, starting_balance)
        ├─ build_target_event(firm_rules, starting_balance)
        ├─ build_tail_loss_event(threshold, distribution)
        └─ build_risk_band_scenarios(firm_rules, risk_range)

    src/engine/hardware_profile.py — Auto-detect GPU/RAM, configure backends
        ├─ detect_gpu() — Check VRAM, CUDA capability
        ├─ get_max_qubits_statevector() — RTX 5060: 27-28 qubits GPU
        ├─ get_max_qubits_cpu() — 32GB RAM: 30-31 qubits CPU
        └─ select_backend(problem_size) — Auto GPU/CPU/tensor-network

    7b. Quantum Engines (all experimental, challenger_only)

    src/engine/quantum_mc.py — IAE Amplitude Estimation (Qiskit 2.3.1)
        ├─ run_quantum_breach_estimation(model, threshold, backend)
        ├─ run_quantum_ruin_estimation(model, threshold, backend)
        ├─ run_quantum_target_hit_estimation(model, threshold, backend)
        ├─ run_quantum_tail_loss_estimation(model, threshold, backend)
        └─ run_hybrid_compare(classical_result, quantum_result)

    src/engine/quantum_bench.py — Benchmarking framework
        ├─ benchmark_against_classical(quantum_result, classical_result, tolerance)
        ├─ validate_tolerance(delta, tolerance_config)
        └─ build_reproducibility_hash(run_config)

    src/engine/tensor_signal_model.py — MPS Tensor Network (quimb 1.13)
        ├─ build_mps_model(feature_config, bond_dim)
        ├─ train_mps(model, training_data, epochs)
        ├─ predict_trade_outcome(model, features) → P(profitable)
        ├─ evaluate_mps(model, test_data)
        └─ serialize_mps(model) / load_mps(path)

    src/engine/quantum_annealing_optimizer.py — SQA Optimizer (dwave-samplers 1.7)
        ├─ build_parameter_qubo(param_ranges, objective)
        ├─ run_sqa_optimization(qubo, num_reads, num_sweeps)
        ├─ decode_solution(binary_solution, param_ranges)
        ├─ compare_vs_optuna(sqa_result, optuna_result)
        └─ find_robust_plateau(solutions, top_k)

    src/engine/qubo_trade_timing.py — QUBO Session Optimization (dwave-samplers 1.7)
        ├─ discretize_session(session_profile, window_size) → 13 RTH / 31 ETH blocks
        ├─ build_timing_qubo(historical_returns, risk_constraints, correlations)
        ├─ solve_timing(qubo, num_reads) → trade/skip per block
        ├─ decode_timing_schedule(solution, session_profile)
        ├─ backtest_timing_schedule(schedule, strategy, historical_data)
        └─ compare_vs_classical_timing(sqa_schedule, classical_schedule)

    src/engine/quantum_rl_agent.py — VQC RL Agent (PennyLane, WSL2 GPU)
        ├─ build_vqc_policy(n_qubits, n_layers, feature_map)
        ├─ train_quantum_agent(env, policy, episodes, learning_rate)
        ├─ evaluate_agent(policy, test_env)
        ├─ compare_vs_classical_rl(quantum_results, classical_results)
        └─ export_agent_signals(policy, market_data)

    7c. Quantum API Endpoints

    POST /api/quantum-mc/run              → IAE breach/ruin/target estimation
    POST /api/quantum-mc/hybrid-compare   → Classical + quantum side-by-side
    POST /api/quantum-mc/tensor-train     → Train MPS model
    POST /api/quantum-mc/tensor-predict   → MPS P(profitable) prediction
    POST /api/quantum-mc/sqa-optimize     → SQA parameter search
    POST /api/quantum-mc/qubo-timing      → QUBO session block optimization
    POST /api/quantum-mc/rl-train         → Train VQC RL agent
    POST /api/quantum-mc/rl-evaluate      → Evaluate/compare RL agent
    GET  /api/quantum-mc/:id              → Fetch persisted run
    GET  /api/quantum-mc/benchmarks/:id   → Fetch comparison details

    7d. Quantum Auto-Triggers (fire-and-forget)

    Backtest completes with daily P&Ls
        │
        └─ Auto Monte Carlo (50K sims, all 8 firms)
            │
            ├─ If probability_of_ruin exists:
            │   └─ Auto Quantum Challenger (quantum_mc breach estimation)
            │       └─ Persists to quantum_mc_runs + quantum_mc_benchmarks
            │
            ├─ If survival_rate > 80%:
            │   ├─ Auto Pine Export (compilePineExport with topstep_50k)
            │   │   └─ Only stores if exportability_score >= 70
            │   └─ Auto Cross Matrix (multi-symbol robustness)
            │
            └─ If tier is TIER_1/2/3:
                └─ Auto-promote to PAPER trading

    7e. Hardware Profile (RTX 5060, 8GB VRAM, 32GB RAM)

    ┌──────────────────────────────────┬──────────────────────────────────┐
    │  Windows Native (CPU)            │  WSL2 Ubuntu 22.04 (GPU)         │
    ├──────────────────────────────────┼──────────────────────────────────┤
    │  qiskit 2.3.1                    │  qiskit 2.3.1                    │
    │  qiskit-aer 0.17.2              │  qiskit-aer 0.17.2              │
    │  qiskit-algorithms 0.4.0        │  qiskit-algorithms 0.4.0        │
    │  dwave-samplers 1.7.0           │  dwave-samplers 1.7.0           │
    │  quimb 1.13.0                   │  quimb 1.11.2                   │
    │  scipy 1.17.1                   │  pennylane 0.42.3               │
    │  numpy 2.4.3                    │  pennylane-lightning[gpu] 0.42.0 │
    │                                  │  cupy-cuda12x 14.0.1            │
    │                                  │  cuquantum-cu12 26.1.0          │
    ├──────────────────────────────────┼──────────────────────────────────┤
    │  CPU statevector: ~30 qubits    │  GPU statevector: ~27 qubits     │
    └──────────────────────────────────┴──────────────────────────────────┘

    8. PINE EXPORT COMPILER (NEW — DSL → TradingView)

    Strategy (passes all gates)
        │
        ├─ Exportability Check (exportability.py)
        │   ├─ Score 0-100
        │   │   ├─ 90-100: Clean Pine deployment candidate
        │   │   ├─ 70-89: Pine possible with reductions
        │   │   ├─ 50-69: Alert-only export recommended
        │   │   └─ <50: Do not export
        │   ├─ Indicator compatibility (DSL → Pine v6 mapping)
        │   └─ Deductions for unexportable features (ML, external APIs)
        │
        ├─ Pine Compilation (pine_compiler.py)
        │   ├─ Normalize StrategyDSL → internal format
        │   ├─ Map indicators → Pine v6:
        │   │   sma→ta.sma  ema→ta.ema  rsi→ta.rsi  atr→ta.atr
        │   │   vwap→ta.vwap  bollinger→ta.bb  macd→ta.macd  adx→ta.dmi
        │   │   order_block→custom  fvg→custom  breaker→custom  sweep→custom
        │   ├─ Build state machine:
        │   │   neutral → watch_long → long_confirmed → invalidated → risk_lockout
        │   ├─ Inject prop-risk overlay (firm constants from firm_config.py)
        │   ├─ Inject risk intelligence overlay (breach_prob, survival, quantum estimate)
        │   ├─ Build alert definitions JSON
        │   │   (long_armed, short_armed, entry_confirmed, invalidated,
        │   │    prop_risk_lockout, no_trade)
        │   └─ Emit artifacts: indicator.pine, alerts.json, strategy_shell.pine (optional)
        │
        └─ DB Persistence
            ├─ strategy_exports — Job status, exportability score, firm overlay
            └─ strategy_export_artifacts — .pine content, type, size

    Routes: /api/pine-export
        ├─ POST /compile — Compile strategy to Pine artifacts
        ├─ GET /:id — Fetch export metadata
        ├─ GET /:id/artifacts — List artifacts
        └─ GET /:id/artifacts/:artifactId/download — Download .pine file

    Auto-trigger: MC survival > 80% → auto Pine compile (fire-and-forget)

    9. SKIP ENGINE (Pre-Market Gate)

    POST /api/skip/classify
        │
        └─ Python skip_engine/ modules (10 signals, was 9):
            ├─ 1. event_proximity    (weight 3.0) — FOMC/CPI/NFP ±30 min = SIT_OUT
            ├─ 2. vix_level          (weight 2.5) — >30 = SKIP, 25-30 = REDUCE
            ├─ 3. overnight_gap      (weight 2.0) — >1.5 ATR = SKIP
            ├─ 4. premarket_volume   (weight 1.5) — <30% normal = SKIP
            ├─ 5. day_of_week        (weight 1.0) — Historically bad days
            ├─ 6. loss_streak        (weight 2.0) — >3 days = REDUCE, >5 = SKIP
            ├─ 7. monthly_budget     (weight 2.5) — >60% DD used = REDUCE, >80% = SKIP
            ├─ 8. correlation_spike  (weight 1.5) — Portfolio corr >0.7 = REDUCE
            ├─ 9. calendar_filter    (weight 2.0) — Holiday, triple witching, roll week
            └─ 10. qubo_timing (NEW) (weight 1.5) — SQA session block says skip this window

    Thresholds: score ≥ 6.0 → SKIP, score ≥ 3.0 → REDUCE, else → TRADE

    10. MONITORING & DECAY DETECTION

    Scheduler (src/server/scheduler.ts) — Cron jobs:
        │
        ├─ Rolling Sharpe (every 4 hours)
        │   └─ Recompute rolling Sharpe ratio for all active strategies
        │
        ├─ Pre-Market Prep (6:00 AM ET)
        │   └─ Skip classifier: 10 signals → trade/skip today
        │       ├─ Economic calendar check
        │       ├─ VIX regime
        │       ├─ Overnight gap analysis
        │       ├─ Correlation cluster check
        │       ├─ Session outlook
        │       └─ NEW — QUBO timing recommendation
        │
        ├─ Drift Detection (every 6 hours)
        │   └─ drift-detection.ts + regime.ts
        │       ├─ Rolling win rate vs historical
        │       ├─ Rolling profit factor vs historical
        │       ├─ Regime shift detection (HMM-based)
        │       ├─ Parameter drift (are optimal params shifting?)
        │       └─ Auto-demotion: DEPLOYED → DECLINING if drift confirmed
        │
        ├─ Decay Monitor (daily)
        │   └─ decay.ts route + Python decay modules
        │       ├─ Equity curve slope analysis
        │       ├─ Drawdown duration tracking
        │       └─ Strategy health scoring
        │
        └─ Graveyard Gate (on strategy demotion)
            └─ graveyard-gate.ts
                ├─ Archive strategy details
                ├─ Record cause of death
                └─ Prevent resurrection without re-validation

    11. GOVERNOR (Position-Level Risk)

    POST /api/governor/check
        │
        └─ Python governor/ modules:
            ├─ portfolio_heat.py — Total portfolio risk exposure
            ├─ correlation_guard.py — Correlated position limits
            ├─ drawdown_governor.py — Dynamic sizing based on DD
            ├─ volatility_scale.py — Size adjustment for vol regime
            └─ concentration_limit.py — Max exposure per sector/asset

    12. AGENT PIPELINE (AI-Assisted Analysis)

    POST /api/agent/analyze
        │
        └─ agent-service.ts
            ├─ Ollama chat (trading-quant or deepseek-r1:14b)
            ├─ Strategy analysis prompts
            ├─ Trade journal analysis
            ├─ Performance review
            └─ Market context interpretation

    POST /api/agent/stream — SSE streaming responses

    13. TOURNAMENT & ARCHETYPES

    Tournament (/api/tournament):
        ├─ Compare strategies head-to-head
        ├─ Rank by composite score
        ├─ Elo-style ratings
        └─ Bracket elimination

    Archetypes (/api/archetypes):
        ├─ Classify strategies by behavior pattern
        ├─ Trend-follower, mean-reversion, breakout, etc.
        ├─ Performance by archetype
        └─ Portfolio balance across archetypes

    14. ANTI-SETUPS

    POST /api/anti-setups/detect
        │
        └─ Python anti_setups/ modules:
            ├─ Identify conditions that LOOK like setups but aren't
            ├─ False breakout patterns
            ├─ Trap patterns (bull/bear traps)
            ├─ Low-probability zones
            └─ Feed back into eligibility gate as negative signal

    15. DATA LAYER

    Database: PostgreSQL (Drizzle ORM, 30+ tables)
        │
        ├─ Core:       strategies, strategy_versions, backtests, backtest_trades,
        │              walk_forward_windows
        ├─ Paper:      paper_sessions, paper_positions, paper_trades
        ├─ Monitoring: decay_snapshots, drift_events, graveyard, skip_decisions
        ├─ Risk:       risk_profiles, stress_test_runs, monte_carlo_runs
        ├─ Quantum:    quantum_mc_runs, quantum_mc_benchmarks (NEW)
        ├─ Pine:       strategy_exports, strategy_export_artifacts (NEW)
        ├─ Compliance: compliance_rulesets, compliance_reviews, compliance_drift_log
        └─ Other:      alerts, alert_events, concept_specs, macro_events,
                       tournament_results, journal_entries, audit_log

    Market Data:
        ├─ Databento WebSocket — Real-time OHLCV bars
        ├─ DuckDB → S3 Parquet — Historical daily bars
        ├─ Polygon API — Fallback historical data
        └─ src/data/fetchers/ — Data acquisition scripts

    Ollama (Local LLM):
        ├─ trading-quant (qwen3-coder:30b) — Strategy DSL generation
        ├─ deepseek-r1:14b — Fast critique/analysis
        └─ nomic-embed-text — Embeddings for similarity search

    16. PORTFOLIO & CORRELATION

    /api/portfolio:
        ├─ Portfolio-level metrics across all active strategies
        ├─ Correlation matrix between strategies
        ├─ Diversification scoring
        ├─ Combined equity curve
        └─ Risk-adjusted returns (Sharpe, Sortino, Calmar)

    correlation-service.ts:
        ├─ Real-time correlation tracking
        ├─ Regime-conditional correlations
        └─ Alert on correlation spikes

    17. SSE REAL-TIME EVENTS

    /api/sse/stream — Server-Sent Events
        │
        ├─ position:open — New position opened
        ├─ position:close — Position closed
        ├─ position:update — Unrealized P&L update
        ├─ signal:detected — New signal from strategy
        ├─ signal:rejected — Signal rejected by gate
        ├─ alert:triggered — Alert condition met
        ├─ session:update — Session metrics update
        ├─ drift:detected — Strategy drift warning
        └─ strategy:promoted — Strategy auto-advanced to PAPER (NEW)

    18. n8n ORCHESTRATION WORKFLOWS

    Active Workflows:
        ├─ Strategy Generation Loop — Scout → Critique → Compile → Validate → Backtest
        ├─ Pre-Market Prep — Daily skip decision + context bias
        ├─ Post-Market Review — Daily performance summary
        ├─ Drift Response — Auto-handle drift events
        └─ (Future) Strategy Promotion — Auto-advance lifecycle stages

    All workflows call Trading Forge API endpoints.
    n8n runs locally alongside the Node server.

    19. COMPLETE DATA FLOW (End-to-End)

                      ┌──────────────────────────────────────────────┐
                      │           n8n ORCHESTRATION                   │
                      │  Scout → Critique → Compile → Validate       │
                      │  → Backtest → Performance Gate → Store        │
                      └──────────────────┬───────────────────────────┘
                                         │ New strategy (CANDIDATE)
                                         ▼
                      ┌──────────────────────────────────────────────┐
                      │           PROMOTION PIPELINE                  │
                      │  Walk-Forward → Monte Carlo → Prop Sim       │
                      │  → Tournament Rank → Paper Assignment         │
                      └──────────────────┬───────────────────────────┘
                                         │
                      ┌──────────────────┼───────────────────────────┐
                      │                  ▼                            │
                      │  ┌─ Auto Quantum Challenger (fire-and-forget) │
                      │  │   ├─ IAE breach estimation                │
                      │  │   ├─ Benchmark vs classical MC            │
                      │  │   └─ Store with governance labels         │
                      │  │                                           │
                      │  ├─ Auto Pine Export (if survival > 80%)     │
                      │  │   ├─ Exportability scoring                │
                      │  │   ├─ DSL → Pine v6 transpilation          │
                      │  │   ├─ Risk intelligence overlay            │
                      │  │   └─ Alert JSON generation                │
                      │  │                                           │
                      │  └─ Auto Cross Matrix (if survival > 80%)    │
                      │                                              │
                      └──────────────────┬───────────────────────────┘
                                         │ Strategy enters PAPER
                                         ▼
  ┌──────────────┐   ┌──────────────────────────────────────────────┐
  │  PRE-MARKET  │──▶│           PAPER TRADING ENGINE                │
  │  Skip Engine │   │                                              │
  │ (10 signals) │   │  Market Data → Bar Buffer → Indicators       │
  │  + QUBO      │   │  → Signal Detection                          │
  │    timing    │   │  → Risk Gate (daily loss, DD, caps)           │
  └──────────────┘   │  → Context Gate (bias, eligibility)           │
                      │  → Tensor Signal (MPS P(profitable))         │
                      │  → Position Open → Management → Close → P&L  │
                      └──────────────────┬───────────────────────────┘
                                         │ Trade results
                                         ▼
                      ┌──────────────────────────────────────────────┐
                      │           MONITORING & DECAY                  │
                      │  Rolling Sharpe │ Drift Detection             │
                      │  Decay Monitor  │ Graveyard Gate              │
                      │  Governor       │ Anti-Setup Detection        │
                      └──────────────────┬───────────────────────────┘
                                         │ Metrics feed back
                                         ▼
                      ┌──────────────────────────────────────────────┐
                      │           PROP FIRM OPTIMIZATION              │
                      │  Simulate → Rank Firms → Compliance          │
                      │  → Payout Timeline → Best Fit Selection      │
                      └──────────────────┬───────────────────────────┘
                                         │ Revenue projection
                                         ▼
                      ┌──────────────────────────────────────────────┐
                      │      DEPLOYMENT (TradingView) — NEW          │
                      │  Pine v6 Indicator │ Alert JSON              │
                      │  Prop Risk Overlay │ Risk Intelligence Table │
                      │  → Copy/paste to TradingView                │
                      │  → Alerts → Tradovate/Tradeify execution    │
                      └──────────────────┬───────────────────────────┘
                                         │
                                         ▼
                      ┌──────────────────────────────────────────────┐
                      │           ANALYTICS & REPORTING               │
                      │  Portfolio View │ Correlation Matrix          │
                      │  Tournament     │ Archetype Analysis          │
                      │  Journal        │ Agent AI Analysis           │
                      │  SSE Events     │ Frontend Dashboard          │
                      └──────────────────────────────────────────────┘

    20. TEST COVERAGE

    82/82 Python tests passing (4.58s)
    TypeScript compiles clean (tsc --noEmit)

    ┌──────────────────────────────────────┬───────┬───────────────────────┐
    │  Test File                           │ Tests │ Coverage Area         │
    ├──────────────────────────────────────┼───────┼───────────────────────┤
    │  test_quantum_mc.py                  │     8 │ IAE estimation        │
    │  test_quantum_models.py              │     8 │ Distribution fitting  │
    │  test_quantum_bench.py               │     6 │ Tolerance validation  │
    │  test_quantum_rl_agent.py            │     8 │ VQC RL training       │
    │  test_quantum_annealing_optimizer.py │     7 │ SQA optimization      │
    │  test_qubo_trade_timing.py           │     8 │ Session QUBO          │
    │  test_tensor_signal_model.py         │     7 │ MPS prediction        │
    │  test_exportability.py               │     6 │ Export scoring        │
    │  test_pine_compiler.py               │    10 │ Pine transpilation    │
    │  test_hardware_profile.py            │     5 │ GPU detection         │
    │  test_golden_snapshots.py            │     3 │ Regression snapshots  │
    │  + existing pre-quantum tests        │     6 │ Other engine tests    │
    ├──────────────────────────────────────┼───────┼───────────────────────┤
    │  TOTAL                               │    82 │                       │
    └──────────────────────────────────────┴───────┴───────────────────────┘

    Golden Snapshots (tests/python/golden/):
    - pine_compiler_sma_cross.json — Pine compiler regression
    - quantum_mc_breach.json — Quantum MC regression
    - sqa_optimizer_params.json — SQA optimizer regression
