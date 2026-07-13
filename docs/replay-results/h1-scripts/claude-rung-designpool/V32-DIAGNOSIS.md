# v3.2 DIAGNOSIS — mechanical Tier-A/B reclassification + defect-class (operator-ordered, answer-first)

## Reclassification of the 11 silenced items (compilability line: could a bot OBEY it?)

| # | strategy | item | executable? | TIER |
|---|---|---|---|:--:|
| 1 | -igp | backtest / compare win-rates / apply risk management | no (coaching) | **B** |
| 2 | 0xyg | daily-bias PRECONDITION ("once I have a daily bias I use this checklist") | yes — a precondition a bot gates on | **A** |
| 3 | 0xyg | box-variant AMD mechanic (deviation/manipulation → retest → other-side) | yes — executable entry mechanic | **A** |
| 4 | CLDE | draw-SELECTION rule (side taken first → opposite is the draw) | yes — executable selection logic | **A** |
| 5 | E9MzEC s0 | "accept the defined risk before entering" | no (coaching) | **B** |
| 6 | E9MzEC s0 | "don't expect this setup every day" (descriptive expectation, not a bound/filter) | no (coaching) | **B** |
| 7 | E9MzEC s1 | "accept the predefined risk before entering" | no (coaching) | **B** |
| 8 | IyF | "start small, scale up size, don't use all buying power" | no (coaching; house owns via baby-mode pyramid) | **B** |
| 9 | IyF | "be selective — one or two quality setups" | yes — frequency bound (1-2/day) | **A** |
| 10 | W7 | "be picky, only A+ versions, don't trade every day" | yes — frequency bound + A+ setup filter | **A** |
| 11 | dV7 | "first retest is highest-probability; don't trade every break/retest" | yes — occurrence-selection filter | **A** |

**Tier-A (silence = FAIL): 6** — 0xyg×2 (precondition + box mechanic), CLDE (draw-rule), IyF#9 (freq bound), W7 (freq+filter), dV7 (occurrence-selection).
**Tier-B (coaching_notes, record-not-gate): 5** — -igp, E9MzEC×3, IyF#8. Under the new taxonomy these are NOT content-fails; they become completeness-tracked coaching_notes.

## DEFECT-CLASS DIAGNOSIS — GRANULARITY GAP, not contract violation (uniform across all 6 Tier-A)
Checked each Tier-A silencing against the frozen Phase-A element_inventory (phaseb-scopes.json):
- 0xyg inventory = 5 PD-array variants only → NO precondition element, box element carried only "relaxes structure-shift" (not the AMD sub-mechanic). Inventory never carried it.
- CLDE inventory = TF variants + target-choice + mirror → NO draw-selection-rule element.
- IyF inventory = 3 support variants + breakdown-mention → NO selectivity/frequency element.
- W7 inventory = mirror + dispreferred-breakout → NO selectivity/frequency element.
- dV7 inventory = 2 entry-timing variants + mirror + Bookmap → NO first-retest occurrence-selection element.

**VERDICT: Phase-B did NOT violate the coverage contract** — it faithfully preserved/accounted-for every element the inventory carried. **The inventory's GRANULARITY was too coarse**: Phase-A enumeration never emitted preconditions, variant sub-mechanics, or Tier-A selection/frequency rules as inventory elements, so Phase-B was never held accountable to them. **Same instrument-defect class ZF8 minted (unregistered granularity in an instrument stage).** Fix belongs in Phase-A enumeration granularity + the extractor's coaching channel, NOT in blaming Phase-B.

## v3.2 FIX (targets both diagnosed defects)
1. `coaching_notes` Tier-B channel in extractor (record non-compilable coaching verbatim; never conditions).
2. Extend Phase-A enumerator inventory granularity: enumerate PRECONDITIONS, VARIANT SUB-MECHANICS, and Tier-A SELECTION/FREQUENCY rules as first-class inventory elements (compilability test in-prompt). Phase-B coverage contract then holds Phase-B accountable to them.
3. Mint 6 Tier-A fixtures (permanent): 0xyg daily-bias, 0xyg box-AMD, CLDE draw-rule, IyF 1-2/day, W7 A+/frequency, dV7 first-retest.
4. One retest, joint bar unmoved: re-extract under v3.2 → re-ground (grown denominator; recovered Tier-A can only push 7.6% UP = legitimate-fix signature) → re-grade content in full (flex, HIGH, cross-vendor). Clears → SHA freeze + terminal-read request. Misses → rung closes like GPT's, terra auditions ~$0.35.
