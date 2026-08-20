from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pandas as pd

from research import current_mnq_strategy_v2_4_replay_lab_v3_calibration_generate as cal

TZ = "America/New_York"


def _bars(index):
    q = pd.DataFrame(index=index)
    q["open"] = 100.0
    q["high"] = 101.0
    q["low"] = 99.0
    q["close"] = 100.0
    return q


def test_calibration_requirements_lock_bilateral_context_momentum_and_fvg_midpoint():
    req = json.loads(Path("research/current_mnq_strategy_v2_4_replay_calibration_requirements.json").read_text())
    assert req["status"] == "LOCKED_TRADER_FIDELITY_CALIBRATION_REQUIREMENTS"
    assert req["chart_context"]["context_15m_lookback_calendar_days"] == 40
    assert req["chart_context"]["context_5m_lookback_calendar_days"] == 10
    assert req["chart_context"]["bilateral_reaction_context_preferred"] is True
    assert "ACTIVE_15M_FVG_MIDPOINT_WHEN_IT_OWNS_FIRST_REACTION" in req["tp_semantics"]["valid_precision_examples"]
    assert req["tp_semantics"]["fvg_is_entry_requirement"] is False
    assert req["sampling"]["priority_order"][0] == "AUTHORITATIVE_FULL_ENGINE_ENTRY_REPLAY"
    assert req["sampling"]["priority_order"][1] == "MOMENTUM_FORCE_CANDIDATE_REJECTED_BY_ROOM_OR_TP"


def test_extended_case_carries_deeper_15m_and_5m_history():
    dte = pd.Timestamp("2026-04-15").date()
    anchor = pd.Timestamp("2026-04-15 10:00", tz=TZ)
    one = _bars(pd.date_range("2026-04-15 09:00", "2026-04-15 10:30", freq="1min", tz=TZ))
    full5 = _bars(pd.date_range("2026-04-01 09:30", "2026-04-15 10:30", freq="5min", tz=TZ))
    h15 = _bars(pd.date_range("2026-03-01 09:30", "2026-04-15 10:30", freq="15min", tz=TZ))
    env = {"one": one, "full5": full5, "h15": h15}
    case = cal._extended_make_case(env, dte, anchor, "TEST")
    assert len(case.context_15m) > len(case.context_5m) / 10
    assert pd.Timestamp(case.context_15m[0]["start"]) <= anchor - pd.Timedelta(days=39)
    assert pd.Timestamp(case.context_5m[0]["start"]) <= anchor - pd.Timedelta(days=9)


def test_bilateral_context_requires_meaningful_destination_both_directions(monkeypatch):
    calls = []
    def fake(*args, **kwargs):
        direction = args[4] if len(args) > 4 else kwargs.get("direction")
        calls.append(direction)
        return [SimpleNamespace(meaningful=True, first_contact_distance=10.0)] if direction == "L" else []
    monkeypatch.setattr(cal, "_meaningful_destinations", fake)
    assert cal._bilateral_context({}, pd.Timestamp("2026-04-15").date(), pd.Timestamp("2026-04-15 10:00", tz=TZ), 100.0, object()) is False
    monkeypatch.setattr(cal, "_meaningful_destinations", lambda *a, **k: [SimpleNamespace(meaningful=True, first_contact_distance=10.0)])
    assert cal._bilateral_context({}, pd.Timestamp("2026-04-15").date(), pd.Timestamp("2026-04-15 10:00", tz=TZ), 100.0, object()) is True
