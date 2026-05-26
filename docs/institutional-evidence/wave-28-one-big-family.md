# Wave 28 "One Big Family" Architecture — Institutional Reference Evidence

## TL;DR (Trading Forge gap assessment)

- CLAIM 1 (Composite Health Score): TRUE-WITH-CAVEAT — institutional desks use BOTH composite scores AND parallel hard gates, but they are strictly layered: hard gates are inviolable kill conditions; composite scores are operational dashboards. Conflating them is the key risk in the Wave 28 proposal.
- CLAIM 2 (Cross-Subsystem Disagreement): TRUE-WITH-CAVEAT — pod shops run multiple VaR models in parallel explicitly to surface disagreement; the pattern exists under the name "multi-model cross-validation" and "challenger model." Wave 28 naming it explicitly is sound practice.
- CLAIM 3 (Daily Digest vs Per-Event): TRUE — severity-tiered hybrid is the 2026 canonical standard. Daily digest alone is insufficient for critical risk events; unfiltered per-event fires cause alert fatigue that paradoxically increases missed events.
- CLAIM 4 (Weight Calibration Cadence): UNSUPPORTED for frequent recalibration — institutional guidance strongly warns against weight-chasing; equal-weight or rarely-recalibrated equal-weighted schemes dominate. Adaptive recalibration is a documented overfitting vector.
- CLAIM 5 (Single Decision Bus): TRUE — "one governed substrate" / single lineage graph is the 2026 institutional direction per OCC/Fed/FDIC April 2026 MRM guidance and Databricks MRM reference architecture.
- CLAIM 6 (Vacation-Safe Composite): TRUE-WITH-CAVEAT for prop firm context — Topstep and most futures prop firms PROHIBIT fully unattended automation on funded accounts; "vacation-proof" mode requires documented human-oversight wrapper even if passive.
- CLAIM 7 (Failure Modes): All five red-team failure modes have documented institutional analogs; Goodhart's Law on the composite is the highest-probability failure at our scale.

---

## Sources (2025-01-01 or later only)

| Date | Source | Tier | Citation | Key claim |
|---|---|---|---|---|
| 2026-05-10 | Quant Enthusiasts (Substack) | practitioner-interview | https://youngandcalculated.substack.com/p/risk-management-inside-a-pod-how | "Platforms run multiple VaR models in parallel: historical simulation, parametric, and Monte Carlo, because each misses different tail behavior" |
| 2026-05-24 | Quant Enthusiasts (Substack) | practitioner-interview | https://youngandcalculated.substack.com/p/what-risk-managers-at-pod-shops-actually | "Overnight VaR and expected shortfall run at the pod, strategy, and firm level. Most platforms run multiple VaR models in parallel." |
| 2026-04-17 | OCC/Fed/FDIC Revised MRM Guidance | corporate-eng (regulatory) | https://www.occ.gov/news-issuances/bulletins/2026/bulletin-2026-13.html | Three-component validation (conceptual soundness, outcomes analysis, ongoing monitoring) retained. "Validation approaches may differ across models based on their characteristics and use." |
| 2026-04-25 | Databricks MRM Reference Architecture | corporate-eng | https://www.databricks.com/blog/model-risk-management-2026-bankers-guide-revised-interagency-guidance | "One lineage graph" single governed substrate as MRM 2026 standard. Champion/challenger, benchmarking, sensitivity testing must be versioned and reproducible. |
| 2026-04-24 | Orrick (law firm analysis of April 2026 MRM) | corporate-eng | https://www.orrick.com/en/Insights/2026/04/Agencies-Overhaul-Model-Risk-Management-Guidance-for-Banks-Heres-What-Changed | Parallel outcomes analysis and VaR backtesting removed from prescriptive guidance; replaced by principles-based "effective challenge" requiring independent validation. |
| 2026-04-13 | Resonanz Capital DD Framework | practitioner-interview | https://resonanzcapital.com/insights/quant-hedge-funds-in-2026-a-due-diligence-framework-by-strategy-type | "Name the failure mode in one sentence. If you can't, you don't understand it yet." Five-bucket underwriting taxonomy. |
| 2026-03-13 | The Specification (Substack) | educator | https://thespecification.substack.com/p/same-sharpe-different-beliefs-what | MIT/Princeton: two models with identical Sharpe/NMSE can hold fundamentally different market beliefs — disagreement is invisible to standard DD; optimizer choice encodes hidden priors. |
| 2026-04-22 | JUXT / Meridian (risk system engineering) | corporate-eng | https://www.juxt.pro/blog/building-meridian/ | Institutional post-trade risk design: immutable, deterministic, reproducible. Five separate services. P&L attribution via sequential tag assembly — every intermediate step is an auditable valuation run. |
| 2026-04-20 | FluxForce (alert fatigue) | blog-general | https://www.fluxforce.ai/blog/fraud-alert-fatigue | Gartner 2025: 70% of analyst time wasted on false-positive alerts. 72% of institutions do not use risk-based alert scoring. Best-in-class use severity-tiered routing, not flat alert queues. |
| 2026-01-16 | Int'l Journal Networks & Security (FEBF) | research | https://www.academicpublishers.org/journals/index.php/ijns/article/view/10098 | Finance Error Budgeting Framework: risk-tiered SLO design, burn-rate-driven alert governance, DORA/FFIEC/PRA aligned. Distinguishes P1-level immediate alerts from digest-level operational summaries. |
| 2026-04-13 | propfirmplus.com (prop firm algo rules) | blog-general | https://propfirmplus.com/algo-trading-on-futures-prop-firms-whats-actually-allowed-in-2026/ | Topstep TopstepX does NOT allow fully automated strategies on funded accounts. Semi-automated with human oversight is the standard. |
| 2026-03-05 | Practical DevSecOps (Goodhart's Law AI) | blog-general | https://www.practical-devsecops.com/glossary/goodharts-law/ | "When a measure becomes a target, it ceases to be a good measure." Particularly acute for composite AI/risk scores used as optimization targets. |
| 2026-04-07 | Model Risk Quantification via Bayesian Model Averaging (clawRxiv) | research | https://clawrxiv.io/abs/2604.01464 | BMA reveals 35% dispersion in credit portfolio loss estimates across accepted models — cross-model disagreement quantified. |

---

## Trading Forge vs institutional comparison

| Aspect | Trading Forge (Wave 28 proposal) | Institutional reference | Gap |
|---|---|---|---|
| Score architecture | Single composite score 0-100 from 12 subsystems, weighted | Hard-gate kill conditions PLUS composite dashboard PLUS capital allocation signals — three distinct layers | Wave 28 conflates kill gates with composite dashboard. These must be separate layers. |
| Parallel model disagreement | Proposed "disagreement detection" between subsystems | Millennium/Citadel/Point72: multiple VaR models (historical sim + parametric + MC) run in parallel explicitly to surface disagreement | Naming the pattern correctly; implementation path is sound |
| Alert cadence | Proposed daily digest | Financial SRE: severity-tiered — P1 (immediate), P2 (15-min), P3 (1hr), P4 (daily digest) | Daily digest alone is insufficient; critical events (DLL breach, kill switch trigger) must be P1 immediate |
| Weight calibration | Proposed dynamic recalibration | OCC/Fed/FDIC: validation approaches proportionate to materiality; weight stability preferred; adaptive recalibration flagged as model risk | Adaptive weight recalibration is itself a model risk that requires independent validation |
| Decision bus | Single `strategy_health_scores` table | Databricks MRM: "one lineage graph" / Unity Catalog single governed substrate is the 2026 standard | Architecture is correct; needs immutability + audit trail per Meridian pattern |
| Vacation-safe operation | Fully unattended composite-driven | Topstep & most futures prop firms: fully automated unattended is PROHIBITED on funded accounts | Cannot claim "vacation-proof" on funded Topstep/MFFU without violating TOS |
| Failure mode isolation | Single aggregator service | Meridian (JUXT): five separate services with adapter boundaries; each service reproducible independently | Single aggregator creates single point of failure for 12 subsystems |

---

## Recommended changes (with citations)

### R1 — Separate hard gates from composite score (REQUIRED)
The composite health score should be an operational DASHBOARD, not the kill gate. Hard gates (DLL, trailing DD, B14 survival) must remain independent AND-connected conditions that fire regardless of composite score.

Supported by: [Resonanz Capital Feb 2026 — "what breaks it? name it in one sentence"], [Millennium/Citadel pod architecture May 2026 — "drawdown triggers are not soft guidelines, they are encoded in the risk system"], [OCC/Fed/FDIC April 2026 — "effective challenge requires sufficient independence to permit objectivity"]

Scale: REQUIRED at our scale. A $50K combine blowing past a DLL because the composite score was 78/100 is not recoverable.

### R2 — Implement three alert tiers, not one daily digest (REQUIRED)
P1 = immediate (DLL breach, kill switch, hard gate fail) — alert within seconds
P2 = intraday (subsystem disagreement > threshold, regime flip) — alert within 15 minutes
P3 = end-of-day digest (composite score trend, individual subsystem summaries)

Supported by: [FEBF / Int'l Journal Networks & Security Jan 2026 — burn-rate-driven alert governance], [FluxForce alert fatigue April 2026 — "72% of institutions don't use risk-based alert scoring; best-in-class route by severity"], [FCA DORA operational incident reporting March 2026 — P1/P2/P3 severity tiers in regulated financial ops]

Scale: REQUIRED at our scale. Daily digest alone for DLL breach is operationally dangerous for prop firm context.

### R3 — Freeze subsystem weights at equal or historically-validated values; do NOT dynamically recalibrate (REQUIRED for overfitting prevention)
If weights must differ from equal, calibrate once on out-of-sample historical data and freeze. Event-driven recalibration based on recent disagreement is a documented overfitting vector.

Supported by: [OCC/Fed/FDIC April 2026 — model risk requires independent validation; weight changes are model changes requiring same lifecycle], [MIT/Princeton via The Specification March 2026 — "same Sharpe, different beliefs; optimizer choice encodes hidden prior"], [Resonanz Capital Feb 2026 — "model risk disguised as sophistication: more degrees of freedom increases backtest overfit risk"]

Scale: REQUIRED at our scale. With 12 subsystems and limited live history, dynamic weight optimization will fit noise.

### R4 — Subsystem isolation: each writes independently; aggregator is read-only (BENEFICIAL)
The aggregator service reads from subsystem outputs but does not own them. If aggregator is down, subsystems still write independently and hard gates still fire from their own tables.

Supported by: [Meridian/JUXT April 2026 — five separate services with adapter boundaries], [Databricks MRM April 2026 — "one lineage graph, not fragmented point solutions"], [OCC/Fed April 2026 — "development, validation, deployment, monitoring, retirement are one governed chain"]

Scale: BENEFICIAL at our scale. Over-engineering to implement if it requires a full microservices rewrite, but fail-closed defaults require subsystems to operate independently of aggregator.

### R5 — Cross-subsystem disagreement: expose as a named metric, not just a warning (BENEFICIAL)
Surface disagreement index (max pairwise delta between subsystem scores) as a first-class metric alongside the composite. When MC-survival says PASS but black-swan stress test says FAIL, the disagreement itself is a signal worth surfacing.

Supported by: [Millennium/Citadel pod risk May 2026 — multiple VaR models run in parallel to surface disagreement], [BMA clawRxiv April 2026 — 35% dispersion across accepted models is itself load-bearing information], [MIT/Princeton disagreement as hidden prior March 2026]

Scale: BENEFICIAL at our scale. Low implementation cost; high diagnostic value.

### R6 — Do NOT claim "vacation-proof" on Topstep funded accounts (REQUIRED for compliance)
Topstep explicitly does not allow fully automated "set and forget" on funded accounts. The operator must maintain documented human oversight even if passive (reviewing end-of-day digest counts).

Supported by: [propfirmplus.com April 2026 — Topstep does not allow fully automated strategies on funded accounts], [MFFU July 2025 policy — algo trading permitted but strategies must comply with CME guidelines], [Apex 4.0 funded account policy — active management required]

Scale: REQUIRED. Violating this terminates funded accounts.

---

## Claim 7 — Documented failure modes and institutional mitigations

| Failure mode | Institutional analog | 2026 documented mitigation |
|---|---|---|
| Goodhart's Law on composite (operators optimize to score, not to actual risk) | LTCM: VaR was the composite; positions were sized to make VaR look good, not to be actually safe. Two Sigma SEC action 2025: model manipulation. | Hard gates remain independent of composite. Composite is dashboard only. Subsystem weights frozen and not operator-adjustable. |
| Single aggregator SPoF | Any centralized risk bus going down during a flash crash | Fail-closed default: if aggregator unavailable, hard gates go to HALT mode. Subsystems write to own tables independently. |
| Cascade stale data (subsystem N reads stale output from subsystem M) | 2008: CDO-squared relied on CDO ratings from same stale model | Subsystems read market data directly, not each other's outputs. Aggregator is the only cross-reader. Timestamps + staleness checks mandatory. |
| Composite uninformative when subsystems return null | Any scoring system with missing inputs defaulting to average | Null-fill policy: missing subsystem score = worst-case (0), not interpolated average. Composite degrades gracefully downward. |
| Weight overfitting to historical disagreement | Barra/Axioma factor models recalibrated to recent factor returns, then failing when factor regime shifts | Weights are frozen at deploy; recalibration requires a full out-of-sample validation cycle and explicit version bump. Never auto-calibrate. |
