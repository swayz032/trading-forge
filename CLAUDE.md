# Trading Forge — Project Conventions

## What This Is
Personal futures/derivatives strategy research lab. Single user (swayz032). Not a SaaS product.

## Tech Stack
- **API Server**: Express.js 5 + TypeScript (src/server/)
- **Database**: PostgreSQL + Drizzle ORM
- **Backtest Engine**: Python + vectorbt + Polars + DuckDB (src/engine/)
- **AI Agents**: TypeScript + Ollama (src/server/services/agent-service.ts, src/server/routes/agent.ts)
- **Dashboard**: React + Vite + TailwindCSS (src/dashboard/)
- **Data Lake**: AWS S3 (Parquet files)
- **Data Providers**:
  - **Databento** — Institutional-grade historical tick/futures data ($125 credits)
  - **Massive** — Free real-time WebSocket streaming (currencies, indices, options, stocks)
  - **Alpha Vantage** — 60+ technical indicators, news/sentiment API, MCP support
- **Orchestration**: n8n (external, local, Docker Compose in `docker-compose.local-ai.yml`)
- **Strategy Scout**: OpenClaw + Ollama (autonomous research — Brave Search, Reddit MCP, Tavily, YouTube MCP, Academic MCP)
- **AI Lab**: Ollama + n8n + OpenClaw + Trading Forge loop (see ROADMAP "Local AI Lab Setup" section)
  - Custom Modelfile: `ollama/Modelfile.trading-quant` (Qwen2.5-Coder:14b tuned for vectorbt)
  - Critic model: Llama 3.1:8b (fast analysis loop)
  - Webhooks: `/api/agent/run-strategy`, `/api/agent/critique`, `/api/agent/batch`, `/api/agent/scout-ideas`

## Commands
- `npm run dev` — Start Express server with hot reload
- `npm run db:generate` — Generate Drizzle migrations
- `npm run db:migrate` — Run migrations
- `npm run db:studio` — Open Drizzle Studio
- `npm test` — Run vitest
- `npm run lint` — ESLint

## Code Conventions
- TypeScript strict mode, ES modules
- Use Drizzle query builder, not raw SQL
- All API routes return JSON
- Auth: simple Bearer token (API_KEY env var), skip in dev
- Logging: pino (structured JSON in prod, pretty in dev)
- Python: type hints, pydantic for configs

## Project Structure
```
src/
├── server/           # Express API
│   ├── index.ts      # Entry point
│   ├── routes/       # Route handlers (one file per domain)
│   ├── db/           # Drizzle schema + migrations
│   ├── services/     # Business logic
│   └── middleware/    # Auth, logging, etc.
├── engine/           # Python backtest + Monte Carlo
├── data/             # Data pipeline scripts
├── agents/           # AI research agents
└── dashboard/        # React frontend
```

## Strategy Philosophy — SIMPLE WINS, HIGH EARNERS
- **Max 3-5 parameters per strategy.** More = overfitting. No exceptions.
- **One-sentence rule:** If you can't describe the strategy in one sentence, it's too complex. Reject it.
- **Proven edges only:** Trend following, mean reversion, volatility expansion, session patterns. No exotic ML signals.
- **Robustness > optimization.** A strategy that works with MA=15-25 is better than one that only works with MA=17.
- **Walk-forward validation is mandatory.** No strategy passes without out-of-sample testing.
- **No black-box ML for entries/exits.** ML is fine for regime detection and position sizing, not for signal generation.
- Agents must REJECT strategies that require tight parameter optimization to be profitable.
- **Technical strategies only for agents.** Agents find simple technical strategies (MAs, RSI, Bollinger, breakouts, VWAP, ATR). ICT/SMC concepts (order blocks, FVGs, liquidity sweeps) are discretionary and applied manually by the trader — agents do NOT codify ICT.
- **ONE account must be profitable.** Agents REJECT any strategy that requires multi-account scaling to be worth trading. If a strategy can't earn serious money on a single $50K prop firm account, it's not good enough.

## Strategy Performance Requirements — HARD MINIMUMS

> A strategy that needs 20 accounts to matter is not an edge. Every strategy Forge approves
> must be profitable enough to trade on ONE account and survive most trading days in a month.

### Minimum Performance Gates (agents MUST enforce these)

```yaml
# All metrics measured on walk-forward out-of-sample data, NOT in-sample backtests.
# ~20 trading days per month assumed.

minimum_avg_daily_pnl: $250        # $250/day × 20 days = $5,000/month gross on 1 account
minimum_monthly_gross: $5,000      # Must clear this on a single 50K account
minimum_win_rate_by_days: 0.60     # Profitable on 12+ out of 20 trading days
minimum_profit_factor: 1.75        # Winners must significantly outweigh losers
minimum_sharpe_ratio: 1.5          # Risk-adjusted returns must be strong
maximum_max_drawdown: $2,000       # Must survive tightest prop firm (Topstep 50K = $2K)
maximum_consecutive_losers: 4      # Max 4 losing days in a row (mental + drawdown survival)
minimum_expectancy_per_trade: $75  # Every trade must be worth taking
minimum_avg_winner_to_loser: 1.5   # Avg win must be 1.5x avg loss minimum
```

### Performance Tiers (for ranking strategies)

```yaml
# TIER 1 — "Bread and Butter" (deploy immediately)
tier_1:
  avg_daily_pnl: ">= $500"        # $10K+/month on one account
  win_days_per_month: ">= 14"     # 70%+ winning days
  max_drawdown: "< $1,500"        # Comfortable buffer at every firm
  profit_factor: ">= 2.5"
  sharpe: ">= 2.0"

# TIER 2 — "Solid Edge" (deploy with monitoring)
tier_2:
  avg_daily_pnl: ">= $350"        # $7K+/month
  win_days_per_month: ">= 13"     # 65%+ winning days
  max_drawdown: "< $2,000"
  profit_factor: ">= 2.0"
  sharpe: ">= 1.75"

# TIER 3 — "Minimum Viable" (deploy on best-fit firm only)
tier_3:
  avg_daily_pnl: ">= $250"        # $5K+/month
  win_days_per_month: ">= 12"     # 60%+ winning days
  max_drawdown: "< $2,500"
  profit_factor: ">= 1.75"
  sharpe: ">= 1.5"

# BELOW TIER 3 — REJECT. Not worth the trader's time or prop firm fees.
```

### Why These Numbers

```
MFFU 50K account costs $77/month to evaluate.
If strategy makes $5,000/month gross:
  - Pass evaluation in ~12-15 trading days (< 1 month)
  - Funded payout: $5,000 × 0.90 = $4,500/month to you
  - ROI on $77 eval fee = 5,844% annualized
  - One account. No scaling needed. No 20-account Apex games.

If strategy only makes $500/month (the kind we REJECT):
  - Takes 6+ months to pass evaluation = $462 in fees before funding
  - Funded payout: $500 × 0.90 = $450/month
  - Barely covers the eval cost in year one
  - You'd need 10 accounts to make $4,500/month = complexity, risk, headache
```

### Daily Survival Requirement

```
20 trading days/month. Strategy must be GREEN on 12+ of them.
The trader sits down, executes the signal, and walks away profitable most days.
Not "profitable over a 3-month window" — profitable THIS WEEK.

Agents track:
  - worst_month_win_days: Minimum winning days in any single month
  - avg_daily_pnl_on_losing_days: How bad are the red days?
  - recovery_days: After a losing day, how many days to recover?

Rules:
  - If worst_month_win_days < 10 in any month → REJECT (too inconsistent)
  - If avg_loss_on_red_days > avg_win_on_green_days → REJECT (losers too big)
  - If recovery after max_drawdown > 5 days → FLAG for review
```

## Institutional Edge — Monitoring & Risk (Top 1% Practices)
- **Regime detection is mandatory.** Every strategy must have a "preferred regime" tag. Regime filter pauses strategies when their preferred regime is NOT active. Use ADX + ATR percentile for classification.
- **Dynamic position sizing.** Scale position size inversely to trailing ATR: `contracts = target_risk / (ATR * tick_value)`. Never use fixed position sizes in production.
- **Stress test against historical crises.** Every strategy must survive 2008, COVID crash, 2022 rate shock with 3x spreads and 50% reduced fill rates. If any scenario exceeds prop firm max drawdown → FAIL.
- **Track execution quality.** Log expected vs actual fill price on every trade. If average slippage > backtest assumptions → strategy is NOT actually profitable. Use stop-limit orders, never stop-market.
- **Monitor for alpha decay.** Track 30-day rolling Sharpe. Shrinking average wins (before win rate drops) is the earliest decay signal. Reduce allocation gradually to decaying strategies.
- **Detect live vs backtest drift.** If live 30-day rolling metrics deviate > 1 std dev from backtest expectations → investigate. > 2 std dev → ALERT.
- **Multi-strategy portfolio.** Target 2-3 uncorrelated strategies (correlation < 0.3 on returns). Track total portfolio heat, not just per-trade risk. If correlation > 0.5 → treat as one strategy for sizing.
- **Strategy pipeline.** Always have at least 1 strategy in development while others are deployed. Strategies have lifespans — plan to replace them, not run forever.
- **Build execution cost as a VARIABLE** in backtests, not a constant. Slippage increases during volatility spikes and around news events.

## Key Patterns
- **Audit Log**: Every significant action (backtest, MC run, strategy change) gets an audit_log entry — borrowed from Aspire's Trust Spine pattern
- **Forge Score**: 0-100 composite score for strategy quality (Sharpe + Drawdown + MC survival + Walk-forward)
- **Node↔Python bridge**: Node spawns Python subprocess, passes JSON config, receives JSON results

## Database
- PostgreSQL on Railway
- Schema in src/server/db/schema.ts
- Migrations via drizzle-kit
- All IDs are UUIDs

## Prop Firm Integration
- **Full rules reference:** `docs/prop-firm-rules.md` — agents MUST load this when simulating strategies
- 7 firms tracked: MFFU, Topstep, TPT, Apex, FFN, Alpha Futures, Tradeify (+ Earn2Trade)
- Agents simulate strategies against each firm's exact rules (drawdown, consistency, contract limits)
- Agents rank firms by expected ROI given a strategy's profile
- Agents calculate payout projections after splits, fees, and ongoing costs
- User trades manually — Forge provides strategy signals and firm rule compliance tracking

## Prop Firm Compliance (Live Rule Enforcement)
- **Architecture:** `docs/PROP-FIRM-COMPLIANCE.md` — three-layer compliance architecture
- **OpenClaw Compliance Guard:** `src/agents/OPENCLAW_COMPLIANCE_GUARD.md` — system prompt for compliance sidecar
- **Rule Engine:** `src/engine/compliance/compliance_gate.py` — deterministic enforcement (no AI judgment)
- **API Routes:** `src/server/routes/compliance.ts` — `/api/compliance/*`
- **Three layers:** OpenClaw monitors → Rule engine enforces → Human approves
- **Freshness gate:** `ruleset_max_age_hours` — 24h for active trading, 72h for research, 0h after drift
- **Drift detection:** Content hash comparison on every doc fetch — blocks approvals until human revalidates
- **Tables:** `compliance_rulesets`, `compliance_reviews`, `compliance_drift_log`
- **Critical rule:** No strategy runs if current rules are stale, ambiguous, or violated. Compliance beats profit.

## System Journal (AI Self-Learning Loop)
- **Table:** `system_journal` — logs every AI-generated strategy's full backtest results, equity curve, daily P&Ls, and prop compliance
- **Purpose:** Ollama Analyst reviews its own past generations nightly via n8n and self-critiques. The system gets smarter every day.
- **n8n integration:** After every backtest, n8n POSTs to `/api/journal` to log the result. Nightly, Ollama Analyst reads recent entries and adds `analystNotes`.
- **Routes:**
  - `GET /api/journal` — List entries (filter by `?status=`, `?tier=`, `?source=`, `?limit=`)
  - `GET /api/journal/:id` — Single entry
  - `POST /api/journal` — Log new entry (called by n8n after backtest)
  - `PATCH /api/journal/:id` — Update (Ollama adds self-critique notes)
  - `GET /api/journal/stats/summary` — Aggregate stats (total, pass rate, by tier/source)

## Prop Risk Calculator
- **Routes:**
  - `POST /api/risk/max-contracts` — Given symbol, ATR, firm, account size, returns safe max contracts per account and across all accounts
  - `POST /api/risk/portfolio-heat` — Given all open positions, returns total exposure, unrealized P&L, drawdown usage per account, and heat percentage
- **Purpose:** Call before every live session to ensure you never breach drawdown limits across multiple prop accounts
- Supports all 7 firms (Topstep, MFFU, TPT, Apex, Tradeify, Alpha, FFN) and all contract specs (ES, NQ, CL, YM, RTY, GC, MES, MNQ)

## Data Provider Roles
- **Databento** → Historical bulk downloads (Phase 1 backfill). Download once to S3, never re-pay.
- **Massive** → Real-time streaming for paper/live trading (Phase 6). Free WebSocket.
- **Alpha Vantage** → Server-side indicators + sentiment for AI agents (Phase 4). MCP-enabled.
- All three are free ($0/mo). Databento has $125 one-time credits.

## Data Layer Rules
- **Polars is the primary data library** — use for all Parquet loading, transforms, and filtering. 5-10x faster than Pandas.
- **DuckDB for S3 queries** — query Parquet on S3 directly with SQL, no download needed for selective date ranges.
- **Pandas only at the vectorbt boundary** — convert Polars → Pandas with `.to_pandas()` only when passing data to vectorbt.
- **ALWAYS use ratio-adjusted continuous contracts for backtesting** — never raw Databento prices. Roll gaps create fake signals.
- Raw prices stored in S3 for reference, but all backtests run on `ratio_adj/` data.
- **Optuna for parameter robustness testing** — Bayesian search (TPE) to map stable plateaus, not find "best" params. ~800 trials vs 100K+ grid search.

## Don't
- Don't add Supabase or complex auth — it's just one user
- Don't over-engineer — MVP each phase, iterate
- Don't generate complex strategies — max 5 parameters, one-sentence logic, proven edges only
- Don't optimize parameters to find "the best" — test robustness across a wide range instead
- Don't use ML/neural nets for entry/exit signals — only for regime detection and sizing
- Don't store secrets in code — use .env
- Don't commit the data/ directory — it's gitignored (lives in S3)
- Don't waste Databento credits on data you can get from Massive/Alpha Vantage for free
- Don't simulate strategies against a firm without loading `docs/prop-firm-rules.md` first
- Don't ignore consistency rules (TPT 50%, FFN Express 15%) — these disqualify many strategies
- Don't use Pandas for data loading — use Polars (only convert to Pandas at vectorbt boundary)
- Don't backtest on raw/unadjusted continuous contracts — always use ratio-adjusted data
- Don't use grid search for parameter testing — use Optuna (Bayesian/TPE) for 100x fewer trials
- Don't use fixed position sizes in production — scale inversely to volatility (ATR-based)
- Don't deploy a strategy without a preferred regime tag — regime filter must gate every strategy
- Don't use stop-market orders — use stop-limit orders (stop-market can cause catastrophic slippage)
- Don't ignore execution quality — if slippage > backtest assumptions, the strategy isn't profitable
- Don't run just one strategy — target 2-3 uncorrelated strategies (correlation < 0.3 on returns)
- Don't treat strategies as permanent — they have lifespans, always be developing replacements
- Don't model slippage as a constant — it's a function of volatility (higher during vol spikes)
- Don't ignore time-of-day liquidity — overnight ES has 2x spreads vs RTH core; slippage multipliers by session are mandatory
- Don't trade through FOMC/CPI/NFP without explicit event handling — default is SIT_OUT ±30 min
- Don't assume limit orders always fill — model fill probability, especially for mean reversion entries at extremes
- Don't use gross P&L for performance gates — use net P&L per firm (commissions differ: MFFU $1.58/side vs Apex $2.64/side)
- Don't ignore firm contract caps in backtests — ATR sizing capped to `min(ATR_size, firm_max_contracts)`
- Don't ignore overnight gap risk — strategies holding across sessions need gap-adjusted MAE and drawdown
