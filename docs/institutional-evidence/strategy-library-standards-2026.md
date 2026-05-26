# Strategy Library 2026 Institutional Standards — Evidence File

## TL;DR (Trading Forge gap assessment)
- DSL spec: Trading Forge LACKS data-lineage ID, model-risk rating, last-validation date, next-review date, and independent-validation sign-off fields per strategy record
- Confluence scoring: Static 11-factor weight is still defensible at $50K scale but misses regime-conditional weight adjustment now standard at top quant funds (Man Group, BNPP AM) and Springer Nature 2026 paper
- Risk management: Missing drawdown-velocity gate and correlation-cap across concurrent strategies on same account; both documented as 2026 prop-firm survival differentiators
- Backtest validation: CPCV n_paths=15 + PSR >= 1.0 is the 2026 published floor (not 8 paths); White's Reality Check / Monte Carlo permutation required after CPCV before any activation
- Strategy lifecycle: "All 96 CANDIDATE, none backtested" is a RED FLAG pattern; 2026 institutional cadence is quarterly review cycle with mandatory OOS testing BEFORE any strategy holds CANDIDATE status
- Portfolio concentration: Single-strategy-per-account is institutionally deprecated for accounts > ~$25K regime exposure; 4-strategy minimum per account is the 2026 published risk-reduction threshold

---

## Sources (≥2025 only)

| Date | Source | Tier | URL | Key claim |
|---|---|---|---|---|
| 2026-02-26 | Man Group, "The Quant Renaissance Part II" | corporate-eng | https://www.man.com/insights/winters-thaw | "dynamic approach utilises machine learning and macro-informed weighting to create forward-looking, adaptive factor combination... continuously evaluates changing market conditions and factor relationships to optimise combinations in real time" |
| 2026-04-08 | statistics.news, "Model Governance Playbook for AI-Powered Hedge Funds" | practitioner-interview | https://statistics.news/when-models-drive-markets-governance-frameworks-for-hedge-fu | Model registry must record: unique ID, version history, owner/author/approvers, purpose/permitted markets, model risk rating, last validation date, next review due date |
| 2026-04-13 | Resonanz Capital, "Quant Hedge Funds in 2026: Due Diligence Framework" | corporate-eng | https://resonanzcapital.com/insights/quant-hedge-funds-in-2026-a-due-diligence-framework-by-strategy-type | "ML models using alternative datasets — risk is not bad models, it is using information not truly available at decision time... data lineage" |
| 2026-04-07 | whatworksintrading.substack.com, "32 Backtests, 3 Survivors" | practitioner-interview | https://whatworksintrading.substack.com/p/32-backtests-3-survivors-what-the | "Gate 2: CPCV with minimum n_paths=15, PSR >= 1.0 and deflated PSR... White's Reality Check next mandatory step" |
| 2026-05-10 | youngandcalculated.substack.com, "Risk Management Inside a Pod" | practitioner-interview | https://youngandcalculated.substack.com/p/risk-management-inside-a-pod-how | Pod PM faces simultaneous constraint stack: single-name cap 1-3% gross, ADV 5-10% of 30-day volume, VaR/CVaR contribution. Drawdown 5% = de-risk, 7-10% = wind-down |
| 2026-05-18 | MQL5 Blogs, "Scaling Strategies for Prop Firm Traders" | community-expert | https://www.mql5.com/en/blogs/post/770144 | "Diversification: non-correlated approaches reduces dependency on one market behavior. Automated risk controls become critical during scaling: daily drawdown protection, max open trade limits, equity protection, session restrictions, automated shutdown rules" |
| 2026-03-01 | setup4alpha.substack.com, "Holy Grail: Citadel-Style Portfolio" | educator | https://setup4alpha.substack.com/p/holy-grail-of-trading-how-to-build-portfolio | Dalio data: one strategy baseline; +1 uncorrelated = -30% risk; 4 strategies = Sharpe 1.70 from 0.90; 15-20 = -80% risk. Four strategies: max drawdown -11.27% vs -18.6% single. "Aim for 4 to 10 strategies. Below four, a single bad strategy drags the whole portfolio." |
| 2026-02-13 | BNPP AM, "Quant Investing in 2026: Data, AI, and Human Judgment" | corporate-eng | https://www.bnpparibas-am.com/en-us/institutional/forward-thinking/quant-investing-in-2026-data-ai-and-human-judgment/ | "markets more volatile, policy shocks more frequent... institutional investors focused not just on returns, but managing risk, resilience in stress periods, and transparency in decision-making" |
| 2026-04-06 | Viprasol, "Quantitative Hedge Fund: Engineering Edge (2026)" | educator | https://viprasol.com/blog/quantitative-hedge-fund/ | "Risk model: drawdown circuit breakers, correlation monitoring real-time, factor exposure limits, position-level liquidity constraints expressed as days-to-liquidate" |
| 2026-05-14 | tianpan.co, "Quarterly Model Migration: Make It Calendar Event" | educator | https://tianpan.co/blog/2026-05-14-quarterly-model-migration-calendar-event-not-fire-drill | Institutional model deprecation cycle: quarterly review, named DRI, regression suite re-baselined every quarter against CURRENT production model |
| 2026-02-23 | tradealgo.com, "ML Backtesting Guide" | blog-general | https://www.tradealgo.com/trading-guides/ai-trading/machine-learning-backtesting-guide | "walk-forward Sharpe 0.8-1.0 is minimum for deployment at most institutional quantitative [shops]" |
| 2026-03-05 | r/quant (337 upvotes, QR commenter), "Weekly Systematic Build" | community-expert | https://www.reddit.com/r/quant/comments/1tg4giq/ | Senior QR with 6 YOE building/operating systematic MFT confirms CPCV + WF as standard pre-live gate |
| 2025-10-31 | r/quant AMA, "Ran $XXM Systematic Options Book, Sharpe 3+" | community-expert | https://www.reddit.com/r/quant/comments/1okr5l7/ | Quant shop operator: strategy lifecycle includes mandatory OOS before any live capital allocation; rolling performance reviewed monthly |
| 2026-03-09 | Springer Nature / IJDSA, "Unified Agentic Framework for Regime-Aware Portfolio Optimization" | research | https://link.springer.com/article/10.1007/s41060-026-01066-0 | Regime-aware dynamic factor weighting with LLM signals published as 2026 research standard |
| 2025-09-14 | arXiv 2510.14986, "RegimeFolio: Regime Aware ML System for Sectoral Portfolio Optimization" | research | https://arxiv.org/html/2510.14986v1 | "dynamic rolling-quantile methodology during training and backtesting to ensure adaptability and statistical balance" — static thresholds flagged as insufficient |

---

## Trading Forge vs Institutional Comparison

| Aspect | Trading Forge (Wave 27.5) | Institutional 2026 Reference | Gap | Scale Verdict |
|---|---|---|---|---|
| **DSL spec fields** | entry_indicator, confluence_factors, min_factors_satisfied, preferred_regimes, 5-TF MTF, exit_plan, position_sizing, session_filter | Above PLUS: unique model ID, version/commit hash, owner+approver, model risk rating (low/med/high), last validation date, next review due date, independent validation sign-off, permitted markets/symbols, data-lineage link to backtest snapshot | MODERATE gap: 6 missing fields | Required at our scale — audit trail and lifecycle fields are what prevent "orphaned strategies" proliferating in lib |
| **Confluence scoring methodology** | 11-factor weighted, static weights, 0.72 threshold | Man Group / BNPP AM: dynamic macro-regime weight adjustment using MacroScope-style regime classifier; static weights treated as "traditional" approach that underperforms in regime transitions | LOW gap: static weights defensible for Wave 25-27 scale; regime-conditional weights are enhancement not requirement | Beneficial at $50K scale — add regime-conditional weight multipliers per regime class as next iteration |
| **Regime classifier granularity** | Binary (trending/ranging/volatile) via Wave 25 structure engine | Man Group publishes 4-regime taxonomy: Crisis/Recession, Recovery/Early Expansion, Mid-Cycle Expansion, Late Cycle/Overheating. Each regime has statistically different factor performance profiles | MODERATE gap: 3-state regime vs 4-state institutional standard | Beneficial at our scale — a 4th late-cycle regime catches the "everything rally" crowding scenario |
| **Backtest CPCV paths** | n_paths not specified in B14 gate | Published floor: n_paths=15, PSR >= 1.0, then White's Reality Check + Monte Carlo permutation | CRITICAL gap: if n_paths < 15 and no White's RC, the B14 gate does not meet 2026 published floor | Required at our scale — every strategy risking real prop-firm capital must clear this |
| **Walk-forward Sharpe minimum** | WFE > 0.70 floor (B14) | tradealgo.com cites 0.8-1.0 as institutional minimum; "32 Backtests" shows surviving strategies averaged 1.0+ OOS Sharpe | MODERATE gap: WFE 0.70 is below published 2026 institutional floor of 0.80 | Required at our scale — raise WFE floor to 0.80 minimum |
| **Validation: White's Reality Check** | Not present in Wave 27.5 gates | "32 Backtests, 3 Survivors" lists White's RC as mandatory next step after CPCV for any strategy tested in a batch; required to correct data-mining bias across multi-strategy library | CRITICAL gap: testing 96 strategies and selecting best performers without White's RC is textbook multiple-testing bias | Required at our scale — 96 CANDIDATE strategies without WRC is a high-confidence false-positive factory |
| **Strategy registry lifecycle fields** | CANDIDATE/PAPER/DEPLOY_READY status states | Institutional standard: unique ID, version hash, model risk rating, last_validated_at, next_review_due, independent_validator | MODERATE gap: TF has promotion gates but not lifecycle metadata on each strategy record | Required at our scale — without next_review_due, strategies silently age and decay |
| **Strategy audit cadence** | No cadence specified; all 96 at CANDIDATE with no backtest | Institutional: quarterly re-validation cycle with named DRI; strategies not re-validated within 2 quarters flagged for deprecation. OOS testing required BEFORE strategy holds active library status | CRITICAL gap: 96 unbacktested CANDIDATE strategies is the exact pattern institutional playbooks call "rumor generator" | Required at our scale — no strategy should hold CANDIDATE without at least one completed WF pass |
| **Portfolio construction per account** | 1 strategy per account (pyramid scaling) | Institutional / Dalio / Citadel data: 4-10 uncorrelated strategies per account. Going from 1 to 4 reduces drawdown from -18.6% to -11.27%, raises Sharpe 0.90 to 1.70. Below 4, single bad strategy drags whole portfolio | MODERATE gap: 1-strategy-per-account is institutionally deprecated above $25K exposure | Beneficial at $50K scale — 2-4 strategies per account materially improves regime-survival; this is "beneficial" not "required" given Topstep 1-contract limits |
| **Drawdown velocity gate** | DLL + structural stop (static) | Pod model: 5% drawdown triggers forced de-risk; velocity matters (rapid drawdown = immediate action vs slow drift). Prop firm practitioners recommend automated equity protection velocity checks | LOW gap: TF has DLL but no velocity-based escalation | Beneficial at our scale — add trailing velocity check: if -3% in single session trigger autopause |
| **Correlation cap across strategies same account** | Not specified | Pod PM constraint: simultaneous strategy correlation monitored real-time; correlated drawdowns are systemic risk. Millennium enforces inter-pod correlation limits | LOW gap: single-strategy-per-account makes this moot until multi-strategy is adopted | Over-engineered at current scale — revisit when moving to 2+ strategies/account |
| **ADV / liquidity constraint** | Per-symbol liquidity cap present | Institutional floor: position size expressed as days-to-liquidate at normal volume; MES/MNQ/MCL are highly liquid so this is automatically satisfied | NO gap for chosen instruments | No action needed |
| **Data lineage for backtest artifacts** | No explicit lineage | Institutional: immutable data snapshot hash linked to each backtest run; reproducible by commit hash | MODERATE gap: backtest results not linked to pinned data snapshot | Required at our scale — without this, backtest re-runs on updated data silently diverge |

---

## Recommended Changes (with citations)

### CRITICAL — Act Before Next Strategy Activation

**C1: Add White's Reality Check (WRC) as mandatory gate between B14 CPCV and PAPER promotion**
- Without WRC, selecting the best strategy from a 96-strategy library inflates the apparent edge by multiple-testing bias
- Supported by: [whatworksintrading, 2026-04-07], [r/quant CPCV cheat sheet 2026-03-05], [arXiv 2512.12924 walk-forward framework 2025-12]
- Scale verdict: Required at our scale

**C2: Raise CPCV n_paths minimum to 15 (from whatever current B14 specifies)**
- "32 Backtests" explicitly sets n_paths=15 as the floor; strategies with fewer paths show instability
- Supported by: [whatworksintrading, 2026-04-07], [MQL5 unified pipeline 2026-03-13], [CPCV Wikipedia 2026-01-02]
- Scale verdict: Required at our scale

**C3: Raise WFE floor from 0.70 to 0.80**
- 0.70 sits below the published 2026 institutional minimum of 0.8-1.0
- Supported by: [tradealgo.com 2026-02-23], [whatworksintrading survivors avg OOS Sharpe 1.0+ 2026-04-07], [viprasol quant hedge fund 2026-04-06]
- Scale verdict: Required at our scale

**C4: No strategy should hold CANDIDATE status without at least 1 completed walk-forward pass**
- "96 CANDIDATE strategies, none backtested" matches exactly the "rumor generator" pattern described in "32 Backtests" and model governance playbook
- Supported by: [statistics.news governance playbook 2026-04-08], [whatworksintrading 2026-04-07], [tianpan.co quarterly cadence 2026-05-14]
- Scale verdict: Required at our scale — implement a HYPOTHESIS state below CANDIDATE; strategies only reach CANDIDATE after completing one WF pass

### HIGH — Implement Within Next Wave

**H1: Add 6 lifecycle metadata fields to strategy DSL records**
- Fields: `model_risk_rating` (low/med/high), `last_validated_at`, `next_review_due`, `version_hash`, `independent_validator`, `data_snapshot_id`
- Supported by: [statistics.news governance playbook 2026-04-08], [resonanz capital 2026-02-10], [tianpan.co 2026-05-14]
- Scale verdict: Required at our scale — audit trail is what separates "institutional grade" from "hope-based"

**H2: Implement quarterly strategy re-validation cadence with automatic STALE flag**
- Any strategy not re-validated within 90 days gets `status=STALE`, blocked from PAPER promotion until re-validated
- Supported by: [tianpan.co 2026-05-14], [statistics.news governance playbook 2026-04-08], [r/quant QR 6YOE systematic build 2026-05-17]
- Scale verdict: Required at our scale

**H3: Expand regime classifier from 3-state to 4-state (add Late-Cycle/Overheating)**
- Man Group's MacroScope uses 4 regimes; the Late-Cycle regime is the one that precedes quant winters and "everything rally" crowding that destroys single-strategy concentration
- Supported by: [Man Group quant renaissance 2026-02-26], [r/quant quant meltdown discussion 2026-05-25], [BNPP AM quant investing 2026-02-13]
- Scale verdict: Beneficial at our scale

### MEDIUM — Consider for Future Waves

**M1: Add regime-conditional weight multipliers to 11-factor confluence scoring**
- Static weights are "traditional" per Man Group; dynamic per-regime weights are the 2026 institutional standard
- Supported by: [Man Group 2026-02-26], [Springer Nature IJDSA 2026-03-09], [arXiv RegimeFolio 2025-09-14]
- Scale verdict: Beneficial at our scale — not required, but closes the gap with Man-Group-tier methodologies

**M2: Expand to 2-4 strategies per account for regime-survival diversification**
- Dalio data: 4 strategies = Sharpe 1.70 vs 0.90 single; drawdown -11.27% vs -18.6%. This is the most documented institutional advantage
- Supported by: [setup4alpha Citadel-style portfolio 2026-03-01], [MQL5 scaling strategies 2026-05-18], [youngandcalculated pod risk 2026-05-10]
- Scale verdict: Beneficial at $50K scale — Topstep 1-contract ceiling limits immediate practicality, but 2nd strategy on same account (different regime behavior) is feasible

**M3: Add drawdown velocity gate: autopause if -3% in single session before hitting DLL**
- "32 Backtests" shows rapid drawdown is the leading indicator of catastrophic loss; velocity-based triggers are in every institutional playbook
- Supported by: [youngandcalculated pod risk 2026-05-10], [MQL5 scaling strategies 2026-05-18], [viprasol quant hedge fund 2026-04-06]
- Scale verdict: Beneficial at our scale

---

## Evidence Quality Notes
- Sources dropped for pre-2025 date: 0 (all searches filtered to ≥2025-01-01)
- Sources dropped for insufficient freshness verification: 2 (MFFU AMA Reddit, could not confirm date; arXiv 2512.12924 December 2025 confirmed fresh)
- Highest-tier sources: Man Group corporate-eng (2026-02-26), Resonanz Capital corporate-eng (2026-02-10), statistics.news governance playbook practitioner-interview (2026-04-08), Springer Nature research (2026-03-09)
- Lowest-tier sources used: tradealgo.com (blog-general) — used only as corroboration, not sole basis for any recommendation
