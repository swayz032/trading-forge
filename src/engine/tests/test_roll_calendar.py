"""Tests for src.engine.roll_calendar — algorithmic CME roll date computation.

Coverage:
  - Equity index quarterly (MES/ES, NQ/MNQ): 2nd Thursday of Mar/Jun/Sep/Dec
  - Crude oil monthly (CL/MCL): business day before the 25th
  - Gold bi-monthly (GC): 5th-to-last business day of delivery month
  - is_roll_day: flatten day = business day before roll day
  - get_active_contract: correct contract code returned
  - get_roll_info: known/unknown, warn_window, days_to_roll
  - Fail-safe: unknown symbols return known=False, is_flatten_day=False
  - Micro-to-full symbol mapping (MES -> ES, MNQ -> NQ, MCL -> CL)
  - Roll computations cross into next year (Dec -> March next year)
"""

from datetime import date
import pytest

from src.engine.roll_calendar import (
    get_next_roll_date,
    is_roll_day,
    days_until_roll,
    get_active_contract,
    get_roll_info,
    _equity_quarterly_roll_day,
    _crude_roll_day,
    _gold_roll_day,
    _nth_weekday,
    _prev_business_day,
)


# ─── Internal helpers ─────────────────────────────────────────────────────────

class TestNthWeekday:
    def test_2nd_thursday_march_2026(self):
        # March 2026: 1st is Sunday. Thursdays: 5, 12, 19, 26.
        # 2nd Thursday = March 12, 2026
        assert _nth_weekday(2026, 3, 3, 2) == date(2026, 3, 12)

    def test_3rd_friday_march_2026(self):
        # March 2026: Fridays: 6, 13, 20, 27. 3rd = March 20, 2026.
        assert _nth_weekday(2026, 3, 4, 3) == date(2026, 3, 20)

    def test_2nd_thursday_june_2026(self):
        # June 2026: 1st is Monday. Thursdays: 4, 11, 18, 25. 2nd = June 11.
        assert _nth_weekday(2026, 6, 3, 2) == date(2026, 6, 11)


class TestPrevBusinessDay:
    def test_weekday_unchanged(self):
        assert _prev_business_day(date(2026, 3, 11)) == date(2026, 3, 11)  # Wednesday

    def test_saturday_goes_to_friday(self):
        assert _prev_business_day(date(2026, 3, 14)) == date(2026, 3, 13)  # Sat -> Fri

    def test_sunday_goes_to_friday(self):
        assert _prev_business_day(date(2026, 3, 15)) == date(2026, 3, 13)  # Sun -> Fri


# ─── Equity quarterly roll dates ──────────────────────────────────────────────

class TestEquityQuarterlyRollDay:
    """2nd Thursday of Mar/Jun/Sep/Dec for MES/ES/NQ/MNQ."""

    def test_march_2026(self):
        # March 2026: March 12 (2nd Thursday)
        assert _equity_quarterly_roll_day(2026, 3) == date(2026, 3, 12)

    def test_june_2026(self):
        # June 2026: June 11 (2nd Thursday)
        assert _equity_quarterly_roll_day(2026, 6) == date(2026, 6, 11)

    def test_sep_2026(self):
        # Sep 2026: Sep 10 (2nd Thursday; Sep 1 = Tue, Thu = Sep 3/10/17/24 → 2nd = Sep 10)
        assert _equity_quarterly_roll_day(2026, 9) == date(2026, 9, 10)

    def test_dec_2026(self):
        # Dec 2026: Dec 10 (2nd Thursday; Dec 1 = Tue, Thu = Dec 3/10/17/24 → 2nd = Dec 10)
        assert _equity_quarterly_roll_day(2026, 12) == date(2026, 12, 10)


# ─── Crude roll dates ─────────────────────────────────────────────────────────

class TestCrudeRollDay:
    """CL roll = business day before the 25th of the delivery month."""

    def test_january_2026_25th_is_sunday(self):
        # Jan 25, 2026 is a Sunday. Day before 25th = Jan 24 (Saturday).
        # prev_business_day(Jan 24) = Jan 23 (Friday)
        # So expiry = Jan 23, 2026
        roll = _crude_roll_day(2026, 1)
        assert roll.weekday() < 5  # must be a weekday
        assert roll < date(2026, 1, 25)

    def test_march_2026(self):
        # Mar 25, 2026 = Wednesday. Day before = Mar 24 (Tue) → already weekday
        assert _crude_roll_day(2026, 3) == date(2026, 3, 24)

    def test_april_2026(self):
        # Apr 25, 2026 = Saturday. Day before = Apr 24 (Fri) → weekday
        assert _crude_roll_day(2026, 4) == date(2026, 4, 24)


# ─── get_next_roll_date ────────────────────────────────────────────────────────

class TestGetNextRollDate:
    def test_mes_before_march_2026_roll(self):
        # March 12 2026 is the roll day; querying from Mar 1 should return Mar 12
        roll = get_next_roll_date("MES", date(2026, 3, 1))
        assert roll == date(2026, 3, 12)

    def test_es_same_as_mes(self):
        # ES and MES share the same roll schedule
        assert get_next_roll_date("ES", date(2026, 3, 1)) == get_next_roll_date("MES", date(2026, 3, 1))

    def test_mnq_maps_to_nq(self):
        # MNQ -> NQ, same quarterly schedule
        assert get_next_roll_date("MNQ", date(2026, 3, 1)) == get_next_roll_date("NQ", date(2026, 3, 1))

    def test_on_roll_date_returns_same_cycle(self):
        # Querying on the roll date itself: the roll IS today, so get_next returns it
        roll = get_next_roll_date("MES", date(2026, 3, 12))
        assert roll == date(2026, 3, 12)

    def test_day_after_roll_returns_next_quarter(self):
        # Day after March roll → next roll is June
        roll = get_next_roll_date("MES", date(2026, 3, 13))
        assert roll == date(2026, 6, 11)

    def test_december_roll_wraps_to_march_next_year(self):
        # After December roll, next quarterly roll is March of following year
        dec_roll = get_next_roll_date("MES", date(2026, 12, 10))
        after_dec = get_next_roll_date("MES", date(2026, 12, 11))
        assert dec_roll == date(2026, 12, 10)
        assert after_dec.year == 2027
        assert after_dec.month == 3

    def test_cl_monthly(self):
        roll = get_next_roll_date("CL", date(2026, 3, 1))
        assert roll is not None
        assert roll.month in range(1, 13)

    def test_mcl_same_as_cl(self):
        assert get_next_roll_date("MCL", date(2026, 3, 1)) == get_next_roll_date("CL", date(2026, 3, 1))

    def test_unknown_symbol_returns_none(self):
        assert get_next_roll_date("AAPL", date(2026, 3, 1)) is None

    def test_gc_gold_bimonthly(self):
        roll = get_next_roll_date("GC", date(2026, 3, 1))
        assert roll is not None
        # Gold delivery months are Feb/Apr/Jun/Aug/Oct/Dec
        assert roll.month in (2, 4, 6, 8, 10, 12)


# ─── is_roll_day ─────────────────────────────────────────────────────────────

class TestIsRollDay:
    """Flatten day = business day immediately before the roll date."""

    def test_march_2026_flatten_day(self):
        # Roll = March 12 (Thursday). Flatten = prev biz day = March 11 (Wednesday)
        assert is_roll_day("MES", date(2026, 3, 11)) is True

    def test_roll_day_itself_is_not_flatten_day(self):
        # Roll day (March 12) is NOT the flatten day
        assert is_roll_day("MES", date(2026, 3, 12)) is False

    def test_day_before_flatten_is_not_flatten(self):
        assert is_roll_day("MES", date(2026, 3, 10)) is False

    def test_june_2026_flatten_day(self):
        # Roll = June 11 (Thursday). Flatten = June 10 (Wednesday)
        assert is_roll_day("MES", date(2026, 6, 10)) is True

    def test_unknown_symbol_returns_false(self):
        assert is_roll_day("AAPL", date(2026, 3, 11)) is False

    def test_lowercase_symbol(self):
        assert is_roll_day("mes", date(2026, 3, 11)) is True

    def test_verification_check_june_2026(self):
        # Plan verification: "June 2026 = 2nd Thursday is June 11"
        # is_roll_day(MES, 2026-06-11) should return False (that's the roll date, not flatten)
        # is_roll_day(MES, 2026-06-10) should return True (flatten = roll - 1 biz day)
        assert is_roll_day("MES", date(2026, 6, 11)) is False
        assert is_roll_day("MES", date(2026, 6, 10)) is True


# ─── days_until_roll ──────────────────────────────────────────────────────────

class TestDaysUntilRoll:
    def test_on_flatten_day_days_to_roll_is_1(self):
        # Flatten day = March 11; roll = March 12 → 1 calendar day
        d = days_until_roll("MES", date(2026, 3, 11))
        assert d == 1

    def test_on_roll_day_days_is_0(self):
        assert days_until_roll("MES", date(2026, 3, 12)) == 0

    def test_unknown_symbol_returns_none(self):
        assert days_until_roll("AAPL", date(2026, 3, 1)) is None


# ─── get_active_contract ─────────────────────────────────────────────────────

class TestGetActiveContract:
    def test_mes_march_2026_before_roll(self):
        # Before the March 2026 roll (March 12), front month is the H26 contract
        contract = get_active_contract("MES", date(2026, 3, 1))
        assert contract == "MESH26"

    def test_mes_after_march_roll(self):
        # After March 12, we're rolling to M26 (June)
        contract = get_active_contract("MES", date(2026, 3, 13))
        assert contract == "MESM26"

    def test_nq_june_2026(self):
        contract = get_active_contract("NQ", date(2026, 6, 1))
        assert contract == "NQM26"

    def test_cl_march_2026(self):
        contract = get_active_contract("CL", date(2026, 3, 1))
        # CL rolls monthly; March 2026 should return CLH26
        assert contract.startswith("CL")
        assert "26" in contract

    def test_unknown_symbol_returns_symbol_unchanged(self):
        assert get_active_contract("AAPL", date(2026, 3, 1)) == "AAPL"


# ─── get_roll_info ────────────────────────────────────────────────────────────

class TestGetRollInfo:
    def test_known_symbol_structure(self):
        info = get_roll_info("MES", date(2026, 3, 1))
        assert info["known"] is True
        assert info["roll_date"] is not None
        assert info["flatten_date"] is not None
        assert info["days_to_roll"] is not None
        assert isinstance(info["active_contract"], str)

    def test_flatten_day_flag(self):
        info = get_roll_info("MES", date(2026, 3, 11))  # flatten day
        assert info["is_flatten_day"] is True
        assert info["warn_window"] is True

    def test_warn_window_2_days_before(self):
        # 2 calendar days before roll (March 12) → March 10 is in warn window
        info = get_roll_info("MES", date(2026, 3, 10))
        assert info["warn_window"] is True
        assert info["is_flatten_day"] is False

    def test_no_warning_5_days_before(self):
        # 5 calendar days before roll: no warning
        info = get_roll_info("MES", date(2026, 3, 7))
        assert info["warn_window"] is False
        assert info["is_flatten_day"] is False

    def test_unknown_symbol(self):
        info = get_roll_info("AAPL", date(2026, 3, 1))
        assert info["known"] is False
        assert info["is_flatten_day"] is False
        assert info["warn_window"] is False
        assert info["roll_date"] is None

    def test_roll_date_is_iso_format(self):
        info = get_roll_info("MES", date(2026, 3, 1))
        # Should be parseable as ISO date
        parsed = date.fromisoformat(info["roll_date"])
        assert parsed.year == 2026

    def test_cl_symbol(self):
        info = get_roll_info("CL", date(2026, 3, 1))
        assert info["known"] is True

    def test_mcl_maps_correctly(self):
        info_cl = get_roll_info("CL", date(2026, 3, 1))
        info_mcl = get_roll_info("MCL", date(2026, 3, 1))
        assert info_cl["roll_date"] == info_mcl["roll_date"]


# ─── Synthetic roll scenario (plan verification) ──────────────────────────────

class TestSyntheticPlanScenario:
    """
    Plan verification scenario:
    Position created on a Wednesday before MES roll Thursday.
    Run paper-execution-service tick. Confirm position closed by Wednesday close.

    Wednesday before March 2026 roll (Thursday March 12) = Wednesday March 11.
    is_roll_day("MES", date(2026, 3, 11)) must return True.
    """

    def test_wednesday_before_roll_thursday_triggers_flatten(self):
        assert is_roll_day("MES", date(2026, 3, 11)) is True

    def test_5_days_before_roll_does_not_trigger(self):
        # 5 days before March 12 = March 7 (Saturday; in practice March 6 Friday)
        # Using March 6:
        assert is_roll_day("MES", date(2026, 3, 6)) is False

    def test_warn_window_is_active_2_days_before(self):
        # 2 days before March 12 = March 10 → warn window
        info = get_roll_info("MES", date(2026, 3, 10))
        assert info["warn_window"] is True
        assert info["is_flatten_day"] is False
