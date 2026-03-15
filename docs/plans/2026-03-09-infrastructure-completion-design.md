# Infrastructure Completion Design: Pre-Phase 0 + Phase 0 + Phase 1 Gaps

**Date:** 2026-03-09
**Status:** Approved

## Decision: Raw Python Code Path (Option B)

Agent routes accept `python_code` as a string from Ollama/n8n. This requires a new code path in the backtest engine alongside the existing structured `BacktestConfig` approach. More flexible for LLM-generated strategies.

## Components

1. **Ollama Modelfile** (`ollama/Modelfile.trading-quant`) — FROM qwen3-coder:30b, system prompt for strategy generation with JSON output format
2. **Ollama HTTP Client** (`src/server/services/ollama-client.ts`) — Thin wrapper around localhost:11434, native fetch, 120s timeout
3. **Agent Service** (`src/server/services/agent-service.ts`) — runStrategy, critiqueResults, batchSubmit, scoutIdeas. Bridges Ollama -> backtest -> DB
4. **Agent Routes** (`src/server/routes/agent.ts`) — 4 POST endpoints at /api/agent/* for n8n webhook integration
5. **n8n Workflows** (4 workflows via MCP) — Nightly research, on-demand generation, weekly hunt, monthly robustness
6. **Lambda + EventBridge** (`infra/`) — CDK stack for nightly data fetch

## Key Decisions

- Sequential batch processing (avoid GPU contention with Ollama)
- llama3:8b for critique (fast), trading-quant for generation
- n8n -> host via `host.docker.internal:4000`
- Reuse existing runBacktest() from backtest-service.ts
- CDK TypeScript for AWS infra
