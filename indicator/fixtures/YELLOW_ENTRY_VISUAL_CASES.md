# Yellow Entry / Structural Proof — User-Approved Visual Cases

Status: VISUAL GOLDEN CANDIDATES. These examples define semantic intent, not backtest evidence.

## Core rule established by the user

The yellow entry/proof lines bracket price using meaningful structural wick extremes:

- LONG proof: the TOP / exact high of the selected meaningful swing-high wick.
- SHORT proof: the BOTTOM / exact low of the selected meaningful swing-low wick.
- Do not use the nearest random wick.
- The upper and lower yellow structural lines may both be visible at the same time.
- The selected wick must represent a meaningful outer structural boundary, leaving room beyond the proof level for the later reaction-zone / TP logic.
- The yellow line is proof/entry-side structure. Reaction zones are destination/TP structure and are not interchangeable with entry levels.
- Actual ENTRY_READY still belongs to the 5-minute reference -> BREAK -> PUSH_1 -> PUSH_2-quality sequence after structural proof is crossed.

## Case YE-001 — MNQ Aug 2026 visual example

Platform: TradingView screenshot, 15-minute structural view.

User-confirmed SHORT structural proof:
- approximately 29,280.00 from the circled meaningful swing-low wick.
- exact runtime candle low must be captured from chart data before executable fixture promotion.

User/assistant-agreed LONG structural proof candidate:
- 30,073.25 from the meaningful swing-high wick / PWH area.

Important reject examples:
- PDH / PDL are not automatically entry levels.
- a nearer small local high around current price is not automatically the LONG proof.
- a nearer small local low is not automatically the SHORT proof.

## Case YE-002 — FX Replay Apr 2025 range example

Platform: FX Replay, 5-minute execution chart.

User-drawn yellow structural boundaries:
- LONG proof: 17,524.75
- SHORT proof: 16,495.00

Interpretation:
- price is bracketed by the meaningful upper swing-high wick and lower swing-low wick of the active structural range.
- both yellow lines are visible simultaneously.

## Case YE-003 — FX Replay Apr 2025 bearish-context example

Platform: FX Replay, 5-minute execution chart.

User-drawn yellow structural boundaries:
- LONG proof: 18,672.75
- SHORT proof: 17,822.50

PDL shown separately at 18,624.25.

Important semantic distinction:
- the PDL is context/key-level information.
- the LONG yellow proof is above it at the meaningful swing-high wick.
- the SHORT yellow proof is the meaningful lower swing-low wick.

## Initial deterministic research hypothesis

For the first platform parity build only:

1. detect confirmed 15-minute swing highs/lows with strict 2-left / 2-right pivot confirmation;
2. remember the most recent N confirmed swings per side (N is calibration-required; initial parity baseline = 8);
3. LONG candidate = highest confirmed swing high in that recent structural memory;
4. SHORT candidate = lowest confirmed swing low in that recent structural memory;
5. round LONG proof upward and SHORT proof downward to the NQ/MNQ tick grid;
6. if either side has no confirmed candidate, fail closed for that side;
7. do not call the hypothesis production-correct until these visual cases and additional blind examples are reproduced.

This hypothesis intentionally models the observed OUTER STRUCTURAL WICK rule rather than nearest-wick selection.
