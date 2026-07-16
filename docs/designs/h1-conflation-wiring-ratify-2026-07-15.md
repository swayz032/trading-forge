# CONFLATION-CHECK WIRING — RATIFY PACKET (2026-07-15, path-(d) step 4)
Autonomous instrument change (pre-live, consumes-not-rebaselines the certified reader). Scope-locked implementer -> independent grader.

## 1. WHAT & WHY
Re-base the terminal read's anti-merge-silencing structural axis from the 3 mechanical lints (proven BLIND on prose format — grader Band-3 NOT-SAFE) to the calibrated semantic conflation check (both-polarity certified). Repro: current terminal_read_grade gates on 3 structural lints which are NOT_EVALUATED/vacuous on real prose objects.

## 2. BLAST RADIUS
- terminal_read_grade gains a conflation_verdict input; its structural axis = that verdict, fail-closed.
- The 3 structural lints (direction_conflation/unsat_sat/or_alternatives) are REMOVED from the terminal-read gate and RE-STATIONED to the H2/compiled-spec layer (A-packet's real home). NOT deleted.
- f2_coverage_gate + causality regex-leg stay live at the terminal read (always-present inputs).
- pilot_grade UNCHANGED (pilot-era artifact). Certified reader UNTOUCHED.

## 3. EXACT CHANGE, SCOPE-LOCKED
- cert_assembler.terminal_read_grade: add `conflation_verdict: Optional[str]` param ("PASS"|"REJECT"|None). Structural axis rule: REJECT -> grade REJECTED; None (check absent/failed) -> INDETERMINATE (fail-closed, NOT clean); PASS -> structural axis clean. Combine with f2/causality as today (any FAIL -> REJECTED; any not-clean -> not-clean). CLEAN iff conflation PASS AND f2 PASS AND causality-regex PASS.
- Read harness (pilot_conveyor finalize): call the conflation check per strategy, pass verdict into terminal_read_grade.
- OUT OF SCOPE: the certified reader, extractor/enumerator, the conflation grader prompt (frozen at v1.1), pilot_grade/full_grade math (full_grade keeps all-5-lints for H2), the lints themselves.

## 4. NULLS / FAIL-CLOSED (pin)
Conflation absent or errored -> None -> INDETERMINATE (not clean). A read cannot pass without a real conflation verdict. Honest-null strategies (gestural exit) are unaffected — the conflation check judges co-required logic, which they have.

## 5. VERIFICATION (both polarities through the REAL terminal grade)
- WITNESS PAIR through the real harness: R5L890-FUSED -> conflation REJECT -> terminal_read_grade=REJECTED, clean=False. Known-good clean strategy -> conflation PASS + f2/causality PASS -> terminal_read_grade=CLEAN, clean=True.
- The 22 design-pool: terminal_read_clean_fraction computed via the conflation axis = 22/22 (matches the retro-run).
- Regression: existing cert_assembler/compile_lints tests still green (the lints unchanged; only their terminal-read GATING moves).

## ROLLBACK: revert the terminal_read_grade signature + harness call; falls back to prior lint-gated grade. No live default, pre-live.

## §5 UPDATE (F-1 verified): design-pool clean fraction = 22/22, reproduced by the grader's own repro over the PERSISTED v1.1 artifacts (not the stale v1 run). Wiring code independently graded Band 6 SAFE-TO-LAND, no test-gutting.
