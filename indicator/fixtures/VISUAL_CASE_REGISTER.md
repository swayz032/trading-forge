# Visual Case Register — Current User Examples

Status: `VISUAL_ONLY`. These examples preserve the user's semantic intent but do **not** count as executable edge evidence until exact market data/timestamps are attached under `CASE_STUDY_PROTOCOL.md`.

## VC-001 — bearish continuation / yellow momentum confirmation

Observed semantics:
- red trendline slopes down -> overall bearish context;
- yellow line is the entry/proof mechanism, not blue level;
- after price establishes beyond yellow, completed candle extreme becomes reference;
- next live 5m candle must create distinct continuation pushes;
- weak Push 2 / reversal / new candle means wait/reset, not force entry.

Expected engine constraints:
- red line cannot create entry;
- one update cannot fake all push stages;
- Candle-3 reset is mandatory.

## VC-002 — conservative upper-pool target front-run

Observed semantics:
- a later bullish move approached the prior major upper reaction area but did not reach the prior highest wick;
- the user intentionally targets inside the near/middle portion of the pool rather than the farthest wick.

Expected target behavior:
- target zone = prior qualified upper `REACTION_ZONE`;
- LONG target = near/lower-side penetration into that zone;
- far wick is an aggressive reference, not default conservative TP.

## VC-003 — conservative lower-pool reaction during selloff

Observed semantics:
- price sold down toward an older lower swing/reaction area;
- price reacted after reaching the upper/near portion of that lower pool before the deepest wick/next lower line.

Expected target behavior:
- SHORT target = near/upper-side penetration into lower reaction zone;
- target does not require deepest wick touch.

## VC-004 — close pool vs next pool depends on momentum/context

User rule:
- if first pool is very close and the move is weak -> take the close pool;
- if move is strong and with the larger trend -> a very close minor pool may be skipped for next meaningful pool;
- countertrend pullback remains more conservative because the larger trend may resume.

Expected tests:
- always-nearest baseline;
- always-next-major baseline;
- frozen context-sensitive selector.

## VC-005 — bearish overall, bullish intraday alternative proof

Observed semantics:
- market remains overall bearish by red trendline context;
- bullish intraday alternative yellow level is deliberately **not** the nearest little wick;
- chosen yellow level is a meaningful prior reaction/key area far enough to filter normal bearish-market pullback noise;
- it must not be so far away that the move is already mature/unreachable;
- bullish intraday acceptance comes from structural yellow proof + live momentum, not from crossing red.

Expected selector behavior:
- reject nearest noise-prone wick;
- reject impractically distant candidate;
- require stronger structure for countertrend than with-trend;
- selected proof price uses anti-fakeout tick rounding.

## VC-006 — reaction creates a future proof zone

Observed semantics:
- some alternative entry zones are meaningful because a prior move visibly reacted at an earlier reaction/liquidity zone;
- the reaction area can later become a proof/entry candidate.

Expected engine behavior:
- provenance must preserve which prior reaction(s) formed the zone;
- no future reaction may be used to retroactively strengthen the zone at decision time.

## VC-007 — big displacement / intermediate structure

User rule:
- during a large-candle/displacement move, meaningful prior reaction areas inside the displacement can sometimes become intermediate entry or TP candidates.

Status:
- semantic intent recorded;
- numeric eligibility rule remains `CALIBRATION_REQUIRED` and may not silently enter production.

## VC-008 — native PDH/PDL workflow

User workflow:
- before the 09:30 New York open, inspect the platform Daily chart;
- PDH/PDL are the high/low of the prior completed native Daily candle;
- do not replace this in V1 with a custom 09:30-16:00 reconstruction.

Expected parity behavior:
- platform-native level provenance logged;
- TradingView/FXR differences flagged rather than averaged or hidden.

## Promotion requirement

Each case becomes `EXECUTABLE` only after attaching exact contract, timestamps, provider/platform, 5m bars and lower-timeframe ordered data (where intrabar logic matters), exact expected levels, and reason-coded expected transitions.
