from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pandas as pd
import pytest

from research import current_mnq_strategy_v2_4_replay_lab_v3 as lab

TZ = "America/New_York"


def _loc(i="Z", side="S", mid=100.0):
    return {
        "id": i, "side": side, "lo": mid - 1.0, "hi": mid + 1.0,
        "mid": mid, "source": "TEST", "entry_authorized": True,
    }


def test_v3_contract_locks_desktop_reaction_cluster_and_noncryptographic_future():
    contract = json.loads(Path("research/current_mnq_strategy_v2_4_replay_lab_v3_contract.json").read_text(encoding="utf-8"))
    assert contract["status"] == "LOCKED_DESKTOP_INTERACTIVE_FIDELITY_LAB_V3"
    assert contract["chart_engine"]["name"] == "TradingView Lightweight Charts"
    assert contract["chart_engine"]["version"] == "5.2.0"
    assert contract["tp_semantics"]["canonical_label"] == "FIRST_MEANINGFUL_REACTION_CLUSTER"
    assert contract["tp_semantics"]["not_a_rule"] == "SIDE_BY_SIDE_CANDLES"
    assert contract["scenario_selection"]["one_case_per_session"] is True
    assert contract["replay_clock"]["future_visibility"] == "UI_PROGRESSIVE_DISCLOSURE_ONLY_NOT_CRYPTOGRAPHICALLY_WITHHELD"


def test_authoritative_entry_skips_candidate_that_fails_room_tp(monkeypatch):
    t1 = pd.Timestamp("2026-08-17 10:03", tz=TZ)
    t2 = pd.Timestamp("2026-08-17 10:08", tz=TZ)
    c1 = SimpleNamespace(direction="L", setup="REV", reason="A", location=SimpleNamespace(id="Z1"))
    c2 = SimpleNamespace(direction="L", setup="REV", reason="B", location=SimpleNamespace(id="Z2"))
    monkeypatch.setattr(lab, "iter_actionable_candidates", lambda *a, **k: iter([
        (c1, t1, SimpleNamespace()), (c2, t2, SimpleNamespace()),
    ]))
    monkeypatch.setattr(lab.eng.core, "one_minute_entry", lambda one, actionable, direction, p: (actionable, 100.0, 100.0))
    picked = SimpleNamespace(
        location=SimpleNamespace(lo=120, hi=124, mid=122, source="R"), kind="KEY_ZONE_15M",
        raw_price=122.0, executable_price=122.0, first_contact_distance=20.0,
    )
    calls = {"n": 0}
    def fake_target(*args, **kwargs):
        calls["n"] += 1
        return (None, "TOO_CLOSE") if calls["n"] == 1 else (picked, "OK")
    monkeypatch.setattr(lab, "build_and_classify", fake_target)
    env = {k: object() for k in ("one", "piv5", "full5", "h15", "pdm", "pwm", "piv15")}
    out = lab._authoritative_first_entry(env, t1.date(), SimpleNamespace())
    assert out is not None
    assert out[0].location.id == "Z2"
    assert out[3] == t2


def test_decision_relevant_zone_map_is_nearby_and_keeps_entry_location():
    zones = [_loc(f"S{i}", "S", 90 + i) for i in range(10)] + [_loc(f"R{i}", "R", 110 + i) for i in range(10)]
    zones.append(_loc("ENTRY", "R", 150))
    got = lab._decision_relevant_zones(zones, 105.0, "ENTRY", max_each_side=3)
    assert len(got) <= 7
    assert any(z["id"] == "ENTRY" for z in got)
    assert sum(float(z["mid"]) <= 105 for z in got if z["id"] != "ENTRY") <= 3
    assert sum(float(z["mid"]) > 105 for z in got if z["id"] != "ENTRY") <= 3


def test_safe_review_rejects_hidden_bot_fields():
    lab._assert_safe_review({"cases": [{"case_id": "A"}]})
    for key in ("bot_action", "bot_entry_time", "bot_relevant_zones", "bot_tp_reaction_cluster", "net_pnl"):
        with pytest.raises(RuntimeError, match="REPLAY_V3_SAFE_PACK_LEAK"):
            lab._assert_safe_review({"cases": [{"case_id": "A", key: "x"}]})


def test_build_pack_is_one_case_per_session_and_prefers_authoritative_entries(monkeypatch):
    days = list(pd.date_range("2026-03-01", periods=12, freq="D").date)
    def fake_entry(env, dte, p):
        i = days.index(dte)
        if i >= 8:
            return None
        t = pd.Timestamp(f"{dte} 10:{10+i:02d}", tz=TZ)
        cand = SimpleNamespace(
            direction="L" if i % 2 == 0 else "S", setup="REV",
            reason="ZONE_REJECTION_STORY_THEN_INTRA5_FORCE" if i else "FIRST_BREAK_PRINT_THEN_INTRA5_FORCE",
            location=SimpleNamespace(id=f"Z{i}"),
        )
        picked = SimpleNamespace(
            location=SimpleNamespace(lo=120.0, hi=124.0, mid=122.0, source="REACTION"),
            kind="KEY_ZONE_15M", raw_price=122.0, executable_price=122.0,
            first_contact_distance=20.0,
        )
        return cand, t, SimpleNamespace(), t, 100.0, picked, "OK"
    monkeypatch.setattr(lab, "_authoritative_first_entry", fake_entry)
    monkeypatch.setattr(lab, "_zone_rows", lambda *a, **k: [_loc("Z0", "S", 100.0)])
    monkeypatch.setattr(lab, "_control_anchor", lambda env, dte, p: (pd.Timestamp(f"{dte} 10:00", tz=TZ), "CONTROL"))
    monkeypatch.setattr(lab, "_make_case", lambda env, dte, anchor, kind: lab.ReplayCaseV3(
        lab._case_id(dte, anchor, kind), str(dte),
        (anchor-pd.Timedelta(minutes=5)).isoformat(), (anchor+pd.Timedelta(minutes=5)).isoformat(),
        [{"start": (anchor-pd.Timedelta(minutes=1)).isoformat(), "end": anchor.isoformat(), "open": 100, "high": 101, "low": 99, "close": 100}], [], [], [],
    ))
    review, key = lab.build_replay_pack_v3({}, days, SimpleNamespace(), max_cases=12, max_entry_cases=8, min_entry_cases=8)
    assert review["case_count"] == 12
    assert review["session_count"] == 12
    assert len({c["session"] for c in review["cases"]}) == 12
    assert sum(a["bot_action"].startswith("ENTER_") for a in key["answers"].values()) == 8


def test_v3_html_uses_lightweight_charts_real_replay_controls_and_reaction_cluster(tmp_path):
    review = {
        "schema_version": 3, "pack_id": "P", "case_count": 1,
        "cases": [{
            "case_id": "A", "session": "2026-08-17",
            "replay_start": "2026-08-17T10:00:00-04:00",
            "replay_end": "2026-08-17T10:10:00-04:00",
            "context_1m": [], "context_5m": [], "context_15m": [], "replay_1m": [],
        }],
    }
    key = {"pack_id": "P", "answers": {}}
    lab.write_lab_v3(tmp_path, review, key)
    html = (tmp_path / "review_v3.html").read_text(encoding="utf-8")
    assert lab.LWC_FILE in html
    assert "LC.createChart" in html and "LC.CandlestickSeries" in html
    assert "+1m" in html and "+5m" in html and "▶ Play" in html
    assert "Draw Key Zone" in html
    assert "Draw Reaction Cluster" in html
    assert "requestFullscreen" in html
    assert "first meaningful <b>reaction cluster</b>" in html
    assert "side-by-side candles" in html
    assert '"bot_action"' not in html


def test_v3_grader_compares_exact_entry_minute_and_reaction_cluster():
    review = {"pack_id": "P", "cases": [{"case_id": "A"}]}
    key = {"pack_id": "P", "answers": {"A": {
        "case_id": "A", "hidden_case_kind": "ENTRY", "bot_action": "ENTER_LONG",
        "bot_entry_time": "2026-08-17T10:03:00-04:00", "bot_setup": "REV",
        "bot_reason": "ZONE_REJECTION_STORY_THEN_INTRA5_FORCE", "bot_location_id": "Z",
        "bot_relevant_zones": [_loc("Z", "S", 100)], "bot_entry_price": 104,
        "bot_tp_reaction_cluster": {"lo": 110, "hi": 112}, "gold_reference_ids": ["V24G08_LIVE_MOMENTUM_FORCE_BEFORE_CANDLE_CLOSE"],
    }}}
    labels = [{
        "case_id": "A", "final_action": "ENTER_LONG",
        "first_entry_time": "2026-08-17T10:04:00-04:00", "entry_force": "FORCE_REAL",
        "trader_zones": [{"lo": 99, "hi": 101, "role": "SUPPORT"}],
        "trader_tp_reaction_cluster": {"lo": 110.25, "hi": 112.25},
        "decision_timeline": [], "note": "",
    }]
    grade = lab.grade_labels_v3(labels, review, key)
    row = grade["rows"][0]
    assert row["action_agreement"] is True
    assert row["entry_timing_delta_minutes"] == 1.0
    assert row["tp_reaction_cluster_grade"]["center_error_ticks"] == 1.0
    serialized = json.dumps(grade).lower()
    assert '"net_pnl"' not in serialized and '"gross_pnl"' not in serialized
