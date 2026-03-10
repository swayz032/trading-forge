"""
Master Data Pipeline Orchestrator

Chains: cost check → download → adjust → upload raw → upload adjusted → resample → upload roll calendar

Usage:
    python run_pipeline.py --symbol ES --start 2020-01-01 --end 2025-01-01 --output-dir ./data
    python run_pipeline.py --symbol ES --start 2020-01-01 --end 2025-01-01 --output-dir ./data --cost-only
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


SCRIPTS_DIR = Path(__file__).parent


def run_script(script_name: str, args: list[str], label: str) -> dict:
    """Run a Python script and return its JSON output."""
    script_path = SCRIPTS_DIR / script_name
    cmd = [sys.executable, str(script_path)] + args

    print(f"\n{'='*60}", file=sys.stderr)
    print(f"  [{label}]", file=sys.stderr)
    print(f"  cmd: {' '.join(cmd)}", file=sys.stderr)
    print(f"{'='*60}", file=sys.stderr)

    proc = subprocess.run(cmd, capture_output=True, text=True, env=os.environ)

    if proc.returncode != 0:
        print(f"  STDERR: {proc.stderr}", file=sys.stderr)
        return {"status": "error", "message": proc.stderr, "step": label}

    try:
        result = json.loads(proc.stdout.strip())
        print(f"  ✓ {label} complete", file=sys.stderr)
        return result
    except json.JSONDecodeError:
        return {"status": "error", "message": f"Invalid JSON output: {proc.stdout[:200]}", "step": label}


def main():
    parser = argparse.ArgumentParser(description="Run full data pipeline for a symbol")
    parser.add_argument("--symbol", required=True, help="Symbol (ES, NQ, CL)")
    parser.add_argument("--start", required=True, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end", required=True, help="End date (YYYY-MM-DD)")
    parser.add_argument("--output-dir", default="./data", help="Base output directory")
    parser.add_argument("--cost-only", action="store_true", help="Only check cost, don't download")
    parser.add_argument("--max-cost", type=float, default=50.0, help="Max cost per symbol in USD")
    parser.add_argument("--bucket", default=None, help="S3 bucket name")
    args = parser.parse_args()

    bucket = args.bucket or os.environ.get("S3_BUCKET", "trading-forge-data")
    raw_dir = Path(args.output_dir) / "raw"
    adj_dir = Path(args.output_dir) / "adjusted"
    raw_dir.mkdir(parents=True, exist_ok=True)
    adj_dir.mkdir(parents=True, exist_ok=True)

    pipeline_result = {
        "symbol": args.symbol,
        "start": args.start,
        "end": args.end,
        "steps": [],
    }

    # Step 1: Cost check
    cost_result = run_script("databento_download.py", [
        "--symbol", args.symbol,
        "--start", args.start,
        "--end", args.end,
        "--output-dir", str(raw_dir),
        "--dry-run",
    ], f"Cost check for {args.symbol}")
    pipeline_result["steps"].append({"step": "cost_check", **cost_result})

    if cost_result.get("status") == "error":
        pipeline_result["status"] = "error"
        print(json.dumps(pipeline_result, indent=2))
        sys.exit(1)

    cost_usd = cost_result.get("cost_usd", 0)
    print(f"  Cost: ${cost_usd:.2f}", file=sys.stderr)

    if args.cost_only:
        pipeline_result["status"] = "ok"
        print(json.dumps(pipeline_result, indent=2))
        return

    if cost_usd > args.max_cost:
        pipeline_result["status"] = "error"
        pipeline_result["message"] = f"Cost ${cost_usd:.2f} exceeds max ${args.max_cost:.2f}"
        print(json.dumps(pipeline_result, indent=2))
        sys.exit(1)

    # Step 2: Download raw data
    download_result = run_script("databento_download.py", [
        "--symbol", args.symbol,
        "--start", args.start,
        "--end", args.end,
        "--output-dir", str(raw_dir),
    ], f"Download {args.symbol}")
    pipeline_result["steps"].append({"step": "download", **download_result})

    if download_result.get("status") == "error":
        pipeline_result["status"] = "error"
        print(json.dumps(pipeline_result, indent=2))
        sys.exit(1)

    raw_parquet = download_result["path"]

    # Step 3: Adjust continuous contracts (ratio + panama)
    adjust_result = run_script("adjust_continuous.py", [
        "--input", raw_parquet,
        "--output-dir", str(adj_dir),
        "--symbol", args.symbol,
        "--method", "both",
    ], f"Adjust {args.symbol}")
    pipeline_result["steps"].append({"step": "adjust", **adjust_result})

    if adjust_result.get("status") == "error":
        pipeline_result["status"] = "error"
        print(json.dumps(pipeline_result, indent=2))
        sys.exit(1)

    roll_calendar_path = adjust_result.get("roll_calendar")
    ratio_adj_path = None
    for output in adjust_result.get("outputs", []):
        if output["method"] == "ratio":
            ratio_adj_path = output["path"]

    # Step 4: Upload raw 1min to S3
    upload_raw_result = run_script("upload_to_s3.py", [
        "--input", raw_parquet,
        "--symbol", args.symbol,
        "--kind", "raw",
        "--timeframe", "1min",
        "--bucket", bucket,
    ], f"Upload raw {args.symbol}")
    pipeline_result["steps"].append({"step": "upload_raw", **upload_raw_result})

    # Step 5: Upload ratio_adj 1min to S3
    if ratio_adj_path:
        upload_adj_args = [
            "--input", ratio_adj_path,
            "--symbol", args.symbol,
            "--kind", "ratio_adj",
            "--timeframe", "1min",
            "--bucket", bucket,
        ]
        if roll_calendar_path:
            upload_adj_args += ["--roll-calendar", roll_calendar_path]

        upload_adj_result = run_script("upload_to_s3.py", upload_adj_args,
            f"Upload ratio_adj {args.symbol}")
        pipeline_result["steps"].append({"step": "upload_ratio_adj", **upload_adj_result})

    # Step 6: Resample + upload higher timeframes (ratio_adj)
    if ratio_adj_path:
        resample_result = run_script("resample_timeframes.py", [
            "--input", ratio_adj_path,
            "--symbol", args.symbol,
            "--kind", "ratio_adj",
            "--bucket", bucket,
        ], f"Resample {args.symbol}")
        pipeline_result["steps"].append({"step": "resample", **resample_result})

    pipeline_result["status"] = "ok"
    print(json.dumps(pipeline_result, indent=2))


if __name__ == "__main__":
    main()
