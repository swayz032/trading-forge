# Phase: Execution Semantics — COMPLETE (frozen 2026-07-05)

**Archived as a completed research chapter before the extraction audit begins, so later discoveries don't
blur into the execution work.** This phase asked: *is the corpus collapse caused by the execution layer
faithfully representing the educators' strategies?* Answer below, with the wording held at the
evidence-supported level.

## The chapter (chronological, each step falsifiable)

| # | Experiment | Result | What it established |
|---|---|---|---|
| 0 | Corpus v2 fidelity baseline | median 0.44; 96.6% approximation | Execution fidelity is low. A real problem exists. |
| 1 | FVG identity dispatch | SDS paired-delta CI [−0.006,+0.002] | Single-object identity restoration is NOT the dominant driver. |
| 2 | Composition (gating bundle) | INCONCLUSIVE; 10/37 → 0 trades | "Not enough evaluators" ruled out; discovered conjunction-unsatisfiability. |
| — | Boolean Structure Audit | 726 OR-branches captured, 0 consumed, 576 spine-alternatives ANDed (93/117) | Located a concrete OR→AND composition defect. |
| 3 | OR-branches honoring + 2 bug fixes | CCR 0%→42%; SDS delta −0.087; 3/63 changed | OR-flattening real but NOT dominant. Two directional correctness bugs (bias always-bullish; confirmation direction-blind) had the larger effect. |
| — | Deep-Scan #17 (parallel session) | backtest-truth P&L/gate CRITICALs fixed | Execution P&L/gate layer corrected. |

## Findings, stated at the evidence-supported level
1. **Execution-layer semantic defects were identified and corrected** — two directional correctness bugs
   (bias, confirmation) and the OR→AND composition defect (`or_branches` now honored, flag-gated).
2. **Those defects were real but had limited explanatory power for the corpus collapse** — fixing them moved
   3/63 strategies (OR) and shifted trade frequency substantially only via the *directional* fixes.
3. **The execution layer is substantially DE-RISKED as the primary explanation** for the collapse — NOT
   "cleared" (leaves room for undiscovered execution issues), but no longer the leading suspect.
4. **Emergent signal:** the more faithfully the educators' stated logic is executed, the fewer trades —
   frozen baseline 0 zero-trade/611 median → 30 zero-trade/56 median after directional correctness alone.

## Durable instruments built this phase (reusable downstream)
- Execution Fidelity Score (`scripts/corpus-fidelity-score.py`)
- Approximation inventory (`scripts/corpus-approximation-inventory.py`)
- Signature Divergence Score harness (`scripts/signature-divergence.py`)
- Composition Conservation Rate (`scripts/or-branches-ccr.py`)
- 5 fresh isolated native evaluators (`fvg/bias/confirmation/sweep/mss_native.py`) — AST-proven pure
- Controlled-run rigs + paired-delta bootstrap (all `scripts/*-controlled-run.py`, `*-paired-delta.py`)

## Operational carry-forward (before trusting ANY P&L number)
The two directional bug fixes are default-on (real correctness fixes, large drift). The full corpus
re-baseline (null-cal → Mode A/B) on the now-fully-corrected engine (#17 P&L/gate + our composition/direction
fixes) is required before any profitability claim. Structural findings (fidelity, OR→AND) are unaffected.

## Next chapter
**Extraction over-specification audit** — see `docs/designs/extraction-overspecification-audit-2026-07-05.md`.
Leading (evidence-consistent, not established) hypothesis: *the extracted executable representation is
systematically more restrictive than the educator's actual decision process.* Measured by semantic inflation
(Decision Requirement Inflation), NOT profitability.
