# Trading Forge — Roadmap

> Personal futures/derivatives strategy research lab.
> Goal: Find, validate, and deploy systematic trading strategies using AI-assisted backtesting and Monte Carlo simulation.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Infrastructure Map](#infrastructure-map)
3. [Local AI Lab Setup — Skytech RTX + Ollama + n8n](#local-ai-lab-setup--skytech-rtx--ollama--n8n)
4. [Institutional Edge — What the Top 1% Do](#institutional-edge--what-the-top-1-do)
5. [Phase 0 — Foundation](#phase-0--foundation-week-1-2)
6. [Phase 1 — Data Pipeline](#phase-1--data-pipeline-week-3-4)
7. [Phase 2 — Backtest Engine](#phase-2--backtest-engine-week-5-7)
8. [Phase 3 — Monte Carlo & Risk](#phase-3--monte-carlo--risk-week-8-9)
9. [Phase 4 — AI Research Agents](#phase-4--ai-research-agents-week-10-12)
10. [Phase 4.5 — OpenClaw Strategy Scout](#phase-45--openclaw-strategy-scout-week-12-13)
11. [Phase 5 — Dashboard](#phase-5--dashboard-week-14-15)
12. [Phase 6 — Live Paper Trading](#phase-6--live-paper-trading-week-16-17)
13. [Phase 7 — Production Hardening](#phase-7--production-hardening-week-18-19)
14. [Phase 8 — Prop Firm Integration](#phase-8--prop-firm-integration-week-20-23)
15. [Budget Tracker](#budget-tracker)
16. [Risk Register](#risk-register)
17. [Decision Log](#decision-log)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    TRADING FORGE                            │
│                                                             │
│  ┌──────────┐   ┌──────────────┐   ┌───────────────────┐   │
│  │ Data     │   │ Backtest     │   │ AI Research       │   │
│  │ Pipeline │──▶│ Engine       │──▶│ Agents            │   │
│  │ (Node)   │   │ (Python)     │   │ (Ollama+n8n)   │   │
│  └────┬─────┘   └──────┬───────┘   └────────┬──────────┘   │
│       │                │                     │              │
│       ▼                ▼                     ▼              │
│  ┌──────────┐   ┌──────────────┐   ┌───────────────────┐   │
│  │ S3       │   │ PostgreSQL   │   │ Dashboard         │   │
│  │ Data Lake│   │ (Railway)    │   │ (React + Express) │   │
│  └──────────┘   └──────────────┘   └───────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ OpenClaw Strategy Scout (autonomous research layer)  │   │
│  │                                                      │   │
│  │  Brave Search ─┐                                     │   │
│  │  Reddit MCP   ─┤                                     │   │
│  │  Tavily       ─┼──▶ Ollama summarizes ──▶ n8n webhook│   │
│  │  YouTube MCP  ─┤         to JSON            (scout)  │   │
│  │  Academic MCP ─┘                                     │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  LOCAL: Skytech PC (RTX 5060, Ollama, n8n, OpenClaw)        │
│  CLOUD: AWS ($100 credits) + Railway (free/hobby)           │
└─────────────────────────────────────────────────────────────┘
```

---

## Infrastructure Map

| Service | Purpose | Cost | Provider |
|---------|---------|------|----------|
| PostgreSQL | Strategy results, configs, audit trail | $5/mo | Railway |
| S3 | Historical OHLCV data lake | ~$2/mo | AWS (credits) |
| Lambda | Nightly data fetch, alerts | $0 (free tier) | AWS (credits) |
| EC2 Spot g5.xlarge | GPU Monte Carlo bursts | ~$5/mo | AWS (credits) |
| SNS | Alert notifications | $0 (free tier) | AWS (credits) |
| Ollama | Local LLM for strategy research | $0 | Local (Skytech) |
| n8n | Workflow orchestration | $0 | Local (Skytech) |
| **Databento** | **Institutional-grade tick/futures data (CME, NASDAQ)** | **$0 ($125 credits)** | **Databento** |
| **Massive** | **Real-time streaming: currencies, indices, options, stocks** | **$0/mo (free tier)** | **Massive** |
| **Alpha Vantage** | **60+ indicators, news/sentiment, MCP for AI agents** | **$0/mo (free tier)** | **Alpha Vantage** |
| **OpenClaw** | **Autonomous strategy research scout** | **$0** | **Local (Skytech)** |
| **Brave Search** | **Web search for trading ideas, prop firm news** | **$0 (free tier, 2K queries/mo)** | **Brave** |
| **Reddit MCP** | **r/algotrading, r/futurestrading, r/prop_firms** | **$0** | **Reddit** |
| **Tavily** | **AI-optimized deep search for strategy research** | **$0 (free tier, 1K queries/mo)** | **Tavily** |
| **YouTube MCP** | **Transcribe & summarize algo trading videos** | **$0** | **YouTube** |
| **Academic MCP** | **arXiv/SSRN quantitative finance papers** | **$0** | **arXiv/SSRN** |
| **Total monthly burn (infra)** | | **~$7/mo** | |
| **Runway on $100 AWS** | | **~14 months** | |
| **Databento credits** | | **$125 one-time** | **Use for historical futures downloads** |

---

## Local AI Lab Setup — Skytech RTX + Ollama + n8n

> Community-validated setup (r/algotrading, r/LocalLLaMA, r/n8n, 2025-2026).
> This is the exact stack people are shipping for AI trading research labs.

### How It Works (division of labor)

```
┌──────────────────────────────────────────────────────────────────┐
│                    AI STRATEGY RESEARCH LAB                       │
│                                                                  │
│  ┌─────────────┐     ┌─────────────┐     ┌──────────────────┐   │
│  │   Ollama     │     │    n8n       │     │  Trading Forge   │   │
│  │  (the brain) │────▶│ (the glue)   │────▶│  (the muscle)    │   │
│  │             │     │             │     │                  │   │
│  │ • Generate   │     │ • Schedule   │     │ • vectorbt       │   │
│  │   strategy   │     │ • Orchestrate│     │ • Monte Carlo    │   │
│  │   ideas      │     │ • Loop       │     │ • Walk-forward   │   │
│  │ • Critique   │     │ • Route      │     │ • Prop firm sim  │   │
│  │   results    │     │   results    │     │ • Crisis stress  │   │
│  │ • Refine     │     │ • Alert      │     │   test           │   │
│  │   params     │     │              │     │                  │   │
│  └─────────────┘     └─────────────┘     └──────────────────┘   │
│        ▲                                         │               │
│        └─────────────────────────────────────────┘               │
│              Results feed back for iteration                     │
│                                                                  │
│  KEY: Ollama does NOT run simulations (it's terrible at math).   │
│       Ollama generates the code/params. Forge RUNS the sims.     │
│       n8n orchestrates the loop. This is 100% private, $0/mo.    │
└──────────────────────────────────────────────────────────────────┘
```

### Step 1: Ollama GPU Setup on Skytech (5-10 mins)

Ollama auto-detects RTX and uses CUDA — 40-120+ tokens/sec depending on model.

```bash
# Windows (Skytech gaming PCs):
# 1. Download & run installer from ollama.com (200 MB .exe)
# 2. Update NVIDIA Game Ready drivers (or Studio drivers)
# 3. (Optional) Install latest CUDA Toolkit from NVIDIA
# 4. Test:
ollama run llama3.2
ollama run --verbose  # confirms "using CUDA" + VRAM usage

# Linux (Ubuntu 24.04):
curl -fsSL https://ollama.com/install.sh | sh
ollama serve  # runs in background
```

**GPU Tips:**
- RTX 5060 (8-16 GB VRAM): Run 7B-14B models at full speed; 32B+ with layer offloading
- Monitor: `nvidia-smi` (keep VRAM under 80-90% for stability)

**Best Models for Trading Strategy Research:**
| Model | Size | Use Case |
|-------|------|----------|
| `qwen2.5-coder:14b` | ~9 GB | Best at generating clean vectorbt code |
| `deepseek-coder-r1` | ~8 GB | Excellent for analysis & critique |
| `llama3.1:8b` | ~5 GB | Fast general reasoning, critique loop |

```bash
# Pull once, runs forever:
ollama pull qwen2.5-coder:14b
ollama pull llama3.1:8b
```

### Step 2: Custom Modelfile for Trading Quant Agent

```dockerfile
# File: trading-forge/ollama/Modelfile.trading-quant
FROM qwen2.5-coder:14b

SYSTEM You are an expert futures quantitative strategist. Your job is to generate, critique, and refine trading strategies for ES, NQ, and CL futures.

RULES:
- Always output valid Python code using vectorbt for backtesting
- Include JSON params for every strategy (max 5 parameters)
- Every strategy must be describable in ONE sentence
- Use only proven edges: trend following, mean reversion, volatility expansion, session patterns
- Include slippage modeling as a function of ATR (not a constant)
- Include walk-forward validation logic
- Never suggest strategies that require tight parameter optimization
- Output Monte Carlo simulation parameters (num_sims, confidence_intervals)
- Score against prop firm rules: max drawdown < $2,000 for Topstep 50K
- Target: avg daily P&L >= $250, 60%+ winning days, profit factor >= 1.75

OUTPUT FORMAT:
{
  "strategy_name": "...",
  "one_sentence": "...",
  "edge_hypothesis": "...",
  "params": {...},
  "python_code": "...",
  "expected_metrics": {...}
}

PARAMETER num_ctx 8192
PARAMETER temperature 0.7
PARAMETER num_gpu 35
```

```bash
# Build:
ollama create trading-quant -f ollama/Modelfile.trading-quant
# Test:
ollama run trading-quant "Generate a mean reversion strategy for ES 15min using Bollinger Bands"
```

### Step 3: Docker Compose — Full Local Stack

```yaml
# File: trading-forge/docker-compose.local-ai.yml
# The full AI research lab stack — Ollama + n8n + Postgres + pgvector
services:
  ollama:
    image: ollama/ollama
    ports: ["11434:11434"]
    volumes: [ollama_data:/root/.ollama]
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]

  n8n:
    image: n8nio/n8n
    ports: ["5678:5678"]
    environment:
      - N8N_HOST=localhost
      - WEBHOOK_URL=http://localhost:5678
      - OLLAMA_HOST=http://ollama:11434
    volumes: [n8n_data:/home/node/.n8n]
    depends_on: [ollama]

  # Optional: pgvector for RAG — so Ollama "remembers" past backtest results
  pgvector:
    image: pgvector/pgvector:pg16
    ports: ["5433:5432"]
    environment:
      POSTGRES_DB: forge_memory
      POSTGRES_USER: forge
      POSTGRES_PASSWORD: ${PGVECTOR_PASSWORD:-localdev}
    volumes: [pgvector_data:/var/lib/postgresql/data]

  # Optional: Open WebUI for ChatGPT-like interface to test agents manually
  open-webui:
    image: ghcr.io/open-webui/open-webui:main
    ports: ["3001:8080"]
    environment:
      - OLLAMA_BASE_URL=http://ollama:11434
    volumes: [openwebui_data:/app/backend/data]
    depends_on: [ollama]

volumes:
  ollama_data:
  n8n_data:
  pgvector_data:
  openwebui_data:
```

```bash
# Start everything:
docker compose -f docker-compose.local-ai.yml up -d

# Access:
# n8n:       http://localhost:5678
# Open WebUI: http://localhost:3001
# Ollama API: http://localhost:11434
```

### Step 4: n8n → Ollama → Trading Forge Loop

**Connect n8n to Ollama (30 seconds):**
1. Create Credential → Ollama → Base URL = `http://ollama:11434`
2. Add Ollama Chat Model node → pick `trading-quant` model
3. Test connection — it just works

**The Loop Pattern (what everyone uses):**
```
1. Trigger (schedule or webhook from dashboard)
       │
2. Ollama "Strategy Finder" Agent
   Prompt: "Generate 5 new vectorbt strategies for ES futures
            using Databento tick data. Output valid Python code
            + JSON params. Max 5 params each."
       │
3. n8n HTTP Node → POST to Trading Forge Express API
   URL: http://localhost:3000/api/backtest/run
   Body: { strategy_code, params, symbol: "ES", timeframe: "15min" }
       │
4. Trading Forge runs:
   - vectorbt backtest
   - Walk-forward validation
   - Performance gate check ($250/day, 60% win days)
   - Monte Carlo (1000 sims)
   - Prop firm compliance (docs/prop-firm-rules.md)
   - Crisis stress test (8 scenarios)
       │
5. Ollama "Analyst" Agent → reviews results
   Prompt: "Review these backtest results. Which strategies
            pass all gates? Suggest parameter refinements for
            borderline strategies."
       │
6. Loop (n8n) → refine or save to DB → dashboard update
```

**n8n exposes a webhook in Trading Forge for this:**
- `POST /api/agent/run-strategy` — accepts Ollama-generated code, returns backtest results
- `POST /api/agent/critique` — accepts results, returns Ollama analysis
- This is the "strategy generation loop" that scales to 1,000s of tests via n8n batching

### Why This Stack Wins

```
Traditional cloud approach:
  GPT-4 API calls × 1,000 strategies = $50-200/month in API costs
  + data leaves your machine (privacy risk)
  + rate limits slow you down
  + vendor lock-in

Your Skytech approach:
  Ollama (free, local, private) × n8n (free, local) × Trading Forge
  = $0/month after hardware
  = 40-120 tokens/sec on RTX
  = No rate limits
  = 100% private (strategies never leave your PC)
  = Scales perfectly (just loop more)

Community consensus: "This is the smart low-cost way" (r/algotrading, 2025-2026)
```

---

## Institutional Edge — What the Top 1% Do

> Research from prop firm traders, institutional quants, and practitioner sources (2024-2026).
> **The top 1% aren't using secret strategies. They're executing simple, well-understood principles with extraordinary consistency, risk management, and process discipline.**

### The 8 Capabilities That Separate Winners From Losers

| # | Capability | Phase | Why It Matters |
|---|-----------|-------|----------------|
| 1 | **Regime Detection** | Phase 4 | Only run strategies in their favorable regime. A trend strategy in a range-bound market loses money. |
| 2 | **Dynamic Position Sizing** | Phase 2 | Scale position size inversely to volatility. Fixed sizing is amateur hour. |
| 3 | **Stress Testing** | Phase 3 | Run portfolios through 2008, March 2020, 2022 rate shock. If any scenario wipes you out, sizing is wrong. |
| 4 | **Multi-Strategy Portfolio** | Phase 6 | 2-3 uncorrelated strategies, not 1. Target correlation < 0.3 between strategies. |
| 5 | **Execution Tracking** | Phase 6 | Log expected vs actual fill price. Slippage erodes 1-3% annually — 7-20% of your edge. |
| 6 | **Strategy Decay Monitoring** | Phase 6 | Track rolling Sharpe. Every strategy eventually loses its edge (5-10% alpha decay/year in liquid markets). |
| 7 | **Live vs Backtest Drift** | Phase 6 | Catch problems in days, not months. If live underperforms backtest by >1 std dev, investigate. |
| 8 | **Strategy Pipeline** | Phase 4 | Always developing the next strategy while running current ones. Strategies have lifespans. |

### Key Research Findings

**On Strategy Robustness:**
- If a 37-period MA works but 36 and 38 don't → you've curve-fitted noise (already handled by Optuna plateau detection)
- Fees and slippage reduce projected profits by 30-50% vs backtests → stress test with 2x expected slippage
- Require positive expectancy across at least 2 distinct market regimes (trending + mean-reverting)
- Cap position size at a fraction of average daily volume (liquidity constraint)
- Test with 3x normal spreads and 50% reduced fill rates (structural fragility test)

**On Risk Management:**
- Track total portfolio exposure as percentage, not just per-trade risk ("portfolio heat")
- If 2+ strategies are effectively long the same factor → treat them as ONE strategy for sizing
- Hedge tail risks with options/event contracts rather than relying on stop-losses (gaps kill stops)
- Scale capital gradually — never go from backtesting to full-size live in one step

**On Process Discipline:**
- The #1 killer: inability to tolerate losing streaks without abandoning a sound strategy
- Separate PROCESS review from OUTCOME review (losing trade executed on plan = success)
- Paper trade 6+ months minimum before going live
- Automation reduces emotional decision-making by ~40% — but only if you trust the system
- Start with the expectation that slightly more than half your trades will lose

**On Alpha Decay:**
- Predictive signals lose ~5-10% effectiveness annually in liquid markets
- Track rolling Sharpe (6-month) — declining Sharpe is the earliest warning sign
- Shrinking average wins (before win rate drops) = early decay signal
- Maintain a pipeline of strategies in development. Always have the next one being tested.
- Reduce allocation to decaying strategies gradually rather than shutting off abruptly

**On Execution:**
- Use TWAP/VWAP for larger orders instead of market orders
- Use stop-limit orders instead of stop-market orders (one trader experienced 10R slippage on a stop-market)
- Build execution cost into backtests as a VARIABLE, not a constant (slippage increases during vol spikes)
- Co-location and latency matter — even a few basis points per trade compounds

---

## Phase 0 — Foundation (Week 1-2)

**Goal:** Repo structure, database schema, basic Express server, dev tooling.

### Tasks

- [ ] **0.1** Initialize monorepo structure
  ```
  trading-forge/
  ├── src/
  │   ├── server/           # Express API (TypeScript)
  │   │   ├── index.ts      # Server entry
  │   │   ├── routes/       # Route modules
  │   │   ├── db/           # Drizzle schema + migrations
  │   │   └── services/     # Business logic
  │   ├── engine/           # Python backtest engine
  │   │   ├── backtester.py
  │   │   ├── monte_carlo.py
  │   │   └── indicators/
  │   ├── data/             # Data pipeline scripts
  │   │   ├── fetchers/     # Databento, Massive, Alpha Vantage
  │   │   ├── transforms/   # OHLCV normalization
  │   │   └── loaders/      # S3 ↔ local sync
  │   ├── agents/           # AI research agents
  │   │   ├── strategy_finder.py
  │   │   ├── param_optimizer.py
  │   │   └── market_analyst.py
  │   └── dashboard/        # React frontend
  │       ├── src/
  │       └── package.json
  ├── scripts/              # Dev/deploy scripts
  ├── data/                 # Local data cache (gitignored)
  ├── ROADMAP.md
  ├── CLAUDE.md
  ├── package.json
  ├── tsconfig.json
  ├── drizzle.config.ts
  └── .env.example
  ```

- [ ] **0.2** Set up Drizzle ORM + PostgreSQL schema
  ```sql
  -- Core tables
  strategies          -- Strategy definitions (name, type, params, status)
  backtests           -- Backtest runs (strategy_id, timeframe, results)
  backtest_trades     -- Individual trades from backtests
  monte_carlo_runs    -- MC simulation results (drawdown, sharpe, etc.)
  market_data_meta    -- Metadata for cached market data
  data_sources        -- Configured data source connections
  audit_log           -- Immutable record of all actions (Trust Spine pattern)
  alerts              -- Alert definitions and history
  watchlist           -- Instruments being tracked
  ```

- [ ] **0.3** Express server with basic endpoints
  ```
  GET    /api/health
  GET    /api/strategies
  POST   /api/strategies
  GET    /api/strategies/:id
  PATCH  /api/strategies/:id
  DELETE /api/strategies/:id
  ```

- [ ] **0.4** Simple API key auth middleware (just you, no Supabase needed)

- [ ] **0.5** Dev tooling: tsx watch, eslint, prettier, vitest

- [ ] **0.6** Docker Compose for local PostgreSQL

### Deliverable
Server running locally, CRUD on strategies table, migrations working.

---

## Phase 1 — Data Pipeline (Week 3-4)

**Goal:** Fetch, store, and serve historical futures data via three data providers.

### Data Provider Strategy

| Provider | Role | When Used | Key Benefit |
|----------|------|-----------|-------------|
| **Databento** | Historical bulk downloads | Phase 1 (backfill) | Institutional-grade tick data for futures (ES, NQ, CL) |
| **Massive** | Real-time streaming | Phase 6 (paper/live) | Free WebSocket feeds for currencies, indices, options, stocks |
| **Alpha Vantage** | Indicators + sentiment | Phase 4 (AI agents) | 60+ server-side indicators, news API, MCP support for agents |

### Tasks

- [ ] **1.1** Databento client wrapper (primary historical source)
  - REST client for bulk historical data downloads
  - Download tick data and aggregate to OHLCV bars (1min, 5min, 15min, 1hr, daily)
  - Save as Parquet to S3 — download once, backtest forever
  - Rate limiting + retry logic
  - Support for: ES, NQ, YM, RTY, CL, GC, SI, ZB, ZN, 6E, 6J
  - **Budget: $125 credits — prioritize core contracts (ES, NQ, CL) first**

- [ ] **1.1a** Continuous contract back-adjustment (**CRITICAL — data integrity**)
  - Raw Databento continuous contracts (ES.v.0) have price gaps on quarterly rolls (Mar→Jun, Jun→Sep, etc.)
  - **Without adjustment, backtests produce fake signals from roll gaps** — this is the #1 data pitfall in futures backtesting
  - Implement ratio-adjusted (proportional) continuous contracts as the default method
  - Also support Panama (additive) back-adjustment as a secondary option
  - Store both raw and adjusted Parquet files in S3 (raw for reference, adjusted for backtesting)
  - Roll calendar: detect roll dates from volume crossover or use Databento's roll metadata
  - Validation: compare adjusted prices against known benchmarks to verify no artifacts
  ```python
  # Ratio adjustment (preferred — preserves percentage returns)
  def ratio_adjust(prices, roll_dates):
      """
      Adjust continuous contract prices to remove roll gaps.
      Ratio method: multiply historical prices by (new_front / old_front) at each roll.
      Preserves percentage returns — critical for strategy backtesting.
      """
      adjusted = prices.copy()
      for roll_date in reversed(roll_dates):
          ratio = prices[roll_date]['new_front'] / prices[roll_date]['old_front']
          adjusted.loc[:roll_date] *= ratio
      return adjusted

  # Panama adjustment (additive — preserves dollar returns)
  def panama_adjust(prices, roll_dates):
      """
      Additive adjustment: subtract the gap at each roll from all prior prices.
      Preserves dollar P&L but distorts percentage returns for older data.
      """
      adjusted = prices.copy()
      for roll_date in reversed(roll_dates):
          gap = prices[roll_date]['new_front'] - prices[roll_date]['old_front']
          adjusted.loc[:roll_date] -= gap
      return adjusted
  ```
  - **S3 structure with adjusted data:**
  ```
  s3://trading-forge-data/futures/ES/
  ├── raw/           # Unadjusted Databento prices (reference only)
  ├── ratio_adj/     # Ratio-adjusted (default for backtesting)
  ├── panama_adj/    # Panama-adjusted (alternative)
  └── roll_calendar/ # Roll dates + ratios for each contract
  ```

- [ ] **1.1b** Massive client wrapper (real-time + supplemental)
  - REST client for on-demand historical bars
  - WebSocket client for real-time streaming (Phase 6)
  - Free tier: Currencies Basic, Indices Basic, Options Basic, Stocks Basic
  - Use as supplemental/validation source alongside Databento

- [ ] **1.1c** Alpha Vantage client wrapper (indicators + sentiment)
  - REST client for technical indicators (RSI, MACD, Bollinger, etc. — 60+ available)
  - News + sentiment API for AI agents (Phase 4)
  - MCP integration for direct Ollama agent access
  - Free tier rate limits: plan API calls accordingly

- [ ] **1.2** S3 data lake structure
  ```
  s3://trading-forge-data/
  ├── futures/
  │   ├── ES/
  │   │   ├── 1min/2024/01/01.parquet
  │   │   ├── 5min/2024/01/01.parquet
  │   │   ├── 15min/...
  │   │   ├── 1hour/...
  │   │   └── daily/...
  │   ├── NQ/...
  │   └── CL/...
  └── metadata/
      └── symbols.json
  ```

- [ ] **1.3** Data fetcher Lambda
  - Nightly cron: fetch previous day's bars via Massive (free, real-time)
  - Backfill script: bulk download historical data via Databento (5+ years)
  - Alpha Vantage: nightly indicator snapshots + sentiment scores
  - Store as Parquet in S3
  - Update `market_data_meta` table with source tracking

- [ ] **1.3a** Polars + DuckDB data layer (high-performance Parquet access)
  - **Polars** replaces Pandas as primary data loading library (5-10x faster for Parquet reads)
  - **DuckDB** for querying Parquet files directly on S3 without downloading (zero-copy, SQL interface)
  - Pandas kept for vectorbt compatibility layer only — all internal data ops use Polars
  - DuckDB enables: `SELECT * FROM 's3://trading-forge-data/futures/ES/ratio_adj/5min/*.parquet' WHERE date > '2023-01-01'`
  - Eliminates full-file S3 downloads for selective backtests (query only the date range you need)
  - Lazy evaluation: Polars scans only the columns/rows needed, not the entire dataset
  ```python
  # Polars: Load 5 years of ES 5min data in ~2 seconds (vs ~15s with Pandas)
  import polars as pl
  df = pl.scan_parquet("s3://trading-forge-data/futures/ES/ratio_adj/5min/*.parquet")
  df = df.filter(pl.col("date") >= "2020-01-01").collect()

  # DuckDB: Query S3 Parquet directly with SQL (no download needed)
  import duckdb
  conn = duckdb.connect()
  conn.execute("INSTALL httpfs; LOAD httpfs;")
  result = conn.execute("""
      SELECT date, open, high, low, close, volume
      FROM 's3://trading-forge-data/futures/ES/ratio_adj/5min/*.parquet'
      WHERE date BETWEEN '2024-01-01' AND '2024-12-31'
  """).pl()  # Returns Polars DataFrame directly

  # vectorbt bridge: Convert Polars → Pandas only at the backtest boundary
  vbt_data = df.to_pandas()  # One-time conversion for vectorbt
  ```

- [ ] **1.4** Local data sync
  - CLI command: `forge data sync ES --from 2020-01-01 --to 2025-01-01`
  - Downloads from S3 to local `data/` directory
  - Supports incremental sync (only fetch what's missing)
  - Source-aware: tracks which provider supplied each data segment
  - Polars/DuckDB can also query S3 directly — local sync is optional for performance

- [ ] **1.5** Data serving API
  ```
  GET  /api/data/symbols              -- Available symbols
  GET  /api/data/:symbol/bars         -- OHLCV bars (with timeframe, range params)
  GET  /api/data/:symbol/info         -- Symbol metadata
  POST /api/data/sync                 -- Trigger sync job
  GET  /api/data/sync/status          -- Sync job status
  ```

### Deliverable
5+ years of ES, NQ, CL data in S3. Local sync working. API serving bars.

---

## Phase 2 — Backtest Engine (Week 5-7)

**Goal:** Run strategy backtests with vectorbt, store results in Postgres.

### Tasks

- [ ] **2.1** Python backtest engine (vectorbt Pro or vectorbt)
  - Strategy definition format (JSON/YAML → Python)
  - Indicator library: SMA, EMA, RSI, MACD, VWAP, Bollinger, ATR, etc.
  - Entry/exit signal generation
  - Position sizing: fixed, percent-risk, Kelly criterion, **volatility-scaled (institutional)**
  - **Dynamic position sizing** (Institutional Edge #2):
    - Scale position size inversely to trailing ATR or realized volatility
    - High vol → smaller size, low vol → larger size (same dollar risk per trade)
    - Implement as `contracts = target_risk / (ATR * tick_value)`
    - This is what institutions do — retail traders use fixed sizes and get killed in vol spikes
  - Slippage + commission modeling (realistic futures costs)
  - **Data loading via Polars** (fast) → convert to Pandas at vectorbt boundary only
  - **Must use ratio-adjusted continuous contracts** — never raw Databento prices
  - Vectorized/Numba approach: 1,000,000+ MC sims in ~20 seconds on modest hardware

- [ ] **2.2** Strategy templates
  ```python
  # Example: Mean Reversion on ES 15min
  {
    "name": "ES Mean Reversion",
    "symbol": "ES",
    "timeframe": "15min",
    "indicators": [
      {"type": "bollinger", "period": 20, "std": 2.0},
      {"type": "rsi", "period": 14}
    ],
    "entry_long": "close < bb_lower AND rsi < 30",
    "entry_short": "close > bb_upper AND rsi > 70",
    "exit": "close crosses bb_middle",
    "stop_loss": {"type": "atr", "multiplier": 2.0},
    "take_profit": {"type": "atr", "multiplier": 3.0},
    "position_size": {"type": "fixed", "contracts": 1}
  }
  ```

- [ ] **2.3** Backtest runner service
  - Node.js spawns Python subprocess
  - Passes strategy config + data path
  - Python returns JSON results
  - Results stored in `backtests` + `backtest_trades` tables

- [ ] **2.4** Backtest results schema
  ```
  backtests:
    id, strategy_id, symbol, timeframe, start_date, end_date,
    total_return, sharpe_ratio, max_drawdown, win_rate,
    profit_factor, total_trades, avg_trade_pnl,
    equity_curve (JSONB), monthly_returns (JSONB),
    created_at, execution_time_ms

  backtest_trades:
    id, backtest_id, entry_time, exit_time, direction,
    entry_price, exit_price, pnl, contracts, commission,
    slippage, mae, mfe, hold_duration
  ```

- [ ] **2.5** Backtest API endpoints
  ```
  POST   /api/backtests              -- Run new backtest
  GET    /api/backtests              -- List all backtests
  GET    /api/backtests/:id          -- Backtest detail + trades
  GET    /api/backtests/:id/equity   -- Equity curve data
  GET    /api/backtests/:id/trades   -- Trade list
  POST   /api/backtests/compare      -- Compare multiple backtests
  DELETE /api/backtests/:id          -- Delete backtest
  ```

- [ ] **2.6** Walk-forward analysis
  - Split data into in-sample / out-of-sample windows
  - Optimize on in-sample, validate on out-of-sample
  - Detect overfitting by comparing IS vs OOS performance

### Deliverable
Can define a strategy, run backtest on ES 5-year data, see equity curve + stats.

---

## Phase 3 — Monte Carlo & Risk (Week 8-9)

**Goal:** Validate strategies with Monte Carlo simulation and risk analysis.

### Tasks

- [ ] **3.1** Monte Carlo simulation engine
  - Trade-level resampling (shuffle trade sequence)
  - Return-level bootstrapping
  - Path simulation (1000+ equity curves)
  - GPU acceleration with CUDA/cuPy on RTX 5060
  - Confidence intervals: 5th, 25th, 50th, 75th, 95th percentile

- [ ] **3.2** Risk metrics computation
  ```
  Per simulation:
    - Max drawdown distribution
    - Probability of ruin (account → 0)
    - Expected Sharpe ratio range
    - Calmar ratio
    - Ulcer index
    - Time to recovery from drawdown
    - Value at Risk (VaR) — 95% and 99%
    - Conditional VaR (CVaR)
  ```

- [ ] **3.3** Monte Carlo API
  ```
  POST   /api/monte-carlo             -- Run MC on a backtest
  GET    /api/monte-carlo/:id         -- MC results
  GET    /api/monte-carlo/:id/paths   -- Simulated equity paths
  GET    /api/monte-carlo/:id/risk    -- Risk metrics summary
  ```

- [ ] **3.4** Strategy scoring system
  ```
  FORGE SCORE (0-100):
    - Earnings power               (0-30 pts)  ← HEAVIEST WEIGHT
      · $250/day avg = 15 pts (minimum viable)
      · $350/day avg = 22 pts (solid edge)
      · $500+/day avg = 30 pts (bread and butter)
      · Below $250/day = 0 pts → AUTO-REJECT

    - Daily survival rate          (0-25 pts)
      · 12/20 winning days = 15 pts (minimum)
      · 14/20 winning days = 20 pts (solid)
      · 16+/20 winning days = 25 pts (exceptional)
      · Below 10/20 in any month = 0 pts → AUTO-REJECT

    - Drawdown vs prop firm limits (0-20 pts)
      · Max DD < $1,500 = 20 pts (fits every firm)
      · Max DD < $2,000 = 15 pts (fits most firms)
      · Max DD < $2,500 = 10 pts (fits some firms)
      · Max DD >= $2,500 = 0 pts → AUTO-REJECT

    - Monte Carlo + walk-forward   (0-25 pts)
      · MC survival rate (0-10 pts)
      · Walk-forward OOS consistency (0-10 pts)
      · Sharpe ratio stability (0-5 pts)

  Grades:
    A+ (90-100) — Deploy immediately, Tier 1 strategy
    A  (80-89)  — Strong edge, Tier 2, deploy with monitoring
    B  (70-79)  — Minimum viable, Tier 3, best-fit firm only
    C  (60-69)  — Below minimums, do NOT trade
    F  (<60)    — Rejected, not worth the trader's time

  HARD GATE: Score of 0 in ANY category = auto-reject regardless of total.
  A strategy earning $800/day with $3K drawdown still fails (drawdown = 0 pts).
  ```

- [ ] **3.5** Historical crisis stress testing (Institutional Edge #3)
  - Run every strategy through known crisis periods:
    ```
    Crisis Scenarios:
      - 2008 Financial Crisis (Sep-Nov 2008)     — liquidity evaporation, gap downs
      - 2010 Flash Crash (May 6, 2010)            — 1000-point drop in minutes
      - 2015 China Devaluation (Aug 24, 2015)     — overnight gap, VIX spike
      - 2018 Volmageddon (Feb 5, 2018)            — VIX 100%+ in one day
      - COVID Crash (Feb-Mar 2020)                — fastest bear market ever
      - 2021 Meme Stock / Archegos (Jan-Mar 2021) — correlation spike
      - 2022 Rate Shock (Jun-Oct 2022)            — sustained bear, no bounces
      - 2023 SVB / Banking Crisis (Mar 2023)      — overnight gap risk
    ```
  - Stress test parameters:
    - 3x normal spreads (liquidity crunch simulation)
    - 50% reduced fill rates (partial fills during stress)
    - 2x expected slippage (market impact during panic)
  - **Hard rule: If any single crisis scenario causes a drawdown > prop firm max → strategy FAILS**
  - Output: crisis survival matrix showing pass/fail per scenario with max drawdown in each
  - Integrate into Forge Score: strategies that survive all crises get bonus points (0-5 pts)

- [ ] **3.6** EC2 Spot GPU burst for heavy MC runs
  - Lambda triggers EC2 spot instance
  - Runs MC simulation batch
  - Results → Postgres
  - Instance auto-terminates

- [ ] **3.7** Time-of-day liquidity profiles
  ```
  Session-based slippage multipliers (all times ET):
    Overnight (8 PM - 4 AM ET):     2.0x base slippage — thin book, wide spreads
    Pre-market (4 AM - 9:30 AM ET):  1.5x — liquidity building but still thin
    RTH open (9:30 - 10:00 AM ET):   1.3x — volatile open, fast fills but wide
    RTH core (10 AM - 3:30 PM ET):   1.0x — deepest liquidity, tightest spreads
    RTH close (3:30 - 4 PM ET):      1.2x — MOC imbalances, wider
    FOMC/CPI/NFP windows (±15 min):  3.0x — liquidity vacuum before, spike after
  ```

- [ ] **3.8** Economic calendar filter
  ```
  High-impact events (must handle):
    - FOMC rate decisions (8x/year, 2 PM ET)
    - CPI release (monthly, 8:30 AM ET)
    - NFP / jobs report (first Friday, 8:30 AM ET)
    - GDP advance estimate (quarterly, 8:30 AM ET)
    - PCE inflation (monthly, 8:30 AM ET)

  Strategy options per event:
    1. SIT_OUT — no new entries ±30 min around event
    2. REDUCE — 50% position size ±15 min
    3. WIDEN — 2x stop distance during event window
    4. IGNORE — strategy explicitly trades events (breakout strategies)

  Default: SIT_OUT for all events unless strategy config overrides.
  Source: Alpha Vantage economic calendar API (free tier).
  ```

- [ ] **3.9** Overnight gap risk model
  ```
  Separate from intraday slippage. Applies to strategies holding across sessions.
    - Gap risk = historical gap distribution for symbol at session boundary
    - ES avg overnight gap: ~5-15 pts (normal), 30-80 pts (event/crisis)
    - CL avg overnight gap: ~$0.30-0.80 (normal), $2-5 (API report/geopolitical)
    - NQ avg overnight gap: ~20-60 pts (normal), 100-300 pts (event/crisis)

  Implementation:
    - Tag each trade: INTRADAY_ONLY vs HOLDS_OVERNIGHT
    - If HOLDS_OVERNIGHT: add gap risk to max adverse excursion (MAE) calculation
    - Stop loss must account for gap-through risk (stop at $X doesn't mean fill at $X)
    - Gap-adjusted drawdown used for prop firm compliance check
  ```

- [ ] **3.10** Fill probability model
  ```
  Not all limit orders fill. Model realistic fill rates:
    - Market orders: 100% fill, slippage applies
    - Limit at current price: ~95% fill rate
    - Limit 1 tick away: ~80% fill rate
    - Limit at support/resistance: ~50-70% fill rate (front-running, absorption)
    - Limit at extreme (RSI > 80 reversal): ~40-60% fill rate

  Impact on strategy metrics:
    - Mean reversion strategies most affected (entries at extremes)
    - Missed entries reduce trade count → changes win rate and daily P&L
    - Partial fills: model as 50% position when fill probability < 70%

  Backtest adjustment:
    - For each limit entry, roll against fill probability
    - Missed fill → no trade (not counted as win or loss)
    - Reduces "theoretical" P&L to "realistic" P&L
  ```

- [ ] **3.11** Per-firm commission modeling
  ```
  Net P&L = Gross P&L - commissions - exchange fees - data fees
  Commissions vary by firm and contract:

  Per-side, per-contract (round-trip = 2x):
    Topstep:        ES $2.52, NQ $2.52, CL $2.52
    MFFU:           ES $1.58, NQ $1.58, CL $1.58
    TPT:            ES $2.04, NQ $2.04, CL $2.04
    Apex:           ES $2.64, NQ $2.64, CL $2.64
    Tradeify:       ES $2.52, NQ $2.52, CL $2.52
    Alpha Futures:  ES $2.04, NQ $2.04, CL $2.04
    FFN:            ES $2.52, NQ $2.52, CL $2.52

  Impact example:
    Strategy trades 8 round-trips/day on ES:
      MFFU:    8 × 2 × $1.58 = $25.28/day in commissions
      Apex:    8 × 2 × $2.64 = $42.24/day in commissions
      Delta:   $16.96/day → $339/month difference between cheapest and most expensive

  Performance gate check uses NET P&L per firm, not gross.
  A strategy making $260/day gross might pass at MFFU ($234 net) but fail at Apex ($218 net).
  ```

- [ ] **3.12** Firm contract cap enforcement in position sizing
  ```
  ATR-based sizing may request more contracts than firm allows:
    Topstep 50K:    max 5 ES / 5 NQ / 10 CL
    MFFU 50K:       max 5 ES / 5 NQ / 10 CL
    TPT 50K:        max 3 ES / 3 NQ / 5 CL (stricter)
    Apex 50K:       max 4 ES / 4 NQ / 10 CL
    Tradeify 50K:   max 5 ES / 5 NQ / 10 CL

  Enforcement:
    position_size = min(atr_based_size, firm_max_contracts)

  Backtester must run with firm cap applied:
    - Low-vol periods: ATR sizing wants 8 ES → capped to 5 → lower P&L than uncapped backtest
    - This changes daily P&L, drawdown profile, and Forge Score
    - Each firm gets its own backtest variant (same strategy, different sizing caps)
  ```

### Deliverable
Any backtest can be Monte Carlo validated. Forge Score assigned. GPU burst working. Backtest realism hardened with session liquidity, event filters, gap risk, fill probability, per-firm commissions, and contract caps.

---

## Phase 4 — AI Research Agents (Week 10-12)

**Goal:** Use local LLMs (Ollama) + n8n + OpenClaw to discover and refine **simple, robust** strategies.

### Strategy Philosophy

> **Simple strategies that survive Monte Carlo > complex strategies that overfit.**

Agents MUST follow these constraints:

1. **Max 3-5 parameters** per strategy. More parameters = more overfitting surface.
2. **Explainable logic** — if you can't describe the strategy in one sentence, it's too complex.
3. **Proven edge categories only:**
   - Trend following (moving average crossovers, breakouts, momentum)
   - Mean reversion (Bollinger Bands, RSI extremes, VWAP reversion)
   - Volatility expansion/contraction (squeeze plays, range breakouts)
   - Session/time-of-day patterns (opening range, London/NY overlap)
4. **No black-box ML strategies** — no neural nets, no random forests for signal generation. ML is fine for regime detection and position sizing, not for entry/exit signals.
5. **Walk-forward validation is mandatory** — no strategy passes without out-of-sample testing.
6. **If a strategy needs optimization to work, it doesn't work.** Good strategies are robust across a wide parameter range.

### What "Simple" Looks Like

```
GOOD: "Buy ES when 20 EMA crosses above 50 EMA, sell when it crosses below.
       Stop loss at 2x ATR. Take profit at 3x ATR."
       → 4 parameters: fast_ma=20, slow_ma=50, stop_atr=2, tp_atr=3

GOOD: "Short NQ when RSI(14) > 80 and price is above upper Bollinger Band(20,2).
       Exit when RSI < 50."
       → 3 parameters: rsi_period=14, bb_period=20, bb_std=2

BAD:  "Use a 7-layer LSTM to predict next-bar direction, combine with
       sentiment from 3 news APIs, weight by regime classifier output,
       then size position using Kelly criterion adjusted for skewness."
       → 50+ parameters, untestable, will overfit

BAD:  "Optimize RSI period from 2-50, MA type from SMA/EMA/WMA/DEMA/TEMA,
       stop from 0.5-5.0 ATR in 0.1 increments, across 6 timeframes."
       → 15,000+ combinations, guaranteed to find something that backtests well
```

### Tasks

- [ ] **4.1** Ollama integration
  - Primary: `qwen2.5-coder:14b` (best vectorbt code gen, ~9 GB VRAM)
  - Critic: `llama3.1:8b` (fast reasoning for result analysis, ~5 GB VRAM)
  - Custom Modelfile: `ollama/Modelfile.trading-quant` (tuned system prompt with Forge rules baked in)
  - Structured output: strategy JSON generation
  - Tool-calling: Ollama agent can directly trigger `/api/agent/run-strategy` webhook
  - Cost: $0 (runs on Skytech RTX 5060)

- [ ] **4.2** Strategy Finder Agent
  ```
  Input:  "Find mean reversion strategies for ES futures, 15min timeframe"

  Constraints (enforced by agent):
    - Max 5 parameters
    - Must use standard indicators only (MA, RSI, BB, ATR, VWAP)
    - Must be describable in one sentence
    - Must have a clear, logical edge hypothesis
    - Technical strategies ONLY — no ICT/SMC concepts (order blocks, FVGs, liquidity sweeps)
    - ICT/SMC is the trader's discretionary overlay, not the agent's job

  Performance Gate (enforced BEFORE Monte Carlo):
    - Avg daily P&L >= $250 on walk-forward OOS data
    - 60%+ winning days (12+ out of 20 trading days/month)
    - Profit factor >= 1.75
    - Max drawdown < $2,500 (must fit prop firm limits)
    - Max 4 consecutive losing days
    - Avg win > 1.5x avg loss
    - REJECT anything below these gates — do NOT waste Monte Carlo compute

  Process:
    1. Agent generates 5 simple strategy variations (not 50)
    2. Each auto-backtested with walk-forward validation
    3. Performance gate check — REJECT strategies below $250/day or <60% win days
    4. Surviving strategies sent to Monte Carlo
    5. Results ranked by Forge Score (earnings-weighted)
    6. Strategies scored against prop firm rules (docs/prop-firm-rules.md)
    7. Tier classification: Tier 1 ($500+/day), Tier 2 ($350+/day), Tier 3 ($250+/day)

  Output: Ranked strategies with tier, metrics, and prop firm compatibility
          ONE account must be enough. No multi-account scaling strategies.
  ```

- [ ] **4.3** Parameter Robustness Agent (replaces "optimizer")
  ```
  Input:  Existing strategy + parameter ranges

  Purpose: Test if strategy is ROBUST, not find the "best" parameters.
  Tool:   Optuna (Bayesian optimization) for intelligent parameter search.

  Why Optuna over grid search:
    - Grid search: 5 params × 10 values each = 100,000 backtests (brute force, wasteful)
    - Optuna: Bayesian search finds the stable regions in ~500-1,000 trials
    - Optuna's Tree-Structured Parzen Estimator (TPE) learns which param regions
      produce stable results and focuses search there
    - 100x fewer backtests to map the same parameter landscape
    - Still respects "robustness > optimization" — we use Optuna to MAP the landscape,
      not to find one magic set of params

  Process:
    1. Optuna runs 500-1,000 trials with TPE sampler across parameter space
    2. Agent analyzes the Optuna study: plot param importance, interaction effects
    3. Identify "plateau regions" where performance is stable across wide ranges
    4. If no plateau exists (performance is spiky/peaked) → REJECT (overfit)
    5. If plateau exists → extract the robust parameter range
    6. Walk-forward validation on the center of the plateau
    7. Monte Carlo on best walk-forward results
    8. Performance gate check: does robust region still meet $250/day minimum?

  Output: Robustness report —
    "Optuna mapped 800 trials. fast_ma has a stable plateau from 15-25,
     slow_ma from 40-60. Performance varies only ±8% across this range.
     Center of plateau (fast_ma=20, slow_ma=50) passes all performance gates."
     = GOOD (robust, deploy)

    "Optuna mapped 800 trials. Performance peaks sharply at fast_ma=17,
     slow_ma=43 and drops >50% with ±2 change in either parameter.
     No stable plateau found."
     = BAD (overfit, reject)
  ```

- [ ] **4.4** Market Analyst Agent + Regime Detection System (Institutional Edge #1)
  ```
  Input:  "Analyze ES market regime for the last 30 days"

  Regime Detection — Three Levels of Sophistication:

  LEVEL 1 — Indicator-Based (implement first):
    - ADX > 25 → trending regime. ADX < 20 → range-bound regime.
    - ATR percentile (current ATR vs 252-day ATR distribution):
      · Top 20% → high-volatility regime
      · Bottom 20% → low-volatility regime
    - 50 MA slope → trend direction (up/down/flat)
    - Gate strategies: only run trend-following when ADX > 25,
      only run mean-reversion when ADX < 20

  LEVEL 2 — Statistical (implement in Phase 7):
    - Hidden Markov Models (HMMs) to classify 2-3 latent market states
      based on returns and volatility distributions
    - This is the institutional standard for regime detection
    - Python: hmmlearn library

  LEVEL 3 — ML-Based (future, optional):
    - UMAP clustering or SVM on multi-dimensional feature vectors
      (volatility, correlation, breadth, momentum)
    - Only if Level 1+2 prove insufficient

  Strategy Gating Rule:
    - Every strategy has a "preferred regime" tag
    - Regime filter pauses or reduces size when preferred regime is NOT active
    - A study using regime-based rebalancing achieved 495% returns (Sharpe 1.88)
      vs S&P 500's 117% from 2019-2024

  Process:
    1. Fetch recent data
    2. Run Level 1 regime indicators (ADX, ATR percentile, MA slope)
    3. Classify: trending-up, trending-down, range-bound, high-vol, low-vol
    4. Match each active strategy to current regime
    5. Output: activation/deactivation recommendations per strategy

  Output: Market regime report + strategy activation/pause recommendations
  ```

- [ ] **4.5** n8n orchestration workflows
  ```
  Setup: Docker Compose (see "Local AI Lab Setup" section above)
    - n8n native Ollama node (built-in since 2025, no HTTP hacks)
    - Connect: Credential → Ollama → Base URL = http://ollama:11434
    - Select model: trading-quant (custom Modelfile)

  API Webhooks (expose in Trading Forge Express server):
    POST /api/agent/run-strategy    — accepts Ollama-generated code, returns backtest results
    POST /api/agent/critique        — accepts results, returns Ollama analysis
    POST /api/agent/batch           — run N strategies in parallel (n8n batching)

  Workflow 1: Nightly Research
    Trigger: 8 PM EST daily
    → Fetch latest data
    → Run Market Analyst (regime detection)
    → If regime changed → alert via SNS
    → Update watchlist
    → Check strategy decay metrics on all DEPLOYED strategies

  Workflow 2: Weekly Strategy Hunt (the 1,000-strategy loop)
    Trigger: Saturday 10 AM
    → Ollama generates 5 strategy variations per prompt × 3 symbols (ES, NQ, CL)
    → n8n HTTP Node → POST /api/agent/run-strategy for each
    → Trading Forge runs: vectorbt + walk-forward + performance gate + MC + crisis stress test
    → Ollama Analyst reviews results, suggests refinements
    → Loop: refine borderline strategies (up to 3 iterations)
    → Save passing strategies to DB with lifecycle state = CANDIDATE
    → Email digest of new discoveries (only strategies scoring B+ or above)
    → This loop generates 15-45 strategies/week, testing 100s of variations

  Workflow 3: Monthly Robustness Check
    Trigger: Monthly
    → Re-run robustness tests on active strategies (Optuna re-validation)
    → Walk-forward validation on new data
    → Check execution quality drift (live vs backtest)
    → Alert if strategy is degrading (decay monitor)
    → Pipeline health check: alert if < 2 strategies in CANDIDATE/TESTING

  Workflow 4: Daily Portfolio Monitor (new)
    Trigger: 5 PM EST daily (after market close)
    → Pull today's execution data (fills, slippage)
    → Update rolling Sharpe for each DEPLOYED strategy
    → Check live vs backtest drift
    → Check portfolio correlation (all strategies)
    → Update portfolio heat metric
    → Alert on any Level 2+ decay warnings
    → Daily P&L summary email (per-strategy + portfolio aggregate)
  ```

- [ ] **4.6** Strategy Pipeline & Lifecycle Management (Institutional Edge #8)
  ```
  The "Alpha Life Cycle" Framework:
    Every strategy moves through: Discovery → Validation → Deployment → Monitoring → Decay → Retirement

  Pipeline Rules:
    - ALWAYS have at least 1 strategy in Discovery/Validation while others are Deployed
    - A deployed strategy is NOT "set and forget" — it has a lifespan
    - Plan to REPLACE strategies, not run them forever
    - Target: 2-3 uncorrelated deployed strategies at any time (not 1, not 10)

  Strategy Lifecycle States:
    1. CANDIDATE  — Generated by Strategy Finder, untested
    2. TESTING    — In walk-forward + Monte Carlo validation
    3. PAPER      — Passed validation, running paper for 30+ days
    4. DEPLOYED   — Live on prop firm account, monitored daily
    5. DECLINING  — Rolling Sharpe dropping, reduced allocation
    6. RETIRED    — Edge exhausted, archived for reference

  Pipeline Dashboard View:
    - Visual Kanban of strategies across lifecycle stages
    - Auto-promotion: PAPER → DEPLOYED after 30 days if metrics hold
    - Auto-demotion: DEPLOYED → DECLINING if rolling Sharpe drops below threshold
    - Alerts when pipeline is empty (no strategies in CANDIDATE/TESTING)

  n8n Automation:
    - Weekly: Strategy Finder generates new CANDIDATEs
    - Daily: Monitor DEPLOYED strategies for decay signals
    - Monthly: Force pipeline health check — alert if < 2 strategies in pipeline
  ```

- [ ] **4.7** Agent API endpoints
  ```
  POST   /api/agents/find-strategies    -- Strategy discovery (simple only)
  POST   /api/agents/robustness         -- Parameter robustness testing
  POST   /api/agents/analyze-market     -- Market regime analysis
  GET    /api/agents/jobs               -- Active agent jobs
  GET    /api/agents/jobs/:id           -- Job status + results
  ```

### Deliverable
AI agents discovering **simple, robust** strategies. Auto-backtesting with walk-forward validation. Scoring against prop firm rules. Rejecting complex/overfit strategies automatically.

---

## Phase 4.5 — OpenClaw Strategy Scout (Week 12-13)

**Goal:** Add an autonomous research layer that feeds the pipeline with strategy ideas — without manual input. OpenClaw + Ollama browses trading forums, Reddit, academic papers, and YouTube to discover new strategy concepts and automatically triggers the n8n → Trading Forge backtest loop.

> **Innovation:** Closes the loop. Pipeline goes from `human idea → AI generates → backtest` to `AI finds idea → AI generates → backtest → human reviews winners`. You become the **curator**, not the operator.

### Why OpenClaw

- **Model-agnostic** — runs on your existing Ollama instance ($0/mo)
- **Autonomous execution** — browses, reads, writes, runs code independently
- **No new infrastructure** — drops into existing n8n webhook pipeline
- **MIT licensed, 200K+ GitHub stars** — battle-tested open-source project

### Research Tool Stack (staged rollout)

| Priority | Tool | Purpose | Cost | Week |
|----------|------|---------|------|------|
| 1 | **Brave Search** | General web: trading blogs, prop firm sites, forums | Free (2K queries/mo) | Week 12 |
| 2 | **Reddit MCP** | r/algotrading, r/futurestrading, r/prop_firms | Free | Week 12 |
| 3 | **Tavily** | AI-optimized search, structured results for targeted queries | Free (1K queries/mo) | Week 12.5 |
| 4 | **YouTube MCP** | Transcribe & summarize strategy breakdown videos | Free | Week 13 |
| 5 | **Academic MCP** | arXiv/SSRN quantitative finance papers, new indicators | Free | Week 13 |

**Total cost: $0/mo** — all free tiers, ~50-100 targeted queries/day across all sources.

### Architecture

```
OpenClaw + Ollama (local, free)
    │
    ├── Brave Search  → "FTMO rule changes March 2026"
    ├── Reddit MCP    → r/algotrading top posts this week
    ├── Tavily        → "mean reversion futures strategy research"
    ├── YouTube MCP   → transcribe top algo trading videos
    ├── Academic MCP  → arxiv quantitative finance new papers
    │
    └── Ollama summarizes ALL into structured JSON
            │
            └── Posts to n8n webhook (POST /api/agent/scout-ideas)
                    │
                    └── n8n Workflow 2 (Weekly Strategy Hunt) picks up ideas
                            │
                            └── Trading Forge backtests → MC → prop firm sim
```

### Tasks

- [ ] **4.5.1** Install & configure OpenClaw
  ```
  - Install OpenClaw alongside existing Ollama
  - ollama launch openclaw (auto-configures connection)
  - Requires 64K+ context model (qwen3-coder or glm-4.7 recommended)
  - Verify: OpenClaw can communicate with local Ollama instance
  ```

- [ ] **4.5.2** Wire up Brave Search + Reddit MCP (Week 12)
  ```
  Phase 1 — Prove the concept

  Brave Search:
    - Sign up for free tier (2,000 queries/month)
    - Configure as OpenClaw search tool
    - Test queries: "futures trading strategy 2026", "prop firm rule changes"
    - Output: structured JSON with title, URL, summary, relevance score

  Reddit MCP:
    - Connect to subreddits: r/algotrading, r/futurestrading, r/prop_firms,
      r/daytrading, r/quantfinance
    - Scan: top posts (weekly), comments with strategy descriptions
    - Filter: posts mentioning backtesting, specific indicators, prop firms
    - Output: structured JSON with strategy concept, indicators mentioned,
      timeframe, asset class, upvote count (social proof signal)
  ```

- [ ] **4.5.3** Add Tavily for deep research (Week 12.5)
  ```
  Phase 2 — Targeted depth

  - Sign up for free tier (1,000 queries/month)
  - Use for targeted queries where Brave is too broad:
    "walk-forward optimization futures strategy 2026"
    "ATR trailing stop backtest results"
    "mean reversion RSI Bollinger Bands futures"
  - Tavily returns pre-structured, AI-friendly results
  - Complements Brave: Brave for breadth, Tavily for depth
  ```

- [ ] **4.5.4** Add YouTube MCP + Academic MCP (Week 13)
  ```
  Phase 3 — Edge discovery

  YouTube MCP:
    - Transcribe and summarize top algo trading channels
    - Focus on: strategy breakdowns, backtesting walkthroughs, indicator tutorials
    - Extract: strategy logic, parameters, claimed performance, timeframes
    - Flag videos with actual backtest results (higher signal)

  Academic MCP:
    - Search arXiv quantitative finance (q-fin) and SSRN
    - Focus on: new indicators, novel strategy concepts, market microstructure
    - Extract: paper title, abstract summary, key findings, proposed strategy logic
    - Flag papers with out-of-sample results (higher signal)
    - This is where genuine EDGE ideas come from — not Reddit
  ```

- [ ] **4.5.5** OpenClaw → n8n webhook integration
  ```
  New API endpoint in Trading Forge:
    POST /api/agent/scout-ideas

  Payload schema:
    {
      "source": "brave|reddit|tavily|youtube|academic",
      "strategy_concept": "Buy ES when RSI(14) < 30 and price touches lower BB",
      "indicators_mentioned": ["RSI", "Bollinger Bands"],
      "asset_class": "futures",
      "instruments": ["ES", "NQ"],
      "timeframe": "15min",
      "source_url": "https://...",
      "source_quality": "high|medium|low",
      "confidence_score": 0.0-1.0,
      "raw_summary": "..."
    }

  n8n receives payload → deduplicates → feeds into Workflow 2 (Weekly Strategy Hunt)
  → Ollama generates vectorbt code from concept → backtest → MC → prop firm sim

  Deduplication:
    - Hash strategy_concept + indicators + timeframe
    - Skip if same concept already tested in last 30 days
    - Track: ideas_received, ideas_tested, ideas_passed_gates
  ```

- [ ] **4.5.6** OpenClaw daily/weekly schedule
  ```
  Schedule (via n8n or OpenClaw native scheduler):

  Daily (6 PM EST — before Nightly Research workflow):
    - Brave Search: prop firm rule changes, market news
    - Reddit: scan top posts from subscribed subreddits
    - Output: 5-10 raw ideas → POST /api/agent/scout-ideas

  Weekly (Saturday 8 AM — before Weekly Strategy Hunt):
    - Tavily: deep research on specific strategy categories
    - YouTube: transcribe top 5 new algo trading videos
    - Academic: new arXiv q-fin papers from the week
    - Output: 10-20 curated ideas → POST /api/agent/scout-ideas

  Monthly:
    - Full scan of all sources for emerging trends
    - Summary report: what's trending in algo trading this month
    - Update search queries based on what's working
  ```

- [ ] **4.5.7** Metrics & monitoring
  ```
  Track OpenClaw Scout effectiveness:
    - ideas_received_total: total raw ideas from all sources
    - ideas_deduplicated: skipped (already tested)
    - ideas_tested: sent to backtest pipeline
    - ideas_passed_performance_gate: met $250/day minimum
    - ideas_passed_monte_carlo: survived MC simulation
    - ideas_deployed: reached PAPER or DEPLOYED status
    - source_hit_rate: % of ideas per source that pass gates
      (expect: Academic > Reddit > YouTube > Brave)
    - time_to_discovery: idea received → strategy deployed

  Dashboard widget: "Strategy Scout" panel showing pipeline funnel
  ```

### Deliverable
Self-feeding research pipeline. OpenClaw autonomously discovers strategy ideas from web, Reddit, YouTube, and academic papers. Ideas flow into the existing n8n → Trading Forge backtest loop without manual intervention. You review winners, not generate ideas.

---

## Phase 5 — Dashboard (Week 14-15)

**Goal:** Visual interface for monitoring strategies, backtests, and market data.

### Tasks

- [ ] **5.1** React dashboard (Vite + TailwindCSS)
  - Dark theme (trading-standard)
  - Responsive but desktop-first

- [ ] **5.2** Dashboard pages
  ```
  /                       -- Overview: active strategies, today's P&L, alerts
  /strategies             -- Strategy library with Forge Scores
  /strategies/:id         -- Strategy detail: config, backtest history, MC results
  /backtests              -- Backtest run history
  /backtests/:id          -- Equity curve, trade list, drawdown chart
  /monte-carlo/:id        -- MC fan chart, risk metrics, confidence bands
  /data                   -- Data pipeline status, symbol coverage
  /agents                 -- AI agent job history, discoveries
  /settings               -- API keys, alert config, data sources
  ```

- [ ] **5.3** Charting — three libraries, each with a clear role

  **lightweight-charts** (TradingView open-source) — CME futures charting
  - Candlestick charts for ES, NQ, CL, etc. (no CME data on TradingView widgets)
  - Fed by your own Databento/Massive data via API
  - Entry/exit trade markers overlaid on price charts
  - Equity curve with drawdown overlay

  **TradingView Widgets** (free embeddable) — overview & non-CME markets
  - Advanced Chart widget for stocks, indices, currencies (built-in delayed data)
  - Mini Chart widgets for watchlist overview
  - Heatmap widget for sector/market overview
  - Ticker tape widget for dashboard header
  - Symbol Overview for quick glance panels
  - Note: No CME futures support — use lightweight-charts for ES/NQ/CL

  **Recharts** (React) — analytics & custom data visualizations
  - Monte Carlo fan chart (percentile bands)
  - Monthly returns heatmap
  - Trade scatter plot (MAE vs MFE)
  - Win/loss distribution histogram
  - Correlation matrix (multi-strategy)
  - Forge Score breakdown charts

- [ ] **5.4** Real-time updates
  - SSE (Server-Sent Events) for backtest progress
  - Live agent status updates
  - Alert toast notifications

### Deliverable
Full dashboard with all visualizations. Can monitor everything from browser.

---

## Phase 6 — Live Paper Trading (Week 16-17)

**Goal:** Forward-test strategies with real-time data, no real money.

### Tasks

- [ ] **6.1** Paper trading engine
  - Massive WebSocket for real-time quotes (free tier: currencies, indices, options, stocks)
  - Virtual account with configurable starting capital
  - Realistic fill simulation (slippage, partial fills)
  - Position tracking + P&L computation

- [ ] **6.2** Strategy executor
  - Load active strategies from DB
  - Generate signals on each new bar
  - Execute virtual trades
  - Log to `paper_trades` table

- [ ] **6.3** Paper trading API
  ```
  POST   /api/paper/start              -- Start paper trading session
  POST   /api/paper/stop               -- Stop session
  GET    /api/paper/sessions            -- List sessions
  GET    /api/paper/sessions/:id        -- Session detail + live P&L
  GET    /api/paper/positions           -- Open positions
  GET    /api/paper/trades              -- Trade history
  ```

- [ ] **6.4** Execution Quality Tracker (Institutional Edge #5)
  ```
  Per-Trade Logging:
    - Expected fill price (signal price at time of signal generation)
    - Actual fill price (what you actually got)
    - Slippage = actual - expected (in ticks and dollars)
    - Commission paid
    - Time-to-fill (latency)
    - Order type used (market, limit, stop-market, stop-limit, TWAP)

  Aggregate Metrics (rolling):
    - Average slippage per trade (ticks + dollars)
    - Slippage as % of gross P&L (target: < 10%)
    - Slippage by time of day (higher around opens/closes)
    - Slippage by volatility regime (higher during vol spikes)
    - Fill rate on limit orders (% of orders filled)

  Execution Rules:
    - Use stop-LIMIT orders, never stop-market (avoid catastrophic slippage)
    - Use TWAP/VWAP for entries > 2 contracts
    - Build execution cost as VARIABLE in backtests (f(volatility), not constant)
    - If average slippage > backtest assumptions → strategy is NOT actually profitable

  Alert: If slippage exceeds 2x backtest assumption for 5+ consecutive trades → PAUSE strategy
  ```

- [ ] **6.5** Strategy Decay Monitor (Institutional Edge #6)
  ```
  What to Track (rolling windows):
    - 30-day rolling Sharpe ratio (primary decay signal)
    - 60-day rolling Sharpe ratio (confirmation)
    - Rolling win rate (separate from Sharpe — decay shows as shrinking avg wins first)
    - Rolling average win / average loss ratio
    - Rolling profit factor

  Alpha Decay Warning Levels:
    LEVEL 1 — WATCH (yellow):
      - Rolling Sharpe drops below 1.5 (from deployment baseline)
      - OR average win shrinks by 20%+ while win rate holds steady
      → Action: Flag for review, continue trading at full size

    LEVEL 2 — REDUCE (orange):
      - Rolling Sharpe drops below 1.0
      - OR rolling profit factor drops below 1.5
      → Action: Reduce allocation by 50%, accelerate pipeline for replacement

    LEVEL 3 — RETIRE (red):
      - Rolling Sharpe drops below 0.5 for 30+ days
      - OR rolling profit factor drops below 1.2
      → Action: Move to RETIRED state, stop trading, archive

  Signal Crowding Detection:
    - If strategy uses publicly available signals (RSI, MA crossovers on popular timeframes)
      → assume faster decay (monitor on 14-day rolling windows instead of 30-day)
    - Proprietary or alternative data signals → slower decay expected

  Decay Rate Tracking:
    - Log monthly Sharpe decline rate
    - Estimate remaining strategy lifespan based on decay curve
    - Alert when estimated remaining life < 3 months → start replacement process
  ```

- [ ] **6.6** Live vs Backtest Drift Detection (Institutional Edge #7)
  ```
  Continuous Comparison Engine:
    - For each deployed strategy, maintain a "backtest expectation" baseline:
      · Expected daily P&L mean and std dev (from walk-forward OOS)
      · Expected win rate
      · Expected max drawdown
      · Expected Sharpe ratio

  Drift Detection:
    - Compare live 30-day rolling metrics to backtest expectations
    - Flag when live performance deviates by > 1 standard deviation
    - ALERT when live performance deviates by > 2 standard deviations

  Specific Checks:
    - Daily P&L: Is live avg daily P&L within 1 std dev of backtest expectation?
    - Win rate: Is live win rate within 5% of backtest win rate?
    - Drawdown: Is live max DD tracking proportionally to backtest max DD?
    - Trade frequency: Are we taking the expected number of trades?
      (Too few = signals not firing; too many = noise trades)

  Root Cause Analysis:
    When drift detected, auto-diagnose:
    1. Execution issue? (slippage > expected → check execution tracker)
    2. Regime mismatch? (strategy running in wrong regime → check regime detector)
    3. Alpha decay? (signals losing effectiveness → check decay monitor)
    4. Data issue? (feed problems, missing bars → check data pipeline)

  Dashboard: Side-by-side chart of expected equity curve (backtest) vs actual (live)
  ```

- [ ] **6.7** Multi-Strategy Portfolio Manager (Institutional Edge #4)
  ```
  Portfolio Construction:
    - Target: 2-3 uncorrelated strategies running simultaneously
    - Measure strategy-to-strategy correlation on RETURNS, not on trades
    - Two strategies can trade different instruments but correlate if they
      share the same underlying factor (e.g., both effectively "long risk-on")

  Correlation Management:
    - Target: correlation < 0.3 between any two deployed strategies
    - If correlation > 0.5 → treat them as ONE strategy for sizing purposes
    - Recalculate correlation monthly on rolling 60-day windows

  Portfolio Heat Control:
    - Track TOTAL portfolio exposure as a percentage
    - The "2% rule" applies to TOTAL portfolio heat, not just individual trades
    - If 3 strategies are all long simultaneously → actual risk is 3x what it looks like
    - Limit: total portfolio risk never exceeds 4% of account at any moment

  Factor Decomposition:
    - Decompose portfolio returns into factor exposures:
      · Equity beta (directional market exposure)
      · Volatility factor (long/short vol)
      · Momentum factor
      · Mean-reversion factor
    - Ensure portfolio is not accidentally concentrated in one factor
    - Alert if single factor explains > 60% of portfolio returns

  Strategy Allocation Overlay:
    - Cross-sectional momentum on your OWN strategies:
      · Increase allocation to strategies with strong recent risk-adjusted performance
      · Decrease allocation to underperformers
    - Time-series filter: if strategy equity curve < its own 30-day MA → reduce allocation
    - This overlay adds value per Quantpedia research

  Portfolio-Level Risk:
    - Portfolio Sharpe (not just per-strategy Sharpe)
    - Portfolio max drawdown (can be WORSE than worst single strategy during correlation spikes)
    - Tail risk: what happens if all strategies lose on the same day? (correlation → 1 in crises)
  ```

- [ ] **6.8** Alert system
  - SNS → SMS/Email for trade signals
  - Drawdown threshold alerts
  - Strategy degradation warnings (from decay monitor)
  - Execution quality warnings (from execution tracker)
  - Live vs backtest drift alerts (from drift detector)
  - Portfolio correlation spike alerts (from portfolio manager)
  - Pipeline health alerts (no strategies in development)
  - Daily P&L summary (per-strategy + portfolio aggregate)

- [ ] **6.10** Dynamic correlation monitoring
  - Recalculate portfolio correlation daily after market close (5 PM ET)
  - Alert when correlation between any 2 deployed strategies spikes > 0.5
  - During vol events, correlations converge — exactly when you need diversification most
  - Auto-reduce combined position size when correlation > 0.5 to maintain portfolio heat limits

- [ ] **6.11** Proactive decay prediction
  - If regime indicators shift away from strategy's preferred regime, reduce allocation BEFORE Sharpe drops
  - Example: trend strategy has preferred regime = ADX > 25. If ADX drops from 30 to 22 over 5 days, reduce allocation by 50% even though rolling Sharpe hasn't dropped yet
  - Reactive decay detection (rolling Sharpe) catches decay after it happens. This catches it before.

### Deliverable
Strategies running on live data (paper). Full institutional monitoring suite: execution tracking, decay detection, drift monitoring, multi-strategy portfolio management. Proactive risk management. Alerts firing. Forward-test validation.

---

## Phase 7 — Production Hardening (Week 18-19)

**Goal:** Make everything robust, monitored, and maintainable.

### Tasks

- [ ] **7.1** Error handling + retry logic across all services
- [ ] **7.2** Structured logging (pino)
- [ ] **7.3** Health checks for all external dependencies
- [ ] **7.4** Backup strategy: DB snapshots, S3 versioning
- [ ] **7.5** CI/CD: GitHub Actions for lint, test, deploy
- [ ] **7.6** Documentation: API docs (OpenAPI), strategy authoring guide
- [ ] **7.7** Performance: connection pooling, query optimization, caching
- [ ] **7.8** Cross-strategy signal confirmation
  - When 2+ uncorrelated deployed strategies independently generate the same directional signal at the same time, boost size by 25-50%
  - Requires correlation < 0.3 between the agreeing strategies (otherwise it's the same signal twice)
  - Free alpha from infrastructure already in place — just a portfolio manager overlay

### Deliverable
Production-ready system. Can run unattended. Self-healing where possible. Multi-strategy synergy.

---

## Phase 8 — Prop Firm Integration (Week 20-23)

**Goal:** Use Forge-validated strategies to pass prop firm evaluations and trade funded accounts.

> Full rules, payout formulas, simulation code, and firm-matching logic: **[docs/prop-firm-rules.md](docs/prop-firm-rules.md)**

### Quick Comparison

| Firm | Monthly (50K) | Profit Target | Max Drawdown | Split | Activation | Standout |
|------|--------------|---------------|-------------|-------|------------|----------|
| **MFFU** | $77 | $3,000 | $2,500 (5%) | 90/10 | $0 | Best value, no activation |
| **Topstep** | $49 | $3,000 (6%) | $2,000 (4%) | 90/10 | $149 | Cheapest monthly |
| **Tradeify** | $99 | $2,500 | $2,500 | 100% first $15K | $0 | Cheapest total |
| **Apex** | ~$167 | $3,000 | $2,500 | 100% first $25K | $85 | 20 accounts, news OK |
| **TPT** | $150 | $3,000 (6%) | $3,000 (6%) | 80→90% | $130 | Daily payouts, 15+ platforms |
| **FFN** | ~$150 | $3,000 | $2,500 | 80→90% | $120 | Free Quantower + MotiveWave |
| **Alpha Futures** | $99-$149 | 6-8% | 3.5-4% | 70→90% | $0-$149 | Advanced = 90% day one |

### What AI Agents Use From This

- **Backtest simulation:** Apply firm-specific trailing drawdown, consistency rules, and contract limits as hard constraints
- **Strategy scoring:** Report PASS/FAIL per firm with exact rule violations
- **Firm ranking:** Given a strategy profile, rank firms by expected ROI after fees and splits
- **Payout projection:** Calculate net profit after splits, activation fees, and ongoing costs

### Deliverable
Forge strategies validated via backtest/MC, scored against each firm's rules. AI agents simulate evaluation feasibility and project payouts.

---

## Budget Tracker

| Item | Monthly | Annual | Notes |
|------|---------|--------|-------|
| Railway Postgres | $5 | $60 | Hobby plan |
| AWS S3 | $2 | $24 | ~100GB storage |
| AWS Lambda | $0 | $0 | Free tier |
| AWS EC2 Spot (GPU) | $5 | $60 | 2-3 hrs/month burst |
| AWS SNS | $0 | $0 | Free tier |
| Databento | $0 | $0 | $125 one-time credits (historical bulk downloads) |
| Massive | $0 | $0 | Free tier: Currencies, Indices, Options, Stocks Basic |
| Alpha Vantage | $0 | $0 | Free tier: indicators, sentiment, MCP |
| Ollama / Local AI | $0 | $0 | Runs on Skytech |
| **Prop Firm Evals** | **$49-150** | **$588-1800** | **Topstep $49, MFFU $77, TPT $150** |
| **Total (infra only)** | **$7** | **$84** | **All data providers and AI are free/local** |
| **Total (with 1 prop eval)** | **$56-157** | **$672-1,884** | **Revenue-generating cost** |

**AWS $100 credits allocation:**
- S3: $24/year → covers ~4 years
- EC2 Spot: $60/year → covers ~1.5 years
- Lambda + SNS: $0
- **Runway: ~14 months** (S3 + EC2 combined)

**Databento $125 credits allocation:**
- ES (E-mini S&P 500): ~$30-40 for 5 years tick data
- NQ (E-mini Nasdaq): ~$30-40 for 5 years tick data
- CL (Crude Oil): ~$20-30 for 5 years tick data
- Remaining: secondary contracts (YM, RTY, GC, etc.)
- **Strategy: Download once as Parquet → S3 → backtest forever at $0**

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Overfitting strategies | Trade real money on curve-fitted garbage | Walk-forward + Monte Carlo + Forge Score gating |
| Data quality issues | Bad backtests from bad data | Cross-validate Databento vs Massive, multiple sources |
| API rate limits (Alpha Vantage/Massive) | Slow data fetches | S3 cache, batch requests, stagger across providers |
| Databento credits run out | Can't download more historical data | Download priority contracts first, cache everything in S3 |
| AWS credits expire | Need to pay or migrate | Monitor burn rate, have Railway fallback |
| RTX 5060 not enough VRAM | Can't run large MC on GPU | Fall back to CPU, use EC2 spot for heavy jobs |
| Scope creep | Never finish | Strict phase gates, MVP each phase |
| Single point of failure (you) | If you're away, nothing runs | n8n automation, alerts, self-healing |
| Prop firm rule violation | Account terminated, lose funded status | Dashboard tracks drawdown/consistency in real-time, alerts before limits |
| Prop firm policy changes | Rules change, strategy no longer fits | Multi-firm approach, agents re-rank firms on rule changes |
| Prop firm insolvency | Unpaid profits, lost account | Withdraw frequently, diversify across firms |
| Alpha decay (strategy edge dying) | Gradual P&L decline, unnoticed for months | Rolling Sharpe monitor, decay alerting, strategy pipeline always has replacements |
| Regime mismatch | Trend strategy running in range market | Regime detection gates every strategy, auto-pause in wrong regime |
| Execution slippage eating edge | Backtest shows profit, live shows loss | Per-trade slippage tracking, stop-limit orders, TWAP for larger orders |
| Correlation spike in crisis | All strategies lose simultaneously | Multi-strategy correlation monitoring, portfolio heat limits, crisis stress testing |
| Single strategy dependency | One strategy dies = zero income | Maintain 2-3 uncorrelated deployed strategies, pipeline always developing replacements |
| Emotional override of system | Turning off algo during drawdown (the #1 killer) | Automation reduces emotional decisions by ~40%, process review separate from outcome review |
| Live vs backtest divergence | Strategy behaves differently live than expected | Continuous drift detection, auto-diagnose root cause (execution/regime/decay/data) |
| Stop-market slippage | Catastrophic fill far from stop price | Use stop-LIMIT orders exclusively, never stop-market |

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-09 | Separate repo from Aspire | Zero overlap, different users, different concerns |
| 2026-03-09 | Express + Drizzle (same as Aspire) | Leverage existing skills, fast development |
| 2026-03-09 | Python for backtest engine | vectorbt ecosystem, numpy/pandas, GPU support |
| 2026-03-09 | S3 for data lake | Cheap, durable, works with Lambda |
| 2026-03-09 | Ollama for AI agents | Free, local, private, no API costs |
| 2026-03-09 | Railway for Postgres | Already using it for Aspire, simple |
| 2026-03-09 | No Supabase auth | Single user, API key is sufficient |
| 2026-03-09 | Trust Spine pattern from Aspire | Immutable audit trail for every trading decision |
| 2026-03-09 | Databento for historical data | Institutional-grade tick data, $125 free credits, download once to S3 |
| 2026-03-09 | Massive for real-time streaming | Free WebSocket feeds for live/paper trading |
| 2026-03-09 | Alpha Vantage for indicators + sentiment | 60+ server-side indicators, news API, MCP for AI agents |
| 2026-03-09 | Three providers over single provider | Redundancy, cost optimization ($0/mo), each excels at different role |
| 2026-03-09 | Three chart libraries | lightweight-charts for CME futures (no TradingView widget CME support), TradingView widgets for stocks/indices/overview, Recharts for analytics |
| 2026-03-09 | 7 prop firms documented for AI agents | MFFU, Topstep, TPT, Apex, FFN, Alpha Futures, Tradeify — full rules in docs/prop-firm-rules.md |
| 2026-03-09 | MFFU as best-value firm | $77/mo, $0 activation, 90/10 split, no consistency rule |
| 2026-03-09 | Agent-parseable prop firm rules | YAML configs, Python simulation code, payout formulas for each firm |
| 2026-03-09 | Simple strategies only | Max 5 params, one-sentence logic, proven edges. Agents REJECT complex/overfit strategies |
| 2026-03-09 | Robustness over optimization | Test parameter stability, not find "best" params. Wide range = robust = good |
| 2026-03-09 | Technical strategies only for agents | Agents find technical strategies (MAs, RSI, BB, breakouts). ICT/SMC is trader's discretionary overlay |
| 2026-03-09 | High-earning strategies or nothing | Min $250/day, 60%+ win days, 12+ green days per month. ONE account must be profitable. No multi-account scaling |
| 2026-03-09 | Performance gate before Monte Carlo | Reject strategies below minimums BEFORE wasting compute on MC. Earnings power is heaviest Forge Score weight (30/100) |
| 2026-03-09 | 3-tier strategy classification | Tier 1: $500+/day, Tier 2: $350+/day, Tier 3: $250+/day. Below Tier 3 = auto-reject |
| 2026-03-09 | Continuous contract back-adjustment | CRITICAL: Raw Databento prices have roll gaps that create fake signals. Ratio-adjust all continuous contracts before backtesting |
| 2026-03-09 | Polars + DuckDB over Pandas | Polars for 5-10x faster Parquet reads, DuckDB for querying S3 directly without download. Pandas kept only for vectorbt compatibility |
| 2026-03-09 | Optuna for robustness testing | Bayesian param search (TPE) maps parameter landscapes in ~800 trials vs 100K+ grid search. Used to find stable plateaus, not "best" params |
| 2026-03-09 | Community validation (Reddit/YouTube 2025-2026) | Exact stack (Databento→Parquet→S3, vectorbt, Ollama+n8n, TradingView lightweight-charts, $7-12/mo infra) confirmed as "the smart low-cost way" by r/algotrading, PyQuant, multiple YouTube creators |
| 2026-03-09 | Local AI Lab setup guide (Ollama + n8n + Docker) | Full operational runbook added: custom Modelfile for trading-quant agent, Docker Compose with Ollama + n8n + pgvector + Open WebUI, n8n webhook pattern for strategy generation loop, GPU tips for RTX 5060. Community-validated stack (r/algotrading, r/LocalLLaMA, r/n8n 2025-2026) |
| 2026-03-09 | Qwen2.5-Coder over Llama 3.1 70B for code gen | Community consensus: Qwen2.5-Coder:14b (~9 GB) generates cleaner vectorbt code than larger general models. Use Llama 3.1:8b as fast critic. Fits RTX 5060 VRAM comfortably |
| 2026-03-09 | n8n Workflow 4 — Daily Portfolio Monitor | Added daily post-market workflow: execution quality tracking, rolling Sharpe updates, live vs backtest drift checks, portfolio correlation monitoring, daily P&L summary |
| 2026-03-09 | Agent API webhooks for n8n integration | Three endpoints: /api/agent/run-strategy, /api/agent/critique, /api/agent/batch. Ollama generates code → n8n triggers Forge → results feed back. Scales to 1,000s of tests via batching |
| 2026-03-09 | Institutional Edge research (top 1% practices) | 8 capabilities identified from prop firm traders, institutional quants, and practitioner sources. Strategy selection matters less than risk management, execution quality, and process discipline |
| 2026-03-09 | Regime detection with strategy gating | ADX + ATR percentile for regime classification. Every strategy gets a preferred regime tag. Regime filter pauses strategies in unfavorable regimes. Study showed 495% vs 117% S&P with regime-based rebalancing |
| 2026-03-09 | Dynamic (volatility-scaled) position sizing | Scale inversely to ATR: contracts = target_risk / (ATR × tick_value). Institutions do this; retail uses fixed sizes and gets killed in vol spikes |
| 2026-03-09 | Historical crisis stress testing | Run every strategy through 8 known crises (2008, Flash Crash, COVID, 2022 rate shock). Test with 3x spreads, 50% fill rates, 2x slippage. Any crisis exceeding prop firm max DD = auto-fail |
| 2026-03-09 | Multi-strategy portfolio (2-3 uncorrelated) | Target correlation < 0.3 between strategies on returns. Track total portfolio heat. Factor decomposition to avoid hidden concentration. Cross-sectional momentum overlay on strategy allocation |
| 2026-03-09 | Execution quality tracking | Log expected vs actual fill price per trade. Slippage erodes 1-3% annually (7-20% of edge). Stop-limit over stop-market. TWAP/VWAP for larger orders |
| 2026-03-09 | Alpha decay monitoring | Track 30-day rolling Sharpe, 60-day confirmation. Shrinking avg wins = earliest signal. 5-10% annual effectiveness loss in liquid markets. Strategy lifespan estimation |
| 2026-03-09 | Live vs backtest drift detection | Continuous comparison of live rolling metrics to backtest expectations. >1 std dev = flag, >2 std dev = alert. Auto-diagnose: execution, regime, decay, or data issue |
| 2026-03-09 | Strategy pipeline lifecycle | 6 states: Candidate → Testing → Paper → Deployed → Declining → Retired. Always have replacement strategies in development. Auto-promote/demote based on metrics |

---

## Quick Reference: CLI Commands (Planned)

```bash
# Data
forge data sync ES --from 2020-01-01        # Sync ES data from S3
forge data fetch ES --backfill 5y            # Backfill 5 years from Databento
forge data status                            # Show data coverage

# Strategies
forge strategy create --template mean-rev    # Create from template
forge strategy list                          # List all strategies
forge strategy backtest <id>                 # Run backtest
forge strategy score <id>                    # Compute Forge Score

# Monte Carlo
forge mc run <backtest-id> --sims 10000      # Run MC simulation
forge mc gpu <backtest-id> --sims 100000     # GPU-accelerated MC

# Agents
forge agent find "momentum strategies for NQ" # Strategy discovery
forge agent optimize <strategy-id>            # Parameter optimization
forge agent analyze ES                        # Market regime analysis

# Paper Trading
forge paper start <strategy-id>              # Start paper trading
forge paper status                           # Show active sessions
forge paper stop <session-id>                # Stop session

# Prop Firms
forge prop simulate <strategy-id> --firm mffu   # Simulate strategy against MFFU rules
forge prop simulate <strategy-id> --all         # Simulate against all 7 firms
forge prop rank <strategy-id>                   # AI-rank best firms for strategy
forge prop payout <strategy-id> --firm topstep  # Project payout after fees/splits
forge prop rules                                # Show all firm rules summary
```
