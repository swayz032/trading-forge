# NMUd0oX_7Pg — `hammer_candle_long_side_mcl_5m`

- transcript: `raw/NMUd0oX_7Pg.txt` — 15246 chars, sha256 `d13846b244c497fa27b005feb96de4382f8dc2974068022ad39d00b8562652e8`
- `direction` = `long`
- `entry_trigger_id` = `ENTER:hammer candle long side#0`
- `framework_overlay` = `{'stop': 'framework_owned', 'sizing': 'framework_owned', 'take_profit': 'framework_owned'}`
- `binding_plan_summary` = `{'compiled': True, 'spine_bound': 22, 'spine_total': 25, 'trigger_bound': True, 'approximation_used': True}`

Every row below is `transcript_text[span.start:span.end]` — the teacher's exact
words, verbatim, in source order. `object` is the compiler's short label and is NOT
the source. `evidence` is shown as stored, including the `},{` corruption reported
in AR-1042.

| span | bucket | type | role | `object` | `evidence` (as stored) | TEACHER'S WORDS via span |
|---|---|---|---|---|---|---|
| 80-111 | entry_conditions | WAIT_SESSION | confluence | time | `T-NMUd-C0002` | Every single morning at 9:30 a. |
| 827-933 | entry_conditions | FILTER | confluence | quality | `T-NMUd-C0016 to T-NMUd-C0017` | seconds to apply and it filters out a lot of the weaker setups before you even consider entering a trade. |
| 1057-1123 | entry_conditions | WAIT_SESSION | confluence | chart selection | `},{` | Choose any chart depending on the asset you're planning to trade. |
| 1328-1381 | entry_conditions | WAIT_STRUCTURE | spine | first 15 minutes candle formed today | `T-NMUd-C0027` | first 15-minutes candle that formed on today's date. |
| 1627-1695 | entry_conditions | FILTER | spine | 15 minutes candle closure | `T-NMUd-C0034` | first 15-minutes candle has fully closed before marking your range. |
| 1695-1739 | invalidations | INVALIDATE | invalidation | candle formation status | `T-NMUd-C0035` | If the candle is still forming, you need to |
| 2244-2306 | entry_conditions | WAIT_BIAS | spine | manipulation candle characteristics | `},{` | it's fast. It's aggressive, and it's moving in one direction. |
| 3695-3836 | invalidations | INVALIDATE | invalidation | price reversal after selling pressure absorption | `T-NMUd-C0068` | They buy into that selling pressure at the price they wanted, fill their entire position, and price reverses back in the original direction. |
| 3836-3890 | invalidations | INVALIDATE | invalidation | breakdown validity | `T-NMUd-C0069` | That aggressive move down was never a real breakdown. |
| 3909-3950 | invalidations | EXCEPTION | invalidation | mechanism applicability | `T-NMUd-C0071` | This mechanism works in both directions. |
| 4666-4770 | entry_conditions | WAIT_CONFIRMATION | spine | opening candle qualification | `T-NMUd-C0082 to T-NMUd-C0083` | To confirm whether your opening candle actually qualifies as a manipulation candle, here's what you do. |
| 4770-4801 | entry_conditions | WAIT_SESSION | confluence | chart timeframe | `T-NMUd-C0082` | Switch over to the daily chart |
| 5077-5123 | entry_conditions | FILTER | confluence | candle size | `{current}` | If the size of the candle you just boxed from |
| 5284-5307 | entry_conditions | FILTER | confluence | candle range threshold | `T-NMUd-C0090` | That's your threshold. |
| 5540-5579 | entry_conditions | FILTER | confluence | price level 25 or higher | `T-NMUd-C0099` | But, 25% or higher is a dead giveaway. |
| 5664-5697 | entry_conditions | WAIT_SESSION | confluence | timeframe | `T-NMUd-C0101` | Drop down to a lower time frame. |
| 5697-5765 | entry_conditions | WAIT_SESSION | confluence | timeframe selection | `T-NMUd-C0102` | I prefer the 5-minute chart, though you can use 3-minute, 2-minute, |
| 5783-5901 | entry_conditions | WAIT_CONFIRMATION | spine | reversal candles | `T-NMUd-C0104` | From here, you're waiting for one of two specific reversal candles to appear outside the range you boxed in step one. |
| 5961-6028 | invalidations | INVALIDATE | invalidation | move continuation | `T-NMUd-C0106` | if neither of these candles appears, the move could just continue. |
| 6231-6312 | entry_conditions | FILTER | spine | time window location | `T-NMUd-C0111` | And they must appear outside the box within 60 to 90 minutes of the market open. |
| 6312-6363 | invalidations | INVALIDATE | invalidation | opportunity window | `T-NMUd-C0112` | After that window closes, the opportunity is gone. |
| 6420-6454 | entry_conditions | ENTER | trigger | hammer candle long side | `{T-NMUd-C0117}` | Take the hammer on the long side. **⟵ ENTRY TRIGGER** |
| 6475-6514 | entry_conditions | WAIT_BIAS | spine | sharp red move downward | `{T-NMUd-C0119}` | after a clear sharp red move downward. |
| 6871-6884 | entry_conditions | WAIT_STRUCTURE | spine | next candle to break above hammer high | `{T-NMUd-C0124}` | Wait for the |
| 6884-6960 | entry_conditions | ENTER | trigger | entry | `{T-NMUd-C0125}` | next candle to break above the hammer high, enter at the open of the candle |
| 7368-7456 | entry_conditions | ENABLE_ENTRY | trigger | entry limit order | `T-NMUd-C0135` | red candle. I like to set my entry limit order at the high of that previous red candle. |
| 7612-7683 | entry_conditions | ENTER | trigger | entry point | `{T-NMUd-C0139}` | Entry at the low of the previous green candle, stop at the high of the |
| 7833-7963 | entry_conditions | WAIT_CONFIRMATION | spine | reversal pattern | `{T-NMUd-C0143}` | So, right away, we know we are looking for a bullish reversal below the range, specifically a hammer or bullish engulfing candle. |
| 7963-8007 | entry_conditions | WAIT_SESSION | spine | 5 minute chart | `T-NMUd-C0144` | We drop to the 5-minute chart and we watch. |
| 8221-8250 | entry_conditions | ENTER | trigger | break next candle | `T-NMUd-C0152` | We enter at the break of the |
| 8263-8288 | entry_conditions | EXIT_HINT | spine | stop goes below low | `T-NMUd-C0154` | Stop goes below the low. |
| 8479-8523 | entry_conditions | WAIT_STRUCTURE | spine | low opening candle and high | `},{` | The low of the opening candle and the high. |
| 10184-10241 | entry_conditions | WAIT_BIAS | spine | these manipulation candles are often even more prominent | `},{` | These manipulation candles are often even more prominent |
| 10716-10813 | entry_conditions | FILTER | confluence | opening 15 minute candle range | `T-NMUd-C0200` | If the opening 15-minute candle has a range greater than this value, it's a manipulation candle. |
| 10813-10827 | entry_conditions | WAIT_SESSION | confluence | market open | `T-NMUd-C0201` | Market opens. |
| 10827-10854 | entry_conditions | WAIT_BIAS | confluence | stock gap up slightly | `T-NMUd-C0202` | The stock gaps up slightly |
| 10854-10877 | entry_conditions | WAIT_BIAS | confluence | stock starts moving | `T-NMUd-C0203` | and then starts moving |
| 11070-11126 | invalidations | INVALIDATE | invalidation | trade window duration | `},{` | after the 90-minute window, the trade is off the table. |
| 11164-11204 | entry_conditions | WAIT_BIAS | spine | bullish reversal | `so we're hunting for a bullish reversal` | so we're hunting for a bullish reversal |
| 11204-11243 | entry_conditions | FILTER | trigger | entry location | `below the range on the 5-minute chart.` | below the range on the 5-minute chart. |
| 11288-11324 | invalidations | INVALIDATE | invalidation | bullish reversal attempt | `but they're still inside the range.` | but they're still inside the range. |
| 11343-11389 | entry_conditions | FILTER | spine | reversal formation | `T-NMUd-C0217` | You need the reversal to form outside the box |
| 11389-11421 | entry_conditions | WAIT_BIAS | spine | directional push | `T-NMUd-C0218` | after a clear directional push. |
| 11813-11834 | entry_conditions | ENABLE_ENTRY | trigger | trade entry status | `We are in the trade.` | We are in the trade. |
| 11976-12018 | entry_conditions | WAIT_CONFIRMATION | trigger | re entry into range | `},{` | It re-enters the range, a promising sign. |
| 12566-12660 | entry_conditions | WAIT_SESSION | spine | volume indicator | `},{` | Volume. To add this to your chart, check on indicators at the top of your TradingView screen. |
| 13312-13411 | entry_conditions | WAIT_STRUCTURE | spine | opening 15 minute candle close | `T-NMUd-C0254` | When that opening 15-minute candle closes, before you do anything else, glance down at the volume. |
| 13445-13515 | entry_conditions | FILTER | spine | volume comparison | `T-NMUd-C0256` | Is the volume of this candle above or below that moving average line? |
| 14036-14060 | entry_conditions | WAIT_BIAS | spine | manipulation likelihood | `{T-NMUd-C0267}` | Manipulation is likely, |
| 14082-14104 | entry_conditions | WAIT_STRUCTURE | spine | market readiness reversal | `{T-NMUd-C0269}` | ready to reverse yet. |
| 14104-14128 | entry_conditions | INVALIDATE | trigger | do not force entry | `},{` | Do not force the entry. |
| 14128-14201 | entry_conditions | WAIT_CONFIRMATION | spine | wait reversal candle signal in step three before doing anything | `},{` | Wait for the reversal candle signal in step three before doing anything. |
| 14243-14295 | entry_conditions | FILTER | spine | scenario three large candle volume below average | `},{` | Scenario three, large candle, volume below average. |
| 14466-14526 | invalidations | INVALIDATE | invalidation | treat with extra caution or skip it entirely and | `{T-NMUd-C0278}` | Treat this setup with extra caution or skip it entirely and |
| 14526-14576 | entry_conditions | WAIT_SESSION | spine | wait cleaner opportunity following day | `{T-NMUd-C0279}` | wait for a cleaner opportunity the following day. |
| 14831-14882 | entry_conditions | WAIT_BIAS | spine | institutional money readiness | `{T-NMUd-C0283, T-NMUd-C0285}` | now ready to push price in the opposite direction. |
