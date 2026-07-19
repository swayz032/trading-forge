# AMENDED A-PACKET — `full_grade` gates on the SEMANTIC structural verdicts. RATIFY PACKET (2026-07-18)

Supersedes the structural-gate half of `h1-a-packet-topology-producer-ratify-2026-07-15.md`. Authorized by **R-039** (AR-030 ruled: option 3 ADOPTED, R-022 law extended to three layers). Autonomous class (instrument code, pre-live, consumes-not-rebaselines the certified reader + the calibrated conflation panel). Builds via scope-locked implementer → fresh-context independent grader.

## 0. WHY THIS AMENDMENT (the AR-030 finding, ruled R-039)
The original A-packet made the 3 mechanical structural lints (`direction_conflation_lint`/`unsat_sat_check`/`or_alternatives_honored`) EVALUATE at the cert layer so `full_grade` could gate on them. Independent grade (2× cycles) proved that gate **vacuous on real prose**: reproduced live — the campaign's own `conflation_fixtures/R5L890_FUSED_reject.json` (annotated "Must REJECT") and all 7/7 real `direction:"both"` staging_v32 strategies return `direction_conflation_lint = PASS`, because real conditions carry no per-condition long/short and the producer honestly stamps the strategy base-direction. The draft's FAIL polarity fired ONLY on hand-crafted fixtures injecting fields the real corpus never has = **fabricated safety claim** ([[feedback_hardcoded_test_copy_is_fabricated_safety_claim]]). Masked today only by the causality `same_bar` NOT_EVALUATED leg holding `full_grade` uniformly False ([[feedback_additive_fix_activates_dead_path]]).

**R-039 three-layer law (the fix, verbatim):** *Semantic cross-vendor checks are the load-bearing structural guarantee at EVERY prose-derived layer — including compiled topology, which INHERITS its source's signal-absence. Mechanical lints are load-bearing ONLY at layers whose PRODUCER emits the signal fields as structured data (the DSL/spec-compiler layer) — REACHABILITY DIAGNOSTICS everywhere else, annotated honest-vacuous, never safety-claimed.*

## 1. WHAT & WHY NOW — receipts
- `cert_assembler.py:404-420`: `full_grade = pilot_grade and all_five_pass and zero_not_evaluated`, where `all_five_pass` requires the 3 blind mechanical lints PASS and `zero_not_evaluated` includes causality's `same_bar_leg_status` (always NOT_EVALUATED here, `assemble_certificate` sets `same_bar_params_present=False` at :370). ⇒ `full_grade` is **structurally always False today** AND, were the `same_bar` gap closed reachability-first, would launder merge-silenced strategies (vacuous mechanical PASS).
- The load-bearing semantic axis ALREADY EXISTS + is calibrated: `terminal_read_grade` (`cert_assembler.py:186-296`) gates on `conflation_verdict` (gpt-5.4 panel) + `enumeration_consistency_verdict`, fail-closed. Calibration on disk: `conflation_grades/CAL_R5L890_FUSED.json` → `REJECT`; `conflation_grades/-igpOZs8LsM__s0.json` (mirror) → `PASS`; RETRO-22 = 22/22 clean (`CONFLATION-CHECK-CALIBRATED.md`).

## 2. BLAST RADIUS
- INVALIDATES nothing frozen. The certified reader + the calibrated conflation panel are CONSUMED read-only. The sealed-12 terminal-read PASS is untouched (uses `terminal_read_grade`, unchanged).
- `full_grade`/`certificate_grade` were **uniformly False in practice** pre-change (dead via `same_bar` NOT_EVALUATED). After: `full_grade` becomes REACHABLE, gated on the semantic verdicts — a strict monotone improvement (no certificate that was `full_grade=True` becomes False; there were none). `pilot_conveyor` `full_grade_n`/`full_grade_fraction` consumers see honest reachable values for the first time.
- The 3 mechanical structural lints stay in `compile_integrity` (still EVALUATE via the topology overlay — the producer's reachability work is salvaged) but are DEMOTED to diagnostics; their load-bearing station moves to the spec-compiler layer (SIBLING packet, R-039 pin 5).
- `pilot_grade` is UNCHANGED (pilot-era artifact).

## 3. THE EXACT CHANGE, SCOPE-LOCKED
`src/engine/extraction/cert_assembler.py`, `assemble_certificate` grade block ONLY:
- **`full_grade` becomes `pilot_grade AND terminal_read["clean"]`** — i.e. the pilot anchoring/classification/f2/causality-regex gate AND the terminal-read SEMANTIC-structural clean determination (`conflation_verdict` PASS + `enumeration_consistency` clean + f2 + causality-regex), fail-closed on an absent conflation verdict. Single-source: reuse the already-computed `terminal_read` result rather than re-deriving the semantic combination.
- **DROP** `all_five_pass` and `zero_not_evaluated` from the `full_grade` formula. The 3 mechanical structural lints and causality's `same_bar` leg NO LONGER gate `full_grade`.
- **DISPOSITION (Law 7, on the artifact):** add a `full_grade_basis` dict to the returned certificate recording the load-bearing axes (semantic conflation + enumeration + f2 + causality-regex) and the demoted ones — the 3 mechanical structural lints = `REACHABILITY_DIAGNOSTIC_NOT_SAFETY_GATING`, causality `same_bar` = `EXEMPT_NOT_LOAD_BEARING` (execution-timing, orthogonal to extraction fidelity; same classification `terminal_read_grade` already applies). This is the R-039 pin-3 same-wave disposition of the `same_bar` NOT_EVALUATED leg: **explicit classification, not a fire-the-leg fix** (its params are genuinely not supplied at cert assembly).
- `certificate_grade = full_grade` alias unchanged.

**EXPLICITLY OUT OF SCOPE:** the certified reader; the conflation panel / its calibration; the enumeration lint; `pilot_grade`; `terminal_read_grade`'s own logic; `compile_lints.py`; the topology producer's derivations; the runnable-spec compiler (SIBLING packet). No schema growth beyond the additive `full_grade_basis`. No LLM call (verdicts consumed as DATA).

## 4. TEST RE-BASE (R-039 pin 4)
- **NEW load-bearing both-polarity proof at the `full_grade` layer, on REAL fixtures + calibrated verdicts** (`test_cert_assembler.py`): R5L890-FUSED (real adversarial) + its calibrated `conflation_verdict="REJECT"` (loaded from `conflation_grades/CAL_R5L890_FUSED.json`) → `full_grade is False`. `-igp` mirror (real `-igpOZs8LsM__s0` staging strategy) + calibrated `conflation_verdict="PASS"` → `full_grade is True` (pilot conditions met). Direction check: strictly toward fail — the merge-silenced object is REJECTED, the honest mirror passes.
- **RELABEL** the mechanical-lint tests in `test_topology_producer.py`: they survive ONLY as explicitly-labeled SYNTHETIC UNIT PROBES of the mechanical lints' reachability/logic (hand-crafted per-condition fields) — NEVER as `full_grade`/merge-silencing safety evidence. Add the honest-vacuous annotation: on the REAL corpus these mechanical lints are diagnostics, calibration-blind on prose.
- **DoD unchanged + extended:** `run_a_packet_22.py` still shows 22/22 mechanical lints EVALUATE (reachability diagnostic). ADD: over the 22, with each strategy's calibrated `conflation_verdict` from `conflation_grades/`, `full_grade` is now reachable and HONEST (22/22 conflation PASS → full_grade tracks the semantic axis, not the vacuous mechanical one).

## 5. VERIFICATION PLAN
- `python -m pytest src/engine/tests/test_cert_assembler.py src/engine/tests/test_topology_producer.py -q` green, with the NEW real-fixture full_grade both-polarity test present.
- Reproduce the AR-030 defect is NEUTRALIZED: R5L890-FUSED → `full_grade False` via the SEMANTIC verdict (not the vacuous mechanical PASS, which is now a labeled diagnostic).
- Full receipt: before/after `full_grade` for R5L890-FUSED + the `-igp` mirror + the 22, with the load-bearing axis named.

## ROLLBACK
Single function's grade block. Revert = restore `full_grade = pilot_grade and all_five_pass and zero_not_evaluated`. Pre-live, no live default. `full_grade` returns to its prior uniformly-False state.

## INDEPENDENT GRADE
doer≠grader, fresh context. Must confirm: the semantic gate is load-bearing (REJECT fixture → full_grade False through the REAL path), the mechanical demotion is honest (no residual safety-claim on the mechanical lints), the same_bar disposition is classification not a masked fire, no caller regresses, and the both-polarity full_grade proof rests on REAL fixtures + calibrated verdicts (no hand-crafted-field safety evidence).
