#!/usr/bin/env python3
"""Coverage-safe ProjectX history retriever for v2.2.

ProjectX History/retrieveBars aggregation units:
  1=Second, 2=Minute, 3=Hour, 4=Day, 5=Week, 6=Month.
The endpoint has a hard 20,000-bar maximum per request. This adapter therefore
uses windows whose theoretical maximum bar count is safely below 20,000 and
refuses any saturated response instead of silently accepting truncation.

Credentials are read only at runtime; this module is safe to keep in GitHub.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import os
import time
import requests
import pandas as pd

from research.current_mnq_strategy_v2_2_contracts import projectx_contract_id

API_BASE = "https://api.topstepx.com/api"
MAX_BARS = 20_000

UNIT_SECOND = 1
UNIT_MINUTE = 2
UNIT_HOUR = 3


def safe_chunk(unit: int, unit_number: int) -> timedelta:
    if unit == UNIT_SECOND:
        # <=14,400 theoretical one-second bars, safely under 20,000.
        return timedelta(hours=4 * max(1, unit_number))
    if unit == UNIT_MINUTE:
        # <=10,080 one-minute bars.
        return timedelta(days=7 * max(1, unit_number))
    if unit == UNIT_HOUR:
        return timedelta(days=365)
    return timedelta(days=30)


@dataclass(frozen=True)
class HistoryRequest:
    contract_id: str
    start: datetime
    end: datetime
    unit: int
    unit_number: int = 1
    live: bool = False


class ProjectXHistory:
    def __init__(self, username: str | None = None, api_key: str | None = None,
                 api_base: str = API_BASE, session: requests.Session | None = None):
        self.username = username or os.getenv("TOPSTEPX_USERNAME")
        self.api_key = api_key or os.getenv("TOPSTEPX_API_KEY")
        if not self.username or not self.api_key:
            raise RuntimeError("PROJECTX_CREDENTIALS_MISSING")
        self.api_base = api_base.rstrip("/")
        self.session = session or requests.Session()
        self.session.headers.update({"Content-Type": "application/json", "accept": "text/plain"})
        self._authenticate()

    def _authenticate(self):
        r = self.session.post(f"{self.api_base}/Auth/loginKey",
                              json={"userName": self.username, "apiKey": self.api_key}, timeout=30)
        r.raise_for_status()
        data = r.json()
        if not data.get("success"):
            raise RuntimeError(f"PROJECTX_AUTH_FAILED:{data}")
        self.session.headers["Authorization"] = f"Bearer {data['token']}"

    def _request(self, req: HistoryRequest) -> list[dict]:
        payload = {
            "contractId": req.contract_id,
            "live": req.live,
            "startTime": req.start.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "endTime": req.end.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "unit": req.unit,
            "unitNumber": req.unit_number,
            "limit": MAX_BARS,
            "includePartialBar": False,
        }
        for attempt in range(6):
            r = self.session.post(f"{self.api_base}/History/retrieveBars", json=payload, timeout=60)
            if r.status_code == 429:
                time.sleep(min(30, 2 ** attempt))
                continue
            r.raise_for_status()
            data = r.json()
            if not data.get("success"):
                raise RuntimeError(f"PROJECTX_HISTORY_FAILED:{data}")
            bars = data.get("bars", [])
            if len(bars) >= MAX_BARS:
                raise RuntimeError("PROJECTX_HISTORY_SATURATED_20000_REFUSE")
            return bars
        raise RuntimeError("PROJECTX_RATE_LIMIT_RETRY_EXHAUSTED")

    def fetch(self, req: HistoryRequest) -> pd.DataFrame:
        if req.start >= req.end:
            return pd.DataFrame(columns=["datetime","open","high","low","close","volume"])
        step = safe_chunk(req.unit, req.unit_number)
        rows = []
        cur = req.start
        while cur < req.end:
            nxt = min(cur + step, req.end)
            rows.extend(self._request(HistoryRequest(req.contract_id, cur, nxt, req.unit, req.unit_number, req.live)))
            cur = nxt
        if not rows:
            return pd.DataFrame(columns=["datetime","open","high","low","close","volume"])
        x = pd.DataFrame({
            "datetime": [r["t"] for r in rows], "open": [r["o"] for r in rows],
            "high": [r["h"] for r in rows], "low": [r["l"] for r in rows],
            "close": [r["c"] for r in rows], "volume": [r.get("v",0) for r in rows],
        })
        x["datetime"] = pd.to_datetime(x.datetime, utc=True)
        x = x.drop_duplicates("datetime", keep="last").sort_values("datetime").reset_index(drop=True)
        return x


def fetch_roll_aware_sessions(client: ProjectXHistory, sessions: list,
                              unit: int, unit_number: int = 1,
                              pre_hours: int = 16, post_hours: int = 7) -> pd.DataFrame:
    """Fetch each NY session from its expected CME lead contract.

    This intentionally fetches contracts separately rather than splicing an
    unidentified generic symbol. Contract ID is persisted on every output row.
    """
    parts = []
    for d in sessions:
        d = pd.Timestamp(d).date()
        contract = projectx_contract_id(d)
        # Wide UTC envelope; caller later converts/filter NY session boundaries.
        center = datetime(d.year, d.month, d.day, 14, 0, tzinfo=timezone.utc)
        start = center - timedelta(hours=pre_hours)
        end = center + timedelta(hours=post_hours)
        x = client.fetch(HistoryRequest(contract, start, end, unit, unit_number, False))
        if len(x):
            x["contract_id"] = contract
            x["session"] = str(d)
            parts.append(x)
    return pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()
