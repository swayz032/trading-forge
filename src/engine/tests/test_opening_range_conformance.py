"""B1 STEP 2 (CORRECTED per R-728) — PERMANENT RED: production itself turns the
taught opening-range prose into a coarse structure binding.

AUTHORITY: R-728 §6, executing `EXTERNAL-READ-2026-08-09-STEP2-STARTS-TOO-LATE.md`.
Supersedes the first STEP 2 attempt (AR-821, commit 1dbac9ec).

WHY THIS FILE WAS REBUILT
-------------------------
The first version entered at census blob `23f30eb0` — a DERIVED artifact that
already contains `WAIT_STRUCTURE`, the role assignment, the condition identity
and the binding result. So it proved the binder misroutes an ALREADY-CLASSIFIED
condition; it did not prove that production CREATES the wrong classification,
which is the handoff B1 exists to repair. `A TEST THAT FAILS FOR THE RIGHT
REASON CAN STILL START IN THE WRONG PLACE.`

This version enters one level earlier, at the frozen extraction JSON, and drives
the real production chain:

    frozen extraction JSON  (tier-a-extraction-provenance/<stub>.json)
      -> produce_spec_artifact()      [src/engine/extraction/spec_producer.py]
      -> produced condition graph
      -> compile_binding_plan()       [src/engine/spec_family_bindings.py]
      -> selected primitive + output contract

The census is DEMOTED to a comparison oracle (see the join control below). It is
never the production input.

THE GENEROSITY IS REMOVED (R-728 §2)
------------------------------------
The first version inspected `StructureState`'s annotations and would have turned
GREEN if opening-range-shaped fields were added there. That is a path to a false
green: it lets the old wrong primitive satisfy the field list COSMETICALLY while
the semantic-identity defect is untouched. The typed-contract check below now
requires BOTH, in this order:

    (1) the selected primitive is NOT `structure_engine.compute_structure_state`
    (2) that primitive's resolved RETURN contract carries all six typed fields

Because (1) is a hard gate evaluated first, no amount of field-adding on
`StructureState` can satisfy this test. After the repair, deliberately routing
the opening-range type back to the structure primitive fails (1) automatically —
which is why R-728 §3 retired the previous SKIPPED placeholder rather than
keeping it. `A PARKED CONTROL PROTECTS NOTHING WHILE IT IS PARKED.`

EXPECTED POPULATION UNTIL B1 STEPS 3-6 LAND
-------------------------------------------
PASS  frozen extraction identity (three independent recorded sources agree)
PASS  the intended strategy is selected
PASS  produce_spec_artifact() actually runs
PASS  the opening-range prose reaches the produced condition graph
PASS  the historical census joins to the independently produced baseline
PASS  an unrelated genuine structure condition retains its structure route
FAIL  the opening-range definition is still typed `WAIT_STRUCTURE`
FAIL  the opening-range definition still selects `compute_structure_state`
FAIL  no typed opening-range output contract exists

`EXACT TEST COUNT IS NOT IMPORTANT; EXACT FAILURE MEMBERSHIP IS.` (R-728 §4)

WHAT THIS FILE DELIBERATELY DOES *NOT* ASSERT
---------------------------------------------
- No claim that structural output stays numerically unchanged. R-726 §1 withdrew
  the behavioural basis for that; the read forbids it.
- No decision on the breakout trigger. Wick / touch / close remains
  `UNRESOLVED_SOURCE_AMBIGUITY` (R-725 §4) and B1 may not settle it.
- Nothing about the other 8 conditions of this spec, or the other 10 specs.
"""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import get_type_hints

from src.engine.extraction.spec_producer import _spec_hash, produce_spec_artifact
from src.engine.family_meta_enforcement import (
    FamilyMetaEnforcementError,
    resolve_primitive,
)
from src.engine.spec_family_bindings import compile_binding_plan

REPO_ROOT = Path(__file__).resolve().parents[3]
PROVENANCE_DIR = REPO_ROOT / "docs/replay-results/h1-battery/tier-a-extraction-provenance"
PROVENANCE_MANIFEST = PROVENANCE_DIR / "_MANIFEST.json"
CENSUS = REPO_ROOT / "docs/replay-results/h1-battery/tier-a-compile-census.json"

# The golden slice. The stub carries the within-video strategy index, and the
# extraction file holds exactly that one strategy.
GOLDEN_STUB = "st5e-YJRfKc__s0"

# An UNRELATED, genuinely structural condition from a DIFFERENT video, used as
# the neighbour control (R-728 §4, control 6). It is a real production condition
# read from the frozen corpus, not a hand-built one.
NEIGHBOUR_STUB = "hcHuDfxdywI__s0"
NEIGHBOUR_CONDITION_ID = "WAIT_STRUCTURE:after-the-first-break-of-structure-price#2"

# The taught prose that defines the opening range. Quoted from the frozen
# extraction's `entry_sequence[0].action`.
OR_PROSE = "first 5, 15, and the 30 minute ranges"

STRUCTURE_PRIMITIVE = "structure_engine.compute_structure_state"
COARSE_FAMILY = "WAIT_STRUCTURE"

# The six typed fields the taught concept requires (read, STEP 2).
REQUIRED_OR_FIELDS = (
    "opening_range_high",
    "opening_range_low",
    "opening_range_width",
    "opening_range_midpoint",
    "opening_range_complete",
    "opening_range_window_status",
)

# Post-census producer field. `git log be194136..HEAD -- src/engine/extraction/
# spec_producer.py` names commit 1a9d1a1f ("emit explicit §0 load_bearing=True on
# every produced condition") as landing AFTER the census was frozen. Removing it
# reproduces the census `spec_hash` byte-for-byte — proven as a control below,
# not asserted.
POST_CENSUS_CONDITION_FIELDS = ("load_bearing",)


# ── production chain ─────────────────────────────────────────────────────────
def _extraction_path(stub: str) -> Path:
    return PROVENANCE_DIR / f"{stub}.json"


def _produce(stub: str):
    """Drive the REAL production chain from the frozen extraction JSON.

    Deliberately mirrors `tier_a_compile_census.py:284-289` — the same public
    entry points, the same arguments, flags off — so this is the production path
    and not a private re-implementation of it.
    """
    doc = json.loads(_extraction_path(stub).read_text(encoding="utf-8"))
    strategies = doc.get("strategies") or []
    assert len(strategies) == 1, (
        f"{stub}: the stub names one within-video strategy; found {len(strategies)}"
    )
    artifact = produce_spec_artifact(
        strategies[0], video=stub, certificate=None, transcript_chars=0
    )
    plan = compile_binding_plan(artifact["spec"])
    by_id = {b.condition_id: b for b in plan.bindings + plan.invalidation_bindings}
    return doc, artifact, plan, by_id


def _opening_range_condition(artifact: dict) -> dict:
    """The produced condition that carries the taught opening-range definition.

    Selected BY ITS TAUGHT PROSE, never by a pre-classified type or a frozen
    condition id — selecting it by `type == WAIT_STRUCTURE` would assume the very
    classification this file exists to convict.
    """
    matches = [
        c
        for c in artifact["spec"]["entry_conditions"]
        if OR_PROSE in c.get("object", "")
    ]
    assert len(matches) == 1, (
        f"expected exactly one produced condition carrying the taught opening-range "
        f"prose {OR_PROSE!r}; found {len(matches)}. Without exactly one, every "
        f"assertion below is about the wrong object."
    )
    return matches[0]


def _typed_opening_range_fields(primitive: str | None) -> set[str]:
    """Which required typed OR fields the SELECTED primitive can actually yield.

    NO GENEROSITY (R-728 §2). Two gates, in order:

      1. ROUTE IDENTITY. The structure primitive can never satisfy this contract,
         whatever fields are added to `StructureState`. Adding opening-range-shaped
         fields there is a cosmetic repair, and this gate is what refuses it.
      2. OUTPUT CONTRACT. Resolve the named primitive through the engine's own
         resolver and read its RETURN annotation's fields. An unregistered
         primitive resolves to nothing, which is an absent contract — not a pass.
    """
    if not primitive or primitive == STRUCTURE_PRIMITIVE:
        return set()
    try:
        fn = resolve_primitive(primitive)
    except FamilyMetaEnforcementError:
        return set()
    return_type = get_type_hints(fn).get("return") if callable(fn) else None
    return set(getattr(return_type, "__annotations__", {}) or {})


# ── PASSING CONTROL 1 — frozen extraction identity ───────────────────────────
def test_frozen_extraction_identity():
    """The bytes we drive production with are the frozen artifact.

    Three independently recorded sources must agree: the file's own bytes, the
    provenance manifest, and the census's `extraction_sha256`. A single recorded
    hash agreeing with itself would prove nothing.
    """
    path = _extraction_path(GOLDEN_STUB)
    assert path.exists(), f"frozen extraction artifact missing: {path}"

    on_disk = hashlib.sha256(path.read_bytes()).hexdigest()

    manifest = json.loads(PROVENANCE_MANIFEST.read_text(encoding="utf-8"))
    manifest_rows = [f for f in manifest["files"] if f["file"] == f"{GOLDEN_STUB}.json"]
    assert len(manifest_rows) == 1, "provenance manifest does not name the golden stub exactly once"
    manifest_sha = manifest_rows[0]["sha256"]

    census = json.loads(CENSUS.read_text(encoding="utf-8"))
    census_rows = [s for s in census["specs"] if s["stub"] == GOLDEN_STUB]
    assert len(census_rows) == 1, "census does not name the golden stub exactly once"
    census_sha = census_rows[0]["extraction_sha256"]

    assert on_disk == manifest_sha == census_sha, (
        "frozen extraction identity does not join across three sources:\n"
        f"  on disk  : {on_disk}\n"
        f"  manifest : {manifest_sha}\n"
        f"  census   : {census_sha}"
    )


# ── PASSING CONTROL 2 — the intended strategy is selected ────────────────────
def test_intended_strategy_is_selected_from_the_extraction():
    doc, _, _, _ = _produce(GOLDEN_STUB)
    strategy = doc["strategies"][0]
    assert strategy["name"] == "opening_range_breakout"
    assert OR_PROSE in strategy["entry_sequence"][0]["action"], (
        "the taught opening-range definition is not where this file believes it is"
    )


# ── PASSING CONTROL 3 — the producer actually runs ───────────────────────────
def test_produce_spec_artifact_actually_runs():
    """Positive witness that the production path EXECUTED.

    Every negative assertion below ('does not route to X', 'has no typed
    contract') is also satisfied by a chain that never ran. This is the witness
    that it did.
    """
    _, artifact, plan, by_id = _produce(GOLDEN_STUB)
    assert artifact["spec_hash"], "producer emitted no spec_hash"
    assert len(artifact["spec"]["entry_conditions"]) == 10
    assert len(artifact["spec"]["invalidations"]) == 1
    assert len(by_id) == 11, f"binder emitted {len(by_id)} bindings, expected 11"
    assert plan.bindings, "binding plan is empty; nothing downstream means anything"


# ── PASSING CONTROL 4 — the taught prose reaches the produced graph ──────────
def test_opening_range_prose_reaches_the_produced_condition_graph():
    """Extraction did NOT lose the opening-range definition.

    This is what makes the reds below a CLASSIFICATION defect rather than an
    extraction defect — R-725 §1 refuted `EXTRACTION_MISSING_REQUIRED_INFORMATION`
    and this control is what keeps that refutation live on every run.
    """
    _, artifact, _, _ = _produce(GOLDEN_STUB)
    condition = _opening_range_condition(artifact)
    assert OR_PROSE in condition["object"]
    assert condition["role"] == "spine"
    assert condition["load_bearing"] is True


# ── PASSING CONTROL 5 — the census joins to the independent reproduction ─────
def test_historical_census_agrees_with_the_independently_produced_baseline():
    """The census is a COMPARISON ORACLE here, never the production input.

    Two joins:

      (a) CONDITION IDENTITY — id, type, role and object, member by member.
      (b) SPEC HASH, byte-identical — but only after removing the producer fields
          that landed AFTER the census was frozen. That subtraction is not a
          convenience: it is the two-path proof that the divergence is fully
          explained by commit 1a9d1a1f and by nothing else. If any OTHER producer
          change had moved the spec, this join would still fail.
    """
    _, artifact, _, _ = _produce(GOLDEN_STUB)
    census = json.loads(CENSUS.read_text(encoding="utf-8"))
    census_spec = next(s for s in census["specs"] if s["stub"] == GOLDEN_STUB)

    produced = artifact["spec"]["entry_conditions"] + artifact["spec"]["invalidations"]
    assert len(produced) == len(census_spec["conditions"]), (
        f"produced {len(produced)} conditions, census recorded "
        f"{len(census_spec['conditions'])} — join by MEMBER, and the members differ in count"
    )
    for produced_condition, census_condition in zip(produced, census_spec["conditions"]):
        assert produced_condition["id"] == census_condition["condition_id"]
        assert produced_condition["type"] == census_condition["type"]
        assert produced_condition["role"] == census_condition["role"]
        assert produced_condition["object"] == census_condition["object"]

    census_era_body = copy.deepcopy(artifact["spec"])
    for condition in census_era_body["entry_conditions"] + census_era_body["invalidations"]:
        for field in POST_CENSUS_CONDITION_FIELDS:
            condition.pop(field, None)
    assert _spec_hash(census_era_body) == census_spec["spec_hash"], (
        "the reproduced spec does not join to the census by hash even after removing the "
        f"known post-census fields {POST_CENSUS_CONDITION_FIELDS}. Some OTHER producer "
        "change has moved the spec and the divergence is no longer explained.\n"
        f"  reproduced (today)          : {artifact['spec_hash']}\n"
        f"  reproduced (census-era body): {_spec_hash(census_era_body)}\n"
        f"  census                      : {census_spec['spec_hash']}"
    )


# ── PASSING CONTROL 6 — the neighbour keeps its route ────────────────────────
def test_unrelated_genuine_structure_condition_retains_the_structure_route():
    """THE CONTROL AGAINST A FALSE REPAIR.

    A genuine break-of-structure condition, from a different video, driven
    through the same production chain, must KEEP routing to the structure
    primitive. `A FIX THAT TURNS THE TARGET GREEN BY BREAKING A NEIGHBOUR IS THE
    CLASSIC FALSE REPAIR` (R-728 §4) — and nothing else in this contract catches
    it. This control must stay GREEN through B1 STEPS 3-6.
    """
    _, artifact, _, by_id = _produce(NEIGHBOUR_STUB)

    ids = [c["id"] for c in artifact["spec"]["entry_conditions"]]
    assert NEIGHBOUR_CONDITION_ID in ids, (
        f"the neighbour control's condition is not in the produced graph; found {ids}"
    )
    binding = by_id[NEIGHBOUR_CONDITION_ID]
    assert "break of structure" in binding.object.lower(), (
        "the neighbour control must be a GENUINE structure condition, and this one no "
        f"longer reads as one: {binding.object!r}"
    )
    assert binding.bindable is True
    assert binding.primitive == STRUCTURE_PRIMITIVE, (
        "REGRESSION: an unrelated genuine structure condition lost its structure route.\n"
        f"  condition : {NEIGHBOUR_CONDITION_ID}\n"
        f"  expected  : {STRUCTURE_PRIMITIVE}\n"
        f"  actual    : {binding.primitive}"
    )


# ── PERMANENT RED 1 — the classification handoff ─────────────────────────────
def test_production_must_not_type_the_opening_range_definition_as_coarse_structure():
    """PERMANENT RED (expected until B1 STEP 3).

    Production reads the opening-range prose correctly and then seals a type too
    coarse to preserve what it read. An opening range is a TIME-BOUNDED STATEFUL
    AGGREGATION THAT PRODUCES LEVELS; `WAIT_STRUCTURE` can express neither half.
    """
    _, artifact, _, _ = _produce(GOLDEN_STUB)
    condition = _opening_range_condition(artifact)

    assert condition["type"] != COARSE_FAMILY, (
        "PERMANENT RED (expected until B1 STEP 3): production itself collapses the taught "
        "opening-range definition into the coarse structure family.\n"
        f"  produced type : {condition['type']}\n"
        f"  taught object : {condition['object'][:90]}...\n"
        "Required: OPENING_RANGE_DEFINITION or an equivalently explicit typed subtype."
    )
    assert "OPENING_RANGE" in condition["type"].upper(), (
        f"the produced type {condition['type']!r} is no longer the coarse family, but it "
        "does not name the opening range either — an equivalently explicit subtype must."
    )


# ── PERMANENT RED 2 — the routing handoff ────────────────────────────────────
def test_production_must_not_route_the_opening_range_definition_to_the_structure_primitive():
    """PERMANENT RED (expected until B1 STEPS 4-6).

    This is the wrong-route assertion R-728 §3 ordered folded into a LIVE test
    rather than parked in a skip. It is also what makes the repair irreversible:
    after B1, deliberately routing the opening-range type back to
    `compute_structure_state` fails HERE, automatically.
    """
    _, artifact, _, by_id = _produce(GOLDEN_STUB)
    condition = _opening_range_condition(artifact)
    binding = by_id.get(condition["id"])

    assert binding is not None, (
        "no binding was emitted for the opening-range condition; this test would otherwise "
        "pass by absence rather than by repair"
    )
    assert binding.bindable is True, (
        "the condition is expected to BIND today — that it binds to the WRONG primitive is "
        f"the defect. Got bindable={binding.bindable!r}"
    )
    assert binding.primitive != STRUCTURE_PRIMITIVE, (
        "PERMANENT RED (expected until B1 STEPS 4-6): production routes the taught opening "
        "range to a market-structure EVENT evaluator. The taught concept is level "
        "CONSTRUCTION over a clock window.\n"
        f"  condition : {condition['id']}\n"
        f"  routes to : {binding.primitive}"
    )


# ── PERMANENT RED 3 — the output contract ────────────────────────────────────
def test_no_typed_opening_range_output_contract_exists_in_production():
    """PERMANENT RED (expected until B1 STEPS 3-4).

    Field/output identity is the load-bearing proof (read, STEP 2). Route
    identity is enforced FIRST inside `_typed_opening_range_fields`, so a
    cosmetic repair that adds opening-range-shaped fields to `StructureState`
    cannot turn this green.
    """
    _, artifact, _, by_id = _produce(GOLDEN_STUB)
    condition = _opening_range_condition(artifact)
    binding = by_id.get(condition["id"])
    assert binding is not None, "no binding emitted; this test proves nothing without one"

    produced = _typed_opening_range_fields(binding.primitive)
    missing = [f for f in REQUIRED_OR_FIELDS if f not in produced]

    assert not missing, (
        "PERMANENT RED (expected until B1 STEPS 3-4): no typed opening-range output "
        "contract is reachable from the production binding.\n"
        f"  bound primitive : {binding.primitive}\n"
        f"  fields required : {list(REQUIRED_OR_FIELDS)}\n"
        f"  fields produced : {sorted(produced) or '(none)'}\n"
        f"  fields missing  : {missing}"
    )


# ── DISCRIMINATOR — the route gate itself must be able to refuse ─────────────
def test_route_identity_gate_refuses_the_structure_primitive_whatever_fields_it_gains():
    """The anti-generosity gate is itself red-proofed.

    Without this, `_typed_opening_range_fields` could return an empty set for a
    reason that has nothing to do with route identity, and the removal of the
    generosity would be an untested claim. Here the structure primitive is asked
    directly and must yield NOTHING — and the same helper is shown to be capable
    of returning fields for a primitive that does carry them, so an empty result
    is a refusal rather than a helper that always returns empty.
    """
    assert _typed_opening_range_fields(STRUCTURE_PRIMITIVE) == set(), (
        "the route-identity gate admitted the structure primitive; the generosity R-728 §2 "
        "ordered removed is still present"
    )

    # POSITIVE WITNESS that the helper can return fields at all: a real,
    # resolvable primitive whose return annotation carries named fields. Without
    # this, `== set()` above is satisfied by a helper that never returns anything.
    witness = _typed_opening_range_fields("bias_native.compute_bias_signal")
    assert witness, (
        "the helper returned nothing for a resolvable primitive with an annotated return "
        "contract, so it cannot discriminate and the assertion above is vacuous"
    )
