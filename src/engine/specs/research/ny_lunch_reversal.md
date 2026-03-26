# ICT NY Lunch Reversal — Cross-Validation Report

## Sources

1. **forexfactory.com** — "New York Reversal Strategy in ICT Daily Profiles (TFlab)"
   - NY Reversal is a core ICT daily profile type: London session establishes a directional move, then the New York session reverses it
   - The reversal typically occurs after a liquidity sweep — price manipulates in the AM direction to grab liquidity, then reverses
   - The lunch consolidation (roughly 12:00 PM - 1:30 PM ET) serves as the accumulation/re-distribution phase before the PM reversal
   - PM session (1:30 PM - 4:00 PM ET) then delivers in the opposite direction of the AM session move
   - The pattern is: AM trend -> lunch consolidation -> PM reversal

2. **innercircletrader.net** — "What are ICT Macro Times" + "Master All 4 ICT Kill Zones"
   - NY Lunch Macro window: **11:50 AM - 12:10 PM ET** — a 20-minute macro where algorithmic activity creates the transition point
   - NY PM Macro window: **1:10 PM - 1:40 PM ET** — the macro that sets the tone for PM session delivery
   - The lunch period (12:00 PM - 1:30 PM ET) is a "dead zone" with low probability — often features reversal traps and reduced liquidity
   - ICT explicitly warns against trading DURING lunch; the opportunity is to position for the PM move AFTER lunch ends
   - The PM Silver Bullet window (2:00 PM - 3:00 PM ET) is where the reversal trade is often executed

3. **arongroups.co** — "New York Reversal: ICT Setup, Timing & Strategy"
   - An afternoon reversal is about a move that has already trended and stretched in the AM, now fading into profit-taking and rebalancing
   - MSS (Market Structure Shift) must confirm the reversal — not every lunch consolidation becomes a reversal; only a liquidity sweep followed by MSS and follow-through qualifies
   - The reversal must show displacement (strong candles) to be valid — weak, choppy structure shifts are traps
   - Targets: opposite liquidity from the AM session (e.g., if AM rallied, PM targets the AM session's sell-side liquidity)

4. **writofinance.com + innercircletrading.blog** — "ICT Macros: Smart Money Time-Based Trading"
   - The algorithm consolidates between 12:00 PM and controls price; the 1:10 PM - 1:40 PM macro begins setting the pace for PM delivery
   - Lunch BSL/SSL (buy-side/sell-side liquidity) formed during the 12:00-1:30 consolidation becomes the reversal trigger point
   - Once the PM session starts (~1:30 PM), the goal is to identify whether lunch liquidity gets swept, then trade the opposite direction
   - The PM Silver Bullet (2:00 PM - 3:00 PM ET) is specifically designed for this: identify the AM/lunch liquidity pool, wait for sweep + FVG, enter the reversal

## Consensus Rules

1. **Time window**: The "lunch reversal" is not a single-moment event but a process:
   - AM session establishes direction: 9:30 AM - 12:00 PM ET
   - Lunch consolidation / dead zone: 12:00 PM - 1:30 PM ET (avoid trading here)
   - NY Lunch Macro: 11:50 AM - 12:10 PM ET (transition point)
   - NY PM Macro: 1:10 PM - 1:40 PM ET (sets PM tone)
   - PM reversal delivery: 1:30 PM - 4:00 PM ET
   - PM Silver Bullet entry window: 2:00 PM - 3:00 PM ET

2. **Yes, the MSS direction must OPPOSE the AM session move** — all sources agree. The PM session reversal is specifically a counter-move to the AM trend. If AM was bullish, the PM reversal is bearish (and vice versa).

3. **What confirms the reversal**:
   - Liquidity sweep of AM/lunch highs or lows (the stretched extreme)
   - Market Structure Shift (MSS) with displacement — must be energetic, not choppy
   - FVG formed by the displacement provides the entry zone
   - Follow-through after the MSS confirms intent (not just a wick)

4. **Do NOT trade during lunch** — the 12:00 PM - 1:30 PM ET period is low-probability, trap-heavy. The reversal is identified during lunch but traded after it.

5. **Targets are the opposite AM liquidity pool** — if AM rallied, the PM reversal targets the AM sell-side liquidity (lows). If AM sold off, PM targets AM buy-side liquidity (highs).

## Disputed Points

- **Exact lunch macro timing**: Most sources cite 11:50 AM - 12:10 PM ET as the NY Lunch Macro, but some reference 1:10 PM - 1:40 PM as a separate "NY PM Macro." These are two distinct macros, not alternatives — the confusion arises from sources lumping them together. The lunch macro (11:50-12:10) marks the transition; the PM macro (1:10-1:40) sets the PM direction.
- **Is the lunch reversal a daily profile or a standalone setup?** ICT teaches it as part of a broader "daily profile" framework (London Reversal, NY Continuation, NY Reversal, etc.). Some community sources extract the lunch reversal as a standalone trade, which loses the context of why the reversal is happening (typically because London's move failed to reach HTF targets).
- **How often does the reversal actually occur?** Not every day is a "reversal day." ICT daily profiles include continuation days where PM continues the AM direction. Sources vary on how to determine in advance whether a reversal will occur — the consensus is that HTF context (is price at a HTF level where reversal is expected?) determines whether to anticipate continuation or reversal.
- **PM Silver Bullet vs lunch reversal**: Some sources present the PM Silver Bullet (2:00-3:00 PM) as the vehicle for trading the lunch reversal, while others treat them as related but separate concepts. The Silver Bullet is more of a specific entry model; the lunch reversal is the broader directional thesis.

## Final Definition

**ICT NY Lunch Reversal** is a daily profile pattern where the PM session (after ~1:30 PM ET) reverses the direction established by the AM session (9:30 AM - 12:00 PM ET), with the lunch period (12:00 PM - 1:30 PM ET) serving as the transitional consolidation phase.

**Full sequence**:
1. **AM session trends** — establishes a clear directional move (e.g., bullish from 9:30 AM to ~11:30 AM)
2. **Lunch consolidation** (12:00 PM - 1:30 PM ET) — price stalls, creates a range, builds liquidity pools above and below
3. **Lunch/AM liquidity gets swept** — the extreme of the AM move or lunch range gets taken out (e.g., new session high)
4. **MSS with displacement** — a Market Structure Shift occurs in the OPPOSITE direction of the AM move, confirmed by strong displacement candles
5. **FVG forms** — the displacement creates a Fair Value Gap for entry
6. **PM session delivers the reversal** — price moves opposite to the AM direction, targeting the AM session's opposite liquidity pool

**Critical requirements**:
- The MSS must oppose the AM direction (this is what makes it a "reversal")
- Displacement must accompany the MSS (weak shifts are traps)
- Do NOT enter during the 12:00-1:30 PM dead zone; wait for PM session confirmation
- Best entry windows: PM Macro (1:10-1:40 PM ET) or PM Silver Bullet (2:00-3:00 PM ET)
- HTF context should support a reversal (price at HTF PD array, daily/weekly level, etc.)
