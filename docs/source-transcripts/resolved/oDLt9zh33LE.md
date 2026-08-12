# oDLt9zh33LE — `opening_range_breakout_orb_mcl_5m`

- transcript: `raw/oDLt9zh33LE.txt` — 18004 chars, sha256 `416cb384d3ebc484dd4702f42cea771e67ac7b9facac1198ffb6f7f5fae71569`
- `direction` = `both`
- `entry_trigger_id` = `ENABLE_ENTRY:trade entry#0`
- `framework_overlay` = `{'stop': 'framework_owned', 'sizing': 'framework_owned', 'take_profit': 'framework_owned'}`
- `binding_plan_summary` = `{'compiled': True, 'spine_bound': 31, 'spine_total': 38, 'trigger_bound': True, 'approximation_used': True}`

Every row below is `transcript_text[span.start:span.end]` — the teacher's exact
words, verbatim, in source order. `object` is the compiler's short label and is NOT
the source. `evidence` is shown as stored, including the `},{` corruption reported
in AR-1042.

| span | bucket | type | role | `object` | `evidence` (as stored) | TEACHER'S WORDS via span |
|---|---|---|---|---|---|---|
| 0-28 | entry_conditions | WAIT_STRUCTURE | spine | opening range breakout orb | `T-oDLt-C0000` | The opening range breakout. |
| 1007-1024 | entry_conditions | WAIT_SESSION | spine | time window | `T-oDLt-C0020` | first 50 minutes |
| 1141-1187 | entry_conditions | WAIT_STRUCTURE | spine | opening range breakout zone | `{T-oDLt-C0025}` | That is your opening range breakout zone that |
| 1187-1227 | entry_conditions | WAIT_CONFIRMATION | confluence | price action breakout | `{T-oDLt-C0026}` | you wait for price action to break out. |
| 1252-1282 | entry_conditions | WAIT_CONFIRMATION | confluence | price breakout | `{T-oDLt-C0028}` | when price breaks out of this |
| 1282-1323 | entry_conditions | ENABLE_ENTRY | trigger | trade entry | `{T-oDLt-C0029}` | box, you take a trade in that direction. **⟵ ENTRY TRIGGER** |
| 1522-1605 | entry_conditions | WAIT_STRUCTURE | spine | first 15minute candle range high | `T-oDLt-C0034 to T-oDLt-C0035` | first 15minute candle of the range, people go ahead and mark out the high and they |
| 1748-1921 | entry_conditions | ENTER | trigger | buy position | `If we are at a swing point and we have s` | If we are at a swing point and we have swept out a swing high and people think that okay cool we have broken out of this range let's place a buy position with our stop loss |
| 3757-3801 | entry_conditions | WAIT_CONFIRMATION | spine | breakout | `},{` | wait for a breakout on the fiveminut chart. |
| 4007-4075 | entry_conditions | WAIT_STRUCTURE | spine | overlapping fvg crosses higher low | `},{` | wait for an overlapping fair value gap that crosses the higher low. |
| 4570-4646 | entry_conditions | WAIT_CONFIRMATION | spine | fvg breaks out range | `T-oDLt-C0092` | That fair value gap has to be the same candle that breaks out of the range. |
| 4646-4680 | entry_conditions | FILTER | confluence | fvg candle position | `T-oDLt-C0093` | That has to be the middle candle. |
| 4698-4757 | entry_conditions | FILTER | confluence | fvg overlap with range high | `T-oDLt-C0095` | if the fair value gap overlaps with the actual range high. |
| 4946-5058 | entry_conditions | WAIT_RETEST | spine | high or low initial candle with overlapping fvg | `{T-oDLt-C0101}` | wait for the market to retest that high or low of this initial candle that has a fair value gap overlapping it. |
| 5166-5228 | entry_conditions | ENABLE_ENTRY | trigger | trade execution | `{T-oDLt-C0105}` | And then step number four, we're only going to take the trade |
| 5228-5266 | entry_conditions | WAIT_CONFIRMATION | confluence | retest candle engulfment | `{T-oDLt-C0106}` | when the retest candle gets engulfed. |
| 5438-5486 | entry_conditions | FILTER | spine | traps | `T-oDLt-C0109` | You're filtering out the traps and only trading |
| 5556-5603 | entry_conditions | WAIT_RETEST | spine | fvg | `T-oDLt-C0113` | wait for that retest into that fair value gap. |
| 5603-5666 | entry_conditions | WAIT_CONFIRMATION | spine | bearish candle trading into gap | `},{` | We're going to get a bearish candle that trades into that gap. |
| 6077-6141 | entry_conditions | WAIT_SESSION | trigger | market entry time | `T-oDLt-C0122` | What they do is they come to the market right before 9:30 open. |
| 6141-6224 | entry_conditions | WAIT_SESSION | confluence | trading context | `T-oDLt-C0123` | They're on the 15-minute time frame looking at ENQ or NASDAQ or NAS 100 or US 100. |
| 6403-6445 | entry_conditions | WAIT_SESSION | confluence | timeframe | `T-oDLt-C0127` | to their five minute time frame, and they |
| 6463-6496 | entry_conditions | WAIT_CONFIRMATION | spine | candle breakout | `T-oDLt-C0129` | first 5m minute candle breakout. |
| 6644-6663 | entry_conditions | WAIT_STRUCTURE | confluence | first 5m minute candle to close above or below range | `wait for that very` | wait for that very |
| 6721-6768 | entry_conditions | WAIT_STRUCTURE | confluence | first candle closes above range | `that very first candle closes above the ` | that very first candle closes above the range. |
| 6768-6867 | entry_conditions | ENTER | trigger | entry at candle close | `They take the entry at the candle close,` | They take the entry at the candle close, stop loss at that candle low and they target their two R. |
| 7364-7504 | entry_conditions | WAIT_STRUCTURE | spine | order block formation | `T-oDLt-C0145` | taken out, they receive a change in the state of delivery with downlosed candles closing below this up close candle forming an order block. |
| 7527-7566 | entry_conditions | ENABLE_ENTRY | trigger | sell entry | `T-oDLt-C0147` | now I'm going to take the sell because |
| 7644-7684 | entry_conditions | WAIT_STRUCTURE | confluence | first 5m minute candle close | `T-oDLt-C0150` | wait for a first 5m minute candle close |
| 7684-7759 | entry_conditions | WAIT_STRUCTURE | confluence | 50minut range low | `T-oDLt-C0151` | below that 50minut range low and they still think to themselves, "Not yet. |
| 8094-8194 | invalidations | RESET | invalidation | daily loss limit | `{T-oDLt-C0161}` | After two losses, you should be done for the day and you shouldn't take two losses in a single day. |
| 8495-8524 | entry_conditions | WAIT_BIAS | spine | so rules stay same | `{}` | So, the rules stay the same. |
| 8581-8603 | entry_conditions | FILTER | confluence | high first 15 minute candle | `T-oDLt-C0169` | We mark out the high. |
| 8603-8624 | entry_conditions | FILTER | confluence | low first 15 minute candle | `T-oDLt-C0170` | We mark out the low. |
| 8743-8787 | entry_conditions | WAIT_CONFIRMATION | confluence | break above or break below | `},{` | We wait for a break above or a break below. |
| 8864-8956 | entry_conditions | WAIT_CONFIRMATION | confluence | displacement through level | `And what is very important that we note ` | And what is very important that we note here, we do have a displacement through that level. |
| 8956-8982 | entry_conditions | WAIT_STRUCTURE | spine | fvg | `We have a fair value gap.` | We have a fair value gap. |
| 9030-9068 | entry_conditions | FILTER | spine | candle interaction | `},{` | first candle do not touch each other. |
| 9322-9353 | invalidations | INVALIDATE | invalidation | high | `{}` | But do we trade into the high? |
| 9353-9367 | invalidations | INVALIDATE | invalidation | trade into high | `{}` | No, we don't. |
| 9397-9437 | entry_conditions | WAIT_CONFIRMATION | spine | high rejection | `},{` | I want to see that high being rejected. |
| 9656-9700 | entry_conditions | WAIT_STRUCTURE | spine | fvg inversion | `},{` | We do. We then inverse that fair value gap. |
| 9846-9907 | entry_conditions | WAIT_CONFIRMATION | spine | candle close above order block | `},{` | next candle tries to close above it and form an order block, |
| 9907-9923 | invalidations | INVALIDATE | invalidation | order block attempt failure | `},{` | but that fails. |
| 9961-10083 | invalidations | INVALIDATE | invalidation | long idea | `},{` | And then playing this along, we see that price action just runs and we take out the low, which invalidates our long idea. |
| 10192-10242 | entry_conditions | WAIT_CONFIRMATION | spine | breaking close below forms fvg | `{T-oDLt-C0210, T-oDLt-C0211}` | I want to see a breaking close below that forms a |
| 10356-10504 | entry_conditions | INVALIDATE | trigger | fvg entry | `},{` | We don't get a fair value gap where people would normally go and enter a short here, place a stop at that high because we've broken out of the low. |
| 10599-10639 | entry_conditions | WAIT_RETEST | spine | high price level | `},{` | now? Now, we trade back up to the high. |
| 10961-11003 | invalidations | INVALIDATE | invalidation | we simply miss level and we run away | `{}` | We simply miss the level and we run away. |
| 11060-11116 | invalidations | INVALIDATE | invalidation | here we avoided loss and over here we avoided loss | `{}` | Here we avoided a loss and over here we avoided a loss. |
| 11537-11609 | entry_conditions | WAIT_SESSION | spine | new york open time zone | `T-oDLt-C0243` | We come to our charts right before 9:30 open in the New York hill zone. |
| 11769-11843 | entry_conditions | WAIT_STRUCTURE | confluence | displacement through highs forming fvg | `{0247}` | Something to note here, we do displace through highs forming a fair value |
| 11927-12027 | entry_conditions | WAIT_STRUCTURE | confluence | range high and low | `{0249}` | But keeping it 100% mechanical, we mark out the high and we go ahead and we mark out the range low. |
| 12101-12161 | entry_conditions | WAIT_STRUCTURE | confluence | price action to break out box and give us fvg | `},{` | wait for the price action to break out of this box and give |
| 12182-12257 | entry_conditions | WAIT_STRUCTURE | confluence | price action to trade higher and break out box | `So waiting for price action to trade hig` | So waiting for price action to trade higher and break out of the box here. |
| 12257-12309 | entry_conditions | WAIT_CONFIRMATION | spine | close above box to form fvg | `We do close above the box we form a fair` | We do close above the box we form a fair value gap. |
| 12445-12484 | entry_conditions | WAIT_BIAS | spine | trade into high | `},{` | We see that we do trade into the high. |
| 12737-12764 | entry_conditions | WAIT_STRUCTURE | spine | order block | `T-oDLt-C0265` | This forms my order block. |
| 12764-12805 | entry_conditions | ENABLE_ENTRY | trigger | entry point | `T-oDLt-C0266` | So, entry there, stop loss at this swing |
| 12876-12962 | invalidations | INVALIDATE | invalidation | exit trigger | `T-oDLt-C0268` | Then I know I'm wrong with my idea and I get out of the trade as quickly as possible. |
| 13043-13114 | entry_conditions | WAIT_SESSION | spine | higher time frame | `},{` | We go to a higher time frame and we leave a very small runner running. |
| 13196-13258 | entry_conditions | EXIT_HINT | spine | position exit | `},{` | and then eventually we are taken out of our position for a 2. |
| 13444-13491 | entry_conditions | WAIT_SESSION | spine | nq trading | `on the daily time frame on NQ, what do w` | on the daily time frame on NQ, what do we see? |
| 13641-13725 | entry_conditions | WAIT_STRUCTURE | confluence | sweep out external range liquidity and market leaves behind fvgs | `{T-oDLt-C0284}` | We sweep out external range liquidity and the market leaves behind fair value gaps. |
| 13765-13793 | entry_conditions | WAIT_STRUCTURE | confluence | fvg market has left behind | `{T-oDLt-C0286}` | the market has left behind. |
| 14086-14139 | entry_conditions | WAIT_SESSION | spine | daily time frame | `T-oDLt-C0291` | So looking at this daily time frame, what do we see? |
| 14485-14543 | entry_conditions | WAIT_STRUCTURE | confluence | previous swing high sweep | `},{` | Looking at this, we have swept out a previous swing high. |
| 14543-14602 | entry_conditions | WAIT_STRUCTURE | confluence | internal range liquidity | `},{` | We have internal range liquidity that the market has left. |
| 14912-14957 | invalidations | INVALIDATE | invalidation | displacement above high | `},{` | first is we failed to displace above a high. |
| 15009-15045 | entry_conditions | WAIT_BIAS | spine | market direction | `clause` | I'm looking for the market to trade |
| 15103-15160 | entry_conditions | WAIT_STRUCTURE | spine | daily fvg | `clause` | And if I go out here, we have that daily fair value gap. |
| 15203-15316 | entry_conditions | WAIT_BIAS | spine | delivery closing through up close candles | `},{` | Also looking at this market, we do have a nice change in the state of delivery closing through up close candles. |
| 15361-15420 | entry_conditions | WAIT_SESSION | confluence | 9 30 open | `},{` | is going to be bearish looking waiting for that 9:30 open. |
| 15446-15479 | entry_conditions | WAIT_SESSION | confluence | 15minut time frame | `},{` | We go to the 15minut time frame. |
| 15851-15886 | entry_conditions | WAIT_BIAS | spine | sells | `},{` | look for sells with this position. |
| 15966-15990 | entry_conditions | WAIT_STRUCTURE | spine | sweep | `},{` | We sweep. Look at this. |
| 16075-16139 | invalidations | INVALIDATE | invalidation | initial order block rejection | `},{` | We also reject our initial order block without closing into it. |
| 16250-16322 | entry_conditions | WAIT_SESSION | spine | 5minut time frame | `Dropping to the 5minut time frame here o` | Dropping to the 5minut time frame here on the 5 minute we have our high |
| 16664-16715 | invalidations | INVALIDATE | invalidation | if we play ahead we see you get stopped out | `},{` | if we play this ahead, we see you get stopped out. |
| 16853-16907 | entry_conditions | WAIT_STRUCTURE | spine | fvg overlapping with range | `T-oDLt-C0356` | We have a fair value gap overlapping with that range. |
| 16924-16965 | entry_conditions | WAIT_SESSION | spine | market activity | `T-oDLt-C0358` | now? Now we wait for the market to trade |
| 16986-17053 | entry_conditions | WAIT_CONFIRMATION | confluence | engulfing candle | `},{` | and then give us an engulfing candle playing price action forward. |
| 17468-17485 | entry_conditions | ENABLE_ENTRY | trigger | second position entry | `T-oDLt-C0371` | second position? |
| 17511-17601 | entry_conditions | EXIT_HINT | spine | daily fvg | `},{` | The market traded all the way to that daily fair value gap and we're out of this position |
