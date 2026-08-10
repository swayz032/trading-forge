# Slumdawg Trendline Family Protocol

Status: **SPEC / REFERENCE ENGINE — not live-decision-support approved**

## 1. Purpose

Encode the user's top-down GREEN/RED trendline drawing method without turning it into a generic two-pivot indicator. The authoritative chart sequence for Slumdawg is:

**Daily -> 4H -> 1H -> 15M -> 5M**

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
- deterministic parent/child lineage identifiers;
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

### 3.2 Highest-timeframe root
Daily is the Slumdawg root timeframe. Within the explicit research window:
- GREEN A = lowest confirmed eligible Daily swing low.
- RED A = highest confirmed eligible Daily swing high.
- B = latest later directional swing that yields a clean ray against intervening same-kind swings.

The bounded window is a platform approximation for the human phrase “visible structural extreme” and remains calibration-gated.

### 3.3 Strict parent -> child bridge
A lower-timeframe trendline is not independently rooted.

For every accepted child:

`child.A == parent.B`

exactly in time and price.

The child B must be a later confirmed swing on the child timeframe in the same structural direction. If a timeframe does not produce a qualified child, it is skipped and the next lower timeframe inherits from the most recent accepted higher-timeframe parent. No orphan close-up line is allowed.

### 3.4 Same-path collision rejection
If a proposed child B lies on essentially the same projected path as its parent within the explicit collision tolerance, the child is redundant and is not added. A lower-timeframe pivot alone is not sufficient reason to draw another ray.

Collision/touch tolerances are calibration inputs. They are not allowed to become hidden production constants.

## 4. Frozen board

After a line is accepted:
- A never moves.
- B never moves.
- current price never changes its slope.
- a new pivot never changes its slope.
- hiding/showing the line never changes its geometry.

The ray may extend right because that is its defined geometry; extension is not anchor movement.

Normal chart labels do not print timeframe names on the rays. Internal metadata still records timeframe, direction, parent and revision.

## 5. Violation state machine

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

## 6. Repair contract

The operator's refresh action means **repair violated lines only**.

On repair:
1. Process top-down.
2. ACTIVE and BREACHED lines are immutable and must remain value-identical.
3. For each VIOLATED slot, search for a later qualified replacement.
4. Child replacement must attach to the nearest currently accepted higher-timeframe parent using `parent.B -> child.A`.
5. Replacement B must occur later than the old B; repair may not rediscover the same broken geometry.
6. If no qualified replacement exists, keep the old VIOLATED line and draw nothing new.
7. A successful replacement increments the slot revision and archives the old revision internally.

There is no “refresh all current pivots” command in this contract.

## 7. Visibility contract

Every board slot has an independent SHOW/HIDE preference. Hiding is visual only.

- Hide -> line geometry remains stored.
- Show again -> exact same revision/anchors return.
- Visibility cannot qualify, invalidate, repair or move a line.

## 8. Fail-closed cases

Return no child/replacement rather than guessing when:
- fewer than two eligible structural points exist;
- the Daily root is absent;
- no valid higher-timeframe parent exists;
- B does not move in the required structural direction;
- an intervening swing cuts through the candidate ray beyond tolerance;
- candidate is a duplicate of the parent path;
- candidate uses an unconfirmed/future swing;
- replacement would reuse the violated line's B or an earlier B.

## 9. Required assurance

Before platform promotion:
- bullish/bearish mirror tests;
- no-future-leak tests;
- exact `parent.B == child.A` tests;
- skipped-timeframe lineage tests;
- duplicate-path rejection tests;
- immutable-anchor tests;
- source-timeframe violation/reclaim tests;
- repair-only-violated tests;
- failed-repair fail-closed tests;
- hide/show geometry identity tests;
- Pine/reference parity;
- TradingView compile/reload/replay golden screenshots against the user's pink-line examples;
- sensitivity analysis for root window, touch tolerance, collision tolerance and violation confirmation.

No synthetic test proves trading edge.
