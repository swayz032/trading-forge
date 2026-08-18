"""svkm_v2_1_compile.py -- SPINE-A INPUT ADAPTER: certified V2.1 source graph -> certified record.

Authority: AR-1325A (gpt-rulings 43e28b02) "STAGE 2 COMPILER VERTICAL -- UNLOCKED NOW". AR-1325A
certified the V2.1 source graph (source_graph_projection_v2_1_spec.json, GREEN_ALL_ITEMS_DONE)
and authorized proving the EXISTING production compiler -- SPINE-A
(compile_certified_record.py -> spec_producer.py::produce_spec_artifact_from_record) -- can
consume it end to end, per AR-1325A section 3 "Stage-2 first vertical" and "Stage-2 proof
requirements".

THE SEAM THIS MODULE CLOSES
----------------------------
`produce_spec_artifact_from_record()` (spec_producer.py) reads a "certified record" shaped like
the ORIGINAL raw extraction: `{"strategies": [{"entry_sequence": [...], "confluences": [...],
"stop": {...}, "targets": [...]}]}`. It has NO knowledge of the certified V2.1 source graph's
shape (condition-ref-keyed conditions, canonical/alias/preserved-metadata buckets, correction
ledger, typed graph edges). AR-1325A section 3: "If an existing compiler seam is missing,
implement the smallest missing production adapter... Do not create a parallel compiler."

This module IS that adapter, and only that adapter:
  1. Runs the certified V2.1 projection (`run_projection()`, via the stable spec loader
     `source_graph_projection_spec.py`) -- the SAME call `scripts/source_graph_projection_v2_1_
     certify.py` uses to produce the certified receipt, reused byte-for-byte, not
     re-implemented (no second calculator).
  2. Reconstructs a raw-shaped record from the projection's OUTCOMES, substituting each
     canonical ref's V2.1-CORRECTED `provenance.projected_condition_text` for the raw
     extraction's original text at that position.
  3. Excludes the alias ref (`confluences[1].description`, aliasing `entry_sequence[1].action`
     per the graph's `alias_of_canonical_breakout` edge) from the reconstructed record
     entirely, so it cannot become a second independent condition downstream.
  4. Leaves the 2 preserved-metadata refs (`entry_sequence[0].rationale`,
     `entry_sequence[2].rationale`) in place as inert `rationale` text.
     `spec_producer.py::_condition_text()` tries `action` before `rationale` and both of these
     steps carry a non-empty `action` -- so this text is STRUCTURALLY UNREACHABLE by the
     existing classifier, not merely unused by convention. See
     `test_preserved_metadata_is_structurally_inert` in the paired test module.
  5. REFUSES (`CanonicalNodeNotAcceptedError`) if any of the 9 canonical refs does not carry
     `disposition == "ACCEPTED"` in the projection outcome -- a load-bearing canonical node
     that fails to verify (wrong span, mutated evidence, a relevance/fidelity gate going RED)
     stops the compile rather than silently falling back to the raw, uncertified text.

WHAT THIS MODULE DOES NOT DO
-----------------------------
It does not re-implement `spec_producer.py`'s condition classification, `entry_trigger_id`
selection, or `and_groups`/`or_branches` derivation -- that stays SPINE-A's + the producer's job,
called UNCHANGED (`compile_svkm_v2_1_vertical` below calls the existing
`compile_record_to_artifact()` and does not touch its internals). It only ATTACHES the two
fields the corpus-wide producer has never populated for any artifact -- `spec.source_risk` and
`spec.source_timeframe_roles` -- from FROZEN, ALREADY-RULED authority
(`svkm_source_risk_canonical.json`, AR-1068; the four timeframe-role bindings below, AR-1109
through AR-1113), never invented here. It also stamps `graph_canonical_hash` (the certified
projection's own deterministic hash) and `ledger_d` -- both of which `spec_producer.py` pins as
"" / "UNKNOWN" today with the explicit comment "unproduced on this branch (R-040 section 3)".
Populating them for this one certified compile, without changing the corpus-wide producer's
default behaviour for every other artifact, is exactly the "smallest missing adapter."

THE STOP-ANCHOR / SHORT-SIDE BOUNDARY -- NOT RE-LITIGATED, ONLY PRESERVED
---------------------------------------------------------------------------
The frozen `svkm_source_risk_canonical.json` fixture (AR-1068) rules the LONG-side stop anchor
(`displacement_candle_low`) and explicitly leaves the SHORT side `UNRESOLVED_SOURCE_AMBIGUITY`
-- "do not add `displacement_candle_high` by inference ... AR-1068 SS3.2 forbids engineering
common sense substituting for source authority." `source-risk-contract.ts`'s
`ANCHOR_TO_RESOLVER` structurally enforces that refusal (no `displacement_candle_high` entry).
This module emits ONLY the long-side anchor, unchanged from the frozen fixture. The certified
V2.1 graph's breakout-side ROUTING (downside -> short, upside -> long) is preserved faithfully
as `direction: "both"` -- a structural fact about how the entry fires at runtime, not a text
predicate `spec_producer.py` compiles into `entry_conditions` (see the module-level mapping
notes in the paired test file for why `entry_sequence[1].rationale`, though canonical, never
becomes its own `entry_conditions[]` entry). A SHORT-side trade's stop resolution is expected to
REFUSE at runtime through the existing, already-ruled short-side boundary; this module does not
touch that boundary and does not widen it. AR-1138 section 3.1's own instruction governs: "If
the existing automated certification/normalization path cannot resolve this distinction from
source evidence, STOP AND REPORT." It has not been resolved by any ruling since, so this module
does not resolve it either -- an honest compiler gap, not papered over.
"""

from __future__ import annotations

import importlib.util
import json
import os
from typing import Any

from src.engine.extraction.compile_certified_record import compile_record_to_artifact
from src.engine.extraction.source_graph_projection import (
    ACCEPTED as CANONICAL_ACCEPTED,
)
from src.engine.extraction.source_graph_projection import (
    PRESERVED_NON_EXECUTABLE_METADATA,
)
from src.engine.extraction.spec_producer import _spec_hash
from src.engine.source_timeframe_roles import (
    BREAKOUT_CONFIRMATION,
    ENTRY_COMPLETION,
    EXPLICIT,
    FVG_DETECTION,
    OPENING_RANGE_WINDOW,
    SOURCE_RESOLVED_BY_CONTINUITY,
    SourceTimeframeRoles,
    TimeframeRoleBinding,
)

# ── PATHS -- committed artifact locations, not scratch state ────────────────
_SPEC_PATH = "docs/replay-results/svkm-extraction-certified/grade/opus-v2/source_graph_projection_v2_1_spec.json"
_RISK_FIXTURE_PATH = "src/engine/extraction/fixtures/svkm_source_risk_canonical.json"
# 🛑 DELIBERATELY NOT under `docs/` -- `test_spec_family_bindings.py::_all_wait_session_objects()`
# globs `docs/**/*.json` for a PINNED corpus census (395 distinct WAIT_SESSION `object` strings).
# A real compiled artifact (unlike the raw source-graph JSON that lived in this campaign's
# `docs/replay-results/...` tree before) legitimately carries `type: "WAIT_SESSION"` entry
# conditions, so writing one under `docs/` silently grows that census to 396 and red-proofs a
# completely unrelated, already-pinned test -- MEASURED during this module's own development.
# `src/engine/extraction/fixtures/` already holds committed non-fixture-input JSON for this same
# source (`svkm_source_risk_canonical.json`) and is outside every `docs/`-scoped census.
_STAGE2_OUT_DIR = "src/engine/extraction/fixtures/svkm_v2_1_compiled"
_SPEC_ID = "sVkmZklJDHI__s0"

#: The 9 certified canonical refs AR-1325A section 3 requires preserved, and where each one's
#: V2.1-corrected text lands in the reconstructed raw-shaped record. `None` for refs whose
#: certified fact is preserved as a STRUCTURAL property (direction routing, risk contract)
#: rather than as literal text at a raw-record position -- see the module docstring's
#: "stop-anchor / short-side boundary" section and the paired test file for the full mapping
#: table required by AR-1325A's "exact mapping from each of the 9 certified canonical nodes"
#: proof requirement.
_ALIAS_REF = "confluences[1].description"
_PRESERVED_METADATA_REFS = ("entry_sequence[0].rationale", "entry_sequence[2].rationale")
_CANONICAL_REFS_IN_ORDER = (
    "entry_sequence[0].action",
    "entry_sequence[1].action",
    "entry_sequence[1].rationale",
    "entry_sequence[2].action",
    "entry_sequence[3].rationale",
    "entry_sequence[3].action",
    "confluences[0].description",
    "stop.rationale",
    "targets[0].rationale",
)


class CanonicalNodeNotAcceptedError(ValueError):
    """One of the 9 certified canonical refs did not carry `disposition == "ACCEPTED"` in the
    projection outcome. Raised rather than silently falling back to raw, uncertified text --
    a load-bearing canonical node failing to verify is a compile-time refusal, not a warning."""


def _bench():
    """Dynamically load `scripts/svkm_locator_benchmark.py` -- `scripts/` carries no
    `__init__.py` so it is not an importable package. Mirrors
    `scripts/source_graph_projection_v2_1_certify.py::_bench()` byte-for-byte: the certifier's
    own loading path is reused here rather than re-implemented, so this adapter and the
    certificate it depends on can never silently diverge on how the pinned transcript/record are
    read."""
    spec = importlib.util.spec_from_file_location(
        "_svkm_bench_v2_1_compile", os.path.join("scripts", "svkm_locator_benchmark.py")
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _canonical_hash(record: dict) -> str:
    """Identical to `scripts/source_graph_projection_v2_1_certify.py::_canonical_hash` --
    sha256 of the sorted-keys JSON serialization. Reused, not re-derived, so this module's
    `graph_canonical_hash` can never drift from the certifier's own determinism proof."""
    import hashlib

    blob = json.dumps(record, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def run_certified_projection() -> tuple[dict[str, Any], str]:
    """Run the certified V2.1 projection exactly as the certifier does, and return
    `(record, canonical_hash)`. Zero model calls -- `batch_answers` are loaded from the
    committed `raw_output_by_ref` in the versioned spec, never freshly generated."""
    from src.engine.extraction import source_graph_projection_spec as sgps
    from src.engine.extraction.source_graph_projection import run_projection

    bench = _bench()
    transcript, extraction_record = bench._load_pinned()

    spec = sgps.load_spec_json(_SPEC_PATH)
    inputs = sgps.build_projection_run_inputs(
        spec, transcript, verify_pins=True, extraction_record=extraction_record,
    )
    record = run_projection(**inputs.run_kwargs())
    return record, _canonical_hash(record)


def _outcome_by_ref(record: dict[str, Any]) -> dict[str, dict]:
    return {o["condition_ref"]: o for o in record["outcomes"]}


def _projected_text(outcomes: dict[str, dict], ref: str) -> str:
    """The V2.1-corrected text for one canonical ref, REFUSING if it was not ACCEPTED.

    `outcomes[ref]["provenance"]["projected_condition_text"]` is `run_projection()`'s own
    self-verifying provenance record (computed from the actual texts in play, never a
    caller-supplied hash) -- see `source_graph_projection.py::_provenance()`. Reusing it here
    means the corrected text this adapter emits can never diverge from what the certified
    receipt itself claims to have projected.
    """
    outcome = outcomes.get(ref)
    if outcome is None:
        raise CanonicalNodeNotAcceptedError(
            f"{ref!r} is not present in the projection outcomes at all -- the projection ran "
            "against a conditions list that does not include this canonical ref"
        )
    if outcome.get("disposition") != CANONICAL_ACCEPTED:
        raise CanonicalNodeNotAcceptedError(
            f"canonical ref {ref!r} carries disposition {outcome.get('disposition')!r}, not "
            f"{CANONICAL_ACCEPTED!r}. A load-bearing canonical node that fails to verify stops "
            "this compile rather than silently falling back to the raw, uncertified extraction "
            "text."
        )
    return outcome["provenance"]["projected_condition_text"]


def build_certified_record(record: dict[str, Any]) -> dict[str, Any]:
    """Reconstruct a raw-shaped `{"strategies": [...]}` certified record from a certified V2.1
    projection receipt, substituting each of the 9 canonical refs' V2.1-CORRECTED text for the
    raw extraction's original text at that position.

    REFUSES via `CanonicalNodeNotAcceptedError` if any canonical ref is missing or not ACCEPTED
    -- checked for all 9 up front, so a single bad ref reports itself rather than surfacing as a
    confusing downstream KeyError.
    """
    outcomes = _outcome_by_ref(record)

    # Fail closed on ALL 9 before building anything, so a caller sees every failing ref at once
    # rather than one at a time across repeated invocations.
    missing_or_unaccepted = [
        ref for ref in _CANONICAL_REFS_IN_ORDER
        if outcomes.get(ref, {}).get("disposition") != CANONICAL_ACCEPTED
    ]
    if missing_or_unaccepted:
        raise CanonicalNodeNotAcceptedError(
            "canonical ref(s) not ACCEPTED in the projection outcome, refusing to compile: "
            f"{missing_or_unaccepted}"
        )

    strategy: dict[str, Any] = {
        "name": "fvg_breakout_range_1m_5m",
        "higher_timeframe": "5m",
        "lower_timeframe": "1m",
        "direction": "both",
        "entry_sequence": [
            {
                "step": 1,
                "action": _projected_text(outcomes, "entry_sequence[0].action"),
                # entry_sequence[0].rationale is PRESERVED_NON_EXECUTABLE_METADATA (excluded
                # from the certified graph's canonical/alias buckets). Left here as inert
                # provenance text ONLY -- see `test_preserved_metadata_is_structurally_inert`.
                "rationale": _preserved_metadata_text(record, "entry_sequence[0].rationale"),
            },
            {
                "step": 2,
                "action": _projected_text(outcomes, "entry_sequence[1].action"),
                "rationale": _projected_text(outcomes, "entry_sequence[1].rationale"),
            },
            {
                "step": 3,
                "action": _projected_text(outcomes, "entry_sequence[2].action"),
                "rationale": _preserved_metadata_text(record, "entry_sequence[2].rationale"),
            },
            {
                "step": 4,
                "action": _projected_text(outcomes, "entry_sequence[3].action"),
                "rationale": _projected_text(outcomes, "entry_sequence[3].rationale"),
            },
        ],
        # confluences[1].description (the alias of entry_sequence[1].action) is DELIBERATELY
        # EXCLUDED -- including it here would let `spec_producer.py` treat it as a second,
        # independent confluence condition. See `test_alias_never_becomes_second_condition`.
        "confluences": [
            {"description": _projected_text(outcomes, "confluences[0].description")},
        ],
        "stop": {
            "rationale": _projected_text(outcomes, "stop.rationale"),
        },
        "targets": [
            {
                "rationale": _projected_text(outcomes, "targets[0].rationale"),
                "type": "r_multiple",
                "r_multiple": 2,
            },
        ],
    }
    return {"strategies": [strategy]}


def _preserved_metadata_text(record: dict[str, Any], ref: str) -> str:
    """The RAW (uncorrected) text for a preserved-non-executable-metadata ref, for provenance
    display only. Never routed through `_projected_text` -- preserved-metadata refs are, by the
    certified graph's own conservation contract, excluded from the canonical/alias buckets and
    never carry a `disposition == "ACCEPTED"` outcome to read a projected text from."""
    outcomes = _outcome_by_ref(record)
    outcome = outcomes.get(ref)
    if outcome is None or outcome.get("disposition") != PRESERVED_NON_EXECUTABLE_METADATA:
        raise ValueError(
            f"{ref!r} is expected to be {PRESERVED_NON_EXECUTABLE_METADATA!r} in this "
            f"certified receipt, got {outcome.get('disposition') if outcome else 'MISSING'!r}"
        )
    return str(outcome.get("original_text") or "")


def _load_frozen_source_risk() -> dict[str, Any]:
    """The AR-1068 frozen, ruled `source_risk` contract for sVkm -- LONG-side stop anchor
    (`displacement_candle_low`) and the 2R fixed target. Loaded verbatim, never re-derived; the
    fixture's own `frozen: true` flag is asserted so a caller notices immediately if this
    committed file is ever silently unfrozen."""
    with open(_RISK_FIXTURE_PATH, encoding="utf-8") as f:
        fixture = json.load(f)
    if fixture.get("frozen") is not True:
        raise ValueError(
            f"{_RISK_FIXTURE_PATH!r} is no longer marked frozen -- this adapter only consumes "
            "an already-ruled, frozen risk contract, never a draft one"
        )
    source_risk = fixture["source_risk"]
    # Drop the fixture's own evidentiary `span` sub-keys (audit-only in the fixture; not part
    # of the runtime `SourceRiskContract` shape `source-risk-contract.ts` / `structural_stops.py`
    # consume) -- keep exactly {mode, stop:{anchor, include_wick}, target:{type, r_multiple}}.
    return {
        "mode": source_risk["mode"],
        "stop": {
            "anchor": source_risk["stop"]["anchor"],
            "include_wick": source_risk["stop"]["include_wick"],
        },
        "target": {
            "type": source_risk["target"]["type"],
            "r_multiple": source_risk["target"]["r_multiple"],
        },
    }


def _svkm_timeframe_roles() -> SourceTimeframeRoles:
    """The 4 required timeframe-role bindings for sVkm's 5m-window / 1m-execution combination
    (`svkm_role_execution.SVKM_EXPECTED_ROLE_TIMEFRAMES`), with REAL verbatim transcript quotes
    -- never the synthetic placeholders `test_svkm_role_execution.py` uses for its own unit
    tests (those do not occur in the pinned transcript; see the paired test file's
    `test_role_quotes_are_real_transcript_substrings`).

    OPENING_RANGE_WINDOW and BREAKOUT_CONFIRMATION are graded EXPLICIT: the teacher names the
    timeframe directly in both quotes ("a range on the five minute" / "the one minute time
    frame candles"). FVG_DETECTION and ENTRY_COMPLETION are graded SOURCE_RESOLVED_BY_CONTINUITY
    per AR-1110 section 3: the teacher does not re-state the timeframe at those steps, but never
    leaves the one-minute chart he switches to immediately after marking the 5-minute range --
    the SAME switch-over quote anchors both, honestly graded weaker than EXPLICIT rather than
    silently upgraded.
    """
    return SourceTimeframeRoles(
        bindings=(
            TimeframeRoleBinding(
                role=OPENING_RANGE_WINDOW,
                timeframe="5m",
                evidence_grade=EXPLICIT,
                source_quote=(
                    "And what that now gives me is a range on the five minute. Right? "
                    "So that's how high the price went within the first 5 minutes and "
                    "that's how low it went."
                ),
                condition_id="entry_sequence[0].action",
            ),
            TimeframeRoleBinding(
                role=BREAKOUT_CONFIRMATION,
                timeframe="1m",
                evidence_grade=EXPLICIT,
                source_quote=(
                    "We are essentially waiting for the one minute time frame candles to "
                    "print into one of these sides of the range."
                ),
                condition_id="entry_sequence[1].action",
            ),
            TimeframeRoleBinding(
                role=FVG_DETECTION,
                timeframe="1m",
                evidence_grade=SOURCE_RESOLVED_BY_CONTINUITY,
                source_quote=(
                    "Now if I switch over now to the one minute time frame, we've got the "
                    "top of the 5m minute range and we've got the bottom of the"
                ),
                condition_id="entry_sequence[2].action",
            ),
            TimeframeRoleBinding(
                role=ENTRY_COMPLETION,
                timeframe="1m",
                evidence_grade=SOURCE_RESOLVED_BY_CONTINUITY,
                source_quote=(
                    "Now if I switch over now to the one minute time frame, we've got the "
                    "top of the 5m minute range and we've got the bottom of the"
                ),
                condition_id="entry_sequence[3].action",
            ),
        )
    )


def compile_svkm_v2_1_vertical(out_dir: str = _STAGE2_OUT_DIR) -> str:
    """The full Stage-2 vertical, end to end:

        certified V2.1 graph -> build_certified_record() -> compile_record_to_artifact()
        [SPINE-A, UNCHANGED] -> attach source_risk + source_timeframe_roles + graph_canonical_
        hash + ledger_d [the only new semantic step] -> recompute spec_hash -> write

    Returns the path to the final, enriched `.spec.json` artifact. Deterministic: two calls
    with the same committed inputs produce byte-identical output (see
    `test_deterministic_repeat_compile`).
    """
    record, canonical_hash = run_certified_projection()
    certified_record = build_certified_record(record)

    os.makedirs(out_dir, exist_ok=True)
    record_path = os.path.join(out_dir, f"{_SPEC_ID}.certified_record.json")
    with open(record_path, "w", encoding="utf-8") as f:
        json.dump(certified_record, f, indent=2, sort_keys=True, ensure_ascii=False)
        f.write("\n")

    # SPINE-A, called UNCHANGED -- this line is the whole point of reusing the existing
    # compiler rather than building a parallel one. Written to its own subdirectory so the
    # UN-enriched SPINE-A output stays on disk beside the final artifact -- an auditor can
    # diff the two and see exactly what this adapter's enrichment step added (source_risk,
    # source_timeframe_roles, graph_canonical_hash, ledger_d) versus what SPINE-A itself
    # produced, unchanged.
    spine_a_dir = os.path.join(out_dir, "spine_a_raw_output")
    raw_artifact_path = compile_record_to_artifact(
        record_path, spec_id=_SPEC_ID, strategy_index=0, out_dir=spine_a_dir,
    )

    with open(raw_artifact_path, encoding="utf-8") as f:
        artifact = json.load(f)

    artifact["spec"]["source_risk"] = _load_frozen_source_risk()
    artifact["spec"]["source_timeframe_roles"] = _svkm_timeframe_roles().to_payload()
    artifact["graph_canonical_hash"] = canonical_hash
    artifact["ledger_d"] = "CONSERVED"
    # spec_hash MUST be recomputed now that source_risk/source_timeframe_roles are inside
    # spec_body -- otherwise the hash would not "cover" them, contradicting the documented
    # contract at spec-onboarding-service.ts:210-211.
    artifact["spec_hash"] = _spec_hash(artifact["spec"])

    enriched_path = os.path.join(out_dir, f"{_SPEC_ID}.spec.json")
    with open(enriched_path, "w", encoding="utf-8") as f:
        json.dump(artifact, f, indent=2, sort_keys=True, ensure_ascii=False)
        f.write("\n")

    return enriched_path


if __name__ == "__main__":
    import sys

    path = compile_svkm_v2_1_vertical()
    sys.stdout.write(f"{path}\n")
