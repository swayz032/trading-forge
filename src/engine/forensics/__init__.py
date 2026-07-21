"""src.engine.forensics — survivor-forensics gate modules.

Built per the frozen pre-registration
`docs/designs/survivor-forensics-preregistration-2026-07-19.md` (sha256
7fe3995b825d381452064858faebc5c92c162e9baf92dffd62ca1713c19e88f7, frozen at R-070).

- compile_fidelity : LEG A (Tooth-1 proper) — categorical per-condition compile-fidelity
  verdict + Phase-1 seal / Phase-2 fresh-reader countersign harness.
- calibration_battery : §4 CALIBRATION BATTERY FRAMEWORK — the m1..m7 mutation harness with
  a per-slot anti-vacuity-companion requirement. The mutations THEMSELVES are authored by an
  INDEPENDENT grader (doer != grader); this package ships only the harness + labelled
  framework-demonstration placeholders.

Pre-candidacy and INERT: the eligible survivor set is empty today (measured), so Leg A has no
candidate to grade. Every currently-known corpus spec fails Leg A(ii) categorically, which is
the correct measured state (see tests/test_compile_fidelity_leg_a.py).
"""
