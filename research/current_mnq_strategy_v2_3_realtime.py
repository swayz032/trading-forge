#!/usr/bin/env python3
"""Fail-closed reader for the read-only ProjectX SignalR sidecar snapshot."""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

TICK = 0.25


@dataclass(frozen=True)
class RealtimeSnapshot:
    account_id: int
    contract_id: str
    snapshot_age_seconds: float
    quote_age_seconds: float
    user_hub_connected: bool
    market_hub_connected: bool
    best_bid: float
    best_ask: float
    last_price: float | None
    pid: int | None

    @property
    def feed_age_seconds(self) -> float:
        return max(self.snapshot_age_seconds, self.quote_age_seconds)


def _parse_utc(value: str, field: str) -> datetime:
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception as exc:
        raise RuntimeError(f"REALTIME_TIMESTAMP_INVALID:{field}") from exc
    if dt.tzinfo is None:
        raise RuntimeError(f"REALTIME_TIMESTAMP_NAIVE:{field}")
    return dt.astimezone(timezone.utc)


def _tick_valid(x: float) -> bool:
    return abs(x / TICK - round(x / TICK)) < 1e-8


def read_realtime_snapshot(path: str | Path, expected_account_id: int,
                           expected_contract_id: str, *,
                           max_snapshot_age_seconds: float = 3.0,
                           max_quote_age_seconds: float = 15.0,
                           now: datetime | None = None) -> RealtimeSnapshot:
    p = Path(path)
    if not p.exists():
        raise RuntimeError("REALTIME_SNAPSHOT_MISSING")
    try:
        data = json.loads(p.read_text())
    except Exception as exc:
        raise RuntimeError("REALTIME_SNAPSHOT_CORRUPT") from exc
    if int(data.get("schema_version", -1)) != 1:
        raise RuntimeError("REALTIME_SNAPSHOT_SCHEMA_MISMATCH")
    if int(data.get("account_id", -1)) != int(expected_account_id):
        raise RuntimeError("REALTIME_SNAPSHOT_ACCOUNT_MISMATCH")
    if str(data.get("contract_id")) != str(expected_contract_id):
        raise RuntimeError("REALTIME_SNAPSHOT_CONTRACT_MISMATCH")
    if not bool(data.get("user_hub_connected")):
        raise RuntimeError("REALTIME_USER_HUB_DOWN")
    if not bool(data.get("market_hub_connected")):
        raise RuntimeError("REALTIME_MARKET_HUB_DOWN")

    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    snapshot_written = _parse_utc(data.get("snapshot_written_utc"), "snapshot_written_utc")
    last_quote = _parse_utc(data.get("last_quote_received_utc"), "last_quote_received_utc")
    snapshot_age = (now - snapshot_written).total_seconds()
    quote_age = (now - last_quote).total_seconds()
    if snapshot_age < -1.0 or quote_age < -1.0:
        raise RuntimeError("REALTIME_CLOCK_SKEW_FUTURE")
    if snapshot_age > max_snapshot_age_seconds:
        raise RuntimeError(f"REALTIME_SNAPSHOT_STALE:{snapshot_age:.3f}")
    if quote_age > max_quote_age_seconds:
        raise RuntimeError(f"REALTIME_QUOTE_STALE:{quote_age:.3f}")

    try:
        bid = float(data["best_bid"])
        ask = float(data["best_ask"])
    except Exception as exc:
        raise RuntimeError("REALTIME_BBO_MISSING") from exc
    if not (bid > 0 and ask > 0 and bid <= ask):
        raise RuntimeError("REALTIME_BBO_INVALID")
    if not _tick_valid(bid) or not _tick_valid(ask):
        raise RuntimeError("REALTIME_BBO_OFF_TICK")
    lp = data.get("last_price")
    last_price = None if lp is None else float(lp)
    if last_price is not None and not _tick_valid(last_price):
        raise RuntimeError("REALTIME_LAST_PRICE_OFF_TICK")

    return RealtimeSnapshot(
        account_id=int(expected_account_id), contract_id=str(expected_contract_id),
        snapshot_age_seconds=float(snapshot_age), quote_age_seconds=float(quote_age),
        user_hub_connected=True, market_hub_connected=True,
        best_bid=bid, best_ask=ask, last_price=last_price,
        pid=int(data["pid"]) if data.get("pid") is not None else None,
    )
