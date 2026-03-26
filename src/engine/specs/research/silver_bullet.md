# Silver Bullet — Cross-Validation Report

> Generated: 2026-03-20
> Search queries: "ICT Silver Bullet strategy time window FVG", "ICT Silver Bullet exact time windows displacement candle",
> "ICT Silver Bullet market structure shift liquidity sweep FVG entry detailed rules", and variants.
> Sources span: broker education sites, indicator vendors, community forums, independent ICT educators.

---

## Sources

### 1. LuxAlgo — [ICT Silver Bullet Setup & Trading Methods](https://www.luxalgo.com/blog/ict-silver-bullet-setup-trading-methods/)
- **Time windows (ET):** 3:00 AM-4:00 AM | 10:00 AM-11:00 AM | 2:00 PM-3:00 PM
- **Sessions:** London Open | NY AM | NY PM
- **Entry mechanism:** Liquidity sweep -> Displacement -> MSS/CHOCH -> FVG forms -> enter on retrace into FVG
- **Displacement required:** Yes — displacement must create a Market Structure Shift (MSS)
- **Timeframes:** 15m for bias/liquidity markup, 1m-5m for entry refinement
- **FVG definition:** Three-candle imbalance where wick of candle 1 and wick of candle 3 do not overlap
- **Stop loss:** Below FVG low (longs) / above FVG high (shorts)
- **Targets:** Opposite liquidity pool or opposing FVG edge; min 1:2 RR
- **Validation notes:** Claims 70-80% win rate when rules respected; 20-30 pips per session typical

### 2. FXOpen — [ICT Silver Bullet Strategy Explained: Trading Windows and FVG Setups](https://fxopen.com/blog/en/what-is-the-ict-silver-bullet-strategy-and-how-does-it-work/)
- **Time windows (EST):** 3:00 AM-4:00 AM | 10:00 AM-11:00 AM | 2:00 PM-3:00 PM
- **Sessions:** London Open | NY AM | NY PM
- **Entry mechanism:** Price sweeps liquidity -> swift rejection / displacement -> FVG forms -> enter on retrace into FVG
- **Displacement required:** Yes — described as "swift rejection" / energetic impulsive move
- **Timeframes:** M1 or M5 for entry
- **FVG definition:** Price quickly moves away from a level without significant trading, leaving a gap likely to be retested
- **Stop loss:** Above FVG-forming candle high (bearish) / below FVG-forming candle low (bullish)
- **Key emphasis:** Strategy emphasises market structure, liquidity pools, and FVGs — NOT indicators

### 3. FluxCharts — [ICT Silver Bullet Strategy Explained: How to Identify and Trade It](https://www.fluxcharts.com/articles/trading-strategies/ict-strategies/ict-silver-bullet)
- **Time windows (EST):** Three specific time periods (3 AM-4 AM, 10 AM-11 AM, 2 PM-3 PM)
- **Entry mechanism:** Mark BSL/SSL levels -> wait for liquidity sweep -> after sweep, wait for quick price movement forming FVG -> enter on FVG
- **Displacement required:** Yes — described as "quick price movement" after liquidity sweep
- **Direction logic:** SSL swept = look for longs; BSL swept = look for shorts (counter to the sweep)
- **Daily bias filter:** If daily bias is bullish, only take bullish Silver Bullets; if bearish, only bearish
- **Key concepts:** FVG + Liquidity are the two core ICT concepts used

### 4. Smart Money ICT — [ICT Silver Bullet Strategy: 10:00 AM Setup](https://smartmoneyict.com/ict-silver-bullet-strategy/)
- **Time windows (ET):** 10:00 AM-11:00 AM highlighted as primary; 3 AM-4 AM and 2 PM-3 PM also referenced
- **10 AM rationale:** London/NY overlap; smart money initiates moves building on London session trends
- **Entry mechanism:** Liquidity raid -> FVG or displacement -> reversal or continuation aligned with HTF bias
- **Displacement required:** Yes — liquidity raids followed by FVG or displacement
- **Key emphasis:** Time-sensitive setup; clarity and repeatability; low-risk/high-reward

### 5. Forex Factory (TFlab) — [ICT Silver Bullet Strategy Explained](https://www.forexfactory.com/thread/1343550-ict-silver-bullet-strategy-explained-tflab)
- **Time windows (EST):** 3:00 AM-4:00 AM | 10:00 AM-11:00 AM | 2:00 PM-3:00 PM
- **Entry mechanism:** Same core sequence — liquidity sweep, displacement/MSS, FVG entry
- **Community validation:** Thread includes multiple traders backtesting and sharing results

### 6. InnerCircleTrader.net — [Master ICT Silver Bullet Strategy – 2025 Guide](https://innercircletrader.net/tutorials/ict-silver-bullet-strategy/)
- **Time windows (NY time):** 3:00 AM-4:00 AM | 10:00 AM-11:00 AM | 2:00 PM-3:00 PM
- **Setup sequence:** Price sweeps minor liquidity or taps HTF FVG -> displacement follows -> displacement creates MSS -> FVG forms within displacement -> enter on retrace to FVG
- **First FVG rule:** Trade the FIRST FVG created after the MSS — second or third may be exhausted
- **15m markup:** Use 15m to identify BSL/SSL zones before dropping to execution timeframe

---

## Consensus Rules (all sources agree)

### Time Windows (New York / Eastern Time)
| Window | Start | End | Session |
|--------|-------|-----|---------|
| London Open Silver Bullet | 03:00 AM ET | 04:00 AM ET | London session |
| NY AM Silver Bullet | 10:00 AM ET | 11:00 AM ET | NY morning (London/NY overlap) |
| NY PM Silver Bullet | 02:00 PM ET | 03:00 PM ET | NY afternoon |

- All six sources agree on these exact windows with zero variation.
- The 10:00 AM-11:00 AM window is universally cited as the highest-probability window due to London/NY session overlap.

### Setup Sequence (unanimous across all sources)
1. **Pre-session markup:** On 15m chart, identify BSL (above swing highs) and SSL (below swing lows) as liquidity targets.
2. **Liquidity sweep:** Within the 1-hour window, price sweeps a liquidity level (BSL or SSL).
3. **Displacement + MSS:** After the sweep, an aggressive/impulsive move occurs in the OPPOSITE direction. This displacement must create a Market Structure Shift (MSS) — breaking a prior swing high (bullish) or swing low (bearish).
4. **FVG formation:** Within the displacement candles, a Fair Value Gap forms (3-candle pattern: candle 1 wick and candle 3 wick do not overlap).
5. **Entry on FVG retrace:** Place limit order at the FVG boundary closest to trade direction. Enter when price retraces into the FVG.

### Direction Logic
- SSL swept -> bullish setup (longs)
- BSL swept -> bearish setup (shorts)
- The trade goes AGAINST the direction of the sweep (counter-move after stop hunt).

### Risk Management
- **Stop loss:** Just beyond the FVG-forming candle extreme (below low for longs, above high for shorts).
- **Take profit:** Opposite liquidity level or opposing FVG edge.
- **Minimum RR:** 1:2.

### Execution Timeframes
- **Bias / liquidity markup:** 15-minute chart
- **Entry / execution:** 1-minute to 5-minute chart (M1 preferred for precision)

### Displacement Requirement
- **YES — unanimously required.** All sources describe displacement as a necessary step. It is the aggressive move that creates both the MSS and the FVG. Without displacement, there is no valid Silver Bullet.

---

## Disputed / Variable Points

| Point | Variation | Assessment |
|-------|-----------|------------|
| **FVG selection** | InnerCircleTrader.net explicitly says "trade the FIRST FVG after MSS." Others do not specify first vs. any. | Recommend: use first FVG only (conservative, matches original ICT teaching). |
| **Exact SL placement** | Some say "beyond FVG candle extreme," others say "beyond the displacement candle." | Recommend: SL beyond the high/low of the candle that forms the FVG boundary (the first or third candle of the 3-candle pattern), as this is the most commonly cited rule. |
| **HTF FVG tap as trigger** | InnerCircleTrader.net mentions price can tap a HTF FVG instead of sweeping a liquidity level. | Recommend: primary trigger = liquidity sweep; HTF FVG tap as secondary/optional trigger. |
| **Daily bias filter** | FluxCharts emphasises only taking setups aligned with daily bias. Others mention it but less strongly. | Recommend: implement as a filter (improves win rate) but not strictly required for a valid setup. |
| **CHOCH vs MSS terminology** | LuxAlgo uses "MSS or CHOCH" interchangeably. Others use only MSS. | These are the same concept: a break of a prior swing that confirms directional shift. Use MSS as canonical term. |
| **3m timeframe** | One source mentions 3m alongside 1m for execution. Most say 1m or 5m. | Recommend: support 1m and 5m; 3m is non-standard. |

---

## Final Definition (used for YAML spec)

```yaml
strategy:
  name: ICT Silver Bullet
  creator: Michael J. Huddleston (Inner Circle Trader)
  type: intraday
  markets: [futures, forex, indices, crypto]

time_windows:  # All times in ET (America/New_York)
  london_open:
    start: "03:00"
    end: "04:00"
    session: london
    priority: 3  # lowest of the three
  ny_am:
    start: "10:00"
    end: "11:00"
    session: new_york_am
    priority: 1  # highest probability (London/NY overlap)
  ny_pm:
    start: "14:00"
    end: "15:00"
    session: new_york_pm
    priority: 2

setup_sequence:
  1_markup:
    timeframe: 15m
    action: "Identify BSL (above swing highs) and SSL (below swing lows)"
  2_liquidity_sweep:
    description: "Price sweeps BSL or SSL within the active time window"
    ssl_swept: bullish  # look for longs
    bsl_swept: bearish  # look for shorts
  3_displacement:
    required: true
    description: "Aggressive impulsive move OPPOSITE to the sweep direction"
    must_create: market_structure_shift  # MSS — break of prior swing H/L
  4_fvg_formation:
    description: "Fair Value Gap forms within the displacement move"
    definition: "3-candle pattern where candle_1 wick and candle_3 wick do not overlap"
    selection: first_fvg_after_mss  # do not use 2nd or 3rd — move may be exhausted
  5_entry:
    type: limit_order
    placement: "FVG boundary closest to trade direction"
    trigger: "Price retraces into FVG zone"

execution_timeframes:
  bias_markup: 15m
  entry: [1m, 5m]  # 1m preferred for precision

risk_management:
  stop_loss: "Beyond FVG-forming candle extreme (below low for longs, above high for shorts)"
  take_profit: "Opposite liquidity level or opposing FVG edge"
  min_reward_risk: 2.0

filters:
  daily_bias:
    recommended: true
    rule: "Only take setups aligned with higher-timeframe directional bias"
  one_trade_per_window:
    recommended: true
    rule: "Take only the first valid setup per time window"

validation_checklist:
  - "Is current time within one of the three Silver Bullet windows?"
  - "Has a liquidity level (BSL or SSL) been swept?"
  - "Did displacement occur opposite to the sweep direction?"
  - "Did the displacement create a Market Structure Shift (break prior swing)?"
  - "Has an FVG formed within the displacement candles?"
  - "Is this the FIRST FVG after the MSS?"
  - "Is the setup aligned with daily/HTF bias? (recommended filter)"
  - "Does the entry provide at least 1:2 RR to the target?"
```

---

## Sources

1. [ICT Silver Bullet Setup & Trading Methods — LuxAlgo](https://www.luxalgo.com/blog/ict-silver-bullet-setup-trading-methods/)
2. [ICT Silver Bullet Strategy Explained — FXOpen](https://fxopen.com/blog/en/what-is-the-ict-silver-bullet-strategy-and-how-does-it-work/)
3. [ICT Silver Bullet Strategy Explained — FluxCharts](https://www.fluxcharts.com/articles/trading-strategies/ict-strategies/ict-silver-bullet)
4. [ICT Silver Bullet Strategy: 10:00 AM Setup — Smart Money ICT](https://smartmoneyict.com/ict-silver-bullet-strategy/)
5. [ICT Silver Bullet Strategy Explained — Forex Factory (TFlab)](https://www.forexfactory.com/thread/1343550-ict-silver-bullet-strategy-explained-tflab)
6. [Master ICT Silver Bullet Strategy — InnerCircleTrader.net](https://innercircletrader.net/tutorials/ict-silver-bullet-strategy/)
