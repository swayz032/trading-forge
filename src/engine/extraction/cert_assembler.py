"""H1 fidelity certificate assembler (pre-reg §4 schema, amended per
`docs/designs/h1-pilot-preregistration-2026-07-12.md` §6).

Assembles ONE certificate per extracted strategy from:
  - tier-1 `Tier1Detection` entries (deterministic, `tier1_detectors.py`)
  - tier-3 `Tier3Verdict` entries (blind adjudication, accepted as an INPUT
    structure here -- this module never calls an LLM, per the Wave-4 brief)
  - an OPTIONAL per-condition structural overlay (`ConditionTopology`:
    direction / and_group / role / comparator / is_disabled_sentinel) and an
    OPTIONAL `or_branches` grouping, both consumed by the 5 compile-integrity
    lints.

Emits the AMENDED schema: `classifying_tier` in {1, 3} ONLY -- tier-2
(discourse) is RETIRED WITH CAUSE (pilot pre-reg §6, the terminal fork). This
module MUST NEVER emit `classifying_tier == 2`; `_TIER2_RETIRED` below is the
single enforcement point (`_condition_entry`'s assertion).

WAVE1-FEED-UNRESOLVED note (topology overlay, honest scope limit): the tier-1
layer (tier1_detectors.py) emits ONLY surface_class/quote_anchor/char_span --
it carries no direction/and_group/or_branch/role information, and no pipeline
stage in this repo yet produces that topology at the CERTIFICATE layer (the
only place AND/OR/direction structure is represented today is the ENGINE's
compiled DSL spec, spec_condition_compiler.py / spec_family_bindings.py,
which is a LATER compile stage than extraction). Rather than fabricate that
topology, the assembler accepts it as an OPTIONAL per-condition overlay
(`ConditionTopology`, keyed by char_span -- the one join key common to both
tier-1 and tier-3 output) plus an optional `or_branches` grouping of the
assembler's own synthetic condition_ids (`t1-<i>` / `t3-<j>`, assignment
order). When absent, the 3 structural lints (direction_conflation_lint /
unsat_sat_check / or_alternatives_honored) degrade to a vacuous PASS (nothing
to check against). f2_coverage_gate stays fully active (anchor/span/text are
on every certificate entry). causality_lint is PARTIALLY active: its
impossible-ref regex leg is fully live (operates on anchor/comparator text),
but its same-bar-opt-out leg is UNREACHABLE in the current wiring --
`assemble_certificate` exposes no `same_bar_fill`/`signal_lag` params, so both
default off and that branch never fires until an upstream stage supplies them.
So of the 5 named compile-integrity lints, only ~1.5 contribute discriminating
power on a topology-less certificate; a faithful all-5 §4 test requires a
compile-stage topology producer (F-1, independent grade 2026-07-12). This is
the most defensible reading available without inventing data no upstream stage
produces; flagged here per Law 4 rather than silently assumed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from .compile_lints import CompiledSpine, SpineCondition, run_all_lints
from .tier1_detectors import Tier1Detection, Tier1FallThrough

_TIER2_RETIRED = 2  # never emitted -- pilot pre-reg §6, tier-2 retired with cause


@dataclass
class Tier3Verdict:
    """One blind-adjudicator call result routed to a tier-1 fall-through span
    (pre-reg §3 control-gated blind protocol). `surface_class` is the closed-
    taxonomy call the certificate records; `verdict` is the raw gate-strength
    taxonomy call. `control_gate_passed` records whether THIS rater cleared
    the 5/5 gate + 5/5 context control set (pre-reg §3) -- a verdict from a
    rater who failed the control gate must not enter a certificate (see
    `assemble_certificate`, which drops non-passing verdicts before joining)."""

    char_span: Tuple[int, int]
    quote_anchor: str
    surface_class: str
    verdict: str  # "gate-strength" | "context" | "cannot-determine"
    control_gate_passed: bool


@dataclass
class ConditionTopology:
    """Optional structural overlay, keyed by char_span (see module docstring
    WAVE1-FEED-UNRESOLVED note). Fields mirror `compile_lints.SpineCondition`
    minus the anchor/span fields (those come from the tier-1/tier-3 entry
    itself, never duplicated here to avoid a second source of truth)."""

    char_span: Tuple[int, int]
    direction: Optional[str] = None
    and_group: Optional[int] = None
    role: Optional[str] = None
    is_disabled_sentinel: bool = False
    comparator: Optional[str] = None


@dataclass
class Provenance:
    source_video_id: str
    full_transcript_sha256: str
    extractor_version: str
    taxonomy_version: str

    def as_dict(self) -> dict:
        return {
            "source_video_id": self.source_video_id,
            "full_transcript_sha256": self.full_transcript_sha256,
            "extractor_version": self.extractor_version,
            "taxonomy_version": self.taxonomy_version,
        }


def _condition_entry(
    surface_class: str,
    classifying_tier: Optional[int],
    quote_anchor: str,
    char_span: Tuple[int, int],
    adjudication_verdict: Optional[dict],
) -> dict:
    assert classifying_tier != _TIER2_RETIRED, (
        "cert_assembler MUST NEVER emit classifying_tier==2 (retired, pilot pre-reg §6)"
    )
    return {
        "surface_class": surface_class,
        "classifying_tier": classifying_tier,
        "quote_anchor": quote_anchor,
        "char_span": [char_span[0], char_span[1]],
        "adjudication_verdict": adjudication_verdict,
    }


def _spine_condition(condition_id: str, quote_anchor: str, char_span: Tuple[int, int],
                      topo_by_span: Dict[Tuple[int, int], ConditionTopology]) -> SpineCondition:
    topo = topo_by_span.get(char_span)
    return SpineCondition(
        condition_id=condition_id,
        quote_anchor=quote_anchor,
        char_span=char_span,
        direction=topo.direction if topo else None,
        and_group=topo.and_group if topo else None,
        role=topo.role if topo else None,
        is_disabled_sentinel=topo.is_disabled_sentinel if topo else False,
        comparator=topo.comparator if topo else None,
    )


def assemble_certificate(
    full_transcript: str,
    full_transcript_sha256: str,
    source_video_id: str,
    extractor_version: str,
    taxonomy_version: str,
    tier1_detections: List[Tier1Detection],
    tier1_fallthroughs: List[Tier1FallThrough],
    tier3_verdicts: Optional[List[Tier3Verdict]] = None,
    topology: Optional[List[ConditionTopology]] = None,
    or_branches: Optional[List[List[str]]] = None,
    scope_line: Optional[str] = None,
) -> dict:
    """Assemble one fidelity certificate. Pure function: no I/O, no LLM call
    (tier-3 verdicts are consumed as data, per the Wave-4 brief), no
    randomness -- same inputs always produce the same certificate (replay-
    determinism contract, backtest-core priority #2).

    `or_branches` (optional): groups of this function's own synthetic
    condition_ids (`t1-<i>` for tier1_detections[i], `t3-<j>` for
    tier1_fallthroughs[j] when tier-3-resolved) that the CALLER asserts are
    alternatives -- see module docstring WAVE1-FEED-UNRESOLVED note."""
    tier3_verdicts = tier3_verdicts or []
    topo_by_span: Dict[Tuple[int, int], ConditionTopology] = {t.char_span: t for t in (topology or [])}
    tier3_by_span: Dict[Tuple[int, int], Tier3Verdict] = {
        v.char_span: v for v in tier3_verdicts if v.control_gate_passed
    }

    condition_entries: List[dict] = []
    spine_conditions: List[SpineCondition] = []

    for i, det in enumerate(tier1_detections):
        condition_entries.append(
            _condition_entry(det.surface_class, 1, det.quote_anchor, det.char_span, None)
        )
        spine_conditions.append(_spine_condition(f"t1-{i}", det.quote_anchor, det.char_span, topo_by_span))

    for j, ft in enumerate(tier1_fallthroughs):
        verdict = tier3_by_span.get(ft.char_span)
        if verdict is None:
            # No control-gate-passing tier-3 adjudication reached this span --
            # stays unclassified (classifying_tier=None), NEVER tier-2
            # (retired). certificate_grade sees this as an unresolved span.
            condition_entries.append(
                _condition_entry("cannot-determine-at-tier-1", None, "", ft.char_span, None)
            )
            continue
        condition_entries.append(
            _condition_entry(
                verdict.surface_class,
                3,
                verdict.quote_anchor,
                verdict.char_span,
                {"verdict": verdict.verdict, "control_gate_passed": verdict.control_gate_passed},
            )
        )
        spine_conditions.append(_spine_condition(f"t3-{j}", verdict.quote_anchor, verdict.char_span, topo_by_span))

    spine = CompiledSpine(conditions=spine_conditions, or_branches=or_branches or [])
    lint_results = run_all_lints(spine, full_transcript)
    compile_integrity = {name: r.as_cert_fields() for name, r in lint_results.items()}

    every_condition_classified = all(c["classifying_tier"] in (1, 3) for c in condition_entries)
    every_anchor_resolves = all(
        full_transcript[c["char_span"][0] : c["char_span"][1]] == c["quote_anchor"]
        for c in condition_entries
        if c["classifying_tier"] is not None
    )
    every_lint_passes = all(r.passed for r in lint_results.values())

    certificate_grade = bool(condition_entries) and every_condition_classified and every_anchor_resolves and every_lint_passes

    return {
        "conditions": condition_entries,
        "compile_integrity": compile_integrity,
        "provenance": Provenance(
            source_video_id=source_video_id,
            full_transcript_sha256=full_transcript_sha256,
            extractor_version=extractor_version,
            taxonomy_version=taxonomy_version,
        ).as_dict(),
        "scope_line": scope_line,
        "certificate_grade": certificate_grade,
    }
