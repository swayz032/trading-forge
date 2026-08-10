# Golden Fixture — MNQU2026 Short TP Reaction Clusters — 2026-08-10

Status: USER-VISUAL SEMANTIC FIXTURE / RESEARCH ONLY

This fixture records the user-reviewed TradingView screenshot used to correct the automatic Take Profit Zone selector. It is not a claim of market edge and is not a future-aware backtest fixture.

## Context

- Platform: TradingView
- Instrument: MNQU2026 / Micro E-mini Nasdaq-100 Index Futures (Sep 2026)
- Execution chart: 5 minute
- Structural entry source: confirmed 15 minute swing structure
- Visible plan context in screenshot: bearish continuation / short-side destination review

## User-approved semantic observations

### Short entry structure

- Visible `🔴 SHORT - ENTRY ZONE`: approximately **29,719.00**.
- This is the proof/BOS structure. It is not itself a Take Profit Zone.

### Operator reaction-shelf targets drawn in white

1. **TP1 reference: 29,628.50**
   - First clearly separate lower reaction shelf after the short entry structure.
   - The destination is separated from entry by real travel space.
   - Target belongs at the near/upper side of the lower reaction structure, not at its deepest wick.

2. **TP2 reference: 29,527.25**
   - Next clearly separate lower reaction shelf/base.
   - The target is again placed toward the near/upper side of the reaction area rather than at the deepest lower wick.

## Explicit rejection from the screenshot

The prior automatic selector produced approximately:

- TP1 near **29,714**, effectively overlapping the ~29,719 short-entry neighborhood.
- TP2 near **29,583**, an isolated pivot-like level between the two operator-recognized reaction shelves.

Both behaviors are rejected.

## Required selector semantics

A future automatic TP selector must:

- reject a single isolated wick/pivot as sufficient TP evidence;
- require a multi-touch reaction cluster/shelf;
- reject TP1 when it belongs to the same structural neighborhood as entry;
- keep TP1, TP2, and TP3 as separate reaction clusters;
- for SHORT, place the TP line at the **near/upper edge** of the selected lower reaction cluster;
- for LONG, mirror the rule at the **near/lower edge** of the selected upper reaction cluster;
- use far wicks only as evidence of zone extent, never as the automatic target price;
- fail closed (`NOT SET`) when no qualified separate cluster exists.

## Calibration status

Exact cluster tolerance, minimum separation, and minimum touch-count beyond the currently tested research defaults remain **CALIBRATION_REQUIRED** under `indicator/spec/AMBIGUITY_REGISTER.md`.

The screenshot provides semantic truth about what constitutes a better destination on this example. It does not by itself authorize a universal numeric threshold.
