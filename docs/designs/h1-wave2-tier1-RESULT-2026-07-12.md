# H1 Wave-2 — Tier-1 Deterministic Detectors — RESULT + grader HOLD resolved (2026-07-12)

Tier-1 surface detectors (imperative + conditional-action + exclusion-contrast) built per the frozen spec, then INDEPENDENTLY GRADED (doer≠grader). The grader returned HOLD on a proven leakage vector; resolved by stripping the test-tuned component. This record carries the violation openly (pre-reg discipline: surface the gap, never absorb it silently).

## Build (doer) — files
`src/engine/extraction/tier1_detectors.py` (3 detectors + fall-through orchestration), `tier1_coverage_report.py` (materialization + harness), `fixtures/tier1_birth_fixtures.json`, `src/engine/tests/test_tier1_detectors.py` (30 tests, birth-gate as CI hard gate). 143/78 split materialized from `corpus-v3-heldout-split-2026-07-05.json` (restored from git `1521b467`), deterministic `sha256(condition_id) low-byte mod 10 < 3 -> held-out`; 143 design + 78 held-out (= 70 scorable + 8 UNRESOLVED) = 221, disjoint.

## Grader verdict: HOLD -> RESOLVED
**Reproduced clean (independent re-derivation):** 143/78 materialization (two paths, zero mismatch), birth-fixtures (30/30 pytest + novel-paraphrase probes — pattern-keyed, not fixture-memorized), coverage arithmetic (bit-for-bit).
**THE LEAKAGE VECTOR (grader-PROVEN, most severe):** the `_NOMINAL_ARTICLE` 'get an entry' guard had **ZERO effect on the 143 design set** (its two cited design exemplars never fire either way — blocked by unrelated mechanisms) and its ONLY measurable effect was suppressing exactly ONE held-out false-fire (`"if you didn't get an entry over here..."`, a phrase present ONLY in the held-out partition). A guard whose sole effect is to fix one held-out negative is definitionally held-out-tuned, regardless of the docstring's claimed design motivation — voiding the single-shot read (pre-reg §4.3). **Caught only by ABLATION, not by reading the docstring — the method lesson: a claimed-design-motivation is verified by removing the component and measuring, never by its comment.**
**Overfit ratio was noise (grader Claim 4):** 9/143 vs 5/78 — SE(≈2-2.8pp) exceeds the coverage gap; one fixture flips the ratio 0.981->0.818. 'Generalizes' was not supportable either way on these counts; the *gate* (<=1.85) clears with margin, the *ratio-as-evidence* does not.

## Resolution — guard stripped, honest numbers
The guard was REMOVED 2026-07-12 (it had no design merit to keep; removal is toward-honesty, anti-goalpost). Post-strip, single-shot re-run — and it reproduces the grader's independent ablation EXACTLY (two-path agreement):
| metric | shipped (leaked) | guard-stripped (HONEST) |
|---|---|---|
| birth-gate (all 3 families) | PASS | **PASS** (fires-on-pos ∧ silent-on-neg intact) |
| design_143 coverage | 6.29% | 6.29% (unchanged — guard had 0 design effect) |
| held-out_78 coverage | 6.41% | **7.69%** (the 'get an entry' now honestly fires) |
| overfit ratio vs 1.85 | 0.981 | **0.818 — PASS** (gate survives on design merit) |
| held-out false-fire | 2/33 = 6.06% | **3/33 = 9.09%** (the honest walkthrough-narration residual) |
| pytest | 30/30 | **30/30** (no test encoded the leaked behavior) |
The 9.09% residual is the Wave-1 walkthrough-narration hard class — correctly a tier-2 fall-through, NOT something to patch at tier-1 (patching it = the leakage we just removed).

## Disposition (Law 3 + Law 6)
- **Tier-1 detector LANDS in guard-stripped (design-honest) form.** Coverage gate PASS on design merit; high-precision/low-recall as specced.
- **The 78-held-out is now SPENT for tier-1** — observed once during development, tuning removed, violation documented. Its number carries the scope 'held-out touched, tuning stripped'; the overfit ratio is explicitly a noisy gate-pass, not a generalization claim.
- **The CERTIFIED validation is deferred to Wave 5 on the PRISTINE sealed fresh set** (16 videos, sealed `8e39ffe1`, never observed) — the clean single-shot the pre-reg reserves. Tier-1's real generalization number comes from ground it has not seen.
- Spec §6 WAVE-1-FEED: [A]/[D] resolved (the two Wave-1 ambiguity classes route to the uniform tier-1 fall-through, by construction); [B] confidence-floor, [C] compile-lints, [E] precision-co-gate left open (tier-2/3 scope).

*doer≠grader worked: the build looked all-green (0.981/6.06%/30-30); the independent grader proved one guard was quietly reading the answer sheet. The honest detector is less flattering (0.818/9.09%) and more true. Certification waits for the sealed set.*
