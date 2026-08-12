"""SOURCE-RISK-HANDOFF-1 / STEP 2B — the exact causal FVG identity.

Authority: AR-1068 (gpt-rulings 06d63e2b) §5 and §10 NEXT UNIT 2.

WHAT THIS IS, AND WHAT IT IS EMPHATICALLY NOT
---------------------------------------------
🛑 THIS IS NOT A SECOND FVG DETECTOR. AR-1068 §5: "Do not add a second FVG detector.
Reuse `compute_fvg_signal()` / `FVGResult.zones`; fix the identity handoff."

It computes no imbalance. It SELECTS, from zones the existing native detector already
produced, the one zone that satisfies the teacher's causal sequence — and returns that
zone BY IDENTITY so the stop can be built from the same object that qualified the entry.

THE DEFECT IT CLOSES
--------------------
`spec_condition_compiler._eval_fvg()` computes `compute_fvg_signal(...)` and returns
`result.any_active`, discarding `FVGResult.zones` at the return statement (AR-1069 §2).
So two things were wrong at once:

  1. NO IDENTITY SURVIVED. Nothing downstream could know WHICH zone qualified, so a stop
     built later would have to re-scan for a "nearest" zone — a different object from the
     one that caused the entry.
  2. THE PREDICATE ITSELF WAS WRONG. `any_active[i]` is True iff ANY still-unfilled
     bullish OR bearish zone is active at bar i, including one formed much earlier in the
     session and on the wrong side. The teacher's rule needs the zone whose THIRD CANDLE
     IS THE CURRENT BAR, on the BREAKOUT SIDE, formed AFTER the breakout.

THE GOVERNED SEQUENCE (blueprint v4, quoted in AR-1068 §5)
----------------------------------------------------------
    opening range locks
    -> a candle CLOSES outside ORH/ORL          (close, never a wick breach)
    -> a matching-direction 3-candle FVG forms OUTSIDE that SAME side
    -> the third candle completes
    -> enter from that third-candle event

DIRECTION AUTHORITY (AR-1068 §6)
--------------------------------
The BREAKOUT SIDE selects direction. There is deliberately NO EMA input to this module:

    close above ORH -> LONG  -> bullish FVG required
    close below ORL -> SHORT -> bearish FVG required

⚠️ HONEST SCOPE LIMIT: because this module takes no EMA argument, a test that flips an EMA
slope and observes no change here is a WEAK control — it would pass even on a module that
had no direction logic at all. The meaningful control is the one in the test suite that
holds the source sequence constant while making an EMA-slope proxy disagree, and asserts
this module still answers from the breakout side. Rewiring `_eval_fvg`'s caller so the
COMPILER stops consulting the EMA proxy on the source-faithful path is AR-1068 §10
NEXT UNIT 3, and is NOT done here.

SHORT SIDE
----------
Short selection is implemented here because the causal structure is symmetric and
observable. That is NOT a claim that the teacher's SHORT STOP anchor is resolved — it is
not (AR-1068 §3.2 / §12), and `displacement_candle_high` remains unmapped in the TypeScript
contract so a short stop still REFUSES. This module answers "which zone qualified", not
"where does the stop go".
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from src.engine.indicators.fvg_native import BEARISH, BULLISH, FVGZone, displacement_extreme

LONG = "long"
SHORT = "short"

# The zone direction each breakout side requires. AR-1068 §5 negative control:
# "bullish breakout + bearish FVG -> NO ENTRY".
_REQUIRED_ZONE_DIRECTION = {LONG: BULLISH, SHORT: BEARISH}


@dataclass(frozen=True)
class SourceEntryEvent:
    """ONE taught entry event, carrying the EXACT zone that qualified it.

    `zone` is the identity AR-1068 §5 item 6 requires be "captured and carried forward to
    stop construction". It is the same frozen `FVGZone` object the detector produced — not
    a copy, not a re-scan, not a (direction, start_idx, lower, upper) tuple rebuilt later.

    `bar_idx` is the THIRD candle of that FVG and is the teacher's decision bar
    ("my entry is going to be on the closure of that third candle"). It equals
    `zone.start_idx` by construction; both are carried so a consumer that only holds the
    event still has the decision bar without reaching into the zone.

    `breakout_idx` is the bar whose CLOSE crossed the opening-range side. It is retained so
    a receipt can show the causal order rather than assert it.
    """

    bar_idx: int
    direction: str
    zone: FVGZone
    breakout_idx: int

    def __post_init__(self) -> None:
        if self.direction not in (LONG, SHORT):
            raise ValueError(f"direction must be {LONG!r} or {SHORT!r}, got {self.direction!r}")
        if self.bar_idx != self.zone.start_idx:
            raise ValueError(
                f"bar_idx={self.bar_idx} is not the zone's third candle "
                f"(zone.start_idx={self.zone.start_idx}); the decision bar and the zone that "
                "qualified it must be the same bar, or the identity has already been lost"
            )
        if self.breakout_idx > self.bar_idx:
            raise ValueError(
                f"breakout_idx={self.breakout_idx} is AFTER the FVG third candle "
                f"{self.bar_idx}; that inverts the taught causal order"
            )


def find_breakout_events(
    close: np.ndarray,
    or_high: float,
    or_low: float,
    *,
    lock_idx: int,
) -> list[tuple[int, str]]:
    """Bars whose CLOSE transitions from inside the opening range to outside it.

    CLOSE, NEVER A WICK. AR-1068 §11 discriminator 2: "Wick-only OR breach does not qualify
    where close-outside is required." `high`/`low` are deliberately not parameters here, so
    a wick breach is not merely unused — it is unreachable.

    TRANSITION, NOT MEMBERSHIP. After a breakout, many subsequent bars also close outside.
    Treating every one of them as a breakout event would make "post-breakout" vacuous. The
    event is the crossing: `close[i]` outside and `close[i-1]` not outside on that side.

    `lock_idx` is the first bar at which the opening range is LOCKED and its levels may be
    read. Bars before it are not evaluated: reading OR levels before the window closes is
    lookahead, and the governed OR adapter refuses it (`OpeningRangeWindowStatus.FORMING`).
    """
    if lock_idx < 0:
        raise ValueError(f"lock_idx must be >= 0, got {lock_idx}")
    if not np.isfinite(or_high) or not np.isfinite(or_low):
        raise ValueError(
            f"opening-range levels must be finite; got or_high={or_high!r}, or_low={or_low!r}. "
            "A refused/forming opening range has no levels, and guessing them is invention."
        )
    if or_high < or_low:
        raise ValueError(f"inverted opening range: or_high={or_high!r} < or_low={or_low!r}")

    events: list[tuple[int, str]] = []
    for i in range(max(lock_idx, 1), len(close)):
        c, prev = float(close[i]), float(close[i - 1])
        if not np.isfinite(c) or not np.isfinite(prev):
            continue
        if c > or_high and not prev > or_high:
            events.append((i, LONG))
        elif c < or_low and not prev < or_low:
            events.append((i, SHORT))
    return events


def _zone_is_outside(zone: FVGZone, direction: str, or_high: float, or_low: float) -> bool:
    """AR-1068 §5 item 4 / §11 discriminator 6: the FVG must be OUTSIDE the same OR side.

    WHOLLY outside, using the near edge:
      LONG  — the gap's LOWER boundary must sit above ORH.
      SHORT — the gap's UPPER boundary must sit below ORL.

    A zone straddling the range is not "outside it"; taking the near edge means a zone that
    merely pokes out cannot qualify.
    """
    if direction == LONG:
        return zone.lower > or_high
    return zone.upper < or_low


def select_source_entry_events(
    *,
    close: np.ndarray,
    zones: list[FVGZone],
    or_high: float,
    or_low: float,
    lock_idx: int,
) -> list[SourceEntryEvent]:
    """The taught entry events, each carrying the exact FVG that qualified it.

    `zones` MUST come from `compute_fvg_signal(...).zones` — this function detects nothing.

    An event is emitted for bar `b` iff ALL of these hold (AR-1068 §5):
      1. a zone `z` exists with `z.start_idx == b`      — the third candle IS this bar;
      2. a breakout event occurred at `k <= b`          — post-breakout causal order;
      3. `z.direction` matches that breakout's side     — matching direction;
      4. `z` lies wholly outside the same OR side       — outside the range;
      5. the breakout is a CLOSE crossing               — enforced by find_breakout_events.

    ⚠️ NO MAXIMUM DISTANCE IS IMPOSED between the breakout and the FVG. The source teaches
    the sequence ("we have our break to the upside... let's take a look and see if we got
    our fair value gap") but never states a bar limit, and inventing one would be exactly
    the fabrication this campaign refuses. The consequence is stated rather than hidden: a
    qualifying FVG arbitrarily long after the breakout still qualifies, provided no opposite
    breakout has intervened. If the source is later found to bound it, that is a one-value
    change here.

    A LATER OPPOSITE BREAKOUT ENDS THE PRIOR REGIME. The governing breakout for bar `b` is
    the most recent breakout at or before `b`, so an upside break followed by a downside
    break cannot leave a stale LONG regime alive underneath.
    """
    breakouts = find_breakout_events(close, or_high, or_low, lock_idx=lock_idx)
    if not breakouts:
        return []

    by_start: dict[int, list[FVGZone]] = {}
    for z in zones:
        by_start.setdefault(int(z.start_idx), []).append(z)

    events: list[SourceEntryEvent] = []
    for bar_idx in sorted(by_start):
        governing = None
        for k, side in breakouts:
            if k <= bar_idx:
                governing = (k, side)
            else:
                break
        if governing is None:
            continue                      # the zone predates every breakout — an OLD gap
        k, side = governing

        for zone in by_start[bar_idx]:
            if zone.direction != _REQUIRED_ZONE_DIRECTION[side]:
                continue                  # wrong-side FVG under this breakout
            if not _zone_is_outside(zone, side, or_high, or_low):
                continue                  # inside the range, or straddling it
            events.append(
                SourceEntryEvent(bar_idx=bar_idx, direction=side, zone=zone, breakout_idx=k)
            )
    return events


def source_stop_price(event: SourceEntryEvent, high: np.ndarray, low: np.ndarray) -> float:
    """The taught stop for `event`, built from THE SAME zone that qualified the entry.

    AR-1068 §5 items 7 and 8: the stop uses `displacement_extreme()` on THAT zone, and no
    nearest-FVG re-scan occurs at stop time. That property is structural here — this
    function receives no `zones` list, so there is nothing to re-scan. It cannot pick a
    different zone even if one is closer, because it never sees another zone.
    """
    return displacement_extreme(event.zone, high, low, event.direction)
