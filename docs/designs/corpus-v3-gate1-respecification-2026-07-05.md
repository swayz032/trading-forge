# Corpus v3 — Gate 1 Re-Specification (PRE-REGISTERED before computation, 2026-07-05)

**Trigger:** Gate 1 FAILED at the pre-registered overall ≥85% (verified 70.0%, 49/70 held-out). Fable-5 (advisor)
ruling. This doc is locked BEFORE the human-vs-gold threshold is computed — the classifier's known scores cannot
be blinded, but the threshold is an empirical, non-tunable quantity nobody has computed yet.

## Record correction (parent-agent errors, stated plainly — not laundered)
1. The ceiling arithmetic `0.17×0.83 + 0.83×0.672 ≈ 70%` used the CLASSIFIER'S OWN margin score (67.2%) as the
   ceiling term — that computes where the classifier landed, NOT where the ceiling is. Circular.
2. `67.2% > 57.7%` compared classifier-vs-gold against human-vs-human INTER-RATER — different quantities/units.
3. The 57.7% figure was KNOWN at pin time (in the Fable-5 briefing); it was not a discovery. **The ONLY genuinely
   new fact is STRATUM COMPOSITION:** the design assumed deterministic rules would cover most conditions; instead
   82.9% of held-out (58/70) landed in the gemma margin. That surprise is the legitimate basis for re-examining
   the pin. The label-noise implication was foreseeable and we failed to foresee it — recorded as a miss.

## Gate role change
- **Gate 1 DEMOTED: certifying-proxy → NECESSARY SCREEN.**
- **Gate 3 (behavioral revival) is now the explicit DECISIVE gate**, UNCHANGED at its frozen rule (≥8/9 revival
  + zero unexplained regressions).
- **Pure-(c) REJECTED:** Gate 3 is small-N (9 strategies); dropping the semantic screen would let a classifier
  that is right for compensating reasons pass behaviorally. Keep BOTH, weight correctly.

## Re-specified Gate 1 pass criterion (LOCKED, threshold uncomputed)
Gate 1 (necessary screen) PASSES iff:
> the classifier's **margin-stratum agreement 95% binomial-CI LOWER BOUND (= 54.42%, known)** ≥ the empirical
> **human-vs-gold-on-margin agreement rate** (threshold, NOT yet computed).

Operationalization (fixed now):
- **human-vs-gold-on-margin** = agreement of the independent SECOND-pass rater's labels vs the FIRST-pass GOLD
  labels, restricted to the second-pass-subsample conditions that the DETERMINISTIC classifier routes to the
  margin (i.e. fall through rules 1-5 to gemma). Computed from `dri-audit-2026-07-05.json`
  `full_classification_table_second_pass_subsample` (71 conds) vs `full_classification_table_first_pass` (gold),
  intersected with the deterministic classifier's margin routing. NO new gemma calls — pure label comparison.
- **Gold construction MUST be documented** in the same record (single-rater first-pass / adjudicated / majority).
  If gold was adjudicated/reconciled, human-vs-gold rises and the bar rises with it — this is the honest risk.
- If human-vs-gold-on-margin comes back **> 54.42%**, Gate 1 stays FAILED and that verdict STANDS.
- If the human-vs-gold margin sample is itself too small for a stable rate, report LOW_POWER on the ceiling and
  do NOT certify (same discipline as the classifier-side LOW_POWER pin).
- The overall-≥85% condition is RETIRED as the Gate-1 pass gate (mis-specified relative to now-known stratum
  composition) — RETAINED only as a reported diagnostic, never as a pass/fail.

## Gate 3 NO-RELIEF pre-commitment (LOCKED, before Gate 3 runs)
The ceiling-relief reasoning applied to Gate 1 here is **NOT available to Gate 3.** If the revival proof fails
its frozen rule (≥8/9 revival AND zero unexplained regressions), **it fails — there is no "the pin was mis-formed"
argument in reserve.** Written down NOW so today's re-specification is honest, not precedent for the next miss.

## Also required (Fable-5 ruling)
- **(a) regardless:** expand deterministic rule coverage using ONLY the 143 rules-design conditions (non-circular),
  single re-test on held-out. Diagnostic FIRST: rule coverage on the design set vs the held-out 17%. If design-set
  coverage is much higher, the rules OVERFIT the design split — a separate finding to freeze.
- **Record notes:** rule-covered stratum 83.3% is N=12 — quote with its (wide) CI or not at all. The Gate 1 FAIL
  was self-reported honestly against the pre-registered pin — the pre-registration did its job; logged.
