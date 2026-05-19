"""One-shot diagnostic: compare local cache vs S3 consolidated row counts/date ranges."""
import duckdb, os, sys

# Load .env
env_file = os.path.join(os.path.dirname(__file__), "..", ".env")
with open(env_file, encoding="utf-8", errors="ignore") as f:
    for line in f:
        line = line.strip()
        if line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k, v)

con = duckdb.connect()
con.execute("SET s3_region='us-east-1'")
con.execute(f"SET s3_access_key_id='{os.environ['AWS_ACCESS_KEY_ID']}'")
con.execute(f"SET s3_secret_access_key='{os.environ['AWS_SECRET_ACCESS_KEY']}'")

bucket = os.environ.get("S3_BUCKET", "trading-forge-data")
for symbol in ["ES", "NQ", "CL"]:
    for tf in ["1min", "5min", "15min", "30min", "1hour", "4hour", "daily"]:
        try:
            r = con.execute(
                f"SELECT MIN(ts_event), MAX(ts_event), COUNT(*) "
                f"FROM read_parquet('s3://{bucket}/futures/{symbol}/consolidated/{tf}.parquet')"
            ).fetchone()
            print(f"S3   {symbol:3} {tf:6}  min={r[0]}  max={r[1]}  rows={r[2]:,}")
        except Exception as e:
            print(f"S3   {symbol:3} {tf:6}  ERROR: {str(e)[:80]}")

print()
cache_dir = os.path.join(os.path.dirname(__file__), "..", "data_cache")
for symbol in ["ES", "NQ", "CL"]:
    for tf in ["1min", "5min", "15min", "30min", "1hour", "4hour", "daily"]:
        path = os.path.join(cache_dir, symbol, f"{tf}.parquet")
        if not os.path.exists(path):
            continue
        try:
            r = con.execute(
                f"SELECT MIN(ts_event), MAX(ts_event), COUNT(*) FROM read_parquet('{path.replace(chr(92), '/')}')"
            ).fetchone()
            print(f"CACHE {symbol:3} {tf:6}  min={r[0]}  max={r[1]}  rows={r[2]:,}")
        except Exception as e:
            print(f"CACHE {symbol:3} {tf:6}  ERROR: {str(e)[:80]}")
