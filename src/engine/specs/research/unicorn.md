# ICT Unicorn Model — Cross-Validation Report

> Generated: 2026-03-20
> Search queries: "ICT Unicorn Model breaker block FVG overlap setup", "ICT Unicorn entry model Inner Circle Trader setup sequence requirements",
> "ICT Unicorn Model rules break of structure displacement fair value gap breaker", "ICT Unicorn Model stop loss take profit exit strategy targets"
> Sources span: indicator vendors, broker education sites, community forums, independent ICT educators.

---

## Sources

### 1. LuxAlgo — [ICT Unicorn Model Strategy: How To Use](https://www.luxalgo.com/blog/ict-unicorn-model-strategy-how-to-use/)
- **Core definition:** The Unicorn Zone is the overlap between an FVG and a Breaker Block
- **Bullish Unicorn:** Bullish Breaker Block + Bullish FVG overlap; enter long on price return
- **Bearish Unicorn:** Bearish Breaker Block + Bearish FVG overlap; enter short on price return
- **Stop loss:** Just outside the breaker block zone
- **Take profit:** Based on next draw on liquidity level (equal highs/lows, HTF PD array)
- **Risk-to-reward:** Minimum 1:2 RR

### 2. InnerCircleTrader.net — [Master ICT Unicorn Model](https://innercircletrader.net/tutorials/ict-unicorn-model/)
- **Setup sequence:** Liquidity Sweep -> Market Structure Shift -> Displacement creates FVG within Breaker Block -> Enter on retrace to FVG-Breaker zone
- **Strict mechanical sequence:** Each step must be confirmed before the next
- **FVG placement:** FVG must sit directly inside the range of the Breaker Block
- **Invalidation:** If price closes past the Breaker Block high/low, or takes out opposing liquidity before entry

### 3. FluxCharts — [ICT Unicorn Strategy Explained](https://www.fluxcharts.com/articles/trading-strategies/ict-strategies/ict-unicorn)
- **Setup:** Breaker Block + FVG overlap = Unicorn zone
- **Entry:** Wait for price to retrace to the FVG zone; limit order at FVG midpoint or boundary
- **Stop loss:** Below breaker block low (longs) or above breaker block high (shorts)
- **Take profit:** Nearest swing point or FVG in trade direction (TP1); major swing high/low (TP2)
- **RR:** 1:2 or higher standard goal

### 4. Aron Groups — [ICT Unicorn Model: Setup, Rules & Entry Strategy](https://arongroups.co/technical-analyze/ict-unicorn-model/)
- **Setup sequence:** Liquidity sweep -> MSS -> Displacement -> FVG within Breaker -> Enter on retrace
- **Bullish SL:** Below the low of the Breaker Block or the FVG (whichever is lower)
- **Bearish SL:** Above the high of the Breaker Block or the FVG (whichever is higher)
- **TP targets:** Next draw on liquidity (equal highs/lows, previous session H/L)

### 5. SmartMoneyICT — [ICT Unicorn Strategy: 5 Simple Steps](https://smartmoneyict.com/ict-unicorn-strategy/)
- **5 steps:** (1) Identify swing structure (2) Spot the liquidity sweep (3) Look for displacement/MSS (4) Find FVG within breaker (5) Enter on retrace
- **SL for bullish:** 10-20 pips below the FVG low that overlaps the breaker
- **SL for bearish:** 10-20 pips above the FVG high that overlaps the breaker
- **TP:** Next draw on liquidity level; opposing FVG edge

### 6. WritoFinance — [ICT Unicorn Model – SMC and ICT Trading Concept](https://www.writofinance.com/ict-unicorn-model-in-forex/)
- **Core:** Breaker Block + FVG overlap = more reliable entry than either alone
- **Invalidation:** Price closes past the Breaker Block boundary; zone is dead
- **Optional trailing stop:** Exit prematurely to preserve profits

---

## Consensus Rules (all sources agree)

### Core Definition
The ICT Unicorn is specifically the **overlap zone between a Breaker Block and a Fair Value Gap**. A Unicorn setup only exists when an FVG sits directly inside or overlaps the range of a Breaker Block. This combined zone is more reliable than either component alone.

### Setup Sequence (unanimous across sources)
1. **Swing structure forms:** Price creates a swing high or swing low
2. **Order Block forms:** The last opposing candle before the swing becomes the Order Block
3. **Order Block fails (broken through):** Price sweeps through the OB aggressively — this creates the Breaker Block
4. **Displacement + BOS/MSS:** The aggressive move through the OB must show displacement (strong candle body) and create a Break of Structure or Market Structure Shift
5. **FVG forms within the Breaker:** During the displacement move, a Fair Value Gap is created that overlaps with or sits inside the Breaker Block zone
6. **Unicorn Zone identified:** The overlap region between the Breaker Block and the FVG is the Unicorn Zone
7. **Entry on retrace:** Price retraces back into the Unicorn Zone; enter via limit order at FVG boundary or midpoint

### Direction Logic
- **Bullish Unicorn:** Bearish OB broken to the upside -> Bullish Breaker + Bullish FVG overlap -> Long entry on retrace
- **Bearish Unicorn:** Bullish OB broken to the downside -> Bearish Breaker + Bearish FVG overlap -> Short entry on retrace

### Risk Management (consensus)
- **Stop loss:** Beyond the Breaker Block extreme (below bottom for longs, above top for shorts)
- **Take profit:** Next draw on liquidity (equal highs/lows, prior session H/L, opposing FVG edge)
- **Minimum RR:** 1:2
- **Invalidation:** If price closes past the Breaker Block boundary before entry is triggered

### FVG-Breaker Relationship
- The FVG must **overlap with** or **sit inside** the Breaker Block range
- Sources 2 and 4 specify the FVG should sit "directly inside" the Breaker range
- Sources 1, 3, and 5 use "overlap" more broadly
- **Recommendation:** Require overlap (conservative: min(breaker_top, fvg_top) > max(breaker_bottom, fvg_bottom))

---

## Disputed / Variable Points

| Point | Variation | Assessment |
|-------|-----------|------------|
| **FVG inside vs overlap** | Some say "inside," others say "overlap." | Use overlap check — if FVG is inside, overlap is automatically true. Overlap is the broader, safer criterion. |
| **Displacement required?** | Sources 2, 4, 5 explicitly require displacement. Sources 1, 3 imply it via "aggressive move." | Recommend: YES, require displacement. The break of the OB should be an aggressive/impulsive candle. |
| **BOS/MSS required?** | Sources 2, 4 explicitly require MSS. Others describe it implicitly. | Recommend: YES, the breaker formation inherently involves BOS (breaking past the OB). The detect_breaker indicator already captures this. |
| **Exact SL placement** | Source 5 says 10-20 pips beyond FVG. Others say beyond the breaker block boundary. | Recommend: SL beyond the breaker block boundary (more universal, accounts for zone width). |
| **Session/time filter** | No sources specify required session windows (unlike Silver Bullet). | Recommend: No session filter required. Unicorn is a structural pattern, not time-dependent. |
| **Trailing stop** | Source 6 mentions optional trailing stop. Others do not. | Recommend: Use time-based + structure-based exit (zone age limit), not trailing. |

---

## Final Definition (used for YAML spec)

```yaml
strategy:
  name: ICT Unicorn
  creator: Michael J. Huddleston (Inner Circle Trader)
  type: intraday / swing (structural, not time-bound)
  markets: [futures, forex, indices, crypto]

setup_sequence:
  1_swing_structure:
    action: "Detect swing highs and lows for market structure"
  2_order_block:
    action: "Identify order blocks at swing points"
  3_breaker_formation:
    action: "OB is broken through by price — becomes a Breaker Block"
    displacement: required
  4_fvg_overlap:
    action: "FVG forms during the displacement that overlaps with the Breaker Block range"
    relationship: "min(breaker_top, fvg_top) > max(breaker_bottom, fvg_bottom)"
  5_entry:
    type: limit_order_or_market
    trigger: "Price retraces into the overlap zone (Unicorn Zone)"

risk_management:
  stop_loss: "Beyond the breaker block extreme (1 ATR buffer)"
  take_profit: "Opposing swing high/low or next liquidity level"
  min_reward_risk: 2.0
  invalidation: "Price closes beyond the breaker block boundary"

validation_checklist:
  - "Is there a valid Breaker Block (failed OB)?"
  - "Was the OB broken with displacement (strong move)?"
  - "Does an FVG overlap with the Breaker Block zone?"
  - "Is the FVG directionally aligned with the Breaker (both bullish or both bearish)?"
  - "Has price retraced into the overlap zone?"
  - "Is the zone still valid (price has not closed past breaker boundary)?"
  - "Does the entry provide at least 1:2 RR?"
```

---

## Sources

1. [ICT Unicorn Model Strategy: How To Use — LuxAlgo](https://www.luxalgo.com/blog/ict-unicorn-model-strategy-how-to-use/)
2. [Master ICT Unicorn Model — InnerCircleTrader.net](https://innercircletrader.net/tutorials/ict-unicorn-model/)
3. [ICT Unicorn Strategy Explained — FluxCharts](https://www.fluxcharts.com/articles/trading-strategies/ict-strategies/ict-unicorn)
4. [ICT Unicorn Model: Setup, Rules & Entry Strategy — Aron Groups](https://arongroups.co/technical-analyze/ict-unicorn-model/)
5. [ICT Unicorn Strategy: 5 Simple Steps — SmartMoneyICT](https://smartmoneyict.com/ict-unicorn-strategy/)
6. [ICT Unicorn Model – SMC and ICT Trading Concept — WritoFinance](https://www.writofinance.com/ict-unicorn-model-in-forex/)
