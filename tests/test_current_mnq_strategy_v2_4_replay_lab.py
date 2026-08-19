from __future__ import annotations

from types import SimpleNamespace

import pandas as pd
import pytest

from research import current_mnq_strategy_v2_4_replay_lab as lab

TZ = "America/New_York"


def _bars():
    idx = pd.date_range("2026-08-17 10:00", periods=6, freq="1min", tz=TZ)
    return pd.DataFrame({
        "open": [100, 101, 102, 103, 104, 105],
        "high": [101, 102, 103, 104, 105, 106],
        "low": [99, 100, 101, 102, 103, 104],
        "close": [101, 102, 103, 104, 105, 106],
    }, index=idx)


def test_completed_bar_slice_never_exposes_future_minute():
    bars = _bars()
    cutoff = pd.Timestamp("2026-08-17 10:03", tz=TZ)
    q = lab._completed_bars(bars, cutoff, 1, 25)
    assert list(q.index) == list(bars.index[:3])
    assert all((ts + pd.Timedelta(minutes=1)) <= cutoff for ts in q.index)


def test_blind_pack_refuses_pnl_or_bot_answer_leak():
    clean = {"cases": [{"case_id": "A", "one_minute": [], "five_minute": [], "zones": []}]}
    lab._assert_blind(clean)
    with pytest.raises(RuntimeError, match="REPLAY_BLIND_PACK_LEAK"):
        lab._assert_blind({"cases": [{"case_id": "A", "net_pnl": 10.0}]})
    with pytest.raises(RuntimeError, match="REPLAY_BLIND_PACK_LEAK"):
        lab._assert_blind({"cases": [{"case_id": "A", "bot_action": "ENTER_LONG"}]})


def test_grader_surfaces_bot_enter_vs_trader_wait_disagreement():
    review = {
        "cases": [{"case_id": "A"}],
    }
    key = {
        "answers": {
            "A": {
                "case_id": "A", "bot_action": "ENTER_LONG",
                "bot_confirmed_time": "2026-08-17T10:03:00-04:00",
                "setup": "REV", "candidate_reason": "ZONE_REJECTION_STORY_THEN_INTRA5_FORCE",
                "location_id": "Z1",
            }
        }
    }
    labels = [{"case_id": "A", "trader_action": "WAIT", "trader_force": "TUG_OF_WAR"}]
    grade = lab.grade_labels(labels, review, key)
    assert grade["action_agreement_rate"] == 0.0
    assert grade["disagreements"][0]["disagreement_type"] == "ENTER_LONG__VS__WAIT"


def test_label_validation_is_fail_closed_and_complete():
    review = {"cases": [{"case_id": "A"}, {"case_id": "B"}]}
    with pytest.raises(RuntimeError, match="REPLAY_MISSING_LABELS"):
        lab.validate_labels([
            {"case_id": "A", "trader_action": "WAIT", "trader_force": "TUG_OF_WAR"}
        ], review)
    with pytest.raises(RuntimeError, match="REPLAY_BAD_ACTION"):
        lab.validate_labels([
            {"case_id": "A", "trader_action": "MAYBE", "trader_force": "TUG_OF_WAR"},
            {"case_id": "B", "trader_action": "WAIT", "trader_force": "NOT_APPLICABLE"},
        ], review)


def test_build_pack_keeps_bot_answer_out_of_review(monkeypatch):
    ts = pd.Timestamp("2026-08-17 10:03", tz=TZ)
    cand = SimpleNamespace(
        direction="L", setup="REV", reason="ZONE_REJECTION_STORY_THEN_INTRA5_FORCE",
        location=SimpleNamespace(id="Z1"),
    )
    monkeypatch.setattr(lab, "_first_signal", lambda *a, **k: (cand, ts))
    monkeypatch.setattr(lab, "_zone_touch_times", lambda *a, **k: [])
    monkeypatch.setattr(lab, "_blind_case", lambda *a, **k: lab.ReplayCase(
        "RPL-A", "2026-08-17", ts.isoformat(), "BOT_FIRST_A_PLUS_CLOCK", [], [], []
    ))
    review, key = lab.build_replay_pack({}, [ts.date()], max_entry_cases=1, max_touch_cases=0)
    assert "bot_action" not in str(review)
    assert key["answers"]["RPL-A"]["bot_action"] == "ENTER_LONG"
