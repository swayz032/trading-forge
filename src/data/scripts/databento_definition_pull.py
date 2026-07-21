"""
W19 Schema 1 — Databento Definition Pull

Fetches the Definition schema for ES/NQ/MES/MNQ/MCL from GLBX.MDP3.
Definition schema is FREE (included with any historical data license).

Writes one JSON file per symbol to data_cache/contract_specs/<symbol>.json
for Skytech local access, AND outputs structured JSON for the Node scheduler
to persist to contract_specs_authoritative table.

Usage:
    python databento_definition_pull.py --output-json
    python databento_definition_pull.py --symbols ES,NQ --output-json

Expected multipliers (hardcoded reference for verification alert):
    ES  -> $50  per point
    NQ  -> $20  per point
    MES -> $5   per point
    MNQ -> $2   per point
    MCL -> $10  per barrel (1000 bbl per contract)
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

import databento as db

# Tracking import is fire-and-forget: if the module or DB is unavailable the
# script still runs.  All tracker calls are wrapped in try/except internally.
try:
    import sys as _sys
    import os as _os
    _sys.path.insert(0, _os.path.dirname(__file__))
    from _data_sync_tracking import (
        start_sync_job,
        complete_sync_job,
        fail_sync_job,
        COST_DEFINITION_FREE,
    )
except Exception:  # noqa: BLE001
    COST_DEFINITION_FREE = 0.0
    def start_sync_job(*a, **kw): return None  # type: ignore[misc]
    def complete_sync_job(*a, **kw): return None  # type: ignore[misc]
    def fail_sync_job(*a, **kw): return None  # type: ignore[misc]

DATASET = "GLBX.MDP3"

# Continuous front-month contracts for Definition pulls
SYMBOL_MAP: dict[str, str] = {
    "ES":  "ES.c.0",
    "NQ":  "NQ.c.0",
    "MES": "MES.c.0",
    "MNQ": "MNQ.c.0",
    "MCL": "MCL.c.0",
}

# Hardcoded reference values from firm-config.ts — alert fires if CME changes these
EXPECTED_MULTIPLIERS: dict[str, float] = {
    "ES":  50.0,
    "NQ":  20.0,
    "MES": 5.0,
    "MNQ": 2.0,
    "MCL": 10.0,
}

EXPECTED_TICK_SIZES: dict[str, float] = {
    "ES":  0.25,
    "NQ":  0.25,
    "MES": 0.25,
    "MNQ": 0.25,
    "MCL": 0.01,
}


def get_cache_dir() -> Path:
    """data_cache/contract_specs/ relative to project root."""
    return Path(__file__).parent.parent.parent.parent / "data_cache" / "contract_specs"


def get_client() -> db.Historical:
    api_key = os.environ.get("DATABENTO_API_KEY")
    if not api_key:
        raise RuntimeError("DATABENTO_API_KEY not set in environment")
    return db.Historical(api_key)


def pull_definition(
    client: db.Historical,
    symbol: str,
    start_date: str,
    end_date: str,
) -> dict[str, Any]:
    """
    Pull definition records for a single symbol.
    Returns the parsed spec dict with multiplier, tick_size, point_value, expiry.

    Definition schema returns instrument metadata — not time-series bars.
    We use a 1-day window (today) since we only need current specs.
    stype_in='continuous' gives us the front-month contract definition.
    """
    dbn_symbol = SYMBOL_MAP.get(symbol)
    if not dbn_symbol:
        raise ValueError(f"Unknown symbol: {symbol}. Known: {list(SYMBOL_MAP.keys())}")

    data = client.timeseries.get_range(
        dataset=DATASET,
        symbols=[dbn_symbol],
        stype_in="continuous",
        schema="definition",
        start=start_date,
        end=end_date,
    )

    df = data.to_df()
    if df is None or len(df) == 0:
        raise ValueError(f"No definition records returned for {symbol} ({dbn_symbol})")

    # Definition records contain instrument metadata
    # Key fields: min_price_increment (tick), unit_of_measure_qty (multiplier),
    #             expiration (expiry date), instrument_class, underlying
    row = df.iloc[0]

    # Databento definition fields — field names from MDP3 schema
    # min_price_increment: minimum price change = tick size (in points)
    # unit_of_measure_qty: units per contract (ES=50, NQ=20, etc.)
    # expiration: nanosecond UTC timestamp of contract expiry

    tick_size_raw = float(row.get("min_price_increment", 0) or 0)
    multiplier_raw = float(row.get("unit_of_measure_qty", 0) or 0)

    # Databento stores prices in fixed-point. min_price_increment is already in
    # native price units (e.g., 0.25 for ES quarter-point ticks).
    # unit_of_measure_qty is the number of underlying units per contract
    # (ES=50 shares of the index point value, NQ=20, etc.)

    # point_value = multiplier (dollar value per full point)
    # For ES: 1 point = $50; tick_size = 0.25; tick_value = 0.25 * 50 = $12.50
    point_value = multiplier_raw

    # Expiry: nanosecond timestamp -> date
    expiry_date = None
    expiration_raw = row.get("expiration")
    if expiration_raw is not None:
        try:
            expiry_ns = int(expiration_raw)
            if expiry_ns > 0:
                expiry_dt = datetime.fromtimestamp(expiry_ns / 1e9, tz=timezone.utc)
                expiry_date = expiry_dt.strftime("%Y-%m-%d")
        except (TypeError, ValueError, OSError):
            expiry_date = None

    # Build raw definition dict (limited to useful audit fields)
    raw_def: dict[str, Any] = {}
    for col in df.columns:
        val = row.get(col)
        if val is not None and not (isinstance(val, float) and val != val):  # skip NaN
            try:
                raw_def[col] = str(val) if hasattr(val, "__class__") and val.__class__.__name__ in ("Timestamp", "datetime") else val
            except Exception:
                raw_def[col] = str(val)

    return {
        "symbol": symbol,
        "dbn_symbol": dbn_symbol,
        "multiplier": multiplier_raw,
        "tick_size": tick_size_raw,
        "point_value": point_value,
        "expiry_date": expiry_date,
        "raw_definition": raw_def,
        "records_returned": len(df),
    }


def check_against_expected(symbol: str, spec: dict[str, Any]) -> dict[str, Any]:
    """
    Compare pulled spec against hardcoded expected values.
    Returns alert dict if any value changed.
    """
    alerts = []

    expected_mult = EXPECTED_MULTIPLIERS.get(symbol)
    if expected_mult is not None and spec["multiplier"] > 0:
        if abs(spec["multiplier"] - expected_mult) > 0.001:
            alerts.append({
                "field": "multiplier",
                "expected": expected_mult,
                "actual": spec["multiplier"],
                "delta": spec["multiplier"] - expected_mult,
            })

    expected_tick = EXPECTED_TICK_SIZES.get(symbol)
    if expected_tick is not None and spec["tick_size"] > 0:
        if abs(spec["tick_size"] - expected_tick) > 0.0001:
            alerts.append({
                "field": "tick_size",
                "expected": expected_tick,
                "actual": spec["tick_size"],
                "delta": spec["tick_size"] - expected_tick,
            })

    return {
        "symbol": symbol,
        "spec_changed": len(alerts) > 0,
        "changes": alerts,
    }


def save_to_cache(symbol: str, spec: dict[str, Any]) -> str:
    """Write spec to data_cache/contract_specs/<symbol>.json atomically."""
    cache_dir = get_cache_dir()
    cache_dir.mkdir(parents=True, exist_ok=True)
    dest = cache_dir / f"{symbol}.json"
    tmp = dest.with_suffix(".json.tmp")

    payload = {
        **spec,
        "pulled_at": datetime.now(timezone.utc).isoformat(),
        "source": "databento_definition",
    }
    with open(tmp, "w", newline="\n") as f:
        json.dump(payload, f, indent=2, default=str)
    os.replace(str(tmp), str(dest))
    return str(dest)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="W19: Pull Databento Definition schema for contract specs"
    )
    parser.add_argument(
        "--symbols",
        default="ES,NQ,MES,MNQ,MCL",
        help="Comma-separated symbols (default: ES,NQ,MES,MNQ,MCL)",
    )
    parser.add_argument(
        "--output-json",
        action="store_true",
        help="Output results as JSON (for Node subprocess parsing)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Skip actual Databento pull; return mock data (testing only)",
    )
    args = parser.parse_args()

    symbols = [s.strip() for s in args.symbols.split(",") if s.strip()]

    # Definition schema: use a 1-day window ending today to get current specs.
    # The Definition schema holds static instrument metadata; any recent window works.
    today = datetime.now(timezone.utc)
    end_date = today.strftime("%Y-%m-%d")
    start_date = (today - timedelta(days=3)).strftime("%Y-%m-%d")  # 3-day window to ensure records exist

    if args.dry_run:
        # Return mock data for testing without hitting Databento API
        results = []
        for symbol in symbols:
            spec = {
                "symbol": symbol,
                "dbn_symbol": SYMBOL_MAP.get(symbol, symbol + ".c.0"),
                "multiplier": EXPECTED_MULTIPLIERS.get(symbol, 0.0),
                "tick_size": EXPECTED_TICK_SIZES.get(symbol, 0.25),
                "point_value": EXPECTED_MULTIPLIERS.get(symbol, 0.0),
                "expiry_date": "2025-06-20",
                "raw_definition": {"mode": "dry_run"},
                "records_returned": 1,
            }
            alert = check_against_expected(symbol, spec)
            results.append({
                "status": "dry_run",
                "symbol": symbol,
                **spec,
                "alert": alert,
                "cache_path": str(get_cache_dir() / f"{symbol}.json"),
            })
        output = {
            "status": "ok",
            "mode": "dry_run",
            "pulled_at": today.isoformat(),
            "results": results,
        }
        print(json.dumps(output, indent=2, default=str))
        return

    # Live pull
    try:
        client = get_client()
    except RuntimeError as e:
        print(json.dumps({"status": "error", "message": str(e)}))
        sys.exit(1)

    results = []
    any_error = False
    any_spec_changed = False

    _start_dt = datetime.strptime(start_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    _end_dt = datetime.strptime(end_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)

    for symbol in symbols:
        _job_id = start_sync_job(
            symbol=symbol,
            source="databento",
            start_date=_start_dt,
            end_date=_end_dt,
            metadata={"schema": "definition", "dataset": DATASET},
        )
        try:
            spec = pull_definition(client, symbol, start_date, end_date)
            alert = check_against_expected(symbol, spec)
            cache_path = save_to_cache(symbol, spec)

            if alert["spec_changed"]:
                any_spec_changed = True

            complete_sync_job(
                job_id=_job_id,
                rows_downloaded=spec.get("records_returned", 0),
                cost_usd=COST_DEFINITION_FREE,
                metadata={
                    "schema": "definition",
                    "spec_changed": alert.get("spec_changed", False),
                    "multiplier": spec.get("multiplier"),
                    "tick_size": spec.get("tick_size"),
                },
            )
            results.append({
                "status": "ok",
                "symbol": symbol,
                **spec,
                "alert": alert,
                "cache_path": cache_path,
            })
        except Exception as e:
            any_error = True
            fail_sync_job(job_id=_job_id, error_message=str(e))
            results.append({
                "status": "error",
                "symbol": symbol,
                "message": str(e),
            })

    output = {
        "status": "error" if any_error else "ok",
        "mode": "execute",
        "pulled_at": today.isoformat(),
        "spec_changed": any_spec_changed,
        "results": results,
    }

    if args.output_json:
        print(json.dumps(output, indent=2, default=str))
    else:
        print(f"\n{'=' * 70}")
        print("Databento Definition Pull — W19 Schema 1")
        print(f"{'=' * 70}")
        for r in results:
            sym = r.get("symbol", "?")
            status = r.get("status", "?")
            if status == "ok":
                mult = r.get("multiplier", "?")
                tick = r.get("tick_size", "?")
                changed = r.get("alert", {}).get("spec_changed", False)
                alert_tag = " [SPEC CHANGED]" if changed else ""
                print(f"  OK  {sym}: multiplier=${mult}, tick={tick}{alert_tag}")
            else:
                print(f"  ERR {sym}: {r.get('message', '?')}")
        if any_spec_changed:
            print("\n  *** ALERT: contract spec changed vs hardcoded reference ***")
        print()

    if any_error:
        sys.exit(1)


if __name__ == "__main__":
    main()
