"""Data loading layer: DuckDB → Polars.

Mirrors S3 path convention from src/data/loaders/duckdb-service.ts.
ALWAYS uses ratio_adj path, never raw.
"""

from __future__ import annotations

import os
from typing import Optional

import duckdb
import polars as pl


def build_s3_glob(
    symbol: str,
    timeframe: str,
    start: str,
    end: str,
    bucket: Optional[str] = None,
) -> str:
    """Build S3 glob path matching duckdb-service.ts convention.

    Path pattern: s3://{bucket}/futures/{symbol}/ratio_adj/{timeframe}/{year}/{month}/*.parquet
    """
    if bucket is None:
        bucket = os.environ.get("S3_BUCKET", "trading-forge-data")

    from_year, from_month = start.split("-")[:2]
    to_year, to_month = end.split("-")[:2]

    same_year = from_year == to_year
    same_month = same_year and from_month == to_month

    if same_month:
        glob = f"futures/{symbol}/ratio_adj/{timeframe}/{from_year}/{from_month}/*.parquet"
    elif same_year:
        glob = f"futures/{symbol}/ratio_adj/{timeframe}/{from_year}/*/*.parquet"
    else:
        glob = f"futures/{symbol}/ratio_adj/{timeframe}/*/*/*.parquet"

    return f"s3://{bucket}/{glob}"


def _configure_duckdb_s3(con: duckdb.DuckDBPyConnection) -> None:
    """Configure DuckDB httpfs for S3 access, matching duckdb-service.ts."""
    con.execute("INSTALL httpfs; LOAD httpfs;")
    region = os.environ.get("AWS_REGION", "us-east-1")
    access_key = os.environ.get("AWS_ACCESS_KEY_ID", "")
    secret_key = os.environ.get("AWS_SECRET_ACCESS_KEY", "")
    con.execute(f"""
        SET s3_region='{region}';
        SET s3_access_key_id='{access_key}';
        SET s3_secret_access_key='{secret_key}';
    """)


def load_ohlcv(
    symbol: str,
    timeframe: str,
    start: str,
    end: str,
    local_path: Optional[str] = None,
) -> pl.DataFrame:
    """Load OHLCV data as a Polars DataFrame.

    Args:
        symbol: Futures symbol (ES, NQ, CL, etc.)
        timeframe: Bar timeframe (1min, 5min, daily, etc.)
        start: Start date YYYY-MM-DD
        end: End date YYYY-MM-DD
        local_path: If provided, load from local Parquet instead of S3

    Returns:
        Polars DataFrame with columns: ts_event, open, high, low, close, volume
    """
    con = duckdb.connect(":memory:")

    if local_path:
        source = local_path
    else:
        _configure_duckdb_s3(con)
        source = build_s3_glob(symbol, timeframe, start, end)

    sql = f"""
        SELECT ts_event, open, high, low, close, volume
        FROM read_parquet('{source}')
        WHERE ts_event >= '{start}' AND ts_event <= '{end}'
        ORDER BY ts_event
    """

    pdf = con.execute(sql).fetchdf()
    con.close()

    # Convert Pandas → Polars (DuckDB returns Pandas)
    df = pl.from_pandas(pdf)

    if df.is_empty():
        raise ValueError(
            f"No data found for {symbol} {timeframe} between {start} and {end}"
        )

    return df
