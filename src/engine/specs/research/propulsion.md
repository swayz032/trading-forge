# Propulsion Block — Cross-Validation Report

> Generated: 2026-03-20
> Search queries: "ICT Propulsion Block trading concept definition rules", "ICT propulsion block order block FVG overlap displacement break of structure",
> "propulsion block ICT entry trigger retest candle 2 body FVG mean threshold invalidation", "ICT propulsion block vs order block difference"
> Sources span: indicator vendors (LuxAlgo, GrandAlgo, FluxCharts), broker education (XS), community forums (Forex Factory), independent ICT educators.

---

## Sources

### 1. GrandAlgo — [ICT Propulsion Block Explained: The Order Block Upgrade](https://grandalgo.com/blog/ict-propulsion-block-explained)
- **Definition:** The body of candle 2 (the displacement candle) inside an FVG. NOT the OB+FVG overlap.
- **Zone:** Open-to-close range of the candle that propelled price and created the imbalance.
- **Mean threshold:** 50% of candle 2's full range (high to low). Not optional — serves as the invalidation line.
- **Displacement required:** Yes — the candle must show genuine displacement (large body relative to surrounding action, ideally with above-average volume).
- **Invalidation:** When candle bodies start closing on the wrong side of the 50% level, the propulsion block is compromised.
- **BOS alignment:** Gains additional weight when aligning with BOS or CHOCH. If the FVG also caused a structural break, that is confluence.
- **Usage:** Continuation tool. Works in trending environments where displacement creates genuine imbalances.
- **Entry options:** (1) Aggressive at the propulsion block edge, or (2) wait for price to reach the mean threshold (50% level).

### 2. InnerCircleTrader.net — [ICT Propulsion Block Complete Guide](https://innercircletrader.net/tutorials/ict-propulsion-block/)
- **Definition:** Body of the FVG displacement candle (candle 2 in the 3-candle FVG pattern).
- **Key distinction from OB:** Propulsion blocks are tighter zones derived from the displacement candle body, not from the broader order block.
- **Mean threshold:** 50% mark of the propulsion candle is the confirmation/invalidation line.
- **Validity:** Price holding above the mean threshold (bullish) confirms block is still valid.

### 3. TradingFinder — [ICT Propulsion Block: Guide to ICT & SMC Trade Concepts](https://tradingfinder.com/education/forex/ict-propulsion-block/)
- **Bullish PB:** Last bearish candlestick in a strong bullish move that trades into a bullish order block, followed by strong upward price movement.
- **Bearish PB:** Last bullish candlestick in a strong bearish move that trades into a bearish order block, followed by strong downward price movement.
- **Confirmation:** Sharp reaction when price returns to the propulsion candle.

### 4. XS — [ICT Propulsion Block: What It Is and How It Works](https://www.xs.com/en/blog/propulsion-block/)
- **Definition:** A candle that trades within an order block and then drives the price away from it.
- **Zone:** The body of the propulsion candle (not the full candle range).
- **Entry:** Wait for price to retrace to the propulsion block zone.

### 5. FluxCharts — [How To Identify and Trade Propulsion Blocks](https://www.fluxcharts.com/articles/Trading-Concepts/Price-Action/propulsion-blocks)
- **Relationship to OBs:** Propulsion blocks are a refined version of order blocks — tighter entry zones with more structure.
- **Purpose:** Continuation entries with precision. Better risk-to-reward than regular OB entries.
- **Displacement:** Required — small-bodied FVGs produce unreliable propulsion blocks.

### 6. Forex Factory (TFlab) — [Mastering the ICT Propulsion Block](https://www.forexfactory.com/thread/1345801-mastering-the-ict-propulsion-block-tflab)
- **Zone:** Candle 2 body within the FVG — the candle that created the imbalance.
- **Mean threshold:** 50% of candle 2 range is the hard invalidation.
- **BOS confluence:** A propulsion block retest that coincides with a BOS on a lower timeframe adds confirmation.
- **Community validation:** Multiple traders backtesting and sharing results in thread.

### 7. PineScript Market — [Propulsion Block: ICT Trading Strategy for Precise Entries](https://pinescriptmarket.com/learn/price-action/propulsion-block)
- **Definition consistent:** Body of the displacement candle within an FVG.
- **Mean threshold:** 50% invalidation line is critical.
- **Entry:** On retest of the propulsion block zone after the initial displacement move.

---

## Consensus Rules (all sources agree)

### What a Propulsion Block IS
A propulsion block is the **body (open-to-close range) of the displacement candle (candle 2)** within a 3-candle FVG pattern. It is the candle that literally propelled price and created the fair value gap.

### What a Propulsion Block is NOT
- It is NOT the overlap of an order block and an FVG (this is a common misconception).
- It is NOT an order block by itself.
- It is NOT the full candle range (high to low) — only the body.

### Formation Sequence (unanimous)
1. **FVG forms:** A 3-candle pattern where candle 1 and candle 3 wicks do not overlap.
2. **Candle 2 is the displacement candle:** It must show genuine displacement — large body relative to surrounding price action.
3. **Propulsion block zone = candle 2 body:** The open-to-close range of the displacement candle.
4. **Mean threshold = 50% of candle 2 full range (high to low):** This is the invalidation line.

### Entry Logic
- **Trigger:** Price retraces back into the propulsion block zone after the initial displacement.
- **Aggressive entry:** Limit order at the propulsion block edge (open of candle 2 for bullish, close of candle 2 for bearish).
- **Conservative entry:** Wait for price to reach the mean threshold (50% level).
- **Direction:** Continuation only — enter in the direction of the displacement.

### Invalidation (unanimous)
- **Bullish PB invalidated:** Price closes below the mean threshold (50% of candle 2 range).
- **Bearish PB invalidated:** Price closes above the mean threshold (50% of candle 2 range).

### Displacement Requirement
- **YES — unanimously required.** All sources describe the displacement candle as the core of the propulsion block. Without genuine displacement, there is no valid propulsion block. Small-bodied FVGs produce unreliable propulsion blocks.

### BOS Confluence
- **Recommended but not strictly required for formation.** When a propulsion block aligns with a BOS or CHOCH, it is higher probability. If the FVG also caused a structural break, that is strong confluence.

---

## Disputed / Variable Points

| Point | Variation | Assessment |
|-------|-----------|------------|
| **OB interaction** | TradingFinder and XS describe PB as a candle that "trades into an order block." GrandAlgo/FluxCharts/FF focus on candle 2 body within FVG. | The candle 2 body definition is more precise and more widely cited. OB interaction may add confluence but is not the zone definition itself. Use candle 2 body as the zone. |
| **Entry precision** | Some say edge of block, others say mean threshold. | Implement both: aggressive = block edge, conservative = mean threshold. |
| **Stop loss placement** | Some say beyond the FVG, others beyond the propulsion block edge. | Use beyond the FVG extreme (candle 1 or 3 wick) — wider but safer. The propulsion block edge is for entry, not SL. |
| **BOS requirement** | Some say required, most say confluence. | Implement as a filter/bonus, not a hard requirement. |
| **Displacement threshold** | GrandAlgo mentions "above-average volume." Most focus on candle body size. | Use body size relative to ATR as the displacement test (consistent with our detect_displacement indicator). Volume is nice-to-have but not universally available. |

---

## Final Definition (used for YAML spec)

```yaml
strategy:
  name: ICT Propulsion Block
  creator: Michael J. Huddleston (Inner Circle Trader)
  type: continuation
  markets: [futures, forex, indices]

formation:
  step_1_fvg:
    description: "3-candle FVG forms — candle 1 and candle 3 wicks do not overlap"
    required: true
  step_2_displacement:
    description: "Candle 2 (the middle candle) must be a displacement candle"
    required: true
    test: "body_size > atr_mult * ATR"
  step_3_zone:
    description: "Propulsion block zone = body of candle 2 (open to close)"
    zone_top: "max(open, close) of candle 2"
    zone_bottom: "min(open, close) of candle 2"
  step_4_mean_threshold:
    description: "50% of candle 2 full range (high to low)"
    formula: "(candle_2_high + candle_2_low) / 2"
    purpose: "invalidation line"

entry:
  trigger: "Price retraces into the propulsion block zone"
  direction: continuation  # same direction as displacement
  bullish: "Price dips into zone (low <= zone_top) and closes above zone_bottom"
  bearish: "Price rallies into zone (high >= zone_bottom) and closes below zone_top"

invalidation:
  bullish: "Close below mean threshold"
  bearish: "Close above mean threshold"

confluence:
  bos_alignment:
    description: "FVG that created the propulsion block also caused a BOS"
    required: false
    recommended: true

risk_management:
  stop_loss: "Beyond the FVG extreme (candle 1 or 3 wick)"
  take_profit: "Next liquidity level or 2R minimum"
```

---

## Impact on Existing Code

The existing `propulsion.py` has **fundamental definition errors:**

1. **Wrong zone definition:** Uses OB+FVG overlap instead of candle 2 body.
2. **No displacement check:** Accepts any FVG regardless of displacement quality.
3. **No mean threshold:** Missing the core invalidation mechanism.
4. **Wrong exit logic:** Uses arbitrary 2x zone size instead of mean threshold invalidation.
5. **Wrong regime:** `preferred_regime = "TRENDING_UP"` is too restrictive — PBs work in both directions.

**Verdict: FAIL — full rewrite required.**

---

## Sources

1. [ICT Propulsion Block Explained — GrandAlgo](https://grandalgo.com/blog/ict-propulsion-block-explained)
2. [ICT Propulsion Block Complete Guide — InnerCircleTrader.net](https://innercircletrader.net/tutorials/ict-propulsion-block/)
3. [ICT Propulsion Block Guide — TradingFinder](https://tradingfinder.com/education/forex/ict-propulsion-block/)
4. [ICT Propulsion Block: What It Is — XS](https://www.xs.com/en/blog/propulsion-block/)
5. [How To Identify and Trade Propulsion Blocks — FluxCharts](https://www.fluxcharts.com/articles/Trading-Concepts/Price-Action/propulsion-blocks)
6. [Mastering the ICT Propulsion Block — Forex Factory (TFlab)](https://www.forexfactory.com/thread/1345801-mastering-the-ict-propulsion-block-tflab)
7. [Propulsion Block: ICT Trading Strategy — PineScript Market](https://pinescriptmarket.com/learn/price-action/propulsion-block)
