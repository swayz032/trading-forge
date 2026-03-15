# Edge Mechanisms — Prop-Firm Survival Systems (Insert Before Phase 5)

> **Context:** Phases 0-4 are complete. RESEARCH-OS.md covers the infrastructure layer
> (compiler, graveyard, tournament, regime graph, half-life detector).
> This document covers the **edge layer** — mechanisms that make and protect money.
>
> These are NOT strategies. They are systems that make every strategy better.
>
> **Priority order:** Skip Engine → Prop Survival Optimizer → Day Archetype Engine →
> Anti-Setup Filters → First-Loss Governor
>
> **The core insight:** Prop firms punish bad participation more than they reward
> constant participation. A system that knows when NOT to trade is worth more
> than a system that finds one more entry.

---

## Phase 4.11 — Skip Engine (No-Trade Classifier)

**Goal:** Build a system that answers "should I trade today?" and "which session should I avoid?" before any strategy runs. A strong no-trade classifier protects daily drawdown and consistency — the two things that kill prop accounts.

**Why this is #1 priority:** One good skip saves more than one good trade makes. Your current system has event sit-outs (FOMC/CPI/NFP ±30 min) but ZERO intelligence about whether today is structurally a bad day to trade.

### What the Skip Engine Evaluates

```yaml
skip_signals:
  # Pre-session signals (evaluated before RTH open)
  overnight_structure:
    metric: "Overnight range vs 20-day average overnight range"
    skip_if: "Overnight range > 2x average (already extended, reduced follow-through)"
    skip_if: "Overnight range < 0.3x average (dead market, no edge)"

  gap_analysis:
    metric: "Opening gap size vs ATR"
    skip_if: "Gap > 1.5 ATR AND no macro catalyst (likely to chop filling gap)"
    reduce_if: "Gap > 1.0 ATR (higher reversion probability, trend strategies disadvantaged)"

  vix_term_structure:
    metric: "VIX front month vs second month ratio"
    skip_if: "VIX in steep backwardation > 1.15 (crisis regime, all bets off)"
    reduce_if: "VIX backwardation 1.05-1.15 (elevated risk, reduce size)"

  prior_day_character:
    metric: "Yesterday's range, close location, volume profile"
    skip_if: "Yesterday was a massive trend day (>2.5 ATR) close at extreme (exhaustion likely)"
    context: "Day-after-trend tends to be rotational — trend strategies fail"

  holiday_proximity:
    metric: "Days to/from market holiday"
    skip_if: "Half-day session (reduced liquidity, wider spreads)"
    reduce_if: "Day before holiday (thin participation after lunch)"

  triple_witching:
    metric: "Monthly/quarterly options expiration"
    context: "Pinning effects dominate — trend strategies fail, mean reversion works differently"
    action: "Switch to expiration-aware playbook, not default"

  day_of_week:
    metric: "Historical win rate by day of week per strategy"
    skip_if: "Strategy win rate < 45% on this day historically"

  # Real-time session signals (evaluated during session)
  first_hour_character:
    metric: "Range and direction of first 60 minutes vs 20-day average"
    skip_rest_of_day_if: "First hour range < 0.3x average (dead day)"
    skip_rest_of_day_if: "First hour already hit daily target (take the win)"

  current_session_pnl:
    metric: "Current P&L vs daily risk budget"
    skip_if: "Already down 50% of daily loss limit (protect remaining buffer)"
    skip_if: "Already hit daily profit target (don't give it back)"
```

### Skip Decision Output

```jsonc
{
  "date": "2026-03-14",
  "session": "RTH",
  "decision": "SKIP",           // TRADE | REDUCE | SKIP
  "confidence": 0.82,
  "reasons": [
    "Overnight range 2.3x average — already extended",
    "VIX backwardation at 1.08 — elevated risk regime",
    "Strategy X win rate on Fridays: 41% (below 45% threshold)"
  ],
  "strategy_overrides": {
    "ES_mean_reversion": "TRADE",    // mean reversion may work on extended days
    "NQ_momentum": "SKIP",           // momentum fails after overnight extension
    "CL_breakout": "REDUCE"          // reduce size, don't skip entirely
  },
  "alternative_action": "If must trade, use mean reversion only, 50% size"
}
```

### Architecture

```
src/engine/skip_engine/
├── skip_classifier.py       # Main decision engine
├── premarket_analyzer.py    # Pre-session signal collection
├── session_monitor.py       # Real-time session signals
├── calendar_filter.py       # Holiday, day-of-week, expiration
└── historical_skip_stats.py # Backtest: what would skipping have saved?
```

### Database

```sql
CREATE TABLE skip_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  session TEXT NOT NULL,             -- RTH | OVERNIGHT | LONDON
  decision TEXT NOT NULL,            -- TRADE | REDUCE | SKIP
  confidence FLOAT NOT NULL,
  reasons JSONB NOT NULL,
  strategy_overrides JSONB,
  signals_snapshot JSONB NOT NULL,   -- all signal values at decision time
  actual_outcome JSONB,             -- filled in after session: was skip correct?
  pnl_saved FLOAT,                  -- estimated P&L saved by skipping
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_skip_date ON skip_decisions (date);
CREATE INDEX idx_skip_decision ON skip_decisions (decision);
```

### Skip Engine Backtest

Before going live, backtest the skip engine itself:

```
For each historical trading day:
  1. Calculate all skip signals using data available BEFORE the session
  2. Record skip decision
  3. Compare actual strategy P&L on that day
  4. Calculate: "If I had skipped this day, how much would I have saved/lost?"

Metrics:
  - skip_accuracy: % of skipped days that would have been losers
  - false_skip_rate: % of skipped days that would have been winners
  - net_pnl_impact: total P&L improvement from skipping
  - drawdown_reduction: max drawdown with vs without skip engine
  - consistency_improvement: winning day % with vs without skip engine
```

### Strategy DSL Extension

```jsonc
{
  "skip_rules": {
    "use_skip_engine": true,
    "override_skip_on": ["high_vix_mean_reversion"],
    "custom_skip_signals": [
      "skip if overnight_range > 2.5 * atr_20"
    ],
    "max_daily_loss_before_skip": 500,
    "max_trades_per_session": 3
  }
}
```

### API Routes

```
GET    /api/skip/today                — Today's skip decision + reasoning
GET    /api/skip/strategy/:id/today   — Skip decision for a specific strategy
GET    /api/skip/history              — Historical skip decisions + accuracy
GET    /api/skip/backtest             — Skip engine backtest results
POST   /api/skip/override             — Manual override (trader says "I'm trading anyway")
GET    /api/skip/stats                — Skip accuracy, false skip rate, net P&L impact
```

### n8n Integration

```
Workflow: Pre-Session Skip Check
Trigger: Daily at 9:00 AM ET (30 min before RTH)
├── Node 1: Collect overnight structure (from data pipeline)
├── Node 2: Collect gap analysis (current price vs prior close)
├── Node 3: Collect VIX term structure (from data feed)
├── Node 4: Collect calendar signals (holiday, expiration, day of week)
├── Node 5: POST /api/skip/today — run skip classifier
├── Node 6: Route decision
│   ├── TRADE → proceed to normal strategy execution
│   ├── REDUCE → adjust position sizes by 50%
│   └── SKIP → send notification, no strategies run
└── Node 7: Log decision to skip_decisions table

Workflow: Post-Session Skip Review
Trigger: Daily at 5:30 PM ET
├── Node 1: Get today's skip decision
├── Node 2: Get actual P&L for each strategy
├── Node 3: Calculate: was the skip decision correct?
├── Node 4: PATCH /api/skip/:id — update actual_outcome + pnl_saved
└── Node 5: If false skip rate > 30% over last 20 days → alert for recalibration
```

### Deliverable
Pre-session classifier that decides TRADE/REDUCE/SKIP before any strategy runs. Per-strategy overrides. Backtestable. Post-session review loop. Net P&L impact quantified.

---

## Phase 4.12 — Prop Survival Optimizer

**Goal:** Replace standard profitability metrics (Sharpe, profit factor) with a fitness function that optimizes for PROP FIRM SURVIVAL — the probability of passing evaluation and maintaining funded status without breaching rules.

**Why this matters:** A strategy with Sharpe 2.0 but clustered losses can breach daily drawdown on day 3. A strategy with Sharpe 1.5 but smooth daily P&L passes evaluation in 10 days. Prop firms don't pay for pretty equity curves — they pay for surviving the rule cage.

### Prop Survival Fitness Function

```yaml
survival_metrics:
  daily_loss_breach_probability:
    weight: 0.25
    description: "P(any single day loss > daily_loss_limit)"
    why_king: "One breach = account dead. THE most important metric."

  trailing_drawdown_breach_probability:
    weight: 0.20
    description: "P(cumulative drawdown exceeds max_drawdown at any point)"
    method: "Monte Carlo: simulate 10000 paths, count breaches"

  avg_red_day_size:
    weight: 0.15
    description: "Mean loss on losing days. Smaller = more survivable."

  best_day_concentration:
    weight: 0.10
    description: "What % of monthly profit comes from the single best day?"
    danger: "If > 40% → fragile. Topstep consistency rule enforces this."

  consecutive_loss_cluster_risk:
    weight: 0.10
    description: "P(3+ consecutive losing days)"
    why: "Consecutive losses compound toward trailing DD limit + trigger emotional override"

  trades_to_payout:
    weight: 0.10
    description: "Expected trading days to reach profit target"
    why: "Fewer = less exposure to random bad days"

  recovery_time_after_max_dd:
    weight: 0.10
    description: "Days to recover after hitting worst drawdown"
    danger: "If > 10 days → high risk of psychological breakdown"
```

### Strategy Comparison Example

```
Strategy A: "Classic Momentum"
  Net profit: $8,200/month    Sharpe: 2.1    PF: 2.8
  Traditional rank: #1
  Daily breach probability: 8%         ← DANGER
  Best-day concentration: 45%          ← FRAGILE
  Consecutive 3+ loss clusters: 2.1/mo
  SURVIVAL SCORE: 52/100              ← WILL LIKELY BREACH

Strategy B: "Boring Mean Reversion"
  Net profit: $5,800/month    Sharpe: 1.7    PF: 2.0
  Traditional rank: #3
  Daily breach probability: 1.2%       ← SAFE
  Best-day concentration: 18%          ← DISTRIBUTED
  Consecutive 3+ loss clusters: 0.4/mo
  SURVIVAL SCORE: 88/100              ← WILL SURVIVE AND PAY

Winner for prop trading: Strategy B, by a mile.
```

### Per-Firm Survival Profiles

```yaml
firm_survival_profiles:
  topstep_50k:
    daily_loss_limit: 1000
    max_trailing_dd: 2000
    consistency_rule: "Best day < 50% of total profit"
    survival_priority: [daily_breach, concentration, dd_breach]

  mffu_50k:
    daily_loss_limit: 1650
    max_trailing_dd: 2500
    consistency_rule: null
    survival_priority: [dd_breach, daily_breach, red_day_size]

  tpt_50k:
    daily_loss_limit: 1100
    max_trailing_dd: 2000
    consistency_rule: "No day > 50% of total profit"
    survival_priority: [daily_breach, concentration, dd_breach]

  apex_50k:
    daily_loss_limit: null
    max_trailing_dd: 2500
    consistency_rule: "No day > 30% of total profit"
    survival_priority: [dd_breach, concentration, consec_loss]
```

### Architecture

```
src/engine/survival/
├── survival_scorer.py       # Main survival fitness function
├── daily_breach_model.py    # P(daily loss breach) calculator
├── drawdown_simulator.py    # Monte Carlo DD breach probability
├── concentration_analyzer.py # Best-day concentration analysis
├── cluster_detector.py      # Consecutive loss cluster analysis
├── firm_profiles.py         # Per-firm survival configurations
└── survival_comparator.py   # Compare strategies by survival, not profit
```

### Integration with Existing Gates

```
Current flow:
  Backtest → Walk-Forward → Monte Carlo → Forge Score → Pass/Fail

New flow:
  Backtest → Walk-Forward → Monte Carlo → Forge Score → Survival Score → Pass/Fail

  If Forge Score ≥ threshold BUT Survival Score < 60:
    → "Profitable but likely to breach rules at [firm]. Modify or skip."

  If Forge Score < threshold BUT Survival Score ≥ 85:
    → "Marginal edge but very survivable. Consider for lowest-risk firm slot."
```

### API Routes

```
POST   /api/survival/score           — Survival score for strategy + firm combo
POST   /api/survival/compare         — Compare strategies by survival score
GET    /api/survival/firm-profiles    — List all firm survival profiles
POST   /api/survival/monte-carlo     — MC simulation for DD breach probability
GET    /api/survival/leaderboard     — Rank all strategies by survival per firm
```

### Deliverable
Survival fitness function optimizing for prop firm rule survival. Per-firm profiles. Strategy comparison by survival score. Integrated as additional gate in pipeline.

---

## Phase 4.13 — Day Archetype Retrieval Engine

**Goal:** Cluster historical trading days into repeatable archetypes. Before each session, identify which archetype today most likely becomes. Map strategies to the day types where they historically perform best.

**Why this matters:** You stop trading "today" as a mystery and start trading it as a known class of day. A trend strategy on a chop day is throwing money away.

### Day Archetype Taxonomy

```yaml
archetypes:
  trend_day:
    characteristics:
      - One-directional move > 1.5 ATR
      - Close near extreme of range (top/bottom 10%)
      - Volume increasing through session
    frequency: "~15-20% of days"
    best_strategies: [momentum, breakout, trend_following]
    worst_strategies: [mean_reversion, fade]

  failed_trend_day:
    characteristics:
      - Strong directional move first 2 hours (> 1.0 ATR)
      - Reversal after lunch, close near opposite extreme
    frequency: "~8-12% of days"
    best_strategies: [mean_reversion, reversal]
    worst_strategies: [momentum, breakout]

  double_distribution_day:
    characteristics:
      - Two distinct value areas (morning + afternoon)
      - Transitional move between them
    frequency: "~10-15% of days"
    best_strategies: [breakout_of_initial_balance, range_extension]
    worst_strategies: [fade, tight_mean_reversion]

  late_reversal_day:
    characteristics:
      - Trend-like first 4 hours
      - Sharp reversal in final 90 minutes
    frequency: "~5-8% of days"
    best_strategies: [late_session_fade, MOC_imbalance]
    worst_strategies: [trend_following_held_to_close]

  macro_event_expansion:
    characteristics:
      - FOMC/CPI/NFP day
      - Range expansion 2-3x normal in 30-minute window
    frequency: "~12-15 days/year"
    best_strategies: [post_event_momentum, expansion_breakout]
    worst_strategies: [tight_stop_strategies]

  lunch_chop_day:
    characteristics:
      - Reasonable morning range (0.5-1.0 ATR by noon)
      - Near-zero range 11:30-14:00
    frequency: "~20-25% of days"
    best_strategies: [morning_only_strategies, skip_afternoon]
    worst_strategies: [all_day_strategies]

  overnight_imbalance_unwind:
    characteristics:
      - Large overnight move (> 1.0 ATR gap)
      - RTH session retraces 50-80% of overnight move
    frequency: "~10-15% of days"
    best_strategies: [gap_fade, mean_reversion_to_prior_close]
    worst_strategies: [gap_and_go_momentum]

  narrow_range_day:
    characteristics:
      - Total range < 0.5 ATR
      - No clear direction, low volume
      - Often precedes expansion day
    frequency: "~10-15% of days"
    best_strategies: [skip_today]
    worst_strategies: [everything]
```

### Classification Features (Pre-Session)

```yaml
premarket_features:
  overnight_range_vs_avg: "ratio to 20-day average overnight range"
  gap_size_vs_atr: "opening gap as multiple of 20-day ATR"
  gap_direction: "up | down | flat"
  overnight_volume_profile: "balanced | skewed_up | skewed_down"
  vix_level: "current VIX"
  vix_change_overnight: "VIX change from prior close"
  prior_day_archetype: "yesterday's archetype"
  prior_day_close_location: "% of range (0=low, 100=high)"
  prior_day_range_vs_avg: "ratio to 20-day average"
  day_of_week: "Mon-Fri"
  event_scheduled: "FOMC | CPI | NFP | earnings | none"
  days_since_trend_day: "days since last trend day"
  atr_percentile: "20-day ATR as percentile of 1-year range"
```

### Classification Method

```python
# Phase 1: Rule-based (simple, transparent, no ML black box)
def classify_day(bar_data):
    """Classify a completed day into an archetype for historical labeling."""
    total_range = bar_data.high - bar_data.low
    atr_20 = bar_data.atr_20
    close_location = (bar_data.close - bar_data.low) / total_range

    if total_range > 1.5 * atr_20 and (close_location > 0.9 or close_location < 0.1):
        return "trend_day"
    if total_range > 1.0 * atr_20 and close_reversed_from_first_2h(bar_data):
        return "failed_trend_day"
    if total_range < 0.5 * atr_20:
        return "narrow_range_day"
    # ... etc

# Phase 2: KNN prediction (before session opens)
def predict_archetype(premarket_features):
    """Find 20 most similar historical days, return archetype distribution."""
    neighbors = knn_search(premarket_features, k=20)
    distribution = Counter(n.archetype for n in neighbors)
    return {
        "most_likely": distribution.most_common(1)[0],
        "distribution": dict(distribution),
        "confidence": distribution.most_common(1)[0][1] / 20
    }
```

### Pre-Session Output

```jsonc
{
  "date": "2026-03-14",
  "prediction": {
    "most_likely": "overnight_imbalance_unwind",
    "confidence": 0.55,
    "distribution": {
      "overnight_imbalance_unwind": 11,
      "failed_trend_day": 4,
      "trend_day": 3,
      "lunch_chop_day": 2
    }
  },
  "strategy_recommendations": {
    "ES_mean_reversion": { "fit": "STRONG", "reason": "gap fade works on unwind days" },
    "NQ_momentum": { "fit": "WEAK", "reason": "momentum fails on reversion days" },
    "CL_breakout": { "fit": "NEUTRAL", "reason": "CL less correlated to ES day type" }
  },
  "historical_stats": {
    "avg_range_on_this_type": "28.5 points",
    "best_entry_window": "9:30-10:15 (fade the gap)",
    "worst_period": "11:00-13:00 (chop after initial move)",
    "avg_retracement": "65% of overnight move"
  }
}
```

### Database

```sql
CREATE TABLE day_archetypes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  archetype TEXT NOT NULL,
  premarket_features JSONB NOT NULL,
  intraday_features JSONB NOT NULL,
  classification_method TEXT NOT NULL,   -- rule_based | knn | hybrid
  confidence FLOAT,
  strategy_performance JSONB,            -- how each strategy did on this day type
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Architecture

```
src/engine/archetypes/
├── classifier.py            # Rule-based day classification
├── predictor.py             # KNN prediction from premarket features
├── feature_extractor.py     # Extract premarket + intraday features
├── strategy_mapper.py       # Map strategies to day types
├── historical_labeler.py    # Label all historical days with archetypes
└── archetype_stats.py       # Per-archetype statistics
```

### API Routes

```
GET    /api/archetypes/today          — Today's predicted archetype + strategy fit
GET    /api/archetypes/history        — Historical day classifications
GET    /api/archetypes/stats          — Per-archetype statistics
GET    /api/archetypes/strategy-fit   — Strategy performance by day type
POST   /api/archetypes/classify       — Classify a specific day
GET    /api/archetypes/similar-days   — Find N most similar historical days to today
```

### Deliverable
Every historical day labeled. Pre-session prediction of today's archetype. Strategy-to-archetype fit scoring. Strategies only run on day types where they perform.

---

## Phase 4.14 — Anti-Setup Filters

**Goal:** For every strategy, systematically mine the exact conditions where its setups consistently FAIL. Build an automatic filter layer that blocks those trades. Killing false positives is often more profitable than finding more entries.

### Anti-Setup Discovery Process

```
For each deployed/validated strategy:
  1. Collect all historical entry signals (winners and losers)
  2. For each losing cluster, identify common conditions:
     - Regime (ADX, ATR, VIX)
     - Time of day
     - Overnight structure
     - Day archetype (from Phase 4.13)
     - Macro context (from Phase 4.9 Regime Graph)
     - Distance from VWAP
     - Volume profile
  3. Find conditions where win rate drops below 40%
  4. Create anti-setup filter rules for those conditions
```

### Anti-Setup Filter Schema

```jsonc
{
  "strategy_id": "ES_opening_drive_long",
  "anti_setups": [
    {
      "name": "extended_overnight_inventory",
      "condition": "overnight_range > 1.5 * atr_20 AND direction == long AND overnight_close > 0.8",
      "effect": "Win rate drops from 62% to 31%",
      "action": "BLOCK",
      "sample_size": 87,
      "confidence": 0.92
    },
    {
      "name": "low_atr_breakout_fail",
      "condition": "atr_percentile < 20 AND pattern == breakout",
      "effect": "Win rate drops from 58% to 28%, avg winner shrinks 60%",
      "action": "BLOCK",
      "sample_size": 134,
      "confidence": 0.95
    },
    {
      "name": "post_trend_day_continuation",
      "condition": "prior_day_archetype == trend_day AND entry_direction == prior_day_direction",
      "effect": "Win rate drops from 62% to 44%, mean reversion dominates",
      "action": "REDUCE_SIZE_50",
      "sample_size": 62,
      "confidence": 0.78
    },
    {
      "name": "cpi_afternoon_mean_reversion",
      "condition": "event_today == CPI AND time > 13:00 AND pattern == mean_reversion",
      "effect": "Post-CPI drift continues, mean reversion gets run over",
      "action": "BLOCK",
      "sample_size": 41,
      "confidence": 0.73
    }
  ]
}
```

### Strategy DSL Extension

```jsonc
{
  "anti_setups": {
    "auto_discovered": true,
    "manual_overrides": [],
    "min_sample_size": 30,
    "min_confidence": 0.75,
    "refresh_frequency": "monthly"
  }
}
```

### Architecture

```
src/engine/anti_setups/
├── miner.py                 # Discover anti-setup conditions from historical data
├── filter_gate.py           # Real-time filter: block/reduce trades matching anti-setups
├── condition_analyzer.py    # Analyze conditions clustering around losing trades
└── anti_setup_backtest.py   # Backtest: P&L improvement from filtering
```

### API Routes

```
GET    /api/anti-setups/:strategy_id      — List anti-setups for a strategy
POST   /api/anti-setups/mine/:strategy_id — Trigger anti-setup discovery
GET    /api/anti-setups/check             — Check if current conditions match anti-setup
GET    /api/anti-setups/impact            — P&L impact of filtering (backtest)
POST   /api/anti-setups/override          — Add manual anti-setup rule
```

### Deliverable
Automated anti-setup discovery for every strategy. Real-time filter blocking trades under historically failing conditions. Monthly refresh on rolling data.

---

## Phase 4.15 — First-Loss Governor

**Goal:** Build per-strategy behavioral modification after adverse events during a session. Most prop account damage comes from behavior AFTER the first failed attempt — not from the first failure itself.

**Why this matters:** Your current system has `max_daily_loss` and `max_trades_per_session` as hard stops. But nothing between "full speed" and "shut down." The governor adds graduated responses.

### Governor States

```yaml
governor_states:
  normal:
    description: "Session start. No adverse events. Full playbook."
    size_multiplier: 1.0
    max_remaining_trades: per_strategy_default

  after_first_loss:
    trigger: "First losing trade of the session"
    size_multiplier: 0.75
    max_remaining_trades: 2
    cooldown_minutes: 15
    setup_filter: "A+ setups only (highest win rate)"
    rationale: >
      After first loss, most traders revenge trade or become hesitant.
      Governor enforces 15-min cooldown, reduces size, only highest-probability setups.

  after_second_loss:
    trigger: "Second losing trade of the session"
    size_multiplier: 0.50
    max_remaining_trades: 1
    cooldown_minutes: 30
    setup_filter: "Mean reversion only (if supported)"
    rationale: >
      Two losses = strategy doesn't match today or execution is off.
      One more attempt allowed, half size, safest setup. Fails → done for day.

  after_max_adverse_excursion:
    trigger: "Open trade hits MAE > 1.5x normal before stop"
    cooldown_minutes: 20
    size_multiplier: 0.75
    rationale: "Deep adverse excursion indicates poor timing. Pause before re-engaging."

  after_missed_impulse:
    trigger: "Primary setup fired but not taken (filled late or skipped)"
    allowed_setups: "Only pullback entries, no market orders"
    size_multiplier: 0.75
    rationale: "Missing A+ setup leads to FOMO chasing. Governor blocks market-order chasing."

  session_transition:
    trigger: "Clock crosses 11:30 AM ET (lunch) or 14:30 PM ET (late session)"
    action: "Re-check day archetype. If morning was chop → skip afternoon."
    size_multiplier: 0.75

  daily_target_hit:
    trigger: "Session P&L exceeds daily profit target"
    allowed_setups: "Only if new setup has > 2:1 R:R"
    size_multiplier: 0.50
    rationale: "After target, continuing full size risks giving back the day."
```

### Governor Configuration in Strategy DSL

```jsonc
{
  "governor": {
    "enabled": true,
    "after_first_loss": {
      "size_multiplier": 0.75,
      "cooldown_minutes": 15,
      "max_remaining_trades": 2,
      "setup_filter": "A_plus_only"
    },
    "after_second_loss": {
      "size_multiplier": 0.50,
      "cooldown_minutes": 30,
      "max_remaining_trades": 1,
      "setup_filter": "mean_reversion_only"
    },
    "daily_target": {
      "target_dollars": 500,
      "post_target_size_multiplier": 0.50,
      "post_target_min_rr": 2.0
    },
    "session_transitions": {
      "lunch_pause": true,
      "lunch_start": "11:30",
      "late_session_reassess": true,
      "late_session_start": "14:30"
    }
  }
}
```

### Architecture

```
src/engine/governor/
├── state_machine.py         # Governor state transitions
├── session_tracker.py       # Track session events (losses, MAE, P&L)
├── trade_filter.py          # Filter trades based on current governor state
├── governor_backtest.py     # Backtest: P&L with vs without governor
└── governor_config.py       # Per-strategy governor configuration
```

### API Routes

```
GET    /api/governor/:strategy_id/state   — Current governor state
GET    /api/governor/:strategy_id/history — State transitions today
GET    /api/governor/backtest/:strategy_id — P&L impact of governor
POST   /api/governor/:strategy_id/override — Manual override
GET    /api/governor/session-summary       — All strategies' governor states
```

### Deliverable
Per-strategy state machine modifying behavior after adverse events. Graduated responses. Backtestable impact. Cooldowns, size reductions, setup filtering — all configurable per strategy.

---

## Bonus Mechanisms (Phase 5+ or Backtest Engine Upgrades)

These are high-value but can be added after the core 5 above:

### Counterfactual Replay Lab (Backtest Upgrade)

For every historical trade, replay variations and decompose which component carries the edge:

```yaml
variations: [entry_timing, stop_size, target_size, partial_exit, time_stop, session_filter]
output: "setup_edge vs timing_edge vs exit_edge vs risk_edge decomposition"
```

### Cross-Market Teacher Signals (Filter Layer)

Use related futures as permission filters, not direct signals:

```yaml
teachers:
  es_for_nq: "ES trend alignment as permission for NQ entries"
  zn_for_indices: "Treasury behavior as risk-tone filter"
  dxy_for_all: "Dollar strength as macro permission"
  cl_for_energy: "Crude inventory reaction as CL trade validator"
  rty_divergence: "RTY vs ES divergence as breadth/risk signal"
usage: "Entry fires → check teacher → aligned? → PROCEED : SKIP"
```

### Nearest-Neighbor Trade Validator (Real-Time)

When a live setup appears, compare to most similar historical setups:

```yaml
output:
  historical_win_rate: "65%"
  median_favorable_excursion: "18 ticks"
  median_time_to_target: "35 minutes"
  recommendation: "TAKE — above historical average"
```

### Recovery Mode Strategy Classes

Separate strategy behavior based on session state:

```yaml
modes:
  normal: "Full playbook, standard sizing"
  down_one_unit: "Reduced setups, smaller size, wider targets"
  after_failed_breakout: "Switch to mean reversion only"
  after_news_spike: "Wait 15 min, reassess with reduced size"
  early_overtrade: "Stop after 3 trades regardless of P&L"
```

### Strategy Insurance Pairs (Failure Diversification)

Not random diversification — deliberate failure-mood pairing:

```yaml
pair:
  strategy_a: "Trend follower (profits in expansion, loses in contraction)"
  strategy_b: "Mean reverter (profits in contraction, loses in expansion)"
  key_metric: "Failure correlation < 0 (they fail on different days)"
  effect: "Smoother daily P&L, lower max drawdown"
```

### Trade Absence Mining

Model what FAILED to happen as a signal:

```yaml
absence_signals:
  no_continuation: "Strong push → no follow-through → reversal likely"
  no_mean_reversion: "Extreme move → no reversion in 30 min → trend day likely"
  no_retest: "Breakout → no retest → strong momentum"
  no_response_at_level: "Price at key level → no reaction → level is dead"
usage: "Regime/archetype confirmation, not direct entries"
```

### Mental Load Ranker

Score every strategy on execution difficulty:

```yaml
complexity_factors: [parameter_count, conditions, discretionary_reads, screen_time, ambiguity]
rule: "Prefer strategies scoring 80+ on simplicity even if 10% lower raw profitability"
why: "A strategy 15% less profitable but 50% easier to execute wins in real prop usage"
```

### Parameter Plateau Scoring (Already Exists — Phase 4.3)

Already implemented via Optuna robustness testing. CLAUDE.md says "MA=15-25 is better than MA=17." No additional work needed.

### Strategy Cemetery Resurrection (Extends Phase 4.7 Graveyard)

Periodically retest dead strategies only in the regimes where they used to thrive:

```yaml
resurrection_check:
  frequency: "Monthly"
  condition: "Regime that killed strategy X has shifted back to its preferred regime"
  action: "Re-backtest on last 60 days. If passes gates → re-promote to PAPER."
  why: "Some edges go dormant, not dead. Market structure returns."
```

---

## Implementation Order

```
Phase 4.11  Skip Engine              ← FIRST (biggest P&L saver for prop accounts)
  ↓
Phase 4.12  Prop Survival Optimizer  ← SECOND (reframes all ranking by survival)
  ↓
Phase 4.13  Day Archetype Engine     ← THIRD (context for skip engine + strategy selection)
  ↓
Phase 4.14  Anti-Setup Filters       ← FOURTH (per-strategy false positive killer)
  ↓
Phase 4.15  First-Loss Governor      ← FIFTH (session-level behavioral protection)
  ↓
Phase 5     Dashboard                ← THEN continue with original roadmap
```

### Dependencies

```
Skip Engine     → uses: Regime Graph (4.9), VIX data, overnight structure
                → feeds: strategy execution decisions
Day Archetypes  → uses: historical price data, overnight features
                → feeds: Skip Engine (day type), Anti-Setups (context)
Anti-Setups     → uses: historical trades, Day Archetypes, Regime Graph
                → feeds: real-time trade filter
Survival Optimizer → uses: backtest results, prop firm rules (docs/prop-firm-rules.md)
                   → feeds: strategy ranking, Forge Score extension
First-Loss Governor → uses: real-time session data, strategy config
                    → feeds: trade execution layer (Phase 6)
```

### Integration with RESEARCH-OS.md

```
RESEARCH-OS (Phases 4.6-4.10)  = Infrastructure layer
  How strategies are compiled, validated, stored, and monitored.

EDGE-MECHANISMS (Phases 4.11-4.15) = Edge layer
  How strategies make and protect money.

Both layers feed into Phase 5 (Dashboard) and Phase 6 (Live Trading).

Strategy DSL (4.6) extended by: Skip Rules (4.11), Anti-Setups (4.14), Governor (4.15)
Graveyard (4.7) fed by: Anti-Setup discoveries (4.14), Survival failures (4.12)
Regime Graph (4.9) feeds: Skip Engine (4.11), Day Archetypes (4.13), Anti-Setups (4.14)
Half-Life Detector (4.10) feeds: Survival Optimizer (4.12), Governor state resets
```

---

> **The most underrated edge:** A world-class skip engine.
> Prop firms punish bad participation more than they reward constant participation.
>
> **The actual unlock:** Don't just ask "what trades should I take?"
> Force the system to answer: "What days should I avoid,
> what strategy mode am I in, and what failure pattern is currently most likely?"
