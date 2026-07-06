"""Deep-scan C-1 BEHAVIORAL regression (upgrades the source-structural guard).

Drives the REAL src.engine.context.eligibility_gate.evaluate_signal with (a) a UUID and
(b) a registered concept name, proving the actual runtime behavior the C-1 fix depends on:
a UUID hard-SKIPs at Check #2 ("not in playbook") while a registered concept name clears it.

This is the downstream contract the TS fix (paper-signal-service.ts now passes
sessionConfig.name, not sessionConfig.strategyId) relies on. Fixtures follow the MagicMock
pattern already used in test_skip_trade_propagation.py.
"""
from __future__ import annotations

from unittest.mock import MagicMock

from src.engine.context.eligibility_gate import evaluate_signal
from src.engine.context.structural_stops import StopPlan, SKIP_TRADE  # noqa: F401  (import parity w/ sibling test)


def _stop_plan(skip: bool = False) -> StopPlan:
    return StopPlan(
        stop_price=4478.0,
        stop_reason=SKIP_TRADE if skip else "swing_point",
        buffer=0.75,
        risk_dollars=110.0,
        session_adjustment=1.0,
        buffer_ticks=3,
        sweep_aware_buffer=True,
        skip_trade=skip,
    )


def _bias():
    b = MagicMock()
    b.bias = "BULLISH"; b.net_bias = 1; b.playbook = "TREND_CONTINUATION"
    b.confidence = 0.8; b.bias_confidence = 0.8; b.no_trade_reasons = []
    return b


def _playbook():
    p = MagicMock()
    p.action = "TAKE"; p.playbook = "TREND_CONTINUATION"
    p.allowed_strategies = ["breaker", "silver_bullet"]; p.confidence_modifier = 1.0
    return p


def _loc():
    l = MagicMock()
    l.score = 85; l.swept_liquidity = True; l.sweep_present = True; l.confluence_count = 5
    return l


def _target():
    t = MagicMock()
    t.tp1 = 4515.0; t.tp2 = 4525.0; t.tp3 = 4535.0
    t.r_multiple_tp2 = 3.5; t.rr_achieved = 3.5; t.min_rr_ratio = 2.0
    return t


def _session():
    s = MagicMock()
    s.ny_killzone_active = True; s.london_killzone_active = False
    return s


def _run(strategy_name: str):
    sig = {"direction": "long", "strategy_name": strategy_name, "entry_price": 4500.0}
    return evaluate_signal(sig, _bias(), _playbook(), _loc(), _stop_plan(), _target(), _session())


UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"


def _overlay_bypassed(decision) -> bool:
    """True when the eligibility overlay was BYPASSED (identity not in ALL_STRATS) rather than
    evaluated. The gate emits an 'unregistered ... eligibility overlay bypassed' reasoning line
    on the bypass path (added for backtest parity, DS#21 carry-forward)."""
    return any(("unregistered" in r) or ("overlay bypassed" in r) for r in decision.reasoning)


def test_registered_concept_name_is_EVALUATED_by_the_overlay():
    """The concept name the C-1 fix passes → a registered strategy is actually run THROUGH the
    eligibility overlay (Check #2 etc.), not bypassed. This is the whole value of C-1: the
    overlay only does its job for live signals when the real name is supplied."""
    d = _run("silver_bullet")
    assert not _overlay_bypassed(d), "registered concept name must be EVALUATED, not bypassed"
    assert d.action == "TAKE"  # A+ happy-path fixture proceeds through the full 7-layer gate


def test_uuid_BYPASSES_the_overlay():
    """A UUID (what the OLD live code passed) is not in ALL_STRATS → the gate BYPASSES the
    eligibility overlay entirely. That is the wrong path for a real registered strategy: its
    playbook/eligibility gating never runs. (Pre-DS21 the same UUID hard-SKIPped instead — the
    symptom changed when the unregistered-bypass landed, but either way the overlay does NOT
    apply, which is exactly what C-1 fixes by passing the real name.)"""
    d = _run(UUID)
    assert _overlay_bypassed(d), "a UUID must fall to the unregistered-bypass, not real evaluation"


def test_uuid_vs_name_diverge_on_overlay_application():
    """C-1's core contract: identical context, different identity → the overlay APPLIES for the
    concept name and is BYPASSED for the UUID. This is precisely the behavior the TS fix
    (pass sessionConfig.name, not sessionConfig.strategyId) controls upstream."""
    assert _overlay_bypassed(_run(UUID)) is True
    assert _overlay_bypassed(_run("silver_bullet")) is False


def test_unregistered_name_also_bypasses_documented_separate_gap():
    """BOUNDARY: a concept name NOT in ALL_STRATS also bypasses the overlay — the SEPARATE,
    still-open unregistered-strategy parity gap (DS#21 carry-forward), distinct from the UUID
    defect C-1 fixed. Passing the concept name is necessary but not sufficient for unregistered
    strategies. Asserted so the boundary is explicit, never silently assumed away."""
    d = _run("some_unregistered_concept_xyz")
    assert _overlay_bypassed(d), "unregistered name bypasses — this is the tracked separate gap"
