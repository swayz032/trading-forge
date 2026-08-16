"""AR-1226 §6 LANE L1 item 3 — duplicate-span collision diagnostic.

Controls required by the ruling:
  item 5 (negative) — the real char-19546 entry+stop+target cluster must NEVER silently pass;
  item 4 (positive) — a legitimate pair of related fields sharing evidence must NOT be
                      automatically condemned.
"""
from __future__ import annotations

import json
import pathlib

from src.engine.extraction.span_collision import (
    STATUS_ACCEPTED,
    STATUS_ACCEPTED_PENDING_REVIEW,
    STATUS_REFUSED_PENDING_ADJUDICATION,
    adjudicate_locations,
    detect_span_collisions,
    role_of,
    summarise,
)

PHASE1 = (
    pathlib.Path(__file__).resolve().parents[3]
    / "docs" / "replay-results" / "svkm-extraction-certified" / "grade" / "phase1.json"
)


def _real_locations() -> dict:
    """The ACTUAL anchored spans from the committed golden-slice grade artifact."""
    data = json.loads(PHASE1.read_text(encoding="utf-8"))
    out = {}
    for o in data["strategies"][0]["condition_outcomes"]:
        span = o.get("char_span")
        if span:
            out[o["condition_ref"]] = tuple(span)
    return out


def test_the_real_golden_slice_cluster_is_flagged_HIGH():
    """🛑 THE NEGATIVE CONTROL (item 5). Six conditions across entry_sequence, stop and
    targets share char 19546. This must be a HIGH cross-role finding, not a silent pass."""
    collisions = detect_span_collisions(_real_locations())
    assert collisions, "the known mis-grounding cluster was not detected at all"
    high = [c for c in collisions if c.severity == "HIGH"]
    assert high, f"the cross-role cluster was not rated HIGH: {collisions}"

    biggest = high[0]
    assert len(biggest.condition_refs) >= 5, biggest.condition_refs
    assert {"entry_sequence", "stop", "targets"} <= set(biggest.roles), biggest.roles
    assert biggest.span[0] == 19546, biggest.span


def test_related_fields_sharing_evidence_are_not_condemned():
    """THE POSITIVE CONTROL (item 4). Two fields of the SAME step sharing a quote is normal.
    It is surfaced for adjudication as REVIEW — never HIGH, never auto-refused."""
    collisions = detect_span_collisions({
        "entry_sequence[0].action": (100, 200),
        "entry_sequence[0].rationale": (100, 200),
    })
    assert len(collisions) == 1
    assert collisions[0].severity == "REVIEW", collisions[0]
    assert collisions[0].roles == ("entry_sequence",)


def test_distinct_spans_produce_no_collision():
    """The discriminator: a clean location set must come back empty, or the check would
    condemn everything and mean nothing."""
    assert detect_span_collisions({
        "entry_sequence[0].action": (100, 200),
        "stop.rationale": (900, 1000),
        "targets[0].rationale": (2000, 2100),
    }) == []


def test_substantial_overlap_cannot_be_evaded_by_trimming():
    """A reused span trimmed by a few characters is still the same evidence."""
    collisions = detect_span_collisions({
        "entry_sequence[0].action": (1000, 1200),
        "stop.rationale": (1005, 1195),
    })
    assert len(collisions) == 1
    assert collisions[0].severity == "HIGH"


def test_role_extraction():
    assert role_of("entry_sequence[2].action") == "entry_sequence"
    assert role_of("stop.rationale") == "stop"
    assert role_of("targets[0].rationale") == "targets"


def test_summary_counts():
    s = summarise(detect_span_collisions(_real_locations()))
    assert s["collisions"] >= 1 and s["high"] >= 1


# --------------------------------------------------------------------------- #
# ACCEPTANCE GATE — AR-1226 §6.3 "before accepting a location set"
# --------------------------------------------------------------------------- #


def test_acceptance_refuses_the_real_cross_role_cluster():
    """🛑 THE NEGATIVE CONTROL AT THE ACCEPTANCE LAYER (item 5). Detecting the cluster is not
    enough — §6.5 says it must never PASS as independently grounded conditions. Every member
    of the real cross-role group must come back refused."""
    verdicts, collisions = adjudicate_locations(_real_locations())
    high = [c for c in collisions if c.severity == "HIGH"]
    assert high, "no cross-role collision found; the acceptance control is vacuous"

    for ref in high[0].condition_refs:
        assert verdicts[ref]["status"] == STATUS_REFUSED_PENDING_ADJUDICATION, (ref, verdicts[ref])
        assert verdicts[ref]["collides_with"], ref

    refused = [r for r, v in verdicts.items() if v["status"] == STATUS_REFUSED_PENDING_ADJUDICATION]
    assert len(refused) >= 5, refused
    assert {"entry_sequence", "stop", "targets"} <= {role_of(r) for r in refused}


def test_acceptance_does_not_refuse_same_role_reuse():
    """THE POSITIVE CONTROL AT THE ACCEPTANCE LAYER (item 4). Same-role reuse is flagged for
    adjudication and KEPT. A gate that refuses this would condemn legitimate evidence."""
    verdicts, _ = adjudicate_locations({
        "entry_sequence[0].action": (100, 200),
        "entry_sequence[0].rationale": (100, 200),
    })
    for ref, v in verdicts.items():
        assert v["status"] == STATUS_ACCEPTED_PENDING_REVIEW, (ref, v)
        assert v["status"] != STATUS_REFUSED_PENDING_ADJUDICATION


def test_acceptance_passes_a_clean_set_untouched():
    """THE DISCRIMINATOR. If a clean set did not come back fully ACCEPTED, the gate would be
    refusing on something other than reuse and every refusal above would be meaningless."""
    verdicts, collisions = adjudicate_locations({
        "entry_sequence[0].action": (100, 200),
        "stop.rationale": (900, 1000),
        "targets[0].rationale": (2000, 2100),
    })
    assert collisions == []
    assert {v["status"] for v in verdicts.values()} == {STATUS_ACCEPTED}
    assert all(v["collides_with"] == [] for v in verdicts.values())


def test_acceptance_ignores_unlocated_conditions():
    """A condition with no span has nothing to collide with and must not appear as either an
    acceptance or a refusal — otherwise an UNANCHORED condition would silently acquire a
    verdict about evidence it never had."""
    verdicts, _ = adjudicate_locations({
        "entry_sequence[0].action": (100, 200),
        "confluences[0].description": None,
        "confluences[1].description": (),
    })
    assert set(verdicts) == {"entry_sequence[0].action"}


def test_acceptance_is_not_a_correctness_claim_a_solitary_misgrounding_passes():
    """🛑 THE KNOWN LIMITATION, PINNED SO NOBODY READS `ACCEPTED` AS `VERIFIED`.

    This gate detects REUSE. It is structurally blind to a condition anchored to a wrong-but-
    unique span — nothing collides, so nothing fires. Measured in the AR-1226 §6.1 re-issue:
    one condition was ACCEPTED while its span sat inside the very disclaimer region already
    ruled invalid, purely because no sibling shared it.

    If this test ever fails, the module has grown a relevance judgment it is not authorized to
    make (AR-1226 §3/§4: relevance stays advisory and its terminology layer needs taxonomy
    ownership) — that is a ruling, not a refactor.
    """
    verdicts, collisions = adjudicate_locations({
        "confluences[0].description": (19845, 19997),   # unique span, wrong content
        "entry_sequence[0].action": (100, 200),
    })
    assert collisions == []
    assert verdicts["confluences[0].description"]["status"] == STATUS_ACCEPTED


def test_module_contains_no_source_specific_strings():
    import inspect

    from src.engine.extraction import span_collision as m

    src = inspect.getsource(m).lower()
    for banned in ("svkm", "fair value", "nasdaq", "fvg", "19546"):
        assert banned not in src, f"module hardcodes source-specific string: {banned!r}"
