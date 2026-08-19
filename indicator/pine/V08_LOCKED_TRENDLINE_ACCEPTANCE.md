# Slumdawg v0.8 Locked Trendlines — TradingView Acceptance

Status: REQUIRED / NOT YET PLATFORM-CERTIFIED

Source: `indicator/pine/slumdawg_platform_parity_v0_8_locked_trendlines.pine`

## Regression that v0.8 fixes
The v0.6/v0.7 automatic trendline candidates could change as newer confirmed pivots appeared, which made the visible ray appear to move/chase price. That is not acceptable for the user's drawing semantics.

## Locked-anchor contract
- Structural candidates may be recalculated internally.
- Visible/logical trendline A/B timestamps and prices are captured once into a frozen snapshot.
- While `Trendline set` is unchanged, price movement and newly confirmed pivots MUST NOT alter any captured A/B anchor, slope, or originating swing.
- The ray may naturally extend forward in time from the same fixed A/B anchors.
- To intentionally rescan/re-anchor, increment `Trendline set` by 1.
- Show/hide picker toggles MUST NOT recapture or alter anchors.

## Structural hierarchy still required
- Prefer broad clean swing pairs instead of the latest nearby pair.
- Lower-timeframe close-up lines require a connected same-color bigger parent.
- Trendline crosses remain context only and never flip BIG DIRECTION or create GO/READY.

## Visual checks
1. Paste exact v0.8 source unchanged; Pine v6 must compile with zero errors.
2. Record a screenshot of all qualified lines.
3. Let price update for several realtime 5M bars without changing `Trendline set`.
4. Verify every line remains attached to exactly the same two historical swing anchors and keeps exactly the same slope.
5. Toggle one line OFF, then ON; verify it returns to the same anchors.
6. Increment `Trendline set` from 1 to 2; verify that this is the only user-controlled action that allows a fresh structural snapshot.
7. Verify PDH/PDL full-width display and Reset Chart View remain normal.

Passing this gate does not certify trading edge or live decision support.
