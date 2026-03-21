# ICT Scalp — Cross-Validation Report

> Generated: 2026-03-21
> Search queries: "ICT scalp strategy FVG killzone rules fair value gap",
> "ICT scalp entry model FVG fill consequent encroachment killzone entry exit",
> "ICT scalp model displacement FVG order block entry 2024 2025",
> "ICT scalping strategy rules quick FVG fill institutional time Asia London New York",
> "ICT scalping strategy step by step liquidity sweep displacement FVG entry killzone rules detailed"
> Sources span: broker education sites, indicator vendors, community forums, independent ICT educators.

---

## Sources

### 1. Smart Money ICT — [Simple ICT Scalping Strategy: 4 Easy Steps + 3 Examples](https://smartmoneyict.com/ict-scalping-strategy/)
- **Killzones:** London Open, New York Open (highest liquidity windows)
- **Step 1:** Identify market structure (bullish = HH/HL, bearish = LH/LL)
- **Step 2:** Wait for liquidity sweep — price briefly breaks key level to capture retail stops
- **Step 3:** Identify FVG on smaller timeframe (1-min) — imbalance gap from the sweep reaction
- **Step 4:** Enter when price retraces into FVG after sweep, aligned with market structure bias
- **Stop loss:** Just below the sweep level (longs) / above (shorts)
- **Targets:** Next swing high/low structure point; min 1:1 RR, prefer 2:1
- **Timeframes:** 5m for structure, 1m for entry/FVG identification

### 2. Aron Groups — [ICT Scalping Strategy: Fast Intraday Entry Model](https://arongroups.co/technical-analyze/ict-scalping-strategy/)
- **Killzones:** London Open (first 60-180 min), New York Open (first 60-180 min)
- **Execution spine:** Sweep → Displace → Retrace → Enter (non-negotiable sequence)
- **Step A:** Identify external liquidity pools (BSL above session highs, SSL below session lows)
- **Step B:** After sweep, lower-timeframe MSS must occur (break internal swing opposite to sweep)
- **Step C:** Displacement confirmation — strong impulse candle with follow-through required
- **Step D:** FVG forms from displacement leg — enter on retrace into FVG, not on chase
- **Premium/Discount filter:** Bullish scalps in discount (after SSL sweep), bearish scalps in premium (after BSL sweep)
- **Stop loss:** Beyond the sweep extreme or MSS invalidation point
- **Targets:** One-impulse objective — nearest internal swing H/L; optional runner to external liquidity
- **HTF bias alignment:** Prefer trades aligned with higher-timeframe draw
- **Confluence checklist:** Kill Zone + BSL/SSL identified + Sweep + MSS + Displacement + FVG + PD context + HTF alignment — "If 2 boxes are missing, you skip"
- **Timeframes:** HTF 1H/4H for bias, 15m/5m for dealing range, 1m-3m for execution

### 3. TradingFinder — [ICT Scalping Strategy for Short-Term Volatility Trading](https://tradingfinder.com/education/forex/ict-scalping-made-simple/)
- **Entry sequence:** Liquidity collection → Displacement move → MSS → OTE zone entry
- **Liquidity collection:** Price breaks through recent high/low to collect accumulated stops
- **Displacement:** Substantial move after collection that breaks prior structure (MSS)
- **Entry:** OTE zone (Fibonacci 0.62-0.79 of displacement leg) — not just any FVG touch
- **Stop loss:** Above recent highs (shorts) / below recent lows (longs) — beyond the pivot
- **Take profit:** First target at opposite structure level from entry

### 4. FXNX — [ICT Killzones: Guide to Institutional Logic & Entries](https://fxnx.com/en/blog/ict-killzones-trade-like-institution)
- **Kill Zones are mandatory:** "If you scalp outside Kill Zones, you will often get the pattern almost right but the move won't travel"
- **Key windows:** London Open, New York Open, 2 PM NY reversal hour
- **FVG + OB zones only active during Kill Zones** — outside KZ, probability of reaction drops
- **Volume requirement:** True institutional urgency requires London or NY session volume

### 5. TradingView (TehThomas) — [Ultimate Guide to Master ICT Killzones](https://www.tradingview.com/chart/US100/b1vcISfb-Ultimate-Guide-to-Master-ICT-Killzones/)
- **Kill Zone times (ET):** Asia (20:00-00:00), London (02:00-05:00), NY AM (08:00-11:00), NY PM (13:30-16:00)
- **FVG formation during kill zones creates highest-probability setups**
- **Session-based FVGs offer precise entry points with minimal risk exposure**

### 6. B2Prime — [Top 5 ICT Trading Strategies](https://b2prime.com/news/top-5-ict-trading-strategies-for-new-and-pros)
- **Killer Bee scalping strategy:** London or NY session → identify liquidity sweep (equal H/L) → displacement candle opposite direction → enter on retrace to mini FVG or micro OB
- **Fast-paced, high-probability, low-risk setups during volatile sessions**

---

## Consensus Rules (all sources agree)

### Kill Zone Requirement (unanimous)
- Entries ONLY during institutional Kill Zones — London Open and NY Open are primary
- Asia session is lower-probability but valid
- Outside Kill Zones, setups fail far more often ("the move won't travel")

### Setup Sequence (unanimous — 4 of 4 detailed sources)
1. **Identify liquidity pools:** BSL above swing highs (buy stops), SSL below swing lows (sell stops)
2. **Liquidity sweep:** Price briefly breaks a key level, taking out retail stops
3. **Market Structure Shift (MSS):** After sweep, price breaks internal structure in the OPPOSITE direction
4. **Displacement confirmation:** Strong impulse candle(s) confirming the MSS — weak displacement invalidates
5. **FVG formation:** The displacement leg creates an FVG (three-candle imbalance)
6. **Entry on retrace into FVG:** Wait for price to retrace into the FVG — do NOT chase displacement

### Direction Logic (unanimous)
- SSL swept → bullish setup (longs) — price took sell stops, now reverses up
- BSL swept → bearish setup (shorts) — price took buy stops, now reverses down
- Trade AGAINST the sweep direction

### Risk Management (strong consensus)
- **Stop loss:** Beyond the sweep extreme or MSS invalidation point
- **Take profit:** Nearest opposing liquidity level (one-impulse objective)
- **Min RR:** 1:1, prefer 2:1
- **One trade per kill zone window** (avoid overtrading)

### Execution Timeframes (consensus)
- **Bias/structure:** 15m or 5m
- **Entry/FVG:** 1m-5m (lower TF for precision)

---

## Disputed / Variable Points

| Point | Variation | Assessment |
|-------|-----------|------------|
| **Premium/Discount filter** | Aron Groups strongly requires PD alignment; others mention it less. | Recommend: implement as optional filter (improves win rate, adds complexity). For 5m execution TF, omit to keep params ≤ 5. |
| **OTE zone vs full FVG** | TradingFinder says enter at 0.62-0.79 Fib of displacement; others say anywhere in FVG. | Recommend: enter on first touch of FVG (simpler, more consistent with FVG fill logic). |
| **HTF bias alignment** | Aron Groups requires it; Smart Money ICT mentions it; others don't enforce. | Recommend: not implemented in code (would need multi-TF data); note in spec as enhancement. |
| **Asia killzone validity** | Most sources focus on London/NY; TradingView includes Asia. | Recommend: include Asia but note lower probability. Keep all 3 KZs. |
| **Displacement threshold** | Some say "strong candle," others give no measurable threshold. | Recommend: use detect_displacement with ATR multiplier (already available). |
| **MSS vs just displacement** | Smart Money ICT simplifies to "sweep + FVG"; Aron Groups requires full MSS. | Recommend: require MSS (structural break) — this is the higher-quality filter. |

---

## Final Definition (used for YAML spec)

```yaml
strategy:
  name: ICT Scalp
  creator: Michael J. Huddleston (Inner Circle Trader)
  type: intraday_scalp
  markets: [futures, forex, indices]

kill_zones:  # All times in ET (America/New_York)
  asia:
    start: "20:00"
    end: "00:00"
    priority: 3  # lowest probability
  london:
    start: "02:00"
    end: "05:00"
    priority: 2
  ny_am:
    start: "08:00"
    end: "11:00"
    priority: 1  # highest probability

setup_sequence:
  1_identify_liquidity:
    description: "Find BSL (above recent swing highs) and SSL (below recent swing lows)"
  2_liquidity_sweep:
    description: "Price briefly breaks BSL or SSL, taking out retail stops"
    ssl_swept: bullish  # look for longs
    bsl_swept: bearish  # look for shorts
  3_mss:
    required: true
    description: "Market Structure Shift — price breaks internal swing opposite to sweep"
  4_displacement:
    required: true
    description: "Strong impulse candle(s) confirming MSS; weak displacement = invalid"
  5_fvg_formation:
    description: "Displacement leg creates a Fair Value Gap"
    selection: first_fvg_after_mss
  6_entry:
    type: limit_on_retrace
    placement: "Enter when price retraces into the FVG zone"

execution_timeframes:
  bias_structure: [15m, 5m]
  entry: [1m, 5m]

risk_management:
  stop_loss: "Beyond sweep extreme or MSS invalidation"
  take_profit: "Nearest opposing swing high/low (one-impulse target)"
  min_reward_risk: 1.5
  max_hold: "12 bars (time stop for failed setups)"

validation_checklist:
  - "Is current bar inside a Kill Zone (Asia, London, or NY AM)?"
  - "Has a liquidity level (BSL or SSL) been swept?"
  - "Did an MSS occur after the sweep (structural break opposite to sweep)?"
  - "Was there displacement (strong candle) confirming the MSS?"
  - "Has an FVG formed from the displacement move?"
  - "Is this the first FVG after the MSS?"
  - "Did price retrace into the FVG zone for entry?"
```

---

## Sources

1. [Simple ICT Scalping Strategy: 4 Easy Steps + 3 Examples — Smart Money ICT](https://smartmoneyict.com/ict-scalping-strategy/)
2. [ICT Scalping Strategy: Fast Intraday Entry Model — Aron Groups](https://arongroups.co/technical-analyze/ict-scalping-strategy/)
3. [ICT Scalping Strategy for Short-Term Volatility Trading — TradingFinder](https://tradingfinder.com/education/forex/ict-scalping-made-simple/)
4. [ICT Killzones: Guide to Institutional Logic & Entries — FXNX](https://fxnx.com/en/blog/ict-killzones-trade-like-institution)
5. [Ultimate Guide to Master ICT Killzones — TradingView (TehThomas)](https://www.tradingview.com/chart/US100/b1vcISfb-Ultimate-Guide-to-Master-ICT-Killzones/)
6. [Top 5 ICT Trading Strategies — B2Prime](https://b2prime.com/news/top-5-ict-trading-strategies-for-new-and-pros)
