# Slumdawg — FX Replay / FXR Script Overlay Bundle

Status: PLATFORM PARITY RESEARCH. NOT LIVE-DECISION-SUPPORT APPROVED.

FX Replay officially documents FXR Script as its custom-indicator language and documents `mtf.timeframe()` as a single requested timeframe configured once in `init()`. Because Slumdawg currently needs independent 15m, Daily, and Weekly native contexts, the first robust FXR port is intentionally split into small overlays rather than pretending one MTF request can serve all three contexts.

## Add these three custom indicators to the same FX Replay chart

1. `slumdawg_entry_v0_1.fxr.js`
   - intended chart: 5m execution view
   - requests 15m structure
   - draws both yellow structural proof boundaries:
     - LONG ENTRY = highest recent confirmed 15m swing-high wick
     - SHORT ENTRY = lowest recent confirmed 15m swing-low wick
   - initial research memory = 8 confirmed swings per side
   - strict 2-left / 2-right confirmation

2. `slumdawg_daily_levels_v0_1.fxr.js`
   - requests native Daily data
   - PDH / PDL = previous completed Daily candle high / low

3. `slumdawg_weekly_levels_v0_1.fxr.js`
   - requests native Weekly data
   - PWH / PWL = previous completed Weekly candle high / low

## Why this is a bundle instead of one giant FXR script

The documented FXR MTF API says to call `mtf.timeframe()` only once inside `init()`. The first port therefore keeps each requested source timeframe in its own tiny overlay. This avoids undocumented multi-MTF behavior and makes parity failures easy to isolate.

## Runtime gate

These sources are prepared but cannot be called FXR-parity PASS until they are pasted into the FX Replay Editor and run against the user-approved examples. Required first checks:

- no syntax/runtime errors;
- exact yellow levels reproduce the approved structural examples where the 8-swing hypothesis is expected to fit;
- PDH/PDL match FX Replay's prior completed native Daily candle;
- PWH/PWL match FX Replay's prior completed native Weekly candle;
- replay pause/resume/rewind does not leak future state;
- no unexplained mismatch against the Python reference / TradingView port.
