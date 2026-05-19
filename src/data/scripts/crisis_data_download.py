"""
Crisis Period Data Downloader + Pipeline

Downloads targeted date ranges for historical crisis scenarios from Databento,
then runs the full pipeline: adjust → resample (all timeframes) → upload to S3.

GLBX.MDP3 starts 2010-06-06, so 2008/2010 crises are unavailable.

Usage:
    python crisis_data_download.py --symbols ES,NQ,CL --dry-run
    python crisis_data_download.py --symbols ES,NQ,CL --output-dir ./data/raw/crisis
    python crisis_data_download.py --symbols ES,NQ,CL --skip-s3   # download + adjust only
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

# Downloadable crisis periods (GLBX.MDP3 starts 2010-06-06)
CRISIS_PERIODS = {
    "2015_china_devaluation": ("2015-08-01", "2015-09-30"),
    "2018_volmageddon": ("2018-01-15", "2018-03-31"),
}

# Periods NOT available on Databento (pre-2010-06-06)
# Stress tests use synthetic degradation for these
UNAVAILABLE_PERIODS = {
    "2008_financial_crisis": ("2008-09-01", "2008-12-31"),
    "2010_flash_crash": ("2010-04-15", "2010-06-15"),
}

# Post-2020 periods — data already available in S3
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
}

DATASET = "GLBX.MDP3"
SCRIPTS_DIR = Path(__file__).parent


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

    file_size_mb = out_path.stat().st_size / (1024 * 1024)

    return {
        "symbol": symbol,
        "start": start,
        "end": end,
        "path": str(out_path),
        "file_size_mb": round(file_size_mb, 2),
    }


def run_pipeline_step(script_name: str, args: list[str], label: str) -> dict:
    """Run a pipeline script and return its JSON output."""
    script_path = SCRIPTS_DIR / script_name
    cmd = [sys.executable, str(script_path)] + args

    print(f"  [{label}] {' '.join(cmd)}", file=sys.stderr)

    proc = subprocess.run(cmd, capture_output=True, text=True, env=os.environ)

    if proc.returncode != 0:
        print(f"  FAILED: {proc.stderr[:200]}", file=sys.stderr)
        return {"status": "error", "message": proc.stderr[:500], "step": label}

    try:
        result = json.loads(proc.stdout.strip())
        return result
    except json.JSONDecodeError:
        return {"status": "error", "message": f"Bad JSON: {proc.stdout[:200]}", "step": label}


def process_file(raw_path: str, symbol: str, bucket: str, adj_dir: Path) -> list[dict]:
    """Run adjust → upload raw → upload adjusted → resample for a downloaded file."""
    steps = []

    # Step 1: Adjust continuous contracts (ratio + panama)
    adj_result = run_pipeline_step("adjust_continuous.py", [
        "--input", raw_path,
        "--output-dir", str(adj_dir),
        "--symbol", symbol,
        "--method", "both",
    ], f"Adjust {symbol}")
    steps.append(adj_result)

    if adj_result.get("status") == "error":
        return steps

    # Step 2: Upload raw 1min to S3
    upload_raw = run_pipeline_step("upload_to_s3.py", [
        "--input", raw_path,
        "--symbol", symbol,
        "--kind", "raw",
        "--timeframe", "1min",
        "--bucket", bucket,
    ], f"Upload raw 1min {symbol}")
    steps.append(upload_raw)

    # Step 3: Upload ratio_adj 1min + resample all timeframes
    ratio_adj_path = None
    roll_calendar_path = adj_result.get("roll_calendar")
    for output in adj_result.get("outputs", []):
        if output["method"] == "ratio":
            ratio_adj_path = output["path"]

    if ratio_adj_path:
        upload_adj_args = [
            "--input", ratio_adj_path,
            "--symbol", symbol,
            "--kind", "ratio_adj",
            "--timeframe", "1min",
            "--bucket", bucket,
        ]
        if roll_calendar_path:
            upload_adj_args += ["--roll-calendar", roll_calendar_path]

        upload_adj = run_pipeline_step("upload_to_s3.py",
            upload_adj_args, f"Upload ratio_adj 1min {symbol}")
        steps.append(upload_adj)

        # Step 4: Resample to 5min, 15min, 30min, 1hr, 4hr, daily + upload
        resample = run_pipeline_step("resample_timeframes.py", [
            "--input", ratio_adj_path,
            "--symbol", symbol,
            "--kind", "ratio_adj",
            "--bucket", bucket,
        ], f"Resample all TFs {symbol}")
        steps.append(resample)

    return steps


def main():
    parser = argparse.ArgumentParser(description="Crisis Period Data Downloader + Pipeline")
    parser.add_argument("--symbols", default="ES,NQ,CL", help="Comma-separated symbols")
    parser.add_argument("--output-dir", default="./data/raw/crisis", help="Output directory")
    parser.add_argument("--dry-run", action="store_true", help="Check costs without downloading")
    parser.add_argument("--skip-s3", action="store_true", help="Download + adjust only, skip S3 upload")
    parser.add_argument("--bucket", default=None, help="S3 bucket name")
    args = parser.parse_args()

    symbols = [s.strip().upper() for s in args.symbols.split(",")]
    output_dir = Path(args.output_dir)
    adj_dir = output_dir.parent / "adjusted" / "crisis"
    bucket = args.bucket or os.environ.get("S3_BUCKET", "trading-forge-data")

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
                    print(f"  -> Downloaded {result['file_size_mb']}MB to {result['path']}")

                    if not args.skip_s3:
                        pipeline_steps = process_file(
                            result["path"], symbol, bucket, adj_dir
                        )
                        result["pipeline"] = pipeline_steps
                        ok = all(s.get("status") != "error" for s in pipeline_steps)
                        print(f"  -> Pipeline: {'OK' if ok else 'ERRORS'} "
                              f"(adjust + upload raw/adj + resample 6 TFs)")

            except Exception as e:
                print(f"{period_name:<30} {symbol:<6} ERROR: {e}")

    print("-" * 75)
    print(f"{'TOTAL':<30} {'':6} {'':12} {'':12} ${total_cost:>7.2f}")
    print(f"\nBudget: $125.00 | Remaining: ${125.0 - total_cost:.2f}")

    if args.dry_run:
        print("\n[DRY RUN] No data was downloaded. Remove --dry-run to download.")
    else:
        print(f"\nDownloaded {len(results)} files to {output_dir}")
        if not args.skip_s3:
            print(f"Pipeline: adjust → upload raw/adj 1min → resample (5m,15m,30m,1h,4h,daily) → S3")

    print(f"\nPost-2020 crisis periods (already in S3):")
    for name, (start, end) in EXISTING_PERIODS.items():
        print(f"  {name}: {start} to {end}")

    print(f"\nUnavailable on Databento (pre-2010-06-06, stress tests use synthetic degradation):")
    for name, (start, end) in UNAVAILABLE_PERIODS.items():
        print(f"  {name}: {start} to {end}")


if __name__ == "__main__":
    main()
