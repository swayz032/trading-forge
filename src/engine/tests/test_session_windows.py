"""Tests for session_windows.py — Python mirror of src/server/lib/killzone.ts.

Fixture table below mirrors the boundary-semantics assertions killzone.ts's
own test suite makes (start-inclusive, end-exclusive; DST-correct). This is
the Ledger E parity surface for the WAIT_SESSION primitive: if these fixtures
ever diverge from killzone.ts's behavior, both files must be updated in the
same commit (see session_windows.py module docstring).

Run targeted:
    python -m pytest src/engine/tests/test_session_windows.py -v
"""

from __future__ import annotations

from datetime import UTC, datetime

from src.engine.session_windows import (
    active_killzones,
    is_in_any_killzone,
    is_in_killzone,
    is_in_lunch_blackout,
    resolve_session_keyword,
)


def _et(year, month, day, hour, minute, second=0):
    """Build a UTC datetime that lands at the given ET wall-clock time.
    Uses fixed EST (UTC-5) or EDT (UTC-4) offsets picked per DST test case."""
    from zoneinfo import ZoneInfo

    et = datetime(year, month, day, hour, minute, second, tzinfo=ZoneInfo("America/New_York"))
    return et.astimezone(UTC)


# ─── Boundary semantics: [start, end) ──────────────────────────────────────

def test_ny_am_start_inclusive():
    assert is_in_killzone(_et(2026, 3, 10, 7, 0, 0), "ny_am") is True


def test_ny_am_end_exclusive():
    assert is_in_killzone(_et(2026, 3, 10, 10, 0, 0), "ny_am") is False


def test_ny_am_one_second_before_end_still_active():
    assert is_in_killzone(_et(2026, 3, 10, 9, 59, 59), "ny_am") is True


def test_london_window():
    assert is_in_killzone(_et(2026, 3, 10, 3, 0, 0), "london") is True
    assert is_in_killzone(_et(2026, 3, 10, 5, 0, 0), "london") is False


def test_ny_pm_window():
    assert is_in_killzone(_et(2026, 3, 10, 14, 0, 0), "ny_pm") is True
    assert is_in_killzone(_et(2026, 3, 10, 12, 0, 0), "ny_pm") is False


def test_silver_bullet_three_windows():
    assert is_in_killzone(_et(2026, 3, 10, 3, 30, 0), "silver_bullet") is True
    assert is_in_killzone(_et(2026, 3, 10, 10, 30, 0), "silver_bullet") is True
    assert is_in_killzone(_et(2026, 3, 10, 14, 30, 0), "silver_bullet") is True
    assert is_in_killzone(_et(2026, 3, 10, 12, 0, 0), "silver_bullet") is False


def test_macro_window_three_windows():
    assert is_in_killzone(_et(2026, 3, 10, 9, 55, 0), "macro_window") is True
    assert is_in_killzone(_et(2026, 3, 10, 2, 40, 0), "macro_window") is True
    assert is_in_killzone(_et(2026, 3, 10, 4, 10, 0), "macro_window") is True


def test_unknown_zone_returns_false_never_throws():
    assert is_in_killzone(_et(2026, 3, 10, 8, 0, 0), "not_a_real_zone") is False


def test_invalid_datetime_never_throws():
    assert is_in_killzone(None, "london") is False  # type: ignore[arg-type]


# ─── active_killzones / is_in_any_killzone ─────────────────────────────────

def test_active_killzones_london_and_silver_bullet_overlap():
    # London is 02:00-05:00 ET; silver_bullet window 1 is 03:00-04:00 ET —
    # these two DO overlap (unlike ny_am/silver_bullet window 2, which are
    # adjacent but non-overlapping: 07:00-10:00 vs 10:00-11:00).
    zones = active_killzones(_et(2026, 3, 10, 3, 30, 0))
    assert "london" in zones
    assert "silver_bullet" in zones


def test_is_in_any_killzone_true_and_false():
    assert is_in_any_killzone(_et(2026, 3, 10, 8, 0, 0)) is True
    assert is_in_any_killzone(_et(2026, 3, 10, 22, 0, 0)) is False


# ─── DST correctness (spring-forward + fall-back) ──────────────────────────

def test_dst_spring_forward_still_resolves_correct_et_hour():
    # 2026-03-08 is the US spring-forward date (2 AM -> 3 AM).
    assert is_in_killzone(_et(2026, 3, 9, 7, 0, 0), "ny_am") is True


def test_dst_fall_back_still_resolves_correct_et_hour():
    # 2026-11-01 is the US fall-back date.
    assert is_in_killzone(_et(2026, 11, 2, 7, 0, 0), "ny_am") is True


# ─── Lunch blackout (W23F.N canonical window, CLAUDE.md §13) ───────────────

def test_lunch_blackout_window():
    assert is_in_lunch_blackout(_et(2026, 3, 10, 12, 0, 0)) is True
    assert is_in_lunch_blackout(_et(2026, 3, 10, 11, 0, 0)) is False
    assert is_in_lunch_blackout(_et(2026, 3, 10, 13, 30, 0)) is False


# ─── Keyword resolution (matches spec_family_bindings.py table) ───────────

def test_resolve_session_keyword_silver_bullet():
    assert resolve_session_keyword("silver bullet setup") == "silver_bullet"


def test_resolve_session_keyword_unmatched_returns_none():
    assert resolve_session_keyword("institutional participation") is None
