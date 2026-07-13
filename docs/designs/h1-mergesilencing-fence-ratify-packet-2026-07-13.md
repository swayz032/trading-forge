# H1 — MERGE-SILENCING FENCE — RATIFY-PACKET (2026-07-13)

> Instrument code, built under the standing launch protocol (instrument fixes autonomous under independent grader). Closes the §2-wiring-verify CRIT: R5L890's real merged (merge-silenced) object gets `pilot_grade=True` and sails through the terminal-read grade. On the critical path of EVERY deeper-fork branch (pass-2 recombined / cloud / human) — the cert layer is engine-agnostic.

## THE CRIT (observed, `R5L890_wiring_verify.json`)
Two stacked holes:
- **Hole 1 — producer:** the 3 structural lints return `NOT_EVALUATED (no_compiled_topology)` without a compiled-topology overlay. The A-packet (topology→full-grade) is **promoted from post-H1 queue to TERMINAL-READ PRECONDITION.**
- **Hole 2 — verdict:** the grade the terminal read consumes (`pilot_grade`) gates only on `f2 + causality-regex`; it does NOT gate on any structural lint. **CASE B proved topology alone changes nothing** — with the A-packet wired and `direction_conflation_lint` FAILing, `pilot_grade` is STILL True. The cheap fix ("just wire the A-packet") is dead.

## PINNED SEMANTICS — fail-closed (the conveyor's founding principle applied to the grade tier)
`NOT_EVALUATED` on a load-bearing lint = **INDETERMINATE**. For the terminal read's ≥60% video-unit bar, **only affirmatively-CLEAN counts — INDETERMINATE ≠ clean, REJECTED ≠ clean.** This is the strictest reading and the direct application of "NOT_EVALUATED is never a vacuous pass" — tonight we observed what happens when a grade tier is exempted from it.

**License re-scope (record honesty):** `pilot_grade` gating on the f2+causality subset was a LICENSED design decision (the F-1 two-grade ladder), adequate for a world that didn't know merge-silencing existed. That world ended tonight. This is new-evidence-re-scopes-the-license — total: **no terminal read consumes a grade that structural lints cannot fail.** `pilot_grade` itself is NOT changed (it remains the pilot-era artifact); a NEW `terminal_read_grade` is introduced as the only grade the sealed-12 read consumes.

## SWEEP THE CLASS (not the instance) — full lint × gating disposition table
Disease class = "verdict functions that gate a SUBSET while other lints can be NOT_EVALUATED or FAIL without moving the verdict." Every lint dispositioned; no silent exemptions. **Direction-check: every disposition pushes the verdict toward FAIL (the legitimate-fix signature)** — the single not-load-bearing exemption carries a stated proof.

| Lint | in `pilot_grade`? | **terminal_read_grade disposition** | direction |
|------|:---:|---|:---:|
| `direction_conflation_lint` | NO (the CRIT) | **GATE.** FAIL→REJECTED; NOT_EVALUATED→INDETERMINATE | →fail |
| `unsat_sat_check` | NO | **GATE.** Contradictory-comparator merge-silencing (5-SMA>50 ∧ 5-SMA<50) — same disease, one operand-level down. FAIL→REJECTED; NE→INDETERMINATE | →fail |
| `or_alternatives_honored` | NO | **GATE.** OR-alternatives strictly-ANDed = mis-packaged boundaries, a merge-silencing sibling. FAIL→REJECTED; NE→INDETERMINATE | →fail |
| `f2_coverage_gate` | YES | **GATE** (already; keep). FAIL→REJECTED. Never NOT_EVALUATED (always evaluable) | →fail |
| `causality_lint` — regex leg | YES | **GATE** (already; keep). regex-leg FAIL→REJECTED; regex-leg NE→INDETERMINATE | →fail |
| `causality_lint` — same_bar leg | NO | **PROVABLY-NOT-LOAD-BEARING (proof):** the same-bar-fill leg is execution-TIMING semantics (when a fill lands relative to signal), orthogonal to the terminal read's question — *did the machine faithfully carry what the trader TAUGHT?* Merge-silencing lives at strategy-object boundaries (direction / comparator / alternatives), fully covered by the 3 structural lints. Same-bar timing cannot make a merge-silenced object look clean or a faithful one look merged. NOT promoted to a precondition (operator promoted topology only). | exempt (proof) |

**Consequence (the forcing function):** without the A-packet, the 3 structural lints are NOT_EVALUATED → `terminal_read_grade = INDETERMINATE` → every video is not-clean → the ≥60% bar is unreachable. The fence makes it **impossible to pass a terminal read without the topology producer** — Hole 1 is forced fail-closed, not merely documented.

## THE FENCE (build)
New `terminal_read_grade(cert) -> {grade, clean, disposition}` in the cert layer:
- `grade = "CLEAN"` iff every load-bearing lint is affirmatively PASS (regex-leg PASS for causality).
- `grade = "REJECTED"` if any load-bearing lint is FAIL.
- `grade = "INDETERMINATE"` if any load-bearing lint is NOT_EVALUATED and none FAIL.
- `clean = (grade == "CLEAN")` — the ONLY value that counts toward the ≥60% video-unit bar.
- Wired into `assemble_certificate` output alongside `pilot_grade`/`full_grade`; carries the per-lint disposition for audit.

## CLOSURE CRITERION (the wiring-verify closes its own loop)
The fence is NOT done when the code lands. It is done when **the same R5L890 probe re-runs against the FENCED path and observes the catch — REJECTED or INDETERMINATE in BOTH configurations (topology ABSENT and topology PRESENT).** The probe that exposed the hole is the only witness qualified to certify the fence. Before/after pair vaulted together.

## GRADE (doer≠grader)
Independent grade dispatched after build: verify (1) the disposition table has no silent exemption and the one proof holds, (2) fail-closed semantics correct (NE→INDETERMINATE, not clean), (3) `pilot_grade` unchanged, (4) the closure re-probe genuinely catches in BOTH configs, (5) direction-check (every disposition →fail except the proven exemption).

---

## INDEPENDENT GRADE (doer≠grader, fresh-context adversarial) + WIRING FIX (2026-07-13)

Grade verdict: **grade layer SOUND (A–E all PASS), but criterion F FAILED — the fence was INERT.**
- A (disposition completeness): PASS — all 6 legs dispositioned, same_bar exemption proof holds (execution timing cannot mask a structural merge).
- B (fail-closed): PASS — FAIL dominates NE; NE→INDETERMINATE; clean only iff CLEAN.
- C (pilot_grade unchanged): PASS — additive.
- D (closure): PASS — real R5L890 witness catches in both configs.
- E (direction-check): PASS — monotone-toward-fail except the proven exemption.
- **F (fence consumed): FAIL** — nothing read `terminal_read_clean`; the terminal-read consumers still keyed on `pilot_grade` (`h1_pilot_phase3_finalize.py:142`, `pilot_conveyor.aggregate`'s fraction). A grade nothing reads cannot close a CRIT — the claimed-safeguards law firing on our own fence.

**FIX (applied, with a correction to the grader's literal prescription):** the grader said "repoint `h1_pilot_phase3_finalize.py:142`" — but that file is the SEALED PILOT's driver (ran, sealed `a73c1f60`), not the sealed-12 terminal-read driver (which does not exist yet). Repointing it would corrupt the sealed pilot record. Instead:
1. `pilot_conveyor.aggregate` now **additively exposes** `terminal_read_clean_n` + `terminal_read_clean_fraction` (from `cert["terminal_read_clean"]`). `pilot_grade_fraction` is UNCHANGED — sealed-pilot integrity preserved (and the fence only tightens the pilot's already-failed 0/16, so no re-read is owed).
2. Test proves the wiring: a merge-silenced cert (`pilot_grade=True`, `terminal_read_clean=False`) counts toward `pilot_grade_fraction`=1.0 but is EXCLUDED from `terminal_read_clean_fraction`=0.5.

**PINNED CONTRACT (the wiring requirement, now hard):** the sealed-12 TERMINAL-READ driver (frozen §6 read shape, when built) MUST gate its ≥60% video-unit bar on **`terminal_read_clean_fraction`**, NOT `pilot_grade_fraction`. The ratify-packet's earlier claim ("the only grade the sealed-12 read consumes") was aspirational at grade time; it is now TRUE-BY-CONTRACT — the instrument exposes the fenced fraction and this pin binds the driver to it. Until a terminal-read driver exists AND gates on it, the fence is wired at the instrument layer and contractually bound, but the end-to-end path completes only when that driver is built. Recorded honestly, not claimed done.
