from __future__ import annotations

from types import SimpleNamespace

import pandas as pd
import pytest

from research import current_mnq_strategy_v2_4_levels as levels
from research import current_mnq_strategy_v2_3_engine as prod

core = prod.core
TZ = "America/New_York"

# Every fixture in this file used to pass `pd.DataFrame()` as the 15m frame, so every pivot
# that reached the band build ran through the join's old `except Exception: return 0.5` and
# asserted against a FABRICATED close_away. ALGO-119 made that join fail loudly, and the six
# tests that were riding the fallback went red. They now carry the source candle each pivot
# would actually have come from — which is what they always claimed to be testing.

BAR_RANGE = 20.0


def piv(rows):
    return pd.DataFrame(rows, columns=["t", "confirm", "side", "price", "wick", "disp", "atr"])


def bars_for(rows, rng: float = BAR_RANGE) -> pd.DataFrame:
    """The 15m candle each pivot row would have been emitted from.

    Built to `v1_fast.pivots`' OWN definitions, not to a convenient shape: `price` is the
    extreme it emits, and `wick` is the fraction measured from the BODY EDGE.
    """
    recs, idx = [], []
    for t, _confirm, side, price, wick, _disp, _atr in rows:
        if side == "S":
            recs.append({"open": price + rng, "high": price + rng,
                         "low": price, "close": price + wick * rng})
        else:
            recs.append({"open": price - rng, "high": price,
                         "low": price - rng, "close": price - wick * rng})
        idx.append(t)
    return pd.DataFrame(recs, index=pd.DatetimeIndex(idx))


def level(loc) -> float:
    """The pivot's own key level — the wick extreme, which the ruled band starts from.

    It used to be readable as `loc.mid`, because the band was symmetric about the extreme.
    On the ruled band the extreme is an EDGE, so identity assertions read the edge.
    """
    return float(loc.hi) if loc.side == "R" else float(loc.lo)


def ts(text):
    return pd.Timestamp(text, tz=TZ)


def empty_bars():
    return pd.DataFrame(index=pd.DatetimeIndex([], tz=TZ))


def test_one_exceptional_swing_can_create_zone_before_multiple_rejections_exist():
    asof = ts("2026-08-17 09:30")
    rows = [
        (ts("2026-08-10 10:00"), ts("2026-08-10 10:45"), "R", 20000.0, .25, .50, 20.0),
        (ts("2026-08-11 10:00"), ts("2026-08-11 10:45"), "R", 20100.0, .28, .60, 20.0),
        (ts("2026-08-12 10:00"), ts("2026-08-12 10:45"), "R", 20200.0, .30, .70, 20.0),
        (ts("2026-08-13 10:00"), ts("2026-08-13 10:45"), "R", 20300.0, .35, 1.60, 20.0),
    ]
    out = levels.exceptional_single_swing_zones(
        piv(rows), bars_for(rows), empty_bars(), asof, core.Params())
    assert len(out) == 1
    assert out[0].source == levels.SOURCE
    assert out[0].side == "R"
    assert level(out[0]) == 20300.0
    # the ruled band: from the wick extreme down to that candle's close, nothing added
    assert (out[0].lo, out[0].hi) == (20300.0 - .35 * BAR_RANGE, 20300.0)
    assert out[0].entry_authorized is True
    assert out[0].zone.touches == 1


def test_ordinary_single_pivot_does_not_become_zone_just_because_it_exists():
    asof = ts("2026-08-17 09:30")
    rows = [
        (ts("2026-08-13 10:00"), ts("2026-08-13 10:45"), "S", 19000.0, .35, .80, 20.0),
    ]
    out = levels.exceptional_single_swing_zones(
        piv(rows), bars_for(rows), empty_bars(), asof, core.Params())
    assert out == []


def test_future_unconfirmed_pivot_is_never_used():
    asof = ts("2026-08-17 09:30")
    rows = [
        (ts("2026-08-17 09:15"), ts("2026-08-17 10:00"), "R", 20500.0, .80, 3.0, 20.0),
    ]
    out = levels.exceptional_single_swing_zones(
        piv(rows), bars_for(rows), empty_bars(), asof, core.Params())
    assert out == []


def test_reference_window_is_frozen_at_candidate_confirmation_not_current_asof():
    rows = [
        (ts("2026-06-10 10:00"), ts("2026-06-10 10:45"), "R", 19500.0, .40, 1.40, 20.0),
        (ts("2026-06-11 10:00"), ts("2026-06-11 10:45"), "R", 19600.0, .40, 1.50, 20.0),
        (ts("2026-06-12 10:00"), ts("2026-06-12 10:45"), "R", 19700.0, .40, 1.60, 20.0),
        (ts("2026-06-13 10:00"), ts("2026-06-13 10:45"), "R", 19800.0, .40, 1.70, 20.0),
        (ts("2026-07-15 10:00"), ts("2026-07-15 10:45"), "R", 20500.0, .45, 1.30, 20.0),
    ]
    q, h15 = piv(rows), bars_for(rows)
    early = levels.exceptional_single_swing_zones(
        q, h15, empty_bars(), ts("2026-07-16 09:30"), core.Params()
    )
    late = levels.exceptional_single_swing_zones(
        q, h15, empty_bars(), ts("2026-08-17 09:30"), core.Params()
    )
    assert not any(level(x) == 20500.0 for x in early)
    assert not any(level(x) == 20500.0 for x in late)


def test_later_giant_pivots_cannot_retroactively_invalidate_earlier_exceptional_swing():
    asof = ts("2026-08-17 09:30")
    early = (
        ts("2026-08-10 10:00"), ts("2026-08-10 10:45"),
        "R", 20000.0, .40, 1.25, 20.0,
    )
    rows = [
        early,
        (ts("2026-08-11 10:00"), ts("2026-08-11 10:45"), "R", 20500.0, .50, 4.0, 20.0),
        (ts("2026-08-12 10:00"), ts("2026-08-12 10:45"), "R", 21000.0, .50, 5.0, 20.0),
        (ts("2026-08-13 10:00"), ts("2026-08-13 10:45"), "R", 21500.0, .50, 6.0, 20.0),
        (ts("2026-08-14 10:00"), ts("2026-08-14 10:45"), "R", 22000.0, .50, 7.0, 20.0),
    ]
    out = levels.exceptional_single_swing_zones(
        piv(rows), bars_for(rows), empty_bars(), asof, core.Params())
    assert any(level(x) == 20000.0 for x in out)


def test_candidate_does_not_grade_itself_inside_its_reference_distribution():
    asof = ts("2026-08-17 09:30")
    rows = [
        (ts("2026-08-10 10:00"), ts("2026-08-10 10:45"), "S", 19000.0, .40, 1.10, 20.0),
        (ts("2026-08-11 10:00"), ts("2026-08-11 10:45"), "S", 18900.0, .40, 1.20, 20.0),
        (ts("2026-08-12 10:00"), ts("2026-08-12 10:45"), "S", 18800.0, .40, 1.30, 20.0),
        (ts("2026-08-13 10:00"), ts("2026-08-13 10:45"), "S", 18700.0, .40, 1.40, 20.0),
        (ts("2026-08-14 10:00"), ts("2026-08-14 10:45"), "S", 18600.0, .40, 1.31, 20.0),
    ]
    out = levels.exceptional_single_swing_zones(
        piv(rows), bars_for(rows), empty_bars(), asof, core.Params())
    assert not any(level(x) == 18600.0 for x in out)


def test_established_multi_rejection_zone_wins_over_overlapping_single_swing():
    asof = ts("2026-08-17 09:30")
    rows = [
        (ts("2026-08-13 10:00"), ts("2026-08-13 10:45"), "R", 20300.0, .60, 2.0, 20.0),
    ]
    mature = core.Location(
        id="MATURE", side="R", lo=20298.0, hi=20302.0, mid=20300.0,
        source="WICK_ZONE", quality=.9, confluence=1,
        entry_authorized=True, zone=None,
    )
    out = levels.exceptional_single_swing_zones(
        piv(rows), bars_for(rows), empty_bars(), asof, core.Params(), established=[mature]
    )
    assert out == []


def test_active_fvg_overlap_adds_the_only_allowed_external_confluence_vote():
    asof = ts("2026-08-17 09:30")
    rows = [
        (ts("2026-08-13 10:00"), ts("2026-08-13 10:45"), "S", 19000.0, .65, 2.0, 20.0),
    ]
    fvg = SimpleNamespace(lo=18999.0, hi=19001.0)
    out = levels.exceptional_single_swing_zones(
        piv(rows), bars_for(rows), empty_bars(), asof, core.Params(),
        refs=[], native_fvgs=[fvg],
    )
    assert len(out) == 1
    assert out[0].confluence == 1


def test_prior_day_or_week_reference_injection_fails_closed():
    asof = ts("2026-08-17 09:30")
    rows = [
        (ts("2026-08-13 10:00"), ts("2026-08-13 10:45"), "S", 19000.0, .65, 2.0, 20.0),
    ]
    with pytest.raises(RuntimeError, match="V24_LEGACY_PRIOR_DAY_WEEK_REFERENCE_FORBIDDEN"):
        levels.exceptional_single_swing_zones(
            piv(rows), bars_for(rows), empty_bars(), asof, core.Params(), refs=[19000.0],
        )


def test_percentile_threshold_adapts_up_when_recent_market_has_larger_swings():
    q = pd.DataFrame({"disp": [1.1, 1.2, 1.5, 2.0, 3.0]})
    threshold = levels._reference_threshold(q, floor_atr=1.0, percentile=.75, min_refs=4)
    assert threshold == 2.0


def test_sr_location_contract_contains_no_pnl_optimizer_and_forbids_later_pivots():
    spec = levels.load_key_level_spec()
    assert spec["anti_overfit"]["no_PnL_selection"] is True
    assert spec["anti_overfit"]["no_threshold_search"] is True
    assert set(spec["forbidden_location_families"]) == {"PDH", "PDL", "PWH", "PWL"}
    rule = spec["exceptional_single_swing_path"]
    assert rule["recent_displacement_percentile"] == .75
    assert rule["absolute_displacement_floor_atr"] == 1.0
    assert rule["lookback_anchor"] == "candidate_confirmation_time"
    assert rule["current_asof_may_not_rewindow_candidate_reference_history"] is True
    assert rule["reference_pivots_must_confirm_before_candidate"] is True
    assert rule["candidate_itself_excluded_from_reference_distribution"] is True
    assert rule["later_pivots_forbidden_from_retroactive_classification"] is True
    assert rule["older_reference_pivots_aging_out_of_current_map_may_not_reclassify_candidate"] is True
