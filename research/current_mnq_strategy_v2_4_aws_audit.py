#!/usr/bin/env python3
"""Read-only audit of existing AWS/S3 MNQ history for the frozen v2.4 clean seal.

This utility NEVER runs strategy P&L and NEVER mutates S3. It inventories the
existing MNQ objects and reports whether the stored history has enough provenance
to be adapted into the v2.4 production dataset contract, or whether the frozen
explicit-outright Databento collector is still required.

The audit deliberately distinguishes a convenient continuous/ratio-adjusted MNQ
series from the stronger evidence required by the sealed runner: exact per-session
lead contract identity, reproducible roll bridges/adjustments, immutable data
identity, and genuine MNQ history beginning at launch (2019-05-06).
"""
from __future__ import annotations

import io
import json
import os
import re
from datetime import date
from pathlib import Path
from typing import Any

CLEAN_START = date(2019, 5, 6)
CLEAN_END = date(2021, 12, 31)
DEFAULT_BUCKET = "trading-forge-data"
SYMBOL_PREFIX = "futures/MNQ/"
OUT_DIR = Path("research/_mnq_v24_aws_audit")

DAY_KEY_RE = re.compile(
    r"^futures/MNQ/(?P<kind>raw|ratio_adj)/(?P<tf>[^/]+)/"
    r"(?P<year>\d{4})/(?P<month>\d{2})/(?P<day>\d{2})\.parquet$"
)
# Search broadly because an explicit-outright archive may have been stored under
# a one-off path instead of the standard futures/MNQ/{raw,ratio_adj}/ hierarchy.
OUTRIGHT_RE = re.compile(r"(?:CON\.F\.US\.MNQ\.[HMUZ]\d{2}|MNQ[HMUZ]\d)", re.I)


def _credentials_present() -> bool:
    return bool(os.environ.get("AWS_ACCESS_KEY_ID") and os.environ.get("AWS_SECRET_ACCESS_KEY"))


def _client():
    if not _credentials_present():
        raise RuntimeError(
            "AWS_CREDENTIALS_MISSING: set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY "
            "in the local environment before running this read-only audit"
        )
    import boto3
    return boto3.client(
        "s3",
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
    )


def _list_keys(s3, bucket: str, prefix: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    token = None
    while True:
        kwargs: dict[str, Any] = {"Bucket": bucket, "Prefix": prefix}
        if token:
            kwargs["ContinuationToken"] = token
        resp = s3.list_objects_v2(**kwargs)
        for obj in resp.get("Contents", []):
            out.append({
                "key": str(obj["Key"]),
                "size": int(obj.get("Size", 0)),
                "etag": str(obj.get("ETag", "")).strip('"'),
                "last_modified": str(obj.get("LastModified", "")),
            })
        token = resp.get("NextContinuationToken")
        if not token:
            break
    return out


def _key_date(key: str) -> date | None:
    m = DAY_KEY_RE.match(key)
    if not m:
        return None
    try:
        return date(int(m.group("year")), int(m.group("month")), int(m.group("day")))
    except ValueError:
        return None


def _parquet_sample(s3, bucket: str, key: str) -> dict[str, Any]:
    """Read one object in memory for schema/timestamp evidence only."""
    try:
        import polars as pl
        body = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
        df = pl.read_parquet(io.BytesIO(body))
        result: dict[str, Any] = {
            "key": key,
            "rows": int(df.height),
            "columns": list(df.columns),
        }
        ts_col = "ts_event" if "ts_event" in df.columns else ("datetime" if "datetime" in df.columns else None)
        if ts_col and df.height:
            result["first_timestamp"] = str(df[ts_col].min())
            result["last_timestamp"] = str(df[ts_col].max())
        for col in ("instrument_id", "contract_id", "raw_symbol", "symbol", "price_adjustment"):
            if col in df.columns and df.height:
                vals = df[col].drop_nulls().unique().head(20).to_list()
                result[f"sample_{col}_values"] = [str(v) for v in vals]
        return result
    except Exception as exc:  # audit should report unreadable objects, not hide them
        return {"key": key, "error": f"{type(exc).__name__}:{exc}"}


def _roll_calendar_sample(s3, bucket: str, key: str) -> dict[str, Any]:
    try:
        raw = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
        data = json.loads(raw)
        rows = data if isinstance(data, list) else data.get("rolls", data.get("events", []))
        return {
            "key": key,
            "type": type(data).__name__,
            "events": len(rows) if isinstance(rows, list) else None,
            "first_event": rows[0] if isinstance(rows, list) and rows else None,
            "last_event": rows[-1] if isinstance(rows, list) and rows else None,
        }
    except Exception as exc:
        return {"key": key, "error": f"{type(exc).__name__}:{exc}"}


def audit(bucket: str | None = None) -> dict[str, Any]:
    bucket = bucket or os.environ.get("S3_BUCKET", DEFAULT_BUCKET)
    s3 = _client()
    objects = _list_keys(s3, bucket, SYMBOL_PREFIX)
    keys = [o["key"] for o in objects]

    standard: dict[str, list[tuple[date, dict[str, Any]]]] = {
        "raw_1min": [], "ratio_adj_1min": []
    }
    prelaunch: list[str] = []
    for obj in objects:
        key = obj["key"]
        m = DAY_KEY_RE.match(key)
        if not m or m.group("tf") != "1min":
            continue
        d = _key_date(key)
        if d is None:
            continue
        if d < CLEAN_START:
            prelaunch.append(key)
        label = f"{m.group('kind')}_1min"
        if label in standard:
            standard[label].append((d, obj))

    for rows in standard.values():
        rows.sort(key=lambda x: x[0])

    def coverage(label: str) -> dict[str, Any]:
        rows = standard[label]
        dates = [d for d, _ in rows]
        clean_dates = [d for d in dates if CLEAN_START <= d <= CLEAN_END]
        return {
            "objects": len(rows),
            "earliest_key_date": str(dates[0]) if dates else None,
            "latest_key_date": str(dates[-1]) if dates else None,
            "clean_scope_daily_objects": len(clean_dates),
            "has_launch_or_earlier": bool(dates and dates[0] <= CLEAN_START),
            "has_end_2021_or_later": bool(dates and dates[-1] >= CLEAN_END),
        }

    raw_rows = standard["raw_1min"]
    ratio_rows = standard["ratio_adj_1min"]
    samples: dict[str, Any] = {}
    for label, rows in (("raw", raw_rows), ("ratio_adj", ratio_rows)):
        if rows:
            samples[f"{label}_first"] = _parquet_sample(s3, bucket, rows[0][1]["key"])
            samples[f"{label}_last"] = _parquet_sample(s3, bucket, rows[-1][1]["key"])
            clean_rows = [x for x in rows if CLEAN_START <= x[0] <= CLEAN_END]
            if clean_rows:
                samples[f"{label}_clean_start"] = _parquet_sample(s3, bucket, clean_rows[0][1]["key"])
                samples[f"{label}_clean_end"] = _parquet_sample(s3, bucket, clean_rows[-1][1]["key"])

    roll_keys = sorted(k for k in keys if k.startswith("futures/MNQ/roll_calendar/") and k.endswith(".json"))
    roll_samples = [_roll_calendar_sample(s3, bucket, k) for k in roll_keys if any(f"/{y}.json" in k for y in (2019, 2020, 2021))]

    explicit_keys = sorted(k for k in keys if OUTRIGHT_RE.search(k))
    manifest_like = sorted(
        k for k in keys
        if any(token in k.lower() for token in ("manifest", "provenance", "definition", "contract"))
    )

    # Current standard AWS pipeline evidence is continuous-contract oriented. Raw
    # daily files + instrument IDs may be useful development data, but may not be
    # relabeled as explicit-outright provenance. Only an actual explicit-contract
    # archive/manifest can justify an adapter without a fresh collector.
    raw_cov = coverage("raw_1min")
    ratio_cov = coverage("ratio_adj_1min")
    scope_available = (
        (raw_cov["has_launch_or_earlier"] and raw_cov["has_end_2021_or_later"])
        or (ratio_cov["has_launch_or_earlier"] and ratio_cov["has_end_2021_or_later"])
    )

    if scope_available and explicit_keys:
        verdict = "AWS_DATA_REQUIRES_PROVENANCE_ADAPTER"
        reason = (
            "Full-date AWS history appears present and explicit MNQ contract-like objects were found. "
            "Do not run clean P&L yet; build/verify an adapter that reproduces the frozen v2.4 "
            "contract_sessions, roll bridges, price_adjustment, and byte hashes."
        )
    else:
        verdict = "AWS_DATA_NOT_ELIGIBLE_USE_DATABENTO"
        reason = (
            "The discovered AWS MNQ layout does not itself prove the explicit H/M/U/Z outright-contract "
            "history required by the frozen v2.4 production/sealed dataset contract. Continuous or "
            "ratio-adjusted MNQ history cannot be upgraded to clean provenance by labeling dates after the fact."
        )

    report = {
        "schema_version": 1,
        "audit": "MNQ_V2_4_AWS_READ_ONLY_CLEAN_DATA_ELIGIBILITY",
        "pnl_executed": False,
        "s3_mutation_performed": False,
        "bucket": bucket,
        "prefix": SYMBOL_PREFIX,
        "clean_required_start": str(CLEAN_START),
        "clean_required_end": str(CLEAN_END),
        "objects_under_mnq_prefix": len(objects),
        "raw_1min": raw_cov,
        "ratio_adj_1min": ratio_cov,
        "prelaunch_daily_keys_count": len(prelaunch),
        "prelaunch_daily_keys_first_20": prelaunch[:20],
        "consolidated_1min_present": "futures/MNQ/consolidated/1min.parquet" in keys,
        "roll_calendar_keys": roll_keys,
        "roll_calendar_2019_2021": roll_samples,
        "explicit_contract_like_keys_count": len(explicit_keys),
        "explicit_contract_like_keys_first_50": explicit_keys[:50],
        "manifest_or_provenance_like_keys_first_100": manifest_like[:100],
        "samples": samples,
        "verdict": verdict,
        "reason": reason,
        "next_action_if_not_eligible": (
            "Use research/current_mnq_strategy_v2_3_databento.py explicit raw_symbol collector "
            "for 2019-05-06..2021-12-31, then freeze dataset_manifest.json before one-shot v2.4 seal."
        ),
    }
    return report


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    report = audit()
    out = OUT_DIR / "aws_audit.json"
    out.write_text(json.dumps(report, indent=2, sort_keys=True, default=str))
    print(json.dumps(report, indent=2, sort_keys=True, default=str))
    print(f"\nWROTE:{out}")


if __name__ == "__main__":
    main()
