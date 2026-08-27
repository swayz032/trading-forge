from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

from research import current_mnq_strategy_v2_4_automation_runtime as rt


def test_context_refresh_precedes_authoritative_live_quote_and_decision(tmp_path, monkeypatch):
    calls: list[str] = []
    manifest = tmp_path / "dataset_manifest.json"
    manifest.write_text("{}")

    runtime = object.__new__(rt.AutomationRuntime)
    runtime.account_id = 123
    runtime.snapshot_path = tmp_path / "rt.json"
    runtime.context_root = tmp_path
    runtime.receipt = tmp_path / "receipt.json"
    runtime.risk_store = SimpleNamespace(config=SimpleNamespace(account_id=123))
    runtime.broker = object()
    runtime.ledger = SimpleNamespace(
        load=lambda session: SimpleNamespace(phase="EMPTY", bullet_consumed=False),
        disable=lambda *a, **k: None,
    )
    runtime.context = SimpleNamespace(
        manifest_path=manifest,
        refresh=lambda *a, **k: calls.append("context_refresh"),
        bootstrap=lambda *a, **k: calls.append("context_bootstrap"),
    )

    monkeypatch.setattr(rt, "projectx_contract_id", lambda d: "CON.F.US.MNQ.U26")
    monkeypatch.setattr(rt, "load_production_dataset", lambda root: ("raw5", "raw1", {"x": 1}))
    monkeypatch.setattr(
        rt, "prepare_causal",
        lambda *a, **k: calls.append("prepare_causal") or {"prepared": True},
    )
    monkeypatch.setattr(
        rt, "read_realtime_snapshot",
        lambda *a, **k: calls.append("read_bbo") or SimpleNamespace(best_bid=100.0, best_ask=100.25),
    )
    monkeypatch.setattr(
        rt, "find_first_actionable_signal",
        lambda *a, **k: calls.append("decision") or None,
    )

    out = runtime.evaluate_once(datetime(2026, 8, 18, 14, 5, tzinfo=timezone.utc))
    assert out["status"] == "NO_A_PLUS_YET"
    assert calls == ["context_refresh", "prepare_causal", "read_bbo", "decision"]


def test_no_context_refresh_or_quote_read_after_daily_bullet_is_consumed(tmp_path, monkeypatch):
    calls: list[str] = []
    runtime = object.__new__(rt.AutomationRuntime)
    runtime.account_id = 123
    runtime.snapshot_path = Path(tmp_path / "rt.json")
    runtime.context_root = tmp_path
    runtime.ledger = SimpleNamespace(
        load=lambda session: SimpleNamespace(phase="SUBMITTED", bullet_consumed=True),
    )
    runtime.context = SimpleNamespace(
        manifest_path=tmp_path / "missing.json",
        refresh=lambda *a, **k: calls.append("context_refresh"),
        bootstrap=lambda *a, **k: calls.append("context_bootstrap"),
    )
    monkeypatch.setattr(rt, "read_realtime_snapshot", lambda *a, **k: calls.append("read_bbo"))

    out = runtime.evaluate_once(datetime(2026, 8, 18, 14, 5, tzinfo=timezone.utc))
    assert out["status"] == "DAILY_BULLET_ALREADY_CONSUMED"
    assert calls == []
