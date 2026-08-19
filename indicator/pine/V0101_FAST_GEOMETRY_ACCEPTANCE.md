# Slumdawg v0.10.1 Fast Geometry Acceptance

Status: PLATFORM PARITY / RESEARCH ONLY. Not live-decision-support approved.

## Why this build exists

v0.9 loaded slowly and v0.10 exceeded TradingView's execution-time budget. Both are performance failures. v0.10.1 changes the Pine execution architecture without relaxing the trendline geometry contract.

## Performance architecture

- Host script history is bounded with `calc_bars_count`.
- Every `request.security()` call is explicitly bounded with `calc_bars_count`.
- There is one compact GREEN/RED geometry request per structural timeframe: Monthly, Weekly, Daily, 4H, 1H, 15M, 5M.
- Heavy structural scans execute only on the last bar of each requested source context.
- Candidate B searches are capped at 12 structural candidates per color per timeframe.
- Full-candle no-intersection validation remains mandatory for every accepted fresh candidate.
- The old v0.10 `ta.valuewhen()` snapshot engine and repeated all-history brute-force scans are not used.

## Geometry that must not regress

- RED root A is the highest price extreme in the frozen analysis window; GREEN root A is the lowest.
- Every accepted line requires A and B.
- Lower-timeframe children inherit exact parent B as child A.
- Fresh RED rays reject candle-high penetration; fresh GREEN rays reject candle-low penetration beyond tolerance.
- Same-path child candidates remain filtered by parent/child separation.
- A/B geometry is rendered with `xloc.bar_time` and must be identical across host chart timeframes.
- Monthly -> Weekly -> Daily -> 4H -> 1H -> 15M -> 5M lines are available on every supported chart timeframe.
- Coach has a user-facing Show/Hide checkbox and must not control geometry state.

## Platform acceptance sequence

1. Remove prior indicator instance and add v0.10.1 fresh.
2. On 5M, select the board freeze point once.
3. First-load performance must no longer raise TradingView's `script takes too long to execute` failure.
4. Switch 5M -> 15M -> 1H -> 4H -> Daily -> Weekly -> Monthly -> 5M.
5. The board must not gain, lose, rotate, or move lines merely because the host timeframe changed.
6. Confirm root RED/GREEN anchors against the user's hand-drawn pink examples.
7. Reject the build if any fresh ray visibly cuts through price before its freeze point.
8. Toggle Show Slumdawg coach OFF/ON and confirm chart geometry remains unchanged.

## Release gate

A compile pass is not enough. A build fails this lane if it times out, remains materially slow to load/switch, or changes geometry across chart timeframes. Performance and visual correctness are both release-blocking.
