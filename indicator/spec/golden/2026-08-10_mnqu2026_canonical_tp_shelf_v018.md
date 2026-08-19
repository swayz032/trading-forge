# Golden Fixture — MNQU2026 Canonical TP Shelf v0.18 — 2026-08-10

Status: USER-APPROVED SEMANTIC ACCEPTANCE / RESEARCH + PLATFORM PARITY ONLY

## Context

- Platform: TradingView
- Instrument: MNQU2026
- Execution chart: 5 minute
- Active example: SHORT
- Structural Short Entry Zone: approximately `29,719.00`
- Original rejected panel values: TP1 `29,694.75`, TP2 `29,678.50`, TP3 `29,643.25`

## Failure being closed

The old TP ladder could let separate 5m/15m/1H/4H descriptions of one physical reaction shelf consume multiple TP numbers. It could also inherit a lane-local target that sat too close to the shelf's first edge.

That behavior is rejected.

## v0.18 canonical shelf contract

1. Every timeframe lane may discover reaction-zone LOW/HIGH candidates, but lane candidates are **not** TP1/TP2/TP3 yet.
2. Before TP numbering, all overlapping or structurally adjacent cross-timeframe candidate zones are fused transitively into one **canonical physical reaction shelf**.
3. A connected shelf counts exactly once regardless of whether 5m, 15m, 1H, and/or 4H each describe a different piece of it.
4. The final displayed TP price is recomputed from the full canonical shelf LOW/HIGH bounds. A lane-local target price may not survive as the final answer merely because that lane was encountered first.
5. AUTO targets must be strictly inside the canonical shelf by at least one valid instrument tick on both sides. If a shelf is too narrow to contain a valid interior tick, that shelf fails closed instead of placing the target on an edge.
6. For SHORT, the safe target remains on the near/top-to-middle side of the lower reaction shelf; for LONG, mirror to the near/bottom-to-middle side of the upper shelf. Exact penetration remains calibration/research-gated.
7. TP2 and TP3 must be genuinely separate canonical shelves. Candidate enumeration/timeframe ordering must not change the shelf identities or TP numbering.
8. In the original Aug-10 case, the `29,694.75` and `29,678.50` observations must not survive as TP1 and TP2 if they belong to the same physical shelf. The old distinct destination around `29,643.25` should promote to TP2 if it remains the next qualified canonical shelf, and the engine must continue deeper for TP3.
9. `🕯️ ENTRY CONFIRMATION` remains the beginner-facing row. `CANDLE SETUP` is not allowed in this build.

## Required proof before platform acceptance

- The exact committed v0.18 Pine source compiles unchanged in TradingView.
- Reload the same MNQU2026 5m visual case with the old indicator instance removed.
- Confirm the rejected TP1/TP2 duplicate-shelf pair cannot reappear as two TP numbers.
- Confirm each displayed auto TP is visibly inside the canonical shelf rather than on its outer edge.
- Confirm the old deeper distinct shelf promotes in sequence when still qualified.
- Confirm `ENTRY CONFIRMATION` is shown and `CANDLE SETUP` is absent.
- Save the TradingView screenshot as platform-parity evidence.

Until that replay is completed, v0.18 remains PLATFORM PARITY / RESEARCH ONLY and is not certified live-decision-support.