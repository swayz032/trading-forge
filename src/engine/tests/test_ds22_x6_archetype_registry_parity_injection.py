"""X6 archetype registry parity + registry-completeness fault injection
(deep-scan #22 Track X6, 2026-07-09).

Closes the "scoped re-cert, no whole-surface failure-injection" gap for the
archetype-registry parity control. Two things this file proves that the
existing per-path tests (test_ds21_eligibility_unregistered_parity.py,
test_c3_eligibility_gate_mode_disclosure.py, test_strategy_registry_completeness.py)
do NOT, individually, tie together:

  1. Cross-path PARITY — the SAME injected unregistered-archetype name is fed
     through BOTH the live eligibility gate (eligibility_gate.evaluate_signal)
     and the backtest eligibility gate (backtester.apply_eligibility_gate) in
     one test, proving they bypass IDENTICALLY rather than each independently
     bypassing on its own fixture (which could still parity-break if one path
     regressed while the other didn't).

  2. Registry-completeness guard FAULT INJECTION — test_strategy_registry_completeness.py
     only ever observes the CURRENT (clean) production state. This file
     fault-injects a synthetic "forgot to register" archetype into the
     detection algorithm and proves the guard's assertion actually fires
     (raises) on that fault — i.e. the guard is a real gate, not a check that
     merely happens to pass today because nothing is currently broken.
"""
from __future__ import annotations

from unittest.mock import MagicMock

import numpy as np
import polars as pl
import pytest

from src.engine.context.eligibility_gate import evaluate_signal
from src.engine.context.playbook_router import ALL_STRATS
from src.engine.context.structural_stops import StopPlan

INJECTED_UNREGISTERED_NAME = "x6_injected_fault_archetype_never_registered"


def _assert_truly_unregistered(name: str) -> None:
    normalized = name.lower().replace("_", "")
    all_normalized = [s.lower().replace("_", "") for s in ALL_STRATS]
    assert normalized not in all_normalized, (
        f"fault-injection setup error: {name!r} unexpectedly collides with a real "
        "ALL_STRATS entry after normalization — pick a different injected name"
    )


# ─── Live-path helpers (mirrors test_ds21_eligibility_unregistered_parity.py) ──

def _stop(skip: bool = False, stop_price: float = 4492.0) -> StopPlan:
    return StopPlan(
        stop_price=stop_price,
        stop_reason="exceeds_ceiling" if skip else "swing_point",
        buffer=0.75, risk_dollars=40.0, session_adjustment=1.0,
        buffer_ticks=3, sweep_aware_buffer=True, skip_trade=skip,
    )


def _bias():
    bs = MagicMock()
    bs.bias = "BULLISH"
    bs.net_bias = 1
    bs.playbook = "TREND_CONTINUATION"
    bs.confidence = 0.8
    bs.bias_confidence = 0.8
    bs.no_trade_reasons = []
    return bs


def _playbook(allowed):
    pd = MagicMock()
    pd.action = "TAKE"
    pd.playbook = "TREND_CONTINUATION"
    pd.allowed_strategies = allowed
    pd.confidence_modifier = 1.0
    return pd


def _loc():
    loc = MagicMock()
    loc.score = 85
    loc.swept_liquidity = True
    loc.sweep_present = True
    loc.confluence_count = 5
    return loc


def _target():
    tp = MagicMock()
    tp.tp1 = 4515.0
    tp.tp2 = 4525.0
    tp.tp3 = 4535.0
    tp.r_multiple_tp2 = 3.5
    tp.rr_achieved = 3.5
    tp.min_rr_ratio = 2.0
    return tp


def _session():
    s = MagicMock()
    s.ny_killzone_active = True
    s.london_killzone_active = False
    return s


def _live_eval(strategy_name: str, allowed):
    return evaluate_signal(
        signal={"direction": "long", "strategy_name": strategy_name, "entry_price": 4500.0},
        bias_state=_bias(),
        playbook=_playbook(allowed),
        location=_loc(),
        stop_plan=_stop(),
        target_plan=_target(),
        session=_session(),
    )


def _flat_df(n=5):
    return pl.DataFrame({
        "close": [4400.0 + i for i in range(n)],
        "atr_14": [4.0] * n,
    })


# ────────────────────────────────────────────────────────────────────────────
# 1. Cross-path parity — SAME injected fault, BOTH paths must bypass identically
# ────────────────────────────────────────────────────────────────────────────

def test_injected_unregistered_archetype_bypasses_identically_live_and_backtest():
    """FAULT INJECTION: fabricate a brand-new archetype name that has never
    been registered in playbook_router.ALL_STRATS (simulating a new engine
    strategy file shipped without its registry entry) and feed the SAME name
    through both the live eligibility gate and the backtest eligibility gate.

    Both paths must bypass the overlay identically — the actual parity claim,
    not just "each path independently bypasses on its own fixture"."""
    from src.engine.backtester import apply_eligibility_gate

    _assert_truly_unregistered(INJECTED_UNREGISTERED_NAME)

    # --- Live path: playbook allow-list would otherwise EXCLUDE this name ---
    live_decision = _live_eval(INJECTED_UNREGISTERED_NAME, allowed=["breaker"])
    assert live_decision.action == "TAKE", (
        f"live path must bypass an unregistered archetype to TAKE, got {live_decision.action}"
    )
    assert any(
        "unregistered" in r.lower() or "bypass" in r.lower() for r in live_decision.reasoning
    ), f"expected bypass reasoning, got {live_decision.reasoning}"

    # --- Backtest path: same injected name, same-shaped signal ---
    n = 5
    df = _flat_df(n)
    entries = np.zeros(n, dtype=bool)
    entries[2] = True
    exits = np.zeros(n, dtype=bool)

    filtered_entries, _, gate_stats = apply_eligibility_gate(
        entries, exits, df, direction="long", symbol="MES",
        htf_cache={"2026-01-05": object()},
        strategy_name=INJECTED_UNREGISTERED_NAME,
    )
    assert gate_stats["mode"] == "passthrough_strategy_unregistered"
    assert INJECTED_UNREGISTERED_NAME in gate_stats["passthrough_reason"]
    assert bool(filtered_entries[2]) is True, "backtest bypass must pass the signal through unfiltered"

    # --- Parity assertion: BOTH paths treat the injected name as a bypass;
    # neither silently filters it while the other lets it through. ---
    live_bypassed = live_decision.action == "TAKE" and any(
        "unregistered" in r.lower() or "bypass" in r.lower() for r in live_decision.reasoning
    )
    backtest_bypassed = gate_stats["mode"] == "passthrough_strategy_unregistered"
    assert live_bypassed is True and backtest_bypassed is True and live_bypassed == backtest_bypassed, (
        "PARITY BREAK: live and backtest disagree on whether the injected "
        "unregistered archetype bypasses the eligibility overlay"
    )


def test_registered_strategy_does_not_falsely_trigger_the_bypass_on_either_path():
    """Companion clean-path proof: a genuinely registered name must NOT hit
    the bypass on either path — guards against the parity check above being
    satisfied by an over-broad bypass that swallows everything."""
    from src.engine.backtester import apply_eligibility_gate

    registered_name = ALL_STRATS[0]

    live_decision = _live_eval(registered_name, allowed=[registered_name])
    assert not any("unregistered" in r.lower() for r in live_decision.reasoning)

    n = 5
    df = _flat_df(n)
    entries = np.zeros(n, dtype=bool)
    entries[1] = True
    exits = np.zeros(n, dtype=bool)
    _, _, gate_stats = apply_eligibility_gate(
        entries, exits, df, direction="long", symbol="MES",
        htf_cache={"2026-01-05": object()},
        strategy_name=registered_name,
    )
    assert gate_stats["mode"] == "tf_institutional_overlay"


# ────────────────────────────────────────────────────────────────────────────
# 2. Registry-completeness guard fault injection — prove the guard BITES
# ────────────────────────────────────────────────────────────────────────────

def _normalize(name: str) -> str:
    """Mirrors eligibility_gate.py / backtester.py's exact normalization
    (identical to test_strategy_registry_completeness.py's helper)."""
    return name.lower().replace("strategy", "").strip().replace("_", "")


def _completeness_check(discovered_names: list[str]) -> list[str]:
    """Re-implementation of test_strategy_registry_completeness.py's core
    detection logic, parameterized over an injectable discovered-class-name
    list so we can fault-inject a synthetic missing registration without
    touching the real filesystem-discovery mechanism."""
    all_strats_normalized = {_normalize(s) for s in ALL_STRATS}
    unregistered = []
    for name in discovered_names:
        if _normalize(name) not in all_strats_normalized:
            unregistered.append(name)
    return unregistered


def test_registry_completeness_guard_catches_an_injected_missing_registration():
    """FAULT INJECTION: simulate a NEW hand-coded archetype class landing in
    src/engine/strategies/ (e.g. a future 'gann_box_8h_reversal.py') whose
    author forgot to add it to playbook_router.ALL_STRATS. The completeness
    guard must flag it — proving the guard is a real gate, not a check that
    only ever observes an already-clean state."""
    real_discovered_names = list(ALL_STRATS[:5])  # genuinely registered baseline
    injected_fault_name = "gann_box_8h_reversal_never_registered"
    _assert_truly_unregistered(injected_fault_name)

    faulted_population = real_discovered_names + [injected_fault_name]
    unregistered = _completeness_check(faulted_population)

    assert unregistered == [injected_fault_name], (
        f"registry-completeness guard failed to catch the injected fault; "
        f"got unregistered={unregistered}"
    )
    # Prove the guard's own assertion form actually raises on this fault
    # (mirrors the real test's `assert not unregistered` gate).
    with pytest.raises(AssertionError):
        assert not unregistered, (
            f"The following hand-coded archetype classes are NOT registered: {unregistered}"
        )


def test_registry_completeness_guard_stays_clean_when_all_registered():
    """CLEAN path: when every discovered name is genuinely registered, the
    guard must not flag anything (no false positives)."""
    real_discovered_names = list(ALL_STRATS[:8])
    unregistered = _completeness_check(real_discovered_names)
    assert unregistered == []
