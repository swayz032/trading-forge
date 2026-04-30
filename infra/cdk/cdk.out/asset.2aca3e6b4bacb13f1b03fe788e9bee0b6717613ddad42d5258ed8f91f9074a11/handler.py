"""Nightly data fetch Lambda — downloads latest daily bars via Massive API."""

import json
import os
from datetime import datetime, timedelta
from urllib.request import urlopen, Request
from urllib.error import URLError

import boto3

S3_BUCKET = os.environ.get("S3_BUCKET", "trading-forge-data")
SYMBOLS = os.environ.get("SYMBOLS", "ES,NQ,CL").split(",")
SNS_TOPIC_ARN = os.environ.get("SNS_TOPIC_ARN", "")
MASSIVE_BASE_URL = "https://api.massive.app/v1"

s3 = boto3.client("s3")
sns = boto3.client("sns")


def handler(event, context):
    """Fetch yesterday's daily bars for each configured symbol."""
    yesterday = (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%d")
    results = []
    failures = []

    for symbol in SYMBOLS:
        try:
            data = fetch_daily_bar(symbol, yesterday)
            s3_key = f"daily/{symbol}/{yesterday}.json"
            s3.put_object(
                Bucket=S3_BUCKET,
                Key=s3_key,
                Body=json.dumps(data),
                ContentType="application/json",
            )
            results.append({"symbol": symbol, "date": yesterday, "s3_key": s3_key, "status": "ok"})
        except Exception as e:
            failures.append({"symbol": symbol, "date": yesterday, "error": str(e)})

    if failures and SNS_TOPIC_ARN:
        sns.publish(
            TopicArn=SNS_TOPIC_ARN,
            Subject=f"Trading Forge Data Fetch Failures ({yesterday})",
            Message=json.dumps(failures, indent=2),
        )

    return {"date": yesterday, "results": results, "failures": failures}


def fetch_daily_bar(symbol: str, date: str) -> dict:
    """Fetch daily OHLCV bar from Massive API (free tier)."""
    url = f"{MASSIVE_BASE_URL}/bars/{symbol}?date={date}&timeframe=daily"
    req = Request(url, headers={"Accept": "application/json"})

    try:
        with urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except URLError as e:
        raise RuntimeError(f"Failed to fetch {symbol} for {date}: {e}") from e
