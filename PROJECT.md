# Trading Forge Project

## What Trading Forge Is

Trading Forge is a private autonomous quant research and strategy qualification engine for futures and prop-firm trading.

It continuously discovers strategy ideas, converts them into testable logic, validates them, backtests them, stress-tests them, paper trades them, and prepares only the best strategies for human-approved TradingView/ATS deployment.

It is not a generic trading chatbot. It is not a SaaS product. It is a single-user automation system.

## Core Mission

**Find one futures strategy that clears $10,000/month net on a single 50K prop-firm account** via ATS automation, surviving:

- realistic execution costs (commissions, slippage, fill rates)
- prop-firm drawdown, consistency, and buffer-phase rules
- out-of-sample walk-forward testing
- Monte Carlo path randomness
- changing market regimes
- paper-trading/live-vs-backtest drift

A strategy that needs multi-account scaling to matter is rejected. Profit is never assumed — it must be proven by the pipeline.

## Current Phase: Production Hardening Only

All build phases are done (Phases 4.6–4.15 + enterprise upgrade + autonomy upgrade complete). The only remaining work is hardening:

- Pipeline + lifecycle bulletproof — no orphan states, no silent drops, atomic transitions, full audit
- n8n production-ready — retry, idempotency, errorWorkflow, dedupe, no execution backlog
- Every built subsystem wired into the live pipeline or deleted (no shelfware)
- Zero bugs, errors, or disconnects across Node ↔ Python ↔ n8n ↔ Postgres ↔ frontend
- Strategies, indicators, services, migrations, workflows organized — no duplicates, no half-finished refactors
- No overkill — prefer deletion over abstraction

No new subsystems. No Phase 4.16. New work is justified only when it closes a disconnect or removes a bug.

## Always-On n8n Layer

n8n is permanent and should stay online even when the Trading Forge engine is paused.

n8n responsibilities:

- scout strategy ideas
- run scheduled research loops
- feed the Strategy page candidate backlog
- monitor workflow health
- sync workflow inventory
- report failures
- trigger OpenClaw daily reporting
- maintain evidence while Trading Forge is in pre-production

The Trading Forge on/off button controls engine authority, not n8n existence.

When Trading Forge is OFF, the Strategy page should still receive n8n-fed ideas and show them as ready-to-test candidates. When Trading Forge is ON, queued Strategy page candidates can move into compiler, validation, backtest, Monte Carlo, compliance, and paper-trading gates.

## OpenClaw

OpenClaw is the assistant watching n8n.

OpenClaw is responsible for daily reports about:

- n8n active workflows
- execution health
- strategy discoveries
- failed workflows
- stale workflows
- pipeline backlog
- blockers to beta/production

OpenClaw should summarize n8n and Trading Forge status, not generate random Discord content.

## Pipeline Authority

Trading Forge has staged authority:

1. Intake: always on through n8n/OpenClaw.
2. Research: strategy ideas are collected, deduped, and surfaced on the Strategy page.
3. Compile: ideas become deterministic DSL or class strategy definitions.
4. Validate: compiler/static/runtime/spec validation.
5. Backtest: Python engine, futures math, slippage, fees, walk-forward.
6. Monte Carlo: survival, drawdown, tail risk, prop-firm breach probability.
7. Compliance: prop-firm rules and drift checks.
8. Paper: live-data paper trading with parity to backtest logic.
9. Deploy Ready: strategy is ready for user review.
10. TradingView Deploy: human approval only.

## Tournament Gating

The 4-role adversarial tournament (Proposer → Critic → Prosecutor → Promoter) runs in n8n workflows, NOT in the Node service layer. The in-process `agent-service.runStrategy()` loop intentionally skips tournament checks; orchestration is canonical in n8n. See CLAUDE.md "Tournament Gating (n8n-canonical)" for the disconnect implications when running the Node loop without n8n.

## Systems And Subsystems

Major systems:

- n8n orchestration
- OpenClaw n8n assistant
- AI strategy proposer/critic loop
- compiler and validation layer
- Python backtesting engine
- walk-forward engine
- Monte Carlo and quantum challenger lab
- prop-firm compliance engine
- strategy lifecycle engine
- graveyard anti-memory
- paper trading engine
- risk/skip engine
- DeepAR regime forecasting
- metrics and observability
- Discord reporting
- Pine/TradingView export compiler

## Production Rule

The system is beta-ready only when:

- live n8n active workflow truth is correct
- n8n errors are known and controlled
- OpenClaw daily reports are structured
- DB migrations are current
- backtest, Monte Carlo, and paper tests pass
- runtime evidence is fresh
- Discord reporting is deduped
- deployment remains human-controlled
