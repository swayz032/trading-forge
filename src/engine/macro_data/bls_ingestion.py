"""C11 BLS data ingestion adapter.

Pulls BLS (Bureau of Labor Statistics) data for:
  NAPM / ISM Manufacturing PMI  (series: PCU------ proxy via NAPM)
  NFP  — Nonfarm Payrolls       (series: CES0000000001)
  CPI  — All Items Urban        (series: CUSR0000SA0)
  AHE  — Average Hourly Earnings (series: CES0500000003)
  JOLTS — Job Openings          (series: JTS000000000000000JOL)

C11 hard-gate threshold:
  NAPM (ISM Mfg PMI) < 49 → recession signal → triggers crisis gate when
  combined with RRP < $20B.

BLS API (free):
  v1: 25 requests/day (no key)
  v2: 500 requests/day (free key from bls.gov/developers)

Reuses existing src.data.macro.bls_client (stdlib urllib).
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.engine.macro_data.fred_ingestion import MacroObservation

sys.path.insert(0, ".")

# C11 BLS series
C11_BLS_SERIES: dict[str, str] = {
    "CES0000000001": "NFP",     # Nonfarm payrolls → "NFP"
    "CUSR0000SA0": "CPI",       # CPI All Urban → "CPI"
    "CES0500000003": "AHE",     # Avg hourly earnings → "AHE"
    "JTS000000000000000JOL": "JOLTS",  # Job openings → "JOLTS"
    # ISM/NAPM: BLS doesn't publish ISM directly; use FRED NAPM series via
    # fred_ingestion instead. Retained here as documentation of intent.
}


def pull_bls_release(
    api_key: str | None = None,
    year: int | None = None,
) -> list["MacroObservation"]:
    """Pull latest BLS release data for C11 macro series.

    Called on macro release days (8:35 AM ET cron) to capture NFP, CPI, etc.
    immediately after BLS publishes.

    Args:
        api_key: BLS API key (BLS_API_KEY env var fallback).
        year: Year to pull. Defaults to current year.

    Returns:
        MacroObservation list for DB upsert.
    """
    import os

    from src.engine.macro_data.fred_ingestion import MacroObservation

    key = api_key or os.environ.get("BLS_API_KEY") or None
    target_year = year or datetime.now().year

    pub_ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    observations: list[MacroObservation] = []

    # Use existing BLS client
    try:
        from src.data.macro.bls_client import fetch_series as bls_fetch_series
    except ImportError as exc:
        print(f"WARNING: BLS client not available: {exc}", file=sys.stderr)
        return observations

    for bls_series_id, canonical_name in C11_BLS_SERIES.items():
        try:
            raw = bls_fetch_series(
                bls_series_id,
                start_year=target_year - 1,
                end_year=target_year,
                api_key=key,
            )
        except Exception as exc:
            print(
                f"WARNING: C11 BLS pull failed for {bls_series_id} ({canonical_name}): {exc}",
                file=sys.stderr,
            )
            continue

        for obs in raw:
            # BLS returns period as "M01"..."M12", date is "YYYY-MM-DD" after conversion
            obs_date = obs.get("date", "")
            obs_value = obs.get("value")
            if not obs_date or obs_value is None:
                continue

            try:
                value = float(obs_value)
            except (TypeError, ValueError):
                continue

            observations.append(
                MacroObservation(
                    series_id=canonical_name,
                    series_date=obs_date,
                    publication_timestamp=pub_ts,
                    value=value,
                    revision_number=1,
                    source="bls",
                )
            )

    return observations
