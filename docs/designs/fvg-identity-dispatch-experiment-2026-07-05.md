# FVG Identity Dispatch — Phase 3 Increment 1 (Controlled Experiment)

**Status:** design locked (operator + GPT, 2026-07-05). Single-variable scientific experiment, NOT a framework expansion.

## Hypothesis under test
*Restoring semantic identity increases behavioral entropy across strategies.* — NOT "does FVG improve performance."

The corpus collapses (47 strategies → 17 behaviors; fidelity 96.6% approximation) because the binding compiler
routes every `WAIT_STRUCTURE` to one generic `structure_engine` regardless of the object (fvg/vwap/sweep/mss).
This is a **dispatch failure of identity preservation**, not missing logic. This experiment restores identity for
ONE object family (FVG) and measures whether the affected strategies **stop clustering**.

## Scope discipline (hard)
- **FVG object family ONLY.** No sweep, MSS, VWAP, order-block. No general framework refactor.
- **Single variable:** FVG identity on/off. Everything else byte-identical.
- The metric that decides success is **behavioral separation, NOT edge.** Edge is recorded, never judged here.

## Part A — Fresh minimal FVG detector (purity > convenience)
**Build fresh; DO NOT reuse `structure_engine`, `location_score`, `htf_context`, or any archetype evaluator** — reuse
would contaminate the causal axis with prior abstraction bias (the point-8 trap: routing ≠ preservation).

`src/engine/indicators/fvg_native.py` (new, isolated, OHLC-only, no HTF/regime/overlay/context imports):
- Input: OHLC arrays only.
- Rule (classic 3-candle imbalance): **bullish FVG** `low[i] > high[i-2]`; **bearish FVG** `high[i] < low[i-2]`.
- Output per bar: raw gap zone (upper/lower bounds), `filled/unfilled` boolean (simple forward scan only).
- No structure_engine call, no context. The FVG signal must remain a **distinct object into the execution trace**
  (`spec_trace`), tagged `fvg` — never collapsed to a structure call internally.

## Part B — Identity dispatch (minimal wiring)
1. `spec_family_bindings.py` — `WAIT_STRUCTURE`/`FILTER` whose object ∈ FVG-family
   (`fvg`, `fair value gap`, `imbalance`, `put limit order right fvg`) → bind to the native FVG primitive
   (`approximation=False`), mirroring the existing `resolve_session_keyword` object-token pattern. All other objects
   unchanged (still generic).
2. `spec_condition_compiler.py` — evaluate that binding via `fvg_native`, emit a distinct `fvg` trace contributor.

## Part C — Signature Divergence Score (SDS) harness (the science)
`scripts/signature-divergence.py` — one scalar, computed identically before/after and reusable for every future evaluator:
- Per strategy → distribution vector: entry-time histogram (session-binned 30–60), holding-time histogram,
  per-trade R histogram (+ optional downsampled equity-curve shape).
- Pairwise `D(i,j)` = mean of per-component **Wasserstein** (distributions) + **cosine** (normalized histograms);
  **KS-max** as sanity cross-check.
- **Family = concept** (video concept; ×3 symbol siblings = one family).
- **SDS = mean(inter-family D) / mean(intra-family D).** ≈1 = collapse; ≫1 = identity preserved.
- **Small-N guard (only ~18 FVG strategies):** bootstrap-resample pairwise set → **90% CI on SDS** + report
  **cluster stability under resampling**. Unstable shifts do not count.

## The controlled comparison
- Subset: the FVG-tagged strategies (+ a non-FVG control set for inter-family contrast).
- Run **before** (generic binding) vs **after** (FVG identity), same data/seed, single variable.
- **Primary (must move for the hypothesis to survive):** SDS ↑ with CI excluding "no change"; distinct signatures ↑;
  intra-cluster variance ↑; cross-strategy correlation ↓. Mechanical check: fidelity score ↑ on the affected strategies
  (binding actually flipped `approximation=False`).
- **Secondary (recorded, NOT judged):** edge/Sharpe shift.

## Decision gate
- **SDS rises (stable under resampling)** → identity dispatch works → expand to next object (sweep → MSS → VWAP), one at a time, same harness.
- **Fidelity ↑ but SDS flat/unstable** → **Prediction 2**: fidelity is NOT the dominant bottleneck. STOP adding evaluators;
  investigate upstream (extraction over-compression, normalization, evaluator semantics, execution model). This is a real, publishable result.

## Verification bar (before trusting the experiment)
1. `fvg_native.py` is genuinely isolated (no import of structure_engine/context/archetype) — grep-proven.
2. FVG binding flips `approximation=False` for the affected conditions; fidelity score rises on those strategies.
3. Non-FVG strategies' bindings + results are byte-identical (single variable).
4. FVG appears as a distinct contributor in `spec_trace` (point-8 preservation, not just routing).
5. SDS computed with bootstrap CI + stability; small-N caveat stated in the output.
