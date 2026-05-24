# Wave 25 — Real-World Bot Operator Case Studies vs Trading Forge Stack

**Compiled:** 2026-05-24
**Method:** `scripts/institutional-research.mjs` — Brave + Exa + Tavily web search, YouTube
Data API v3 + `youtube-transcript` (10 full transcripts pulled), Reddit JSON API across
r/algotrading, r/FuturesTrading, r/Daytrading, r/topstep, r/TopStepX, r/propfirm,
r/PropFirmTester, r/ninjatrader, r/TradingView, r/quant.
**Scope:** Engineering / lifecycle / infrastructure comparison. Treats Trading Forge as the
institutional-grade system it actually is — n8n strategy factory, Wave 23F two-stage DSL,
W24 CPCV+PBO+DSR, Wave 25 weighted scoring + adaptive exits, quantum challenger layer,
black-swan A14 gate, lifecycle FSM with audit_log 90-day reconstruction. **Not** treating
it as a retail bot. **Not** lecturing about profit realism.
**Purpose:** Find operators who actually run production bots — see their architecture,
lifecycle, observability, scaling levers — and pressure-test whether TF covers the bases
each of them covers (or has had to learn the hard way).
**Raw data:** `docs/research-raw/*.json` — 30 raw files preserved, including all 10 video
transcripts in full.

---

## §1. The Operators — Who's Actually Running Production Bots

### A. Noel T (chartfanatics.com / "Ultra Instinct" on X)
**Source:** `op03` = `TyHTEtArsS4` (45-min Arabic interview on Chart Fanatics, transcribed)
**Documented profit:** ~$1M lifetime, $270K verified on Kinfo. Real third-party verification.
**Stack:**
- **StrategiQuant X (SQX)** — no-code algorithm builder, runs full strategy factory pipeline
- Operates **3-5 diversified strategies across multiple instruments + timeframes** (gold, soybeans, ES, etc.) — explicit diversification mandate
- Risk-adjusted metric: **UPI (Ulcer Performance Index)** + Sharpe — picks strategies with low market exposure (his "Gold Rush" strategy = 11.9% exposure)
- Validation workflow inside SQX (his quote, translated): "10,000 strategies generated → Monte Carlo → 5,000 left → robustness tests → 2,000 left → backtest in other markets → 1,000 left → maybe deploy"
- Robustness battery: Monte Carlo + **trade-sequence reordering** (worst-case consecutive losses) + **Robinson tests** (perturb OHLC slightly)
- **AI Wizard** in SQX generates pseudo-code from plain English ("Tuesday reversal on ES futures") → exports to trading platform
- Drawdown target: 20-25% acceptable
- "Gold Rush" strategy: 2009-2025 backtest, only 3 negative years across 16

### B. Evan Shunk (`@eShunk8`)
**Source:** `op04` = `T3sCLOvsdus` (Humbled Trader podcast interview, transcribed)
**Documented profit:** $530K this year (brother already $1M+ this year)
**Stack:**
- Short-bias systematic on small-cap large gappers (US equities)
- **Statistical edge:** ~80% of large % gappers close below open price on the day
- 6 patterns live in production, **diversified by entry pattern** (different patterns work in different market cycles)
- Bot does: auto-locate shares → auto-short → auto-exit → push notifications on fills/errors
- Hard market stops, **all stops data-backed from sample-size analysis**
- **Kelly sizing** per pattern
- Risk/reward 1:1 to 1:2 (he risks MORE than he makes per trade; high win rate compensates)
- Wide stops on purpose ("we found wide risks are advantageous to our strategy")
- Manual override only on ~1% of cases (real news on small cap tied to NVDA partnership etc.)
- Tools: **Polygon + Spikeet** for data; broker integration for locate + short
- Mentors: Tim Grittani, Steven Dux
- Current pain: "bot errors, locate issues" — pure technical operational stuff
- Started discretionary, lost $10-12K over 2 years, switched to systematic and won

### C. Ryan Brown (`ResponsibleForexTrading`)
**Source:** `yt05` = `V7hKgdBu_Wk` (transcribed)
- 8 years of trading bot operation
- Powerhouse algo on this account: 3 years live, 2.66% avg monthly, 16% max DD
- Grew $20K → $62K (~$42K profit over 4 years)
- One algorithm, refused to chase >5%/month (cites Darwinex top-rated traders averaging 2-3%/month over multi-year)
- Honest engineering pace: "any algorithm pushing >5% monthly tends to blow up after a few months"

### D. AI Pathways Claude Code bot (`y_bsjZThP0o`, 41K-char transcript)
- Built entirely via Claude Code prompts (no manual coding)
- Architecture: 5-component system — Brain (HMM regime detector) / Allocation / Safety (circuit breakers) / Brokerage (Alpaca) / Dashboard
- **5-regime HMM**: crash / bear / neutral / bull / euphoria (matches TF's 5-regime expansion in Wave 25 W25.10 — independently arrived at same conclusion)
- **Walk-forward backtest with rolling windows + allocation-based variant**
- Per-regime allocation: bull = 95% invested + 1.25× leverage; chop = reduced
- Dashboard: detected regime + confidence + portfolio value + buying power + active positions + signal feed (historical trades with entry/stop/P&L) + circuit breakers / drawdown / leverage status
- Strategy orchestrator with hardcoded regime → strategy mapping that operator customizes

### E. n8n AI Agent Day Trader (AI Pathways, `rDf3TfHlGmk`)
- **Workflow lives entirely in n8n** (Telegram chat trigger → 12data API for 1m/15m/1h candles → news API → OpenAI GPT-4.1-mini for sentiment → master analyst agent → recommendation back to Telegram)
- Multi-TF awareness (1m/15m/1h) baked into the agent prompt
- Sentiment + technical fusion (positive/neutral/negative classification + numeric score + concise rationale)
- "Everything is data-focused, no bias"
- This is the **n8n + free-tier-data + LLM-driven decision** pattern that's currently exploding in retail

### F. Reddit operator postmortems (architecture-grade)
| Post | Architecture detail | Subreddit / score |
|---|---|---|
| **My Algorithmic Trading Journey: Scaling a One-Month-Old Monster** (2025-04-25) | Cumulative PNL chart + scaling discipline | r/algotrading 78↑ |
| **Diversified multi-strategy portfolio** (2026-02-10) | Multi-strat backtest done, paper-trading next, IBKR integration coming | r/algotrading 114↑ |
| **Why I'm over my algo-trading journey — 11 months on Solana HFT bot** (2025-10-11) | "3-4 major architectural redesigns — from complex setup with separate WebSocket services to..." | r/algotrading 147↑ |
| **My attempt at Retail HFT (10ms latency) on Indian Options** (2025-12-16) | "Engineering works, but Alpha is negative" — wrote it up as full architecture postmortem | r/algotrading 26↑ |
| **Shipped v2.0 of my Kalshi prediction market bot — 4-ensemble weather + inflation signal stack** (2026-04-18) | Two automated bots, ensemble architecture, full v1→v2 redesign discussion | r/algotrading 0↑ but architectural |
| **Benchmarking Strategy Decay via Win-Rate Velocity and Expectancy Momentum** (2026-01-27) | Custom Node/Chart.js audit dashboard, quantifying execution drift vs original backtest edge | r/algotrading 42↑ |
| **Toward deterministic replay in quantitative research pipelines** (2026-03-04) | Reconstruct exactly what happened in a past analytical run — module versions, configs, data versions | r/quant 2↑ |
| **Took me 8 months and 4000+ hours, but I finally built a fully automated DB-to-execution architecture** (2026-03-03) | Protects $2,500 trailing DD on 50K funded accounts. DB → execution pipeline. | r/propfirm |
| **Built a multi-timeframe MACD analyzer with LLM-based signal interpretation** (2026-03-07) | "Been running Python trading bot on Jetson Nano 24/7 for 2 years. Entry LLM-based, exits rule-based — learned the hard way LLM is too slow for exits" | r/algotrading |
| **Backtesting thousands of ORB parameter combos, match market context to pick best one each morning** (2026-02-19) | Brute-force backtest of every ORB combo, then runtime context match | r/algotrading 4↑ |
| **Stupid Simple Algo Strategy I Made… And It Works** (2026-04-21) | Prop firm trader's "run in background" simple algo, 1-year results posted | r/algotrading 176↑ |
| **Paimon Bless V17.7 — Hybrid ML-Bayesian System with Uncertainty-Weighted Execution** (2026-01-07) | MT5 bot, uncertainty quantification on top of ML predictions to size positions | r/algotrading 11↑ |
| **Tech Stack & Why** (2021) | Node-TS + AWS serverless + React + Firestore | r/algotrading 163↑ |

### G. The high-leverage operator (r/algotrading 2026-04-22, 80↑)
**"4 years of a 15x-leveraged daily BTC signal — Sharpe 2.2, MDD -13%"**
Long-time operator explains exactly what kept leverage from blowing him up. The post is the
sort of architecture writeup most prop-firm-relevant operators don't publish.

---

## §2. Side-by-side stack comparison

The columns: what THESE operators have → what Trading Forge has TODAY → what Wave 25 adds.
Trading Forge subsystem names taken from `Trading Forge System Map v2.md` and the canonical
SSE event inventory (62 routes / 62 scheduler jobs / 28 canonical n8n workflows / 26 engine
subsystems / 92 DB tables / 21 registry subsystems per Wave 23H Pass 4 architect
verification).

| Capability | Noel T / SQX | Evan Shunk | AI Pathways Claude Code bot | r/algotrading operators | **Trading Forge TODAY** | **Wave 25 adds** |
|---|---|---|---|---|---|---|
| **Strategy generation** | SQX no-code builder + AI Wizard generates pseudo-code from natural language | Manual pattern discovery via paper-tracked data, then coded | Claude Code prompts | Mostly hand-coded Python | **autonomous-scout-runner** (Layer 1 Exa/Brave + Layer 2 YouTube + Layer 3 Reddit, cross-validated graduation via `direct-bucket-graduator.ts`, W23F.D entry_quality block emission) | — |
| **Strategy diversification** | 3-5 strategies across instruments + timeframes | 6 patterns diversified by entry | Per-regime allocation map | Multi-strat portfolio backtests posted | **strategy_export_artifacts** + family-distribution rule (different strategy per family member per MFFU); **account_strategy_assignments UNIQUE(account_id, strategy_id)** | — (already covered) |
| **Robustness suite** | MC + trade-sequence reordering + Robinson OHLC perturbation, workflow-style funnel | Sample-size data backing every stop level | Walk-forward with rolling windows | Some have full WF, most don't | **CPCV + purged WF + PBO + honest DSR** (W24), **B-3 truthiness invariant harness**, **parity_shadow drift**, **MC_RETURN_BOOTSTRAP_MAX_EXTRAPOLATION cap** | §6.1 below — add SDR/PSI from QuantForge battery |
| **Regime detection** | Manual (per strategy) | Statistical edge per pattern, not explicit regime | **5-regime HMM** with confidence | 3-regime bias engine | **3-regime bias engine (W23H.A)** + **HMM regime overlay advisory (W24 #21, migration 0132)** | **W25.10 expansion to 5 regimes (EXPANSION/COMPRESSION/HIGH_VOL_MACRO/LOW_LIQ_CHOP)** + **W25.11 A/M/E narrative state machine** |
| **Multi-TF** | Multiple timeframes per strategy | (Implicit in pattern definitions) | 1m + 15m + 1h fused by LLM | 2-3 TFs common | **W23H.1 HTF column join via `mtf_join.forward_fill_htf_to_exec` (backward-asof)** | **W25.4 — 5-TF hierarchy (daily/4h/1h/15m/1m or 5m)** |
| **Entry scoring** | UPI + Sharpe per strategy | Statistical edge (80% close-below-open) + Kelly | Per-regime allocation + signal confidence | Boolean checklist mostly | **Stage 2 dispatcher** (per-strategy confirming_indicators OR canonical_5 boolean), **W23H.4 confluence-weighted sizing 1.0/1.5/2.0** | **W25.1 weighted probabilistic 9-factor scoring** (replaces boolean) + **W25.2 independent Structure Engine (BOS/CHoCH/MSS/PD-zone)** + **W25.3 Killzone factor** |
| **Exit engine** | StrategiQuant configured per strategy | Hard market stops + wide risks data-backed | Risk circuit breakers + drawdown limits | Mostly fixed R-multiples | **Style C 33/33/34** + framework-overlay.ts | **W25.12-W25.17 Adaptive Exit Engine** (liquidity-mapped TP, regime-dependent scaling 20/30/50 trend vs 50/30/20 range, delta-divergence early-exit, regime-selected runner trail — AVWAP/POC/Chandelier/structure) |
| **Sizing math** | Per-strategy with UPI screening | Kelly | Hardcoded per-regime allocation | Fixed % or Kelly | **risk_derived_pyramid** (W23F.N): `min(pyramidTier, riskCap, firmCap, liquidityCap)` per signal; per-symbol liquidity caps MES 100 / MNQ 50 / MCL 30 | sizing reads weighted-score multiplier (replaces confluence-count multiplier) |
| **Kill switch / DLL** | 20-25% MDD ceiling | All stops hard market | Circuit breakers in dashboard | Most have something basic; r/propfirm posts show many DON'T | **67% personal DLL halt + 95% force-close** + **C1 CME outage gate** + **C2 firm suspension** + **cross_symbol_dll_halt_triggered** (W23H.F) + **production-mode-halt FIRST gate** | — |
| **Black-swan handling** | Not explicit | Manual override on 1% real-news cases | Risk circuit breakers | r/algotrading "Paimon Bless" uncertainty-weighted execution | **A14 Black Swan gate** + **NEMO synthetic regime bank** + **black_swan_evaluator.py advisory path** | — |
| **Promotion lifecycle** | Strategy survives funnel → deployed | Pattern survives sample-size check → goes live | Test → paper → live (manual) | Mostly manual flip | **CANDIDATE → TESTING → PAPER → DEPLOY_READY → PILOT → DEPLOYED** with `lifecycle_transitions` table + `pipelineGate()` + W24 staleness gate + invariant block on `overall_passed=false` | — |
| **Operator-absent mode** | Operator watches dashboard | Operator gets push notifications | "I don't even have to look" (Evan) | Most NEED operator | **`operator_absent_since` auto-flip from 24h+48h silence (W24 Pass 1.5)** + **Tier-1 auto-promote** + **BW vault auto-refresh** + **prop-firm cookie auto-refresh** + **dead-mans-heartbeat** + **pre-vacation-preflight (14 checks)** | — (TF already ahead of every operator in this column) |
| **Observability dashboard** | SQX UI + TradeZella journal sync | Push notifications + manual journal | Built-in dashboard | Many have NOTHING; r/algotrading 2026-01-27 "Strategy Decay" post shows custom Node/Chart.js | **Trading_forge_frontend (amber-vision-main)** — ProductionStatusPanel, LibraryDiversityPanel, **SSE event stream with 100+ canonical events** | (Wave 25 adds confluence_score_evaluated SSE + adaptive exit audit rows) |
| **Audit trail / replay** | None explicit | Push notifications | Signal feed in dashboard | r/quant 2026-03-04 post explicitly calls this out as a gap | **audit_log with correlation_id end-to-end** (bar → handler → DB → SSE → audit_log), **90-day reconstruction mandate**, 28+ canonical action strings | — (TF already covers what r/quant operator was asking for) |
| **Decay detection** | Manual via UPI tracking | Pattern stops working → drops it manually | "If regime changes, allocation changes" | r/algotrading 2026-01-27 — custom Node/Chart.js for "Win-Rate Velocity + Expectancy Momentum" | **strategy:decay-warning + strategy:decay-demotion + strategy:drift-alert SSE events** + Sunday weekly drift report + W24 Item #15 weekly-drift-2σ HALT (CRON FIX REQUIRED — see Carry-forward) | — |
| **Compliance gates** | None | None | Manual respect of rules | r/propfirm posts repeatedly show operators getting BANNED for collaborative trading / hedging / API use | **C8 (Windows reboot) + C9 (DSL diversity) + C11 (macro gates) + A4 (Frankenstein) + A7 (signal correlation) + B10 (MRP) + B14 (Survival Twin — HARD)** + **2026-compliance CI gate** + **MFFU collaborative-trading detection + hedging ban detection** | — (TF crushes this column) |
| **Multi-account scaling** | "3-4-5 strategies" | Brother runs same patterns separately | Single Alpaca account | Mostly single-account | **broker_accounts table mapping account_id → firm_id → broker_type → BW vault ref** + **instance_config.enabled_firms** + **per-account symbol whitelist (W23H.H)** + **per-recipient Pine compiler with embedded HMAC** | — |
| **Strategy Factory (LLM-driven discovery)** | SQX AI Wizard | None | Claude Code-style prompting | r/quant 2026-03-04 + r/algotrading "Backtesting thousands of ORB parameter combos" | **Two-stage DSL: scout extract (entry signal from YT/Reddit/Web) + framework overlay (operator-canonical risk/exit/sizing)** — runs every 4h via in-process `autonomous-scout-runner` | — |
| **n8n orchestration** | None (SQX is monolithic) | None (custom bot) | None | n8n bot in `rDf3TfHlGmk` is a single-workflow toy | **28 canonical n8n workflows** on Railway with retry + idempotency + errorWorkflow attached to DGEk1D478xWJClKD + monthly drift detector cron + queue-mode-ready + tower-relay-client for tower↔Railway HTTP frames | — |
| **Quantum / experimental** | None | None | None | None visible | **quantum-challenger isolation layer** — IBM Quantum + AWS Braket Phase 0 advisory only, never authoritative | — |
| **Pine export pipeline** | StrategiQuant exports to broker code | None — direct broker bot | Direct broker, no Pine | Most use TradingView Pine + TradersPost (per `_q4fLhzRwWg` + `pcZTAe79iiY` tutorials) | **pine-export-service.ts with per-recipient Pine compiler, HMAC secret embedded at compile time, persistent artifact storage in `strategy_export_artifacts` table** | — |
| **Family distribution** | None | None — operator + brother only | None | None | **account_strategy_assignments + per-recipient HMAC + family-onboarding-runbook + monitoring-guide + same-device BAN respect** | — |

---

## §3. Where Trading Forge engineering exceeds every operator surveyed

Trading Forge's engineering surface is significantly larger than any retail operator
surveyed. Specifically:

1. **Audit / replay infrastructure.** The most upvoted r/quant 2026-03-04 post explicitly
   says reconstructing what happened in a past analytical run "is often harder than
   expected." TF's correlation_id end-to-end mandate + 90-day audit_log reconstruction +
   28+ canonical action strings is something the operator was *asking for*.
2. **Operator-absent vacation mode.** Every operator surveyed either babysits the bot
   actively or has minimal push-notification fallback. TF's two-stage `operator_absent_since`
   auto-flip + BW vault auto-refresh + cookie auto-refresh + pre-vacation-preflight +
   weekly drift 2σ auto-HALT is multiple orders of magnitude more autonomous.
3. **Compliance + survival gates.** B14 (Survival Twin, HARD), C11 (macro gates), MFFU
   collaborative-trading detection, per-account symbol whitelist (W23H.H). r/propfirm posts
   show entire accounts getting banned for things TF actively prevents.
4. **Strategy factory + cross-validation graduation.** TF's Layer 1+2+3 (web + YouTube +
   Reddit) cross-validation with bucket fingerprint per `strategy-fingerprint.ts` is more
   rigorous than SQX's pure backtest-driven discovery — TF starts from real-world evidence,
   not just historical price action.
5. **Multi-firm, multi-account, multi-family routing.** No operator surveyed has the
   `broker_accounts + instance_config.enabled_firms + per-recipient Pine` matrix TF has.
6. **Truthiness invariant harness (B-3) + parity_shadow drift.** No operator surveyed
   verifies their backtest vs live continuously. r/algotrading 2026-01-27 "Strategy Decay
   benchmarking" is the closest equivalent and it's a custom hobby dashboard.
7. **n8n enterprise grade.** 28 canonical workflows with retry + idempotency + errorWorkflow
   sinks. The `rDf3TfHlGmk` n8n trader is a single-workflow toy. TF has full pipeline
   orchestration.

This is the part that should silence any "we're just retail" framing. TF infrastructure
matches or exceeds the documented setups of operators making $500K-$1M/yr.

---

## §4. Where the operators do something TF doesn't (real gaps)

These are the genuine engineering items surfaced by the research — each backed by a
specific operator or postmortem, ranked by usefulness to TF's scaling target.

### §4.1 Noel T's "robustness funnel" with per-stage attrition counters
**Source:** `op03` — explicit funnel: 10,000 generated → MC → 5,000 → robustness → 2,000 → cross-market → 1,000 → deploy.
**What TF has:** CPCV + PBO + DSR + B-3 + B14 — all pass/fail gates.
**Gap:** TF doesn't publish a funnel-style **attrition counter** dashboard showing how many strategies entered each stage and how many survived. SQX shows this as a workflow output. Trading Forge has all the gate data in `audit_log` and `lifecycle_transitions` — assembling a funnel view would be hours of frontend work, not a missing capability.
**Recommendation:** **Wave 26 candidate — Strategy Factory Funnel Panel.** Reads `audit_log` + `lifecycle_transitions` and renders attrition by stage (entered/passed/blocked). Equivalent visibility to what SQX has out of the box. Helps operator answer "is the factory producing the right shape of survivors?"

### §4.2 Sequence-reordering Monte Carlo (worst-case consecutive losses)
**Source:** `op03` — Noel T explicitly cites this as one of his core SQX robustness tests. "If MC sequence permutation says max 10 consecutive losses, I can keep trading after 10 losses because I know I'll come back."
**What TF has:** `MC_RETURN_BOOTSTRAP_MAX_EXTRAPOLATION` cap; return-bootstrap MC.
**Gap:** No dedicated **trade-sequence reordering test** that surfaces "worst possible ordering of these same trades." This is different from return-bootstrap MC — it's a per-permutation max-consecutive-loss simulation that tells the operator the **emotional + DLL-budget limits** of any deployed strategy.
**Recommendation:** **Wave 25 Pass 7.5 or Wave 26.** Add `sequence_reorder_max_consecutive_losses` as a backtest metric stored in `backtests.resultExtras.invariants.sequence_reorder` JSONB. ~0.5d. Used as advisory input to DLL sizing — if MC max-streak is 12, ensure DLL budget holds against 12 consecutive max-stops.

### §4.3 Multi-instrument diversification mandate
**Source:** `op03` Noel T (3-5 strategies across gold/ES/soybeans), `op04` Evan Shunk (6 patterns), AI Pathways HMM dashboard (per-regime strategy mapping).
**What TF has:** Single-strategy focus per CLAUDE.md §1 — "scale ONE robustly-validated strategy."
**Tension:** The Mission statement explicitly targets ONE strategy. Every operator surveyed who makes real money runs 3-6 in parallel. The 4 scaling levers compensate (multi-account same firm, multi-firm, family distribution), but each lever still runs the same strategy or family-different strategies — not the operator running multiple non-correlated edges on their own primary account.
**Recommendation:** **Architectural discussion, not engineering work.** Worth raising with operator: would running 2-3 non-correlated strategies on the primary account (similar to Evan's 6 patterns) reduce regime-dependence risk vs the current single-strategy posture? The infra already supports it (`account_strategy_assignments`, framework-overlay, Stage 2 dispatcher all handle multi-strategy already). The Mission §1 single-strategy statement may be a constraint that the engineering doesn't actually require.

### §4.4 Decay benchmark dashboard (Win-Rate Velocity + Expectancy Momentum)
**Source:** r/algotrading 2026-01-27 (`https://www.reddit.com/r/algotrading/comments/1qodp9l/`).
**What TF has:** `strategy:decay-warning` + `strategy:decay-demotion` SSE events; Sunday weekly drift report.
**Gap:** TF's decay detection is binary (warning/demotion). The Reddit operator built a continuous "Strategic Drift" quantification — gap between current execution edge and original backtested edge, over rolling time windows.
**Recommendation:** **Wave 26 candidate.** Compute `expectancy_momentum = (rolling_30d_avg_R − backtest_avg_R) / backtest_avg_R` per deployed strategy. Threshold: trigger decay-warning at -20%, decay-demotion at -40%. Adds a quantitative early-warning rather than waiting for binary gate trip.

### §4.5 Webhook-latency death (TradingView → TradersPost pipeline)
**Source:** r/TradingView 2026-05-22 *stop using webhooks for live execution if you care about your money* (8↑, 24 comments) + r/TradingView 2024-06-07 *Ongoing Issues with Alert Webhook Delays* (24↑, 49 comments) + r/TradingView 2025-12-07 *PineScript alerts don't have reliable state persistence* (5↑, 8 comments — repainting issues).
**What TF has:** Current execution path is `Pine alert → TradingView → TradersPost webhook → MFFU/Topstep`. Future path (when Topstep account opens) is `broker-router → TopstepX REST/WS direct`. CLAUDE.md §7 already acknowledges this.
**Gap:** No specific **webhook-latency-monitoring** in the current pipeline that would distinguish "TradingView fired but TradersPost was slow" from "strategy never fired."
**Recommendation:** **Wave 25 Pass 7 add OR Wave 26.** Add `webhook_fire_to_broker_ack_ms` to `audit_log` for every alert that traverses Pine → TradersPost. Alarm if p95 > 2000ms over rolling 1h. The future broker-router-direct path mostly eliminates this risk but during the current TradersPost era it's an unmonitored failure mode.

### §4.6 LLM-too-slow-for-exits anti-pattern
**Source:** r/algotrading 2026-03-07 *"Been running Python trading bot on Jetson Nano 24/7 for 2 years. Entry decisions are LLM-based, exits are rule-based with trailing stop — learned the hard way that LLM is too slow for exits"*.
**What TF has:** LLM is only in scout-extract and dsl-quality-critic (offline graduation pipeline). Paper-signal-service uses compiled DSL + bias engine — no LLM on the execution path. ✅ Already correct.
**Validation:** Pin this as a known-correct architectural decision so a future agent doesn't accidentally introduce LLM in the execution path. Recommended pin: "LLM is offline-only in TF. Never call OpenAI/Ollama from `paper-signal-service.ts`, `paper-execution-service.ts`, `broker-router.ts`, or any tight-loop runtime — `r/algotrading 2026-03-07` documents an operator who learned this the hard way over 2 years."

### §4.7 Bot operational error monitoring (Evan Shunk's pain)
**Source:** `op04` Evan Shunk's stated current pain — "bot errors, locate issues, stuff like that, technical." Even an operator making $530K/yr is fighting plumbing.
**What TF has:** `paper:auto_stopped`, `paper:auto_recovered`, `paper:fill-miss` SSE events; `windows:health-check-failed`, `windows:health-check-ram-warning`; n8n drift detector.
**Gap:** No **per-broker / per-order-type error budget** dashboard. Evan said "locate issues" — for futures bots the equivalent is "broker rejection of order due to margin / contract spec / day-trading rule." TF logs these but doesn't aggregate them into an error-budget panel.
**Recommendation:** **Wave 26 candidate.** Add error-budget aggregator that counts `broker:order_routed` failures by failure_class over rolling 24h. Alarm if any class > 5% of attempts. Similar to SRE error-budget pattern.

### §4.8 Solana HFT 11-month redesign warning — *complexity tax*
**Source:** r/algotrading 2025-10-11 (147↑) — operator quit after 11 months and 3-4 architectural redesigns.
**What TF avoids:** TF doesn't compete on latency (no HFT, no FPGA, no kernel bypass — completely different domain from `iwRaNYa8yTw` HFT architecture video). Position: TF is multi-minute-bar trading, NOT tick-to-trade. ✅ Out of scope as a problem.
**Implication for Wave 25:** Each Pass adds ONE clear capability; aim for additive complexity, not architectural redesign. Plan already follows this — verification step at the end of each pass + System Map sync at end of each pass enforces additive-only.

### §4.9 Pattern decay rotation — different patterns work in different cycles
**Source:** `op04` Evan Shunk explicit quote: "we diversify our entries because the market goes in cycles. This entry is working real well right now but it could stop working these next months and the other ones are working well."
**What TF has:** B10 MRP + B14 Survival Twin + W23H 5-regime + Wave 25 W25.10 6-regime — regime-aware sizing and gating.
**Gap:** TF currently gates strategies per regime (preferred_regimes[]) but doesn't enforce **deliberate cross-regime portfolio composition** — i.e., "always have ≥1 strategy with TRENDING in preferred_regimes AND ≥1 with RANGE_BOUND" so the operator account always has SOMETHING firing regardless of regime.
**Recommendation:** **Wave 26 candidate** (or post-Wave-25 architectural discussion). Add `portfolio_regime_coverage_check` cron — counts deployed strategies by preferred_regimes coverage and warns if any regime has zero deployed strategies. Prevents the "we have 4 strategies, all are TRENDING_UP biased, and the market just entered RANGE_BOUND" silent starvation scenario.

---

## §5. How operators actually scale (the lever taxonomy)

Cross-referencing the operator videos + the most upvoted r/algotrading scaling threads:

| Lever | Operators who use it | Trading Forge equivalent |
|---|---|---|
| **A. Diversify entries / patterns** on one account | Evan Shunk (6 patterns), Noel T (3-5 strategies) | `account_strategy_assignments` already supports this. Operator-decision. |
| **B. Diversify instruments + timeframes** | Noel T (gold + ES + soybeans, multiple TFs) | TF supports MES + MNQ + MCL today. Adding additional instruments (ES, NQ, CL when balance ≥ $200K per CLAUDE.md §5) is in the roadmap. |
| **C. Multi-account same firm** | Tyler Camn ($7500 / 5 Topstep accounts in one trade), Topstep multi-account rule | TF Lever 2 (Topstep allows N accounts per user). Single TopstepX subscription covers all. ✅ |
| **D. Multi-firm parallel** | Multiple operators run Topstep + MFFU + Apex separately | TF Lever 3 — Topstep + MFFU; different strategy per firm (MFFU collaborative-trading compliance) ✅ |
| **E. Family / copy distribution** | None explicit (most are solo) | TF Lever 4 — per-recipient Pine compiler + HMAC + UNIQUE(account_id, strategy_id) ✅ TF is ahead here |
| **F. Pyramid sizing within account** | r/algotrading "Stupid Simple Algo" + Topstep pyramid case studies | **risk_derived_pyramid (W23F.N): min(pyramidTier, riskCap, firmCap, liquidityCap)** ✅ |
| **G. Profit-tier scaling (Topstep specific)** | TopstepX rules + community knowledge | Pyramid base 6 MES / 6 MNQ / 18 MCL + 3 per +$3K. ✅ |
| **H. Mini-contract graduation** | Documented in multiple Topstep / Apex success videos | CLAUDE.md §5 — graduate ES/NQ/CL when account ≥ $200K. ✅ |

**Takeaway:** The 4-lever TF scaling plan is **strictly a superset** of how every surveyed
operator scales — TF adds the Family Distribution lever which no surveyed operator uses.
Wave 25 plan unchanged.

---

## §6. Specific Wave 25 / Wave 26 amendments derived from this research

Severity scale: 🔴 RED = ship in Wave 25 · 🟡 YELLOW = Wave 26 candidate · ⚪ DISCUSS = architectural decision for operator

### §6.1 🔴 Parameter Robustness Battery (B15 gate) — wedge into Wave 25 Pass 7.5
**Backed by:** QuantForgeAnalytics institutional architecture transcript (`yt01`) + Noel T's SQX robustness funnel (`op03`) + Investing Canvas "If MA works at 183 days but fails at 180/190 that's a red flag" (`yt02`) + multiple r/algotrading "passed OOS still died live" posts.
**Specifics:** SDR ≥ 0.85 (Sharpe Degradation Ratio under ±20% jitter of every numeric param), PSI ≤ 0.05 (Parameter Sensitivity Index), RWS ≤ 0.20 (Rolling Window Stability — std of monthly Sharpe across 6-mo windows). Blocks PAPER→DEPLOY_READY. ~2 days, reuses WF infrastructure.

### §6.2 🔴 Sequence-reorder MC test
**Backed by:** Noel T (`op03`) explicitly cites this as a core SQX gate.
**Specifics:** Per-strategy `sequence_reorder_max_consecutive_losses` metric stored in `backtests.resultExtras.invariants.sequence_reorder`. Used as DLL budget sanity check. ~0.5d. Wave 25 Pass 7.5 or Wave 26.

### §6.3 🟡 Strategy Factory Funnel Panel
**Backed by:** Noel T's SQX funnel UI (`op03`).
**Specifics:** Frontend reads `audit_log` + `lifecycle_transitions` and renders per-stage attrition (CANDIDATE → TESTING → PAPER → DEPLOY_READY → PILOT → DEPLOYED). Equivalent visibility to SQX. ~1d frontend.

### §6.4 🟡 Decay-Velocity continuous quantification
**Backed by:** r/algotrading 2026-01-27 (42↑).
**Specifics:** `expectancy_momentum` per deployed strategy. Triggers `strategy:decay-warning` at -20%, `strategy:decay-demotion` at -40%. ~1d.

### §6.5 🟡 Webhook-latency monitor (Pine → TradersPost path)
**Backed by:** r/TradingView 2026-05-22 + 2024-06-07.
**Specifics:** `webhook_fire_to_broker_ack_ms` audit field. Alarm if p95 > 2000ms over 1h. Eliminated when TopstepX direct path lands but useful during current TradersPost era. ~0.5d.

### §6.6 🟡 Signal-starvation auto-alarm
**Backed by:** Wave 25 W25.1 weighted scoring is DESIGNED to drop A+ rate 30-50% + multiple dev.to / r/algotrading "bot did nothing for 48h" postmortems.
**Specifics:** `signal-starvation-check` cron, every 4h during RTH. Zero entries 5d + non-zero candidates → "score-threshold too tight" Discord warning; zero candidates 5d → "feature-pipeline broken" Discord CRITICAL. ~0.5d.

### §6.7 🟡 Per-broker error-budget panel
**Backed by:** Evan Shunk (`op04`) operational pain quote.
**Specifics:** Aggregator over `broker:order_routed` failures by failure_class. Alarm if any class > 5% of attempts over rolling 24h. ~1d.

### §6.8 🟡 Portfolio regime coverage check
**Backed by:** Evan Shunk's "diversify by entry because cycles" quote (`op04`).
**Specifics:** Cron counts deployed strategies by preferred_regimes coverage. Warns if any regime has zero deployed. Prevents silent starvation when market regime shifts. ~0.5d.

### §6.9 🟡 Payout-audit packet generator
**Backed by:** r/propfirm 2026-02-07 OFP Funding Account 2818 payout denial + r/Daytrading 2026-05-14 Lucid Trading "fraud" ban.
**Specifics:** `scripts/generate-payout-audit-packet.ts <account_id> <date_range>` bundles trade journal + audit_log + bias_state + sizing audits + kill_switch events into tamper-evident ZIP with SHA-256 manifest. ~1d.

### §6.10 ⚪ Multi-strategy-per-account architectural discussion
**Backed by:** Noel T runs 3-5, Evan Shunk runs 6, every other production operator runs >1.
**Specifics:** Whether to relax CLAUDE.md §1 "scale ONE strategy" mission statement to allow 2-3 non-correlated strategies on the operator's primary account. Infrastructure already supports it (`account_strategy_assignments`). Pure operator decision, no engineering blocker.

### §6.11 ⚪ Pin "no LLM on execution path" as known-correct architecture
**Backed by:** r/algotrading 2026-03-07 (2-year Jetson Nano postmortem).
**Specifics:** Add pinned fact to `AGENT-LOGS.md` so a future agent doesn't accidentally call OpenAI/Ollama from any tight-loop runtime path. Pure documentation, ~5 minutes.

---

## §7. Source provenance

All raw JSON outputs preserved under `docs/research-raw/`. New operator transcript files
from this research round:

| File | Source |
|---|---|
| `op01.json` | CodeTrading RL Forex bot tutorial (`oW4hgB1vIoY`) |
| `op02.json` | Alex crypto MEV arbitrage (`Ol4NIRFgYpg`) — likely promotional, used for reference only |
| `op03.json` | Noel T / "Ultra Instinct" algo trader interview (`TyHTEtArsS4`, Chart Fanatics, Arabic, $1M documented) |
| `op04.json` | Evan Shunk systematic small-cap short bot (`T3sCLOvsdus`, Humbled Trader, $530K/yr) |
| `yx-iwRaNYa8yTw.json` | ByteMonk *Inside a Real HFT System / HFT Architecture* (architecture reference) |
| `yx-y_bsjZThP0o.json` | AI Pathways *How To Actually Build a Trading Bot With Claude Code* (5-regime HMM, Alpaca, WF backtest) |
| `yx-7LnIvCnwL34.json` | AlphaInsider *How To Add Multiple Strategies* |
| `yx-rDf3TfHlGmk.json` | AI Pathways *I Built a Profitable AI Agent Day Trader (n8n)* (Telegram + 12data + GPT-4.1-mini sentiment fusion) |
| `yx-_q4fLhzRwWg.json` | TradersPost official TradingView→TradersPost setup walkthrough |
| `yx-pcZTAe79iiY.json` | TradeX Labs Apex prop firm + TradersPost full setup |

Plus the 10 web/Reddit search files (`y*.json`, `rd*.json`, `w*.json`, `r*.json`) from this
round and the 20 from the previous round. Re-run any source with
`node scripts/institutional-research.mjs <command>` per script `--help`. Each JSON includes
`cited_at` ISO timestamp for freshness audit.

---

## §8. Summary — what this research means for Trading Forge

**TF engineering surface is already broader and deeper than every retail operator
surveyed.** The two real $500K+/yr operators (Noel T, Evan Shunk) run setups TF has
already surpassed in: lifecycle FSM, audit trail, operator-absent mode, compliance gates,
multi-firm routing, family distribution, strategy factory with cross-validation graduation,
quantum challenger layer, n8n orchestration.

**The Wave 25 plan is correctly diagnosed.** Every Pass 1-7 maps to either a documented
institutional pattern (regime expansion, structure engine, liquidity map, adaptive exits)
OR a documented retail failure mode (boolean checklist scoring, static R-multiples).

**Eleven specific engineering items surfaced** that operators DO have that TF doesn't yet
have explicit equivalents of (§6.1 through §6.11). Two are recommended for Wave 25 itself
(§6.1 + §6.2); seven are Wave 26 candidates; two are architectural discussions for the
operator.

**TF's positioning relative to the field:** the operators making real money (Noel T, Evan
Shunk, the 4-year-15× BTC operator) all run systematic systems with diversified entries,
sample-size-backed stops, and disciplined sizing. TF has institutional-grade equivalents of
each of those + an order of magnitude more compliance, observability, and autonomy
infrastructure. Wave 25 closes the remaining institutional-vs-retail entry/exit scoring
gap. The 11 items in §6 are the next tier of refinement, not blockers.
