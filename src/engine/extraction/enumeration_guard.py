"""H1 Wave-6 Pass-2 (2026-07-13) — Guard 1: bidirectional over-enumeration fence.

Pure, no I/O, no LLM calls (mirrors `pilot_conveyor.py`'s own
non-adjudicator discipline — this module is a comparator, never a caller).
Per docs/designs/h1-wave6-pass2-two-phase-PACKET-2026-07-13.md §4 Guard 1:

  What it defends against: a degenerate Phase-A enumerator that splits
  every condition-cluster into its own "strategy" would manufacture tiny,
  easily-certified strategies -- gaming the >=1-clean-strategy-per-video
  bar by fragmentation. The SAME fence also catches the mirror failure
  (under-splitting -- silencing a real second strategy, the exact
  `WEhmadJArQo` disease pass-2 exists to fix).

Two-stage design, reusing the exact §9a/§10 machinery already proven this
campaign (see docs/designs/h1-wave6-extractor-iteration-preregistration-2026-07-12.md
§9-§10):

  Stage 1 (screen): compare Phase A's enumerated strategy count against the
  SAME baseline Gate 2 already used (the original spent-16 per-video
  strategy count). A mismatch in EITHER direction trips the screen. The
  screen NEVER fails the gate by itself -- it only decides which videos
  need adjudication.

  Stage 2 (escalation): a tripped video gets a fresh-context blind
  adjudicator (transcript alone, the §9b question) -- UNLESS it is one of
  the three videos already adjudicated this campaign (KNOWN_ADJUDICATIONS
  below), which are reused directly rather than re-asking an
  already-answered question.

  Routing: enumerated count matches the adjudication (or falls in the
  known non-trip band) -> the trip was baseline error -> Guard 1 clears.
  Otherwise -> the content-preservation decider (packet's §9->§10 ladder,
  one level down): does every distinct entry/exit skeleton the adjudicator
  named survive SOMEWHERE in Phase B's eventual per-strategy output? Content
  present -> re-segmentation, not a failure. Content absent -> genuine
  Guard-1 failure -- a terminal-swing signal on this (pass-2, last-swing)
  pass per packet §4 step 4.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional, Tuple

# §9b/§10c pre-committed adjudications, reused directly rather than
# re-asking an already-answered question (packet §4 Guard 1 step 2).
# WEhmadJArQo accepts EITHER 1 or 2 as a non-trip -- the adjudicator's own
# "a reasonable adjudicator could score this as 1" flag makes this the
# pre-declared ambiguous band (packet §4 Guard 1, WEh-specific note); only
# 0 or 3+ trips it, and any trip still resolves through the
# content-preservation decider, never by ontology alone.
KNOWN_ADJUDICATIONS: dict[str, Tuple[int, ...]] = {
    "4cT8WTyxhYY": (1,),
    "IyFioFkRgWo": (1,),
    "WEhmadJArQo": (1, 2),
}


class ScreenResult:
    MATCH = "match"
    OVER_SPLIT = "over_split"
    UNDER_SPLIT = "under_split"


def screen_enumeration_count(enumerated_count: int, baseline_count: int) -> str:
    """Stage 1 — cheap screen, all design-pool videos. Never fails the gate
    by itself (packet §4 Guard 1 step 1)."""
    if enumerated_count > baseline_count:
        return ScreenResult.OVER_SPLIT
    if enumerated_count < baseline_count:
        return ScreenResult.UNDER_SPLIT
    return ScreenResult.MATCH


@dataclass
class Guard1Verdict:
    video_id: str
    enumerated_count: int
    baseline_count: int
    screen_result: str
    escalated: bool
    adjudicated_count: Optional[int] = None
    routing: str = ""  # cleared_no_trip | cleared_baseline_error | cleared_content_preserved | failed
    content_preserved: Optional[bool] = None
    note: str = ""

    @property
    def cleared(self) -> bool:
        return self.routing in ("cleared_no_trip", "cleared_baseline_error", "cleared_content_preserved")


def evaluate_guard1(
    video_id: str,
    enumerated_count: int,
    baseline_count: int,
    adjudicate_fn: Optional[Callable[[str], int]] = None,
    content_preservation_fn: Optional[Callable[[str], bool]] = None,
) -> Guard1Verdict:
    """Two-stage bidirectional over-enumeration fence (packet §4 Guard 1).

    `adjudicate_fn(video_id) -> int`: required ONLY when a trip occurs on a
    video NOT in `KNOWN_ADJUDICATIONS` -- a fresh-context blind
    adjudicator's enumerated-strategy count. Injectable so this function is
    testable without any live LLM call (Guard 3(b) — proving the fence
    machinery independent of what Phase A actually outputs).

    `content_preservation_fn(video_id) -> bool`: required ONLY when the
    adjudicated count (or, for a known video, an enumerated count outside
    its pre-declared non-trip band) still disagrees with the enumerated
    count -- the §9->§10 content-preservation decider one level down.

    Raises `ValueError` (never silently skips) if an escalation this guard
    owes has no callback supplied for it -- ambiguity here must be loud,
    never quietly resolved either way.

    KNOWN-VIDEO PRIORITY (2026-07-13 correctness fix, found during this
    pass's own birth-fixture run): for the three pre-adjudicated videos, the
    known adjudication band is checked BEFORE the baseline screen is trusted
    as a clearance -- not only when the screen trips. Reason: the baseline
    itself is KNOWN WRONG for exactly these three videos (that is WHY they
    were adjudicated in §9b); a live run on `IyFioFkRgWo` enumerated 2
    strategies, which happens to MATCH that video's old (also over-split)
    baseline of 2 -- a literal implementation of "only escalate on a screen
    trip" would have waved this through as `cleared_no_trip` even though the
    pre-committed ground truth is 1. For these three videos we already HOLD
    ground truth directly; the baseline-comparison proxy is never the
    authority once ground truth is in hand, regardless of what the cheap
    screen says.
    """
    screen = screen_enumeration_count(enumerated_count, baseline_count)
    known_band = KNOWN_ADJUDICATIONS.get(video_id)

    if known_band is not None:
        if enumerated_count in known_band:
            routing = "cleared_no_trip" if screen == ScreenResult.MATCH else "cleared_baseline_error"
            note = (
                "screen matched baseline AND known ground-truth band"
                if screen == ScreenResult.MATCH
                else f"enumerated_count {enumerated_count} in pre-committed non-trip band {known_band} "
                     f"(baseline screen tripped, but the baseline itself is known-wrong for this video)"
            )
            return Guard1Verdict(
                video_id, enumerated_count, baseline_count, screen, escalated=(screen != ScreenResult.MATCH),
                adjudicated_count=enumerated_count, routing=routing, note=note,
            )
        # Known video, but the count fell OUTSIDE its non-trip band -> content decider,
        # REGARDLESS of what the baseline screen says (ground truth outranks the proxy).
        if content_preservation_fn is None:
            raise ValueError(
                f"Guard 1 trip on known video {video_id!r} (enumerated={enumerated_count}, "
                f"outside non-trip band {known_band}) requires content_preservation_fn to resolve"
            )
        preserved = content_preservation_fn(video_id)
        return Guard1Verdict(
            video_id, enumerated_count, baseline_count, screen, escalated=True,
            adjudicated_count=None, routing="cleared_content_preserved" if preserved else "failed",
            content_preserved=preserved,
            note="known video, count outside non-trip band -> content-preservation decider",
        )

    if screen == ScreenResult.MATCH:
        return Guard1Verdict(
            video_id, enumerated_count, baseline_count, screen, escalated=False,
            routing="cleared_no_trip", note="screen matched baseline; no escalation needed",
        )

    # Unknown video, screen tripped -> needs a fresh-context blind adjudication.
    if adjudicate_fn is None:
        raise ValueError(
            f"Guard 1 trip on unknown video {video_id!r} (enumerated={enumerated_count}, "
            f"baseline={baseline_count}) requires adjudicate_fn -- cannot resolve without a "
            f"fresh-context blind adjudication"
        )
    adjudicated_count = adjudicate_fn(video_id)
    if enumerated_count == adjudicated_count:
        return Guard1Verdict(
            video_id, enumerated_count, baseline_count, screen, escalated=True,
            adjudicated_count=adjudicated_count, routing="cleared_baseline_error",
            note="trip was baseline error vs fresh adjudication",
        )
    if content_preservation_fn is None:
        raise ValueError(
            f"Guard 1 trip on {video_id!r} (adjudicated_count={adjudicated_count} != "
            f"enumerated_count={enumerated_count}) requires content_preservation_fn to resolve"
        )
    preserved = content_preservation_fn(video_id)
    return Guard1Verdict(
        video_id, enumerated_count, baseline_count, screen, escalated=True,
        adjudicated_count=adjudicated_count, routing="cleared_content_preserved" if preserved else "failed",
        content_preserved=preserved,
        note="adjudicated count differs from enumeration -> content-preservation decider",
    )
