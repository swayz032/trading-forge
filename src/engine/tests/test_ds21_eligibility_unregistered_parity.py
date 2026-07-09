"""ds21 (deep-scan #21 residual): unregistered-strategy paper/backtest parity in the eligibility gate.

The backtester (apply_eligibility_gate, backtester.py:303-322) BYPASSES the 7-layer eligibility
overlay when strategy_name is not in playbook_router.ALL_STRATS (passthrough_strategy_unregistered).
The live/paper path (evaluate_signal) previously lacked this bypass, so its check #2 SKIPped every
signal for the ~100 graduated strategies whose names aren't in the 174-entry ALL_STRATS list — while
backtest traded them. These tests lock in the mirrored bypass AND prove it does NOT over-broaden
(registered strategies still hit the per-playbook allow-list at check #2).
"""
from __future__ import annotations

from unittest.mock import MagicMock

from src.engine.context.structural_stops import StopPlan
from src.engine.context.eligibility_gate import evaluate_signal
from src.engine.context.playbook_router import ALL_STRATS


def _stop(skip: bool = False, stop_price: float = 4492.0) -> StopPlan:
    return StopPlan(
        stop_price=stop_price,
        stop_reason="exceeds_ceiling" if skip else "swing_point",
        buffer=0.75, risk_dollars=40.0, session_adjustment=1.0,
        buffer_ticks=3, sweep_aware_buffer=True, skip_trade=skip,
    )


def _bias():
    bs = MagicMock()
    bs.bias = "BULLISH"; bs.net_bias = 1; bs.playbook = "TREND_CONTINUATION"
    bs.confidence = 0.8; bs.bias_confidence = 0.8; bs.no_trade_reasons = []
    return bs


def _playbook(allowed):
    pd = MagicMock()
    pd.action = "TAKE"; pd.playbook = "TREND_CONTINUATION"
    pd.allowed_strategies = allowed; pd.confidence_modifier = 1.0
    return pd


def _loc():
    loc = MagicMock()
    loc.score = 85; loc.swept_liquidity = True; loc.sweep_present = True; loc.confluence_count = 5
    return loc


def _target():
    tp = MagicMock()
    tp.tp1 = 4515.0; tp.tp2 = 4525.0; tp.tp3 = 4535.0
    tp.r_multiple_tp2 = 3.5; tp.rr_achieved = 3.5; tp.min_rr_ratio = 2.0
    return tp


def _session():
    s = MagicMock()
    s.ny_killzone_active = True; s.london_killzone_active = False
    return s


def _eval(strategy_name: str, allowed, stop=None):
    return evaluate_signal(
        signal={"direction": "long", "strategy_name": strategy_name, "entry_price": 4500.0},
        bias_state=_bias(),
        playbook=_playbook(allowed),
        location=_loc(),
        stop_plan=stop or _stop(),
        target_plan=_target(),
        session=_session(),
    )


def test_unregistered_strategy_bypasses_overlay_not_skip():
    """A strategy name NOT in ALL_STRATS must bypass the overlay (action != SKIP), even when the
    playbook's allow-list would otherwise exclude it — mirrors backtester passthrough."""
    name = "zzz_totally_unregistered_xyz"
    assert name.lower().replace("_", "") not in [s.lower().replace("_", "") for s in ALL_STRATS]
    decision = _eval(name, allowed=["breaker"])  # allow-list would exclude it if it reached check #2
    assert decision.action == "TAKE", f"unregistered strategy must bypass to TAKE, got {decision.action}"
    assert any("unregistered" in r.lower() or "bypass" in r.lower() for r in decision.reasoning), (
        f"expected a bypass reasoning line, got {decision.reasoning}"
    )


def test_registered_strategy_not_in_playbook_still_skips():
    """A REGISTERED strategy (in ALL_STRATS) that is not in THIS playbook's allow-list must still
    SKIP at check #2 — the bypass must NOT over-broaden to registered names."""
    assert "silver_bullet".lower().replace("_", "") in [s.lower().replace("_", "") for s in ALL_STRATS]
    decision = _eval("silver_bullet", allowed=["breaker"])  # registered, but not allowed here
    assert decision.action == "SKIP", f"registered-not-in-playbook must SKIP, got {decision.action}"
    assert any("not in playbook" in r.lower() for r in decision.reasoning), (
        f"expected check #2 skip reasoning, got {decision.reasoning}"
    )


def test_registered_strategy_in_playbook_proceeds():
    """A registered strategy that IS in the playbook allow-list proceeds through the normal gate
    (not the unregistered bypass) — sanity that the happy path is unchanged."""
    decision = _eval("breaker", allowed=["breaker", "silver_bullet"])
    assert decision.action in ("TAKE", "REDUCE"), f"allowed registered strategy should proceed, got {decision.action}"
    # must NOT carry the unregistered-bypass reasoning
    assert not any("unregistered" in r.lower() for r in decision.reasoning)
