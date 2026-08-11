# Golden Fixture — MNQU2026 Reaction-Zone Target v0.19 — 2026-08-10

Status: USER-APPROVED SEMANTIC ACCEPTANCE / PLATFORM PARITY RESEARCH

## Rejected visual

TradingView, MNQU2026, 5-minute chart:

- BIG DIRECTION: DOWN
- CURRENT MOVE: DOWN WITH DIRECTION
- ACTIVE PLAN: SHORT
- SHORT ENTRY: `29666.00`
- rejected TP1: `29198.50`
- rejected TP2: `29117.25`
- rejected TP3: `28958.75`

The three target prices above are frozen as **negative evidence**. They were visually rejected because the indicator was selecting distant levels instead of the actual reaction areas used by the operator.

## v0.19 target contract

1. **One entry anchor.** The final displayed Entry Zone anchors target discovery. A 5m/15m target lane may not substitute a different local outer swing.
2. **Reaction-zone first.** Build a qualified interval from repeated turn/reaction structure. An isolated wick is not a target. LONG destinations come from prior high-side rejection/supply; SHORT destinations come from prior low-side reaction/demand.
3. **Fuse before numbering.** Overlapping/adjacent 5m and 15m descriptions of the same physical area count as one destination.
4. **Aligned move = MID.** BIG DIRECTION = DOWN + CURRENT MOVE = DOWN + SHORT plan means the displayed target sits at the midpoint of each qualified downside reaction zone. Mirror for UP/LONG.
5. **Pullback = SAFE.** Countertrend/temporary moves use the nearer middle portion: upper-middle for SHORT, lower-middle for LONG.
6. **Strictly inside.** Auto TP must be at least one valid tick inside both reaction-zone edges. Too-narrow zones fail closed.
7. **Distance is not TP geometry.** Distance may reject entry overlap and order separate qualified zones; it may not add/subtract points from a wick to manufacture a target.
8. **Parity target surface.** v0.19 executable target geometry is 15m + native 5m so FX Replay can reproduce the same supported information surface. 1H/4H remain context until parity support is proven.
9. **No invented replacement prices.** New numeric targets are not frozen until the exact v0.19 Pine source is compiled and the same visual case shows that TP1/TP2/TP3 are visibly inside the intended reaction zones.

## Required acceptance evidence

- exact committed Pine v0.19 source compiles unchanged in TradingView;
- same MNQU2026 5m case loaded with old indicator removed;
- each TP is visibly inside a real reaction zone, not underneath/above an isolated wick by a distance offset;
- aligned DOWN/DOWN case reports `TP MID` mode;
- temporary/countertrend case reports `TP SAFE` and uses the nearer-middle side;
- exact committed FXR v0.4 source loads in FX Replay without syntax/runtime error;
- FXR is run on 5m, requests 15m once, and BIG DIRECTION input is matched to the Daily helper;
- Pine and FXR agree to the valid tick on Entry Zone, selected reaction-zone bounds, and TP for matched 15m+5m evidence;
- replay pause/resume/rewind does not leak future state.
