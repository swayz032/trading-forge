from datetime import datetime, timedelta, timezone
import pytest
from research import current_mnq_strategy_v2_2_projectx_history as h


def test_second_chunks_cannot_theoretically_hit_20k_by_time_span():
    assert h.safe_chunk(h.UNIT_SECOND,1) <= timedelta(hours=4)
    assert h.safe_chunk(h.UNIT_SECOND,1).total_seconds() < h.MAX_BARS


def test_minute_chunks_stay_under_20k():
    assert h.safe_chunk(h.UNIT_MINUTE,1).total_seconds()/60 < h.MAX_BARS


def test_credentials_missing_refuses(monkeypatch):
    monkeypatch.delenv('TOPSTEPX_USERNAME',raising=False); monkeypatch.delenv('TOPSTEPX_API_KEY',raising=False)
    with pytest.raises(RuntimeError,match='PROJECTX_CREDENTIALS_MISSING'):
        h.ProjectXHistory(username=None,api_key=None)


def test_history_request_is_explicit_contract():
    r=h.HistoryRequest('CON.F.US.MNQ.M26',datetime(2026,3,23,tzinfo=timezone.utc),datetime(2026,3,24,tzinfo=timezone.utc),h.UNIT_MINUTE,1)
    assert r.contract_id=='CON.F.US.MNQ.M26'
