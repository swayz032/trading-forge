from __future__ import annotations

from pathlib import Path

import pytest

from research.current_mnq_strategy_v2_4_replay_lab_v3_tp_context import (
    NO_VISIBLE_MEANINGFUL_REACTION,
    TP_NOT_CAPTURABLE_FROM_PRESENTED_CONTEXT,
    WAIT_AT_REPLAY_END,
    entry_tp_capture_complete,
    normalize_selected_tp,
    selected_tp_evidence,
    validate_labels_v3_context_aware,
)
from research.current_mnq_strategy_v2_4_replay_lab_v3_tp_context_patch import MARKER, patch


def _entry_row(action="ENTER_LONG"):
    return {
        "case_id": "A",
        "final_action": action,
        "first_entry_time": "2026-08-17T10:03:00-04:00",
        "entry_force": "FORCE_REAL",
        "trader_zones": [{"lo": 100.0, "hi": 101.0, "role": "SUPPORT"}],
        "trader_tp_reaction_cluster": None,
        "decision_timeline": [],
        "note": "",
    }


def test_entered_direction_can_explicitly_record_no_visible_meaningful_reaction_without_fake_price():
    row = _entry_row("ENTER_LONG")
    row["trader_tp_long_status"] = NO_VISIBLE_MEANINGFUL_REACTION
    assert entry_tp_capture_complete(row) is True
    tp, status = selected_tp_evidence(row)
    assert tp is None
    assert status == NO_VISIBLE_MEANINGFUL_REACTION
    normalize_selected_tp(row)
    assert row["trader_tp_reaction_cluster"] is None
    assert row["trader_tp_status"] == NO_VISIBLE_MEANINGFUL_REACTION


def test_presented_chart_context_gap_can_preserve_finished_entry_without_fake_tp():
    row = _entry_row("ENTER_SHORT")
    row["trader_tp_short_status"] = TP_NOT_CAPTURABLE_FROM_PRESENTED_CONTEXT
    assert entry_tp_capture_complete(row) is True
    validate_labels_v3_context_aware([row], {"cases": [{"case_id": "A"}]})


def test_opposite_direction_tp_is_optional_for_export_capture():
    row = _entry_row("ENTER_LONG")
    row["trader_tp_long"] = {"lo": 110.0, "hi": 110.0}
    assert "trader_tp_short" not in row
    assert entry_tp_capture_complete(row) is True


def test_missing_selected_tp_requires_explicit_context_gap_not_silent_waiver():
    row = _entry_row("ENTER_SHORT")
    assert entry_tp_capture_complete(row) is False
    review = {"cases": [{"case_id": "A"}]}
    with pytest.raises(RuntimeError, match="ENTRY_WITHOUT_TP_CAPTURE_OR_CONTEXT_GAP"):
        validate_labels_v3_context_aware([row], review)


def test_context_aware_validation_accepts_open_space_status_for_entered_direction():
    row = _entry_row("ENTER_SHORT")
    row["trader_tp_short_status"] = NO_VISIBLE_MEANINGFUL_REACTION
    validate_labels_v3_context_aware([row], {"cases": [{"case_id": "A"}]})


def test_context_aware_validation_accepts_saved_state_capture_gap_for_entry_time_and_zone():
    row = _entry_row("ENTER_LONG")
    row["first_entry_time"] = None
    row["entry_time_capture_status"] = "ENTRY_TIME_NOT_RECOVERABLE_FROM_SAVED_REPLAY_STATE"
    row["trader_zones"] = []
    row["key_zone_capture_status"] = "KEY_ZONE_NOT_CAPTURED_IN_SAVED_STATE"
    row["trader_tp_long_status"] = TP_NOT_CAPTURABLE_FROM_PRESENTED_CONTEXT
    validate_labels_v3_context_aware([row], {"cases": [{"case_id": "A"}]})


def test_wait_is_a_valid_distinct_fidelity_outcome_not_no_trade():
    row = {
        "case_id": "A",
        "final_action": WAIT_AT_REPLAY_END,
        "first_entry_time": None,
        "entry_force": "NOT_APPLICABLE",
        "trader_zones": [],
        "trader_tp_reaction_cluster": None,
        "decision_timeline": [{"time": "2026-08-17T10:20:00-04:00", "action": "WAIT", "force": "TUG_OF_WAR"}],
        "note": "",
    }
    validate_labels_v3_context_aware([row], {"cases": [{"case_id": "A"}]})
    assert row["final_action"] == "WAIT"
    assert row["final_action"] != "NO_TRADE"


def test_browser_patch_preserves_ended_wait_only_cases_as_wait(tmp_path):
    html = tmp_path / "review_v3.html"
    html.write_text("<html><body><div id='x'></div></body></html>", encoding="utf-8")
    out = patch(html)
    assert MARKER in out
    assert MARKER.endswith("_V4")
    assert "Do not invent a TP" in out
    assert "BULLISH — NO VISIBLE REACTION" in out
    assert "BEARISH — NO VISIBLE REACTION" in out
    assert "The opposite-direction TP is optional" in out
    assert "TP_NOT_CAPTURABLE_FROM_PRESENTED_CONTEXT" in out
    assert "recoverFinalAction" in out
    assert "preserveEndedWaitOnly" in out
    assert "TRADER_ENDED_PRESENTED_REPLAY_STILL_WAITING" in out
    assert "l.final_action = 'WAIT'" in out
    assert "WAIT is preserved and is not converted to NO_TRADE" in out
    assert "A full replay that ends while you are still WAITING is preserved as WAIT" in out
    assert "FROZEN_WITH_TRADER_WAIT_AT_REPLAY_END" in out
    assert "Save Draft" in out
