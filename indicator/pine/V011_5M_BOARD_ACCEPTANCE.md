# Slumdawg v0.11 — 5M-only frozen board acceptance

Status: PLATFORM PARITY / RESEARCH ONLY. Not live-decision-support approved.

## Architecture decision

V1 no longer promises one script instance that recalculates the full board correctly on every host chart timeframe. The supported execution/view surface is the 5-minute NQ/MNQ chart only.

The 5-minute chart must render the complete accepted hierarchy together:

Monthly -> Weekly -> Daily -> 4H -> 1H -> 15M -> 5M.

The operator should not need to open higher chart timeframes to make those higher-timeframe rays appear.

## Mandatory geometry

- RED root A begins at the highest structural extreme in its frozen source-timeframe window.
- GREEN root A begins at the lowest structural extreme.
- A/B are immutable after the selected freeze snapshot.
- A child inherits the last accepted parent B as child A.
- Fresh candidate rays must pass full source-candle envelope validation from A through the freeze snapshot; A/B anchor bars may touch.
- A fresh RED ray is rejected when a source candle high exceeds the minimum ray height across that candle beyond tolerance.
- A fresh GREEN ray is rejected when a source candle low falls below the maximum ray height across that candle beyond tolerance.
- Trendline cross alone cannot create GO/READY or change BIG DIRECTION.

## Runtime/performance

- No `request.security_lower_tf()`.
- No request of 5-minute data from a higher host timeframe.
- No nested canonical 5-minute board request.
- Geometry uses equal/higher-timeframe `request.security()` calls from the 5-minute host only.
- Freeze reconstruction is event-driven at the historical freeze bar and carried forward, rather than rediscovered by scanning backward from the current bar on every reload.
- No `f_gate_pair_5m()` / recent lower-timeframe historical-offset gate.
- No TradingView historical-buffer runtime error at default inputs.
- No `Script takes too long to execute` at default inputs.

## D/W regression lock

PDH/PDL/PWH/PWL use the earlier completed Daily/Weekly bridge with normal closed-gap handling. PDH and PDL remain always visible when valid on the 5-minute chart. PWH/PWL remain conditional-near contextual levels.

## UI

- `Show Slumdawg coach` hides/shows the coach without changing board geometry.
- All Monthly/Weekly/Daily/4H/1H/15M/5M GREEN/RED rays have individual visibility controls.
- Chart timeframe other than 5m shows `SWITCH TO 5 MIN` and does not pretend the board is supported there.

## Platform gate

Required user test order:
1. Remove prior Slumdawg version.
2. Add v0.11 fresh on MNQ/NQ 5m.
3. Choose the current 5m candle for `Build/freeze board at`.
4. Confirm no compile/runtime error and acceptable load time.
5. Confirm PDH/PDL values against the latest intended completed Daily candle.
6. Confirm all accepted higher-timeframe rays are visible on 5m without visiting higher chart timeframes.
7. Compare ray anchors and geometry to the user's pink-line goldens.
8. Reject build on any fresh ray that visibly cuts through price or starts from the wrong structural extreme.

No software CI result substitutes for TradingView compile/runtime/visual acceptance.
