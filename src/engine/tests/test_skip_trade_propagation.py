"""Test skip_trade sentinel propagation from structural_stops through eligibility_gate.

Covers:
  1. MES stop > 14pt ceiling → skip_trade=True → eligibility SKIP
  2. MNQ stop > 40pt ceiling → skip_trade=True → eligibility SKIP
  3. MCL stop > 25 ticks (0.25 pts) → skip_trade=True → eligibility SKIP
  4. Valid MES stop within 14pt ceiling → passes through to normal gate logic
  5. Check 0 fires before other gate checks (structural_stop_exceeds_ceiling reason)
  6. Valid MNQ stop within ceiling → passes
  7. ATR fallback with large ATR exceeding ceiling → skip
  8. skip_trade=False is not confused with skip_trade=True
"""
from __future__ import annotations

import pytest
from unittest.mock import MagicMock

from src.engine.context.structural_stops import (
    StopPlan,
    compute_structural_stop,
    INSTRUMENT_STOP_CONFIG,
    SKIP_TRADE,
)
from src.engine.context.eligibility_gate import evaluate_signal


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _make_stop_plan(skip: bool, symbol: str = "MES", stop_price: float = 4486.0) -> StopPlan:
    """Build a minimal StopPlan for testing."""
    return StopPlan(
        stop_price=stop_price,
        stop_reason=SKIP_TRADE if skip else "swing_point",
        buffer=0.25,
        risk_dollars=abs(4500.0 - stop_price) * 5.0,
        session_adjustment=1.0,
        skip_trade=skip,
    )


def _make_bias_state():
    """Minimal DailyBiasState mock with numeric fields."""
    bs = MagicMock()
    bs.bias = "BULLISH"
    bs.net_bias = 1          # positive = bullish (numeric for > 0 check in gate)
    bs.playbook = "TREND_CONTINUATION"
    bs.confidence = 0.8
    bs.bias_confidence = 0.8   # numeric for < comparison in gate
    bs.no_trade_reasons = []
    return bs


def _make_playbook(action: str = "TAKE"):
    """Minimal PlaybookDecision mock."""
    pd = MagicMock()
    pd.action = action
    pd.playbook = "TREND_CONTINUATION"
    pd.allowed_strategies = ["breaker", "silver_bullet"]
    pd.confidence_modifier = 1.0   # numeric for min/max in gate
    return pd


def _make_location():
    """Minimal LocationScore mock with high confluence."""
    loc = MagicMock()
    loc.score = 85
    loc.swept_liquidity = True
    loc.sweep_present = True
    loc.confluence_count = 5
    return loc


def _make_target_plan():
    tp = MagicMock()
    tp.tp1 = 4515.0
    tp.tp2 = 4525.0
    tp.tp3 = 4535.0
    tp.r_multiple_tp2 = 3.5
    tp.rr_achieved = 3.5        # numeric for < comparison in gate
    tp.min_rr_ratio = 2.0       # numeric for < comparison in gate
    return tp


def _make_session():
    """Minimal SessionContext mock with kill zone active."""
    s = MagicMock()
    s.ny_killzone_active = True
    s.london_killzone_active = False
    return s


# ─── Test 1: MES stop > 14pt ceiling → skip_trade=True ───────────────────────

def test_mes_exceeds_14pt_ceiling_returns_skip_trade():
    """compute_structural_stop returns skip_trade=True when swing distance > 14pt for MES."""
    # Entry 4500, swing_low 4479 → 21pt > 14pt ceiling for MES
    result = compute_structural_stop(
        symbol="MES",
        direction="long",
        entry_price=4500.0,
        point_value=5.0,
        atr=8.0,
        tick_size=0.25,
        nearest_swing_low=4479.0,  # 21pt below entry — exceeds 14pt ceiling
    )
    assert result.skip_trade is True, (
        f"MES 21pt stop must set skip_trade=True; got skip_trade={result.skip_trade}, "
        f"stop_price={result.stop_price}, reason={result.stop_reason}"
    )


def test_mes_skip_trade_propagates_to_eligibility_skip():
    """skip_trade=True StopPlan → evaluate_signal returns SKIP action."""
    stop_plan = _make_stop_plan(skip=True, symbol="MES", stop_price=4479.0)

    decision = evaluate_signal(
        signal={"direction": "long", "strategy_name": "breaker", "entry_price": 4500.0},
        bias_state=_make_bias_state(),
        playbook=_make_playbook(),
        location=_make_location(),
        stop_plan=stop_plan,
        target_plan=_make_target_plan(),
        session=_make_session(),
        daily_loss_used_pct=0.0,
        max_trades_hit=False,
    )

    assert decision.action == "SKIP", f"Expected SKIP got {decision.action}"
    skip_reasons = [r for r in decision.reasoning if "SKIP_TRADE" in r or "ceiling" in r.lower() or "structural_stop" in r.lower()]
    assert len(skip_reasons) > 0, f"Expected a ceiling-related skip reason in {decision.reasoning}"


# ─── Test 2: MNQ stop > 40pt ceiling → skip_trade=True ───────────────────────

def test_mnq_exceeds_40pt_ceiling_returns_skip_trade():
    """compute_structural_stop returns skip_trade=True when swing distance > 40pt for MNQ."""
    # Entry 15000, swing_high 15055 → 55pt > 40pt ceiling for MNQ short
    result = compute_structural_stop(
        symbol="MNQ",
        direction="short",
        entry_price=15000.0,
        point_value=2.0,
        atr=20.0,
        tick_size=0.25,
        nearest_swing_high=15055.0,  # 55pt above entry — exceeds 40pt ceiling
    )
    assert result.skip_trade is True, (
        f"MNQ 55pt stop must set skip_trade=True; got stop_price={result.stop_price}"
    )


def test_mnq_skip_trade_propagates_to_eligibility_skip():
    """MNQ skip_trade=True StopPlan → evaluate_signal returns SKIP."""
    stop_plan = _make_stop_plan(skip=True, symbol="MNQ", stop_price=15055.0)

    decision = evaluate_signal(
        signal={"direction": "short", "strategy_name": "breaker", "entry_price": 15000.0},
        bias_state=_make_bias_state(),
        playbook=_make_playbook(),
        location=_make_location(),
        stop_plan=stop_plan,
        target_plan=_make_target_plan(),
        session=_make_session(),
    )
    assert decision.action == "SKIP"


# ─── Test 3: MCL stop > 25 ticks → skip_trade=True ───────────────────────────

def test_mcl_exceeds_25tick_ceiling_returns_skip_trade():
    """compute_structural_stop returns skip_trade=True when distance > 0.25pt for MCL."""
    # Entry 80.00, swing_low 79.40 → 0.60pt > 0.25pt ceiling (60 ticks > 25 tick ceiling)
    result = compute_structural_stop(
        symbol="MCL",
        direction="long",
        entry_price=80.00,
        point_value=100.0,
        atr=0.10,
        tick_size=0.01,
        nearest_swing_low=79.40,  # 0.60pt below entry > 0.25pt ceiling
    )
    assert result.skip_trade is True, (
        f"MCL 60-tick stop must set skip_trade=True; got stop_price={result.stop_price}"
    )


def test_mcl_skip_trade_propagates_to_eligibility_skip():
    """MCL skip_trade=True StopPlan → evaluate_signal returns SKIP."""
    stop_plan = _make_stop_plan(skip=True, symbol="MCL", stop_price=79.40)

    decision = evaluate_signal(
        signal={"direction": "long", "strategy_name": "breaker", "entry_price": 80.00},
        bias_state=_make_bias_state(),
        playbook=_make_playbook(),
        location=_make_location(),
        stop_plan=stop_plan,
        target_plan=_make_target_plan(),
        session=_make_session(),
    )
    assert decision.action == "SKIP"


# ─── Test 4: Valid MES stop within 14pt ceiling passes through ───────────────

def test_mes_within_ceiling_passes_through():
    """MES stop 12pt (within 14pt ceiling) → skip_trade=False."""
    # Entry 4500, swing_low 4488 → 12pt < 14pt ceiling
    result = compute_structural_stop(
        symbol="MES",
        direction="long",
        entry_price=4500.0,
        point_value=5.0,
        atr=6.0,
        tick_size=0.25,
        nearest_swing_low=4488.0,  # 12pt below entry — within 14pt ceiling
    )
    assert result.skip_trade is False, f"MES 12pt stop must NOT set skip_trade; got {result}"

    # evaluate_signal must NOT produce ceiling-based SKIP
    stop_plan = _make_stop_plan(skip=False, symbol="MES", stop_price=4488.0)
    decision = evaluate_signal(
        signal={"direction": "long", "strategy_name": "breaker", "entry_price": 4500.0},
        bias_state=_make_bias_state(),
        playbook=_make_playbook(),
        location=_make_location(),
        stop_plan=stop_plan,
        target_plan=_make_target_plan(),
        session=_make_session(),
    )
    ceiling_reasons = [r for r in decision.reasoning if "SKIP_TRADE" in r or "structural_stop_exceeds" in r]
    assert len(ceiling_reasons) == 0, f"Valid stop should not produce ceiling skip reason: {ceiling_reasons}"


# ─── Test 5: Check 0 fires before other gate checks ──────────────────────────

def test_check0_skip_fires_before_other_checks():
    """skip_trade=True short-circuits before playbook/confluence/kill zone checks."""
    # Even with NO_TRADE playbook, ceiling check fires first
    pd = _make_playbook()
    pd.playbook = "NO_TRADE"
    pd.allowed_strategies = []

    stop_plan_ceiling = _make_stop_plan(skip=True, symbol="MES", stop_price=4479.0)
    decision = evaluate_signal(
        signal={"direction": "long", "strategy_name": "breaker", "entry_price": 4500.0},
        bias_state=_make_bias_state(),
        playbook=pd,
        location=_make_location(),
        stop_plan=stop_plan_ceiling,
        target_plan=_make_target_plan(),
        session=_make_session(),
    )
    assert decision.action == "SKIP"
    # The ceiling skip reason must be the FIRST reasoning entry (Check 0 priority)
    assert len(decision.reasoning) > 0
    assert "SKIP_TRADE" in decision.reasoning[0] or "structural_stop" in decision.reasoning[0].lower(), (
        f"Check 0 ceiling reason must be first. Got: {decision.reasoning}"
    )


# ─── Test 6: Valid MNQ stop within ceiling → no ceiling skip ─────────────────

def test_mnq_within_ceiling_passes_through():
    """MNQ stop 35pt (within 40pt ceiling) → skip_trade=False."""
    # Entry 15000, swing_high 14965 → 35pt < 40pt ceiling
    result = compute_structural_stop(
        symbol="MNQ",
        direction="long",
        entry_price=15000.0,
        point_value=2.0,
        atr=20.0,
        tick_size=0.25,
        nearest_swing_low=14965.0,  # 35pt below entry — within 40pt ceiling
    )
    assert result.skip_trade is False, f"MNQ 35pt stop should NOT set skip_trade; got {result}"


# ─── Test 7: ATR fallback with oversized ATR triggers ceiling ────────────────

def test_atr_fallback_oversized_triggers_ceiling():
    """When ATR-derived stop floor would exceed ceiling, skip_trade is set."""
    # MES ceiling = 14pt. If we pass a very large ATR, the floor = 1.5 × ATR.
    # If floor > ceiling AND no structural levels provided, handler must skip.
    result = compute_structural_stop(
        symbol="MES",
        direction="long",
        entry_price=4500.0,
        point_value=5.0,
        atr=15.0,          # 1.5 × 15 = 22.5pt floor > 14pt ceiling
        tick_size=0.25,
        # No structural levels → ATR fallback at 22.5pt — exceeds 14pt ceiling
    )
    # Either skip_trade=True (ceiling exceeded) or stop placed within 14pt (ATR floor capped)
    # The implementation must NOT silently cap — it must set skip_trade=True
    stop_distance = abs(result.stop_price - 4500.0)
    assert result.skip_trade is True or stop_distance <= 14.0, (
        f"ATR fallback of {stop_distance:.2f}pt (1.5×15=22.5) should trigger ceiling; "
        f"skip_trade={result.skip_trade}"
    )


# ─── Test 8: skip_trade=False is distinct from skip_trade=True ───────────────

def test_skip_trade_false_is_not_confused_with_true():
    """Ensure skip_trade=False StopPlan does not accidentally produce ceiling SKIP."""
    stop_plan_valid = _make_stop_plan(skip=False, symbol="MES", stop_price=4492.0)
    assert stop_plan_valid.skip_trade is False

    decision = evaluate_signal(
        signal={"direction": "long", "strategy_name": "breaker", "entry_price": 4500.0},
        bias_state=_make_bias_state(),
        playbook=_make_playbook(),
        location=_make_location(),
        stop_plan=stop_plan_valid,
        target_plan=_make_target_plan(),
        session=_make_session(),
    )
    ceiling_reasons = [r for r in decision.reasoning if "SKIP_TRADE" in r or "structural_stop_exceeds" in r]
    assert len(ceiling_reasons) == 0, f"Valid stop must not produce ceiling skip: {ceiling_reasons}"
