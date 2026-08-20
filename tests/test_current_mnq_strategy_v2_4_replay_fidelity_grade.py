from __future__ import annotations

from research import current_mnq_strategy_v2_4_replay_fidelity_grade as grade


def _loc(i="Z", side="S", mid=100.0):
    return {
        "id": i, "side": side, "lo": mid - 1.0, "hi": mid + 1.0,
        "mid": mid, "source": "TEST", "entry_authorized": True,
    }


def test_wait_is_legal_and_never_relabelled_no_trade():
    review = {"pack_id": "P", "cases": [{"case_id": "A"}]}
    labels = [{
        "case_id": "A", "final_action": "WAIT", "first_entry_time": None,
        "entry_force": "TUG_OF_WAR", "trader_zones": [],
        "trader_tp_reaction_cluster": None,
    }]
    key = {"pack_id": "P", "answers": {"A": {
        "case_id": "A", "bot_action": "NO_TRADE", "bot_entry_time": None,
        "bot_setup": None, "bot_reason": None, "bot_relevant_zones": [],
        "bot_tp_reaction_cluster": None, "gold_reference_ids": [],
    }}}
    out = grade.grade_wait_preserving_labels(labels, review, key)
    row = out["rows"][0]
    assert row["trader_action"] == "WAIT"
    assert row["bot_action"] == "NO_TRADE"
    assert row["exact_action_agreement"] is False
    assert row["entered_behavior_agreement"] is True
    assert row["trader_wait_preserved"] is True
    assert out["trader_wait_count"] == 1


def test_exact_entry_timing_is_preserved_without_pnl_fields():
    review = {"pack_id": "P", "cases": [{"case_id": "A"}]}
    labels = [{
        "case_id": "A", "final_action": "ENTER_LONG",
        "first_entry_time": "2026-08-17T10:02:00-04:00", "entry_force": "FORCE_REAL",
        "trader_zones": [{"lo": 99.0, "hi": 101.0, "role": "SUPPORT"}],
        "trader_tp_reaction_cluster": {"lo": 120.0, "hi": 120.0},
    }]
    key = {"pack_id": "P", "answers": {"A": {
        "case_id": "A", "bot_action": "ENTER_LONG",
        "bot_entry_time": "2026-08-17T10:04:00-04:00", "bot_setup": "REV",
        "bot_reason": "ZONE_REJECTION_STORY_THEN_INTRA5_FORCE",
        "bot_relevant_zones": [_loc()],
        "bot_tp_reaction_cluster": {"lo": 120.0, "hi": 120.0},
        "gold_reference_ids": ["V24G08_LIVE_MOMENTUM_FORCE_BEFORE_CANDLE_CLOSE"],
    }}}
    out = grade.grade_wait_preserving_labels(labels, review, key)
    row = out["rows"][0]
    assert row["entry_timing_delta_minutes"] == -2.0
    assert out["same_direction_entry_timing_deltas_minutes"] == [-2.0]
    text = str(out).lower()
    assert "net_pnl" not in text and "gross_pnl" not in text and "winner" not in text
