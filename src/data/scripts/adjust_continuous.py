"""
Continuous Contract Adjustment

Ratio-adjust and Panama-adjust futures continuous contracts to remove
roll gaps that create fake signals in backtesting.

Usage:
    python adjust_continuous.py --input raw.parquet --output-dir adjusted/ --symbol ES --method both
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import polars as pl

PRICE_COLS = ["open", "high", "low", "close"]


def detect_roll_dates(df: pl.DataFrame) -> list[dict[str, Any]]:
    """Detect contract roll dates by instrument_id changes.

    Returns list of roll events with:
        - roll_idx: first bar index of new contract
        - old_instrument_id, new_instrument_id
        - old_close: last close of old contract
        - new_open: first open of new contract
        - ratio: new_open / old_close (for ratio adjustment)
        - gap: new_open - old_close (for Panama adjustment)
        - ts_event: timestamp of roll
    """
    if "instrument_id" not in df.columns:
        return []

    instrument_ids = df["instrument_id"].to_list()
    rolls = []

    for i in range(1, len(instrument_ids)):
        if instrument_ids[i] != instrument_ids[i - 1]:
            old_close = df["close"][i - 1]
            new_open = df["open"][i]

            if old_close == 0:
                continue

            rolls.append({
                "roll_idx": i,
                "old_instrument_id": instrument_ids[i - 1],
                "new_instrument_id": instrument_ids[i],
                "old_close": float(old_close),
                "new_open": float(new_open),
                "ratio": float(new_open / old_close),
                "gap": float(new_open - old_close),
                "ts_event": str(df["ts_event"][i]),
            })

    return rolls


def ratio_adjust(df: pl.DataFrame, rolls: list[dict[str, Any]]) -> pl.DataFrame:
    """Multiply pre-roll OHLC prices by ratio = new_open / old_close.

    Process rolls in REVERSE chronological order so cumulative ratios
    are applied correctly to earlier data.
    """
    if not rolls:
        return df.clone()

    adjusted = df.clone()
    open_vals = adjusted["open"].to_list()
    high_vals = adjusted["high"].to_list()
    low_vals = adjusted["low"].to_list()
    close_vals = adjusted["close"].to_list()

    # Process rolls in reverse order (most recent first)
    for roll in reversed(rolls):
        ratio = roll["ratio"]
        roll_idx = roll["roll_idx"]

        for i in range(roll_idx):
            open_vals[i] *= ratio
            high_vals[i] *= ratio
            low_vals[i] *= ratio
            close_vals[i] *= ratio

    return adjusted.with_columns(
        pl.Series("open", open_vals),
        pl.Series("high", high_vals),
        pl.Series("low", low_vals),
        pl.Series("close", close_vals),
    )


def panama_adjust(df: pl.DataFrame, rolls: list[dict[str, Any]]) -> pl.DataFrame:
    """Add gap = new_open - old_close to all pre-roll OHLC prices.

    Process rolls in REVERSE chronological order.
    """
    if not rolls:
        return df.clone()

    adjusted = df.clone()
    open_vals = adjusted["open"].to_list()
    high_vals = adjusted["high"].to_list()
    low_vals = adjusted["low"].to_list()
    close_vals = adjusted["close"].to_list()

    for roll in reversed(rolls):
        gap = roll["gap"]
        roll_idx = roll["roll_idx"]

        for i in range(roll_idx):
            open_vals[i] += gap
            high_vals[i] += gap
            low_vals[i] += gap
            close_vals[i] += gap

    return adjusted.with_columns(
        pl.Series("open", open_vals),
        pl.Series("high", high_vals),
        pl.Series("low", low_vals),
        pl.Series("close", close_vals),
    )


def main():
    parser = argparse.ArgumentParser(description="Adjust continuous futures contracts")
    parser.add_argument("--input", required=True, help="Input Parquet file path")
    parser.add_argument("--output-dir", required=True, help="Output directory")
    parser.add_argument("--symbol", required=True, help="Symbol name (ES, NQ, CL)")
    parser.add_argument(
        "--method",
        choices=["ratio", "panama", "both"],
        default="both",
        help="Adjustment method",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    df = pl.read_parquet(str(input_path))
    rolls = detect_roll_dates(df)

    result: dict[str, Any] = {
        "symbol": args.symbol,
        "input": str(input_path),
        "total_rows": df.height,
        "rolls_detected": len(rolls),
        "roll_dates": [r["ts_event"] for r in rolls],
        "outputs": [],
    }

    # Save roll calendar
    calendar_path = output_dir / f"{args.symbol}_roll_calendar.json"
    with open(calendar_path, "w") as f:
        json.dump(rolls, f, indent=2)
    result["roll_calendar"] = str(calendar_path)

    if args.method in ("ratio", "both"):
        adj = ratio_adjust(df, rolls)
        out_path = output_dir / f"{args.symbol}_ratio_adj.parquet"
        adj.write_parquet(str(out_path))
        result["outputs"].append({"method": "ratio", "path": str(out_path)})

    if args.method in ("panama", "both"):
        adj = panama_adjust(df, rolls)
        out_path = output_dir / f"{args.symbol}_panama_adj.parquet"
        adj.write_parquet(str(out_path))
        result["outputs"].append({"method": "panama", "path": str(out_path)})

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
