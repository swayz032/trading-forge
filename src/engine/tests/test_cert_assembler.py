"""H1 certificate assembler contract tests (Wave-4 deliverable 5; F-1 repair
addendum §A/§B/§C, 2026-07-12).

Covers: (a) every emitted char_span resolves to quote_anchor verbatim; (b)
pilot_grade/full_grade/certificate_grade logic -- pilot_grade gates on
classification+anchoring+the LIVE lints only (f2_coverage_gate +
causality_lint's regex leg); full_grade additionally requires the SEMANTIC
structural gate CLEAN (calibrated conflation + enumeration verdicts, via
terminal_read's clean determination), fail-closed on an absent conflation
verdict (ratify-packet h1-a-packet-full-grade-semantic-gate-amended-2026-07-18,
R-039). The 3 mechanical structural lints + causality's same_bar leg are
REACHABILITY DIAGNOSTICS at this cert layer, NOT full_grade gates -- they are
calibration-blind on prose (AR-030), their load-bearing station is the spec-
compiler layer. certificate_grade is a bool alias of full_grade; (c)
classifying_tier==2 is NEVER emitted; (d) adjudication_verdict present iff
tier==3; (e) provenance complete.

Imports ONLY the pure-stdlib extraction package (no vectorbt / no
backtester), matching test_tier1_detectors.py / test_compile_lints.py.
"""

import pytest

from src.engine.extraction.cert_assembler import (
    ConditionTopology,
    Tier3Verdict,
    assemble_certificate,
)
from src.engine.extraction.tier1_detectors import Tier1Detection, Tier1FallThrough, run_tier1


def _control_passed_verdict(char_span, quote_anchor, surface_class="narration", verdict="gate-strength"):
    return Tier3Verdict(
        char_span=char_span,
        quote_anchor=quote_anchor,
        surface_class=surface_class,
        verdict=verdict,
        control_gate_passed=True,
    )


# --------------------------------------------------------------------------- #
# (a) every emitted char_span resolves to quote_anchor verbatim
# --------------------------------------------------------------------------- #


def test_every_char_span_resolves_verbatim_tier1_only():
    transcript = "buy from the demand zone when it is retested"
    res = run_tier1(transcript)
    cert = assemble_certificate(
        full_transcript=transcript,
        full_transcript_sha256="sha1",
        source_video_id="v1",
        extractor_version="e1",
        taxonomy_version="t1",
        tier1_detections=res.detections,
        tier1_fallthroughs=[],
    )
    assert cert["conditions"]
    for c in cert["conditions"]:
        s, e = c["char_span"]
        assert transcript[s:e] == c["quote_anchor"]


def test_every_char_span_resolves_verbatim_mixed_tier1_tier3():
    transcript = "buy from the demand zone when it is retested. we do have a fair value gap here."
    ft_span = (46, 82)  # "we do have a fair value gap here." region (tier-2/3 candidate, tier1 silent)
    tier1 = run_tier1(transcript[:44], char_span=(0, 44))
    fallthroughs = [Tier1FallThrough(char_span=ft_span)]
    verdict = _control_passed_verdict(ft_span, transcript[ft_span[0]:ft_span[1]])
    cert = assemble_certificate(
        full_transcript=transcript,
        full_transcript_sha256="sha1",
        source_video_id="v1",
        extractor_version="e1",
        taxonomy_version="t1",
        tier1_detections=tier1.detections,
        tier1_fallthroughs=fallthroughs,
        tier3_verdicts=[verdict],
    )
    assert len(cert["conditions"]) == 2
    for c in cert["conditions"]:
        s, e = c["char_span"]
        assert transcript[s:e] == c["quote_anchor"]


# --------------------------------------------------------------------------- #
# (b) pilot_grade / full_grade / certificate_grade logic (F-1 repair, addendum
# §A/§B/§C, 2026-07-12). certificate_grade is a bool alias of full_grade (the
# strictest §4 reading -- the only grade H2 consumes, addendum §D).
# --------------------------------------------------------------------------- #


def test_pilot_grade_true_but_full_grade_false_on_topology_less_certificate():
    """The honest pilot-conveyor default (no topology, no or_branches
    supplied): every condition classifies+anchors and the two LIVE lints
    (f2_coverage_gate, causality_lint's regex leg) are clean, so pilot_grade
    is True -- this is the pilot's actual question, answered. full_grade
    (and its certificate_grade alias) must be False: NO conflation verdict was
    supplied, so the SEMANTIC structural gate is fail-closed (terminal_read
    INDETERMINATE -> not clean). The 3 structural lints being NOT_EVALUATED is
    now a DIAGNOSTIC observation (reachability), no longer the full_grade gate
    (R-039 amendment); the load-bearing reason full_grade is False here is the
    absent conflation verdict, asserted below."""
    transcript = "buy from the demand zone when it is retested"
    res = run_tier1(transcript)
    cert = assemble_certificate(
        full_transcript=transcript,
        full_transcript_sha256="sha1",
        source_video_id="v1",
        extractor_version="e1",
        taxonomy_version="t1",
        tier1_detections=res.detections,
        tier1_fallthroughs=[],
    )
    assert cert["pilot_grade"] is True
    assert cert["full_grade"] is False
    assert cert["certificate_grade"] is False
    for name in ("direction_conflation_lint", "unsat_sat_check", "or_alternatives_honored"):
        assert cert["compile_integrity"][name]["status"] == "NOT_EVALUATED"
        assert cert["compile_integrity"][name]["reason"] == "no_compiled_topology"
    assert cert["compile_integrity"]["causality_lint"]["same_bar_leg_status"] == "NOT_EVALUATED"
    assert cert["compile_integrity"]["f2_coverage_gate"]["status"] == "PASS"
    assert cert["compile_integrity"]["causality_lint"]["status"] == "PASS"


def test_pilot_grade_false_when_a_span_is_unclassified():
    """A fall-through span with NO control-gate-passing tier-3 verdict stays
    classifying_tier=None -- pilot_grade (and full_grade) must go FALSE."""
    transcript = "buy from the demand zone when it is retested. now back to the euro dollar chart here."
    res = run_tier1(transcript[:44], char_span=(0, 44))
    unresolved_span = (46, 87)
    fallthroughs = [Tier1FallThrough(char_span=unresolved_span)]
    cert = assemble_certificate(
        full_transcript=transcript,
        full_transcript_sha256="sha1",
        source_video_id="v1",
        extractor_version="e1",
        taxonomy_version="t1",
        tier1_detections=res.detections,
        tier1_fallthroughs=fallthroughs,
        tier3_verdicts=[],  # no adjudication reached this span
    )
    assert any(c["classifying_tier"] is None for c in cert["conditions"])
    assert cert["pilot_grade"] is False
    assert cert["full_grade"] is False
    assert cert["certificate_grade"] is False


def test_pilot_grade_false_when_a_live_lint_fails():
    """A LIVE lint (f2_coverage_gate) FAIL must block pilot_grade -- this is
    the addendum §B disjunction's live half: the pilot's own question
    (classification + anchoring + the two live checks) is genuinely unmet."""
    transcript = "buy from the demand zone when it is retested"
    fabricated_span = (0, 5)
    det = Tier1Detection(surface_class="imperative", quote_anchor="totally fabricated text", char_span=fabricated_span)
    cert = assemble_certificate(
        full_transcript=transcript,
        full_transcript_sha256="sha1",
        source_video_id="v1",
        extractor_version="e1",
        taxonomy_version="t1",
        tier1_detections=[det],
        tier1_fallthroughs=[],
    )
    assert cert["compile_integrity"]["f2_coverage_gate"]["status"] == "FAIL"
    assert cert["pilot_grade"] is False
    assert cert["full_grade"] is False
    assert cert["certificate_grade"] is False


def test_mechanical_structural_lint_fail_is_a_diagnostic_not_a_full_grade_gate():
    """R-039 amendment: a MECHANICAL structural lint (direction_conflation_lint)
    FAIL is a REACHABILITY DIAGNOSTIC at the cert layer, NOT a full_grade gate.
    Here a hand-crafted topology (an explicitly-labeled SYNTHETIC probe, the ONLY
    legitimate use of hand-injected per-condition direction fields) makes
    direction_conflation_lint FAIL -- but with the SEMANTIC conflation verdict
    PASS and the pilot gate clean, full_grade is TRUE. The mechanical FAIL is
    recorded as a diagnostic in full_grade_basis, never a safety veto. (This is
    the exact inversion of the pre-R-039 behavior: the mechanical lint is
    calibration-blind on prose, so it must NOT be able to convict OR acquit
    full_grade -- the semantic verdict is the load-bearing gate.)"""
    transcript = "5-SMA-cross-above-50 confirms long; 5-SMA-cross-below-50 confirms short"
    span_a = (0, len("5-SMA-cross-above-50"))
    idx_b = transcript.index("5-SMA-cross-below-50")
    span_b = (idx_b, idx_b + len("5-SMA-cross-below-50"))
    det_a = Tier1Detection(surface_class="imperative", quote_anchor=transcript[span_a[0]:span_a[1]], char_span=span_a)
    det_b = Tier1Detection(surface_class="imperative", quote_anchor=transcript[span_b[0]:span_b[1]], char_span=span_b)
    topology = [
        ConditionTopology(char_span=span_a, direction="long", and_group=0),
        ConditionTopology(char_span=span_b, direction="short", and_group=0),
    ]
    cert = assemble_certificate(
        full_transcript=transcript,
        full_transcript_sha256="sha1",
        source_video_id="v1",
        extractor_version="e1",
        taxonomy_version="t1",
        tier1_detections=[det_a, det_b],
        tier1_fallthroughs=[],
        topology=topology,
        conflation_verdict="PASS",  # the load-bearing semantic axis says coherent
    )
    assert cert["compile_integrity"]["direction_conflation_lint"]["status"] == "FAIL"
    assert cert["pilot_grade"] is True, "a non-live structural lint FAIL must not block pilot_grade (§B)"
    # THE INVERSION: mechanical FAIL no longer gates full_grade; semantic PASS + clean pilot -> True.
    assert cert["full_grade"] is True, "mechanical lint FAIL must NOT block full_grade (R-039 demotion)"
    assert cert["certificate_grade"] is True
    assert cert["full_grade_basis"]["direction_conflation_lint"] == "REACHABILITY_DIAGNOSTIC_NOT_SAFETY_GATING"
    assert "conflation_verdict(semantic)" in cert["full_grade_basis"]["load_bearing_axes_policy"]
    assert all(c["classifying_tier"] in (1, 3) for c in cert["conditions"])


def test_mechanical_structural_lint_fail_still_recorded_but_semantic_reject_convicts():
    """Companion to the above: the SEMANTIC axis is what convicts. Same synthetic
    topology (mechanical FAIL present), but conflation_verdict=REJECT -> full_grade
    False. Proves the gate is the semantic verdict, not the mechanical lint (which
    happens to also FAIL here but is not consulted for the gate)."""
    transcript = "5-SMA-cross-above-50 confirms long; 5-SMA-cross-below-50 confirms short"
    span_a = (0, len("5-SMA-cross-above-50"))
    idx_b = transcript.index("5-SMA-cross-below-50")
    span_b = (idx_b, idx_b + len("5-SMA-cross-below-50"))
    det_a = Tier1Detection(surface_class="imperative", quote_anchor=transcript[span_a[0]:span_a[1]], char_span=span_a)
    det_b = Tier1Detection(surface_class="imperative", quote_anchor=transcript[span_b[0]:span_b[1]], char_span=span_b)
    topology = [
        ConditionTopology(char_span=span_a, direction="long", and_group=0),
        ConditionTopology(char_span=span_b, direction="short", and_group=0),
    ]
    cert = assemble_certificate(
        full_transcript=transcript,
        full_transcript_sha256="sha1",
        source_video_id="v1",
        extractor_version="e1",
        taxonomy_version="t1",
        tier1_detections=[det_a, det_b],
        tier1_fallthroughs=[],
        topology=topology,
        conflation_verdict="REJECT",
    )
    assert cert["full_grade"] is False, "semantic REJECT convicts full_grade"
    assert cert["certificate_grade"] is False
    assert cert["terminal_read_grade"] == "REJECTED"


def test_same_bar_not_evaluated_is_exempt_from_full_grade():
    """R-039 pin-3 disposition: causality's same_bar leg is ALWAYS NOT_EVALUATED
    at cert assembly (same_bar_fill/signal_lag params are never wired here), and
    it is EXEMPT from full_grade by explicit classification (execution-timing,
    orthogonal to extraction fidelity -- the same call terminal_read_grade
    already makes). So with the SEMANTIC conflation verdict PASS and the pilot
    gate clean, full_grade is TRUE despite the same_bar NOT_EVALUATED sub-leg.
    This is the exact inversion of the pre-R-039 invariant (which let the dead
    same_bar leg hold full_grade uniformly False); the disposition is recorded
    on the artifact, not a masked fire."""
    transcript = "buy from the demand zone when it is retested"
    res = run_tier1(transcript)
    span = res.detections[0].char_span
    topology = [ConditionTopology(char_span=span, and_group=None)]  # real overlay, no conflicts
    cert = assemble_certificate(
        full_transcript=transcript,
        full_transcript_sha256="sha1",
        source_video_id="v1",
        extractor_version="e1",
        taxonomy_version="t1",
        tier1_detections=res.detections,
        tier1_fallthroughs=[],
        topology=topology,
        conflation_verdict="PASS",
    )
    assert cert["compile_integrity"]["causality_lint"]["same_bar_leg_status"] == "NOT_EVALUATED"
    assert cert["pilot_grade"] is True
    assert cert["full_grade"] is True, "same_bar NOT_EVALUATED is EXEMPT -- must not block full_grade (R-039)"
    assert cert["certificate_grade"] is True
    assert cert["full_grade_basis"]["causality_lint.same_bar_leg"] == "EXEMPT_NOT_LOAD_BEARING"


def test_certificate_grade_false_when_no_conditions_at_all():
    cert = assemble_certificate(
        full_transcript="",
        full_transcript_sha256="sha1",
        source_video_id="v1",
        extractor_version="e1",
        taxonomy_version="t1",
        tier1_detections=[],
        tier1_fallthroughs=[],
    )
    assert cert["conditions"] == []
    assert cert["pilot_grade"] is False
    assert cert["full_grade"] is False
    assert cert["certificate_grade"] is False


# --------------------------------------------------------------------------- #
# (b') THE LOAD-BEARING full_grade semantic-gate proof (R-039): both polarities
# on REAL fixtures + the panel's CALIBRATED verdicts (never hand-crafted fields).
# This is the safety claim the AR-030 finding demanded -- merge-silencing is
# caught by the SEMANTIC verdict, not the prose-blind mechanical lint.
# --------------------------------------------------------------------------- #

import json  # noqa: E402
import os  # noqa: E402

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
_V32 = os.path.join(_ROOT, "docs", "replay-results", "h1-scripts", "claude-rung-v32")
_STAGING = os.path.join(
    _ROOT, "docs", "replay-results", "h1-scripts", "claude-rung-designpool", "staging_v32"
)


def _calibrated_conflation_verdict(grade_stub: str) -> str:
    with open(os.path.join(_V32, "conflation_grades", f"{grade_stub}.json"), encoding="utf-8") as fh:
        return json.load(fh)["verdict"]["verdict"]


def _cert_with_conflation(strategy: dict, conflation_verdict: str, vid: str) -> dict:
    """Assemble a REAL certificate through the unmodified assembler + producer,
    threading the given (calibrated) conflation verdict -- the seal-day path."""
    from src.engine.extraction.topology_producer import produce_topology
    from src.engine.tests._a_packet_harness import build_inputs

    transcript, tier1, entries = build_inputs(strategy)
    topology, or_branches = produce_topology(strategy, entries)
    return assemble_certificate(
        full_transcript=transcript,
        full_transcript_sha256="sha-real",
        source_video_id=vid,
        extractor_version="gpt-5.4:designpool-v32",
        taxonomy_version="taxonomy-v2",
        tier1_detections=tier1,
        tier1_fallthroughs=[],
        topology=list(topology.values()),
        or_branches=or_branches,
        conflation_verdict=conflation_verdict,
    )


def test_full_grade_semantic_gate_REJECT_polarity_real_r5l890_fused():
    """REJECT witness: the campaign's own 'Must REJECT' calibration fixture
    (R5L890-FUSED, two opposite VWAP-band setups welded co-required) + its
    CALIBRATED panel verdict REJECT (loaded from disk) -> full_grade False.
    The mechanical direction_conflation_lint VACUOUSLY PASSes this same object
    (the AR-030 defect) -- so this test proves the SEMANTIC verdict, not the
    mechanical lint, is what convicts."""
    with open(os.path.join(_V32, "conflation_fixtures", "R5L890_FUSED_reject.json"), encoding="utf-8") as fh:
        strategy = json.load(fh)["strategies"][0]
    verdict = _calibrated_conflation_verdict("CAL_R5L890_FUSED")
    assert verdict == "REJECT", "calibration fixture must carry the REJECT verdict"
    cert = _cert_with_conflation(strategy, verdict, "R5L890juvRw")
    # the prose-blind mechanical lint vacuously PASSes -- exactly the AR-030 defect
    assert cert["compile_integrity"]["direction_conflation_lint"]["status"] == "PASS"
    # but the SEMANTIC gate convicts: full_grade False, terminal read REJECTED
    assert cert["full_grade"] is False
    assert cert["certificate_grade"] is False
    assert cert["terminal_read_grade"] == "REJECTED"
    assert cert["full_grade_basis"]["direction_conflation_lint"] == "REACHABILITY_DIAGNOSTIC_NOT_SAFETY_GATING"


def test_full_grade_semantic_gate_PASS_polarity_real_igp_mirror():
    """PASS witness (mirror): the real -igp fvg_trend_continuation strategy (one
    skeleton, side-by-context -- NOT a fusion) + its CALIBRATED panel verdict
    PASS -> full_grade True. Direction check: the honest mirror passes where the
    fused adversarial is rejected -- strictly the legitimate signature."""
    with open(os.path.join(_STAGING, "-igpOZs8LsM__s0.json"), encoding="utf-8") as fh:
        strategy = json.load(fh)["strategies"][0]
    verdict = _calibrated_conflation_verdict("-igpOZs8LsM__s0")
    assert verdict == "PASS", "mirror fixture must carry the PASS verdict"
    cert = _cert_with_conflation(strategy, verdict, "-igpOZs8LsM")
    assert cert["pilot_grade"] is True
    assert cert["full_grade"] is True, "semantic PASS + clean pilot -> full_grade reachable"
    assert cert["certificate_grade"] is True
    assert cert["terminal_read_grade"] == "CLEAN"


def test_full_grade_second_semantic_axis_enumeration_fail_convicts():
    """R-039's gate is BOTH semantic axes (conflation + enumeration_consistency).
    This proves the SECOND axis is load-bearing in full_grade: the -igp mirror
    with conflation=PASS but enumeration_consistency=FAIL (a promoted
    enumeration-excluded mention) -> full_grade False. Neither semantic axis
    alone suffices; both must be clean."""
    with open(os.path.join(_STAGING, "-igpOZs8LsM__s0.json"), encoding="utf-8") as fh:
        strategy = json.load(fh)["strategies"][0]
    from src.engine.extraction.topology_producer import produce_topology
    from src.engine.tests._a_packet_harness import build_inputs

    transcript, tier1, entries = build_inputs(strategy)
    topology, or_branches = produce_topology(strategy, entries)
    cert = assemble_certificate(
        full_transcript=transcript,
        full_transcript_sha256="sha-real",
        source_video_id="-igpOZs8LsM",
        extractor_version="gpt-5.4:designpool-v32",
        taxonomy_version="taxonomy-v2",
        tier1_detections=tier1,
        tier1_fallthroughs=[],
        topology=list(topology.values()),
        or_branches=or_branches,
        conflation_verdict="PASS",
        enumeration_consistency_verdict="FAIL",
    )
    assert cert["full_grade"] is False, "enumeration FAIL must convict full_grade even with conflation PASS"
    assert cert["certificate_grade"] is False
    assert cert["terminal_read_grade"] == "REJECTED"


# --------------------------------------------------------------------------- #
# (c) classifying_tier==2 is NEVER emitted
# --------------------------------------------------------------------------- #


def test_classifying_tier_2_never_emitted_across_all_paths():
    transcript = "buy from the demand zone when it is retested. now back to the euro dollar chart here."
    res = run_tier1(transcript[:44], char_span=(0, 44))
    unresolved_span = (46, 87)
    fallthroughs = [Tier1FallThrough(char_span=unresolved_span)]
    verdict = _control_passed_verdict(unresolved_span, transcript[unresolved_span[0]:unresolved_span[1]])
    for tier3 in ([], [verdict]):
        cert = assemble_certificate(
            full_transcript=transcript,
            full_transcript_sha256="sha1",
            source_video_id="v1",
            extractor_version="e1",
            taxonomy_version="t1",
            tier1_detections=res.detections,
            tier1_fallthroughs=fallthroughs,
            tier3_verdicts=tier3,
        )
        for c in cert["conditions"]:
            assert c["classifying_tier"] != 2


def test_assembler_raises_if_forced_to_emit_tier2():
    """Direct unit check on the enforcement point itself (`_condition_entry`'s
    assertion) -- proves the guard is load-bearing, not decorative."""
    from src.engine.extraction.cert_assembler import _condition_entry

    with pytest.raises(AssertionError):
        _condition_entry("narration", 2, "x", (0, 1), None)


# --------------------------------------------------------------------------- #
# (d) adjudication_verdict present iff tier==3
# --------------------------------------------------------------------------- #


def test_adjudication_verdict_present_iff_tier_3():
    transcript = "buy from the demand zone when it is retested. now back to the euro dollar chart here."
    res = run_tier1(transcript[:44], char_span=(0, 44))
    unresolved_span = (46, 87)
    fallthroughs = [Tier1FallThrough(char_span=unresolved_span)]
    verdict = _control_passed_verdict(unresolved_span, transcript[unresolved_span[0]:unresolved_span[1]])
    cert = assemble_certificate(
        full_transcript=transcript,
        full_transcript_sha256="sha1",
        source_video_id="v1",
        extractor_version="e1",
        taxonomy_version="t1",
        tier1_detections=res.detections,
        tier1_fallthroughs=fallthroughs,
        tier3_verdicts=[verdict],
    )
    tier1_entries = [c for c in cert["conditions"] if c["classifying_tier"] == 1]
    tier3_entries = [c for c in cert["conditions"] if c["classifying_tier"] == 3]
    assert tier1_entries and tier3_entries
    assert all(c["adjudication_verdict"] is None for c in tier1_entries)
    assert all(c["adjudication_verdict"] is not None for c in tier3_entries)


def test_control_gate_failed_verdict_does_not_enter_certificate():
    """A tier-3 verdict from a rater who FAILED the control gate must not
    resolve the fall-through span into a tier-3 condition (pre-reg §3)."""
    transcript = "now back to the euro dollar chart here."
    span = (0, len(transcript))
    fallthroughs = [Tier1FallThrough(char_span=span)]
    bad_verdict = Tier3Verdict(
        char_span=span,
        quote_anchor=transcript,
        surface_class="narration",
        verdict="context",
        control_gate_passed=False,
    )
    cert = assemble_certificate(
        full_transcript=transcript,
        full_transcript_sha256="sha1",
        source_video_id="v1",
        extractor_version="e1",
        taxonomy_version="t1",
        tier1_detections=[],
        tier1_fallthroughs=fallthroughs,
        tier3_verdicts=[bad_verdict],
    )
    assert len(cert["conditions"]) == 1
    assert cert["conditions"][0]["classifying_tier"] is None
    assert cert["conditions"][0]["adjudication_verdict"] is None
    assert cert["certificate_grade"] is False


# --------------------------------------------------------------------------- #
# (e) provenance complete
# --------------------------------------------------------------------------- #


def test_provenance_complete():
    transcript = "buy from the demand zone when it is retested"
    res = run_tier1(transcript)
    cert = assemble_certificate(
        full_transcript=transcript,
        full_transcript_sha256="deadbeef123",
        source_video_id="videoXYZ",
        extractor_version="extractor-v3",
        taxonomy_version="taxonomy-v2",
        tier1_detections=res.detections,
        tier1_fallthroughs=[],
        scope_line="sealed-16 · taxonomy-v2 · extractor-v3 · engine-snapshot-2026-07-12",
    )
    prov = cert["provenance"]
    assert prov == {
        "source_video_id": "videoXYZ",
        "full_transcript_sha256": "deadbeef123",
        "extractor_version": "extractor-v3",
        "taxonomy_version": "taxonomy-v2",
    }
    assert all(prov.values())
    assert cert["scope_line"] == "sealed-16 · taxonomy-v2 · extractor-v3 · engine-snapshot-2026-07-12"


def test_provenance_present_even_on_empty_certificate():
    cert = assemble_certificate(
        full_transcript="",
        full_transcript_sha256="sha1",
        source_video_id="v1",
        extractor_version="e1",
        taxonomy_version="t1",
        tier1_detections=[],
        tier1_fallthroughs=[],
    )
    assert cert["provenance"]["source_video_id"] == "v1"
    assert cert["provenance"]["full_transcript_sha256"] == "sha1"


# --------------------------------------------------------------------------- #
# Determinism (replay contract)
# --------------------------------------------------------------------------- #


def test_assemble_certificate_deterministic_repeat_call():
    transcript = "buy from the demand zone when it is retested"
    res = run_tier1(transcript)
    kwargs = dict(
        full_transcript=transcript,
        full_transcript_sha256="sha1",
        source_video_id="v1",
        extractor_version="e1",
        taxonomy_version="t1",
        tier1_detections=res.detections,
        tier1_fallthroughs=[],
    )
    c1 = assemble_certificate(**kwargs)
    c2 = assemble_certificate(**kwargs)
    assert c1 == c2


# --------------------------------------------------------------------------- #
# or_alternatives_honored wiring end-to-end (via the or_branches param)
# --------------------------------------------------------------------------- #


# --------------------------------------------------------------------------- #
# enumeration-consistency axis FORWARDING through assemble_certificate (F-3,
# ratify-packet enum-consistency wiring). These call the REAL assemble_
# certificate (not terminal_read_grade directly) to prove assemble forwards
# the enum verdict to terminal_read_grade's second structural axis. The clean
# transcript keeps f2_coverage_gate + causality's regex leg PASSing so the enum
# axis is the sole discriminator between REJECTED / CLEAN / INDETERMINATE.
# --------------------------------------------------------------------------- #


def _clean_tier1_kwargs():
    """Minimal assemble_certificate kwargs whose live lints (f2_coverage_gate +
    causality regex leg) PASS -- so the terminal read's grade is driven purely
    by the conflation/enumeration verdicts we thread in."""
    transcript = "buy from the demand zone when it is retested"
    res = run_tier1(transcript)
    return dict(
        full_transcript=transcript,
        full_transcript_sha256="sha1",
        source_video_id="v1",
        extractor_version="e1",
        taxonomy_version="t1",
        tier1_detections=res.detections,
        tier1_fallthroughs=[],
    )


def test_assemble_forwards_enum_fail_to_terminal_read_rejected():
    """(F-3a) assemble_certificate(..., enumeration_consistency_verdict="FAIL",
    conflation_verdict="PASS") -> terminal_read_grade REJECTED. Proves assemble
    forwards the enum verdict (the FAIL comes ONLY from the enum axis: conflation
    is PASS and the live lints are clean)."""
    cert = assemble_certificate(
        **_clean_tier1_kwargs(),
        conflation_verdict="PASS",
        enumeration_consistency_verdict="FAIL",
    )
    assert cert["terminal_read_grade"] == "REJECTED"
    assert cert["terminal_read_clean"] is False
    assert cert["terminal_read_disposition"]["enumeration_consistency"] == "FAIL"
    assert cert["terminal_read_disposition"]["conflation_check"] == "PASS"


def test_assemble_forwards_enum_pass_to_terminal_read_clean():
    """(F-3c) The PASS counterpart -> CLEAN, proving the FAIL test above is not
    trivially always-REJECT: with enum PASS (and conflation PASS + clean live
    lints) the same certificate grades CLEAN."""
    cert = assemble_certificate(
        **_clean_tier1_kwargs(),
        conflation_verdict="PASS",
        enumeration_consistency_verdict="PASS",
    )
    assert cert["terminal_read_grade"] == "CLEAN"
    assert cert["terminal_read_clean"] is True
    assert cert["terminal_read_disposition"]["enumeration_consistency"] == "PASS"


def test_assemble_forwards_enum_not_evaluated_to_terminal_read_indeterminate():
    """(F-3d) The fail-closed forwarding: enumeration_consistency_verdict=
    "NOT_EVALUATED" (with conflation PASS, no FAIL anywhere) -> INDETERMINATE,
    never CLEAN. A live enum axis that could not be evaluated must not pass."""
    cert = assemble_certificate(
        **_clean_tier1_kwargs(),
        conflation_verdict="PASS",
        enumeration_consistency_verdict="NOT_EVALUATED",
    )
    assert cert["terminal_read_grade"] == "INDETERMINATE"
    assert cert["terminal_read_clean"] is False
    assert cert["terminal_read_disposition"]["enumeration_consistency"] == "NOT_EVALUATED"


def test_or_alternatives_honored_flows_through_assembler(monkeypatch):
    monkeypatch.delenv("TF_OR_BRANCHES_ENABLED", raising=False)
    transcript = "take puts on a VWOP retest or take puts on a pre-market low retest"
    span_a = (0, len("take puts on a VWOP retest"))
    idx_b = transcript.index("pre-market low retest")
    span_b = (idx_b, idx_b + len("pre-market low retest"))
    det_a = Tier1Detection(surface_class="imperative", quote_anchor=transcript[span_a[0]:span_a[1]], char_span=span_a)
    det_b = Tier1Detection(surface_class="imperative", quote_anchor=transcript[span_b[0]:span_b[1]], char_span=span_b)
    topology = [
        ConditionTopology(char_span=span_a, role="spine"),
        ConditionTopology(char_span=span_b, role="spine"),
    ]
    cert = assemble_certificate(
        full_transcript=transcript,
        full_transcript_sha256="sha1",
        source_video_id="v1",
        extractor_version="e1",
        taxonomy_version="t1",
        tier1_detections=[det_a, det_b],
        tier1_fallthroughs=[],
        topology=topology,
        or_branches=[["t1-0", "t1-1"]],
    )
    assert cert["compile_integrity"]["or_alternatives_honored"]["status"] == "FAIL"
    # or_alternatives_honored is a mechanical structural lint -- this asserts it
    # FLOWS THROUGH the assembler and EVALUATEs to FAIL (a reachability/logic
    # probe), NOT that it gates full_grade. Post-R-039 it is a diagnostic, not a
    # safety gate. full_grade is False here because NO conflation verdict was
    # supplied (semantic gate fail-closed), and full_grade_basis labels the
    # mechanical lint honest-vacuous.
    assert cert["pilot_grade"] is True
    assert cert["full_grade"] is False
    assert cert["full_grade_basis"]["or_alternatives_honored"] == "REACHABILITY_DIAGNOSTIC_NOT_SAFETY_GATING"
    assert cert["certificate_grade"] is False
