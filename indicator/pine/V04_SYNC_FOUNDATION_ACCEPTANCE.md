# Slumdawg v0.4 Sync Foundation — TradingView Acceptance

Status: REQUIRED / NOT YET PLATFORM-CERTIFIED

This gate validates chart synchronization and the reset-view fix before the trendline ladder is added. Do not skip it.

## Source under test
`indicator/pine/slumdawg_platform_parity_v0_4_sync_foundation.pine`

Paste the exact committed source into TradingView Pine Editor unchanged.

## A. Compile gate
- Pine v6 compiles with zero errors.
- Do not hand-edit source in TradingView to make an error disappear.
- Record exact TradingView compiler error text if any.

## B. Chart identity gate
Use active NQ or MNQ contract on a standard 5-minute candle chart.
- Coach must report `5 MIN ✓`.
- Wrong timeframe must display `CHANGE CHART TO 5 MIN` and never look actionable.
- Engineering diagnostics, when enabled, must show the same root/contract/timeframe that TradingView shows.

## C. Reset Chart View / autoscale P0 gate
Run all captures on the same symbol, timeframe, zoom, and window size.
1. Remove all Slumdawg indicator instances. Press Reset Chart View. Capture screenshot A.
2. Add v0.4 with defaults; GO LINE and SAFE TARGET remain unset. Press Reset Chart View. Capture screenshot B.
3. B must retain a normal candle-readable price range; no hidden 0/sentinel object may pull the chart away from price.
4. By default only the nearest two of PDH/PDL/PWH/PWL are drawn. All four values remain available in diagnostics.
5. Set a valid nearby GO LINE and press Reset Chart View. Capture screenshot C.
6. Set a valid nearby SAFE TARGET zone and press Reset Chart View. Capture screenshot D.
7. If any capture materially compresses price compared with A beyond the legitimate active price objects, gate FAILS.

Important: TradingView documents that overlay indicator graphics can influence Auto scale. The script therefore removes inactive sentinel coordinates and limits D/W chart drawings by visual relevance. If legitimate active price objects still cause unacceptable scale behavior, record it rather than hiding it; the release gate remains open.

## D. D/W freshness gate
Compare the script labels against TradingView's own completed Daily and Weekly candles to the exact valid tick.

Required cases:
1. Friday after close / before Sunday reopen.
2. Sunday after 18:00 ET reopen.
3. Monday live session.
4. Extended holiday/no-new-bar gap.

Expected safety behavior:
- normal closed gap may bridge to the just-completed D/W candle only when its HTF `time_close` is already in the past and the last chart bar is within the bounded normal-closed gap;
- open/realtime session uses confirmed prior D/W values;
- extended close does not self-certify and must show `EXTENDED CLOSE — VERIFY LEVELS`.

No mismatch is accepted as "close enough". Record platform candle construction differences instead of silently correcting them.

## E. Beginner UI gate
Normal mode must be readable without engineering vocabulary:
- BIG DIRECTION
- CURRENT MOVE
- NEXT WALL
- GO LINE
- SAFE TARGET
- NOW
- SYSTEM

`NOT SET` BIG DIRECTION must not be described as with-trend or countertrend.

The current v0.4 foundation intentionally says `NEXT WALL — NOT LOADED — TRENDLINE LADDER NEXT`; that is honest, not a missing-label defect. Automatic trendline/GO/target selection is not certified yet.

## F. 5-minute parity safety
The parity engine remains OFF by default and live approval remains hard-coded false.
If test engine is enabled for a controlled case:
- one realtime update advances at most one stage;
- one spike cannot manufacture BREAK + PUSH 1 + READY;
- doji veto remains active;
- recoil resets;
- Candle-2 failure / Candle-3 starts fresh;
- parity alerts remain NON-ACTIONABLE.

## Pass condition
This foundation can advance to the multi-timeframe green/red trendline ladder only after:
- exact source compiles unchanged;
- Reset Chart View case passes;
- chart identity is correct;
- D/W required cases are captured and reconciled;
- no unexplained platform discrepancy remains.

Passing this file does NOT certify market edge, win rate, automatic GO LINE selection, automatic SAFE TARGET selection, or live-decision support.
