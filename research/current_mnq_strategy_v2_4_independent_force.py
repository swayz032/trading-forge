#!/usr/bin/env python3
"""An INDEPENDENT re-derivation of directional force, so the receipt can actually disagree.

F-4 REPAIR (ALGO-020 section 1 item 4), on the band-5 grade.

WHAT WAS WRONG. The frozen-replay regrade "verified" the kernel's force gate by calling
`force_snapshot(one, cand.signal_time, 5, cand.direction, cand.confirmed_time, p)` --
**IDENTICAL ARGUMENTS TO A PURE FUNCTION.** `FORCE_RECEIPT_DISAGREES_WITH_KERNEL_GATE` could
therefore never fire on any REV or BRK5 candidate, which is every published case. I called it
"real and falsifiable" and red-proofed that the RAISE exists, not that it is REACHABLE.
A green check with no path to red.

WHAT THIS IS. A second implementation of the same five conditions, written from the raw 1m
bars and the frozen parameters, calling NEITHER `force_snapshot` NOR `momentum_bar`. Two
implementations agreeing is evidence; one implementation agreeing with itself is not.

    completed observations   sub-bars fully inside the parent AND fully known at the clock
    geometry                 directional body_frac and close_loc on the composite bar
    efficiency               net directional progress over total path distance
    at extreme               the latest close has regained the directional extreme
    before parent close      the parent candle has not already closed

THE BRK15 PARENT, which the grader found latent and ALGO-020 section 2 ruled on. The kernel
confirms a BRK15 through a **15-minute** parent floored to the decision clock
(`_intra15_confirmation`), while the old receipt recomputed a **5-minute** parent anchored at
`pen.attempted_at`. Any BRK15 confirmed more than one 5m bucket after the weak break would have
raised against a CORRECT kernel decision. `parent_for_setup` returns the parent the kernel
actually used, per setup, so the comparison is like-for-like.

Zero BRK15 candidates exist in any committed artifact, so that path is exercised by test
fixtures rather than by the corpus, and this module says so rather than implying coverage.

DIAGNOSTIC ONLY. Computes no strategy decision; it only re-derives and compares.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

DIAGNOSTIC_ONLY = (
    "DIAGNOSTIC_ONLY. An independent second derivation used to falsify the force receipt. "
    "Selects no strategy rule and gates no trade. ALGO-020 section 1 item 4."
)

EPS = 1e-9
#: Mirrors `force.MIN_COMPLETED_1M_OBSERVATIONS`. Asserted equal by test, never imported, so
#: that a change to one is caught rather than silently followed by the other.
MIN_COMPLETED_1M = 2


def parent_for_setup(setup: str, signal_time: pd.Timestamp,
                     decision_time: pd.Timestamp) -> tuple[pd.Timestamp, int]:
    """The parent candle the KERNEL gated on, per setup.

    REV and BRK5 gate on the 5-minute bucket the candidate formed in. BRK15 gates through
    `_intra15_confirmation`, which floors the DECISION clock to 15 minutes -- a different
    anchor and a different width, and getting that wrong is what made the old receipt raise
    against correct BRK15 decisions.
    """
    if setup == "BRK15":
        return decision_time.floor("15min"), 15
    return signal_time, 5


def independent_force(one: pd.DataFrame, parent_start: pd.Timestamp, parent_minutes: int,
                      direction: str, known_at: pd.Timestamp,
                      body_frac: float, close_loc: float) -> dict:
    """Re-derive the force verdict from raw 1m bars. Calls nothing from the force module."""
    if direction not in {"L", "S"}:
        raise ValueError("direction must be L or S")
    parent_end = parent_start + pd.Timedelta(minutes=int(parent_minutes))

    mask = ((one.index >= parent_start) & (one.index < parent_end)
            & ((one.index + pd.Timedelta(minutes=1)) <= known_at))
    q = one.loc[mask, ["open", "high", "low", "close"]]
    n = int(len(q))
    if n == 0:
        return {"confirmed": False, "reason": "NO_COMPLETED_1M", "completed_1m": 0}

    o = float(q.iloc[0].open)
    h = float(q.high.max())
    lo = float(q.low.min())
    c = float(q.iloc[-1].close)

    closes = q.close.to_numpy(float)
    path = np.concatenate(([o], closes))
    distance = float(np.abs(np.diff(path)).sum())
    progress = float(c - o) if direction == "L" else float(o - c)
    efficiency = float(progress / max(distance, EPS))

    # Composite-bar geometry, written out rather than delegated to `momentum_bar`.
    rng = max(h - lo, EPS)
    body = abs(c - o)
    bf = body / rng
    cl = (c - lo) / rng
    if direction == "L":
        geometry = bool(c > o and bf >= body_frac and cl >= close_loc)
        at_extreme = bool(c >= float(np.max(closes)) - EPS)
    else:
        geometry = bool(c < o and bf >= body_frac and cl <= 1.0 - close_loc)
        at_extreme = bool(c <= float(np.min(closes)) + EPS)

    enough = n >= MIN_COMPLETED_1M
    before_close = bool(known_at < parent_end)
    efficient = bool(progress > 0 and efficiency >= body_frac)
    confirmed = bool(enough and before_close and geometry and efficient and at_extreme)

    if confirmed:
        reason = "SUSTAINED_DIRECTIONAL_FORCE"
    elif not enough:
        reason = "INSUFFICIENT_1M_OBSERVATIONS"
    elif not before_close:
        reason = "PARENT_CANDLE_ALREADY_CLOSED"
    elif not geometry:
        reason = "PARTIAL_MOMENTUM_GEOMETRY_NOT_PROVEN"
    elif not efficient:
        reason = "TUG_OF_WAR_PATH_TOO_INEFFICIENT"
    else:
        reason = "LATEST_CLOSE_HAS_NOT_REGAINED_DIRECTIONAL_EXTREME"

    return {
        "confirmed": confirmed, "reason": reason, "completed_1m": n,
        "directional_progress": progress, "path_distance": distance,
        "path_efficiency": efficiency,
        "latest_close_at_directional_extreme": at_extreme,
        "partial_momentum_geometry": geometry,
        "before_parent_close": before_close,
    }


def compare(kernel_snapshot, independent: dict, tol: float = 1e-6) -> list[str]:
    """Every way the two derivations can disagree. Empty list means they agree."""
    d = []
    if bool(kernel_snapshot.confirmed) != bool(independent["confirmed"]):
        d.append(f"confirmed {kernel_snapshot.confirmed} vs {independent['confirmed']}")
    if str(kernel_snapshot.reason) != str(independent["reason"]):
        d.append(f"reason {kernel_snapshot.reason} vs {independent['reason']}")
    if int(kernel_snapshot.completed_1m) != int(independent["completed_1m"]):
        d.append(f"completed_1m {kernel_snapshot.completed_1m} vs "
                 f"{independent['completed_1m']}")
    for field, key in (("directional_progress", "directional_progress"),
                       ("path_distance", "path_distance"),
                       ("path_efficiency", "path_efficiency")):
        a = float(getattr(kernel_snapshot, field))
        b = float(independent.get(key, float("nan")))
        if not (abs(a - b) <= tol):
            d.append(f"{field} {a!r} vs {b!r}")
    return d


__all__ = ["DIAGNOSTIC_ONLY", "MIN_COMPLETED_1M", "compare", "independent_force",
           "parent_for_setup"]
