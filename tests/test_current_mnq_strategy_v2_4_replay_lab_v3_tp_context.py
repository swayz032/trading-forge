from __future__ import annotations

from pathlib import Path

import pytest

from research.current_mnq_strategy_v2_4_replay_lab_v3_tp_context import (
    NO_VISIBLE_MEANINGFUL_REACTION,
    TP_NOT_CAPTURABLE_FROM_PRESENTED_CONTEXT,
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


def test_browser_patch_preserves_completed_work_and_only_blocks_missing_final_action(tmp_path):
    html = tmp_path / "review_v3.html"
    html.write_text("<html><body><div id='x'></div></body></html>", encoding="utf-8")
    out = patch(html)
    assert MARKER in out
    assert MARKER.endswith("_V2")
    assert "Do not invent a TP" in out
    assert "BULLISH — NO VISIBLE REACTION" in out
    assert "BEARISH — NO VISIBLE REACTION" in out
    assert "The opposite-direction TP is optional" in out
    assert "TP_NOT_CAPTURABLE_FROM_PRESENTED_CONTEXT" in out
    assert "recoverFinalAction" in out
    assert "Migrate work made in older replay builds" in out
    assert "saved label missing" in out
    assert "final action missing" in out
    assert "FROZEN_WITH_PRESENTED_CONTEXT_CAPTURE_GAPS" in out
    assert "Save Draft" in out
