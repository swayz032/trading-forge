# Groundability audit — n=8 corpus (2026-06-30)

Stage 1+2 of the semantic-grounding track: every condition object the compiler emitted across the
n=8 corpus, classified against the engine's REAL primitives (structure_engine / liquidity-map /
indicator-catalog DSL archetypes / killzone / htf_narrative / bias_engine / smt_divergence / DSL
bar-comparisons). Statuses: native (evaluator exists) / composite (combinable from existing) /
needs_new (no path) / ambiguous (too vague to bind).

## Overall Groundability Coverage

**72.7%** of 410 conditions ground to existing engine machinery (native 235 + composite 63); needs_new 30, ambiguous 82.

## By semantic family

| family | native | composite | needs_new | ambiguous | total | grounded |
|---|---|---|---|---|---|---|
| unclassified | 0 | 0 | 0 | 82 | 82 | 0.0% |
| market_structure | 58 | 7 | 0 | 0 | 65 | 100.0% |
| entry_execution | 57 | 0 | 0 | 0 | 57 | 100.0% |
| session_time | 42 | 13 | 0 | 0 | 55 | 100.0% |
| bias_direction | 50 | 0 | 0 | 0 | 50 | 100.0% |
| price_action | 1 | 9 | 21 | 0 | 31 | 32.3% |
| ict_zone | 0 | 25 | 0 | 0 | 25 | 100.0% |
| indicator | 13 | 4 | 7 | 0 | 24 | 70.8% |
| liquidity | 14 | 5 | 0 | 0 | 19 | 100.0% |
| risk_framework | 0 | 0 | 2 | 0 | 2 | 0.0% |

## Per transcript

| transcript | conditions | coverage | needs_new | ambiguous |
|---|---|---|---|---|
| psH--oXkD8M | 17 | 88.2% | 1 | 1 |
| l-2iKbcm5UI | 32 | 100% | 0 | 0 |
| h6TnE7QClJg | 31 | 67.7% | 7 | 3 |
| MKsjbL0WNjg | 119 | 67.2% | 21 | 18 |
| e-QmGJU1XYc | 28 | 64.3% | 0 | 10 |
| 9dErM4MFCTY | 20 | 75% | 0 | 5 |
| qwLbJfBTZYA | 61 | 72.1% | 0 | 17 |
| 8PYgFVB0GHE | 102 | 71.6% | 1 | 28 |

## Ungroundable conditions (the explicit work queue — nothing silently dropped)

### needs_new (30)
- [price_action] price rejection 15m candle high — no native candle-pattern evaluator (bounce_off_level embeds rejection internally; standalone detector unbuilt)
- [indicator] cci crossing zero line upwards — REJECTED by indicator-catalog policy ('fails diversity gate vs RSI') — never silently proxy
- [indicator] when cci drops below zero bearish momentum is building — REJECTED by indicator-catalog policy ('fails diversity gate vs RSI') — never silently proxy
- [indicator] cci indicator — REJECTED by indicator-catalog policy ('fails diversity gate vs RSI') — never silently proxy
- [indicator] cci sma line signal line — REJECTED by indicator-catalog policy ('fails diversity gate vs RSI') — never silently proxy
- [indicator] cci lines to monitor — REJECTED by indicator-catalog policy ('fails diversity gate vs RSI') — never silently proxy
- [indicator] cci — REJECTED by indicator-catalog policy ('fails diversity gate vs RSI') — never silently proxy
- [indicator] cci below zero — REJECTED by indicator-catalog policy ('fails diversity gate vs RSI') — never silently proxy
- [price_action] focus weakness — educator-idiolect 'weakness' (reversal-rejection concept, MKsj two-line) — detector requires explicit definition
- [price_action] weakness definition 1 — educator-idiolect 'weakness' (reversal-rejection concept, MKsj two-line) — detector requires explicit definition
- [price_action] weakness definition 2 — educator-idiolect 'weakness' (reversal-rejection concept, MKsj two-line) — detector requires explicit definition
- [price_action] weakness definition 3 — educator-idiolect 'weakness' (reversal-rejection concept, MKsj two-line) — detector requires explicit definition
- [price_action] rejection — no native candle-pattern evaluator (bounce_off_level embeds rejection internally; standalone detector unbuilt)
- [price_action] spot weakness — educator-idiolect 'weakness' (reversal-rejection concept, MKsj two-line) — detector requires explicit definition
- [price_action] bearish candle close — no native candle-pattern evaluator (bounce_off_level embeds rejection internally; standalone detector unbuilt)
- [price_action] bullish candle close — no native candle-pattern evaluator (bounce_off_level embeds rejection internally; standalone detector unbuilt)
- [price_action] bullish candle close with weakness — no native candle-pattern evaluator (bounce_off_level embeds rejection internally; standalone detector unbuilt)
- [price_action] price weakness — educator-idiolect 'weakness' (reversal-rejection concept, MKsj two-line) — detector requires explicit definition
- [price_action] weakness and opposite closure same candle — educator-idiolect 'weakness' (reversal-rejection concept, MKsj two-line) — detector requires explicit definition
- [price_action] low with weakness — educator-idiolect 'weakness' (reversal-rejection concept, MKsj two-line) — detector requires explicit definition
- [price_action] weakness below both lines — educator-idiolect 'weakness' (reversal-rejection concept, MKsj two-line) — detector requires explicit definition
- [price_action] valid high taken with weakness closing lower — educator-idiolect 'weakness' (reversal-rejection concept, MKsj two-line) — detector requires explicit definition
- [price_action] weakness — educator-idiolect 'weakness' (reversal-rejection concept, MKsj two-line) — detector requires explicit definition
- [price_action] confirmation candle — no native candle-pattern evaluator (bounce_off_level embeds rejection internally; standalone detector unbuilt)
- [risk_framework] entry point target definition — framework-overlay.ts (overlay-owned — must NOT be an entry condition)
- [price_action] weakness into key level — educator-idiolect 'weakness' (reversal-rejection concept, MKsj two-line) — detector requires explicit definition
- [price_action] weakness — educator-idiolect 'weakness' (reversal-rejection concept, MKsj two-line) — detector requires explicit definition
- [price_action] price having weakness from level — educator-idiolect 'weakness' (reversal-rejection concept, MKsj two-line) — detector requires explicit definition
- [price_action] weakness within structure — educator-idiolect 'weakness' (reversal-rejection concept, MKsj two-line) — detector requires explicit definition
- [risk_framework] stop loss level — framework-overlay.ts (overlay-owned — must NOT be an entry condition)

### ambiguous (82)
- waiting state
- trade
- three fast steps
- search bar
- specific pattern
- new year continuation
- framework application time
- wait
- stop day
- current validity
- next day so day we have one trade is valid
- end trading day
- valid
- trading activity
- i ll take it
- i could still take it
- now you don t need to take it
- okay 50 because i think is still high probability
- longs
- price action going higher from current point
- continuation higher
- and then i would be buying
- low
- uptrend
- low validation
- price
- downtrend
- downtrend confirmation
- steps 1 and 2
- trade
- price
- trade
- start time
- time
- rows layout setting
- first three candles
- stop out event within trading window before 11 00 m
- previous candle closure
- presence two things
- crt
- mnq mes
- uptrend
- appearance
- timeframes
- news events
- trading activity
- validity
- price location
- time constraint
- market activity
- wednesday
- market state
- market condition
- trading right off open
- trade upload to tradzella
- execution
- and then instantly reverse
- s p 500
- downtrend
- but it didn t
- … +22 more

## Next (Stage 3 — Ledger F live)

`ledgerF(spec)` (condition-grounding.ts) already enforces: every condition classified exactly once,
ungroundable explicitly reported, framework leakage cross-checked. Raising coverage = building the
needs_new evaluators + tightening compression on the ambiguous tail (many ambiguous objects are
vague predicates that should have folded — a compression refinement, not an evaluator gap).
