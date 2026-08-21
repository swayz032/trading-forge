"""STABLE, SOURCE-AGNOSTIC LOADER for a versioned source-graph-projection spec — AR-1323A F54.

WHY THIS FILE EXISTS

    AR-1323A F54 found that every fixture-specific adjudication for the source-graph certification
    projection (condition text overrides, the correction ledger, raw-output resolution, preserved-
    metadata records, the dependency graph) lived as Python state INSIDE a temporary driver script
    (`scripts/ar1322a_source_graph_projection_v2_driver_tmp.py`). There was no committed versioned
    DATA artifact from which the receipt could be regenerated without reading that script.

    This module is the fix's OTHER half from the versioned JSON spec artifact itself
    (`docs/replay-results/svkm-extraction-certified/grade/opus-v2/source_graph_projection_v2_1_spec.json`
    for the sVkm candidate): a GENERIC loader that turns any spec conforming to this shape into the
    exact keyword arguments `source_graph_projection.run_projection()` needs, and verifies the
    spec's declared pins against the caller-supplied transcript and extraction record.

    Contains NO strategy, instrument, video, or teacher-specific text — every fixture value is
    supplied by the spec file the caller passes in, the same discipline
    `source_graph_projection.py` itself is already asserted under
    (`test_module_contains_no_source_specific_strings`).

WHAT IT DOES NOT DO

    It does not itself run the projection, does not itself decide certification, and does not
    itself run pytest or any other proof surface. Those are the stable certification runner's job
    (AR-1323A F59/F60) — this module's only contract is: JSON in, `run_projection()` kwargs out,
    with the caller-verifiable pin check.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

from .source_graph_projection import (
    AliasSpec,
    ExternalDependencySpec,
    GraphEdge,
    ProjectionSpec,
)


class SpecPinMismatchError(ValueError):
    """Raised when a loaded spec's declared pins do not match the transcript/extraction record
    the caller actually has in hand."""


class SpecShapeError(ValueError):
    """Raised when a spec JSON is missing a required top-level key or that key is malformed —
    a shape defect, distinguished from a PIN mismatch (correct shape, wrong content) so a reader
    of the error can tell which class of defect it is looking at."""


_REQUIRED_TOP_LEVEL_KEYS = (
    "spec_version", "pins", "conditions", "raw_output_by_ref", "canonical_refs",
    "alias_specs", "preserved_metadata_refs", "preserved_metadata_records",
    "correction_ledger", "graph_edges", "graph_roots", "allowed_edge_types",
)


def _sha256(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def load_spec_json(spec_path: str) -> dict[str, Any]:
    with open(spec_path, encoding="utf-8") as f:
        spec = json.load(f)
    missing = [k for k in _REQUIRED_TOP_LEVEL_KEYS if k not in spec]
    if missing:
        raise SpecShapeError(
            f"SPEC_SHAPE_INCOMPLETE: {spec_path!r} is missing required top-level key(s) {missing}"
        )
    pins = spec["pins"]
    for k in ("transcript_sha256", "extraction_sha256"):
        if not str(pins.get(k) or "").strip():
            raise SpecShapeError(f"SPEC_SHAPE_INCOMPLETE: pins.{k} is missing or empty")
    return spec


def verify_spec_pins(spec: dict[str, Any], transcript: str, extraction_record: dict) -> None:
    """Verify the spec's declared pins against what the caller actually loaded — never trust the
    spec's own claim about what it was built against. Mirrors the discipline
    `svkm_locator_benchmark.py::_load_pinned()` already enforces for the raw corpus files."""
    declared_transcript_sha = spec["pins"]["transcript_sha256"]
    computed_transcript_sha = _sha256(transcript)
    if declared_transcript_sha != computed_transcript_sha:
        raise SpecPinMismatchError(
            "SPEC_TRANSCRIPT_PIN_MISMATCH: spec declares transcript_sha256 "
            f"{declared_transcript_sha!r}, but the transcript in hand hashes to "
            f"{computed_transcript_sha!r}"
        )
    declared_extraction_sha = spec["pins"]["extraction_sha256"]
    actual_extraction_sha = extraction_record.get("extraction_sha256")
    if declared_extraction_sha != actual_extraction_sha:
        raise SpecPinMismatchError(
            "SPEC_EXTRACTION_PIN_MISMATCH: spec declares extraction_sha256 "
            f"{declared_extraction_sha!r}, but the loaded extraction record's own "
            f"extraction_sha256 is {actual_extraction_sha!r}"
        )


@dataclass(frozen=True)
class ProjectionRunInputs:
    """Everything `source_graph_projection.run_projection()` needs, pre-built from a spec."""

    transcript: str
    conditions: tuple[dict, ...]
    batch_answers: tuple[dict, ...]
    projection: ProjectionSpec
    composition_specs: tuple[dict, ...]
    extra_evidence_by_ref: dict[str, tuple[dict, ...]]
    transcript_sha256: str
    extraction_sha256: str
    allowed_edge_types: tuple[str, ...]

    def run_kwargs(self) -> dict[str, Any]:
        return {
            "transcript": self.transcript,
            "conditions": list(self.conditions),
            "batch_answers": list(self.batch_answers),
            "projection": self.projection,
            "composition_specs": list(self.composition_specs) or None,
            "extra_evidence_by_ref": {k: list(v) for k, v in self.extra_evidence_by_ref.items()} or None,
            "transcript_sha256": self.transcript_sha256,
            "extraction_sha256": self.extraction_sha256,
            "allowed_edge_types": list(self.allowed_edge_types),
            "strict_preserved_metadata_schema": True,
        }


def build_projection_run_inputs(
    spec: dict[str, Any], transcript: str, verify_pins: bool = True,
    extraction_record: dict | None = None,
) -> ProjectionRunInputs:
    """Translate a loaded spec dict into `ProjectionRunInputs`. `verify_pins=True` (default)
    requires `extraction_record` and verifies both pins before building anything; a caller that
    has already verified pins elsewhere may pass `verify_pins=False` to skip the redundant check
    (the transcript pin is re-verified again anyway inside `run_projection()` regardless — this
    flag only controls the extraction-pin check and the doubled transcript check here)."""
    if verify_pins:
        if extraction_record is None:
            raise SpecShapeError("verify_pins=True requires extraction_record")
        verify_spec_pins(spec, transcript, extraction_record)

    conditions = tuple(
        {"condition_ref": c["condition_ref"], "condition_text": c["condition_text"]}
        for c in spec["conditions"]
    )
    batch_answers = tuple(
        {"condition_ref": ref, "raw_output": raw}
        for ref, raw in spec["raw_output_by_ref"].items()
    )
    alias_specs = tuple(
        AliasSpec(
            alias_ref=a["alias_ref"], canonical_ref=a["canonical_ref"], authority=a["authority"],
        )
        for a in spec["alias_specs"]
    )
    graph_edges = tuple(
        GraphEdge(from_ref=e["from"], to_ref=e["to"], edge_type=e["type"])
        for e in spec["graph_edges"]
    )
    # AR-1395 F-8: the loader never passed `external_dependencies`, so NO PRODUCTION CALLER COULD
    # DECLARE ONE -- the typed dependency was reachable only from tests that construct
    # `ProjectionSpec` by hand. EXISTENCE IS NOT WIRING: the feature and every fail-closed guard
    # behind it were, from the production path, unreachable code. Optional key on the same
    # `.get()`-with-default discipline `composition_specs` and `extra_evidence_by_ref` already use,
    # so specs that declare none keep loading byte-identically.
    external_dependencies = tuple(
        ExternalDependencySpec(
            dependency_id=d["dependency_id"],
            consumer_refs=tuple(d["consumer_refs"]),
            kind=d["kind"],
            provider=d["provider"],
            artifact=d["artifact"],
            platform=d["platform"],
            display_chart_timeframe=d["display_chart_timeframe"],
            decision_timeframe=d["decision_timeframe"],
            configuration=dict(d.get("configuration") or {}),
            output_contract=dict(d["output_contract"]),
            semantic_status=d["semantic_status"],
            access_status=d["access_status"],
            live_delivery=d["live_delivery"],
            historical_replay=d["historical_replay"],
            update_policy=d["update_policy"],
            implementation_status=d["implementation_status"],
            expected_contract_sha256=d.get("expected_contract_sha256"),
        )
        for d in (spec.get("external_dependencies") or ())
    )
    projection = ProjectionSpec(
        canonical_refs=tuple(spec["canonical_refs"]),
        alias_specs=alias_specs,
        preserved_metadata_refs=tuple(spec["preserved_metadata_refs"]),
        preserved_metadata_records=dict(spec["preserved_metadata_records"]),
        correction_ledger=dict(spec["correction_ledger"]),
        graph_edges=graph_edges,
        graph_roots=tuple(spec["graph_roots"]),
        external_dependencies=external_dependencies,
    )
    extra_evidence_by_ref = {
        ref: tuple(items) for ref, items in (spec.get("extra_evidence_by_ref") or {}).items()
    }
    return ProjectionRunInputs(
        transcript=transcript,
        conditions=conditions,
        batch_answers=batch_answers,
        projection=projection,
        composition_specs=tuple(spec.get("composition_specs") or ()),
        extra_evidence_by_ref=extra_evidence_by_ref,
        transcript_sha256=spec["pins"]["transcript_sha256"],
        extraction_sha256=spec["pins"]["extraction_sha256"],
        allowed_edge_types=tuple(spec["allowed_edge_types"]),
    )
