"""The ablation duplicates `reversal_story_v24`'s event selection. Pin the duplication.

I spent today fixing a diagnostic that re-implemented production logic and silently diverged
from it. `ablation_verdicts` does the same thing: it copies the event-selection scan out of
`reversal_story_v24` so its verdicts describe the bar the production gate actually used. If that
scan is ever edited in `entries.py`, the ablation keeps using the old one and its numbers quietly
stop meaning what they say.

THE PROPER FIX IS AT SOURCE -- extract the scan into one function both call, or have the story
return the event it chose. `entries.py` is a STRATEGY-SEMANTIC file and ALGO-011 section 9 gates
semantic edits on an independent grade that has not landed, so that fix is not available yet.

WHAT IS AVAILABLE is a textual correspondence pin. It is cruder than sharing the code, and it is
red-provable today: edit the scan in `entries.py` and this goes red instead of the ablation going
quietly wrong. Recorded as a stopgap, not as a solution.
"""
from __future__ import annotations

import inspect
import re

import pytest

from research import current_mnq_strategy_v2_4_entries as entries
from research import current_mnq_strategy_v2_4_story_ablation as A


def _norm(s: str) -> str:
    """Collapse whitespace so indentation differences do not mask or manufacture a match."""
    return re.sub(r"\s+", " ", s).strip()


# The scan, exactly as `reversal_story_v24` writes it. The ablation must contain the same
# statements, and `entries.py` must still contain them too.
EVENT_SCAN = """
    start = max(0, len(q) - 4)
    event_pos = None
    for j in range(len(q) - 2, start - 1, -1):
        if _valid_rejection_side(q.iloc[j], loc, direction, pad):
            event_pos = j
            break
"""


def test_the_production_story_still_contains_the_scan_this_pin_describes():
    """POSITIVE WITNESS. Without it, a rewrite of entries.py makes the next test vacuous."""
    assert _norm(EVENT_SCAN) in _norm(inspect.getsource(entries.reversal_story_v24)), (
        "`reversal_story_v24` no longer contains the event scan this pin was written against - "
        "the pin is stale and the ablation may already be describing a different bar"
    )


def test_the_ablation_uses_the_same_scan_verbatim():
    assert _norm(EVENT_SCAN) in _norm(inspect.getsource(A.ablation_verdicts)), (
        "the ablation's event selection has drifted from `reversal_story_v24`'s. Its verdicts "
        "would be about a different bar than the one the production gate used."
    )


def test_the_prior_window_matches_too():
    """The scan is meaningless over a different window; both must take the same 5 bars."""
    frag = "full5[full5.index < ts].tail(5)"
    assert frag in inspect.getsource(entries.reversal_story_v24)
    assert frag in inspect.getsource(A.ablation_verdicts)


def test_the_ablation_refuses_rather_than_guesses_if_it_loses_the_event():
    src = inspect.getsource(A.ablation_verdicts)
    assert "ABLATION_LOST_THE_EVENT_BAR_THE_KERNEL_FOUND" in src, (
        "if the scan finds no event on a candidate the kernel granted, the two have diverged "
        "and the ablation must raise, not return a verdict about nothing"
    )


def test_it_only_grades_candidates_the_kernel_actually_grants():
    """A verdict on a candidate the kernel refuses would inflate every kill count."""
    src = inspect.getsource(A.ablation_verdicts)
    assert "if not story.complete:" in src and "return None" in src


def test_every_ablation_has_a_stated_requirement_and_a_source_line():
    """A restored requirement with no citation is an invention. Each must name where it went."""
    for key, why in A.ABLATIONS.items():
        assert key.startswith("R") and len(why) > 80, key
        assert "v2.2" in why, f"{key} does not say what v2.2 required"


def test_the_module_disclaims_v22_as_the_teacher():
    """v2.2 is the prior implementation. Reading the table as a to-do list is the live risk."""
    doc = A.__doc__ or ""
    assert "not the teacher" in doc.lower() or "PRIOR IMPLEMENTATION" in doc, doc[:200]


def test_it_is_diagnostic_only():
    assert "DIAGNOSTIC_ONLY" in A.DIAGNOSTIC_ONLY
    assert "ALGO-011" in A.DIAGNOSTIC_ONLY


@pytest.mark.parametrize("key", [
    "R1_APPROACH_TRAVEL", "R2_RECLAIM_AT_ZONE_MID", "R3_RECLAIM_IS_A_TURN",
    "R4_WICK_REJECTION_REQUIRED", "R5_FOLLOW_ANCHORED_AT_MID", "R6_DISPLACEMENT_REQUIRED",
])
def test_each_named_ablation_is_declared(key):
    assert key in A.ABLATIONS
