# Slumdawg v0.7 Hierarchical Trendlines — TradingView Acceptance

Status: REQUIRED / NOT YET PLATFORM-CERTIFIED

Source under test: `indicator/pine/slumdawg_platform_parity_v0_7_hierarchical_trendlines.pine`

## Why v0.7 exists
The user rejected v0.6's independent close-up 5M/15M trendlines. Their manual examples use larger structural rays first, connect two or more swing points, and only accept smaller/closer trendlines when they are connected to a bigger trendline. The user also requested all qualified trendlines to be visible by default, per-line show/hide controls, and no timeframe-name labels printed on the rays.

## A. Compile gate
- Paste the exact committed source unchanged into TradingView.
- Pine v6 must compile with zero errors.
- Do not hand-edit the source during this gate.

## B. Blue-level regression
- PDH and PDL remain visible whenever valid and span the full chart.
- PWH/PWL remain conditional on the existing visual-near rule and span the full chart when shown.
- Reset Chart View must remain candle-readable.

## C. Trendline drawing contract
- GREEN remains bullish/support-context geometry; RED remains bearish/resistance-context geometry.
- A candidate is not chosen merely because the latest two pivots are close to current price.
- Within each timeframe, prefer the widest clean qualifying pair among the last four confirmed swing pivots.
- Intervening swing pivots may not violate the candidate line by more than one instrument tick.
- Daily may establish a root line.
- 4H/1H may establish a root only if no valid same-color bigger parent exists; if a parent exists they must connect to it.
- 15M and 5M may never appear as standalone close-up roots. They require a valid same-color bigger parent and at least one anchor that connects to that parent's projected line within one instrument tick.
- A lower-timeframe line cross never flips BIG DIRECTION and never creates GO/READY.

## D. Picker contract
Under `2B — TRENDLINE PICKER`, all ten display toggles default ON:
- Daily GREEN / RED
- 4H GREEN / RED
- 1H GREEN / RED
- 15M GREEN / RED
- 5M GREEN / RED

Turning one OFF hides only that chart ray. Turning it ON restores it if the structural line is still qualified. The display choice does not silently delete the qualified line from internal NEXT WALL logic.

## E. No ray-name clutter
- No `5M GREEN`, `15M GREEN`, `D RED`, etc. labels are printed on the trendline rays.
- Timeframe/color names remain available only in Settings and internal logic.

## F. Golden visual comparison
Compare v0.7 directly against the user's 2026-08-09 pink manual trendline screenshots.
Required visual questions:
1. Does the automatic root line originate from the same broad structural swing family as the user's pink line?
2. Are local 5M/15M rays suppressed when they are not connected to a bigger line?
3. If a child ray appears, is its connection to a bigger line visually defensible?
4. Are any important user-drawn broad rays still missing?
5. Does showing all qualified lines remain readable, and does each picker toggle hide/restore the intended ray?

Any disagreement is evidence for another rule correction; do not tune thresholds ad hoc on the live chart.

## G. Existing release locks
- `PLATFORM_PARITY_ONLY` remains hard-coded.
- `LIVE_DECISION_SUPPORT_APPROVED=false` remains hard-coded.
- Test engine remains OFF by default.
- Debug alerts remain NON-ACTIONABLE.
- Automatic GO LINE / SAFE TARGET selection remains uncertified.

Passing this visual gate does not prove trading edge, win rate, or live-decision readiness.
