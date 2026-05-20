"""
entry_windows.py — W23H.3 allowed_entry_windows parser + checker (Python mirror)

Parses window specs of the form "HH:MM-HH:MM TZ" and checks whether a
bar timestamp falls inside any configured window.

Boundary semantics: [start, end) — left-inclusive, right-exclusive.
So "09:45-12:00 ET" includes 09:45:00 but NOT 12:00:00.

Timezone shorthands:
  ET → America/New_York
  PT → America/Los_Angeles
  CT → America/Chicago
  MT → America/Denver
  UTC → UTC
  Any other string is passed through as an IANA name.

TypeScript mirror: src/server/lib/entry-windows.ts
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Optional, Sequence

try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError  # Python 3.9+
except ImportError:  # pragma: no cover
    from backports.zoneinfo import ZoneInfo, ZoneInfoNotFoundError  # type: ignore

# ─── Timezone shorthands ─────────────────────────────────────────────────────

TZ_SHORTHANDS: dict[str, str] = {
    "ET": "America/New_York",
    "EST": "America/New_York",
    "EDT": "America/New_York",
    "PT": "America/Los_Angeles",
    "PST": "America/Los_Angeles",
    "PDT": "America/Los_Angeles",
    "CT": "America/Chicago",
    "CST": "America/Chicago",
    "CDT": "America/Chicago",
    "MT": "America/Denver",
    "MST": "America/Denver",
    "MDT": "America/Denver",
    "UTC": "UTC",
}


def resolve_timezone(tz_raw: str) -> str:
    """Resolve a shorthand or IANA timezone name to a canonical IANA name."""
    return TZ_SHORTHANDS.get(tz_raw.upper(), tz_raw)


# ─── Types ───────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class EntryWindow:
    """A parsed entry window.

    start_minutes_of_day and end_minutes_of_day are minutes-since-midnight in
    the window's timezone. Boundary: [start, end) left-inclusive, right-exclusive.
    """
    start_minutes_of_day: int
    end_minutes_of_day: int
    timezone: str       # IANA name
    spec: str           # original spec string, for diagnostics


# ─── Parser ──────────────────────────────────────────────────────────────────

_TIME_RE = re.compile(r"^(\d{2}):(\d{2})-(\d{2}):(\d{2})$")


def parse_entry_window(spec: str) -> EntryWindow:
    """Parse "HH:MM-HH:MM TZ" → EntryWindow. Raises ValueError on malformed input.

    Examples::

        parse_entry_window("09:45-12:00 ET")
        # EntryWindow(start_minutes_of_day=585, end_minutes_of_day=720,
        #             timezone="America/New_York", spec="09:45-12:00 ET")

        parse_entry_window("13:30-15:30 ET")
        # EntryWindow(start_minutes_of_day=810, end_minutes_of_day=930, ...)
    """
    if not isinstance(spec, str) or not spec.strip():
        raise ValueError(f"parse_entry_window: empty or non-string spec: {spec!r}")

    trimmed = spec.strip()
    # Split at last whitespace — left side is time range, right side is TZ
    parts = trimmed.rsplit(" ", 1)
    if len(parts) != 2:
        raise ValueError(
            f'parse_entry_window: missing timezone in spec "{spec}" '
            f'— expected "HH:MM-HH:MM TZ"'
        )

    time_range, tz_raw = parts[0].strip(), parts[1].strip()
    if not tz_raw:
        raise ValueError(f'parse_entry_window: missing timezone in spec "{spec}"')

    m = _TIME_RE.match(time_range)
    if not m:
        raise ValueError(
            f'parse_entry_window: time range "{time_range}" must be HH:MM-HH:MM '
            f'(spec: "{spec}")'
        )

    sh, sm, eh, em = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))

    if sm > 59:
        raise ValueError(
            f'parse_entry_window: start minute {sm} out of range [0,59] (spec: "{spec}")'
        )
    if em > 59:
        raise ValueError(
            f'parse_entry_window: end minute {em} out of range [0,59] (spec: "{spec}")'
        )
    if sh > 23:
        raise ValueError(
            f'parse_entry_window: start hour {sh} out of range [0,23] (spec: "{spec}")'
        )
    if eh > 23:
        raise ValueError(
            f'parse_entry_window: end hour {eh} out of range [0,23] (spec: "{spec}")'
        )

    start_min = sh * 60 + sm
    end_min = eh * 60 + em

    if end_min <= start_min:
        raise ValueError(
            f'parse_entry_window: end ({m.group(3)}:{m.group(4)}) must be after '
            f'start ({m.group(1)}:{m.group(2)}) — overnight windows not supported '
            f'(spec: "{spec}")'
        )

    iana_tz = resolve_timezone(tz_raw)

    # Validate the IANA timezone name by constructing a ZoneInfo object.
    try:
        ZoneInfo(iana_tz)
    except (ZoneInfoNotFoundError, KeyError) as exc:
        raise ValueError(
            f'parse_entry_window: unrecognized timezone "{tz_raw}" '
            f'(resolved: "{iana_tz}") in spec "{spec}": {exc}'
        ) from exc

    return EntryWindow(
        start_minutes_of_day=start_min,
        end_minutes_of_day=end_min,
        timezone=iana_tz,
        spec=spec,
    )


def parse_entry_windows(specs: Optional[Sequence[str]]) -> list[EntryWindow]:
    """Parse a list of window specs. Raises on first malformed spec. Returns [] for None/empty."""
    if not specs:
        return []
    return [parse_entry_window(s) for s in specs]


# ─── Checker ─────────────────────────────────────────────────────────────────

def to_minutes_of_day_in_tz(ts_utc: datetime, iana_tz: str) -> int:
    """Convert a UTC datetime to minutes-of-day in the given IANA timezone.

    Handles DST correctly because ZoneInfo applies the correct UTC offset for
    the moment represented by ts_utc.
    """
    if ts_utc.tzinfo is None:
        ts_utc = ts_utc.replace(tzinfo=timezone.utc)
    local_dt = ts_utc.astimezone(ZoneInfo(iana_tz))
    return local_dt.hour * 60 + local_dt.minute


def is_bar_in_window(ts_utc: datetime, window: EntryWindow) -> bool:
    """Return True if ts_utc falls in [window.start, window.end) in window.timezone."""
    minutes = to_minutes_of_day_in_tz(ts_utc, window.timezone)
    return window.start_minutes_of_day <= minutes < window.end_minutes_of_day


def is_bar_in_any_window(ts_utc: datetime, windows: list[EntryWindow]) -> bool:
    """Return True if ts_utc falls in ANY of the windows.

    Returns False for empty windows list — callers are responsible for the
    semantics: ``not windows or is_bar_in_any_window(ts, windows)`` for
    "no restriction when list is empty".
    """
    if not windows:
        return False
    return any(is_bar_in_window(ts_utc, w) for w in windows)


# ─── Pine helper ─────────────────────────────────────────────────────────────

def window_to_pine_time_string(window: EntryWindow) -> str:
    """Convert a parsed EntryWindow to a Pine-compatible time() argument string.

    Pine time() format: "HHMM-HHMM" (no colon).
    Example: start=585 (09:45), end=720 (12:00) → "0945-1200"
    """
    sh, sm = divmod(window.start_minutes_of_day, 60)
    eh, em = divmod(window.end_minutes_of_day, 60)
    return f"{sh:02d}{sm:02d}-{eh:02d}{em:02d}"
