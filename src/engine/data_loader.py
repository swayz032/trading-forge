"""Data loading layer: S3 consolidated Parquet → DuckDB → Polars.

Production-grade:
- Reads from consolidated single Parquet files on S3 (1 file per symbol/timeframe)
- Singleton DuckDB connection — configure S3 once, reuse across all backtests
- Falls back to daily files if consolidated doesn't exist
- Optional local cache for offline/fastest access

Path convention:
  Consolidated: s3://{bucket}/futures/{symbol}/consolidated/{timeframe}.parquet
  Legacy daily:  s3://{bucket}/futures/{symbol}/ratio_adj/{timeframe}/{year}/{month}/{day}.parquet
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Optional

import duckdb
import numpy as np
import polars as pl


# ─── Singleton DuckDB Connection ──────────────────────────────────

_con: Optional[duckdb.DuckDBPyConnection] = None
_s3_configured: bool = False


def _get_connection() -> duckdb.DuckDBPyConnection:
    """Get or create singleton DuckDB connection with S3 configured."""
    global _con, _s3_configured

    if _con is None:
        _con = duckdb.connect(":memory:")
        _s3_configured = False

    if not _s3_configured:
        _con.execute("INSTALL httpfs; LOAD httpfs;")
        region = os.environ.get("AWS_REGION", "us-east-1")
        access_key = os.environ.get("AWS_ACCESS_KEY_ID", "")
        secret_key = os.environ.get("AWS_SECRET_ACCESS_KEY", "")
        _con.execute(f"""
            SET s3_region='{region}';
            SET s3_access_key_id='{access_key}';
            SET s3_secret_access_key='{secret_key}';
            SET enable_object_cache=true;
        """)
        _s3_configured = True

    return _con


# ─── Local Cache ──────────────────────────────────────────────────

CACHE_DIR = Path(os.environ.get(
    "DATA_CACHE_DIR",
    Path(__file__).resolve().parent.parent.parent / "data_cache",
))


def _cache_path(symbol: str, timeframe: str) -> Path:
    return CACHE_DIR / symbol / f"{timeframe}.parquet"


# ─── S3 Paths ────────────────────────────────────────────────────

def _consolidated_s3_path(symbol: str, timeframe: str) -> str:
    bucket = os.environ.get("S3_BUCKET", "trading-forge-data")
    return f"s3://{bucket}/futures/{symbol}/consolidated/{timeframe}.parquet"


def _legacy_s3_glob(symbol: str, timeframe: str) -> str:
    bucket = os.environ.get("S3_BUCKET", "trading-forge-data")
    return f"s3://{bucket}/futures/{symbol}/ratio_adj/{timeframe}/*/*/*.parquet"


# ─── Sync ─────────────────────────────────────────────────────────

def sync_from_s3(symbol: str, timeframe: str) -> Path:
    """Download consolidated data from S3 to local cache."""
    cache_file = _cache_path(symbol, timeframe)
    cache_file.parent.mkdir(parents=True, exist_ok=True)

    print(f"Syncing {symbol} {timeframe} from S3 → local cache...", file=sys.stderr)

    con = _get_connection()
    s3_path = _consolidated_s3_path(symbol, timeframe)

    con.execute(f"""
        COPY (
            SELECT ts_event, open, high, low, close, volume
            FROM read_parquet('{s3_path}')
            ORDER BY ts_event
        ) TO '{cache_file}' (FORMAT PARQUET, COMPRESSION ZSTD)
    """)

    size_kb = cache_file.stat().st_size / 1024
    print(f"Cached to {cache_file} ({size_kb:.0f} KB)", file=sys.stderr)
    return cache_file


# ─── Data Quality Validation ─────────────────────────────────────

def _validate_data_quality(df: pl.DataFrame, symbol: str, timeframe: str) -> None:
    """Validate loaded data quality — check for roll gaps and basic sanity."""
    if df.is_empty():
        return

    close = df["close"].to_numpy()
    # Check for large day-over-day gaps that suggest unadjusted contracts
    if len(close) > 1:
        pct_changes = np.abs(np.diff(close) / close[:-1])
        max_gap = float(np.nanmax(pct_changes))
        # Ratio-adjusted contracts should NOT have >5% single-bar moves
        # (even flash crashes rarely exceed this on adjusted data)
        if max_gap > 0.05:
            print(
                f"WARNING: {symbol} {timeframe} has {max_gap:.1%} max single-bar move. "
                f"Possible unadjusted contract data or roll gap.",
                file=sys.stderr,
            )


# ─── Main Loader ──────────────────────────────────────────────────

def load_ohlcv(
    symbol: str,
    timeframe: str,
    start: str,
    end: str,
    local_path: Optional[str] = None,
) -> pl.DataFrame:
    """Load OHLCV data as a Polars DataFrame.

    Priority: local_path → local cache → S3 consolidated → S3 legacy daily files.

    Args:
        symbol: Futures symbol (ES, NQ, CL, etc.)
        timeframe: Bar timeframe (1min, 5min, 15min, 30min, 1hour, 4hour, daily)
        start: Start date YYYY-MM-DD
        end: End date YYYY-MM-DD
        local_path: If provided, load from this specific Parquet file

    Returns:
        Polars DataFrame with columns: ts_event, open, high, low, close, volume
    """
    con = _get_connection()

    # Determine source
    if local_path:
        source = local_path
        print(f"Loading {symbol} {timeframe} from local path", file=sys.stderr)
    else:
        cache_file = _cache_path(symbol, timeframe)
        if cache_file.exists():
            source = str(cache_file)
            print(f"Loading {symbol} {timeframe} from local cache", file=sys.stderr)
        else:
            # Read directly from S3 consolidated file (single HTTP request)
            source = _consolidated_s3_path(symbol, timeframe)
            print(f"Loading {symbol} {timeframe} from S3 consolidated", file=sys.stderr)

    sql = f"""
        SELECT ts_event, open, high, low, close, volume
        FROM read_parquet('{source}')
        WHERE ts_event >= '{start}' AND ts_event <= '{end}'
        ORDER BY ts_event
    """

    try:
        pdf = con.execute(sql).fetchdf()
    except Exception:
        # Fallback to legacy daily files if consolidated doesn't exist
        if not local_path and not str(source).startswith(str(CACHE_DIR)):
            legacy = _legacy_s3_glob(symbol, timeframe)
            print(f"Falling back to legacy daily files for {symbol} {timeframe}", file=sys.stderr)
            legacy_sql = f"""
                SELECT ts_event, open, high, low, close, volume
                FROM read_parquet('{legacy}')
                WHERE ts_event >= '{start}' AND ts_event <= '{end}'
                ORDER BY ts_event
            """
            pdf = con.execute(legacy_sql).fetchdf()
        else:
            raise

    df = pl.from_pandas(pdf)

    if df.is_empty():
        raise ValueError(
            f"No data found for {symbol} {timeframe} between {start} and {end}"
        )

    # Auto-cache: write to local cache after S3 fetch so re-runs are instant
    if not local_path:
        cache_file = _cache_path(symbol, timeframe)
        if not cache_file.exists():
            try:
                cache_file.parent.mkdir(parents=True, exist_ok=True)
                # Cache the FULL dataset (no date filter) for future use
                # But we only have the filtered slice — cache what we got
                df.write_parquet(str(cache_file), compression="zstd")
                size_kb = cache_file.stat().st_size / 1024
                print(f"Auto-cached {symbol} {timeframe} → {cache_file} ({size_kb:.0f} KB)", file=sys.stderr)
            except Exception as e:
                print(f"Auto-cache failed (non-fatal): {e}", file=sys.stderr)

    # ─── Convert UTC timestamps to ET for session logic ──────────
    # Databento data arrives with ts_event in UTC. All session filtering
    # (killzones, RTH/ETH, event windows) must happen in ET.
    # Keep ts_event (UTC) for storage/alignment. Add ts_et as a NEW column.
    if "ts_event" in df.columns:
        ts_dtype = df["ts_event"].dtype
        if hasattr(ts_dtype, "time_zone") and ts_dtype.time_zone in ("UTC", None):
            df = df.with_columns(
                pl.col("ts_event")
                .dt.convert_time_zone("America/New_York")
                .alias("ts_et")
            )
        elif str(ts_dtype).startswith("Datetime"):
            # Assume UTC if no timezone info (Databento convention)
            df = df.with_columns(
                pl.col("ts_event")
                .cast(pl.Datetime("ns", "UTC"))
                .dt.convert_time_zone("America/New_York")
                .alias("ts_et")
            )

    # ─── Validate data quality (ratio-adjusted check) ────────────
    _validate_data_quality(df, symbol, timeframe)

    return df
