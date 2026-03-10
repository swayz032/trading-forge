"""
S3 Upload Pipeline

Reads a big Parquet file, partitions by date, and uploads each day
as a separate file to S3 following the convention:
    futures/{SYMBOL}/{KIND}/{TIMEFRAME}/YYYY/MM/DD.parquet

Usage:
    python upload_to_s3.py --input data.parquet --symbol ES --kind ratio_adj --timeframe 1min
"""

import argparse
import json
import os
import sys
from pathlib import Path

import boto3
import polars as pl


def get_s3_client():
    return boto3.client(
        "s3",
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
    )


def upload_partitioned(
    df: pl.DataFrame,
    symbol: str,
    kind: str,
    timeframe: str,
    bucket: str,
    s3_client=None,
    ts_col: str = "ts_event",
) -> dict:
    """Partition df by date and upload each day as a separate Parquet file."""
    if s3_client is None:
        s3_client = get_s3_client()

    # Add date column for partitioning
    df = df.with_columns(pl.col(ts_col).cast(pl.Date).alias("_date"))

    dates = df["_date"].unique().sort()
    uploaded = 0
    errors = []

    for date_val in dates:
        day_df = df.filter(pl.col("_date") == date_val).drop("_date")
        date_str = str(date_val)  # YYYY-MM-DD
        year, month, day = date_str.split("-")

        key = f"futures/{symbol}/{kind}/{timeframe}/{year}/{month}/{day}.parquet"

        # Write to bytes buffer
        buf = day_df.write_parquet(None)

        try:
            s3_client.put_object(Bucket=bucket, Key=key, Body=buf)
            uploaded += 1
        except Exception as e:
            errors.append({"key": key, "error": str(e)})

    return {
        "status": "ok" if not errors else "partial",
        "symbol": symbol,
        "kind": kind,
        "timeframe": timeframe,
        "total_dates": len(dates),
        "uploaded": uploaded,
        "errors": errors,
    }


def upload_json(data: dict | list, key: str, bucket: str, s3_client=None) -> None:
    """Upload a JSON file to S3."""
    if s3_client is None:
        s3_client = get_s3_client()
    body = json.dumps(data, indent=2).encode("utf-8")
    s3_client.put_object(Bucket=bucket, Key=key, Body=body, ContentType="application/json")


def main():
    parser = argparse.ArgumentParser(description="Upload partitioned Parquet to S3")
    parser.add_argument("--input", required=True, help="Input Parquet file")
    parser.add_argument("--symbol", required=True, help="Symbol (ES, NQ, CL)")
    parser.add_argument("--kind", required=True, choices=["raw", "ratio_adj", "panama_adj"])
    parser.add_argument("--timeframe", default="1min", help="Timeframe label")
    parser.add_argument("--bucket", default=None, help="S3 bucket name")
    parser.add_argument("--roll-calendar", default=None, help="Roll calendar JSON to upload")
    args = parser.parse_args()

    bucket = args.bucket or os.environ.get("S3_BUCKET", "trading-forge-data")
    df = pl.read_parquet(args.input)
    s3 = get_s3_client()

    result = upload_partitioned(df, args.symbol, args.kind, args.timeframe, bucket, s3)

    # Upload roll calendar if provided
    if args.roll_calendar:
        cal_path = Path(args.roll_calendar)
        if cal_path.exists():
            with open(cal_path) as f:
                cal_data = json.load(f)
            year = str(df["ts_event"].min()).split("-")[0]
            cal_key = f"futures/{args.symbol}/roll_calendar/{year}.json"
            upload_json(cal_data, cal_key, bucket, s3)
            result["roll_calendar_key"] = cal_key

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
