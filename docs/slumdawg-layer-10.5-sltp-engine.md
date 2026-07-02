# Layer 10.5 — Institutional Stop Loss & Take Profit Engine

> Operator's SL/TP framework (2026-06-27), captured as a dedicated blueprint layer **between
> Execution and Trade Management**. Verified against the live code: **~75% already built** — the
> adaptive-exit engine IS Layer 10.5. This is **additive + recalibration, NOT a rip-and-replace**
> (Style C stays as the scale-out model). Philosophy: **Stop = where thesis breaks · TP = where
> liquidity sits · Size = adjusted to keep risk constant** (never fixed-RR retail logic).

## The spec (operator framework)
**Stop types** (priority hierarchy: Structural → Liquidity → Emergency):
1. **Structure stop** — below the HL (long) / above the LH (short). Trend/BOS/CHoCH trades.
2. **Liquidity stop** — below the sweep low / above the sweep high. Sweep-reversal setups (**core for Slumdawg**).
3. **Volatility stop** — ATR/session-vol; widens in expansion, tightens in compression (anti-wick).
4. **Order-flow stop** — delta flips / absorption / aggression dies → exit early (dynamic).
- **Emergency stop** — risk kill switch (max daily loss → flatten all).

**TP types:**
1. **Liquidity target** — PDH/PDL/PWH/PWL/EQH/EQL (**most important**).
2. **Volume target** — HVN/LVN/VAH/VAL.
3. **Risk multiple** — 1R/2R/3R (partials only, not the main model).
4. **Structure trailing** — hold until HL breaks / bearish CHoCH (runner upside).

**Scale-out:** Partial 1 (1R) / Partial 2 (liquidity) / Runner (structure trail). 6→2/2/2, 9→3/3/3, 12→4/4/4.

**Instrument stop templates:** MES 4-8pt (8-15 high-vol) · MNQ 20-40pt (40-80 high-vol) · MCL **ATR-only** (fixed = dangerous).

## Verified status map (grounded in code, 2026-06-27)

| Component | Status | Evidence / gap |
|---|---|---|
| **Structure stop** | ✅ BUILT | `structural_stops.py` (invalidation_swing + per-symbol sweep_buffer) |
| **Liquidity stop** (sweep-low anchor) | 🟡 PARTIAL | `liquidity_levels` + sweep detection exist; stop currently anchors on invalidation swing — needs sweep-low as a distinct anchor |
| **Volatility stop** (ATR) | ✅ BUILT | 1.5×ATR floor. ⚠️ **CEILINGS miscalibrated** — see recalibration below |
| **Order-flow stop** (delta/absorption) | 🔴 LOGIC-ONLY | `adaptive_exits.py:394` delta-divergence early-exit (threshold 0.6) exists, but `backtester.py:1040` "delta feed not available → delta_div_skipped". **Gap = the cumulative-delta/order-flow FEED**, not the logic |
| **Stop hierarchy** (struct→liq→emergency) | 🟡 PARTIAL | Structural stop + DLL kill switch (95% force-close) both live; no formal priority RESOLVER assembling them |
| **TP1 liquidity target** | ✅ in adaptive | `adaptive_exits.py:186 _build_liquidity_targets` picks TP1/TP2 from the liquidity snapshot |
| **TP2 liquidity target** | 🟡 **NOT DEFAULT** | Adaptive engine does it; the **74 strategies on `static_styleC` take TP2 at a mechanical +2.0R, ignoring `liquidity_levels`** (the #1 PnL gap) |
| **Volume target** (HVN/LVN) | 🟡 PARTIAL | VWAP/POC live; no true HVN/LVN node detection |
| **Risk-multiple partials** | ✅ BUILT | Style C TP1@1R / TP2@2R |
| **Structure trailing runner** | ✅ BUILT | `structure_trail` runner method (+ anchored_vwap / developing_poc / chandelier) |
| **Scale-out 2/2/2 → 3/3/3 → 4/4/4** | ✅ BUILT | Style C 33/33/34 = exactly 2/2/2 @6, 3/3/3 @9 (our new base) |
| **Instrument templates** | ⚠️ RECAL | ceilings below — MCL ATR-only is correct |

## ⚠️ The recalibration (verified live bug — do FIRST, coordinated)
Single source: `framework-overlay.ts:117 stopCeilingPts: { MES: 14, MNQ: 40, MCL: 25 }`. NQ is ~57%
higher / ES ~34% higher than when these were set, so the **MNQ 40pt ceiling now sits below the 5-min
noise floor (~25-40pt) and silently skips nearly every MNQ setup** — an MNQ backtest looks edgeless
when the real cause is "threw away every trade before sizing." Constant-dollar sizing means a wider
ceiling does NOT add per-trade risk (fewer contracts on wider stops).
- **MNQ 40 → ~62-80** (operator template: 40-80 high-vol)
- **MCL → ATR-only** (drop the fixed 25-tick cap; oil fixed-stop is dangerous)
- **MES floor → 6pt** + **VIX-tiered ATR multipliers**
- **Must land in 3 places together:** `framework-overlay.ts` (live overlay) + `backtester.py`/`structural_stops.py` (backtest parity) + `gate_block_analyzer.py` env (`STOP_CEILING_PTS_<SYM>`) — or every parity check diverges.

## What it supersedes
**Nothing is ripped out.** Style C *is* the scale-out model; the new framework formalizes + extends
it. So the migration is wiring + tuning + 2 real gaps, not a parity-bug-prone rewrite.

## Migration order (safe sequence)
1. **Stop-ceiling recalibration** (the verified bug) — HIGH value, LOW risk, but COORDINATED across overlay/backtester/analyzer. FIRST because every backtest + the gate-block analyzer need correct ceilings to measure anything.
2. **Liquidity-TP as default** — point `static_styleC` TP2 at `liquidity_levels` (or migrate the 74 strategies onto the adaptive engine that already does it). The #1 PnL lever (stop leaving money at structural levels).
3. **Formal stop hierarchy** — assemble the Structural→Liquidity→Emergency priority resolver.
4. **Order-flow stop** — wire the cumulative-delta/absorption FEED, then the logic lights up (it's already there). Bigger build; gated on the feed (Layer 5).
5. **HVN/LVN volume targets + sweep-low liquidity-stop anchor** — defer.

## Goal
Maximize expectancy while controlling drawdown — institutional SL/TP, not fixed 2:1 RR.
