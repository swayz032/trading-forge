# Golden Fixture Contract

Every user-approved screenshot/video example should become a permanent fixture before automation claims semantic parity.

Each fixture must record:
- fixture id and source date/time if known
- instrument and platform
- 5m execution context plus referenced 15m/1H/4H/D/W levels
- expected persistent BIG DIRECTION (`UP` / `DOWN` / `BUILDING`) and the protected higher-timeframe structure concept that keeps it valid
- expected CURRENT MOVE (`UP WITH DIRECTION`, `DOWN WITH DIRECTION`, `UP PULLBACK`, `DOWN PULLBACK`, or `BUILDING`)
- expected ACTIVE PLAN (`LONG`, `SHORT`, or `WAIT`)
- why a strong countertrend rally/pullback does or does not reverse BIG DIRECTION
- reaction zones / shelves with exact bounds and source timeframe/evidence lane
- both structural Entry Zones when present
- active yellow proof/reference level
- why nearer/random wicks were rejected
- whether/why the Entry Zone auto-adjusts after a new confirmed pullback swing
- printed reference candle id and extreme
- expected `BREAK`, `PUSH_1`, `ENTRY_READY`, `RECOIL_RESET`, or bar-reset transitions
- candle geometry features when relevant: body fraction, wick fractions, close location, displacement, rejection side
- expected candle-sequence display state when relevant, e.g. `REJECTION -> ENGULF`
- expected entry lane: `STANDARD` or research-only `QUALIFIED_MOMENTUM_ENTRY`
- doji veto if applicable
- TP1/TP2/TP3 reaction shelf bounds and expected conservative penetration location
- explicit rejected isolated TP wicks / entry-neighbor zones
- expected TP visibility reason if no target is shown: `NO QUALIFIED SHELF` versus `DATA/DETECTOR UNAVAILABLE`
- expected top-right `🤖 SLUMDAWG TRADERS` values
- reason codes for every rejected candidate and state transition that matters to the fixture

## Acceptance rule

After fixture approval, later code changes must reproduce the same reason-coded decisions from the same normalized market inputs. If behavior changes, the test must fail until either:
1. the implementation is corrected, or
2. the trading specification is explicitly versioned and the fixture is deliberately re-approved.

## Positive and negative fixtures

Entry/candlestick research must include both:

- user-approved positive examples; and
- failed/look-alike examples that visually resemble the positive setup but should be rejected.

A winning screenshot alone is never sufficient to promote a candle-pattern or momentum-entry rule.

## Historical-order warning

No screenshot may be used as a future-aware backtest. It is a semantic fixture only unless complete lower-timeframe event data is available. Ordinary historical 5m OHLC must not be used to invent intrabar ordering for BREAK/PUSH state transitions.
