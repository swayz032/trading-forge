# xTTDH5iRhJc — `entry_at_key_levels_mcl_5m`

- transcript: `raw/xTTDH5iRhJc.txt` — 16046 chars, sha256 `325a2ccefe4ec26c63b9eb1ec7fdaf04942161a6c6be50bd0bbfe3e91be0cfc9`
- `direction` = `both`
- `entry_trigger_id` = `ENABLE_ENTRY:entry at key levels#0`
- `framework_overlay` = `{'stop': 'framework_owned', 'sizing': 'framework_owned', 'take_profit': 'framework_owned'}`
- `binding_plan_summary` = `{'compiled': True, 'spine_bound': 19, 'spine_total': 22, 'trigger_bound': True, 'approximation_used': True}`

Every row below is `transcript_text[span.start:span.end]` — the teacher's exact
words, verbatim, in source order. `object` is the compiler's short label and is NOT
the source. `evidence` is shown as stored, including the `},{` corruption reported
in AR-1042.

| span | bucket | type | role | `object` | `evidence` (as stored) | TEACHER'S WORDS via span |
|---|---|---|---|---|---|---|
| 94-136 | entry_conditions | WAIT_SESSION | confluence | market open time frame | `T-xTTD-C0002` | first 2 and 1/2 hours of the market open. |
| 988-1076 | entry_conditions | WAIT_SESSION | confluence | multi timeframe analysis | `T-xTTD-C0014` | So, these three steps are done on three different time frames, one time frame per step. |
| 1076-1122 | entry_conditions | WAIT_SESSION | confluence | timeframe step 1 | `T-xTTD-C0015` | The first step is done on a daily time frame. |
| 1122-1175 | entry_conditions | WAIT_SESSION | confluence | timeframe step 2 | `T-xTTD-C0016` | The second step is done on the 15-minute time frame. |
| 1175-1230 | entry_conditions | WAIT_SESSION | confluence | timeframe step 3 | `T-xTTD-C0017` | And the third step is done on the 5-minute time frame. |
| 1282-1327 | entry_conditions | FILTER | confluence | indicator usage | `},{` | We will actually not use a single indicator. |
| 1327-1377 | entry_conditions | WAIT_SESSION | confluence | time frame progression | `Instead, we will go down time frame by t` | Instead, we will go down time frame by time frame |
| 1402-1481 | entry_conditions | WAIT_SESSION | confluence | chart | `So, the first step is to open whatever a` | So, the first step is to open whatever asset you are trading on a daily chart. |
| 1872-1925 | entry_conditions | WAIT_SESSION | confluence | daily candle | `},{` | The daily candle is the blueprint for this strategy, |
| 1942-2080 | entry_conditions | WAIT_STRUCTURE | spine | liquidity zones | `},{` | so important because there is liquidity resting above your previous day high, and there's liquidity resting below the previous day's low. |
| 2264-2425 | entry_conditions | ENABLE_ENTRY | trigger | entry at key levels | `We are simply going to enter the market ` | We are simply going to enter the market at these two key levels, and we're going to do it mechanically, meaning that we can't trade this strategy the wrong way. **⟵ ENTRY TRIGGER** |
| 2722-2789 | entry_conditions | ENTER | trigger | trade entry | `{T-xTTD-C0047}` | We're just going to use the box, and we are going to enter a trade |
| 2908-2957 | entry_conditions | CONFIRM_DIRECTION | confluence | break above key levels | `{T-xTTD-C0048, T-xTTD-C0051}` | If we break above, we are likely to head higher. |
| 2957-3005 | entry_conditions | CONFIRM_DIRECTION | confluence | break below key levels | `{T-xTTD-C0048, T-xTTD-C0052}` | If we break below, we are likely to head lower. |
| 4069-4146 | entry_conditions | WAIT_STRUCTURE | spine | breakout from range | `{T-xTTD-C0071}` | when we have a breakout from the range that we boxed in in [music] step one. |
| 4162-4251 | entry_conditions | ENABLE_ENTRY | trigger | breakout above high level or breakout below low level | `T-xTTD-C0073` | looking for is either a breakout above the high level or a breakout below the low level. |
| 4356-4436 | entry_conditions | WAIT_RETEST | spine | price breakout level | `T-xTTD-C0075` | if the price breaks out of the level, it will usually retest the breakout level |
| 4573-4640 | entry_conditions | WAIT_SESSION | confluence | breakout | `},{` | if we have a breakout, and we do this on the 15-minute time frame. |
| 4744-4780 | entry_conditions | FILTER | confluence | candle timeframe | `},{` | but this is with 15-minute candles. |
| 5035-5103 | entry_conditions | WAIT_CONFIRMATION | confluence | close 15 minute candle above high level | `if we have a close of the 15-minute cand` | if we have a close of the 15-minute candle above the high level, or |
| 5243-5347 | entry_conditions | WAIT_CONFIRMATION | confluence | candle close above level or candle close below low level | `},{` | We want a full 15-minute candle close above the level, or a 15-minute candle close below the low level. |
| 5469-5618 | entry_conditions | WAIT_STRUCTURE | spine | price movement relative to previous day s range and gap | `},{` | Okay, we open up at the middle of previous day's range with a gap, and the price starts going up, and it's actually going up above the range in this |
| 5640-5687 | invalidations | INVALIDATE | invalidation | breakout confirmation | `but remember, this isn't a confirmed bre` | but remember, this isn't a confirmed breakout. |
| 5763-5848 | entry_conditions | FILTER | spine | close within range | `},{` | and it closes within the range, meaning that we don't have a confirmed breakout yet. |
| 5962-5993 | entry_conditions | WAIT_CONFIRMATION | confluence | confirmed breakout | `},{` | now have a confirmed breakout. |
| 6133-6210 | entry_conditions | WAIT_CONFIRMATION | confluence | candle close above or below range | `},{` | We're just waiting for that 15-minute candle close above or below the range. |
| 6504-6552 | entry_conditions | WAIT_SESSION | spine | 5 minute time frame | `And this step we do on the 5-minute time` | And this step we do on the 5-minute time frame. |
| 6722-6751 | entry_conditions | WAIT_STRUCTURE | spine | key level | `to appear at this key level.` | to appear at this key level. |
| 6798-6845 | invalidations | INVALIDATE | invalidation | candle appearance | `},{` | if none of these candles appear, >> [music] >> |
| 6845-6938 | invalidations | INVALIDATE | invalidation | reversal readiness | `},{` | then it's not ready to be reversed because that movement could continue back into the range. |
| 7000-7043 | entry_conditions | ENABLE_ENTRY | trigger | trade execution prerequisite | `},{` | Also, remember we will only take the trade |
| 7070-7112 | entry_conditions | WAIT_SESSION | spine | market open duration | `T-xTTD-C0126` | first 2 and 1/2 hours of the market open. |
| 7112-7193 | invalidations | INVALIDATE | invalidation | opportunity loss | `T-xTTD-C0127` | If that doesn't happen, the opportunity is lost, and we will not take the trade. |
| 7362-7495 | entry_conditions | WAIT_CONFIRMATION | confluence | reversal candlestick pattern | `T-xTTD-C0130` | I'm going to be looking for are either the hammer or the inverted hammer candle, [music] or the bullish or bearish engulfing candle. |
| 8373-8507 | entry_conditions | WAIT_CONFIRMATION | confluence | break 5 minute hammer candle | `T-xTTD-C0145` | wait for the break of this 5-minute hammer candle here, and the entry would be right here, and the stop loss would be set at the low. |
| 8557-8596 | entry_conditions | WAIT_BIAS | spine | clear green positive movement | `T-xTTD-C0148` | after a clear green positive movement. |
| 8712-8815 | entry_conditions | ENTER | trigger | entry point | `},{` | The entry would be at the break of the candle, and we would set the stop loss slightly above the high. |
| 9195-9286 | entry_conditions | ENTER | trigger | entry price | `},{` | For engulfing candles, though, I like to set the entry already at the high of the previous |
| 9813-9861 | entry_conditions | WAIT_SESSION | spine | timeframe | `{T-xTTD-C0164}` | Step one, we go to that daily timeframe and the |
| 9861-9932 | entry_conditions | WAIT_STRUCTURE | confluence | range | `{T-xTTD-C0165}` | first [music] thing that we do in the morning is to box in yesterday's |
| 9932-9968 | entry_conditions | WAIT_STRUCTURE | confluence | range extension | `{T-xTTD-C0166}` | range and we extend it until today. |
| 10225-10248 | entry_conditions | WAIT_RETEST | spine | price retest | `{T-xTTD-C0170}` | if we get that retest, |
| 10248-10283 | entry_conditions | WAIT_CONFIRMATION | spine | reversal candle | `{T-xTTD-C0171}` | if we get that reversal candle and |
| 10306-10366 | entry_conditions | WAIT_STRUCTURE | spine | price retest level | `{T-xTTD-C0173}` | So, the price actually rapidly retest the level here in the |
| 10388-10445 | entry_conditions | WAIT_CONFIRMATION | spine | reversal candlestick formation | `},{` | So, we're waiting for the reversal candlestick formation |
| 10445-10474 | entry_conditions | FILTER | spine | level | `somewhere around this level.` | somewhere around this level. |
| 10474-10553 | invalidations | INVALIDATE | invalidation | reversal candlestick formation | `In this next candle, price goes up again` | In this next candle, price goes up again, no reversal candlesticks yet and the |
| 10738-10794 | entry_conditions | WAIT_BIAS | spine | negative movement | `T-xTTD-C0183` | if it was preceded by a clear negative movement and not |
| 10861-10875 | entry_conditions | WAIT_RETEST | spine | retest | `},{` | third retest. |
| 10956-11002 | entry_conditions | FILTER | spine | breakout level | `},{` | We are once again around this breakout level. |
| 11086-11205 | entry_conditions | WAIT_CONFIRMATION | spine | bullish engulfing candle | `},{` | if the price goes up from here to the high of the previous candle, we could very well have a bullish engulfing candle. |
| 11522-11542 | entry_conditions | ENTER | trigger | trade execution | `T-xTTD-C0197` | we enter the trade. |
| 11976-12004 | entry_conditions | WAIT_CONFIRMATION | confluence | breakout | `},{` | We had a positive breakout. |
| 12218-12285 | entry_conditions | WAIT_CONFIRMATION | confluence | bearish engulfing candle | `T-xTTD-C0212` | If we go back to March 9th, we got a bearish engulfing candle here |
| 12285-12355 | entry_conditions | INVALIDATE | trigger | price retest range entry | `T-xTTD-C0213` | but it's false and the price actually goes back into the range again. |
| 12402-12489 | entry_conditions | WAIT_RETEST | spine | breakout retest | `T-xTTD-C0215` | but almost every time that the price breaks out like this, it will retest the breakout |
| 12570-12624 | entry_conditions | WAIT_SESSION | confluence | trading within range full day | `},{` | Sometimes we trade within the range for the full day. |
| 12655-12679 | entry_conditions | FILTER | confluence | breakout location | `},{` | but it's not within the |
| 12770-12805 | entry_conditions | FILTER | confluence | reversal candle | `},{` | but we don't get a reversal candle |
| 13295-13412 | entry_conditions | WAIT_SESSION | confluence | market open | `T-xTTD-C0236` | So, the market opens in 10 minutes and we can start by doing step one, which is to box in yesterday's trading range. |
| 13446-13515 | entry_conditions | WAIT_STRUCTURE | spine | trading range box | `T-xTTD-C0238` | We draw a box from the high to the low and we extend it until today. |
| 13536-13562 | entry_conditions | WAIT_SESSION | confluence | netflix | `T-xTTD-C0240` | Again, we are on Netflix. |
| 13562-13587 | entry_conditions | FILTER | confluence | high level 97 | `T-xTTD-C0241` | So, the high level is 97. |
| 13587-13614 | entry_conditions | FILTER | confluence | low level 94 | `T-xTTD-C0242` | 19. The low level is at 94. |
| 13614-13679 | entry_conditions | WAIT_SESSION | confluence | 15 minute timeframe | `T-xTTD-C0243` | 27. >> [snorts] >> Let's go to the 15-minute timeframe and let's |
| 13871-13950 | entry_conditions | FILTER | confluence | candle close above range | `T-xTTD-C0251` | Uh so, we have a 15-minute candle close here above the range around 75 minutes |
| 14532-14584 | entry_conditions | ENTER | trigger | entry trigger | `{T-xTTD-C0264, T-xTTD-C0265}` | then we will enter immediately at the candle close. |
| 15151-15259 | entry_conditions | EXIT_HINT | spine | position duration | `},{` | but if we are still in position by the time the market closes, we [music] want to manually close the trade. |
