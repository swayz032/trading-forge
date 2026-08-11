# MNQU2026 map-level visibility + live TP re-anchor — v0.21.1 golden fixture

Status: **USER-VISUAL SEMANTIC FIXTURE / RESEARCH ONLY**

Platform: TradingView
Symbol: MNQU2026
Chart: 5m
Reviewed date: 2026-08-11

## Operator corrections frozen here

### PDH / PDL

- PDH and PDL are independent completed Daily levels.
- A valid PDH must not disappear because PDL is temporarily unavailable, and vice versa.
- They remain map levels even when they are not the active plan's NEXT WALL.

### PWH / PWL

- PWH and PWL are independent completed Weekly levels.
- They remain conditional in normal mode: show them when they are close/relevant to the current planning area, hide them when they are not relevant to avoid clutter.
- Weekly visibility must not require both PDH and PDL to be simultaneously valid.
- v0.21.1 defines the research planning horizon from available Daily map distance plus the current structural LONG/SHORT GO distances. This is a deterministic visibility rule, not a claim that the threshold is fully market-calibrated.

### LONG / SHORT TP ladders

- A TP ladder is attached to the current actionable yellow proof boundary, not permanently to the earlier structural GO after live proof has advanced.
- When LONG yellow ratchets upward, an old TP that is now behind/below yellow is retired and the next qualified physical reaction shelf is promoted/reselected as TP1.
- Mirror for SHORT when yellow ratchets downward.
- The ladder must not simply disappear because the old TP became invalid relative to the new proof line.
- If there is genuinely no qualified physical reaction shelf beyond the active proof boundary, the panel may say NO QUALIFIED TP1; it must not invent a target.

### Reaction shelf identity

- Full-body reaction zones belonging to one physical shelf can have different candle-body edges.
- Repeated reactions qualify by interval overlap/adjacency plus the calibrated tolerance, not by requiring nearly identical near-edge prices.
- Canonical same-shelf fusion remains before TP numbering.

## Acceptance checks

1. On the reviewed MNQU2026 5m replay, PDH must render whenever the previous completed Daily high is available.
2. PDL must render independently whenever the previous completed Daily low is available.
3. PWH/PWL must appear when the weekly level falls inside the deterministic planning horizon and remain hidden when outside it.
4. If live LONG proof advances above the prior LONG TP1, Slumdawg must reselect/promote the next qualified reaction shelf above yellow rather than only hiding TP1.
5. Mirror check for SHORT.
6. No LONG TP may print at/below displayed LONG yellow; no SHORT TP may print at/above displayed SHORT yellow.
7. Exact TradingView visual parity is still required before v0.21.1 is called platform-certified.
