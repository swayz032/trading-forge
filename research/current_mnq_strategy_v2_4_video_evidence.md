# Current MNQ v2.4 — Verified Video Evidence Ledger

Status: research evidence for the user's current MNQ discretionary translation.

Critical policy: a video rule is NOT automatically part of the user's strategy. It may be adopted only when it agrees with the trader's own stated process or the trader explicitly confirms it. Creator-specific timeframes, news-event levels, indicators, entries, sizing, or targets are research context only unless confirmed by the trader.

## Verified source 6 — key-level validation transcript supplied by trader

User-supplied transcript summary:

- Support/resistance should not be drawn everywhere; too many levels create noise.
- A key level can be validated by **multiple rejections**.
- A level can also be meaningful when price forms a swing high/low and then **moves away drastically**, even before several retests exist.
- A price area may function as resistance, later break, and then function as support (and vice versa).
- The most useful levels are the ones relevant/near enough to current price to matter; distant levels can be omitted from the active execution map.
- Recent levels are emphasized.

### Adopted into v2.4 because it agrees with the trader's own rules

1. `REPEATED_REJECTION` is primary evidence of a 15m S/R zone.
2. `STRONG_DISPLACEMENT_AWAY_FROM_SWING` is allowed as secondary evidence for a candidate zone, but cannot bypass all other quality/context checks.
3. Zone role is stateful: a resistance can become support and support can become resistance **only after durable acceptance / break-retest evidence**. A mere wick breach does not permanently flip a zone.
4. The active execution map should prioritize nearby/relevant zones and avoid clutter, but 'nearby' must be causal and may not delete a farther zone if that farther zone is the next meaningful destination/target.
5. No level alone creates a trade. Price still has to reach the zone and show rejection or breakout/acceptance plus candle/control confirmation.

### Not adopted automatically

- Generic recommendation to draw simple lines rather than the trader's own 15m zones.
- Any creator-specific timeframe hierarchy.
- Any fixed count such as 'exactly three' rejections as a universal threshold.

---

## Verified source 7 — NASDAQ key-level / supply-demand / reclaim transcript supplied by trader

User-supplied transcript supports the following concepts:

- Build **zones rather than single exact lines** when nearby highs/lows/wicks represent the same reaction area.
- A zone is an **inflection area**, not a promise that price must hold.
- The same zone can produce either a long or short depending on whether price **holds/reclaims/rejects** or **breaks/fails**.
- Prior support/resistance can change role after a genuine break and retest.
- A reclaim can occur when price trades below a key area, attracts shorts, then gets back above and **holds/defends** the reclaimed area.
- Break-and-retest logic uses the level to decide where to pay attention, then reads price action at the level before entry.
- Trading directly into a nearby opposing supply/resistance area is undesirable; the next meaningful inflection area naturally becomes a target / reaction destination.
- Zones may be fine-tuned as new price action forms, but the historical engine must do this causally without future data.

### Adopted into v2.4 because it agrees with the trader's own rules

1. `ZONE_NOT_LINE`: a 15m S/R location is a price interval built from a cluster of causal reactions/wicks, not one magic tick.
2. `INFLECTION_NOT_PREDICTION`: touching support does not force a long and touching resistance does not force a short.
3. `BOTH_OUTCOMES_ALLOWED_AT_ZONE`: after price reaches a zone, the engine must classify the interaction:
   - rejection/reclaim -> possible reversal in the defending direction;
   - break/acceptance -> possible continuation through the zone.
4. `RECLAIM_REQUIRES_HOLD`: a sweep/breach and immediate close back through the level is only the start of reclaim evidence. Directional control/defense/hold must confirm; a doji reclaim alone is not an A+ trade.
5. `ROLE_FLIP_REQUIRES_ACCEPTANCE`: support/resistance polarity changes only after durable acceptance and may be validated by a retest. A transient breach does not flip the zone.
6. `BREAK_RETEST_IS_ZONE_INTERACTION`: a prior resistance that is broken, accepted and retested as support can become a valid long location; the mirror applies to support -> resistance for shorts.
7. `ROOM_TO_NEXT_INFLECTION`: the bot must not enter when a strong opposing blocker is too close. Targets remain the next meaningful reaction/liquidity/zone destination, not fixed R.
8. `CAUSAL_ZONE_MAINTENANCE`: zones may update from newly completed bars, but future bars are forbidden and every historical update must be reproducible from information available at that time.

### Not adopted automatically

The video creator uses concepts that are useful research but are NOT automatically part of the user's current strategy:

- 4H -> 1H -> 30m top-down zone construction;
- CPI/news-event highs/lows;
- daily 20 SMA;
- 1m as a required execution timeframe;
- whole-number levels such as 30,000;
- creator-specific supply/demand coloring or named 'reclaim ripper' setup;
- creator position sizing or P&L examples.

The user's currently confirmed map remains centered on their own premarket analysis, 15m S/R / 15m FVG / PDH-PDL-PWH-PWL context, 5m execution candle story, 9:30–12:00 ET window, first A+ only, and one trade maximum.

---

## Engineering consequence

The v2.4 signal engine must enforce this order:

`PREMARKET -> CAUSAL ZONE MAP -> PRICE REACHES ZONE -> CLASSIFY REJECT / RECLAIM / BREAK / RETEST -> CANDLE STORY + CONTROL -> ROOM TO NEXT MEANINGFUL DESTINATION -> FIRST A+ ONLY`

Explicit refusals:

- candlestick pattern away from a zone -> `NO_TRADE`;
- price near but not interacting with a zone -> `NO_TRADE`;
- touch with mixed/doji control -> `WAIT_OR_NO_TRADE`;
- sweep/reclaim without directional defense -> `WAIT_OR_NO_TRADE`;
- transient breach treated as permanent role flip -> `REFUSE`;
- trade directly into a strong nearby opposing blocker -> `REFUSE`;
- hindsight zone redrawing using future bars -> `REFUSE`.
