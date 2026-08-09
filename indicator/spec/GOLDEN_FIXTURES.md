# Golden Fixture Contract

Every user-approved screenshot/video example should become a permanent fixture before automation claims semantic parity.

Each fixture must record:
- fixture id and source date/time if known
- instrument and platform
- 5m execution context plus referenced 15m/4h/D/W levels
- overall red-trendline direction (`BULLISH` / `BEARISH` / `UNKNOWN`)
- blue reaction zones with exact bounds and source timeframe
- yellow primary proof level
- yellow alternative/countertrend proof level when present
- why nearer wicks were rejected
- printed reference candle id and extreme
- expected `BREAK`, `PUSH_1`, `ENTRY_READY`, `RECOIL_RESET`, or bar-reset transitions
- doji veto if applicable
- conservative TP zone and expected near-side penetration
- reason codes for every rejected candidate

## Acceptance rule

After fixture approval, later code changes must reproduce the same reason-coded decisions from the same normalized market inputs. If behavior changes, the test must fail until either:
1. the implementation is corrected, or
2. the trading specification is explicitly versioned and the fixture is deliberately re-approved.

No screenshot may be used as a future-aware backtest. It is a semantic fixture only unless complete lower-timeframe event data is available.
