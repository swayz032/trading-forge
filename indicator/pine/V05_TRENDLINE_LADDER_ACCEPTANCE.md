# Slumdawg v0.5.1 Trendline Ladder — TradingView Acceptance

Status: REQUIRED / NOT YET PLATFORM-CERTIFIED

Source under test: `indicator/pine/slumdawg_platform_parity_v0_5_trendline_ladder.pine`

Paste the exact committed source into TradingView unchanged.

## A. Compile gate
- Pine v6 compiles with zero errors.
- Do not hand-edit source in TradingView.
- Record exact compiler text if it fails.

## B. D/W visual contract
- PDH and PDL remain visible whenever valid.
- PDH and PDL span the full chart left and right.
- PWH/PWL are not permanently forced onto the chart.
- A weekly level is displayed only when it is no farther from current price than the farther of PDH/PDL.
- When PWH/PWL is displayed, its horizontal line also spans the full chart.
- This weekly-near rule is visual-only. It does not qualify an entry or claim market significance.
- Confirm the user's current example still shows PWH while the farther PWL remains hidden if the same geometry persists.
- Reset Chart View must remain candle-readable.

## C. Top-down ladder setup
Trendlines are intentionally operator-anchored in this parity slice; they do not auto-appear from candle heuristics.

Configure the ladder in this order:
1. Daily
2. 4H
3. 1H
4. 15M
5. 5M

Each timeframe has one current GREEN bullish ray slot and one current RED bearish ray slot. Each ray uses two explicit time+price anchor points.

For each enabled line:
- enable the GREEN or RED line in Inputs;
- set A and B to the user's intended TradingView swing points;
- B time must be later than A time;
- GREEN is bullish context / possible support wall;
- RED is bearish context / possible resistance wall;
- line geometry must remain attached to the same timestamps/prices when switching chart timeframe and after reload.

With zero valid A/B pairs, the coach must explicitly say `NO TRENDLINES — SET A/B`; an empty chart is not allowed to look like a successful automatic trendline read.

## D. Clean-chart rule
- Default prominent trendline count is 2.
- The nearest enabled trendlines are prominent.
- If NEXT WALL is an enabled trendline, it remains visible even when it is not one of those two.
- Other enabled ladder lines may remain hidden visually but must not be deleted from the configured ladder.
- Hidden/inactive drawings use NA geometry, never price 0.
- Reset Chart View remains normal with no active GO LINE or SAFE TARGET.

## E. NEXT WALL vertical slice
For LONG plans:
- RED trendline projections above price are wall candidates;
- PDH/PDL ahead are candidates;
- PWH/PWL join only when the weekly-near visual rule is true.

For SHORT plans:
- GREEN trendline projections below price are wall candidates;
- PDH/PDL ahead are candidates;
- PWH/PWL join only when the weekly-near visual rule is true.

The nearest candidate in the plan direction is displayed as NEXT WALL.

This is route awareness only. A wall does not automatically reject a trade, select a GO LINE, set a target, or predict a reaction.

## F. Frozen semantic safety
A GREEN/RED trendline cross alone must never:
- flip BIG DIRECTION;
- create a GO LINE;
- create BREAK/PUSH/READY;
- label a temporary move as an overall reversal.

BIG DIRECTION remains explicit/manual in this platform-parity slice.

## G. Existing 5M state-machine parity
The test engine remains OFF by default and live approval remains false.
Controlled parity cases must preserve:
- one forward stage maximum per realtime update;
- no one-spike BREAK+PUSH+READY manufacture;
- doji veto;
- recoil reset;
- Candle-2 failure / Candle-3 fresh reference behavior;
- NON-ACTIONABLE debug alerts only.

## Pass condition
v0.5.1 may advance only after:
- exact source compiles unchanged;
- PDH/PDL full-span + always-visible behavior is confirmed;
- weekly-near display matches the intended uncluttered behavior;
- Daily -> 4H -> 1H -> 15M -> 5M GREEN/RED anchors are platform-checked;
- NEXT WALL agrees with the configured geometry;
- Reset Chart View remains fixed;
- no trendline cross changes forbidden state.

Passing this gate does not certify automatic GO LINE selection, automatic SAFE TARGET selection, trading edge, win rate, or live-decision support.
