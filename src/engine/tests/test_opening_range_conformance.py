"""B1 STEP 2 — PERMANENT RED: the golden slice's opening-range condition cannot
produce typed opening-range state through production.

AUTHORITY: R-727 §4, executing `EXTERNAL-READ-2026-08-09-B1-AUTHORIZED.md` STEP 2.

WHAT THIS TEST IS
-----------------
It starts from the REAL FROZEN EXTRACTION ARTIFACT — not a hand-built binding —
and asserts that production can return, for the taught opening-range condition:

    typed OR high · typed OR low · width · midpoint · completion state ·
    complete-window status

Today it CANNOT, because the condition routes to
`structure_engine.compute_structure_state`, whose 15 output fields contain none
of them. **This test is EXPECTED TO FAIL until B1 STEPS 3-4 land.** That is its
purpose: it is the permanent RED that a repair must turn GREEN.

WHAT THIS TEST DELIBERATELY DOES *NOT* ASSERT
---------------------------------------------
- It does NOT assert that structural output stays numerically unchanged
  (the read forbids that, and R-726 §1 withdrew the behavioural claim it rested on).
- It does NOT decide the breakout trigger. Whether a breakout is a wick, a touch
  or a close is `UNRESOLVED_SOURCE_AMBIGUITY` (R-725 §4) and B1 may not settle it.
- It makes NO claim about the other 8 conditions or the other 10 specs.

PATH TO RED AFTER THE REPAIR (read, STEP 2, verbatim requirement)
----------------------------------------------------------------
Once the typed opening-range route exists, deliberately routing it back to
`structure_engine.compute_structure_state` MUST fail this test. That mutation is
recorded in `test_repaired_route_sent_back_to_structure_engine_must_fail` below,
which is skipped until the repaired route exists — a skip that NAMES what it is
waiting for rather than passing silently.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.engine.spec_family_bindings import bind_condition

# ── The frozen real artifact. Not constructed here. ──────────────────────────
REPO_ROOT = Path(__file__).resolve().parents[3]
CENSUS = REPO_ROOT / "docs/replay-results/h1-battery/tier-a-compile-census.json"
GOLDEN_STUB = "st5e-YJRfKc__s0"
OR_DEFINING_CONDITION_ID = "WAIT_STRUCTURE:once-you-take-the-price-that-s-establish#0"

# The six typed fields the taught concept requires. Named here so a reader sees
# the contract without running anything.
REQUIRED_OR_FIELDS = (
    "opening_range_high",
    "opening_range_low",
    "opening_range_width",
    "opening_range_midpoint",
    "opening_range_complete",
    "opening_range_window_status",
)


def _load_golden_condition() -> dict:
    """The real condition, read out of the committed census artifact."""
    data = json.loads(CENSUS.read_text(encoding="utf-8"))
    spec = next(s for s in data["specs"] if s["stub"] == GOLDEN_STUB)
    cond = next(c for c in spec["conditions"] if c["condition_id"] == OR_DEFINING_CONDITION_ID)
    return cond


def test_frozen_artifact_is_present_and_is_the_one_we_think():
    """Positive control for the whole file: if this fails, every assertion below
    is about the wrong object and the reds mean nothing."""
    assert CENSUS.exists(), f"frozen census artifact missing: {CENSUS}"
    cond = _load_golden_condition()
    assert cond["type"] == "WAIT_STRUCTURE"
    assert cond["role"] == "spine"
    assert cond["load_bearing_spine"] is True
    # The taught text really is the opening-range definition.
    assert "first 5, 15, and the 30 minute ranges" in cond["object"]


def test_production_binding_cannot_produce_typed_opening_range_state():
    """PERMANENT RED (B1 STEP 2).

    The load-bearing proof is FIELD/OUTPUT IDENTITY: bind the real condition
    through the real production entry point and ask whether the resulting
    primitive can yield the six typed opening-range fields.

    Today the binding resolves to `structure_engine.compute_structure_state`,
    which produces bos/choch/mss/swing/premium-discount fields and NO opening
    range. This test therefore fails, by design, until the typed route exists.
    """
    cond = _load_golden_condition()
    binding = bind_condition(
        {
            "id": cond["condition_id"],
            "type": cond["type"],
            "object": cond["object"],
            "role": cond["role"],
        }
    )

    # Witness that the path actually ran and produced a binding at all — a
    # negative assertion needs a positive witness that the path executed.
    assert binding is not None, "binder returned nothing; this test proves nothing"
    assert binding.bindable is True, (
        "the condition is expected to BIND today (that is the defect: it binds to "
        f"the wrong primitive). Got bindable={binding.bindable!r}"
    )

    produced = _typed_opening_range_fields_for(binding)
    missing = [f for f in REQUIRED_OR_FIELDS if f not in produced]

    assert not missing, (
        "PERMANENT RED (expected until B1 STEPS 3-4): production cannot produce typed "
        "opening-range state for the golden slice's opening-range condition.\n"
        f"  bound primitive : {binding.primitive}\n"
        f"  fields required : {list(REQUIRED_OR_FIELDS)}\n"
        f"  fields produced : {sorted(produced) or '(none)'}\n"
        f"  fields missing  : {missing}\n"
        "The condition routes to a market-structure EVENT evaluator; the taught "
        "concept is level CONSTRUCTION over a clock window."
    )


def _typed_opening_range_fields_for(binding) -> set[str]:
    """Which of the required typed OR fields this binding can actually yield.

    Deliberately generous: it inspects the binding object itself AND the output
    contract of the primitive it names. If a future repair exposes the fields by
    either route, this returns them and the RED turns GREEN honestly.
    """
    found: set[str] = set()

    for field in REQUIRED_OR_FIELDS:
        if getattr(binding, field, None) is not None:
            found.add(field)

    primitive = binding.primitive or ""
    if primitive.startswith("structure_engine."):
        # Enumerate the real output contract rather than assuming it.
        from src.engine.context.structure_engine import StructureState

        available = set(getattr(StructureState, "__annotations__", {}))
        found |= {f for f in REQUIRED_OR_FIELDS if f in available}

    return found


@pytest.mark.skip(
    reason="PATH-TO-RED MUTATION, armed at B1 STEP 4: once the typed opening-range "
    "route exists, deliberately routing it back to "
    "structure_engine.compute_structure_state must fail the conformance test. "
    "Skipped because the repaired route does not exist yet — this skip is a "
    "placeholder that NAMES its dependency rather than passing silently."
)
def test_repaired_route_sent_back_to_structure_engine_must_fail():  # pragma: no cover
    raise AssertionError("unreachable until B1 STEP 4 lands")
