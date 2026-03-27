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
from pathlib import Path

import databento as db

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

    if args.dry_run:
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
        except Exception as e:
            result = {"status": "error", "message": str(e)}
    else:
        try:
            result = download(client, args.symbol, args.start, args.end, args.output_dir)
        except Exception as e:
            result = {"status": "error", "message": str(e)}

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
