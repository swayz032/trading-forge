#!/usr/bin/env python3
"""A SECOND derivation of intra-candle directional force, from raw 1m bars.

WHAT IT DETECTS, AND WHAT IT CANNOT — corrected 2026-08-23 after the arena grade (F-3) measured
it rather than taking the caption's word.

    one-sided mutation of `force.py` alone      6000 / 6000 caught
    40,000 random windows                       0 disagreements
    SHARED `body_frac` 0.62 -> 0.05 / 0.95      883 / 988 verdict flips, 0 disagreements
    SHARED `parent_start` +1m / +2m             344 / 387 flips, 0 disagreements

**It has full power against implementation drift inside `force.py`, and ZERO power against
specification error.** Both derivations read `body_frac`, `close_loc` and the parent anchor from
the same `Params`, so anything wrong upstream is wrong identically in both — and fidelity to the
trader is a *specification* question, which is exactly the axis this does not cover.

The grade also observed that the two implementations share the same algebra and compare the same
six `reason` constants in the same ladder order: this is a re-derivation by one author from one
conception, not two independent readings of the market. **Same-layer agreement is not evidence
about the layer itself.** `test_it_calls_neither_force_snapshot_nor_momentum_bar` is an AST scan
— it proves non-delegation, never non-transliteration.

So the honest claim is: **this is a drift detector between two copies of one rule.** It is worth
having and it is not a validation of the rule. Closing the remaining gap means anchoring the
thresholds and the parent rule to an independent authority (the frozen spec JSON) rather than to
`Params`; that is a semantics change and is not made here.

BUILD/DIAGNOSTIC. Calls neither `force_snapshot` nor `momentum_bar`.
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
        # F-12 REPAIR (arena grade 2026-08-23). This branch used to return only three keys,
        # while `compare()` reads `directional_progress`, `path_distance` and
        # `path_efficiency`. Missing, they defaulted to NaN, and `abs(a - nan) <= tol` is
        # False - so two derivations that AGREED perfectly on NO_COMPLETED_1M reported a
        # SPURIOUS three-field divergence. Unreachable through the kernel today (it only
        # yields on `confirmed`), which is exactly why it would have surfaced as a mystery
        # FORCE_DERIVATIONS_DISAGREE for the first caller with a different call pattern.
        #
        # The kernel's own snapshot reports 0.0 for all three when there is nothing to
        # measure, so this now says the same thing rather than saying nothing.
        return {"confirmed": False, "reason": "NO_COMPLETED_1M", "completed_1m": 0,
                "directional_progress": 0.0, "path_distance": 0.0, "path_efficiency": 0.0,
                "latest_close_at_directional_extreme": False,
                "partial_momentum_geometry": False, "before_parent_close": False}

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
    #
    # F1 (ALGO-096 s5), MIRRORED IDENTICALLY from `force._directional_body`: the taught force
    # shape is a DIRECTIONAL BODY; the untaught `body_frac`/`close_loc` fractions are retired
    # from this clause. "Control" is already carried by `at_extreme` below. This module must
    # change in step with `force.py` or it stops being a witness - it would then agree with
    # the kernel everywhere except where the bug is. `body_frac` still reaches the mutation
    # arm through `efficient` below, which F1 does NOT touch, so the arm keeps a live channel.
    rng = max(h - lo, EPS)
    body = abs(c - o)
    bf = body / rng
    cl = (c - lo) / rng
    if direction == "L":
        geometry = bool(c > o)
        at_extreme = bool(c >= float(np.max(closes)) - EPS)
    else:
        geometry = bool(c < o)
        at_extreme = bool(c <= float(np.min(closes)) + EPS)

    enough = n >= MIN_COMPLETED_1M
    before_close = bool(known_at < parent_end)
    efficient = bool(progress > 0 and efficiency >= body_frac)
    # ENTAILED CLAUSE REMOVED FROM THE CONJUNCTION (ALGO-098), mirroring force.py exactly:
    # `geometry` is `c > o`, which is `progress > 0`, which `efficient` already requires.
    # It stays computed and reported so the reason chain and this witness keep their
    # observation, and it is gone from the verdict because it can never change one.
    confirmed = bool(enough and before_close and efficient and at_extreme)

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


#: Every key `compare()` reads. Derived once so a return path cannot quietly omit one.
COMPARED_KEYS = ("confirmed", "reason", "completed_1m",
                 "directional_progress", "path_distance", "path_efficiency")


def compare(kernel_snapshot, independent: dict, tol: float = 1e-6) -> list[str]:
    """Every way the two derivations can disagree. Empty list means they agree.

    A MISSING key is not agreement and is not disagreement - it is a broken caller, and it
    used to masquerade as a three-field divergence (F-12). It now says so in its own words.
    """
    missing = [k for k in COMPARED_KEYS if k not in independent]
    if missing:
        raise KeyError(
            f"INDEPENDENT_FORCE_RESULT_INCOMPLETE: {missing}. A return path omitted fields "
            f"`compare` reads; NaN defaults would have reported this as a false divergence.")
    d = []
    if bool(kernel_snapshot.confirmed) != bool(independent["confirmed"]):
        d.append(f"confirmed {kernel_snapshot.confirmed} vs {independent['confirmed']}")
    if str(kernel_snapshot.reason) != str(independent["reason"]):
        d.append(f"reason {kernel_snapshot.reason} vs {independent['reason']}")
    if int(kernel_snapshot.completed_1m) != int(independent["completed_1m"]):
        d.append(f"completed_1m {kernel_snapshot.completed_1m} vs "
                 f"{independent['completed_1m']}")
    for field in ("directional_progress", "path_distance", "path_efficiency"):
        a = float(getattr(kernel_snapshot, field))
        b = float(independent[field])
        if not (abs(a - b) <= tol):
            d.append(f"{field} {a!r} vs {b!r}")
    return d


__all__ = ["COMPARED_KEYS", "DIAGNOSTIC_ONLY", "MIN_COMPLETED_1M", "compare",
           "independent_force",
           "parent_for_setup"]
