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
from src.engine.forensics.compile_fidelity import PASS, run_leg_a, run_leg_a_phase1
from src.engine.tests._forensics_fixtures import (
    _mutant_inputs,
    _rehash,
    clean_artifact,
    clean_certificate,
    clean_countersignatures,
    clean_inputs,
    m2_both_forms_cases,
    m2_launder_drop_inputs,
    m2_naive_drop_inputs,
    m4_false_flag_inputs,
    m4_matching_label_companion,
    m6_both_forms_cases,
    m6_unlinkable_null_video_inputs,
    m6_video_mismatch_inputs,
    m7_zero_width_disposition_inputs,
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
# distinguished by its own anti-vacuity companion. (m6/m7 were withheld in R-272 as detector
# holes; R-273 below certifies m6 after the fix and keeps m7 withheld on a residual hole.)
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


def test_r272_five_real_slots_config_stays_placeholder():
    # HISTORICAL R-272 configuration: with only m1..m5 real and m6/m7 placeholder, the battery
    # stays HARNESS_DEMONSTRATED_ON_PLACEHOLDERS. (R-273 then certified m6; m7's detector residual is
    # since CLOSED but its both-forms MutationCase is grader-owned, so the m7 slot stays a
    # placeholder — see test_r273_final_wave_is_blocked_at_placeholder_by_the_unauthored_m7_slot.)
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
# R-273 — the m6/m7 fail-open holes were FIXED by an independent doer. Grader re-attack:
#   m6 cross-link fix is SOLID (every unlinkable/broken-chain state BLOCKs; only genuine same-id
#      matches under _norm PASS) → m6 CERTIFIED with both-forms.
#   m7 disposition — the grader's re-attack found a residual zero-width/format fail-open; a SECOND
#      doer loop then closed it CATEGORICALLY (`_has_visible_content`, compile_fidelity.py) and
#      SWEPT the whole presence-check class (see the SWEEP red-proofs below). m7 is now
#      detector-SOLID; the m7 both-forms MutationCase remains the independent grader's to author
#      (doer != grader), so the m7 SLOT stays a placeholder until then — NOT because of any
#      surviving hole.
# =========================================================================== #
def test_r273_m6_both_forms_certify_the_slot():
    # m6 slot carries TWO real cases (naive mismatch + unlinkable-null-video, the founding
    # instance of the original hole); both BLOCK on 'vi_cert'; each is distinguished by the clean
    # matching-video companion. The slot is OK and non-placeholder.
    assert "vi_cert" in m6_video_mismatch_inputs().run().checks_failed
    assert "vi_cert" in m6_unlinkable_null_video_inputs().run().checks_failed

    slots = dict(placeholder_cases())
    slots.update(robust_six_real_cases())
    slots["m2"] = m2_both_forms_cases()
    slots["m6"] = m6_both_forms_cases()
    result = run_calibration(clean_inputs(), slots)
    sr = result.slot_results["m6"]
    assert sr.ok, sr.detail
    assert len(sr.cases) == 2
    assert not sr.is_placeholder
    assert [c.convicted for c in sr.cases] == [True, True]
    assert [c.distinguishes for c in sr.cases] == [True, True]
    assert {c.label for c in sr.cases} == {
        "m6-cert-names-different-extraction", "m6-unlinkable-null-artifact-video"}


def test_r273_m7_zero_width_disposition_now_fails_v_nonlb_categorically():
    # RED-PROOF REGRESSION (was the self-destructing R-273 residual-hole TRIPWIRE; the second doer
    # loop closed the hole, so the tripwire fired and is REPLACED by this fail-CLOSED contract).
    # The m7 fix is DEFINITIONAL -- not str.strip() (removes only isspace()), not a char deny-list
    # (re-opens on the next invisible codepoint), but a VISIBLE-CONTENT predicate
    # (_has_visible_content) requiring >=1 char that is isprintable(), non-space, NOT
    # `Default_Ignorable_Code_Point`, and not a lone combining/enclosing mark. A non_lb_disposition
    # made ONLY of invisible characters is semantically empty AND invisible to BOTH the automated
    # check and the Phase-2 fresh reader, so it must FAIL v_nonlb exactly like "" / "   " do.
    # Proven across THREE tiers so the close is by PROPERTY, not enumeration:
    #   (a) the 5 originally-catalogued zero-width/format chars (str.isprintable() already False);
    #   (b) 3 format chars NEVER in that list (U+00AD soft hyphen, U+2061 function-application,
    #       U+180E) -- a 5-char deny-list would have re-opened on these;
    #   (c) the R-275 RESIDUAL class -- variation selectors + Hangul fillers that str.isprintable()
    #       reports TRUE (see the `residual` list below), incl. >=2 codepoints the fix does NOT
    #       special-case. This is the exact "re-opens on the next invisible one" failure, now shut.
    known = ["​", "‌", "‍", "﻿", "⁠"]
    beyond = ["­", "⁡", "᠎"]  # NOT in the catalogued 5 -> a blacklist would miss them
    # (c) R-275 RESIDUAL class — str.isprintable() reports TRUE for these (category Mn variation
    # selectors / category Lo Hangul fillers), so the OLD isprintable-only predicate FAIL-OPENED on
    # them. They block now because they carry Default_Ignorable_Code_Point, NOT because they are
    # named. Built by codepoint (never invisible source literals). Includes >=2 codepoints the fix
    # does NOT special-case: U+E0100 (variation-selector-supplement), U+1160 (Hangul jungseong
    # filler), U+2064 (invisible plus).
    residual = [
        chr(0xFE00), chr(0xFE0F),          # VARIATION SELECTOR-1 / -16 (Mn) — named residuals
        chr(0x115F), chr(0x3164),          # HANGUL CHOSEONG / HANGUL FILLER (Lo) — named residuals
        chr(0xE0100), chr(0x1160), chr(0x2064),  # NOT special-cased -> definitional close proves it
    ]
    # LONE combining/enclosing marks render nothing on their own -> also absent (Mn/Me clause):
    lone_marks = [chr(0x0301), chr(0x20DD)]  # COMBINING ACUTE (cc=230) / ENCLOSING CIRCLE (Me, cc=0)
    for zw in known + beyond + residual + lone_marks:
        r = m7_zero_width_disposition_inputs(zw).run()
        assert r.verdict != PASS, f"m7 invisible hole RE-OPENED for {zw!r} (U+{ord(zw):04X})"
        assert "v_nonlb" in r.checks_failed, repr(zw)
    # DISCRIMINATION (no false-BLOCK, no over-block): ordinary Unicode WHITESPACE is (still) caught,
    # and -- crucially -- a REAL visible disposition on a non-LB condition still PASSes v_nonlb, so
    # the gate rejects the invisible class specifically, not all non-ASCII, and does not over-block.
    for ws in [" ", "　", " ", "   "]:  # ASCII space, ideographic space, NBSP, multi-space
        a = clean_artifact()
        a["spec"]["entry_conditions"][0]["load_bearing"] = False
        a["spec"]["entry_conditions"][0]["non_lb_disposition"] = ws
        _rehash(a)
        assert "v_nonlb" in _mutant_inputs(a).run().checks_failed, repr(ws)
    real = clean_artifact()
    real["spec"]["entry_conditions"][0]["load_bearing"] = False
    real["spec"]["entry_conditions"][0]["non_lb_disposition"] = "phase-2 countersign owed"
    _rehash(real)
    assert "v_nonlb" not in _mutant_inputs(real).run().checks_failed  # real disposition NOT blocked
    # A base letter carrying a COMBINING accent is legitimate visible content (the base 'e' is ink);
    # the predicate must NOT over-reject a valid base+mark sequence (only a LONE mark is absent).
    accented = clean_artifact()
    accented["spec"]["entry_conditions"][0]["load_bearing"] = False
    accented["spec"]["entry_conditions"][0]["non_lb_disposition"] = "caf" + "e" + chr(0x0301) + " owed"
    _rehash(accented)
    assert "v_nonlb" not in _mutant_inputs(accented).run().checks_failed  # base+combining PASSES


def test_r273_final_wave_is_blocked_at_placeholder_by_the_unauthored_m7_slot():
    # THE WAVE RESULT: m2 both-forms + m1/m3/m4/m5 robust + m6 both-forms are all CERTIFIED (6 real
    # slots), and m7 stays a PLACEHOLDER. NOTE (post-residual-fix): the m7 DETECTOR residual
    # (zero-width/format disposition) is now CLOSED — see
    # test_r273_m7_zero_width_disposition_now_fails_v_nonlb_categorically. m7 stays a placeholder
    # ONLY because the m7 both-forms MutationCase is the INDEPENDENT grader's to author (doer !=
    # grader), NOT because of any surviving hole. Overall status therefore stays
    # HARNESS_DEMONSTRATED_ON_PLACEHOLDERS — STATUS_CALIBRATED is NOT reached, blocked solely by the
    # unauthored m7 slot. (When the grader authors m7 both-forms, this test updates to CALIBRATED.)
    slots = dict(placeholder_cases())      # m7 stays placeholder
    slots.update(robust_six_real_cases())  # m1, m3, m4, m5 real
    slots["m2"] = m2_both_forms_cases()    # m2 real
    slots["m6"] = m6_both_forms_cases()    # m6 real (R-273)
    result = run_calibration(clean_inputs(), slots)

    real_slots = {sid for sid, sr in result.slot_results.items() if sr.filled and not sr.is_placeholder}
    ph_slots = {sid for sid, sr in result.slot_results.items() if sr.is_placeholder}
    assert real_slots == {"m1", "m2", "m3", "m4", "m5", "m6"}
    assert ph_slots == {"m7"}
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


# =========================================================================== #
# SWEEP: fix-the-CLASS-not-the-instance. m7's zero-width bypass is one instance of a CLASS —
# "a string presence / non-empty check that treats invisible (zero-width / Unicode-format /
# default-ignorable) characters as content." The doer SWEPT compile_fidelity.py and closed every
# sibling with the SAME categorical predicate (`_has_visible_content`). These red-proofs pin each
# swept sibling: an invisible-only value now BLOCKs on its target check, and a visible control
# still PASSes (discriminating). Siblings fixed: the certificate `video` link and per-condition
# `quote_anchor` validity (`_cert_key_invalid`), the per-condition `type_confidence` presence
# (i_conf), and the Phase-2 `reader_id` identity presence. AUDITED-AND-IMMUNE (no fix, no
# red-proof): the `spec_hash` presence test — a zero-width spec_hash is truthy but routes to the
# exact-hash-equality MISMATCH BLOCK, never a fail-open. Detector authored by the doer; battery
# MutationCases remain the independent grader's to author (doer != grader).
# =========================================================================== #
# 5 originally-catalogued zero-width chars + 3 NOT in that list (a deny-list would miss the tail).
_FORMAT_CHARS = ["​", "‌", "‍", "﻿", "⁠", "­", "⁡", "᠎"]


# R-275 RESIDUAL class appended (str.isprintable() reports TRUE for these): variation selectors
# (category Mn) + Hangul fillers (category Lo). Built by codepoint (no invisible source literals),
# and INCLUDES >=2 codepoints the fix does NOT special-case (U+E0100 variation-selector-supplement,
# U+1160 Hangul jungseong filler, U+2064 invisible plus). Appended to _FORMAT_CHARS so ALL FOUR
# sweep red-proofs below drive the whole invisible class -- Cf/Cc catalogued tail AND the residuals
# -- through the SAME categorical predicate, proving the close is definitional, not enumerated.
_FORMAT_CHARS = _FORMAT_CHARS + [
    chr(0xFE00), chr(0xFE0F), chr(0x115F), chr(0x3164), chr(0xE0100), chr(0x1160), chr(0x2064),
]


def test_sweep_cert_video_invisible_link_blocks_vi_cert():
    # SIBLING (net fail-open before the sweep): an all-invisible video on BOTH artifact and cert
    # would `_norm`-match itself and certify a clean provenance link. Now every invisible link is
    # rejected as no-content → vi_cert BLOCK.
    for zw in _FORMAT_CHARS:
        a = clean_artifact()
        a["video"] = zw
        cert = clean_certificate(a["spec"])
        cert["video"] = zw
        r = _mutant_inputs(a, cert=cert).run()
        assert r.verdict != PASS, f"invisible video certified clean: {zw!r} (U+{ord(zw):04X})"
        assert "vi_cert" in r.checks_failed, repr(zw)
    # DISCRIMINATION: a real matching video links clean and the fixture passes whole.
    ok = clean_inputs().run()
    assert "vi_cert" not in ok.checks_failed and ok.verdict == PASS


def test_sweep_cert_conditions_invisible_anchor_is_invalid():
    # SIBLING (bypassed the validity layer; net-caught downstream by MIN_ANCHOR_TOKENS, now closed
    # at the validity layer too so the class stays shut if that floor is ever refactored).
    from src.engine.forensics.compile_fidelity import _cert_key_invalid

    for zw in _FORMAT_CHARS:
        assert _cert_key_invalid({"video": "V", "conditions": [{"quote_anchor": zw}]}, "conditions") is True, repr(zw)
    # DISCRIMINATION: a real >=2-token anchor is a valid ledger entry.
    assert _cert_key_invalid({"video": "V", "conditions": [{"quote_anchor": "spine completion"}]}, "conditions") is False


def test_sweep_i_conf_invisible_type_confidence_not_recorded():
    # SIBLING (fail-open before the sweep: `in (None, "")` accepted BOTH invisible AND whitespace as
    # "recorded"). Now a type_confidence with no visible content fails i_conf.
    for zw in _FORMAT_CHARS + ["", "   ", "　"]:
        a = clean_artifact()
        a["spec"]["entry_conditions"][0]["type_confidence"] = zw
        _rehash(a)
        seal = run_leg_a_phase1(a, certificate=clean_certificate(a["spec"]))
        assert "i_conf" in seal.checks_failed, repr(zw)
    # DISCRIMINATION: a real confidence label is recorded (i_conf passes, fixture clean).
    art = clean_artifact()
    seal = run_leg_a_phase1(art, certificate=clean_certificate(art["spec"]))
    assert "i_conf" not in seal.checks_failed and seal.automated_verdict == PASS


def test_sweep_reader_id_invisible_identity_is_incomplete_countersign():
    # SIBLING (net fail-open before the sweep: an invisible/whitespace reader_id cleared the
    # fresh-reader completeness check, so a "reader" with no identity could countersign the leg).
    for zw in _FORMAT_CHARS + ["   ", "　"]:
        a = clean_artifact()
        cs = clean_countersignatures(a)
        for k in cs:
            cs[k] = {**cs[k], "reader_id": zw}
        r = run_leg_a(a, certificate=clean_certificate(a["spec"]), countersignatures=cs)
        assert r.verdict != PASS, f"invisible reader_id cleared the countersign: {zw!r}"
        assert "countersign" in r.checks_failed, repr(zw)
    # DISCRIMINATION: a real reader identity clears the countersign and the fixture passes whole.
    assert clean_inputs().run().verdict == PASS
