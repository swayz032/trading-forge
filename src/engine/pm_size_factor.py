"""pm_size_factor.py — Wave 26 Pass K Phase 3 (2026-05-26)

Python mirror of src/server/lib/pm-size-factor.ts for backtester parity.

EOD-DD-aware PM session size taper. Returns a multiplier in [0, 1] that
scales base_contracts BEFORE the firm cap / liquidity cap minimum.

Default schedule (institutional 2026 per TTT Markets + SurgeFunded + Tradecovex):
    Before 13:30 ET -> factor 1.0 (AM session, full base size)
    13:30 ET        -> factor 0.50 (PM start)
    13:30 -> 15:00 ET   -> linear decay 0.50 -> 0.25
    15:00 -> 15:30 ET   -> factor 0.25 (floor held)
    15:30 ET and after  -> factor 0.0 (no new entries; 15:55 flatten still active for opens)

PARITY CONTRACT with TypeScript implementation:
    - Same boundaries, same env var names, same fallback behavior
    - Returns the same factor (within 1e-6 tolerance) for any UTC timestamp
    - Phase enum matches: "am" | "pm_taper" | "pm_floor" | "pm_closed"
    - Misconfig fallback to 0.25 (floor) matches TS

Pure-function design: no I/O, no datetime.now(), no side effects.
Replay-deterministic for backtester use.

Verified by scripts/check-ts-python-pm-factor-parity.ts.
"""

import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")


@dataclass(frozen=True)
class PmSizeFactorResult:
    """Result of computePmSizeFactor — mirrors TS interface."""
    factor: float
    phase: str  # "am" | "pm_taper" | "pm_floor" | "pm_closed"
    et_minute_of_day: int
    reason: str


def _parse_hh_mm(s: Optional[str]) -> Optional[int]:
    """Parse 'HH:MM' to minute-of-day. Returns None on malformed input."""
    if not s or not isinstance(s, str):
        return None
    parts = s.strip().split(":")
    if len(parts) != 2:
        return None
    try:
        h = int(parts[0])
        m = int(parts[1])
    except ValueError:
        return None
    if h < 0 or h > 23 or m < 0 or m > 59:
        return None
    return h * 60 + m


def _to_et_minute_of_day(ts_utc: datetime) -> int:
    """Convert a UTC datetime to ET minute-of-day. DST-correct via zoneinfo."""
    if ts_utc.tzinfo is None:
        ts_utc = ts_utc.replace(tzinfo=timezone.utc)
    et_dt = ts_utc.astimezone(ET)
    return et_dt.hour * 60 + et_dt.minute


def get_pm_size_factor_env_defaults() -> dict:
    """Read env defaults. Centralized for testability + parity with TS."""
    pm_start_et = (os.environ.get("PM_SESSION_START_ET") or "13:30").strip()
    pm_floor_at_et = (os.environ.get("PM_SIZE_FACTOR_FLOOR_AT_ET") or "15:00").strip()
    pm_last_entry_et = (os.environ.get("PM_LAST_ENTRY_ET") or "15:30").strip()

    factor_at_start_raw = os.environ.get("PM_SIZE_FACTOR_AT_13_30")
    factor_at_floor_raw = os.environ.get("PM_SIZE_FACTOR_AT_15_00")

    try:
        factor_at_start = float(factor_at_start_raw) if factor_at_start_raw else 0.50
    except (ValueError, TypeError):
        factor_at_start = 0.50
    try:
        factor_at_floor = float(factor_at_floor_raw) if factor_at_floor_raw else 0.25
    except (ValueError, TypeError):
        factor_at_floor = 0.25

    return {
        "pm_start_et": pm_start_et,
        "pm_floor_at_et": pm_floor_at_et,
        "pm_last_entry_et": pm_last_entry_et,
        "factor_at_start": factor_at_start,
        "factor_at_floor": factor_at_floor,
    }


def compute_pm_size_factor(
    bar_ts_utc: datetime,
    pm_start_et: Optional[str] = None,
    pm_floor_at_et: Optional[str] = None,
    pm_last_entry_et: Optional[str] = None,
    factor_at_start: Optional[float] = None,
    factor_at_floor: Optional[float] = None,
) -> PmSizeFactorResult:
    """Compute the PM size factor for a given UTC bar timestamp.

    Pure-function. Returns a structured result for audit + caller-side
    downstream sizing logic. The factor is in [0, 1] and is multiplied by
    base_contracts BEFORE the firm cap / liquidity cap minimum.

    Parity contract with TS implementation:
        - Same defaults (13:30 / 15:00 / 15:30 / 0.50 / 0.25)
        - Same boundary semantics (PM taper at 13:30 EXACTLY; floor reached at 15:00 EXACTLY;
          PM closed at 15:30 EXACTLY)
        - Same misconfig fallback to 0.25 with phase=pm_floor and reason mentioning "config_error"
    """
    env = get_pm_size_factor_env_defaults()
    pm_start_et = pm_start_et if pm_start_et is not None else env["pm_start_et"]
    pm_floor_at_et = pm_floor_at_et if pm_floor_at_et is not None else env["pm_floor_at_et"]
    pm_last_entry_et = pm_last_entry_et if pm_last_entry_et is not None else env["pm_last_entry_et"]
    factor_at_start = factor_at_start if factor_at_start is not None else env["factor_at_start"]
    factor_at_floor = factor_at_floor if factor_at_floor is not None else env["factor_at_floor"]

    start_min = _parse_hh_mm(pm_start_et)
    floor_min = _parse_hh_mm(pm_floor_at_et)
    last_entry_min = _parse_hh_mm(pm_last_entry_et)

    # Misconfig -> conservative fallback to floor factor 0.25
    if (
        start_min is None or floor_min is None or last_entry_min is None
        or not isinstance(factor_at_start, (int, float))
        or not isinstance(factor_at_floor, (int, float))
        or factor_at_start < 0 or factor_at_start > 1
        or factor_at_floor < 0 or factor_at_floor > 1
        or floor_min <= start_min or last_entry_min < floor_min
    ):
        return PmSizeFactorResult(
            factor=0.25,
            phase="pm_floor",
            et_minute_of_day=-1,
            reason="pm_size_factor_config_error:fallback_to_floor=0.25",
        )

    et_min = _to_et_minute_of_day(bar_ts_utc)

    # Phase: AM (before PM start) — full size
    if et_min < start_min:
        return PmSizeFactorResult(
            factor=1.0,
            phase="am",
            et_minute_of_day=et_min,
            reason="am_session: full base size (factor=1.0)",
        )

    # Phase: PM closed — no new entries
    if et_min >= last_entry_min:
        return PmSizeFactorResult(
            factor=0.0,
            phase="pm_closed",
            et_minute_of_day=et_min,
            reason=(
                f"pm_closed: no new entries after {pm_last_entry_et} ET "
                f"(15:55 flatten still active for open positions)"
            ),
        )

    # Phase: PM floor — held at floor between floor_min and last_entry_min
    if et_min >= floor_min:
        return PmSizeFactorResult(
            factor=factor_at_floor,
            phase="pm_floor",
            et_minute_of_day=et_min,
            reason=(
                f"pm_floor: factor={factor_at_floor} held until {pm_last_entry_et} ET "
                f"(Topstep EOD trailing DD aware sizing per TTT Markets 2026-04)"
            ),
        )

    # Phase: PM taper — linear interpolation between factor_at_start and factor_at_floor
    progress = (et_min - start_min) / (floor_min - start_min)  # [0, 1)
    factor = factor_at_start + progress * (factor_at_floor - factor_at_start)
    # Match TS toFixed(6) precision rounding
    factor = round(factor, 6)

    return PmSizeFactorResult(
        factor=factor,
        phase="pm_taper",
        et_minute_of_day=et_min,
        reason=(
            f"pm_taper: linear decay {factor_at_start} -> {factor_at_floor} "
            f"from {pm_start_et} -> {pm_floor_at_et} ET (CLAUDE.md §4)"
        ),
    )


def compute_pm_size_factor_vec(
    et_minute_of_day: "np.ndarray",  # noqa: F821 — forward-ref to avoid hard numpy dep at import time
    pm_start_et: Optional[str] = None,
    pm_floor_at_et: Optional[str] = None,
    pm_last_entry_et: Optional[str] = None,
    factor_at_start: Optional[float] = None,
    factor_at_floor: Optional[float] = None,
) -> "np.ndarray":  # noqa: F821
    """Vectorized PM size factor for backtester per-bar sizing.

    Input: numpy array of ET-minute-of-day integers (0..1439). Caller is
    responsible for converting UTC bar timestamps to ET wall-clock minutes
    via Polars/numpy (e.g. `df.select(pl.col("ts_event").dt.convert_time_zone("America/New_York").dt.hour() * 60 + ...)`).

    Output: numpy float64 array of factors in [0, 1], one per bar.

    Same logic as compute_pm_size_factor() but per-bar vectorized to keep the
    backtester sizing path O(n) rather than O(n) Python-call overhead per bar.
    Misconfig fallback: return all-0.25 array.
    """
    import numpy as np  # local import — avoid breaking import-time when numpy absent

    env = get_pm_size_factor_env_defaults()
    pm_start_et = pm_start_et if pm_start_et is not None else env["pm_start_et"]
    pm_floor_at_et = pm_floor_at_et if pm_floor_at_et is not None else env["pm_floor_at_et"]
    pm_last_entry_et = pm_last_entry_et if pm_last_entry_et is not None else env["pm_last_entry_et"]
    factor_at_start = factor_at_start if factor_at_start is not None else env["factor_at_start"]
    factor_at_floor = factor_at_floor if factor_at_floor is not None else env["factor_at_floor"]

    start_min = _parse_hh_mm(pm_start_et)
    floor_min = _parse_hh_mm(pm_floor_at_et)
    last_entry_min = _parse_hh_mm(pm_last_entry_et)

    if (
        start_min is None or floor_min is None or last_entry_min is None
        or not isinstance(factor_at_start, (int, float))
        or not isinstance(factor_at_floor, (int, float))
        or factor_at_start < 0 or factor_at_start > 1
        or factor_at_floor < 0 or factor_at_floor > 1
        or floor_min <= start_min or last_entry_min < floor_min
    ):
        # Misconfig: conservative fallback to floor factor everywhere
        return np.full_like(et_minute_of_day, 0.25, dtype=np.float64)

    et = np.asarray(et_minute_of_day, dtype=np.float64)

    # Default: AM session → 1.0
    factors = np.ones_like(et, dtype=np.float64)

    # PM closed (>= last_entry_min) → 0
    closed_mask = et >= last_entry_min
    factors[closed_mask] = 0.0

    # PM floor (floor_min <= et < last_entry_min) → factor_at_floor
    floor_mask = (et >= floor_min) & (et < last_entry_min)
    factors[floor_mask] = factor_at_floor

    # PM taper (start_min <= et < floor_min) → linear interpolation
    taper_mask = (et >= start_min) & (et < floor_min)
    if taper_mask.any():
        span = floor_min - start_min
        progress = (et[taper_mask] - start_min) / span
        factors[taper_mask] = factor_at_start + progress * (factor_at_floor - factor_at_start)
        # Match scalar toFixed(6) rounding for parity
        factors[taper_mask] = np.round(factors[taper_mask], 6)

    return factors


if __name__ == "__main__":
    # CLI entry for the parity-checker. Reads UTC ISO timestamp from argv[1],
    # emits JSON {factor, phase, et_minute_of_day, reason} to stdout.
    import json
    import sys

    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: pm_size_factor.py <ISO-8601-utc-timestamp>"}))
        sys.exit(1)

    ts_str = sys.argv[1]
    try:
        # Accept "Z" suffix; fromisoformat is strict
        if ts_str.endswith("Z"):
            ts_str = ts_str[:-1] + "+00:00"
        ts = datetime.fromisoformat(ts_str)
    except ValueError as e:
        print(json.dumps({"error": f"invalid timestamp: {e}"}))
        sys.exit(1)

    r = compute_pm_size_factor(ts)
    print(json.dumps({
        "factor": r.factor,
        "phase": r.phase,
        "et_minute_of_day": r.et_minute_of_day,
        "reason": r.reason,
    }))
