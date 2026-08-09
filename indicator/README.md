# Slumdawg 5-Minute Momentum Indicator

Status: architecture + reference-engine validation scaffold.

This project turns the user's discretionary NQ/MNQ 5-minute execution method into deterministic software without pretending that market prediction can be made certain.

## Design principle

Separate **software certainty** from **market uncertainty**.

The software must be deterministic, auditable, fail-closed, and explicit about uncertainty. The market outcome remains probabilistic and must be validated out-of-sample.

## Human chart vocabulary vs internal code vocabulary

- Red trendline -> `overall_direction_context`
- Blue "liquidity pool" -> `REACTION_ZONE`
- Yellow line -> `PROOF_LEVEL`
- PDH/PDL -> prior completed platform-native Daily candle high/low
- PWH/PWL -> prior completed platform-native Weekly candle high/low
- 5-minute Push 1 / Push 2 -> intrabar momentum state machine
- Conservative TP -> near-side penetration into the next qualified `REACTION_ZONE`

## Non-negotiable rules

1. Red trendlines provide big-picture direction only. A trendline break cannot flip intraday bias.
2. Countertrend intraday entries require a meaningful yellow proof level; the nearest tiny wick is not automatically eligible.
3. Proof-level selection must reject both "too close / normal-noise" and "too far / late-to-the-move" candidates.
4. Once a 5-minute reference candle is printed beyond the yellow proof level, the next candle must prove continuation with distinct favorable price updates.
5. A single spike/update may advance at most one momentum state.
6. If the live candle fails and a new 5-minute candle begins, the just-finished candle becomes the new reference and the momentum sequence resets.
7. Doji-like completed reference candles are a veto until the exact doji threshold is calibrated and frozen.
8. Conservative TP is inside the next reaction zone, on the near side, not at the farthest wick.
9. Same input stream + same config must produce byte-equivalent state transitions.
10. Unknown/ambiguous data must return `NO_SIGNAL`, never a guessed trade.

See `spec/V1_RULEBOOK.md` and `spec/PRODUCTION_GATES.md`.
