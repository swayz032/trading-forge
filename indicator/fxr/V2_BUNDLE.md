# Slumdawg FX Replay V2 Bundle

Status: **PLATFORM PARITY / RESEARCH ONLY**. Not live-decision-support approved.

## Executable entry / target adapter

Load `slumdawg_v2_entry_tp_15m_v0_5.fxr.js` on a **5-minute NQ/MNQ** replay chart.

Current file header: **Slumdawg FX Replay V2.0.5.0 — FULL REACTION-BODY ZONES + FIRST-SHELF TP**.

## v2.0.5 target geometry

The v2.0.5 adapter fixes the repeated white-line mismatch at the geometry layer rather than adding another distance threshold:

- an upper/LONG destination reaction area is built from the **lower edge of the full candle body through the reaction high**;
- a lower/SHORT destination reaction area is built from the **reaction low through the upper edge of the full candle body**;
- the old thin `body-top -> wick-high` and `wick-low -> body-bottom` strips are forbidden in this adapter;
- historical reaction/displacement must qualify **before** proximity can rank a shelf;
- the first qualified physical shelf in trade direction owns TP1;
- 5m + 15m descriptions of the same shelf fuse before TP numbering;
- LONG target placement defaults to **zone middle with a small upper lean** (`0.55` depth from the lower boundary);
- SHORT target placement defaults to the **zone midpoint** (`0.50`);
- those depth values are parity/research defaults derived from the current operator-approved visual intent, not claims of optimal edge;
- every LONG TP is hard-rejected unless it remains above LONG Entry; every SHORT TP is hard-rejected unless it remains below SHORT Entry;
- targets remain at least one MNQ/NQ tick inside the selected zone when geometry permits;
- the heartbeat and standard `plot.line` mirrors remain available so a running script cannot silently look dead.

## BIG DIRECTION input

FX Replay's current adapter design requests **15m once** and uses the native 5m chart for execution/TP geometry. Daily BIG DIRECTION remains in the separate macro helper because this parity lane does not pretend cross-script shared state exists.

Set `BIG DIRECTION (match Daily helper)` to the direction shown by `slumdawg_v2_macro_daily_v0_2.fxr.js` when performing matched replay tests.

## Load this bundle

1. `slumdawg_v2_entry_tp_15m_v0_5.fxr.js` — 5m + one requested 15m lane; CURRENT MOVE, Entry Zones, full-body reaction-zone TP ladder, entry-state foundation.
2. `slumdawg_v2_macro_daily_v0_2.fxr.js` — Daily BIG DIRECTION authority.
3. `slumdawg_v2_context_4h.fxr.js` — 4H corroboration/context only; not TP authority.
4. `slumdawg_daily_levels_v0_1.fxr.js` — PDH/PDL.
5. `slumdawg_weekly_levels_v0_1.fxr.js` — PWH/PWL.

## Golden white-line acceptance — Aug 11

The paired MNQU2026 5-minute screenshots are now frozen together in:

`indicator/spec/golden/2026-08-11_mnqu2026_long_short_white_line_tp_v020.md`

### LONG side

- Entry approximately `29900.00`
- rejected old TP1 approximately `29974–29975`
- operator white-line TP1 reference `29953.25`

The defect was not simply “too far.” The old zone geometry hugged the upper wick/extreme. v2.0.5 must build the broader reaction body and place the target around the middle with the approved slight upper lean.

### SHORT side

- Entry approximately `29666.00`
- rejected old TP1 approximately `29555.25`
- operator white-line TP1 reference `29600.75`

The old detector skipped the first meaningful lower reaction shelf and promoted a deeper shelf. v2.0.5 must qualify the nearer full-body reaction zone first and place TP1 around its middle.

The exact white-line prices are **golden case values only**. They must never be hard-coded as general target prices.

## Why 1H/4H are not executable TP lanes here

TradingView can request several timeframes in one Pine script. FX Replay's documented MTF surface is narrower. The parity target slice therefore remains **native 5m + one requested 15m lane**. 1H/4H remain context until a supported and tested parity mechanism exists.

## Certification boundary

Source/static checks can prove the intended geometry, ordering, parser-safe syntax patterns, and one-MTF contract. Actual FX Replay execution, rewind/pause behavior, exact reaction-zone bounds, and tick-for-tick comparison against TradingView still require a platform run.

Until the paired white-line cases reproduce correctly on both platforms, **full Python/Pine/FXR parity remains a certification blocker**.
