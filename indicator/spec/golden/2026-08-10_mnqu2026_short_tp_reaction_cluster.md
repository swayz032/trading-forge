# Golden Fixture — MNQU2026 Macro Context + Short TP Reaction Clusters — 2026-08-10

Status: USER-VISUAL SEMANTIC FIXTURE / RESEARCH ONLY

This fixture records the user-reviewed TradingView screenshots used to correct BIG DIRECTION and the automatic Take Profit Zone selector. It is not a claim of market edge and is not a future-aware backtest fixture.

## Context

- Platform: TradingView
- Instrument: MNQU2026 / Micro E-mini Nasdaq-100 Index Futures (Sep 2026)
- Execution chart: 5 minute
- Structural entry source: confirmed 15 minute swing structure
- Higher-timeframe review: 4H + Daily/Weekly reference context
- Visible plan context after the rejection: bearish continuation / short-side destination review

## Macro-direction semantic observation

The 4H chart shows a large bullish rally from the late-July low toward the prior-week-high area. That rally is a **large bullish pullback / countertrend leg inside the still-bearish larger market regime**, not sufficient proof that the macro regime itself reversed.

After price reaches/rejects the PWH area and 15m structure turns down, the desired relationship is:

- `BIG DIRECTION = 📉 DOWN`
- `CURRENT MOVE = 📉 DOWN WITH DIRECTION`
- `ACTIVE PLAN = 🔴 SHORT`

During the rally before bearish resumption, the desired relationship is:

- `BIG DIRECTION = 📉 DOWN`
- `CURRENT MOVE = 📈 UP PULLBACK`

A strong recent 4H HH/HL leg must therefore not initialize or flip BIG DIRECTION to UP when the slower macro structure is still bearish. PWH rejection may strengthen context, but a PWH touch/rejection alone is never the definition of BIG DIRECTION.

## Short entry structure

- Visible `🔴 SHORT - ENTRY ZONE`: approximately **29,719.00**.
- This is the proof/BOS structure. It is not itself a Take Profit Zone.

## Operator reaction-shelf targets drawn in white

1. **TP1 reference: 29,628.50**
   - First clearly separate lower reaction shelf after the short entry structure.
   - The destination is separated from entry by real travel space.
   - Target belongs inside the near/upper portion of the lower reaction structure, not at its deepest wick.

2. **TP2 reference: 29,527.25**
   - Next clearly separate lower reaction shelf/base.
   - The target is again placed toward the near/upper portion of the reaction area rather than at the deepest lower wick.

## Explicit rejected behaviors

Earlier automatic selectors produced or allowed:

- TP1 near **29,714**, effectively overlapping the ~29,719 short-entry neighborhood;
- TP2 near **29,583**, an isolated pivot-like level between the two operator-recognized reaction shelves;
- later builds displaying **NO QUALIFIED TP SHELF** even while the reviewed chart still contains the previously approved lower reaction shelves;
- BIG DIRECTION = UP merely because the recent 4H pullback leg was strongly bullish.

All four behaviors are rejected.

## Root cause captured for the missing-TP regression

The v0.17.1 Pine adapter used one shared capped reaction array per timeframe. It scanned recent reactions first and stopped when the shared cap filled. Reactions on the irrelevant side of the Entry Zone could therefore consume the history budget before deeper trade-direction shelves were reached.

Required platform behavior:

- retain ABOVE-entry and BELOW-entry reaction histories separately;
- scan sufficient historical depth for the active side;
- do not let irrelevant recent reactions hide deeper valid destinations;
- distinguish `NO QUALIFIED TP SHELF` from `TP DATA/DETECTOR UNAVAILABLE`.

## Required selector semantics

A future automatic TP selector must:

- reject a single isolated wick/pivot as sufficient TP evidence;
- recognize repeated body/wick reaction shelves, not only textbook pivots;
- reject TP1 when it belongs to the same structural neighborhood as entry;
- keep TP1, TP2, and TP3 as separate reaction clusters;
- for SHORT, place the TP line **inside the near/upper side** of the selected lower reaction cluster;
- for LONG, mirror the rule **inside the near/lower side** of the selected upper reaction cluster;
- use far wicks only as evidence of zone extent, never as the automatic target price;
- perform the full multi-lane search before reporting no qualified target.

## Calibration status

Exact major-pivot strength, reaction-cluster tolerance, minimum separation, minimum touch-count, and penetration depth remain **CALIBRATION_REQUIRED** under `indicator/spec/AMBIGUITY_REGISTER.md`.

The screenshots provide semantic truth about this example and regression behavior. They do not by themselves authorize universal numeric thresholds or prove an edge.
