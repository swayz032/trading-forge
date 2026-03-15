"""
BLS API client -- Bureau of Labor Statistics.
v1 (no key): 25 requests/day. v2 (free key): 500 requests/day.
Fetches: CPI, PPI, Employment, Unemployment claims.

Uses only stdlib (urllib) -- no requests dependency.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BLS_V1_URL = "https://api.bls.gov/publicAPI/v1/timeseries/data/"
BLS_V2_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/"

BLS_SERIES = {
    "cpi_all_urban": "CUSR0000SA0",       # CPI-U All Items
    "cpi_core": "CUSR0000SA0L1E",         # CPI-U Core (less food/energy)
    "ppi_finished": "WPUFD49104",         # PPI Finished Goods
    "nonfarm_payrolls": "CES0000000001",  # Total Nonfarm Payrolls
    "initial_claims": "LNS14000000",      # Unemployment Rate (monthly)
}

# Rate limiting
_last_request_time: float = 0.0
_REQUEST_INTERVAL: float = 1.0  # Conservative: 1 req/s


def _rate_limit() -> None:
    """Enforce BLS rate limiting."""
    global _last_request_time
    now = time.monotonic()
    elapsed = now - _last_request_time
    if elapsed < _REQUEST_INTERVAL:
        time.sleep(_REQUEST_INTERVAL - elapsed)
    _last_request_time = time.monotonic()


def _get_api_key(api_key: str | None = None) -> str | None:
    """Resolve BLS API key. None means use v1 (no key)."""
    return api_key or os.environ.get("BLS_API_KEY") or None


def _bls_period_to_date(year: str, period: str) -> str:
    """
    Convert BLS year + period code to YYYY-MM-DD.

    BLS period codes: M01-M12 (monthly), Q01-Q04 (quarterly),
    A01 (annual), S01-S02 (semi-annual).
    """
    if period.startswith("M"):
        month = int(period[1:])
        return f"{year}-{month:02d}-01"
    elif period.startswith("Q"):
        quarter = int(period[1:])
        month = (quarter - 1) * 3 + 1
        return f"{year}-{month:02d}-01"
    elif period.startswith("S"):
        half = int(period[1:])
        month = 1 if half == 1 else 7
        return f"{year}-{month:02d}-01"
    else:
        # Annual or unknown
        return f"{year}-01-01"


def fetch_bls_series(
    series_ids: list[str],
    start_year: int | None = None,
    end_year: int | None = None,
    api_key: str | None = None,
) -> dict[str, list[dict]]:
    """
    Fetch from BLS API. Returns {series_id: [{date, value}]}.

    Uses v2 if api_key provided, v1 otherwise.
    BLS API accepts up to 50 series per request (v2) or 25 (v1).

    Args:
        series_ids: List of BLS series IDs to fetch.
        start_year: Start year (default: current year - 1).
        end_year: End year (default: current year).
        api_key: BLS API key for v2 (optional).

    Returns:
        Dict mapping series_id to list of {date, value} observations.
    """
    key = _get_api_key(api_key)
    now_year = datetime.now().year

    if start_year is None:
        start_year = now_year - 1
    if end_year is None:
        end_year = now_year

    _rate_limit()

    # Build request payload
    payload: dict = {
        "seriesid": series_ids,
        "startyear": str(start_year),
        "endyear": str(end_year),
    }

    if key:
        base_url = BLS_V2_URL
        payload["registrationkey"] = key
    else:
        base_url = BLS_V1_URL

    body = json.dumps(payload).encode("utf-8")
    request = Request(
        base_url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "trading-forge/1.0",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))
    except HTTPError as e:
        raise ConnectionError(f"BLS API request failed (HTTP {e.code}): {e.read().decode()}") from e
    except URLError as e:
        raise ConnectionError(f"BLS API request failed: {e}") from e

    # Parse response
    results: dict[str, list[dict]] = {}

    status = data.get("status", "")
    if status != "REQUEST_SUCCEEDED":
        message = data.get("message", ["Unknown error"])
        raise RuntimeError(f"BLS API error: {status} - {message}")

    series_list = data.get("Results", {}).get("series", [])
    for series in series_list:
        sid = series.get("seriesID", "")
        observations: list[dict] = []

        for item in series.get("data", []):
            year = item.get("year", "")
            period = item.get("period", "")
            value_str = item.get("value", "")

            # Skip annual averages
            if period == "M13":
                continue

            try:
                value = float(value_str)
            except (ValueError, TypeError):
                continue

            date_str = _bls_period_to_date(year, period)
            observations.append({
                "date": date_str,
                "value": value,
            })

        # BLS returns data newest-first; reverse to chronological order
        observations.sort(key=lambda x: x["date"])
        results[sid] = observations

    return results


def fetch_all_bls(
    start_year: int | None = None,
    end_year: int | None = None,
    api_key: str | None = None,
) -> dict[str, list[dict]]:
    """
    Fetch all configured BLS series.

    Args:
        start_year: Start year.
        end_year: End year.
        api_key: BLS API key.

    Returns:
        Dict mapping series name to list of observations.
    """
    key = _get_api_key(api_key)
    series_ids = list(BLS_SERIES.values())

    try:
        raw = fetch_bls_series(
            series_ids,
            start_year=start_year,
            end_year=end_year,
            api_key=key,
        )
    except Exception:
        return {name: [] for name in BLS_SERIES}

    # Map series IDs back to friendly names
    id_to_name = {v: k for k, v in BLS_SERIES.items()}
    results: dict[str, list[dict]] = {}
    for sid, observations in raw.items():
        name = id_to_name.get(sid, sid)
        results[name] = observations

    return results
