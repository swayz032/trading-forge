# ICT Breaker Block — Cross-Validation Report

## Sources

1. **TheICTTrader.com** — A breaker block is a failed order block that now acts as support/resistance from the opposite side. Key distinction from mitigation block: a breaker block first leads to continuation (breaks structure in the current trend direction) before yielding to an MSS in the opposite direction. A mitigation block fails to create a new BOS before the reversal. When breaker blocks or mitigation blocks fail, they revert to their original state as order blocks.

2. **LuxAlgo** (luxalgo.com) — An order block signals institutional order accumulation. A breaker block results from a Market Structure Shift and typically appears after a strong move and a liquidity grab. A former support-acting OB becomes a resistance-acting breaker, and vice versa. The breakout must close decisively beyond the OB to transform it.

3. **InnerCircleTrader.net** — A breaker block is the specific candle used to sweep liquidity before an MSS occurs. Formation requires: (a) valid order block exists, (b) price breaks the OB with an impulsive wave, (c) the breakout is significant — price does not reverse immediately. Bullish breaker = failed bearish OB (price closes above bearish OB high, zone becomes support). Bearish breaker = failed bullish OB (price closes below bullish OB low, zone becomes resistance).

4. **ATAS** (atas.net) — Order blocks represent zones of active institutional activity. Breaker blocks are the transformation of those zones after price breaks through them. A BOS marks the moment price closes decisively beyond an OB, transforming it into a breaker and signaling a directional shift.

5. **ForexBee** (forexbee.co) — Validation checklist for breaker blocks: (a) Liquidity sweep — price first captures liquidity behind a zone, (b) Order block break — price breaches the OB boundary, invalidating it, (c) Market Structure Shift — confirmed trend reversal must occur. Entries taken on the retest of the breaker, stops beyond the breaker block boundary.

6. **WritoFinance** (writofinance.com) — When price breaks an order block instead of respecting it and shifts market trend, that OB area becomes a breaker block. Breaker block trading is most effective on 15m--1h for entries, 4h--daily for structure identification.

## Consensus Rules

- **A breaker is a failed order block**: All sources agree. An OB that price breaks through decisively is reclassified as a breaker.
- **Polarity flip**: The breaker acts from the opposite side — former support becomes resistance, former resistance becomes support.
- **BOS/MSS is required**: The break through the OB must produce a confirmed Break of Structure or Market Structure Shift. A wick through an OB that does not close beyond it is not a breaker.
- **Liquidity sweep precedes the break**: Price first sweeps liquidity at/beyond the OB (e.g., stop hunts) before the impulsive move that invalidates it.
- **Trade on the retest**: Entry is taken when price returns to the breaker zone. The expectation is that the former OB now repels price in the new direction.
- **Stop placement**: Beyond the far side of the breaker block.

## Disputed Points

- **Breaker vs Mitigation Block**: Source 1 (TheICTTrader) draws a clear distinction — a breaker first breaks structure in the original trend direction before the MSS, while a mitigation block fails to make a new BOS before reversing. Other sources (2, 3, 4) do not consistently differentiate or treat them as interchangeable. This is a meaningful nuance for detection logic: a breaker involves a "last gasp" continuation before failure, while a mitigation block fails in place.
- **Must the OB have been "mitigated" (traded through)?** Sources 1 and 5 imply the OB is swept/tested first (liquidity capture), then broken. Sources 3 and 4 focus on the decisive close beyond the OB as the key event, without requiring a prior test. The conservative interpretation: the OB should have been reached and then broken through (not just gapped over).
- **Impulsive candle requirement**: Some sources (3, 6) require the break to be impulsive (large body, minimal wick). Others (2, 4) only require a decisive close. For algorithmic detection, requiring displacement (impulsive candles) at the break point is the safer filter.

## Final Definition

**ICT Breaker Block** is a former Order Block that has been invalidated by a decisive price break and now acts as a support/resistance zone from the opposite polarity.

**Formation sequence:**
1. **Valid Order Block** exists (last opposite-color candle before an impulsive move).
2. **Liquidity sweep**: Price reaches/tests the OB zone, capturing resting liquidity (stop hunts).
3. **Decisive break**: Price closes beyond the OB boundary with an impulsive move (displacement candles).
4. **Market Structure Shift (MSS)**: The break produces a confirmed change in market structure — a higher high in a previously bearish structure (bullish breaker) or a lower low in a previously bullish structure (bearish breaker).
5. **Polarity flip**: The former OB zone is reclassified as a breaker. Bullish breaker (failed bearish OB) = new support. Bearish breaker (failed bullish OB) = new resistance.

**Execution:**
- Wait for price to **retest** the breaker zone.
- Enter in the direction of the new trend (buy at bullish breaker, sell at bearish breaker).
- Stop loss beyond the breaker block boundary.
- Target: next liquidity pool or PD array in the new trend direction.

**Key distinction from Order Block**: An OB is expected to hold and continue the trend. A breaker is an OB that failed — it was broken through with a structural shift — and now works from the other side.
