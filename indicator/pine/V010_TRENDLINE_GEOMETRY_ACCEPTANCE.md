# Slumdawg v0.10 Trendline Geometry Rebuild — Acceptance Contract

Status: PLATFORM-PARITY / VISUAL-VALIDATION BUILD ONLY. NOT LIVE-DECISION-SUPPORT APPROVED.

## Purpose

Replace the failed v0.9 pivot-family renderer with one chart-timeframe-invariant trendline board that follows the operator's top-down drawing semantics.

Authoritative hierarchy:

**Monthly -> Weekly -> Daily -> 4H -> 1H -> 15M -> 5M**

## 1. Root anchor semantics

For each GREEN/RED family at board build time:

- RED major root begins at the highest confirmed structural high in the frozen source-timeframe analysis window.
- GREEN major root begins at the lowest confirmed structural low in the frozen source-timeframe analysis window.
- A root requires a later confirmed directional swing B.
- RED requires B.price < A.price.
- GREEN requires B.price > A.price.
- The root is not allowed to begin from a later local pivot merely because it is closer to current price.
- The analysis window is explicit/configurable in research builds; the current zoomed viewport must never select A.

## 2. Clean-ray rule

A fresh candidate is invalid if it already intersects price before the frozen board is accepted.

- RED: inspect actual source-timeframe candle highs from A through the board-freeze bar. A high above the projected ray beyond the configured research tolerance rejects the candidate.
- GREEN: inspect actual source-timeframe candle lows from A through the board-freeze bar. A low below the projected ray beyond tolerance rejects the candidate.
- A/B touches and later C/D/E touches within tolerance are allowed.
- Validation against pivot markers alone is insufficient.

## 3. Parent/child family rule

Lower-timeframe lines are not standalone two-pivot trendlines.

- Search top-down Monthly -> Weekly -> Daily -> 4H -> 1H -> 15M -> 5M.
- A child must attach to the nearest accepted higher-timeframe family structure.
- The canonical bridge is `child.A == parent.B` in time and price.
- If an intermediate timeframe cannot produce a clean child, the next lower timeframe may inherit from the nearest accepted ancestor.
- Orphan close-up lines are rejected.
- Same-path/near-overlap children are rejected.

## 4. Frozen board / host-timeframe invariance

For a given symbol/contract, freeze timestamp, inputs and board revision, every accepted line has immutable:

- A timestamp
- A price
- B timestamp
- B price
- direction
- source timeframe
- parent lineage

Those values must be identical when the host TradingView chart is switched among 5M, 15M, 1H, 4H, Daily, Weekly or Monthly.

Changing chart timeframe, zoom, visible history width, price scale, or Reset Chart View may change only the pixel projection. It must not rebuild, rotate, add, remove or relabel accepted geometry.

Direct-open requirement: opening the 5M chart first must display the complete accepted board. The user must never need to visit a higher timeframe to make its line appear.

All trendline drawings use timestamp + price coordinates (`xloc.bar_time`), never host `bar_index` anchors.

## 5. Visibility

All accepted Monthly/Weekly/Daily/4H/1H/15M/5M GREEN/RED slots are available on every supported host timeframe.

Each slot has an independent SHOW/HIDE checkbox. Hide/show is display-only and cannot alter geometry, validity, violation state, parentage, NEXT WALL eligibility, or repair state.

Normal rays carry no timeframe text labels.

## 6. Coach visibility

The top-right Slumdawg coach has a clear `Show Slumdawg coach` checkbox.

- ON: table renders normally.
- OFF: coach cells are cleared/hidden.
- Toggling the coach cannot alter any market/trendline state.
- Coach table must not affect price autoscale.

## 7. Violation / repair lifecycle

A wick through a frozen line does not automatically delete it.

Research lifecycle remains:

`ACTIVE -> BREACHED -> VIOLATED`

Violation is evaluated only from confirmed closes in the line's own source timeframe, using explicit research penetration/confirmation inputs.

Refresh means **repair violated lines only**:

- ACTIVE/BREACHED lines remain coordinate-identical.
- Only VIOLATED slots may be replaced.
- Replacement must be later than the old B, attach to the valid higher-timeframe family, pass full-candle clean-ray validation and pass collision rejection.
- If no replacement qualifies, retain the old violated line and draw nothing new.

The exact penetration/count values are research placeholders until calibrated against operator-approved examples.

## 8. Safety

Trendlines are context / possible walls only.

A trendline touch, cross, break, violation or repair cannot by itself:

- flip BIG DIRECTION;
- create a GO LINE;
- create ENTRY READY;
- approve live decision support.

`LIVE_DECISION_SUPPORT_APPROVED` remains false.

## 9. Mandatory platform acceptance

Do not promote v0.10 until all are demonstrated:

1. exact Pine source compiles unchanged in TradingView;
2. direct-open 5M shows the complete accepted board;
3. 5M -> 15M -> 1H -> 4H -> D -> W -> M -> 5M preserves every A/B timestamp and price;
4. no fresh accepted RED ray cuts through source highs and no GREEN ray cuts through source lows beyond tolerance;
5. root RED visibly begins at the correct big-picture highest structural high; root GREEN mirrors from the lowest structural low;
6. lower-timeframe lines visibly belong to the higher-timeframe family rather than appearing as random close-up rays;
7. coach Show/Hide works without geometry or autoscale changes;
8. individual trendline Show/Hide restores exact same line;
9. Reset Chart View remains candle-readable;
10. operator screenshots are compared against hand-drawn pink-line golden examples.

Software/synthetic tests prove implementation invariants only. They do not prove trading edge.