"""H1 pilot conveyor runner tests (Wave-4 ADDENDUM 2 REWORK + ADDENDUM 3
ANCHOR-LOCATOR WIRING, 2026-07-12).

Covers the extractor-as-unit rework: (a) spine-condition extraction from a
minimal-schema strategy dict; (b) anchor location now goes through
`anchor_locator.locate_anchor` (Addendum 3, A-prime) via a stubbed
`propose_fn` seam — NOT an exact-substring search of the condition's own
text — and partitions totally into anchored/unanchored, with the locator's
own `reason` threaded onto each unanchored entry; (c) prepare_strategy runs
tier-1 ONE CONDITION PER CALL on the LOCATED quote, builds a clean tier-3
packet, and never adjudicates itself; (d) the non-drop invariant (clause
3b) — every spine condition ends up unanchored OR gets a tier-1 outcome,
nothing vanishes; (e) the blinding leak-scan (unchanged contract:
silent-on-clean, fires-on-positive, no self-trip on meta text); (f)
prepare_strategy REFUSES to return a packet that fails the scan; (g)
finalize_certificate maps synthetic Tier3Verdicts back by char_span,
injects unanchored conditions as honest condition_entries (carrying the
locator's reason), and downgrades pilot_grade/full_grade/certificate_grade
to False whenever any condition is unanchored (clause 4); (h) per-condition
diagnosis distribution (clause 5) plus the unanchored reason breakdown;
(i) aggregate's arithmetic including the diagnosis roll-up; (j) the
SYNTHETIC DRY-RUN full-loop proof (network-free via a stubbed
`propose_fn`); (k) extractor_version_pin is deterministic and
content-keyed; (l) fetch_transcript is an unimplemented documented seam;
(m) no sealed-set / real-transcript access anywhere in the module.

Every `prepare_strategy`/`prepare_video`/`locate_condition_anchors` call in
this file passes an explicit stub `propose_fn` (`_stub_propose_fn` below)
so NO test in this file ever calls the real gemma anchor-locator (birth-gate
discipline, same as anchor_locator.py's own tests) — the real-locator proof
is the REQUIRED dry-run smoke test (extractor_bridge.py's
`run_dry_run_real_extractor`, exercised standalone, not under pytest).

Imports ONLY the pure-stdlib extraction package (no vectorbt / no
backtester), matching test_cert_assembler.py / test_tier1_detectors.py.
extractor_bridge.py (the subprocess-to-Node / real-extractor / vault module)
is tested separately in test_extractor_bridge.py — this file never invokes
a real extraction, per the module's own two-file split (see pilot_conveyor.
py's docstring on why the LLM-dispatch tokens live outside this module).
"""

from __future__ import annotations

import inspect
import json
import os
from typing import Optional

import pytest

from src.engine.extraction import anchor_locator as al
from src.engine.extraction import pilot_conveyor as pc
from src.engine.extraction.cert_assembler import Tier3Verdict


def _stub_propose_fn(transcript: str, condition_text: str) -> Optional[str]:
    """Birth-gate-safe, network-free stand-in for the real gemma locator:
    proposes the condition's own text verbatim. For every fixture strategy
    in this file, condition text is EITHER a genuine literal substring of
    its transcript (resolves LOCATED — mirrors the pre-Addendum-3 anchored
    set exactly) or a deliberately fabricated paraphrase (resolves
    UNANCHORED via `anchor_locator.REASON_NOT_LITERAL_SUBSTRING`, never via
    a decline, since this stub always proposes something). The mechanical
    VERIFY leg (`anchor_locator._verify_and_locate` /
    `_resolves_as_anchor`) still runs for REAL — only the PROPOSE leg (the
    network call) is stubbed, exactly as the module's own tests do."""
    return condition_text

# --------------------------------------------------------------------------- #
# (a) spine-condition extraction
# --------------------------------------------------------------------------- #


def test_extract_spine_condition_texts_pulls_all_five_field_kinds():
    strategy = {
        "entry_sequence": [
            {"step": 1, "action": "Buy the breakout.", "rationale": "Because it confirms momentum."},
        ],
        "confluences": [{"name": "vwap", "description": "Price above VWAP."}],
        "stop": {"anchor": "swing_low_below_entry", "rationale": "Below the swing low."},
        "targets": [{"priority": 1, "type": "x", "rationale": "Prior day high."}],
        "stop_management": "Trail to break-even after 1R.",
    }
    conds = pc.extract_spine_condition_texts(strategy)
    refs = {c.condition_ref for c in conds}
    assert refs == {
        "entry_sequence[0].action",
        "entry_sequence[0].rationale",
        "confluences[0].description",
        "stop.rationale",
        "targets[0].rationale",
        "stop_management",
    }
    assert all(c.strategy_index == 0 for c in conds)


def test_extract_spine_condition_texts_skips_null_and_empty_fields():
    strategy = {
        "entry_sequence": [{"step": 1, "action": "Buy.", "rationale": None}],
        "confluences": [],
        "stop": {"anchor": None, "rationale": None},
        "targets": [{"priority": 1, "type": "x", "rationale": "   "}],
        "stop_management": None,
    }
    conds = pc.extract_spine_condition_texts(strategy)
    assert len(conds) == 1
    assert conds[0].condition_ref == "entry_sequence[0].action"


def test_extract_spine_condition_texts_stamps_strategy_index():
    conds = pc.extract_spine_condition_texts({"entry_sequence": [{"step": 1, "action": "Buy."}]}, strategy_index=3)
    assert conds[0].strategy_index == 3


# --------------------------------------------------------------------------- #
# (b) anchor location — ADDENDUM 3: routes through anchor_locator.
# locate_anchor (gemma proposes / mechanics verify), NOT an exact-substring
# search of the condition's own text. Total partition, reason threading.
# --------------------------------------------------------------------------- #


def test_locate_condition_anchors_partitions_totally():
    conditions = [
        pc.SpineConditionText("a", "Buy from the demand zone when it is retested."),
        pc.SpineConditionText("b", "This text is not in the transcript at all."),
        pc.SpineConditionText("c", "Set your stop at the low of the hammer."),
    ]
    anchored, unanchored = pc.locate_condition_anchors(conditions, pc.DRY_RUN_TRANSCRIPT, propose_fn=_stub_propose_fn)
    assert len(anchored) == 2
    assert len(unanchored) == 1
    assert unanchored[0].condition_ref == "b"
    assert unanchored[0].reason == al.REASON_NOT_LITERAL_SUBSTRING
    for cond, anchor_result in anchored:
        s, e = anchor_result.char_span
        assert pc.DRY_RUN_TRANSCRIPT[s:e] == cond.text.strip()
        assert anchor_result.quote == pc.DRY_RUN_TRANSCRIPT[s:e]


def test_locate_condition_anchors_reason_on_locator_decline():
    def _declining_propose_fn(transcript: str, condition_text: str):
        return None

    conditions = [pc.SpineConditionText("a", "Anything at all")]
    anchored, unanchored = pc.locate_condition_anchors(
        conditions, "some transcript text", propose_fn=_declining_propose_fn
    )
    assert anchored == []
    assert len(unanchored) == 1
    assert unanchored[0].reason == al.REASON_LOCATOR_DECLINED


def test_locate_condition_anchors_reason_on_hallucinated_non_substring():
    def _hallucinating_propose_fn(transcript: str, condition_text: str):
        return "this exact phrase does not appear anywhere in the source"

    conditions = [pc.SpineConditionText("a", "Anything at all")]
    anchored, unanchored = pc.locate_condition_anchors(
        conditions, "some transcript text", propose_fn=_hallucinating_propose_fn
    )
    assert anchored == []
    assert len(unanchored) == 1
    assert unanchored[0].reason == al.REASON_NOT_LITERAL_SUBSTRING


def test_extractor_anchor_availability_report_shape():
    conditions = [
        pc.SpineConditionText("entry_sequence[0].action", "Buy from the demand zone when it is retested."),
        pc.SpineConditionText("entry_sequence[1].action", "Not in transcript."),
        pc.SpineConditionText("confluences[0].description", "Also not in transcript."),
    ]
    anchored, unanchored = pc.locate_condition_anchors(conditions, pc.DRY_RUN_TRANSCRIPT, propose_fn=_stub_propose_fn)
    report = pc.extractor_anchor_availability_report(conditions, anchored, unanchored)
    assert report["total_spine_conditions"] == 3
    assert report["anchored_count"] == 1
    assert report["unanchored_count"] == 2
    assert report["anchored_fraction"] == round(1 / 3, 4)
    assert set(report["by_field"].keys()) == {"entry_sequence[].action", "confluences[].description"}
    assert report["by_field"]["entry_sequence[].action"] == {"anchored": 1, "unanchored": 1}
    assert report["by_field"]["confluences[].description"] == {"anchored": 0, "unanchored": 1}
    assert report["unanchored_reason_breakdown"] == {al.REASON_NOT_LITERAL_SUBSTRING: 2}


# --------------------------------------------------------------------------- #
# (c) prepare_strategy: one-condition-per-tier1-call, packet built,
# non-adjudicator
# --------------------------------------------------------------------------- #


def test_prepare_strategy_fires_all_three_tier1_classes_and_two_fallthroughs():
    prep = pc.prepare_strategy(
        pc.DRY_RUN_EXTRACTED_STRATEGY,
        pc.DRY_RUN_TRANSCRIPT,
        "unit-test-video",
        extractor_version="e1",
        taxonomy_version="t1",
    propose_fn=_stub_propose_fn,
    )
    classes = {d.surface_class for d in prep["tier1_detections"]}
    assert classes == {"imperative", "conditional-action", "exclusion-contrast"}
    assert len(prep["tier1_fallthroughs"]) == 2
    assert len(prep["unanchored_conditions"]) == 1
    set_b = prep["tier3_packet"]["sections"][-1]
    assert set_b["section_id"] == "SET-B"
    assert set_b["item_count"] == 2
    assert len(prep["item_span_map"]) == 2
    assert prep["leak_scan"].clean is True


def test_prepare_strategy_item_ids_namespace_by_strategy_index():
    prep = pc.prepare_strategy(
        pc.DRY_RUN_EXTRACTED_STRATEGY,
        pc.DRY_RUN_TRANSCRIPT,
        "v-multi",
        extractor_version="e1",
        taxonomy_version="t1",
        strategy_index=2,
    propose_fn=_stub_propose_fn,
    )
    set_b_items = prep["tier3_packet"]["sections"][-1]["items"]
    assert all(it["item_id"].startswith("v-multi-S2-B") for it in set_b_items)


def test_prepare_strategy_reuses_wave1_set_a_verbatim():
    minimal_strategy = {"entry_sequence": [{"step": 1, "action": "Buy from the demand zone when it is retested.", "rationale": None}]}
    prep = pc.prepare_strategy(
        minimal_strategy,
        "Buy from the demand zone when it is retested.",
        "unit-test-video-2",
        extractor_version="e1",
        taxonomy_version="t1",
    propose_fn=_stub_propose_fn,
    )
    set_a = prep["tier3_packet"]["sections"][0]
    assert set_a["section_id"] == "SET-A"
    assert set_a["item_count"] == 10
    item_ids = {it["item_id"] for it in set_a["items"]}
    assert item_ids == {f"W1-{i:04d}" for i in range(1, 11)}
    assert all(it["rater_response"] == {"role": None, "notes": None} for it in set_a["items"])


def test_prepare_strategy_computes_sha256_when_not_supplied():
    strategy = {"entry_sequence": [{"step": 1, "action": "hello", "rationale": None}]}
    prep = pc.prepare_strategy(strategy, "hello world", "v-hash", extractor_version="e1", taxonomy_version="t1", propose_fn=_stub_propose_fn)
    import hashlib

    assert prep["provenance"]["full_transcript_sha256"] == hashlib.sha256(b"hello world").hexdigest()


def test_prepare_video_loops_over_every_strategy_and_returns_one_prep_per_strategy():
    extracted_output = {
        "strategies": [
            {"entry_sequence": [{"step": 1, "action": "Buy from the demand zone when it is retested.", "rationale": None}]},
            {"entry_sequence": [{"step": 1, "action": "Set your stop at the low of the hammer.", "rationale": None}]},
        ]
    }
    preps = pc.prepare_video(
        extracted_output, pc.DRY_RUN_TRANSCRIPT, "v-multi-strat", extractor_version="e1", taxonomy_version="t1",
    propose_fn=_stub_propose_fn,
    )
    assert len(preps) == 2
    assert [p["strategy_index"] for p in preps] == [0, 1]


def test_prepare_video_zero_strategies_returns_empty_list():
    preps = pc.prepare_video({"strategies": []}, "text", "v-empty", extractor_version="e1", taxonomy_version="t1", propose_fn=_stub_propose_fn)
    assert preps == []


def test_module_never_calls_an_llm_or_adjudicator():
    """Structural non-adjudicator proof: the module source contains no LLM/
    agent dispatch call anywhere on the prepare/finalize path. The real-
    extractor subprocess bridge lives entirely in extractor_bridge.py,
    imported here (an import statement, not a dispatch token) so this scan
    stays meaningful rather than growing an exemption list."""
    src = inspect.getsource(pc)
    forbidden_calls = ("ollama", "anthropic", "openai", "requests.post", "httpx.post", ".chat(")
    lowered = src.lower()
    for tok in forbidden_calls:
        assert tok not in lowered, f"found forbidden adjudicator-dispatch token: {tok}"


# --------------------------------------------------------------------------- #
# (d) non-drop invariant (clause 3b)
# --------------------------------------------------------------------------- #


def test_non_drop_invariant_every_condition_unanchored_or_classified_or_fallthrough():
    prep = pc.prepare_strategy(
        pc.DRY_RUN_EXTRACTED_STRATEGY,
        pc.DRY_RUN_TRANSCRIPT,
        "v-nondrop",
        extractor_version="e1",
        taxonomy_version="t1",
    propose_fn=_stub_propose_fn,
    )
    spine_count = prep["spine_condition_count"]
    unanchored_count = len(prep["unanchored_conditions"])
    outcome_count = len(prep["condition_outcomes"])
    assert spine_count == unanchored_count + outcome_count
    # cross-check against raw tier1 outputs: every outcome is EITHER
    # "classified_tier1" (that condition's run_tier1 call fired >=1
    # detection) OR "fallthrough_pending_tier3" (exactly one fallthrough) —
    # never both, never neither (tier1_detectors.py's own Tier1Result
    # contract).
    classified = [o for o in prep["condition_outcomes"] if o["outcome"] == "classified_tier1"]
    fell_through = [o for o in prep["condition_outcomes"] if o["outcome"] == "fallthrough_pending_tier3"]
    assert len(classified) + len(fell_through) == outcome_count
    assert len(fell_through) == len(prep["tier1_fallthroughs"])


def test_non_drop_invariant_final_certificate_accounts_for_every_spine_condition():
    prep = pc.prepare_strategy(
        pc.DRY_RUN_EXTRACTED_STRATEGY,
        pc.DRY_RUN_TRANSCRIPT,
        "v-nondrop-cert",
        extractor_version="e1",
        taxonomy_version="t1",
    propose_fn=_stub_propose_fn,
    )
    verdicts = [
        pc.verdict_from_rater_response(
            char_span=ft.char_span,
            quote_anchor=pc.DRY_RUN_TRANSCRIPT[ft.char_span[0]:ft.char_span[1]],
            role="context",
            control_gate_passed=True,
        )
        for ft in prep["tier1_fallthroughs"]
    ]
    cert = pc.finalize_certificate(prep, verdicts)
    # every unanchored condition appears explicitly in the certificate
    unanchored_entries = [c for c in cert["conditions"] if c["surface_class"] == "unanchored"]
    assert len(unanchored_entries) == len(prep["unanchored_conditions"])
    # tier-1-classified + tier-3-resolved + unanchored covers every outcome
    # (a classified condition may map to >=1 cert condition_entry in the
    # rare multi-detection case — see finalize_certificate's docstring —
    # so this is >=, not strict equality).
    classified_entries = [c for c in cert["conditions"] if c["classifying_tier"] in (1, 3)]
    assert len(classified_entries) >= len([o for o in prep["condition_outcomes"] if o["outcome"] == "classified_tier1"])


# --------------------------------------------------------------------------- #
# (e) blinding leak-scan: silent-on-clean, fires-on-positive (both legs),
# no self-trip on meta text — UNCHANGED contract
# --------------------------------------------------------------------------- #


def test_leak_scan_silent_on_clean_real_packet():
    prep = pc.prepare_strategy(pc.DRY_RUN_EXTRACTED_STRATEGY, pc.DRY_RUN_TRANSCRIPT, "v-clean", extractor_version="e1", taxonomy_version="t1", propose_fn=_stub_propose_fn)
    scan = pc.blinding_leak_scan(prep["tier3_packet"])
    assert scan.clean is True
    assert scan.violations == []


def test_leak_scan_does_not_self_trip_on_blinding_contract_meta_text():
    prep = pc.prepare_strategy(pc.DRY_RUN_EXTRACTED_STRATEGY, pc.DRY_RUN_TRANSCRIPT, "v-meta", extractor_version="e1", taxonomy_version="t1", propose_fn=_stub_propose_fn)
    contract_text = prep["tier3_packet"]["blinding_contract"].lower()
    assert "rationale" in contract_text and "verdict" in contract_text
    scan = pc.blinding_leak_scan(prep["tier3_packet"])
    assert scan.clean is True


def test_leak_scan_fires_on_injected_forbidden_token_lexical():
    prep = pc.prepare_strategy(pc.DRY_RUN_EXTRACTED_STRATEGY, pc.DRY_RUN_TRANSCRIPT, "v-poison-lex", extractor_version="e1", taxonomy_version="t1", propose_fn=_stub_propose_fn)
    poisoned = json.loads(json.dumps(prep["tier3_packet"]))
    poisoned["sections"][-1]["items"][0]["extracted_object"] = "demotion_role was OPTIONAL"
    scan = pc.blinding_leak_scan(poisoned)
    assert scan.clean is False
    assert any(v.startswith("forbidden_token:demotion") for v in scan.violations)


def test_leak_scan_fires_on_novel_out_of_allowlist_key_structural():
    prep = pc.prepare_strategy(pc.DRY_RUN_EXTRACTED_STRATEGY, pc.DRY_RUN_TRANSCRIPT, "v-poison-struct", extractor_version="e1", taxonomy_version="t1", propose_fn=_stub_propose_fn)
    poisoned = json.loads(json.dumps(prep["tier3_packet"]))
    poisoned["sections"][-1]["items"][0]["prior_label"] = "gate-strength"
    scan = pc.blinding_leak_scan(poisoned)
    assert scan.clean is False
    assert any("forbidden_item_keys" in v for v in scan.violations)
    assert not any(v.startswith("forbidden_token:") for v in scan.violations)


def test_leak_scan_fires_on_prefilled_rater_response():
    prep = pc.prepare_strategy(pc.DRY_RUN_EXTRACTED_STRATEGY, pc.DRY_RUN_TRANSCRIPT, "v-poison-prefill", extractor_version="e1", taxonomy_version="t1", propose_fn=_stub_propose_fn)
    poisoned = json.loads(json.dumps(prep["tier3_packet"]))
    poisoned["sections"][-1]["items"][0]["rater_response"]["role"] = "gate-strength"
    scan = pc.blinding_leak_scan(poisoned)
    assert scan.clean is False
    assert any("prefilled_rater_response" in v for v in scan.violations)


# --------------------------------------------------------------------------- #
# (f) prepare_strategy REFUSES to emit a packet that fails the scan
# --------------------------------------------------------------------------- #


def test_prepare_strategy_refuses_to_emit_on_leak_scan_failure(monkeypatch):
    original_builder = pc._build_tier3_packet

    def _poisoned_builder(full_transcript, video_id, fallthroughs, strategy_index=0):
        packet, span_map = original_builder(full_transcript, video_id, fallthroughs, strategy_index)
        if packet["sections"][-1]["items"]:
            packet["sections"][-1]["items"][0]["dri"] = "JUSTIFIED_MANDATORY"
        return packet, span_map

    monkeypatch.setattr(pc, "_build_tier3_packet", _poisoned_builder)
    with pytest.raises(pc.LeakScanFailure) as exc_info:
        pc.prepare_strategy(pc.DRY_RUN_EXTRACTED_STRATEGY, pc.DRY_RUN_TRANSCRIPT, "v-refuse", extractor_version="e1", taxonomy_version="t1", propose_fn=_stub_propose_fn)
    assert "v-refuse" in exc_info.value.video_id
    assert exc_info.value.violations


# --------------------------------------------------------------------------- #
# (g) finalize_certificate: char_span join + schema validity + clause-4
# unanchored downgrade
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
    for _name, result in ci.items():
        assert result["status"] in ("PASS", "FAIL", "NOT_EVALUATED")

    prov = cert["provenance"]
    for key in ("source_video_id", "full_transcript_sha256", "extractor_version", "taxonomy_version"):
        assert prov.get(key)

    assert "pilot_grade" in cert and isinstance(cert["pilot_grade"], bool)
    assert "full_grade" in cert and isinstance(cert["full_grade"], bool)
    assert "certificate_grade" in cert
    assert "diagnosis" in cert and isinstance(cert["diagnosis"], dict)
    assert "unanchored_condition_count" in cert


def test_finalize_certificate_downgrades_grade_when_a_condition_is_unanchored():
    prep = pc.prepare_strategy(pc.DRY_RUN_EXTRACTED_STRATEGY, pc.DRY_RUN_TRANSCRIPT, "v-unanchored", extractor_version="e1", taxonomy_version="t1", propose_fn=_stub_propose_fn)
    assert len(prep["unanchored_conditions"]) == 1
    verdicts = [
        pc.verdict_from_rater_response(
            char_span=ft.char_span,
            quote_anchor=pc.DRY_RUN_TRANSCRIPT[ft.char_span[0]:ft.char_span[1]],
            role="context",
            control_gate_passed=True,
        )
        for ft in prep["tier1_fallthroughs"]
    ]
    cert = pc.finalize_certificate(prep, verdicts, dry_run=True)
    _assert_schema_valid_certificate(cert, pc.DRY_RUN_TRANSCRIPT)
    assert cert["unanchored_condition_count"] == 1
    unanchored_entries = [c for c in cert["conditions"] if c["surface_class"] == "unanchored"]
    assert len(unanchored_entries) == 1
    assert unanchored_entries[0]["char_span"] == [-1, -1]
    assert unanchored_entries[0]["classifying_tier"] is None
    # clause 4: unanchored conditions COUNT AGAINST cert-grade, even though
    # every OTHER condition classified cleanly.
    assert cert["pilot_grade"] is False
    assert cert["full_grade"] is False
    assert cert["certificate_grade"] is False


def test_finalize_certificate_pilot_grade_true_when_fully_anchored_and_resolved():
    strategy = {
        "entry_sequence": [
            {"step": 1, "action": "Buy from the demand zone when it is retested.", "rationale": None},
            {"step": 2, "action": "Set your stop at the low of the hammer.", "rationale": None},
        ]
    }
    prep = pc.prepare_strategy(strategy, pc.DRY_RUN_TRANSCRIPT, "v-full-anchor", extractor_version="e1", taxonomy_version="t1", propose_fn=_stub_propose_fn)
    assert prep["unanchored_conditions"] == []
    verdicts = [
        pc.verdict_from_rater_response(
            char_span=ft.char_span,
            quote_anchor=pc.DRY_RUN_TRANSCRIPT[ft.char_span[0]:ft.char_span[1]],
            role="context",
            control_gate_passed=True,
        )
        for ft in prep["tier1_fallthroughs"]
    ]
    cert = pc.finalize_certificate(prep, verdicts, dry_run=True)
    _assert_schema_valid_certificate(cert, pc.DRY_RUN_TRANSCRIPT)
    assert cert["unanchored_condition_count"] == 0
    assert cert["pilot_grade"] is True
    assert cert["full_grade"] is False, "topology-less pilot path: full_grade unreachable by design (addendum §C)"
    assert cert["certificate_grade"] is False


def test_finalize_certificate_leaves_span_unclassified_when_verdict_missing():
    prep = pc.prepare_strategy(pc.DRY_RUN_EXTRACTED_STRATEGY, pc.DRY_RUN_TRANSCRIPT, "v-partial", extractor_version="e1", taxonomy_version="t1", propose_fn=_stub_propose_fn)
    cert = pc.finalize_certificate(prep, tier3_verdicts=[])
    assert any(c["classifying_tier"] is None and c["surface_class"] != "unanchored" for c in cert["conditions"])
    assert cert["pilot_grade"] is False
    assert cert["full_grade"] is False


def test_finalize_certificate_control_gate_failed_verdict_ignored():
    prep = pc.prepare_strategy(pc.DRY_RUN_EXTRACTED_STRATEGY, pc.DRY_RUN_TRANSCRIPT, "v-badgate", extractor_version="e1", taxonomy_version="t1", propose_fn=_stub_propose_fn)
    ft = prep["tier1_fallthroughs"][0]
    bad = Tier3Verdict(
        char_span=ft.char_span,
        quote_anchor=pc.DRY_RUN_TRANSCRIPT[ft.char_span[0]:ft.char_span[1]],
        surface_class="context",
        verdict="context",
        control_gate_passed=False,
    )
    cert = pc.finalize_certificate(prep, tier3_verdicts=[bad])
    resolved_spans = {tuple(c["char_span"]) for c in cert["conditions"] if c["classifying_tier"] == 3}
    assert list(ft.char_span) not in [list(s) for s in resolved_spans]


# --------------------------------------------------------------------------- #
# (h) per-condition diagnosis distribution (clause 5)
# --------------------------------------------------------------------------- #


def test_diagnose_certificate_counts_unanchored_and_fallthrough_unresolved():
    prep = pc.prepare_strategy(pc.DRY_RUN_EXTRACTED_STRATEGY, pc.DRY_RUN_TRANSCRIPT, "v-diag", extractor_version="e1", taxonomy_version="t1", propose_fn=_stub_propose_fn)
    cert = pc.finalize_certificate(prep, tier3_verdicts=[])
    diag = cert["diagnosis"]
    assert diag[pc.DIAGNOSIS_UNANCHORED] == 1
    assert diag[pc.DIAGNOSIS_FALLTHROUGH_UNRESOLVED] == len(prep["tier1_fallthroughs"])
    assert diag[pc.DIAGNOSIS_OK] == len(prep["tier1_detections"])


def test_diagnose_certificate_counts_tier3_fail_from_raw_verdicts_not_cert():
    prep = pc.prepare_strategy(pc.DRY_RUN_EXTRACTED_STRATEGY, pc.DRY_RUN_TRANSCRIPT, "v-diag-t3fail", extractor_version="e1", taxonomy_version="t1", propose_fn=_stub_propose_fn)
    ft = prep["tier1_fallthroughs"][0]
    bad = Tier3Verdict(
        char_span=ft.char_span,
        quote_anchor=pc.DRY_RUN_TRANSCRIPT[ft.char_span[0]:ft.char_span[1]],
        surface_class="context",
        verdict="context",
        control_gate_passed=False,
    )
    cert = pc.finalize_certificate(prep, tier3_verdicts=[bad])
    assert cert["diagnosis"][pc.DIAGNOSIS_TIER3_FAIL] == 1


def test_diagnose_certificate_ok_only_when_fully_resolved():
    strategy = {"entry_sequence": [{"step": 1, "action": "Set your stop at the low of the hammer.", "rationale": None}]}
    prep = pc.prepare_strategy(strategy, pc.DRY_RUN_TRANSCRIPT, "v-diag-ok", extractor_version="e1", taxonomy_version="t1", propose_fn=_stub_propose_fn)
    cert = pc.finalize_certificate(prep, tier3_verdicts=[])
    diag = cert["diagnosis"]
    assert diag[pc.DIAGNOSIS_UNANCHORED] == 0
    assert diag[pc.DIAGNOSIS_FALLTHROUGH_UNRESOLVED] == 0
    assert diag[pc.DIAGNOSIS_OK] == 1


# --------------------------------------------------------------------------- #
# (i) aggregate arithmetic + diagnosis roll-up
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
        "diagnosis": {pc.DIAGNOSIS_OK: 3},
    }
    cert_fail = {
        "pilot_grade": False,
        "full_grade": False,
        "conditions": [{"classifying_tier": None}],
        "diagnosis": {pc.DIAGNOSIS_FALLTHROUGH_UNRESOLVED: 1},
    }
    agg = pc.aggregate([cert_pass, cert_fail])
    assert agg["n_videos"] == 2
    assert agg["pilot_grade_n"] == 1
    assert agg["pilot_grade_fraction"] == 0.5
    assert agg["full_grade_n"] == 0
    assert agg["tier3_adjudications_per_video"] == [2, 0]
    assert agg["mean_tier3_adjudications_per_video"] == 1.0
    assert agg["diagnosis_distribution"][pc.DIAGNOSIS_OK] == 3
    assert agg["diagnosis_distribution"][pc.DIAGNOSIS_FALLTHROUGH_UNRESOLVED] == 1


def test_aggregate_empty_list_is_none_not_crash():
    agg = pc.aggregate([])
    assert agg["n_videos"] == 0
    assert agg["pilot_grade_fraction"] is None
    assert agg["mean_tier3_adjudications_per_video"] is None
    assert all(v == 0 for v in agg["diagnosis_distribution"].values())


# --------------------------------------------------------------------------- #
# (j) SYNTHETIC DRY-RUN full-loop proof (no LLM call anywhere)
# --------------------------------------------------------------------------- #


def test_dry_run_synthetic_full_loop_schema_valid_and_labeled():
    result = pc.run_dry_run_synthetic()
    assert result["dry_run"] is True
    assert "DRY-RUN" in result["artifact"]
    assert result["video_id"] == pc.DRY_RUN_VIDEO_ID
    assert "DRY-RUN" in result["video_id"]

    cert = result["certificate"]
    _assert_schema_valid_certificate(cert, pc.DRY_RUN_TRANSCRIPT)
    assert cert["dry_run"] is True
    assert cert["provenance"]["dry_run"] is True
    assert cert["full_grade"] is False
    # this strategy has exactly one unanchored condition by construction —
    # pilot_grade must therefore honestly read False (clause 4), NOT True.
    assert cert["unanchored_condition_count"] == 1
    assert cert["pilot_grade"] is False

    assert result["prepare_leak_scan"]["clean"] is True
    assert result["leak_scan_positive_proof"]["clean"] is False
    assert result["leak_scan_positive_proof"]["violations"]
    assert result["anchor_report"]["unanchored_count"] == 1


def test_dry_run_artifact_filename_contains_dry_run_marker(tmp_path):
    result = pc.run_dry_run_synthetic()
    path = pc.write_dry_run_artifact(result, str(tmp_path))
    assert "DRY-RUN" in os.path.basename(path)
    with open(path, encoding="utf-8") as fh:
        on_disk = json.load(fh)
    assert on_disk["dry_run"] is True
    assert on_disk["certificate"]["dry_run"] is True


# --------------------------------------------------------------------------- #
# (k) extractor_version_pin
# --------------------------------------------------------------------------- #


def test_extractor_version_pin_is_deterministic():
    a = pc.extractor_version_pin()
    b = pc.extractor_version_pin()
    assert a == b
    assert "content-" in a


def test_extractor_version_pin_changes_between_legacy_and_minimal(monkeypatch):
    monkeypatch.delenv("TRANSCRIPT_EXTRACTOR_USE_LEGACY", raising=False)
    minimal_pin = pc.extractor_version_pin()
    monkeypatch.setenv("TRANSCRIPT_EXTRACTOR_USE_LEGACY", "true")
    legacy_pin = pc.extractor_version_pin()
    assert minimal_pin != legacy_pin
    assert "minimal" in minimal_pin
    assert "legacy" in legacy_pin


# --------------------------------------------------------------------------- #
# (l) fetch_transcript is a documented, unimplemented seam — UNCHANGED
# --------------------------------------------------------------------------- #


def test_fetch_transcript_is_unimplemented_documented_seam():
    with pytest.raises(NotImplementedError) as exc_info:
        pc.fetch_transcript("some-video-id")
    msg = str(exc_info.value)
    assert "transcript-fetch-queue.ts" in msg
    assert "youtube-transcript" in msg


# --------------------------------------------------------------------------- #
# (m) no sealed-set / real-transcript access anywhere in the module
# --------------------------------------------------------------------------- #


def test_module_never_references_sealed_set_artifacts():
    src = inspect.getsource(pc)
    forbidden = ("h1-sealed-fresh-set", "sealed-16", "sealed_eval")
    for tok in forbidden:
        assert tok not in src, f"module source references a sealed-set artifact: {tok}"


def test_dry_run_transcript_is_not_sealed_content():
    assert "DRY-RUN" in pc.DRY_RUN_VIDEO_ID
    assert pc.DRY_RUN_TRANSCRIPT  # non-empty, hand-authored, see module docstring
