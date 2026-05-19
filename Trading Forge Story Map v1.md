# Trading Forge Story Map v1

**Companion document to:** `Trading Forge System Map v2.md`
**Created:** 2026-05-05
**Purpose:** A living-organism view of Trading Forge. The System Map describes WHAT each subsystem does. The Story Map describes HOW they breathe together as one family.

Read the System Map when you want to find a file or a contract.
Read the Story Map when you want to feel whether the system is alive and healthy.

---

## What Trading Forge actually is

A self-defending, self-validating, self-critiquing futures strategy research lab that runs 24/7 with safety sentinels watching every external dependency. It scouts the internet for ideas, synthesizes them into structured strategies, runs them through 10+ independent evaluators, watches them in paper for a month, canaries them through 5 live sessions on 1 contract, and only THEN lets the operator deploy real size — and even after deployment, it's still watching for decline, drift, regime shifts, prop firm bans, and exchange halts.

The mission is concrete: **find one strategy that clears $10,000/month net on a single 50K prop-firm account.** Everything in this organism exists to serve that mission.

---

## The heartbeat — 24 hours in the life

### 4:00 AM ET — the system wakes
The scouts open their eyes first. Five of them, each watching a different corner of the internet. Parallel.ai is reading deep-research papers (5K). Tavily is harvesting quant blogs (5L). Brave is scanning overnight news (5M). Supadata is pulling YouTube transcripts (5O). 5J is the unified search router for general queries.

Each one returns to the same place: `POST /api/agent/scout-ideas`, dropping its findings into `system_journal` with a `signal_type` tag (`strategy_candidate` | `market_news_intel` | `research_find`). They don't talk to each other. They don't need to. The journal is the meeting place.

### 4:30 AM ET — the synthesizer rises
`drainScoutedIdeas()` wakes up. It walks through everything tagged `'strategy_candidate'`. For each one, it talks to the **strategy_proposer** LLM — a model with KB cards loaded into its system prompt: indicator catalog, regime taxonomy, prop-firm rules, anti-pattern catalog. The synthesizer turns scout noise into structured StrategyDSL JSON.

### 4:35 AM ET — the immune system kicks in
Before new strategy gets compute time, three guards check it:
- **DSL diversity (C9)** — "have I seen this exact strategy template before? Mode collapse?"
- **Pre-flight quantum cache** — "did a similar strategy hash already fail UCI breach in a prior run?"
- **dsl_quality_critic LLM** — final schema-and-quality check before compute

Reject any → strategy goes back to drain queue. No compute wasted.

### 4:40 AM ET — the metabolism
Strategy passes. Backtester wakes up. Polars loads MES/MNQ/MCL ratio-adjusted parquet from S3, vectorbt runs the strategy across years of bars. The backtest produces:
- Trade ledger
- Equity curve
- Information Ratio (A13)
- Determinism hash (A1)
- Provenance hash (A2)
- Signal vector compressed (A7)
- MRP per-regime Sharpe (B10)

**As the backtest finishes, the body sends out hormones — fire-and-forget messages:**
- A7 persists the signal vector for future correlation checks
- A14 enqueues black swan evaluation against the synthetic regime bank
- B10 computes minimum regime performance
- SQA optimizer takes the parameters into quantum-annealing search
- Critic optimizer queues an evidence assembly
- Quantum MC submits to IBM Heron QPU (if cloud enabled)

These don't block. The strategy moves on. The hormones do their work in the background, each one persisting a "pending" row that the stale-sweeper finalizes if anything stalls.

### 5:00 AM ET — the lifecycle service makes its calls
Every six hours, lifecycle service walks through CANDIDATE → TESTING → PAPER → DEPLOY_READY decisions. At each transition it asks specific questions of specific organs:

- **CANDIDATE → TESTING**: forgeScore ≥ 50, tier 1/2/3, backtest + WF complete (auto)
- **TESTING → PAPER**: MC survival > 70%, **Frankenstein passed** (A4 hard gate), prop compliance ≥ 1 firm, adversarial stress shadow logged
- **PAPER → DEPLOY_READY**: 30+ days paper, rolling Sharpe ≥ 1.5, **signal correlation < 0.85** vs DEPLOYED (A7 hard gate), multi-firm eligibility computed (B5), MRP advisory (B10), black swan advisory (A14), survival probability noted (B14)

Each YES or NO is logged. Audit row + lifecycle_transitions row written in the same transaction. SSE broadcasts to the dashboard so the operator SEES it happen.

### Throughout the day — the safety nervous system
While strategies move through lifecycle, the safety sentinels never sleep:

- **C1** polls CME Globex every 60 seconds — if the exchange halts, paper engine STOPS opening positions; existing ones held
- **C2** polls 8 prop firm APIs every 15 minutes — if Apex suspends or MFFU shows VPN-detection, NEW entries blocked for that firm only
- **C11** keeps the macro HMM updated — if `crisis_prob > 0.60` or `ISM<49 AND RRP<$20B`, ES/NQ/MES/MNQ longs blocked entirely
- **C8** runs at 8 AM ET — if a Windows reboot is pending, the WHOLE pipeline pauses (failed CLOSED)
- **C7** monitors validation cadence — if the dashboard panel goes RED, the operator gets a forcing function to validate live

The body protects itself.

### Evening — the consolidation phase
Paper trades close at 4:15 PM ET. Trade outcomes flow into B12 closed feedback loops. Strategy memory updates with what worked and what didn't. The audit_log grows. lifecycle_transitions records every state change.

### 3:00 AM ET (next day) — the dreaming
While the operator sleeps, the deep critics work:
- **9A nightly self-critique** reads the entire system journal. Looks for patterns — failure modes the day's strategies shared, anti-patterns to add to the KB, themes worth promoting in tomorrow's synthesizer prompt
- **A8 data integrity findings** runs reconciliation
- **synthetic-regime-refresh** samples fresh black swan regimes
- **synthetic-tsgen-train** (Sunday only) retrains the A14 VAE on the week's data
- **DeepAR train + predict** generates regime forecasts (currently shadow at weight=0)
- **C11 macro ingestion** pulls fresh FRED + H.4.1 data
- **B14 monthly priors refit** updates Bayesian priors per firm based on 90 days of health-check observations

By 4 AM the body wakes up smarter than it went to sleep. The cycle begins again.

---

## The family — who feeds whom

Picture concentric rings of nourishment:

**Center: the strategy candidates** — the things you actually want to deploy.

**First ring: the gates that filter them**
C9 (mode collapse), A4 (overfit), A7 (signal duplication), C11 (macro), B5 (firm fit), B10 (regime fragility), A14 (black swan), B14 (firm survival).

Each one is a different sense — sight, smell, taste, touch, hearing. The system perceives strategy weakness from different angles.

**Second ring: the data substrate**
system_journal, lifecycle_transitions, audit_log, backtest_provenance, strategy_signal_vectors, prop_firm_health_checks.

Every gate decision writes evidence. Every transition is replayable.

**Third ring: the safety sentinels**
C1, C2, C3, C4, C6, C7, C8, C11.

These don't filter strategies. They protect the OPERATOR. They make sure when a strategy IS deployed, real-world events don't blow it up.

**Fourth ring: the feedback machinery**
9A self-critique, B12 closed loop, strategy memory, A11 shadow re-run, 11A critic optimization, 7A auto-evolution.

These take outcomes and route them back to upstream KB cards, prompts, archetype banks. The system learns its own mistakes.

**Outer ring: the human (the operator)**
Promotes DEPLOY_READY → PILOT. Reads the dashboard to validate cadence. Authorizes live trading on Topstep.

The strategy candidate at the center is fed by all these layers. When it survives the journey, it has been examined by ~10 independent evaluators, watched by ~6 sentinels, and held to evidence-backed gates at every transition. That's not a stack. That's an organism.

---

## The defenses — failure modes the organism survives

| Failure mode | Defense layer |
|---|---|
| Strategy is overfit | C9 + A4 + A7 + Grover (4 overfit detectors at different stages) |
| Backtest data is wrong | A1 determinism + A2 provenance + A8 reconciliation |
| Strategy works in backtest, fails live | A14 black swan + B10 MRP + 30-day paper period + B8 PILOT canary (5 sessions, 1 contract) |
| Prop firm bans the operator | B14 survival twin + B5 multi-firm eligibility + compliance drift detection |
| Market halts mid-trade | C1 CME outage + C4 network failover + paper-execution-service halt gates |
| Macro regime rotation | C11 hard gates + bias engine + skip engine |
| LLM hallucinates a strategy | dsl_quality_critic + DSL strict schema + sandbox checker |
| LLM gets prompt-injected | C3 input sanitizer + output validator + Python AST sandbox |
| Pipeline silently breaks | A8 data integrity + audit_log + drift detector + SSE health channels |
| Strategy decays in production | Rolling Sharpe monitor + DECLINING auto-transition + B4 regen + GRAVEYARD |
| Operator's machine reboots mid-trade | C8 Windows update protection (8 AM ET pre-market check, fail-closed) |
| Operator's internet dies | C4 network failover + Railway emergency compute |
| Credentials get compromised | C6 Bitwarden vault + 90-day rotation + fail-closed on vault unreachable |
| Operator gets distracted from validation | C7 RED panel forcing function + AGENTS.md infra-block rule |

Every realistic failure mode has a defense. Most have multiple.

---

## Grooming rituals — keeping the organism healthy

A living system needs care. Not heroic interventions — small, consistent rituals.

### Daily (5 minutes, before market open)
- Check the **Validation Cadence panel** on the dashboard. Is it GREEN?
- Check the **ScoutHealthCard** tile. Are scouts firing? When was the last strategy created?
- Check the pipeline pause state — paused intentionally or accidentally?
- Glance at overnight n8n execution count. Roughly normal? No mass failures?
- Skim the latest 3-5 system_journal entries. Anything weird?

### Weekly (30 minutes, Sunday morning)
- Run `npm run audit:n8n` — drift detector must exit 0
- Run `npm run system-map:check` — must exit 0
- Read the past week's 9A nightly self-critique outputs. Any recurring failure patterns?
- Check lifecycle distribution: how many strategies in each state? Is the funnel flowing?
- Review safety probe firings (C1/C2/C8 alerts). Anything blocked unintentionally?
- Skim API budget burn — GPT-5-mini tokens, IBM QPU seconds, Brave/Tavily/Parallel calls. Any anomalies?
- Check for stale-pending rows piling up in the 18 pending-row tables. Sweeper still working?

### Monthly (2-3 hours, 1st of month)
- **Run the W7b graduation query** for each Phase 0 advisory subsystem (A14, B14, A4, A7, Grover, A+ Market Auditor, DeepAR, quantum_mc). Either graduate to Phase 1 hard gate OR delete.
- B14 monthly priors refit — auto cron at 4 AM ET 1st of month, but verify it ran successfully
- Compliance ruleset drift review — are any firm rules stale? Any new payout policy changes?
- C7 validation cadence honest review — did the operator validate live this month?
- n8n execution success rate per workflow — anything below 80%? Investigate.
- Audit code review of significant changes from the past month

### Quarterly (4-6 hours, 1st of quarter)
- **Audit pass** like the one done 2026-05-05 (see TRADING-FORGE-BLUEPRINT.md). Identify new redundancies, dead weight, naming drift.
- Subsystem retirement review — anything that didn't graduate Phase 0 in the last quarter?
- Cost review — cloud quantum spend, API spend, Railway compute. Trending up unexpectedly?
- Benchmark check — are DEPLOYED strategies still hitting their gates?
- Hardware health check — Skytech tower fans, drive space, RAM utilization, GPU thermal

---

## Signs of health vs unhealth

### Healthy organism (green vital signs)
- Strategies flow through CANDIDATE → TESTING → PAPER → DEPLOY_READY → PILOT regularly
- New scout signals arrive daily
- Weekly new strategy candidates passing diversity check
- Monthly Phase 0 graduations or considered retirements
- Quarterly subsystem retirements
- Validation Cadence panel stays GREEN
- Drift detector exits 0
- audit_log gaps = 0
- DEPLOYED strategy rolling Sharpe ≥ 1.0
- API budgets utilized but not exhausted

### Unhealthy organism (red flags)
- Validation Cadence panel goes RED — the operator hasn't validated live in N days
- Stale-pending rows climbing — the sweeper is broken or downstream stalled
- Drift detector exits non-zero — config has drifted from contracts
- Same n8n workflow fails 3+ times in a row — something upstream broke
- audit_log gaps detected by A8 — transactions failing silently
- Phase 0 advisory subsystems perpetually never graduating — research debt accumulating
- Strategies pile up in CANDIDATE without progressing — gate too tight or upstream broken
- DEPLOYED count = 0 for 30+ days — pipeline producing no winners (tighten gates OR investigate why)
- Token budgets exhausted before noon — runaway LLM use somewhere

When you see a red flag, **don't add a new subsystem to "fix it."** Diagnose the existing organ. The organism is already designed to handle every realistic failure. If it's not handling something, an existing organ is broken — find which.

---

## The grooming philosophy

Three rules:

1. **Every Phase 0 has an expiry date.** Day 60 graduation is mandatory. Phase 0 perpetual is research debt. Either the evidence shows the gate would improve outcomes (graduate to Phase 1) or it doesn't (delete the gate).

2. **Every "I should add X" thought is suspect.** Before adding, ask: which existing organ is supposed to handle this? Why isn't it? Most "missing features" are misdiagnosed broken integrations.

3. **The forcing function is the operator validating live.** Every quarter without a real PILOT canary is a quarter of accumulating research debt. The C7 panel exists because this organism's primary failure mode is its operator drifting away from live validation into endless infrastructure.

---

## The mission, restated

This organism exists to find ONE strategy that clears $10K/month net on a single 50K prop account. Every gate, every sentinel, every feedback loop, every grooming ritual serves that single purpose.

When the organism produces that strategy and the operator deploys it on Topstep — that's the moment the system has fulfilled its design intent. Everything else is in service of that moment.

Until then: groom, validate, harvest evidence, graduate Phase 0 advisories, and resist the pull to add more layers. The body is built. Tend it.
