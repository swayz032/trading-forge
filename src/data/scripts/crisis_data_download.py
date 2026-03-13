"""
Crisis Period Data Downloader

Downloads targeted date ranges for 8 historical crisis scenarios from Databento.
Only downloads pre-2020 data (2008-2019) since 2020-2026 is already available.

Usage:
    python crisis_data_download.py --symbols ES,NQ,CL --dry-run
    python crisis_data_download.py --symbols ES,NQ,CL --output-dir ./data/raw/crisis
"""

import argparse
import json
import os
import sys
from pathlib import Path

# Pre-2020 crisis periods that need data download
# Post-2020 periods already have data (2020-2026 in S3)
CRISIS_PERIODS = {
    "2008_financial_crisis": ("2008-09-01", "2008-12-31"),
    "2010_flash_crash": ("2010-04-15", "2010-06-15"),
    "2015_china_devaluation": ("2015-08-01", "2015-09-30"),
    "2018_volmageddon": ("2018-01-15", "2018-03-31"),
}

# Post-2020 periods — data already available, no download needed
EXISTING_PERIODS = {
    "covid_2020": ("2020-02-01", "2020-04-30"),
    "meme_archegos_2021": ("2021-01-15", "2021-04-15"),
    "2022_rate_shock": ("2022-06-01", "2022-10-31"),
    "2023_svb": ("2023-03-01", "2023-04-15"),
}

SYMBOL_MAP = {
    "ES": "ES.c.0",
    "NQ": "NQ.c.0",
    "CL": "CL.c.0",
    "YM": "YM.c.0",
    "RTY": "RTY.c.0",
    "GC": "GC.c.0",
}

DATASET = "GLBX.MDP3"


def get_client():
    import databento as db
    api_key = os.environ.get("DATABENTO_API_KEY")
    if not api_key:
        print(json.dumps({"status": "error", "message": "DATABENTO_API_KEY not set"}))
        sys.exit(1)
    return db.Historical(api_key)


def check_cost(client, symbol: str, start: str, end: str) -> float:
    dbn_symbol = SYMBOL_MAP.get(symbol)
    if not dbn_symbol:
        raise ValueError(f"Unknown symbol: {symbol}")

    cost = client.metadata.get_cost(
        dataset=DATASET,
        symbols=[dbn_symbol],
        stype_in="continuous",
        schema="ohlcv-1m",
        start=start,
        end=end,
    )
    return cost


def download_period(client, symbol: str, start: str, end: str, output_dir: Path) -> dict:
    dbn_symbol = SYMBOL_MAP.get(symbol)
    if not dbn_symbol:
        raise ValueError(f"Unknown symbol: {symbol}")

    out_path = output_dir / f"{symbol}_{start}_{end}.parquet"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    data = client.timeseries.get_range(
        dataset=DATASET,
        symbols=[dbn_symbol],
        stype_in="continuous",
        schema="ohlcv-1m",
        start=start,
        end=end,
    )

    data.to_parquet(str(out_path))

    return {
        "symbol": symbol,
        "start": start,
        "end": end,
        "path": str(out_path),
        "rows": len(data),
    }


def main():
    parser = argparse.ArgumentParser(description="Crisis Period Data Downloader")
    parser.add_argument("--symbols", default="ES,NQ,CL", help="Comma-separated symbols")
    parser.add_argument("--output-dir", default="./data/raw/crisis", help="Output directory")
    parser.add_argument("--dry-run", action="store_true", help="Check costs without downloading")
    args = parser.parse_args()

    symbols = [s.strip().upper() for s in args.symbols.split(",")]
    output_dir = Path(args.output_dir)

    client = get_client()

    total_cost = 0.0
    results = []

    print(f"{'Period':<30} {'Symbol':<6} {'Start':<12} {'End':<12} {'Cost':>8}")
    print("-" * 75)

    for period_name, (start, end) in CRISIS_PERIODS.items():
        for symbol in symbols:
            try:
                cost = check_cost(client, symbol, start, end)
                total_cost += cost
                print(f"{period_name:<30} {symbol:<6} {start:<12} {end:<12} ${cost:>7.2f}")

                if not args.dry_run:
                    result = download_period(client, symbol, start, end, output_dir)
                    results.append(result)
                    print(f"  -> Downloaded {result['rows']} rows to {result['path']}")

            except Exception as e:
                print(f"{period_name:<30} {symbol:<6} ERROR: {e}")

    print("-" * 75)
    print(f"{'TOTAL':<30} {'':6} {'':12} {'':12} ${total_cost:>7.2f}")
    print(f"\nBudget: $125.00 | Remaining: ${125.0 - total_cost:.2f}")

    if args.dry_run:
        print("\n[DRY RUN] No data was downloaded. Remove --dry-run to download.")
    else:
        print(f"\nDownloaded {len(results)} files to {output_dir}")

    print(f"\nNote: Post-2020 crisis periods already have data in S3:")
    for name, (start, end) in EXISTING_PERIODS.items():
        print(f"  {name}: {start} to {end}")


if __name__ == "__main__":
    main()
