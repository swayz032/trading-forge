"""★ CAUSALITY PROOF for the WIRE-1 STRUCTURE COLUMN (R-066 §2 applied to the step function).

`test_htf_straddle_causality` proves the availability HELPER excludes the forming bar.
That is necessary but NOT sufficient: the column BUILDER could still leak by feeding
`compute_structure_state` an exec slice that extends past `t`, or by stamping a value
computed at boundary `b` onto bars BEFORE `b`. This proves the built column itself.

Method — FUTURE-PERTURBATION replay (same instrument that validated the daily cache):
    build the column on real-shaped frames            -> v1
    CORRUPT every exec+HTF bar from index k onward    -> v2
    assert v1[:k] == v2[:k]
If any value before k moved, that value was a function of the future. The error
direction would be OPTIMISTIC — trades would drop for a reason that isn't real gating,
faking the fidelity gain the 0.99 re-measure is supposed to detect.

Anti-vacuity companion included per the R-069 §2 house pattern.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta

import polars as pl

_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from src.engine.context.htf_columns import COL_STRUCTURE_ACTIVE, attach_structure_column  # noqa: E402

BASE = datetime(2022, 3, 1)
N_EXEC = 600          # 5-minute bars
N_HTF = 40            # 4h bars


def _zigzag(n: int, amp: float, leg: int) -> list[float]:
    """Impulse/pullback zigzag with a rising bias — produces real swing highs/lows so
    the structure detector has BOS/CHoCH to find. A smooth series makes the detector
    return a constant, which silently vacuates a causality probe (caught by the
    anti-vacuity companion below on the first attempt)."""
    out, price, direction = [], 100.0, 1
    for i in range(n):
        if i % leg == 0:
            direction *= -1
        price += direction * amp * (1.0 + (i % 5) * 0.25) + 0.06  # net upward drift
        out.append(price)
    return out


def _exec_frame(n: int = N_EXEC) -> pl.DataFrame:
    close = _zigzag(n, amp=0.9, leg=17)
    return pl.DataFrame({
        "ts_event": [BASE + timedelta(minutes=5 * i) for i in range(n)],
        "open": [c - 0.2 for c in close],
        "high": [c + 0.6 for c in close],
        "low": [c - 0.6 for c in close],
        "close": close,
        "volume": [500.0 + (i % 23) for i in range(n)],
    })


def _htf_frame(n: int = N_HTF) -> pl.DataFrame:
    close = _zigzag(n, amp=2.4, leg=5)
    return pl.DataFrame({
        "ts_event": [BASE + timedelta(hours=4 * i) for i in range(n)],
        "open": [c - 0.4 for c in close],
        "high": [c + 1.2 for c in close],
        "low": [c - 1.2 for c in close],
        "close": close,
        "volume": [900.0 + i for i in range(n)],
    })


def _corrupt_from(df: pl.DataFrame, idx: int) -> pl.DataFrame:
    """Replace every bar from `idx` onward with a FLAT series.

    NOTE (bought by the anti-vacuity companion): the obvious corruption — multiplying
    OHLC by a constant — is a NO-OP here, because swing/BOS/CHoCH detection is
    SCALE-INVARIANT. Scaling preserves which highs exceed which lows, so the detector
    returned an identical state and the probe proved nothing. The perturbation must
    change the SHAPE of the series, not its level."""
    n = len(df)
    close = df["close"].to_list()
    flat = float(close[max(0, idx - 1)]) if n else 0.0
    new_close = [close[i] if i < idx else flat for i in range(n)]
    return df.with_columns([
        pl.Series("open", [c for c in new_close]),
        pl.Series("high", [c + (0.6 if i < idx else 0.01) for i, c in enumerate(new_close)]),
        pl.Series("low", [c - (0.6 if i < idx else 0.01) for i, c in enumerate(new_close)]),
        pl.Series("close", new_close),
    ])


def _column(exec_df: pl.DataFrame, htf_df: pl.DataFrame) -> list:
    out, _ = attach_structure_column(exec_df, htf_df, tf="4h")
    return out[COL_STRUCTURE_ACTIVE].to_list()


def test_structure_column_values_do_not_depend_on_the_future():
    """★ THE PIN: corrupting exec+HTF bars from index k onward must not move any column
    value BEFORE k."""
    ex, htf = _exec_frame(), _htf_frame()
    k_exec = 400
    k_htf = 20  # ~ the same wall-clock point (400 * 5min = 33.3h ≈ htf bar 8; be generous)

    v1 = _column(ex, htf)
    v2 = _column(_corrupt_from(ex, k_exec), _corrupt_from(htf, k_htf))

    # compare only bars strictly before BOTH corruption points (in wall-clock terms the
    # HTF corruption starts earlier, so it is the binding constraint)
    cutoff = min(k_exec, int((htf["ts_event"][k_htf] - BASE).total_seconds() // 300))
    assert cutoff > 50, "cutoff too small to be a meaningful test"
    assert v1[:cutoff] == v2[:cutoff], (
        "LOOK-AHEAD in the structure column: a value before the corruption point moved "
        "when only FUTURE bars changed."
    )


def test_anti_vacuity_corrupting_the_PAST_does_move_values():
    """Companion: the column must be capable of changing at all, or the test above
    passes for a trivial reason (e.g. an all-None or constant column)."""
    ex, htf = _exec_frame(), _htf_frame()
    v1 = _column(ex, htf)
    v_past = _column(_corrupt_from(ex, 60), _corrupt_from(htf, 3))

    assert any(a is not None for a in v1), "column is entirely None — nothing proven"
    assert v1 != v_past, (
        "VACUOUS PROBE: corrupting the PAST did not change the column, so the "
        "future-perturbation test cannot detect look-ahead."
    )


def test_column_is_a_step_function_not_per_bar_noise():
    """R-067 §3 two-granularity: structure is a STEP FUNCTION advancing per COMPLETED
    HTF bar — it must hold its value between boundaries, not flip every bar."""
    ex, htf = _exec_frame(), _htf_frame()
    vals = [v for v in _column(ex, htf) if v is not None]
    assert len(vals) > 100, "not enough engaged bars to assess"
    flips = sum(1 for a, b in zip(vals, vals[1:]) if a != b)
    # 600 exec bars span ~50h => ~12 4h boundaries; flips must be bounded by that order,
    # nowhere near per-bar churn.
    assert flips <= 30, f"column flips {flips} times — that is per-bar noise, not a step function"


def test_no_htf_frame_yields_no_column_and_zero_engagement():
    ex = _exec_frame()
    out, engaged = attach_structure_column(ex, None, tf="4h")
    assert engaged == 0 and COL_STRUCTURE_ACTIVE not in out.columns
