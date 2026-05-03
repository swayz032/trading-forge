"""C11 H.4.1 RRP/TGA ingestion adapter.

Pulls Federal Reserve H.4.1 statistical release data for:
  RRPONTSYD — Overnight Reverse Repo balance (the authoritative weekly)
  WTREGEN   — U.S. Treasury General Account (TGA) balance

H.4.1 is published every Thursday at 4:30 PM ET.
We apply these values Friday morning (9 AM ET cron).

Critical C11 thresholds (Dec 2025 regime collapse patterns):
  RRP <  $15B  AND  TGA jump > $50B  → liquidity stress signal
  TGA > +$100B/week                   → liquidity squeeze
  Both together                        → Crisis state hard gate candidate

Source: FRED API (FRED also hosts H.4.1 series)
  RRPONTSYD: https://fred.stlouisfed.org/series/RRPONTSYD
  WTREGEN:   https://fred.stlouisfed.org/series/WTREGEN

Note: The FRED RRPONTSYD series is daily but H.4.1 is the authoritative
weekly source. For simplicity, we pull both from FRED — the values match
the H.4.1 release for Thursdays.

Look-ahead prevention:
  publication_timestamp = Friday pull timestamp (≥ Thursday 4:30 PM release)
  series_date = the Thursday H.4.1 observation date
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.engine.macro_data.fred_ingestion import MacroObservation

sys.path.insert(0, ".")
from src.data.macro.fred_client import fetch_series  # noqa: E402

# H.4.1 series from FRED
H41_SERIES: dict[str, str] = {
    "RRPONTSYD": "RRPONTSYD",  # Overnight RRP outstanding ($B)
    "WTREGEN": "WTREGEN",      # TGA balance ($B)
}


def pull_h41_rrp_tga(
    lookback_days: int = 14,
    api_key: str | None = None,
) -> list["MacroObservation"]:
    """Pull H.4.1 RRP and TGA series from FRED.

    Returns weekly observations for RRP (RRPONTSYD) and TGA (WTREGEN)
    for the last 2 weeks. On Friday morning the most recent row is
    the Thursday H.4.1 release.

    Args:
        lookback_days: Days to look back. Default 14 covers 2 weekly releases.
        api_key: FRED API key (FRED_API_KEY env var fallback).

    Returns:
        MacroObservation list for DB upsert.
    """
    from datetime import timedelta

    from src.engine.macro_data.fred_ingestion import MacroObservation

    key = api_key or os.environ.get("FRED_API_KEY", "")
    if not key:
        raise ValueError(
            "FRED_API_KEY env var required for C11 H.4.1 ingestion."
        )

    pub_ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    end_date = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=lookback_days + 7)).strftime("%Y-%m-%d")

    observations: list[MacroObservation] = []

    for fred_id, canonical_id in H41_SERIES.items():
        try:
            raw = fetch_series(
                fred_id,
                start_date=start_date,
                end_date=end_date,
                api_key=key,
            )
        except Exception as exc:
            print(
                f"WARNING: C11 H.4.1 pull failed for {fred_id}: {exc}",
                file=sys.stderr,
            )
            continue

        for obs in raw:
            observations.append(
                MacroObservation(
                    series_id=canonical_id,
                    series_date=obs["date"],
                    publication_timestamp=pub_ts,
                    value=float(obs["value"]),
                    revision_number=1,
                    source="fred",  # H.4.1 series sourced via FRED
                )
            )

    return observations


def compute_rrp_tga_stress_signal(
    rrp_observations: list[dict],
    tga_observations: list[dict],
) -> dict:
    """Compute RRP/TGA stress signal from recent H.4.1 data.

    C11 threshold logic:
      - RRP < $15B AND TGA weekly jump > $50B → stress=True
      - TGA weekly jump > $100B              → squeeze=True (regardless of RRP)

    Args:
        rrp_observations: List of {date, value} for RRPONTSYD ($ billions)
        tga_observations: List of {date, value} for WTREGEN ($ billions)

    Returns:
        {
          "rrp_current": float,   # Most recent RRP ($B)
          "tga_current": float,   # Most recent TGA ($B)
          "tga_weekly_change": float,  # TGA change vs prior week ($B)
          "rrp_stress": bool,     # RRP < $15B
          "tga_squeeze": bool,    # TGA +$100B+/week
          "combined_stress": bool, # both rrp_stress AND tga_weekly_change > $50B
        }
    """
    rrp_sorted = sorted(rrp_observations, key=lambda x: x["date"])
    tga_sorted = sorted(tga_observations, key=lambda x: x["date"])

    rrp_current = float(rrp_sorted[-1]["value"]) if rrp_sorted else float("nan")
    tga_current = float(tga_sorted[-1]["value"]) if tga_sorted else float("nan")

    # Weekly TGA change (compare last 2 observations)
    if len(tga_sorted) >= 2:
        tga_prev = float(tga_sorted[-2]["value"])
        tga_weekly_change = tga_current - tga_prev
    else:
        tga_weekly_change = 0.0

    rrp_stress = rrp_current < 15.0 if not (rrp_current != rrp_current) else False
    tga_squeeze = tga_weekly_change > 100.0
    combined_stress = rrp_stress and tga_weekly_change > 50.0

    return {
        "rrp_current": rrp_current,
        "tga_current": tga_current,
        "tga_weekly_change": tga_weekly_change,
        "rrp_stress": rrp_stress,
        "tga_squeeze": tga_squeeze,
        "combined_stress": combined_stress,
    }
