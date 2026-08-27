from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from research.current_mnq_strategy_v2_3_shadow import summarize_shadow


def event(ts, session="2026-08-17", *, kind="HEARTBEAT", would_trade=False,
          note=None, semantics="h", working=0, position=0):
    return {
        "timestamp_utc": ts.isoformat(),
        "session": session,
        "semantics_sha256": semantics,
        "event_type": kind,
        "would_trade": would_trade,
        "account_simulated": True,
        "user_hub_connected": True,
        "market_hub_connected": True,
        "working_orders": working,
        "broker_position": position,
        "note": note,
    }


def write(path, rows):
    path.write_text("\n".join(json.dumps(r) for r in rows) + "\n")


def full_coverage_rows(session="2026-08-17"):
    # 09:30–12:00 ET on Aug 17 2026 = 13:30–16:00 UTC.
    start = datetime(2026, 8, 17, 13, 30, tzinfo=timezone.utc)
    return [event(start + timedelta(seconds=60 * i), session) for i in range(151)]


def test_single_good_snapshot_does_not_count_as_full_shadow_day(tmp_path):
    p = tmp_path / "s.jsonl"
    write(p, [event(datetime(2026, 8, 17, 14, 0, tzinfo=timezone.utc), kind="DECISION")])
    assert summarize_shadow(p)["full_sessions"] == 0


def test_continuous_60_second_heartbeats_count_one_full_session(tmp_path):
    p = tmp_path / "s.jsonl"
    rows = full_coverage_rows()
    rows.append(event(
        datetime(2026, 8, 17, 14, 5, tzinfo=timezone.utc),
        kind="DECISION", would_trade=True,
    ))
    write(p, rows)
    s = summarize_shadow(p)
    assert s["full_sessions"] == 1
    assert s["would_trade_sessions"] == 1
    assert s["unreconciled_state_events"] == 0
    assert s["missed_first_signal_events"] == 0


def test_heartbeat_gap_over_90_seconds_invalidates_full_session(tmp_path):
    p = tmp_path / "s.jsonl"
    rows = full_coverage_rows()
    # Delete two consecutive minute heartbeats -> 180-second gap.
    del rows[50:52]
    write(p, rows)
    assert summarize_shadow(p)["full_sessions"] == 0


def test_broker_state_contamination_is_counted(tmp_path):
    p = tmp_path / "s.jsonl"
    rows = full_coverage_rows()
    rows[20]["working_orders"] = 1
    rows[30]["broker_position"] = 2
    write(p, rows)
    assert summarize_shadow(p)["unreconciled_state_events"] == 2


def test_missed_first_a_plus_event_is_zero_tolerance_evidence(tmp_path):
    p = tmp_path / "s.jsonl"
    rows = full_coverage_rows()
    rows.append(event(
        datetime(2026, 8, 17, 14, 10, tzinfo=timezone.utc),
        kind="DECISION", would_trade=False, note="MISSED_FIRST_A_PLUS_SIGNAL",
    ))
    write(p, rows)
    s = summarize_shadow(p)
    assert s["full_sessions"] == 1
    assert s["missed_first_signal_events"] == 1


def test_setup_and_execution_replay_mismatches_are_counted(tmp_path):
    p = tmp_path / "s.jsonl"
    rows = full_coverage_rows()
    rows.append({
        "timestamp_utc": "2026-08-17T20:30:00+00:00",
        "session": "2026-08-17",
        "semantics_sha256": "h",
        "event_type": "REPLAY_PARITY",
        "signal_fingerprint": "setup-live",
        "replay_signal_fingerprint": "setup-live",
        "execution_fingerprint": "exec-live",
        "replay_execution_fingerprint": "exec-different",
    })
    write(p, rows)
    assert summarize_shadow(p)["signal_parity_mismatches"] == 1
