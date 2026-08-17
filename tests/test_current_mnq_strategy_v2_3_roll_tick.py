from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd

from research import current_mnq_strategy_v2_3_data as data


def _frame(contract: str, closes: list[float]) -> pd.DataFrame:
    idx = pd.date_range("2026-03-13 19:30:00+00:00", periods=len(closes), freq="1min")
    c = np.asarray(closes, dtype=float)
    return pd.DataFrame({
        "datetime": idx,
        "open": c,
        "high": c + 0.25,
        "low": c - 0.25,
        "close": c,
        "volume": 1,
        "contract_id": contract,
    })


def test_even_median_half_tick_roll_basis_is_quantized_to_mnq_grid():
    # 10 observations at 10.00 basis and 10 at 10.25 -> statistical median
    # is 10.125. A continuous futures bridge may not preserve that half tick.
    old_close = [20000.0 + i * 0.25 for i in range(20)]
    gaps = [10.0] * 10 + [10.25] * 10
    new_close = [a + b for a, b in zip(old_close, gaps)]
    old = _frame("CON.F.US.MNQ.H26", old_close)
    new = _frame("CON.F.US.MNQ.M26", new_close)
    bridge = data.compute_roll_bridge(old, new, date(2026, 3, 16), min_shared=10)
    assert bridge.raw_gap_new_minus_old == 10.25
    assert abs(bridge.raw_gap_new_minus_old / data.TICK - round(bridge.raw_gap_new_minus_old / data.TICK)) < 1e-9


def test_forward_adjust_refuses_a_manually_injected_half_tick_bridge():
    lead = pd.DataFrame({
        "datetime": pd.to_datetime(["2026-03-13 20:00:00+00:00", "2026-03-16 13:30:00+00:00"]),
        "open": [20000.0, 20010.25],
        "high": [20000.25, 20010.50],
        "low": [19999.75, 20010.0],
        "close": [20000.0, 20010.25],
        "volume": [1, 1],
        "contract_id": ["CON.F.US.MNQ.H26", "CON.F.US.MNQ.M26"],
        "session": [date(2026, 3, 13), date(2026, 3, 16)],
    })
    bridge = data.RollBridge(
        roll_date="2026-03-16",
        old_contract="CON.F.US.MNQ.H26",
        new_contract="CON.F.US.MNQ.M26",
        anchor_start="x",
        anchor_end="y",
        shared_minutes=20,
        raw_gap_new_minus_old=10.125,
    )
    adjusted = data.forward_adjust(lead, [bridge])
    # Runtime defense quantizes even if an external bridge object is malformed.
    assert adjusted.iloc[1].price_adjustment == -10.25
    for c in ("open", "high", "low", "close"):
        assert np.allclose(adjusted[c] / data.TICK, np.round(adjusted[c] / data.TICK))
