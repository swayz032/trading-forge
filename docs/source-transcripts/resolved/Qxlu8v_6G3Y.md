# Qxlu8v_6G3Y — `put_limit_order_right_fvg_mcl_5m`

- transcript: `raw/Qxlu8v_6G3Y.txt` — 15767 chars, sha256 `460878e0b3c131057c596165a8d025bd2117a4c26d7bc18d04deeb977312933f`
- `direction` = `long`
- `entry_trigger_id` = `ENABLE_ENTRY:put limit order right fvg#0`
- `framework_overlay` = `{'stop': 'framework_owned', 'sizing': 'framework_owned', 'take_profit': 'framework_owned'}`
- `binding_plan_summary` = `{}`

Every row below is `transcript_text[span.start:span.end]` — the teacher's exact
words, verbatim, in source order. `object` is the compiler's short label and is NOT
the source. `evidence` is shown as stored, including the `},{` corruption reported
in AR-1042.

| span | bucket | type | role | `object` | `evidence` (as stored) | TEACHER'S WORDS via span |
|---|---|---|---|---|---|---|
| 4873-4963 | entry_conditions | WAIT_SESSION | confluence | trading duration limit | `T-Qxlu-C0081` | We want to get in the market and make consistent profits in less than 90 minutes per day, |
| 5226-5307 | entry_conditions | WAIT_SESSION | confluence | trading day start time | `T-Qxlu-C0086` | Now, to start off your trading day, you want to get to your desk right at 9:30 a. |
| 5614-5681 | entry_conditions | WAIT_SESSION | confluence | nasdaq futures markets | `T-Qxlu-C0092` | Now, in this example, we're looking at the Nasdaq futures markets, |
| 6161-6248 | entry_conditions | WAIT_SESSION | confluence | time window | `T-Qxlu-C0103` | we want to be on our 15-minute chart, and we're going to wait until the 9:30 to 9:45 a. |
| 6679-6725 | entry_conditions | WAIT_BIAS | spine | market direction | `if we don't know which direction the mar` | if we don't know which direction the market's |
| 6786-6871 | entry_conditions | WAIT_SESSION | spine | timeframe | `{T-Qxlu-C0115}` | And in order to confirm the market's direction, we need to go to the 5-minute chart. |
| 7044-7108 | entry_conditions | WAIT_CONFIRMATION | spine | displacement break | `{T-Qxlu-C0119}` | to wait for a displacement break of either the high or the low. |
| 7263-7366 | entry_conditions | FILTER | confluence | displacement break | `},{` | We need a very specific type of pattern to occur through this level in order to constitute of a break. |
| 7630-7677 | entry_conditions | FILTER | confluence | losing trades | `T-Qxlu-C0126` | That way, we can filter out the losing trades. |
| 8176-8219 | entry_conditions | WAIT_STRUCTURE | spine | breakout high | `T-Qxlu-C0135` | And since we broke through the high of the |
| 8219-8293 | entry_conditions | CONFIRM_DIRECTION | spine | direction is bullish | `T-Qxlu-C0136` | first 15-minute range, the direction is bullish and we've confirmed that. |
| 8801-8873 | entry_conditions | WAIT_STRUCTURE | spine | fvg prints 5 minute chart through first 15 minute range | `T-Qxlu-C0144` | As soon as the fair value gap prints on the 5-minute chart through that |
| 8873-8962 | entry_conditions | ENABLE_ENTRY | trigger | put limit order right fvg | `T-Qxlu-C0145` | first 15-minute range, we're actually good to put a limit order right on that fair value **⟵ ENTRY TRIGGER** |
| 9123-9244 | entry_conditions | FILTER | spine | fvg to be valid one three candles has to close outside 15 minute range | `T-Qxlu-C0148` | Now, in order for the fair value gap to be valid, one of the three candles has to close outside of this 15-minute range. |
| 9325-9381 | entry_conditions | WAIT_RETEST | spine | market dip into zone | `T-Qxlu-C0151` | if the market dips down back into this zone right here. |
| 9381-9498 | entry_conditions | ENABLE_ENTRY | trigger | entry into market | `T-Qxlu-C0152` | It could go all the way up here, as long as it dips down into that zone, we're going to get entered into the market. |
| 12893-13027 | entry_conditions | WAIT_SESSION | spine | live trading access | `T-Qxlu-C0201` | My traders get access to live trading 5 days per week in both the London and New York session watching executions on a shared screen. |
| 13069-13084 | entry_conditions | WAIT_CONFIRMATION | spine | execution timing | `T-Qxlu-C0203` | when to do it. |
