# ENUMERATION-CONSISTENCY LINT — RATIFY PACKET (2026-07-15, operator order)
Autonomous instrument change (pre-live, POST-PROCESSING — frozen reader UNTOUCHED, conformance-in-post-processing law). Scope-locked implementer -> independent grader.

## 1. WHAT & WHY
A defect class INVISIBLE to every existing net: Phase-B re-promotes an enumeration-EXCLUDED mention into a runnable direction-tagged VARIANT. k=5 count-guard (count unchanged), completeness panel (hunts omissions not over-inclusion), conflation check (passes labeled alternatives) all miss it. Measured 1/22: IyF's `breakdown_continuation` variant (short) = the certified-excluded "breakdown big move" mention promoted. Repro: staging_v32/IyFioFkRgWo__s0.json variants[2] vs enumeration-exclusion-log.json IyF "breakdown".

## 2. BLAST RADIUS
- terminal_read_grade gains an enumeration_consistency axis (fail-closed). A cert with a promoted-excluded-mention variant -> not-clean.
- Mechanical post-processing diff of two on-disk artifacts (Phase-B variants vs exclusion log). Frozen reader/extractor/enumerator UNTOUCHED.
- Certificate carries scope line: "variant promotion beyond enumeration: measured lower-bound 1/22, lint armed at terminal read."

## 3. EXACT CHANGE, SCOPE-LOCKED
- NEW: enumeration_consistency_lint(strategy_extraction, exclusion_log_for_video) -> LintResult. For each variant in the strategy, check if it matches an excluded mention (key-term match on variant name/label/note AND, when the mention has a direction, the variant's direction == the excluded direction, i.e. opposite the strategy). Match -> FAIL (offending variant named). No variants / no match -> PASS.
- terminal_read_grade: add enumeration_consistency to the fail-closed structural axes (FAIL -> not-clean; absent log -> NOT_EVALUATED fail-closed).
- Blind-adjudication OVERRIDE hook: a variant may be promoted from FAIL to allowed ONLY by a recorded blind adjudication artifact (from source). Absent override, FAIL stands.
- OUT OF SCOPE: the certified reader, extractor/enumerator prompts, the conflation check, the other lints, pilot_grade/full_grade.

## 4. VERIFICATION (direction: strictly HARDER to grade clean = legitimate signature)
- FOUNDING FIXTURE IyF: breakdown_continuation variant vs excluded "breakdown" mention -> enumeration_consistency=FAIL -> terminal_read_grade not-clean.
- CLEAN witness: a strategy whose variants are all legitimate (no excluded-mention match) -> PASS.
- Run on the 22: expect >=1 FAIL (IyF) -- the fraction can only DROP vs the pre-lint 22/22 (recovered-content pushes DOWN here = the legitimate-fix signature, opposite of grounding but same honesty).
- Regression: existing tests green.

## ROLLBACK: revert the lint + its terminal_read_grade axis. No live default, pre-live.

## LANDED (2026-07-15): lint + fail-closed axis + COMPLETE 16-video exclusion log (12 re-derived blind + 4 founding). Empty-vs-absent semantic corrected (None=NOT_EVALUATED, []=PASS). Re-run: 21/22 PASS, IyF FAIL (breakdown_continuation vs excluded 'breakdown'/short), 0 NOT_EVALUATED. CERTIFICATE SCOPE LINE (operator): "variant promotion beyond enumeration: measured lower-bound 1/22, lint armed at terminal read." NEXT: independent grade (isolated packet). Note (dress-rehearsal grader catch): this axis was co-mingled uncommitted with the conflation-wiring packet -> now committed SEPARATELY, isolating the two terminal_read_grade edits.
