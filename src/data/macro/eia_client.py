"""
EIA API client -- Energy Information Administration.
Free key from https://www.eia.gov/opendata/
Fetches: WTI Crude, Natural Gas, Gasoline prices.

Uses only stdlib (urllib) -- no requests dependency.
EIA API v2 base: https://api.eia.gov/v2/
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timedelta
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

EIA_BASE_URL = "https://api.eia.gov/v2"

EIA_SERIES = {
    "wti_crude": "PET.RWTC.D",                          # WTI Crude daily spot
    "brent_crude": "PET.RBRTE.D",                       # Brent daily spot
    "natural_gas": "NG.RNGWHHD.D",                      # Henry Hub Natural Gas daily
    "gasoline": "PET.EMM_EPMR_PTE_NUS_DPG.W",          # Regular gasoline weekly
}

# Rate limiting
_last_request_time: float = 0.0
_REQUEST_INTERVAL: float = 1.0  # Conservative


def _rate_limit() -> None:
    """Enforce EIA rate limiting."""
    global _last_request_time
    now = time.monotonic()
    elapsed = now - _last_request_time
    if elapsed < _REQUEST_INTERVAL:
        time.sleep(_REQUEST_INTERVAL - elapsed)
    _last_request_time = time.monotonic()


def _get_api_key(api_key: str | None = None) -> str:
    """Resolve EIA API key from argument or environment."""
    key = api_key or os.environ.get("EIA_API_KEY", "")
    if not key:
        raise ValueError(
            "EIA API key required. Set EIA_API_KEY env var or pass api_key argument. "
            "Get a free key at https://www.eia.gov/opendata/"
        )
    return key


def _parse_series_id(series_id: str) -> tuple[str, str, str]:
    """
    Parse EIA series ID into route components.

    E.g. "PET.RWTC.D" -> route="petroleum", series="RWTC", freq="daily"
    E.g. "NG.RNGWHHD.D" -> route="natural-gas", series="RNGWHHD", freq="daily"
    """
    parts = series_id.split(".")
    if len(parts) < 2:
        return "seriesid", series_id, ""

    prefix = parts[0].upper()
    route_map = {
        "PET": "petroleum",
        "NG": "natural-gas",
        "ELEC": "electricity",
        "COAL": "coal",
        "INTL": "international",
        "SEDS": "seds",
        "TOTAL": "total-energy",
    }
    route = route_map.get(prefix, prefix.lower())
    series = parts[1] if len(parts) > 1 else ""
    freq = parts[2] if len(parts) > 2 else ""
    return route, series, freq


def fetch_eia_series(
    series_id: str,
    start_date: str | None = None,
    end_date: str | None = None,
    api_key: str | None = None,
) -> list[dict]:
    """
    Fetch from EIA API v2. Returns [{date, value}].

    The EIA v2 API uses a route-based structure. We construct the URL
    from the series ID and query with date filters.

    Args:
        series_id: EIA series ID (e.g. "PET.RWTC.D").
        start_date: Start date in YYYY-MM-DD format.
        end_date: End date in YYYY-MM-DD format.
        api_key: EIA API key.

    Returns:
        List of observation dicts with date and value keys.
    """
    key = _get_api_key(api_key)
    _rate_limit()

    # EIA v2 uses the old series ID as a query parameter
    url = f"{EIA_BASE_URL}/seriesid/{series_id}?api_key={key}"
    url += "&frequency=daily&data[0]=value&sort[0][column]=period&sort[0][direction]=asc"

    if start_date:
        url += f"&start={start_date}"
    if end_date:
        url += f"&end={end_date}"

    request = Request(url, headers={"User-Agent": "trading-forge/1.0"})

    try:
        with urlopen(request, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))
    except HTTPError as e:
        if e.code == 429:
            time.sleep(2.0)
            _rate_limit()
            with urlopen(request, timeout=30) as response:
                data = json.loads(response.read().decode("utf-8"))
        else:
            raise ConnectionError(
                f"EIA API request failed for {series_id} (HTTP {e.code})"
            ) from e
    except URLError as e:
        raise ConnectionError(f"EIA API request failed for {series_id}: {e}") from e

    response_data = data.get("response", {}).get("data", [])
    results: list[dict] = []

    for item in response_data:
        period = item.get("period", "")
        value_raw = item.get("value")

        if value_raw is None or value_raw == "":
            continue

        try:
            value = float(value_raw)
        except (ValueError, TypeError):
            continue

        results.append({
            "date": period,
            "value": value,
        })

    return results


def fetch_all_eia(
    lookback_days: int = 365,
    api_key: str | None = None,
) -> dict[str, list[dict]]:
    """
    Fetch all configured EIA series for the lookback period.

    Args:
        lookback_days: Number of days to look back.
        api_key: EIA API key.

    Returns:
        Dict mapping series name to list of observations.
    """
    key = _get_api_key(api_key)
    end_date = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=lookback_days)).strftime("%Y-%m-%d")

    results: dict[str, list[dict]] = {}

    for name, series_id in EIA_SERIES.items():
        try:
            observations = fetch_eia_series(
                series_id,
                start_date=start_date,
                end_date=end_date,
                api_key=key,
            )
            results[name] = observations
        except Exception:
            results[name] = []

    return results
