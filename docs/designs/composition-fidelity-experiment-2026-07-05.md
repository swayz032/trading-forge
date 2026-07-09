# Composition Fidelity Experiment — Phase 3 Increment 2 (PRE-REGISTERED)

**Status:** pre-registered design (operator + GPT, 2026-07-05). The falsification test the FVG null pointed to.
Thresholds and sample floor are fixed **BEFORE** the after-run — no post-hoc reinterpretation.

## What the FVG null (increment 1) taught
Restoring ONE object's identity was statistically real (fidelity 0.443→0.467) yet behaviorally invisible
(SDS paired-delta CI [−0.0057,+0.0016], includes zero). Root cause: strategies are **AND-chains**; the
conjunction is gated by whichever condition is *rarest-true*, almost never the one object we restored.

## The question this experiment answers
**Does restoring identity at the CONJUNCTION level — specifically to the actually-gating conditions —
change the strategy's behavior?** (Not "does object X matter?")

## Pre-registered rule set (fixed before looking — this is what makes a negative CONCLUSIVE)

### Step 0 — identify the gating conditions (blind to SDS)
For each candidate strategy, measure per-spine-condition **true-frequency** on the real historical bars
(fraction of bars each condition's boolean is True). The **gating set** = the conditions whose true-frequency
is in the bottom tier (rarest-true) such that their conjunction determines ~all entry timing — operationally:
the smallest set of conditions whose AND reproduces ≥95% of the strategy's actual entry bars. Record it.

### Step 1 — restore the gating BUNDLE together
Build fresh, isolated native evaluators (same purity contract as `fvg_native.py`: OHLC/level-only, AST-proven
no `structure_engine`/context/archetype imports) for the OBJECTS carried by the gating conditions across the
test set — expected bundle from the approximation inventory: bias (`WAIT_BIAS`), confirmation
(`WAIT_CONFIRMATION`), structure objects (FVG already built; sweep/MSS as needed). Restore ALL gating
conditions of a strategy at once; leave non-gating conditions and everything else **byte-identical**.

### Step 2 — matched controls
- **Non-target control:** strategies in the SAME families whose gating conditions are NOT in the restored
  bundle → must stay byte-identical (single-variable proof).
- **Coverage control:** report per-strategy conjunction-fidelity (fraction of the *gating* set now native) —
  the experiment is only valid where gating-fidelity actually reached HIGH (target ≥ 0.80 of the gating set
  native). Strategies where we couldn't restore ≥0.80 of the gate are excluded from the primary test (and
  that exclusion is itself a finding).

### Step 3 — PRE-REGISTERED decision thresholds (set now, before the after-run)
Metric = SDS paired-delta (same bootstrap resample indices both modes), 90% CI, 1000 resamples.
- **MIN_EFFECT = +0.20 SDS** (baseline SDS ≈ 2.15; FVG-null noise ≈ ±0.006, so +0.20 is ~30× the noise floor —
  a behaviorally meaningful separation, not drift).
- **SAMPLE FLOOR:** ≥ 15 strategies with gating-fidelity ≥ 0.80, spanning ≥ 5 families. Below floor → result is
  **INCONCLUSIVE**, never reported as a conclusive negative.
- **Decision rule (evaluated once, after):**
  - **SUPPORTS** (conjunction fidelity moves behavior): paired-delta 90% CI **entirely > +0.20**, stable under
    resampling. → identity dispatch works at the conjunction level; expand systematically.
  - **CONCLUSIVE NEGATIVE (Prediction 2 confirmed):** paired-delta 90% CI **entirely < +0.20** (or includes
    zero) AT sample floor with gating-fidelity ≥0.80. → even conjunction-level identity restoration does not
    separate behavior. **Stop chasing evaluators.** The bottleneck is upstream (caching / extraction
    over-compression / execution model) — hand off to the parallel investigation.
  - **INCONCLUSIVE:** CI straddles +0.20, or below sample floor / gating-fidelity. → need more restored
    conditions or more strategies; NOT a negative.

## Reused instruments (do not rebuild)
`scripts/signature-divergence.py` (SDS + bootstrap CI + stability), `src/engine/indicators/fvg_native.py`,
`scripts/fvg-experiment-controlled-run.py` rig, the gating-frequency measurement path from increment 1.
Same execution instrument as increment 1 (documented fixed ATR-bracket for distribution sufficiency — never
claimed as edge), so before/after and increment-1/increment-2 are comparable.

## Purity contract (point-8, non-negotiable)
Every new evaluator: fresh, isolated, AST-proven no engine-context imports; emits a distinct trace contributor.
All flag-gated, default OFF. Non-target strategies byte-identical. Single variable: gating-bundle identity on/off.

## Parallel (NOT the primary falsification)
Characterize the upstream structure in parallel — the `spec_condition_compiler.py` shared-cached-generic-array
pattern (does one cached array serve multiple conditions, itself forcing collapse?) and extraction
over-compression (distinct educator concepts normalized to the same tokens). This becomes the PRIMARY line
only if the composition experiment returns a conclusive negative.

## Verification bar
1. Gating set per strategy reproduces ≥95% of actual entries (Step 0 validated).
2. New evaluators AST-proven isolated; gating-fidelity ≥0.80 reached on the primary set (report the n).
3. Non-target + non-gating conditions byte-identical.
4. SDS paired-delta with pre-registered thresholds applied ONCE; decision per the rule above; small-N/floor stated.
