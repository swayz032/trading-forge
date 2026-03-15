# Research OS — Innovation Systems (Insert Before Phase 5)

> **Context:** Phases 0-4 are complete. These 5 systems must be built BEFORE Phase 5 (Dashboard).
> They transform Trading Forge from a backtester into a **research operating system** —
> a closed loop that gets smarter with every run.
>
> **Priority order:** Compiler → Graveyard → Tournament → Regime Graph → Half-Life Detector
>
> The closed loop: `idea → compile → attack → backtest → stress → label failure → store memory → mutate → retest → promote/demote`

---

## Phase 4.6 — Strategy Compiler (Foundation)

**Goal:** Replace soft AI prose with a strict JSON strategy DSL. Every strategy idea MUST compile into a deterministic, diffable, replayable schema before it touches the backtest engine. No valid DSL = no backtest slot.

**Why this is the foundation:** Without a compiler, the AI layer is fake intelligence. Strategies that can't be expressed as structured data can't be compared, version-controlled, or ranked by structure. The compiler is the contract between AI output and backtest input.

### Strategy DSL Schema

```jsonc
{
  "$schema": "strategy-dsl-v1",
  "meta": {
    "name": "ES Overnight Mean Reversion",
    "version": "1.0.0",
    "author": "strategy-finder",           // which agent/human created it
    "created": "2026-03-14T12:00:00Z",
    "one_sentence": "Fade extended overnight moves using Bollinger Bands on 15min ES during Asia/London overlap",
    "tags": ["mean-reversion", "overnight", "ES"]
  },
  "market": {
    "symbol": "ES",
    "contract_type": "continuous_ratio_adjusted",
    "tick_value": 12.50,
    "tick_size": 0.25
  },
  "timeframes": {
    "primary": "15min",                    // signal timeframe
    "confirmation": "1h",                  // optional higher timeframe filter
    "execution": "1min"                    // entry/exit precision
  },
  "session": {
    "allowed_hours_et": ["18:00-02:00"],   // when the strategy is active
    "blocked_hours_et": ["09:25-09:35"],   // never trade during these windows
    "trading_days": ["Mon", "Tue", "Wed", "Thu", "Fri"],
    "event_handling": "SIT_OUT"            // SIT_OUT | REDUCE | IGNORE for FOMC/CPI/NFP
  },
  "regime_filter": {
    "preferred_regime": "low_volatility",  // low_volatility | high_volatility | trending | ranging
    "adx_range": [0, 20],                 // only active when ADX is in this range
    "atr_percentile_range": [0, 50]       // only active when ATR percentile is in this range
  },
  "entry": {
    "direction": "both",                   // long | short | both
    "pattern": "bollinger_band_touch",     // from pattern library
    "indicators": [
      { "name": "BB", "period": 20, "std": 2.0 },
      { "name": "RSI", "period": 14, "threshold_long": 30, "threshold_short": 70 }
    ],
    "conditions": [
      "price <= BB.lower AND RSI < RSI.threshold_long",   // long entry
      "price >= BB.upper AND RSI > RSI.threshold_short"    // short entry
    ],
    "order_type": "stop_limit",
    "max_entries_per_session": 3
  },
  "exit": {
    "take_profit": { "method": "BB_middle", "indicator": "BB.middle" },
    "stop_loss": { "method": "ATR_multiple", "multiplier": 1.5 },
    "time_exit": { "minutes_after_entry": 120 },
    "trailing_stop": null
  },
  "sizing": {
    "method": "volatility_scaled",         // fixed | volatility_scaled
    "target_risk_per_trade": 0.01,         // 1% of account
    "formula": "contracts = (account * target_risk) / (ATR * tick_value)",
    "max_contracts": 5                     // hard cap (firm limit aware)
  },
  "invalidation": {
    "max_consecutive_losers": 4,
    "max_daily_loss": 500,                 // USD — stop trading for the day
    "correlation_gate": 0.3                // pause if correlated > 0.3 with another active strategy
  },
  "slippage_assumptions": {
    "entry_slippage_ticks": 1,
    "exit_slippage_ticks": 1,
    "session_multipliers": {
      "overnight": 2.0,
      "rth_open": 1.5,
      "rth_core": 1.0,
      "rth_close": 1.25
    }
  },
  "backtest_requirements": {
    "minimum_bars": 50000,
    "walk_forward_splits": 5,
    "monte_carlo_sims": 10000,
    "crisis_stress_test": true
  }
}
```

### Compiler Rules

1. **Validation gate** — Every field is required. Missing fields = compile error, no backtest.
2. **Parameter count check** — Count all numeric parameters in `entry.indicators` + `exit`. If > 5 → reject with "too many parameters, simplify."
3. **One-sentence check** — `meta.one_sentence` must be < 140 characters. If Ollama can't describe it in one sentence, it's too complex.
4. **Schema versioning** — DSL version is tracked. Old strategies can be re-compiled against new schema versions.
5. **Diff-friendly** — JSON is git-trackable. Every strategy change is a visible diff.
6. **Deterministic** — Same DSL + same data = same backtest result. Always.

### Implementation

```
src/
├── engine/
│   ├── compiler/
│   │   ├── strategy_schema.py      # Pydantic model matching the DSL
│   │   ├── compiler.py             # Validates + compiles DSL → backtest config
│   │   ├── pattern_library.py      # Registry of valid entry/exit patterns
│   │   └── schema_versions/        # Versioned schemas for migration
│   └── ...
├── server/
│   ├── routes/
│   │   └── compiler.ts             # POST /api/compiler/validate — checks DSL
│   └── ...
```

### API Routes

```
POST  /api/compiler/validate        — Validate a strategy DSL (returns errors or "valid")
POST  /api/compiler/compile         — Compile DSL → backtest-ready config
GET   /api/compiler/schema          — Return current DSL schema (for Ollama context)
POST  /api/compiler/diff            — Diff two strategy DSLs (structural comparison)
```

### n8n Integration

- Ollama outputs strategy → n8n sends to `/api/compiler/validate`
- If invalid → return errors to Ollama for self-correction (max 3 retries)
- If valid → forward to `/api/backtest/run`
- Every compiled strategy is stored in Postgres with its DSL JSON

### Ollama Modelfile Update

Add to the trading-quant Modelfile system prompt:
```
CRITICAL: You MUST output strategies in the Strategy DSL JSON format.
Do NOT output prose descriptions. Do NOT output raw Python code.
Every strategy must compile against the DSL schema.
The schema is available at /api/compiler/schema.
If you cannot express your idea in the DSL, the idea is too complex. Simplify it.
```

### Deliverable
Every strategy idea — whether from Strategy Finder, OpenClaw Scout, or human input — passes through the compiler before consuming any backtest compute. Strategies are deterministic, diffable, version-controlled, and rankable by structure.

---

## Phase 4.7 — Strategy Graveyard (Anti-Memory)

**Goal:** Build a vector-searchable archive of every failed strategy, tagged with its exact failure mode. Every new candidate is checked against the graveyard before it gets a backtest slot. The system learns what NOT to do.

**Why this matters:** Most traders save winners and forget corpses. That is backwards. After 6 months with 500+ failures archived, the system stops wasting compute on recycled garbage. Anti-memory compounds faster than positive memory.

### Failure Taxonomy

Every failed strategy gets tagged with one or more failure modes:

```yaml
failure_modes:
  regime_fragility:
    description: "Only works in one regime, dies in others"
    example: "Trend strategy that only works when ADX > 30 — fails 70% of the time"

  slippage_sensitivity:
    description: "Profitable in backtest, unprofitable with realistic slippage"
    example: "Scalper that needs 0 slippage to work — real slippage eats entire edge"

  time_of_day_overfit:
    description: "Edge exists only in a narrow time window that doesn't generalize"
    example: "Opening range breakout that only works 9:35-9:40 on Tuesdays"

  parameter_fragility:
    description: "Works with MA=17 but fails with MA=15 or MA=19"
    example: "Strategy needs exact RSI=14, BB=2.1 — any change kills it"

  macro_event_blowup:
    description: "Looks great in normal conditions, catastrophic during macro events"
    example: "Mean reversion that blew up during 2022 rate shock"

  cross_market_non_transfer:
    description: "Works on ES but fails on NQ, CL, or other markets"
    example: "Pattern is specific to ES microstructure, not a real edge"

  insufficient_edge:
    description: "Passes some gates but expectancy too low after costs"
    example: "$40/trade expectancy disappears with commissions + slippage"

  correlation_duplicate:
    description: "Structurally identical to an existing strategy (different clothes, same body)"
    example: "BB mean reversion that's just RSI mean reversion with extra steps"

  drawdown_excess:
    description: "Profitable but drawdown exceeds prop firm limits"
    example: "$8K max drawdown on a $50K account — no firm allows this"

  walk_forward_failure:
    description: "In-sample looks great, out-of-sample falls apart"
    example: "Classic overfitting — trained on noise, not signal"
```

### Architecture

```
src/
├── engine/
│   ├── graveyard/
│   │   ├── embedder.py             # Generate embeddings from strategy DSL + failure context
│   │   ├── similarity.py           # Cosine similarity search against graveyard
│   │   ├── failure_tagger.py       # Auto-tag failure modes from backtest results
│   │   └── graveyard_gate.py       # Pre-backtest check: "is this a known corpse?"
│   └── ...
├── server/
│   ├── routes/
│   │   └── graveyard.ts            # CRUD + search routes
│   └── ...
```

### Database (pgvector — already in Docker Compose)

```sql
CREATE TABLE strategy_graveyard (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_dsl JSONB NOT NULL,              -- the full compiled DSL
  failure_modes TEXT[] NOT NULL,             -- array of failure mode tags
  failure_details JSONB,                    -- specific metrics that caused failure
  backtest_summary JSONB,                   -- key metrics from the failed backtest
  external_context TEXT,                    -- Tavily/Brave context if relevant
  embedding vector(1536) NOT NULL,          -- Ollama embedding of DSL + failure context
  similarity_threshold FLOAT DEFAULT 0.85,  -- how similar is "too similar"
  created_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT,                              -- strategy-finder | openclaw | human | tournament
  death_cause TEXT                          -- one-sentence summary of why it failed
);

CREATE INDEX idx_graveyard_embedding ON strategy_graveyard
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX idx_graveyard_failure_modes ON strategy_graveyard
  USING gin (failure_modes);
```

### Graveyard Gate Flow

```
New strategy candidate arrives
    ↓
Compile to DSL (Phase 4.6)
    ↓
Generate embedding from DSL
    ↓
Search graveyard: cosine similarity > 0.85?
    ├── YES → REJECT with message:
    │         "This is 92% similar to [dead strategy name].
    │          It died because: [failure_mode].
    │          Specific issue: [death_cause].
    │          Either differentiate significantly or move on."
    │
    └── NO → Proceed to backtest
              ↓
         Backtest fails?
              ├── YES → Auto-tag failure mode
              │         Generate embedding
              │         Add to graveyard
              │         Attach external context (Tavily) if relevant
              │
              └── NO → Strategy passes → promote to next stage
```

### API Routes

```
POST   /api/graveyard/check          — Check candidate against graveyard (returns similar corpses)
POST   /api/graveyard/bury           — Add a failed strategy to graveyard
GET    /api/graveyard/search         — Search by failure mode, similarity, date range
GET    /api/graveyard/stats          — Failure mode distribution, most common death causes
GET    /api/graveyard/:id            — Get specific graveyard entry
DELETE /api/graveyard/:id            — Remove entry (rare — if wrongly buried)
```

### Embedding Strategy

Use Ollama embeddings (nomic-embed-text or mxbai-embed-large — both free, local):
- Input: concatenation of `meta.one_sentence` + `entry.conditions` + `exit` rules + `regime_filter` + failure details
- This captures both WHAT the strategy does and WHY it failed
- Cosine similarity > 0.85 = "too similar to a known corpse"
- Cosine similarity 0.70-0.85 = "warning: partially similar, review these corpses before proceeding"

### Deliverable
Every failed strategy is embedded, tagged, and searchable. New candidates are automatically checked against the graveyard before wasting compute. The system accumulates institutional memory of what doesn't work. After 500+ entries, this becomes a genuine competitive edge.

---

## Phase 4.8 — Adversarial Strategy Tournament

**Goal:** Replace single-model strategy generation with a 4-role adversarial process. Strategies must survive intellectual attack before earning a backtest slot. Most bad ideas die here instead of wasting compute.

**Why this matters:** One model generating and one model "reviewing" is theater. Real validation requires adversarial tension — roles with opposing incentives that stress-test ideas from different angles.

### The Four Roles

```yaml
roles:
  proposer:
    model: "qwen2.5-coder:14b"
    system_prompt: |
      You are a strategy PROPOSER. Your job is to generate strategy candidates
      in the Strategy DSL format. You have access to the current regime,
      recent graveyard entries, and the strategy pipeline status.
      Generate creative but simple strategies (max 5 parameters).
      Output ONLY valid Strategy DSL JSON.
    incentive: "Create strategies that pass all gates"
    tools: [compiler_schema, graveyard_recent, regime_current]

  critic:
    model: "llama3.1:8b"
    system_prompt: |
      You are a strategy CRITIC. Your job is to find logical flaws,
      hidden assumptions, and structural weaknesses in strategy candidates.
      You receive a compiled Strategy DSL and must output specific objections.
      Be ruthless. Your reputation depends on catching bad strategies
      BEFORE they waste compute.
      Common attacks: parameter fragility, regime dependency, slippage sensitivity,
      time-of-day bias, correlation with existing strategies.
    incentive: "Find fatal flaws before backtest"
    tools: [graveyard_search, existing_strategies]

  prosecutor:
    model: "llama3.1:8b"
    system_prompt: |
      You are a strategy PROSECUTOR. Your job is to find EXTERNAL evidence
      that invalidates the strategy thesis. Use Brave Search and Tavily to find:
      - Academic papers showing the edge doesn't exist or has decayed
      - Forum posts from traders who tried similar approaches and failed
      - Market microstructure changes that would kill this edge
      - Regulatory or structural changes that affect the thesis
      Output specific counter-evidence with sources.
    incentive: "Find real-world evidence against the thesis"
    tools: [brave_search, tavily_extract, tavily_search]

  promoter:
    model: "qwen2.5-coder:14b"
    system_prompt: |
      You are the strategy PROMOTER (final judge). You receive:
      1. The original Strategy DSL from the Proposer
      2. The Critic's objections
      3. The Prosecutor's external counter-evidence
      Your job is to make a final decision:
      - PROMOTE: Strategy deserves a backtest slot. Objections are addressable.
      - REVISE: Strategy has merit but needs modifications. Output revised DSL.
      - KILL: Strategy is fundamentally flawed. Send to graveyard with failure tags.
      You must justify your decision with specific reasoning.
    incentive: "Only promote strategies with genuine edge potential"
    tools: [compiler_validate, graveyard_check]
```

### Tournament Flow

```
n8n Workflow: "Strategy Tournament"
Trigger: scheduled (daily) or webhook (manual)

Step 1: PROPOSE
  → Ollama (qwen2.5-coder) generates 3-5 candidates
  → Each compiled to DSL via /api/compiler/validate
  → Each checked against graveyard via /api/graveyard/check
  → Surviving candidates proceed

Step 2: CRITIQUE (parallel — one per candidate)
  → Ollama (llama3.1:8b) attacks each candidate
  → Output: list of specific objections per candidate
  → Candidates with 0 valid objections are suspicious (critic wasn't trying)

Step 3: PROSECUTE (parallel — one per candidate)
  → Ollama (llama3.1:8b) + Brave/Tavily researches counter-evidence
  → Output: external evidence for/against each candidate
  → Time-boxed: max 60 seconds research per candidate

Step 4: PROMOTE/KILL
  → Ollama (qwen2.5-coder) reviews all evidence
  → Decision: PROMOTE | REVISE | KILL
  → PROMOTED → queue for backtest
  → REVISED → re-compile, re-check graveyard, queue for backtest
  → KILLED → auto-bury in graveyard with failure tags from critic + prosecutor

Step 5: LOG
  → Full tournament transcript stored in system_journal
  → Win/loss/revision rates tracked per role
  → Roles can be tuned based on hit rates
```

### n8n Implementation

```
Workflow: Strategy Tournament
├── Trigger: Cron (daily 6 AM ET) or Webhook
├── Node 1: Proposer (Ollama HTTP Request → qwen2.5-coder)
├── Node 2: Compiler Gate (HTTP → /api/compiler/validate)
├── Node 3: Graveyard Gate (HTTP → /api/graveyard/check)
├── Node 4: Split (one branch per surviving candidate)
│   ├── Node 4a: Critic (Ollama → llama3.1:8b)  ← parallel
│   └── Node 4b: Prosecutor (Ollama → llama3.1:8b + Brave/Tavily)  ← parallel
├── Node 5: Merge results per candidate
├── Node 6: Promoter (Ollama → qwen2.5-coder)
├── Node 7: Route decision
│   ├── PROMOTE → POST /api/backtest/queue
│   ├── REVISE → Loop back to Node 2 (max 2 revisions)
│   └── KILL → POST /api/graveyard/bury
└── Node 8: Log to system_journal
```

### Metrics to Track

```yaml
tournament_metrics:
  candidates_proposed: 0          # total ideas generated
  killed_by_compiler: 0           # failed DSL validation
  killed_by_graveyard: 0          # too similar to known corpses
  killed_by_critic: 0             # logical flaws found
  killed_by_prosecutor: 0         # external evidence against
  killed_by_promoter: 0           # final judge said no
  revised_and_resubmitted: 0      # sent back for revision
  promoted_to_backtest: 0         # earned a backtest slot
  promotion_rate: 0.0             # promoted / proposed (target: 10-20%)
  backtest_pass_rate: 0.0         # of promoted, how many pass backtest gates
```

A healthy system should have a 10-20% promotion rate. If > 50% are promoted, the tournament is too lenient. If < 5%, the proposer needs better context (more graveyard data, better regime info).

### Deliverable
Adversarial 4-role tournament running as an n8n workflow. Most bad strategies die before touching the backtest engine. Tournament transcripts logged for system learning. Promotion rates tracked and tunable.

---

## Phase 4.9 — Regime Graph (Macro Context Layer)

**Goal:** Overlay macroeconomic context on top of price data so strategies are validated against CONTEXT, not just candles. Pull FRED, BLS, and EIA data into a parallel event layer and tag price history with macro conditions.

**Why this matters:** Your current regime detection (ADX + ATR) is purely technical. It doesn't know the difference between "low volatility because nothing's happening" and "low volatility before a CPI print that's about to move the market 2%." Macro context is the bridge from pattern backtesting to context-aware validation.

### Data Sources (All Free)

```yaml
data_sources:
  fred:
    url: "https://api.stlouisfed.org/fred/series/observations"
    auth: "Free API key (register at fred.stlouisfed.org)"
    cost: "$0"
    series:
      - DFF           # Fed Funds Rate
      - DGS2          # 2-Year Treasury Yield
      - DGS10         # 10-Year Treasury Yield
      - T10Y2Y        # 10Y-2Y Spread (yield curve)
      - VIXCLS        # VIX Close
      - DCOILWTICO    # WTI Crude Oil Price
      - UNRATE        # Unemployment Rate
      - CPIAUCSL      # CPI (Consumer Price Index)
      - GDPC1         # Real GDP
      - UMCSENT       # Consumer Sentiment
    update_frequency: "daily (most series)"

  bls:
    url: "https://api.bls.gov/publicAPI/v2/timeseries/data/"
    auth: "No registration required for v2 public API"
    cost: "$0"
    series:
      - CES0000000001  # Total Nonfarm Payrolls
      - LNS14000000    # Unemployment Rate
      - CUUR0000SA0    # CPI-U (All Urban Consumers)
      - CUUR0000SA0L1E # Core CPI (excludes food & energy)
    update_frequency: "monthly"

  eia:
    url: "https://api.eia.gov/v2/"
    auth: "Free API key (register at eia.gov)"
    cost: "$0"
    series:
      - PET.WCESTUS1.W    # Weekly Crude Oil Inventory
      - PET.RWTC.D        # WTI Spot Price (daily)
      - NG.RNGWHHD.D      # Henry Hub Natural Gas Spot
    update_frequency: "weekly (inventories), daily (prices)"
```

### Macro Regime Tags

Every bar in your price history gets tagged with the macro context active at that time:

```yaml
macro_regimes:
  rate_environment:
    hiking:    "Fed Funds Rate rising (3+ consecutive hikes)"
    cutting:   "Fed Funds Rate falling (3+ consecutive cuts)"
    holding:   "Fed Funds Rate unchanged for 3+ meetings"

  yield_curve:
    normal:    "10Y-2Y spread > 0.5%"
    flat:      "10Y-2Y spread between -0.2% and 0.5%"
    inverted:  "10Y-2Y spread < -0.2%"

  inflation:
    hot:       "CPI YoY > 4%"
    moderate:  "CPI YoY between 2% and 4%"
    cool:      "CPI YoY < 2%"

  labor:
    strong:    "NFP > 200K, unemployment < 4.5%"
    moderate:  "NFP 100K-200K, unemployment 4.5-5.5%"
    weak:      "NFP < 100K, unemployment > 5.5%"

  oil:
    shock:     "WTI > 30% above 6-month average"
    normal:    "WTI within 15% of 6-month average"
    collapse:  "WTI > 30% below 6-month average"

  vix:
    complacent: "VIX < 15"
    normal:     "VIX 15-25"
    elevated:   "VIX 25-35"
    crisis:     "VIX > 35"

  event_proximity:
    pre_fomc:   "Within 24 hours before FOMC announcement"
    post_fomc:  "Within 24 hours after FOMC announcement"
    pre_cpi:    "Within 24 hours before CPI release"
    post_cpi:   "Within 24 hours after CPI release"
    pre_nfp:    "Within 24 hours before NFP release"
    post_nfp:   "Within 24 hours after NFP release"
    earnings_season: "Within major earnings reporting window"
```

### Architecture

```
src/
├── data/
│   ├── macro/
│   │   ├── fred_client.py          # FRED API client
│   │   ├── bls_client.py           # BLS API client
│   │   ├── eia_client.py           # EIA API client
│   │   ├── macro_tagger.py         # Tag price bars with macro context
│   │   ├── regime_graph.py         # Build composite regime from technical + macro
│   │   └── event_calendar.py       # FOMC/CPI/NFP schedule + proximity detection
│   └── ...
├── server/
│   ├── routes/
│   │   └── macro.ts                # API routes for macro data
│   └── ...
```

### Database

```sql
CREATE TABLE macro_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  fed_funds_rate FLOAT,
  treasury_2y FLOAT,
  treasury_10y FLOAT,
  yield_curve_spread FLOAT,
  vix_close FLOAT,
  cpi_yoy FLOAT,
  unemployment_rate FLOAT,
  nfp_latest INT,
  wti_price FLOAT,
  crude_inventory_change FLOAT,
  -- Derived regime tags
  rate_regime TEXT,           -- hiking | cutting | holding
  yield_curve_regime TEXT,    -- normal | flat | inverted
  inflation_regime TEXT,      -- hot | moderate | cool
  labor_regime TEXT,          -- strong | moderate | weak
  oil_regime TEXT,            -- shock | normal | collapse
  vix_regime TEXT,            -- complacent | normal | elevated | crisis
  composite_macro_regime TEXT, -- combined label for easy filtering
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_macro_date ON macro_snapshots (date);
CREATE INDEX idx_macro_composite ON macro_snapshots (composite_macro_regime);
```

### Enhanced Backtest Flow

```
Before (current):
  Strategy + Price Data → Backtest → Results

After (with regime graph):
  Strategy + Price Data + Macro Context → Backtest → Results tagged by macro regime

  Example output:
  ┌──────────────────────────┬─────────┬────────┬───────────┐
  │ Macro Regime             │ Trades  │ Sharpe │ Win Rate  │
  ├──────────────────────────┼─────────┼────────┼───────────┤
  │ hiking + hot inflation   │   142   │  2.1   │   68%     │
  │ cutting + cool inflation │    89   │  0.4   │   48%     │  ← EDGE DIES HERE
  │ holding + moderate       │   203   │  1.8   │   65%     │
  │ pre-FOMC (any)           │    31   │  3.2   │   74%     │  ← EDGE STRONGEST
  │ crisis VIX (>35)         │    18   │ -0.3   │   39%     │  ← NEVER TRADE THIS
  └──────────────────────────┴─────────┴────────┴───────────┘
```

### Strategy DSL Extension

Add to the Strategy DSL (Phase 4.6):

```jsonc
{
  "macro_filter": {
    "required_regimes": ["hiking", "holding"],     // only active in these macro regimes
    "blocked_regimes": ["crisis"],                  // never active in these
    "event_handling": {
      "pre_fomc": "SIT_OUT",
      "post_cpi": "REDUCE",
      "earnings_season": "IGNORE"
    }
  }
}
```

### n8n Integration

```
Workflow: Macro Data Sync
Trigger: Daily at 7 PM ET (after market close, after most data releases)
├── Node 1: Fetch FRED series (HTTP Request)
├── Node 2: Fetch BLS series (HTTP Request) — monthly only
├── Node 3: Fetch EIA series (HTTP Request) — weekly only
├── Node 4: POST /api/macro/snapshot — store + compute regime tags
└── Node 5: POST /api/macro/tag-today — tag today's price bars with macro context
```

### API Routes

```
GET    /api/macro/current             — Current macro regime snapshot
GET    /api/macro/history             — Historical macro snapshots (date range)
GET    /api/macro/regime/:date        — Macro regime for a specific date
POST   /api/macro/sync                — Trigger manual data sync
GET    /api/macro/calendar            — Upcoming economic events (FOMC, CPI, NFP)
GET    /api/macro/strategy-fit/:id    — How does strategy X perform across macro regimes?
```

### Deliverable
Price history tagged with macro context. Strategies validated against macro regimes, not just candle patterns. Backtest results broken down by macro condition. Strategies that only work in one macro regime are identified and properly gated. Event calendar integrated for pre/post event handling.

---

## Phase 4.10 — Edge Half-Life Detector (Upgrade to Phase 6.5)

**Goal:** Upgrade the existing decay monitoring (Phase 6.5/6.11) into a standalone service that measures specific sub-signals, estimates remaining edge lifespan, and auto-quarantines strategies — not just alerts.

**Why this is an upgrade, not a new system:** You already have rolling Sharpe monitoring and proactive decay prediction planned in Phase 6. This adds teeth: automatic action, sub-signal decomposition, and half-life estimation.

### Sub-Signals (Beyond Rolling Sharpe)

```yaml
decay_sub_signals:
  sharpe_decay:
    metric: "30-day rolling Sharpe ratio"
    baseline: "Sharpe at deployment"
    warning: "Sharpe < 80% of baseline"
    critical: "Sharpe < 50% of baseline"
    existing: true  # already in Phase 6.5

  follow_through_decay:
    metric: "Average favorable excursion after entry (MFE)"
    baseline: "MFE from backtest / first 30 days live"
    warning: "MFE < 70% of baseline"
    critical: "MFE < 50% of baseline"
    existing: false  # NEW — measures how far price moves in your favor after entry

  slippage_inflation:
    metric: "Rolling average slippage (actual - expected fill)"
    baseline: "Slippage assumptions from strategy DSL"
    warning: "Actual slippage > 1.5x assumed"
    critical: "Actual slippage > 2x assumed (edge may be fully eaten)"
    existing: false  # NEW — slippage eating the edge

  win_size_shrinkage:
    metric: "Rolling average winner size"
    baseline: "Average winner from backtest"
    warning: "Avg winner < 75% of baseline"
    critical: "Avg winner < 50% of baseline"
    existing: false  # NEW — wins getting smaller before win rate drops

  regime_mismatch_frequency:
    metric: "% of recent trades taken outside preferred regime"
    baseline: "0% (should only trade in preferred regime)"
    warning: "> 20% of trades in non-preferred regime"
    critical: "> 40% of trades in non-preferred regime"
    existing: false  # NEW — regime filter may be miscalibrated

  fill_rate_decline:
    metric: "Limit order fill rate (for mean reversion strategies)"
    baseline: "Fill rate from first 30 days live"
    warning: "Fill rate < 80% of baseline"
    critical: "Fill rate < 60% of baseline (competition at same levels)"
    existing: false  # NEW — other algos competing for same entries
```

### Half-Life Estimation

```python
# Concept: fit exponential decay curve to rolling Sharpe
# Estimate when Sharpe will cross below minimum threshold

from scipy.optimize import curve_fit

def estimate_half_life(sharpe_series, min_sharpe=1.0):
    """
    Fit exponential decay: S(t) = S0 * exp(-lambda * t)
    Half-life = ln(2) / lambda
    Remaining life = time until S(t) < min_sharpe
    """
    # Returns:
    # - half_life_days: estimated days until Sharpe halves
    # - remaining_days: estimated days until Sharpe < min_sharpe
    # - confidence: R² of the fit (low R² = noisy, don't trust estimate)
    pass
```

### Auto-Quarantine (Not Just Alert)

```yaml
quarantine_actions:
  level_1_watch:
    trigger: "Any 1 sub-signal at WARNING level"
    action: "Flag in dashboard, no operational change"
    notification: "Daily summary includes warning"

  level_2_reduce:
    trigger: "Any 2 sub-signals at WARNING, OR any 1 at CRITICAL"
    action: "Reduce position size by 50% automatically"
    notification: "Immediate alert to trader"
    reversal: "Auto-restore if sub-signals recover within 10 trading days"

  level_3_quarantine:
    trigger: "Any 2 sub-signals at CRITICAL, OR Sharpe < 0.5 for 30 days"
    action: "Pause strategy entirely — no new trades"
    notification: "Immediate alert + trigger pipeline for replacement"
    reversal: "Manual review required to reactivate"

  level_4_retire:
    trigger: "Quarantined for 30+ days with no recovery"
    action: "Move to RETIRED, bury in graveyard with full diagnostics"
    notification: "Post-mortem added to system journal"
    reversal: "None — strategy is dead"
```

### API Routes (Extend Existing)

```
GET    /api/decay/:strategy_id/signals    — All sub-signal values for a strategy
GET    /api/decay/:strategy_id/half-life  — Estimated remaining edge lifespan
POST   /api/decay/:strategy_id/quarantine — Manually quarantine a strategy
POST   /api/decay/:strategy_id/restore    — Manually restore from quarantine
GET    /api/decay/portfolio               — Decay status across all deployed strategies
```

### Deliverable
Decay monitoring upgraded from "rolling Sharpe alerts" to a multi-signal system that measures WHY edge is decaying, estimates HOW LONG it has left, and ACTS automatically (reduce → quarantine → retire). Strategies die gracefully with full diagnostics instead of bleeding P&L until a human notices.

---

## Implementation Order

```
Phase 4.6  Strategy Compiler        ← FIRST (everything depends on this)
  ↓
Phase 4.7  Strategy Graveyard       ← SECOND (needs compiled DSL to embed)
  ↓
Phase 4.8  Adversarial Tournament   ← THIRD (uses compiler + graveyard)
  ↓
Phase 4.9  Regime Graph             ← FOURTH (enhances backtest context)
  ↓
Phase 4.10 Half-Life Detector       ← FIFTH (upgrade existing Phase 6.5)
  ↓
Phase 5    Dashboard                ← THEN continue with original roadmap
```

### Dependencies

```
Compiler  → needed by: Graveyard (DSL to embed), Tournament (DSL validation)
Graveyard → needed by: Tournament (corpse checking), Half-Life (retirement destination)
Tournament → needs: Compiler + Graveyard + Brave/Tavily (already set up via OpenClaw)
Regime Graph → independent (can be built in parallel with Tournament)
Half-Life → extends: existing Phase 6.5 decay monitoring
```

### What Already Exists (Don't Rebuild)

- pgvector in Docker Compose → use for Graveyard embeddings
- Ollama + Modelfile → extend for Compiler + Tournament roles
- n8n workflows → add Tournament + Macro Sync workflows
- System Journal → logs tournament transcripts + decay diagnostics
- Strategy lifecycle (Candidate → Retired) → Half-Life feeds into this
- Brave Search + Tavily → Prosecutor role uses these (already configured for OpenClaw)

---

> **The framing matters:** Trading Forge is a **research operating system**, not a backtester.
> These 5 systems are what make it a system that gets smarter with every run
> instead of just running the same dumb process faster.
