# Slumdawg FX Replay V2 Bundle

Status: **PLATFORM PARITY / RESEARCH ONLY**. Not live-decision-support approved.

FX Replay's current MTF documentation says `mtf.timeframe()` should be called once in `init()` and warns that the MTF API is beta. Because Slumdawg needs 15m entry/TP structure plus 4H/D/W context, the robust FXR implementation is a bundle rather than an undocumented multi-MTF hack.

## Load on a 5-minute MNQ/NQ replay chart

1. `slumdawg_v2_entry_tp_15m.fxr.js`
   - 15m CURRENT MOVE using persistent BOS state
   - 🟢 LONG / 🔴 SHORT Entry Zones
   - 15m primary + dense 5m fallback reaction-shelf TP search
   - 🎯 TP1/TP2/TP3 lines when qualified
   - standard reference/BREAK/PUSH state foundation
   - research-only strong-engulf momentum candidate marker

2. `slumdawg_v2_context_4h.fxr.js`
   - persistent 4H protected-structure context
   - draws the protected HIGH/LOW with BIG-DIRECTION wording
   - does **not** fake Daily confirmation

3. Existing Daily helper
   - `slumdawg_daily_levels_v0_1.fxr.js`

4. Existing Weekly helper
   - `slumdawg_weekly_levels_v0_1.fxr.js`

## Important parity limitation

The current documented FXR API does not provide a supported cross-indicator shared-state contract and documents one MTF timeframe request per indicator. Therefore a single FXR script cannot yet combine 4H + Daily + 15m into the exact TradingView V2 `🤖 SLUMDAWG TRADERS` box without either:

- violating documented MTF guidance, or
- silently approximating higher-timeframe state.

Both are forbidden by the V2 spec.

So this bundle is **FXR implementation-ready and testable**, but **full canonical BIG-DIRECTION/panel parity remains blocked on an FXR platform capability or an explicitly certified cross-script synchronization mechanism**. Entry/TP geometry must still be compared against the same golden fixtures used by Python/Pine.

## No hidden fallback

If TP1/TP2/TP3 cannot be produced from the supported 15m + chart-5m lanes, do not invent a target. Add a golden case and improve the canonical detector. 1H/4H target-lane parity is currently richer in Pine than in this FXR adapter because the FXR entry script has already used its one MTF request for 15m.
