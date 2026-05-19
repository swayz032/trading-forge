# Prop Firm Rules Reference

> This document is consumed by Trading Forge AI agents for strategy simulation,
> evaluation feasibility scoring, and payout projections. All numbers are current
> as of April 2026 (the **## 2026 Updates** section reflects the latest rule
> changes; the per-firm blocks below contain the full historical detail).
> Agents MUST use these constraints when simulating strategies.

---

## How Agents Should Use This Document

1. **Before backtesting:** Load the target firm's rules as hard constraints
2. **During simulation:** Enforce drawdown limits, consistency rules, and contract caps
3. **Scoring output:** Report whether a strategy PASSES or FAILS each firm's evaluation
4. **Payout projection:** Calculate expected net profit after splits and fees
5. **Firm ranking:** Given a strategy profile, rank firms by expected ROI

---

## 2026 Updates

> Source-of-truth overlay on top of the per-firm blocks below. When a value
> here conflicts with a per-firm block, **this section wins** — the per-firm
> blocks are kept for historical context and detailed payout/platform info.

### Per-Firm Routing Matrix

| Firm | Path | Reason |
|---|---|---|
| **Topstep** | ATS via TopstepX API, **local-only** (Skytech tower) | Most algo-permissive; no-VPS rule = local execution required |
| **MFFU** | ATS via TradersPost / PickMyTrade | Permissive |
| **Top One Futures, YRM Prop** | ATS, fully automated | Most automation-friendly per March 2026 |
| **Apex 4.0** | INDICATOR + manual TradersPost approval | Semi-auto allowed, fully auto banned |
| **Tradeify** | INDICATOR only | Bans bot trading |
| **TPT, Earn2Trade, Alpha Futures** | ATS allowed | Permissive |
| **FundingPips** | INDICATOR only | Bans bots |

> **Routing implication for Trading Forge:** strategies tagged `automation=full`
> can only be deployed against Topstep (local), MFFU, Top One, YRM, TPT,
> Earn2Trade, and Alpha Futures. Apex/Tradeify/FundingPips routes must
> emit signals to the indicator/alert layer with a human-approval step in
> TradersPost — never auto-fire orders.

### Apex 4.0 — Effective Mar 1, 2026

```yaml
firm: apex_trader_funding
plan_version: "4.0"
effective_date: "2026-03-01"
consistency_rule:
  evaluation: 0.50           # Was 0.30 — relaxed to 50% single-day cap
  funded: 0.50
qualifying_days: 5            # Was 7 — reduced
profit_split_tiers:
  - tier: first_25k
    split: 1.00               # 100% to trader on first $25K (no split)
  - tier: after_25k
    split: 0.90               # Then 90/10
removed_rules:
  - mae_rule                  # MAE rule REMOVED in 4.0
  - rr_5_to_1_requirement     # 5:1 R:R requirement REMOVED in 4.0
automation_policy:
  pa_live_accounts: prohibited  # AI/autobots/algorithms/HFT BANNED on PA/Live
  evaluation_accounts: allowed  # Algos still allowed during eval
  semi_auto: allowed            # Permitted: TradersPost webhook + manual approval
household_max_pa_accounts: 20   # Cap of 20 PA accounts per household
```

> **Trading Forge implication:** Apex strategies must route through the
> indicator layer with explicit human approval in TradersPost. Setting
> `automated: true` on a strategy tagged for an Apex PA account triggers
> an automatic compliance violation in `compliance_gate.check_violation()`.

### Topstep — Effective Apr 14, 2026

```yaml
firm: topstep
effective_date: "2026-04-14"
daily_loss_limit:
  status: opt_in_at_checkout    # No longer always-on; selected at purchase
  enforcement: auto_liquidation  # If breached, account auto-liquidates
trailing_drawdown_type: EOD
trailing_drawdown_locks: true   # Locks once HWM reaches starting balance
  # 50K example: starts at $48K floor, trails up to $50K, locks there
api_policy:
  topstepx_api: allowed
  webhooks: allowed
  bots: allowed
  vps: prohibited                # No VPS allowed
  vpn: prohibited                # No VPN allowed
  remote_access: prohibited      # Must run from personal device
  # → Trading Forge requirement: Topstep deployment is LOCAL ONLY (Skytech tower)
```

> **Trading Forge implication:** Topstep is the only fully-automated route
> that requires local execution. The bias engine and paper executor must
> validate `host=skytech-tower` before sending any TopstepX webhook.
> The compliance gate must reject any Topstep order originating from a
> VPS/VPN/cloud host.

### MFFU — 2026 Plan Restructure

The old Starter/Expert/Milestone plans have been retired. New 2026 plans:

```yaml
firm: my_funded_futures
plans:
  Core:                          # Replaces Starter
    sizes: ["50K"]               # 50K only
    profit_split: 0.80           # 80/20
    drawdown_type: EOD
    monthly_fee: 77
    profit_cycle_cap: 5000       # $5K cycle cap
    min_winning_days: 5
  Rapid:                         # Replaces Expert
    profit_split: 0.90           # 90/10 effective Jan 12, 2026
    drawdown_type: intraday_trailing
    monthly_fee_min: 129
  Pro:                           # Replaces Milestone
    profit_split: 0.80           # 80/20
    drawdown_type: EOD
    consistency_rule_funded: null  # No consistency rule once funded
    monthly_fee_min: 229
    total_payout_cap: 100000     # $100K total cap
```

### ProjectX Exit — Effective Feb 28, 2026

```yaml
event: projectx_third_party_discontinued
date: "2026-02-28"
status: exited_third_party_prop_firm_support
exclusive_partner: topstep
affected_firms:
  - top_one_futures
  - tradify
  - blue_guardian
  - tick_tick_trader
```

> **Trading Forge implication:** any strategy previously routed via ProjectX
> infrastructure for Top One / Tradify / Blue Guardian / Tick Tick Trader
> must be re-routed. Trading Forge tracks Top One/YRM as ATS-direct (per the
> routing matrix above). The `compliance_rulesets` table must mark
> ProjectX-derived rulesets as stale and force re-fetch from each firm's
> direct platform.

### Buffer Phase Math (All Firms — $0 Activation Fee)

The "buffer" is the additional profit beyond the eval target needed before the
first payout, equal to the trailing drawdown amount on most firms (so the
account is fully clear of the drawdown floor by the time you withdraw).

```python
def buffer_required(profit_target: float, max_drawdown: float) -> float:
    """Total profit needed before first payout = target + drawdown buffer."""
    return profit_target + max_drawdown
```

| Firm (50K) | Profit Target | Buffer (= maxDD) | Total Before 1st Payout | Notes |
|---|---|---|---|---|
| **Topstep 50K** | $3,000 | $2,000 | **$5,000** | 90% split from dollar one |
| **MFFU 50K Core** | $3,000 | $2,500 | **$5,500** | 80% split (Core), 90% (Rapid) |
| **Apex 50K** | $3,000 | $2,500 | **$5,500** | 100% to trader on first $25K, then 90/10 |
| **TPT 50K** | $3,000 | $2,000 | **$5,000** | 80% split (PRO), 90% (PRO+ after $5K) |
| **Tradeify 50K** | $2,500 | $2,000 | **$4,500** | 100% to trader on first $15K |
| **Alpha 50K Std** | $3,000 | $2,000 | **$5,000** | 70% → 80% → 90% scaling split |
| **Earn2Trade 50K** | $3,000 | $2,000 | **$5,000** | $4K lifetime withdrawal cap |

```yaml
days_to_first_payout:
  at_500_per_day:  "10–12 trading days"   # ~$5,000–$6,000 buffer ÷ $500/day
  at_1000_per_day: "5–6 trading days"     # Same buffer ÷ $1,000/day
target_monthly_income: 10000               # $10K/month
```

> **Trading Forge implication:** the strategy ranker (`rank_firms_for_strategy`
> in the **Strategy-to-Firm Matching** block below) must use these total
> buffer values, not the bare profit_target, when projecting time-to-funded.
> Apex's first-$25K-100% rule changes the ROI math — for Apex specifically,
> the first-payout cycle is materially better than splits suggest.

---

## Topstep

### Evaluation Accounts (Trading Combine)

| Size | Monthly Fee | Profit Target | Trailing Drawdown (EOD) | Max Contracts |
|------|------------|---------------|------------------------|---------------|
| $50K | $49 | $3,000 | $2,000 | 15 micros |
| $100K | $99 | $6,000 | $3,000 | 10 ES / 100 MES |
| $150K | $149 | $9,000 | $4,500 | 15 ES / 150 MES |

### Rules

```yaml
firm: topstep
evaluation_type: one_step
daily_loss_limit: $1,000  # Soft daily loss limit (March 2026)
trailing_drawdown_type: EOD  # Calculated at end of day, not intraday
trailing_drawdown_locks: true  # Stops trailing once it reaches starting balance
consistency_rule: null  # No consistency rule
min_trading_days: 5  # Minimum 5 trading days
max_trading_days: null  # No time limit
overnight_positions: not_allowed  # User constraint: no overnight positions
commission_per_side: $0.37  # TopstepX clearing fees only (March 2026)
weekend_positions: not_allowed
news_trading: allowed
scaling_plan: false  # Full contracts from day one
```

### Funded Account (XFA)

```yaml
activation_fee: $0  # All firms have $0 activation fee
monthly_fee: $0  # No recurring fees once funded
starting_balance: $0  # You trade up from zero
profit_split: 0.90  # 90% to trader, 10% to Topstep
profit_split_from: dollar_one  # No threshold before split applies
payout_minimum: $200
payout_frequency: on_demand  # Request anytime
payout_processing: 1-3_business_days
drawdown_same_as_eval: true
```

### Platform

```yaml
platform: TopstepX  # Proprietary web-based (required for new accounts)
legacy_platforms: [NinjaTrader, Tradovate, Quantower, TradingView, T4]
data_feed: TopstepX_proprietary  # Was Rithmic/CQG, now proprietary
```

### Payout Formula

```
gross_profit = total_pnl
trader_payout = gross_profit * 0.90
net_after_activation = trader_payout  # activation_fee = $0
monthly_cost_to_pass = monthly_fee * months_to_pass
total_cost = monthly_cost_to_pass
ROI = trader_payout / total_cost
```

---

## Take Profit Trader (TPT)

### Evaluation Accounts (Test)

| Size | Monthly Fee | Profit Target | Trailing Drawdown (EOD) | Max Contracts |
|------|------------|---------------|------------------------|---------------|
| $25K | $150 | $1,500 | $1,500 | 3 ES / 30 MES |
| $50K | $170 | $3,000 | $2,000 | 15 micros |
| $75K | $200 | $4,500 | $3,000 | 9 ES / 90 MES |
| $100K | $250 | $6,000 | $4,000 | 12 ES / 120 MES |
| $150K | $360 | $9,000 | $6,000 | 15 ES / 150 MES |

### Rules

```yaml
firm: take_profit_trader
evaluation_type: one_step
daily_loss_limit: null  # Removed January 2025
trailing_drawdown_type: EOD
trailing_drawdown_locks: false
consistency_rule:
  type: single_day_cap
  max_single_day_percent: 0.50  # No single day > 50% of total profit
  # Example: If total profit = $4,000, no single day can exceed $2,000
  applies_to: [evaluation, funded_PRO]
  removed_at: PRO_plus  # No consistency rule after PRO+
min_trading_days: 5
max_trading_days: null  # No time limit
overnight_positions: not_allowed  # User constraint: no overnight positions
weekend_positions: not_allowed
news_trading: allowed
scaling_plan: false
```

### Funded Account (PRO → PRO+)

```yaml
activation_fee: $0  # All firms have $0 activation fee
monthly_fee: $0  # No recurring fees once funded
starting_balance: account_size  # Unlike Topstep, starts at full size
profit_split_tiers:
  - tier: PRO
    split: 0.80  # 80% to trader
    until: $5,000_withdrawn
  - tier: PRO_plus
    split: 0.90  # 90% to trader
    after: $5,000_withdrawn
    consistency_rule: removed
payout_minimum: $100
payout_frequency: daily  # Standout feature — daily payouts
payout_processing: same_day
drawdown_same_as_eval: true
```

### Platform

```yaml
data_feed: [Rithmic, CQG]  # Choose at purchase, cannot switch
platforms:
  - NinjaTrader
  - Tradovate
  - TradingView
  - Sierra Chart
  - Quantower
  - R|Trader Pro
  - ATAS
  - Bookmap
  - Jigsaw
  - MotiveWave
  # 15+ total — broadest platform support in industry
```

### Payout Formula

```
# PRO phase (first $5K withdrawn)
gross_profit = total_pnl
trader_payout_PRO = gross_profit * 0.80

# PRO+ phase (after $5K withdrawn)
trader_payout_PRO_plus = gross_profit * 0.90

# Break-even calculation
total_cost = (monthly_fee * months_to_pass)
break_even_profit = total_cost / 0.80  # Need this much gross to cover costs
```

### Consistency Rule Simulation

```python
# Agent must enforce this during backtest simulation:
def check_consistency(daily_pnls):
    total_profit = sum(p for p in daily_pnls if p > 0)
    if total_profit == 0:
        return True
    for day_pnl in daily_pnls:
        if day_pnl > total_profit * 0.50:
            return False  # FAIL — single day exceeded 50%
    return True
```

---

## My Funded Futures (MFFU)

### Evaluation Accounts

| Size | Monthly Fee | Profit Target | Trailing Drawdown (EOD) | Max Contracts |
|------|------------|---------------|------------------------|---------------|
| $50K (Core) | $77 | $3,000 | $2,000 | 15 micros |
| $50K (Rapid) | $97 | $3,000 | $2,000 | 15 micros |
| $100K | $137 | $5,500 | $3,500 | 10 ES |
| $150K | $197 | $9,000 | $5,000 | 15 ES |

### Rules

```yaml
firm: my_funded_futures
evaluation_type: one_step
daily_loss_limit: null
trailing_drawdown_type: EOD
trailing_drawdown_locks: true  # Locks at starting balance
consistency_rule:
  type: single_day_cap
  evaluation: 0.50  # No single day > 50% of total profit
  funded: 0.40  # 40% consistency on funded
min_trading_days: 5  # Updated March 2026
max_trading_days: null  # No time limit
overnight_positions: not_allowed  # User constraint: no overnight positions
weekend_positions: not_allowed
news_trading: allowed
scaling_plan: false
```

### Funded Account

```yaml
activation_fee: $0  # No activation fee — standout feature
monthly_fee: $0
starting_balance: $0  # Trade up from zero (like Topstep)
profit_split: 0.80  # Core plan: 80% (Rapid plan: 90%)
payout_minimum: $250
payout_frequency: bi_weekly  # Every 2 weeks
payout_processing: 2-5_business_days
drawdown_same_as_eval: true
```

### Platform

```yaml
data_feed: Rithmic  # Rithmic only
platforms:
  - NinjaTrader
  - Tradovate
  - Sierra Chart
  - Quantower
  - ATAS
  - Jigsaw
  - TradingView
  - R|Trader Pro
```

### Payout Formula

```
gross_profit = total_pnl
trader_payout = gross_profit * 0.80
total_cost = monthly_fee * months_to_pass  # No activation fee
ROI = trader_payout / total_cost
# Best ROI of any firm due to $0 activation + lowest monthly fees
```

---

## Apex Trader Funding

### Evaluation Accounts

| Size | Monthly Fee | Profit Target | Trailing Drawdown (EOD) | Max Contracts |
|------|------------|---------------|------------------------|---------------|
| $50K (EOD) | $99 one-time | $3,000 | $2,000 | 15 micros |
| $50K (Intraday) | $79 one-time | $3,000 | $2,000 | 15 micros |

### Rules

```yaml
firm: apex_trader_funding
evaluation_type: one_step
daily_loss_limit: $1,000  # EOD accounts only (March 2026)
trailing_drawdown_type: EOD
trailing_drawdown_locks: true  # Locks at starting balance once reached
consistency_rule:
  evaluation: null  # No consistency on eval
  funded: 0.50  # 50% single-day cap on funded payouts
min_trading_days: 1  # Reduced from 7 (March 2026)
max_trading_days: null
overnight_positions: not_allowed  # User constraint: no overnight positions
weekend_positions: not_allowed
news_trading: allowed
scaling_plan: false
max_payouts_per_account: 6  # Max 6 payouts per account (March 2026)
```

### Funded Account (PA — Performance Account)

```yaml
activation_fee: $0  # All firms have $0 activation fee
monthly_fee: $85  # $85/month ongoing fee in funded phase (March 2026)
starting_balance: $0  # Trade up from zero
profit_split_tiers:
  - tier: first_25k
    split: 1.00  # 100% of first $25,000 to trader
  - tier: after_25k
    split: 0.90  # 90% after $25K
payout_minimum: $500  # First 3 payouts
payout_frequency: bi_weekly
payout_processing: 3-5_business_days
```

### Platform

```yaml
data_feed: Rithmic
platforms:
  - NinjaTrader
  - Tradovate
  - TradingView
  - Sierra Chart
  - Quantower
  - ATAS
  - Bookmap
  - Jigsaw
  - MotiveWave
  - R|Trader Pro
  # 14+ total
```

### Payout Formula

```
# First $25K — 100% to trader
if cumulative_withdrawn <= 25000:
    trader_payout = gross_profit * 1.00
else:
    trader_payout = gross_profit * 0.90

# BUT: $85/month ongoing data fee eats into profits
net_monthly = trader_payout - 85
total_cost = (eval_months * monthly_fee)  # $0 activation, $85/mo ongoing
```

---

## Funded Futures Network (FFN)

### Evaluation Accounts

| Type | Size | Monthly Fee | Profit Target | Trailing Drawdown |
|------|------|------------|---------------|-------------------|
| Standard | $50K | $150 | $3,000 | $2,000 |
| Standard | $100K | $260 | $6,000 | $3,500 |
| Standard | $150K | $350 | $9,000 | $5,000 |

### Rules

```yaml
firm: funded_futures_network
evaluation_type: two_step  # Evaluation → Exhibition → Funded
daily_loss_limit: null  # No daily loss limit (March 2026)
trailing_drawdown_type: EOD
trailing_drawdown_locks: true
consistency_rule:
  type: single_day_cap
  max_single_day_percent: 0.40  # 40% consistency rule (March 2026)
min_trading_days:
  evaluation: 3
  exhibition: 0
max_trading_days: null
overnight_positions: not_allowed  # User constraint: no overnight positions
weekend_positions: not_allowed
news_trading: restricted
scaling_plan: false
```

### Exhibition Phase (Step 2)

```yaml
# After passing evaluation, must pass Exhibition before real funding
exhibition_activation_fee: $0  # All firms have $0 activation fee
exhibition_rules:
  profit_target: varies  # Buffer target, lower than eval
  consistency_rule: none
  min_days: 0
  drawdown: same_as_eval
```

### Funded Account

```yaml
activation_fee: $0  # All firms have $0 activation fee
monthly_data_fee: $126  # Ongoing — significant cost
starting_balance: account_size
profit_split_tiers:
  - tier: initial
    split: 0.80
    until: $5,000_withdrawn
  - tier: scaled
    split: 0.90
    after: $5,000_withdrawn
payout_minimum: $250
payout_frequency: bi_weekly
payout_processing: 3-5_business_days
```

### Platform

```yaml
data_feed: Rithmic
platforms:
  proprietary: [FundX, EdgeProX, ONYX]  # Included free
  included_free: [Quantower, MotiveWave]
  bring_your_own: [Sierra Chart, Bookmap, Jigsaw, NinjaTrader]
  NOT_supported: [TradingView]  # Important: no TradingView
```

### Payout Formula

```
# Two-step process increases time-to-funded
total_eval_cost = (eval_months * monthly_fee) + (funded_months * 126)
# $126/month data fee is highest ongoing cost of any firm

# First $5K at 80%, then 90%
if cumulative_withdrawn <= 5000:
    trader_payout = gross_profit * 0.80
else:
    trader_payout = gross_profit * 0.90

net_monthly = trader_payout - 126  # Ongoing data fee
```

---

## Alpha Futures

### Evaluation Accounts

| Type | Size | Monthly Fee | Profit Target | Trailing Drawdown (EOD) | Activation Fee |
|------|------|------------|---------------|------------------------|----------------|
| Standard | $50K | $99 | $3,000 (6%) | $2,000 (4%) | $0 |
| Standard | $100K | $179 | $6,000 (6%) | $4,000 (4%) | $0 |
| Standard | $150K | $279 | $9,000 (6%) | $6,000 (4%) | $0 |
| Advanced | $50K | $149 | $4,000 (8%) | $1,750 (3.5%) | $0 |
| Advanced | $100K | $279 | $8,000 (8%) | $3,500 (3.5%) | $0 |
| Advanced | $150K | $419 | $12,000 (8%) | $5,250 (3.5%) | $0 |
| Zero | $25K | $79 | varies | varies | $0 |
| Zero | $50K | $119 | varies | varies | $0 |
| Zero | $100K | $199 | varies | varies | $0 |

### Rules

```yaml
firm: alpha_futures
evaluation_type: one_step
daily_loss_limit: null
trailing_drawdown_type: EOD
trailing_drawdown_locks: true
consistency_rule:
  evaluation:
    type: single_day_cap
    max_single_day_percent: 0.50  # Standard eval only
  funded:
    type: none  # No consistency rule once funded
min_trading_days: 2
max_trading_days: null  # Unlimited evaluation resets
overnight_positions: NOT_ALLOWED  # Must flatten before session close
weekend_positions: NOT_ALLOWED
news_trading: restricted
scaling_plan: false
```

### Funded Account

```yaml
activation_fee: $0  # All firms have $0 activation fee
monthly_fee: $0
starting_balance: account_size
profit_split_tiers:
  standard:
    - tier: first_payout
      split: 0.70
    - tier: second_payout
      split: 0.80
    - tier: third_payout_plus
      split: 0.90
  advanced:
    - tier: all_payouts
      split: 0.90  # 90% from day one — best for high-conviction strategies
  zero:
    - tier: all_payouts
      split: 0.80
payout_minimum: $100
payout_frequency: bi_weekly
payout_processing: 3-5_business_days
```

### Platform

```yaml
data_feed: CQG  # CQG only — different from most firms (Rithmic)
platforms:
  - NinjaTrader
  - Tradovate
  - TradingView
  - Quantower
  - ProjectX
  - AlphaTicks  # Proprietary
```

### Payout Formula

```
# Standard: Scaling split (70% → 75% → 80% → 90%)
# Advanced: 90% flat from day one (best for strategies with high expected profit)
# Zero: 80% flat

# Advanced is best when: expected_profit > (advanced_fee - standard_fee) / 0.10
# Breakpoint: If you expect to make > $500/month profit, Advanced pays for itself
```

---

## Tradeify

### Evaluation Accounts

| Size | Monthly Fee | Profit Target | Trailing Drawdown | Max Contracts |
|------|------------|---------------|-------------------|---------------|
| $50K (Select) | $159 | $2,500 | $2,000 | 15 micros |

### Rules

```yaml
firm: tradeify
evaluation_type: one_step
daily_loss_limit: null
trailing_drawdown_type: EOD  # Changed from realtime to EOD (March 2026)
trailing_drawdown_locks: true
consistency_rule:
  type: single_day_cap
  max_single_day_percent: 0.40  # 40% consistency rule (March 2026)
min_trading_days: 3
max_trading_days: null
overnight_positions: not_allowed  # User constraint: no overnight positions
weekend_positions: not_allowed
news_trading: allowed
scaling_plan: false
commission_per_side: $1.29  # Higher than most firms
```

### Funded Account

```yaml
activation_fee: $0  # No activation fee
monthly_fee: $0
starting_balance: $0  # Trade up from zero
profit_split: 0.90  # 90% to trader (March 2026)
payout_minimum: $200
payout_frequency: weekly
payout_processing: 1-3_business_days
```

### Platform

```yaml
platform: DXtrade  # Browser-based, proprietary
secondary: [NinjaTrader, Tradovate]  # Limited support
data_feed: proprietary  # Not Rithmic or CQG
```

### Payout Formula

```
# Best for small accounts — 100% of first $15K
if cumulative_withdrawn <= 15000:
    trader_payout = gross_profit * 1.00
else:
    trader_payout = gross_profit * 0.90

total_cost = monthly_fee * months_to_pass  # No activation fee
# Cheapest total path to funded
```

---

## Earn2Trade

### Evaluation Accounts (Gauntlet Mini)

| Size | Monthly Fee | Profit Target | Trailing Drawdown (EOD) | Max Contracts |
|------|------------|---------------|------------------------|---------------|
| $50K | $170 | $3,000 | $2,000 | 15 micros |

### Rules

```yaml
firm: earn2trade
evaluation_type: one_step
daily_loss_limit: $1,100
trailing_drawdown_type: EOD
trailing_drawdown_locks: true
consistency_rule:
  type: single_day_cap
  max_single_day_percent: 0.50  # 50% consistency rule
min_trading_days: 10
max_trading_days: null
overnight_positions: NOT_ALLOWED
weekend_positions: NOT_ALLOWED
news_trading: allowed
scaling_plan: false
commission_per_side: $0.62
max_withdrawal_cap: $4,000  # Severe limitation — total withdrawal cap
```

### Funded Account

```yaml
activation_fee: $0  # All firms have $0 activation fee
monthly_fee: $0
starting_balance: account_size
profit_split: 0.80  # 80% to trader
payout_minimum: $200
payout_frequency: bi_weekly
payout_processing: 3-5_business_days
drawdown_same_as_eval: true
max_withdrawal_cap: $4,000  # Total lifetime cap — severe limitation
```

### Platform

```yaml
data_feed: Rithmic
platforms:
  - NinjaTrader
  - R|Trader Pro
```

### Payout Formula

```
gross_profit = total_pnl
trader_payout = gross_profit * 0.80

# CRITICAL: $4,000 total withdrawal cap
# Once trader has withdrawn $4,000 total, account is done
# This makes Earn2Trade the worst firm for long-term funded trading
total_cost = monthly_fee * months_to_pass
max_lifetime_payout = $4,000  # Hard cap
```

---

## Agent Simulation Rules

### Performance Gate — BEFORE Firm Simulation

> Agents MUST check these BEFORE simulating against any firm.
> If a strategy fails the performance gate, do NOT waste compute on firm simulation.

```python
def check_performance_gate(strategy_stats):
    """
    Hard minimum performance requirements. Strategy must pass ALL gates.
    All metrics from walk-forward OUT-OF-SAMPLE data only.

    Returns:
        (passed: bool, rejection_reasons: list[str])
    """
    rejections = []

    # --- EARNINGS POWER ---
    if strategy_stats['avg_daily_pnl'] < 250:
        rejections.append(
            f"avg_daily_pnl ${strategy_stats['avg_daily_pnl']:.0f} < $250 minimum. "
            f"Strategy earns ${strategy_stats['avg_daily_pnl'] * 20:.0f}/month — not worth one account."
        )

    # --- DAILY SURVIVAL ---
    # Must be profitable on 60%+ of trading days (12 out of 20)
    win_day_rate = strategy_stats['winning_days'] / strategy_stats['total_trading_days']
    if win_day_rate < 0.60:
        rejections.append(
            f"Win rate by days {win_day_rate:.0%} < 60% minimum. "
            f"Trader would have {strategy_stats['total_trading_days'] - strategy_stats['winning_days']} "
            f"losing days out of {strategy_stats['total_trading_days']} — too inconsistent."
        )

    # Worst month must still have 10+ winning days
    if strategy_stats.get('worst_month_win_days', 0) < 10:
        rejections.append(
            f"Worst month had only {strategy_stats['worst_month_win_days']} winning days. "
            f"Minimum 10 required. Strategy is too streaky."
        )

    # --- PROFIT QUALITY ---
    if strategy_stats['profit_factor'] < 1.75:
        rejections.append(
            f"Profit factor {strategy_stats['profit_factor']:.2f} < 1.75 minimum. "
            f"Winners don't outweigh losers enough."
        )

    if strategy_stats['sharpe_ratio'] < 1.5:
        rejections.append(
            f"Sharpe ratio {strategy_stats['sharpe_ratio']:.2f} < 1.5 minimum. "
            f"Risk-adjusted returns too weak."
        )

    if strategy_stats.get('avg_winner_to_loser_ratio', 0) < 2.0:
        rejections.append(
            f"Avg winner/loser ratio {strategy_stats['avg_winner_to_loser_ratio']:.2f} < 2.0. "
            f"Average loss is too close to average win."
        )

    # --- DRAWDOWN ---
    if strategy_stats['max_drawdown'] > 2000:
        rejections.append(
            f"Max drawdown ${strategy_stats['max_drawdown']:.0f} > $2,000. "
            f"Exceeds most prop firm limits. Would blow Topstep 50K ($2K limit)."
        )

    # --- CONSECUTIVE LOSSES ---
    if strategy_stats.get('max_consecutive_losing_days', 0) > 4:
        rejections.append(
            f"Max consecutive losing days: {strategy_stats['max_consecutive_losing_days']}. "
            f"Maximum 4 allowed. Drawdown + mental capital risk too high."
        )

    # --- RECOVERY ---
    if strategy_stats.get('avg_loss_on_red_days', 0) > strategy_stats.get('avg_win_on_green_days', 0):
        rejections.append(
            f"Avg loss on red days (${abs(strategy_stats['avg_loss_on_red_days']):.0f}) > "
            f"avg win on green days (${strategy_stats['avg_win_on_green_days']:.0f}). "
            f"Red days hit harder than green days pay — unsustainable."
        )

    return (len(rejections) == 0, rejections)


def classify_strategy_tier(strategy_stats):
    """
    Classify strategy into performance tier.
    Only called AFTER check_performance_gate passes.
    """
    pnl = strategy_stats['avg_daily_pnl']
    win_days = strategy_stats['winning_days'] / strategy_stats['total_trading_days'] * 20
    dd = strategy_stats['max_drawdown']
    pf = strategy_stats['profit_factor']
    sharpe = strategy_stats['sharpe_ratio']

    if pnl >= 500 and win_days >= 14 and dd < 1500 and pf >= 2.5 and sharpe >= 2.0:
        return "TIER_1_BREAD_AND_BUTTER"  # Deploy immediately, $10K+/month
    elif pnl >= 350 and win_days >= 13 and dd < 2000 and pf >= 2.0 and sharpe >= 1.75:
        return "TIER_2_SOLID_EDGE"  # Deploy with monitoring, $7K+/month
    elif pnl >= 250 and win_days >= 12 and dd < 2500 and pf >= 1.75 and sharpe >= 1.5:
        return "TIER_3_MINIMUM_VIABLE"  # Best-fit firm only, $5K+/month
    else:
        return "REJECTED"  # Should not reach here if gate passed
```

### Universal Constraints (Apply to ALL Firms)

```yaml
# Trading hours (CME Globex)
futures_session:
  sunday_open: "17:00 CT"  # 6:00 PM ET
  friday_close: "16:00 CT"  # 5:00 PM ET
  daily_maintenance: "16:00-17:00 CT"  # 1 hour daily

# Contract specifications (for position sizing)
ES:  # E-mini S&P 500
  tick_size: 0.25
  tick_value: $12.50
  point_value: $50.00
  margin_day: ~$500  # Prop firm reduced margin
  margin_overnight: ~$12,000  # Full exchange margin

NQ:  # E-mini Nasdaq
  tick_size: 0.25
  tick_value: $5.00
  point_value: $20.00
  margin_day: ~$500
  margin_overnight: ~$17,000

CL:  # Crude Oil
  tick_size: 0.01
  tick_value: $10.00
  point_value: $1,000.00
  margin_day: ~$500
  margin_overnight: ~$6,000

MES:  # Micro E-mini S&P 500
  tick_size: 0.25
  tick_value: $1.25
  point_value: $5.00
  margin_day: ~$50
  margin_overnight: ~$1,200

MNQ:  # Micro E-mini Nasdaq
  tick_size: 0.25
  tick_value: $0.50
  point_value: $2.00
  margin_day: ~$50
  margin_overnight: ~$1,700
```

### Trailing Drawdown Simulation

```python
def simulate_trailing_drawdown_eod(daily_closing_balances, max_drawdown, locks_at_start=True):
    """
    Simulate EOD trailing drawdown for prop firm evaluation.

    Args:
        daily_closing_balances: List of end-of-day account balances
        max_drawdown: Maximum allowed drawdown (e.g., 2000 for Topstep 50K)
        locks_at_start: If True, drawdown floor stops trailing at starting balance

    Returns:
        (passed: bool, blown_on_day: int or None, max_drawdown_used: float)
    """
    starting_balance = daily_closing_balances[0]
    high_water_mark = starting_balance

    for day, balance in enumerate(daily_closing_balances):
        high_water_mark = max(high_water_mark, balance)

        # Calculate drawdown floor
        drawdown_floor = high_water_mark - max_drawdown

        # If locks_at_start, floor never goes below starting balance
        if locks_at_start:
            drawdown_floor = max(drawdown_floor, starting_balance - max_drawdown)
            # Once HWM reaches starting_balance + max_drawdown, floor = starting_balance
            # After that, floor stays at starting_balance (locked)

        if balance <= drawdown_floor:
            return (False, day, high_water_mark - balance)

    return (True, None, high_water_mark - min(daily_closing_balances))


def check_tpt_consistency(daily_pnls):
    """
    TPT 50% consistency rule: no single day > 50% of total profit.

    Args:
        daily_pnls: List of daily P&L values
    Returns:
        (passed: bool, worst_day_pct: float)
    """
    total_profit = sum(p for p in daily_pnls if p > 0)
    if total_profit <= 0:
        return (True, 0.0)

    worst_pct = 0.0
    for pnl in daily_pnls:
        if pnl > 0:
            day_pct = pnl / total_profit
            worst_pct = max(worst_pct, day_pct)
            if day_pct > 0.50:
                return (False, day_pct)

    return (True, worst_pct)


def check_ffn_express_consistency(daily_pnls, profit_target):
    """
    FFN Express 15% consistency rule: no single day > 15% of profit target.

    Args:
        daily_pnls: List of daily P&L values
        profit_target: Evaluation profit target (e.g., 3000 for 50K)
    Returns:
        (passed: bool, max_day: float, limit: float)
    """
    daily_limit = profit_target * 0.15
    max_day = max(daily_pnls) if daily_pnls else 0
    return (max_day <= daily_limit, max_day, daily_limit)
```

### Strategy-to-Firm Matching

```python
def rank_firms_for_strategy(strategy_stats):
    """
    Given a strategy's backtest stats, rank prop firms by expected ROI.

    strategy_stats = {
        'avg_daily_pnl': 150,          # Average daily P&L
        'max_daily_pnl': 800,          # Largest single day
        'max_drawdown': 1500,           # Worst peak-to-trough
        'avg_days_to_target': 20,       # Days to hit typical profit target
        'trades_overnight': False,      # Does strategy hold overnight?
        'consistency_ratio': 0.35,      # Largest day / total profit
    }
    """
    firms = {
        'topstep_50k': {
            'monthly_fee': 49, 'activation': 0, 'profit_target': 3000,
            'max_drawdown': 2000, 'split': 0.90, 'consistency': None,
            'overnight_ok': True, 'ongoing_fee': 0
        },
        'tpt_50k': {
            'monthly_fee': 170, 'activation': 0, 'profit_target': 3000,
            'max_drawdown': 2000, 'split': 0.80, 'consistency': 0.50,
            'overnight_ok': True, 'ongoing_fee': 0
        },
        'mffu_50k': {
            'monthly_fee': 77, 'activation': 0, 'profit_target': 3000,
            'max_drawdown': 2000, 'split': 0.80, 'consistency': 0.50,
            'overnight_ok': True, 'ongoing_fee': 0
        },
        'apex_50k': {
            'monthly_fee': 99, 'activation': 0, 'profit_target': 3000,
            'max_drawdown': 2000, 'split': 1.00, 'consistency': 0.50,
            'overnight_ok': True, 'ongoing_fee': 85
        },
        'tradeify_50k': {
            'monthly_fee': 159, 'activation': 0, 'profit_target': 2500,
            'max_drawdown': 2000, 'split': 0.90, 'consistency': 0.40,
            'overnight_ok': True, 'ongoing_fee': 0
        },
        'alpha_50k': {
            'monthly_fee': 99, 'activation': 0, 'profit_target': 3000,
            'max_drawdown': 2000, 'split': 0.70, 'consistency': 0.50,
            'overnight_ok': False, 'ongoing_fee': 0
        },
        'ffn_50k': {
            'monthly_fee': 150, 'activation': 0, 'profit_target': 3000,
            'max_drawdown': 2000, 'split': 0.80, 'consistency': 0.40,
            'overnight_ok': True, 'ongoing_fee': 126
        },
        'earn2trade_50k': {
            'monthly_fee': 170, 'activation': 0, 'profit_target': 3000,
            'max_drawdown': 2000, 'split': 0.80, 'consistency': 0.50,
            'overnight_ok': True, 'ongoing_fee': 0
        },
    }

    results = []
    for name, firm in firms.items():
        # Check hard disqualifiers
        if strategy_stats['max_drawdown'] >= firm['max_drawdown']:
            continue  # Strategy drawdown exceeds firm limit
        if not firm['overnight_ok'] and strategy_stats['trades_overnight']:
            continue  # Strategy needs overnight, firm bans it
        if firm['consistency'] and strategy_stats['consistency_ratio'] > firm['consistency']:
            continue  # Strategy fails consistency rule

        # Calculate expected ROI
        months_to_pass = strategy_stats['avg_days_to_target'] / 21  # ~21 trading days/month
        eval_cost = firm['monthly_fee'] * months_to_pass + firm['activation']
        gross_payout = firm['profit_target'] * firm['split']

        # Annualized: assume you stay funded for 12 months after passing
        annual_ongoing = firm['ongoing_fee'] * 12
        annual_gross = strategy_stats['avg_daily_pnl'] * 252 * firm['split']
        annual_net = annual_gross - annual_ongoing - eval_cost

        results.append({
            'firm': name,
            'eval_cost': eval_cost,
            'months_to_pass': months_to_pass,
            'first_payout': gross_payout,
            'annual_net_estimate': annual_net,
            'roi': annual_net / eval_cost if eval_cost > 0 else float('inf')
        })

    return sorted(results, key=lambda x: x['roi'], reverse=True)
```

---

## Summary: Agent Quick Reference

| Firm | Best For | Avoid If |
|------|----------|----------|
| **Topstep** | Cheapest eval ($49), no consistency rule | Strategy needs > $2K drawdown (tight at 4%) |
| **TPT** | Daily payouts, 15+ platforms | Large single-day winners (50% consistency rule) |
| **MFFU** | Best value ($77, $0 activation, 80% split) | Need TradingView... wait, they support it |
| **Apex** | Scaling (20 accounts), 100% first $25K | $85/month ongoing fee eats small profits |
| **FFN** | Free Quantower + MotiveWave | $126/month data fee, 15% Express consistency, no TradingView |
| **Alpha Futures** | Advanced = 90% from day one | Overnight strategies (must flatten), tight 3.5% drawdown |
| **Tradeify** | Cheapest total, 100% first $15K, 40% consistency rule | DXtrade only, limited platform support |
| **Earn2Trade** | Low commission ($0.62), familiar Rithmic/NinjaTrader setup | $4,000 total withdrawal cap (worst payout ceiling), 10 min days, $1,100 daily loss limit |

### Recommended Evaluation Order (Cost-Optimized)

1. **MFFU $50K** — $77/mo, $0 activation, 80% split, no consistency rule
2. **Topstep $50K** — $49/mo, $0 activation, 90% split, tightest drawdown
3. **Tradeify $50K** — $159/mo, $0 activation, 90% split, 100% first $15K
4. **Apex $50K** — $99/mo, $0 activation, 100% first $25K ($85/mo ongoing fee)
5. **TPT $50K** — $170/mo, $0 activation (only if strategy passes 50% consistency check)
