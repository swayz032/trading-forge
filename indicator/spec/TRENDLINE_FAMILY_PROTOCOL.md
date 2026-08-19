# Slumdawg Trendline Family Protocol

Status: **SPEC / REFERENCE ENGINE — not live-decision-support approved**

## 1. Purpose

Encode the user's top-down GREEN/RED trendline drawing method without turning it into a generic two-pivot indicator. The authoritative structural sequence is:

**Daily -> 4H -> 1H -> 15M -> 5M**

The resulting accepted board is **chart-timeframe invariant**: the same frozen trendlines must be visible whether the operator opens 5M, 15M, 1H, 4H or Daily. Changing the TradingView chart timeframe, zoom or visible chart size is a display operation only and must never rebuild, move, rotate, add or remove an accepted line.

This protocol governs drawing geometry and lifecycle only. A trendline cross alone never flips BIG DIRECTION, creates a GO LINE, or creates ENTRY READY.

## 2. Source-derived drawing rules vs Slumdawg engineering overlay

### Source-derived drawing rules
The external trendline teaching used for the drawing method describes:
- upward trendlines connecting higher lows and downward trendlines connecting lower highs;
- ray geometry from Point A and Point B;
- top-down analysis;
- Point A as the structural extreme and Point B as a later higher-low/lower-high that the market has not intersected;
- moving down timeframes using the previous structural points rather than drawing unrelated close-up lines.

Research references:
- https://www.youtube.com/watch?v=yHAC0xtBR2Q
- https://videohighlight.com/v/yHAC0xtBR2Q
- https://tradingvsmyself.com/trendline-strategy-without-indicators-with-toritrades/

Only the drawing methodology is imported. Slumdawg entry, GO LINE, candle-momentum, target, risk, and lifecycle semantics remain separate.

### Slumdawg robustness overlay
The following are engineering decisions and must not be misrepresented as the external educator's rules:
- confirmed-swing/as-of gating to prevent future leak;
- immutable accepted anchors;
- source-timeframe-native geometry calculation;
- host-chart-timeframe invariance;
- deterministic parent/child lineage identifiers;
- full-candle clean-ray validation, not pivot-only validation;
- duplicate-path rejection;
- ACTIVE -> BREACHED -> VIOLATED close-confirmation state;
- manual repair that changes VIOLATED slots only;
- fail-closed behavior when no replacement qualifies;
- deterministic reload/parity requirements.

## 3. Geometry invariants

### 3.1 Minimum anchors
Every accepted trendline requires at least two structural anchors:
- GREEN: Point A and Point B are swing lows, with `B.price > A.price`.
- RED: Point A and Point B are swing highs, with `B.price < A.price`.

A later C/D/E touch may strengthen the same ray. It does **not** rotate A or B.

### 3.2 Root = frozen structural extreme
Daily is the Slumdawg root timeframe.

At board-build time, inside a deterministic analysis window:
- GREEN A = lowest confirmed eligible Daily structural low.
- RED A = highest confirmed eligible Daily structural high.
- B = a later directional swing that yields a clean, non-intersecting ray.

The operator's visual viewport is **not** allowed to define the root after the fact. Zooming, resizing the chart or changing host timeframe would otherwise mutate the big picture. Therefore “highest/lowest point in the chart” is implemented as the highest/lowest confirmed structural extreme inside the frozen board-build analysis window.

The analysis-window length remains calibration-gated and must be visible/configurable in research builds rather than hidden as an arbitrary production constant.

### 3.3 Strict parent -> child bridge
A lower-timeframe trendline is not independently rooted.

For every accepted child:

`child.A == parent.B`

exactly in time and price.

The child B must be a later confirmed swing on the child timeframe in the same structural direction. If a timeframe does not produce a qualified child, it is skipped and the next lower timeframe inherits from the most recent accepted higher-timeframe parent. No orphan close-up line is allowed.

This creates one connected structural family rather than unrelated timeframe-specific rays.

### 3.4 Fresh-line no-intersection rule
A **fresh** candidate is invalid if its ray cuts through price before board acceptance.

Validation must inspect the actual source-timeframe candle path, not only other pivot markers:
- GREEN support candidate: no intervening or post-B source candle low may fall materially below the projected ray before the board-freeze time.
- RED resistance candidate: no intervening or post-B source candle high may rise materially above the projected ray before the board-freeze time.
- Touches within the explicit research tolerance are allowed and may count as C/D/E respect points.
- A candidate that already has a true violation before freeze is not “fresh” and cannot enter the board as ACTIVE.

The tolerance is calibration input; it may not become a hidden production constant.

### 3.5 Same-path collision rejection
If a proposed child lies on essentially the same projected path as its parent or another accepted same-direction family member within the explicit collision tolerance, the child is redundant and is not added.

A lower-timeframe pivot alone is not sufficient reason to draw another ray.

Collision/touch tolerances are calibration inputs. They are not allowed to become hidden production constants.

## 4. Frozen board and cross-timeframe display

After a line is accepted:
- A never moves.
- B never moves.
- current price never changes its slope.
- a new pivot never changes its slope.
- hiding/showing the line never changes its geometry.
- changing TradingView chart timeframe never changes its geometry.
- changing zoom/visible chart size never changes its geometry.

The ray may extend right because that is its defined geometry; extension is not anchor movement.

All accepted Daily/4H/1H/15M/5M trendlines must be projected on **every supported host chart timeframe**. If the operator wakes up and opens the 5M chart directly, the full frozen board must already be present. The operator must never need to switch to a higher timeframe to make a higher-timeframe line appear.

Trendline drawing must use time/price anchors, not host `bar_index` geometry. Chart rescaling may change the pixels on screen, but the underlying timestamp/price A/B coordinates must remain value-identical.

Normal chart labels do not print timeframe names on the rays. Internal metadata still records timeframe, direction, parent and revision.

## 5. Source-timeframe-native computation requirement

Each timeframe's geometry must be computed in that timeframe's own data context and reconstructed from the same board-freeze timestamp, independent of the current host chart timeframe.

It is a release-blocking defect if:
- 5M shows fewer/different locked lines than 15M, 1H, 4H or Daily for the same symbol/contract and board revision;
- a line appears only after switching to its source timeframe;
- the same line receives different A/B timestamps or prices on different host timeframes;
- changing host timeframe changes ACTIVE/BREACHED/VIOLATED state for the same source-timeframe evidence.

## 6. Violation state machine

A wick/touch alone is not enough for automatic deletion.

Research default lifecycle:

`ACTIVE -> BREACHED -> VIOLATED`

- Evaluate a line only on **confirmed closes of its own source timeframe**.
- GREEN is adverse when the confirmed close is below the projected GREEN ray by at least the configured penetration.
- RED is adverse when the confirmed close is above the projected RED ray by at least the configured penetration.
- First adverse confirmed close: `BREACHED`.
- Reclaim before confirmation count is met: back to `ACTIVE`.
- Required consecutive adverse closes: latch `VIOLATED`.
- `VIOLATED` remains latched until operator repair.

The current research default is two consecutive source-timeframe closes and one-tick penetration. Those numbers are **Slumdawg research placeholders**, not source-derived trading truth; they require golden-example and sensitivity calibration before promotion.

## 7. Repair contract

The operator's refresh action means **repair violated lines only**.

On repair:
1. Process top-down.
2. ACTIVE and BREACHED lines are immutable and must remain value-identical.
3. For each VIOLATED slot, search for a later qualified replacement in the slot's source-timeframe-native context.
4. Child replacement must attach to the nearest currently accepted higher-timeframe parent using `parent.B -> child.A`.
5. Replacement B must occur later than the old B; repair may not rediscover the same broken geometry.
6. Replacement must pass the full-candle fresh-line no-intersection test.
7. If no qualified replacement exists, keep the old VIOLATED line and draw nothing new.
8. A successful replacement increments the slot revision and archives the old revision internally.

There is no “refresh all current pivots” command in this contract.

## 8. Visibility contract

Every board slot has an independent SHOW/HIDE preference. Hiding is visual only.

- Hide -> line geometry remains stored.
- Show again -> exact same revision/anchors return.
- Visibility cannot qualify, invalidate, repair or move a line.
- Default is to make every accepted board line available on every supported chart timeframe.

## 9. Fail-closed cases

Return no child/replacement rather than guessing when:
- fewer than two eligible structural points exist;
- the Daily root is absent;
- no valid higher-timeframe parent exists;
- B does not move in the required structural direction;
- any source candle cuts through the fresh candidate ray beyond tolerance before freeze;
- candidate is a duplicate/same-path collision with an existing family member;
- candidate uses an unconfirmed/future swing;
- replacement would reuse the violated line's B or an earlier B;
- source-timeframe data is insufficient to reconstruct the same board across host timeframes.

## 10. Required assurance

Before platform promotion:
- bullish/bearish mirror tests;
- no-future-leak tests;
- exact `parent.B == child.A` tests;
- skipped-timeframe lineage tests;
- full-candle no-intersection tests (including adversarial wick-through cases);
- duplicate-path rejection tests;
- immutable-anchor tests;
- source-timeframe violation/reclaim tests;
- repair-only-violated tests;
- failed-repair fail-closed tests;
- hide/show geometry identity tests;
- host-timeframe invariance matrix for 5M/15M/1H/4H/Daily;
- zoom/rescale geometry identity check;
- direct-open-5M test proving full board appears without first visiting higher timeframes;
- Pine/reference parity;
- TradingView compile/reload/replay golden screenshots against the user's pink-line examples;
- sensitivity analysis for root window, touch tolerance, collision tolerance and violation confirmation.

No synthetic test proves trading edge.
