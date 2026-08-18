from __future__ import annotations

from types import SimpleNamespace

import pandas as pd

from research import current_mnq_strategy_v2_4_engine as eng
from research import current_mnq_strategy_v2_4_kernel as ker
from research import current_mnq_strategy_v2_4_signal as sig


def _env():
    now = pd.Timestamp("2026-08-17 10:00", tz="America/New_York")
    old = now - pd.Timedelta(days=80)
    full5 = pd.DataFrame(
        {"open": [90.0, 100.0], "high": [91.0, 101.0], "low": [89.0, 99.0], "close": [90.5, 100.5]},
        index=[old, now],
    )
    r5 = pd.DataFrame(
        {"open": [100.0], "high": [101.0], "low": [99.0], "close": [100.5], "atr": [10.0]},
        index=[now],
    )
    return {"full5": full5, "r5": r5, "h15": pd.DataFrame(), "pdm": {}, "pwm": {}, "pcm": {}}


def test_historical_and_live_import_the_exact_same_candidate_kernel():
    assert eng.iter_actionable_candidates is ker.iter_actionable_candidates
    assert sig.iter_actionable_candidates is ker.iter_actionable_candidates


def test_kernel_uses_v24_level_builder_not_legacy_entry_map():
    source = open(ker.__file__, encoding="utf-8").read()
    assert "build_entry_locations_v24" in source
    assert "core.build_entry_locations(env" not in source


def test_zone_candle_gate_can_veto_an_old_style_complete_reversal(monkeypatch):
    env = _env(); ts = env["r5"].index[0]
    loc = ker.core.Location(
        id="S1", side="S", lo=99.0, hi=100.0, mid=99.5, source="WICK_ZONE",
        quality=0.9, confluence=2, entry_authorized=True, zone=None,
    )
    monkeypatch.setattr(ker.core, "premarket_plan", lambda *a, **k: SimpleNamespace(primary="BULL"))
    monkeypatch.setattr(ker, "build_entry_locations_v24", lambda *a, **k: ([loc], []))
    monkeypatch.setattr(ker.core, "bar_interacts", lambda *a, **k: True)
    monkeypatch.setattr(ker.core, "reversal_story", lambda *a, **k: SimpleNamespace(complete=True))
    monkeypatch.setattr(ker.core, "plan_allows", lambda *a, **k: True)
    monkeypatch.setattr(ker, "gate_candidate", lambda **k: SimpleNamespace(allowed=False, reason="NO_ZONE_NO_TRADE"))
    got = list(ker.iter_actionable_candidates(env, ts.date(), eng.Params()))
    assert got == []


def test_zone_candle_gate_is_present_on_rev_brk5_and_brk15_paths():
    source = open(ker.__file__, encoding="utf-8").read()
    assert 'setup="REV"' in source
    assert 'setup="BRK5"' in source
    assert source.count('setup="BRK15"') >= 2
    assert "WAIT_FOR_NEW_COMPLETED_15M_ACCEPTANCE" in source
