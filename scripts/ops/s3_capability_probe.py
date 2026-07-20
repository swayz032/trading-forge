"""Cold-recovery leg 5: can THIS box actually read the data lake?

A CAPABILITY GATE, not a diagnostic. The distinction is the whole point:
`scripts/inspect_cache_vs_s3.py` prints per-object errors, continues, and ALWAYS EXITS 0 —
correct for a human reading a report, and a decorative green as a recovery check. 21 reads
can all fail and it still reports success. This exits with a verdict.

MIRRORS THE PRODUCTION READ PATH (src/engine/data_loader.py), deliberately:
  * INSTALL httpfs; LOAD httpfs — and let DuckDB AUTO-READ AWS_ACCESS_KEY_ID /
    AWS_SECRET_ACCESS_KEY from the environment. No manual SET, so no credential ever
    enters a SQL string ("avoids SQL injection risk from credentials with special chars").
  * Only AWS_REGION is SET, with quotes stripped, exactly as the engine does.
A boto3 probe would prove "AWS credentials are valid" — a DIFFERENT capability from
"DuckDB can read the lake", and they genuinely diverge. Verifying the wrong one is a green
check over a blind box.

THREE-STATE VERDICT, because a probe that fails on its OWN setup must never report the
LAKE as down — that is a true alarm pointed at the wrong thing:
    exit 0  PASS     a real object was read
    exit 1  FAIL     the lake is genuinely unreachable/unreadable
    exit 2  UNKNOWN  the probe could not run (no duckdb, no credentials, no bucket)

NO SECRET IN ANY OUTPUT PATH: values are never printed; failures are scrubbed to an
exception CLASS NAME plus a short reason code, never the message text, which can echo a
presigned URL or a key. Env vars appear as NAMES only.
"""
import json
import os
import sys

PASS, FAIL, UNKNOWN = 0, 1, 2


def emit(verdict, reason, **extra):
    """One JSON line. Paths, var NAMES and codes only — never a value."""
    print(json.dumps({"probe": "s3_capability", "verdict": verdict, "reason": reason, **extra}))


def main():
    # ── UNKNOWN: the probe itself cannot run. Not the lake's fault. ──
    try:
        import duckdb
    except Exception as e:
        emit("UNKNOWN", "duckdb_unavailable", error_class=type(e).__name__)
        return UNKNOWN

    missing = [v for v in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY") if not os.environ.get(v)]
    if missing:
        # The engine performs this same pre-flight before DuckDB touches the network,
        # specifically so missing creds fail diagnosably instead of as an opaque non-zero.
        emit("UNKNOWN", "credentials_absent", missing=missing)
        return UNKNOWN

    bucket = os.environ.get("S3_BUCKET", "trading-forge-data")
    key = os.environ.get("S3_PROBE_KEY", "futures/ES/consolidated/daily.parquet")

    try:
        con = duckdb.connect(":memory:")
        con.execute("INSTALL httpfs; LOAD httpfs;")
        region = os.environ.get("AWS_REGION", "")
        if region:
            con.execute("SET s3_region='%s';" % region.replace("'", ""))
    except Exception as e:
        emit("UNKNOWN", "duckdb_setup_failed", error_class=type(e).__name__)
        return UNKNOWN

    # ── ONE tiny read. The gate asks "can this box reach the lake at all", not
    # ── "is the lake complete". LIMIT 1 keeps it cheap enough for a boot check.
    s3_path = "s3://%s/%s" % (bucket, key)
    try:
        row = con.execute("SELECT COUNT(*) FROM (SELECT 1 FROM read_parquet(?) LIMIT 1)", [s3_path]).fetchone()
    except Exception as e:
        # FAIL: setup worked, credentials present, the READ failed -> the lake is the problem.
        # Scrub to the class name: DuckDB messages can embed the full presigned URL.
        emit("FAIL", "read_failed", error_class=type(e).__name__, s3_path=s3_path)
        return FAIL

    if not row or row[0] < 1:
        emit("FAIL", "object_empty_or_absent", s3_path=s3_path)
        return FAIL

    emit("PASS", "read_ok", s3_path=s3_path)
    return PASS


if __name__ == "__main__":
    sys.exit(main())
