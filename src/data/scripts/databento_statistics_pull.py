"""
W19 Schema 2 — Databento Statistics Pull

Fetches the Statistics schema (daily settlement price + open interest) for
ES/NQ/MES/MNQ/MCL from GLBX.MDP3.

Statistics schema is FREE (included with any historical data license).

Outputs structured JSON for the Node scheduler to persist to daily_statistics table.
Also used for:
  - PnL reconciliation: backtest close price vs CME official settlement
  - OI liquidity filter: block entries on contracts with >20% OI decline over 5 days
  - Stress test scenarios: use real settlement prices instead of bar-close approximations

Usage:
    python databento_statistics_pull.py --start 2025-01-01 --end 2025-01-31 --output-json
    python databento_statistics_pull.py --lookback-days 30 --output-json
    python databento_statistics_pull.py --lookback-days 5 --output-json  (default for daily cron)
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

DATASET = "GLBX.MDP3"

# Continuous front-month contracts
SYMBOL_MAP: dict[str, str] = {
    "ES":  "ES.c.0",
    "NQ":  "NQ.c.0",
    "MES": "MES.c.0",
    "MNQ": "MNQ.c.0",
    "MCL": "MCL.c.0",
}

# Databento Statistics stat_type codes (from MDP3 schema)
# 1 = daily settlement price
# 2 = open interest
# We request all stat_types and filter by these
STAT_TYPE_SETTLEMENT = 1
STAT_TYPE_OI = 2


def get_client():
    import databento as db
    api_key = os.environ.get("DATABENTO_API_KEY")
    if not api_key:
        raise RuntimeError("DATABENTO_API_KEY not set in environment")
    return db.Historical(api_key)


def pull_statistics(
    client,
    symbol: str,
    start_date: str,
    end_date: str,
) -> list[dict[str, Any]]:
    """
    Pull Statistics schema records for a single symbol over the date range.
    Returns a list of dicts, one per trading day, with settlement + OI.
    """
    import databento as db

    dbn_symbol = SYMBOL_MAP.get(symbol)
    if not dbn_symbol:
        raise ValueError(f"Unknown symbol: {symbol}. Known: {list(SYMBOL_MAP.keys())}")

    data = client.timeseries.get_range(
        dataset=DATASET,
        symbols=[dbn_symbol],
        stype_in="continuous",
        schema="statistics",
        start=start_date,
        end=end_date,
    )

    df = data.to_df()
    if df is None or len(df) == 0:
        return []

    # Statistics schema: one row per stat_type per ts_ref (date)
    # We need to pivot: group by date, collect settlement + OI
    import polars as pl
    df_pl = pl.from_pandas(df.reset_index())

    # Normalize ts_event/ts_ref to date
    # Databento statistics rows have ts_ref = the reference date (YYYYMMDD as nanoseconds or date col)
    # ts_event = when the stat was published
    # We group by the calendar date of ts_ref
    if "ts_ref" in df_pl.columns:
        date_col = "ts_ref"
    elif "ts_event" in df_pl.columns:
        date_col = "ts_event"
    else:
        date_col = df_pl.columns[0]  # fallback: first column

    # Cast to date for grouping
    if df_pl[date_col].dtype in (pl.Datetime, pl.Date):
        df_pl = df_pl.with_columns(
            pl.col(date_col).cast(pl.Date).alias("_trade_date")
        )
    else:
        # Nanosecond integer
        df_pl = df_pl.with_columns(
            (pl.col(date_col).cast(pl.Int64) // 1_000_000_000)
            .map_elements(lambda ts: datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat(), return_dtype=pl.Utf8)
            .alias("_trade_date")
        )

    # Group by date and collect stat values
    # stat_type column: 1=settlement, 2=OI (per CME MDP3 spec)
    results: dict[str, dict[str, Any]] = {}

    for row in df_pl.iter_rows(named=True):
        trade_date = str(row.get("_trade_date", ""))
        if not trade_date:
            continue

        if trade_date not in results:
            results[trade_date] = {
                "symbol": symbol,
                "trade_date": trade_date,
                "settlement_price": None,
                "open_interest": None,
                "session_high": None,
                "session_low": None,
                "volume": None,
            }

        stat_type = row.get("stat_type") or row.get("type")
        price_val = row.get("price") or row.get("stat_value") or row.get("value")
        quantity_val = row.get("quantity") or row.get("stat_quantity")

        if stat_type == STAT_TYPE_SETTLEMENT and price_val is not None:
            # Databento prices in fixed-point: divide by 1e9 for actual price
            price_float = float(price_val)
            if price_float > 1e6:  # likely nanosecond-scaled fixed point
                price_float = price_float / 1e9
            results[trade_date]["settlement_price"] = price_float

        elif stat_type == STAT_TYPE_OI and quantity_val is not None:
            results[trade_date]["open_interest"] = int(quantity_val)

        # High/low/volume from standard OHLCV-adjacent fields if present
        if row.get("high") is not None and results[trade_date]["session_high"] is None:
            results[trade_date]["session_high"] = float(row["high"])
        if row.get("low") is not None and results[trade_date]["session_low"] is None:
            results[trade_date]["session_low"] = float(row["low"])
        if row.get("volume") is not None and results[trade_date]["volume"] is None:
            results[trade_date]["volume"] = int(row["volume"])

    return list(results.values())


def main() -> None:
    parser = argparse.ArgumentParser(
        description="W19: Pull Databento Statistics schema (settlement + OI)"
    )
    parser.add_argument(
        "--symbols",
        default="ES,NQ,MES,MNQ,MCL",
        help="Comma-separated symbols (default: ES,NQ,MES,MNQ,MCL)",
    )
    parser.add_argument(
        "--start",
        help="Start date YYYY-MM-DD (overrides --lookback-days)",
    )
    parser.add_argument(
        "--end",
        help="End date YYYY-MM-DD (default: today)",
    )
    parser.add_argument(
        "--lookback-days",
        type=int,
        default=5,
        help="Days back from end date (default: 5 for daily cron; use 30 for bootstrap)",
    )
    parser.add_argument(
        "--output-json",
        action="store_true",
        help="Output results as JSON (for Node subprocess parsing)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Skip actual Databento pull; return mock data (testing only)",
    )
    args = parser.parse_args()

    symbols = [s.strip() for s in args.symbols.split(",") if s.strip()]
    today = datetime.now(timezone.utc)
    end_date = args.end or today.strftime("%Y-%m-%d")
    if args.start:
        start_date = args.start
    else:
        start_dt = today - timedelta(days=args.lookback_days)
        start_date = start_dt.strftime("%Y-%m-%d")

    if args.dry_run:
        # Mock data for testing
        results = []
        for symbol in symbols:
            results.append({
                "status": "dry_run",
                "symbol": symbol,
                "start_date": start_date,
                "end_date": end_date,
                "rows": [
                    {
                        "symbol": symbol,
                        "trade_date": start_date,
                        "settlement_price": 5000.0 if symbol in ("ES", "MES") else 20000.0,
                        "open_interest": 2500000 if symbol == "ES" else 150000,
                        "session_high": 5010.0 if symbol in ("ES", "MES") else 20050.0,
                        "session_low": 4990.0 if symbol in ("ES", "MES") else 19950.0,
                        "volume": 1200000,
                    }
                ],
                "row_count": 1,
            })
        output = {
            "status": "ok",
            "mode": "dry_run",
            "pulled_at": today.isoformat(),
            "results": results,
        }
        print(json.dumps(output, indent=2, default=str))
        return

    try:
        client = get_client()
    except RuntimeError as e:
        print(json.dumps({"status": "error", "message": str(e)}))
        sys.exit(1)

    results = []
    any_error = False

    for symbol in symbols:
        try:
            rows = pull_statistics(client, symbol, start_date, end_date)
            results.append({
                "status": "ok",
                "symbol": symbol,
                "start_date": start_date,
                "end_date": end_date,
                "rows": rows,
                "row_count": len(rows),
            })
        except Exception as e:
            any_error = True
            results.append({
                "status": "error",
                "symbol": symbol,
                "message": str(e),
            })

    output = {
        "status": "error" if any_error else "ok",
        "mode": "execute",
        "pulled_at": today.isoformat(),
        "start_date": start_date,
        "end_date": end_date,
        "results": results,
    }

    if args.output_json:
        print(json.dumps(output, indent=2, default=str))
    else:
        print(f"\n{'=' * 70}")
        print("Databento Statistics Pull — W19 Schema 2")
        print(f"{'=' * 70}")
        for r in results:
            sym = r.get("symbol", "?")
            status = r.get("status", "?")
            if status == "ok":
                n = r.get("row_count", 0)
                print(f"  OK  {sym}: {n} rows ({start_date} to {end_date})")
            else:
                print(f"  ERR {sym}: {r.get('message', '?')}")
        print()

    if any_error:
        sys.exit(1)


if __name__ == "__main__":
    main()
