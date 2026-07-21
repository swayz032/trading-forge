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
