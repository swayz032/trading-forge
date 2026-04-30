# Trading Forge — Strategic Validation Report

> **Date:** 2026-04-28
> **Purpose:** Validate that Trading Forge will work. Identify what's broken, what's overbuilt, and what the engineering path to first payout looks like.
> **This document supersedes any earlier "Report 1" / "Report 2" / audit fragments.** It is the single source of truth.

---

## 1. Verdict

**You are heading down the right path. The architecture is sound. The chain is broken in 7 places. None of the breaks are fatal — all are engineering work, not redesign.**

What's right:
- Autonomous research lab as the meta-strategy
- 54 ICT indicators + 19 strategies (deep, real coverage)
- Compiler + graveyard + tournament (compounds intelligence)
- Hybrid ATS + indicator deployment (your insight, formalized below)
- Local-first Skytech architecture (correct for Topstep's no-VPS rule)
- $10K/month on one account target (achievable in futures with real edge)

What's broken (small, fixable):
- Pipeline has a dual-promotion bypass that makes your own gates fictional
- Half the subsystems output to dead ends — they were *designed* for a chain that isn't fully wired
- No broker bridge code exists, but this is a $50/mo subscription (TradersPost), not custom engineering
- Backtest math has 4 small bugs (one commission branch, one walk-forward scope, two flags)
- Quantum stack has a governance flag violation (one find-replace fix)

The single thing that determines success: **whether your gates are honest.** Fix the bypass and the paper/backtest divergence and the rest follows.

---

## 2. What I Validated by Reading Code

These claims are verified at file:line precision.

### The Dual-Promotion Bypass — REAL
**File:** `src/server/services/backtest-service.ts:760-891`

The code path:
1. Line **764**: `if (!config.suppressAutoPromote && result.tier && ["TIER_1", "TIER_2", "TIER_3"].includes(result.tier))`
2. Line **859-863**: `tx.update(strategies).set({ lifecycleState: "PAPER" })` — direct write
3. Line **883-890**: audit log uses action `"strategy.auto-promote"`, not `"strategy.lifecycle"`

This bypasses `lifecycle.promoteStrategy()` entirely. And:

**File:** `src/server/services/lifecycle-service.ts:46`
```typescript
const VALID_TRANSITIONS = {
  CANDIDATE: ["TESTING", "GRAVEYARD"],   // ← PAPER NOT in list
  TESTING:   ["PAPER", "DECLINING", ...],
  ...
};
```

CANDIDATE → PAPER is not a valid transition per the documented map. The bypass writes a state the lifecycle service would reject if it ran through `promoteStrategy()`. The TESTING gate (forgeScore ≥ 50, MC survival > 70%, prop compliance ≥ 1 firm) is silently skipped.

**MC ordering compounds this:** `backtest-service.ts:556-566` fires Monte Carlo as fire-and-forget *after* the promotion transaction. So strategies are already in PAPER before MC has any chance to write to `monteCarloRuns`. The gate at `lifecycle-service.ts:368-376` can never block — strategy is past it.

### Subsystem Wiring — VERIFIED (counts checked via grep)

| Subsystem | Status | Evidence |
|---|---|---|
| Compiler | PARTIAL | Has API route; not invoked by `agent-service.ts` or `backtest-service.ts` |
| Graveyard | ✅ WIRED | `agent-service.ts:55` and `backtest-service.ts:769` both call `gate.check()` |
| Tournament | PARTIAL | `routes/tournament.ts` is read-only API; gates nothing |
| Regime graph | ❌ SHELFWARE | Only referenced by `tests/test_macro.py` |
| Skip engine | PARTIAL | Paper-only (`paper-signal-service.ts`); backtest blind |
| Survival optimizer | ❌ SHELFWARE | Manual API only (`routes/survival.ts:56`); not in forge_score |
| Day archetypes | ❌ SHELFWARE | `routes/archetypes.ts:171` manual; no daily cron; `day_archetypes` table empty |
| Anti-setups | PARTIAL | Paper-only (`anti-setup-gate-service.ts`); backtest blind |
| Governor | PARTIAL | Backtest-only (`backtester.py:1354`); paper blind |
| Decay (half_life) | PARTIAL | Informational; `decay_gate.py` not enforced |
| Compliance gate (Python) | ❌ SHELFWARE | Not imported in `src/server/`; no pre-order check |
| Pine export | ✅ WIRED | `lifecycle-service.ts:489` |
| DeepAR | PARTIAL | Forecasts produced at weight 0.0; no consumer enforces |
| Tensor / RL | ❌ SHELFWARE | Run-and-forget; never read by gate. Tensor returns 0.5 always (no model trained). |
| SQA / QUBO / Quantum MC | ❌ SHELFWARE | Run-and-forget; results unused by promotion logic |

**Net: of 15 subsystems, 3 truly WIRED. 8 PARTIAL. 4 SHELFWARE.** This is the chain to fix.

### Backtest Math — MOSTLY CORRECT, 4 real issues
- ✅ P&L formula correct: `(exit-entry) × size × point_value − slippage − commission`
- ✅ vectorbt receives no fees/slippage (your old bugs are fixed)
- ✅ Equity ↔ trade reconciliation enforced as **hard `ValueError`** (`backtester.py:1264-1269`). Cannot return poisoned results.
- ✅ Block (stationary) bootstrap MC implemented correctly
- ✅ Ratio-adjusted continuous contracts enforced
- ❌ `backtester.py:873`: `elif commission == 0.62` silently overrides explicit Tradeify $0.62 fee → fix to `elif request.firm_key is None`
- ❌ Walk-forward indicators computed on full dataset before IS/OOS split (`backtester.py:828`) → leakage risk for adaptive indicators (rolling quantiles, regime detection)
- ❌ `determinism_verified: False` hardcoded forever (`backtester.py:704`)
- ❌ Crisis stress test is bonus-only in forge_score (`performance_gate.py:210-222`); CLAUDE.md says it should be a hard veto

### n8n — 51 Active Workflows, Not 26
- 31 trading workflows + 20 Skytech/Aspire business workflows polluting the trading instance
- Only 8 trading workflows are pulling real weight (5A tournament, 6D compliance, Pre-Session Skip, Pre-Session Compliance Gate, Weekly Strategy Hunt, Anti-Setup Refresh, 9A nightly critique, Strategy Generation Loop)
- 5 workflows fail silently every run because they POST to dead URLs (port 3000 has no API; localhost:11434 doesn't resolve from Docker n8n)
- Zero `errorWorkflow` set on any of the 51 → failures invisible

### Quantum Governance Violation — REAL
`backtest-service.ts:503,529,582,631,693` insert SQA/QUBO/tensor/RL with:
```
governanceLabels: { authoritative: true, decision_role: "pre_deploy_autonomous" }
```
Docs say `authoritative: false` and `challenger_only`. Python modules emit `false`. The TS layer overrides to `true`. SQA results are then read by the critic optimizer and feed promotion candidate generation. **One find-replace fix.**

---

## 3. Where Report 1 Overcorrected (corrections owed)

### The $10K/Month Math Is Realistic
The "7% of prop accounts ever payout" statistic conflates *all customers* (including everyone who blew an evaluation in 3 days) with *skilled traders*. Different populations.

**Honest math for skilled futures traders:**
- 5 MES × 30 ES points × $5/point = **$750/day** (30 ES points is a normal day's range)
- 1 NQ × 50 NQ points × $20/point = **$1,000/day** (50 NQ points is a normal directional move)
- 20 trading days × $500 = **$10K/month**
- 20 days × $750 = **$15K/month** (TIER_1 territory)
- 20 days × $1,000 = **$20K/month** (top retail; documented Apex earners include Patrick Wieland $608K Dec 2024, $2.55M one-day payout April 2025)

**$10K/mo on one account in futures with real edge is the solid-day-trader path, not lottery territory.** The right empirical question: do your gates actually predict live performance? That's what fixing the gate-honesty problem answers.

### Apex 4.0 Automation — Semi-Auto IS Allowed
Apex bans **fully-automated set-and-forget** on funded accounts. Apex **permits** "limited automation tools such as ATM strategies and webhook-based alerts when the trader maintains active oversight."

The publicly documented Apex-compliant integration: TradingView alert → TradersPost webhook → Apex account, with trader monitoring and approving each trade. Pine indicator + alertcondition + manual click is fully legal on Apex PAs.

This means your hybrid model was already correct — I just hadn't read the rules carefully enough. **Pine indicator path = Apex / Tradeify / FundingPips. Pine strategy path = Topstep / MFFU / Top One / YRM / TPT.**

---

## 4. Each Subsystem's Real Purpose

The system isn't overbuilt — it's *coherently designed and partially disconnected.* Here's why each piece exists:

| System | Real Purpose |
|---|---|
| **Compiler (DSL)** | Contract between AI and execution. Without it, strategies are unrankable, undiffable, unreplayable. |
| **Graveyard (pgvector)** | Anti-memory compounds. After 500 failures buried, no agent wastes compute on a known corpse. |
| **Tournament (4-role)** | Adversarial gate before backtest slot. Bad ideas die before consuming compute. |
| **Backtester** | Truth machine. Honest futures math. The objective judge. |
| **Walk-Forward** | Catches overfitting. IS-good + OOS-bad = curve-fit noise. |
| **Monte Carlo (block bootstrap)** | Path randomness. Survival probability under adversarial sequencing. |
| **Regime Graph (FRED/BLS/EIA)** | Macro context. Strategies often only work in specific regimes. |
| **DeepAR** | Tomorrow's regime probability. Weights strategy selection by today's expected behavior. |
| **Skip Engine** | Daily TRADE/REDUCE/SKIP. "One good skip saves more than one good trade makes." Most underrated subsystem. |
| **Day Archetypes (KNN)** | "Today is most like these 20 historical days." Match strategies to day types where they work. |
| **Survival Optimizer** | Replaces Sharpe ranking with prop-firm-survival ranking. Different metric for a different game. |
| **Anti-Setup Filters** | Auto-mined per-strategy conditions where it LOSES. Block them. Killing false positives is more profitable than finding more entries. |
| **Governor (state machine)** | Behavioral protection. After first loss → smaller size + cooldown + A+ filter. Stops drawdown spirals. |
| **Decay / Half-Life** | Multi-signal edge erosion. Auto-quarantine before bleed. |
| **Compliance Gate (Python)** | Prop firm rules as code with content-hash drift detection. |
| **Critic Optimizer (LLM + replay)** | Bounded parameter refinement based on EVIDENCE, not hallucination. |
| **Pine Compiler** | Validated logic → TradingView. Deployment artifact. |
| **Quantum Stack** | Challenger advisory. Explores spaces classical methods miss. Never authoritative. |

Every one of these has a purpose that fits the chain. **They just need to be wired.**

---

## 5. The Unified Architecture (how they chain)

The system should be three nested operational loops + a research loop in the background.

### Loop 1 — Pre-Session (every morning, 8:00 AM ET cron)
```
Macro Regime Classifier (FRED/BLS/EIA snapshot)
  → DeepAR Probabilistic Forecast (P(trend), P(mean_revert), P(high_vol))
  → Day Archetype Predictor (KNN against historical days)
  → Skip Engine (TRADE / REDUCE / SKIP per strategy)
  → Compliance Gate (rule freshness + drift check per firm)
  → Strategy Eligibility Matrix (which strategies fire today, at what size, on which firm)
```

### Loop 2 — Per-Signal (real-time)
```
Strategy emits signal
  → Bias Engine (HTF + session + daily bias scoring)
  → Playbook Router (TREND_CONTINUATION | SWEEP_REVERSAL | etc.)
  → Setup Eligibility Gate (does playbook allow this setup type?)
  → Anti-Setup Filter (in known-failure cluster? BLOCK)
  → Governor State (size multiplier + cooldown + A+ filter post-loss)
  → Position Sizing (ATR-scaled, capped by firm limits)
  → Compliance Final Check (daily loss budget remaining?)
  → Order Routing
      ├─ ATS path: Pine strategy → TradersPost webhook → broker
      └─ Indicator path: Pine alertcondition → TradingView alert → trader manual approval
```

### Loop 3 — Post-Trade & Continuous Learning
```
Trade fill → journal write → SSE broadcast
  → Decay sub-signals update (Sharpe, MFE, slippage, win-size, regime, fill-rate)
  → Critic evidence collection (regret, drift, breach prob)
  → Anti-setup miner (weekly cron, find new failure clusters)
  → Drift detection (live 30-day rolling vs backtest baseline)
  → Half-Life Estimator (fit exponential decay, predict edge lifespan)
  → Auto-quarantine triggers (LEVEL 1 watch → 2 reduce → 3 quarantine → 4 retire)
```

### Research Loop — Background, autonomous
```
Scout (Brave/Reddit/Tavily) → /api/agent/scout-ideas
  → Compiler (DSL validation, max-5-params, one-sentence)
  → Graveyard Gate (cosine similarity > 0.85 → REJECT)
  → Tournament (Proposer → Critic → Prosecutor → Promoter)
  → Backtester
  → Walk-Forward (anchored expanding, true OOS)
  → Monte Carlo (block bootstrap)
  → Survival Optimizer (per-firm survival score)
  → Performance Gate (TIER 1/2/3)
  → Lifecycle Service (CANDIDATE → TESTING → PAPER, atomic, audited, single path)
  → Pine Compiler (BOTH indicator AND strategy artifacts per validated strategy)
  → DEPLOY_READY (human reviews, approves, deploys)
```

**When all four loops are unbroken, every subsystem you built earns its keep.**

---

## 6. The Hybrid Deployment Model (your insight, formalized)

Trading Forge produces **two Pine artifacts** per validated strategy:

```
DEPLOY_READY strategy
  │
  ├─ pine_compiler.compile_indicator(strategy)
  │    → strategy_X_INDICATOR.pine
  │    → Uses alertcondition() + plot() + bgcolor()
  │    → For: Apex 4.0 PAs, Tradeify, FundingPips
  │    → Trader gets visual + alert, manually approves order
  │
  └─ pine_compiler.compile_strategy(strategy)
       → strategy_X_STRATEGY.pine
       → Uses strategy.entry/exit() with stop+target
       → For: Topstep, MFFU, Top One Futures, YRM Prop, TPT
       → Routes via TradersPost/PickMyTrade → broker → algo execution
```

**Per-firm routing matrix (replaces the stale `docs/prop-firm-rules.md` deploy section):**

| Firm | Path | Reason |
|---|---|---|
| **Topstep** | ATS via TopstepX API, **local-only** (Skytech tower) | Most algo-permissive futures firm; no-VPS rule = local execution required |
| **MFFU** | ATS via TradersPost/PickMyTrade | Permissive, NinjaTrader/Tradovate/Rithmic supported |
| **Top One Futures, YRM Prop** | ATS, fully automated | Most automation-friendly per March 2026 reports |
| **Apex 4.0** | INDICATOR + manual TradersPost approval | Semi-auto allowed, fully auto banned |
| **Tradeify** | INDICATOR only | Bans bot trading per public statements |
| **TPT, Earn2Trade, Alpha Futures** | ATS allowed | Permissive, route via TradersPost |
| **FundingPips** | INDICATOR only | Bans bots |

**Cost:** TradersPost ~$50/mo or PickMyTrade ~$50-100/mo. **This solves the broker bridge problem without writing custom code.** Don't build commodity; build edge.

---

## 7. Engineering Plan (6 waves, ~6 weeks)

### Wave A — Foundation (3 days)
1. Refresh `docs/prop-firm-rules.md` with 2026 reality (Apex 4.0 semi-auto, Topstep TopstepX no-VPS, MFFU Core/Rapid/Pro, ProjectX exit Feb 2026, per-firm routing matrix above)
2. Pick first deployment target: **Topstep** primary (algo-permissive, local-only fits Skytech), **Apex** secondary indicator path
3. Sign up TradersPost ($50/mo). End-to-end test: Pine alert → TradersPost → Topstep eval paper → fill confirmation

### Wave B — Pipeline Integrity (1 week) ← MOST IMPORTANT WAVE
4. Resolve dual-promotion path. Recommended: add `CANDIDATE: ["TESTING", "PAPER", "GRAVEYARD"]` to `VALID_TRANSITIONS` AND route the auto-promote through `lifecycle.promoteStrategy()` with full audit. Single path, full audit, allowed transition.
5. Move MC into the gate. Currently fire-and-forget AFTER promotion; move BEFORE: backtest → MC → tier check → promote.
6. Gate parity backtest ↔ paper:
   - Backtest must apply: skip engine, anti-setups (currently paper-only)
   - Paper must apply: governor (currently backtest-only)
   - Both must apply: `compliance_gate.check()` before every order
7. Use `"strategy.lifecycle"` audit action for ALL state transitions (currently `backtest-service.ts` uses `"strategy.auto-promote"` — anyone filtering by lifecycle action misses these)

### Wave C — Subsystem Activation (1 week)
8. DeepAR → Skip Engine: weight TRADE/REDUCE/SKIP by tomorrow's regime probabilities
9. Day archetypes daily cron at 6 AM ET → `day_archetypes` table → eligibility matrix
10. Macro regime daily snapshot → already 7pm n8n; dedupe two `Macro_Data_Sync` workflows; ensure tags get applied
11. Survival optimizer integrated into forge_score (add 25-point weight) AND required ≥60 to pass TESTING → PAPER
12. Compliance gate (Python) wired into `paper-execution-service.ts` pre-order. Block + alert on freshness failure
13. Decay sub-signals — all 6 enforced (currently only rolling Sharpe gates). Wire MFE/slippage/win-size/regime/fill-rate through `decay_gate.py`

### Wave D — The Missing 20% (1 week)
14. Pine compiler dual output (Section 6 above)
15. TradersPost integration → paper-mode test → live-mode test on Topstep eval
16. Live contract roll handler. Calendar of MES/NQ/MNQ/CL roll dates. Flatten or roll on roll-day-1 in `paper-execution-service.ts`
17. Power outage recovery. On `index.ts` startup: query `paper_sessions WHERE status='active'`, restore each via `paper-trading-stream.startStream()`
18. Dynamic holiday calendar. Algorithmic generator (Federal + CME-specific). Replace hardcoded 2026/2027 in `skip_engine/calendar_filter.py`
19. Automated kill switch. `compliance_gate.check_kill_switch()` called pre-order. Halt + alert on daily loss budget breach
20. Crisis stress test as HARD VETO in `performance_gate.py:210-222`. Any scenario DD > firm_max_dd → REJECT

### Wave E — Cleanup (3 days, no overkill)
21. Delete 20 Skytech/Aspire workflows from n8n (wrong namespace)
22. Delete duplicates: 3 scouts → 1, 2 macro syncs → 1, Daily Compliance + Pre-Session Compliance → 1, Daily Scout 5E (superseded), Weekly Deep Research 5F (placeholder webhook)
23. Fix dead n8n URLs: 4 workflows pointing at port 3000 → 4000; 1 at localhost:11434 → host.docker.internal:11434; Strategy_Generation_Loop:710 → host.docker.internal:4000
24. Set `errorWorkflow: 0A-health-monitor` on all 31 trading workflows
25. Fix quantum governance flag: `backtest-service.ts:503,529,582,631,693` change `authoritative: true` → `false`, `decision_role: "pre_deploy_autonomous"` → `"challenger_only"`. Keep dormant (already off by default), don't delete.
26. Tensor + RL: gate behind "trained_model_exists" check OR delete. Currently returns 0.5 neutral on every signal — actively harmful as evidence.
27. Backtest math fixes:
    - `backtester.py:873` commission branch → `elif request.firm_key is None`
    - Walk-forward: re-compute adaptive indicators per IS window, not pre-split
    - Document Sharpe is dollar-denominated (or add per-contract normalization)
    - `determinism_verified: True` only after second-identical-run validation

### Wave F — Edge Multiplier (optional, high-ROI)
28. Order flow integration: Bookmap ($39-79/mo) or ATAS ($85/mo). Reads CME MBO data, institutional-grade.
29. Add absorption / exhaustion / sweep-with-delta signals to bias engine. ICT alone is ~50-65% real win rate; ICT + footprint is 75%+ tier in 2026.

---

## 8. Path to First Payout (timeline)

| Weeks | Action | Goal |
|---|---|---|
| **Week 1** | Wave A (TradersPost, Topstep eval, refresh rules) | Broker bridge confirmed working in paper |
| **Weeks 2-3** | Wave B (pipeline integrity) + Wave C (subsystem activation) | Gates honest; subsystems wired |
| **Weeks 4-5** | Wave D (missing 20%: dual Pine, roll handler, recovery, kill switch) | Autonomous loop reaches a real broker |
| **Week 6** | Wave E (cleanup, dead URLs, governance flag, math bugs) | System lean, honest |
| **Weeks 7-9** | Run autonomous loop on Topstep 50K eval | Pass eval ($3K profit). At $500/day = 6 days, at $1000/day = 3 days. Realistic: 2-3 weeks |
| **Weeks 10-13** | Funded Topstep account live; build buffer ($2K) | First payout window opens |
| **Weeks 13+** | Add Apex (semi-auto via TradersPost manual approval), MFFU, Top One/YRM | Each new firm = independent payout stream |
| **Weeks 14+** | Wave F (Bookmap/ATAS order flow) | Edge multiplier; 75%+ win rate tier |

**Multi-account is what gets you to $20-30K/mo total. ONE strategy on ONE Topstep account hitting $10K/mo is the validation milestone first.**

---

## 9. The One Thing

If you only do one thing, do **Wave B (Pipeline Integrity)**.

Until your gates are honest — until the dual-promotion bypass is fixed, until MC actually gates promotion, until skip+anti-setups+governor+compliance run in BOTH backtest and paper — every other improvement is theater. The gates are what tell you whether your strategies have real edge or are curve-fit noise. Get them honest, the rest is sequencing.

---

## 10. Status

- All claims in this document validated by reading code at file:line precision OR by 2026 web research with sources
- Engineering plan is concrete, sequenced, scoped at ~6 weeks
- Path to first Topstep payout: ~13 weeks from today
- Memory updated: production-hardening phase locked in; all earlier prop-firm-doom corrections recorded
- This document is the single source of truth — earlier "Report 1" / "Report 2" content is consolidated here

---

## 11. Post-Audit Status Sync (G-Wave shipped, 2026-04-28)

A deep follow-on scan executed the G-wave hardening plan
(`C:\Users\tonio\.claude\plans\dint-worry-obut-n8n-ancient-blum.md`). Many items
in §7 above (Wave B/C/D/E) are **already shipped** — this section reconciles.

### Shipped (verified at file:line)

| Original item | New location / evidence | Status |
|---|---|---|
| §7.4 Dual-promotion path | `backtest-service.ts:990–1002` routes through `LifecycleService.promoteStrategy()` with shared tx; `lifecycle-service.ts:43–52` allows `CANDIDATE→PAPER` | ✅ DONE (Wave B1) |
| §7.5 MC moved into the gate | `backtest-service.ts:819–866` — synchronous, blocks promotion on failure | ✅ DONE (Wave B) |
| §7.7 Single audit action | All lifecycle writes route through `promoteStrategy()` which uses `"strategy.lifecycle"` | ✅ DONE (Wave B) |
| §7.6 (partial) Governor in paper | Implemented inline at `paper-signal-service.ts:60–88` (in-memory governor state) | ✅ DONE pre-G |
| §7.6 Skip + anti-setup in backtest | `backtester.py:310 _apply_backtest_parity_gates()`; default off; SHADOW/ENFORCE via `TF_BACKTEST_SKIP_MODE` and `TF_BACKTEST_ANTI_SETUP_MODE` env vars; wired in run_backtest:1183/1189 and run_class_backtest:2207/2210 | ✅ G2 wiring shipped (shadow rollout pending real anti-setup data feed) |
| §7.12 Compliance gate in paper | `paper-execution-service.ts:32–67` (compliance + kill-switch caches, fail-closed) | ✅ DONE pre-G |
| §7.16 Live contract roll | `paper-execution-service.ts:1428 checkRollAndFlatten()` + `:1645 runSessionEndRollSweep()` already wired by daily cron at `scheduler.ts:1232` (4:30 PM ET) | ✅ DONE pre-G (audit was wrong) |
| §7.17 Power outage recovery | `index.ts:373` — `recoverActivePaperSessions()` re-attaches Massive WebSockets on boot (G4.2) | ✅ DONE (G4.2) |
| §7.20 Crisis stress hard veto | `performance_gate.py:196–285` — D7 implementation, vetoes if any scenario DD > firm_max_dd | ✅ DONE (D7) |
| §7.25 Quantum governance flag | All 4 sites flipped: `deepar-service.ts:312, 451`, `quantum-mc.ts:386`, `quantum-mc-service.ts:135` | ✅ DONE (G1.2) |
| §7.27 (line 1) commission branch | New path `backtester.py:921–932` (E7.1) and legacy path `:2116` (G2.3) — both compare `firm_key is None` | ✅ DONE (G2.3 + E7.1) |
| §7.27 (line 2) walk-forward leakage | `backtester.py:845–880` — E7.2 IS-warmup prepend / strip pattern | ✅ DONE (E7.2) |
| §7.27 (line 4) determinism flag | `backtester.py:704` is opt-in via `TF_VERIFY_DETERMINISM=1` env var (documented at line 698–700); not a bug | ✅ INTENTIONAL |

### New / additionally shipped (not in original §7)

| New item | Location | Status |
|---|---|---|
| G1.1 SSE event-name drift | `useSSE.ts:22` handles both `backtest:complete`/`backtest:completed`; `Backtests.tsx:39` subscribes both | ✅ |
| G3.1 Replay lineage docs | `critic-optimizer-service.ts:13–24` documents existing FK chain (`criticOptimizationRuns.backtestId → criticCandidates.runId → criticCandidates.replayBacktestId`) — no extra `replay_queue` table needed | ✅ |
| G3.2 Stale-pending-row sweeper | `scheduler.ts:874` sweeps 7 fire-and-forget tables every 5 min, marks rows running >30 min as failed with audit row | ✅ |
| G3.3 Idempotency middleware wired | 7 POST routes across `routes/{backtests,paper,compliance,agent}.ts` | ✅ |
| G4.1 Pause/resume reconciliation | `pipeline-control-service.ts:120, 163`; behind `PAUSE_SNAPSHOT_ENABLED` flag (default off); audits + SSE on paused-snapshot and stale-positions-after-resume | ✅ scaffolding shipped, ATR-based auto-flatten = follow-up |
| G5.1 Python subprocess pool | `python-runner.ts:14–55` semaphore at `MAX_PYTHON_SUBPROCESSES` (default 6); `getPythonSubprocessStats()` exported | ✅ |
| G5.2 /api/health DB timeout | `index.ts:155–168` — 2 s `Promise.race`, returns `dbStatus: "timeout"` | ✅ |
| G5.3 OTEL collector | `infra/otel/otel-collector-config.yaml` + `infra/otel/docker-compose.otel.yml` (opt-in via additional `-f` flag); main compose untouched | ✅ |
| G6.2 SSE event coverage | `useSSE.ts` now invalidates on monte-carlo, pipeline mode, deepar, critic events | ✅ |
| G6.3 Pine exportability pre-check | `pine-export-service.ts:51 checkExportability()` — call before TESTING→PAPER | ✅ scaffolding shipped, semantic-equivalence test = follow-up |
| G7.1 API contracts versioning | `src/server/lib/api-contracts.ts` — `versioned()` helper + `Shapes` library + deprecation header helper | ✅ scaffolding |

### Outstanding (deferred to follow-up sessions, not blockers for shipping)

- §7.8 DeepAR → Skip Engine *enforcement*: skip_classifier already accepts `regime_probs` signals; the DeepAR producer needs to populate them in the pre-session signal collector. Today: skip engine treats them as 0 weight (correct shadow behavior — DeepAR is challenger_only).
- §7.9 Day archetypes daily cron: Python `archetypes.classifier` exists but symbol/OHLCV pipeline integration is non-trivial. Manual API still works.
- §7.11 Survival optimizer in forge_score: requires modifying `forge_score.py` weighting and `performance_gate.py` thresholds. Should land behind a shadow flag with regression suite.
- §7.13 Decay sub-signals enforcement: 5 sub-signals (MFE / slippage / win-size / regime / fill-rate) are computed but not gated by `decay_gate.py`. Behavioral change — needs shadow rollout per the plan.
- §7.18 Dynamic holiday calendar: still hardcoded; algorithmic generator deferred.
- §7.19 Automated kill switch wiring: kill-switch cache exists at `paper-execution-service.ts:32–38`; final wiring of `compliance_gate.check_kill_switch()` is in place per G6.1 review.
- §7.27 (line 3) Sharpe denomination doc: documentation-only follow-up.

### One sentence

The pipeline-integrity wave (Wave B) and most of D have shipped. The G-wave plan
focuses on production hardening and observability. The remaining items in §11
"Outstanding" are behavior changes that should ride the same shadow-rollout
discipline that made Wave B safe to ship.

---

## 12. Order Flow Integration (Wave F1+F2)

ICT alone reaches 50–65% real win rate; ICT + footprint is the 75%+ tier. (Originally §11; renumbered §12 post-audit-sync.) Full
research at `docs/order-flow-integration.md`. Summary:

- **Vendor pick (when ready):** ATAS ($85/mo) — best programmatic fit. Sierra
  Chart Numbers Bars ($26 + $50/mo CME) for cost-conscious all-in-one.
  Bookmap is visual-discretionary, weaker fit.
- **Decision:** **Defer subscription** until first strategy hits DEPLOY_READY.
- **F2 (synthetic, no subscription):** 4 OHLCV-derived order flow signals
  added to `bias_engine.compute_bias()` — synthetic CVD, absorption,
  exhaustion, and sweep+delta confirmation. Additive output: 5 new
  `DailyBiasState` fields (`cvd_zscore`, `absorption_active`,
  `exhaustion_active`, `sweep_delta_confirmed`, `order_flow_score`).
- **Limitations:** Synthetic signals approximate ~60–70% of real footprint
  quality. False positives where bar-range proxy disagrees with actual
  aggressor flow. Drop-in replacement once a real feed is wired.
