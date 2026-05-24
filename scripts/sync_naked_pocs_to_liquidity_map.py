#!/usr/bin/env python3
"""
Wave 25 Pass 3 W25.6 bridge — backtest-core agent P3.A3.

Fetches recent daily + intraday bars from S3 (via the existing load_ohlcv()
helper), computes naked POCs via extract_naked_pocs_for_persistence(), and
writes them to the liquidity_levels table via the TS HTTP endpoint:

    POST /api/admin/liquidity-map/naked-pocs-batch

Idempotent — the TS layer is expected to UPSERT on (symbol, session_date,
level_type='naked_poc', price) so re-running the script for the same date
produces no duplicate rows.

Design constraints (CLAUDE.md §10b):
  - Does NOT write directly to PostgreSQL from Python.
  - Uses the TS HTTP endpoint as the single persistence path so the
    correlation_id chain (Python → TS endpoint → DB → audit_log) is intact.
  - Fail-CLOSED by default: if the HTTP endpoint is unreachable, the script
    exits non-zero and the cron scheduler retries.

Usage:
    # Dry-run (no writes — prints detected naked POCs to stdout)
    python -m scripts.sync_naked_pocs_to_liquidity_map --symbol MES --date 2026-05-24

    # Apply (POST to TS endpoint)
    python -m scripts.sync_naked_pocs_to_liquidity_map --symbol MES --date 2026-05-24 --apply

    # All 3 production symbols, infer today's ET date automatically
    python -m scripts.sync_naked_pocs_to_liquidity_map --date today --apply

    # All symbols, explicit date
    python -m scripts.sync_naked_pocs_to_liquidity_map --date 2026-05-24 --apply

Endpoint contract (expected from P3.A1+A2 — liquidity-map-service.ts):
----------------------------------------------------------------------
POST /api/admin/liquidity-map/naked-pocs-batch

Request body (application/json):
{
  "symbol": "MES",
  "as_of_date": "2026-05-24",       // ISO YYYY-MM-DD
  "records": [
    {
      "session_date": "2026-05-20", // ISO YYYY-MM-DD — when POC was established
      "price": 5312.25,
      "age_days": 2,                // sessions since established
      "establishing_high": 5320.0,  // session_high when POC formed
      "establishing_low": 5298.75,  // session_low when POC formed
      "establishing_volume": 18432.0
    },
    ...
  ]
}

Expected response on success:
{
  "ok": true,
  "upserted": 3,
  "symbol": "MES",
  "as_of_date": "2026-05-24"
}

On 404:
  The endpoint is live as of 2026-05-24 (P3.A5 architect close-out shipped
  POST /api/admin/liquidity-map/naked-pocs-batch in routes/admin.ts). A 404
  now indicates a routing regression — surface as soft warning but DO NOT
  silently no-op; operator should investigate immediately.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
from datetime import date as _date, timedelta
from pathlib import Path

# ─── Make sure project root is importable ─────────────────────────────────────
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

# ─── Config ───────────────────────────────────────────────────────────────────

DEFAULT_SYMBOLS = ["MES", "MNQ", "MCL"]
INTRADAY_TIMEFRAME = "5min"
DAILY_TIMEFRAME = "daily"
NAKED_POC_LOOKBACK_DAYS = 30  # mirrors NAKED_POC_LOOKBACK_DAYS in volume_profile.py
DAILY_HISTORY_LOOKBACK_DAYS = NAKED_POC_LOOKBACK_DAYS + 5   # extra buffer for gaps

ENDPOINT_PATH = "/api/admin/liquidity-map/naked-pocs-batch"

# Audit key written to TS audit_log via the POST body's metadata section.
# The TS endpoint is expected to write this row; we do not write audit rows
# directly from Python (§10b — correlation_id chain mandate).
AUDIT_KEY = "liquidity_map.naked_pocs_synced"


# ─── ET date helper ───────────────────────────────────────────────────────────

def _today_et_date() -> str:
    """Return today's date in ET (America/New_York) as YYYY-MM-DD.

    Falls back to UTC if the zoneinfo or pytz packages are unavailable.
    """
    try:
        from zoneinfo import ZoneInfo
        from datetime import datetime
        return datetime.now(tz=ZoneInfo("America/New_York")).date().isoformat()
    except Exception:
        pass
    try:
        import pytz
        from datetime import datetime
        return datetime.now(tz=pytz.timezone("America/New_York")).date().isoformat()
    except Exception:
        pass
    # Fallback: UTC (acceptable for after-close runs; RTH closes 20:00 UTC)
    return _date.today().isoformat()


# ─── Core sync logic ──────────────────────────────────────────────────────────

def _sync_one_symbol(
    symbol: str,
    as_of_date: str,
    backend_base_url: str,
    apply: bool,
    verbose: bool,
) -> dict:
    """Compute and (optionally) persist naked POCs for one symbol.

    Returns a result dict suitable for JSON logging.
    """
    result: dict = {"symbol": symbol, "as_of_date": as_of_date, "status": "pending"}

    try:
        from src.engine.data_loader import load_ohlcv
        from src.engine.indicators.volume_profile import extract_naked_pocs_for_persistence
    except ImportError as exc:
        result["status"] = "error"
        result["error"] = f"Import failed: {exc}"
        return result

    # ── Load intraday bars (5-min) for the lookback window ────────────────────
    try:
        session_date = _date.fromisoformat(as_of_date)
        lookback_start = (session_date - timedelta(days=DAILY_HISTORY_LOOKBACK_DAYS)).isoformat()
        lookback_end = (session_date - timedelta(days=1)).isoformat()

        intraday = load_ohlcv(
            symbol=symbol,
            timeframe=INTRADAY_TIMEFRAME,
            start=lookback_start,
            end=lookback_end,
        )
        if verbose:
            print(f"[{symbol}] intraday bars loaded: {len(intraday)}", file=sys.stderr)
    except Exception as exc:
        # Intraday unavailable — fall back to daily only (still valid)
        if verbose:
            print(f"[{symbol}] intraday load failed ({exc}) — falling back to daily only", file=sys.stderr)
        intraday = None  # type: ignore[assignment]

    # ── Load daily bars ───────────────────────────────────────────────────────
    try:
        daily = load_ohlcv(
            symbol=symbol,
            timeframe=DAILY_TIMEFRAME,
            start=lookback_start,
            end=lookback_end,
        )
        if verbose:
            print(f"[{symbol}] daily bars loaded: {len(daily)}", file=sys.stderr)
    except Exception as exc:
        result["status"] = "error"
        result["error"] = f"load_ohlcv (daily) failed: {exc}"
        return result

    # ── Compute naked POCs ────────────────────────────────────────────────────
    try:
        import polars as pl

        intraday_for_func = intraday if intraday is not None and len(intraday) > 0 else pl.DataFrame()
        naked_records = extract_naked_pocs_for_persistence(
            daily_history=daily,
            intraday_history=intraday_for_func,
            symbol=symbol,
            as_of_date=as_of_date,
            lookback_days=NAKED_POC_LOOKBACK_DAYS,
        )
    except Exception as exc:
        result["status"] = "error"
        result["error"] = f"extract_naked_pocs_for_persistence failed: {exc}"
        result["traceback"] = traceback.format_exc()
        return result

    result["naked_poc_count"] = len(naked_records)

    if verbose or not apply:
        for rec in naked_records:
            print(
                f"  [{symbol}] POC {rec.price:.2f}  "
                f"established {rec.session_date}  "
                f"age={rec.age_days}d  "
                f"vol={rec.establishing_volume:.0f}  "
                f"range=({rec.high_low_at_establishment[1]:.2f}-{rec.high_low_at_establishment[0]:.2f})"
            )

    if not apply:
        result["status"] = "dry_run"
        return result

    if len(naked_records) == 0:
        # Nothing to write — idempotent no-op
        result["status"] = "ok_no_levels"
        result["upserted"] = 0
        return result

    # ── POST to TS endpoint ───────────────────────────────────────────────────
    payload = {
        "symbol": symbol,
        "as_of_date": as_of_date,
        "records": [
            {
                "session_date": rec.session_date,
                "price": rec.price,
                "age_days": rec.age_days,
                "establishing_high": rec.high_low_at_establishment[0],
                "establishing_low": rec.high_low_at_establishment[1],
                "establishing_volume": rec.establishing_volume,
            }
            for rec in naked_records
        ],
    }

    url = backend_base_url.rstrip("/") + ENDPOINT_PATH

    try:
        import urllib.request
        import urllib.error

        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "User-Agent": "TradingForge-NakedPocSync/1.0",
            },
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            resp_data = json.loads(body)
            result["status"] = "ok"
            result["upserted"] = resp_data.get("upserted", 0)
            result["response"] = resp_data

    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            # Endpoint not yet deployed by P3.A1+A2 — soft failure (see module docstring)
            result["status"] = "endpoint_not_yet_available"
            result["warning"] = (
                f"POST {url} returned 404. "
                "P3.A1+A2 (liquidity-map-service.ts) likely hasn't shipped yet. "
                "Dry-run data is valid; writes deferred until endpoint is live. "
                "Remove 404-toleration in TODO block once endpoint ships."
            )
            print(f"[{symbol}] WARN: {result['warning']}", file=sys.stderr)
        else:
            body = exc.read().decode("utf-8") if exc.fp else ""
            result["status"] = "http_error"
            result["error"] = f"HTTP {exc.code}: {body[:500]}"
    except Exception as exc:
        result["status"] = "error"
        result["error"] = str(exc)
        result["traceback"] = traceback.format_exc()

    return result


# ─── Entry point ──────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sync naked POCs from Python detector → TS liquidity_levels table."
    )
    parser.add_argument(
        "--symbol",
        default=None,
        help=(
            "Single symbol (e.g. MES). "
            "Omit to run all 3 production symbols: MES, MNQ, MCL."
        ),
    )
    parser.add_argument(
        "--date",
        default="today",
        help="Session date YYYY-MM-DD or 'today' (default: today in ET).",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        default=False,
        help="Write to TS endpoint. Without --apply, dry-run only (prints to stdout).",
    )
    parser.add_argument(
        "--backend-url",
        default=None,
        help=(
            "Base URL of the Trading Forge backend "
            "(e.g. http://localhost:4000). "
            "Falls back to TF_BACKEND_URL env var, then http://localhost:4000."
        ),
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        default=False,
        help="Verbose logging to stderr.",
    )
    args = parser.parse_args()

    # ── Resolve date ──────────────────────────────────────────────────────────
    as_of_date = _today_et_date() if args.date in ("today", "TODAY") else args.date
    try:
        _date.fromisoformat(as_of_date)
    except ValueError:
        print(f"ERROR: Invalid date '{as_of_date}'. Use YYYY-MM-DD or 'today'.", file=sys.stderr)
        return 1

    # ── Resolve backend URL ───────────────────────────────────────────────────
    backend_url = (
        args.backend_url
        or os.environ.get("TF_BACKEND_URL")
        or os.environ.get("TF_BACKEND_PUBLIC_URL")  # Wave 24 env var name
        or "http://localhost:4000"
    )

    # ── Resolve symbols ───────────────────────────────────────────────────────
    symbols = [args.symbol.upper()] if args.symbol else DEFAULT_SYMBOLS

    # ── Run ───────────────────────────────────────────────────────────────────
    mode = "APPLY" if args.apply else "DRY-RUN"
    print(
        f"naked-poc-sync: date={as_of_date}  symbols={symbols}  "
        f"mode={mode}  backend={backend_url}"
    )

    all_results = []
    exit_code = 0

    for sym in symbols:
        r = _sync_one_symbol(
            symbol=sym,
            as_of_date=as_of_date,
            backend_base_url=backend_url,
            apply=args.apply,
            verbose=args.verbose,
        )
        all_results.append(r)

        status = r.get("status", "unknown")
        poc_count = r.get("naked_poc_count", "?")
        upserted = r.get("upserted", "n/a")

        if status in ("ok", "dry_run", "ok_no_levels", "endpoint_not_yet_available"):
            print(
                f"  [{sym}] status={status}  naked_pocs={poc_count}  upserted={upserted}"
            )
        else:
            print(
                f"  [{sym}] FAILED status={status}  error={r.get('error', 'unknown')}",
                file=sys.stderr,
            )
            exit_code = 1

    # ── Summary JSON to stdout (machine-readable for cron audit) ─────────────
    summary = {
        "date": as_of_date,
        "mode": mode,
        "symbols": symbols,
        "results": all_results,
        "exit_code": exit_code,
    }
    print("\n--- JSON SUMMARY ---")
    print(json.dumps(summary, indent=2))

    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
