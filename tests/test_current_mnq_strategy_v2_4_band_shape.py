"""THE RULED BAND SHAPE — the a-priori table of `..._band_shape_apriori.py`, executed.

ALGO-073 §2 ruled the zone shape from his own sentence and the code never carried it
(ALGO-109: the fifth clause this ladder ruled that never reached an executable line).
ALGO-119 authorized the build for the EXCEPTIONAL SINGLE-SWING path only.

Every expectation here is a transcription of a fixture that was committed BEFORE the build
in `research/current_mnq_strategy_v2_4_band_shape_apriori.py`. The table is imported and
each test names the fixture it executes, so a clause quietly re-expressed after seeing its
effect is visible as a table/test divergence.

WHAT THIS FILE DOES NOT COVER, stated plainly:
  * The ESTABLISHED multi-rejection path keeps its own construction. Out of scope by
    ALGO-111 §4, and untested here.
  * It pins the band EDGES and the refusal behaviour. It does not pin how many zones a real
    session produces — that is the guard's job, and a structural observable, not a target.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from research import current_mnq_strategy_v2_4_band_shape_apriori as apriori
from research import current_mnq_strategy_v2_4_levels as levels
from research import current_mnq_strategy_v2_3_engine as prod

core = prod.core
TZ = "America/New_York"

FIXTURES = {f.key: f for f in apriori.TABLE}


def ts(text):
    return pd.Timestamp(text, tz=TZ)


def source_bar(side: str, price: float, wick: float, rng: float) -> dict:
    """A 15m candle that a pivot with (side, price, wick) would actually have come from.

    Built to satisfy `v1_fast.pivots`' OWN definitions rather than to a convenient shape:
    `price` is the extreme it emits, and `wick` is the fraction measured from the BODY EDGE
    — upper = (high - max(open,close)) / range, lower = (min(open,close) - low) / range.
    """
    if side == "S":
        bar = {"open": price + rng, "high": price + rng,
               "low": price, "close": price + wick * rng}
        assert (min(bar["open"], bar["close"]) - bar["low"]) / rng == pytest.approx(wick)
    else:
        bar = {"open": price - rng, "high": price,
               "low": price - rng, "close": price - wick * rng}
        assert (bar["high"] - max(bar["open"], bar["close"])) / rng == pytest.approx(wick)
    return bar


def one_bar_frame(t, side: str, price: float, wick: float, rng: float) -> pd.DataFrame:
    return pd.DataFrame([source_bar(side, price, wick, rng)],
                        index=pd.DatetimeIndex([t], tz=TZ))


class Row:
    """The attribute surface `_pivot_source_bar` reads off an itertuples row."""

    def __init__(self, t, side):
        self.t = t
        self.side = side


# ── F1 / F2 — the two edges, from his sentence ──────────────────────────────────────────

def test_F1_support_band_runs_from_the_wick_low_UP_TO_the_close():
    f = FIXTURES["F1_SUPPORT_LONG_WICK"]
    assert "19000.0, 19007.0" in f.expected, "the a-priori table was changed after the fact"
    t = ts("2026-08-13 10:00")
    bar = one_bar_frame(t, "S", 19000.0, 0.35, 20.0).iloc[0]
    lo, hi = levels._rejection_band(bar, "S")
    assert (lo, hi) == (19000.0, 19007.0)
    # one-sided FROM the extreme, never across it
    assert lo == 19000.0
    assert hi - lo == pytest.approx(0.35 * 20.0)


def test_F2_resistance_band_runs_from_the_wick_high_DOWN_TO_the_close():
    f = FIXTURES["F2_RESISTANCE_MIRRORED"]
    assert "20293.0, 20300.0" in f.expected, "the a-priori table was changed after the fact"
    t = ts("2026-08-13 10:00")
    bar = one_bar_frame(t, "R", 20300.0, 0.35, 20.0).iloc[0]
    lo, hi = levels._rejection_band(bar, "R")
    assert (lo, hi) == (20293.0, 20300.0)
    assert hi == 20300.0
    assert hi - lo == pytest.approx(0.35 * 20.0)


def test_the_two_sides_are_MIRRORS_and_neither_half_is_dead_weight():
    """Swapping the side must move BOTH edges. A one-sided implementation passes F1 or F2,
    not both, and this asserts the pair rather than the two separately."""
    t = ts("2026-08-13 10:00")
    s_bar = one_bar_frame(t, "S", 19000.0, 0.40, 25.0).iloc[0]
    r_bar = one_bar_frame(t, "R", 19000.0, 0.40, 25.0).iloc[0]
    s_lo, s_hi = levels._rejection_band(s_bar, "S")
    r_lo, r_hi = levels._rejection_band(r_bar, "R")
    assert (s_lo, s_hi) == (float(s_bar.low), float(s_bar.close))
    assert (r_lo, r_hi) == (float(r_bar.close), float(r_bar.high))
    assert s_hi - s_lo == pytest.approx(r_hi - r_lo)


# ── F6 — no magnitude is added ──────────────────────────────────────────────────────────

def test_F6_the_edges_are_the_bars_OWN_values_bit_for_bit():
    """No pad, no ATR term, no tick floor, no rounding. Deliberately an ugly off-tick price:
    a tick floor or a `round_to_tick` would show up here and nowhere else."""
    t = ts("2026-08-13 10:00")
    bar = one_bar_frame(t, "S", 19000.13, 0.37, 17.0).iloc[0]
    lo, hi = levels._rejection_band(bar, "S")
    assert lo == float(bar.low)
    assert hi == float(bar.close)


def test_F6_the_retired_symmetric_construction_is_GONE_from_this_path():
    """`key_level_pad_atr` and the 4-tick floor decided the swing band until ALGO-119.
    They may still appear in a comment naming what was removed; they may not appear in code."""
    import inspect
    src = inspect.getsource(levels.exceptional_single_swing_zones)
    code = "\n".join(ln for ln in src.splitlines() if not ln.lstrip().startswith("#"))
    assert "key_level_pad_atr" not in code
    assert "TICK * 4" not in code


# ── F4 — the join fails loudly ──────────────────────────────────────────────────────────

def test_F4_a_missing_source_bar_RAISES_and_never_returns_the_old_0_5():
    t = ts("2026-08-13 10:00")
    empty = pd.DataFrame(index=pd.DatetimeIndex([], tz=TZ))
    with pytest.raises(RuntimeError, match="V24_PIVOT_SOURCE_BAR_JOIN_FAILED"):
        levels._pivot_source_bar(empty, Row(t, "S"))


def test_F4_the_whole_swing_path_refuses_rather_than_drawing_a_bandless_zone():
    """The failure must reach the CALLER, not be swallowed inside the loop."""
    asof = ts("2026-08-17 09:30")
    q = pd.DataFrame(
        [(ts("2026-08-13 10:00"), ts("2026-08-13 10:45"), "R", 20300.0, .60, 2.0, 20.0)],
        columns=["t", "confirm", "side", "price", "wick", "disp", "atr"])
    empty = pd.DataFrame(index=pd.DatetimeIndex([], tz=TZ))
    with pytest.raises(RuntimeError, match="V24_PIVOT_SOURCE_BAR_JOIN_FAILED"):
        levels.exceptional_single_swing_zones(q, empty, empty, asof, core.Params())


def test_F4_no_exception_handler_in_this_module_returns_a_fabricated_VALUE():
    """The convicting shape was `except Exception: return 0.5` inside the join. A band drawn
    from a fabricated bar is a plausible zone unrelated to its candle.

    CHECKED ON THE AST, NOT ON THE TEXT, and the first version of this test is why: written
    as a substring search it went RED against the DOCSTRING that describes the removed code.
    Five substring guards on this campaign have convicted the sentence written to make the
    promise. A handler may re-raise or raise; it may not answer with a value.
    """
    import ast
    import inspect
    tree = ast.parse(inspect.getsource(levels))
    offenders = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.ExceptHandler):
            continue
        for inner in ast.walk(node):
            if isinstance(inner, ast.Return) and inner.value is not None:
                offenders.append(f"line {inner.lineno}: {ast.unparse(inner)}")
    assert not offenders, (
        "an exception handler answers with a fabricated value: " + "; ".join(offenders))


# ── F5 — the width is positive BY CONSTRUCTION, which is why no floor is needed ──────────

def test_F5_width_is_bounded_below_by_min_wick_times_range_for_every_admitted_pivot():
    """The entailment is PINNED so no future seat re-derives it, and so that a change to the
    `wick >= min_wick` filter that would make a degenerate band reachable shows up here."""
    p = core.Params()
    t = ts("2026-08-13 10:00")
    rng = np.random.default_rng(20260826)
    for _ in range(2000):
        side = "S" if rng.random() < 0.5 else "R"
        wick = float(p.min_wick) + float(rng.random()) * (1.0 - float(p.min_wick))
        span = float(rng.uniform(0.25, 200.0))
        price = float(rng.uniform(15000.0, 25000.0))
        bar = one_bar_frame(t, side, price, wick, span).iloc[0]
        lo, hi = levels._rejection_band(bar, side)
        assert hi > lo
        assert hi - lo >= float(p.min_wick) * span - 1e-9


def test_F5_a_degenerate_band_RAISES_rather_than_passing_silently():
    """Unreachable today. It is asserted anyway: if the admission filter ever changes, the
    failure must be loud rather than a zero-width zone nothing can touch."""
    t = ts("2026-08-13 10:00")
    flat = pd.DataFrame([{"open": 19000.0, "high": 19000.0, "low": 19000.0, "close": 19000.0}],
                        index=pd.DatetimeIndex([t], tz=TZ)).iloc[0]
    with pytest.raises(RuntimeError, match="V24_REJECTION_BAND_DEGENERATE"):
        levels._rejection_band(flat, "S")
    with pytest.raises(RuntimeError, match="V24_REJECTION_BAND_DEGENERATE"):
        levels._rejection_band(flat, "R")


# ── F3 — a close inside a prior band changes nothing about the band ──────────────────────

def test_F3_the_band_is_NOT_reshaped_to_avoid_an_established_overlap():
    """His sentence names the candle and nothing else, so an overlap may not shrink, shift,
    pad or clip the band. The pre-existing established-overlap rule then drops the zone —
    which is a CONSEQUENCE of his shape, not a reason to change it."""
    asof = ts("2026-08-17 09:30")
    t = ts("2026-08-13 10:00")
    q = pd.DataFrame(
        [(t, ts("2026-08-13 10:45"), "R", 20300.0, .60, 2.0, 20.0)],
        columns=["t", "confirm", "side", "price", "wick", "disp", "atr"])
    h15 = one_bar_frame(t, "R", 20300.0, 0.60, 20.0)
    empty5 = pd.DataFrame(index=pd.DatetimeIndex([], tz=TZ))
    ruled_lo, ruled_hi = levels._rejection_band(h15.iloc[0], "R")

    # An established zone that the OLD symmetric band (20299.0-20301.0 at these inputs) would
    # have missed entirely, and that the RULED band reaches.
    mature = core.Location(id="MATURE", side="R", lo=ruled_lo - 1.0, hi=ruled_lo + 1.0,
                           mid=ruled_lo, source="WICK_ZONE", quality=.9, confluence=1,
                           entry_authorized=True, zone=None)
    assert not (20301.0 >= mature.lo and mature.hi >= 20299.0), (
        "the fixture must separate the two shapes, or it tests nothing")

    dropped = levels.exceptional_single_swing_zones(
        q, h15, empty5, asof, core.Params(), established=[mature])
    assert dropped == []

    # Move the established zone out of the way: the band is byte-identical, not reshaped.
    far = core.Location(id="FAR", side="R", lo=21000.0, hi=21002.0, mid=21001.0,
                        source="WICK_ZONE", quality=.9, confluence=1,
                        entry_authorized=True, zone=None)
    kept = levels.exceptional_single_swing_zones(
        q, h15, empty5, asof, core.Params(), established=[far])
    assert len(kept) == 1
    assert (kept[0].lo, kept[0].hi) == (ruled_lo, ruled_hi)


# ── the identity decisions recorded beside the table ────────────────────────────────────

def test_zone_identity_stays_anchored_on_the_level_so_before_after_joins_BY_KEY():
    asof = ts("2026-08-17 09:30")
    t = ts("2026-08-13 10:00")
    q = pd.DataFrame(
        [(t, ts("2026-08-13 10:45"), "S", 19000.0, .60, 2.0, 20.0)],
        columns=["t", "confirm", "side", "price", "wick", "disp", "atr"])
    h15 = one_bar_frame(t, "S", 19000.0, 0.60, 20.0)
    empty5 = pd.DataFrame(index=pd.DatetimeIndex([], tz=TZ))
    out = levels.exceptional_single_swing_zones(q, h15, empty5, asof, core.Params())
    assert len(out) == 1
    assert out[0].id == f"SWING:S:{ts('2026-08-13 10:45').isoformat()}:{round(19000.0/core.TICK)}"


def test_mid_is_the_RULED_BANDS_midpoint_not_an_edge_of_it():
    asof = ts("2026-08-17 09:30")
    t = ts("2026-08-13 10:00")
    q = pd.DataFrame(
        [(t, ts("2026-08-13 10:45"), "S", 19000.0, .60, 2.0, 20.0)],
        columns=["t", "confirm", "side", "price", "wick", "disp", "atr"])
    h15 = one_bar_frame(t, "S", 19000.0, 0.60, 20.0)
    empty5 = pd.DataFrame(index=pd.DatetimeIndex([], tz=TZ))
    out = levels.exceptional_single_swing_zones(q, h15, empty5, asof, core.Params())
    loc = out[0]
    assert loc.mid == pytest.approx((loc.lo + loc.hi) / 2.0)
    assert loc.lo < loc.mid < loc.hi


def test_the_apriori_table_still_holds_all_six_fixtures_this_file_executes():
    """A fixture deleted from the table to make a test pass is the failure this pins."""
    assert set(FIXTURES) == {
        "F1_SUPPORT_LONG_WICK", "F2_RESISTANCE_MIRRORED", "F3_CLOSE_INSIDE_A_PRIOR_BAND",
        "F4_JOIN_FAILURE_RAISES", "F5_WIDTH_IS_POSITIVE_BY_CONSTRUCTION",
        "F6_NO_MAGNITUDE_IS_ADDED"}
