# v0.13 Simple Multi-Timeframe 5M Board Acceptance

Status: PLATFORM PARITY / RESEARCH ONLY. Not live-decision-support approved.

## Purpose
Recover the simple, visible trendline behavior that worked in the early automatic build without touching the now-correct key-level engine.

## Frozen separation
- PDH/PDL/PWH/PWL are an independent subsystem and remain available on every chart timeframe.
- Trendlines are rendered on the 5-minute chart only.
- No `scale = scale.none`; all price drawings use the main symbol price scale.
- Trendline work must not change the completed Daily/Weekly level bridge.

## v0.13 baseline geometry
Each source timeframe is detected independently: Monthly, Weekly, Daily, 4H, 1H, 15M, 5M.

For each source timeframe:
- RED A starts from the highest confirmed extreme inside the frozen structural window.
- GREEN A starts from the lowest confirmed extreme.
- B is a newer directional confirmed swing.
- A->B must be clean; a candidate that cuts intervening source candles is rejected.
- A later cross after B marks the accepted line VIOLATED instead of deleting it.
- Missing Monthly/Weekly/etc. cannot erase unrelated lower-timeframe lines.

Parent-B -> child-A family filtering is intentionally deferred until this independent board visibly renders the expected lines. This is a controlled simplification, not a change to the final rulebook.

## Mandatory TradingView gate
1. Remove the prior indicator instance and add v0.13 fresh.
2. Open MNQ/NQ 5M.
3. Select the current candle for `Build/freeze board at`.
4. PDH/PDL must remain on their exact printed y-axis prices.
5. All qualified M/W/D/4H/1H/15M/5M GREEN/RED lines must render together on 5M.
6. Solid line = active; faded dashed line = accepted but already violated before the freeze point.
7. Switching away from 5M may hide trendlines, but key levels must remain correct.
8. No runtime error, historical-buffer error, or long pathological load is acceptable.

Only after this baseline visually passes may parent-family connection filtering be added. Key levels remain frozen throughout that lane.
