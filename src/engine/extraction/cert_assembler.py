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
order).

F-1 REPAIR (addendum §A, 2026-07-12; supersedes the vacuous-PASS note this
docstring used to carry): NO lint ever vacuously passes. When `topology` and
`or_branches` are both absent (the pilot conveyor's actual state today), the
3 structural lints (direction_conflation_lint / unsat_sat_check /
or_alternatives_honored) report `NOT_EVALUATED` (`reason="no_compiled_
topology"`), not PASS. `f2_coverage_gate` stays fully active (anchor/span/text
are on every certificate entry). `causality_lint`'s impossible-ref regex leg
is fully live; its same-bar-opt-out leg reports `NOT_EVALUATED`
(`reason="no_same_bar_fill_signal_lag"`, surfaced on `same_bar_leg_status`)
because `assemble_certificate` exposes no `same_bar_fill`/`signal_lag` params
(still out of scope here -- the option-A topology producer, addendum §C,
wires those through later). Every `compile_integrity` field on the emitted
certificate carries its 3-state status honestly, on the artifact (Law 7).

TWO-GRADE CERTIFICATE (addendum §B/§C): `pilot_grade` reads the pilot's
actual question -- every spine condition classifies (tier 1/3) with a
resolvable verbatim anchor AND the LIVE lints (`f2_coverage_gate` +
`causality_lint`'s regex leg) PASS. The 3 structural lints + causality's
same-bar leg being NOT_EVALUATED does NOT block pilot_grade. `full_grade` is
strictly stronger: pilot_grade AND all 5 lints PASS on REAL compiled
topology (zero NOT_EVALUATED anywhere). In this topology-less pilot conveyor
full_grade is NEVER reachable -- that is correct and expected (addendum §C:
the compile-stage topology producer is a pre-registered PRECONDITION of the
H2 battery read, not built here). `certificate_grade` is kept as a bool alias
of `full_grade` (the strictest §4 reading, the only grade H2 consumes) so no
caller can mistake a lesser pilot-grade certificate for the full standard.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from . import compile_lints as cl
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


# --------------------------------------------------------------------------- #
# terminal_read_grade -- the MERGE-SILENCING FENCE (ratify-packet
# h1-mergesilencing-fence-ratify-packet-2026-07-13.md). The ONLY grade the
# sealed-12 terminal read consumes. Closes the §2 wiring-verify CRIT: pilot_grade
# gates only f2+causality-regex, so a merge-silenced object (opposite-direction
# entries fused, unsat comparators, OR-alternatives strictly-ANDed) sails through
# it -- observed on R5L890. This grade GATES on the 3 structural lints too, with
# fail-closed semantics: NOT_EVALUATED on a load-bearing lint = INDETERMINATE, and
# ONLY affirmatively-CLEAN counts toward the >=60% video-unit bar.
# --------------------------------------------------------------------------- #

# Load-bearing lints for the terminal read's fidelity question. causality's
# same_bar leg is DELIBERATELY excluded -- provably-not-load-bearing (execution
# timing, orthogonal to extraction fidelity; ratify-packet disposition table).
_TERMINAL_STRUCTURAL_LINTS = (
    "direction_conflation_lint",
    "unsat_sat_check",
    "or_alternatives_honored",
)


def terminal_read_grade(lint_results: Dict[str, "cl.LintResult"]) -> dict:
    """Fail-closed terminal-read grade. Returns {grade, clean, disposition}.
      CLEAN         iff every load-bearing lint is affirmatively PASS.
      REJECTED      if any load-bearing lint is FAIL.
      INDETERMINATE if any load-bearing lint is NOT_EVALUATED and none FAIL.
    `clean` (grade == CLEAN) is the ONLY value counting toward the >=60% bar --
    INDETERMINATE != clean, REJECTED != clean. Without a compiled-topology
    overlay the 3 structural lints are NOT_EVALUATED -> INDETERMINATE, which is
    the forcing function that makes the A-packet a hard terminal-read
    precondition (Hole 1) rather than a documented wish."""
    disposition: Dict[str, str] = {}
    any_fail = False
    any_not_eval = False

    # 3 structural lints: gate top-level status.
    for name in _TERMINAL_STRUCTURAL_LINTS:
        st = lint_results[name].status
        disposition[name] = st
        if st == cl.STATUS_FAIL:
            any_fail = True
        elif st == cl.STATUS_NOT_EVALUATED:
            any_not_eval = True

    # f2_coverage_gate: gate top-level status (never NOT_EVALUATED).
    f2 = lint_results["f2_coverage_gate"].status
    disposition["f2_coverage_gate"] = f2
    if f2 == cl.STATUS_FAIL:
        any_fail = True
    elif f2 == cl.STATUS_NOT_EVALUATED:
        any_not_eval = True

    # causality: gate the REGEX leg only (same_bar leg is provably-not-load-
    # bearing -- ratify-packet proof). regex_leg_status is the load-bearing leg.
    caus = lint_results["causality_lint"]
    regex_leg = caus.regex_leg_status
    disposition["causality_lint.regex_leg"] = regex_leg
    disposition["causality_lint.same_bar_leg"] = "EXEMPT_NOT_LOAD_BEARING"
    if regex_leg == cl.STATUS_FAIL:
        any_fail = True
    elif regex_leg == cl.STATUS_NOT_EVALUATED:
        any_not_eval = True

    if any_fail:
        grade = "REJECTED"
    elif any_not_eval:
        grade = "INDETERMINATE"
    else:
        grade = "CLEAN"
    return {"grade": grade, "clean": grade == "CLEAN", "disposition": disposition}


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

    # §A: topology_present is True iff the caller actually supplied a real
    # compile-stage overlay (ConditionTopology rows and/or or_branches
    # groups) -- NOT inferred from per-condition field values, so an absent
    # overlay never masquerades as "nothing to check" (that would be the
    # vacuous-PASS bug this repair removes). same_bar_params_present stays
    # False here unconditionally: this function exposes no same_bar_fill/
    # signal_lag params (out of scope, addendum §C wires those later).
    spine = CompiledSpine(
        conditions=spine_conditions,
        or_branches=or_branches or [],
        topology_present=bool(topology) or bool(or_branches),
        same_bar_params_present=False,
    )
    lint_results = run_all_lints(spine, full_transcript)
    compile_integrity = {name: r.as_cert_fields() for name, r in lint_results.items()}

    every_condition_classified = all(c["classifying_tier"] in (1, 3) for c in condition_entries)
    every_anchor_resolves = all(
        full_transcript[c["char_span"][0] : c["char_span"][1]] == c["quote_anchor"]
        for c in condition_entries
        if c["classifying_tier"] is not None
    )

    f2_result = lint_results["f2_coverage_gate"]
    causality_result = lint_results["causality_lint"]

    # §B: pilot_grade gates ONLY on the live subset -- f2_coverage_gate PASS
    # and causality_lint's impossible-ref REGEX LEG specifically PASS (not
    # its overall field status, and NOT the same-bar leg, and NOT the 3
    # structural lints). This is deliberate: a structural lint that happens
    # to FAIL on a rare topology-bearing certificate is a real compile-time
    # defect the pilot's own question does not ask about -- that gap is
    # exactly what full_grade (and the §C H2 precondition) exists to close.
    live_lints_pass = (
        f2_result.status == cl.STATUS_PASS
        and causality_result.regex_leg_status == cl.STATUS_PASS
    )

    pilot_grade = (
        bool(condition_entries)
        and every_condition_classified
        and every_anchor_resolves
        and live_lints_pass
    )

    # §C: full_grade requires ALL FIVE lints PASS on real topology -- zero
    # NOT_EVALUATED anywhere in compile_integrity, including causality's
    # same_bar_leg_status sub-field (a lint whose top-level status happens to
    # be PASS can still carry a NOT_EVALUATED sub-leg; that must still block
    # full_grade -- "on EVERY certificate field", addendum §A).
    def _statuses(r: cl.LintResult) -> List[str]:
        statuses = [r.status]
        if r.same_bar_leg_status is not None:
            statuses.append(r.same_bar_leg_status)
        return statuses

    zero_not_evaluated = all(
        s != cl.STATUS_NOT_EVALUATED for r in lint_results.values() for s in _statuses(r)
    )
    all_five_pass = all(r.status == cl.STATUS_PASS for r in lint_results.values())

    full_grade = pilot_grade and all_five_pass and zero_not_evaluated

    # THE FENCE (ratify-packet 2026-07-13): the ONLY grade the sealed-12
    # terminal read consumes. Gates on the 3 structural lints too, fail-closed.
    # A merge-silenced object that gets pilot_grade=True is REJECTED (topology
    # present -> direction_conflation FAIL) or INDETERMINATE (topology absent ->
    # structural lints NOT_EVALUATED) here -- never CLEAN. pilot_grade itself is
    # UNCHANGED (pilot-era artifact); this is additive.
    terminal_read = terminal_read_grade(lint_results)

    return {
        "conditions": condition_entries,
        "compile_integrity": compile_integrity,
        "terminal_read_grade": terminal_read["grade"],
        "terminal_read_clean": terminal_read["clean"],
        "terminal_read_disposition": terminal_read["disposition"],
        "provenance": Provenance(
            source_video_id=source_video_id,
            full_transcript_sha256=full_transcript_sha256,
            extractor_version=extractor_version,
            taxonomy_version=taxonomy_version,
        ).as_dict(),
        "scope_line": scope_line,
        "pilot_grade": pilot_grade,
        "full_grade": full_grade,
        # bool alias of full_grade (§D: the strictest §4 reading is the only
        # grade H2 consumes) -- kept so any future caller reading a plain
        # bool never mistakes a lesser pilot-grade certificate for full §4.
        "certificate_grade": full_grade,
    }
