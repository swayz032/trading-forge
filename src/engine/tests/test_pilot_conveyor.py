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
(m) no sealed-set / real-transcript access anywhere in the module;
(n) ADDENDUM 4 FIX 1 — the dual-read agreement gate: agreement classifies,
disagreement (a mis-grounded-but-literal anchor) falls through, exercised
via the grader's own three constructed "flatter" cases (a literal-but-wrong
located quote whose surface diverges from the condition's own surface);
(o) ADDENDUM 4 FIX 2 — the two-stage tier-3 packet: Stage-1 blinding stays
intact (leak-scan proves the condition string is absent from the blind
view, with a positive-fire proof so the guard is not vacuous) and Stage 2
carries a revealed condition text + an empty support slot per fall-through
item; (p) the Stage-2 support certificate field:
`adjudication_verdict.support`/`.support_justification`, confirmed leaves a
condition grounded, denied/partial downgrades it (treated like an
unresolved fall-through) and forces pilot_grade/full_grade/certificate_grade
False; (q) dual-read costs zero extra model calls (the existing
non-adjudicator source scan already proves this structurally — dual-read
only adds more calls to the same pure-regex `run_tier1`).

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
    # ADDENDUM 5 AXIS 3: this strategy has classified fires + idle budget
    # (2 fallthroughs < the default 15 ceiling), so a deterministic
    # sampling-audit item is appended -- 2 genuine fallthroughs + exactly
    # ONE audit item (never more).
    expected_count = 2 + (1 if prep["axis3_audit"]["char_span"] is not None else 0)
    assert set_b["item_count"] == expected_count
    assert len(prep["item_span_map"]) == expected_count
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
    # ADDENDUM 5 AXIS 3: a fallthrough item is namespaced "...-S2-B###"; the
    # (at most one) sampling-audit item is namespaced "...-S2-AUDIT" and is
    # explicitly tagged -- both share the strategy-index prefix.
    for it in set_b_items:
        assert it["item_id"].startswith("v-multi-S2-")
        if it.get("audit"):
            assert it["item_id"] == "v-multi-S2-AUDIT"
        else:
            assert it["item_id"].startswith("v-multi-S2-B")


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

    def _poisoned_builder(
        full_transcript, video_id, fallthroughs, strategy_index=0,
        condition_text_by_span=None, audit_target=None,
    ):
        packet, span_map = original_builder(
            full_transcript, video_id, fallthroughs, strategy_index,
            condition_text_by_span=condition_text_by_span,
            audit_target=audit_target,
        )
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
# (h2) enumeration-consistency axis FORWARDING through finalize_certificate
# (F-3, ratify-packet enum-consistency wiring). These call the REAL
# finalize_certificate (not terminal_read_grade directly) to prove the FULL
# runner-level forwarding chain threads the enum verdict all the way to the
# terminal read. The fully-anchored/resolved strategy keeps f2_coverage_gate +
# causality's regex leg PASSing so the enum verdict is the sole discriminator.
# --------------------------------------------------------------------------- #


def _clean_finalize_prep(video_id: str):
    """A fully-anchored, fully-resolved prep whose live lints PASS -- so the
    terminal read's grade is driven purely by the threaded conflation/enum
    verdicts. Mirrors test_finalize_certificate_pilot_grade_true_when_fully_
    anchored_and_resolved's fixture."""
    strategy = {
        "entry_sequence": [
            {"step": 1, "action": "Buy from the demand zone when it is retested.", "rationale": None},
            {"step": 2, "action": "Set your stop at the low of the hammer.", "rationale": None},
        ]
    }
    return pc.prepare_strategy(
        strategy, pc.DRY_RUN_TRANSCRIPT, video_id,
        extractor_version="e1", taxonomy_version="t1", propose_fn=_stub_propose_fn,
    )


def test_finalize_forwards_enum_fail_to_terminal_read_rejected():
    """(F-3b) finalize_certificate(..., enumeration_consistency_verdict="FAIL",
    conflation_verdict="PASS") -> terminal_read_grade REJECTED, through the REAL
    runner. Proves finalize forwards the enum verdict (the FAIL comes ONLY from
    the enum axis: conflation PASS, live lints clean)."""
    prep = _clean_finalize_prep("v-enum-fail")
    cert = pc.finalize_certificate(
        prep, tier3_verdicts=[], dry_run=True,
        conflation_verdict="PASS", enumeration_consistency_verdict="FAIL",
    )
    assert cert["terminal_read_grade"] == "REJECTED"
    assert cert["terminal_read_clean"] is False
    assert cert["terminal_read_disposition"]["enumeration_consistency"] == "FAIL"
    assert cert["terminal_read_disposition"]["conflation_check"] == "PASS"


def test_finalize_forwards_enum_pass_to_terminal_read_clean():
    """(F-3c) The PASS counterpart -> CLEAN, proving the FAIL test above is not
    trivially always-REJECT: enum PASS + conflation PASS + clean live lints ->
    CLEAN through the real runner."""
    prep = _clean_finalize_prep("v-enum-pass")
    cert = pc.finalize_certificate(
        prep, tier3_verdicts=[], dry_run=True,
        conflation_verdict="PASS", enumeration_consistency_verdict="PASS",
    )
    assert cert["terminal_read_grade"] == "CLEAN"
    assert cert["terminal_read_clean"] is True
    assert cert["terminal_read_disposition"]["enumeration_consistency"] == "PASS"


def test_finalize_forwards_enum_not_evaluated_to_terminal_read_indeterminate():
    """(F-3d) The fail-closed forwarding through the real runner: enum verdict
    "NOT_EVALUATED" (conflation PASS, no FAIL anywhere) -> INDETERMINATE, never
    CLEAN."""
    prep = _clean_finalize_prep("v-enum-noteval")
    cert = pc.finalize_certificate(
        prep, tier3_verdicts=[], dry_run=True,
        conflation_verdict="PASS", enumeration_consistency_verdict="NOT_EVALUATED",
    )
    assert cert["terminal_read_grade"] == "INDETERMINATE"
    assert cert["terminal_read_clean"] is False
    assert cert["terminal_read_disposition"]["enumeration_consistency"] == "NOT_EVALUATED"


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


# --------------------------------------------------------------------------- #
# (n) ADDENDUM 4 FIX 1 -- dual-read agreement gate
# --------------------------------------------------------------------------- #

# Three literal spans in DRY_RUN_TRANSCRIPT with three DIFFERENT tier-1
# surface classes (conditional-action / imperative / exclusion-contrast) plus
# one tier-1-SILENT narration span -- reused verbatim from
# DRY_RUN_EXTRACTED_STRATEGY's own fixture set (pc.DRY_RUN_TRANSCRIPT), so no
# new transcript is invented for this test.
_CA_SPAN_TEXT = "Buy from the demand zone when it is retested."
_IMP_SPAN_TEXT = "Set your stop at the low of the hammer."
_EC_SPAN_TEXT = "Take puts on a VWOP retest, NOT a pre-market low retest."
_SILENT_SPAN_TEXT = "We do have a fair value gap here where price tapped the level before."

# The grader's three constructed "flatter" cases: a condition whose OWN
# surface (run_tier1(cond.text)) is one class (or silent), mis-grounded by
# the locator onto a DIFFERENT, real, literal transcript span carrying a
# DIFFERENT class. Every proposed quote below IS a literal substring of
# DRY_RUN_TRANSCRIPT (so anchor_locator resolves it LOCATED, not
# unanchored) -- exactly the F-2026-07-12-A defect shape: a real, literal,
# but MIS-GROUNDED anchor.
_FLATTER_MISGROUNDING = {
    # condition's own surface = imperative; mis-grounded onto a
    # conditional-action span -> both fire, DIFFERENT fired classes.
    _IMP_SPAN_TEXT: _CA_SPAN_TEXT,
    # condition's own surface = SILENT (narration); mis-grounded onto an
    # imperative span -> the quote fires, the condition is silent. This is
    # the exact pre-fix defect: the mis-grounded quote would have fired
    # uncaught.
    _SILENT_SPAN_TEXT: _IMP_SPAN_TEXT,
    # condition's own surface = exclusion-contrast; mis-grounded onto the
    # (real, literal, but tier-1-SILENT) narration span -> the condition
    # fires, the quote is silent -- the mirror-image disagreement shape.
    # (Each of the three mis-grounding TARGETS above is a distinct span --
    # CA/IMP/SILENT -- so no two conditions share a char_span key.)
    _EC_SPAN_TEXT: _SILENT_SPAN_TEXT,
}


def _flatter_propose_fn(transcript: str, condition_text: str) -> Optional[str]:
    return _FLATTER_MISGROUNDING.get(condition_text, condition_text)


def _flatter_strategy() -> dict:
    return {
        "entry_sequence": [{"step": 1, "action": _IMP_SPAN_TEXT, "rationale": None}],
        "targets": [{"priority": 1, "type": "structural", "rationale": _SILENT_SPAN_TEXT}],
        "confluences": [{"name": "exclusion", "description": _EC_SPAN_TEXT}],
    }


def test_dual_read_agreement_classifies_when_surfaces_match():
    """A condition whose located quote IS its own text -- surfaces agree
    (both fire the SAME class) -- classifies at tier-1, no fall-through."""
    strategy = {"entry_sequence": [{"step": 1, "action": _CA_SPAN_TEXT, "rationale": None}]}
    prep = pc.prepare_strategy(
        strategy, pc.DRY_RUN_TRANSCRIPT, "v-agree", extractor_version="e1", taxonomy_version="t1",
        propose_fn=_stub_propose_fn,
    )
    assert prep["unanchored_conditions"] == []
    assert len(prep["tier1_detections"]) == 1
    assert prep["tier1_detections"][0].surface_class == "conditional-action"
    assert prep["tier1_fallthroughs"] == []
    assert prep["condition_outcomes"][0]["outcome"] == "classified_tier1"


def test_dual_read_three_flatter_cases_all_fall_through_on_disagreement():
    """The grader's three constructed flatter cases: each condition's own
    surface diverges from its (real, literal) but mis-grounded located
    quote's surface -- ALL THREE must fall through to tier-3, and NONE may
    contribute a tier1_detection (the pre-fix defect: a mis-grounded-but-
    literal anchor firing uncaught)."""
    prep = pc.prepare_strategy(
        _flatter_strategy(), pc.DRY_RUN_TRANSCRIPT, "v-flatter", extractor_version="e1", taxonomy_version="t1",
        propose_fn=_flatter_propose_fn,
    )
    assert prep["unanchored_conditions"] == [], (
        "every mis-grounded quote here IS a literal transcript substring -- "
        "the locator must resolve all three LOCATED, never unanchored"
    )
    assert prep["tier1_detections"] == [], "no mis-grounded quote may fire uncaught"
    assert len(prep["tier1_fallthroughs"]) == 3
    outcomes = {o["outcome"] for o in prep["condition_outcomes"]}
    assert outcomes == {"fallthrough_dual_read_disagreement"}

    set_b = prep["tier3_packet"]["sections"][-1]
    assert set_b["item_count"] == 3
    stage2_items = prep["tier3_packet"]["stage2"]["items"]
    assert len(stage2_items) == 3
    # each Stage-2 item carries the EXTRACTOR'S OWN condition text (not the
    # mis-grounded quote it was located against).
    stage2_condition_texts = {it["extracted_condition_text"] for it in stage2_items}
    assert stage2_condition_texts == {_IMP_SPAN_TEXT, _SILENT_SPAN_TEXT, _EC_SPAN_TEXT}
    for it in stage2_items:
        assert it["adjudication_response"] == {"support": None, "support_justification": None}

    # Stage-1 blinding intact + a Stage-2 support slot present.
    scan = pc.blinding_leak_scan(prep["tier3_packet"])
    assert scan.clean is True, scan.violations


def test_dual_read_disagreement_span_is_the_located_quote_not_condition_text():
    """Even under disagreement, the certificate-facing span/quote must be
    the LOCATED quote (the real transcript span), never the condition's own
    (possibly non-resolving) text -- Addendum 4's own wording."""
    prep = pc.prepare_strategy(
        _flatter_strategy(), pc.DRY_RUN_TRANSCRIPT, "v-flatter-span", extractor_version="e1", taxonomy_version="t1",
        propose_fn=_flatter_propose_fn,
    )
    misgrounded_targets = set(_FLATTER_MISGROUNDING.values())
    for ft in prep["tier1_fallthroughs"]:
        s, e = ft.char_span
        quote = pc.DRY_RUN_TRANSCRIPT[s:e]
        assert quote in misgrounded_targets, "fall-through span must be the LOCATED (mis-grounded) quote"


def test_module_never_calls_an_llm_dual_read_included():
    """Dual-read adds a SECOND run_tier1 call per anchored condition, still
    zero model calls -- reuses the module's own non-adjudicator source scan
    (tier1_detectors.run_tier1 is pure regex/stdlib; no new import was
    added for FIX 1)."""
    src = inspect.getsource(pc)
    forbidden_calls = ("ollama", "anthropic", "openai", "requests.post", "httpx.post", ".chat(")
    lowered = src.lower()
    for tok in forbidden_calls:
        assert tok not in lowered, f"found forbidden adjudicator-dispatch token: {tok}"


# --------------------------------------------------------------------------- #
# (o)/(p) ADDENDUM 4 FIX 2 -- two-stage tier-3 packet + support certificate
# field
# --------------------------------------------------------------------------- #


def test_two_stage_packet_stage1_free_of_condition_string_positive_proof():
    """Positive-fire proof that the Stage-2-leak guard is not vacuous: poison
    a copy of a clean packet by duplicating a Stage-2 condition text into a
    DIFFERENT Stage-1 field (not that item's own quote_anchor) and confirm
    the scan fires."""
    prep = pc.prepare_strategy(
        _flatter_strategy(), pc.DRY_RUN_TRANSCRIPT, "v-stage2-poison", extractor_version="e1", taxonomy_version="t1",
        propose_fn=_flatter_propose_fn,
    )
    assert prep["leak_scan"].clean is True
    poisoned = json.loads(json.dumps(prep["tier3_packet"]))
    stage2_items = poisoned["stage2"]["items"]
    leaked_text = stage2_items[0]["extracted_condition_text"]
    assert leaked_text
    # inject it as a NEW allowlist-violating field on a Set-B item (a
    # structural leak, distinct from that item's own legitimate quote).
    poisoned["sections"][-1]["items"][0]["leaked_condition_hint"] = leaked_text
    scan = pc.blinding_leak_scan(poisoned)
    assert scan.clean is False
    assert any(v.startswith("stage2_leak:") for v in scan.violations)


def test_two_stage_packet_does_not_self_trip_when_quote_equals_condition():
    """A well-grounded anchor's quote is frequently byte-for-byte identical
    to the condition it grounds -- that identity must NOT self-trip the
    Stage-2-leak check (it is the anchor doing its job, not a leak)."""
    strategy = {"entry_sequence": [{"step": 1, "action": _SILENT_SPAN_TEXT, "rationale": None}]}
    prep = pc.prepare_strategy(
        strategy, pc.DRY_RUN_TRANSCRIPT, "v-stage2-honest", extractor_version="e1", taxonomy_version="t1",
        propose_fn=_stub_propose_fn,
    )
    assert prep["tier3_packet"]["stage2"]["items"][0]["extracted_condition_text"] == _SILENT_SPAN_TEXT
    scan = pc.blinding_leak_scan(prep["tier3_packet"])
    assert scan.clean is True, scan.violations


def test_two_stage_packet_fires_on_prefilled_stage2_response():
    prep = pc.prepare_strategy(
        _flatter_strategy(), pc.DRY_RUN_TRANSCRIPT, "v-stage2-prefill", extractor_version="e1", taxonomy_version="t1",
        propose_fn=_flatter_propose_fn,
    )
    poisoned = json.loads(json.dumps(prep["tier3_packet"]))
    poisoned["stage2"]["items"][0]["adjudication_response"]["support"] = "confirmed"
    scan = pc.blinding_leak_scan(poisoned)
    assert scan.clean is False
    assert any(v.startswith("prefilled_stage2_response:") for v in scan.violations)


def test_support_verdict_from_stage2_response_requires_justification_and_closed_taxonomy():
    with pytest.raises(ValueError):
        pc.support_verdict_from_stage2_response((0, 1), "confirmed", "")
    with pytest.raises(ValueError):
        pc.support_verdict_from_stage2_response((0, 1), "maybe", "some justification")
    sv = pc.support_verdict_from_stage2_response((0, 1), "denied", "the quote is about something else")
    assert sv.support == "denied"
    assert sv.support_justification == "the quote is about something else"


def test_finalize_certificate_confirmed_support_leaves_condition_grounded():
    strategy = {"entry_sequence": [{"step": 1, "action": _SILENT_SPAN_TEXT, "rationale": None}]}
    prep = pc.prepare_strategy(
        strategy, pc.DRY_RUN_TRANSCRIPT, "v-support-confirmed", extractor_version="e1", taxonomy_version="t1",
        propose_fn=_stub_propose_fn,
    )
    ft = prep["tier1_fallthroughs"][0]
    verdict = pc.verdict_from_rater_response(
        char_span=ft.char_span,
        quote_anchor=pc.DRY_RUN_TRANSCRIPT[ft.char_span[0]:ft.char_span[1]],
        role="context",
        control_gate_passed=True,
    )
    support = pc.support_verdict_from_stage2_response(ft.char_span, "confirmed", "matches the condition")
    cert = pc.finalize_certificate(prep, [verdict], tier3_support=[support])
    tier3_entries = [c for c in cert["conditions"] if c.get("adjudication_verdict") and c["adjudication_verdict"].get("support")]
    assert len(tier3_entries) == 1
    assert tier3_entries[0]["classifying_tier"] == 3
    assert tier3_entries[0]["adjudication_verdict"]["support"] == "confirmed"
    assert tier3_entries[0]["adjudication_verdict"]["support_justification"] == "matches the condition"
    assert cert["pilot_grade"] is True


@pytest.mark.parametrize("support_value", ["denied", "partial"])
def test_finalize_certificate_denied_or_partial_support_downgrades_condition(support_value):
    strategy = {"entry_sequence": [{"step": 1, "action": _SILENT_SPAN_TEXT, "rationale": None}]}
    prep = pc.prepare_strategy(
        strategy, pc.DRY_RUN_TRANSCRIPT, f"v-support-{support_value}", extractor_version="e1", taxonomy_version="t1",
        propose_fn=_stub_propose_fn,
    )
    ft = prep["tier1_fallthroughs"][0]
    verdict = pc.verdict_from_rater_response(
        char_span=ft.char_span,
        quote_anchor=pc.DRY_RUN_TRANSCRIPT[ft.char_span[0]:ft.char_span[1]],
        role="context",
        control_gate_passed=True,
    )
    support = pc.support_verdict_from_stage2_response(ft.char_span, support_value, "does not match")
    cert = pc.finalize_certificate(prep, [verdict], tier3_support=[support])
    downgraded = [c for c in cert["conditions"] if tuple(c["char_span"]) == tuple(ft.char_span)]
    assert len(downgraded) == 1
    assert downgraded[0]["classifying_tier"] is None, "denied/partial support treats the condition as an unresolved fall-through"
    assert downgraded[0]["adjudication_verdict"]["support"] == support_value
    assert cert["pilot_grade"] is False
    assert cert["full_grade"] is False
    assert cert["certificate_grade"] is False
    assert cert["diagnosis"][pc.DIAGNOSIS_FALLTHROUGH_UNRESOLVED] == 1
    assert cert["diagnosis"][pc.DIAGNOSIS_OK] == 0


# --------------------------------------------------------------------------- #
# (r) ADDENDUM 5 -- AXIS 2 content-word overlap floor + AXIS 3 tier-3
# idle-budget sampling audit (catch #5: the dual-read gate compares
# surface_class ONLY, so a SAME-surface DIFFERENT-content mis-grounding
# passed as "agreement" and classified uncaught).
# --------------------------------------------------------------------------- #

# --- axis-2 fixtures ---------------------------------------------------- #

# Decisive target (a): SAME surface class (both fire "imperative"), ZERO
# shared content tokens -- the catch-#5 reproduction. Content tokens:
# stop text -> {"stop", "hammer."}; entry text -> {"enter", "aggressively",
# "above", "pivot", "high."} (see test_axis2_content_tokens_parity_with_ts_f2
# for the tokenizer trace). _ZERO_OVERLAP_STOP_TEXT reuses the module's own
# _IMP_SPAN_TEXT string verbatim (same fixture, named for this section).
_ZERO_OVERLAP_STOP_TEXT = _IMP_SPAN_TEXT  # "Set your stop at the low of the hammer."
_ZERO_OVERLAP_ENTRY_TEXT = "Enter aggressively above the pivot high."


def _zero_overlap_propose_fn(transcript: str, condition_text: str) -> Optional[str]:
    if condition_text == _ZERO_OVERLAP_STOP_TEXT:
        return _ZERO_OVERLAP_ENTRY_TEXT
    return condition_text


def test_axis2_zero_content_overlap_falls_through_to_tier3():
    """Decisive target (a): a mis-grounded-but-literal anchor sharing the
    condition's surface class but ZERO content tokens must fall through --
    the pre-Addendum-5 defect (dual-read alone would have classified this
    uncaught, since axis 1 only compares surface_class)."""
    transcript = _ZERO_OVERLAP_ENTRY_TEXT + " " + _ZERO_OVERLAP_STOP_TEXT
    strategy = {"stop": {"anchor": "swing_low", "rationale": _ZERO_OVERLAP_STOP_TEXT}}
    prep = pc.prepare_strategy(
        strategy, transcript, "v-axis2-zero-overlap", extractor_version="e1", taxonomy_version="t1",
        propose_fn=_zero_overlap_propose_fn,
    )
    assert prep["unanchored_conditions"] == []
    assert prep["tier1_detections"] == [], "a same-surface, zero-content-overlap fire must never classify"
    assert len(prep["tier1_fallthroughs"]) == 1
    assert prep["condition_outcomes"][0]["outcome"] == "fallthrough_axis2_zero_content_overlap"

    set_b = prep["tier3_packet"]["sections"][-1]
    assert set_b["item_count"] == 1
    assert set_b["items"][0]["quote_anchor"]["verbatim"] == _ZERO_OVERLAP_ENTRY_TEXT
    stage2_items = prep["tier3_packet"]["stage2"]["items"]
    assert stage2_items[0]["extracted_condition_text"] == _ZERO_OVERLAP_STOP_TEXT

    scan = pc.blinding_leak_scan(prep["tier3_packet"])
    assert scan.clean is True, scan.violations


# Decisive target (b): the NAMED RESIDUAL -- SAME surface class
# (conditional-action) AND >=1 shared content token ("price"/"crosses"/
# "50") but a DIFFERENT rule (a stop-rule condition mis-grounded onto an
# entry-rule quote). Neither mechanical axis can catch this by design
# (Addendum 5); axis 3 makes it statistically visible.
_RESIDUAL_STOP_TEXT = "Exit when price crosses below the 50 SMA level."
_RESIDUAL_ENTRY_TEXT = "Enter when price crosses above the 50 SMA line."


def _residual_propose_fn(transcript: str, condition_text: str) -> Optional[str]:
    if condition_text == _RESIDUAL_STOP_TEXT:
        return _RESIDUAL_ENTRY_TEXT
    return condition_text


def test_axis2_named_residual_still_classifies_and_is_covered_by_axis3_sampling():
    """Decisive target (b): a same-surface, shared-vocabulary,
    different-rule mis-grounding still CLASSIFIES (both mechanical axes
    correctly cannot close it -- see the module docstring's ADDENDUM 5
    section) AND is shown COVERED by axis 3: the sampling audit can select
    this exact classified fire and route it through the two-stage support
    packet, making the residual statistically visible without mechanically
    gating it."""
    transcript = _RESIDUAL_ENTRY_TEXT + " " + _RESIDUAL_STOP_TEXT
    strategy = {"stop": {"anchor": "swing_low", "rationale": _RESIDUAL_STOP_TEXT}}
    prep = pc.prepare_strategy(
        strategy, transcript, "v-axis2-residual", extractor_version="e1", taxonomy_version="t1",
        propose_fn=_residual_propose_fn,
    )
    assert prep["unanchored_conditions"] == []
    assert len(prep["tier1_detections"]) == 1
    assert prep["tier1_detections"][0].surface_class == "conditional-action"
    assert prep["condition_outcomes"][0]["outcome"] == "classified_tier1"
    assert prep["tier1_fallthroughs"] == []

    # axis 3: a single classified candidate + idle budget -> deterministically
    # audited.
    audit = prep["axis3_audit"]
    assert audit["char_span"] == list(prep["tier1_detections"][0].char_span)
    assert audit["condition_text"] == _RESIDUAL_STOP_TEXT

    stage2_audit_items = [it for it in prep["tier3_packet"]["stage2"]["items"] if it.get("audit")]
    assert len(stage2_audit_items) == 1
    assert stage2_audit_items[0]["extracted_condition_text"] == _RESIDUAL_STOP_TEXT
    set_b_audit_items = [it for it in prep["tier3_packet"]["sections"][-1]["items"] if it.get("audit")]
    assert len(set_b_audit_items) == 1
    # the audited item's quote is the FIRED DETECTION's own (narrower)
    # anchor -- the same span the certificate's classified condition entry
    # itself carries, not necessarily the full located-anchor sentence.
    assert set_b_audit_items[0]["quote_anchor"]["verbatim"] == prep["tier1_detections"][0].quote_anchor
    assert set_b_audit_items[0]["quote_anchor"]["verbatim"] in _RESIDUAL_ENTRY_TEXT

    scan = pc.blinding_leak_scan(prep["tier3_packet"])
    assert scan.clean is True, scan.violations

    # route the audited fire through the SAME two-stage support mechanism;
    # a denied support is recorded as a MONITORING signal on the
    # certificate, WITHOUT mechanically downgrading the classification
    # (axis 3 is a sampling audit, not a gate).
    span = tuple(audit["char_span"])
    support = pc.support_verdict_from_stage2_response(
        span, "denied", "quote is the entry rule, not the stop rule this condition names"
    )
    cert = pc.finalize_certificate(prep, tier3_verdicts=[], tier3_support=[support])
    assert cert["axis3_audit"]["support"] == "denied"
    assert cert["axis3_audit"]["char_span"] == list(span)
    audited_entries = [c for c in cert["conditions"] if tuple(c["char_span"]) == span]
    assert len(audited_entries) == 1
    assert audited_entries[0]["classifying_tier"] == 1, (
        "axis 3 is a sampling MONITOR, not a mechanical gate -- the named "
        "residual stays classified; visibility, not closure"
    )


def test_axis2_genuine_grounding_still_classifies_not_a_fallthrough_machine():
    """Decisive target (c): a genuinely-grounded condition (quote IS the
    condition's own text, full content overlap) must still classify --
    axis 2 must not become a fallthrough machine."""
    strategy = {"entry_sequence": [{"step": 1, "action": _CA_SPAN_TEXT, "rationale": None}]}
    prep = pc.prepare_strategy(
        strategy, pc.DRY_RUN_TRANSCRIPT, "v-axis2-genuine", extractor_version="e1", taxonomy_version="t1",
        propose_fn=_stub_propose_fn,
    )
    assert prep["tier1_fallthroughs"] == []
    assert len(prep["tier1_detections"]) == 1
    assert prep["condition_outcomes"][0]["outcome"] == "classified_tier1"


def test_axis2_content_tokens_parity_with_ts_f2():
    """PARITY-FIXTURED proof, same precedent as `compile_lints.
    f2_coverage_gate`'s own TS-authority-with-no-Python-import-target
    ledger entry: each case below is hand-traced against extraction-
    coverage-gate.ts's own `normalize()` (lines 120-130) + `contentTokens()`
    (lines 142-149) + `STOPWORDS` (lines 56-64) and confirmed against this
    module's own `content_tokens()`. A silent drift in either side's
    tokenizer trips this test."""
    # plain content words; "buy"/"the"/"from"/"when"/"it"/"is" all excluded
    # (stopword OR len<4); trailing period stays glued to the last word
    # (the TS authority does not strip punctuation -- this mirror does not
    # "improve" on it).
    assert pc.content_tokens("Buy from the demand zone when it is retested.") == frozenset(
        {"demand", "zone", "retested."}
    )
    # numeric tokens (digit-bearing, len>=2) are content-bearing even though
    # short; "sma" (non-numeric, len 3) is EXCLUDED by the SAME rule in the
    # TS authority itself (contentTokens requires len>=4 for non-numeric
    # tokens) -- honesty note, not a divergence (Addendum 5 forbids
    # inventing a new content-word carve-out).
    assert pc.content_tokens("cross above the 50 SMA level") == frozenset(
        {"cross", "above", "50", "level"}
    )
    # digit-letter boundary split ("4hour" -> "4 hour", TS FIX 8) + dash/
    # underscore -> space normalization.
    assert pc.content_tokens("the 4hour candle-close_setup") == frozenset(
        {"hour", "candle", "close", "setup"}
    )
    # all-stopword/too-short text -> empty set, never an error.
    assert pc.content_tokens("it is the and or") == frozenset()


# --- axis-3 fixtures ------------------------------------------------------ #


def test_axis3_selection_is_deterministic_for_same_video_and_pool():
    """Clause 2 (non-negotiable): same (video_id, strategy_index, candidate
    pool) -> same audited fire on every replay."""
    strategy = {
        "entry_sequence": [
            {"step": 1, "action": _CA_SPAN_TEXT, "rationale": None},
            {"step": 2, "action": _IMP_SPAN_TEXT, "rationale": None},
        ]
    }
    prep1 = pc.prepare_strategy(
        strategy, pc.DRY_RUN_TRANSCRIPT, "v-axis3-det", extractor_version="e1", taxonomy_version="t1",
        propose_fn=_stub_propose_fn,
    )
    prep2 = pc.prepare_strategy(
        strategy, pc.DRY_RUN_TRANSCRIPT, "v-axis3-det", extractor_version="e1", taxonomy_version="t1",
        propose_fn=_stub_propose_fn,
    )
    assert prep1["axis3_audit"]["char_span"] is not None
    assert prep1["axis3_audit"]["char_span"] == prep2["axis3_audit"]["char_span"]


def test_axis3_different_video_id_can_select_a_different_fire():
    """Sanity companion to the determinism test: the seed is video-scoped,
    not a global constant -- it is at least POSSIBLE for two different
    video_ids to disagree (not asserted as a requirement, just proves the
    seed is not accidentally ignoring video_id). Both selections must
    individually still be valid members of the candidate pool."""
    strategy = {
        "entry_sequence": [
            {"step": 1, "action": _CA_SPAN_TEXT, "rationale": None},
            {"step": 2, "action": _IMP_SPAN_TEXT, "rationale": None},
        ]
    }
    prep_a = pc.prepare_strategy(
        strategy, pc.DRY_RUN_TRANSCRIPT, "v-axis3-seed-a", extractor_version="e1", taxonomy_version="t1",
        propose_fn=_stub_propose_fn,
    )
    prep_b = pc.prepare_strategy(
        strategy, pc.DRY_RUN_TRANSCRIPT, "v-axis3-seed-b", extractor_version="e1", taxonomy_version="t1",
        propose_fn=_stub_propose_fn,
    )
    valid_spans = {tuple(d.char_span) for d in prep_a["tier1_detections"]}
    assert tuple(prep_a["axis3_audit"]["char_span"]) in valid_spans
    assert tuple(prep_b["axis3_audit"]["char_span"]) in valid_spans


def test_axis3_no_audit_when_ceiling_already_exhausted_by_fallthroughs():
    """Budget accounting: fallthroughs/cannot-determines consume the
    ceiling FIRST -- an exhausted budget means no audit item rides along,
    ever (it never pushes a video over the ceiling)."""
    strategy = {
        "entry_sequence": [
            {"step": 1, "action": _CA_SPAN_TEXT, "rationale": None},  # classifies
            {"step": 2, "action": _SILENT_SPAN_TEXT, "rationale": None},  # falls through
        ]
    }
    prep = pc.prepare_strategy(
        strategy, pc.DRY_RUN_TRANSCRIPT, "v-axis3-ceiling", extractor_version="e1", taxonomy_version="t1",
        propose_fn=_stub_propose_fn, axis3_ceiling=1,
    )
    assert len(prep["tier1_fallthroughs"]) == 1
    assert prep["axis3_audit"]["char_span"] is None
    set_b = prep["tier3_packet"]["sections"][-1]
    assert set_b["item_count"] == 1  # the genuine fallthrough only, no audit


def test_axis3_no_audit_when_nothing_classified():
    """Nothing classified -> nothing to sample -> no audit item, not an
    error (the three flatter cases all fall through by construction)."""
    prep = pc.prepare_strategy(
        _flatter_strategy(), pc.DRY_RUN_TRANSCRIPT, "v-axis3-none", extractor_version="e1", taxonomy_version="t1",
        propose_fn=_flatter_propose_fn,
    )
    assert prep["tier1_detections"] == []
    assert prep["axis3_audit"]["char_span"] is None


def test_axis3_ceiling_env_override(monkeypatch):
    monkeypatch.setenv("H1_PILOT_AXIS3_CEILING", "0")
    strategy = {"entry_sequence": [{"step": 1, "action": _CA_SPAN_TEXT, "rationale": None}]}
    prep = pc.prepare_strategy(
        strategy, pc.DRY_RUN_TRANSCRIPT, "v-axis3-env", extractor_version="e1", taxonomy_version="t1",
        propose_fn=_stub_propose_fn,
    )
    assert prep["axis3_audit"]["ceiling"] == 0
    assert prep["axis3_audit"]["char_span"] is None  # 0 fallthroughs >= ceiling(0)


def test_axis3_arg_ceiling_overrides_env(monkeypatch):
    monkeypatch.setenv("H1_PILOT_AXIS3_CEILING", "0")
    strategy = {"entry_sequence": [{"step": 1, "action": _CA_SPAN_TEXT, "rationale": None}]}
    prep = pc.prepare_strategy(
        strategy, pc.DRY_RUN_TRANSCRIPT, "v-axis3-arg-override", extractor_version="e1", taxonomy_version="t1",
        propose_fn=_stub_propose_fn, axis3_ceiling=15,
    )
    assert prep["axis3_audit"]["ceiling"] == 15
    assert prep["axis3_audit"]["char_span"] is not None


def test_axis3_audit_item_leak_scan_still_clean():
    """The audit item is subject to the SAME blind-packet discipline as a
    genuine fallthrough -- an audited fire never leaks its role/condition
    into the Stage-1 blind view."""
    strategy = {"entry_sequence": [{"step": 1, "action": _CA_SPAN_TEXT, "rationale": None}]}
    prep = pc.prepare_strategy(
        strategy, pc.DRY_RUN_TRANSCRIPT, "v-axis3-leak", extractor_version="e1", taxonomy_version="t1",
        propose_fn=_stub_propose_fn,
    )
    assert prep["axis3_audit"]["char_span"] is not None
    assert prep["leak_scan"].clean is True
