"""Fresh-scan LOW#16 (2026-07-12) — calendar_check must catch cross-year OBSERVED holidays.

calendar_check only consulted the current calendar year, so a date like 2027-12-31 (the OBSERVED
New Year's Day 2028 — Jan 1 2028 is a Saturday) was reported is_holiday=False, i.e. the CME
full-closure day read as OPEN. paper-signal-service reads calResult.is_holiday from this authoritative
path. calendar_check now includes the adjacent years' holidays, matching the standalone is_holiday().
"""
from datetime import date

from src.engine.skip_engine.calendar_filter import calendar_check, is_holiday


def test_crossyear_observed_new_year_is_holiday():
    # Jan 1 2028 = Saturday → observed closure is Fri Dec 31 2027.
    assert calendar_check(date(2027, 12, 31))["is_holiday"] is True
    # calendar_check now agrees with the standalone is_holiday() helper.
    assert is_holiday("2027-12-31") is True


def test_calendar_check_agrees_with_is_holiday_across_year_boundaries():
    # Sweep the Dec/Jan boundary for a few years; the two authoritative paths must never disagree.
    for y in (2026, 2027, 2028):
        for d in (date(y, 12, 30), date(y, 12, 31), date(y + 1, 1, 1), date(y + 1, 1, 2)):
            cc = calendar_check(d)["is_holiday"]
            ih = is_holiday(d.isoformat())
            # is_holiday() also treats weekends as closed; calendar_check reports day_of_week separately,
            # so only compare on weekdays where both are holiday-table driven.
            if d.weekday() < 5:
                assert cc == ih, f"{d}: calendar_check={cc} vs is_holiday={ih}"


def test_normal_trading_day_not_flagged():
    # A plain mid-year weekday is not a holiday.
    assert calendar_check(date(2027, 3, 17))["is_holiday"] is False
