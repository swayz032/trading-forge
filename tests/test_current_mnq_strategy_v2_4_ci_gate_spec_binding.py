"""Bind every CI gate literal to the spec it asserts against.

THREE TIMES IN ONE DAY a v2.4 CI gate was red because a correction renamed a value and the
gate reading it was never updated. All three landed in the same eight-minute correction wave
on 2026-08-20 (23:45-23:58) and all three left a string that existed in EXACTLY ONE place in
the repository - the gate itself:

  1. `_range_room_authorization` stopped passing prior-close maps  (eedebc75, 23:46:27)
     -> a test demanded them; retired in 60878ce3.
  2. the calibration generator's review status was renamed
     TRADER_FIDELITY_CALIBRATION_* -> AUTOMATED_FIDELITY_REGRESSION_*  (e5dca546, 23:58:53)
     -> the replay-lab gate still demanded the old name; fixed in fe13464f.
  3. the spec's candlestick role was renamed
     ..._AT_ZONE_... -> ..._AT_SR_OR_FVG_...  (81c94fc5, 23:49:16)
     -> the zone-candle gate still demands AT_ZONE. That is what this file was written for.

The third one had been MASKED: the same CI job ran pytest first, that step failed on the
orphaned premarket test, and CI never reached the contract step. Fixing the first failure
revealed the second. It was never caused by the fix - `git archive` at 9cef0d1b shows the
spec already read AT_SR_OR_FVG before any of today's work.

Patching a third literal would be the same instance-not-class mistake that produced eight
false-greens in the evidence-registry work. So this test does not check one string: it PARSES
the gate's own assertions out of the workflow YAML and checks EVERY literal against the spec
the gate loads. A rename on either side, in any of these fields, reds here - locally, in
seconds, instead of in CI minutes later behind whatever else fails first.
"""
from __future__ import annotations

import io
import re

import pytest

from research.current_mnq_strategy_v2_4_policy import (
    load_edge_spec,
    load_fvg_spec,
    load_key_level_spec,
    load_spec,
)

WORKFLOW = ".github/workflows/current-mnq-strategy-v2-4-zone-candle-gates.yml"

# The gate binds these single-letter names to these loaders.
LOADERS = {
    "p": load_spec,
    "f": load_fvg_spec,
    "e": load_edge_spec,
    "k": load_key_level_spec,
}

# assert p['a']['b']=='LITERAL'   /   assert e['gates']['x']==0.05   /   ... is True
ASSERT_RE = re.compile(
    r"^\s*assert\s+([pfek])((?:\['[^']+'\])+)\s*==\s*'([^']*)'\s*$", re.M
)

# assert 'TOKEN' in p['a']['b']  -- a SECOND assertion form. The first version of this
# guard only parsed `==` and therefore missed a live drift:
# REQUIRE_SUSTAINED_INTRA_CANDLE_DIRECTIONAL_FORCE was renamed to
# ..._FROM_CAUSAL_1M_RECONSTRUCTION (the operator's 1m-reconstruction rule) and the gate
# still asserted membership of the short name. A parser that covers one syntax is itself
# an instance fix.
MEMBER_RE = re.compile(
    r"^\s*assert\s+'([^']+)'\s+in\s+([pfek])((?:\['[^']+'\])+)\s*$", re.M
)


@pytest.fixture(scope="module")
def workflow_text() -> str:
    return io.open(WORKFLOW, encoding="utf-8").read()


def _walk(obj, keys: list[str]):
    for k in keys:
        obj = obj[k]
    return obj


def _string_assertions(text: str):
    for m in ASSERT_RE.finditer(text):
        var, path, expected = m.group(1), m.group(2), m.group(3)
        keys = re.findall(r"\['([^']+)'\]", path)
        yield var, keys, expected


def _membership_assertions(text: str):
    for m in MEMBER_RE.finditer(text):
        token, var, path = m.group(1), m.group(2), m.group(3)
        yield var, re.findall(r"\['([^']+)'\]", path), token


def test_every_gate_membership_assertion_names_a_real_spec_member(workflow_text):
    """The `in` form. On a list, `in` is exact-element membership, so a renamed member
    fails silently as far as any `==` parser is concerned."""
    found = list(_membership_assertions(workflow_text))
    assert found, "no membership assertions parsed - the regex has drifted"
    missing = []
    for var, keys, token in found:
        try:
            container = _walk(LOADERS[var](), keys)
        except (KeyError, TypeError):
            missing.append(f"{var}{keys}: PATH MISSING (gate expects member {token!r})")
            continue
        if token not in container:
            near = [x for x in container if isinstance(x, str) and x.startswith(token)]
            hint = f" - did it become {near[0]!r}?" if len(near) == 1 else ""
            missing.append(f"{var}{keys}: {token!r} is not a member{hint}")
    assert not missing, (
        "CI gate membership assertions name values the spec no longer has: "
        + "; ".join(missing)
    )


def test_every_gate_string_literal_matches_the_spec_it_asserts(workflow_text):
    """The class fix. Not one string - every string the gate compares to a spec value."""
    found = list(_string_assertions(workflow_text))
    assert found, "no string assertions parsed - the regex has drifted from the workflow"

    mismatches: list[str] = []
    for var, keys, expected in found:
        spec = LOADERS[var]()
        try:
            actual = _walk(spec, keys)
        except (KeyError, TypeError):
            mismatches.append(
                f"{var}{''.join('[' + k + ']' for k in keys)}: PATH MISSING from the spec "
                f"(gate expects {expected!r})"
            )
            continue
        if actual != expected:
            mismatches.append(
                f"{var}{''.join('[' + k + ']' for k in keys)}: gate expects {expected!r}, "
                f"spec says {actual!r}"
            )

    assert not mismatches, (
        "CI gate literals have drifted from the specs they assert against:\n  "
        + "\n  ".join(mismatches)
        + "\n\nThis is the third occurrence of this exact failure class. Update whichever "
          "side carries the SUPERSEDED meaning - normally the gate, since the spec is where "
          "trader corrections land first."
    )


def test_the_third_rename_specifically_is_closed(workflow_text):
    """A named regression test for the instance that prompted the class fix, so the story
    is not lost if the parser above is ever narrowed."""
    assert "CONFIRMATION_AND_BUYER_SELLER_CONTROL_AT_ZONE_NOT_STANDALONE_SIGNAL" not in \
        workflow_text, "the pre-correction AT_ZONE role name is back in the gate"
    role = load_spec()["candlestick_semantics"]["role"]
    assert role == "CONFIRMATION_AND_BUYER_SELLER_CONTROL_AT_SR_OR_FVG_NOT_STANDALONE_SIGNAL"
    assert role in workflow_text, "the gate no longer asserts the corrected role at all"


def test_the_parser_is_not_silently_matching_nothing(workflow_text):
    """Positive control. A regex that stops matching turns this whole file green while
    checking nothing - the same shape as an ffmpeg flag that silences its own output."""
    found = list(_string_assertions(workflow_text))
    assert len(list(_membership_assertions(workflow_text))) >= 1, (
        "no membership assertions parsed; the second syntax is going unchecked again"
    )
    assert len(found) >= 8, (
        f"only {len(found)} string assertions parsed from the gate; the workflow or the "
        f"regex changed and this guard may be inspecting almost nothing"
    )
    # And the parser must actually reject a planted mismatch.
    planted = workflow_text.replace(
        "assert p['release_id']=='MNQ-V2.4-ZONE-CANDLE-PC3-FORCE1'",
        "assert p['release_id']=='DEFINITELY-NOT-THE-RELEASE'",
    )
    assert planted != workflow_text, "the planted-control anchor is no longer in the gate"
    bad = [
        (v, k, e) for v, k, e in _string_assertions(planted)
        if e == "DEFINITELY-NOT-THE-RELEASE"
    ]
    assert bad, "the parser did not pick up the planted assertion"
    var, keys, expected = bad[0]
    assert _walk(LOADERS[var](), keys) != expected, "the planted mismatch was not detected"
