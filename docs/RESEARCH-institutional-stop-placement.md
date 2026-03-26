# Institutional Stop Loss Placement in Futures Markets
## Deep Research — Smart Money Stop Management

**Research Date:** 2026-03-17
**Scope:** How institutional traders, banks, prop desks, and smart money place and manage stop losses in futures markets (ES, NQ, 6E, etc.)

---

## Table of Contents

1. [Core Principle: Structural Stops vs. Arbitrary Stops](#1-core-principle-structural-stops-vs-arbitrary-stops)
2. [Where Institutions Place Stops](#2-where-institutions-place-stops)
3. [Stop Placement Relative to Order Blocks](#3-stop-placement-relative-to-order-blocks)
4. [Stop Placement Relative to FVGs](#4-stop-placement-relative-to-fvgs)
5. [Stop Placement After Liquidity Sweeps](#5-stop-placement-after-liquidity-sweeps)
6. [ICT Turtle Soup Stop Rules](#6-ict-turtle-soup-stop-rules)
7. [Why ATR-Only Stops Get Hunted](#7-why-atr-only-stops-get-hunted)
8. [Session Timing and Stop Management](#8-session-timing-and-stop-management)
9. [Order Flow Signals: Stop Hunt vs. Real Breakout](#9-order-flow-signals-stop-hunt-vs-real-breakout)
10. [Professional Trail and Partial Exit Management](#10-professional-trail-and-partial-exit-management)
11. [Codifiable Rules for Stop Loss Engine](#11-codifiable-rules-for-stop-loss-engine)

---

## 1. Core Principle: Structural Stops vs. Arbitrary Stops

### The Fundamental Problem
Retail traders place stops at:
- Round numbers (4500.00, 20000.00)
- Fixed ATR multiples (2x ATR, 3x ATR) — predictable because everyone uses the same multipliers
- Just below "obvious" support / just above "obvious" resistance
- Fixed dollar amounts ($500 risk = 40 ticks on ES regardless of structure)

**These are ARBITRARY stops.** They have no relationship to the actual market structure that would invalidate the trade thesis.

### The Institutional Approach
Smart money places stops at **structural invalidation points** — the specific price level where the trade thesis is objectively wrong. This means:
- Behind the structure that created the entry signal
- Beyond the wick of the candle that swept liquidity (the stop-hunt candle)
- Below/above the order block that generated the trade
- Outside the FVG that price is expected to respect

**Key Insight:** Institutions embed stop parameters into execution algorithms that adjust dynamically to volatility, liquidity, and position exposure — not static pip/tick distances.

---

## 2. Where Institutions Place Stops

### Rule: Stops Go BEHIND Structural Invalidation, Not AT Obvious Levels

**Retail (hunted):**
```
Long entry → Stop at the obvious swing low everyone can see
```

**Institutional (survives):**
```
Long entry → Stop behind the ORDER BLOCK that created the move
             OR behind the WICK of the liquidity sweep candle
             OR outside the FVG that should hold if thesis is valid
```

### Specific Placement Hierarchy (strongest to weakest)

1. **Behind the sweep candle wick** — If you enter after a liquidity sweep, your stop goes a few ticks beyond the absolute tip of the sweep wick. If price exceeds that wick, the institutional premise is fully invalidated.

2. **Below/above the order block** — For bullish OB entries, stop below the OB low + buffer. For bearish OB entries, stop above the OB high + buffer.

3. **Outside the FVG boundary** — For longs entering at a bullish FVG, stop below the bottom of the gap. For shorts, stop above the top of the gap.

4. **Beyond the swing point + buffer** — NOT at the swing point (that is where retail stops sit), but BEYOND it by enough to survive a sweep.

### Buffer Distances (from research)

| Context | Buffer Beyond Structure |
|---------|------------------------|
| Forex (6E, 6B) | 5–10 pips beyond OB/FVG/swing |
| Forex after sweep | 10–15 pips beyond sweep wick tip |
| ES futures | 2–4 points beyond structure (~8-16 ticks) |
| NQ futures | 5–10 points beyond structure (~20-40 ticks) |

**Critical:** These buffers are NOT fixed — they should scale with current ATR. The buffer exists to survive micro-sweeps and noise, not to replace structural placement.

---

## 3. Stop Placement Relative to Order Blocks

### Bullish Order Block (Long Trade)
```
ENTRY: At or near the top of the bullish OB (or on retest)
STOP:  Below the LOW of the order block candle + buffer

Example (GBP/USD / 6B):
  Bullish OB range: 1.3050 – 1.3070
  Entry: 1.3080 (above OB)
  Stop:  1.3045 (5 pips below OB low at 1.3050)

  Invalidation logic: If price breaks below the OB that
  created the bullish impulse, the bullish thesis is dead.
```

### Bearish Order Block (Short Trade)
```
ENTRY: At or near the bottom of the bearish OB (or on retest)
STOP:  Above the HIGH of the order block candle + buffer

Example:
  Bearish OB range: 1.3200 – 1.3220
  Entry: 1.3195 (below OB)
  Stop:  1.3225 (5 pips above OB high at 1.3220)
```

### Propulsion Block Variant
```
BULLISH: Stop below the low of propulsion block candle 2
BEARISH: Stop above the high of propulsion block candle 2
```

### Breaker Block Variant
```
Stop goes behind the WICK of the liquidity sweep candle
that created the breaker, NOT behind the breaker body.
This is the most conservative (widest) stop placement.
```

### Codifiable Rule:
```
stop_price_long  = order_block.low  - buffer_ticks
stop_price_short = order_block.high + buffer_ticks

where buffer_ticks = max(
    instrument_min_buffer,       // e.g., 2 pts ES, 5 pts NQ
    ATR(14) * 0.1                // 10% of daily ATR as noise filter
)
```

---

## 4. Stop Placement Relative to FVGs

### Bullish FVG (Long Trade)
```
FVG = gap between candle 1 high and candle 3 low (3-candle pattern)
ENTRY: When price retraces into the FVG zone
STOP:  Below the BOTTOM of the FVG (candle 1 high)

Example:
  FVG zone: 0.7100 – 0.7120
  Entry: 0.7110 (mid-gap)
  Stop:  0.7095 (5 pips below FVG bottom)
```

### Bearish FVG (Short Trade)
```
ENTRY: When price retraces up into the bearish FVG
STOP:  Above the TOP of the FVG

Example:
  FVG zone: 0.7100 – 0.7120
  Short entry: 0.7115
  Stop: 0.7125 (5 pips above FVG top)
```

### OB + FVG Confluence (Strongest Setup)
When an FVG develops WITHIN an Order Block, use the wider of the two for stop placement:
```
stop_long  = min(OB.low, FVG.bottom) - buffer
stop_short = max(OB.high, FVG.top)   + buffer
```

This confluence zone has the highest probability of holding because it represents both institutional ordering (OB) and inefficient pricing (FVG).

---

## 5. Stop Placement After Liquidity Sweeps

This is arguably the most important stop placement concept for smart money trading.

### The Pattern
```
1. Price approaches a swing high/low where retail stops cluster
2. Price SWEEPS through that level (triggers the stops)
3. Price immediately reverses (long wick, small body candle)
4. Smart money enters in the REVERSAL direction
5. Stop goes behind the TIP OF THE SWEEP WICK
```

### Specific Rules

**Identification of a valid sweep:**
- Candle pierces a key level with a wick
- Candle body closes BACK INSIDE the previous range
- The longer the wick relative to the body, the more valid the sweep
- If body closes OUTSIDE the range = genuine breakout, NOT a sweep

**Stop Placement:**
```
LONG after bullish sweep (price swept below support then reversed):
  stop = sweep_candle.wick_low - buffer
  buffer = 5-15 pips forex / 2-5 pts ES / 5-10 pts NQ

SHORT after bearish sweep (price swept above resistance then reversed):
  stop = sweep_candle.wick_high + buffer
```

**Invalidation:** If price returns to and exceeds the sweep wick tip, the entire institutional premise is broken. Exit immediately.

### Why This Works
- The sweep already triggered all the retail stops at that level
- There are NO MORE STOPS left to hunt below/above that wick
- Smart money has already filled their orders using the triggered stop liquidity
- The only reason price would go back there is if the move is genuinely continuing (your thesis is wrong)

### Codifiable Rule:
```python
def stop_after_sweep(sweep_candle, direction, instrument):
    buffer = get_buffer(instrument)  # instrument-specific
    if direction == "LONG":
        return sweep_candle.low - buffer
    else:  # SHORT
        return sweep_candle.high + buffer

def is_valid_sweep(candle, level, direction):
    if direction == "BULLISH_SWEEP":  # swept below support
        return (candle.low < level) and (candle.close > level)
    else:  # swept above resistance
        return (candle.high > level) and (candle.close < level)
```

---

## 6. ICT Turtle Soup Stop Rules

The Turtle Soup pattern is a specific type of liquidity sweep trade.

### Setup Sequence
```
1. HTF: Identify order flow direction and draw-on-liquidity target
2. Mark internal range liquidity (recent swing highs/lows)
3. Wait for price to RAID that liquidity (false breakout)
4. Confirm: Candle sweeps level but closes back inside range
5. Drop to LTF (1m or 5m): Look for Market Structure Shift (MSS)
6. Enter on MSS confirmation in direction of HTF order flow
7. Stop: Just beyond the sweep extreme (wick tip)
```

### Stop Loss Specifics
```
Stop = 5-10 pips beyond the "tail" of the sweep candle
     = the wick tip + noise buffer

This creates tight stops because the sweep wick is the
maximum extension — if price exceeds it, thesis is dead.
```

### Risk-Reward Expectation
- Minimum target: 1:2 RR
- Typical achievable: 1:3 to 1:4+ RR
- Target: Nearest internal liquidity OR opposing swing point
- The tight stop behind the sweep wick is what creates the high RR

---

## 7. Why ATR-Only Stops Get Hunted

### The Problem with Pure ATR Stops
```
Retail approach:
  stop = entry - (ATR(14) * 2.0)

Why it fails:
  1. Millions of traders use 2x or 3x ATR multipliers
  2. This creates PREDICTABLE stop clusters
  3. Market makers know exactly where these stops sit
  4. A quick sweep to 2.1x ATR triggers all the 2x ATR stops
  5. Price reverses, and the retail trader is out at the worst price
```

### The Solution: ATR as COMPONENT, Not SOLE Method
```
Smart approach:
  structural_stop = order_block.low - buffer    // structure-based
  atr_stop = entry - (ATR(14) * 2.0)           // volatility-based

  // Use the WIDER of the two
  final_stop = min(structural_stop, atr_stop)   // for longs

  // Then adjust position size to the wider stop
  position_size = risk_dollars / abs(entry - final_stop)
```

### ATR for Position Sizing, NOT Stop Placement
```
ATR's proper role:
  1. Determine if the structural stop is "reasonable" for current vol
  2. Scale position size so dollar risk stays constant
  3. Reduce position by 25-50% when ATR > 6-month median
  4. Use ATR to set the BUFFER beyond structure, not the stop itself

Buffer formula:
  buffer = max(instrument_minimum, ATR(14) * 0.10 to 0.15)
```

### Key Principle
> "A smaller position size with a wider, smarter stop is infinitely better than a large position size with a tight, dumb stop."

---

## 8. Session Timing and Stop Management

### Killzone Windows (EST)
```
Asian Kill Zone:    8:00 PM – 12:00 AM EST
London Kill Zone:   2:00 AM –  5:00 AM EST
NY AM Kill Zone:    7:00 AM – 10:00 AM EST (forex futures)
                    8:30 AM – 11:00 AM EST (index futures)
NY PM Kill Zone:    1:30 PM –  4:00 PM EST
```

### How Sessions Affect Stop Placement

**London Open (2:00-5:00 AM EST):**
- This is when the daily HIGH or LOW is often established
- Smart money sweeps the Asian session high OR low during London open
- 80% of retail stops cluster within 1-2% beyond obvious highs/lows
- Stops placed during Asian session should account for London sweep

**NY AM Kill Zone (8:30-11:00 AM EST for index futures):**
- Institutions exploit stops placed around London session highs/lows
- The London-NY overlap creates maximum liquidity and volatility
- This is where the REAL directional move often begins AFTER the sweep

### Session-Based Stop Rules
```
Rule 1: If entering during London, account for potential NY sweep
  → Use wider buffers (1.5x normal) on stops set during London

Rule 2: If entering during NY AM after a London sweep has occurred
  → Place stop behind the London sweep wick (tightest valid stop)
  → The sweep has already cleared liquidity, reducing hunt risk

Rule 3: Avoid entering during low-liquidity periods (late Asian)
  → Stop hunting risk increases when volume is thin
  → Wider stops needed, worse RR

Rule 4: If holding through a session transition
  → Trail stop to behind the most recent structural level
  → Do NOT use a fixed trailing stop through killzone transitions
```

---

## 9. Order Flow Signals: Stop Hunt vs. Real Breakout

### How to Distinguish (Codifiable Signals)

| Signal | Stop Hunt | Real Breakout |
|--------|-----------|---------------|
| Volume at level break | Sudden burst, then dies | Sustained aggressive volume |
| Follow-through | Price stalls/reverses immediately | New bids/offers support direction |
| Absorption | High volume, no price movement | Volume translates to directional move |
| Post-break behavior | Returns inside range quickly | Holds above/below broken level |
| Delta | Divergent (buying at highs = trap) | Aligned with direction |
| Liquidity post-break | No new liquidity stacks in direction | Passive orders build supporting direction |

### Codifiable Detection Rules
```python
def is_stop_hunt(level_break_candle, following_candles, volume_data):
    # Rule 1: Volume spike followed by volume collapse
    break_volume = volume_data.at_break
    follow_volume = volume_data.next_3_candles_avg
    volume_dies = follow_volume < (break_volume * 0.4)

    # Rule 2: Price fails to hold beyond level
    price_rejected = any(c.close < level for c in following_candles[:3])

    # Rule 3: Absorption pattern (high volume, no movement)
    high_vol_no_move = (break_volume > volume_data.avg_20 * 2.0) and \
                       (abs(level_break_candle.close - level_break_candle.open) < ATR * 0.2)

    return volume_dies and price_rejected  # or high_vol_no_move
```

### Stop Placement Decision Based on Order Flow
```
IF order flow confirms STOP HUNT:
  → Enter reversal trade
  → Stop behind sweep wick + buffer
  → Tight stop, high RR opportunity

IF order flow confirms REAL BREAKOUT:
  → Do NOT fade the move
  → If already in a position, honor your structural stop
  → Do NOT move stop closer hoping it holds
```

---

## 10. Professional Trail and Partial Exit Management

### How Pros Differ from Retail

**Retail trailing:**
```
Fixed trailing stop (e.g., trail by 10 ticks)
→ Gets chopped out on every pullback
→ Exits at the worst time during normal retracement
```

**Institutional trailing:**
```
Trail to STRUCTURAL levels only:
  1. After 1R profit: Move stop to breakeven (behind entry structure)
  2. After 2R profit: Trail to behind the MOST RECENT swing point
  3. After 3R+ profit: Trail to behind the most recent OB or FVG

  NEVER trail on a tick-by-tick basis
  ONLY move stop when new structure forms
```

### Partial Exit Framework
```
Position: 3 contracts (or 3 units)

Unit 1 (1/3): Exit at 1:1 RR (secures cost basis)
Unit 2 (1/3): Exit at 2:1 RR (locks profit)
Unit 3 (1/3): Trail using structural stops (let it run)

After Unit 1 exit: Move stop to breakeven
After Unit 2 exit: Trail to most recent swing/OB
Unit 3: Only exits on structural stop hit or target hit
```

### Volatility-Adjusted Trail
```
When ATR rises above 6-month median:
  → Reduce position by 25-50%
  → Widen trail distances by same factor
  → Use structural trail only (no tick-based trail)

When ATR is below 6-month median:
  → Normal position sizing
  → Tighter structural trails acceptable
```

---

## 11. Codifiable Rules for Stop Loss Engine

### Rule Set Summary (Production-Ready Logic)

```python
class StopLossEngine:
    """
    Institutional stop loss placement engine.
    Places stops at structural invalidation points, not arbitrary levels.
    """

    # ============================================================
    # RULE 1: INITIAL STOP PLACEMENT
    # ============================================================

    def calculate_initial_stop(self, trade):
        """
        Priority order for stop placement:
        1. Behind sweep candle wick (if entry follows a liquidity sweep)
        2. Behind order block boundary (if entry is at OB)
        3. Outside FVG boundary (if entry is at FVG)
        4. Beyond swing point + buffer (fallback)
        """
        buffer = self.get_buffer(trade.instrument)

        if trade.entry_type == "SWEEP_REVERSAL":
            # Tightest valid stop — sweep already cleared liquidity
            if trade.direction == "LONG":
                return trade.sweep_candle.low - buffer
            else:
                return trade.sweep_candle.high + buffer

        elif trade.entry_type == "ORDER_BLOCK":
            if trade.direction == "LONG":
                return trade.order_block.low - buffer
            else:
                return trade.order_block.high + buffer

        elif trade.entry_type == "FVG":
            if trade.direction == "LONG":
                return trade.fvg.bottom - buffer
            else:
                return trade.fvg.top + buffer

        else:  # SWING fallback
            if trade.direction == "LONG":
                return trade.reference_swing_low - buffer
            else:
                return trade.reference_swing_high + buffer

    # ============================================================
    # RULE 2: BUFFER CALCULATION
    # ============================================================

    def get_buffer(self, instrument):
        """
        Buffer = max(instrument_minimum, ATR-based noise filter)
        Scales with volatility but has a floor.
        """
        atr = self.get_atr(instrument, period=14)

        minimums = {
            "ES":  2.0,    # 2 points = 8 ticks = $100/contract
            "NQ":  5.0,    # 5 points = 20 ticks = $100/contract
            "6E":  0.0005, # 5 pips
            "6B":  0.0005, # 5 pips
            "CL":  0.10,   # 10 cents = 10 ticks = $100/contract
            "GC":  1.0,    # $1 = 10 ticks = $100/contract
        }

        min_buffer = minimums.get(instrument, atr * 0.05)
        atr_buffer = atr * 0.10  # 10% of daily ATR

        return max(min_buffer, atr_buffer)

    # ============================================================
    # RULE 3: POSITION SIZING FROM STOP DISTANCE
    # ============================================================

    def calculate_position_size(self, entry, stop, account, instrument):
        """
        Size position TO the stop, never size stop to the position.
        Risk per trade: 0.5% - 1.0% of account.
        Reduce by 25-50% when ATR > 6-month median.
        """
        stop_distance = abs(entry - stop)
        tick_value = self.get_tick_value(instrument)
        ticks = stop_distance / self.get_tick_size(instrument)
        dollar_risk_per_contract = ticks * tick_value

        # Base risk: 1% of account
        max_risk = account.balance * 0.01

        # Volatility adjustment
        atr = self.get_atr(instrument, period=14)
        atr_median_6m = self.get_atr_median(instrument, months=6)
        if atr > atr_median_6m:
            vol_ratio = atr / atr_median_6m
            reduction = min(0.50, (vol_ratio - 1.0) * 0.5)
            max_risk *= (1.0 - reduction)

        contracts = int(max_risk / dollar_risk_per_contract)
        return max(1, contracts)

    # ============================================================
    # RULE 4: SWEEP VALIDATION
    # ============================================================

    def is_valid_sweep(self, candle, level, direction):
        """
        A valid sweep: wick pierces level, body closes back inside range.
        Invalid: body closes beyond level (= genuine breakout).
        """
        if direction == "BULLISH_SWEEP":
            # Price swept below support, closed back above
            swept = candle.low < level
            rejected = candle.close > level
            wick_ratio = (candle.close - candle.low) / max(candle.high - candle.low, 0.0001)
            significant_wick = wick_ratio > 0.5  # wick is >50% of candle range
            return swept and rejected and significant_wick
        else:
            # Price swept above resistance, closed back below
            swept = candle.high > level
            rejected = candle.close < level
            wick_ratio = (candle.high - candle.close) / max(candle.high - candle.low, 0.0001)
            significant_wick = wick_ratio > 0.5
            return swept and rejected and significant_wick

    # ============================================================
    # RULE 5: STRUCTURAL TRAILING STOP
    # ============================================================

    def trail_stop(self, trade, current_price, market_structure):
        """
        Trail to structural levels only. Never tick-by-tick.
        Only move stop when new structure forms.
        """
        current_rr = self.get_current_rr(trade, current_price)

        if current_rr >= 1.0 and not trade.at_breakeven:
            # Move to breakeven after 1R
            trade.stop = trade.entry  # or entry + 1 tick for longs
            trade.at_breakeven = True

        elif current_rr >= 2.0:
            # Trail to most recent swing
            if trade.direction == "LONG":
                new_stop = market_structure.most_recent_swing_low - self.get_buffer(trade.instrument)
                trade.stop = max(trade.stop, new_stop)  # only move stop UP for longs
            else:
                new_stop = market_structure.most_recent_swing_high + self.get_buffer(trade.instrument)
                trade.stop = min(trade.stop, new_stop)  # only move stop DOWN for shorts

    # ============================================================
    # RULE 6: PARTIAL EXIT MANAGEMENT
    # ============================================================

    def manage_partials(self, trade, current_price):
        """
        Scale out in thirds at structural targets.
        """
        current_rr = self.get_current_rr(trade, current_price)

        if current_rr >= 1.0 and trade.units_remaining == 3:
            # Exit 1/3, move stop to breakeven
            self.exit_partial(trade, units=1)
            trade.stop = trade.entry

        elif current_rr >= 2.0 and trade.units_remaining == 2:
            # Exit 1/3, trail to structure
            self.exit_partial(trade, units=1)
            # Trail stop updated by trail_stop()

        # Final 1/3 runs until structural stop or final target

    # ============================================================
    # RULE 7: STOP HUNT DETECTION (Order Flow)
    # ============================================================

    def detect_stop_hunt(self, level_break_candle, following_candles, volume_data, atr):
        """
        Returns True if the level break appears to be a stop hunt,
        not a genuine breakout.
        """
        # Signal 1: Volume spike then collapse
        break_vol = volume_data.at_break
        follow_vol = volume_data.avg_next_3_candles
        volume_dies = follow_vol < (break_vol * 0.40)

        # Signal 2: Price rejected back inside range within 3 candles
        price_rejected = any(
            c.close < level_break_candle.high  # for upside break
            for c in following_candles[:3]
        )

        # Signal 3: Absorption (high volume, minimal price movement)
        candle_range = abs(level_break_candle.close - level_break_candle.open)
        absorption = (break_vol > volume_data.avg_20 * 2.0) and (candle_range < atr * 0.20)

        return (volume_dies and price_rejected) or absorption

    # ============================================================
    # RULE 8: SESSION-AWARE STOP ADJUSTMENT
    # ============================================================

    def adjust_for_session(self, base_stop, trade, current_session):
        """
        Widen stops during session transitions when sweep risk is highest.
        """
        buffer = self.get_buffer(trade.instrument)

        if current_session == "LONDON_OPEN" and trade.entered_during == "ASIA":
            # London sweeps Asian highs/lows — widen buffer 1.5x
            extra = buffer * 0.5
            if trade.direction == "LONG":
                return base_stop - extra
            else:
                return base_stop + extra

        elif current_session == "NY_AM" and trade.entered_during == "LONDON":
            # NY sweeps London highs/lows — widen buffer 1.5x
            extra = buffer * 0.5
            if trade.direction == "LONG":
                return base_stop - extra
            else:
                return base_stop + extra

        return base_stop  # no adjustment needed

    # ============================================================
    # RULE 9: OB + FVG + SWEEP CONFLUENCE STOP
    # ============================================================

    def confluence_stop(self, trade):
        """
        When OB, FVG, and sweep align, use the widest structural level.
        This is the highest-probability setup with most reliable stops.
        """
        candidates = []
        buffer = self.get_buffer(trade.instrument)

        if trade.order_block:
            if trade.direction == "LONG":
                candidates.append(trade.order_block.low - buffer)
            else:
                candidates.append(trade.order_block.high + buffer)

        if trade.fvg:
            if trade.direction == "LONG":
                candidates.append(trade.fvg.bottom - buffer)
            else:
                candidates.append(trade.fvg.top + buffer)

        if trade.sweep_candle:
            if trade.direction == "LONG":
                candidates.append(trade.sweep_candle.low - buffer)
            else:
                candidates.append(trade.sweep_candle.high + buffer)

        if not candidates:
            return None

        # Use the WIDEST (most conservative) stop
        if trade.direction == "LONG":
            return min(candidates)  # furthest below entry
        else:
            return max(candidates)  # furthest above entry
```

---

## Key Takeaways for Engine Design

### DO:
1. **Always place stops at structural invalidation** — the level where your thesis is objectively wrong
2. **Size position TO the stop** — never squeeze the stop to fit a position size
3. **Use ATR for the buffer component only** — not as the primary stop distance
4. **Place stops behind sweep wicks** — the safest location because liquidity was already cleared
5. **Use partial exits** (1/3 at 1R, 1/3 at 2R, 1/3 trail) to lock profits structurally
6. **Trail to new structure only** — never trail tick-by-tick
7. **Widen buffers during session transitions** (Asia→London, London→NY)
8. **Reduce position size 25-50% when ATR exceeds 6-month median**
9. **Validate sweeps before entering** — wick must pierce level, body must close inside range
10. **Use order flow to confirm stop hunts** — volume spike + rejection = hunt, sustained volume = breakout

### DO NOT:
1. Never place stops at round numbers
2. Never use fixed ATR multiples as the sole stop method
3. Never place stops at obvious swing points without a buffer beyond
4. Never trail tick-by-tick during killzone transitions
5. Never use the same buffer for all instruments
6. Never hold full position size through high-volatility regimes
7. Never move stops closer to "reduce risk" — this increases hunt probability
8. Never ignore session context when setting stops

---

## Sources

- [Stop Losses in ICT: 4 Simple Steps](https://smartmoneyict.com/stop-losses-in-ict/)
- [Liquidity Sweep Trading Strategy: How Smart Money Hunts Stop Losses](https://www.mindmathmoney.com/articles/liquidity-sweep-trading-strategy-how-smart-money-hunts-stop-losses-for-profit)
- [Liquidity Sweeps: Complete Guide to Smart Money Manipulation (TradingView)](https://www.tradingview.com/chart/BTCUSD/Ir02S54N-Liquidity-Sweeps-A-Complete-Guide-to-Smart-Money-Manipulation/)
- [The Confirmation Model: OB + FVG + Liquidity Sweep](https://acy.com/en/market-news/education/confirmation-model-ob-fvg-liquidity-sweep-j-o-20251112-094218/)
- [ICT Turtle Soup Pattern — Complete Guide](https://innercircletrader.net/tutorials/ict-turtle-soup-pattern/)
- [Stop Hunt or Just Noise — Bookmap](https://bookmap.com/blog/stop-hunt-or-just-noise-how-to-read-the-real-intent-behind-a-move)
- [The Sweep Candle Explained — Trading Strategy Guides](https://tradingstrategyguides.com/the-1-candlestick-for-catching-institutional-stop-hunts-the-sweep-candle-explained/)
- [How to Avoid Stop Hunting — Trading with Rayner](https://www.tradingwithrayner.com/stop-hunting/)
- [ICT Killzones — Master Guide](https://innercircletrader.net/tutorials/master-ict-kill-zones/)
- [CFTC Study: Stop Orders in Select Futures Markets](https://www.cftc.gov/sites/default/files/Stoploss_final_ada.pdf)
- [ATR Multiple Stop — Go Markets](https://www.gomarkets.com/en-au/articles/the-atr-multiple-stop----the-answer-to-stop-loss-challenges)
- [Stop Loss Hunting — Webull](https://www.webull.com/news/13849322121348096)
- [Institutional Order Flow — ACY](https://acy.com/en/market-news/education/market-education-institutional-order-flow-smart-money-j-o-20250811-141305/)
- [Fair Value Gap Trading Strategy — LiteFinance](https://www.litefinance.org/blog/for-beginners/trading-strategies/fair-value-gap-trading-strategy/)
- [Order Block Trading Guide — Mastery Trader Academy](https://masterytraderacademy.com/order-block-trading-strategy-guide-2025/)
- [Advanced Position Sizing — BrightFunded](https://brightfunded.com/blog/beyond-the-1-rule-advanced-position-sizing-for-prop-traders)
- [Fair Value Gaps: Complete Guide (TradingView)](https://www.tradingview.com/chart/BTCUSD/TwGf2kqg-Fair-Value-Gaps-FVGs-A-Complete-Guide/)
- [Order Block with FVG Confirmation — TradingFinder](https://tradingfinder.com/education/forex/trade-continuations-using-order-blocks/)
- [Liquidity Sweep — ATAS](https://atas.net/technical-analysis/what-is-liquidity-sweep-how-to-trade-it/)
- [Stop Loss Hunting — GFF Brokers](https://www.gffbrokers.com/stop-loss-hunting-how-to-use-it-and-how-to-protect-yourself-from-it/)
