"""ICT Session and Time indicators — killzones, macros, quarterly theory.

All times are in US Eastern (New York) timezone.
ICT trading centers around specific time windows where institutional
activity creates predictable price behavior.
"""

from __future__ import annotations

import polars as pl


# ─── Session time constants (ET) ────────────────────────────────

ASIA_START, ASIA_END = 20, 0  # 8:00 PM - 12:00 AM ET
LONDON_START, LONDON_END = 2, 5  # 2:00 AM - 5:00 AM ET
NYAM_START, NYAM_END = 8, 11  # 8:00 AM - 11:00 AM ET (was 9:30-11:00, using wider for ICT)
NY_LUNCH_START, NY_LUNCH_END = 12, 13  # 12:00 PM - 1:30 PM ET
NYPM_START, NYPM_END = 13, 16  # 1:30 PM - 4:00 PM ET

# ICT Macro times (specific 15-30 min windows)
MACRO_WINDOWS = [
    (2, 33, 3, 0),    # London 2:33 - 3:00 AM
    (4, 3, 4, 30),     # London close 4:03 - 4:30 AM
    (8, 50, 9, 10),    # NY open 8:50 - 9:10 AM
    (9, 50, 10, 10),   # NY AM 9:50 - 10:10 AM
    (10, 50, 11, 10),  # NY mid-morning 10:50 - 11:10 AM
    (11, 50, 12, 10),  # NY lunch 11:50 AM - 12:10 PM
    (13, 10, 13, 40),  # NY PM 1:10 - 1:40 PM
    (15, 15, 15, 45),  # NY close 3:15 - 3:45 PM
]


def _to_et_components(ts: pl.Series) -> tuple[pl.Series, pl.Series]:
    """Extract hour and minute from timestamps in Eastern Time.

    If the series is timezone-aware (e.g. America/New_York), extract
    components directly — Polars respects the timezone. If naive,
    assume timestamps are already in ET.
    """
    if ts.dtype == pl.Datetime("us") or getattr(ts.dtype, 'time_zone', None) is None:
        # Naive datetime — assume ET
        hour = ts.dt.hour()
        minute = ts.dt.minute()
    else:
        # Timezone-aware — extract directly (Polars uses the tz)
        hour = ts.dt.hour()
        minute = ts.dt.minute()
    return hour, minute


def is_asia_killzone(ts: pl.Series) -> pl.Series:
    """Asia session: 8:00 PM - 12:00 AM ET.

    Returns:
        Boolean Series: True during Asia killzone.
    """
    hour, _ = _to_et_components(ts)
    return (hour >= 20).alias("asia_killzone")


def is_london_killzone(ts: pl.Series) -> pl.Series:
    """London killzone: 2:00 AM - 5:00 AM ET.

    Returns:
        Boolean Series: True during London killzone.
    """
    hour, _ = _to_et_components(ts)
    return ((hour >= 2) & (hour < 5)).alias("london_killzone")


def is_nyam_killzone(ts: pl.Series) -> pl.Series:
    """New York AM killzone: 8:00 AM - 11:00 AM ET.

    Returns:
        Boolean Series: True during NY AM killzone.
    """
    hour, _ = _to_et_components(ts)
    return ((hour >= 8) & (hour < 11)).alias("nyam_killzone")


def is_ny_lunch(ts: pl.Series) -> pl.Series:
    """NY Lunch (dead zone): 12:00 PM - 1:30 PM ET.

    Returns:
        Boolean Series: True during NY lunch.
    """
    hour, minute = _to_et_components(ts)
    in_lunch = (
        (hour == 12) |
        ((hour == 13) & (minute < 30))
    )
    return in_lunch.alias("ny_lunch")


def is_nypm_killzone(ts: pl.Series) -> pl.Series:
    """New York PM killzone: 1:30 PM - 4:00 PM ET.

    Returns:
        Boolean Series: True during NY PM killzone.
    """
    hour, minute = _to_et_components(ts)
    in_pm = (
        ((hour == 13) & (minute >= 30)) |
        ((hour >= 14) & (hour < 16))
    )
    return in_pm.alias("nypm_killzone")


def is_silver_bullet_nyam(ts: pl.Series) -> pl.Series:
    """Silver Bullet NY AM window: 10:00 AM - 11:00 AM ET."""
    hour, minute = _to_et_components(ts)
    return ((hour == 10)).alias("sb_nyam")


def is_silver_bullet_nypm(ts: pl.Series) -> pl.Series:
    """Silver Bullet NY PM window: 14:00 - 15:00 (2-3 PM) ET."""
    hour, minute = _to_et_components(ts)
    return ((hour == 14)).alias("sb_nypm")


def is_silver_bullet_london(ts: pl.Series) -> pl.Series:
    """Silver Bullet London window: 03:00 - 04:00 AM ET."""
    hour, minute = _to_et_components(ts)
    return ((hour == 3)).alias("sb_london")


def is_macro_time(ts: pl.Series) -> pl.Series:
    """ICT Macro times — specific high-probability windows.

    Returns:
        Boolean Series: True during any macro window.
    """
    hour, minute = _to_et_components(ts)
    total_minutes = hour.cast(pl.Int32) * 60 + minute.cast(pl.Int32)

    result = pl.Series("macro", [False] * len(ts))
    for start_h, start_m, end_h, end_m in MACRO_WINDOWS:
        start_total = start_h * 60 + start_m
        end_total = end_h * 60 + end_m
        window = (total_minutes >= start_total) & (total_minutes < end_total)
        result = result | window

    return result.alias("macro_time")


def day_of_week_profile(ts: pl.Series) -> pl.Series:
    """Day of week as string for session profiling.

    ICT teaches different behavior by day:
    - Monday: manipulation/accumulation
    - Tuesday: often expansion day
    - Wednesday: midweek reversal
    - Thursday: continuation or reversal
    - Friday: profit-taking, reduced activity after 11 AM

    Returns:
        Series of str: day name (Monday-Sunday).
    """
    # Polars weekday: Monday=1 ... Sunday=7
    weekday = ts.dt.weekday()
    day_names = {1: "Monday", 2: "Tuesday", 3: "Wednesday",
                 4: "Thursday", 5: "Friday", 6: "Saturday", 7: "Sunday"}

    return weekday.map_elements(lambda w: day_names.get(w, "Unknown"), return_dtype=pl.Utf8).alias("day_of_week")


def quarterly_theory(ts: pl.Series, timeframe: str = "1h") -> pl.Series:
    """ICT Quarterly Theory — divide each period into 4 phases.

    Each hour/day/week/month divides into:
    Q1: Accumulation (first 25%)
    Q2: Manipulation (25-50%)
    Q3: Distribution (50-75%)
    Q4: Continuation/Reversal (75-100%)

    Returns:
        Series of str: "Q1", "Q2", "Q3", or "Q4".
    """
    minute = ts.dt.minute()

    if timeframe in ("1h", "60min"):
        # Quarter of the hour
        quarter = (minute // 15) + 1
    elif timeframe in ("4h", "240min"):
        hour_in_session = ts.dt.hour() % 4
        quarter = (hour_in_session) + 1
        quarter = quarter.clip(1, 4)
    else:
        # Default: quarter of the hour
        quarter = (minute // 15) + 1

    return quarter.map_elements(lambda q: f"Q{min(q, 4)}", return_dtype=pl.Utf8).alias("quarterly_phase")


def true_day_open(df: pl.DataFrame) -> pl.Series:
    """True Day Open — the opening price at midnight ET (or first bar of the day).

    Returns:
        Series of float: the true day open price for each bar.
    """
    ts_col = "ts_et" if "ts_et" in df.columns else "ts_event"
    ts = df[ts_col]
    dates = ts.dt.date()

    # Get first open price per date
    temp = pl.DataFrame({"date": dates, "open": df["open"]})
    first_opens = temp.group_by("date").first().sort("date")

    # Map back to each bar
    result = temp.join(
        first_opens.rename({"open": "tdo"}),
        on="date",
        how="left",
    )

    return result["tdo"].alias("true_day_open")


def midnight_open(df: pl.DataFrame) -> pl.Series:
    """Midnight Open — the price at midnight ET.

    For intraday data, this is the opening price of the first bar
    at or after midnight. A key reference level in ICT methodology.

    Returns:
        Series of float: midnight open price for each bar.
    """
    # Same as true_day_open for most purposes
    # In practice, midnight open is specifically 00:00 ET
    return true_day_open(df).alias("midnight_open")
