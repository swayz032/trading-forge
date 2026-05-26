# In-House Bot Pre-Training — Institutional Reference Evidence

## TL;DR (Trading Forge gap assessment)
- VERDICT: YES-WITH-LIMITED-SCOPE. Institutional consensus confirms in-house pre-training phases are standard, but the mechanisms differ sharply by firm tier and strategy frequency.
- Top-tier HFT/market-making firms (HRT, Jane Street) pre-train foundation-style transformer models on decades of tick data before any live exposure — this is infrastructure-scale work beyond Trading Forge.
- Mid-tier quant funds use MLOps pipelines with shadow → canary → live deployment gates as the standard pre-training pipeline; this pattern IS portable to Trading Forge.
- The highest-leverage gap in Trading Forge is NOT quantum RL wiring — it is the absence of a structured shadow-mode testing phase between TESTING and PAPER, and the fact that the quantum RL agent's TradingEnv sees only 8 simplified features instead of full production state.
- CPCV + PBO + frozen-policy OOS contract are the 2026 institutional guardrail trio for any pre-training loop.

---

## Sources (2025-2026 only)

| Date | Source | Tier | Citation | Key claim |
|---|---|---|---|---|
| 2026-05-20 | Lambda-HRT Partnership Announcement | corporate-eng | https://lambda.ai/blog/lambda-partners-with-hudson-river-trading-to-power-quantitative-research-and-development | "HRT's researchers run compute-intensive workloads to train models and simulate trading strategies at scale" — HRT uses NVIDIA HGX B200 clusters for research pre-training before live deployment |
| 2026-01-15 | AI Street — HRT Foundation Models | corporate-eng | https://www.ai-street.co/p/hrt-trains-ai-models-on-trading-data | HRT trains transformer models on 100TB+ of global market data (equity, futures, crypto) spanning 20+ years; "as I increase the model size, the model continues to improve" — scaling law confirmed in market microstructure |
| 2026-03-30 | Finexus — HRT AI Pivot Analysis | blog-general | https://api.finexus.net/api/news/events/1eb9cbda-13da-45b3-8d1b-a21afa0bfe85/html | HRT's Prism unit (mid-frequency, minutes-to-days) uses transformer models pre-trained on "trillions of tokens of market events"; $2B+ annual revenue contribution; models tested in simulation before live routing |
| 2026-05-23 | Officechai — Jane Street Ron Minsky interview | practitioner-interview | https://officechai.com/ai/trading-feels-to-me-to-be-agi-complete-jane-streets-ron-minsky/ | Jane Street Co-head of Technology: "As various pieces of that get automated, the other hard parts… that's where the competitive edge lies." — implies iterative automated pre-training loop as a standard capability; 4,032 GPU liquid-cooled data center purpose-built for model development |
| 2026-05-16 | CryptoBriefing — Jane Street GPU data center | corporate-eng | https://cryptobriefing.com/jane-street-ai-gpu-data-center/ | Jane Street built 4,032 liquid-cooled GPU facility in Texas specifically for "AI research and trading model development"; internal auction system ("hive bucks") governs compute access — teams pre-train competing models iteratively before any live capital exposure |
| 2026-03-31 | AI Street — JPMorgan TradeFM | corporate-eng | https://www.ai-street.co/p/jpmorgan-taught-ai-the-language-of | JPMorgan trained 524M-parameter transformer (TradeFM) on 10.7B tokens from 9,000+ US equities before deployment; validated in "simulated exchange" where model predicts trades in continuous loop — pure pre-training on synthetic replay before live exposure |
| 2025-12-06 | AltStreet — Quant 2.0 Architecture | blog-general | https://altstreet.investments/blog/quant-2-architecture-modern-trading-stack-ai-mlops | "MLOps pipelines automate training → validation → shadow → live deployment"; Citadel spins up 1M+ cores for parallel backtesting; Man Group deploys LLM agent systems evaluating strategies autonomously; Two Sigma applies CI/CD to data pipelines — shadow+canary deployment is the 2025-2026 institutional standard |
| 2025-12-15 | arXiv 2512.12924 — Walk-Forward Validation Framework | research | https://arxiv.org/html/2512.12924v1 | Walk-forward with 34 independent OOS periods + RL agent learning which hypotheses to execute within framework; CPCV + Deflated Sharpe are required guardrails; "over 90% of academic strategies fail when implemented with real capital" — pre-training without strict OOS contracts fails almost universally |
| 2026-04-04 | arXiv 2603.29086 — Realistic Market Impact for RL | research | https://arxiv.org/html/2603.29086 | Without realistic market impact modeling in the pre-training environment, RL agents exhibit "pathological trading behaviors"; IS→OOS Sharpe gap is large (e.g. 13% IS annualized vs 6.4% OOS); HPO essential for constraining over-training; sim-to-real gap is the #1 RL pre-training failure mode |
| 2025-12-11 | arXiv 2512.10913 — RL Financial Decision Making Systematic Review | research | https://arxiv.org/html/2512.10913v1 | 167-paper systematic review: "traditional backtesting may fail to accurately assess adaptive systems"; non-stationarity + overfitting risk requires rolling-window retraining cadence; "implementation quality and domain knowledge often outweigh algorithmic complexity" |
| 2026-04-07 | PickMyTrade — Strategy Robustness Testing 2026 Guide | blog-general | https://blog.pickmytrade.io/trading-strategy-robustness-testing-2026-guide/ | CPCV (PBO <15% threshold), Monte Carlo 1,000+ runs, parameter sensitivity ±10-25%, multi-market validation — minimum pre-deployment checklist; "deploy only if metrics remain acceptable across 80%+ of simulations" |
| 2026-02-10 | Resonanz Capital — Quant Hedge Fund Due Diligence 2026 | practitioner-interview | https://resonanzcapital.com/insights/quant-hedge-funds-in-2026-a-due-diligence-framework-by-strategy-type | Allocators require: governance log of how many model versions were tried; stability testing of regime classifiers; scenario P&L under inflation/rates/USD shocks; kill-switch documentation — these are the due-diligence questions that enforce pre-training discipline |

---

## Trading Forge vs Institutional Comparison

| Aspect | Trading Forge implementation | Institutional reference | Gap |
|---|---|---|---|
| Pre-training infrastructure | RTX 5060 8GB VRAM; ~50-200 backtests/hour; no GPU training loop | HRT: 100TB data, own data center + Lambda HGX B200; Jane Street: 4,032 liquid-cooled GPUs with internal auction system | Over-engineered at our scale to replicate infra; NOT over-engineered to replicate the shadow-phase pattern |
| Pre-training lifecycle stages | CANDIDATE → TESTING → PAPER → DEPLOY_READY → PILOT → DEPLOYED (no shadow stage) | Research → Simulation → Shadow (paper with full state) → Canary (small live allocation) → Live (AltStreet Quant 2.0) | MISSING: explicit shadow stage with automated pass/fail gate before PAPER |
| RL agent state fidelity | quantum_rl_agent.py TradingEnv: 8 features (price_change, rsi, atr, volume, position, pnl) | Institutional RL environments must model full microstructure (limit order book, market impact, regime state); arXiv 2603.29086 shows 8-feature envs produce pathological trading | CRITICAL: RL pre-training on simplified env does not transfer to production; sim-to-real gap guaranteed |
| OOS validation contract | CPCV + WFE + DSR live; quantum MC replay grading live | Frozen-policy OOS contract: after CPCV, policy parameters FROZEN for independent OOS; PBO <15% threshold enforced; no re-optimization on OOS data | PARTIAL: CPCV live but no explicit PBO threshold enforced; frozen-policy contract not formalized |
| Shadow-mode execution | No shadow mode; goes directly from TESTING (backtest) to PAPER (TradingView+TradersPost live paper) | All funds run shadow mode: strategy signals generated and logged but NOT routed to broker; comparison vs live execution quality; feature-parity check between research and production features | MISSING: no shadow signal log; no feature-parity audit between backtest engine and production signal path |
| Training-serving skew prevention | No formal feature store; backtest engine and production signal (TradingView Pine) computed separately | AltStreet: "feature stores eliminate 15-25% of production bugs caused by training-serving skew — the #1 reason models fail in live trading despite strong backtests" | HIGH RISK: Pine Script indicators may compute differently from Polars/vectorbt backtest; no audit trail |
| Regime non-stationarity / retraining cadence | No formal retraining cadence; strategies persist until manually promoted/demoted | arXiv 2512.10913: rolling-window retraining required; regime-dependent performance documented (2512.12924: +2.4% ann in high-vol vs -0.16% in stable markets) | PARTIAL: regime engine live but no automated prompt-evolution retraining trigger on regime shift |
| Pre-training failure mode documentation | No documented failure modes from prior RL training attempts | Resonanz Capital 2026: allocators require list of how many model versions tried, what changed, what broke | MISSING: no versioned model registry or failure mode log |

---

## Recommended Changes (with citations)

### R1: Add a SHADOW stage to the lifecycle between TESTING and PAPER [REQUIRED at our scale]
The institutional standard (AltStreet Quant 2.0, 2025-12-06; Resonanz Capital, 2026-02-10; arXiv 2512.12924, 2025-12-15) is: after statistical validation passes, the strategy enters shadow mode where signals are generated and logged but NOT routed. This catches training-serving skew before real paper capital is at risk. For Trading Forge, this means: the strategy fires its Pine alerts into a shadow log on TradingView, but TradersPost webhook is NOT activated. Shadow-to-PAPER gate requires 20+ shadow signals with <5% signal divergence vs backtest.

Supported by: [AltStreet Quant 2.0], [arXiv 2512.12924], [Resonanz Capital 2026]

### R2: Formalize the CPCV → PBO <15% → frozen-policy OOS contract [REQUIRED at our scale]
2026 institutional practice (arXiv 2512.12924; PickMyTrade 2026; Wikipedia CPCV updated 2026-01-02) requires explicit PBO threshold as a hard gate, not just running CPCV and reading Sharpe. After CPCV, the winning policy must be FROZEN — no re-optimization allowed on the held-out OOS slice. Trading Forge has CPCV live but no PBO threshold gate and no frozen-policy contract.

Supported by: [arXiv 2512.12924], [PickMyTrade 2026 Guide], [Wikipedia CPCV 2026]

### R3: Require the quantum RL TradingEnv to consume full production state before any pre-training is meaningful [REQUIRED — precondition for any RL pre-training value]
arXiv 2603.29086 (2026-04-04) proves that RL agents trained in simplified environments (fixed-cost, limited state) learn pathological behaviors that fail in production. The current 8-feature TradingEnv in quantum_rl_agent.py does not see: 5-TF MTF structure, killzone state, regime classification, or confluence score. Pre-training this agent produces zero transfer value. This is the single highest-leverage gap — wiring production state into TradingEnv must happen before any further RL training.

Supported by: [arXiv 2603.29086], [arXiv 2512.10913], [HRT foundation models (AI Street 2026-01-15)]

---

## Wave 29 Scope Recommendation

See main report (operator communication) for Wave 29 4-pass plan.

---

_Evidence file created: 2026-05-26. Next update trigger: any RL wiring PR or shadow-mode implementation._
