# V1 Rulebook — Deterministic Trading Semantics

Status: specification baseline. No trading edge is claimed until all production gates pass.

## 1. Timeframe and instrument context

- Execution timeframe: 5 minutes.
- Intended market: NQ/MNQ futures.
- User timezone/display convention: America/New_York.
- The method is allowed to inspect 5m, 15m, 4h, Daily, and Weekly context.
- Daily/Weekly reference levels are copied from each platform's prior completed native candle rather than re-created from a custom session.

## 2. Semantic objects

### 2.1 Overall direction context (`OVERALL_DIRECTION`)

Source: user-selected red trendline / larger structure.

Allowed values:
- `BULLISH`
- `BEARISH`
- `UNKNOWN`

Authority:
- Provides big-picture directional context only.
- Does NOT create an entry.
- Does NOT flip intraday direction merely because price crosses the line.
- Does influence how conservative countertrend targets and proof-level selection should be.

### 2.2 Reaction zone (`REACTION_ZONE`)

Human-facing name may remain "Liquidity Pool".

Internally, a reaction zone means a historically observed price area where multiple candles/wicks and/or a major prior reaction create a candidate area for a future pause, pullback, continuation, or reversal.

This name is deliberately chosen because historical candles do not prove the presence of resting orders in the current order book.

Every zone must store:
- `zone_id`
- `timeframe`
- `lower_bound`
- `upper_bound`
- `near_edge_for_long`
- `near_edge_for_short`
- `midpoint`
- `far_extreme`
- `reaction_count`
- `age_bars`
- `origin_bar_ids`
- optional overlap flags: `PDH`, `PDL`, `PWH`, `PWL`
- deterministic quality features, never prose-only labels

Detection thresholds remain CALIBRATION-REQUIRED until measured on real NQ/MNQ data.

### 2.3 Yellow proof level (`PROOF_LEVEL`)

The yellow line is the location price must reach before the 5-minute momentum sequence is allowed to qualify an entry.

It is NOT the red trendline and it is NOT simply the closest wick.

Candidate requirements:
1. tied to a meaningful key level / reaction zone / swing structure;
2. sufficiently far from current price to clear ordinary noise and reduce fakeout risk;
3. not so far away that the move is already mature or impractical to reach;
4. leaves reasonable room to the next target zone;
5. for countertrend entries, must require materially more structural proof than a tiny local wick.

Distance must eventually be normalized to volatility and market structure; no fixed point distance is authorized by this spec.

### 2.4 Prior-day/prior-week levels

- `PDH` = high of the prior completed platform-native Daily candle.
- `PDL` = low of the prior completed platform-native Daily candle.
- `PWH` = high of the prior completed platform-native Weekly candle.
- `PWL` = low of the prior completed platform-native Weekly candle.

Cross-platform parity is not assumed. If FX Replay and TradingView disagree, the discrepancy must be logged, not hidden.

## 3. Two-plan entry model

The system may maintain two plans simultaneously.

Example when overall direction is bearish:
- Primary plan: bearish continuation entry.
- Alternative plan: bullish intraday pullback entry that requires a stronger/farther proof level.

Mirror when overall direction is bullish.

The alternative countertrend plan must never be labeled as an overall trend reversal unless a separate future rule explicitly proves that. V1 has no automatic overall-trend-flip rule.

## 4. Five-minute momentum state machine

### 4.1 Reference candle formation

A completed 5-minute candle beyond the selected proof level establishes the reference candle.

Short:
- proof is below the yellow level;
- reference extreme is the completed candle LOW.

Long:
- proof is above the yellow level;
- reference extreme is the completed candle HIGH.

If the completed reference candle is `DOJI_LIKE`, V1 vetoes the setup and waits for a new eligible reference candle.

Exact `DOJI_LIKE` body/range threshold is CALIBRATION-REQUIRED.

### 4.2 Live continuation sequence

After a valid reference exists:

`WAIT_BREAK -> BREAK -> PUSH_1 -> ENTRY_READY`

For shorts, favorable means lower prices.
For longs, favorable means higher prices.

Rules:
- Each state advance requires a distinct market update.
- One update may advance at most one state.
- Equal-price reprints cannot count as a fresh push.
- Push quality considers distance, elapsed time, recoil, wick growth, hold quality, and acceleration/deceleration.
- Exact thresholds are calibration inputs, not hard-coded doctrine.
- If recoil invalidates the active push chain, state resets to `WAIT_BREAK` against the same completed reference until the bar ends.
- If the 5-minute live candle ends before `ENTRY_READY`, the new candle begins with the just-finished candle's extreme as the new reference and the live push chain resets.

### 4.3 Fail-closed conditions

Return `NO_SIGNAL` / reset rather than guess when:
- malformed or non-finite price
- duplicate/out-of-order event sequence
- symbol/contract changes mid-state
- missing reference
- missing timeframe/context required by the active rule
- unresolved tie between candidate proof levels after deterministic tie-breakers
- platform-data mismatch that materially changes the selected level

## 5. Momentum quality

Human phrase: "good momentum".

Production inputs to be measured:
- favorable displacement distance
- elapsed time to displacement
- recoil as % of favorable push
- live wick growth
- body/range dominance
- hold near current extreme
- push-to-push acceleration/deceleration
- optional volume/footprint features only if ablation tests prove incremental value

The output may display `WEAK`, `MEDIUM`, `STRONG`, but the underlying numeric inputs and thresholds must be logged.

No single feature may be called "momentum" without the component breakdown.

## 6. Conservative target selection

A target is selected from a qualified reaction zone in the trade direction.

Long:
- target the near/lower side of the next upper reaction zone.

Short:
- target the near/upper side of the next lower reaction zone.

Do not require the farthest wick.

Context rules:
- weak move -> favor close valid reaction zone;
- strong with-trend move -> a very close minor zone may be skipped for the next major zone;
- countertrend move -> prefer the closer conservative reaction zone because overall context can resume;
- large displacement / "big candle mode" -> intermediate reaction zones inside the displacement may be valid entry or target candidates.

The exact zone penetration fraction must be learned from real data and pass stability tests. No arbitrary 50% rule is authorized.

## 7. Deterministic candidate tie-breakers

When two proof-level or target candidates have equal calibrated score, use this fixed tie order:

1. higher originating timeframe (4h > 15m > 5m);
2. stronger objective reaction evidence;
3. stronger overlap/confluence with PDH/PDL/PWH/PWL;
4. larger usable room to the next qualified destination;
5. more recent confirmed zone;
6. stable lexical `zone_id` as final deterministic tie-break.

This order can only change through a versioned spec change + regression tests.

## 8. Forbidden shortcuts

The following are explicitly forbidden:
- red trendline break => intraday bullish/bearish flip
- nearest wick => automatic proof level
- one huge price update => multiple momentum states
- historical bar hindsight => pretending intrabar order is known
- unconfirmed swing => historical signal
- exact far wick => mandatory TP
- silent default when a required feature is missing
- optimizing and testing on the same period, then calling it an edge
