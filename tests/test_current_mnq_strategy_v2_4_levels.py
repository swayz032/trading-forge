from __future__ import annotations

from types import SimpleNamespace

import pandas as pd

from research import current_mnq_strategy_v2_4_levels as levels
from research import current_mnq_strategy_v2_3_engine as prod

core = prod.core
TZ = "America/New_York"


def piv(rows):
    return pd.DataFrame(rows, columns=["t", "confirm", "side", "price", "wick", "disp", "atr"])


def ts(text):
    return pd.Timestamp(text, tz=TZ)


def empty_bars():
    return pd.DataFrame(index=pd.DatetimeIndex([], tz=TZ))


def test_one_exceptional_swing_can_create_zone_before_multiple_rejections_exist():
    asof = ts("2026-08-17 09:30")
    q = piv([
        (ts("2026-08-10 10:00"), ts("2026-08-10 10:45"), "R", 20000.0, .25, .50, 20.0),
        (ts("2026-08-11 10:00"), ts("2026-08-11 10:45"), "R", 20100.0, .28, .60, 20.0),
        (ts("2026-08-12 10:00"), ts("2026-08-12 10:45"), "R", 20200.0, .30, .70, 20.0),
        (ts("2026-08-13 10:00"), ts("2026-08-13 10:45"), "R", 20300.0, .35, 1.60, 20.0),
    ])
    out = levels.exceptional_single_swing_zones(q, pd.DataFrame(), empty_bars(), asof, core.Params())
    assert len(out) == 1
    assert out[0].source == levels.SOURCE
    assert out[0].side == "R"
    assert out[0].mid == 20300.0
    assert out[0].entry_authorized is True
    assert out[0].zone.touches == 1


def test_ordinary_single_pivot_does_not_become_zone_just_because_it_exists():
    asof = ts("2026-08-17 09:30")
    q = piv([
        (ts("2026-08-13 10:00"), ts("2026-08-13 10:45"), "S", 19000.0, .35, .80, 20.0),
    ])
    out = levels.exceptional_single_swing_zones(q, pd.DataFrame(), empty_bars(), asof, core.Params())
    assert out == []  # frozen absolute floor is 1.0 ATR


def test_future_unconfirmed_pivot_is_never_used():
    asof = ts("2026-08-17 09:30")
    q = piv([
        (ts("2026-08-17 09:15"), ts("2026-08-17 10:00"), "R", 20500.0, .80, 3.0, 20.0),
    ])
    out = levels.exceptional_single_swing_zones(q, pd.DataFrame(), empty_bars(), asof, core.Params())
    assert out == []


def test_established_multi_rejection_zone_wins_over_overlapping_single_swing():
    asof = ts("2026-08-17 09:30")
    q = piv([
        (ts("2026-08-13 10:00"), ts("2026-08-13 10:45"), "R", 20300.0, .60, 2.0, 20.0),
    ])
    mature = core.Location(
        id="MATURE", side="R", lo=20298.0, hi=20302.0, mid=20300.0,
        source="WICK_ZONE", quality=.9, confluence=1,
        entry_authorized=True, zone=None,
    )
    out = levels.exceptional_single_swing_zones(
        q, pd.DataFrame(), empty_bars(), asof, core.Params(), established=[mature]
    )
    assert out == []


def test_key_level_and_native_fvg_overlap_add_confluence_without_changing_equation():
    asof = ts("2026-08-17 09:30")
    q = piv([
        (ts("2026-08-13 10:00"), ts("2026-08-13 10:45"), "S", 19000.0, .65, 2.0, 20.0),
    ])
    fvg = SimpleNamespace(lo=18999.0, hi=19001.0)
    out = levels.exceptional_single_swing_zones(
        q, pd.DataFrame(), empty_bars(), asof, core.Params(),
        refs=[19000.0], native_fvgs=[fvg],
    )
    assert len(out) == 1
    assert out[0].confluence == 2


def test_percentile_threshold_adapts_up_when_recent_market_has_larger_swings():
    q = pd.DataFrame({"disp": [1.1, 1.2, 1.5, 2.0, 3.0]})
    threshold = levels._reference_threshold(q, floor_atr=1.0, percentile=.75, min_refs=4)
    assert threshold == 2.0


def test_key_level_contract_contains_no_pnl_optimizer():
    spec = levels.load_key_level_spec()
    assert spec["anti_overfit"]["no_PnL_selection"] is True
    assert spec["anti_overfit"]["no_threshold_search"] is True
    assert spec["exceptional_single_swing_path"]["recent_displacement_percentile"] == .75
    assert spec["exceptional_single_swing_path"]["absolute_displacement_floor_atr"] == 1.0
