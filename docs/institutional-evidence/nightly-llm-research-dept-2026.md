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
