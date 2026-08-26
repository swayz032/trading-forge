#!/usr/bin/env python3
"""Causal intra-candle force watcher for Current MNQ v2.4.

The trader does not wait for a momentum candle to finish. He watches the live
buyer/seller tug-of-war and enters while the candle is still forming once force
is sustained; waiting for the full 5m close can create a materially late entry
against the frozen 17.25-point stop.

Historical/live parity constraint:
- use ONLY completed 1-minute sub-bars;
- never infer tick order inside a 1-minute OHLC bar;
- never use the completed parent 5m/15m candle to authorize an earlier entry.

No PnL-selected threshold is introduced. The equation deliberately reuses the
already-frozen Params.body_frac and Params.close_loc values:

    FORCE = PARTIAL_MOMENTUM_GEOMETRY
            AND PATH_EFFICIENCY >= Params.body_frac
            AND LATEST_CLOSE_REGAINS_DIRECTIONAL_EXTREME
            AND >= 2 COMPLETED_1M_OBSERVATIONS
            AND PARENT_CANDLE_NOT_YET_CLOSED

Path efficiency asks how much of the minute-close travel produced net progress
in the intended direction. A candle that repeatedly surges and gives the move
back therefore fails even if a later snapshot temporarily looks large.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from research import current_mnq_strategy_v2_3_engine as prod

core = prod.core
EPS = 1e-12
MIN_COMPLETED_1M_OBSERVATIONS = 2

#: This module's UNTAUGHT choices, declared rather than buried in a default. ALGO-096A ruled
#: `UNFROZEN_CHOICES` is a PER-MODULE convention (`breakout_derivation.py:73` owns
#: `acceptance_bars`, `target_policy.py:77` owns the $400 floor; there is no aggregating
#: registry), so the force site declares its own rather than reaching into a sealed module.
UNFROZEN_CHOICES = {
    "path_efficiency_threshold": (
        "PATH_EFFICIENCY >= Params.body_frac (0.62). The spec teaches that temporary bursts "
        "and tug-of-war are not sustained force, and names NO fraction; reusing the candle "
        "body_frac here is this module's reading of 'sustained', not a frozen value. The "
        "reuse is deliberate and documented above, but body_frac is a v2.2 Params default "
        "shipped with the tuning search range (0.56, 0.68) - a parameter born with a search "
        "range is a construction, not a teaching. MEASURED UNBINDING: "
        "TUG_OF_WAR_PATH_TOO_INEFFICIENT fired 0 of 14 times across the operator's clocks "
        "(ALGO-096 §3), so it refuses nothing we can observe and is left exactly as it is. "
        "It has never been moved, and never selected by any outcome, PnL or score."),
}


@dataclass(frozen=True)
class ForceSnapshot:
    confirmed: bool
    direction: str
    parent_start: pd.Timestamp
    parent_minutes: int
    decision_time: pd.Timestamp | None
    completed_1m: int
    open: float | None
    high: float | None
    low: float | None
    close: float | None
    directional_progress: float
    path_distance: float
    path_efficiency: float
    latest_close_at_directional_extreme: bool
    partial_momentum_geometry: bool
    reason: str

    def as_row(self, atr: float | None = None) -> pd.Series | None:
        if self.open is None:
            return None
        return pd.Series({
            "open": float(self.open),
            "high": float(self.high),
            "low": float(self.low),
            "close": float(self.close),
            "atr": float(atr) if atr is not None and np.isfinite(atr) else np.nan,
        })


def _directional_body(row, direction: str) -> bool:
    """The taught force SHAPE: a DIRECTIONAL BODY on the forming candle. F1, ALGO-096 §5.

    The taught content is the shape — *"momentum = directional body/control geometry; range
    expansion not required"* (`engineer_onboarding:98`, spec
    `entry_trigger_semantics.momentum_candle`). The MAGNITUDES were never his: `body_frac 0.62`
    and `close_loc 0.78` are v2.2 `Params` defaults shipped with tuning search ranges
    (`v2_2_engine.py:95` `(0.56, 0.68)`, `:97` `(0.72, 0.84)`) — a parameter born with a search
    range is a construction — and ALGO-071 §3 records the operator saying these two numbers
    were never his definition.

    "Control" is ALREADY carried at this site by `LATEST_CLOSE_AT_DIRECTIONAL_EXTREME`, so
    demanding it a second time through an untaught close-location fraction is the construction,
    not the teaching. Measured at his clocks (ALGO-096 §3): 04-09 11:37 had monotone progress,
    path efficiency 1.00 and its close AT the extreme, and was refused by this clause alone.

    DELIBERATELY LOCAL. `entries.momentum_bar` has other callers and ALGO-096 §5 forbids
    editing it; this predicate is defined here so the change reaches the force site and
    nowhere else. The efficiency clause below is NOT touched.
    """
    o, c = float(row.open), float(row.close)
    return bool(c > o) if direction == "L" else bool(c < o)


def _completed_subbars(one: pd.DataFrame, parent_start: pd.Timestamp,
                       parent_minutes: int, known_at: pd.Timestamp) -> pd.DataFrame:
    parent_end = parent_start + pd.Timedelta(minutes=int(parent_minutes))
    q = one[
        (one.index >= parent_start)
        & (one.index < parent_end)
        & ((one.index + pd.Timedelta(minutes=1)) <= known_at)
    ]
    return q[["open", "high", "low", "close"]].copy()


def force_snapshot(one: pd.DataFrame, parent_start: pd.Timestamp,
                   parent_minutes: int, direction: str,
                   known_at: pd.Timestamp, p: core.Params) -> ForceSnapshot:
    if direction not in {"L", "S"}:
        raise ValueError("direction must be L or S")
    if parent_minutes <= 1:
        raise ValueError("parent_minutes must be > 1")
    if known_at.tzinfo is None or parent_start.tzinfo is None:
        raise RuntimeError("V24_FORCE_TIMESTAMPS_MUST_BE_TZ_AWARE")

    parent_end = parent_start + pd.Timedelta(minutes=int(parent_minutes))
    q = _completed_subbars(one, parent_start, parent_minutes, known_at)
    n = int(len(q))
    if n == 0:
        return ForceSnapshot(False, direction, parent_start, parent_minutes, None,
                             0, None, None, None, None, 0.0, 0.0, 0.0,
                             False, False, "NO_COMPLETED_1M")

    o = float(q.iloc[0].open)
    h = float(q.high.max())
    l = float(q.low.min())
    c = float(q.iloc[-1].close)
    row = pd.Series({"open": o, "high": h, "low": l, "close": c})

    path = np.concatenate(([o], q.close.to_numpy(float)))
    deltas = np.diff(path)
    distance = float(np.abs(deltas).sum())
    progress = float(c - o) if direction == "L" else float(o - c)
    efficiency = float(progress / max(distance, EPS))

    closes = q.close.to_numpy(float)
    at_extreme = bool(
        c >= float(np.max(closes)) - EPS
        if direction == "L"
        else c <= float(np.min(closes)) + EPS
    )
    # RECORDED, NOT GATING (ALGO-098). `_directional_body` is `close beyond open in the
    # direction`, which for a LONG is exactly `progress > 0` - and `efficient` below ALREADY
    # requires `progress > 0`. The clause is therefore ENTAILED: no input can satisfy
    # `efficient` and fail `geometry`, so it can neither refuse anything nor be tested. It is
    # kept as an observation on the snapshot and removed from the conjunction, because a gate
    # that cannot refuse is not a gate - it is dead code wearing a citation.
    #
    # PRE-REGISTERED AND CHECKED: removing an entailed clause must move ZERO approvals. The
    # 14-session capture is 143 before and after. If it had moved even one, the entailment
    # argument would have been wrong and the clause would have gone back in.
    geometry = bool(_directional_body(row, direction))
    before_parent_close = bool(known_at < parent_end)
    enough_observations = n >= MIN_COMPLETED_1M_OBSERVATIONS
    efficient = bool(progress > 0 and efficiency >= float(p.body_frac))

    confirmed = bool(
        enough_observations
        and before_parent_close
        and efficient
        and at_extreme
    )
    if confirmed:
        reason = "SUSTAINED_DIRECTIONAL_FORCE"
    elif not enough_observations:
        reason = "INSUFFICIENT_1M_OBSERVATIONS"
    elif not before_parent_close:
        reason = "PARENT_CANDLE_ALREADY_CLOSED"
    elif not geometry:
        reason = "PARTIAL_MOMENTUM_GEOMETRY_NOT_PROVEN"
    elif not efficient:
        reason = "TUG_OF_WAR_PATH_TOO_INEFFICIENT"
    else:
        reason = "LATEST_CLOSE_HAS_NOT_REGAINED_DIRECTIONAL_EXTREME"

    decision_time = q.index[-1] + pd.Timedelta(minutes=1)
    return ForceSnapshot(
        confirmed=confirmed,
        direction=direction,
        parent_start=parent_start,
        parent_minutes=int(parent_minutes),
        decision_time=decision_time,
        completed_1m=n,
        open=o, high=h, low=l, close=c,
        directional_progress=progress,
        path_distance=distance,
        path_efficiency=efficiency,
        latest_close_at_directional_extreme=at_extreme,
        partial_momentum_geometry=geometry,
        reason=reason,
    )


def decision_times(one: pd.DataFrame, parent_start: pd.Timestamp,
                   parent_minutes: int, known_at: pd.Timestamp | None = None) -> list[pd.Timestamp]:
    """Completed-1m decision clocks strictly before the parent candle closes."""
    parent_end = parent_start + pd.Timedelta(minutes=int(parent_minutes))
    q = one[(one.index >= parent_start) & (one.index < parent_end)]
    if known_at is not None:
        q = q[(q.index + pd.Timedelta(minutes=1)) <= known_at]
    out = []
    for ts in q.index:
        t = ts + pd.Timedelta(minutes=1)
        if t < parent_end:
            out.append(t)
    return out


def first_force_confirmation(one: pd.DataFrame, parent_start: pd.Timestamp,
                             parent_minutes: int, direction: str,
                             p: core.Params,
                             known_at: pd.Timestamp | None = None) -> ForceSnapshot | None:
    """Return the first causal force confirmation inside the forming parent candle."""
    limit = known_at or (parent_start + pd.Timedelta(minutes=int(parent_minutes)))
    for t in decision_times(one, parent_start, parent_minutes, limit):
        snap = force_snapshot(one, parent_start, parent_minutes, direction, t, p)
        if snap.confirmed:
            return snap
    return None
