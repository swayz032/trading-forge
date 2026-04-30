"""Roll calendar for CME futures contracts.

Provides algorithmic (date-formula) roll date computation for:
  - MES / ES  (E-mini / Micro E-mini S&P 500, quarterly, equity index)
  - NQ  / MNQ (E-mini / Micro Nasdaq-100, quarterly, equity index)
  - CL  / MCL (Crude Oil, monthly)
  - GC        (Gold, bi-monthly)

Roll conventions used by CME (as of 2026):
  Equity index quarterly (ES/MES/NQ/MNQ):
    Expiration:  3rd Friday of Mar / Jun / Sep / Dec
    Roll day:    2nd Thursday of Mar / Jun / Sep / Dec  (1 week before expiration)
    Flatten day: 2nd Wednesday (roll_day - 1) — positions closed before RTH close

  Crude oil monthly (CL/MCL):
    Expiration:  business-day BEFORE the 25th of the delivery month
    Roll day:    same as expiration (last trading day)
    Flatten day: roll_day - 1

  Gold bi-monthly (GC):
    Delivery months: Feb/Apr/Jun/Aug/Oct/Dec
    Expiration:  3rd-to-last business day of delivery month
    Roll day:    5th-to-last business day of delivery month
    Flatten day: roll_day - 1

Design rules:
  - No hard-coded dates — all dates are computed from year/month arithmetic.
  - get_next_roll_date / is_roll_day / get_active_contract are the public API.
  - Weekend skip uses a minimal local is_weekday() — no external calendar dependency
    (CME-specific holidays are conservatively skipped by the caller).
  - __main__ entry point: reads JSON config from stdin (injected by python-runner.ts),
    dispatches on config["action"], prints single JSON line to stdout.
    Actions: "is_roll_day", "get_next_roll_date", "get_active_contract", "get_roll_info"
"""

from __future__ import annotations

import json
import sys
from datetime import date, timedelta
from typing import Optional


# ─── Symbol routing ───────────────────────────────────────────────────────────

# Micro symbols share roll schedule with their full-size equivalents.
_MICRO_TO_FULL: dict[str, str] = {
    "MES": "ES",
    "MNQ": "NQ",
    "MCL": "CL",
}

# Which "family" does each root symbol belong to?
_SYMBOL_FAMILY: dict[str, str] = {
    "ES":  "equity_quarterly",
    "MES": "equity_quarterly",
    "NQ":  "equity_quarterly",
    "MNQ": "equity_quarterly",
    "CL":  "crude_monthly",
    "MCL": "crude_monthly",
    "GC":  "gold_bimonthly",
}

# Equity index quarterly month codes (CME standard)
_QUARTERLY_MONTHS = (3, 6, 9, 12)  # Mar, Jun, Sep, Dec

# Gold delivery months
_GOLD_MONTHS = (2, 4, 6, 8, 10, 12)  # Feb, Apr, Jun, Aug, Oct, Dec

# CME month codes
_MONTH_CODES = {
    1: "F", 2: "G", 3: "H", 4: "J", 5: "K", 6: "M",
    7: "N", 8: "Q", 9: "U", 10: "V", 11: "X", 12: "Z",
}


# ─── Date helpers ─────────────────────────────────────────────────────────────

def _is_weekday(d: date) -> bool:
    """Return True if d is Monday–Friday (CME minimum — not holiday-aware)."""
    return d.weekday() < 5  # 0=Mon, 4=Fri


def _prev_business_day(d: date) -> date:
    """Return the most recent business day on or before d (weekend-only skip)."""
    while not _is_weekday(d):
        d -= timedelta(days=1)
    return d


def _next_business_day(d: date) -> date:
    """Return the next business day strictly after d."""
    d += timedelta(days=1)
    while not _is_weekday(d):
        d += timedelta(days=1)
    return d


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    """Return the n-th occurrence (1-based) of weekday (0=Mon, 3=Thu, 4=Fri) in month."""
    first = date(year, month, 1)
    # Days until the target weekday from the 1st
    delta = (weekday - first.weekday()) % 7
    first_occurrence = first + timedelta(days=delta)
    return first_occurrence + timedelta(weeks=n - 1)


def _last_business_day_of_month(year: int, month: int) -> date:
    """Return the last business day (Mon–Fri) of the given month."""
    # Last day of month
    if month == 12:
        last = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        last = date(year, month + 1, 1) - timedelta(days=1)
    return _prev_business_day(last)


def _nth_to_last_business_day(year: int, month: int, n: int) -> date:
    """Return the n-th-to-last business day (n=1 = last) of the given month."""
    # Collect all business days in the month
    if month == 12:
        end = date(year + 1, 1, 1)
    else:
        end = date(year, month + 1, 1)
    bdays: list[date] = []
    d = date(year, month, 1)
    while d < end:
        if _is_weekday(d):
            bdays.append(d)
        d += timedelta(days=1)
    if n > len(bdays):
        raise ValueError(f"Month {year}-{month:02d} has fewer than {n} business days")
    return bdays[-n]


# ─── Roll date computation by family ─────────────────────────────────────────

def _equity_quarterly_roll_day(year: int, month: int) -> date:
    """2nd Thursday of the given expiration month."""
    return _nth_weekday(year, month, 3, 2)  # weekday 3 = Thursday


def _equity_quarterly_expiry(year: int, month: int) -> date:
    """3rd Friday of the given expiration month."""
    return _nth_weekday(year, month, 4, 3)  # weekday 4 = Friday


def _crude_roll_day(year: int, month: int) -> date:
    """Last business day of the PRECEDING month, adjusted for CL settlement.

    CL contract for delivery month M trades its last day on:
      the business day before the 25th of M-1.
    Roll day = that expiration date.
    """
    # The 25th of the delivery month
    day_25 = date(year, month, 25)
    # Business day immediately before the 25th
    expiry = _prev_business_day(day_25 - timedelta(days=1))
    return expiry


def _gold_roll_day(year: int, month: int) -> date:
    """5th-to-last business day of the delivery month (GC convention)."""
    return _nth_to_last_business_day(year, month, 5)


# ─── Next upcoming roll dates ─────────────────────────────────────────────────

def _next_equity_quarterly_roll(today: date) -> date:
    """Return the next 2nd-Thursday (roll day) for equity-index quarterly contracts."""
    for y in [today.year, today.year + 1]:
        for m in _QUARTERLY_MONTHS:
            roll = _equity_quarterly_roll_day(y, m)
            if roll >= today:
                return roll
    raise RuntimeError("Could not compute next equity quarterly roll date")


def _next_crude_roll(today: date) -> date:
    """Return the next CL roll day (last biz day before 25th of delivery month)."""
    # CL rolls monthly; check this month and the next few.
    for offset in range(12):
        month = (today.month - 1 + offset) % 12 + 1
        year = today.year + (today.month - 1 + offset) // 12
        roll = _crude_roll_day(year, month)
        if roll >= today:
            return roll
    raise RuntimeError("Could not compute next CL roll date")


def _next_gold_roll(today: date) -> date:
    """Return the next GC roll day (5th-to-last biz day of delivery month)."""
    for offset in range(24):
        month = (today.month - 1 + offset) % 12 + 1
        year = today.year + (today.month - 1 + offset) // 12
        if month not in _GOLD_MONTHS:
            continue
        try:
            roll = _gold_roll_day(year, month)
        except ValueError:
            continue
        if roll >= today:
            return roll
    raise RuntimeError("Could not compute next GC roll date")


# ─── Public API ──────────────────────────────────────────────────────────────

def get_next_roll_date(symbol: str, today: date) -> Optional[date]:
    """Return the next contract roll date for the symbol on or after today.

    Returns None for unknown symbols (fail-safe: caller should not flatten
    on unknown symbol).
    """
    root = _MICRO_TO_FULL.get(symbol.upper(), symbol.upper())
    family = _SYMBOL_FAMILY.get(root)
    if family is None:
        return None
    if family == "equity_quarterly":
        return _next_equity_quarterly_roll(today)
    if family == "crude_monthly":
        return _next_crude_roll(today)
    if family == "gold_bimonthly":
        return _next_gold_roll(today)
    return None


def is_roll_day(symbol: str, day: date) -> bool:
    """Return True if day is the flatten day for the symbol (roll_date - 1).

    Flatten day = one business day BEFORE the roll date.  This gives a full
    trading day buffer so positions are closed before the contract becomes stale.

    Returns False for unknown symbols (fail-safe).
    """
    root = _MICRO_TO_FULL.get(symbol.upper(), symbol.upper())
    family = _SYMBOL_FAMILY.get(root)
    if family is None:
        return False

    roll = get_next_roll_date(symbol, day)
    if roll is None:
        return False

    # Flatten day = business day immediately before the roll date
    flatten_day = _prev_business_day(roll - timedelta(days=1))
    return day == flatten_day


def days_until_roll(symbol: str, today: date) -> Optional[int]:
    """Return calendar days until next roll, or None for unknown symbols."""
    roll = get_next_roll_date(symbol, today)
    if roll is None:
        return None
    return (roll - today).days


def get_active_contract(symbol: str, today: date) -> str:
    """Return active contract code string, e.g. 'MESH26' for MES March 2026.

    Uses the front month: if today is BEFORE the roll date, the front month
    is the upcoming expiry month.  If today IS the roll date or after, the
    front month has advanced.

    Format: {symbol}{month_code}{2-digit year}
    """
    root = _MICRO_TO_FULL.get(symbol.upper(), symbol.upper())
    family = _SYMBOL_FAMILY.get(root)

    if family == "equity_quarterly":
        # Find next expiry that is strictly AFTER today (on roll day we're
        # already switching to the deferred contract)
        roll = _next_equity_quarterly_roll(today)
        expiry = _equity_quarterly_expiry(roll.year, roll.month)
        # If today >= roll day, the front month is the expiry of this cycle
        # (last day to trade); after expiry we move to next cycle.
        if today < roll:
            # Still on front month of this cycle — find what the front month is
            # (it's the same cycle as the upcoming roll)
            m, y = roll.month, roll.year
        else:
            # On or past roll — we're already rolling to deferred
            # Advance one quarter
            idx = _QUARTERLY_MONTHS.index(roll.month)
            if idx + 1 < len(_QUARTERLY_MONTHS):
                m = _QUARTERLY_MONTHS[idx + 1]
                y = roll.year
            else:
                m = _QUARTERLY_MONTHS[0]
                y = roll.year + 1
        code = _MONTH_CODES[m]
        return f"{symbol.upper()}{code}{y % 100:02d}"

    if family == "crude_monthly":
        roll = _next_crude_roll(today)
        m, y = roll.month, roll.year
        code = _MONTH_CODES[m]
        return f"{root}{code}{y % 100:02d}"

    if family == "gold_bimonthly":
        roll = _next_gold_roll(today)
        m, y = roll.month, roll.year
        code = _MONTH_CODES[m]
        return f"{root}{code}{y % 100:02d}"

    # Unknown symbol — return symbol as-is (no contract code appended)
    return symbol.upper()


def get_roll_info(symbol: str, today: date) -> dict:
    """Return a full roll-status dict for the given symbol and date.

    Keys:
      known          bool   — False if symbol not in calendar
      is_flatten_day bool   — True if today is the flatten day
      roll_date      str    — ISO date of the next roll (or None)
      flatten_date   str    — ISO date of the flatten day (or None)
      days_to_roll   int    — Calendar days until roll (or None)
      active_contract str   — e.g. 'MESH26'
      warn_window    bool   — True if within 2-day warning window
    """
    root = _MICRO_TO_FULL.get(symbol.upper(), symbol.upper())
    known = root in _SYMBOL_FAMILY

    if not known:
        return {
            "known": False,
            "is_flatten_day": False,
            "roll_date": None,
            "flatten_date": None,
            "days_to_roll": None,
            "active_contract": symbol.upper(),
            "warn_window": False,
        }

    roll = get_next_roll_date(symbol, today)
    flatten: Optional[date] = None
    if roll is not None:
        flatten = _prev_business_day(roll - timedelta(days=1))

    d_to_roll = (roll - today).days if roll is not None else None
    is_flat = (today == flatten) if flatten is not None else False
    warn = (d_to_roll is not None and 0 < d_to_roll <= 2) or is_flat

    return {
        "known": True,
        "is_flatten_day": is_flat,
        "roll_date": roll.isoformat() if roll else None,
        "flatten_date": flatten.isoformat() if flatten else None,
        "days_to_roll": d_to_roll,
        "active_contract": get_active_contract(symbol, today),
        "warn_window": warn,
    }


# ─── CLI entry point (python-runner.ts bridge) ────────────────────────────────

def _main() -> None:
    """Read JSON config from stdin, dispatch action, print result to stdout."""
    import os

    # python-runner.ts injects config via --config-file or stdin
    config_file = None
    args = sys.argv[1:]
    if "--config-file" in args:
        idx = args.index("--config-file")
        config_file = args[idx + 1]

    if config_file and os.path.exists(config_file):
        with open(config_file) as fh:
            config = json.load(fh)
    else:
        raw = sys.stdin.read().strip()
        config = json.loads(raw) if raw else {}

    action = config.get("action", "get_roll_info")
    symbol: str = config.get("symbol", "")
    day_str: str = config.get("date", date.today().isoformat())

    try:
        today = date.fromisoformat(day_str)
    except ValueError:
        print(json.dumps({"error": f"Invalid date: {day_str!r}"}))
        sys.exit(1)

    if not symbol:
        print(json.dumps({"error": "symbol is required"}))
        sys.exit(1)

    if action == "is_roll_day":
        result = {"result": is_roll_day(symbol, today)}
    elif action == "get_next_roll_date":
        roll = get_next_roll_date(symbol, today)
        result = {"result": roll.isoformat() if roll else None}
    elif action == "get_active_contract":
        result = {"result": get_active_contract(symbol, today)}
    elif action == "get_roll_info":
        result = get_roll_info(symbol, today)
    elif action == "days_until_roll":
        result = {"result": days_until_roll(symbol, today)}
    else:
        result = {"error": f"Unknown action: {action!r}"}

    print(json.dumps(result))


if __name__ == "__main__":
    _main()
