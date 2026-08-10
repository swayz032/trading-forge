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

import hashlib
import json
from pathlib import Path
from typing import get_type_hints

from src.engine.extraction.spec_producer import produce_spec_artifact
from src.engine.family_meta_enforcement import (
    FamilyMetaEnforcementError,
    resolve_primitive,
)
from src.engine.opening_range_definition import CANONICAL_TYPE as OPENING_RANGE_DEFINITION
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

# THE AUTHORIZED TWO-MEMBER POPULATION (R-732 §2). Naming the frozen members
# HERE is correct and naming them in production code is not:
# `AN ID IN PRODUCTION CODE IS A CLASSIFIER THAT HAS MEMORISED ITS ANSWER; AN ID
# IN A TEST IS A POPULATION ASSERTION.` The rule stays general so it cannot be
# fitted to a video; this pins the measured population so a silent third member
# cannot slip in unnoticed.
SECOND_STUB = "dENM6gt8ZRg__s0"
SECOND_OR_PROSE = "The first five-minute candle"
AUTHORIZED_RETYPED_CONDITIONS: set[tuple[str, str]] = {
    (GOLDEN_STUB, "WAIT_STRUCTURE:once-you-take-the-price-that-s-establish#0"),
    (SECOND_STUB, "WAIT_STRUCTURE:the-first-five-minute-candle-from-09-30#0"),
}

# The refusal every opening-range definition must carry until STEP 4 lands.
EXPECTED_REFUSAL = "opening_range_adapter_not_implemented"


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


def _opening_range_condition(artifact: dict, prose: str = OR_PROSE) -> dict:
    """The produced condition that carries the taught opening-range definition.

    Selected BY ITS TAUGHT PROSE, never by a type or a frozen condition id.
    Selecting it by type would assume the very classification this file exists to
    check — and it would silently follow the type wherever a future edit moved it,
    which is how a conformance test stops testing anything.
    """
    matches = [c for c in artifact["spec"]["entry_conditions"] if prose in c.get("object", "")]
    assert len(matches) == 1, (
        f"expected exactly one produced condition carrying the taught opening-range "
        f"prose {prose!r}; found {len(matches)}. Without exactly one, every "
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
def test_census_shows_exactly_the_two_authorized_classification_changes():
    """THE EXACT-DELTA CONTROL — converted from equality IN THE SAME COMMIT that
    moved the classification (R-730 §3, widened R-732 §3).

    ★ The conversion order is the point. The census records the KNOWN-BAD
    historical classification, so once production is fixed production MUST NO
    LONGER EQUAL IT. `A CONTROL THAT MUST BREAK WHEN THE FIX LANDS IS NOT A
    FAILING CONTROL — BUT ONLY IF YOU CONVERT IT BEFORE IT BREAKS. CONVERTED
    AFTERWARDS, IT IS INDISTINGUISHABLE FROM WEAKENING A TEST THAT CAUGHT YOU.`

    🛑 The known-wrong census is NOT edited. It stays as the record of what was
    wrong; editing it to match the fix would destroy the only evidence that
    anything was repaired.

    What "exact delta" means here, by member and never by count:
      - EXACTLY the two authorized conditions change type;
      - their mechanically derived condition IDs change, and the change is
        MAPPED and identified rather than suppressed;
      - their source prose, role and ordering are preserved;
      - every other condition, in every spec of the census, is identical.
    """
    census = json.loads(CENSUS.read_text(encoding="utf-8"))
    changes: list[tuple[str, str, str, str]] = []

    for census_spec in census["specs"]:
        stub = census_spec["stub"]
        _, artifact, _, _ = _produce(stub)
        produced = artifact["spec"]["entry_conditions"] + artifact["spec"]["invalidations"]
        census_conditions = census_spec["conditions"]

        assert len(produced) == len(census_conditions), (
            f"{stub}: produced {len(produced)} conditions, census recorded "
            f"{len(census_conditions)} — ORDERING or membership moved, which is never authorized"
        )

        for produced_condition, census_condition in zip(produced, census_conditions):
            # Source prose and role are preserved for EVERY condition, changed or not.
            assert produced_condition["object"] == census_condition["object"], (
                f"{stub}: source prose changed for {census_condition['condition_id']} — "
                "the classification may move, the taught text may never move"
            )
            assert produced_condition["role"] == census_condition["role"], (
                f"{stub}: role changed for {census_condition['condition_id']}"
            )

            if produced_condition["type"] == census_condition["type"]:
                # Unchanged member: its derived id must be identical too.
                assert produced_condition["id"] == census_condition["condition_id"], (
                    f"{stub}: type is unchanged but the derived condition id moved — "
                    f"{census_condition['condition_id']} -> {produced_condition['id']}"
                )
                continue

            # A CHANGED member. Record it; the authorized set is checked below.
            changes.append(
                (stub, census_condition["condition_id"], census_condition["type"],
                 produced_condition["type"])
            )

            # THE ID CHANGE IS MAPPED, NOT SUPPRESSED (R-732 §3). The producer
            # derives `id` as f"{family}:{slug}#{idx}", so re-typing necessarily
            # moves the id. That is mechanical and must be shown to be ONLY the
            # family prefix — a slug or index change would mean the prose or the
            # ordering moved, which is a different and unauthorized event.
            expected_id = census_condition["condition_id"].replace(
                census_condition["type"] + ":", produced_condition["type"] + ":", 1
            )
            assert produced_condition["id"] == expected_id, (
                f"{stub}: the derived condition id did not change MECHANICALLY.\n"
                f"  census   : {census_condition['condition_id']}\n"
                f"  expected : {expected_id}  (family prefix swap only)\n"
                f"  produced : {produced_condition['id']}\n"
                "A slug or index difference means the prose or ordering moved, not just the type."
            )

    observed = {(stub, cid) for stub, cid, _, _ in changes}
    assert observed == AUTHORIZED_RETYPED_CONDITIONS, (
        "the census delta is not EXACTLY the authorized two-member population.\n"
        f"  authorized but unchanged : {sorted(AUTHORIZED_RETYPED_CONDITIONS - observed)}\n"
        f"  changed but UNAUTHORIZED : {sorted(observed - AUTHORIZED_RETYPED_CONDITIONS)}\n"
        "R-732 §2: a third member STOPS. The stop is not spent by being honoured once."
    )
    for _stub, _cid, was, now in changes:
        assert was == COARSE_FAMILY and now == OPENING_RANGE_DEFINITION, (
            f"an authorized member moved {was} -> {now}; the only authorized transition is "
            f"{COARSE_FAMILY} -> {OPENING_RANGE_DEFINITION}"
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


# ── GREEN (B1 STEP 3 landed) — the classification handoff is repaired ────────
def test_both_genuine_definitions_receive_the_explicit_opening_range_type():
    """STEP 3's central claim, asserted on BOTH authorized members (R-732 §2).

    Production used to read the opening-range prose correctly and then seal a
    type too coarse to preserve what it read. An opening range is a TIME-BOUNDED
    STATEFUL AGGREGATION THAT PRODUCES LEVELS; `WAIT_STRUCTURE` expresses neither
    half. Both frozen definitions must now carry the explicit type, with their
    taught prose and role untouched.
    """
    for stub, prose in ((GOLDEN_STUB, OR_PROSE), (SECOND_STUB, SECOND_OR_PROSE)):
        _, artifact, _, _ = _produce(stub)
        condition = _opening_range_condition(artifact, prose)
        assert condition["type"] == OPENING_RANGE_DEFINITION, (
            f"{stub}: the taught opening-range definition is typed {condition['type']!r}, "
            f"not {OPENING_RANGE_DEFINITION!r}"
        )
        # The classification moved; the taught meaning did not.
        assert prose in condition["object"]
        assert condition["role"] == "spine"
        assert condition["id"].startswith(OPENING_RANGE_DEFINITION + ":")


def test_reference_and_anaphoric_sentences_did_not_move():
    """THE OTHER HALF OF THE CLASSIFICATION CLAIM, and the one that protects the
    campaign's open question.

    The breakout sentence carries BOTH a clock and range language, so a naive
    conjunction would have captured it — and typing it as anything would have let
    STEP 3 quietly decide the breakout trigger, which is
    `UNRESOLVED_SOURCE_AMBIGUITY` (R-725 §4) and not ours to settle. The
    anaphoric sentence carries no typed duration of its own.

    Both must remain exactly where they were. `A CLEARER TEACHER DOES NOT RESOLVE
    A DIFFERENT TEACHER'S SILENCE.`
    """
    _, artifact, _, _ = _produce(GOLDEN_STUB)
    by_prose = {c["object"]: c for c in artifact["spec"]["entry_conditions"]}

    unmoved = {
        "breakout/reference": "we look for a breakout",
        "anaphoric clock": "in between these time",
    }
    for label, marker in unmoved.items():
        matches = [c for text, c in by_prose.items() if marker in text]
        assert len(matches) == 1, f"expected exactly one {label} sentence, found {len(matches)}"
        condition = matches[0]
        assert condition["type"] == COARSE_FAMILY, (
            f"the {label} sentence moved to {condition['type']!r}. It refers to an "
            "already-constructed range; it does not define one, and re-typing it would "
            "decide a question this step may not touch."
        )


# ── DURABLE INVARIANTS 3 and 4 (R-779 §7-b), landed in the activation commit ──
def test_the_declared_opening_range_primitive_resolves_to_the_real_adapter():
    """DURABLE INVARIANT 3 (R-779 §7-b): the declared primitive resolves to the real
    adapter — not to a stub, not to the structure engine, not to nothing.

    ★ WHY THIS IS NOT COVERED BY THE PARITY FIXTURE: that one proves the two
    DECLARATION surfaces agree with each other. Two surfaces can agree perfectly on a
    string that points at nothing. This asserts the string is a live pointer to the
    module that does the arithmetic. `A DECLARATION AND THE CODE IT NAMES ARE TWO
    CLAIMS, AND ONLY ONE OF THEM IS CHECKED BY SPELLING.`

    🛑 ASSERTION ORDER IS PART OF THE VERDICT (R-782 §1, campaign law): the activation
    witness is asserted FIRST. A failure at that line means the family was never
    transitioned; a failure BELOW it means the pointer is genuinely broken. Without the
    ordering both read as one undifferentiated red.
    """
    from src.engine.opening_range_adapter import compute_opening_range_state
    from src.engine.spec_family_bindings import FAMILY_META

    declared = FAMILY_META[OPENING_RANGE_DEFINITION].primitive
    assert declared is not None, (
        "OPENING_RANGE_DEFINITION declares no primitive — the family has not been "
        "activated. This is the WITNESS, not the claim: nothing below can be read."
    )

    resolved = resolve_primitive(declared)
    assert resolved is compute_opening_range_state, (
        f"the declared primitive {declared!r} resolves to {resolved!r}, not to the real "
        "adapter opening_range_adapter.compute_opening_range_state."
    )


def test_the_declared_opening_range_primitive_has_an_enforced_dispatch_route():
    """DURABLE INVARIANT 4 (R-779 §7-b): the declared primitive exists in
    ENFORCED_DISPATCH.

    This is pin (a)'s obligation stated as its own fixture rather than left to the
    load-time checker: `family_meta_enforcement.verify_dispatch_coverage()` proves set
    equality in BOTH directions, so a declared name with no route is an UNROUTABLE
    POINTER and a route nothing declares is a SECOND ROUTER.

    ⚖️ R-782 §4 measured that this surface has TWO load-bearing halves pinned by two
    different committed tests — the KEY (pin (a), family_meta_enforcement.py:486-494)
    and the VALUE (test_parameter_acceptance_guard.py's `assert classified == routed`).
    This fixture pins the KEY half against the family that owns it, so the obligation
    is visible from the opening-range suite and not only from the enforcement suite.
    """
    from src.engine.spec_condition_compiler import ENFORCED_DISPATCH
    from src.engine.spec_family_bindings import FAMILY_META

    declared = FAMILY_META[OPENING_RANGE_DEFINITION].primitive
    assert declared is not None, (
        "OPENING_RANGE_DEFINITION declares no primitive — the family has not been "
        "activated. WITNESS, not the claim."
    )
    assert declared in ENFORCED_DISPATCH, (
        f"the declared primitive {declared!r} has NO ENFORCED_DISPATCH entry. Under "
        "pin (a) that is an unroutable pointer and the load-time check fails."
    )


# ── TRANSITIONED — the definitions now BIND, and still never reach structure ──
def test_both_definitions_bind_to_the_opening_range_primitive_and_neither_reaches_structure():
    """TRANSITIONED (R-779 §7-b, authorized R-783 §6). Formerly
    `test_both_definitions_refuse_deliberately_and_neither_reaches_the_structure_evaluator`.

    WHAT MOVED AND WHAT DID NOT. The retired half is the REFUSAL: this used to assert
    `bindable is False`, `primitive is None`, `reason == "opening_range_adapter_not_
    implemented"` — the deliberately temporary off-state B1 STEP 3 shipped. That state
    is what the activation exists to end, so pinning it would block the work it was
    written to protect.

    🛑 THE HALF THAT DID NOT MOVE IS THE ONE THAT PROTECTS THE MONEY PATH, and it is
    now STRONGER rather than merely preserved. R-730 §4 forbids this family ever
    falling back to `structure_engine.compute_structure_state`. Under the old refusal
    that was cheap — a family with no primitive cannot fall back to anything. Now the
    family is switched on and a fallback is genuinely POSSIBLE, so the assertion is
    doing real work for the first time. `SAFETY BY STARVATION IS NOT SAFETY BY DESIGN`
    (R-780 §4) applies to the GUARD as much as to the code it guards.

    R-731 §4's bar still binds and is unchanged: a crash, a missing dictionary entry or
    an accidental exception is not an acceptable outcome. The binding must be a value
    production DELIBERATELY returns.
    """
    from src.engine.spec_family_bindings import FAMILY_META

    declared = FAMILY_META[OPENING_RANGE_DEFINITION].primitive
    assert declared is not None, (
        "OPENING_RANGE_DEFINITION declares no primitive — the family has not been "
        "activated. WITNESS: nothing below this line can be read as a verdict."
    )
    assert "structure_engine" not in declared, (
        f"the declared primitive {declared!r} names the structure engine — the exact "
        "fallback R-730 §4 forbids."
    )
    for stub, prose in ((GOLDEN_STUB, OR_PROSE), (SECOND_STUB, SECOND_OR_PROSE)):
        _, artifact, _, by_id = _produce(stub)  # returns; an exception here fails the test
        condition = _opening_range_condition(artifact, prose)
        binding = by_id.get(condition["id"])

        # UNCHANGED from the pre-transition fixture, and deliberately so: R-731 §4's bar
        # excludes the cheap version — a crash or a missing dictionary entry is not an
        # acceptable outcome in EITHER regime. This assertion never depended on the
        # refusal and is carried across the transition byte-for-byte in meaning.
        assert binding is not None, (
            f"{stub}: NO binding object was emitted for the opening-range definition. "
            "A missing dictionary entry is not an outcome — the binding must be a thing "
            "the code MEANS, reachable and observable."
        )
        assert binding.bindable is True, (
            f"{stub}: the activated opening-range definition is still unbindable "
            f"(reason={binding.reason!r}). Activation removes the unsupported shield; if "
            "this fires, FAMILY_META moved but the binder did not follow."
        )
        assert binding.primitive == declared, (
            f"{stub}: the binding names {binding.primitive!r} but the family declares "
            f"{declared!r}. The binder and the declaration must name ONE primitive — two "
            "spellings of the same route is the drift pin (a) exists to catch."
        )
        # THE MONEY-PATH GUARD, unchanged in intent and now genuinely load-bearing:
        # pre-activation this could not fail (no primitive at all); post-activation a
        # fallback is reachable, so this is the first regime in which it can bite.
        assert binding.primitive != STRUCTURE_PRIMITIVE, (
            f"{stub}: the opening-range definition reached the structure evaluator — the "
            "exact fallback R-732 §3 and R-730 §4 forbid"
        )


# ── PERMANENT RED — no executable adapter yet (expected until B1 STEP 4) ─────
def test_no_production_binding_routes_to_the_opening_range_adapter_yet():
    """PERMANENT RED (expected until B1 STEP 6).

    R-732 §3: `A TRANSITION RULING THAT LISTS ONLY WHAT TURNS GREEN IS A
    COMPLETION CLAIM IN DISGUISE.` STEP 3 typed the concept and made it refuse;
    it did NOT make it computable.

    RENAMED at R-736 §3 (STEP 4 closeout) — NAME AND MESSAGE ONLY, THE ASSERTION
    IS BYTE-UNCHANGED. The old name, `test_no_executable_opening_range_adapter_
    exists_yet`, became FALSE the moment `src/engine/opening_range_adapter.py`
    landed: the executable adapter DOES exist and is proven by 21 controls. What
    is still absent is the PRODUCTION BINDING — `FAMILY_META` deliberately keeps
    `unsupported=True` through STEPS 4-5, so nothing routes to the adapter yet.
    `A CAPTION IS A CLAIM`, and a test whose name asserts something untrue is a
    false claim that every future reader would trust.

    ★ AND THE STAGE MOVED, NOT THE BAR: R-736 §1 WITHDREW STEP 4's claim on this
    test, because a stub that registers and annotates would satisfy it while
    computing nothing. It belongs to STEP 6, where deterministic variant
    expansion must prove the golden candidates ACTUALLY CALL the adapter.
    """
    _, artifact, _, by_id = _produce(GOLDEN_STUB)
    condition = _opening_range_condition(artifact)
    binding = by_id[condition["id"]]

    assert binding.bindable is True and binding.primitive is not None, (
        "PERMANENT RED (expected until B1 STEP 6): the opening-range definition is typed, "
        "refuses correctly, and an executable adapter now EXISTS — but no production binding "
        "routes to it, so the golden slice still cannot compute an opening range.\n"
        f"  condition : {condition['id']}\n"
        f"  bindable  : {binding.bindable}\n"
        f"  primitive : {binding.primitive}\n"
        f"  reason    : {binding.reason}"
    )


# ── PERMANENT RED 3 — the output contract ────────────────────────────────────
def test_no_typed_opening_range_output_contract_exists_in_production():
    """PERMANENT RED (expected until B1 STEP 6).

    Field/output identity is the load-bearing proof (read, STEP 2). Route
    identity is enforced FIRST inside `_typed_opening_range_fields`, so a
    cosmetic repair that adds opening-range-shaped fields to `StructureState`
    cannot turn this green.

    STAGE CORRECTED at R-736 §3 — DOCSTRING ONLY, ASSERTION UNCHANGED. This read
    "expected until B1 STEPS 3-4"; R-736 §1 withdrew STEP 4's claim on it, since
    this test reads a RETURN ANNOTATION and never invokes the primitive, so a
    module that returns `refused_state()` unconditionally would turn it green.
    The name remains accurate — no typed output contract IS reachable from the
    production binding — so only the stage reference moved.
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
