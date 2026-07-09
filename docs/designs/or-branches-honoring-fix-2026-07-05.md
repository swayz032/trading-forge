# OR-Branches Honoring — Composition Defect Fix + Re-Baseline (2026-07-05)

**Status:** design locked (operator + GPT, 2026-07-05).

## Confirmed defect (claim held at the evidence-supported level)
A **concrete, quantified composition defect, sufficient to explain the observed over-conjunction** — NOT yet
proven to be *the* mechanism for all downstream behavior (that is what the re-run tests).
- Extraction preserves OR structure: **726 `or_branches` across 108/117 strategies** (graph-to-engine.ts:
  "condition-id sets where ANY holds — alternative routes").
- Execution ignores it: `or_branches` consumed by **0 engine files**; `spec_condition_compiler.py` builds
  `spine_satisfied &= arr` — a **strict AND over every spine condition**.
- **576 OR-alternative condition-ids are spine-role**, so they are strictly ANDed despite being alternatives,
  across **93/117 strategies**. Educator said "A **or** B **or** C"; engine requires "A **and** B **and** C".
- Consistent with all three observed failures: corpus collapse (over-conjunction → rarely fires), increment-1
  single-object invisibility (gated by tightest AND term), increment-2 unsatisfiability (faithful evaluators
  for *alternatives* can't all hold at once → zero trades).

## Two correctness bugs (fix regardless — they violate intended semantics)
1. `_eval_wait_bias` hard-codes `want_bearish=False` → every WAIT_BIAS treated bullish regardless of object.
2. Confirmation OR-blends `bullish_confirm | bearish_confirm` → discards direction.
Fix on the default path; regression-verify ONLY the intended (directional) behavior changes.

## The fix — honor or_branches (flag-gated, single-variable)
`spec_condition_compiler.py` + `spec_family_bindings.py`, env-flag `TF_OR_BRANCHES_ENABLED` (default OFF):
- Conditions participating in an `or_branch` are combined with **ANY-holds** (logical OR) within their branch;
  the branch's OR-result is what enters the spine conjunction — NOT each alternative ANDed individually.
- Non-OR (plain spine) conditions and everything else: **byte-identical**.
- Nested composition (and_groups containing or_branches) handled per the extracted structure.

## Metric 1 — Composition Conservation Rate (CCR) — market-INDEPENDENT
`CCR = executed_OR_groups / expected_OR_groups`. Expected = OR-branches in the specs (726). Executed = OR-branches
the compiler actually evaluates as ANY. **Before = 0/726 = 0%. Target after ≈ 99%.** Report per-strategy + corpus.
This is the primary *engineering* success metric — semantic conservation is not noisy the way market outcomes are.

## Semantic regression tests (MUST pass BEFORE any market/SDS evaluation)
1. OR groups evaluate as ANY, not ALL.
2. Strategies with NO or_branches → byte-identical.
3. AND-only strategies unchanged.
4. Nested compositions (and_groups ⊇ or_branches) behave per extracted structure.
5. Sequencing semantics (WAIT_RETEST / temporal) unchanged (out of scope of this fix).
6. Provenance / trace unchanged (same condition-ids, same spans).
7. Ledger conservation (Ledger D handoff) still passes.

## Re-baseline (on the FULLY-corrected engine)
Deep-Scan #17 (commit e2029bc) already fixed backtest-truth P&L/gate CRITICALs (backtester/fill_model/
walk_forward/monte_carlo/risk_metrics). This fix stacks on top (different files — no collision). After BOTH land,
one clean re-baseline: null-cal → Mode A/B → composition experiment. Prior P&L numbers (null 0/100, Mode A/B, SDS
magnitudes) are suspect until this re-run; the STRUCTURAL findings (fidelity 96.6% approx, the OR→AND defect) are
unaffected (compile-time, #17 didn't touch spec_condition_compiler/spec_family_bindings).

## The falsification (re-run composition experiment, honor-OR ON vs OFF, else byte-identical)
Pre-registered predictions IF or_branches was the dominant cause:
- zero-trade strategies become tradeable; trade frequency ↑; zero-trade rate ↓.
- behavioral signatures separate; **SDS ↑** (reuse the pre-registered composition thresholds: MIN_EFFECT +0.20,
  floor 15 strategies/5 families, paired-delta 90% CI, decision applied once).
- fidelity stays high (binding still native).
- **CCR ≈ 99%** (semantic conservation restored) — this holds regardless of behavior.
IF CCR → ~99% but behavior does NOT move (SDS flat, zero-trade rate unchanged): the defect is REAL but NOT the
dominant behavioral bottleneck → next audit = extraction over-compression / sequencing / state-handling.

## Execution order (GPT-endorsed)
1. Fix the 2 correctness bugs + regression tests (only-intended-change proof).
2. Implement or_branches honoring behind the flag (single-variable).
3. Semantic regression tests (incl. CCR) — must pass BEFORE market evaluation.
4. Re-run the pre-registered composition experiment; evaluate BOTH semantic (CCR) and behavioral (trade freq,
   zero-trade rate, SDS, fidelity). Report both; apply the pre-registered SDS decision once.
Do NOT enable any flag in production. Do NOT commit until reviewed.
