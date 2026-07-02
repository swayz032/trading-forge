# Trading Methods & Edge — what Slumdawg actually does (reference)

Slumdawg (the bot) trades like an institutional desk, not a retail scalper: **1–2 A+ trades
per day per account**, big structural moves (14–24pt MES, 2R+), not many small scalps. The
edge is a weighted **confluence** of independent institutional signals, with adaptive exits
and risk-derived sizing. (Methods consensus: Raschke, Grimes, Bellafiore/SMB, ICT concepts,
Topstep funded-trader research.)

## Market structure (the skeleton)
- **BOS** (break of structure) = trend continuation; **CHoCH** (change of character) = first sign
  of reversal; **MSS** (market structure shift) = confirmed reversal. Computed by an independent
  Structure Engine BEFORE the entry trigger (fixes the circular "structure is true because I
  entered" bug).
- **PD zones / dealing range:** premium (sell zone) vs discount (buy zone) vs equilibrium.
  Institutions buy discount, sell premium — the opposite of retail "buy strength."

## The 11-factor confluence model (weighted, not boolean)
Each signal contributes a weight; the strategy fires when the weighted score clears ~0.72:
market_structure_aligned (0.20), liquidity_target_clear (0.13), smt_confirmation (0.10),
vwap_alignment (0.10), killzone_active (0.08), delta/volume_signature (0.08), vp_level_proximity
(0.08), **macro_alignment (0.08 — HARD BLOCK: FOMC/CPI/NFP = score 0)**, internals_aligned (0.05),
cross_asset_aligned (0.05), regime_match (0.05). Factors **decay** with age (a stale CHoCH or a
3×-touched order block loses weight). MCL zeroes internals → cross_asset.

## Order-flow + liquidity
- **VWAP** institutional model: long is satisfied when price is at a **discount** (below VWAP),
  short at a premium — corrects the retail "long above VWAP." Plus 1σ/2σ band rejections +
  anchored VWAP retests.
- **SMT divergence** (ES↔NQ): when the two indices disagree at a high/low, it flags exhaustion.
- **Liquidity map (DOL = draw on liquidity):** PDH/PDL, prior session highs/lows, naked POCs,
  untouched FVGs/OBs, EQH/EQL with a sweep-probability score. Intraday targets only — the bot
  never chases weekly/monthly levels (day-trader mandate).

## Regime + narrative
- **5 regimes:** TRENDING, EXPANSION, COMPRESSION, HIGH_VOL_MACRO, LOW_LIQ_CHOP — each routes a
  different playbook and exit/scaling profile.
- **A/M/E narrative state machine:** Accumulation → Manipulation → Distribution → Reversal. Desks
  enter on Distribution, not on the manipulation sweep that traps retail.

## Exits — Style C (default) and Adaptive
- **Style C 33/33/34:** TP1 33% @ +1R, TP2 33% @ +2R, runner 34% trails developing-session POC
  (Chandelier fallback). Stop → BE+1 tick on TP1 fill. 15:55 ET hard flatten.
- **Adaptive (opt-in):** liquidity-mapped TPs, regime-dependent scaling (bigger runner in trends,
  quick harvest in ranges), delta-divergence early exit, AVWAP runner trail, pre-lunch harvest.
  Invariants preserved in BOTH engines: 15:55 flatten, BE+1, 67% DLL halt, 95% force-close.

## Risk + sizing (risk-management-bounded, not contract-count-bounded)
- **Structural stops, never fixed-point:** invalidation swing + sweep buffer; floor 1.5×ATR
  (+6pt MES min); ceiling 14 MES / 62 MNQ / 1.00pt MCL. Wider than ceiling → SKIP.
- **Risk-derived pyramid:** size = min(pyramid tier, risk-cap, firm cap, liquidity cap,
  drawdown-room cap). The pyramid is the slow floor; risk math is the ceiling — lowest wins.
  Base 9 MES / 9 MNQ / 18 MCL, +3 per proven-trade tier, 50-micro final cap.
- **DLL ladder:** reduce size ×0.5 at 60% of personal DLL, HALT new entries at 67%, FORCE-CLOSE
  at 95%. Personal DLL = 67% of firm DLL.
- **News:** Tier-1 (FOMC/CPI/NFP) hard-blocks via macro_alignment; firm-aware (Topstep
  caution/reduce, MFFU restricted).

## How to reason about a strategy as Carter
Strong = real structural entry + multiple independent confluences that aren't all the same idea +
clean WF/PBO/B14 + survives parameter jitter (B15). Weak = single-factor, fitted parameters,
high BIF, ruin CI near the limit, or edge concentrated in one regime. Always separate "fragile"
(fails B15) from "overfit" (fails WF/PBO) — they need different fixes.
