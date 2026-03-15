# Trading Forge — Build Plan

> Backend first. Dashboard last. Every phase has a clear deliverable.

---

## The Stack

```
Backend (you build first)          Dashboard (Lovable builds last)
─────────────────────────          ────────────────────────────────
Express.js 5 + TypeScript          React + Vite + TailwindCSS
PostgreSQL + Drizzle ORM           shadcn/ui (restyled dark amber)
Python + vectorbt + Polars         lightweight-charts + Recharts
Ollama + n8n (local AI lab)        Framer Motion animations
AWS S3 (Parquet data lake)         Lucide React icons
```

---

## Build Order (9 Phases)

### PHASE 0 — Foundation ✅ DONE
> Express server, Drizzle schema, strategy CRUD, auth middleware

- [x] Monorepo structure
- [x] Drizzle ORM + PostgreSQL schema (strategies, backtests, trades, MC, alerts, audit_log)
- [x] Express server with strategy CRUD routes
- [x] Bearer token auth middleware
- [x] Dev tooling (tsx, eslint, vitest)
- [x] Data fetcher adapters (Databento, Massive, Alpha Vantage)

**Deliverable:** Server runs, CRUD works, migrations work.

---

### PHASE 1 — Data Pipeline ✅ DONE
> Download historical futures data, store in S3, serve via API

- [x] **1.1** Databento bulk download (ES, NQ, CL — 5 years)
- [x] **1.1a** Ratio-adjusted continuous contracts (remove roll gaps)
- [x] **1.2** S3 upload pipeline (raw + adjusted Parquet)
- [x] **1.3** Alpha Vantage indicator fetcher (RSI, MACD, Bollinger, ATR)
- [x] **1.4** Market data API endpoints
  ```
  GET  /api/data/symbols          — available symbols
  GET  /api/data/:symbol/ohlcv    — OHLCV bars with timeframe/range params
  GET  /api/data/:symbol/info     — metadata (earliest, latest, records)
  POST /api/data/fetch             — trigger new data download
  ```
- [x] **1.5** DuckDB for querying S3 Parquet directly (no full download needed)

**Deliverable:** 5 years of ES/NQ/CL data in S3. API serves it. $125 Databento credits spent wisely.

---

### PHASE 2 — Backtest Engine ✅ DONE
> Python backtest engine with vectorbt, walk-forward validation, prop firm compliance

- [x] **2.1** vectorbt backtest runner (accepts JSON config from Express)
- [x] **2.2** Strategy templates (trend following, mean reversion, breakout, session)
- [x] **2.3** Walk-forward validation (mandatory — no in-sample-only results)
- [x] **2.4** Dynamic position sizing (ATR-based, not fixed contracts)
- [x] **2.5** Slippage as a variable (scales with ATR, not constant)
- [x] **2.6** Backtest API endpoints
  ```
  POST /api/backtests/run          — run backtest (async, returns job ID)
  GET  /api/backtests              — list all runs
  GET  /api/backtests/:id          — results + equity curve + trades
  GET  /api/backtests/:id/trades   — individual trade list
  ```
- [x] **2.7** Performance gate enforcement (hard minimums from CLAUDE.md)
  ```
  $250/day avg  |  60% win days  |  1.75 profit factor
  $2K max DD    |  4 max losing streak  |  $75 expectancy/trade
  ```

**Deliverable:** Run a backtest via API, get equity curve + trades + pass/fail verdict.

---

### PHASE 3 — Monte Carlo & Risk (Week 8-9) ✅ DONE
> Validate strategies survive randomness, stress test against historical crises

- [x] **3.1** Monte Carlo simulation engine (10,000 sims default)
- [x] **3.2** Forge Score calculator (0-100 composite)
- [x] **3.3** Crisis stress testing (8 scenarios: 2008, Flash Crash 2010, COVID, 2022 rates, etc.)
- [x] **3.4** Monte Carlo API
- [x] **3.5** Time-of-day liquidity profiles (session-based slippage multipliers)
- [x] **3.6** Economic calendar filter (FOMC/CPI/NFP)
- [x] **3.7** Overnight gap risk model
- [x] **3.8** Fill probability model
- [x] **3.9** Per-firm commission modeling
- [x] **3.10** Firm contract cap enforcement

**Deliverable:** Every strategy gets a Forge Score. MC fan chart shows survival probability. Backtest realism hardened.

---

### PHASE 3.5 — ICT Indicators & Strategies ✅ DONE
> 54 ICT/SMT indicators + 19 ICT strategies for institutional-grade trade models

- [x] **3.5.1** Unified BaseStrategy protocol (`strategy_base.py`)
- [x] **3.5.2** ADX + ADR indicators (added to `indicators/core.py`)
- [x] **3.5.3** Market structure indicators (6: swings, BOS, CHoCH, MSS, premium/discount, equilibrium)
- [x] **3.5.4** Price delivery indicators (6: FVG, IFVG, CE, volume imbalance, opening gap, liquidity void)
- [x] **3.5.5** Session indicators (10: 5 killzones, macro times, day profile, quarterly theory, TDO, midnight open)
- [x] **3.5.6** Order flow indicators (6: bullish/bearish OB, breaker, mitigation, rejection, propulsion)
- [x] **3.5.7** Liquidity indicators (7: BSL, SSL, EQH, EQL, sweep, inducement, raid)
- [x] **3.5.8** Fibonacci indicators (4: retracement, OTE zone, extensions, auto swing fib)
- [x] **3.5.9** SMT indicators (7: cross-instrument divergence detection)
- [x] **3.5.10** ICT Strategies Wave 1 (9: Silver Bullet, Unicorn, ICT 2022, Power of 3, Turtle Soup, OTE, Breaker, London Raid, Judas Swing)
- [x] **3.5.11** ICT Strategies Wave 2 (10: NY Lunch Reversal, IOFED, ICT Swing, ICT Scalp, SMT Reversal, Propulsion, Mitigation, Quarterly Swing, EQH/EQL Raid, Midnight Open)

**Deliverable:** 54 composable ICT indicators + 19 backtestable ICT strategies sharing the unified BaseStrategy interface.

---

### PHASE 4 — AI Research Agents (Week 10-12) ✅ DONE
> Ollama generates strategies, Trading Forge validates them, n8n orchestrates the loop

- [x] **4.1** Custom Ollama Modelfile (`trading-quant` — qwen3-coder:30b)
- [x] **4.2** Strategy generation agent (outputs vectorbt code + JSON params)
- [x] **4.3** Critique agent + Parameter robustness (Optuna TPE, 800 trials)
- [x] **4.4** n8n workflows: Nightly Research, Weekly Hunt, Strategy Gen Loop, Monthly Robustness, Daily Portfolio Monitor
- [x] **4.5** Agent webhooks + new API endpoints
  ```
  POST /api/agents/analyze-market   — regime detection
  POST /api/agents/robustness       — parameter robustness test
  POST /api/agents/find-strategies  — strategy finder
  GET  /api/agents/jobs             — list active/recent jobs
  GET  /api/agents/jobs/:id         — job status + results
  ```
- [x] **4.6** Regime detection (ADX + ATR percentile classification — 6 regimes)
- [x] **4.7** Strategy lifecycle state machine (CANDIDATE → TESTING → PAPER → DEPLOYED → DECLINING → RETIRED)
- [x] **4.8** Pipeline health monitoring (`GET /api/strategies/pipeline`)

**Deliverable:** Ollama generates strategies, Forge validates them, regime-aware lifecycle manages deployment. Zero manual work.

---

### PHASE 4.5 — OpenClaw Strategy Scout (Week 12-13) ⬅ CURRENT
> Autonomous research agent that discovers strategy ideas from the web

- [ ] **4.5.1** OpenClaw integration (Brave Search, Reddit MCP, Tavily, YouTube MCP, Academic MCP)
- [ ] **4.5.2** Idea ingestion pipeline (raw ideas → Ollama summarizes → JSON → n8n webhook)
- [ ] **4.5.3** Source tracking + hit rate metrics (Academic > Reddit > YouTube > Brave expected)
- [ ] **4.5.4** Scout webhook
  ```
  POST /api/agent/scout-ideas      — receive discovered ideas
  GET  /api/agent/discoveries      — list all discoveries + status
  ```

**Deliverable:** Self-feeding research pipeline. You review winners, not generate ideas.

---

### PHASE 5 — Dashboard in Lovable (Week 14-15)
> Premium dark UI built in Lovable. Backend is done — this is the visual layer.

**See:** `docs/LOVABLE-DESIGN-SPEC.md` for complete design system
**See:** `docs/LOVABLE-PROMPT.md` for the copy-paste prompt

- [ ] **5.1** Core layout (sidebar + top bar + page routing)
- [ ] **5.2** Dashboard overview (KPI cards, equity curve, recent trades, alerts)
- [ ] **5.3** Strategy pages (library grid, detail view with tabs)
- [ ] **5.4** Backtest pages (run history table, detail with charts)
- [ ] **5.5** Monte Carlo page (fan chart, risk metrics)
- [ ] **5.6** Data pipeline status page
- [ ] **5.7** AI agents page (discovery funnel, agent status)
- [ ] **5.8** Charting integration (lightweight-charts for price, Recharts for analytics)
- [ ] **5.9** Settings page (API keys, alerts, data sources)

**Deliverable:** Full dashboard connected to your Express API. Monitor everything from the browser.

---

### PHASE 6 — Live Paper Trading (Week 16-17)
> Forward-test strategies with real-time data, no real money

- [ ] **6.1** Massive WebSocket client (real-time quotes)
- [ ] **6.2** Virtual account engine (configurable capital, realistic fills)
- [ ] **6.3** Strategy executor (load active strategies, generate signals, execute virtual trades)
- [ ] **6.4** Execution quality tracker (expected vs actual fill, slippage logging)
- [ ] **6.5** Alpha decay monitor (30-day rolling Sharpe)
- [ ] **6.6** Live vs backtest drift detection (>1 std dev = investigate, >2 = alert)
- [ ] **6.7** Multi-strategy portfolio manager (correlation < 0.3, portfolio heat tracking)
- [ ] **6.8** Paper trading API
  ```
  POST /api/paper/start             — start session
  POST /api/paper/stop              — stop session
  GET  /api/paper/sessions/:id      — live P&L
  GET  /api/paper/positions         — open positions
  GET  /api/paper/trades            — trade history
  ```
- [ ] **6.9** SSE (Server-Sent Events) for real-time dashboard updates
- [ ] **6.10** Dynamic correlation monitoring (daily recalc, alert when corr spikes > 0.5 during vol events)
- [ ] **6.11** Proactive decay prediction (regime shift → reduce allocation before Sharpe drops)

**Deliverable:** Paper trade with live data. Track execution quality. Detect drift. Proactive risk management.

---

### PHASE 7 — Production Hardening (Week 18-19)
> Make it bulletproof

- [ ] **7.1** Error handling + structured logging (pino JSON in prod)
- [ ] **7.2** Health checks + monitoring
- [ ] **7.3** Automated backups (PostgreSQL + S3)
- [ ] **7.4** CI/CD pipeline
- [ ] **7.5** Alert routing (SNS → phone/email for drawdown, drift, system down)
- [ ] **7.6** Rate limiting + input validation on all endpoints
- [ ] **7.7** Cross-strategy signal confirmation (boost size when 2+ uncorrelated strategies agree on direction)

**Deliverable:** System runs unattended. Alerts if anything breaks. Multi-strategy synergy.

---

### PHASE 8 — Prop Firm Integration (Week 20-23)
> Simulate strategies against real prop firm rules, rank firms, project payouts

- [ ] **8.1** Prop firm rule engine (loads `docs/prop-firm-rules.md`)
- [ ] **8.2** Strategy × Firm compliance simulator (7 firms: MFFU, Topstep, TPT, Apex, FFN, Alpha Futures, Tradeify)
- [ ] **8.3** Firm ranking by expected ROI given strategy profile
- [ ] **8.4** Payout projection calculator (splits, fees, ongoing costs)
- [ ] **8.5** Evaluation timeline estimator (days to pass based on strategy metrics)
- [ ] **8.6** Dashboard: Prop Firm Simulator page

**Deliverable:** Pick a strategy → see which firms it passes → see projected monthly payout.

---

## Budget

| Item | Cost | Status |
|------|------|--------|
| Databento credits | $125 one-time | Available |
| Railway PostgreSQL | $5/mo | Active |
| AWS (S3 + Lambda + EC2 spot) | ~$2/mo (credits) | $100 credits |
| Massive real-time data | $0/mo | Free tier |
| Alpha Vantage indicators | $0/mo | Free tier |
| Ollama + n8n + OpenClaw | $0/mo | Local (Skytech) |
| **Total monthly burn** | **~$7/mo** | |
| **AWS runway** | **~14 months** | |

---

## Current Status

```
Phase 0   ████████████████████  DONE
Phase 1   ████████████████████  DONE
Phase 2   ████████████████████  DONE
Phase 3   ████████████████████  DONE (Monte Carlo, risk, backtest realism)
Phase 3.5 ████████████████████  DONE (54 ICT indicators + 19 ICT strategies)
Phase 4   ████████████████████  DONE (regime, lifecycle, robustness, n8n, API)
Phase 4.5 ░░░░░░░░░░░░░░░░░░░░  ← CURRENT (OpenClaw Strategy Scout)
Phase 5   ░░░░░░░░░░░░░░░░░░░░  Lovable (dashboard)
Phase 6   ░░░░░░░░░░░░░░░░░░░░
Phase 7   ░░░░░░░░░░░░░░░░░░░░
Phase 8   ░░░░░░░░░░░░░░░░░░░░
```
