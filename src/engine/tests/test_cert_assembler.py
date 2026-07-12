"""H1 certificate assembler contract tests (Wave-4 deliverable 5).

Covers: (a) every emitted char_span resolves to quote_anchor verbatim; (b)
certificate_grade logic (a failing lint OR an unanchored/unclassified
condition => grade FALSE); (c) classifying_tier==2 is NEVER emitted; (d)
adjudication_verdict present iff tier==3; (e) provenance complete.

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
# (b) certificate_grade logic
# --------------------------------------------------------------------------- #


def test_certificate_grade_true_when_fully_classified_and_anchored_and_lints_clean():
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
    assert cert["certificate_grade"] is True


def test_certificate_grade_false_when_a_span_is_unclassified():
    """A fall-through span with NO control-gate-passing tier-3 verdict stays
    classifying_tier=None -- certificate_grade must go FALSE."""
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
    assert cert["certificate_grade"] is False


def test_certificate_grade_false_when_a_lint_fails():
    """Feed the direction-conflation type-specimen through the assembler via
    the topology overlay + or_branches param and confirm a single failing
    compile-integrity lint alone flips certificate_grade to FALSE even though
    every condition is fully classified and anchored."""
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
    )
    assert cert["compile_integrity"]["direction_conflation_lint"]["passed"] is False
    assert cert["certificate_grade"] is False
    # every OTHER precondition for grade=True still holds -- isolates the lint
    # as the sole cause, per the brief's "a failing lint OR an unanchored/
    # unclassified condition" disjunction.
    assert all(c["classifying_tier"] in (1, 3) for c in cert["conditions"])


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
    assert cert["certificate_grade"] is False


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
    assert cert["compile_integrity"]["or_alternatives_honored"]["passed"] is False
    assert cert["certificate_grade"] is False
