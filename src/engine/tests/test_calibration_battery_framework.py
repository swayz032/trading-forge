"""§4 CALIBRATION BATTERY FRAMEWORK tests — frozen pre-reg §4 (doer != grader).

Proves the harness is REAL, not empty (it convicts a mutant and its anti-vacuity companion
distinguishes it from a clean spec), AND that the doer != grader boundary is machine-enforced:
a placeholder-populated battery can NEVER report status CALIBRATED, and an unfilled slot fail-
closes to INCOMPLETE.
"""

from __future__ import annotations

from src.engine.forensics.calibration_battery import (
    PLACEHOLDER_LABEL,
    REQUIRED_SLOTS,
    STATUS_CALIBRATED,
    STATUS_FAILED,
    STATUS_INCOMPLETE,
    STATUS_PLACEHOLDER,
    MutationCase,
    run_calibration,
)
from src.engine.forensics.compile_fidelity import PASS
from src.engine.tests._forensics_fixtures import (
    _mutant_inputs,
    _rehash,
    clean_artifact,
    clean_certificate,
    clean_inputs,
    m2_both_forms_cases,
    m2_launder_drop_inputs,
    m2_naive_drop_inputs,
    m4_false_flag_inputs,
    m4_matching_label_companion,
    placeholder_cases,
    robust_six_real_cases,
    shared_anchor_legit_companion,
)


def test_seven_slots_are_the_frozen_set():
    assert set(REQUIRED_SLOTS) == {"m1", "m2", "m3", "m4", "m5", "m6", "m7"}


def test_clean_baseline_passes_whole():
    # The battery's known-good baseline must pass Leg A whole (else the calibration is moot).
    assert clean_inputs().run().verdict == PASS


def test_harness_convicts_every_placeholder_and_companion_distinguishes():
    result = run_calibration(clean_inputs(), placeholder_cases())
    assert result.clean_passes_whole
    for sid in REQUIRED_SLOTS:
        sr = result.slot_results[sid]
        assert sr.filled, sid
        assert sr.convicted, (sid, sr.detail)               # Leg A BLOCKed the mutant
        assert sr.mutant_trips_target, (sid, sr.detail)      # on the intended check
        assert sr.clean_passes_target, (sid, sr.detail)      # which the clean spec passes
        assert sr.distinguishes, (sid, sr.detail)            # anti-vacuity companion holds
        assert sr.ok, (sid, sr.detail)


def test_placeholders_never_report_calibrated():
    # THE doer != grader GUARD: placeholders exercise the harness but can never be a calibration.
    result = run_calibration(clean_inputs(), placeholder_cases())
    assert result.status == STATUS_PLACEHOLDER
    assert result.status != STATUS_CALIBRATED
    for sr in result.slot_results.values():
        assert sr.is_placeholder


def test_unfilled_slot_fails_closed_to_incomplete():
    cases = placeholder_cases()
    del cases["m4"]
    result = run_calibration(clean_inputs(), cases)
    assert result.status == STATUS_INCOMPLETE
    assert not result.slot_results["m4"].filled


def test_a_mutant_that_is_not_convicted_fails_the_battery():
    # A slot whose "mutant" is actually the clean spec (no real mutation) must NOT convict →
    # the battery reports FAILED, not a false CALIBRATED/PLACEHOLDER pass.
    cases = placeholder_cases()
    cases["m5"] = MutationCase("m5", PLACEHOLDER_LABEL, "iv", clean_inputs(), is_placeholder=True)
    result = run_calibration(clean_inputs(), cases)
    assert result.status == STATUS_FAILED
    assert not result.slot_results["m5"].convicted


def test_calibrated_status_requires_all_nonplaceholder():
    # Simulate what an INDEPENDENT grader's authored (non-placeholder) slots would yield: reuse
    # the placeholder mutants' mechanics but flip is_placeholder=False. This proves the ONLY gate
    # between PLACEHOLDER and CALIBRATED is the placeholder flag — i.e. authorship — exactly the
    # doer != grader boundary. (The live mutations remain the grader's to author; this test only
    # verifies the status machine, using the demonstration mechanics as a stand-in.)
    graded = {
        sid: MutationCase(c.slot_id, "grader-authored-STANDIN", c.targeted_check, c.mutant, is_placeholder=False)
        for sid, c in placeholder_cases().items()
    }
    result = run_calibration(clean_inputs(), graded)
    assert result.status == STATUS_CALIBRATED, result.reasons


# --------------------------------------------------------------------------- #
# MULTI-CASE-PER-SLOT harness widening (R-268 §3 unblock). These are HARNESS-LEVEL
# red-proofs — they exercise the PLUMBING that lets one slot carry several cases each
# with its OWN anti-vacuity companion. They author NO live m2/mutation content: every
# case is a clearly-labelled FRAMEWORK_DEMONSTRATION_PLACEHOLDER reusing the existing
# demonstration mechanics. The LIVE m1..m7 (and the both-forms m2) remain the
# independent grader's to author (doer != grader).
# --------------------------------------------------------------------------- #
def test_multicase_slot_one_convicts_one_does_not_fails_the_battery():
    # RED-PROOF (i): a slot given a LIST of two cases, one convicting and one NOT
    # (its "mutant" is the clean spec) → the slot FAILS and status is not CALIBRATED.
    cases = placeholder_cases()
    convicting = cases["m5"]  # placeholder that convicts on 'iv'
    non_convicting = MutationCase(
        "m5", PLACEHOLDER_LABEL, "iv", clean_inputs(), is_placeholder=True,
    )  # "mutant" is clean → not convicted
    cases["m5"] = [convicting, non_convicting]
    result = run_calibration(clean_inputs(), cases)
    assert result.status == STATUS_FAILED, result.reasons
    assert result.status != STATUS_CALIBRATED
    sr = result.slot_results["m5"]
    assert not sr.ok
    # per-case breakdown is preserved (not silently collapsed to one boolean)
    assert len(sr.cases) == 2
    assert [c.convicted for c in sr.cases] == [True, False]


def test_multicase_slot_companion_that_fails_target_kills_distinguishes():
    # RED-PROOF (ii): a case whose per-case COMPANION does NOT pass the targeted check
    # → distinguishes=False → slot FAILS. This proves the per-case companion is actually
    # consulted: the SAME mutant with the default global-clean companion distinguishes fine.
    ph = placeholder_cases()
    m5_mutant = ph["m5"].mutant  # a known input that FAILS check 'iv'

    # Control: no per-case companion → falls back to the clean spec, which PASSES 'iv'.
    control = placeholder_cases()
    control["m5"] = MutationCase("m5", PLACEHOLDER_LABEL, "iv", m5_mutant, is_placeholder=True)
    control_result = run_calibration(clean_inputs(), control)
    assert control_result.slot_results["m5"].distinguishes  # companion (global clean) passes 'iv'
    assert control_result.status == STATUS_PLACEHOLDER, control_result.reasons

    # Attack: give the case a companion that FAILS 'iv' (reuse the failing mutant input as
    # the "known-good" companion). The companion no longer passes the targeted check →
    # distinguishes must flip to False and the slot must FAIL.
    attack = placeholder_cases()
    attack["m5"] = MutationCase(
        "m5", PLACEHOLDER_LABEL, "iv", m5_mutant, is_placeholder=True, companion=m5_mutant,
    )
    attack_result = run_calibration(clean_inputs(), attack)
    sr = attack_result.slot_results["m5"]
    assert not sr.distinguishes
    assert not sr.clean_passes_target  # the per-case companion failed 'iv'
    assert not sr.ok
    assert attack_result.status == STATUS_FAILED, attack_result.reasons


def test_multicase_slot_two_convicting_distinguishing_cases_is_ok():
    # RED-PROOF (iii): a slot with TWO convicting + distinguishing cases, each with its OWN
    # passing companion → the slot is OK on that slot. Both cases are labelled placeholders
    # (NOT live m2), so the overall status stays PLACEHOLDER, never CALIBRATED.
    ph = placeholder_cases()
    case_a = MutationCase(
        "m2", PLACEHOLDER_LABEL, "ii", ph["m1"].mutant, is_placeholder=True, companion=clean_inputs(),
    )  # convicts, trips 'ii'; companion passes 'ii'
    case_b = MutationCase(
        "m2", PLACEHOLDER_LABEL, "iv", ph["m5"].mutant, is_placeholder=True, companion=clean_inputs(),
    )  # convicts, trips 'iv'; companion passes 'iv'
    cases = placeholder_cases()
    cases["m2"] = [case_a, case_b]
    result = run_calibration(clean_inputs(), cases)
    sr = result.slot_results["m2"]
    assert sr.ok, sr.detail
    assert len(sr.cases) == 2
    assert all(c.ok and c.convicted and c.distinguishes for c in sr.cases)
    assert result.status == STATUS_PLACEHOLDER, result.reasons
    assert result.status != STATUS_CALIBRATED


# =========================================================================== #
# JOB 2 — the REAL (non-placeholder) m2 BOTH-FORMS, permanently fixtured.
# The m2 slot must convict BOTH the naive drop AND the laundered drop on check (v), each
# distinguished by its OWN anti-vacuity companion (R-268 §3 (b)-leg / R-267 §1: the battery
# grows the sub-case that defeated it). These are GRADER-authored in the fixtures layer; the
# detector is untouched.
# =========================================================================== #
def test_m2_naive_and_launder_each_block_on_v():
    # Each form, run standalone through Leg A, BLOCKs on the (v) drop-audit.
    naive = m2_naive_drop_inputs().run()
    assert naive.verdict != PASS
    assert "v" in naive.checks_failed, sorted(naive.checks_failed)

    launder = m2_launder_drop_inputs().run()
    assert launder.verdict != PASS
    assert "v" in launder.checks_failed, sorted(launder.checks_failed)


def test_shared_anchor_companion_passes_v_non_vacuously():
    # The launder companion must PASS (v) — and NON-vacuously: the certificate is well-formed
    # (vi_cert passes) so the drop-audit actually RAN, and (v) is genuinely satisfied via the
    # shared-anchor bijection (not skipped because the cert was malformed). It also passes whole.
    res = shared_anchor_legit_companion().run()
    assert "v" not in res.checks_failed, sorted(res.checks_failed)      # (v) passes
    assert "vi_cert" not in res.checks_failed, sorted(res.checks_failed)  # drop-audit truly ran
    assert res.verdict == PASS, res.summary                              # whole-clean known-good


def test_m2_both_forms_certify_the_slot_but_status_stays_placeholder():
    # THE JOB-2 CERTIFICATION: the m2 slot carries the two REAL cases as a LIST; both convict on
    # (v); each is distinguished by its OWN per-case companion; and — because m1,m3..m7 are still
    # placeholders — the OVERALL status stays PLACEHOLDER, proving m2 ALONE cannot fake CALIBRATED.
    cases = placeholder_cases()
    cases["m2"] = m2_both_forms_cases()
    result = run_calibration(clean_inputs(), cases)

    sr = result.slot_results["m2"]
    assert sr.ok, sr.detail
    assert len(sr.cases) == 2
    assert not sr.is_placeholder                       # both m2 cases are REAL (non-placeholder)
    assert [c.convicted for c in sr.cases] == [True, True]
    assert [c.distinguishes for c in sr.cases] == [True, True]
    assert [c.companion_source for c in sr.cases] == ["case", "case"]  # per-case companions used
    assert [c.targeted_check for c in sr.cases] == ["v", "v"]
    # labels record the two distinct forms
    assert {c.label for c in sr.cases} == {"m2-naive-drop-orphan-cert", "m2-launder-duplicate-anchor"}

    assert result.status == STATUS_PLACEHOLDER, result.reasons
    assert result.status != STATUS_CALIBRATED


# =========================================================================== #
# JOB 1 — adversarial probes on the multi-case AGGREGATION (guard-design: the 5 ways a guard
# silently stops guarding). These author NO live mutation content; they attack the plumbing.
# =========================================================================== #
def _all_real_slots():
    """An all-REAL (non-placeholder) battery that yields CALIBRATED — the ceiling the probes push
    against. Reuses the placeholder mechanics with is_placeholder=False (status-machine stand-in;
    the live m1..m7 remain the grader's to author). This is the baseline a weakening would let
    slip to a false CALIBRATED."""
    return {
        sid: MutationCase(c.slot_id, "grader-authored-STANDIN", c.targeted_check, c.mutant, is_placeholder=False)
        for sid, c in placeholder_cases().items()
    }


def test_probe_all_real_baseline_is_calibrated():
    # Control: the all-real baseline reaches CALIBRATED, so every probe below that does NOT reach
    # CALIBRATED is discriminating (the guard actually had something to stop).
    assert run_calibration(clean_inputs(), _all_real_slots()).status == STATUS_CALIBRATED


def test_probe_placeholder_mixed_into_all_real_slot_blocks_calibrated():
    # ATTACK: a slot that is otherwise all-real gains ONE placeholder case. The slot still reports
    # ok=True, but is_placeholder=True must propagate (any-of-cases) → status drops to PLACEHOLDER,
    # never CALIBRATED. Proves a placeholder cannot hide inside a multi-case slot.
    g = _all_real_slots()
    real = g["m2"]
    ph = MutationCase("m2", "FRAMEWORK_DEMONSTRATION_PLACEHOLDER", real.targeted_check, real.mutant, is_placeholder=True)
    g["m2"] = [real, ph]
    result = run_calibration(clean_inputs(), g)
    sr = result.slot_results["m2"]
    assert sr.ok                       # both cases convict+distinguish
    assert sr.is_placeholder           # but the placeholder taints the slot
    assert result.status == STATUS_PLACEHOLDER, result.reasons
    assert result.status != STATUS_CALIBRATED


def test_probe_empty_case_list_fails_closed_to_incomplete():
    # ATTACK: an EMPTY list for a slot must be treated as UNFILLED (fail-closed INCOMPLETE), never
    # silently OK/CALIBRATED. A multi-case slot with zero cases is not "all cases passed".
    g = _all_real_slots()
    g["m3"] = []
    result = run_calibration(clean_inputs(), g)
    assert not result.slot_results["m3"].filled
    assert result.status == STATUS_INCOMPLETE
    assert result.status != STATUS_CALIBRATED


def test_probe_and_over_cases_one_non_convicting_fails_the_slot():
    # ATTACK: a slot OK must require EVERY case to convict (AND-over-cases), not ANY. Pair a real
    # convicting case with one whose "mutant" is the clean spec (never convicts) → slot FAILS.
    g = _all_real_slots()
    g["m4"] = [g["m4"], MutationCase("m4", "STANDIN", "m4_false_flag", clean_inputs(), is_placeholder=False)]
    result = run_calibration(clean_inputs(), g)
    sr = result.slot_results["m4"]
    assert not sr.ok
    assert [c.convicted for c in sr.cases] == [True, False]
    assert result.status == STATUS_FAILED, result.reasons


def test_probe_per_case_companion_is_consulted_not_defaulted_to_global_clean():
    # ATTACK (companion-consulted): give a REAL m2 case a per-case companion that itself FAILS (v)
    # (the naive-drop mutant reused as a bogus "known-good"). If the harness defaulted a failing
    # companion back to the global clean, the slot would still pass — it must NOT. distinguishes
    # must flip False and the battery must FAIL.
    #
    # ★ PRE-WIDENING IMPOSSIBILITY: this probe cannot even be expressed on 59e6bf9a~1 — that
    # MutationCase had no `companion` field (MutationCase(..., companion=...) raises TypeError) and
    # run_calibration read a single GLOBAL clean for every slot. The widening is what makes a
    # per-case companion a consulted, falsifiable input.
    bogus = m2_naive_drop_inputs()  # BLOCKs on (v) → a companion that does NOT pass (v)
    g = _all_real_slots()
    g["m2"] = MutationCase("m2", "STANDIN", "v", m2_naive_drop_inputs(), is_placeholder=False, companion=bogus)
    attack = run_calibration(clean_inputs(), g)
    sr = attack.slot_results["m2"]
    assert sr.cases[0].companion_source == "case"  # the per-case companion WAS consulted
    assert not sr.clean_passes_target      # the per-case companion failed (v)
    assert not sr.distinguishes
    assert not sr.ok
    assert attack.status == STATUS_FAILED, attack.reasons

    # Control: the SAME mutant with NO per-case companion falls back to the global clean, which
    # passes (v) → distinguishes → CALIBRATED. The only difference is the companion, proving it is
    # consulted.
    g2 = _all_real_slots()
    g2["m2"] = MutationCase("m2", "STANDIN", "v", m2_naive_drop_inputs(), is_placeholder=False)
    control = run_calibration(clean_inputs(), g2)
    assert control.slot_results["m2"].cases[0].companion_source == "clean"
    assert control.slot_results["m2"].distinguishes
    assert control.status == STATUS_CALIBRATED, control.reasons


def test_probe_status_order_failed_dominates_placeholder():
    # ATTACK: fail-closed ordering — a FAILED slot must dominate a PLACEHOLDER slot.
    g = _all_real_slots()
    g["m1"] = MutationCase("m1", "STANDIN", "ii", clean_inputs(), is_placeholder=False)  # never convicts → FAIL
    g["m5"] = MutationCase("m5", "FRAMEWORK_DEMONSTRATION_PLACEHOLDER", g["m5"].targeted_check, g["m5"].mutant, is_placeholder=True)
    assert run_calibration(clean_inputs(), g).status == STATUS_FAILED


def test_probe_status_order_incomplete_dominates_failed():
    # ATTACK: fail-closed ordering — an UNFILLED slot must dominate a FAILED slot.
    g = _all_real_slots()
    del g["m6"]                                                                          # unfilled
    g["m1"] = MutationCase("m1", "STANDIN", "ii", clean_inputs(), is_placeholder=False)  # failed
    assert run_calibration(clean_inputs(), g).status == STATUS_INCOMPLETE


# =========================================================================== #
# R-272 SIX-SLOT WAVE — REAL grader-authored cases for the four slots whose class survived
# an adversarial evasion probe (m1, m3, m4, m5). Each convicts on its targeted check and is
# distinguished by its own anti-vacuity companion. m6 and m7 are WITHHELD — their adversarial
# sub-cases DEFEATED the detector (see the TRIPWIRE tests below), so CALIBRATED is not reached.
# =========================================================================== #
def test_r272_four_robust_slots_each_convict_and_distinguish():
    reals = robust_six_real_cases()
    assert set(reals) == {"m1", "m3", "m4", "m5"}
    # Seed the other slots with placeholders so the battery runs; assert per-slot outcomes.
    slots = dict(placeholder_cases())
    slots.update(reals)
    slots["m2"] = m2_both_forms_cases()
    result = run_calibration(clean_inputs(), slots)
    for sid, case in reals.items():
        sr = result.slot_results[sid]
        assert sr.ok, (sid, sr.detail)
        assert sr.convicted, (sid, sr.detail)
        assert sr.mutant_trips_target, (sid, sr.detail)      # tripped its targeted check
        assert sr.clean_passes_target, (sid, sr.detail)      # companion passes that check
        assert sr.distinguishes, (sid, sr.detail)
        assert not sr.is_placeholder, sid
        assert sr.targeted_check == case.targeted_check, sid


def test_r272_m4_companion_reaches_the_false_flag_row_non_vacuously():
    # The m4 companion must PASS 'm4_false_flag' because the row is REACHED and MATCHES (not
    # because the row is absent). Prove both: the mutant's row FAILS, the companion's row PASSES
    # AND the companion carries an approximation label (so the row genuinely evaluated).
    mut = m4_false_flag_inputs().run()
    assert "m4_false_flag" in mut.checks_failed
    comp = m4_matching_label_companion().run()
    assert "m4_false_flag" not in comp.checks_failed
    assert comp.verdict == PASS  # whole-clean known-good, the row evaluated to a MATCH


def test_r272_full_seven_slot_run_is_blocked_at_placeholder_by_the_two_holes():
    # THE WAVE RESULT: m2 both-forms + the four robust reals are certified, but m6 and m7 remain
    # PLACEHOLDERS (detector holes withhold their pass). Census: 5 real slots, 2 placeholder →
    # overall status stays HARNESS_DEMONSTRATED_ON_PLACEHOLDERS, NOT CALIBRATED. This is the
    # machine-checked proof that the wave does not reach STATUS_CALIBRATED.
    slots = dict(placeholder_cases())      # m6, m7 stay placeholders
    slots.update(robust_six_real_cases())  # m1, m3, m4, m5 real
    slots["m2"] = m2_both_forms_cases()    # m2 real (both forms)
    result = run_calibration(clean_inputs(), slots)

    real_slots = {sid for sid, sr in result.slot_results.items() if sr.filled and not sr.is_placeholder}
    ph_slots = {sid for sid, sr in result.slot_results.items() if sr.is_placeholder}
    assert real_slots == {"m1", "m2", "m3", "m4", "m5"}
    assert ph_slots == {"m6", "m7"}
    assert result.status == STATUS_PLACEHOLDER, result.reasons
    assert result.status != STATUS_CALIBRATED


# =========================================================================== #
# DETECTOR HOLES CLOSED — the two R-272 §2 fail-open holes (m6 null-artifact-video cross-link;
# m7 whitespace-only disposition) are now FIXED in compile_fidelity.py. The self-destructing
# TRIPWIRE tests that asserted the KNOWN-BROKEN (fail-open) state have fired and been removed
# by design; these RED-PROOF regressions replace them and assert the fail-CLOSED contract. Each
# pairs the hostile input (must now BLOCK) with a DISCRIMINATING honest control (must still PASS)
# so a reversion to the fail-open guard breaks the test. Detector authored by the doer; battery
# MutationCases (m6/m7 both-forms) remain the independent grader's to author (doer != grader).
# =========================================================================== #
def test_m6_absent_artifact_video_with_mismatched_cert_blocks_vi_cert():
    # FIX (m6 fail-closed cross-link): a certificate naming a DIFFERENT extraction while the
    # artifact's own `video` is absent (None) is UNLINKABLE — linkage is not affirmatively
    # verified, so vi_cert BLOCKs (was fail-OPEN: the old guard fired only when BOTH ids present).
    a = clean_artifact()
    a["video"] = None                                   # artifact provenance absent
    cert = clean_certificate(a["spec"])
    cert["video"] = "SOME_OTHER_VIDEO_9999"             # cert points at a DIFFERENT extraction
    r = _mutant_inputs(a, cert=cert).run()
    assert r.verdict != PASS
    assert "vi_cert" in r.checks_failed                 # UNLINKABLE → fail-closed BLOCK

    # the SAME different-cert break is still caught when the artifact video IS present:
    b = clean_artifact()
    cert_b = clean_certificate(b["spec"])
    cert_b["video"] = "SOME_OTHER_VIDEO_9999"
    assert "vi_cert" in _mutant_inputs(b, cert=cert_b).run().checks_failed

    # DISCRIMINATING honest control (no false-BLOCK): both ids present AND matching → vi_cert PASSES,
    # and the fixture passes Leg A whole. A reversion to the fail-open guard leaves this green but
    # flips the hostile assertion above red — this control makes the pair discriminating.
    ok = clean_inputs().run()
    assert "vi_cert" not in ok.checks_failed
    assert ok.verdict == PASS


def test_m7_whitespace_disposition_fails_v_nonlb():
    # FIX (m7): a WHITESPACE-ONLY non_lb_disposition ("   ") is semantically NO disposition — a
    # non-load-bearing condition carrying it FAILS v_nonlb (was fail-OPEN: "   " was truthy and
    # PASSED, while "" was caught — the asymmetry is now closed).
    a = clean_artifact()
    a["spec"]["entry_conditions"][0]["load_bearing"] = False
    a["spec"]["entry_conditions"][0]["non_lb_disposition"] = "   "   # blank content
    _rehash(a)
    assert "v_nonlb" in _mutant_inputs(a).run().checks_failed

    # empty-string form is (still) caught — the two blank forms now behave identically:
    b = clean_artifact()
    b["spec"]["entry_conditions"][0]["load_bearing"] = False
    b["spec"]["entry_conditions"][0]["non_lb_disposition"] = ""
    _rehash(b)
    assert "v_nonlb" in _mutant_inputs(b).run().checks_failed

    # DISCRIMINATING honest control (no false-BLOCK): a non-LB condition with a REAL disposition
    # (the clean fixture's ENABLE_ENTRY trigger) PASSES v_nonlb and the fixture passes whole. A
    # reversion (dropping .strip()) leaves this green but flips the "   " assertion red.
    ok = clean_inputs().run()
    assert "v_nonlb" not in ok.checks_failed
    assert ok.verdict == PASS
