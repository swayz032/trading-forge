"""Cache pre-warm script — populate local Parquet cache for all active strategy symbols.

Run this once before firing walk-forward backtests to ensure all S3 data is
cached locally. Subsequent backtests hit disk instead of S3 and complete
in < 90 seconds instead of timing out.

Usage:
    python -m src.engine.cache_prewarm

Or with BACKTEST_CACHE_BUST=1 to force-refresh all existing cached files:
    BACKTEST_CACHE_BUST=1 python -m src.engine.cache_prewarm

Per CLAUDE.md §13: only ratio_adj/consolidated data is cached here.
Raw/unadjusted data is NEVER written to the local cache.
"""

from __future__ import annotations

import sys
import time

# Symbols and timeframes used by current strategy library.
# Add new entries when new strategy types are onboarded.
# Symbols use data_symbol convention (full-size equivalents):
#   MES → ES, MNQ → NQ, MCL → CL
PREWARM_TARGETS: list[tuple[str, str]] = [
    # ES (covers MES strategies)
    ("ES", "5min"),
    ("ES", "15min"),
    ("ES", "1hour"),
    ("ES", "daily"),
    # NQ (covers MNQ strategies)
    ("NQ", "5min"),
    ("NQ", "15min"),
    ("NQ", "1hour"),
    ("NQ", "daily"),
    # CL (covers MCL strategies)
    ("CL", "5min"),
    ("CL", "15min"),
    ("CL", "1hour"),
    ("CL", "daily"),
]


def prewarm_cache() -> dict:
    """Download all required Parquet files from S3 to local cache.

    Returns:
        Summary dict with per-symbol results and total time.
    """
    from src.engine.data_loader import _cache_path, _is_cache_fresh, sync_from_s3

    results = []
    start_total = time.perf_counter()

    for symbol, timeframe in PREWARM_TARGETS:
        cache_file = _cache_path(symbol, timeframe)
        t0 = time.perf_counter()

        if _is_cache_fresh(cache_file):
            age_h = (time.time() - cache_file.stat().st_mtime) / 3600
            size_kb = cache_file.stat().st_size / 1024
            print(
                f"SKIP {symbol}/{timeframe}: cache fresh ({age_h:.1f}h old, {size_kb:.0f} KB)",
                file=sys.stderr,
            )
            results.append({
                "symbol": symbol, "timeframe": timeframe,
                "status": "skip_fresh", "elapsed_s": 0.0,
                "size_kb": size_kb,
            })
            continue

        try:
            out = sync_from_s3(symbol, timeframe)
            elapsed = time.perf_counter() - t0
            size_kb = out.stat().st_size / 1024
            print(
                f"OK   {symbol}/{timeframe}: {size_kb:.0f} KB in {elapsed:.1f}s",
                file=sys.stderr,
            )
            results.append({
                "symbol": symbol, "timeframe": timeframe,
                "status": "ok", "elapsed_s": round(elapsed, 1),
                "size_kb": round(size_kb, 0),
            })
        except Exception as e:
            elapsed = time.perf_counter() - t0
            print(
                f"FAIL {symbol}/{timeframe}: {e} ({elapsed:.1f}s)",
                file=sys.stderr,
            )
            results.append({
                "symbol": symbol, "timeframe": timeframe,
                "status": "error", "elapsed_s": round(elapsed, 1),
                "error": str(e),
            })

    total_elapsed = time.perf_counter() - start_total
    ok_count = sum(1 for r in results if r["status"] == "ok")
    skip_count = sum(1 for r in results if r["status"] == "skip_fresh")
    fail_count = sum(1 for r in results if r["status"] == "error")

    print(
        f"\nPre-warm complete: {ok_count} fetched, {skip_count} skipped (fresh), "
        f"{fail_count} failed — total {total_elapsed:.1f}s",
        file=sys.stderr,
    )
    return {
        "results": results,
        "total_elapsed_s": round(total_elapsed, 1),
        "ok": ok_count,
        "skip_fresh": skip_count,
        "failed": fail_count,
    }


if __name__ == "__main__":
    import json
    summary = prewarm_cache()
    print(json.dumps(summary))
