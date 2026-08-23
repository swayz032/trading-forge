"""The Story advertises twelve states and carries four varying bits. Pin that.

`analyse()` is pure and is tested directly, including the positive witness that it CAN report a
separating field -- without which "0 separating" only proves it never fires. `collect()` re-runs
the X-ray over 14 sessions and is slow, so the measured corpus is checked against the committed
artifact rather than recomputed on every suite run.
"""
from __future__ import annotations

import io
import json
from pathlib import Path

import pytest

from research import current_mnq_strategy_v2_4_story_information_content as S

ARTIFACT = Path("research/current_mnq_strategy_v2_4_story_information_content_2026_08_22.json")


def _row(wanted, **flags):
    r = {"session": "2026-01-01", "wanted": wanted, "quality": 0.8, "confluence": 0.0}
    r.update({f: False for f in S.STORY_FIELDS})
    r.update(flags)
    return r


def test_analyse_FINDS_a_separating_field():
    """POSITIVE WITNESS. A field true for every wanted case and false for every unwanted one."""
    rows = [_row(True, rejection=True) for _ in range(3)] + [_row(False) for _ in range(3)]
    a = S.analyse(rows)
    assert "rejection" in a["separating_fields"], a["fields"]["rejection"]


def test_analyse_does_NOT_fire_on_an_overlapping_field():
    rows = [_row(True, rejection=True), _row(True), _row(False, rejection=True), _row(False)]
    assert S.analyse(rows)["separating_fields"] == []


def test_a_field_with_one_value_is_reported_constant_not_separating():
    rows = [_row(True, complete=True) for _ in range(3)] + [
        _row(False, complete=True) for _ in range(3)]
    a = S.analyse(rows)
    assert a["fields"]["complete"]["constant"] is True
    assert a["fields"]["complete"]["separates"] is False
    assert "complete" in a["constant_fields"]


def test_constant_and_varying_partition_the_fields():
    rows = [_row(True, rejection=True), _row(False)]
    a = S.analyse(rows)
    assert set(a["constant_fields"]) | set(a["varying_fields"]) == set(S.STORY_FIELDS)
    assert not set(a["constant_fields"]) & set(a["varying_fields"])


# --- the measured corpus, from the committed artifact ----------------------------------

def _artifact():
    if not ARTIFACT.exists():
        pytest.skip(f"{ARTIFACT} not present - run the module to produce it")
    return json.load(io.open(ARTIFACT, encoding="utf-8"))


def test_no_discarded_story_field_separates_the_two_groups():
    a = _artifact()
    assert a["separating_fields"] == [], a["separating_fields"]
    assert a["wanted"] == 5 and a["unwanted"] == 5


def test_eight_of_twelve_story_fields_are_constant_at_a_granted_entry():
    a = _artifact()
    assert len(a["constant_fields"]) == 8, a["constant_fields"]
    assert len(a["varying_fields"]) == 4, a["varying_fields"]


def test_follow_through_and_decision_are_the_same_value():
    """They are both `bool(follow)` -- one value under two names, no extra information."""
    assert _artifact()["duplicate_fields"]["follow_through_equals_decision"] is True


def test_weakening_never_fires_on_any_granted_entry():
    """`_shrinking_into_zone` is one of four alternatives in `fight` and contributes nothing.

    This module does not decide WHY -- whether the predicate misses what the trader means, or
    the pattern is absent from these 14 days. It records that it never fired.
    """
    assert _artifact()["weakening_never_fires"] is True


@pytest.mark.parametrize("field", ["approach", "takeover"])
def test_the_two_hardcoded_literals_show_up_as_constant(field):
    assert field in _artifact()["constant_fields"]


def test_the_route_a_scope_is_stated():
    """4 of the 14 cases are BRK5 and carry story=None. A denominator that hides that lies."""
    a = _artifact()
    assert "Route A only" in a["scope"]
    assert a["cases"] == 10
