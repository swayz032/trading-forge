"""
Databento Historical Data Downloader

Downloads OHLCV-1m Parquet files for futures continuous contracts.
Supports dry-run cost checking to preserve $125 credit budget.

Usage:
    python databento_download.py --symbol ES --start 2020-01-01 --end 2025-01-01 --output-dir ./data/raw
    python databento_download.py --symbol ES --start 2020-01-01 --end 2025-01-01 --output-dir ./data/raw --dry-run
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

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
    )
except Exception:  # noqa: BLE001
    def start_sync_job(*a, **kw): return None  # type: ignore[misc]
    def complete_sync_job(*a, **kw): return None  # type: ignore[misc]
    def fail_sync_job(*a, **kw): return None  # type: ignore[misc]

# Symbol → Databento continuous front-month contract mapping
# stype_in="continuous" with .c.0 = front month continuous
SYMBOL_MAP = {
    "ES": "ES.c.0",
    "NQ": "NQ.c.0",
    "CL": "CL.c.0",
}

DATASET = "GLBX.MDP3"


def get_client() -> db.Historical:
    api_key = os.environ.get("DATABENTO_API_KEY")
    if not api_key:
        print(json.dumps({"status": "error", "message": "DATABENTO_API_KEY not set"}))
        sys.exit(1)
    return db.Historical(api_key)


def check_cost(client: db.Historical, symbol: str, start: str, end: str) -> float:
    dbn_symbol = SYMBOL_MAP.get(symbol)
    if not dbn_symbol:
        raise ValueError(f"Unknown symbol: {symbol}. Known: {list(SYMBOL_MAP.keys())}")

    cost = client.metadata.get_cost(
        dataset=DATASET,
        symbols=[dbn_symbol],
        stype_in="continuous",
        schema="ohlcv-1m",
        start=start,
        end=end,
    )
    return cost


def download(
    client: db.Historical,
    symbol: str,
    start: str,
    end: str,
    output_dir: str,
) -> dict:
    dbn_symbol = SYMBOL_MAP.get(symbol)
    if not dbn_symbol:
        raise ValueError(f"Unknown symbol: {symbol}. Known: {list(SYMBOL_MAP.keys())}")

    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    filename = f"{symbol}_ohlcv-1m_{start}_{end}.dbn.zst"
    output_file = out_path / filename

    data = client.timeseries.get_range(
        dataset=DATASET,
        symbols=[dbn_symbol],
        stype_in="continuous",
        schema="ohlcv-1m",
        start=start,
        end=end,
    )

    # Save as DBN format first, then convert to Parquet
    data.to_file(str(output_file))

    # Convert to Parquet
    parquet_file = out_path / f"{symbol}_ohlcv-1m_{start}_{end}.parquet"
    df = data.to_df()
    df.to_parquet(str(parquet_file))

    return {
        "status": "ok",
        "path": str(parquet_file),
        "dbn_path": str(output_file),
        "rows": len(df),
        "columns": list(df.columns),
    }


def main():
    parser = argparse.ArgumentParser(description="Download futures data from Databento")
    parser.add_argument("--symbol", required=True, help="Symbol (ES, NQ, CL, etc.)")
    parser.add_argument("--start", required=True, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end", required=True, help="End date (YYYY-MM-DD)")
    parser.add_argument("--output-dir", required=True, help="Output directory for Parquet files")
    parser.add_argument("--dry-run", action="store_true", help="Only check cost, don't download")
    args = parser.parse_args()

    client = get_client()

    # Parse dates for tracking row
    try:
        _start_dt = datetime.strptime(args.start, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        _end_dt = datetime.strptime(args.end, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except Exception:
        _start_dt = datetime.now(timezone.utc)
        _end_dt = datetime.now(timezone.utc)

    if args.dry_run:
        # Dry-run: cost-check only — no download.  Track as a minimal job so the
        # cost estimate is visible in the dashboard.
        _job_id = start_sync_job(
            symbol=args.symbol,
            source="databento",
            start_date=_start_dt,
            end_date=_end_dt,
            metadata={"mode": "dry_run", "schema": "ohlcv-1m", "dataset": DATASET},
        )
        try:
            cost = check_cost(client, args.symbol, args.start, args.end)
            result = {
                "status": "ok",
                "mode": "dry_run",
                "symbol": args.symbol,
                "start": args.start,
                "end": args.end,
                "cost_usd": cost,
            }
            complete_sync_job(
                job_id=_job_id,
                rows_downloaded=0,
                cost_usd=float(cost),
                metadata={"mode": "dry_run", "schema": "ohlcv-1m"},
            )
        except Exception as e:
            result = {"status": "error", "message": str(e)}
            fail_sync_job(job_id=_job_id, error_message=str(e))
    else:
        _job_id = start_sync_job(
            symbol=args.symbol,
            source="databento",
            start_date=_start_dt,
            end_date=_end_dt,
            metadata={"schema": "ohlcv-1m", "dataset": DATASET, "output_dir": args.output_dir},
        )
        try:
            result = download(client, args.symbol, args.start, args.end, args.output_dir)
            _rows = result.get("rows", 0)
            # Use Databento billing API to get exact cost for bulk downloads
            try:
                _exact_cost = check_cost(client, args.symbol, args.start, args.end)
            except Exception:
                _exact_cost = None
            complete_sync_job(
                job_id=_job_id,
                rows_downloaded=int(_rows),
                cost_usd=float(_exact_cost) if _exact_cost is not None else 0.0,
                metadata={"schema": "ohlcv-1m", "path": result.get("path", "")},
            )
        except Exception as e:
            result = {"status": "error", "message": str(e)}
            fail_sync_job(job_id=_job_id, error_message=str(e))

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
