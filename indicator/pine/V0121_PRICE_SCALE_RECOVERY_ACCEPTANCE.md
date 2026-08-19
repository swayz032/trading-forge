# v0.12.1 Price-Scale Recovery Acceptance

Status: PLATFORM PARITY / RESEARCH ONLY. Not live-decision-support approved.

## Root cause being isolated

v0.12 specified `scale = scale.none` in an overlay script. TradingView treats any explicit `scale` argument as an independently scaled visual space. The user screenshots showed the proof: labels contained the expected PDH/PDL values, but the horizontal drawings were visibly mapped to the wrong y-axis locations relative to the MNQ candles.

## Recovery contract

1. The indicator declaration MUST use `overlay = true` and MUST NOT specify any `scale` argument.
2. PDH/PDL/PWH/PWL retain the pre-trendline completed-D/W bridge and are not 5-minute gated.
3. Trendline drawings remain 5-minute-only for the current stabilization lane.
4. The trendline algorithm is intentionally unchanged from v0.12 in this recovery build; first prove price-coordinate alignment, then judge anchor selection separately.
5. The coach hide/show input remains display-only.
6. Remove the prior script instance and add v0.12.1 fresh; TradingView applies declaration-level scale behavior when the script instance is added.

## Mandatory platform screenshots

- 5M: PDH and PDL lines must sit on the exact y-axis prices printed in their labels.
- Daily: the same PDH/PDL numeric levels must still sit on those exact chart prices.
- 5M: any `LOCKED` trendline must render on the main MNQ price scale; if it is offscreen because its projected price is genuinely far away, that is an anchor-selection defect, not a scaling defect.

Do not modify trendline selection again until this scale gate is visually resolved.
