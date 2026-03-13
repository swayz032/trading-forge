"""
Process already-downloaded crisis data through full pipeline:
adjust → upload raw 1min → upload adj 1min → resample all TFs → upload to S3.

Usage:
    python crisis_pipeline.py --raw-dir ./data/raw/crisis
"""

import json
import os
import subprocess
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent

FILES = [
    ("ES", "2015-08-01", "2015-09-30"),
    ("ES", "2018-01-15", "2018-03-31"),
    ("NQ", "2015-08-01", "2015-09-30"),
    ("NQ", "2018-01-15", "2018-03-31"),
    ("CL", "2015-08-01", "2015-09-30"),
    ("CL", "2018-01-15", "2018-03-31"),
]


def run_step(script: str, args: list[str], label: str) -> dict:
    cmd = [sys.executable, str(SCRIPTS_DIR / script)] + args
    print(f"  [{label}]", file=sys.stderr)
    proc = subprocess.run(cmd, capture_output=True, text=True, env=os.environ)
    if proc.returncode != 0:
        print(f"    FAILED: {proc.stderr[:300]}", file=sys.stderr)
        return {"status": "error", "stderr": proc.stderr[:500]}
    try:
        return json.loads(proc.stdout.strip())
    except json.JSONDecodeError:
        return {"status": "error", "stdout": proc.stdout[:300]}


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", default="./data/raw/crisis")
    parser.add_argument("--adj-dir", default="./data/adjusted/crisis")
    parser.add_argument("--bucket", default=None)
    args = parser.parse_args()

    raw_dir = Path(args.raw_dir)
    adj_dir = Path(args.adj_dir)
    adj_dir.mkdir(parents=True, exist_ok=True)
    bucket = args.bucket or os.environ.get("S3_BUCKET", "trading-forge-data")

    for symbol, start, end in FILES:
        raw_path = raw_dir / f"{symbol}_{start}_{end}.parquet"
        if not raw_path.exists():
            print(f"SKIP {raw_path} (not found)", file=sys.stderr)
            continue

        # Each file gets its own adj subdir to avoid overwriting
        file_adj_dir = adj_dir / f"{symbol}_{start}_{end}"
        file_adj_dir.mkdir(parents=True, exist_ok=True)

        print(f"\n{'='*60}", file=sys.stderr)
        print(f"  {symbol} {start} → {end}", file=sys.stderr)
        print(f"{'='*60}", file=sys.stderr)

        # 1. Adjust
        adj = run_step("adjust_continuous.py", [
            "--input", str(raw_path),
            "--output-dir", str(file_adj_dir),
            "--symbol", symbol,
            "--method", "both",
        ], "Adjust")

        if adj.get("status") == "error":
            print(f"  ABORT {symbol} {start}-{end}: adjust failed", file=sys.stderr)
            continue

        ratio_path = None
        roll_cal = adj.get("roll_calendar")
        for out in adj.get("outputs", []):
            if out["method"] == "ratio":
                ratio_path = out["path"]

        rolls = adj.get("rolls_detected", 0)
        print(f"    {adj['total_rows']} rows, {rolls} rolls detected", file=sys.stderr)

        # 2. Upload raw 1min
        run_step("upload_to_s3.py", [
            "--input", str(raw_path),
            "--symbol", symbol,
            "--kind", "raw",
            "--timeframe", "1min",
            "--bucket", bucket,
        ], "Upload raw 1min")

        if not ratio_path:
            print(f"  WARN: no ratio_adj output for {symbol}", file=sys.stderr)
            continue

        # 3. Upload ratio_adj 1min
        upload_adj_args = [
            "--input", ratio_path,
            "--symbol", symbol,
            "--kind", "ratio_adj",
            "--timeframe", "1min",
            "--bucket", bucket,
        ]
        if roll_cal:
            upload_adj_args += ["--roll-calendar", roll_cal]

        run_step("upload_to_s3.py", upload_adj_args, "Upload ratio_adj 1min")

        # 4. Resample all timeframes (5min, 15min, 30min, 1hr, 4hr, daily) + upload
        resample = run_step("resample_timeframes.py", [
            "--input", ratio_path,
            "--symbol", symbol,
            "--kind", "ratio_adj",
            "--bucket", bucket,
        ], "Resample + upload all TFs")

        if resample.get("status") != "error":
            tfs = [t["timeframe"] for t in resample.get("timeframes", [])]
            print(f"    Uploaded timeframes: {', '.join(tfs)}", file=sys.stderr)

        print(f"  DONE {symbol} {start}-{end}", file=sys.stderr)

    print("\nAll crisis files processed.", file=sys.stderr)


if __name__ == "__main__":
    main()
