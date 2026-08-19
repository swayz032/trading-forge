from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pandas as pd
import pytest

from research import current_mnq_strategy_v2_3_live_data as live
from research import current_mnq_strategy_v2_3_data as common

CID = "CON.F.US.MNQ.U26"


class FakeClient:
    def fetch(self, req):
        end = req.end - timedelta(minutes=1)
        if req.start > end:
            return pd.DataFrame()
        idx = pd.date_range(req.start, end, freq="1h", tz="UTC" if req.start.tzinfo is None else None)
        base = pd.Series(range(len(idx)), dtype=float) * 0.25 + 20000.0
        return pd.DataFrame({
            "datetime": idx,
            "open": base,
            "high": base + 0.25,
            "low": base - 0.25,
            "close": base,
            "volume": 1,
        })


def patch_single_contract(monkeypatch, session):
    monkeypatch.setattr(live, "require_personal_device", lambda *a, **k: None)
    monkeypatch.setattr(live, "projectx_contract_id", lambda d: CID)
    monkeypatch.setattr(common, "projectx_contract_id", lambda d: CID)
    monkeypatch.setattr(common, "contract_windows", lambda start, end, overlap_days=7: [
        common.ContractWindow(CID, start, end)
    ])
    monkeypatch.setattr(common, "transition_dates", lambda start, end: [])


def test_bootstrap_and_refresh_rebuild_hashed_context(monkeypatch, tmp_path):
    session = date(2026, 8, 17)
    patch_single_contract(monkeypatch, session)
    store = live.LiveContextStore(tmp_path, client=FakeClient())
    m1 = store.bootstrap(
        session, lookback_days=80,
        as_of_utc=datetime(2026, 8, 17, 14, 0, tzinfo=timezone.utc),
    )
    assert m1["requested_start"] == str(session)
    assert m1["requested_end"] == str(session)
    assert len(m1["dataset_sha256"]) == 64
    assert CID in m1["raw_contract_files"]
    rows1 = m1["continuous_1m"]["rows"]

    m2 = store.refresh(
        session,
        as_of_utc=datetime(2026, 8, 17, 16, 0, tzinfo=timezone.utc),
    )
    assert m2["continuous_1m"]["rows"] >= rows1
    assert m2["as_of_utc"].startswith("2026-08-17T16:00:00")
    assert len(m2["dataset_sha256"]) == 64


def test_raw_context_tamper_refuses_refresh(monkeypatch, tmp_path):
    session = date(2026, 8, 17)
    patch_single_contract(monkeypatch, session)
    store = live.LiveContextStore(tmp_path, client=FakeClient())
    store.bootstrap(
        session, lookback_days=80,
        as_of_utc=datetime(2026, 8, 17, 14, 0, tzinfo=timezone.utc),
    )
    raw = store._raw_path(CID)
    raw.write_bytes(raw.read_bytes() + b"tamper")
    with pytest.raises(RuntimeError, match="LIVE_CONTEXT_RAW_HASH_REFUSE"):
        store.refresh(
            session,
            as_of_utc=datetime(2026, 8, 17, 15, 0, tzinfo=timezone.utc),
        )


def test_refresh_wrong_session_requires_rebootstrap(monkeypatch, tmp_path):
    session = date(2026, 8, 17)
    patch_single_contract(monkeypatch, session)
    store = live.LiveContextStore(tmp_path, client=FakeClient())
    store.bootstrap(
        session, lookback_days=80,
        as_of_utc=datetime(2026, 8, 17, 14, 0, tzinfo=timezone.utc),
    )
    with pytest.raises(RuntimeError, match="LIVE_CONTEXT_SESSION_MISMATCH_REBOOTSTRAP"):
        store.refresh(
            date(2026, 8, 18),
            as_of_utc=datetime(2026, 8, 18, 14, 0, tzinfo=timezone.utc),
        )
