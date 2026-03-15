# Trading Forge — ICT / SMT Strategy & Indicator Roadmap

> **Status:** Planned
> **Target:** Phase 3.5 — Indicators & Strategy Library
> **Last Updated:** 2026-03-14

All concepts below will be implemented as codeable indicators and full trade models
inside `src/engine/indicators/` and `src/engine/strategies/`. Every single one will be
backtested, Monte Carlo'd, and run through the performance gate before reaching paper trading.

---

## 1. Market Structure Indicators

| # | Indicator | File | Description |
|---|-----------|------|-------------|
| 1 | Break of Structure (BOS) | `indicators/market_structure.py` | Detect when price breaks a previous swing high/low in trend direction |
| 2 | Change of Character (CHoCH) | `indicators/market_structure.py` | Detect first break of structure against the trend — potential reversal |
| 3 | Market Structure Shift (MSS) | `indicators/market_structure.py` | CHoCH confirmed with displacement — high-probability reversal |
| 4 | Swing High / Swing Low Detection | `indicators/market_structure.py` | Identify valid swing points using N-bar lookback |
| 5 | Premium / Discount Zones | `indicators/market_structure.py` | Divide dealing range into premium (above EQ) and discount (below EQ) |
| 6 | Equilibrium (EQ) | `indicators/market_structure.py` | 50% level of the current dealing range |

---

## 2. Price Delivery / Imbalance Indicators

| # | Indicator | File | Description |
|---|-----------|------|-------------|
| 7 | Fair Value Gap (FVG) | `indicators/price_delivery.py` | 3-candle imbalance — gap between candle 1 high and candle 3 low (bullish) or inverse |
| 8 | Inverse Fair Value Gap (IFVG) | `indicators/price_delivery.py` | FVG that has been traded through and now acts as support/resistance |
| 9 | Consequent Encroachment (CE) | `indicators/price_delivery.py` | 50% midpoint of an FVG — precision entry/target level |
| 10 | Volume Imbalance (VI) | `indicators/price_delivery.py` | Gap between consecutive candle bodies (no wick overlap) |
| 11 | Opening Gap | `indicators/price_delivery.py` | Gap between previous session close and current session open |
| 12 | Liquidity Void | `indicators/price_delivery.py` | Large single-candle displacement with no overlap — price will return to fill |

---

## 3. Order Flow / Institutional Footprint Indicators

| # | Indicator | File | Description |
|---|-----------|------|-------------|
| 13 | Bullish Order Block (OB) | `indicators/order_flow.py` | Last bearish candle before a bullish displacement — institutional buy zone |
| 14 | Bearish Order Block (OB) | `indicators/order_flow.py` | Last bullish candle before a bearish displacement — institutional sell zone |
| 15 | Breaker Block | `indicators/order_flow.py` | Failed order block that flips polarity — former support becomes resistance and vice versa |
| 16 | Mitigation Block | `indicators/order_flow.py` | OB from a previous move that price returns to "mitigate" unfilled orders |
| 17 | Rejection Block | `indicators/order_flow.py` | Candle with long wick showing institutional rejection of a level |
| 18 | Propulsion Block | `indicators/order_flow.py` | FVG nested inside an order block — extra confluence for strong moves |

---

## 4. Liquidity Indicators

| # | Indicator | File | Description |
|---|-----------|------|-------------|
| 19 | Buy-Side Liquidity (BSL) | `indicators/liquidity.py` | Clusters of stop losses above swing highs — targets for smart money |
| 20 | Sell-Side Liquidity (SSL) | `indicators/liquidity.py` | Clusters of stop losses below swing lows — targets for smart money |
| 21 | Equal Highs (EQH) | `indicators/liquidity.py` | Two or more swing highs at same level — liquidity pool above |
| 22 | Equal Lows (EQL) | `indicators/liquidity.py` | Two or more swing lows at same level — liquidity pool below |
| 23 | Liquidity Sweep | `indicators/liquidity.py` | Price takes out a liquidity level then reverses — stop hunt detected |
| 24 | Inducement | `indicators/liquidity.py` | Minor liquidity pool designed to trap retail traders before the real move |
| 25 | Raid | `indicators/liquidity.py` | Aggressive sweep of multiple liquidity levels in one move |

---

## 5. Fibonacci / OTE Indicators

| # | Indicator | File | Description |
|---|-----------|------|-------------|
| 26 | Standard Fib Retracement | `indicators/fibonacci.py` | Levels: 0.236, 0.382, 0.5, 0.618, 0.705, 0.786 |
| 27 | Optimal Trade Entry (OTE) | `indicators/fibonacci.py` | The 0.618–0.786 fib zone — highest probability retracement entry |
| 28 | Fib Extensions | `indicators/fibonacci.py` | Targets: -0.272, -0.618, -1.0, -1.272, -1.618 |
| 29 | Auto Swing Fib | `indicators/fibonacci.py` | Automatically plot fibs from detected swing high to swing low |

---

## 6. Time-Based / Session Indicators

| # | Indicator | File | Description |
|---|-----------|------|-------------|
| 30 | Asia Killzone | `indicators/sessions.py` | 8:00 PM – 12:00 AM ET — range formation |
| 31 | London Killzone | `indicators/sessions.py` | 2:00 AM – 5:00 AM ET — first real move |
| 32 | New York AM Killzone | `indicators/sessions.py` | 9:30 AM – 12:00 PM ET — highest volume |
| 33 | New York Lunch | `indicators/sessions.py` | 12:00 PM – 1:30 PM ET — chop / reversal zone |
| 34 | New York PM Killzone | `indicators/sessions.py` | 1:30 PM – 4:00 PM ET — continuation or reversal |
| 35 | Macro Times | `indicators/sessions.py` | xx:50 – xx:10 windows — micro displacement windows |
| 36 | Day of Week Profile | `indicators/sessions.py` | Tuesday/Wednesday tend to set weekly high/low |
| 37 | Quarterly Theory | `indicators/sessions.py` | Divide any time range into Q1–Q4 (accumulation, manipulation, distribution, continuation) |
| 38 | True Day Open | `indicators/sessions.py` | 6:00 PM ET previous day — the real institutional open |
| 39 | Midnight Open | `indicators/sessions.py` | 12:00 AM ET — key reference level for NY session |

---

## 7. SMT Divergence Indicators

| # | Indicator | File | Description |
|---|-----------|------|-------------|
| 40 | ES vs NQ SMT | `indicators/smt.py` | ES makes new high/low but NQ doesn't — divergence signals reversal |
| 41 | DXY vs EUR/USD SMT | `indicators/smt.py` | Dollar index vs Euro inverse correlation divergence |
| 42 | GC vs DXY SMT | `indicators/smt.py` | Gold vs Dollar inverse divergence |
| 43 | YM vs ES SMT | `indicators/smt.py` | Dow vs S&P divergence |
| 44 | NQ vs ES SMT | `indicators/smt.py` | Nasdaq vs S&P divergence (tech rotation signal) |
| 45 | Indices vs Bonds SMT | `indicators/smt.py` | Equity indices vs bond futures divergence |
| 46 | Custom Pair SMT | `indicators/smt.py` | User-defined correlated pair divergence detector |

---

## 8. Complete ICT Trade Models (Strategies)

Each strategy combines multiple indicators above into a full entry→stop→target system.

| # | Strategy | File | Description |
|---|----------|------|-------------|
| 47 | Silver Bullet | `strategies/silver_bullet.py` | FVG entry inside specific time windows (10–11 AM, 2–3 PM, 3–4 AM ET). Wait for displacement + FVG inside killzone. |
| 48 | Unicorn Model | `strategies/unicorn.py` | Breaker Block + FVG overlap zone. Enter when price returns to the overlap — highest confluence setup. |
| 49 | 2022 ICT Mentorship Model | `strategies/ict_2022.py` | HTF PD array → LTF Market Structure Shift → FVG entry. Multi-timeframe top-down analysis. |
| 50 | Power of 3 (AMD) | `strategies/power_of_3.py` | Accumulation (Asia) → Manipulation (London Judas Swing) → Distribution (NY real move). Trade the distribution phase. |
| 51 | Turtle Soup | `strategies/turtle_soup.py` | Liquidity sweep of old high/low → immediate reversal with displacement → enter on FVG left behind. |
| 52 | Optimal Trade Entry (OTE) | `strategies/ote_strategy.py` | Wait for BOS on HTF → retrace into 0.618–0.786 fib zone → enter on LTF FVG inside OTE zone. |
| 53 | Breaker Model | `strategies/breaker.py` | Failed OB becomes Breaker Block → enter on return to breaker + FVG confluence. Fade the failed move. |
| 54 | London Raid | `strategies/london_raid.py` | London session takes out Asia high or low (liquidity grab) → reversal into NY session direction. |
| 55 | Judas Swing Setup | `strategies/judas_swing.py` | Fake move at session open → MSS + FVG in opposite direction = entry. Classic manipulation trade. |
| 56 | NY Lunch Reversal | `strategies/ny_lunch_reversal.py` | 12:00–1:30 PM ET consolidation → reversal setup into PM session. Afternoon continuation trade. |
| 57 | IOFED | `strategies/iofed.py` | Institutional Order Flow Entry Drill: Displacement → FVG → OB → entry on return to FVG/OB overlap. |
| 58 | ICT Swing Trade Model | `strategies/ict_swing.py` | Weekly/Daily bias from HTF OB or FVG → enter on 1H/4H pullback into discount/premium → hold for days. |
| 59 | ICT Scalping Model | `strategies/ict_scalp.py` | 1m/5m charts inside killzone → MSS → FVG → target next liquidity pool. Quick in-and-out. |
| 60 | SMT Divergence Reversal | `strategies/smt_reversal.py` | Detect SMT divergence between correlated pairs → confirm with LTF MSS + FVG → fade the divergent instrument. |
| 61 | Propulsion Block Continuation | `strategies/propulsion.py` | FVG inside OB (propulsion block) → enter on return for continuation trade with high R:R. |
| 62 | Mitigation Entry | `strategies/mitigation.py` | Price returns to unfilled OB from previous swing → enter on mitigation with FVG confirmation. |
| 63 | Quarterly Theory Swing | `strategies/quarterly_swing.py` | Identify Q1 accumulation → Q2 manipulation → enter for Q3 distribution. Works on weekly/daily/session timeframes. |
| 64 | Equal Highs/Lows Raid | `strategies/eqhl_raid.py` | Identify EQH/EQL clusters → wait for sweep → enter on reversal with FVG + OB confluence. |
| 65 | Midnight Open Reversion | `strategies/midnight_open.py` | Use midnight open as magnet level → trade deviations from midnight open back toward it during NY AM. |

---

## 9. Standard Technical Indicators (Supporting)

| # | Indicator | File | Description |
|---|-----------|------|-------------|
| 66 | SMA | `indicators/core.py` | Simple Moving Average |
| 67 | EMA | `indicators/core.py` | Exponential Moving Average |
| 68 | RSI | `indicators/core.py` | Relative Strength Index |
| 69 | MACD | `indicators/core.py` | Moving Average Convergence Divergence |
| 70 | ATR | `indicators/core.py` | Average True Range — used for stops and position sizing |
| 71 | Bollinger Bands | `indicators/core.py` | Mean reversion bands |
| 72 | VWAP | `indicators/core.py` | Volume Weighted Average Price — institutional fair value |
| 73 | ADR | `indicators/core.py` | Average Daily Range — session range expectations |

---

## Implementation Priority

### Wave 1 — Core ICT Building Blocks
- [ ] `indicators/market_structure.py` — BOS, CHoCH, MSS, Swing Points, Premium/Discount
- [ ] `indicators/price_delivery.py` — FVG, IFVG, CE, Volume Imbalance, Liquidity Void
- [ ] `indicators/order_flow.py` — Order Blocks, Breaker, Mitigation, Rejection, Propulsion
- [ ] `indicators/liquidity.py` — BSL, SSL, EQH, EQL, Sweeps, Inducement
- [ ] `indicators/fibonacci.py` — Fib Retracement, OTE Zone, Extensions
- [ ] `indicators/sessions.py` — Killzones, Macros, Day of Week, Quarterly Theory
- [ ] `indicators/core.py` — SMA, EMA, RSI, MACD, ATR, BB, VWAP, ADR

### Wave 2 — SMT Divergence
- [ ] `indicators/smt.py` — All correlated pair divergence detectors

### Wave 3 — Full Strategy Models
- [ ] All 19 strategies in `strategies/` directory
- [ ] Each strategy gets: backtest config, Monte Carlo validation, prop compliance gate
- [ ] Walk-forward out-of-sample testing for every model

### Wave 4 — Optimization & Ranking
- [ ] Optuna Bayesian parameter search per strategy
- [ ] Forge Score ranking across all strategies
- [ ] Multi-strategy portfolio construction
- [ ] Correlation analysis between strategies (avoid overlap)

---

## Testing Requirements

Every indicator and strategy MUST pass:

1. **Unit tests** — Correct detection on known price patterns
2. **Backtest** — Minimum 2 years of 1-minute data per symbol
3. **Monte Carlo** — 10,000 simulations, P5 max drawdown < account limit
4. **Prop compliance** — Meet TIER_3 minimum: $250/day, 60% win days, 1.75 profit factor
5. **Walk-forward** — Out-of-sample validation (70/30 split minimum)
6. **Multi-symbol** — Test on ES, NQ, CL, YM, GC minimum

---

## File Structure

```
src/engine/
├── indicators/
│   ├── __init__.py
│   ├── core.py              # Standard TA (SMA, EMA, RSI, MACD, ATR, BB, VWAP, ADR)
│   ├── market_structure.py  # BOS, CHoCH, MSS, Swings, Premium/Discount
│   ├── price_delivery.py    # FVG, IFVG, CE, Volume Imbalance, Liquidity Void
│   ├── order_flow.py        # Order Blocks, Breaker, Mitigation, Rejection, Propulsion
│   ├── liquidity.py         # BSL, SSL, EQH, EQL, Sweeps, Inducement, Raids
│   ├── fibonacci.py         # Retracement, OTE, Extensions, Auto Swing Fib
│   ├── sessions.py          # Killzones, Macros, Day of Week, Quarterly Theory, Opens
│   └── smt.py               # SMT Divergence (ES/NQ, DXY/EUR, GC/DXY, custom pairs)
├── strategies/
│   ├── __init__.py
│   ├── silver_bullet.py
│   ├── unicorn.py
│   ├── ict_2022.py
│   ├── power_of_3.py
│   ├── turtle_soup.py
│   ├── ote_strategy.py
│   ├── breaker.py
│   ├── london_raid.py
│   ├── judas_swing.py
│   ├── ny_lunch_reversal.py
│   ├── iofed.py
│   ├── ict_swing.py
│   ├── ict_scalp.py
│   ├── smt_reversal.py
│   ├── propulsion.py
│   ├── mitigation.py
│   ├── quarterly_swing.py
│   ├── eqhl_raid.py
│   └── midnight_open.py
├── tests/
│   ├── test_market_structure.py
│   ├── test_price_delivery.py
│   ├── test_order_flow.py
│   ├── test_liquidity.py
│   ├── test_fibonacci.py
│   ├── test_sessions.py
│   ├── test_smt.py
│   └── test_strategies.py
├── monte_carlo.py
├── backtester.py
├── performance_gate.py
├── prop_compliance.py
└── requirements.txt
```

---

## Total Count

| Category | Count |
|----------|-------|
| Market Structure Indicators | 6 |
| Price Delivery Indicators | 6 |
| Order Flow Indicators | 6 |
| Liquidity Indicators | 7 |
| Fibonacci Indicators | 4 |
| Session/Time Indicators | 10 |
| SMT Divergence Indicators | 7 |
| Standard TA Indicators | 8 |
| **Total Indicators** | **54** |
| Full Trade Models (Strategies) | 19 |
| **Grand Total** | **73 indicators + strategies** |
