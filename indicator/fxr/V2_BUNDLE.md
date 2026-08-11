# Slumdawg FX Replay V2 Bundle

Status: **PLATFORM PARITY / RESEARCH ONLY**. Not live-decision-support approved.

## Executable entry / target adapter

Load `slumdawg_v2_entry_tp_15m_v0_4.fxr.js` on a **5-minute NQ/MNQ** replay chart.

Current file header: **Slumdawg FX Replay V2.0.4.5 — QUALITY-FIRST REACTION-ZONE TARGETS**.

The v0.4.5 adapter closes both the Aug-10 target-distance defect and the Aug-11 weak-near-target defect:

- the final 15m Entry Zone is the shared anchor for both 15m and native-chart 5m reaction discovery;
- 5m no longer invents a separate outer-swing anchor that can delete closer reaction zones;
- a candidate must show measurable reaction/displacement **away from its near zone edge** before entering the TP pool;
- reaction quality is checked **before** proximity ranking, so weak nearby micro-structure cannot become TP1 merely because it is closest;
- a candidate still needs repeated reaction evidence before it can become a target shelf;
- target polarity is directional: LONG targets come from prior high-side rejection/supply; SHORT targets come from prior low-side reaction/demand;
- LONG targets are hard-rejected unless they remain above LONG Entry; SHORT targets are hard-rejected unless they remain below SHORT Entry;
- 15m + 5m views of the same physical shelf are fused before TP1/TP2/TP3 numbering;
- distance only rejects or sequences already-qualified shelves; it does not manufacture a TP price or target quality;
- when CURRENT MOVE matches BIG DIRECTION, TP is placed at the **reaction-zone midpoint** (`MID`);
- for a temporary/countertrend move, TP is placed in the **safer near-middle** (`SAFE`): upper-middle for SHORT, lower-middle for LONG;
- target rounding must remain strictly inside the reaction zone by at least one NQ/MNQ tick on each side;
- the test heartbeat and standard plot mirrors remain available so a running script cannot silently look dead while MTF structure is building.

`TP Reaction Confirm Bars` and `Minimum TP Reaction x ATR` are **research/calibration controls**, not approved NQ/MNQ production settings.

## BIG DIRECTION input

FXR currently documents one requested MTF timeframe per script and does not document a supported cross-script shared-state bus. The entry/TP adapter therefore requests **15m once** and uses the native chart for 5m. Daily macro direction stays in the separate Daily helper.

Set the adapter's `BIG DIRECTION (match Daily helper)` input to the direction shown by `slumdawg_v2_macro_daily_v0_2.fxr.js`. This is explicit rather than silently guessing or pretending cross-script state exists.

## Load this bundle

1. `slumdawg_v2_entry_tp_15m_v0_4.fxr.js` — 5m chart + requested 15m; CURRENT MOVE, Entry Zones, quality-first reaction-zone TP ladder, entry-state foundation.
2. `slumdawg_v2_macro_daily_v0_2.fxr.js` — Daily BIG DIRECTION authority.
3. `slumdawg_v2_context_4h.fxr.js` — 4H corroboration/context only; not TP authority.
4. `slumdawg_daily_levels_v0_1.fxr.js` — PDH/PDL.
5. `slumdawg_weekly_levels_v0_1.fxr.js` — PWH/PWL.

## Why 1H/4H are not executable TP lanes in v0.4

TradingView can request several timeframes inside one Pine script. FXR's documented MTF contract is narrower. Rather than let Pine use 1H/4H target lanes that FXR cannot reproduce honestly, the parity slice uses **15m + native 5m** for target geometry. 1H/4H remain context / NEXT-WALL evidence until a supported, tested parity mechanism exists.

## Golden regressions

### Aug-10 distant-target regression

The rejected MNQU2026 5m screenshot showed BIG DIRECTION = DOWN, CURRENT MOVE = DOWN WITH DIRECTION, SHORT ENTRY `29666.00`, and garbage distant targets `29198.50`, `29117.25`, `28958.75`.

Those values are not approved destinations. The regression contract is semantic: for that aligned short context, the adapter must discover qualified downside reaction zones from the shared entry anchor and place each target at the **middle of its selected zone**. It must not recreate those old prices merely because a distant wick passed a spacing filter.

### Aug-11 weak-near LONG regression

The reviewed LONG-side map showed LONG Entry around `29900.00`, a rejected weak/too-near target neighborhood around `29915`, and an operator-marked first meaningful upper reaction reference around `29938.25`.

`29915` is frozen as negative evidence for this semantic class. The `29938.25` white level is **not** frozen as the final TP price; it identifies the reaction structure whose full zone must be constructed. The eventual LONG TP belongs **inside** that qualified zone according to MID/SAFE context. If no meaningful shelf survives the quality gate, fail closed rather than falling back to the weak near-entry neighborhood.

## Certification boundary

Source/static checks can prove that the FXR adapter uses the intended APIs and matches the frozen quality-first geometry semantics. Actual FX Replay Editor execution, reaction-zone value agreement, replay/rewind behavior, and chart agreement still require a platform run. Pine currently normalizes historical candidate reaction displacement with ATR at the candidate bar, while FXR uses its supported lane ATR basis; exact numeric parity for this new quality gate must therefore be demonstrated on-platform before certification.

Until that evidence is captured, **full one-panel Python/Pine/FXR parity remains a certification blocker**.
