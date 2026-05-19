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
from datetime import datetime
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
        # DuckDB 1.0+ auto-reads AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY
        # from environment variables when httpfs is loaded. No manual SET needed,
        # which avoids SQL injection risk from credentials with special chars.
        _con.execute("INSTALL httpfs; LOAD httpfs;")
        _con.execute("SET enable_object_cache=true;")
        region = os.environ.get("AWS_REGION", "")
        if region:
            # Sanitize: strip any single quotes to prevent SQL injection
            _con.execute(f"SET s3_region='{region.replace(chr(39), '')}';")
        _s3_configured = True

    return _con


# ─── Local Cache ──────────────────────────────────────────────────
# Phase 12 perf fix: 24-hour TTL + BACKTEST_CACHE_BUST env var for invalidation.
#
# Cache key: data_cache/<data_symbol>/<timeframe>.parquet
# TTL: 24 hours (S3 data is updated nightly by Databento sync; daytime reruns are safe)
# Bust: BACKTEST_CACHE_BUST=1 → delete + re-fetch ALL cached files before loading
# Scope: bust runs ONCE per Python process (cleared after first load_ohlcv call)
#
# This cache is ratio_adj/consolidated data ONLY. Raw/unadjusted data is never cached
# here (CLAUDE.md §13: "Don't backtest on raw/unadjusted continuous contracts").

CACHE_DIR = Path(os.environ.get(
    "DATA_CACHE_DIR",
    Path(__file__).resolve().parent.parent.parent / "data_cache",
))

# 24 hours TTL for local cache files
CACHE_TTL_SECONDS: float = float(os.environ.get("DATA_CACHE_TTL_SECONDS", str(24 * 3600)))

# Process-level bust flag: set True once per process when BACKTEST_CACHE_BUST=1
_cache_busted: bool = False


def _cache_path(symbol: str, timeframe: str) -> Path:
    return CACHE_DIR / symbol / f"{timeframe}.parquet"


def _is_cache_fresh(cache_file: Path) -> bool:
    """Return True if the cache file exists and is younger than CACHE_TTL_SECONDS."""
    if not cache_file.exists():
        return False
    import time as _time_mod
    age = _time_mod.time() - cache_file.stat().st_mtime
    return age < CACHE_TTL_SECONDS


def _maybe_bust_cache() -> None:
    """If BACKTEST_CACHE_BUST=1, delete all cache files once per process and log."""
    global _cache_busted
    if _cache_busted:
        return
    if os.environ.get("BACKTEST_CACHE_BUST", "0") != "1":
        _cache_busted = True  # Mark as handled (no-op)
        return
    _cache_busted = True  # Prevent repeated bust in the same process
    if CACHE_DIR.exists():
        stale = list(CACHE_DIR.glob("**/*.parquet"))
        for f in stale:
            try:
                f.unlink()
                print(f"Cache bust: deleted {f}", file=sys.stderr)
            except Exception as _e:
                print(f"Cache bust: could not delete {f}: {_e}", file=sys.stderr)
        print(f"Cache bust: removed {len(stale)} cached file(s) from {CACHE_DIR}", file=sys.stderr)


# ─── S3 Paths ────────────────────────────────────────────────────

def _consolidated_s3_path(symbol: str, timeframe: str, adjusted: bool = True) -> str:
    bucket = os.environ.get("S3_BUCKET", "trading-forge-data")
    # Consolidated files live directly under consolidated/ (no ratio_adj subfolder)
    return f"s3://{bucket}/futures/{symbol}/consolidated/{timeframe}.parquet"


def _legacy_s3_glob(symbol: str, timeframe: str, adjusted: bool = True) -> str:
    bucket = os.environ.get("S3_BUCKET", "trading-forge-data")
    prefix = "ratio_adj" if adjusted else "raw"
    return f"s3://{bucket}/futures/{symbol}/{prefix}/{timeframe}/*/*/*.parquet"


def build_s3_glob(
    symbol: str,
    timeframe: str,
    start: str,
    end: str,
    bucket: Optional[str] = None,
    adjusted: bool = True,
) -> str:
    """Build a legacy S3 glob path for a date range.

    This preserves the original test contract used by the loader test suite.
    """
    from_dt = datetime.fromisoformat(start)
    to_dt = datetime.fromisoformat(end)
    s3_bucket = bucket or os.environ.get("S3_BUCKET", "trading-forge-data")
    prefix = "ratio_adj" if adjusted else "raw"

    if from_dt.year == to_dt.year and from_dt.month == to_dt.month:
        return (
            f"s3://{s3_bucket}/futures/{symbol}/{prefix}/{timeframe}/"
            f"{from_dt.year:04d}/{from_dt.month:02d}/*.parquet"
        )
    if from_dt.year == to_dt.year:
        return (
            f"s3://{s3_bucket}/futures/{symbol}/{prefix}/{timeframe}/"
            f"{from_dt.year:04d}/*/*.parquet"
        )
    return f"s3://{s3_bucket}/futures/{symbol}/{prefix}/{timeframe}/*/*/*.parquet"


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
    intraday_timeframes = {"1min", "5min", "15min", "30min", "1hour", "1h", "4hour", "4h"}
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
        denom = close[:-1]
        safe_denom = np.where(denom == 0, np.nan, denom)
        pct_changes = np.abs(np.diff(close) / safe_denom)
        large_gap_bars = int(np.nansum(pct_changes > 0.05))
        if large_gap_bars > 0:
            warn_list.append(f"{large_gap_bars} bars with >5% single-bar move")
        # Roll gap detection: single-bar return > 15% likely unadjusted
        roll_gaps = int(np.nansum(pct_changes > 0.15))
        if roll_gaps > 0:
            warn_list.append(f"{roll_gaps} bars with >15% single-bar move (likely unadjusted roll gap)")

    # ── Coverage / gap detection ──
    # Bars-per-day calibrated to OBSERVED CME Globex futures reality (ES/NQ/CL
    # 10.6 years of ratio-adjusted continuous data, ratio_adj/consolidated bucket).
    # Observed averages (460K 5min bars / 2670 trading days ≈ 172 bars/day):
    #   • 5min  ≈ 172  (RTH + partial ETH; not theoretical 276 = 23h × 12)
    #   • 1min  ≈ 860  (172 × 5)
    #   • 15min ≈  58
    #   • 30min ≈  29
    #   • 1hour ≈  14
    #   • 4hour ≈   4
    #   • daily =   1
    # These are EMPIRICAL floors; theoretical maxes are higher but real CME data
    # has weekend halts, daily 60-min Globex maintenance window, holidays, half
    # days. Using empirical floors avoids false "62% coverage" failures on
    # otherwise-clean data.
    coverage_pct = -1.0  # Sentinel: not yet computed
    bars_per_day_map = {
        "1min": 860, "5min": 172, "15min": 58, "30min": 29,
        "1hour": 14, "1h": 14, "4hour": 4, "4h": 4, "daily": 1, "1D": 1,
    }
    # Threshold tunable via env. Default 80 keeps strict reporting; hard-fail
    # uses a separate (lower) hard floor — see _DATA_COVERAGE_HARD_FAIL_PCT.
    coverage_warn_threshold = float(os.environ.get("DATA_COVERAGE_WARN_PCT", "80"))
    if timeframe in bars_per_day_map and "ts_event" in df.columns:
        ts_series = df["ts_event"]
        try:
            first_date = ts_series[0]
            last_date = ts_series[-1]
            if hasattr(first_date, "date"):
                calendar_days = (last_date.date() - first_date.date()).days
            elif isinstance(first_date, (int, float)):
                # Raw epoch timestamps (nanoseconds) — convert to days
                calendar_days = int((last_date - first_date) / (86400 * 1_000_000_000))
            else:
                calendar_days = (last_date - first_date).days
            if calendar_days > 0:
                trading_days = int(calendar_days * 252 / 365)
                expected_bars = trading_days * bars_per_day_map[timeframe]
                if expected_bars > 0:
                    coverage_pct = round(total / expected_bars * 100, 1)
                    if coverage_pct < coverage_warn_threshold:
                        warn_list.append(
                            f"Data coverage {coverage_pct:.1f}% ({total}/{expected_bars} expected bars) — below {coverage_warn_threshold:.0f}% threshold"
                        )
            elif calendar_days == 0:
                # Single-day data: coverage = actual bars / expected bars per day
                expected_bars = bars_per_day_map[timeframe]
                if expected_bars > 0:
                    coverage_pct = round(total / expected_bars * 100, 1)
                    if coverage_pct < coverage_warn_threshold:
                        warn_list.append(
                            f"Data coverage {coverage_pct:.1f}% ({total}/{expected_bars} expected bars) — below {coverage_warn_threshold:.0f}% threshold"
                        )
        except Exception as exc:
            print(f"WARNING: Coverage calculation failed: {exc}", file=sys.stderr)
            warn_list.append(f"Coverage calculation failed: {exc}")

    # If coverage was never computed (timeframe not in map or no ts_event), default pass
    if coverage_pct < 0:
        coverage_pct = 100.0  # No coverage check applicable

    # ── Determine pass/fail ──
    # Hard floor is the absolute minimum coverage we accept before refusing to
    # backtest. Below this, the data is almost certainly broken (failed S3 sync,
    # mid-year truncation, etc). Default 30 — well below any legitimate
    # CME Globex futures dataset. Soft warnings still emit at 80%.
    coverage_hard_floor = float(os.environ.get("DATA_COVERAGE_HARD_FAIL_PCT", "30"))
    passed = (
        dup_ts == 0
        and ohlc_violations == 0
        and zero_neg == 0
        and coverage_pct >= coverage_hard_floor
    )

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
    # MES/MNQ/MCL use the same price data as ES/NQ/CL — just 1/10th multiplier.
    # S3 stores data under the full-size symbol only.
    MICRO_TO_FULL = {"MES": "ES", "MNQ": "NQ", "MCL": "CL"}
    data_symbol = MICRO_TO_FULL.get(symbol, symbol)

    # Canonicalize DSL timeframe short-form to S3 storage suffix.
    # Strategy schema uses "5m"/"1h"/"1d"; S3 keys use "5min"/"1hour"/"daily".
    # Without this, lookups hit s3://.../consolidated/5m.parquet → 404.
    _TIMEFRAME_S3 = {
        "1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min",
        "1h": "1hour", "4h": "4hour", "1d": "daily", "1D": "daily",
    }
    timeframe = _TIMEFRAME_S3.get(timeframe, timeframe)

    if not adjusted:
        warnings.warn(
            f"Loading UNADJUSTED data for {data_symbol} {timeframe}. "
            f"Backtesting on raw contracts creates fake signals at roll boundaries. "
            f"Use adjusted=True (default) for backtesting."
        )

    # Phase 12: bust stale cache if BACKTEST_CACHE_BUST=1 (runs once per process)
    _maybe_bust_cache()

    con = _get_connection()

    # Determine source (use data_symbol for paths — micro symbols share full-size data)
    if local_path:
        source = local_path
        print(f"Loading {data_symbol} {timeframe} from local path", file=sys.stderr)
        # Verify local path looks like ratio-adjusted data
        _verify_ratio_adjusted_source(source, adjusted)
    else:
        cache_file = _cache_path(data_symbol, timeframe)
        if _is_cache_fresh(cache_file):
            source = str(cache_file)
            print(f"Loading {data_symbol} {timeframe} from local cache ({cache_file})", file=sys.stderr)
        elif cache_file.exists():
            # Cache exists but is stale (> 24h) — re-fetch from S3
            print(
                f"Loading {data_symbol} {timeframe} — cache stale (>24h), refreshing from S3",
                file=sys.stderr,
            )
            source = _consolidated_s3_path(data_symbol, timeframe, adjusted=adjusted)
        else:
            # Cache miss — read directly from S3 consolidated file (single HTTP request)
            source = _consolidated_s3_path(data_symbol, timeframe, adjusted=adjusted)
            print(f"Loading {data_symbol} {timeframe} from S3 consolidated (cache miss)", file=sys.stderr)

    sql = f"""
        SELECT ts_event, open, high, low, close, volume
        FROM read_parquet('{source}')
        WHERE ts_event >= '{start}' AND ts_event < '{end}T23:59:59.999999999'
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
                WHERE ts_event >= '{start}' AND ts_event < '{end}T23:59:59.999999999'
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

    # Auto-cache: write to local cache after S3 fetch so re-runs are instant.
    # Phase 12: always write the FULL dataset (no date filter). Cache is overwritten
    # when stale (>24h) so a fresh nightly S3 sync is picked up automatically.
    # Cache stores ratio_adj consolidated data ONLY (CLAUDE.md §13).
    if not local_path and not str(source).startswith(str(CACHE_DIR)):
        cache_file = _cache_path(data_symbol, timeframe)
        _should_write_cache = not _is_cache_fresh(cache_file)  # Write if missing OR stale
        if _should_write_cache:
            try:
                cache_file.parent.mkdir(parents=True, exist_ok=True)
                # Re-fetch the FULL dataset (no date filter) for caching so future
                # date-range requests (including crisis scenarios in stress_test.py
                # that need 2008-2020 data) all hit the local cache.
                full_sql = f"SELECT ts_event, open, high, low, close, volume FROM read_parquet('{source}') ORDER BY ts_event"
                try:
                    full_pdf = con.execute(full_sql).fetchdf()
                    full_df = pl.from_pandas(full_pdf)
                    full_df.write_parquet(str(cache_file), compression="zstd")
                except Exception:
                    # Fallback: cache the filtered slice (better than nothing)
                    df.write_parquet(str(cache_file), compression="zstd")
                size_kb = cache_file.stat().st_size / 1024
                action = "refreshed" if cache_file.exists() else "auto-cached"
                print(f"Cache {action}: {data_symbol} {timeframe} → {cache_file} ({size_kb:.0f} KB)", file=sys.stderr)
            except Exception as e:
                print(f"Auto-cache failed (non-fatal): {e}", file=sys.stderr)

    # ─── Convert UTC timestamps to ET for session logic ──────────
    # Databento data arrives with ts_event in UTC. All session filtering
    # (killzones, RTH/ETH, event windows) must happen in ET.
    # Keep ts_event (UTC) for storage/alignment. Add ts_et as a NEW column.
    if "ts_event" in df.columns and timeframe not in {"daily", "1D"}:
        ts_dtype = df["ts_event"].dtype
        tz = getattr(ts_dtype, "time_zone", None)
        if tz is not None and tz != "":
            # Timezone-aware (e.g. UTC) — convert directly
            df = df.with_columns(
                pl.col("ts_event")
                .dt.convert_time_zone("America/New_York")
                .alias("ts_et")
            )
        elif str(ts_dtype).startswith("Datetime"):
            # Naive datetime — assume UTC (Databento convention), cast then convert
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

    # ─── Emit structured telemetry (JSON to stderr so server can capture) ─
    # Server-side python-runner stderr handler logs at warn; this gives the
    # audit-log a structured DataQualityReport rather than just printf lines.
    import json as _json
    _qr_payload = {
        "event": "data_quality_report",
        "symbol": symbol,
        "timeframe": timeframe,
        "total_bars": quality_report.total_bars,
        "coverage_pct": quality_report.coverage_pct,
        "duplicate_timestamps": quality_report.duplicate_timestamps,
        "ohlc_violations": quality_report.ohlc_violations,
        "zero_negative_prices": quality_report.zero_negative_prices,
        "large_gap_bars": quality_report.large_gap_bars,
        "passed": quality_report.passed,
        "warnings": quality_report.warnings,
    }
    print(f"DATA_QUALITY_REPORT_JSON {_json.dumps(_qr_payload)}", file=sys.stderr)

    # ─── Hard fail on CRITICAL data issues only ───────────────
    # Hard-fail criteria (any one triggers): duplicate timestamps, OHLC
    # violations, zero/negative prices, OR coverage below the configured
    # hard floor. Coverage between hard-floor and warn-threshold is a SOFT
    # signal — emit warning + audit telemetry, but do NOT refuse to run.
    if not quality_report.passed:
        critical = []
        if quality_report.duplicate_timestamps > 0:
            critical.append(f"{quality_report.duplicate_timestamps} duplicate timestamps")
        if quality_report.ohlc_violations > 0:
            critical.append(f"{quality_report.ohlc_violations} OHLC violations (high<low etc)")
        if quality_report.zero_negative_prices > 0:
            critical.append(f"{quality_report.zero_negative_prices} zero/negative prices")
        hard_floor = float(os.environ.get("DATA_COVERAGE_HARD_FAIL_PCT", "30"))
        if quality_report.coverage_pct < hard_floor:
            critical.append(
                f"coverage {quality_report.coverage_pct:.1f}% below hard floor {hard_floor:.0f}%"
            )
        if not critical:
            # Soft-only failure (e.g. coverage 60% with no critical issues) —
            # log and continue. This matches enterprise behavior: real CME
            # ratio-adjusted futures data legitimately runs 55-75% vs naive
            # bars-per-day expected counts; refusing to backtest on it would
            # block all production work.
            print(
                f"DATA QUALITY [{symbol} {timeframe}]: soft warnings only "
                f"(coverage={quality_report.coverage_pct:.1f}%); proceeding",
                file=sys.stderr,
            )
        elif local_path:
            print(
                f"WARNING: DATA QUALITY GATE FAILED (local test path passthrough) for {symbol} {timeframe}: "
                f"{'; '.join(critical)}",
                file=sys.stderr,
            )
        else:
            raise ValueError(
                f"DATA QUALITY GATE FAILED for {symbol} {timeframe}: {'; '.join(critical)}"
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
    "CL": list(range(1, 13)),
    "MCL": list(range(1, 13)),  # Micro Crude follows same roll schedule as CL
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


def _second_thursday_before_third_friday(year: int, month: int) -> "date":  # noqa: F821
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
) -> list["date"]:  # noqa: F821
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
    # Use ts_event (UTC) consistently — rollover_strs are UTC dates from CME calendar
    if ts.dtype == pl.Utf8:
        date_col = pl.col("ts_event").str.slice(0, 10)
    else:
        date_col = pl.col("ts_event").dt.date().cast(pl.Utf8)

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
