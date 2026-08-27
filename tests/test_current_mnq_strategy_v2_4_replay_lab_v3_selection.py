from __future__ import annotations

from types import SimpleNamespace

import pandas as pd

from research import current_mnq_strategy_v2_4_replay_lab_v3 as v3
from research import current_mnq_strategy_v2_4_replay_lab_v3_selection as sel

TZ = "America/New_York"


def _loc(i="Z", side="S", mid=100.0):
    return {
        "id": i, "side": side, "lo": mid - 1.0, "hi": mid + 1.0,
        "mid": mid, "source": "TEST", "entry_authorized": True,
    }


def _full(dte, i):
    t = pd.Timestamp(f"{dte} 10:{10+i:02d}", tz=TZ)
    cand = SimpleNamespace(
        direction="L" if i % 2 == 0 else "S", setup="REV",
        reason="ZONE_REJECTION_STORY_THEN_INTRA5_FORCE",
        location=SimpleNamespace(id=f"E{i}"),
    )
    picked = SimpleNamespace(
        location=SimpleNamespace(lo=120.0, hi=124.0, mid=122.0, source="REACTION"),
        kind="KEY_ZONE_15M", raw_price=122.0, executable_price=122.0,
        first_contact_distance=20.0,
    )
    return cand, t, SimpleNamespace(), t, 100.0, picked, "OK"


def _case(dte, anchor, kind):
    return v3.ReplayCaseV3(
        v3._case_id(dte, anchor, kind), str(dte),
        (anchor - pd.Timedelta(minutes=5)).isoformat(),
        (anchor + pd.Timedelta(minutes=5)).isoformat(),
        [{
            "start": (anchor - pd.Timedelta(minutes=1)).isoformat(),
            "end": anchor.isoformat(), "open": 100, "high": 101,
            "low": 99, "close": 100,
        }], [], [], [],
    )


def test_diverse_builder_uses_momentum_near_misses_instead_of_repeating_sessions(monkeypatch):
    days = list(pd.date_range("2026-03-01", periods=16, freq="D").date)

    def fake_full(env, dte, p):
        i = days.index(dte)
        return _full(dte, i) if i < 11 else None

    def fake_miss(env, dte, p):
        i = days.index(dte)
        if i < 11:
            return None
        t = pd.Timestamp(f"{dte} 10:30", tz=TZ)
        cand = SimpleNamespace(
            direction="L", setup="REV",
            reason="ZONE_REJECTION_STORY_THEN_INTRA5_FORCE",
            location=SimpleNamespace(id=f"M{i}"),
        )
        return cand, t, SimpleNamespace(), t, 100.0, "FIRST_REACTION_TOO_CLOSE"

    # The diversity builder now owns the production-policy authoritative helper.
    # Patch that exact seam so this remains a sampling test rather than falling
    # through into the real market-data kernel with the deliberately empty env.
    monkeypatch.setattr(sel, "_authoritative_first_entry", fake_full)
    monkeypatch.setattr(sel, "_first_momentum_near_miss", fake_miss)
    monkeypatch.setattr(v3, "_make_case", lambda env, dte, anchor, kind: _case(dte, anchor, kind))
    monkeypatch.setattr(v3, "_zone_rows", lambda *a, **k: [_loc()])

    review, key = sel.build_replay_pack_v3_diverse(
        {}, days, SimpleNamespace(), max_cases=16, max_entry_cases=11,
        min_entry_cases=8, min_momentum_near_miss_cases=4,
    )
    assert review["case_count"] == 16
    assert review["session_count"] == 16
    assert len({c["session"] for c in review["cases"]}) == 16
    receipt = key["sampling_receipt"]
    assert receipt["authoritative_entry_cases"] == 11
    assert receipt["momentum_near_miss_cases"] == 5
    assert receipt["pnl_or_exit_outcome_used"] is False
    misses = [x for x in key["answers"].values() if x["hidden_case_kind"] == "MOMENTUM_FORCE_CANDIDATE_REJECTED_BY_ROOM_OR_TP"]
    assert len(misses) == 5
    assert all(x["bot_action"] == "NO_TRADE" for x in misses)
    assert all(x["bot_tp_reaction_cluster"] is None for x in misses)
    assert all("FINAL_GATE:FIRST_REACTION_TOO_CLOSE" in x["bot_reason"] for x in misses)


def test_near_miss_is_not_mislabeled_as_entry(monkeypatch):
    t = pd.Timestamp("2026-03-20 10:12", tz=TZ)
    cand = SimpleNamespace(
        direction="L", setup="REV", reason="ZONE_REJECTION_STORY_THEN_INTRA5_FORCE",
        location=SimpleNamespace(id="Z"),
    )
    monkeypatch.setattr(sel, "iter_actionable_candidates", lambda *a, **k: iter([(cand, t, SimpleNamespace())]))
    monkeypatch.setattr(sel.eng.core, "one_minute_entry", lambda *a, **k: (t, 100.0, 100.0))
    monkeypatch.setattr(sel, "build_and_classify", lambda *a, **k: (None, "FIRST_REACTION_TOO_CLOSE"))
    env = {k: object() for k in ("one", "piv5", "full5", "h15", "pdm", "pwm", "piv15")}
    got = sel._first_momentum_near_miss(env, t.date(), SimpleNamespace())
    assert got is not None
    assert got[0] is cand
    assert got[3] == t
    assert got[5] == "FIRST_REACTION_TOO_CLOSE"
