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

Below-threshold strategies go to the graveyard, not deployment.

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
