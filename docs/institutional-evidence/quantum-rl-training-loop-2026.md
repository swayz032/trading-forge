# Quantum RL Training Loop — Institutional Reference Evidence

## TL;DR (Trading Forge gap assessment)
- VQC-RL alpha for trading is RESEARCH-TIER in 2026 — comparable but not superior to classical RL; real institutional use (HSBC/IBM) is execution-optimization, not alpha generation.
- Multi-agent LLM orchestration of RL training pipelines has academic validation (NeurIPS 2025, arxiv 2605.02801) but NO documented institutional adoption as of May 2026 for trading desks.
- Overfitting via backtest-driven RL training loops is a severe documented risk — CPCV + DSR + frozen-policy OOS windows are mandatory per 2025-2026 institutional standards; reward shaping from live gates (B14 ruin probability CI) is theoretically sound but not yet documented in production at prop-firm scale.
- VERDICT: WIRE-LIMITED-SCOPE — challenger-only, CPCV-aware reward signal, no self-promotion path.

## Sources (≥2025 only)

| Date | Source | Tier | Citation | Key claim |
|---|---|---|---|---|
| 2026-01-20 | arXiv 2601.18811 (Gurgul/Chen/Lessmann, FU Berlin) | research | https://arxiv.org/abs/2601.18811 | VQC-RL DDPG/DQN analogues "achieve risk-adjusted performance comparable to, and in some cases exceeding, classical deep RL models with several orders of magnitude more parameters" but "practical deployment on cloud-based quantum systems introduces substantial latency... limiting practical applicability" |
| 2025-09-11 | arXiv 2509.09176 (Chen et al, incl. Wells Fargo affiliation disclaimer) | research | https://arxiv.org/abs/2509.09176 | QLSTM+QA3C hybrid for USD/TWD: 11.87% return, 0.92% max DD on 20% OOS holdout; explicitly disclaims "classical quantum simulation and simplified strategy"; "The views... do not represent the views of Wells Fargo" |
| 2025-07 | ICML 2025 (Proceedings PMLR v267) — Meyer et al | research (conference) | https://proceedings.mlr.press/v267/meyer25b.html | "our methodology casts doubt on some previous claims regarding [QRL] superiority... findings are more nuanced overall... possible advantages [exist] but more nuanced than claimed" — systematic statistical benchmarking of QRL shows prior superiority claims are unvalidated at ICML standard |
| 2025-09-25 | HSBC press release + IBM Quantum (multiple news confirmations) | corporate-eng | https://www.hsbc.com/news-and-views/news/media-releases/2025/hsbc-demonstrates-worlds-first-known-quantum-enabled-algorithmic-trading-with-ibm | World's first quantum-enabled algorithmic trading trial: 34% improvement in fill-probability prediction for European corporate BONDS only — NOT equity/futures alpha; execution-optimization use case, not alpha RL |
| 2025-11-18 | CFA Institute Research Foundation (Halperin / Kolm / Ritter, three PhDs) | research | https://rpc.cfainstitute.org/research/foundation/2025/chapter-6-reinforcement-learning-inverse-reinforcement-learning | "Deploy via offline → simulation → online pipeline with guardrails, drift monitoring, challenger policies, and kill-switches"; "risk must be first-class in the reward (mean-variance, CVaR, drawdown or distributional RL)"; governance is "non-negotiable" |
| 2026-05-05 | arXiv 2605.02801 | research | https://arxiv.org/abs/2605.02801 | RL for LLM-based multi-agent systems via orchestration traces: formal Dec-POMDP model for how agents spawn, delegate, communicate, aggregate — validates the pattern of Claude Code subagents orchestrating RL pipelines as architecturally sound |
| 2025-12-06 | NeurIPS 2025 (MAGRPO — Multi-Agent Group Relative Policy Optimization) | research (conference) | https://neurips.cc/virtual/2025/128017 | LLM collaboration as cooperative MARL is an emerging pattern; "multi-agent, multi-turn algorithm" validated in NeurIPS 2025 proceeding |
| 2026-03-19 | NVIDIA (ProRL Agent — Rollout-as-a-Service) | corporate-eng | https://arxiv.org/html/2603.18815v1 | NVIDIA ships production-pattern for multi-agent RL training pipelines: separates rollout orchestration from training; validates the exact pattern Trading Forge is proposing (subagents run iterations, trainer updates separately) |
| 2025-12-15 | arXiv 2512.12924 (Texas Tech University — Deep/Deep/Lamptey) | research | https://arxiv.org/abs/2512.12924 | "rigorous walk-forward validation framework... 34 independent test periods... statistically insignificant aggregate results (p-value 0.34) to demonstrate a reproducible, honest validation protocol" — shows how RL-based trading honest OOS looks; modest 0.55% annualized post-rigorous-WF vs claimed 15-30% in backtests |
| 2025-12-11 | arXiv 2512.10913 (Columbia/Stevens/Stanford — systematic review 167 articles 2017-2025) | research | https://arxiv.org/abs/2512.10913 | "implementation quality and domain knowledge often outweigh algorithmic complexity"; "organizations should focus less on algorithm sophistication and more on market microstructure, regulatory constraints, and risk management" |
| 2025-09-17 | arXiv 2509.14385 (Raj — Adaptive Regime-Aware RL) | research | https://arxiv.org/abs/2509.14385 | Regime-aware RL using PPO/LSTM-PPO/Transformer-PPO: "policy avoided overfitting to noisy signals... decisions shaped by meaningful macro-structural patterns rather than reactive heuristics" — validates regime-conditioning as an anti-overfit mechanism |
| 2026-04-07 | PickMyTrade blog (institutional practitioner style) | blog-general | https://blog.pickmytrade.io/trading-strategy-robustness-testing-2026-guide/ | "run a full Monte Carlo + CPCV suite" is stated as 2026 industry standard robustness requirement for any ML/RL trading strategy |
| 2025-09-01 | QuantBeckman (CPCV with code) | blog-general | https://www.quantbeckman.com/p/with-code-combinatorial-purged-cross | "traditional grid or Bayesian searches on a single path reward parameters that overfit... CPCV generates multiple chronology-respecting train-test partitions" — confirms CPCV as the 2026 standard against RL overfitting |

## Trading Forge vs institutional comparison

| Aspect | Trading Forge implementation | Institutional reference | Gap |
|---|---|---|---|
| VQC-RL role | `decision_role: challenger_only`, advisory, never gates (quantum_rl_agent.py) | Institutional position: execution-optimization only in verified production (HSBC/IBM bond fills); alpha RL = research-tier universally | ALIGNED — challenger_only is the correct posture |
| Training data source | Proposed: thousands of backtests on historical data | Institutional: offline-simulation-online pipeline; policy trained on historical + simulator, validated on OOS holdout BEFORE any live capital signal | GAP: no simulator layer; backtest-only training amplifies look-ahead risk |
| Overfitting safeguards | CPCV + WFE ≥ 0.70 + B14 ci_high + PBO + DSR already in lifecycle gates | 2026 standard: CPCV + purge + embargo + DSR + frozen-policy OOS windows; RL-specific: reward penalizes ruin probability, not just Sharpe | PARTIAL GAP: lifecycle gates exist but not yet wired as RL reward signal |
| Reward function | Not defined for the proposed training loop | Institutional: mean-variance or CVaR or drawdown-adjusted (CFA 2025); survival-aware reward (penalize paths with ruin probability > threshold) | GAP: no formal reward design exists yet |
| Regime non-stationarity | 8-state regime classifier + narrative state machine in bias_engine.py | 2026 standard: policies must retrain on regime shift or use regime-conditioned architecture (Adaptive Regime-Aware RL, arXiv 2509.14385) | PARTIAL GAP: regime features exist but RL policy has no regime-conditioning layer |
| Multi-agent orchestration | Claude Code subagents (backtest-core, quantum-challenger, critic-optimizer) | NVIDIA ProRL Agent (2026): rollout-as-a-service, decouples orchestration from training loop; NeurIPS 2025 MAGRPO: cooperative MARL for multi-agent collaboration | BENEFICIAL: Trading Forge pattern is architecturally validated; not over-engineered |
| Cloud QPU latency | Cloud opt-in via Braket/IonQ; substantial latency acknowledged | HSBC/IBM 2025: latency "dominated by infrastructural overhead"; currently only viable for batch (not real-time) problems | ALIGNED: opt-in cloud is the right posture for 2026 |
| OOS validation | WFE + CPCV + B15 robustness battery in lifecycle gates | Required: frozen-policy OOS windows where policy cannot update; mandatory quarantine period before any live signal | GAP: no policy-freeze contract; RL policy could update based on data that isn't truly OOS |
| Kill switch | QUANTUM_REPLAY_AUTO_FIRE_ENABLED + circuit breaker at 5 consecutive failures | Institutional: kill-switch on policy divergence vs baseline; challenger policies run in shadow before promotion | PARTIAL GAP: circuit breaker exists for infra failures, not for policy-performance divergence |

## Recommended changes (with citations)

1. **Keep `decision_role: challenger_only` permanently for VQC-RL alpha** — no self-promotion path. Supported by [arXiv 2601.18811 — "practical applicability" limitation], [ICML 2025 Meyer et al — QRL superiority claims unvalidated], [arXiv 2512.10913 — "domain knowledge outweighs algorithmic complexity"]. Scale: REQUIRED at our scale.

2. **Wire B14 `probability_of_ruin_ci.ci_high` as an RL reward signal component** — penalize policy trajectories that increase ci_high above 0.40. Supported by [CFA Institute 2025 — "make risk first-class in the reward (CVaR, drawdown)"], [arXiv 2512.12924 — "strict OOS testing" mandate], [arXiv 2509.14385 — survival-aware regime conditioning]. Scale: REQUIRED at our scale.

3. **Enforce CPCV purge + embargo on ALL training data fed to the RL policy** — the existing CPCV infrastructure (Wave 27.5 Pass B) must gate the training set, not just the promotion gate. Supported by [arXiv 2512.12924 — 34 independent test periods with purge], [QuantBeckman CPCV 2025 — "inflates performance through selection bias and temporal leakage"], [PickMyTrade 2026 — "full Monte Carlo + CPCV suite"]. Scale: REQUIRED at our scale.

4. **Add a frozen-policy OOS window before any VQC-RL signal is used even in shadow mode** — after each training cycle, lock the policy parameters for ≥30 OOS trading days before evaluating. Supported by [CFA Institute 2025 — "offline → simulation → online pipeline"], [arXiv 2512.12924 — "34 independent test periods"], [arXiv 2512.10913 — "standardized benchmarking protocols"]. Scale: REQUIRED at our scale.

5. **Adopt regime-conditioned reward shaping** — train separate policies per institutional regime (TRENDING / RANGE_BOUND / HIGH_VOL_MACRO etc) using the existing regime classifier. Supported by [arXiv 2509.14385 — "regime-adaptive RL... avoids overfitting to noisy signals"], [CFA Institute 2025 — "match methods to mechanics"], [ICML 2025 Meyer et al — regime complexity affects QRL advantage]. Scale: BENEFICIAL at our scale.

6. **The multi-agent Claude Code orchestration pattern is architecturally validated** — no change needed. Supported by [arXiv 2605.02801 — RL for LLM multi-agent systems via orchestration traces], [NeurIPS 2025 MAGRPO], [NVIDIA ProRL Agent 2026 — rollout-as-a-service decoupling]. Scale: REQUIRED (already in place, retain it).

---

*Evidence file created: 2026-05-26. Next refresh trigger: if Wells Fargo arxiv 2507.12835 is independently reproduced post-2026-06, or if Chen et al 2506.20930 receives a formal response from any institutional author.*
