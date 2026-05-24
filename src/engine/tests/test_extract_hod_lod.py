"""Tests for extract_hod_lod_for_persistence() — Wave 26.

Covers:
  1. Normal session — HOD and LOD correctly derived from bar extremes
  2. Empty bars → empty list
  3. Missing required columns (high/low) → empty list
  4. Invalid session_date → empty list
  5. Multi-day input: only bars for session_date are used
  6. HodLodRecord fields populated correctly (symbol, price, level_type, htf_significance)
  7. Single bar session → HOD == bar high, LOD == bar low
  8. HOD and LOD prices snapped to tick grid
  9. Idempotence — calling twice with same inputs returns identical list
 10. HOD always > LOD (or == when range=0)
 11. MCL symbol uses 0.01 tick grid
 12. No ts_event column → all rows treated as session_date

Day-trader mandate (CLAUDE.md §2b): HOD/LOD are INTRADAY reference levels.
htf_significance=1 (lowest tier) confirmed in all record-field tests.

All inputs are synthetic; no external data dependencies.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

import polars as pl
import pytest

from src.engine.indicators.volume_profile import (
    HodLodRecord,
    extract_hod_lod_for_persistence,
)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _make_session_bars(
    session_date: date,
    prices: list[tuple[float, float, float, float]],  # (open, high, low, close)
    include_ts: bool = True,
) -> pl.DataFrame:
    """Build synthetic intraday bars for one session.

    Args:
        prices: list of (open, high, low, close) tuples — one per bar.
        include_ts: when False, omits the ts_event column.
    """
    n = len(prices)
    records: dict = {
        "open":  [p[0] for p in prices],
        "high":  [p[1] for p in prices],
        "low":   [p[2] for p in prices],
        "close": [p[3] for p in prices],
    }
    if include_ts:
        records["ts_event"] = [
            datetime(session_date.year, session_date.month, session_date.day, 9, 30)
            + timedelta(minutes=5 * i)
            for i in range(n)
        ]
    return pl.DataFrame(records)


# ─── Tests ────────────────────────────────────────────────────────────────────

class TestExtractHodLod:

    def test_returns_two_records_for_normal_session(self):
        """Normal session returns exactly [hod, lod]."""
        bars = _make_session_bars(
            date(2026, 5, 23),
            [(4000, 4020, 3990, 4010), (4010, 4025, 4005, 4015)],
        )
        result = extract_hod_lod_for_persistence(bars, "MES", "2026-05-23")
        assert len(result) == 2

    def test_hod_is_session_high(self):
        """HOD record.price == max(high) across all session bars."""
        bars = _make_session_bars(
            date(2026, 5, 23),
            [(4000, 4020, 3990, 4010), (4010, 4035, 4005, 4030)],
        )
        result = extract_hod_lod_for_persistence(bars, "MES", "2026-05-23")
        hod = next(r for r in result if r.level_type == "hod")
        # session high = 4035 snapped to nearest 0.25 tick
        assert hod.price == pytest.approx(4035.0, abs=0.26)

    def test_lod_is_session_low(self):
        """LOD record.price == min(low) across all session bars."""
        bars = _make_session_bars(
            date(2026, 5, 23),
            [(4000, 4020, 3990, 4010), (4010, 4025, 3985, 4015)],
        )
        result = extract_hod_lod_for_persistence(bars, "MES", "2026-05-23")
        lod = next(r for r in result if r.level_type == "lod")
        assert lod.price == pytest.approx(3985.0, abs=0.26)

    def test_level_types_are_hod_and_lod(self):
        """The two records must have level_type 'hod' and 'lod'."""
        bars = _make_session_bars(
            date(2026, 5, 23),
            [(4000, 4010, 3995, 4005)],
        )
        result = extract_hod_lod_for_persistence(bars, "MES", "2026-05-23")
        types = {r.level_type for r in result}
        assert types == {"hod", "lod"}

    def test_htf_significance_is_1_for_both(self):
        """htf_significance MUST be 1 (intraday level — day-trader mandate)."""
        bars = _make_session_bars(
            date(2026, 5, 23),
            [(4000, 4015, 3990, 4005)],
        )
        result = extract_hod_lod_for_persistence(bars, "MES", "2026-05-23")
        for r in result:
            assert r.htf_significance == 1, (
                f"htf_significance must be 1 for intraday HOD/LOD, got {r.htf_significance}"
            )

    def test_symbol_stored_on_records(self):
        """symbol field must match the input symbol."""
        bars = _make_session_bars(
            date(2026, 5, 23),
            [(4000, 4010, 3995, 4005)],
        )
        result = extract_hod_lod_for_persistence(bars, "MNQ", "2026-05-23")
        for r in result:
            assert r.symbol == "MNQ"

    def test_session_date_stored_on_records(self):
        """session_date field must match the input session_date."""
        bars = _make_session_bars(
            date(2026, 5, 23),
            [(4000, 4010, 3995, 4005)],
        )
        result = extract_hod_lod_for_persistence(bars, "MES", "2026-05-23")
        for r in result:
            assert r.session_date == "2026-05-23"

    def test_empty_bars_returns_empty_list(self):
        """Empty bars input → empty list (no error)."""
        bars = pl.DataFrame({"ts_event": [], "high": [], "low": [], "close": []})
        result = extract_hod_lod_for_persistence(bars, "MES", "2026-05-23")
        assert result == []

    def test_missing_high_column_returns_empty(self):
        """Missing 'high' column → empty list."""
        bars = pl.DataFrame({"ts_event": [datetime(2026, 5, 23, 9, 30)], "low": [3990.0]})
        result = extract_hod_lod_for_persistence(bars, "MES", "2026-05-23")
        assert result == []

    def test_missing_low_column_returns_empty(self):
        """Missing 'low' column → empty list."""
        bars = pl.DataFrame({"ts_event": [datetime(2026, 5, 23, 9, 30)], "high": [4010.0]})
        result = extract_hod_lod_for_persistence(bars, "MES", "2026-05-23")
        assert result == []

    def test_invalid_session_date_returns_empty(self):
        """Malformed session_date → empty list (no exception)."""
        bars = _make_session_bars(date(2026, 5, 23), [(4000, 4010, 3990, 4000)])
        result = extract_hod_lod_for_persistence(bars, "MES", "not-a-date")
        assert result == []

    def test_multi_day_input_uses_only_session_date(self):
        """When bars span multiple days, only session_date bars contribute."""
        # Day 1 has extremely high/low — must NOT affect session_date result.
        # Use explicit floats in BOTH sessions so pl.concat sees matching Float64 columns.
        day1 = _make_session_bars(
            date(2026, 5, 22),
            [(4000.0, 9999.0, 1000.0, 4000.0)],
        )
        day2 = _make_session_bars(
            date(2026, 5, 23),
            [(4000.0, 4020.0, 3990.0, 4010.0)],
        )
        combined = pl.concat([day1, day2])
        result = extract_hod_lod_for_persistence(combined, "MES", "2026-05-23")

        hod = next(r for r in result if r.level_type == "hod")
        lod = next(r for r in result if r.level_type == "lod")

        # Must reflect day2 only — not day1's 9999/1000 extremes
        assert hod.price < 9000.0, "HOD must not use day1's extreme high"
        assert lod.price > 2000.0, "LOD must not use day1's extreme low"

    def test_single_bar_session(self):
        """Single-bar session: HOD == bar_high snapped, LOD == bar_low snapped."""
        bars = _make_session_bars(
            date(2026, 5, 23),
            [(4000.0, 4012.5, 3987.5, 4005.0)],
        )
        result = extract_hod_lod_for_persistence(bars, "MES", "2026-05-23")
        assert len(result) == 2
        hod = next(r for r in result if r.level_type == "hod")
        lod = next(r for r in result if r.level_type == "lod")
        assert hod.price == pytest.approx(4012.5, abs=0.26)
        assert lod.price == pytest.approx(3987.5, abs=0.26)

    def test_price_snapped_to_mes_tick_grid(self):
        """HOD/LOD prices are snapped to nearest MES tick (0.25)."""
        # bar high = 4017.1 → nearest 0.25 = 4017.25 or 4017.0 (round-half-up)
        bars = _make_session_bars(
            date(2026, 5, 23),
            [(4000.0, 4017.1, 3999.9, 4010.0)],
        )
        result = extract_hod_lod_for_persistence(bars, "MES", "2026-05-23")
        hod = next(r for r in result if r.level_type == "hod")
        lod = next(r for r in result if r.level_type == "lod")
        # Price must be a multiple of 0.25
        assert round(hod.price * 4) == int(hod.price * 4), (
            f"HOD price {hod.price} is not a multiple of 0.25"
        )
        assert round(lod.price * 4) == int(lod.price * 4), (
            f"LOD price {lod.price} is not a multiple of 0.25"
        )

    def test_idempotence_same_inputs(self):
        """Calling twice with identical inputs returns identical list."""
        bars = _make_session_bars(
            date(2026, 5, 23),
            [(4000, 4020, 3990, 4010), (4010, 4030, 4005, 4025)],
        )
        r1 = extract_hod_lod_for_persistence(bars, "MES", "2026-05-23")
        r2 = extract_hod_lod_for_persistence(bars, "MES", "2026-05-23")
        assert len(r1) == len(r2)
        for a, b in zip(r1, r2):
            assert a.price == b.price
            assert a.level_type == b.level_type

    def test_hod_strictly_gte_lod(self):
        """HOD price must always be >= LOD price."""
        bars = _make_session_bars(
            date(2026, 5, 23),
            [(4000, 4025, 3975, 4010), (4010, 4030, 3980, 4020)],
        )
        result = extract_hod_lod_for_persistence(bars, "MES", "2026-05-23")
        hod_price = next(r.price for r in result if r.level_type == "hod")
        lod_price = next(r.price for r in result if r.level_type == "lod")
        assert hod_price >= lod_price

    def test_mcl_symbol_uses_001_tick_grid(self):
        """MCL tick size is 0.01 — HOD/LOD snapped to 0.01 grid."""
        bars = _make_session_bars(
            date(2026, 5, 23),
            [(80.0, 80.234, 79.761, 80.1)],
        )
        result = extract_hod_lod_for_persistence(bars, "MCL", "2026-05-23")
        assert len(result) == 2
        hod = next(r for r in result if r.level_type == "hod")
        lod = next(r for r in result if r.level_type == "lod")
        # Price must be a multiple of 0.01 (within float precision)
        assert abs(round(hod.price * 100) - hod.price * 100) < 1e-6, (
            f"MCL HOD price {hod.price} not on 0.01 grid"
        )
        assert abs(round(lod.price * 100) - lod.price * 100) < 1e-6

    def test_no_ts_event_all_rows_treated_as_session(self):
        """When ts_event column is absent, all rows contribute regardless of date."""
        bars = pl.DataFrame({
            "high": [4020.0, 4030.0],
            "low":  [3990.0, 3985.0],
        })
        result = extract_hod_lod_for_persistence(bars, "MES", "2026-05-23")
        assert len(result) == 2
        hod = next(r for r in result if r.level_type == "hod")
        lod = next(r for r in result if r.level_type == "lod")
        assert hod.price == pytest.approx(4030.0, abs=0.26)
        assert lod.price == pytest.approx(3985.0, abs=0.26)

    def test_hodlod_record_is_dataclass(self):
        """HodLodRecord is a dataclass with the required fields."""
        rec = HodLodRecord(
            symbol="MES",
            session_date="2026-05-23",
            level_type="hod",
            price=4025.0,
        )
        assert rec.symbol == "MES"
        assert rec.session_date == "2026-05-23"
        assert rec.level_type == "hod"
        assert rec.price == 4025.0
        assert rec.htf_significance == 1   # default
