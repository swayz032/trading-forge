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
from datetime import date, datetime

import numpy as np

from src.engine.indicators.fvg_native import BEARISH, BULLISH, FVGZone, displacement_extreme

LONG = "long"
SHORT = "short"

# The declared execution-ownership mode whose entry population this module owns.
#
# ⚠️ IT IS A SECOND OCCURRENCE OF A STRING `backtester.run_class_backtest` ALREADY VALIDATES
# AGAINST, AND THAT IS A JOIN, NOT A DUPLICATE DEFINITION. The backtester owns which modes it
# will RUN; this owns which mode changes the ENTRY POPULATION. Two literals that must agree is
# exactly the shape that rots silently, so the agreement is PINNED BY A TEST rather than
# asserted here — and the Band C vertical proof exercises both in one execution.
SOURCE_FAITHFUL_MODE = "SOURCE_FAITHFUL"

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

    ─── STEP G — SHORT STOP AUTHORITY IS REFUSED (AR-1074 §8, §10.G) ──────────────────
    🛑 A CALCULABLE PRICE IS NOT SOURCE AUTHORITY.

    The TypeScript source-risk contract deliberately maps `displacement_candle_low ->
    fvg_displacement` and deliberately leaves `displacement_candle_high` UNMAPPED, because
    the transcript does not authorize repairing the short-side wording by mirroring
    (AR-1070's declared narrowing, accepted at AR-1074 §8).

    That narrowing was NOT enforced on this side. `displacement_extreme()` is a generic
    geometry helper and will happily return `high[start_idx - 1]` for a short — a
    perfectly plausible number that no teacher ever taught. AR-1074 §8 measured exactly
    that: "do not let this helper accidentally open the short stop path."

    The guard lives HERE and not in `displacement_extreme()` on purpose. That helper is
    generic geometry with its own direct tests and a second caller context; disarming it
    would be a mechanism change where a source-authority check was ordered. THIS function
    is the source-authority boundary — it is the only place that claims a returned price is
    what the teacher taught.

    Short SELECTION remains implemented and correct (`select_source_entry_events` still
    emits short events): this module answers "which zone qualified", and only the STOP
    claim is refused. Long is unaffected.
    """
    if event.direction == SHORT:
        raise ValueError(
            "SHORT source stop authority is REFUSED (AR-1074 §8, §10.G). The transcript "
            "resolves the LONG anchor only ('the bottom of the fair value candle'); "
            "`displacement_candle_high` is deliberately UNMAPPED in the source-risk "
            "contract and may not be inferred by mirroring the long rule. "
            f"`displacement_extreme()` would mechanically return high[{int(event.zone.start_idx) - 1}] "
            "here, but A CALCULABLE PRICE IS NOT SOURCE AUTHORITY. This refusal lifts only "
            "when the bounded short-side visual evidence resolves the teacher's short "
            "example — not by engineering common sense."
        )
    return displacement_extreme(event.zone, high, low, event.direction)


# ══════════════════════════════════════════════════════════════════════════════════════
# AR-1079 §3 / §5 — PER-SESSION OPENING RANGE, AND AN IDENTITY THAT SURVIVES A SLICE
# ══════════════════════════════════════════════════════════════════════════════════════


@dataclass(frozen=True)
class SourceSessionRange:
    """ONE trading session's completed opening-range state, as the adapter computed it.

    AR-1079 §3: `_h_opening_range()` already calls the governed adapter EXACTLY ONCE per
    `(candidate, session_date)` and already holds the exact `OpeningRangeState` — then
    collapses it to a boolean availability array. This record is what that handler keeps
    instead of discarding, so the source join reuses the SAME state.

    🛑 IT IS NOT A SECOND OPENING-RANGE CALCULATOR. Every field here is READ OFF the state
    the adapter returned (`opening_range_high` / `opening_range_low`) or off the adapter's
    OWN `_window_bounds` lock. Nothing is re-derived. `THE SECOND COPY OF A CALCULATION IS
    A DISAGREEMENT WAITING FOR A REASON.`

    🛑 AND IT IS NOT A SCALAR ORH/ORL SMEARED ACROSS A MULTI-DAY FRAME, which is the exact
    defect AR-1079 §3 ordered prevented. One record per session; a session whose range never
    completed produces NO record and therefore no event, and may not borrow a neighbour's.

    Indices are positions in the SAME frame the detector ran on, so a zone selected against
    them is the detector's own object rather than a rebased copy.
    """

    session_date: date
    or_high: float
    or_low: float
    lock_idx: int
    first_idx: int
    last_idx: int

    def __post_init__(self) -> None:
        if not (self.first_idx <= self.lock_idx <= self.last_idx):
            raise ValueError(
                f"session {self.session_date}: lock_idx={self.lock_idx} is outside its own "
                f"session span [{self.first_idx}, {self.last_idx}]; a lock that is not IN the "
                "session it belongs to is a cross-session read, not an opening range"
            )
        if not np.isfinite(self.or_high) or not np.isfinite(self.or_low):
            raise ValueError(
                f"session {self.session_date}: non-finite opening range "
                f"({self.or_low!r}, {self.or_high!r}). A refused/forming range has no levels "
                "and must produce NO record rather than a record with invented ones."
            )
        if self.or_high < self.or_low:
            raise ValueError(
                f"session {self.session_date}: inverted opening range "
                f"or_high={self.or_high!r} < or_low={self.or_low!r}"
            )


@dataclass(frozen=True)
class SourceEventRecord:
    """One source entry event, carried with an identity that SURVIVES A FRAME SLICE.

    ─── AR-1079 §5 — THE WARMUP-INDEX TRAP THIS EXISTS TO CLOSE ─────────────────────────
    🛑 `strategy.compute()` runs on `warmup + OOS` rows; `run_class_backtest` then does
    `df = df.slice(warmup_rows)`. An event recorded as a NAKED PRE-STRIP INTEGER therefore
    points at a DIFFERENT CANDLE afterwards — and because the FVG `start_idx`, the
    displacement wick, the entry bar and the trade manager would all shift TOGETHER, the
    result stays internally consistent around the WRONG ROW. No exception, no mismatch, a
    perfectly plausible trade on a candle the teacher never named.

      `A CONSISTENT ANSWER AROUND THE WRONG ROW IS NOT DETECTABLE BY ANY CHECK THAT ONLY
       TESTS CONSISTENCY.`

    So `decision_ts` — not `event.bar_idx` — is the load-bearing identity across that
    boundary. The integer indices are retained for auditing the pre-strip frame and MUST NOT
    be used to address a post-strip one.

    PRICES ARE RESOLVED PRE-STRIP ON PURPOSE. `entry_price` and `stop_price` are read off the
    same frame the detector ran on, so slicing cannot move them either: a price is not an
    index.

    `stop_price` / `risk_points` are `None` exactly when `refused_reason` is set — today that
    is the SHORT side, whose stop authority remains refused (AR-1079 §6). A refused record is
    still EMITTED rather than dropped, because a short setup that silently vanishes is
    indistinguishable from a short setup that never occurred.
    """

    event: SourceEntryEvent
    session_date: date
    decision_ts: datetime
    breakout_ts: datetime
    entry_price: float
    stop_price: float | None
    risk_points: float | None
    refused_reason: str | None

    def __post_init__(self) -> None:
        if (self.stop_price is None) != (self.refused_reason is not None):
            raise ValueError(
                "a source event record must carry EITHER an executable stop OR a refusal "
                f"reason, never both and never neither (stop_price={self.stop_price!r}, "
                f"refused_reason={self.refused_reason!r})"
            )
        if self.risk_points is not None and self.risk_points <= 0:
            raise ValueError(
                f"risk_points={self.risk_points!r} is not positive; the taught stop must sit "
                "on the losing side of the entry or the R unit is meaningless"
            )


def select_session_source_events(
    *,
    close: np.ndarray,
    zones: list[FVGZone],
    session: SourceSessionRange,
) -> list[SourceEntryEvent]:
    """The taught events for ONE session, in the frame's own index space.

    AR-1079 §3: "For each session independently: that session's exact completed OR state ->
    that session's close breakout -> that session's matching-direction FVG -> source entry
    event." This is the per-session wrapper around `select_source_entry_events`; it adds NO
    selection rule of its own.

    HOW THE SESSION BOUND IS IMPOSED WITHOUT REBASING ANYTHING:
      * the upper bound is a VIEW, `close[: last_idx + 1]` — a numpy slice shares the buffer
        and preserves index identity, so nothing is copied and no index is translated;
      * the lower bound is `lock_idx`, which lies inside this session, so
        `find_breakout_events` cannot reach a previous session's bars;
      * `zones` are filtered to those whose third candle lies inside this session, so a
        neighbouring day's imbalance cannot qualify here.

    🛑 THE ZONE OBJECTS ARE PASSED THROUGH BY IDENTITY. Filtering a list does not copy its
    members, so the zone that reaches `source_stop_price` is the same object the detector
    produced — which is the whole point of AR-1068 §5 item 6.

    The transition test in `find_breakout_events` reads `close[i-1]`, so the scan starts at
    `max(lock_idx, first_idx + 1)`: a breakout on the session's very first bar has no
    in-session predecessor, and borrowing the previous session's last bar to decide "was it
    inside the range" would be exactly the cross-session read §3 forbids.
    """
    lo = max(int(session.lock_idx), int(session.first_idx) + 1)
    hi = int(session.last_idx)
    if lo > hi:
        return []

    session_zones = [z for z in zones if lo <= int(z.start_idx) <= hi]
    if not session_zones:
        return []

    return select_source_entry_events(
        close=close[: hi + 1],
        zones=session_zones,
        or_high=session.or_high,
        or_low=session.or_low,
        lock_idx=lo,
    )
