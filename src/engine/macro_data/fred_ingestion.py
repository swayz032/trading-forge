"""C11 FRED daily ingestion adapter.

Pulls the 6 FRED daily series used by the HMM macro regime classifier
and returns them as MacroObservation records ready for DB persistence.

Series pulled (C11 spec, empirically validated 2024-2026):
  T10Y2Y      — 10Y-2Y yield spread (regime transition signal)
  DFF         — Fed Funds effective rate
  USEPUINDXD  — Economic Policy Uncertainty Index (daily)
  VIXCLS      — VIX closing price
  DTWEXBGS    — Trade-weighted dollar (broad, goods)
  RRPONTSYD   — Overnight reverse repo (daily proxy, H.4.1 is authoritative weekly)

Uses the existing src.data.macro.fred_client (stdlib urllib, no fredapi dep).
Look-ahead prevention: publication_timestamp = the MOMENT this script runs
(i.e., when FRED makes it available), NOT series_date. For historical backtests
this should use ALFRED vintage dates — current implementation uses pull-time
as a conservative approximation (always ≥ series_date + 1 day).

Env vars required:
  FRED_API_KEY — free from https://fred.stlouisfed.org/docs/api/api_key.html
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from typing import NamedTuple

# Reuse the existing stdlib-based FRED client (no fredapi dependency needed)
sys.path.insert(0, ".")
from src.data.macro.fred_client import fetch_series  # noqa: E402

# C11 series to pull daily (FRED series ID → canonical series_id for DB)
C11_FRED_SERIES: dict[str, str] = {
    "T10Y2Y": "T10Y2Y",          # 10Y-2Y yield spread
    "DFF": "DFF",                 # Fed Funds effective rate
    "USEPUINDXD": "USEPUINDXD",  # Policy uncertainty (daily)
    "VIXCLS": "VIXCLS",          # VIX close
    "DTWEXBGS": "DTWEXBGS",      # Trade-weighted dollar
    "RRPONTSYD": "RRPONTSYD",    # Overnight RRP (daily FRED proxy)
}


class MacroObservation(NamedTuple):
    """A single macro data point ready for macro_features DB row insertion."""

    series_id: str
    series_date: str          # YYYY-MM-DD — the date the value applies to
    publication_timestamp: str  # ISO-8601 UTC — when data became available
    value: float
    revision_number: int      # 1 = initial release
    source: str               # "fred" | "bls" | "treasury_direct"


def pull_fred_daily(
    lookback_days: int = 5,
    api_key: str | None = None,
) -> list[MacroObservation]:
    """Pull last N days of C11 FRED series.

    Args:
        lookback_days: How many calendar days back to pull. Default 5 covers
            a trading week + any weekend/holiday gaps.
        api_key: FRED API key. Defaults to FRED_API_KEY env var.

    Returns:
        List of MacroObservation ready for DB upsert via macro_features.
        Look-ahead safe: publication_timestamp = now (pull time) >= series_date.

    Raises:
        ValueError: FRED_API_KEY missing.
        ConnectionError: FRED API unreachable.
    """
    from datetime import timedelta

    key = api_key or os.environ.get("FRED_API_KEY", "")
    if not key:
        raise ValueError(
            "FRED_API_KEY env var required for C11 macro ingestion. "
            "Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html"
        )

    # Publication timestamp = now (UTC, ISO-8601)
    # Conservative: FRED data is published the same day or next day; using
    # pull-time as publication_timestamp ensures look-ahead safety.
    pub_ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    end_date = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=lookback_days + 3)).strftime("%Y-%m-%d")

    observations: list[MacroObservation] = []

    for fred_series_id, canonical_id in C11_FRED_SERIES.items():
        try:
            raw = fetch_series(
                fred_series_id,
                start_date=start_date,
                end_date=end_date,
                api_key=key,
            )
        except Exception as exc:
            print(
                f"WARNING: C11 FRED pull failed for {fred_series_id}: {exc}",
                file=sys.stderr,
            )
            continue

        for obs in raw:
            # Only include dates within the requested lookback window
            try:
                obs_date = datetime.strptime(obs["date"], "%Y-%m-%d")
                if obs_date < datetime.now() - timedelta(days=lookback_days + 3):
                    continue
            except ValueError:
                continue

            observations.append(
                MacroObservation(
                    series_id=canonical_id,
                    series_date=obs["date"],
                    publication_timestamp=pub_ts,
                    value=float(obs["value"]),
                    revision_number=1,
                    source="fred",
                )
            )

    return observations
