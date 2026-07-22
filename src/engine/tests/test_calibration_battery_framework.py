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
from src.engine.tests._forensics_fixtures import clean_inputs, placeholder_cases


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
