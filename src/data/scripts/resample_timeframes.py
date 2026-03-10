"""
Timeframe Resampler

Resamples 1-minute OHLCV data to higher timeframes (5min, 15min, 1hour, daily)
and uploads each to S3.

Usage:
    python resample_timeframes.py --input data.parquet --symbol ES --kind ratio_adj
"""

import argparse
import json
import os
import sys

import polars as pl

from upload_to_s3 import upload_partitioned, get_s3_client

TIMEFRAMES = {
    "5min": "5m",
    "15min": "15m",
    "1hour": "1h",
    "daily": "1d",
}


def resample(df: pl.DataFrame, every: str, ts_col: str = "ts_event") -> pl.DataFrame:
    """Resample OHLCV data using Polars group_by_dynamic."""
    return (
        df.sort(ts_col)
        .group_by_dynamic(ts_col, every=every)
        .agg(
            pl.col("open").first(),
            pl.col("high").max(),
            pl.col("low").min(),
            pl.col("close").last(),
            pl.col("volume").sum(),
        )
        .filter(pl.col("volume") > 0)
    )


def main():
    parser = argparse.ArgumentParser(description="Resample 1min data to higher timeframes")
    parser.add_argument("--input", required=True, help="Input 1min Parquet file")
    parser.add_argument("--symbol", required=True, help="Symbol (ES, NQ, CL)")
    parser.add_argument("--kind", required=True, choices=["raw", "ratio_adj", "panama_adj"])
    parser.add_argument("--bucket", default=None, help="S3 bucket name")
    parser.add_argument(
        "--timeframes",
        nargs="+",
        default=list(TIMEFRAMES.keys()),
        help="Timeframes to generate",
    )
    args = parser.parse_args()

    bucket = args.bucket or os.environ.get("S3_BUCKET", "trading-forge-data")
    df = pl.read_parquet(args.input)

    # Ensure ts_event is datetime
    if df["ts_event"].dtype != pl.Datetime:
        df = df.with_columns(pl.col("ts_event").cast(pl.Datetime("us")))

    s3 = get_s3_client()
    results = []

    for tf_name in args.timeframes:
        if tf_name not in TIMEFRAMES:
            continue

        every = TIMEFRAMES[tf_name]
        resampled = resample(df, every)

        result = upload_partitioned(
            resampled, args.symbol, args.kind, tf_name, bucket, s3
        )
        result["rows"] = resampled.height
        results.append(result)

    print(json.dumps({"status": "ok", "timeframes": results}, indent=2))


if __name__ == "__main__":
    main()
