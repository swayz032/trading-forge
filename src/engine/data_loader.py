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


# ─── S3 Read Pre-Flight Guard (deep-scan #21 Wave-2 MED, 2026-07-05) ──────────
#
# CERTIFIED FINDING: DuckDB's native httpfs S3 reader (`con.execute(sql).fetchdf()`
# in load_ohlcv below) can SEGFAULT / raise a Windows access violation — a native
# crash outside the Python exception machinery — when AWS credentials are
# missing/invalid (reproduced by deep-scan #21 Band B: no AWS_*/S3_BUCKET env ->
# segfault across 3 tests). A bare `except Exception:` around that call CANNOT
# catch a native crash, so the whole backtest subprocess died uncontrolled instead
# of returning a structured error — surfacing to the TS python-runner as an opaque
# non-zero exit with no diagnosable reason.
#
# FIX: verify the exact env-var contract `_get_connection()` documents above
# (AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY — DuckDB auto-reads these once httpfs
# is loaded; no other credential source is wired anywhere in this codebase — see
# the same convention in src/data/scripts/upload_to_s3.py and
# black_swan_evaluator.py) BEFORE DuckDB ever touches the network. Missing creds
# now raise a clean, structured DataLoadConfigError instead of crashing the
# process. No-ops for non-S3 sources, so local_path / warm-cache reads (the vast
# majority of calls) are byte-identical to before this change.
#
# HONEST RESIDUAL (documented per deep-scan #21 instructions): this closes the
# reproducible crash class — missing/absent credentials, the one Band B actually
# reproduced. It does NOT guarantee protection against a truncated S3 object or a
# network drop mid-transfer DURING the DuckDB fetchdf() call itself — those
# failures occur inside DuckDB's native C++ S3 client after this guard has already
# passed, which a Python-level pre-flight cannot wrap without real flaky-S3 /
# truncated-object test infrastructure (deliberately corrupted fixtures + simulated
# connection drops) that is out of scope here. A config guard is the fully
# testable, fully safe subset of the fix; the remaining native-crash surface is
# narrower (mid-read network failure) but not eliminated.

class DataLoadConfigError(RuntimeError):
    """Raised when an S3 parquet read is refused pre-flight instead of risking a
    DuckDB native crash. See the module note above `_check_s3_read_config` for why
    this exists and what it does/doesn't cover."""


def _check_s3_read_config(s3_path: str) -> None:
    """Pre-flight guard: refuse an S3 read with a clean, catchable exception when
    AWS credentials are absent, instead of letting DuckDB's native S3 reader
    attempt (and potentially native-crash on) a read it cannot authenticate.

    No-op for any path that is not an 's3://' URI — local files, `local_path=`
    fixtures, and warm local-cache reads never reach this check and are completely
    unaffected (byte-identical happy path). On the happy path for real S3 reads
    (creds present), this is a single dict lookup pair — negligible overhead, zero
    behavior change to the actual read.
    """
    if not s3_path.startswith("s3://"):
        return

    has_access_key = bool(os.environ.get("AWS_ACCESS_KEY_ID"))
    has_secret_key = bool(os.environ.get("AWS_SECRET_ACCESS_KEY"))
    if has_access_key and has_secret_key:
        return

    missing = []
    if not has_access_key:
        missing.append("AWS_ACCESS_KEY_ID")
    if not has_secret_key:
        missing.append("AWS_SECRET_ACCESS_KEY")

    raise DataLoadConfigError(
        f"S3 read for '{s3_path}' aborted before DuckDB: missing "
        f"{' and '.join(missing)}. DuckDB's native S3 (httpfs) reader can "
        f"native-crash the whole backtest subprocess on a bad-credentials read "
        f"instead of raising a catchable exception — refusing the read pre-flight "
        f"instead. Set the missing credential(s) in the environment before retrying."
    )


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

# ─── Empirical bars-per-day (single source of truth, deep-scan #10 FIX 4/F-11) ──
# Derived from 10.6 years of CME Globex ratio-adjusted continuous contract data.
# These are OBSERVED averages including weekend halts, 60-min daily maintenance,
# US holidays, and half-days — NOT theoretical maxima (which are higher).
# Used by both validate_bars (here) and _validate_bar_count (backtester.py) so the
# two bar-count checks stay consistent. backtester.py imports this dict directly.
EMPIRICAL_BARS_PER_DAY: dict[str, int] = {
    "1min": 860, "5min": 172, "15min": 58, "30min": 29,
    "1hour": 14, "1h": 14, "4hour": 4, "4h": 4,
    "daily": 1, "1D": 1,
}

# Process-level bust flag: set True once per process when BACKTEST_CACHE_BUST=1
_cache_busted: bool = False

# ─── FIX 7 (deep-scan #10): cache sidecar provenance helpers ─────────────────
# Tracks which legacy files have already logged their "no sidecar" INFO to avoid
# per-request spam across a warm-cache run.
_sidecar_info_emitted: set = set()


def _write_cache_sidecar(
    cache_file: Path,
    source: str,
    adjusted: bool,
    dataset_hash: str,
    *,
    is_partial: bool = False,
    range_start: Optional[str] = None,
    range_end: Optional[str] = None,
) -> None:
    """Write provenance JSON alongside a cache parquet (deep-scan #10 FIX 7).

    Guards against cache poisoning: a subsequent read can verify that the file
    written under the ratio_adj/ path is genuinely ratio-adjusted.

    Schema: {source, adjusted, written_at, dataset_hash, is_partial, range_start, range_end}
    File name: <parquet_name>.provenance.json (e.g. ratio_adj/15min.parquet.provenance.json)

    deepscan16 Wave-1 Track2 CRITICAL E-4: is_partial / range_start / range_end are
    additive fields. When the caller could only fetch a date-filtered slice (the
    intended full-history re-fetch failed) it MUST pass is_partial=True + the actual
    [range_start, range_end] covered by what got written to disk. _check_cache_sidecar
    below refuses to serve a sidecar with is_partial=True — this is what stops a
    truncated request-scoped slice from silently being treated as "complete history"
    by every other caller that shares the same full-history cache key.
    """
    import datetime as _dt
    import json as _json
    sidecar = cache_file.parent / f"{cache_file.name}.provenance.json"
    payload = {
        "source": source,
        "adjusted": adjusted,
        "written_at": _dt.datetime.utcnow().isoformat() + "Z",
        "dataset_hash": dataset_hash,
        "is_partial": is_partial,
        "range_start": range_start,
        "range_end": range_end,
    }
    try:
        sidecar.write_text(_json.dumps(payload), encoding="utf-8")
    except Exception as _e:
        print(f"Cache sidecar write failed (non-fatal): {_e}", file=sys.stderr)


def _check_cache_sidecar(cache_file: Path, adjusted: bool) -> bool:
    """Return True if the cache file is safe to serve; False → treat as cache miss.

    FIX 7 (deep-scan #10): prevents poisoned cache from serving raw data under a
    ratio_adj path. Checks the sidecar written by _write_cache_sidecar.

    Rules:
    - Sidecar absent (legacy cache) → allow with one-time INFO per file per process.
    - Sidecar present, adjusted=False for a ratio_adj-path read → WARN, return False.
    - Sidecar present, is_partial=True (deepscan16 E-4) → WARN, return False. A partial
      write means the intended full-history re-fetch failed and only a request-scoped
      date slice landed on disk under the full-history cache key; the ONLY safe read
      behavior is to treat it as a cache miss so the caller re-attempts a full fetch
      rather than silently trusting the truncated slice as complete history.
    - Sidecar present, consistent → return True.
    """
    import json as _json
    sidecar = cache_file.parent / f"{cache_file.name}.provenance.json"
    if not sidecar.exists():
        _key = str(cache_file)
        if _key not in _sidecar_info_emitted:
            _sidecar_info_emitted.add(_key)
            print(
                f"INFO: Cache sidecar absent for {cache_file.name} (legacy cache file) — "
                f"allowing read; run a cache refresh to generate provenance",
                file=sys.stderr,
            )
        return True
    try:
        data = _json.loads(sidecar.read_text(encoding="utf-8"))
        if adjusted and not data.get("adjusted", True):
            print(
                f"WARN: Cache sidecar for {cache_file.name} says adjusted=false "
                f"(expected adjusted=true for ratio_adj path) — treating as cache miss",
                file=sys.stderr,
            )
            return False
        if data.get("is_partial", False):
            print(
                f"WARN: Cache sidecar for {cache_file.name} is_partial=true "
                f"(range {data.get('range_start')}..{data.get('range_end')} — truncated "
                f"full-history refetch fallback) — treating as cache miss until a full "
                f"refresh succeeds",
                file=sys.stderr,
            )
            return False
    except Exception as _e:
        print(f"Cache sidecar read failed (non-fatal): {_e}", file=sys.stderr)
    return True


def _cache_path(symbol: str, timeframe: str, adjusted: bool = True) -> Path:
    # Wave hardening 2026-06-22, data-layer institutional-grade:
    # HIGH-2(a): cache key is adjusted-aware so raw and ratio-adj can never collide.
    # raw and ratio_adj data land in separate subdirectories, preventing a
    # load_ohlcv(adjusted=False) → S3-404 → legacy-raw-fallback → cache-write
    # from poisoning a subsequent load_ohlcv(adjusted=True) cache hit.
    subfolder = "ratio_adj" if adjusted else "raw"
    return CACHE_DIR / symbol / subfolder / f"{timeframe}.parquet"


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


def _verify_ratio_adjusted_source(source: str, adjusted: bool, from_cache: bool = False) -> None:
    """Hard-fail if the data source path does not contain ratio_adj when adjusted=True.

    F-6 fix: Changed from warnings.warn() to raise ValueError() so production callers
    cannot accidentally backtest on raw/unadjusted data. Set ALLOW_RAW_DATA=true in
    the environment ONLY for explicit test/research opt-in — never in production.

    Pass 5 Track A F-1: from_cache=True bypasses the substring check for paths under
    CACHE_DIR. Cache files are ratio-adjusted by construction (sync_from_s3 only writes
    consolidated/ratio_adj data into the cache), but the local cache path strings do
    not contain "ratio_adj" or "consolidated" — without this bypass every cache-hit
    load raises ValueError, killing the entire backtest pipeline on the hot path.
    """
    if from_cache:
        return
    if adjusted and "ratio_adj" not in source and "consolidated" not in source:
        allow_raw = os.environ.get("ALLOW_RAW_DATA", "false").lower() in ("1", "true", "yes")
        if allow_raw:
            warnings.warn(
                f"ALLOW_RAW_DATA=true override: loading from '{source}' which does not appear "
                f"ratio-adjusted. This is for test/research only — never use in production."
            )
        else:
            raise ValueError(
                f"Data source '{source}' does not appear to be ratio-adjusted. "
                f"Backtesting on unadjusted contracts creates fake signals at roll boundaries. "
                f"Set adjusted=False explicitly if intentional, or set ALLOW_RAW_DATA=true "
                f"for test/research use."
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
    # FIX 7 (deep-scan #10): write provenance sidecar after S3 sync
    try:
        _sync_df = pl.read_parquet(str(cache_file))
        _write_cache_sidecar(
            cache_file,
            source=s3_path,
            adjusted=True,  # sync_from_s3 always fetches ratio-adjusted consolidated data
            dataset_hash=compute_dataset_hash(_sync_df),
        )
    except Exception as _sc_err:
        print(f"sync_from_s3 sidecar write failed (non-fatal): {_sc_err}", file=sys.stderr)
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
    """Compute SHA-256 hash of OHLCV data for reproducibility tracking.

    M-4 fix (2026-06-29): replaced .to_pandas().to_csv() chain with Polars-native
    write_csv() into an io.BytesIO buffer.

    Previous implementation used pandas float formatting which varies by pandas version
    (e.g., pandas 1.x vs 2.x print different decimal representations for the same float),
    making the hash non-deterministic across environments that differ in pandas version.
    Polars write_csv() output is stable and version-independent for the same Polars major.
    """
    import io
    buffer = io.BytesIO()
    (
        df.sort("ts_event")
        .select(["ts_event", "open", "high", "low", "close", "volume"])
        .write_csv(buffer)
    )
    return hashlib.sha256(buffer.getvalue()).hexdigest()


# ─── Zero-Volume Fail-Loud Guard (M1) ────────────────────────────
# Wave 27.5 Pass D.3: holidays and data gaps produce volume=0 bars.
# ATR computed on zero-vol bars produces NaN. On indicator-compute bars
# (rolling averages) this is acceptable. On trade-critical bars (where a
# stop or TP would fire) it is NOT — silent skip hides a data-integrity
# failure that can mask systematic backtest errors on US holidays (5-10
# days/year).
#
# BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD (default "true"):
#   true  → raise ZeroVolumeOnTradeCriticalBar (institutional default)
#   false → warn to stderr and return False (preserves legacy silent-skip)
#
# Callers (backtester._apply_trade_management, simulator step loops) should
# call check_zero_volume_trade_critical() before executing any stop/TP action.

class ZeroVolumeOnTradeCriticalBar(RuntimeError):
    """Raised when a trade-critical bar (stop/TP candidate) has volume == 0.

    This indicates a holiday bar or data gap that should not produce fills.
    Raise path is the institutional default (BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD=true).
    Set the env var to "false" to restore legacy silent-skip behavior.
    """

    def __init__(self, bar_timestamp: str, symbol: str, attempted_action: str) -> None:
        self.bar_timestamp = bar_timestamp
        self.symbol = symbol
        self.attempted_action = attempted_action
        super().__init__(
            f"ZeroVolumeOnTradeCriticalBar: {symbol} bar at {bar_timestamp} has volume=0 "
            f"but attempted_action='{attempted_action}'. "
            f"Set BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD=false to skip silently."
        )


def check_zero_volume_trade_critical(
    bar_volume: float,
    bar_timestamp: str,
    symbol: str,
    attempted_action: str,
    *,
    audit_callback: "Optional[callable]" = None,  # type: ignore[type-arg]
) -> bool:
    """Check whether a trade-critical bar has zero volume.

    Trade-critical = a bar where a stop, TP, or entry fill would execute.
    Indicator-compute bars (rolling averages, ATR, etc.) should NOT call this.

    Args:
        bar_volume: Volume of the current bar (0 triggers the guard).
        bar_timestamp: ISO timestamp string for the bar (for audit/error payload).
        symbol: Trading symbol (for audit/error payload).
        attempted_action: Human-readable action string, e.g. 'stop_trigger',
            'tp1_trigger', 'entry_fill'.
        audit_callback: Optional callable(action, payload) for writing an
            audit_log row. When provided, called BEFORE raise/return so callers
            with DB access can persist the event.

    Returns:
        False when volume > 0 (bar is valid — no action needed).
        False when volume == 0 AND fail-loud is disabled (legacy silent-skip).

    Raises:
        ZeroVolumeOnTradeCriticalBar: when volume == 0 AND
            BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD is "true" (default).
    """
    if bar_volume != 0:
        return False  # Fast path — most bars have volume

    fail_loud = os.environ.get("BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD", "true").lower() != "false"

    audit_payload = {
        "bar_timestamp": bar_timestamp,
        "symbol": symbol,
        "attempted_action": attempted_action,
        "fail_loud": fail_loud,
    }

    if audit_callback is not None:
        try:
            audit_callback("backtest.zero_volume_trade_critical_raised", audit_payload)
        except Exception as _cb_err:  # noqa: BLE001
            print(
                f"WARNING: zero-vol audit callback failed: {_cb_err}",
                file=sys.stderr,
            )

    if fail_loud:
        raise ZeroVolumeOnTradeCriticalBar(bar_timestamp, symbol, attempted_action)

    # Backward-compat: env=false — warn to stderr, return True to signal caller to skip
    print(
        f"WARNING: zero-vol trade-critical bar skipped: {symbol} {bar_timestamp} "
        f"attempted_action={attempted_action} (BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD=false)",
        file=sys.stderr,
    )
    return True  # Caller should skip this bar


def validate_bars(
    df: pl.DataFrame,
    symbol: str = "",
    timeframe: str = "",
    source_duplicate_timestamps: int = 0,
) -> DataQualityReport:
    """Run comprehensive data quality checks on OHLCV bars.

    Returns a DataQualityReport with counts of issues found.
    Sets passed=False if duplicate timestamps or OHLC violations exist.
    Prints warnings to stderr but never raises.

    Args:
        df: OHLCV DataFrame to validate (may already be deduped).
        symbol: Symbol name for warnings.
        timeframe: Timeframe label for warnings.
        source_duplicate_timestamps: Wave hardening 2026-06-22, data-layer
            institutional-grade (MED fix): pre-dedup duplicate count from the
            SOURCE data. ``load_ohlcv`` deduplicates before calling this function,
            so computing dup_ts from ``df`` after dedup always returns 0, making
            the hard-gate and telemetry vacuous. Callers should capture the count
            before deduplication and pass it here so the report reflects what the
            SOURCE actually contained. The dedup is still correct; only the
            telemetry was previously untruthful.
    """
    if df.is_empty():
        return DataQualityReport(total_bars=0)

    warn_list: list[str] = []
    total = len(df)

    # ── Duplicate timestamps ──
    # Wave hardening 2026-06-22: use caller-supplied source count (pre-dedup).
    # Computing from df here would always return 0 because load_ohlcv deduplicates
    # before calling this function.
    dup_ts = source_duplicate_timestamps
    if dup_ts > 0:
        warn_list.append(f"{dup_ts} duplicate timestamps in source data (deduped before validation)")

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
    # FIX 4 (deep-scan #10 F-11): use module-level EMPIRICAL_BARS_PER_DAY (single source)
    bars_per_day_map = EMPIRICAL_BARS_PER_DAY
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
    ignore_quality_gate: bool = False,
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
        ignore_quality_gate: For test fixtures ONLY. When True, quality gate failures
            are logged but do not raise. NEVER set True in production callers.

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
    else:
        # Wave hardening 2026-06-22, data-layer institutional-grade:
        # HIGH-2(a): pass adjusted so raw and ratio_adj resolve to separate cache paths.
        cache_file = _cache_path(data_symbol, timeframe, adjusted=adjusted)
        if _is_cache_fresh(cache_file):
            # FIX 7 (deep-scan #10): verify provenance sidecar before serving from cache
            if _check_cache_sidecar(cache_file, adjusted):
                source = str(cache_file)
                print(f"Loading {data_symbol} {timeframe} from local cache ({cache_file})", file=sys.stderr)
            else:
                # Sidecar indicates cache is poisoned — fall through to S3
                source = _consolidated_s3_path(data_symbol, timeframe, adjusted=adjusted)
                print(
                    f"Loading {data_symbol} {timeframe} from S3 (cache sidecar mismatch)",
                    file=sys.stderr,
                )
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

    # F-2 fix: verify adjusted-ratio on EVERY code path (was local_path only).
    # Cache paths contain ratio-adjusted data by construction (CLAUDE.md §13 + cache write guard).
    # This call is a no-op when adjusted=False (the earlier warning covers that case).
    # Pass 5 Track A F-1: pass from_cache=True so cache-rooted paths bypass the substring check.
    _from_cache = source.startswith(str(CACHE_DIR))
    _verify_ratio_adjusted_source(source, adjusted, from_cache=_from_cache)

    # Deep-scan #21 Wave-2 MED: refuse an S3 read with a clean exception when AWS
    # creds are absent, instead of risking a DuckDB native crash (see guard docstring
    # above _check_s3_read_config). No-op for local_path / cache sources.
    _check_s3_read_config(source)

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
            # Wave hardening 2026-06-22, data-layer institutional-grade:
            # HIGH-2(b): verify adjusted source on legacy fallback BEFORE using/caching.
            # Previously the guard was only on the primary path; a raw fallback with
            # adjusted=True would silently serve unadjusted data (and poison the cache).
            _verify_ratio_adjusted_source(legacy, adjusted, from_cache=False)
            # Deep-scan #21 Wave-2 MED: same pre-flight guard on the legacy fallback
            # S3 read — defense in depth in case a future caller reaches this branch
            # without having gone through the primary source's guard above.
            _check_s3_read_config(legacy)
            legacy_sql = f"""
                SELECT ts_event, open, high, low, close, volume
                FROM read_parquet('{legacy}')
                WHERE ts_event >= '{start}' AND ts_event < '{end}T23:59:59.999999999'
                ORDER BY ts_event
            """
            try:
                pdf = con.execute(legacy_sql).fetchdf()
            except Exception as _leg_err:
                # FIX 8 (deep-scan #10 F-12): sanitize DuckDB error to avoid leaking S3 bucket paths
                _bucket = os.environ.get("S3_BUCKET", "trading-forge-data")
                _detail = str(_leg_err)
                print(f"[debug] Legacy DuckDB error {data_symbol} {timeframe}: {_detail}", file=sys.stderr)
                _sanitized = _detail.replace(legacy, "[s3-path-redacted]").replace(_bucket, "[bucket]")
                raise RuntimeError(
                    f"Failed to load {data_symbol} {timeframe} from S3 (legacy path): {_sanitized}"
                ) from None
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
        # Wave hardening 2026-06-22, data-layer institutional-grade:
        # HIGH-2(a): pass adjusted so cache write lands in the correct subfolder.
        cache_file = _cache_path(data_symbol, timeframe, adjusted=adjusted)
        _should_write_cache = not _is_cache_fresh(cache_file)  # Write if missing OR stale
        if _should_write_cache:
            try:
                cache_file.parent.mkdir(parents=True, exist_ok=True)
                # M4 FIX: Atomic cache write — write to a PID-tagged temp file first,
                # then os.replace() (atomic on both POSIX and Windows NTFS). This prevents
                # two parallel WF workers from writing simultaneously and corrupting the
                # shared cache file (race condition observed on Phase 14 stress tests).
                # No external lock library needed — os.replace() is atomic by OS guarantee.
                import os as _os_m4
                tmp_cache = cache_file.with_suffix(f".tmp.{_os_m4.getpid()}")
                # Re-fetch the FULL dataset (no date filter) for caching so future
                # date-range requests (including crisis scenarios in stress_test.py
                # that need 2008-2020 data) all hit the local cache.
                full_sql = f"SELECT ts_event, open, high, low, close, volume FROM read_parquet('{source}') ORDER BY ts_event"
                # deepscan16 Wave-1 Track2 CRITICAL E-4: track WHICH dataframe actually
                # landed on disk (full_df vs the date-filtered `df` fallback) so the
                # sidecar's dataset_hash/range fields describe the real cached bytes,
                # never the wider dataset we merely intended to write.
                _cache_write_is_partial = False
                _written_df = None
                try:
                    full_pdf = con.execute(full_sql).fetchdf()
                    full_df = pl.from_pandas(full_pdf)
                    full_df.write_parquet(str(tmp_cache), compression="zstd")
                    _written_df = full_df
                except Exception as _full_fetch_err:
                    # Full-history re-fetch failed — the ONLY data we have is the
                    # already date-filtered `df` from this request. Previously this
                    # slice was written under the identical full-history cache key
                    # with no marker, so every OTHER caller (including crisis-window
                    # backtests needing 2008-2020 data) would silently read a
                    # truncated "complete history" cache. Now: still write it (better
                    # than nothing for THIS request's own range) but flag it
                    # is_partial=True in the sidecar so _check_cache_sidecar refuses
                    # to serve it as complete history on the next read.
                    print(
                        f"WARNING: full-history re-fetch failed for {data_symbol} {timeframe} "
                        f"({_full_fetch_err!r}); caching date-filtered slice "
                        f"[{start}..{end}] as PARTIAL — will not be trusted as complete "
                        f"history by future reads",
                        file=sys.stderr,
                    )
                    df.write_parquet(str(tmp_cache), compression="zstd")
                    _written_df = df
                    _cache_write_is_partial = True
                # Atomic replace — other readers see either old or new, never partial write
                _os_m4.replace(str(tmp_cache), str(cache_file))
                size_kb = cache_file.stat().st_size / 1024
                _write_kind = "PARTIAL slice" if _cache_write_is_partial else "full history"
                print(
                    f"Cache atomic-write ({_write_kind}): {data_symbol} {timeframe} → "
                    f"{cache_file} ({size_kb:.0f} KB)",
                    file=sys.stderr,
                )
                # FIX 7 (deep-scan #10) + E-4: write provenance sidecar alongside the
                # cache file, describing the dataframe that was ACTUALLY written
                # (_written_df), not the filtered `df` from this request's own query.
                _range_start_val = None
                _range_end_val = None
                try:
                    if _written_df is not None and len(_written_df) > 0 and "ts_event" in _written_df.columns:
                        _range_start_val = str(_written_df["ts_event"].min())
                        _range_end_val = str(_written_df["ts_event"].max())
                except Exception:
                    pass
                _write_cache_sidecar(
                    cache_file,
                    source=source,
                    adjusted=adjusted,
                    dataset_hash=compute_dataset_hash(_written_df if _written_df is not None else df),
                    is_partial=_cache_write_is_partial,
                    range_start=_range_start_val,
                    range_end=_range_end_val,
                )
            except Exception as e:
                # Clean up temp file if atomic replace failed
                try:
                    import os as _os_cleanup
                    _tmp = cache_file.with_suffix(f".tmp.{_os_cleanup.getpid()}")
                    if _tmp.exists():
                        _tmp.unlink()
                except Exception:
                    pass
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
    # Wave hardening 2026-06-22, data-layer institutional-grade (MED fix):
    # Pass the pre-dedup SOURCE duplicate count so the report reflects what the
    # source data actually contained, not the already-deduped DataFrame.
    quality_report = validate_bars(df, symbol, timeframe, source_duplicate_timestamps=deduped)
    # FIX 6 (deep-scan #10): populate dataset_hash — compute_dataset_hash() was implemented
    # but never wired into the quality report; field was always "".
    quality_report.dataset_hash = compute_dataset_hash(df)
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
        "dataset_hash": quality_report.dataset_hash,  # FIX 6: now real (was "")
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
        elif ignore_quality_gate:
            # F-3 fix: local_path no longer bypasses the gate automatically.
            # Callers must EXPLICITLY pass ignore_quality_gate=True (test fixtures only).
            print(
                f"WARNING: DATA QUALITY GATE FAILED (ignore_quality_gate=True override) for {symbol} {timeframe}: "
                f"{'; '.join(critical)}",
                file=sys.stderr,
            )
        else:
            raise ValueError(
                f"DATA QUALITY GATE FAILED for {symbol} {timeframe}: {'; '.join(critical)}"
            )

    return df


# ─── Multi-Timeframe Loader ──────────────────────────────────────────

def load_with_htf(
    symbol: str,
    exec_tf: str,
    htf: str,
    start: str,
    end: str,
    local_path: Optional[str] = None,
    htf_local_path: Optional[str] = None,
    adjusted: bool = True,
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Load exec-TF and HTF data for a symbol (sequential load_ohlcv calls).

    This is a THIN WRAPPER over load_ohlcv(). The existing load_ohlcv() function
    is called twice — once for the execution timeframe, once for the HTF. No
    new loading logic; the wrapper exists so callers have a single import point
    for multi-TF loading.

    Both calls reuse the same singleton DuckDB connection and benefit from local
    cache. The practical latency is the same as two sequential load_ohlcv() calls
    (both typically cache hits after the first backtest).

    Args:
        symbol: Futures symbol (MES, MNQ, MCL, etc.)
        exec_tf: Execution timeframe (e.g. '15m', '5m').
        htf: Higher timeframe (e.g. '4h', '1d'). Must be higher than exec_tf.
        start: Start date YYYY-MM-DD.
        end: End date YYYY-MM-DD.
        local_path: Optional local path for exec-TF data (for testing).
        htf_local_path: Optional local path for HTF data (for testing).
        adjusted: Use ratio-adjusted data (default True).

    Returns:
        Tuple (exec_df, htf_df) — both Polars DataFrames with ts_event column.

    Raises:
        ValueError: if either load_ohlcv() fails (no data found).
    """
    exec_df = load_ohlcv(
        symbol=symbol,
        timeframe=exec_tf,
        start=start,
        end=end,
        local_path=local_path,
        adjusted=adjusted,
    )
    htf_df = load_ohlcv(
        symbol=symbol,
        timeframe=htf,
        start=start,
        end=end,
        local_path=htf_local_path,
        adjusted=adjusted,
    )
    return exec_df, htf_df


# ─── N-Timeframe Loader (W25.4) ──────────────────────────────────────

def load_n_timeframes(
    symbol: str,
    timeframes: list[str],
    start: str,
    end: str,
    adjusted: bool = True,
) -> dict[str, pl.DataFrame]:
    """Load N timeframes via sequential load_ohlcv calls (cache-friendly).

    Returns a dict keyed by timeframe string (e.g. {"1m": df, "15m": df, "4h": df}).
    Duplicate timeframe strings are deduplicated — only the first occurrence loads.
    Daily ("daily" or "1d") ALWAYS loads regardless of this list (engine invariant);
    however if the caller includes "daily" or "1d" explicitly it is still loaded here.

    Args:
        symbol: Futures symbol (MES, MNQ, MCL, etc.)
        timeframes: List of timeframe strings. Duplicates are deduplicated.
        start: Start date YYYY-MM-DD.
        end: End date YYYY-MM-DD.
        adjusted: Use ratio-adjusted data (default True).

    Returns:
        Dict mapping each unique timeframe string to its loaded Polars DataFrame.

    Raises:
        ValueError: if timeframes list is empty.
        ValueError: if any load_ohlcv() call fails (no data found).
    """
    if not timeframes:
        raise ValueError("load_n_timeframes: timeframes list must not be empty")

    # Deduplicate preserving order
    seen: set[str] = set()
    unique_tfs: list[str] = []
    for tf in timeframes:
        if tf not in seen:
            seen.add(tf)
            unique_tfs.append(tf)

    result: dict[str, pl.DataFrame] = {}
    for tf in unique_tfs:
        result[tf] = load_ohlcv(
            symbol=symbol,
            timeframe=tf,
            start=start,
            end=end,
            adjusted=adjusted,
        )
    return result


def resample_daily_to_weekly(daily_df: pl.DataFrame) -> pl.DataFrame:
    """ISO-week aggregation: Monday 00:00 UTC → one weekly bar per ISO week.

    Used by pre-market routine for strict ISO-week PWH/PWL (Pass 2.5).
    The S3 bucket has no weekly TF folder — this resamples from daily bars in-engine.

    The group_by_dynamic with every="1w", closed="left", label="left" anchors each
    group to the Monday start of each ISO week (Polars uses Mon as week start).
    Output ts_event = Monday 00:00 UTC for each week.

    Args:
        daily_df: Daily OHLCV Polars DataFrame with ts_event column.

    Returns:
        Weekly OHLCV DataFrame (one row per ISO week). Immutable — original unchanged.

    Raises:
        ValueError: if ts_event column is missing from daily_df.
    """
    if "ts_event" not in daily_df.columns:
        raise ValueError("resample_daily_to_weekly: daily_df must have 'ts_event' column")

    return (
        daily_df
        .sort("ts_event")
        .group_by_dynamic("ts_event", every="1w", closed="left", label="left")
        .agg([
            pl.col("open").first(),
            pl.col("high").max(),
            pl.col("low").min(),
            pl.col("close").last(),
            pl.col("volume").sum(),
        ])
    )


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


def _dl_nth_weekday(year: int, month: int, weekday: int, n: int) -> "date":  # noqa: F821
    """Return the n-th occurrence (1-based) of weekday (0=Mon, 3=Thu, 4=Fri) in month.

    Wave hardening 2026-06-22, data-layer institutional-grade:
    Mirrors roll_calendar._nth_weekday — kept as a local copy to avoid a
    circular import (roll_calendar does not import data_loader).
    roll_calendar._nth_weekday is the CANONICAL implementation; any change
    there must be reflected here.
    """
    from datetime import date, timedelta
    first = date(year, month, 1)
    delta = (weekday - first.weekday()) % 7
    first_occurrence = first + timedelta(days=delta)
    return first_occurrence + timedelta(weeks=n - 1)


def _second_thursday_before_third_friday(year: int, month: int) -> "date":  # noqa: F821
    """CME-correct equity index rollover: 2nd Thursday of the delivery month.

    Wave hardening 2026-06-22, data-layer institutional-grade: HIGH-1 fix.

    The old implementation computed ``3rd Friday − 8 days``, which produces
    the wrong date when the 3rd Friday falls on the 15th of the month.
    Example: 2024-03 — 3rd Friday = Mar 15; 3rdFri − 8 = Mar 7 (wrong).
    CME-correct roll day for that quarter = 2nd Thursday = Mar 14, 2024.

    The authoritative formula is in roll_calendar._equity_quarterly_roll_day:
    ``_nth_weekday(year, month, 3, 2)`` — 2nd Thursday (weekday 3).
    We delegate to the same formula via the local _dl_nth_weekday copy to
    avoid a circular import. Parity tested against roll_calendar for all
    4 quarters of 2023–2029 in test_data_loader.py::TestRolloverDateParity.
    """
    return _dl_nth_weekday(year, month, 3, 2)  # weekday 3 = Thursday, 2nd occurrence


def _equity_index_rollover_dates(start_year: int, end_year: int) -> list["date"]:  # noqa: F821
    """Compute equity-index (ES/MES/NQ/MNQ) rollover dates.

    Equity index futures roll quarterly (Mar/Jun/Sep/Dec). Rollover date is the
    2nd Thursday before 3rd Friday of the delivery month.
    """
    from datetime import date
    dates_list: list[date] = []
    for year in range(start_year, end_year + 1):
        for month in [3, 6, 9, 12]:
            dates_list.append(_second_thursday_before_third_friday(year, month))
    return dates_list


def _crude_oil_rollover_dates(start_year: int, end_year: int) -> list["date"]:  # noqa: F821
    """Compute crude oil (CL/MCL) rollover dates.

    CL rolls every month. The rollover date is the business day BEFORE the 25th
    calendar day of the month PRECEDING the delivery month.

    Example: CL May contract (delivery = May) rolls in late April.
    The 25th of April is the reference; step back one business day.
    If April 25 is Saturday → go to April 24 (Fri), then step back one biz day
    → April 23 (Thu) is the rollover.

    Per CME published schedule: CME Rule 104.12.
    """
    from datetime import date, timedelta
    dates_list: list[date] = []
    for year in range(start_year, end_year + 1):
        for month in range(1, 13):
            # The 25th of the prior month (month preceding delivery month)
            # Delivery month = month; prior month = month - 1 (wrap: Dec → Jan prev year)
            # We iterate over the month that PRECEDES the delivery month.
            # Simpler: for delivery month M, roll_reference = 25th of month M-1.
            # We iterate by roll_reference month directly.
            roll_ref = date(year, month, 25)
            # Step back to the previous business day (the roll_reference itself
            # must be a business day, otherwise step back further)
            candidate = roll_ref - timedelta(days=1)
            while candidate.weekday() >= 5:  # Sat=5, Sun=6
                candidate -= timedelta(days=1)
            dates_list.append(candidate)
    return dates_list


def compute_rollover_dates(
    symbol: str,
    start_year: int,
    end_year: int,
) -> list["date"]:  # noqa: F821
    """Compute standard rollover dates for a futures symbol across a year range.

    F-1 fix: Added per-symbol dispatch so CL/MCL use the correct crude oil
    rollover formula (business day before the 25th of the prior month) instead
    of the equity index formula (2nd Thursday before 3rd Friday).

    Args:
        symbol: Futures symbol (ES, MES, NQ, MNQ, CL, MCL)
        start_year: First year (inclusive)
        end_year: Last year (inclusive)

    Returns:
        Sorted list of datetime.date objects representing rollover days

    Raises:
        ValueError: If the symbol does not have a known rollover schedule.
    """
    if symbol in ("ES", "MES", "NQ", "MNQ"):
        return sorted(_equity_index_rollover_dates(start_year, end_year))
    elif symbol in ("CL", "MCL"):
        return sorted(_crude_oil_rollover_dates(start_year, end_year))
    else:
        # Graceful fallback — unknown symbol uses equity quarterly schedule with a warning.
        import warnings as _w
        _w.warn(
            f"compute_rollover_dates: unknown rollover schedule for '{symbol}'. "
            f"Falling back to equity quarterly (Mar/Jun/Sep/Dec). "
            f"Add explicit handling for this symbol."
        )
        from datetime import date
        months = ROLLOVER_MONTHS.get(symbol, [3, 6, 9, 12])
        dates_list: list[date] = []
        for year in range(start_year, end_year + 1):
            for month in months:
                dates_list.append(_second_thursday_before_third_friday(year, month))
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

    # Extract calendar date from each bar's timestamp.
    # M5 FIX: Use ts_et (Eastern Time) not ts_event (UTC) — roll dates are
    # calendar dates in ET (CME announces "March 13 rollover" meaning ET).
    # With UTC timestamps, bars near midnight ET would be assigned the wrong
    # roll date (e.g. 23:00 ET on March 12 = 04:00 UTC on March 13 — UTC date
    # says March 13 but ET date is still March 12, causing premature suppression).
    ts_date_col = "ts_et" if "ts_et" in df.columns else "ts_event"
    if ts.dtype == pl.Utf8:
        date_col = pl.col(ts_date_col).str.slice(0, 10)
    else:
        date_col = pl.col(ts_date_col).dt.date().cast(pl.Utf8)

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
