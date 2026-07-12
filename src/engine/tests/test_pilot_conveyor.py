"""H1 pilot conveyor runner tests (Wave-4 dispatch deliverable, 2026-07-12).

Covers: (a) prepare_video builds a clean tier-3 packet and never adjudicates
itself; (b) the blinding leak-scan is silent-on-clean AND fires-on-positive,
both structurally (forbidden keys) and lexically (forbidden tokens), and
does NOT false-trip on its own meta text; (c) prepare_video REFUSES to
return a packet that fails the scan; (d) finalize_certificate maps synthetic
Tier3Verdicts back by char_span and produces a schema-valid pilot-grade
certificate with full_grade=False (topology-less path, addendum §C); (e)
aggregate's arithmetic; (f) the DRY-RUN full-loop proof: schema-valid,
DRY-RUN-labeled, leak-scan proven to fire; (g) fetch_transcript is an
unimplemented documented seam; (h) no sealed-set / real-transcript access
anywhere in the module.

Imports ONLY the pure-stdlib extraction package (no vectorbt / no
backtester), matching test_cert_assembler.py / test_tier1_detectors.py.
"""

from __future__ import annotations

import inspect
import json
import os

import pytest

from src.engine.extraction import pilot_conveyor as pc
from src.engine.extraction.cert_assembler import Tier3Verdict


# --------------------------------------------------------------------------- #
# (a) prepare_video: tier-1 runs, packet is built, non-adjudicator
# --------------------------------------------------------------------------- #


def test_prepare_video_fires_all_three_tier1_classes_and_two_fallthroughs():
    prep = pc.prepare_video(
        transcript_text=pc.DRY_RUN_TRANSCRIPT,
        video_id="unit-test-video",
        extractor_version="e1",
        taxonomy_version="t1",
    )
    classes = {d.surface_class for d in prep["tier1_detections"]}
    assert classes == {"imperative", "conditional-action", "exclusion-contrast"}
    assert len(prep["tier1_fallthroughs"]) == 2
    set_b = prep["tier3_packet"]["sections"][-1]
    assert set_b["section_id"] == "SET-B"
    assert set_b["item_count"] == 2
    assert len(prep["item_span_map"]) == 2
    assert prep["leak_scan"].clean is True


def test_prepare_video_reuses_wave1_set_a_verbatim():
    prep = pc.prepare_video(
        transcript_text="Buy from the demand zone when it is retested.",
        video_id="unit-test-video-2",
        extractor_version="e1",
        taxonomy_version="t1",
    )
    set_a = prep["tier3_packet"]["sections"][0]
    assert set_a["section_id"] == "SET-A"
    assert set_a["item_count"] == 10
    item_ids = {it["item_id"] for it in set_a["items"]}
    assert item_ids == {f"W1-{i:04d}" for i in range(1, 11)}
    # every control item's rater_response is still un-filled (Wave-1 source
    # already ships them null; the reuse must not mutate them).
    assert all(it["rater_response"] == {"role": None, "notes": None} for it in set_a["items"])


def test_prepare_video_computes_sha256_when_not_supplied():
    prep = pc.prepare_video(
        transcript_text="hello world",
        video_id="v-hash",
        extractor_version="e1",
        taxonomy_version="t1",
    )
    import hashlib

    assert prep["provenance"]["full_transcript_sha256"] == hashlib.sha256(b"hello world").hexdigest()


def test_module_never_calls_an_llm_or_adjudicator():
    """Structural non-adjudicator proof: the module source contains no LLM/
    agent dispatch call anywhere on the prepare/finalize path."""
    src = inspect.getsource(pc)
    forbidden_calls = ("ollama", "anthropic", "openai", "requests.post", "httpx.post", ".chat(")
    lowered = src.lower()
    for tok in forbidden_calls:
        assert tok not in lowered, f"found forbidden adjudicator-dispatch token: {tok}"


# --------------------------------------------------------------------------- #
# (b) blinding leak-scan: silent-on-clean, fires-on-positive (both legs),
# no self-trip on meta text
# --------------------------------------------------------------------------- #


def test_leak_scan_silent_on_clean_real_packet():
    prep = pc.prepare_video(
        transcript_text=pc.DRY_RUN_TRANSCRIPT,
        video_id="v-clean",
        extractor_version="e1",
        taxonomy_version="t1",
    )
    scan = pc.blinding_leak_scan(prep["tier3_packet"])
    assert scan.clean is True
    assert scan.violations == []


def test_leak_scan_does_not_self_trip_on_blinding_contract_meta_text():
    """The blinding_contract string ITSELF names the forbidden words
    ('outcome/tally/verdict/rationale') as its own policy description. The
    scan must NOT fire on that meta text -- only on the rater-facing
    `sections` content. Regression guard for the exact false-positive trap
    named in the module docstring."""
    prep = pc.prepare_video(
        transcript_text=pc.DRY_RUN_TRANSCRIPT,
        video_id="v-meta",
        extractor_version="e1",
        taxonomy_version="t1",
    )
    contract_text = prep["tier3_packet"]["blinding_contract"].lower()
    assert "rationale" in contract_text and "verdict" in contract_text  # sanity: meta text DOES say these
    scan = pc.blinding_leak_scan(prep["tier3_packet"])
    assert scan.clean is True


def test_leak_scan_fires_on_injected_forbidden_token_lexical():
    prep = pc.prepare_video(
        transcript_text=pc.DRY_RUN_TRANSCRIPT,
        video_id="v-poison-lex",
        extractor_version="e1",
        taxonomy_version="t1",
    )
    poisoned = json.loads(json.dumps(prep["tier3_packet"]))
    poisoned["sections"][-1]["items"][0]["extracted_object"] = "demotion_role was OPTIONAL"
    scan = pc.blinding_leak_scan(poisoned)
    assert scan.clean is False
    assert any(v.startswith("forbidden_token:demotion") for v in scan.violations)


def test_leak_scan_fires_on_novel_out_of_allowlist_key_structural():
    """A key that matches NO forbidden token by substring (so the lexical
    leg is silent) must still be caught by the structural allowlist leg --
    proves the two checks are independent, not one masquerading as two."""
    prep = pc.prepare_video(
        transcript_text=pc.DRY_RUN_TRANSCRIPT,
        video_id="v-poison-struct",
        extractor_version="e1",
        taxonomy_version="t1",
    )
    poisoned = json.loads(json.dumps(prep["tier3_packet"]))
    poisoned["sections"][-1]["items"][0]["prior_label"] = "gate-strength"
    scan = pc.blinding_leak_scan(poisoned)
    assert scan.clean is False
    assert any("forbidden_item_keys" in v for v in scan.violations)
    assert not any(v.startswith("forbidden_token:") for v in scan.violations), (
        "this test's poison must NOT match the lexical denylist -- "
        "otherwise it isn't isolating the structural leg"
    )


def test_leak_scan_fires_on_prefilled_rater_response():
    prep = pc.prepare_video(
        transcript_text=pc.DRY_RUN_TRANSCRIPT,
        video_id="v-poison-prefill",
        extractor_version="e1",
        taxonomy_version="t1",
    )
    poisoned = json.loads(json.dumps(prep["tier3_packet"]))
    poisoned["sections"][-1]["items"][0]["rater_response"]["role"] = "gate-strength"
    scan = pc.blinding_leak_scan(poisoned)
    assert scan.clean is False
    assert any("prefilled_rater_response" in v for v in scan.violations)


# --------------------------------------------------------------------------- #
# (c) prepare_video REFUSES to emit a packet that fails the scan
# --------------------------------------------------------------------------- #


def test_prepare_video_refuses_to_emit_on_leak_scan_failure(monkeypatch):
    original_builder = pc._build_tier3_packet

    def _poisoned_builder(full_transcript, video_id, fallthroughs):
        packet, span_map = original_builder(full_transcript, video_id, fallthroughs)
        if packet["sections"][-1]["items"]:
            packet["sections"][-1]["items"][0]["dri"] = "JUSTIFIED_MANDATORY"
        return packet, span_map

    monkeypatch.setattr(pc, "_build_tier3_packet", _poisoned_builder)
    with pytest.raises(pc.LeakScanFailure) as exc_info:
        pc.prepare_video(
            transcript_text=pc.DRY_RUN_TRANSCRIPT,
            video_id="v-refuse",
            extractor_version="e1",
            taxonomy_version="t1",
        )
    assert exc_info.value.video_id == "v-refuse"
    assert exc_info.value.violations


# --------------------------------------------------------------------------- #
# (d) finalize_certificate: char_span join + schema validity + full_grade=False
# --------------------------------------------------------------------------- #


def _assert_schema_valid_certificate(cert: dict, transcript: str) -> None:
    assert cert["conditions"], "certificate must have at least one condition"
    for c in cert["conditions"]:
        assert "surface_class" in c
        assert c["classifying_tier"] in (1, 3, None)
        assert "quote_anchor" in c
        assert "char_span" in c and len(c["char_span"]) == 2
        if c["classifying_tier"] is not None:
            s, e = c["char_span"]
            assert transcript[s:e] == c["quote_anchor"]

    ci = cert["compile_integrity"]
    assert set(ci.keys()) == {
        "direction_conflation_lint",
        "unsat_sat_check",
        "or_alternatives_honored",
        "f2_coverage_gate",
        "causality_lint",
    }
    for name, result in ci.items():
        assert result["status"] in ("PASS", "FAIL", "NOT_EVALUATED")

    prov = cert["provenance"]
    for key in ("source_video_id", "full_transcript_sha256", "extractor_version", "taxonomy_version"):
        assert prov.get(key)

    assert "pilot_grade" in cert and isinstance(cert["pilot_grade"], bool)
    assert "full_grade" in cert and isinstance(cert["full_grade"], bool)
    assert "certificate_grade" in cert


def test_finalize_certificate_maps_verdicts_by_char_span_and_is_schema_valid():
    prep = pc.prepare_video(
        transcript_text=pc.DRY_RUN_TRANSCRIPT,
        video_id="v-finalize",
        extractor_version="e1",
        taxonomy_version="t1",
    )
    verdicts = [
        pc.verdict_from_rater_response(
            char_span=ft.char_span,
            quote_anchor=pc.DRY_RUN_TRANSCRIPT[ft.char_span[0] : ft.char_span[1]],
            role="context",
            control_gate_passed=True,
        )
        for ft in prep["tier1_fallthroughs"]
    ]
    cert = pc.finalize_certificate(prep, verdicts, dry_run=True)
    _assert_schema_valid_certificate(cert, pc.DRY_RUN_TRANSCRIPT)
    assert all(c["classifying_tier"] in (1, 3) for c in cert["conditions"]), (
        "every fall-through was resolved by a verdict -- nothing should stay unclassified"
    )
    assert cert["pilot_grade"] is True
    assert cert["full_grade"] is False, "topology-less pilot path: full_grade unreachable by design (addendum §C)"
    assert cert["certificate_grade"] is False
    assert cert["dry_run"] is True
    assert cert["provenance"]["dry_run"] is True


def test_finalize_certificate_leaves_span_unclassified_when_verdict_missing():
    prep = pc.prepare_video(
        transcript_text=pc.DRY_RUN_TRANSCRIPT,
        video_id="v-partial",
        extractor_version="e1",
        taxonomy_version="t1",
    )
    cert = pc.finalize_certificate(prep, tier3_verdicts=[])
    assert any(c["classifying_tier"] is None for c in cert["conditions"])
    assert cert["pilot_grade"] is False
    assert cert["full_grade"] is False


def test_finalize_certificate_control_gate_failed_verdict_ignored():
    prep = pc.prepare_video(
        transcript_text=pc.DRY_RUN_TRANSCRIPT,
        video_id="v-badgate",
        extractor_version="e1",
        taxonomy_version="t1",
    )
    ft = prep["tier1_fallthroughs"][0]
    bad = Tier3Verdict(
        char_span=ft.char_span,
        quote_anchor=pc.DRY_RUN_TRANSCRIPT[ft.char_span[0] : ft.char_span[1]],
        surface_class="context",
        verdict="context",
        control_gate_passed=False,
    )
    cert = pc.finalize_certificate(prep, tier3_verdicts=[bad])
    resolved_spans = {tuple(c["char_span"]) for c in cert["conditions"] if c["classifying_tier"] == 3}
    assert list(ft.char_span) not in [list(s) for s in resolved_spans]


# --------------------------------------------------------------------------- #
# (e) aggregate arithmetic
# --------------------------------------------------------------------------- #


def test_aggregate_computes_fraction_and_mean_adjudications():
    cert_pass = {
        "pilot_grade": True,
        "full_grade": False,
        "conditions": [
            {"classifying_tier": 1},
            {"classifying_tier": 3},
            {"classifying_tier": 3},
        ],
    }
    cert_fail = {
        "pilot_grade": False,
        "full_grade": False,
        "conditions": [{"classifying_tier": None}],
    }
    agg = pc.aggregate([cert_pass, cert_fail])
    assert agg["n_videos"] == 2
    assert agg["pilot_grade_n"] == 1
    assert agg["pilot_grade_fraction"] == 0.5
    assert agg["full_grade_n"] == 0
    assert agg["tier3_adjudications_per_video"] == [2, 0]
    assert agg["mean_tier3_adjudications_per_video"] == 1.0


def test_aggregate_empty_list_is_none_not_crash():
    agg = pc.aggregate([])
    assert agg["n_videos"] == 0
    assert agg["pilot_grade_fraction"] is None
    assert agg["mean_tier3_adjudications_per_video"] is None


# --------------------------------------------------------------------------- #
# (f) DRY-RUN full-loop proof
# --------------------------------------------------------------------------- #


def test_dry_run_full_loop_schema_valid_and_labeled():
    result = pc.run_dry_run()
    assert result["dry_run"] is True
    assert "DRY-RUN" in result["artifact"]
    assert result["video_id"] == pc.DRY_RUN_VIDEO_ID
    assert "DRY-RUN" in result["video_id"]

    cert = result["certificate"]
    _assert_schema_valid_certificate(cert, pc.DRY_RUN_TRANSCRIPT)
    assert cert["dry_run"] is True
    assert cert["provenance"]["dry_run"] is True
    assert cert["full_grade"] is False

    assert result["prepare_leak_scan"]["clean"] is True
    assert result["leak_scan_positive_proof"]["clean"] is False
    assert result["leak_scan_positive_proof"]["violations"]


def test_dry_run_artifact_filename_contains_dry_run_marker(tmp_path):
    result = pc.run_dry_run()
    path = pc.write_dry_run_artifact(result, str(tmp_path))
    assert "DRY-RUN" in os.path.basename(path)
    with open(path, encoding="utf-8") as fh:
        on_disk = json.load(fh)
    assert on_disk["dry_run"] is True
    assert on_disk["certificate"]["dry_run"] is True


# --------------------------------------------------------------------------- #
# (g) fetch_transcript is a documented, unimplemented seam
# --------------------------------------------------------------------------- #


def test_fetch_transcript_is_unimplemented_documented_seam():
    with pytest.raises(NotImplementedError) as exc_info:
        pc.fetch_transcript("some-video-id")
    msg = str(exc_info.value)
    assert "transcript-fetch-queue.ts" in msg
    assert "youtube-transcript" in msg


# --------------------------------------------------------------------------- #
# (h) no sealed-set / real-transcript access anywhere in the module
# --------------------------------------------------------------------------- #


def test_module_never_references_sealed_set_artifacts():
    src = inspect.getsource(pc)
    forbidden = ("h1-sealed-fresh-set", "sealed-16", "sealed_eval")
    for tok in forbidden:
        assert tok not in src, f"module source references a sealed-set artifact: {tok}"


def test_dry_run_transcript_is_not_sealed_content():
    # The dry-run transcript is composed of fixture sentences that are
    # already public design-set exemplars (tier1_birth_fixtures.json), not
    # drawn from the sealed 16 or the 77 sealed-eval tier-2 quarantine.
    assert "DRY-RUN" in pc.DRY_RUN_VIDEO_ID
    assert pc.DRY_RUN_TRANSCRIPT  # non-empty, hand-authored, see module docstring
