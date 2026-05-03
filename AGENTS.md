# Trading Forge Agent Contract

## Mission

Trading Forge is an autonomous futures strategy research, validation, paper-trading, and ATS-export pipeline for prop-firm trading.

The business target is concrete and non-negotiable: **find one strategy that clears $10,000/month net on a single 50K prop-firm account** after fees, commissions, slippage, firm rules, buffer phase, and payout splits. A strategy that requires multi-account scaling is rejected. Agents must never fake profitability. The gates decide.

## Current Phase: Production Hardening Only

All build phases are done. No new subsystems, no Phase 4.16, no greenfield features. The only remaining work is:

- Pipeline + lifecycle bulletproof (no orphan states, no silent drops, atomic transitions)
- n8n production-ready (retry, idempotency, errorWorkflow, dedupe)
- Every built subsystem either wired into the live pipeline or deleted
- Zero bugs, errors, disconnects across Node ↔ Python ↔ n8n ↔ Postgres ↔ frontend
- Strategies, indicators, services, migrations, workflows organized — no duplicates, no shelfware
- No overkill — prefer deletion over abstraction; small fixes stay small

Agents must reject feature-add suggestions and reframe work as hardening, integration, organization, or deletion.

## Validation Cadence — Forcing Function (HARD RULE, C7 / W16)

**No new infrastructure work, refactor, or subsystem proposal is approved while
the Validation Cadence panel is RED.**

The panel turns RED when ANY of these conditions hold:

- Days Since Last Live Backtest > `VALIDATION_CADENCE_RED_THRESHOLD_DAYS` (default 7)
- Strategies Tested End-to-End This Month < `VALIDATION_CADENCE_MIN_STRATEGIES_PER_MONTH` (default 1)
- Reality Check Score < 50 / 100

**"Tested end-to-end this month" means the strategy crossed at least into PAPER
state (PAPER, DEPLOY_READY, PILOT, or DEPLOYED) via `lifecycle_transitions` in
the current calendar month.** A strategy that bounces TESTING ↔ TESTING does NOT
count. Backtest-only does NOT count. The pipeline must complete end-to-end.

**Why this rule exists:** Most common failure mode for sophisticated solo
operators. Reddit/Medium documents traders who built elaborate infrastructure
for 3-6 months and never deployed live. December 2025: 100+ elaborate
backtested systems all hit Sharpe 0.0 on regime change — built over months,
all worthless because never validated live. This rule exists to prevent that
exact failure mode in Trading Forge.

**Operator override path:** the threshold is tunable via env vars
(`VALIDATION_CADENCE_RED_THRESHOLD_DAYS`, `VALIDATION_CADENCE_MIN_STRATEGIES_PER_MONTH`).
Operators may raise the threshold for documented reasons (e.g. deliberate
research period). They MAY NOT silently bypass the panel.

**Inspection commands:**
- Live state: `GET /api/validation-cadence/dashboard`
- Manual report: `POST /api/validation-cadence/reality-check`
- Dashboard component: `Trading_forge_frontend/amber-vision-main/src/components/forge/ValidationCadencePanel.tsx`
- Service: `src/server/services/validation-cadence-service.ts`
- Monthly cron: `validation-cadence-monthly` (1st of each month, 3:30 AM UTC,
  bypasses pipeline-pause gate)

**When the panel is RED:** stop all infrastructure work and run a strategy
through the full pipeline (CANDIDATE → TESTING → PAPER → …). Once the
lifecycle transition lands, the counter resets and infrastructure work
resumes. The system is engineered to make this the path of least resistance.

## Operating Model

n8n and OpenClaw are always on. They are the intake layer and eyes of the system.

Trading Forge itself has an on/off control:

- OFF / pre-production / paused: n8n keeps discovering strategies, logging ideas, monitoring health, and feeding the candidate backlog.
- ON / active: queued strategy candidates flow through compiler, validation, backtest, Monte Carlo, compliance, paper trading, lifecycle, and deployment-prep gates.
- Deployment to TradingView is always human-approved only.

Agents must not turn n8n off as part of pausing Trading Forge. Pause should stop promotion/execution authority, not strategy intake or n8n monitoring.

The Strategy page is the operator-facing backlog for n8n-fed strategies. When Trading Forge is OFF, strategies found by n8n should still appear there as ready-to-test candidates. When the system is turned ON, those queued candidates can enter the full testing pipeline.

## n8n Source Of Truth

If MCP/API access exists, always query live n8n before reporting workflow counts or health.

Active workflow count means:

```ts
active === true && isArchived !== true
```

Never use total workflow records, archived records, local JSON file counts, historical reports, or stale generated docs as active workflow truth.

Current audited snapshot on 2026-04-24: 26 active workflows. This is a snapshot, not a hard-code.

## OpenClaw Role

OpenClaw is the n8n assistant for Trading Forge.

OpenClaw must report:

- daily n8n health
- active workflow count from live n8n
- failed executions
- stale workflows
- strategy discoveries found by n8n
- strategy candidates sent into Trading Forge
- backtest / validation / paper status when available
- critical blockers and next fixes

OpenClaw must not post random trading education, generic assistant chatter, raw JSON commentary, or unrelated topics to Discord.

## Strategy Pipeline

Strategy intake can come from OpenClaw, n8n scouts, Ollama/GPT, human ideas, tournament workflows, or research sources.

Canonical path:

```text
OpenClaw/n8n scout
  -> /api/agent/scout-ideas
  -> Strategy page / idea backlog
  -> DSL/compiler
  -> validation
  -> backtest
  -> walk-forward
  -> Monte Carlo
  -> prop compliance
  -> lifecycle
  -> paper trading
  -> DEPLOY_READY
  -> human TradingView deploy
```

The system never auto-deploys to TradingView.

## Strategy Standards

Agents must prefer simple, robust strategies:

- max 3-5 parameters
- one-sentence edge thesis
- no tight optimization dependency
- realistic slippage and commissions
- walk-forward out-of-sample validation required
- Monte Carlo survival required
- prop-firm drawdown and consistency rules required
- paper-trading parity required before deployment
- no concurrent correlated positions (correlation > 0.70 per `src/engine/compliance/correlation_matrix.yaml`)
  Cross-market lead-lag signals (Tier 3.3) are legal IF the lagging market entry is sequential —
  i.e., the lead-market position must be CLOSED before the lagging-market entry fires.
  Prop firms ban simultaneous correlated positions as a position-limit-bypass violation.
  Enforcement: `check_correlated_position_guard()` in `compliance_gate.py` and
  `checkCorrelatedPositionGuard()` in `correlated-position-guard.ts` (paper gate).

Below-threshold strategies go to the graveyard, not deployment.

## Lifecycle Hard Gates (W9–W19)

Agents must NOT propose bypasses for any of these gates. They are defense-
in-depth — different stages catch different failure modes. Full contract
documentation lives in CLAUDE.md.

- **C9 DSL Diversity (pre-backtest):** mode-collapsed LLM strategies are
  rejected before backtest compute is spent. Cosine similarity > 0.85 vs
  any of the last 50 accepted strategies → reject. Catches LLM "same
  template, new name" duplication.
- **A4 Frankenstein (TESTING → PAPER):** randomization gate. Strategies
  whose Sharpe survives N-shuffle randomization are rejected (no edge,
  just curve-fit luck). `passed=true` REQUIRED to advance to PAPER.
- **A7 Signal Correlation (PAPER → DEPLOY_READY):** empirical signal
  cosine vs DEPLOYED strategies. > 0.85 → reject. Catches "different code,
  same signal" — the Two Sigma duplicate-signal failure mode. Pairs with
  C9 (different stage, different failure mode).
- **C11 Macro Hard Gates (paper signal):** `prob_crisis > 0.60` blocks new
  ES/NQ longs > 2hr. ISM<49 + RRP<$20B blocks new ES/NQ longs. FOMC ±1
  day halves position size. Macro release windows block new entries
  (1hr before to 3hr after). Existing positions HELD, never auto-closed.
- **B10 MRP soft gate (PAPER → DEPLOY_READY):** `mrp_sharpe < 0.5` logs
  advisory; hard-gates after 30 days of MRP data. Strategies fragile
  under regime rotation get flagged here.
- **C1 / C2 Safety blocks (live execution):** CME outage detection blocks
  new entries during halts; positions HELD. Per-firm suspension detection
  blocks new entries on the affected firm only.
- **C8 Windows pre-market check (8 AM ET):** any non-zero exit code
  flips pipeline-control to PAUSED (fail-CLOSED). Operator must explicitly
  resume after reviewing `infra/windows-update-policy.md`.

## PILOT Canary State (W14 / B8)

Agents must NOT promote DEPLOY_READY → DEPLOYED directly when a PILOT
canary makes sense. The canonical promotion path is:

  DEPLOY_READY → PILOT (human only, 5 sessions, 1 contract clamp)
  PILOT → DEPLOYED (AUTOMATIC on rolling Sharpe ≥ 1.0 + all 5 sessions
                    compliance-passed)
  PILOT → GRAVEYARD (AUTOMATIC if any kill switch fires OR criteria fail
                     at session 5)

Direct DEPLOY_READY → DEPLOYED remains supported for legacy migrations,
but new strategies should go through PILOT.

## Constraint: Trading Forge Is PRIVATE

Trading Forge is a single-operator system — no SaaS, no marketplace, no
monetization. Reject any feature suggestion framed around selling,
licensing, or distributing strategy artifacts. The B9 Pine Marketplace
component was REMOVED 2026-05-03 (commit `6740db2`) for this reason. Pine
export remains available strictly for the operator's personal TradingView
indicator use.

## Hosting / Cost Posture

- Railway is the PAID $20/month plan. Do not assume "free-tier $5 credit
  window" constraints — those are obsolete.
- Skytech is primary compute. Railway is emergency failover (B6 in
  `src/server/lib/compute-failover.ts`).
- Free-tier dependencies kept by design: Bitwarden CLI (C6 vault), phone
  USB tethering (C4 network failover backup), free govt APIs (C11 macro
  overlay: FRED / BLS / TreasuryDirect).
- Other free tiers (Fly.io, Cloudflare Workers, IBM Quantum) remain in use
  as secondary fallbacks; cost discipline still applies elsewhere.

## Backtest / Data Truth

Backtests are only meaningful if:

- data is correct, adjusted, and fresh
- futures P&L math is correct
- commissions/slippage are included
- walk-forward/OOS metrics are used
- no lookahead bias exists
- prop-firm constraints are applied
- audit logs and DB persistence are working

Do not claim production readiness from unit tests alone.

## Discord Reporting

Discord is an operator reporting surface, not the source of truth.

Required channels or routes:

- n8n daily report
- strategy finds
- workflow errors
- critical alerts
- paper/deployment-ready summaries

All alerts need dedupe/cooldown. No spam.
