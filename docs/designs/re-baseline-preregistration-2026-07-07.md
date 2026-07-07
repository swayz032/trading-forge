# Re-Baseline Pre-Registration (item 0.5) — FROZEN before the 7/8/9 batch lands, 2026-07-07

**The judge's exam, written before the judge studies.** The re-baseline (null-cal -> Mode A/B on the fully-corrected
engine) re-validates the backtest instrument after Defects 4/7/8/9/10 surgery. Its criteria MUST be frozen NOW — if
written after the corrected engine produces its first numbers, whoever writes them will have seen the terrain, and that
is exactly when thresholds go soft. PROPOSED FOR OPERATOR RATIFICATION.

## Null-cal side (easy — unchanged)
Zero fabricated strategies survive the null-cal floor (the established floor, unchanged). Any fabricated strategy
surviving = instrument regression, full stop.

## Mode A/B side (the hard part — the corrected engine MOVES equity metrics by design)
Defects 4 (roll-cost omitted from equity loop), 7 (partial-fill idealized), 8 (VIX-margin over-sizing), 10 (look-ahead)
ALL move P&L, and we have pre-registered that historical numbers were OPTIMISTICALLY INFLATED on these axes. So a metric
SHIFT is expected — the question is which shifts are correction vs anomaly. Pre-registered now:

### EXPECTED — correction, NOT anomaly (re-validation criterion met)
- **Equity-metric shifts in the PRE-REGISTERED DIRECTION** — DOWNWARD for the optimism-inflating defects: roll-cost now
  deducted from equity (4), realistic partial fills (7), VIX-throttled sizing (8), look-ahead-tainted entries removed
  (10). Sharpe/PF/total-return moving DOWN on affected strategies is the fixes working.
- **WITH trade-count stability OUTSIDE the Defect-10 window classes** — trade counts change ONLY where the (a)/(b)/(c)
  taxonomy explains it (removed / occupancy-freed / timing-shifted); everywhere else, counts hold.

### ANOMALY — reopens investigation (re-validation withheld; stop and diagnose)
1. **Any zero<->nonzero flip** on an N=9-reference or v2-traded pair -> the LOCKED tripwire read-order fires (classify
   (a)/(b)/(c) on that pair FIRST -> every diff clean = fix working, reference stands -> any (d) or predicate-fail =
   FULL STOP, contradicting-evidence protocol, reference reopens).
2. **Any trade-count shift NOT classifiable under the (a)/(b)/(c) taxonomy** — an unexplained count change is an
   unmodeled interaction, not a correction.
3. **Equity shifts AGAINST the pre-registered direction** — a defect-fix that moves equity UP where it should move down
   means something is wrong (a fix mis-signed, or a second bug masking the first). Investigate, do not re-validate.

### Baseline comparison + tolerance
- **Compared against:** the last clean historical snapshot (the pre-defect-correction Mode A/B, e.g. the corpus-v2
  baseline), per-pair.
- **Drift tolerance is DIRECTIONAL + CLASSIFIABILITY-based, NOT a fixed % band** — the criterion is "shift is in the
  pre-registered direction AND every count change classifies," not "shift < X%." A magnitude band would itself be a soft
  threshold; the direction + taxonomy is the hard criterion. (Magnitude is reported as the receipt, not gated on.)

## Why frozen now
The 7/8/9 batch cannot land until this is ratified — otherwise the re-validation's own criteria would be authored by
someone who has already seen the corrected numbers. That is the one place Phase 0's ordering left open, and it closes
here. **Operator ratifies -> then the batch lands -> then the re-baseline runs its pre-written exam.**
