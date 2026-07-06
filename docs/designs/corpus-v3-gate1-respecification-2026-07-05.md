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

## CERTIFIED RESULT (independently re-verified 2026-07-05)
- **human-vs-gold-on-margin = 29/43 = 67.44%** (95% Wilson CI [52.52%, 79.51%]; not LOW_POWER). Gold = single-rater
  first-pass (documented; NOT adjudicated) → same units as classifier-vs-gold. Overall inter-rater independently
  re-verified 41/71 = 57.75% (matches audit).
- **Locked criterion:** classifier margin CI-lower 54.42% ≥ 67.44%? **FALSE → Gate 1 STAYS FAILED (certified).**
- **The failure mode (finding, not relief):** classifier margin POINT 67.24% vs human ceiling POINT 67.44% —
  **statistically indistinguishable (~67% both, overlapping CIs). The classifier is HUMAN-EQUIVALENT on the margin.**
  It fails only the *demonstrable strict beat* the criterion required, which a human-equivalent classifier cannot
  satisfy against single-rater gold whose own inter-rater ceiling is 57.7%.
- **Overfit finding (frozen separately):** deterministic-rule coverage design-set 34.35% vs held-out 17.14% =
  **2.00× → rules OVERFIT the design split.** Option-(a) rule expansion is therefore weakly motivated — more rules
  likely overfit further rather than generalize on held-out.
- **Rule-covered stratum:** 10/12 = 83.33%, 95% Wilson CI [55.20%, 95.30%] (N=12, wide — cited with CI per ruling).

## DISCIPLINE NOTE (do NOT re-specify Gate 1 a third time)
Gate 1 was re-specified ONCE with a coin-in-the-air threshold; it failed honestly. Arguing now that "the screen is
unsatisfiable by a human-equivalent classifier, so relax it again" is the exact goalpost-move precedent the Gate-3
no-relief pre-commitment was written to forbid. **Gate 1 stays FAILED. The classifier does not clear the necessary
screen. Per the plan we do NOT proceed to Gate 3.** The path forward is an operator/advisor decision on a DIFFERENT
lever (gold quality / classifier approach / fallback), not a third re-spec.

## PATH FORWARD — Gate 1 RETIRED, replaced by Gate 1′ (Fable-5 ruling, LOCKED 2026-07-05)
Gate 1 (semantic bulk-screen) stays FAILED and UNCURED — the classifier never passes it. It is RETIRED, not
relaxed: the record shows the semantic bulk-certification was gold-noise-limited and replaced by a
behaviorally-anchored screen. (Diagnosis-not-appeal note: the locked criterion was asymmetric — classifier
CI-lower 54.42% vs human POINT 67.44%; under that test a second human rater would likely fail the first too.
That confirms "human-equivalent" is the right read of 67.24% vs 67.44%; it changes nothing about the certified FAIL.)

### Gate 1′ — targeted adjudication (LOCKED before any adjudication happens)
The screen function (catch a classifier wrong for compensating reasons) does NOT require certifying against 221
noisy labels — it requires high-quality adjudication of exactly the conditions that are BEHAVIORALLY DECISIVE.
- **Scope:** for every strategy whose trading behavior CHANGES between v2 and v3-shadow (revivals AND deaths),
  every condition whose ROLE ASSIGNMENT DIFFERS (v2 role ≠ v3 classifier role) gets fresh MULTI-RATER,
  transcript-anchored adjudication.
- **LOCKED pass rule:** every revival-driving role change must be UPHELD by adjudication; any OVERTURNED change
  is treated as an UNEXPLAINED REGRESSION under Gate 3's frozen clause and FAILS certification.
- **Can fail:** adjudicators have not looked; the classifier's known scores do NOT predetermine their verdicts.
- **doer≠grader extends to adjudicators:** their labels are CLAIMS until the transcript anchors are independently
  checked; multi-rater, independent, transcript-anchored.

### AND-certification pre-commitment (LOCKED before Gate 3 runs — knowledge-ordering hazard)
Running Gate 3 in the shadow namespace is legitimate (shadow prevents baseline contamination; "Gate 1 before
Gate 3" was flip-safety, not information). But if Gate 3 passes first, pressure builds to wave off adjudication.
**Certification for the flip requires Gate 3 (frozen rule: ≥8/9 revival + zero unexplained regressions, NO relief)
AND Gate 1′ (adjudication rule above) — regardless of the order results arrive or how good either looks alone.**

### Two freezes
1. **Rules-overfit CLOSED:** design 34.35% vs held-out 17.14% = 2.00× → option-(a) rule expansion is not merely
   capped but likely COUNTERPRODUCTIVE (more rules → more overfit). Closed; not pursued.
2. **Structural finding + gold-strengthening DEFERRED:** semantic bulk-certification is gold-noise-limited at
   ~57.7% single-rater label reliability; the classifier is at human parity on the margin. Gold-strengthening is
   NOT rejected — DEFERRED to corpus-scale, scoped to the MARGIN stratum only, if/when the classifier certifies
   via Gate 1′+Gate 3 and 117-strategy confidence is actually needed.
