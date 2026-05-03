"""
W19 Schema 3 — Databento Imbalance Pull

Fetches opening auction imbalance for ES and NQ from GLBX.MDP3.
CME publishes the opening auction imbalance ~1 second before 8:30 AM ET open.
Documented predictive edge on opening direction.

Cost: ~$5/month at Databento per-message pricing (2 symbols x 250 days x 1 msg).
This is a per-message subscription, NOT the free historical tier.

The script pulls imbalance records for the 8:29–8:30 AM ET window only,
capturing the opening auction imbalance message. We use historical pull with
a tight time window to keep costs at ~1 message per symbol per day.

Usage (called by Node scheduler at 8:25 AM ET daily, weekdays):
    python databento_imbalance_pull.py --date 2025-04-30 --output-json
    python databento_imbalance_pull.py --lookback-days 5 --output-json
    python databento_imbalance_pull.py --date today --output-json

For historical backfill of the last N trading days:
    python databento_imbalance_pull.py --lookback-days 30 --output-json
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone, timedelta
from typing import Any

DATASET = "GLBX.MDP3"

# Only ES and NQ — large contracts where opening auction imbalance is meaningful
# MES/MNQ share the same auction with ES/NQ but less liquidity in their specific books
SYMBOL_MAP: dict[str, str] = {
    "ES": "ES.c.0",
    "NQ": "NQ.c.0",
}

# Auction window: 8:29:00 AM ET to 8:30:30 AM ET (captures the pre-open imbalance msg)
# In UTC: 12:29 (EDT) or 13:29 (EST)
AUCTION_START_MINUTE = 29  # 8:29 AM ET
AUCTION_END_MINUTE = 31    # 8:31 AM ET (exclusive, grab a small window past open)


def get_client():
    import databento as db
    api_key = os.environ.get("DATABENTO_API_KEY")
    if not api_key:
        raise RuntimeError("DATABENTO_API_KEY not set in environment")
    return db.Historical(api_key)


def et_to_utc_window(date_str: str) -> tuple[str, str]:
    """
    Convert a date string (YYYY-MM-DD) to a UTC window covering 8:29–8:31 AM ET.
    Handles EDT (UTC-4) and EST (UTC-5) automatically via pytz or zoneinfo.
    """
    try:
        from zoneinfo import ZoneInfo
        et_tz = ZoneInfo("America/New_York")
    except ImportError:
        import pytz
        et_tz = pytz.timezone("America/New_York")

    date = datetime.strptime(date_str, "%Y-%m-%d")

    # 8:29 AM ET
    start_et = date.replace(hour=8, minute=29, second=0, microsecond=0, tzinfo=et_tz)
    # 8:31 AM ET (2 min window to catch the imbalance message safely)
    end_et = date.replace(hour=8, minute=31, second=0, microsecond=0, tzinfo=et_tz)

    # Convert to UTC ISO format for Databento API
    start_utc = start_et.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    end_utc = end_et.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    return start_utc, end_utc


def pull_imbalance_for_date(
    client,
    symbol: str,
    date_str: str,
) -> dict[str, Any] | None:
    """
    Pull the opening auction imbalance record for a single symbol on a single date.
    Returns None if no records found (non-trading day, market holiday, etc.)
    """
    dbn_symbol = SYMBOL_MAP.get(symbol)
    if not dbn_symbol:
        raise ValueError(f"Unknown symbol: {symbol}. Known: {list(SYMBOL_MAP.keys())}")

    start_utc, end_utc = et_to_utc_window(date_str)

    data = client.timeseries.get_range(
        dataset=DATASET,
        symbols=[dbn_symbol],
        stype_in="continuous",
        schema="imbalance",
        start=start_utc,
        end=end_utc,
    )

    df = data.to_df()
    if df is None or len(df) == 0:
        return None

    # Take the record closest to 8:29:59 AM ET (highest priority pre-open message)
    # Imbalance records: ref_price = indicative price, paired_qty = matched contracts
    # near_qty = buy-side imbalance, far_qty = sell-side imbalance (CME convention)
    row = df.iloc[0]  # First record in the auction window

    # Parse imbalance side from near_qty / far_qty
    # CME MDP3 imbalance: near_qty > 0 = buy imbalance, far_qty > 0 = sell imbalance
    near_qty = int(row.get("near_qty", 0) or 0)
    far_qty = int(row.get("far_qty", 0) or 0)

    # Alternative field names in Databento Python SDK
    if near_qty == 0 and far_qty == 0:
        paired_qty_raw = int(row.get("paired_qty", 0) or 0)
        imbalance_qty_raw = int(row.get("imbalance_qty", 0) or row.get("ref_qty", 0) or 0)
        # If only one direction available, try direct imbalance field
        near_qty = imbalance_qty_raw
        far_qty = 0

    imbalance_qty = abs(near_qty - far_qty)
    if near_qty > far_qty:
        imbalance_side = "buy"
    elif far_qty > near_qty:
        imbalance_side = "sell"
    else:
        imbalance_side = "none"

    paired_qty = int(row.get("paired_qty", 0) or 0)

    # Indicative price (ref_price in CME MDP3)
    indicative_price_raw = row.get("ref_price") or row.get("indicative_price") or row.get("price")
    indicative_price = None
    if indicative_price_raw is not None:
        price_float = float(indicative_price_raw)
        if price_float > 1e6:  # fixed-point scaled — divide by 1e9
            price_float = price_float / 1e9
        indicative_price = price_float

    # Auction timestamp
    ts_event = row.get("ts_event") or row.get("ts_recv")
    auction_time = None
    if ts_event is not None:
        try:
            ts_ns = int(ts_event)
            auction_time = datetime.fromtimestamp(ts_ns / 1e9, tz=timezone.utc).isoformat()
        except (TypeError, ValueError, OSError):
            auction_time = date_str + "T12:29:59Z"  # fallback

    return {
        "symbol": symbol,
        "auction_date": date_str,
        "imbalance_quantity": imbalance_qty,
        "imbalance_side": imbalance_side,
        "paired_quantity": paired_qty,
        "indicative_price": indicative_price,
        "auction_time": auction_time,
        "records_in_window": len(df),
    }


def get_trading_dates(lookback_days: int) -> list[str]:
    """Return last N calendar days (Mon-Fri) as date strings. Excludes today."""
    today = datetime.now(timezone.utc).date()
    dates = []
    cursor = today - timedelta(days=1)
    while len(dates) < lookback_days:
        if cursor.weekday() < 5:  # Monday=0, Friday=4
            dates.append(cursor.isoformat())
        cursor -= timedelta(days=1)
    return dates


def main() -> None:
    parser = argparse.ArgumentParser(
        description="W19: Pull Databento Imbalance schema (opening auction)"
    )
    parser.add_argument(
        "--symbols",
        default="ES,NQ",
        help="Comma-separated symbols (default: ES,NQ)",
    )
    parser.add_argument(
        "--date",
        help="Single date YYYY-MM-DD or 'today'. Overrides --lookback-days.",
    )
    parser.add_argument(
        "--lookback-days",
        type=int,
        default=1,
        help="Number of past trading days to pull (default: 1 for daily cron)",
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

    symbols = [s.strip() for s in args.symbols.split(",") if s.strip() and s.strip() in SYMBOL_MAP]

    today = datetime.now(timezone.utc)

    # Determine dates to pull
    if args.date:
        if args.date == "today":
            dates = [today.strftime("%Y-%m-%d")]
        else:
            dates = [args.date]
    else:
        dates = get_trading_dates(args.lookback_days)

    if args.dry_run:
        results = []
        for symbol in symbols:
            for date_str in dates:
                results.append({
                    "status": "dry_run",
                    "symbol": symbol,
                    "auction_date": date_str,
                    "imbalance_quantity": 5000,
                    "imbalance_side": "buy",
                    "paired_quantity": 12000,
                    "indicative_price": 5000.0 if symbol == "ES" else 20000.0,
                    "auction_time": date_str + "T12:29:59Z",
                    "records_in_window": 1,
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
        for date_str in dates:
            try:
                record = pull_imbalance_for_date(client, symbol, date_str)
                if record is None:
                    results.append({
                        "status": "no_data",
                        "symbol": symbol,
                        "auction_date": date_str,
                        "message": "No imbalance records in auction window (non-trading day or holiday)",
                    })
                else:
                    results.append({"status": "ok", **record})
            except Exception as e:
                any_error = True
                results.append({
                    "status": "error",
                    "symbol": symbol,
                    "auction_date": date_str,
                    "message": str(e),
                })

    output = {
        "status": "error" if any_error else "ok",
        "mode": "execute",
        "pulled_at": today.isoformat(),
        "dates": dates,
        "results": results,
    }

    if args.output_json:
        print(json.dumps(output, indent=2, default=str))
    else:
        print(f"\n{'=' * 70}")
        print("Databento Imbalance Pull — W19 Schema 3")
        print(f"{'=' * 70}")
        for r in results:
            sym = r.get("symbol", "?")
            dt = r.get("auction_date", "?")
            status = r.get("status", "?")
            if status == "ok":
                side = r.get("imbalance_side", "?")
                qty = r.get("imbalance_quantity", 0)
                print(f"  OK  {sym} {dt}: {side.upper()} imbalance {qty:,} contracts")
            elif status == "no_data":
                print(f"  --  {sym} {dt}: no data (holiday/weekend)")
            else:
                print(f"  ERR {sym} {dt}: {r.get('message', '?')}")
        print()

    if any_error:
        sys.exit(1)


if __name__ == "__main__":
    main()
