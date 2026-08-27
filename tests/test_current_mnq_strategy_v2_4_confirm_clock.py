from __future__ import annotations

import pandas as pd

from research import current_mnq_strategy_v2_4_levels as levels

TZ = "America/New_York"


def ts(text: str) -> pd.Timestamp:
    return pd.Timestamp(text, tz=TZ)


def test_reference_lower_boundary_uses_confirmation_not_raw_swing_time():
    candidate_confirm = ts("2026-08-17 10:45")
    start = candidate_confirm - pd.Timedelta(days=40)
    # This swing formed just before the boundary but only became knowable inside
    # it. Confirmation-clock semantics require it to be included.
    history = pd.DataFrame([
        {
            "t": start - pd.Timedelta(minutes=30),
            "confirm": start + pd.Timedelta(minutes=15),
            "side": "R", "price": 20000.0, "wick": .4,
            "disp": 1.5, "atr": 20.0,
        },
        {
            "t": start - pd.Timedelta(hours=2),
            "confirm": start - pd.Timedelta(seconds=1),
            "side": "R", "price": 19900.0, "wick": .4,
            "disp": 9.0, "atr": 20.0,
        },
    ])
    prior = levels._candidate_prior_reference_set(history, "R", candidate_confirm, 40)
    assert len(prior) == 1
    assert float(prior.iloc[0].disp) == 1.5


def test_candidate_confirmation_itself_is_excluded_from_reference_set():
    candidate_confirm = ts("2026-08-17 10:45")
    history = pd.DataFrame([
        {"t": ts("2026-08-16 10:00"), "confirm": ts("2026-08-16 10:45"),
         "side": "S", "price": 19000.0, "wick": .4, "disp": 1.2, "atr": 20.0},
        {"t": ts("2026-08-17 10:00"), "confirm": candidate_confirm,
         "side": "S", "price": 18900.0, "wick": .4, "disp": 5.0, "atr": 20.0},
    ])
    prior = levels._candidate_prior_reference_set(history, "S", candidate_confirm, 40)
    assert list(prior["disp"]) == [1.2]
