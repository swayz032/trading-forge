# ICT Turtle Soup / Larry Williams Turtle Soup — Cross-Validation Report

## Sources

1. **Connors & Raschke, "Street Smarts" (1995)** via OxfordStrat — The original Turtle Soup pattern was published by Laurence A. Connors and Linda Bradford Raschke (not Larry Williams directly, though Williams' "Trap of Specialists" concept is closely related). The setup: market makes a new 20-bar high/low, the previous 20-bar extreme was at least 5 bars earlier, and the current bar closes at or beyond the previous extreme. The trade fades the breakout — enter counter-trend when the breakout fails. This was designed to exploit the Turtle Trading System's breakout entries.

2. **InnerCircleTrader.net** — ICT Turtle Soup is a reversal/continuation strategy exploiting false breakouts at higher-timeframe liquidity levels. Key components: (a) liquidity resting above/below equal highs/lows or swing extremes, (b) a sweep of that liquidity (price goes beyond the level then reverses), (c) Market Structure Shift on a lower timeframe confirming the reversal. FVGs, previous highs, and equal highs/lows are used to mark liquidity zones. After the sweep, price reverses to balance imbalances or sweep the opposite side's liquidity.

3. **FluxCharts** (fluxcharts.com) — ICT Turtle Soup uses three ICT concepts: Liquidity, Liquidity Sweeps, and Market Structure. The strategy takes advantage of false breakouts at higher-timeframe liquidity areas. A bullish MSS forms when price makes a lower low then breaks the previous lower high. A bearish MSS forms when price makes a higher high then breaks the previous higher low. After the MSS, price pulls back to an FVG for optimal entry.

4. **SmartMoneyICT** (smartmoneyict.com) — Turtle Soup catches "smart money traps." Sellside liquidity sweep: price drops below SSL, goes below it, and reverses back up. Buyside liquidity sweep: price rises above BSL, goes above it, and reverses back down. Equal highs/lows are magnets for liquidity — retail traders cluster stops there, making them prime sweep targets.

5. **FXOpen** (fxopen.com) — Turtle Soup setups are most reliable during **London and New York sessions** when high volume creates the volatility needed for stop hunts. Most effective on H1/H4 for identifying major liquidity sweeps. For day trading, M5/M15 during high-volatility sessions. Monitor lower timeframes for liquidity sweep + MSS/CHoCH confirmation. After the structural shift, price typically pulls back to an FVG for the entry.

6. **Orbex** (orbex.com) — The strategy exploits "trapped liquidity" from false breakouts. Connors & Raschke developed the original concept to fade the Turtle breakout system. ICT adapted it by adding the smart money framework: institutional players engineer the false breakout to sweep liquidity, then drive price in the opposite direction.

## Consensus Rules

- **Liquidity target**: Price must sweep a **defined liquidity level** — equal highs/lows, previous swing highs/lows, or session extremes where stops are clustered.
- **False breakout / sweep**: Price moves beyond the liquidity level (triggering stops) then reverses. The breakout fails — this is the "soup" moment.
- **Market Structure Shift (MSS) or CHoCH**: After the sweep, a **confirmed structural break on a lower timeframe** validates the reversal. Without MSS/CHoCH, the sweep is not confirmed.
- **FVG as entry**: After the MSS, price typically retraces to a **Fair Value Gap** created by the displacement move. This is the preferred entry point.
- **Session context**: London and New York sessions are preferred — sufficient volume/volatility for institutional stop hunts.

## Disputed Points

- **Must it sweep equal highs/lows specifically, or any swing extreme?** Sources 2 and 4 (InnerCircleTrader, SmartMoneyICT) emphasize equal highs/lows as the primary liquidity targets because retail traders cluster stops there. Sources 3 and 5 (FluxCharts, FXOpen) describe any higher-timeframe liquidity level (including single swing highs/lows). The stricter interpretation: equal highs/lows are the highest-probability targets, but prominent single swing extremes also qualify if they have visible resting liquidity.
- **MSS vs FVG — which is the confirmation?** All sources agree MSS is the structural confirmation that the sweep has led to a reversal. FVG is the entry mechanism after MSS, not the confirmation itself. No real dispute here, but some sources blur the distinction by listing them together.
- **Original concept attribution**: Source 1 credits Connors & Raschke (1995, "Street Smarts"), not Larry Williams directly. Larry Williams' "Trap of Specialists" concept is related but distinct. ICT adapted the Connors/Raschke Turtle Soup framework and layered smart money concepts on top. The user prompt mentions "Larry Williams Turtle Soup" — the more accurate attribution is Connors & Raschke, though Williams' false-breakout work influenced the lineage.
- **Session filter — hard requirement or guideline?** Source 5 (FXOpen) presents London/NY sessions as strongly preferred. Other sources mention it as context but not a strict filter. For algorithmic implementation, session filtering improves win rate but is not a binary rule.

## Final Definition

**ICT Turtle Soup** is a liquidity-sweep reversal strategy that fades false breakouts at key liquidity levels, adapted from the Connors & Raschke (1995) Turtle Soup pattern with ICT's smart money framework layered on top.

**Original concept (Connors & Raschke, 1995):**
- Price makes a new 20-bar high/low, breaking a previous 20-bar extreme that occurred at least 5 bars earlier.
- The breakout fails — enter counter-trend, fading the breakout.
- Designed to exploit the Turtle Trading System's mechanical breakout entries.

**ICT adaptation:**
1. **Identify liquidity**: Locate equal highs/lows, session extremes, or prominent swing highs/lows where sell stops (SSL) or buy stops (BSL) are resting.
2. **Wait for the sweep**: Price moves beyond the liquidity level, triggering clustered stops. This is the engineered false breakout.
3. **Confirm with MSS/CHoCH**: On a lower timeframe, observe a **Market Structure Shift** or **Change of Character** — price breaks a recent swing point in the opposite direction of the sweep, confirming the reversal.
4. **Entry at FVG**: After the MSS, price retraces to a **Fair Value Gap** created by the displacement move. Enter at the FVG.
5. **Stop loss**: Beyond the sweep high/low (the false breakout extreme).
6. **Target**: Opposing liquidity pool or the next PD array.

**Session filter (recommended):** London session (02:00--05:00 ET) and New York session (07:00--10:00 ET) provide the volume and volatility needed for institutional stop hunts. Setups outside these windows have lower probability.
