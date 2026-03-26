# Backtesting Mistakes — Complete Reference

**Date:** 2026-03-17
**Purpose:** Every known source of false data in backtesting systems. Used to build verification tests and harden Trading Forge.

---

## Part 1: Trader Backtesting Mistakes

### 1.1 Data Mistakes

| Mistake | Impact | Trading Forge Status |
|---------|--------|---------------------|
| Survivorship bias (testing only instruments that still exist) | Inflated returns | LOW RISK — we test specific futures (ES/NQ/CL/YM/RTY/GC) |
| Look-ahead bias (using future info for decisions) | Spectacular but fictional results | AUDIT NEEDED — daily bars available intraday? |
| Unadjusted continuous contracts (roll gaps = phantom signals) | 10-15 phantom signals per year per symbol | CLAUDE.md says ratio-adjusted — VERIFY S3 data |
| Bad data quality (missing bars, duplicates, bad prints) | Incorrect indicator values, phantom stops triggered | AUDIT S3 parquet quality |
| Wrong session data (RTH vs ETH) | VWAP, volume profile, RSI all differ | MUST enforce session type per strategy |
| Cherry-picked date ranges | Strategies look good only in favorable periods | Wave 1.3/1.4 fixes (full S3 range) |
| Insufficient sample size (<100 trades meaningless) | Cannot distinguish skill from luck | Enforce minimum 500 trades gate |
| Timezone errors (UTC vs ET) | All killzones shifted 4-5 hours | MUST convert Databento UTC → ET before session logic |
| Using revised economic data instead of initial release | Look-ahead for macro signals | Use initial release dates for macro indicators |
| COT data on report date vs release date | Look-ahead by 3 days | Use Friday release, not Tuesday coverage |

### 1.2 Execution Realism Mistakes

| Mistake | Impact | Trading Forge Status |
|---------|--------|---------------------|
| Zero slippage | $12,600/year/contract difference on 4 trades/day | FIXED — ATR-based slippage model |
| Constant slippage | Understates worst-trade slippage | BUG — using `np.nanmean` instead of per-bar |
| 100% fill on limit orders | Massively inflates mean-reversion strategies | fill_model.py EXISTS but NOT wired |
| Adverse selection on limit fills | Get filled disproportionately on losers | NOT modeled |
| Overnight gap risk | Stops gap through, actual loss >> stop distance | gap_risk.py EXISTS but NOT wired |
| Stop-market vs stop-limit confusion | Stop-market = catastrophic slippage; stop-limit = no fill | CLAUDE.md says stop-limit only |
| Per-firm commission differences | MFFU $1.58/side vs Apex $2.64/side | firm_config.py HAS rates |
| Micro contract commission penalty | 10 MES = 10x commission vs 1 ES for same exposure | Must model per-contract cost ratio |
| Ignoring margin requirements | Backtest trades 10 contracts, account can afford 5 | MISSING — Wave 6.3 |
| Margin expansion during volatility | Exchanges double margin in high-vol | NOT modeled |
| Partial fills on larger orders | 10+ MES overnight = realistic partial fill risk | NOT modeled |
| Latency between signal and fill | 20-100ms retail latency, price moves 2-4 ticks | Handled by next-bar entry convention |

### 1.3 Statistical Mistakes

| Mistake | Impact | Trading Forge Status |
|---------|--------|---------------------|
| Overfitting (>5 parameters) | Captures noise, not signal | CLAUDE.md caps at 5 params |
| In-sample only testing | All metrics are fictional | Walk-forward default (Wave 1.5) |
| Curve fitting to one regime | Strategy dies when regime changes | Regime detection exists |
| Data snooping / multiple comparisons | Best of 400 tests looks amazing by chance | Need Bonferroni correction with Optuna |
| Parameter spike vs plateau | Fragile parameter = overfit | Robustness testing via Optuna |
| Small sample Sharpe uncertainty | Sharpe 2.0 with 24 months → true could be 1.2-2.8 | Report confidence intervals |
| Win rate confidence intervals | 50 trades at 60% → true win rate 46%-74% | Enforce minimum trade counts |
| P-hacking (only reporting winners) | Selection bias | System journal tracks ALL runs |
| Long-bias in equity indices | Longs inflated ~7-10%/year by drift | Must test long and short separately |

### 1.4 Strategy Logic Mistakes

| Mistake | Impact | Trading Forge Status |
|---------|--------|---------------------|
| Trading every signal without context | Enters in wrong regime/session | Bias Engine + Eligibility Gate (design phase) |
| Not considering regime changes | Strategy works 2020-2021, dies 2022 | Regime detection exists |
| Ignoring time-of-day liquidity | 2x spreads overnight, lunch dead zone | Session multipliers (Wave 6.7) |
| Not accounting for FOMC/CPI/NFP | Normal signals meaningless during events | Skip engine EXISTS |
| Not testing long/short separately | Long side carries shorts in bull market | Must split in analytics |
| Combining correlated strategies as diversification | ES+NQ = 0.90 correlation = one strategy | Correlation check required |
| 0DTE options changing ES intraday dynamics since 2022 | Historical patterns may not hold | Regime recency weighting |

### 1.5 Prop Firm Specific Mistakes

| Mistake | Impact | Trading Forge Status |
|---------|--------|---------------------|
| Ignoring daily loss limits | Account terminated on one bad day | Wave 2.3 |
| Ignoring consistency rules | Best day >30-50% of total profit = fail | Wave 2.1 |
| Wrong trailing DD type (EOD vs intraday) | Different survival rates from same trades | Wave 6.8 |
| Not modeling evaluation phase separately | Different rules than funded phase | Wave 2.1 |
| Scaling plan not modeled | Start at 2 contracts, not 5 | Wave 6.4 |
| Cost of failed evaluations | 30% pass rate = $300-$1,000 avg cost to pass | Must factor into ROI |
| Trading overnight when firm prohibits | Account violation | Wave 6.6 |

---

## Part 2: Machine Backtesting Mistakes

### 2.1 vectorbt-Specific

| Bug | Details | Trading Forge Status |
|-----|---------|---------------------|
| Slippage is multiplicative on price, not dollar-based | `price * (1 + slippage)` — wrong for futures | FIXED — compute externally |
| `fixed_fees` per-order not per-contract | $0.62 flat instead of $0.62 × 15 contracts | FIXED — compute externally |
| `init_cash` silently rejects orders when too low | `OrderStatus.Rejected` — no exception | FIXED — using `float("inf")` |
| `freq` affects Sharpe by sqrt(N) | `freq="1D"` on 15min = 5x deflation | Wave 1.1 |
| Slippage NOT applied to stop orders (GitHub #695) | Stops fill at exact price — unrealistic | Must add slippage to stops manually |
| Reversals treated as single order | Fee/slippage applied once, not twice | FIXED — equity loop counts both legs |
| `SizeType.Percent` raises on reversals (#697) | Can't use percentage sizing with reversals | Using fixed contract sizes |
| `pf.value()` meaningless with `init_cash=inf` | Always near infinity | FIXED — using `pf.assets()` |
| Signal generation look-ahead | Signal at bar[i] using close[i], fill at close[i] | AUDIT signal shift logic |

### 2.2 Equity Curve Construction

| Bug | Details | Trading Forge Status |
|-----|---------|---------------------|
| Close-diff vs actual fill prices | Assumes entry/exit at close | Acceptable with vectorbt default |
| Average slippage instead of per-bar | `np.nanmean` used for all bars | **BUG — must index slippage_clean[i]** |
| Compounding vs non-compounding | Futures = non-compounding (fixed contracts) | CORRECT — using cumsum |
| Mark-to-market vs trade-based DD | MTM captures intra-trade drawdowns | CORRECT — using MTM |

### 2.3 Numerical Precision

| Bug | Details | Trading Forge Status |
|-----|---------|---------------------|
| Float equality in signals.py | `"==": lambda a, b: a == b` | **BUG — 5000.4999 != 5000.50** |
| Price level comparisons failing | Computed targets/stops miss by 1e-15 | Must use approximate equality |
| Off-by-one in lookback windows | `rolling_mean(20)` includes current bar | Standard for end-of-bar signals |
| Timestamp alignment between TFs | Different bar-labeling conventions across sources | AUDIT Databento convention |

### 2.4 Data Pipeline

| Bug | Details | Trading Forge Status |
|-----|---------|---------------------|
| Wrong timeframe loaded | Cache hit on wrong file | Add bar count validation |
| Forward-fill creating false signals | Holidays with zero range dilute ATR | Don't forward-fill — skip holidays |
| Multi-TF look-ahead | Today's daily bar available at 09:30 | **Must use previous day's daily** |
| Resampling errors (wrong OHLC agg) | Using mean() instead of first()/max()/min()/last() | AUDIT resampling logic |
| Session boundary resampling | 1H bar spanning 15:45-18:15 crosses sessions | Must respect session boundaries |

### 2.5 Performance Metric Errors

| Bug | Details | Trading Forge Status |
|-----|---------|---------------------|
| Sharpe ddof=0 vs ddof=1 | `np.std(arr)` vs `np.std(arr, ddof=1)` | BUG — using ddof=0, should use ddof=1 |
| Intraday vs EOD max drawdown | EOD is optimistic vs intraday for prop firms | Must compute intraday DD |
| Win rate per-trade vs per-day | CLAUDE.md gates use per-day, code computes per-trade | Must compute both |
| Profit factor excluding flat days | Standard but masks concentration risk | Track PF + best-day concentration |
| Sortino denominator | Downside deviation vs std of negative returns | AUDIT implementation |

### 2.6 Position Sizing

| Bug | Details | Trading Forge Status |
|-----|---------|---------------------|
| Fractional contracts traded | `floor(0.3) = 0, max(1,0) = 1` — over-risks | Must skip trade when ATR says <1 |
| Stale ATR for sizing | ATR at bar[i] includes bar[i]'s move | Acceptable lag for end-of-bar |
| Default max_contracts=15 hardcoded | Research mode shouldn't have arbitrary cap | Make configurable |
| No margin check | Trade 10 ES on $50K account = impossible | Wave 6.3 |
| Sizing on starting capital vs current equity | After 20K drawdown, still risking on 100K | Non-compounding mitigates this |

### 2.7 Walk-Forward Implementation

| Bug | Details | Trading Forge Status |
|-----|---------|---------------------|
| Data leakage via normalization | Z-scores computed on full dataset | AUDIT walk_forward.py |
| Too-short OOS windows | 60 bars at 15min = 2.3 days = meaningless | Enforce minimum 30 trades in OOS |
| `optimize=False` default | Rolling OOS validation, not WFO | Document the distinction |
| Indicator lookback at split boundary | First 20 bars of OOS have NaN SMA(20) | Exclude from scoring |

---

## Part 3: Monte Carlo Simulation Mistakes

### 3.1 Methodology

| Mistake | Impact | Trading Forge Status |
|---------|--------|---------------------|
| Simple (IID) bootstrap destroys autocorrelation | Underestimates consecutive loss streaks 40-60% | **BUG — `trade_resample()` uses IID** |
| Wrong resampling method for overlapping positions | Shuffling individual trades creates impossible scenarios | Only trade_resample + return_bootstrap |
| Not accounting for regime changes in shuffle | Mixes trending and choppy trade distributions | No regime-stratified shuffle |
| Too few iterations (default 10,000) | 1st percentile unreliable below 100K sims | **BUG — default should be 100K** |
| Single seed (42) for all runs | Not reproducible across parallel workers | Using `default_rng(42)` — OK for single-thread |

### 3.2 Distribution Assumptions

| Mistake | Impact | Trading Forge Status |
|---------|--------|---------------------|
| Assuming normal distribution | Fat tails (kurtosis 10-25x): 4σ events 100x more frequent | Non-parametric resampling is correct |
| Not modeling skewness | Symmetric simulation misses asymmetric tails | Empirical resampling preserves skew |
| Ignoring separate win/loss distributions | Misses heavy-tailed losses | Not separated |
| Ignoring autocorrelation in trade P&Ls | Clusters of losses = deeper drawdowns | **BUG — IID bootstrap** |

### 3.3 Drawdown Simulation

| Mistake | Impact | Trading Forge Status |
|---------|--------|---------------------|
| Max DD 2-4x larger than backtest shows | Backtest $1,664 DD → MC worst $5,195 | Users may not understand this |
| Not tracking drawdown duration | Prop firms have time limits on evaluation | **MISSING** |
| Not simulating per-firm rules | EOD vs realtime trailing = different survival rates | **MISSING** |
| Path dependency with trailing DD | Win-then-lose vs lose-then-win = different DD | **MISSING** |
| Using average DD instead of 1st percentile | Average is useless for risk management | Should report p1, p5 prominently |
| Drawdown clustering (autocorrelated) | IID breaks this, underestimates DD depth | **BUG — IID bootstrap** |

### 3.4 Confidence Interval Mistakes

| Mistake | Impact | Trading Forge Status |
|---------|--------|---------------------|
| 95% CI when prop firm needs 99%+ | 5% failure rate per eval attempt | Report 99th percentile |
| Confusing mean performance CI vs worst-case CI | Different questions, different answers | Must separate them |
| Reporting median instead of tail | Median $800 DD, 1st pct $3,200 — size for $3,200 | Default display should show tail |

### 3.5 Practical Application

| Mistake | Impact | Trading Forge Status |
|---------|--------|---------------------|
| MC on overfitted IS results | 100K overfit equity curves = garbage | Must run on WFO OOS trades only |
| Using MC to validate instead of stress-test | Confirmation bias | Frame as "how bad can it get?" |
| Not simulating evaluation vs funded separately | Different rules, different survival | Must model both phases |
| MC can't simulate unseen regimes | Bounded by worst historical trade | Must inject synthetic stress |
| Not comparing MC to live results | No feedback loop | Track paper vs MC distribution |

### 3.6 Implementation Bugs (Current monte_carlo.py)

| Bug | Line | Details |
|-----|------|---------|
| IID trade resample | 39-65 | `rng.integers(0, len(trades), ...)` — simple shuffle, no block bootstrap |
| IID return bootstrap | 68-92 | Same IID issue for daily returns |
| No block bootstrap option | — | Missing entirely — need stationary bootstrap |
| No stress multiplier | — | Never amplifies losses for stress testing |
| No synthetic bad-day injection | — | Can't produce events beyond historical worst |
| No per-firm rule simulation | — | `_compute_max_drawdowns` uses simple peak-to-trough, not firm-specific trailing DD |
| No drawdown duration tracking | — | Only tracks depth, not time-in-drawdown |
| Default 10K sims insufficient | 250 | `num_simulations=10_000` — need 100K for prop firm |
| ddof=1 inconsistency | 107 | `np.std(daily, axis=1, ddof=1)` — correct here but backtester uses ddof=0 |
| No convergence check | — | No validation that percentiles have stabilized |
| "both" method padding is wrong | 175-188 | Pads shorter path set with last value — creates flat tails |

---

## Part 4: What Monte Carlo Cannot Tell You

1. **Alpha decay** — MC assumes stationarity. Edge erosion over months is invisible.
2. **Market microstructure changes** — Tick sizes, exchange hours, 0DTE options impact.
3. **Liquidity regime shifts** — Your strategy's popularity causes its own fills to move the market.
4. **Black swans beyond historical distribution** — Non-parametric MC bounded by worst historical trade.
5. **Correlation breakdown between strategies** — Independent MC per strategy misses simultaneous failure.
6. **Margin requirement changes** — Exchanges raise margin during crises, forcing liquidation.

---

## Verification Test Checklist (build these)

### Accuracy Tests (must pass before any backtest result is trusted)
- [ ] Trade PnL ↔ equity curve match within $100 (test_accuracy.py CHECK 1)
- [ ] Reversal friction: strategy that reverses every bar shows 2x friction per change
- [ ] Per-bar slippage: replace `np.nanmean` with indexed slippage, verify total differs
- [ ] Float equality: signal with `close == 100.10` fires on `100.10` data
- [ ] Daily data look-ahead: daily SMA used intraday is from previous day
- [ ] Roll gap: raw unadjusted data produces no signal on roll day
- [ ] Timezone: 09:30 ET signal fires at correct UTC timestamp
- [ ] Stop vs signal exit priority: worse price used when both trigger same bar

### Statistical Tests
- [ ] WFO OOS windows have minimum 30 trades before computing stats
- [ ] Sharpe annualization matches timeframe (15min ≠ daily)
- [ ] Win rate reported both per-trade and per-day
- [ ] Long and short metrics reported separately
- [ ] Parameter robustness: neighborhood must be plateau, not spike
- [ ] Minimum 500 trades for any strategy to pass gates

### Monte Carlo Tests
- [ ] Block bootstrap produces deeper max DD than IID (validates autocorrelation)
- [ ] 100K sims: 1st percentile DD stable (±5%) when doubled to 200K
- [ ] Stress test: 1.5x loss multiplier changes survival rate by 10%+
- [ ] Per-firm MC: Tradeify (realtime) shows worse survival than Topstep (EOD)
- [ ] Synthetic bad day: injecting 5x worst-trade changes 5th percentile
- [ ] MC on IS trades vs OOS trades: IS should show unrealistically good results

### Prop Firm Tests
- [ ] Daily loss limit halts trading: day with -$1,200 stops at -$1,000 (Topstep)
- [ ] EOD vs realtime trailing DD: same trades, different results
- [ ] Consistency: best day >50% of total profit → TPT fails
- [ ] Evaluation sim: tracks days to profit target, checks DD before target
- [ ] Scaling plan: starts at 2 contracts, scales after profit milestone
- [ ] Net payout: gross × split - monthly_fee - data_fee - activation_amortized
