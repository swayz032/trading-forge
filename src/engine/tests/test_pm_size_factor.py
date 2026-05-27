"""test_pm_size_factor.py — Wave 26 Pass K Phase 3 (2026-05-26)

Pytest mirror of wave26-pass-k-pm-size-factor.test.ts.

Verifies that the Python implementation produces identical factor + phase
values to the TS implementation for the same UTC bar timestamps.

Same default schedule:
    Before 13:30 ET -> 1.0 (am)
    13:30 ET        -> 0.50 (pm_taper start)
    13:30 -> 15:00  -> linear decay 0.50 -> 0.25
    15:00 -> 15:30  -> 0.25 (pm_floor)
    15:30 ET+       -> 0.00 (pm_closed)
"""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pytest

from src.engine.pm_size_factor import (
    compute_pm_size_factor,
    get_pm_size_factor_env_defaults,
)

ET = ZoneInfo("America/New_York")


def et_bar(yyyy_mm_dd_hh_mm: str) -> datetime:
    """Construct a UTC datetime from an ET wall-clock 'YYYY-MM-DD HH:MM' string."""
    date_part, time_part = yyyy_mm_dd_hh_mm.split(" ")
    y, mo, d = map(int, date_part.split("-"))
    h, mi = map(int, time_part.split(":"))
    et_dt = datetime(y, mo, d, h, mi, tzinfo=ET)
    return et_dt.astimezone(timezone.utc)


# ─── AM phase ────────────────────────────────────────────────────────────


class TestAmPhase:
    def test_0945_et_factor_1_0(self):
        r = compute_pm_size_factor(et_bar("2026-05-26 09:45"))
        assert r.factor == 1.0
        assert r.phase == "am"

    def test_1100_et_factor_1_0(self):
        assert compute_pm_size_factor(et_bar("2026-05-26 11:00")).factor == 1.0

    def test_1329_et_last_am_minute(self):
        assert compute_pm_size_factor(et_bar("2026-05-26 13:29")).factor == 1.0


# ─── PM taper (linear decay 13:30 -> 15:00) ─────────────────────────────


class TestPmTaper:
    def test_1330_et_factor_0_50(self):
        r = compute_pm_size_factor(et_bar("2026-05-26 13:30"))
        assert r.factor == 0.50
        assert r.phase == "pm_taper"

    def test_1415_et_halfway_factor_0_375(self):
        r = compute_pm_size_factor(et_bar("2026-05-26 14:15"))
        assert r.factor == pytest.approx(0.375, abs=1e-5)
        assert r.phase == "pm_taper"

    def test_1430_et_two_thirds_factor_0_333(self):
        r = compute_pm_size_factor(et_bar("2026-05-26 14:30"))
        assert r.factor == pytest.approx(0.333, abs=1e-2)

    def test_1459_et_barely_above_floor(self):
        r = compute_pm_size_factor(et_bar("2026-05-26 14:59"))
        assert r.factor > 0.25
        assert r.factor < 0.30
        assert r.phase == "pm_taper"


# ─── PM floor (15:00 -> 15:30 held at 0.25) ─────────────────────────────


class TestPmFloor:
    def test_1500_et_factor_0_25(self):
        r = compute_pm_size_factor(et_bar("2026-05-26 15:00"))
        assert r.factor == 0.25
        assert r.phase == "pm_floor"

    def test_1515_et_held_at_floor(self):
        r = compute_pm_size_factor(et_bar("2026-05-26 15:15"))
        assert r.factor == 0.25
        assert r.phase == "pm_floor"

    def test_1529_et_last_entry_minute(self):
        r = compute_pm_size_factor(et_bar("2026-05-26 15:29"))
        assert r.factor == 0.25
        assert r.phase == "pm_floor"


# ─── PM closed (15:30+ no new entries) ──────────────────────────────────


class TestPmClosed:
    def test_1530_et_factor_0(self):
        r = compute_pm_size_factor(et_bar("2026-05-26 15:30"))
        assert r.factor == 0.0
        assert r.phase == "pm_closed"
        assert "15:55 flatten" in r.reason

    def test_1545_et_factor_0(self):
        assert compute_pm_size_factor(et_bar("2026-05-26 15:45")).factor == 0.0

    def test_1630_et_factor_0(self):
        assert compute_pm_size_factor(et_bar("2026-05-26 16:30")).factor == 0.0


# ─── Misconfig fallback to floor 0.25 ───────────────────────────────────


class TestMisconfigFallback:
    def test_malformed_pm_start_et(self):
        r = compute_pm_size_factor(et_bar("2026-05-26 14:00"), pm_start_et="not-a-time")
        assert r.factor == 0.25
        assert "config_error" in r.reason

    def test_floor_before_start(self):
        r = compute_pm_size_factor(
            et_bar("2026-05-26 14:00"),
            pm_start_et="15:00",
            pm_floor_at_et="13:30",
        )
        assert r.factor == 0.25

    def test_factor_out_of_range(self):
        r = compute_pm_size_factor(et_bar("2026-05-26 14:00"), factor_at_start=1.5)
        assert r.factor == 0.25

    def test_negative_factor(self):
        r = compute_pm_size_factor(et_bar("2026-05-26 14:00"), factor_at_floor=-0.1)
        assert r.factor == 0.25


# ─── Custom schedule via input args ─────────────────────────────────────


class TestCustomSchedule:
    def test_custom_early_start_12_00_later_floor_15_30(self):
        r = compute_pm_size_factor(
            et_bar("2026-05-26 13:45"),
            pm_start_et="12:00",
            pm_floor_at_et="15:30",
            pm_last_entry_et="15:45",
            factor_at_start=0.80,
            factor_at_floor=0.40,
        )
        # (13:45 - 12:00) / (15:30 - 12:00) = 105 / 210 = 0.5
        # 0.80 + 0.5 * (0.40 - 0.80) = 0.60
        assert r.factor == pytest.approx(0.60, abs=1e-2)
        assert r.phase == "pm_taper"


# ─── Env defaults ────────────────────────────────────────────────────────


class TestEnvDefaults:
    def test_defaults_match_institutional_2026(self, monkeypatch):
        for key in [
            "PM_SESSION_START_ET", "PM_SIZE_FACTOR_FLOOR_AT_ET", "PM_LAST_ENTRY_ET",
            "PM_SIZE_FACTOR_AT_13_30", "PM_SIZE_FACTOR_AT_15_00",
        ]:
            monkeypatch.delenv(key, raising=False)
        d = get_pm_size_factor_env_defaults()
        assert d["pm_start_et"] == "13:30"
        assert d["pm_floor_at_et"] == "15:00"
        assert d["pm_last_entry_et"] == "15:30"
        assert d["factor_at_start"] == 0.50
        assert d["factor_at_floor"] == 0.25

    def test_env_override_honored(self, monkeypatch):
        monkeypatch.setenv("PM_SIZE_FACTOR_AT_13_30", "0.75")
        monkeypatch.setenv("PM_SIZE_FACTOR_AT_15_00", "0.40")
        d = get_pm_size_factor_env_defaults()
        assert d["factor_at_start"] == 0.75
        assert d["factor_at_floor"] == 0.40

    def test_malformed_env_falls_back(self, monkeypatch):
        monkeypatch.setenv("PM_SIZE_FACTOR_AT_13_30", "not-a-number")
        d = get_pm_size_factor_env_defaults()
        assert d["factor_at_start"] == 0.50


# ─── DST handling ────────────────────────────────────────────────────────


class TestDstHandling:
    def test_1330_et_in_march_edt(self):
        r = compute_pm_size_factor(et_bar("2026-03-09 13:30"))
        assert r.factor == 0.50

    def test_1330_et_in_january_est(self):
        r = compute_pm_size_factor(et_bar("2026-01-15 13:30"))
        assert r.factor == 0.50

    def test_1330_et_in_november_post_fall_back_est(self):
        r = compute_pm_size_factor(et_bar("2026-11-05 13:30"))
        assert r.factor == 0.50
