"""
FRED API client -- Federal Reserve Economic Data.
Free API key from https://fred.stlouisfed.org/docs/api/api_key.html
Fetches: Fed Funds Rate, 10Y Treasury, 2Y Treasury, VIX, yield curve spread.

Uses only stdlib (urllib) -- no requests dependency.
Rate limit: 120 requests/minute for FRED.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timedelta
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations"

# Key FRED series IDs
FRED_SERIES = {
    "fed_funds_rate": "FEDFUNDS",         # Federal Funds Effective Rate (monthly)
    "treasury_10y": "DGS10",              # 10-Year Treasury Constant Maturity Rate (daily)
    "treasury_2y": "DGS2",               # 2-Year Treasury (daily)
    "treasury_3m": "DGS3MO",             # 3-Month Treasury (daily)
    "vix": "VIXCLS",                      # CBOE VIX (daily)
    "yield_spread_10y2y": "T10Y2Y",       # 10Y-2Y spread (daily)
    "unemployment": "UNRATE",             # Unemployment Rate (monthly)
    "cpi_yoy": "CPIAUCSL",              # CPI All Urban (monthly, compute YoY)
    "pce_yoy": "PCEPI",                 # PCE Price Index (monthly)
    "retail_sales": "RSAFS",             # Retail Sales (monthly)
    "industrial_production": "INDPRO",    # Industrial Production (monthly)
}

# Rate limiting state
_last_request_time: float = 0.0
_REQUEST_INTERVAL: float = 0.5  # 120 req/min = 0.5s between requests


def _rate_limit() -> None:
    """Enforce FRED rate limit of 120 requests/minute."""
    global _last_request_time
    now = time.monotonic()
    elapsed = now - _last_request_time
    if elapsed < _REQUEST_INTERVAL:
        time.sleep(_REQUEST_INTERVAL - elapsed)
    _last_request_time = time.monotonic()


def _get_api_key(api_key: str | None = None) -> str:
    """Resolve FRED API key from argument or environment."""
    key = api_key or os.environ.get("FRED_API_KEY", "")
    if not key:
        raise ValueError(
            "FRED API key required. Set FRED_API_KEY env var or pass api_key argument. "
            "Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html"
        )
    return key


def fetch_series(
    series_id: str,
    start_date: str | None = None,
    end_date: str | None = None,
    api_key: str | None = None,
) -> list[dict]:
    """
    Fetch observations from FRED API.

    Returns list of {"date": "YYYY-MM-DD", "value": float}.
    Handles missing values (FRED returns ".").

    Args:
        series_id: FRED series ID (e.g. "DGS10")
        start_date: Start date in YYYY-MM-DD format
        end_date: End date in YYYY-MM-DD format
        api_key: FRED API key (falls back to FRED_API_KEY env var)

    Returns:
        List of observation dicts with date and value keys.
    """
    key = _get_api_key(api_key)
    _rate_limit()

    params = f"series_id={series_id}&api_key={key}&file_type=json"
    if start_date:
        params += f"&observation_start={start_date}"
    if end_date:
        params += f"&observation_end={end_date}"

    url = f"{FRED_BASE_URL}?{params}"
    request = Request(url, headers={"User-Agent": "trading-forge/1.0"})

    try:
        with urlopen(request, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))
    except HTTPError as e:
        if e.code == 429:
            # Rate limited -- wait and retry once
            time.sleep(2.0)
            _rate_limit()
            with urlopen(request, timeout=30) as response:
                data = json.loads(response.read().decode("utf-8"))
        else:
            raise
    except URLError as e:
        raise ConnectionError(f"FRED API request failed for {series_id}: {e}") from e

    observations = data.get("observations", [])
    results: list[dict] = []

    for obs in observations:
        value_str = obs.get("value", ".")
        if value_str == "." or value_str is None or value_str == "":
            continue  # Skip missing values
        try:
            value = float(value_str)
        except (ValueError, TypeError):
            continue
        results.append({
            "date": obs["date"],
            "value": value,
        })

    return results


def fetch_all_macro(
    lookback_days: int = 365,
    api_key: str | None = None,
) -> dict[str, list[dict]]:
    """
    Fetch all configured FRED series for the lookback period.

    Args:
        lookback_days: Number of days to look back from today.
        api_key: FRED API key.

    Returns:
        Dict mapping series name to list of observations.
    """
    key = _get_api_key(api_key)
    end_date = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=lookback_days)).strftime("%Y-%m-%d")

    results: dict[str, list[dict]] = {}

    for name, series_id in FRED_SERIES.items():
        try:
            observations = fetch_series(
                series_id,
                start_date=start_date,
                end_date=end_date,
                api_key=key,
            )
            results[name] = observations
        except Exception:
            # Log but don't fail -- partial data is better than none
            results[name] = []

    return results


def get_latest_values(api_key: str | None = None) -> dict[str, float | None]:
    """
    Get most recent value for each configured FRED series.

    Args:
        api_key: FRED API key.

    Returns:
        Dict mapping series name to most recent float value (or None if unavailable).
    """
    all_data = fetch_all_macro(lookback_days=90, api_key=api_key)
    latest: dict[str, float | None] = {}

    for name, observations in all_data.items():
        if observations:
            latest[name] = observations[-1]["value"]
        else:
            latest[name] = None

    return latest
