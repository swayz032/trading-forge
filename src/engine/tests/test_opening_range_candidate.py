"""B1 STEP 6A — controls for the typed opening-range EXECUTION CANDIDATE.

AUTHORITY: R-738 §3 (the carrier), §7-2 (identity must include `variant_label`),
R-740 §5/§7. Obligations 4, 6, 7 and 11 of the STEP 6 proof list live here.

WHY THIS FILE EXISTS SEPARATELY FROM THE LOWERING SUITE
-------------------------------------------------------
The carrier is PURE DOMAIN: given a definition and one of its taught variants it
must produce a stable identity and nothing else. It has no source evidence, no
file I/O and no market data. Keeping its controls here means a lowering failure
can never be mistaken for an identity failure, and vice versa.

THE CONTROL THAT MATTERS MOST IS `test_cache_identity_is_stable_in_a_separate_process`.
R-738 §8 requirement (11): a uniqueness test and a sensitivity test are BOTH
satisfied by a random identity, and only a stability test excludes it. Python's
`hash()` on a str is salted per process by PYTHONHASHSEED, so an implementation
built on `hash()` passes every other control in this file and fails that one.
"""

from __future__ import annotations

import json
import subprocess
import sys

import pytest

from src.engine.opening_range_candidate import (
    OpeningRangeExecutionCandidate,
    expand_execution_candidates,
)
from src.engine.opening_range_definition import (
    OpeningRangeDefinition,
    OpeningRangeProvenance,
    OpeningRangeVariant,
)

SPEC_ID = "spec-under-test__s0"
CONDITION_ID = "WAIT_STRUCTURE:a-taught-opening-range#0"


def _variant(label: str, minutes: int) -> OpeningRangeVariant:
    return OpeningRangeVariant(
        variant_label=label,
        duration_minutes=minutes,
        source_quote=f"the first {minutes} minute range",
    )


def _definition(*variants: OpeningRangeVariant) -> OpeningRangeDefinition:
    return OpeningRangeDefinition(
        session_start_local="09:30",
        source_timezone="America/New_York",
        variants=tuple(variants),
        market_scope="US equities / S&P 500 example, regular-session opening",
        trading_day_rule="relative for every single trading day",
        provenance=OpeningRangeProvenance(
            source_quote="the first 5, 15, and the 30 minute ranges",
            condition_id=CONDITION_ID,
        ),
    )


THREE_TAUGHT = (_variant("5m", 5), _variant("15m", 15), _variant("30m", 30))


def _candidate(definition: OpeningRangeDefinition, variant: OpeningRangeVariant):
    return OpeningRangeExecutionCandidate(
        source_spec_id=SPEC_ID,
        source_condition_id=CONDITION_ID,
        definition=definition,
        variant=variant,
    )


# ── the carrier's own construction rules (R-738 §3) ──────────────────────────


def test_the_carrier_refuses_a_variant_the_definition_never_taught():
    """A candidate is ONE taught alternative made executable. A variant the
    definition does not carry is an invented duration wearing a valid type."""
    definition = _definition(*THREE_TAUGHT)
    with pytest.raises(ValueError, match="not among the taught variants"):
        _candidate(definition, _variant("45m", 45))


def test_the_carrier_accepts_every_taught_variant_positive_witness():
    """Positive witness for the refusal above: without it, a carrier that
    rejected EVERYTHING would satisfy the negative control."""
    definition = _definition(*THREE_TAUGHT)
    for variant in THREE_TAUGHT:
        assert _candidate(definition, variant).variant is variant


def test_the_carrier_does_not_copy_definition_values_into_flat_fields():
    """R-738 §3: `TWO FIELDS HOLDING ONE FACT ARE A DISAGREEMENT WITH A COMMIT
    DATE.` The candidate must REFERENCE the definition and the variant, never
    restate their contents beside them."""
    definition = _definition(*THREE_TAUGHT)
    candidate = _candidate(definition, THREE_TAUGHT[0])
    forbidden = {
        "duration_minutes",
        "session_start_local",
        "source_timezone",
        "market_scope",
        "trading_day_rule",
        "variant_label",
    }
    own_fields = set(candidate.__dataclass_fields__)
    assert own_fields & forbidden == set(), (
        f"candidate restates definition/variant facts as its own fields: "
        f"{sorted(own_fields & forbidden)}"
    )
    assert candidate.definition is definition


# ── expansion to the taught set (R-740 §3, obligation 1) ─────────────────────


def test_expansion_produces_one_candidate_per_taught_variant_in_taught_order():
    definition = _definition(*THREE_TAUGHT)
    candidates = expand_execution_candidates(SPEC_ID, CONDITION_ID, definition)
    assert [c.variant.variant_label for c in candidates] == ["5m", "15m", "30m"]
    assert [c.variant.duration_minutes for c in candidates] == [5, 15, 30]


def test_expansion_chooses_no_favourite():
    """R-736 §4: the factory makes three bots; it does not guess which one she
    really meant. There is no primary, no default and no ordering by preference."""
    definition = _definition(*THREE_TAUGHT)
    candidates = expand_execution_candidates(SPEC_ID, CONDITION_ID, definition)
    assert len(candidates) == len(definition.variants)
    assert not hasattr(expand_execution_candidates, "default_variant")
    for candidate in candidates:
        assert not getattr(candidate, "is_primary", False)


def test_removing_one_taught_variant_changes_the_expanded_membership():
    """Obligation 5, as a mutation: exact-membership testing must FAIL when a
    candidate goes missing, or it is not testing membership."""
    full = expand_execution_candidates(SPEC_ID, CONDITION_ID, _definition(*THREE_TAUGHT))
    reduced = expand_execution_candidates(
        SPEC_ID, CONDITION_ID, _definition(THREE_TAUGHT[0], THREE_TAUGHT[1])
    )
    assert {c.candidate_id for c in full} != {c.candidate_id for c in reduced}
    assert len(full) == 3 and len(reduced) == 2


# ── identity: sensitivity, uniqueness, and the join key (§7-2) ───────────────


def test_changing_a_duration_changes_candidate_and_cache_identity():
    """Obligation 4."""
    definition = _definition(*THREE_TAUGHT)
    five = _candidate(definition, THREE_TAUGHT[0])
    other = _definition(_variant("5m", 6), THREE_TAUGHT[1], THREE_TAUGHT[2])
    six = _candidate(other, other.variants[0])
    assert five.candidate_id != six.candidate_id
    assert five.cache_identity != six.cache_identity


def test_two_taught_variants_never_share_a_cache_identity():
    """Obligation 6, planted between two GOLDEN variants per R-740 §5."""
    definition = _definition(*THREE_TAUGHT)
    candidates = expand_execution_candidates(SPEC_ID, CONDITION_ID, definition)
    identities = [c.cache_identity for c in candidates]
    assert len(set(identities)) == len(identities), f"cache identity collision: {identities}"


def test_identity_is_keyed_on_the_full_payload_not_on_duration_alone():
    """R-738 §7-2, the LATENT defect the desk pre-registered: the definition's
    uniqueness guard reads `variant_label` ONLY, so two variants with DIFFERENT
    labels and the SAME duration construct legally. Cache identity must still
    separate them, or obligation 6 and that guard cannot both hold.

    This is the control that would go RED on an implementation keyed on
    `duration_minutes`, which is the obvious and wrong choice."""
    definition = _definition(_variant("first-5m", 5), _variant("opening-5m", 5))
    candidates = expand_execution_candidates(SPEC_ID, CONDITION_ID, definition)
    assert len(candidates) == 2
    assert candidates[0].variant.duration_minutes == candidates[1].variant.duration_minutes
    assert candidates[0].cache_identity != candidates[1].cache_identity


def test_identity_separates_two_specs_that_taught_an_identical_window():
    """Two teachers can teach the same 5-minute window. They are different
    candidates and must never share a cache namespace."""
    definition = _definition(*THREE_TAUGHT)
    mine = _candidate(definition, THREE_TAUGHT[0])
    theirs = OpeningRangeExecutionCandidate(
        source_spec_id="another-spec__s0",
        source_condition_id=CONDITION_ID,
        definition=definition,
        variant=THREE_TAUGHT[0],
    )
    assert mine.cache_identity != theirs.cache_identity


def test_identity_is_not_free_form_and_carries_no_video_id():
    """R-738 §9 / the provenance docstring: no video or strategy id is hardcoded
    in production. The identity is a digest, not a human-authored label."""
    candidate = _candidate(_definition(*THREE_TAUGHT), THREE_TAUGHT[0])
    assert len(candidate.cache_identity) == 64
    assert set(candidate.cache_identity) <= set("0123456789abcdef")


def test_canonical_payload_is_order_independent_and_json_serialisable():
    """Never set-iteration, never dict order. Serialising twice must be
    byte-identical within a process before cross-process stability can mean
    anything."""
    candidate = _candidate(_definition(*THREE_TAUGHT), THREE_TAUGHT[0])
    first = json.dumps(candidate.canonical_payload(), sort_keys=True)
    second = json.dumps(candidate.canonical_payload(), sort_keys=True)
    assert first == second


# ── obligation 11: the control only a STABILITY test can enforce ─────────────

_CHILD = """
import json, sys
sys.path.insert(0, {repo!r})
from src.engine.opening_range_candidate import expand_execution_candidates
from src.engine.opening_range_definition import (
    OpeningRangeDefinition, OpeningRangeProvenance, OpeningRangeVariant,
)
variants = tuple(
    OpeningRangeVariant(
        variant_label=label,
        duration_minutes=minutes,
        source_quote="the first %d minute range" % minutes,
    )
    for label, minutes in (("5m", 5), ("15m", 15), ("30m", 30))
)
definition = OpeningRangeDefinition(
    session_start_local="09:30",
    source_timezone="America/New_York",
    variants=variants,
    market_scope="US equities / S&P 500 example, regular-session opening",
    trading_day_rule="relative for every single trading day",
    provenance=OpeningRangeProvenance(
        source_quote="the first 5, 15, and the 30 minute ranges",
        condition_id={condition!r},
    ),
)
candidates = expand_execution_candidates({spec!r}, {condition!r}, definition)
print(json.dumps([[c.candidate_id, c.cache_identity] for c in candidates]))
"""


@pytest.mark.parametrize("hash_seed", ["0", "1", "12345"])
def test_cache_identity_is_stable_in_a_separate_process(tmp_path, hash_seed):
    """R-738 §8 requirement (11), and the ONLY control here that excludes a
    randomised identity.

    `A UNIQUENESS TEST AND A SENSITIVITY TEST ARE BOTH SATISFIED BY RANDOMNESS;
    ONLY A STABILITY TEST EXCLUDES IT.`

    PYTHONHASHSEED is varied deliberately: an identity built on Python's `hash()`
    of any str changes between processes under different seeds, so this
    parametrisation is what makes the control BITE rather than merely run.
    """
    import os

    repo = os.getcwd()
    script = tmp_path / "child_identity.py"
    script.write_text(
        _CHILD.format(repo=repo, spec=SPEC_ID, condition=CONDITION_ID),
        encoding="utf-8",
    )

    def run(seed: str) -> list[list[str]]:
        env = dict(os.environ, PYTHONHASHSEED=seed)
        completed = subprocess.run(
            [sys.executable, str(script)],
            capture_output=True,
            text=True,
            env=env,
            cwd=repo,
            check=False,
        )
        assert completed.returncode == 0, completed.stderr
        return json.loads(completed.stdout)

    in_process = [
        [c.candidate_id, c.cache_identity]
        for c in expand_execution_candidates(SPEC_ID, CONDITION_ID, _definition(*THREE_TAUGHT))
    ]
    child = run(hash_seed)
    assert child == in_process, (
        "candidate/cache identity changed across processes "
        f"(PYTHONHASHSEED={hash_seed}) — the identity is not derived from the "
        "canonical payload"
    )


def test_the_separate_process_control_can_actually_fail(tmp_path):
    """POSITIVE CONTROL for the stability test above.

    A stability assertion that compares a value against itself passes for a
    broken implementation too. This proves the child process, the seed plumbing
    and the comparison DO surface a difference when one exists — by asking the
    child for a deliberately different candidate set."""
    import os

    repo = os.getcwd()
    script = tmp_path / "child_divergent.py"
    script.write_text(
        _CHILD.format(repo=repo, spec="a-different-spec__s0", condition=CONDITION_ID),
        encoding="utf-8",
    )
    completed = subprocess.run(
        [sys.executable, str(script)],
        capture_output=True,
        text=True,
        env=dict(os.environ, PYTHONHASHSEED="7"),
        cwd=repo,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    child = json.loads(completed.stdout)
    in_process = [
        [c.candidate_id, c.cache_identity]
        for c in expand_execution_candidates(SPEC_ID, CONDITION_ID, _definition(*THREE_TAUGHT))
    ]
    assert child != in_process, (
        "the cross-process harness reported agreement for two DIFFERENT candidate "
        "sets — it cannot detect instability either"
    )
