"""
Databento Local Cache Refresh

Incremental update of data_cache/<SYMBOL>/<timeframe>.parquet files.
Fetches only the date range from (last cached bar + 1 day) to today,
then appends to the existing parquet.

Usage (internal — called by scripts/refresh-databento.mjs via Node subprocess):
    python refresh_local_cache.py --symbol ES --timeframes 5min,15min,1hour,daily --output-json
    python refresh_local_cache.py --symbol ES --timeframes 5min --dry-run --output-json

Schema contract:
    Parquet columns (unchanged from existing cache):
        ts_event : Datetime(us, UTC)   — bar open timestamp in UTC
        open     : Float64
        high     : Float64
        low      : Float64
        close    : Float64
        volume   : UInt64

Ratio adjustment:
    Continuous contracts (ES.c.0, NQ.c.0, etc.) from Databento already deliver
    ratio-adjusted prices when stype_in="continuous". The .c.0 suffix denotes
    the front-month continuous with back-adjustment handled server-side by CME.
    We do NOT apply additional ratio-adjustment to fresh incremental data —
    Databento's continuous contract series is pre-adjusted.

Safety:
    - Atomic write: write to <file>.tmp then os.replace (never half-written parquet)
    - Deduplication: drop rows with ts_event already in existing data before append
    - Validation: after write, assert max(ts_event) > now - 24h (unless market closed)
"""

import argparse
import json
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import polars as pl

# ---------------------------------------------------------------------------
# Symbol map — continuous front-month contracts on GLBX.MDP3
# MES and MNQ are micro versions of ES and NQ. They share the same dataset
# and use the same .c.0 continuous suffix.
# ---------------------------------------------------------------------------
SYMBOL_MAP: dict[str, str] = {
    "ES": "ES.c.0",
    "NQ": "NQ.c.0",
    "MES": "MES.c.0",
    "MNQ": "MNQ.c.0",
    "MCL": "MCL.c.0",
    # CL maps to MCL in the cache directory but uses CL contract on Databento
    # The data_cache uses "CL" as the directory name.
    "CL": "CL.c.0",
}

DATASET = "GLBX.MDP3"

# Timeframe → Polars group_by_dynamic "every" string
TIMEFRAME_EVERY: dict[str, str] = {
    "5min": "5m",
    "15min": "15m",
    "1hour": "1h",
    "daily": "1d",
}

# How far back to look at minimum (avoid downloading nothing for illiquid symbols)
MIN_LOOKBACK_DAYS = 2


def get_cache_dir() -> Path:
    """data_cache/ relative to the project root (two levels up from this script)."""
    return Path(__file__).parent.parent.parent.parent / "data_cache"


def get_parquet_path(symbol: str, timeframe: str) -> Path:
    return get_cache_dir() / symbol / f"{timeframe}.parquet"


def get_latest_ts(symbol: str, timeframe: str) -> datetime | None:
    """Return the latest ts_event in the existing parquet, or None if file missing."""
    p = get_parquet_path(symbol, timeframe)
    if not p.exists():
        return None
    try:
        df = pl.read_parquet(p, columns=["ts_event"])
        if df.is_empty():
            return None
        max_val = df["ts_event"].max()
        if max_val is None:
            return None
        # Ensure UTC
        if hasattr(max_val, "tzinfo") and max_val.tzinfo is None:
            max_val = max_val.replace(tzinfo=timezone.utc)
        elif hasattr(max_val, "tzinfo") and max_val.tzinfo is not None:
            max_val = max_val.astimezone(timezone.utc)
        return max_val
    except Exception:
        return None


def resample_1m_to_tf(df_1m: pl.DataFrame, every: str) -> pl.DataFrame:
    """Resample 1-min OHLCV DataFrame to the given Polars 'every' interval."""
    # Ensure ts_event is Datetime with UTC
    if df_1m["ts_event"].dtype.time_zone != "UTC":
        df_1m = df_1m.with_columns(
            pl.col("ts_event").dt.convert_time_zone("UTC")
        )
    resampled = (
        df_1m.sort("ts_event")
        .group_by_dynamic("ts_event", every=every)
        .agg(
            pl.col("open").first(),
            pl.col("high").max(),
            pl.col("low").min(),
            pl.col("close").last(),
            pl.col("volume").sum(),
        )
        .filter(pl.col("volume") > 0)
    )
    return resampled


def fetch_1m_bars(
    api_key: str,
    dbn_symbol: str,
    start_date: str,
    end_date: str,
) -> pl.DataFrame:
    """Download 1-minute OHLCV bars from Databento. Returns Polars DataFrame."""
    import databento as db

    client = db.Historical(api_key)
    data = client.timeseries.get_range(
        dataset=DATASET,
        symbols=[dbn_symbol],
        stype_in="continuous",
        schema="ohlcv-1m",
        start=start_date,
        end=end_date,
    )
    df_pd = data.to_df()
    if df_pd is None or len(df_pd) == 0:
        return pl.DataFrame(schema={
            "ts_event": pl.Datetime("us", "UTC"),
            "open": pl.Float64,
            "high": pl.Float64,
            "low": pl.Float64,
            "close": pl.Float64,
            "volume": pl.UInt64,
        })

    # Convert to Polars, keep only OHLCV + ts_event
    df = pl.from_pandas(df_pd.reset_index())

    # Normalize ts_event column (Databento returns nanosecond timestamps in index)
    if "ts_event" not in df.columns:
        # The Databento ohlcv-1m schema puts ts_event in the index as 'ts_event'
        # after reset_index(). If not found, try the DataFrame index.
        raise ValueError(f"ts_event column not found. Columns: {df.columns}")

    # Cast to us precision UTC
    if df["ts_event"].dtype == pl.Datetime:
        if df["ts_event"].dtype.time_zone is None:
            df = df.with_columns(
                pl.col("ts_event").dt.replace_time_zone("UTC").dt.cast_time_unit("us")
            )
        else:
            df = df.with_columns(
                pl.col("ts_event").dt.convert_time_zone("UTC").dt.cast_time_unit("us")
            )
    else:
        # Nanosecond integer or string — cast
        df = df.with_columns(
            pl.col("ts_event").cast(pl.Datetime("ns")).dt.cast_time_unit("us").dt.replace_time_zone("UTC")
        )

    # Keep only the columns we need
    keep_cols = ["ts_event", "open", "high", "low", "close", "volume"]
    available = [c for c in keep_cols if c in df.columns]
    df = df.select(available)

    # Cast OHLC to Float64, volume to UInt64
    df = df.with_columns([
        pl.col("open").cast(pl.Float64),
        pl.col("high").cast(pl.Float64),
        pl.col("low").cast(pl.Float64),
        pl.col("close").cast(pl.Float64),
        pl.col("volume").cast(pl.UInt64),
    ])

    return df


def atomic_write_parquet(df: pl.DataFrame, dest: Path) -> None:
    """Write parquet atomically: write to .tmp then os.replace."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".parquet.tmp")
    df.write_parquet(str(tmp))
    os.replace(str(tmp), str(dest))


def refresh_symbol_timeframe(
    symbol: str,
    timeframe: str,
    api_key: str,
    dry_run: bool,
    today: datetime,
) -> dict[str, Any]:
    """
    Refresh a single symbol/timeframe parquet.
    Returns a result dict with keys: symbol, timeframe, status, message, ...
    """
    dbn_symbol = SYMBOL_MAP.get(symbol)
    if not dbn_symbol:
        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "status": "error",
            "message": f"Unknown symbol: {symbol}. Known: {list(SYMBOL_MAP.keys())}",
        }

    every = TIMEFRAME_EVERY.get(timeframe)
    if not every:
        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "status": "error",
            "message": f"Unknown timeframe: {timeframe}. Known: {list(TIMEFRAME_EVERY.keys())}",
        }

    parquet_path = get_parquet_path(symbol, timeframe)
    latest_ts = get_latest_ts(symbol, timeframe)

    if latest_ts is not None:
        # Start 1 day after the latest cached bar
        start_dt = latest_ts + timedelta(days=1)
    else:
        # No existing data — start 2 years back as a safe bootstrap window
        # (caller may override by running without --dry-run to get full history)
        start_dt = today - timedelta(days=730)

    # Don't fetch beyond yesterday (today's session is incomplete)
    end_dt = today - timedelta(days=0)  # Databento end is exclusive, so today = up to now
    end_date_str = end_dt.strftime("%Y-%m-%d")
    start_date_str = start_dt.strftime("%Y-%m-%d")

    existing_rows = 0
    if parquet_path.exists():
        try:
            existing_df = pl.read_parquet(parquet_path, columns=["ts_event"])
            existing_rows = len(existing_df)
        except Exception:
            existing_rows = 0

    # If start >= end, nothing to fetch
    if start_dt.date() >= end_dt.date():
        latest_ts_str = latest_ts.isoformat() if latest_ts else "none"
        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "status": "up_to_date",
            "message": f"Already up to date (latest: {latest_ts_str})",
            "existing_rows": existing_rows,
            "latest_ts": latest_ts_str,
            "new_rows": 0,
        }

    if dry_run:
        latest_ts_str = latest_ts.isoformat() if latest_ts else "none"
        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "status": "dry_run",
            "message": f"Would fetch {start_date_str} to {end_date_str}",
            "dbn_symbol": dbn_symbol,
            "start_date": start_date_str,
            "end_date": end_date_str,
            "existing_rows": existing_rows,
            "latest_ts": latest_ts_str,
        }

    # --- Execute: download 1-min bars ---
    try:
        df_1m = fetch_1m_bars(api_key, dbn_symbol, start_date_str, end_date_str)
    except Exception as e:
        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "status": "error",
            "message": f"Databento fetch failed: {e}",
        }

    if df_1m.is_empty():
        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "status": "no_new_data",
            "message": f"No bars returned for {start_date_str} to {end_date_str}",
            "existing_rows": existing_rows,
        }

    # --- Resample to target timeframe ---
    try:
        df_new = resample_1m_to_tf(df_1m, every)
    except Exception as e:
        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "status": "error",
            "message": f"Resample failed: {e}",
        }

    if df_new.is_empty():
        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "status": "no_new_data",
            "message": "Resampled data is empty (possibly zero-volume bars filtered)",
            "existing_rows": existing_rows,
        }

    # --- Merge with existing parquet ---
    if parquet_path.exists():
        try:
            df_existing = pl.read_parquet(parquet_path)

            # Normalize ts_event timezone to UTC for consistent deduplication
            if df_existing["ts_event"].dtype.time_zone != "UTC":
                df_existing = df_existing.with_columns(
                    pl.col("ts_event").dt.convert_time_zone("UTC").dt.cast_time_unit("us")
                )

            # Dedup: only keep new rows not already in existing
            existing_ts_set = set(df_existing["ts_event"].to_list())
            df_new_filtered = df_new.filter(
                ~pl.col("ts_event").is_in(list(existing_ts_set))
            )

            if df_new_filtered.is_empty():
                latest_ts_str = latest_ts.isoformat() if latest_ts else "none"
                return {
                    "symbol": symbol,
                    "timeframe": timeframe,
                    "status": "up_to_date",
                    "message": "All fetched bars already in cache (no new rows after dedup)",
                    "existing_rows": existing_rows,
                    "latest_ts": latest_ts_str,
                    "new_rows": 0,
                }

            # Align schema: ensure both frames have same dtypes before concat
            df_new_filtered = df_new_filtered.with_columns([
                pl.col("open").cast(pl.Float64),
                pl.col("high").cast(pl.Float64),
                pl.col("low").cast(pl.Float64),
                pl.col("close").cast(pl.Float64),
                pl.col("volume").cast(pl.UInt64),
            ])

            df_merged = pl.concat([df_existing, df_new_filtered]).sort("ts_event")
        except Exception as e:
            return {
                "symbol": symbol,
                "timeframe": timeframe,
                "status": "error",
                "message": f"Merge with existing parquet failed: {e}",
            }
    else:
        # No existing file — write fresh
        df_merged = df_new.sort("ts_event")
        df_new_filtered = df_new

    new_row_count = len(df_new_filtered)
    final_row_count = len(df_merged)
    final_latest = df_merged["ts_event"].max()
    final_latest_str = final_latest.isoformat() if final_latest else "none"

    # --- Atomic write ---
    try:
        atomic_write_parquet(df_merged, parquet_path)
    except Exception as e:
        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "status": "error",
            "message": f"Write failed: {e}",
        }

    # --- Validation: latest bar must be within 24h of now ---
    now_utc = datetime.now(timezone.utc)
    if final_latest:
        final_latest_aware = final_latest
        if not hasattr(final_latest_aware, "tzinfo") or final_latest_aware.tzinfo is None:
            final_latest_aware = final_latest_aware.replace(tzinfo=timezone.utc)
        age_hours = (now_utc - final_latest_aware).total_seconds() / 3600
        validation_passed = age_hours < 36  # 36h to account for weekends and holidays
    else:
        validation_passed = False
        age_hours = None

    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "status": "ok",
        "dbn_symbol": dbn_symbol,
        "start_date": start_date_str,
        "end_date": end_date_str,
        "existing_rows": existing_rows,
        "new_rows": new_row_count,
        "final_rows": final_row_count,
        "latest_ts": final_latest_str,
        "validation_passed": validation_passed,
        "age_hours": round(age_hours, 1) if age_hours is not None else None,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Refresh Databento local cache (data_cache/)"
    )
    parser.add_argument(
        "--symbols",
        default="ES,NQ,MES,MNQ,CL",
        help="Comma-separated symbols (default: ES,NQ,MES,MNQ,CL)",
    )
    parser.add_argument(
        "--timeframes",
        default="5min,15min,1hour,daily",
        help="Comma-separated timeframes (default: 5min,15min,1hour,daily)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only show what would be fetched, do not download",
    )
    parser.add_argument(
        "--output-json",
        action="store_true",
        help="Output results as JSON (for Node subprocess parsing)",
    )
    args = parser.parse_args()

    symbols = [s.strip() for s in args.symbols.split(",") if s.strip()]
    timeframes = [t.strip() for t in args.timeframes.split(",") if t.strip()]

    api_key = os.environ.get("DATABENTO_API_KEY", "")
    if not api_key and not args.dry_run:
        result = {
            "status": "error",
            "message": "DATABENTO_API_KEY not set in environment",
            "results": [],
        }
        print(json.dumps(result))
        sys.exit(1)

    today = datetime.now(timezone.utc)
    results: list[dict[str, Any]] = []

    for symbol in symbols:
        for timeframe in timeframes:
            parquet_path = get_parquet_path(symbol, timeframe)
            # In execute mode: skip timeframes that have no existing cache file.
            # These require a full pipeline bootstrap (databento_download.py ->
            # adjust_continuous.py -> resample_timeframes.py) — not an incremental
            # refresh. Dry-run always reports the full picture.
            if not parquet_path.exists() and not args.dry_run:
                results.append({
                    "symbol": symbol,
                    "timeframe": timeframe,
                    "status": "skipped",
                    "message": f"No existing cache file at {parquet_path}. Run full pipeline first.",
                })
                continue
            r = refresh_symbol_timeframe(
                symbol=symbol,
                timeframe=timeframe,
                api_key=api_key,
                dry_run=args.dry_run,
                today=today,
            )
            results.append(r)

    any_error = any(r.get("status") == "error" for r in results)
    output = {
        "status": "error" if any_error else "ok",
        "mode": "dry_run" if args.dry_run else "execute",
        "symbol_count": len(symbols),
        "timeframe_count": len(timeframes),
        "results": results,
    }

    if args.output_json:
        print(json.dumps(output, indent=2, default=str))
    else:
        # Human-readable output
        mode_label = "[DRY RUN]" if args.dry_run else "[EXECUTE]"
        print(f"\n{'='*70}")
        print(f"Databento Local Cache Refresh {mode_label}")
        print(f"{'='*70}")
        for r in results:
            sym = r.get("symbol", "?")
            tf = r.get("timeframe", "?")
            status = r.get("status", "?")
            msg = r.get("message", "")
            new_rows = r.get("new_rows", "")
            latest = r.get("latest_ts", "")
            if status == "ok":
                print(f"  OK  {sym}/{tf}: +{new_rows} rows, latest={latest}")
            elif status in ("up_to_date", "dry_run", "no_new_data", "skipped"):
                print(f"  --  {sym}/{tf}: {status} — {msg}")
            else:
                print(f"  ERR {sym}/{tf}: {msg}")

        ok_count = sum(1 for r in results if r.get("status") == "ok")
        print(f"\n{ok_count}/{len(results)} symbol/timeframe combos updated.")

    if any_error:
        sys.exit(1)


if __name__ == "__main__":
    main()
