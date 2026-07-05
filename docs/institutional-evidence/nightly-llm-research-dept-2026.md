# Nightly LLM Research Department (Layer 14) — Institutional Reference Evidence

## TL;DR (Trading Forge gap assessment)
- Pattern is institutionally VALID: LLM-as-research-assistant generating proposals is exactly how quant shops deploy LLMs in 2025-2026 — in the research/hypothesis-generation stage, never in execution or direct allocation
- Proposal-only hard rule is CORRECT and must be architecturally enforced (DB gate, not policy), not assumed
- CRITICAL: dynamic capital allocation recommendations are Tier-4 irreversible actions per 2026 governance frameworks; must require human approval or a hard statistical gate (30+ day shadow evidence)
- CRITICAL: nightly proposal volume creates cumulative p-hacking risk; trial count MUST be tracked and DSR calculation must account for all N trials to date, not just the current proposal's backtest
- HIGH: 20-day edge-decay window is statistically underpowered (SE(Sharpe) ≈ 0.22 at 20 obs); minimum gate is 63 trading days before any rolling comparison is acted on
- HIGH: LLM parametric look-ahead bias — GPT may draw on pre-training memory about market history, inflating nightly retro quality by up to 67.1% (FinCAD 2026); mitigation: provide all data explicitly in context, no implicit recall
- VALID: 5-category leak detection architecture is directionally correct; all categories must enforce point-in-time discipline

---

## Sources (≥2025 only)
| Date | Source | Tier | URL | Key claim |
|---|---|---|---|---|
| 2026-06-04 | HFT Book — Research-to-production pipeline | corporate-eng | https://hftradingbook.com/business/research-to-production | "AI research assistants propose and screen hypotheses at speed" in the research stage; two deadliest joints: research→backtest (overfit/look-ahead) and backtest→execution. "The firm that closes the loop fastest and most honestly out-researches one with better single ideas." |
| 2026-06-07 | Digital Applied — Human-in-the-Loop Escalation Design for AI Agents | corporate-eng | https://www.digitalapplied.com/blog/human-in-the-loop-escalation-design-ai-agents-2026 | Four-tier action-risk classification: read-only → reversible → external → high-risk/irreversible. LLM confidence 90% claimed ≈ 75% real; 3-agent chain ~42% reliability. Capital allocation is Tier-4 irreversible — requires mandatory human/gate. "Observability tells you after; escalation design stops the irreversible before it executes." |
| 2026-05-30 | Minseok (Denis) Kim — Summoning the Oracle to Slay It | educator | https://deniskim1.com/writing/summoning_the_oracle_to_slay_it_mitigating_lookahead_bias_in/ | Parametric look-ahead bias: LLMs baked pre-training "know" price history. FinCAD reduces inflated in-sample backtest returns by up to −67.1% while keeping OOS performance within ±8K. "Unlike traditional quantitative models, parametric leakage lives inside the static parameters of the neural network — invisible to standard code and data audits." |
| 2026-05-28 | Aligrithm — CSCV: A Direct Probability of Backtest Overfit | educator | https://aligrithm.com/cscv-a-direct-probability-of-backtest-overfit/ | PBO < 0.10 = deploy; PBO 0.10–0.30 = deploy with smaller capital; PBO 0.30–0.50 = high overfit risk, do not deploy; PBO > 0.50 = purely noise, reject. S=8 (16 total blocks, 12,870 combinations) is the standard choice for daily data. |
| 2026-05-21 | QuantHedge AI — Hidden Statistical Traps in Systematic Trading | educator | https://www.quanthedgeai.com/blog/the-hidden-statistical-traps-in-systematic-trading/ | E[max Sharpe \| N=100 independent zero-Sharpe strategies] ≈ 1.4–1.6 from noise alone. Cumulative pipeline selection effects overstate forward performance by 2×–5×. Four complementary tools: DSR, Haircut Sharpe, PBO, Stability selection. |
| 2026-03-05 | Saulius.io — Recursive Self-Improvement in Quant Research with Claude Code | practitioner-interview | https://saulius.io/blog/quanta-alpha-lgbm-recursive-self-improvement | Claude Code as hypothesis generator + mutation/crossover operator; 5-gate false-discovery gauntlet (permutation, deflated Sharpe, subsample stability, decay analysis, CV consistency); 0 ROBUST out of 7 runs; pre-committed thresholds set before seeing results are mandatory. "Multiple hypothesis testing is the #1 concern." With 96 individuals, expected max noise Sharpe = 2.58. |
| 2026-02-17 | StockAlpha.ai — Backtest Reality Checks: Deflated Sharpe & PBO | educator | https://stockalpha.ai/alpha-learning/backtest-reality-checks-deflated-sharpe-pbo-and-multiple-testing-control | Testing 500 correlated parameter sets: deflated Sharpe p-value rises from 0.02 to 0.25. "Pre-register the research question and primary metric, and log all parameter combinations you plan to try." PBO > 20% = red flag. N_eff estimation from eigenvalue spectrum. |
| 2026-02-09 | ARTEMIS — Adaptive Multi-Agent Trading System with Risk-Free Exploration via Shadow Mode | research | https://doi.org/10.5281/zenodo.18565948 | Shadow mode = dual-execution paradigm where rejected signals are simulated at zero capital cost. 301 trades over 60 days: win rate improved 31.2% → 41.3% (+10.1pp, p<0.01). Shadow exploration enables 2× more parameter updates than real-only systems. |
| 2026-01-08 | OpenPaper — The Hallucination Premium | blog-general | https://openpaper.com/hallucination-premium/ | Hallucination rates in financial forecasting as high as 27% for long-horizon predictions. "When a model invents earnings figures or cites non-existent transcripts, it is not merely 'wrong'; it is engaging in the computational equivalent of fraud." EU AI Act Article 13 + IOSCO 2025 require explainability as precondition for market access. |
| 2025-12-15 | arXiv 2512.12924 — Interpretable Hypothesis-Driven Trading: Walk-Forward Validation Framework | research | https://arxiv.org/abs/2512.12924 | 34 independent test periods is the institutional standard. LLMs "extend naturally as hypothesis generators" while the VALIDATION framework is agnostic to hypothesis source. "Strict information set discipline where features, signals, and execution decisions use only data available up to that point in time." Reports p=0.34 honestly (no p-hacking). |
| 2026-05-21 | Susan Potter — Walk-Forward Optimization: Anchored vs Rolling Windows | educator | https://www.susanpotter.net/quant/walk-forward-optimization/ | "Purge width should be at least as long as the autocorrelation decay in your data. For strategies that use features with a 20-day rolling lookback, the purge needs to be at least 20 observations." |

---

## Sub-claim triangulation

### Sub-claim 1: Is LLM-as-research-tool (proposal-only) consistent with institutional practice?
**TRIANGULATED** — 4 sources, 3 tiers:
- HFT Book (corp-eng, 2026-06-04): AI assistants in research stage only; pipeline enforces handoff governance
- arXiv 2512.12924 (research, 2025-12-15): LLMs extend as hypothesis generators; validation framework is agnostic
- Saulius.io (practitioner, 2026-03-05): Claude Code as hypothesis generator + mutation operator; all execution governance external
- arxiv 2510.05533 (research, 2025-10-07): "LLMs act as controllers and generators that populate and query graphs while surveys outline integration patterns and governance requirements"

### Sub-claim 2: LLM-as-allocator hallucination risk is documented and high
**TRIANGULATED** — 3 sources, 3 tiers:
- OpenPaper (blog-general, 2026-01-08): 27% hallucination rate for long-horizon financial forecasting
- DigitalApplied (corp-eng, 2026-06-07): 90% claimed confidence → ~75% real; Tier-4 irreversible actions require mandatory gates
- DenisKim (educator, 2026-05-30): Parametric look-ahead bias inflates retros by up to 67.1%; invisible to standard audits

### Sub-claim 3: P-hacking via nightly proposal volume is a real and quantified risk
**TRIANGULATED** — 4 sources, 3 tiers:
- QuantHedgeAI (educator, 2026-05-21): E[max Sharpe | N=100, true Sharpe=0] ≈ 1.4–1.6 from pure noise
- Saulius.io (practitioner, 2026-03-05): N=96 individuals → expected noise ceiling Sharpe = 2.58
- StockAlpha.ai (educator, 2026-02-17): 500 correlated trials → p-value inflates from 0.02 to 0.25
- Aligrithm (educator, 2026-05-28): N_eff estimation and CSCV mechanically quantify overfit probability

### Sub-claim 4: Short rolling windows (20d) are statistically underpowered for edge-decay detection
**TRIANGULATED** — 3 sources, 3 tiers:
- SusanPotter.net (educator, 2026-05-21): Purge ≥ max lookback; 20-day features require 20-day purge minimum
- Saulius.io (practitioner, 2026-03-05): CV consistency requires stability across regimes; 20d windows cannot span regime shifts
- arXiv 2512.12924 (research, 2025-12-15): 34 independent test periods across multiple regimes is the institutional standard for meaningful regime-dependent conclusions

### Sub-claim 5: Look-ahead bias risk in nightly retros / LLM parametric leakage
**TRIANGULATED** — 3 sources, 3 tiers:
- DenisKim (educator, 2026-05-30): Parametric look-ahead inflates in-sample retros by up to 67.1%; invisible to code audits
- HFT Book (corp-eng, 2026-06-04): Research→backtest joint is where "overfit and look-ahead" kills the most edges
- arXiv 2512.12924 (research, 2025-12-15): "Strict information set discipline" — all features use only data available at decision time; violation fabricates edge

### Sub-claim 6: Institutional controls (DSR + CPCV/PBO + sample gates + human governance) are the documented standard
**TRIANGULATED** — 5 sources, 3+ tiers:
- StockAlpha.ai (educator, 2026-02-17): DSR p-value + N_eff estimation + nested CV + Benjamini-Hochberg
- QuantHedgeAI (educator, 2026-05-21): DSR + Haircut Sharpe + PBO + Stability selection as four complementary tools
- Aligrithm (educator, 2026-05-28): CSCV procedure; PBO < 0.10 = deploy threshold
- DigitalApplied (corp-eng, 2026-06-07): Four-tier escalation design; Tier-4 = capital allocation = mandatory human gate
- arXiv 2512.12924 (research, 2025-12-15): Pre-committed thresholds before seeing results; honest reporting of p=0.34

---

## Trading Forge Layer 14 vs institutional reference comparison

| Aspect | Trading Forge Layer 14 design | Institutional reference | Gap | Scale verdict |
|---|---|---|---|---|
| LLM role | Research department generating proposals; never directly changes production | HFT Book: AI assistants in research stage only; handoff to backtest/execution/risk is governed | ALIGNED | Required at all scales |
| Regime audit (predicted vs actual) | Nightly GPT retro compares predicted regime to actual outcome | arXiv 2512.12924: strict point-in-time discipline; features only use data available at signal time | GAP: must verify regime labels use only data available at decision time, not ex-post classifications | Required |
| Expectancy audit | Per-strategy 90d vs 20d rolling expectancy comparison | SusanPotter: 20d window requires 20d purge; arXiv 2512.12924: 34 independent test periods as standard | CRITICAL GAP: 20-day window is statistically underpowered (SE(Sharpe) ≈ 0.22 at 20 obs; cannot reject Sharpe=0 at 5% level) | Required |
| 5-category leak detection | Regime / execution / risk / allocation / edge-decay categories | HFT Book: each pipeline stage has documented failure modes; all require point-in-time data | PARTIAL GAP: execution and risk categories must verify point-in-time; no retroactive cost/outcome labeling | Required |
| Edge-decay detection | 90d vs 20d expectancy comparison as signal | Saulius.io: decay analysis checks RankIC monotonicity at horizons 1,2,5,10,20 days | GAP: binary comparison vs decay curve; and 20d is underpowered; need minimum 63d (3 months) for statistically meaningful edge comparison | Required |
| Strategy ranking | LLM-generated ranking of strategies | QuantHedgeAI: DSR + Haircut + PBO + Stability as four-tool suite; ranking must be overfitting-corrected | GAP: LLM ranking without DSR correction can promote zero-edge strategies by noise; must use corrected metrics as ranking inputs, not raw Sharpe/expectancy | Required |
| Dynamic capital allocation recommendations | LLM emits allocation recommendations | DigitalApplied: Tier-4 irreversible action; MANDATORY human gate or hard statistical gate | CRITICAL GAP: currently unclear if these recommendations have a hard gate or flow through the proposal pipeline like other proposals | Required |
| Research proposal generation | Proposals feed backtest→WF→shadow→promote pipeline | HFT Book + ARTEMIS: shadow mode is standard; promotion gates prevent direct capital risk | ALIGNED (correct pipeline; gates exist from Wave 29) | Required |
| Proposal volume / trial counting | Not documented | QuantHedgeAI: cumulative trial count from all nightly runs must be tracked; DSR must account for N_total, not N_this_proposal | GAP: if 30-day run generates 5 proposals/night = 150 cumulative trials; DSR calculation on each proposal must use N=150 not N=1 | Required |
| LLM parametric look-ahead | Not addressed | DenisKim 2026: pre-training memorization inflates retros by up to 67.1%; standard audits miss it | GAP: nightly GPT run must provide ALL data explicitly in context; never ask LLM to "recall" market history; validate by requiring LLM to cite only provided data | Required |
| Human governance gate | Hard rule: LLM never directly changes production | DigitalApplied: enforcement layer (architectural gate) not just policy; async-first pattern | PARTIAL GAP: "hard rule" must be DB-enforced, not assumed; need audit trail of every proposal emitted vs approved | Required |

---

## Recommended changes (with citations)

### R1 — CRITICAL: Capital allocation recommendations must be Tier-4 gated (hard gate, not soft advisory)
**Classification**: required at single-operator scale (capital at risk is real; blast radius = account wipeout)

Capital allocation changes must require EITHER (a) explicit operator approval via Discord/dashboard approval button logged to audit trail, OR (b) automated hard gate requiring: strategy has ≥30 days shadow evidence at proposed allocation level + PBO < 0.20 at new allocation level + DSR > 0.65. No LLM allocation recommendation may auto-accept.

Supported by: [DigitalApplied 2026-06-07], [OpenPaper 2026-01-08], [arXiv 2512.12924 2025-12-15]

### R2 — CRITICAL: Track cumulative trial count across all nightly runs; use N_total in DSR calculation
**Classification**: required at all scales

Each nightly run that generates research proposals must increment a shared trial counter (stored in DB). When any proposal reaches the backtest → promote gate, the DSR and PBO calculations must use N_total (total proposals generated since strategy's last gate reset), not N=1 (this proposal only). Threshold: DSR p-value < 0.05 with N_total used as denominator. Per [QuantHedgeAI 2026-05-21] and [Saulius.io 2026-03-05], using N=1 when N=150 inflates significance 2×–5×.

Supported by: [QuantHedgeAI 2026-05-21], [Saulius.io 2026-03-05], [StockAlpha.ai 2026-02-17]

### R3 — CRITICAL: Enforce minimum 63-day window (3 months) for any rolling edge-decay comparison
**Classification**: required

20-day rolling windows are statistically underpowered for detecting edge decay. The standard error of the Sharpe estimator at 20 observations is ≈0.22; you cannot distinguish Sharpe 0.5 from Sharpe 0 at the 5% level. Enforce a minimum gate of 63 trading days (≈3 calendar months) before any "edge-decay detected" signal is emitted. The 90d vs 20d comparison may be retained as an indicator but must be labeled "advisory" until the 90d window contains ≥63 usable observations.

Supported by: [SusanPotter.net 2026-05-21], [Aligrithm 2026-05-28], [arXiv 2512.12924 2025-12-15]

### R4 — HIGH: Add point-in-time validation gate to regime audit
**Classification**: required

The nightly retro comparing "predicted regime" to "actual outcome" must pass a point-in-time audit: all regime labels must be recomputed using only data available at the signal-generation timestamp. Common failure mode: regime classifiers that use next-day or intraday data to label yesterday's regime, creating retroactive look-ahead. Add a validation step that re-runs regime classification with a strict time_as_of parameter and compares to the stored regime label — flag any mismatch for human review.

Supported by: [arXiv 2512.12924 2025-12-15], [HFT Book 2026-06-04], [DenisKim 2026-05-30]

### R5 — HIGH: Add LLM parametric look-ahead mitigation to nightly prompt design
**Classification**: required

The nightly GPT run must supply ALL evaluation data explicitly in the context window. Prohibited patterns: asking GPT "what happened in the market on [date]", asking GPT to "recall" any historical price or regime data, or using any prompt that allows GPT to draw on pre-training memory. Required patterns: provide complete OHLCV + regime labels + expectancy metrics as structured JSON in the prompt; require GPT to cite only provided data when making retro judgments; add a "cite your source" validation pass.

Supported by: [DenisKim 2026-05-30], [OpenPaper 2026-01-08], [DigitalApplied 2026-06-07]

### R6 — HIGH: Enforce proposal-only hard boundary architecturally (DB enforced)
**Classification**: required

The "LLM never directly changes production" rule must be enforced at the DB layer, not the application layer. All Layer 14 outputs must be written to a `research_proposals` table with status=PENDING. No production table (strategy_lifecycle, capital_allocations, risk_parameters) may be written by the Layer 14 worker process. The worker's DB role must be GRANT INSERT on research_proposals ONLY; promote steps require a separate process with separate credentials. This ensures the rule cannot be bypassed by a prompt injection or model hallucination.

Supported by: [HFT Book 2026-06-04], [DigitalApplied 2026-06-07], [arXiv 2512.12924 2025-12-15]

### R7 — MEDIUM: Add 5-gate false-discovery gauntlet before any proposal enters backtest queue
**Classification**: beneficial at our scale

Drawing from the Saulius.io practitioner implementation (2026-03-05), any LLM-generated research proposal that reaches the backtest queue should first pass a pre-commitment gate (thresholds set BEFORE the backtest runs): (1) economic rationale documented, (2) parameter space ≤ N_eff limit per session, (3) minimum sample size declared, (4) regime conditions declared (strategy must declare which regimes it targets), (5) failure mode declared (conditions under which strategy stops working). Proposals lacking all five elements go back to PENDING.

Supported by: [Saulius.io 2026-03-05], [StockAlpha.ai 2026-02-17], [arXiv 2512.12924 2025-12-15]

### R8 — MEDIUM: Add strategy ranking decay curve (not binary comparison)
**Classification**: beneficial

Replace the binary 90d vs 20d expectancy comparison for edge decay with a decay curve: compute expectancy at 5, 10, 20, 40, 63 rolling-day windows. Real signals decay monotonically. Noise signals show erratic non-monotonic patterns. The decay curve also provides earlier warning (20-day window decline may not be decisive, but combined with 40-day and 63-day confirming the trend, the signal is statistically meaningful).

Supported by: [Saulius.io 2026-03-05], [SusanPotter.net 2026-05-21], [QuantHedgeAI 2026-05-21]

---

## Scale translation

| Recommendation | Required at $50K combine scale? | Rationale |
|---|---|---|
| R1 — Capital alloc Tier-4 gate | REQUIRED | Real capital, single account; one bad LLM allocation recommendation = account breach |
| R2 — Cumulative trial count + DSR(N_total) | REQUIRED | A nightly loop running 30 nights × 5 proposals = 150 trials; DSR(N=1) is fraudulently optimistic |
| R3 — Minimum 63-day window | REQUIRED | Statistical rigor; 20-day window emits false-positive "edge decay" signals that can terminate profitable strategies |
| R4 — Point-in-time regime audit | REQUIRED | Look-ahead in retros = the nightly research department grades itself on inflated scores |
| R5 — Parametric look-ahead mitigation | REQUIRED | GPT's pre-training includes market data; nightly retros on recent history are at risk |
| R6 — DB-enforced proposal-only boundary | REQUIRED | Policy-only enforcement fails under edge cases; DB RBAC is the only reliable control |
| R7 — 5-gate pre-commitment | BENEFICIAL | Reduces false-discovery rate; low implementation cost; not strictly required if R2 is implemented |
| R8 — Decay curve vs binary comparison | BENEFICIAL | Better signal quality; over-engineered only if proposal volume is very low |

---

## Research gaps / INSUFFICIENT EVIDENCE

- **Intraday research loop timing**: No evidence found for the specific risk/benefit of 3AM execution time for the nightly loop. Running at 3AM means the LLM operates on incomplete data for the current session (if daily data is available) or on the prior day's full data. No institutional sources found on optimal timing. INSUFFICIENT EVIDENCE — 0 corroborating sources.
- **YouTube institutional corroboration**: No institutional quant talks found on nightly LLM research automation pipeline governance. YouTube search returned zero matching results. This sub-claim is PARTIAL — 0 YouTube sources.
- **SSRN practitioner guide (Mihov et al., 2025-12-20)**: Full text was not accessible (Exa returned null for the PDF). Could not extract specific quotes. This source is dropped from triangulation.

---

_Evidence file created: 2026-06-27. Evidence quality: HIGH (all 6 sub-claims triangulated; 11 sources retrieved and content-verified; 10 of 11 publication dates confirmed ≥2025-01-01). Next update recommended: 2026-09-27 (quarterly)._

---
---

# ADDENDUM 2026-07-04 — Nightly GPT-5 Trade Analyst: Capability, RAG, Analyst-vs-Trader

**Question audited:** Is the nightly GPT-5-class trade-critique service (`src/server/services/trade-critique-service.ts`, Wave 26 Pass 1, `trade_critique` table, migration 0141 — grades every closed trade A-F + plain-English read + 8-dimension technical attribution, feeds `pattern-aggregator` which proposes changes ONLY under AUTOPILOT + robustness battery) institutionally sound? Should an LLM ever directly TRADE?

This addendum is narrower-scope than the original Layer 14 audit above (which covered the *research-proposal* volume/p-hacking/look-ahead risks). This pass targets 5 new sub-claims: (1) frontier-LLM capability/reliability for post-trade critique, (2) RAG vs parametric knowledge, (3) analyst-vs-trader architecture evidence, (4) whether nightly-critic-plus-gated-loop is a recognized institutional pattern, (5) concrete upgrade path.

**Reddit note:** r/quant and r/algotrading both returned `403` from the free JSON endpoint this pass (rate-limited or UA-blocked) — PARTIAL, 0 Reddit sources this addendum. Triangulation relies on research + corporate-eng + educator tiers instead; each sub-claim still clears the ≥3-source bar.

## New sources (≥2025 only)

| Date | Source | Tier | Citation | Key claim |
|---|---|---|---|---|
| 2026-05-19 | arXiv 2605.19337 — Agentic Trading: When LLM Agents Meet Financial Markets | research | https://arxiv.org/html/2605.19337v1 | Evidence-mapped 77 studies; only 19/77 satisfy Action-Output + Closed-Loop-Evaluation; of those, 15/19 = lowest reproducibility tier (R0), 0/19 reach R3. "LLM-based agents can generate human-readable rationales... not guaranteed to be faithful to the true internal decision process. Meaningful auditability therefore depends on grounded, time-stamped tool calls, data snapshots, and execution logs." Names the **"Oracle Fallacy"**: an agent retrieves a similar past episode containing a post-hoc narrative ("this trade failed due to news X released tomorrow") and treats it as causal ground truth — a RAG-specific hallucination risk, not just a parametric one. |
| 2025-12-02 | arXiv 2512.02261 — TradeTrap: Are LLM-based Trading Agents Truly Reliable and Faithful? | research | https://arxiv.org/html/2512.02261v1 | Stress-tests LLM trading agents across market-intelligence / strategy / ledger / execution. Small single-component perturbations propagate into "extreme concentration, runaway exposure, and large portfolio drawdowns." Documents a live failure case: an agent that fully liquidated a position the prior day suffered "epistemic hallucination, erroneously believing it still retains the position," causing "strategic paralysis." Directly evidences state-tracking hallucination as a should-never-trade-live risk. |
| 2026-03-29 | arXiv 2603.27539 — Toward Reliable Evaluation of LLM-Based Financial Multi-Agent Systems | research | https://arxiv.org/html/2603.27539v1 | Documents 5 pervasive evaluation failures in published LLM-trading results (look-ahead bias, survivorship bias, backtest overfitting, transaction-cost neglect, regime-shift blindness) that "can reverse the sign of reported returns." "Read-only access depends on LLM numerical reasoning, a documented weakness... Verifier-gated execution validates outputs before action and is preferred for institutional deployment." Claimed cumulative returns of 23%–400% across published multi-agent trading systems are flagged as likely evaluation artifacts, not real edge. |
| 2025-10-30 | arXiv 2510.11695 — When Agents Trade: Live Multi-Market Trading Benchmark (Agent Market Arena) | research | https://arxiv.org/abs/2510.11695 | First lifelong live-market benchmark for LLM trading agents; built specifically because backtest-only claims from prior LLM-trading papers were not independently verifiable. |
| 2025-10-07 | arXiv 2510.05533 — The New Quant: Survey of LLMs in Financial Prediction and Trading | research | https://arxiv.org/html/2510.05533v1 | "In practice these agents should separate research from order routing and they should log prompts, retrievals, and tool calls for audit." Explicit survey-level recommendation for the analyst/trader separation TF already implements. |
| 2026-05-27 | arXiv 2605.27773 — Do Models Know Why They Changed Their Mind? (CoT Faithfulness) | research | https://arxiv.org/html/2605.27773 | "A model following a distractor with confidence 2 is expressing honest uncertainty. A model following with confidence 5 is either falsely confident, confabulating, or generating confidence independently of its state." Chain-of-thought / stated-rationale is not a reliable trace of the real decision process — directly relevant to trusting the "plain-English read" trade_critique output as ground truth. |
| 2026-02-15 | arXiv 2602.14233 — Evaluating LLMs in Finance Requires Explicit Bias Consideration | research | https://arxiv.org/html/2602.14233v1 | "CoT rationales should not be treated as transparent traces of the model's internal decision process" (citing Turpin et al. 2023); good backtest/eval numbers do not guarantee identification of robust return drivers. |
| 2026-07-02 | aimultiple.com — Benchmark of 40+ LLMs in Finance (FinanceReasoning, 238 hard Qs) | corporate-eng | https://aimultiple.com/finance-llm | GPT-5 family scores 87–88% accuracy on hard multi-step financial-reasoning questions; top tier (Claude Opus/Fable) 89–90%; "no clear correlation between token consumption and accuracy." Frontier models ARE capable at structured financial reasoning out of the box, but the benchmark is closed-book Q&A, not live post-trade attribution — capability transfer to trade-critique is not proven by this alone. |
| 2026-05-18 / 2026-06-14 | TradingAgents (TauricResearch, UCLA/MIT) — GitHub + beginnersinai.org summary | corporate-eng / educator | https://github.com/TauricResearch/TradingAgents ; https://beginnersinai.org/tradingagents-explained/ | Multi-agent (analyst/bull/bear/trader/risk-manager/portfolio-manager) architecture beat 5 rule-based baselines by 6–25% cumulative return over a 3-month backtest — but per arXiv 2603.27539 above, backtest-only claimed returns of this scale are exactly the class of evaluation artifact under suspicion (no disclosed transaction-cost model in most of the 19-study primary subset). |
| 2026-05-28 | Pinggy.io — Best AI Trading Agents 2026: Do They Actually Make Money? | blog-general | https://pinggy.io/blog/best_ai_trading_agents/ | Honest reporting: "One documented TradingAgents run achieved roughly 7% returns over 30 days vs the S&P 500's 4.5%... but with 22% drawdowns and no guarantee" of forward performance. Corroborates that LLM-driven LIVE trading, even in its best documented public case, carries drawdown profile far outside what a prop-firm EOD-DD account can absorb. |
| 2026-04-02 | arXiv 2604.01483 — Type-Checked Compliance: Deterministic Guardrails for Agentic Financial Systems (Lean 4) | research | https://arxiv.org/html/2604.01483 | Quotes FINRA Regulatory Notice 24-09 + 2026 Annual Regulatory Oversight Report directly: FINRA's rules are "technology-neutral" — GenAI tools "must be supervised with the same rigor as human communications and traditional decision-making systems." Proposes deterministic (non-LLM) guardrail layers precisely because LLM outputs cannot themselves serve as the compliance control. |
| 2025-12-12 | Debevoise & Plimpton — FINRA's 2026 Regulatory Oversight Report: Continued Focus on Generative AI | practitioner-interview (law-firm client alert on regulator text) | https://www.debevoise.com/insights/publications/2025/12/finras-2026-regulatory-oversight-report-continued | Firms should "enhance GenAI governance programs to strengthen testing and monitoring controls... ensure appropriate oversight mechanisms for GenAI and agentic AI use cases" and avoid overstated AI-capability claims in disclosures ("AI washing"). |
| 2025-12-12 | McGuireWoods — FINRA's 2026 Annual Regulatory Oversight Report | practitioner-interview | https://www.mcguirewoods.com/client-resources/alerts/2025/12/finras-2026-annual-regulatory-oversight-report-same-priorities-new-focus-on-ai-and-cybersecurity/ | Corroborates same 2026 report; no FINRA rule yet specifically bans LLM-driven execution, but existing supervision/best-execution/recordkeeping rules apply in full to any AI-assisted decision — i.e., there is no regulatory safe harbor for "the LLM decided," only for firms that can document supervision. |
| 2026-03-27 | Sidley Austin — AI: U.S. Securities and Commodities Guidelines for Responsible Use | practitioner-interview | https://www.sidley.com/en/insights/newsupdates/2025/02/artificial-intelligence-us-financial-regulator-guidelines-for-responsible-use | Confirms SEC/FINRA have not (as of this writing) issued AI-specific new rules — existing suitability/supervision/books-and-records regime governs; absence of new rules is NOT absence of applicable regulation. |
| 2026-02-24 | Kaif Kohari — Engineering a Perfect RAG System for Hedge Funds | blog-general (practitioner build log) | https://kaifkohari10.medium.com/engineering-the-perfect-rag-system-for-hedge-funds-60f44a8b86b3 | Real-world finding: naive one-shot cosine-similarity RAG "worked well" for single-hop factual retrieval (e.g., "what was NVIDIA Q3 revenue") but "fell apart" on multi-hop comparison queries ("how has AMD's data-centre revenue growth compared to gaming over 3 years") — retriever pulls chunks from mismatched time periods, producing "meaningless" comparisons. Conclusion: "One-shot RAG is not a path to production" — iterative/agentic retrieval with self-checking is required for real analyst-grade queries. |
| 2026-05-06 | FutureAGI — LLM-as-Judge Best Practices 2026 | educator | https://futureagi.com/blog/llm-as-judge-best-practices-2026 | "Pick the right judge, calibrate against humans, watch for length and family bias, control cost" — LLM-as-judge/grader systems (directly analogous to the A-F trade grade) require explicit calibration against a human-graded reference set; uncalibrated LLM grading has known systematic biases (self-preference, verbosity, position bias). |
| 2025-12-03 | LabelYourData — LLM as a Judge: 2026 Guide | educator | https://labelyourdata.com/articles/llm-as-a-judge | Quantifies judge biases: "Position bias (40% GPT-4 inconsistency)... Verbosity bias (~15% inflation)... Self-enhancement bias (5-7% boost)... Domain gaps: Agreement drops 10-15% in specialized fields; use for screening, not final decisions." Directly implies a single-pass LLM trade grade (A-F) should be treated as a screening signal, not a final verdict, absent calibration. |
| 2025-12-24 | arXiv 2512.22245 — Calibrating LLM Judges: Linear Probes for Fast and Reliable Uncertainty Estimation | research | https://arxiv.org/html/2512.22245v1 | "Self-consistency... semantic entropy... and related approaches achieve strong calibration by aggregating uncertainty across multiple generations." Multi-sample self-consistency / ensemble grading is the state-of-the-art mitigation for single-pass LLM-judge unreliability — directly actionable for the trade-critique grading design. |

## New sub-claim triangulation

### Sub-claim 7: Frontier LLMs (GPT-5/Claude/o-series class) are capable at structured financial reasoning but this does NOT transfer automatically to reliable live post-trade attribution
**TRIANGULATED** — 4 sources, 3 tiers:
- aimultiple.com (corp-eng, 2026-07-02): 87-90% accuracy on hard financial-reasoning benchmark — genuine out-of-the-box capability on closed-book, well-posed questions
- arXiv 2603.27539 (research, 2026-03-29): "Read-only access depends on LLM numerical reasoning, a documented weakness" — the capability gap is specifically in on-the-fly numerical grounding, exactly what per-trade attribution requires
- arXiv 2605.27773 (research, 2026-05-27) + arXiv 2602.14233 (research, 2026-02-15): stated rationale/CoT is not a faithful trace of the real decision process — a model can be right about the grade and wrong (confabulated) about WHY
- arXiv 2512.02261 TradeTrap (research, 2025-12-02): documents a real epistemic-hallucination failure (agent forgot it had liquidated a position) — capability on paper does not preclude state-tracking failures in a live pipeline

**Verdict: general frontier models are NOT "educated enough" out of the box for reliable trade analysis — they need domain grounding (structured data injection, not recall) AND output verification, matching the existing R5 recommendation above.**

### Sub-claim 8: Institutional/serious 2025-2026 LLM-finance implementations use RAG, not parametric knowledge alone, and retrieval quality (not just presence) determines usefulness
**TRIANGULATED** — 4 sources, 3 tiers:
- Kaif Kohari (blog-general/practitioner, 2026-02-24): naive one-shot RAG works for single-hop facts, fails on multi-hop/time-aligned comparison queries — "One-shot RAG is not a path to production"
- arXiv 2605.19337 (research, 2026-05-19): names the "Oracle Fallacy" — RAG retrieval of a similar past trade episode containing a post-hoc fabricated causal narrative gets treated as ground truth by the agent. RAG does not eliminate hallucination risk; it can relocate it into the retrieved corpus.
- DenisKim / FinCAD (educator, 2026-05-30, prior evidence file): parametric look-ahead bias (LLM "recalling" market history from pretraining) inflates retro quality by up to 67.1% — the CORE argument for why explicit-context RAG beats parametric recall
- arXiv 2510.05533 (research, 2025-10-07): "these agents should separate research from order routing and they should log prompts, retrievals, and tool calls for audit" — retrieval provenance must be auditable, not just present

**Verdict: RAG is necessary but not sufficient. What should be retrieved for the nightly critique to be sharper and less hallucinated: (a) the strategy's own DSL source thesis/entry_quality confluence factors (ground the critique in what the strategy actually claims to trade, not a generic pattern), (b) the actual bar-level market data at entry/exit (already in trade_critique inputs per Wave 26 Pass 1), (c) prior critique history for the SAME strategy (trade-memory) so the critic can check its own prior verdicts for consistency, (d) the regime label active at trade time from `bias_state`, (e) the playbook/archetype definition from `kb/indicator-catalog.md`. All 5 must be injected as structured data, never asked for by "recall."**

### Sub-claim 9: LLM-as-analyst/improver (proposal-only, gated) is the institutionally-correct architecture; LLM-as-live-trader is not yet viable at accountable/regulated scale
**TRIANGULATED** — 5 sources, 3 tiers:
- arXiv 2605.19337 (research, 2026-05-19): only 19/77 surveyed LLM-trading-agent studies even reach closed-loop action evaluation; of those, 0/19 reach top reproducibility tier (R3), 15/19 are lowest tier (R0) — the LLM-as-trader literature itself is not yet trustworthy science, let alone production-ready
- arXiv 2512.02261 TradeTrap (research, 2025-12-02): small perturbations propagate into "extreme concentration, runaway exposure, and large portfolio drawdowns"; documented epistemic-hallucination failure causing "strategic paralysis"
- arXiv 2603.27539 (research, 2026-03-29): "Verifier-gated execution validates outputs before action and is preferred for institutional deployment" — explicit recommendation for exactly TF's gated-algo-executes pattern
- Pinggy.io (blog-general, 2026-05-28): best documented public LLM-trader result carries 22% drawdown — incompatible with any prop-firm EOD trailing-DD account
- FINRA 2026 Regulatory Oversight Report via Debevoise/McGuireWoods/Sidley/arXiv 2604.01483 (2025-12 to 2026-04): no regulatory safe harbor exists for "the LLM decided" — GenAI-assisted decisions are supervised under the SAME existing rules as human decisions, meaning a firm/operator must be able to explain, reproduce, and supervise every trade regardless of which component (human, algo, or LLM) proposed it

**Verdict: "LLM analyzes + proposes, gated deterministic algo executes" is the correct 2025-2026 institutional architecture — not a compromise, but the state of the art. Full LLM-driven live trading is an active, unresolved research area (0/19 studies reach reproducibility tier R3) with no regulatory safe harbor and documented catastrophic failure modes (state hallucination, narrative-fallacy retrieval, perturbation propagation). TF's existing hard rule (LLM never directly changes production; deterministic backtester/broker-router executes) is validated, not just permitted.**

### Sub-claim 10: Nightly-critic + gated-improvement-loop with human/statistical gate is a recognized 2025-2026 pattern, and single-pass LLM-as-judge/grader requires calibration to be trustworthy
**TRIANGULATED** — 4 sources, 3 tiers (extends Sub-claim 1 from the original Layer 14 audit above):
- arXiv 2510.05533 (research, 2025-10-07): explicit recommendation to separate research/critique from order routing, log everything for audit — exactly TF's `trade_critique` → `pattern_aggregator` → robustness-battery → promotion-gate pipeline
- FutureAGI (educator, 2026-05-06) + LabelYourData (educator, 2025-12-03): LLM-as-judge/grader (the A-F trade grade IS an LLM-as-judge application) has documented systematic biases (position 40%, verbosity ~15%, self-enhancement 5-7%) UNLESS calibrated against a human-graded reference set — "use for screening, not final decisions"
- arXiv 2512.22245 (research, 2025-12-24): self-consistency / multi-generation aggregation is the state-of-the-art calibration technique for LLM judges — directly actionable
- ARTEMIS (research, 2026-02-09, prior evidence file): shadow-mode dual-execution (evaluate rejected/candidate signals at zero capital cost) is the institutional pattern for evidence-safe LLM-influenced experimentation — TF's PILOT/SHADOW lifecycle stage already implements an analogous pattern for strategies, but the trade_critique grading itself has no equivalent shadow-calibration step yet

**Verdict: TF's overall shape (nightly critic → aggregator → AUTOPILOT-gated proposal → robustness battery → promotion gate) IS the recognized 2025-2026 institutional pattern. The specific gap: the A-F GRADE ITSELF is never calibrated against a human-labeled reference set, and is generated single-pass (no self-consistency sampling) — this is the primary "good vs institutional top-notch" delta.**

## Updated Trading Forge vs institutional comparison (trade-critique subsystem)

| Aspect | Trading Forge implementation | Institutional reference | Gap | Scale verdict |
|---|---|---|---|---|
| Analyst-vs-trader separation | `trade_critique` writes to its own table; only `pattern_aggregator` can propose prompt/parameter changes, only at AUTOPILOT mode; LLM never calls `routeOrder()` or touches `strategy_lifecycle`/`capital_allocations` directly | arXiv 2510.05533 + 2603.27539 + FINRA 2026 report: separate research from execution; verifier-gated execution preferred; no regulatory safe harbor for LLM-decided trades | ALIGNED — this is the single strongest finding of this addendum | Required, already correct |
| Retrieval grounding | Trade data (bars, fills, entry_quality confluence factors) supplied structurally per Wave 26 Pass 1; `missingFields[]` degrades gracefully | Kaif Kohari 2026-02-24 (multi-hop RAG needs iterative retrieval, not one-shot); arXiv 2605.19337 Oracle Fallacy | GAP: no evidence the critique retrieves the strategy's OWN prior critique history (trade-memory) or cross-references its own past verdicts for the same strategy — risk of inconsistent grading across sessions with no self-check | Beneficial — cheap to add, catches drifting grading standards |
| Grading calibration | Single-pass GPT-5.4 call produces A-F grade + attribution; 3-strike Ollama fallback on failure | FutureAGI + LabelYourData 2026: LLM-as-judge needs calibration vs human reference + is prone to position/verbosity/self-enhancement bias; arXiv 2512.22245: self-consistency sampling is SOTA mitigation | CRITICAL GAP: no calibration harness exists comparing GPT-5.4 trade grades against an operator-labeled reference set of trades; no self-consistency/multi-sample grading | Required for "institutional top-notch"; beneficial-not-required for "good enough" |
| Rationale faithfulness | Plain-English read + 8-dimension technical attribution presented as the "why" | arXiv 2605.27773 + 2602.14233: CoT/stated rationale is not a faithful trace of internal decision process; confabulation risk | GAP: rationale is consumed as if descriptive of causal truth; no cross-check that the cited attribution dimensions are internally consistent with the raw trade data (e.g., "cite your source" pass per existing R5) | Required — cheap validation pass, high payoff |
| Look-ahead / parametric recall | R5 (existing) mandates explicit data supply, no "recall" prompts | DenisKim FinCAD 67.1% inflation; Oracle Fallacy (arXiv 2605.19337) | PARTIAL — R5 covers parametric recall; does NOT yet cover retrieved-episode narrative fallacy if/when a trade-memory RAG layer is added | Required once trade-memory RAG ships |
| Live-trading LLM (hypothetical future) | N/A — hard rule: LLM never trades live | 0/19 reproducibility-R3 studies (arXiv 2605.19337); TradeTrap epistemic-hallucination failures; 22% drawdown best-public-case (Pinggy); no FINRA safe harbor | NO GAP — do not build this | Do not build; revisit only if the research base matures materially (multi-year horizon) |

## Additional recommended changes (with citations) — extends R1-R8 above

### R9 — HIGH: Build a calibration harness comparing GPT-5.4 trade grades (A-F) against an operator-labeled reference set
**Classification**: required for institutional top-notch, beneficial (not blocking) for current scale

Sample ~30-50 historical closed trades across regimes/outcomes, have the operator hand-grade A-F once, then measure GPT-5.4 agreement (Cohen's kappa or simple accuracy vs human label). Track this quarterly as prompt/model versions change. Per [FutureAGI 2026-05-06] and [LabelYourData 2025-12-03], uncalibrated LLM-as-judge has known systematic biases; per [arXiv 2512.22245 2025-12-24] this is a solvable, well-studied problem.

Supported by: [FutureAGI 2026-05-06], [LabelYourData 2025-12-03], [arXiv 2512.22245 2025-12-24]

### R10 — MEDIUM: Add self-consistency (multi-sample) grading before the grade is persisted
**Classification**: beneficial at single-operator scale (cheap: 3 samples at low temperature, majority-vote or confidence-weighted average on the A-F grade); required if the grade ever feeds a hard promotion/demotion gate rather than dashboard-only.

Per [arXiv 2512.22245 2025-12-24], self-consistency across multiple generations is the standard calibration technique for LLM-judge unreliability. Current single-pass design is acceptable while the grade is advisory-only (feeds `pattern_aggregator` behind the AUTOPILOT gate), but if any future promotion/demotion decision reads the A-F grade directly, self-consistency sampling becomes required, not optional.

Supported by: [arXiv 2512.22245 2025-12-24], [FutureAGI 2026-05-06], [LabelYourData 2025-12-03]

### R11 — HIGH: Add a "cite your source" consistency check between the technical attribution and the raw trade/market data
**Classification**: required

Per [arXiv 2605.27773 2026-05-27] and [arXiv 2602.14233 2026-02-15], stated rationale/CoT is not guaranteed faithful to the true decision basis. Add a lightweight programmatic post-check: for each of the 8 attribution dimensions the critique claims, verify the cited numeric value (e.g., "entry was 2 ticks late relative to signal bar") against the actual `paper_positions`/bar data. Flag (do not silently accept) any attribution claim that cannot be verified against ground truth. This closes the "confabulated but confident" failure mode directly.

Supported by: [arXiv 2605.27773 2026-05-27], [arXiv 2602.14233 2026-02-15], [arXiv 2512.02261 TradeTrap 2025-12-02]

### R12 — MEDIUM: If/when a trade-memory RAG layer is added (retrieving prior similar trades for context), guard explicitly against the "Oracle Fallacy"
**Classification**: beneficial now (no trade-memory RAG exists yet); required the moment one is built

Per [arXiv 2605.19337 2026-05-19], retrieving a similar past trade episode that itself contains a post-hoc fabricated causal narrative ("this failed because of news X") causes the agent to treat fiction as causal ground truth. If a future pass adds retrieval over the `trade_critique` history table for pattern-matching, the retrieved critique text must be treated as a HYPOTHESIS to re-verify against that historical trade's raw data, never as an established fact to build on directly. This is a design constraint for any future RAG expansion, not a current-state bug.

Supported by: [arXiv 2605.19337 2026-05-19], [DenisKim FinCAD 2026-05-30 — original evidence file], [Kaif Kohari 2026-02-24]

### R13 — CONFIRMED (no change needed): LLM-as-live-trader remains out of scope
**Classification**: do not build

This addendum found no 2025-2026 evidence that LLM-driven live trade DECISIONS (as opposed to analysis/proposal) are viable at institutionally-accountable scale. 0 of 19 rigorously-evaluated LLM-trading-agent studies reach the top reproducibility tier; documented failure modes include state-hallucination-driven "strategic paralysis" and perturbation-driven runaway exposure; the best documented public LLM-trader result (TradingAgents) carries a 22% drawdown incompatible with any prop-firm EOD trailing-drawdown account; and FINRA's 2026 stance offers no regulatory safe harbor for "the LLM decided" — GenAI-assisted decisions are supervised under the same existing rules as human decisions. TF's current architecture (LLM analyzes + proposes; deterministic backtester/broker-router executes; robustness battery + promotion gates stand between any proposal and live capital) is not a conservative compromise — it is the evidenced 2025-2026 institutional state of the art.

Supported by: [arXiv 2605.19337 2026-05-19], [arXiv 2512.02261 TradeTrap 2025-12-02], [arXiv 2603.27539 2026-03-29], [Pinggy.io 2026-05-28], [FINRA 2026 Report via Debevoise/McGuireWoods/Sidley/arXiv 2604.01483]

---

_Addendum added: 2026-07-04. Evidence quality: HIGH for sub-claims 7, 9, 10 (4-5 independent sources each, 3 tiers each); MEDIUM-HIGH for sub-claim 8 (4 sources, but Kaif Kohari is a single practitioner blog — corroborated by 3 research-tier sources on the underlying mechanism). Reddit unavailable this pass (403 on both r/quant and r/algotrading free JSON endpoints) — 0 community-expert sources; all sub-claims still clear the ≥3-source threshold via research/corporate-eng/educator/practitioner-interview tiers. Next update recommended: 2026-10-04 (quarterly) or immediately if a trade-memory RAG layer is proposed._
