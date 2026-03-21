"""Data loading layer: S3 consolidated Parquet → DuckDB → Polars.

Includes rollover-day detection utility (Task 7.1).

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

import hashlib
import os
import sys
import warnings
from pathlib import Path
from typing import Optional

import duckdb
import numpy as np
import polars as pl

from src.engine.config import DataQualityReport


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

def _consolidated_s3_path(symbol: str, timeframe: str, adjusted: bool = True) -> str:
    bucket = os.environ.get("S3_BUCKET", "trading-forge-data")
    # Consolidated files live directly under consolidated/ (no ratio_adj subfolder)
    return f"s3://{bucket}/futures/{symbol}/consolidated/{timeframe}.parquet"


def _legacy_s3_glob(symbol: str, timeframe: str, adjusted: bool = True) -> str:
    bucket = os.environ.get("S3_BUCKET", "trading-forge-data")
    prefix = "ratio_adj" if adjusted else "raw"
    return f"s3://{bucket}/futures/{symbol}/{prefix}/{timeframe}/*/*/*.parquet"


def _verify_ratio_adjusted_source(source: str, adjusted: bool) -> None:
    """Warn if the data source path does not contain ratio_adj when adjusted=True."""
    if adjusted and "ratio_adj" not in source and "consolidated" not in source:
        warnings.warn(
            f"Data source '{source}' does not appear to be ratio-adjusted. "
            f"Backtesting on unadjusted contracts creates fake signals at roll boundaries. "
            f"Set adjusted=False to suppress this warning if intentional."
        )


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


# ─── Comprehensive Data Quality Validation ───────────────────────

def compute_dataset_hash(df: pl.DataFrame) -> str:
    """Compute SHA-256 hash of OHLCV data for reproducibility tracking."""
    csv_bytes = (
        df.sort("ts_event")
        .select(["ts_event", "open", "high", "low", "close", "volume"])
        .to_pandas()
        .to_csv(index=False)
        .encode()
    )
    return hashlib.sha256(csv_bytes).hexdigest()


def validate_bars(df: pl.DataFrame, symbol: str = "", timeframe: str = "") -> DataQualityReport:
    """Run comprehensive data quality checks on OHLCV bars.

    Returns a DataQualityReport with counts of issues found.
    Sets passed=False if duplicate timestamps or OHLC violations exist.
    Prints warnings to stderr but never raises.
    """
    if df.is_empty():
        return DataQualityReport(total_bars=0)

    warn_list: list[str] = []
    total = len(df)

    # ── Duplicate timestamps ──
    dup_ts = df.filter(pl.col("ts_event").is_duplicated()).height
    if dup_ts > 0:
        warn_list.append(f"{dup_ts} duplicate timestamps found")

    # ── Duplicate OHLCV rows ──
    dup_rows = int(df.is_duplicated().sum())
    if dup_rows > 0:
        warn_list.append(f"{dup_rows} fully duplicate rows found")

    # ── OHLC sanity violations ──
    ohlc_violations = df.filter(
        (pl.col("high") < pl.col("low"))
        | (pl.col("close") < pl.col("low"))
        | (pl.col("close") > pl.col("high"))
        | (pl.col("open") < pl.col("low"))
        | (pl.col("open") > pl.col("high"))
        | (pl.col("volume") < 0)
    ).height
    if ohlc_violations > 0:
        warn_list.append(f"{ohlc_violations} OHLC sanity violations (high<low, close/open outside range, negative volume)")

    # ── Zero-volume bars ──
    zero_vol = df.filter(pl.col("volume") == 0).height
    if zero_vol > 0:
        warn_list.append(f"{zero_vol} zero-volume bars")

    # ── Session boundary check (intraday only) ──
    out_of_session = 0
    intraday_timeframes = {"1min", "5min", "15min", "30min", "1hour", "4hour"}
    if timeframe in intraday_timeframes and "ts_et" in df.columns:
        # CME Globex session: 18:00 (6 PM) to 17:00 (5 PM) ET next day
        # Out-of-session = hour 17 with minute > 0, or exactly between 17:01 and 17:59
        hours = df.select(pl.col("ts_et").dt.hour().alias("h")).to_series()
        # The only invalid window is 17:00-17:59 ET (CME maintenance)
        out_of_session = int((hours == 17).sum())
        if out_of_session > 0:
            warn_list.append(f"{out_of_session} bars outside CME Globex session (17:xx ET)")

    # ── Zero or negative prices (hard fail) ──
    zero_neg = df.filter(
        (pl.col("close") <= 0) | (pl.col("open") <= 0)
        | (pl.col("high") <= 0) | (pl.col("low") <= 0)
    ).height
    if zero_neg > 0:
        warn_list.append(f"{zero_neg} bars with zero or negative prices")

    # ── Large gap detection (reuse 5% threshold) ──
    large_gap_bars = 0
    close = df["close"].to_numpy()
    if len(close) > 1:
        pct_changes = np.abs(np.diff(close) / close[:-1])
        large_gap_bars = int(np.sum(pct_changes > 0.05))
        if large_gap_bars > 0:
            warn_list.append(f"{large_gap_bars} bars with >5% single-bar move")
        # Roll gap detection: single-bar return > 15% likely unadjusted
        roll_gaps = int(np.sum(pct_changes > 0.15))
        if roll_gaps > 0:
            warn_list.append(f"{roll_gaps} bars with >15% single-bar move (likely unadjusted roll gap)")

    # ── Coverage / gap detection ──
    coverage_pct = 100.0
    bars_per_day_map = {
        "1min": 390, "5min": 78, "15min": 26, "30min": 13,
        "1hour": 7, "1h": 7, "4hour": 2, "4h": 2, "daily": 1, "1D": 1,
    }
    if timeframe in bars_per_day_map and "ts_event" in df.columns:
        ts_series = df["ts_event"]
        try:
            first_date = ts_series[0]
            last_date = ts_series[-1]
            if hasattr(first_date, "date"):
                calendar_days = (last_date.date() - first_date.date()).days
            else:
                calendar_days = (last_date - first_date).days
            if calendar_days > 0:
                trading_days = int(calendar_days * 252 / 365)
                expected_bars = trading_days * bars_per_day_map[timeframe]
                if expected_bars > 0:
                    coverage_pct = round(total / expected_bars * 100, 1)
                    if coverage_pct < 80:
                        warn_list.append(
                            f"Data coverage {coverage_pct:.1f}% ({total}/{expected_bars} expected bars) — below 80% threshold"
                        )
        except Exception:
            pass

    # ── Determine pass/fail ──
    passed = (dup_ts == 0) and (ohlc_violations == 0) and (zero_neg == 0) and (coverage_pct >= 80)

    return DataQualityReport(
        total_bars=total,
        duplicate_timestamps=dup_ts,
        duplicate_ohlcv_rows=dup_rows,
        ohlc_violations=ohlc_violations,
        zero_volume_bars=zero_vol,
        out_of_session_bars=out_of_session,
        large_gap_bars=large_gap_bars,
        coverage_pct=coverage_pct,
        zero_negative_prices=zero_neg,
        dataset_hash="",
        warnings=warn_list,
        passed=passed,
    )


# ─── Main Loader ──────────────────────────────────────────────────

def load_ohlcv(
    symbol: str,
    timeframe: str,
    start: str,
    end: str,
    local_path: Optional[str] = None,
    adjusted: bool = True,
) -> pl.DataFrame:
    """Load OHLCV data as a Polars DataFrame.

    Priority: local_path → local cache → S3 consolidated → S3 legacy daily files.

    Args:
        symbol: Futures symbol (ES, NQ, CL, etc.)
        timeframe: Bar timeframe (1min, 5min, 15min, 30min, 1hour, 4hour, daily)
        start: Start date YYYY-MM-DD
        end: End date YYYY-MM-DD
        local_path: If provided, load from this specific Parquet file
        adjusted: If True (default), load from ratio-adjusted path. If False,
            load raw unadjusted data (with a warning).

    Returns:
        Polars DataFrame with columns: ts_event, open, high, low, close, volume
    """
    # Map micro symbols to full-size equivalents for S3 data paths.
    # MES/MNQ/MCL/MGC use the same price data as ES/NQ/CL/GC — just 1/10th multiplier.
    # S3 stores data under the full-size symbol only.
    MICRO_TO_FULL = {"MES": "ES", "MNQ": "NQ", "MCL": "CL", "MGC": "GC"}
    data_symbol = MICRO_TO_FULL.get(symbol, symbol)

    if not adjusted:
        warnings.warn(
            f"Loading UNADJUSTED data for {data_symbol} {timeframe}. "
            f"Backtesting on raw contracts creates fake signals at roll boundaries. "
            f"Use adjusted=True (default) for backtesting."
        )

    con = _get_connection()

    # Determine source (use data_symbol for paths — micro symbols share full-size data)
    if local_path:
        source = local_path
        print(f"Loading {data_symbol} {timeframe} from local path", file=sys.stderr)
        # Verify local path looks like ratio-adjusted data
        _verify_ratio_adjusted_source(source, adjusted)
    else:
        cache_file = _cache_path(data_symbol, timeframe)
        if cache_file.exists():
            source = str(cache_file)
            print(f"Loading {data_symbol} {timeframe} from local cache", file=sys.stderr)
        else:
            # Read directly from S3 consolidated file (single HTTP request)
            source = _consolidated_s3_path(data_symbol, timeframe, adjusted=adjusted)
            print(f"Loading {data_symbol} {timeframe} from S3 consolidated", file=sys.stderr)

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
            legacy = _legacy_s3_glob(data_symbol, timeframe, adjusted=adjusted)
            print(f"Falling back to legacy daily files for {data_symbol} {timeframe}", file=sys.stderr)
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

    # ─── Deduplicate timestamps (keep last occurrence) ──────────
    pre_dedup = len(df)
    df = df.unique(subset=["ts_event"], keep="last").sort("ts_event")
    deduped = pre_dedup - len(df)
    if deduped > 0:
        print(
            f"DATA QUALITY [{symbol} {timeframe}]: Removed {deduped} duplicate timestamps (kept last)",
            file=sys.stderr,
        )

    # ─── Validate data quality (ratio-adjusted check) ────────────
    _validate_data_quality(df, symbol, timeframe)

    # ─── Comprehensive data quality validation ───────────────
    quality_report = validate_bars(df, symbol, timeframe)
    if quality_report.warnings:
        for w in quality_report.warnings:
            print(f"DATA QUALITY [{symbol} {timeframe}]: {w}", file=sys.stderr)

    # ─── Hard fail on critical data issues ────────────────────
    if not quality_report.passed:
        issues = [w for w in quality_report.warnings if "OHLC" in w or "duplicate" in w]
        raise ValueError(
            f"DATA QUALITY GATE FAILED for {symbol} {timeframe}: {'; '.join(issues) or 'critical violations detected'}"
        )

    return df


# ─── Rollover Day Detection (Task 7.1) ──────────────────────────────

# Delivery months per symbol. Equity index futures roll quarterly;
# crude oil rolls every month.
ROLLOVER_MONTHS: dict[str, list[int]] = {
    "ES": [3, 6, 9, 12],
    "MES": [3, 6, 9, 12],
    "NQ": [3, 6, 9, 12],
    "MNQ": [3, 6, 9, 12],
    "YM": [3, 6, 9, 12],
    "RTY": [3, 6, 9, 12],
    "CL": list(range(1, 13)),
    "MCL": list(range(1, 13)),  # Micro Crude follows same roll schedule as CL
    "GC": [2, 4, 6, 8, 10, 12],
    "MGC": [2, 4, 6, 8, 10, 12],  # Micro Gold follows same roll schedule as GC
}


def _third_friday(year: int, month: int) -> int:
    """Return day-of-month of the 3rd Friday for the given year/month."""
    from datetime import date
    # First day of the month
    first = date(year, month, 1)
    # Weekday: Monday=0 ... Friday=4
    first_friday = 1 + (4 - first.weekday()) % 7
    third_friday = first_friday + 14
    return third_friday


def _second_thursday_before_third_friday(year: int, month: int) -> "date":
    """Standard CME equity index rollover: 2nd Thursday before 3rd Friday of delivery month.

    This is typically 8 days before the 3rd Friday (the Thursday of the prior week).
    """
    from datetime import date, timedelta
    tf_day = _third_friday(year, month)
    third_friday_date = date(year, month, tf_day)
    # Go back to the Thursday of the previous week (8 days before Friday)
    rollover = third_friday_date - timedelta(days=8)
    return rollover


def compute_rollover_dates(
    symbol: str,
    start_year: int,
    end_year: int,
) -> list["date"]:
    """Compute standard rollover dates for a futures symbol across a year range.

    Uses CME convention: 2nd Thursday before 3rd Friday of each delivery month.

    Args:
        symbol: Futures symbol (ES, NQ, CL, etc.)
        start_year: First year (inclusive)
        end_year: Last year (inclusive)

    Returns:
        Sorted list of datetime.date objects representing rollover days
    """
    from datetime import date
    months = ROLLOVER_MONTHS.get(symbol, [3, 6, 9, 12])
    dates_list: list[date] = []
    for year in range(start_year, end_year + 1):
        for month in months:
            rollover = _second_thursday_before_third_friday(year, month)
            dates_list.append(rollover)
    return sorted(dates_list)


def flag_rollover_days(
    df: pl.DataFrame,
    symbol: str,
) -> pl.DataFrame:
    """Add a boolean 'is_rollover_day' column to the DataFrame.

    Bars on rollover days are flagged True. The backtester can use this
    to suppress new entries on rollover days (volume spikes, spread
    widening, and price gaps around the roll make signals unreliable).

    Args:
        df: OHLCV DataFrame with 'ts_event' column
        symbol: Futures symbol

    Returns:
        DataFrame with 'is_rollover_day' boolean column added
    """
    from datetime import date

    if "ts_event" not in df.columns:
        return df.with_columns(pl.lit(False).alias("is_rollover_day"))

    # Extract year range from data
    ts = df["ts_event"]
    if ts.dtype == pl.Utf8:
        # String dates — parse year from first/last
        first_year = int(str(ts[0])[:4])
        last_year = int(str(ts[-1])[:4])
    else:
        first_year = ts.dt.year().min()
        last_year = ts.dt.year().max()

    rollover_dates = compute_rollover_dates(symbol, first_year, last_year)
    rollover_strs = {d.isoformat() for d in rollover_dates}

    # Extract calendar date from each bar's timestamp
    if ts.dtype == pl.Utf8:
        date_col = pl.col("ts_event").str.slice(0, 10)
    else:
        ts_col_name = "ts_et" if "ts_et" in df.columns else "ts_event"
        date_col = pl.col(ts_col_name).dt.date().cast(pl.Utf8)

    df = df.with_columns(
        date_col.is_in(list(rollover_strs)).alias("is_rollover_day")
    )

    rollover_count = df["is_rollover_day"].sum()
    if rollover_count > 0:
        print(
            f"Flagged {rollover_count} bars on {len(rollover_dates)} rollover days for {symbol}",
            file=sys.stderr,
        )

    return df
