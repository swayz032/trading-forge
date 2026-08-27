from __future__ import annotations

import json
from types import SimpleNamespace

import pandas as pd
import pytest

from research import current_mnq_strategy_v2_4_replay_lab as lab

TZ = "America/New_York"


def _bars(freq="1min", periods=12):
    idx = pd.date_range("2026-08-17 10:00", periods=periods, freq=freq, tz=TZ)
    base = list(range(100, 100 + periods))
    return pd.DataFrame({
        "open": base,
        "high": [x + 1 for x in base],
        "low": [x - 1 for x in base],
        "close": [x + 0.5 for x in base],
    }, index=idx)


def test_completed_bar_slices_never_expose_future_data():
    one = _bars()
    cutoff = pd.Timestamp("2026-08-17 10:03", tz=TZ)
    q1 = lab._completed_bars(one, cutoff, 1, 30)
    assert list(q1.index) == list(one.index[:3])
    assert all((ts + pd.Timedelta(minutes=1)) <= cutoff for ts in q1.index)

    h15 = _bars("15min", 8)
    cutoff15 = pd.Timestamp("2026-08-17 10:46", tz=TZ)
    q15 = lab._completed_bars(h15, cutoff15, 15, 600)
    assert all((ts + pd.Timedelta(minutes=15)) <= cutoff15 for ts in q15.index)


def test_blind_pack_refuses_bot_zone_tp_case_type_or_pnl_leak():
    clean = {"cases": [{"case_id": "A", "one_minute": [], "five_minute": [], "fifteen_minute": []}]}
    lab._assert_blind(clean)
    for bad in (
        {"bot_action": "ENTER_LONG"},
        {"bot_zones": []},
        {"bot_tp_zone": {"lo": 1, "hi": 2}},
        {"hidden_case_kind": "ENTRY"},
        {"case_kind": "ENTRY"},
        {"net_pnl": 100},
    ):
        with pytest.raises(RuntimeError, match="REPLAY_BLIND_PACK_LEAK"):
            lab._assert_blind({"cases": [{"case_id": "A", **bad}]})


def test_entry_label_requires_key_zone_and_tp_zone():
    review = {"cases": [{"case_id": "A"}]}
    with pytest.raises(RuntimeError, match="REPLAY_ENTRY_WITHOUT_KEY_ZONE"):
        lab.validate_labels([{
            "case_id": "A", "trader_action": "ENTER_LONG", "trader_force": "FORCE_REAL",
            "trader_zones": [], "trader_tp_zone": {"lo": 110, "hi": 112},
        }], review)
    with pytest.raises(RuntimeError, match="REPLAY_ENTRY_WITHOUT_TP_ZONE"):
        lab.validate_labels([{
            "case_id": "A", "trader_action": "ENTER_LONG", "trader_force": "FORCE_REAL",
            "trader_zones": [{"lo": 100, "hi": 102, "role": "SUPPORT"}], "trader_tp_zone": None,
        }], review)


def test_zone_geometry_is_mnq_tick_aware():
    exact = lab._geometry((100.0, 102.0), (100.0, 102.0))
    assert exact["iou"] == 1.0
    assert exact["center_error_ticks"] == 0.0
    shifted = lab._geometry((100.25, 102.25), (100.0, 102.0))
    assert shifted["center_error_ticks"] == 1.0
    assert shifted["low_edge_error_ticks"] == 1.0


def test_grader_surfaces_action_and_zone_disagreement_without_pnl_threshold():
    review = {"pack_id": "P", "cases": [{"case_id": "A"}]}
    key = {
        "pack_id": "P",
        "answers": {"A": {
            "case_id": "A", "hidden_case_kind": "ENTRY", "bot_action": "ENTER_LONG",
            "bot_confirmed_time": "2026-08-17T10:03:00-04:00", "bot_setup": "REV",
            "bot_reason": "ZONE_REJECTION_STORY_THEN_INTRA5_FORCE", "bot_location_id": "Z1",
            "bot_zones": [{"id": "Z1", "side": "S", "lo": 100.0, "hi": 102.0,
                           "mid": 101.0, "source": "X", "entry_authorized": True}],
            "bot_entry_price": 104.0,
            "bot_tp_zone": {"lo": 110.0, "hi": 112.0, "target_executable": 111.0},
        }},
    }
    labels = [{
        "case_id": "A", "trader_action": "WAIT", "trader_force": "TUG_OF_WAR",
        "trader_zones": [{"lo": 100.25, "hi": 102.25, "role": "SUPPORT"}],
        "trader_tp_zone": None,
    }]
    grade = lab.grade_labels(labels, review, key)
    assert grade["action_agreement_rate"] == 0.0
    assert grade["disagreements"][0]["disagreement_type"] == "ENTER_LONG__VS__WAIT"
    match = grade["rows"][0]["key_zone_grade"]["matches"][0]
    assert match["center_error_ticks"] == 1.0
    serialized = json.dumps(grade).lower()
    for forbidden_key in ('"pnl"', '"net_pnl"', '"gross_pnl"'):
        assert forbidden_key not in serialized


def test_same_side_entry_grades_tp_geometry():
    review = {"pack_id": "P", "cases": [{"case_id": "A"}]}
    key = {"pack_id": "P", "answers": {"A": {
        "case_id": "A", "hidden_case_kind": "ENTRY", "bot_action": "ENTER_LONG",
        "bot_confirmed_time": "2026-08-17T10:03:00-04:00", "bot_setup": "REV",
        "bot_reason": "X", "bot_location_id": "Z", "bot_entry_price": 104.0,
        "bot_zones": [{"id": "Z", "side": "S", "lo": 100, "hi": 102, "mid": 101,
                       "source": "X", "entry_authorized": True}],
        "bot_tp_zone": {"lo": 110.0, "hi": 112.0, "target_executable": 111.0},
    }}}
    labels = [{
        "case_id": "A", "trader_action": "ENTER_LONG", "trader_force": "FORCE_REAL",
        "trader_zones": [{"lo": 100, "hi": 102, "role": "SUPPORT"}],
        "trader_tp_zone": {"lo": 110.25, "hi": 112.25},
    }]
    g = lab.grade_labels(labels, review, key)
    assert g["rows"][0]["tp_zone_grade"]["center_error_ticks"] == 1.0


def test_build_pack_keeps_bot_map_and_case_type_out_of_review(monkeypatch):
    ts = pd.Timestamp("2026-08-17 10:03", tz=TZ)
    cand = SimpleNamespace(
        direction="L", setup="REV", reason="ZONE_REJECTION_STORY_THEN_INTRA5_FORCE",
        location=SimpleNamespace(id="Z1"),
    )
    monkeypatch.setattr(lab, "_first_signal", lambda *a, **k: (cand, ts, SimpleNamespace()))
    monkeypatch.setattr(lab, "_zone_rows", lambda *a, **k: [
        {"id": "Z1", "side": "S", "lo": 100.0, "hi": 102.0, "mid": 101.0,
         "source": "X", "entry_authorized": True}
    ])
    monkeypatch.setattr(lab, "_bot_target", lambda *a, **k: (104.0, {"lo": 110.0, "hi": 112.0}))
    monkeypatch.setattr(lab, "_zone_touch_times", lambda *a, **k: [])
    monkeypatch.setattr(lab, "_no_authorized_zone_clock", lambda *a, **k: None)
    monkeypatch.setattr(lab, "_blind_case", lambda *a, **k: lab.ReplayCase(
        "RPL2-A", "2026-08-17", ts.isoformat(), [], [], []
    ))
    review, key = lab.build_replay_pack(
        {}, [ts.date()], max_entry_cases=1, max_touch_cases=0, max_no_zone_cases=0,
    )
    text = json.dumps(review)
    assert "bot_action" not in text
    assert "bot_zones" not in text
    assert "case_kind" not in text
    assert key["answers"]["RPL2-A"]["bot_action"] == "ENTER_LONG"
    assert key["answers"]["RPL2-A"]["bot_zones"][0]["id"] == "Z1"


def test_safe_html_is_simple_functional_and_has_no_answer_key(tmp_path):
    review = {
        "schema_version": 2, "pack_id": "PACK", "case_count": 1,
        "cases": [{
            "case_id": "A", "session": "2026-08-17", "decision_time": "2026-08-17T10:03:00-04:00",
            "one_minute": [], "five_minute": [], "fifteen_minute": [],
        }],
    }
    key = {"schema_version": 2, "pack_id": "PACK", "answers": {"A": {"bot_action": "ENTER_LONG"}}}
    lab.write_lab(tmp_path, review, key)
    html = (tmp_path / "review.html").read_text(encoding="utf-8")
    assert "chart15" in html and "chart5" in html and "chart1" in html
    assert "Draw Key Zone" in html and "Draw TP Zone" in html
    assert "Freeze & Export Labels" in html
    assert "localStorage" in html
    assert '"bot_action"' not in html
    assert (tmp_path / "answer_key.json").exists()
