from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest

from research.current_mnq_strategy_v2_3_realtime import read_realtime_snapshot


def write_snapshot(path, *, now, account=123, contract="CON.F.US.MNQ.U26",
                   user=True, market=True, quote_age=1.0, snapshot_age=0.5,
                   bid=23000.0, ask=23000.25):
    payload = {
        "schema_version": 1,
        "pid": 99,
        "account_id": account,
        "contract_id": contract,
        "snapshot_written_utc": (now - timedelta(seconds=snapshot_age)).isoformat(),
        "user_hub_connected": user,
        "market_hub_connected": market,
        "last_quote_received_utc": (now - timedelta(seconds=quote_age)).isoformat(),
        "best_bid": bid,
        "best_ask": ask,
        "last_price": ask,
    }
    path.write_text(json.dumps(payload))


def test_realtime_snapshot_requires_fresh_correct_dual_hub_state(tmp_path):
    now = datetime(2026, 8, 17, 22, 0, tzinfo=timezone.utc)
    p = tmp_path / "rt.json"
    write_snapshot(p, now=now)
    s = read_realtime_snapshot(p, 123, "CON.F.US.MNQ.U26", now=now)
    assert s.user_hub_connected and s.market_hub_connected
    assert s.feed_age_seconds == pytest.approx(1.0)
    assert s.best_bid == 23000.0 and s.best_ask == 23000.25


@pytest.mark.parametrize("field,value,reason", [
    ("user", False, "REALTIME_USER_HUB_DOWN"),
    ("market", False, "REALTIME_MARKET_HUB_DOWN"),
    ("quote_age", 16.0, "REALTIME_QUOTE_STALE"),
    ("snapshot_age", 4.0, "REALTIME_SNAPSHOT_STALE"),
])
def test_realtime_snapshot_fails_closed_on_unhealthy_state(tmp_path, field, value, reason):
    now = datetime(2026, 8, 17, 22, 0, tzinfo=timezone.utc)
    p = tmp_path / "rt.json"
    kwargs = {field: value}
    write_snapshot(p, now=now, **kwargs)
    with pytest.raises(RuntimeError, match=reason):
        read_realtime_snapshot(p, 123, "CON.F.US.MNQ.U26", now=now)


def test_realtime_snapshot_binds_exact_account_and_contract(tmp_path):
    now = datetime(2026, 8, 17, 22, 0, tzinfo=timezone.utc)
    p = tmp_path / "rt.json"
    write_snapshot(p, now=now)
    with pytest.raises(RuntimeError, match="ACCOUNT_MISMATCH"):
        read_realtime_snapshot(p, 124, "CON.F.US.MNQ.U26", now=now)
    with pytest.raises(RuntimeError, match="CONTRACT_MISMATCH"):
        read_realtime_snapshot(p, 123, "CON.F.US.MNQ.Z26", now=now)


def test_realtime_snapshot_refuses_bad_or_off_tick_bbo(tmp_path):
    now = datetime(2026, 8, 17, 22, 0, tzinfo=timezone.utc)
    p = tmp_path / "rt.json"
    write_snapshot(p, now=now, bid=23000.25, ask=23000.0)
    with pytest.raises(RuntimeError, match="BBO_INVALID"):
        read_realtime_snapshot(p, 123, "CON.F.US.MNQ.U26", now=now)
    write_snapshot(p, now=now, bid=23000.10, ask=23000.25)
    with pytest.raises(RuntimeError, match="BBO_OFF_TICK"):
        read_realtime_snapshot(p, 123, "CON.F.US.MNQ.U26", now=now)
