"""A-packet verification harness (NOT a test module -- underscore-prefixed so
pytest does not collect it; imported by test_topology_producer.py AND the
all-22 script docs/replay-results/h1-scripts/claude-rung-v32/run_a_packet_22.py).

Turns a raw extracted-strategy dict (staging_v32 shape) into the
`(transcript, tier1_detections, condition_entries)` triple the A-packet's
`produce_topology` + `assemble_certificate` consume, then assembles a real
certificate through the UNMODIFIED assembler.

Transcript synthesis: each present condition's verbatim text is concatenated,
separated by blank lines, so every emitted `char_span` resolves to its
`quote_anchor` verbatim AND sits on clean token boundaries
(f2_coverage_gate PASS). `condition_id == f"t1-{i}"` matches the assembler's own
synthetic id for `tier1_detections[i]`, so `or_branches` ids line up.

This harness builds the CALLER side of the seam (the part the packet leaves to
the caller); it imports the certified reader read-only and never modifies it.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from src.engine.extraction.cert_assembler import assemble_certificate
from src.engine.extraction.tier1_detectors import Tier1Detection
from src.engine.extraction.topology_producer import ConditionEntry, produce_topology

_SEP = "\n\n"  # non-word separator -> every synthesized span is token-bounded


def condition_specs_from_strategy(strategy: dict) -> List[Dict[str, Any]]:
    """Ordered spec dicts pulled from entry_sequence / confluences / stop /
    targets (packet §3 enumeration -- preconditions are NOT spine conditions,
    consistent with pilot_conveyor.SPINE_CONDITION_FIELDS). An absent/empty
    field contributes nothing (null design -- never a fabricated condition).

    Each spec honors an OPTIONAL per-condition `direction` / `or_group` /
    `is_disabled_sentinel` marker if the extraction carries one (real
    staging_v32 conditions do not; adversarial fixtures do) -- exactly the
    packet's "+ per-condition direction when the condition itself is
    directional" and "OR-alternatives the extraction marks as
    mutually-substitutable"."""
    specs: List[Dict[str, Any]] = []

    def _add(field_kind: str, obj: dict, *text_keys: str) -> None:
        text = ""
        for k in text_keys:
            v = obj.get(k)
            if isinstance(v, str) and v.strip():
                text = v.strip()
                break
        if not text:
            return
        specs.append(
            {
                "field_kind": field_kind,
                "text": text,
                "direction": obj.get("direction"),
                "or_group": obj.get("or_group"),
                "is_disabled_sentinel": bool(obj.get("is_disabled_sentinel", False)),
            }
        )

    for step in strategy.get("entry_sequence") or []:
        if isinstance(step, dict):
            _add("entry_sequence", step, "action", "rationale")
    for c in strategy.get("confluences") or []:
        if isinstance(c, dict):
            _add("confluence", c, "description", "rationale")
    stop = strategy.get("stop")
    if isinstance(stop, dict):
        _add("stop", stop, "description", "rationale", "stop_management")
    for t in strategy.get("targets") or []:
        if isinstance(t, dict):
            _add("target", t, "description", "rationale")
    return specs


def build_inputs(
    strategy: dict,
) -> Tuple[str, List[Tier1Detection], List[ConditionEntry]]:
    """(transcript, tier1_detections, condition_entries) for one strategy.
    `condition_entries[i].condition_id == f"t1-{i}" == ` the assembler's id for
    `tier1_detections[i]`, and their char_spans are identical, so the topology
    overlay and or_branches join correctly onto the assembled spine."""
    specs = condition_specs_from_strategy(strategy)

    parts: List[str] = []
    spans: List[Tuple[int, int]] = []
    cursor = 0
    for spec in specs:
        text = spec["text"]
        start = cursor
        end = start + len(text)
        spans.append((start, end))
        parts.append(text)
        cursor = end + len(_SEP)
    transcript = _SEP.join(parts)

    tier1: List[Tier1Detection] = []
    entries: List[ConditionEntry] = []
    for i, (spec, span) in enumerate(zip(specs, spans)):
        tier1.append(
            Tier1Detection(surface_class="imperative", quote_anchor=spec["text"], char_span=span)
        )
        entries.append(
            ConditionEntry(
                condition_id=f"t1-{i}",
                char_span=span,
                field_kind=spec["field_kind"],
                text=spec["text"],
                direction=spec["direction"],
                or_group=spec["or_group"],
                is_disabled_sentinel=spec["is_disabled_sentinel"],
            )
        )
    return transcript, tier1, entries


def certificate_for_strategy(
    strategy: dict,
    *,
    source_video_id: str = "vid-test",
    full_transcript_sha256: str = "sha-test",
    extractor_version: str = "gpt-5.4:designpool-v32",
    taxonomy_version: str = "taxonomy-v2",
    scope_line: Optional[str] = None,
) -> dict:
    """Run produce_topology + the UNMODIFIED assemble_certificate on one
    strategy dict, returning the full certificate. This is the single seam the
    fixtures, the invariant test, and the all-22 script all go through."""
    transcript, tier1, entries = build_inputs(strategy)
    topology, or_branches = produce_topology(strategy, entries)
    return assemble_certificate(
        full_transcript=transcript,
        full_transcript_sha256=full_transcript_sha256,
        source_video_id=source_video_id,
        extractor_version=extractor_version,
        taxonomy_version=taxonomy_version,
        tier1_detections=tier1,
        tier1_fallthroughs=[],
        topology=list(topology.values()),
        or_branches=or_branches,
        scope_line=scope_line,
    )
