# Bot Research — Plain English Version (VERIFIED against codebase)

**For:** swayz032 (you)
**Date:** 2026-05-24
**This version:** Verified every claim against your actual `src/`, `Trading_forge_frontend/`,
`workflows/n8n/`, and `scripts/` files before calling anything a gap. The previous draft of
this file claimed gaps without checking. **4 of the 11 claims I made were WRONG — you
already have those things.** Corrected version below.

---

## What you already have (I was wrong on these 4)

I called these "gaps" but verification shows they exist and are well-developed. Apologies
for not checking first.

### ✅ Claim 1 — Sequence Reorder MC — YOU ALREADY HAVE THIS
**Where it lives:** `src/engine/monte_carlo.py:93-121` — function `trade_resample()`
literally has the docstring: *"Shuffles the trade sequence n_sims times to test: 'If these
same trades happened in a different order, what would the drawdown look like?'"*
Plus `compute_permutation_test()` with Bonferroni adjustment at line 1244-1280.
Exposed via `src/server/services/monte-carlo-service.ts:33-50` (`runPermutationTest`,
`permutationN` knob) and `/api/monte-carlo` route.

**Verdict:** Noel T's SQX has it. You have it. Closed.

### ✅ Claim 5 — Decay Velocity — YOU ALREADY HAVE THIS (and more)
**Where it lives:** `src/engine/decay/sub_signals.py:11-50` — `sharpe_decay()` computes
rolling 30-day Sharpe slope as a continuous 0-100 score normalized by mean Sharpe. Plus
MFE slope (line 74), slippage slope (line 111) — three independent continuous decay
signals. Plus `src/engine/decay/half_life.py`, `decay_gate.py`, `quarantine.py`, and
`src/server/routes/decay.ts` with status/analyze/signals/quarantine/dashboard endpoints.

**Verdict:** This is more sophisticated than the Reddit operator's custom Node/Chart.js
dashboard I cited. Closed.

### ✅ Claim 6 — Multi-Strategy on One Account — YOU EXPLICITLY HAVE THIS
You called this out directly: *"I do trade multiple strategies that's why I have a deploy
library and bias playbook to determine what strategy to use."*

**Verification:** Confirmed.
- `src/engine/context/playbook_router.py:1-80` — `route_playbook()` maps bias → 9 named
  playbooks → `allowed_strategies` lists (CONTINUATION / REVERSAL / MEAN_REV / ORB families)
- `src/server/services/bias-state-service.ts:1-60` — daily picks active strategy per
  symbol (MES/MNQ/MCL) from DB via picker scoring, emits `bias_state` rows + SSE
- `src/server/services/picker-metrics.ts` — `computePickerScores` selects from the
  deployed library
- Migrations: `0095_bias_engine_shadow.sql`, `0112_wave23_bias_state.sql`,
  `0114_bias_state_multi_symbol.sql`, `0120_multi_regime_strategies.sql`,
  `0122_bias_state_position_lock.sql`, `0132_hmm_regime_overlay.sql`
- 20+ strategy archetypes in `src/engine/strategies/` (ote, breaker, judas_swing, etc.)

**Verdict:** I missed this in the first draft. Mea culpa. The CLAUDE.md §1 "scale ONE
strategy" line refers to the **target** strategy that gets pyramided to maximum size, not
to your full deployed library. The library + bias playbook router runs many strategies in
parallel and picks the right one per bias/regime, exactly like Evan Shunk's 6-pattern
setup. Closed.

### ✅ Claim 7 — Strategy Factory Funnel Dashboard — YOU ALREADY HAVE THIS
**Where it lives:**
- Backend: `src/server/services/funnel-metrics-service.ts:14-60` — `computeFunnelMetrics()`
  returns per-stage counts (scouted / tested / promoted / paper / deployReady / deployed
  / archived / failed) + conversion rates (scouted_to_tested, etc.) — exactly the Noel T /
  SQX attrition view I claimed missing
- Route: `src/server/routes/metrics.ts:21-25` — `GET /api/metrics/funnel`
- Frontend page: `Trading_forge_frontend/amber-vision-main/src/pages/ForgeFactory.tsx`
  consumes it

**Verdict:** Closed.

---

## What you partially have (real but not complete)

### 🟡 Claim 2 — Parameter Robustness — YOU HAVE OPTUNA-BASED, NOT THE ±20% NAMED BATTERY
**What's there:**
- `src/engine/robustness.py:15-76` — `analyze_optuna_study()` computes "plateau variance"
  and `is_robust` across top 15% of Optuna trials. This IS a Sharpe-degradation-style
  robustness check.
- `src/server/services/robustness-service.ts:48-99` runs it as `agent.robustness`
- `src/engine/cross_validation.py` exists
- n8n workflow `Monthly_Robustness_Check` exists (`workflows/n8n/Monthly_Robustness_Check_RIK5eQ0rFEG78Vtd.json`)

**What's missing:** No deliberate ±20% parameter jitter test producing the explicit named
QuantForgeAnalytics triplet — SDR (Sharpe Degradation Ratio), PSI (Parameter Sensitivity
Index), RWS (Rolling Window Stability). Your robustness comes from Optuna trial dispersion
which is a related but different signal.

**Reframed recommendation:** Either (a) call your existing Optuna plateau robustness "good
enough" — it catches knife-edge fragility, just measures it differently — OR (b) add an
explicit ±20% jitter battery as a second axis. NOT urgent if Optuna trials already span the
parameter space.

### 🟡 Claim 3 — Signal Starvation Alarm — YOU HAVE SCOUT-SIDE, NOT EXECUTION-SIDE
**What's there:**
- `src/server/routes/scout-health.ts:20-50` returns `strategiesProducedToday`,
  `scoutsBySourceLast7d`
- `src/server/services/scout-watchdog-service.ts` is the live alarm
- Frontend: `ScoutHealthCard.tsx` + `useScoutHealth.ts` hook
- SSE: `scout-health:reject-spike` / `scout-health:no-strategies-today` (per System Map)

**What's missing:** This monitors **scout / strategy production** — "is my factory making
new candidates?" It does NOT specifically watch "did my DEPLOYED strategies fire zero
signals today on the trading path?" Wave 25 W25.1 weighted scoring is going to reduce A+
firing rate 30-50% by design; if it overshoots, the deployed-strategy path could go silent
and your scout-health panel would still be green.

**Reframed recommendation:** Add a `deployed_strategy_signal_frequency` watchdog
(symmetric to scout-watchdog). Cron every 4h RTH. If zero entries 5 RTH days AND non-zero
candidates → "score-threshold too tight." Half a day of work. **Ship with Wave 25 Pass 1.**

### 🟡 Claim 8 — Broker Error Budget — YOU HAVE EVENTS, NOT THE AGGREGATOR
**What's there:**
- `src/server/services/broker-router.ts:180` — `broker_router.route_rejected` audit event
- Line 420 — `compliance_rejected`
- Line 440 — SSE `compliance:rejected`
- All rejections written to `audit_log`
- Multi-firm broker routing tested (`wave23h-c2-multi-firm.test.ts`)

**What's missing:** No analytical roll-up that groups by `rejection_class` per broker into
an error-budget view. The raw events exist; nobody aggregates them. No file matches
`broker_error_budget` or `rejection_class`.

**Reframed recommendation:** Wave 26 candidate. Add a service that queries
`audit_log WHERE action IN (broker_router.route_rejected, compliance_rejected)` grouped by
failure_class over rolling 24h. Frontend panel under `dashboard/`. ~1 day.

---

## What's actually missing (genuine gaps)

### 🔴 Claim 4 — Webhook Latency Monitor — TRUE GAP
**Verified absent:** Grep across `src/server/`, `src/server/services/`, `audit_log` action
strings, and SSE event inventory returned ZERO matches for `webhook_latency`,
`traderspost_latency`, `fire_to_ack`, or any per-alert timing aggregation.
`alert-service.ts:174` only emits silence-duration alerts (not per-webhook timing).
Circuit-breaker handles retries but not p50/p95 latency tracking.

**Why it matters:** Pine alert → TradingView → TradersPost → broker has documented latency
problems in the Reddit operator community. During your current TradersPost era you have no
visibility into whether fills are slow. Goes away when TopstepX direct lands.

**Effort:** ~0.5 day. Add `webhook_fire_to_broker_ack_ms` to audit_log. Wave 26 candidate.

### 🔴 Claim 9 — Regime Coverage Cron — TRUE GAP
**Verified absent:** The infrastructure is all there:
- Schema has `preferredRegimes` array (`src/server/db/schema.ts:68`)
- `bias-state-service.ts:120` reads it to pick today's strategy
- `src/server/services/portfolio-optimizer-service.ts:1-50` runs correlation analysis

But no file/cron computes "for each regime in {TRENDING_UP, RANGE_BOUND, EXPANSION,
COMPRESSION, HIGH_VOL_MACRO, LOW_LIQ_CHOP}, count deployed strategies covering it; alarm
if zero."

**Why it matters:** If your deployed library is heavy on TRENDING_UP strategies and market
shifts to RANGE_BOUND, the bias playbook router has nothing to pick. Silent zero-trades.

**Effort:** ~0.5 day. Wave 26 candidate. Becomes more important AFTER Wave 25 Pass 6
(W25.10 5-regime expansion) since coverage gaps get more likely with more regimes.

### 🔴 Claim 10 — Payout Audit Packet Generator — TRUE GAP
**Verified absent:** You have audit infrastructure piecemeal (`audit_log` table,
`audit-log-helper.ts`, `agent-audit-service.ts`, `graduated-strategy-auditor.ts`,
`discord-fanout-audit-service.ts`, multiple `scripts/` like graduation-rate-audit,
audit-graduated-strategy-dsls). But **no ZIP / bundle / packet generator**. No match for
`tamper_evident`, `hash_chain`, `audit_bundle`, `payout_dispute`, `evidence_bundle`. The
audit_log is append-via-helper but no hash-chain integrity.

**Why it matters:** Real Reddit cases: OFP Funding denied payout at 1.02% drawdown (Case
2818, 2026-02-07), Lucid Trading "fraud" ban (2026-05-14). Operators lost payouts because
they couldn't produce structured evidence fast enough. You have the underlying data; just
no bundler.

**Effort:** ~1 day. Wave 26 candidate.

### 🟡 Claim 11 — "No LLM on Execution Path" — TRUE IN CODE, NOT WRITTEN DOWN
**Code verification:**
- `paper-signal-service.ts` — zero LLM imports (the only "claude" match is a comment
  citing CLAUDE.md §6)
- `paper-execution-service.ts` — zero openai/anthropic/ollama/gpt/claude/llm
- `broker-router.ts` — zero
- `production/kill-switch.ts` — zero

**Docs verification:** No pinned rule in CLAUDE.md, AGENTS.md, or the Known-Facts Pin
section of AGENT-LOGS.md saying "no LLM on execution path."

**Fix:** 5 minutes to add the pin so a future agent doesn't break the invariant. Backed by
r/algotrading 2026-03-07 (Jetson Nano operator who learned this over 2 years).

---

## Updated count

| Original claim | Verified verdict | Action |
|---|---|---|
| 1. Sequence reorder MC | ✅ Already exists | — |
| 2. Parameter robustness battery | 🟡 Partial (Optuna-based, not named SDR/PSI/RWS) | Optional add |
| 3. Signal starvation alarm | 🟡 Scout-side yes, execution-side no | Wave 25 Pass 1 — 0.5d |
| 4. Webhook latency monitor | 🔴 True gap | Wave 26 — 0.5d |
| 5. Decay velocity | ✅ Already exists (more sophisticated than I credited) | — |
| 6. Multi-strategy / deploy library / bias playbook | ✅ Already exists (I missed it) | — |
| 7. Factory funnel dashboard | ✅ Already exists (`funnel-metrics-service.ts` + `ForgeFactory.tsx`) | — |
| 8. Broker error budget panel | 🟡 Events exist, aggregator doesn't | Wave 26 — 1d |
| 9. Regime coverage cron | 🔴 True gap | Wave 26 — 0.5d (becomes more important after W25.10) |
| 10. Payout audit packet | 🔴 True gap | Wave 26 — 1d |
| 11. No-LLM-on-execution rule | 🟡 True in code, undocumented | 5 minutes |

**Real gap count: 3 true gaps + 3 partials + 1 documentation pin.**
**Not "11 things you're missing" — only 4-5 things worth shipping.**

---

## Revised recommendations

### Wave 25 Pass 1 ship-with addition
**Deployed-strategy signal starvation watchdog** (Claim 3 reframed). Wave 25 W25.1
weighted scoring intentionally drops A+ rate 30-50%. Without an execution-side starvation
alarm to complement your existing scout-side one, you could silently go from "scout
producing strategies daily" to "deployed strategies firing zero signals" without knowing
which one broke. Half a day. Use the same SSE/Discord wiring scout-watchdog uses.

### Wave 26 backlog (in priority order)
1. **Regime coverage cron** (Claim 9) — 0.5d. Especially important after W25.10 5-regime
   expansion.
2. **Webhook latency monitor** (Claim 4) — 0.5d. Sunsets when TopstepX direct path lands.
3. **Broker error budget aggregator + panel** (Claim 8) — 1d. Reuses existing
   `broker_router.route_rejected` + `compliance_rejected` events.
4. **Payout audit packet generator** (Claim 10) — 1d. Pure read-side aggregation.

### Optional (judgment call)
- **±20% parameter jitter battery on top of Optuna** (Claim 2) — 1-2d. Only if you decide
  the QuantForge SDR/PSI/RWS metric naming is worth adopting on top of existing Optuna
  plateau variance.

### 5-minute add
- **Pin "no LLM on execution path" in AGENT-LOGS.md Known-Facts section** (Claim 11). The
  invariant holds today; just document it.

### Removed from recommendations
- ❌ Sequence Reorder MC — you have it (`monte_carlo.py:93`)
- ❌ Decay Velocity quantification — you have it (`sub_signals.py:11`)
- ❌ Multi-strategy framework discussion — you have it (`playbook_router.py` +
  `bias-state-service.ts`)
- ❌ Strategy Factory Funnel Panel — you have it (`funnel-metrics-service.ts` +
  `ForgeFactory.tsx`)

---

## Honest assessment of the previous drafts

Both prior versions of this report claimed "gaps" based only on the transcripts and
external research, without verifying against your actual code. The audit shows I was wrong
on 4 of 11 — you had `monte_carlo.py:93` `trade_resample()`, `decay/sub_signals.py:11`
`sharpe_decay()`, `playbook_router.py` + `bias-state-service.ts`, and
`funnel-metrics-service.ts` + `ForgeFactory.tsx` the whole time.

Trading Forge is even further ahead of the operators I researched than I claimed. The
real gap list is much shorter: 3 true gaps, 3 partials, 1 doc pin. That's what's actually
worth shipping.

---

## Raw research preserved

All 30 raw research files still under `docs/research-raw/*.json` (10 video transcripts + 20
web/Reddit searches). Detailed technical version with operator stack comparisons under
`docs/wave25-bot-case-studies-research.md` — that version also needs a similar
verification pass; treat its "gaps" section as superseded by this PLAIN file.
