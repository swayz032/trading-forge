# Slumdawg traders indicator v0.6 — TradingView Acceptance

Status: REQUIRED / NOT YET PLATFORM-CERTIFIED

Source: `indicator/pine/slumdawg_platform_parity_v0_6_auto_trendlines.pine`

## User-reported v0.5.1 defects addressed

1. The chart status line must show only the clean indicator name `Slumdawg traders indicator`, not a long chain of input values.
2. GREEN/RED trendline suggestions must appear automatically when qualifying confirmed swing pairs exist; the user must not type 1969 timestamps or price `0` into A/B fields.
3. PDH and PDL remain visible at all times when valid and span the full chart left-to-right.
4. PWH/PWL remain conditional visual context: they display only when within the current PDH/PDL visual envelope, and span the full chart when shown.
5. Hidden/inactive geometry uses `na`, never price zero, so Reset Chart View must remain candle-readable.

## Automatic trendline research slice

Top-down timeframes: Daily -> 4H -> 1H -> 15M -> 5M.

For this parity slice only:
- GREEN candidate = two latest confirmed 2-left/2-right swing lows where the newer low is higher.
- RED candidate = two latest confirmed 2-left/2-right swing highs where the newer high is lower.
- only the nearest two qualified trendlines are prominent by default to control clutter.
- these lines are **research suggestions**, not certified replacements for the user's discretionary trendlines.
- a trendline cross alone never flips BIG DIRECTION, creates GO LINE, or creates READY.

The 2/2 pivot setting is an explicit engineering placeholder for visual/parity comparison. It is not an approved production market threshold and must be validated against human-drawn golden examples before promotion.

## TradingView checks

- Paste the exact committed v0.6 source unchanged.
- Pine v6 compiles with zero errors.
- Top-left status line reads `Slumdawg traders indicator` without input-value spam.
- On MNQ/NQ, coach row TRENDLINES reports `AUTO TL <n> FOUND` when candidates exist.
- At least one qualifying GREEN/RED line can be visually compared against the user's own line-drawing method.
- Switching 5M -> 15M -> 1H -> 4H -> D and back does not detach timestamp/price geometry.
- PDH/PDL span the entire visible chart.
- PWH/PWL appear only when near by the current visual rule.
- Reset Chart View remains normal.
- No trendline crossing changes BIG DIRECTION or advances the 5M momentum state machine.

## Not certified by this build

Automatic GO LINE selection, automatic SAFE TARGET selection, market edge, win rate, live decision support, and equivalence between the 2/2 automatic suggestions and the user's discretionary trendline method remain unproven.
