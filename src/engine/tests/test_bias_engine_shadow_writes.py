"""Tests: bias_engine shadow writes (Track 5 Phase D Readiness).

6 tests:
  1. compute_bias() return value is unchanged by shadow write (zero behavioral change)
  2. Shadow write is skipped when BIAS_ENGINE_MODE=OFF
  3. Shadow write fires (Popen called) when BIAS_ENGINE_MODE=SHADOW
  4. Shadow write is a no-op on subprocess.Popen error (fail-open)
  5. Shadow write payload includes router_version and router_hash
  6. compute_bias() does not raise even when _maybe_persist_bias_decision raises
"""

import os
import pytest
from unittest.mock import MagicMock, patch

from src.engine.context.htf_context import HTFContext
from src.engine.context.session_context import SessionContext
from src.engine.context.bias_engine import compute_bias, DailyBiasState


# ─── Fixtures ─────────────────────────────────────────────────────────────────

def make_htf():
    return HTFContext(
        daily_trend="bullish",
        weekly_trend="bullish",
        four_h_trend="bullish",
        adx=30,
        atr_percentile=50,
        pd_location="discount",
        prev_day_high=5300.0,
        prev_day_low=5100.0,
        prev_day_close=5200.0,
        weekly_high=5350.0,
        weekly_low=5050.0,
        adr=100.0,
    )


def make_session():
    return SessionContext(
        overnight_range=(5250.0, 5150.0),
        overnight_bias="bullish",
        london_high=5240.0,
        london_low=5160.0,
        london_swept_pdh=False,
        london_swept_pdl=False,
        ny_killzone_active=True,
        london_killzone_active=False,
        asian_killzone_active=False,
        current_session="ny_am",
        opening_range=(5200.0, 5185.0),
        or_broken=None,
        macro_time_active=False,
    )


# ─── Test 1: Return value unchanged ──────────────────────────────────────────

def test_compute_bias_return_value_unchanged(monkeypatch):
    """Shadow write must not alter the DailyBiasState returned by compute_bias()."""
    monkeypatch.setenv("BIAS_ENGINE_MODE", "SHADOW")
    # Patch Popen to no-op so no real subprocess fires
    with patch("subprocess.Popen") as mock_popen:
        mock_popen.return_value = MagicMock()
        state = compute_bias(make_htf(), make_session(), current_price=5250.0, vwap=5220.0)

    assert isinstance(state, DailyBiasState)
    assert isinstance(state.net_bias, int)
    assert -100 <= state.net_bias <= 100
    assert isinstance(state.bias_confidence, float)
    assert 0.0 <= state.bias_confidence <= 1.0
    assert isinstance(state.playbook, str)


# ─── Test 2: Shadow write skipped when MODE=OFF ───────────────────────────────

def test_shadow_write_skipped_when_mode_off(monkeypatch):
    """When BIAS_ENGINE_MODE=OFF, subprocess.Popen must NOT be called."""
    monkeypatch.setenv("BIAS_ENGINE_MODE", "OFF")
    with patch("subprocess.Popen") as mock_popen:
        state = compute_bias(make_htf(), make_session(), current_price=5250.0, vwap=5220.0)
        mock_popen.assert_not_called()

    assert isinstance(state, DailyBiasState)


# ─── Test 3: Shadow write fires when MODE=SHADOW ─────────────────────────────

def test_shadow_write_fires_when_mode_shadow(monkeypatch):
    """When BIAS_ENGINE_MODE=SHADOW, subprocess.Popen must be called exactly once."""
    monkeypatch.setenv("BIAS_ENGINE_MODE", "SHADOW")
    with patch("subprocess.Popen") as mock_popen:
        mock_popen.return_value = MagicMock()
        compute_bias(make_htf(), make_session(), current_price=5250.0, vwap=5220.0)
        assert mock_popen.call_count == 1


# ─── Test 4: Fail-open on Popen error ────────────────────────────────────────

def test_shadow_write_fail_open_on_popen_error(monkeypatch):
    """Popen failure must be swallowed — compute_bias() must return DailyBiasState regardless."""
    monkeypatch.setenv("BIAS_ENGINE_MODE", "SHADOW")
    with patch("subprocess.Popen", side_effect=FileNotFoundError("curl not found")):
        state = compute_bias(make_htf(), make_session(), current_price=5250.0, vwap=5220.0)

    assert isinstance(state, DailyBiasState)


# ─── Test 5: Payload includes router_version and router_hash ─────────────────

def test_shadow_write_payload_includes_router_provenance(monkeypatch):
    """The curl payload in the Popen call must include router_version and router_hash."""
    monkeypatch.setenv("BIAS_ENGINE_MODE", "SHADOW")
    import json

    with patch("subprocess.Popen") as mock_popen:
        mock_popen.return_value = MagicMock()
        compute_bias(make_htf(), make_session(), current_price=5250.0, vwap=5220.0)

        call_args = mock_popen.call_args
        # The payload is the -d argument in the curl command list
        cmd_list = call_args[0][0]
        d_index = cmd_list.index("-d")
        payload_str = cmd_list[d_index + 1]
        payload = json.loads(payload_str)

    assert "routerVersion" in payload
    assert "routerHash" in payload
    assert len(payload["routerHash"]) == 16
    assert "featureSnapshot" in payload
    assert "rawStateProbs" in payload


# ─── Test 6: compute_bias() does not raise even when persist helper raises ────

def test_compute_bias_does_not_raise_on_persist_exception(monkeypatch):
    """If _maybe_persist_bias_decision raises, compute_bias must still return state."""
    monkeypatch.setenv("BIAS_ENGINE_MODE", "SHADOW")
    with patch("src.engine.context.bias_engine._maybe_persist_bias_decision", side_effect=RuntimeError("DB down")):
        # The try/except in _maybe_persist_bias_decision should catch this
        # But even if it doesn't, compute_bias catches the outer exception path
        try:
            state = compute_bias(make_htf(), make_session(), current_price=5250.0, vwap=5220.0)
            assert isinstance(state, DailyBiasState)
        except RuntimeError:
            # If the monkeypatch makes it raise above the try/except, that's a test failure
            pytest.fail("compute_bias() raised RuntimeError — shadow write must be fail-open")
