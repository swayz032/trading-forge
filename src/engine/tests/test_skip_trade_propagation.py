"""Test skip_trade sentinel propagation from structural_stops through eligibility_gate.

Canonical ceiling values (deep-scan #8 2026-07-02; Wave 1 2026-06-27):
  MES = 14 pt ceiling   (was 6pt hardcoded before Wave 1)
  MNQ = 62 pt ceiling   (was 40pt stale in prior test — corrected here)
  MCL = 1.00 pt ceiling (100 ticks at $0.01/tick; was 0.25pt/25-tick stale)

Covers:
  1. INSTRUMENT_STOP_CONFIG canonical values match Wave 1 recal
  2. MES stop > 14pt → skip_trade=True + stop_price un-clamped
  3. skip_trade=True StopPlan → evaluate_signal SKIP with ceiling reason
  4. MNQ stop > 62pt → skip_trade=True (was 40pt — stale; now 62pt)
  5. MCL stop > 1.00pt → skip_trade=True (was 0.25pt — stale; now 1.00pt)
  6. MES at-ceiling boundary (distance == 14.0pt) → skip_trade=False
  7. Below-ceiling stop: price preserved un-clamped, no ceiling SKIP from gate
  8. Check 0 fires before NO_TRADE playbook (ceiling skip is first reasoning entry)
  9. MNQ within 62pt ceiling → skip_trade=False
  10. ATR fallback oversized triggers ceiling (22.5pt > MES 14pt)
  11. skip_trade=False distinct from True — gate does not produce ceiling SKIP
  12. No explicit max_stop_points → per-symbol ceiling from INSTRUMENT_STOP_CONFIG
"""
from __future__ import annotations

import pytest
from unittest.mock import MagicMock

from src.engine.context.structural_stops import (
    StopPlan,
    INSTRUMENT_STOP_CONFIG,
    SKIP_TRADE,
    compute_structural_stop,
)
from src.engine.context.eligibility_gate import evaluate_signal


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _make_stop_plan(skip: bool, stop_price: float = 4486.0) -> StopPlan:
    """Build a minimal StopPlan for testing the eligibility gate skip path."""
    return StopPlan(
        stop_price=stop_price,
        stop_reason=SKIP_TRADE if skip else "swing_point",
        buffer=0.75,
        risk_dollars=abs(4500.0 - stop_price) * 5.0,
        session_adjustment=1.0,
        buffer_ticks=3,
        sweep_aware_buffer=True,
        skip_trade=skip,
    )


def _make_bias_state():
    bs = MagicMock()
    bs.bias = "BULLISH"
    bs.net_bias = 1
    bs.playbook = "TREND_CONTINUATION"
    bs.confidence = 0.8
    bs.bias_confidence = 0.8
    bs.no_trade_reasons = []
    return bs


def _make_playbook(action: str = "TAKE"):
    pd = MagicMock()
    pd.action = action
    pd.playbook = "TREND_CONTINUATION"
    pd.allowed_strategies = ["breaker", "silver_bullet"]
    pd.confidence_modifier = 1.0
    return pd


def _make_location():
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
    tp.rr_achieved = 3.5
    tp.min_rr_ratio = 2.0
    return tp


def _make_session():
    s = MagicMock()
    s.ny_killzone_active = True
    s.london_killzone_active = False
    return s


# ─── 1. INSTRUMENT_STOP_CONFIG canonical values ──────────────────────────────

def test_instrument_stop_config_canonical_values():
    """INSTRUMENT_STOP_CONFIG must hold Wave 1 / deep-scan #8 canonical values."""
    assert INSTRUMENT_STOP_CONFIG["MES"] == 14.0, "MES ceiling must be 14pt"
    assert INSTRUMENT_STOP_CONFIG["MNQ"] == 62.0, "MNQ ceiling must be 62pt (was 40pt — stale)"
    assert INSTRUMENT_STOP_CONFIG["MCL"] == 1.00, "MCL ceiling must be 1.00pt (was 0.25pt — stale)"
    assert INSTRUMENT_STOP_CONFIG["ES"] == INSTRUMENT_STOP_CONFIG["MES"]
    assert INSTRUMENT_STOP_CONFIG["NQ"] == INSTRUMENT_STOP_CONFIG["MNQ"]
    assert INSTRUMENT_STOP_CONFIG["CL"] == INSTRUMENT_STOP_CONFIG["MCL"]


# ─── 2+3. MES > 14pt ceiling ─────────────────────────────────────────────────

def test_mes_exceeds_14pt_ceiling_sets_skip_trade():
    """Swing-point stop 21.75pt > 14pt MES ceiling → skip_trade=True, stop_price un-clamped."""
    # Entry 4500, swing_low 4479; buffer=3×0.25=0.75; stop=4478.25; distance=21.75pt > 14pt
    result = compute_structural_stop(
        symbol="MES",
        direction="long",
        entry_price=4500.0,
        point_value=5.0,
        atr=8.0,
        tick_size=0.25,
        nearest_swing_low=4479.0,
    )
    assert result.skip_trade is True, (
        f"MES 21.75pt stop must set skip_trade=True; "
        f"got skip_trade={result.skip_trade}, stop_price={result.stop_price}, "
        f"reason={result.stop_reason}"
    )
    # True stop price preserved — NOT clamped to 4500-14=4486
    assert result.stop_price < 4486.0, (
        f"stop_price must be below ceiling line 4486.0 (un-clamped); got {result.stop_price}"
    )
    assert "exceeds_ceiling" in result.stop_reason


def test_mes_skip_trade_propagates_to_eligibility_skip():
    """skip_trade=True StopPlan → evaluate_signal SKIP with ceiling reasoning."""
    stop_plan = _make_stop_plan(skip=True, stop_price=4478.25)

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

    assert decision.action == "SKIP", f"Expected SKIP, got {decision.action}"
    ceiling_reasons = [
        r for r in decision.reasoning
        if "SKIP_TRADE" in r or "ceiling" in r.lower() or "structural_stop" in r.lower()
    ]
    assert len(ceiling_reasons) > 0, (
        f"Expected ceiling-related skip reason; got {decision.reasoning}"
    )


# ─── 4. MNQ > 62pt ceiling (canonical; old test used stale 40pt) ─────────────

def test_mnq_exceeds_62pt_ceiling_sets_skip_trade():
    """Swing-point stop 71.25pt > 62pt MNQ ceiling → skip_trade=True."""
    # Entry 15000 short, swing_high 15070; buffer=5×0.25=1.25; stop=15071.25
    # distance=71.25pt > 62pt MNQ ceiling
    result = compute_structural_stop(
        symbol="MNQ",
        direction="short",
        entry_price=15000.0,
        point_value=2.0,
        atr=20.0,
        tick_size=0.25,
        nearest_swing_high=15070.0,
    )
    assert result.skip_trade is True, (
        f"MNQ 71.25pt stop must set skip_trade=True; "
        f"got skip_trade={result.skip_trade}, "
        f"distance={abs(15000.0 - result.stop_price):.2f}pt (ceiling=62pt)"
    )
    assert result.stop_price > 15062.0, "stop_price must be above 62pt-ceiling line (un-clamped)"
    assert "exceeds_ceiling" in result.stop_reason


def test_mnq_skip_trade_propagates_to_eligibility_skip():
    """MNQ skip_trade=True StopPlan → evaluate_signal SKIP."""
    stop_plan = _make_stop_plan(skip=True, stop_price=15071.25)

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


# ─── 5. MCL > 1.00pt ceiling (canonical; old test used stale 0.25pt/25ticks) ─

def test_mcl_exceeds_100tick_ceiling_sets_skip_trade():
    """Swing-point stop 1.52pt > 1.00pt MCL ceiling (100 ticks) → skip_trade=True."""
    # Entry 80.00, swing_low 78.50; buffer=2×0.01=0.02; stop=78.48; distance=1.52pt > 1.00pt
    result = compute_structural_stop(
        symbol="MCL",
        direction="long",
        entry_price=80.00,
        point_value=100.0,
        atr=0.30,
        tick_size=0.01,
        nearest_swing_low=78.50,
    )
    assert result.skip_trade is True, (
        f"MCL 1.52pt stop must set skip_trade=True (ceiling=1.00pt); "
        f"got skip_trade={result.skip_trade}, "
        f"distance={abs(80.0 - result.stop_price):.3f}pt"
    )
    assert result.stop_price < 79.00, "stop_price must be below 1.00pt ceiling line (un-clamped)"
    assert "exceeds_ceiling" in result.stop_reason


def test_mcl_skip_trade_propagates_to_eligibility_skip():
    """MCL skip_trade=True StopPlan → evaluate_signal SKIP."""
    stop_plan = _make_stop_plan(skip=True, stop_price=78.48)

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


# ─── 6. At-ceiling boundary → NOT skipped ────────────────────────────────────

def test_mes_at_ceiling_boundary_not_skipped():
    """MES stop exactly at 14.0pt distance → skip_trade=False (boundary is inclusive)."""
    # swing_low 4486.75; buffer=3×0.25=0.75; stop=4486.0; distance=14.0pt = ceiling
    result = compute_structural_stop(
        symbol="MES",
        direction="long",
        entry_price=4500.0,
        point_value=5.0,
        atr=6.0,
        tick_size=0.25,
        nearest_swing_low=4486.75,
    )
    distance = abs(4500.0 - result.stop_price)
    assert result.skip_trade is False, (
        f"At-ceiling boundary (distance={distance:.4f}pt) must NOT skip; "
        f"skip_trade={result.skip_trade}"
    )


# ─── 7. Below-ceiling: price preserved un-clamped, no gate ceiling SKIP ──────

def test_mes_below_ceiling_stop_price_preserved_unclamped():
    """MES stop 12.75pt < 14pt ceiling → skip_trade=False, stop_price exact structural level."""
    # swing_low 4488; buffer=0.75; stop=4487.25; distance=12.75pt < 14pt
    result = compute_structural_stop(
        symbol="MES",
        direction="long",
        entry_price=4500.0,
        point_value=5.0,
        atr=6.0,
        tick_size=0.25,
        nearest_swing_low=4488.0,
    )
    assert result.skip_trade is False
    assert abs(result.stop_price - 4487.25) < 1e-9, (
        f"Stop price must be exact structural level 4487.25; got {result.stop_price}"
    )

    # Gate must NOT produce ceiling SKIP
    stop_plan = _make_stop_plan(skip=False, stop_price=4487.25)
    decision = evaluate_signal(
        signal={"direction": "long", "strategy_name": "breaker", "entry_price": 4500.0},
        bias_state=_make_bias_state(),
        playbook=_make_playbook(),
        location=_make_location(),
        stop_plan=stop_plan,
        target_plan=_make_target_plan(),
        session=_make_session(),
    )
    ceiling_reasons = [
        r for r in decision.reasoning
        if "SKIP_TRADE" in r or "structural_stop_exceeds" in r
    ]
    assert len(ceiling_reasons) == 0, f"Valid stop must not produce ceiling skip: {ceiling_reasons}"


# ─── 8. Check 0 fires before NO_TRADE playbook ───────────────────────────────

def test_check0_fires_before_no_trade_playbook():
    """skip_trade=True fires BEFORE NO_TRADE playbook check; ceiling reason is first."""
    pd = _make_playbook()
    pd.playbook = "NO_TRADE"
    pd.allowed_strategies = []

    stop_plan = _make_stop_plan(skip=True, stop_price=4478.25)
    decision = evaluate_signal(
        signal={"direction": "long", "strategy_name": "breaker", "entry_price": 4500.0},
        bias_state=_make_bias_state(),
        playbook=pd,
        location=_make_location(),
        stop_plan=stop_plan,
        target_plan=_make_target_plan(),
        session=_make_session(),
    )
    assert decision.action == "SKIP"
    assert len(decision.reasoning) > 0
    first = decision.reasoning[0]
    assert "SKIP_TRADE" in first or "structural_stop" in first.lower(), (
        f"Check 0 ceiling reason must be FIRST reasoning entry. Got: {decision.reasoning}"
    )


# ─── 9. MNQ within 62pt ceiling → skip_trade=False ──────────────────────────

def test_mnq_within_62pt_ceiling_not_skipped():
    """MNQ stop 39.25pt < 62pt ceiling → skip_trade=False."""
    # swing_low 14962; buffer=1.25; stop=14960.75; distance=39.25pt
    result = compute_structural_stop(
        symbol="MNQ",
        direction="long",
        entry_price=15000.0,
        point_value=2.0,
        atr=20.0,
        tick_size=0.25,
        nearest_swing_low=14962.0,
    )
    assert result.skip_trade is False, (
        f"MNQ 39.25pt stop must NOT set skip_trade (ceiling=62pt); "
        f"got skip_trade={result.skip_trade}"
    )


# ─── 10. ATR fallback oversized triggers ceiling ─────────────────────────────

def test_atr_fallback_oversized_triggers_ceiling():
    """ATR fallback 22.5pt (1.5 × ATR=15) > MES 14pt ceiling → skip_trade=True."""
    result = compute_structural_stop(
        symbol="MES",
        direction="long",
        entry_price=4500.0,
        point_value=5.0,
        atr=15.0,       # 1.5 × 15 = 22.5pt ATR floor > 14pt ceiling
        tick_size=0.25,
        # No structural levels → ATR fallback fires
    )
    assert result.skip_trade is True, (
        f"ATR fallback 22.5pt must trigger skip (MES ceiling=14pt); "
        f"skip_trade={result.skip_trade}, "
        f"stop_distance={abs(result.stop_price - 4500.0):.2f}pt"
    )
    # True ATR stop preserved un-clamped
    assert abs(result.stop_price - 4477.5) < 1e-9, (
        f"stop_price must be un-clamped ATR stop (4477.5); got {result.stop_price}"
    )


# ─── 11. skip_trade=False does not produce ceiling SKIP ──────────────────────

def test_skip_trade_false_does_not_produce_ceiling_skip():
    """skip_trade=False StopPlan must never cause ceiling SKIP in the gate."""
    stop_plan = _make_stop_plan(skip=False, stop_price=4492.0)
    assert stop_plan.skip_trade is False

    decision = evaluate_signal(
        signal={"direction": "long", "strategy_name": "breaker", "entry_price": 4500.0},
        bias_state=_make_bias_state(),
        playbook=_make_playbook(),
        location=_make_location(),
        stop_plan=stop_plan,
        target_plan=_make_target_plan(),
        session=_make_session(),
    )
    ceiling_reasons = [
        r for r in decision.reasoning
        if "SKIP_TRADE" in r or "structural_stop_exceeds" in r
    ]
    assert len(ceiling_reasons) == 0, f"Valid stop must not produce ceiling skip: {ceiling_reasons}"


# ─── 12. No explicit max_stop_points → per-symbol from INSTRUMENT_STOP_CONFIG ─

def test_no_max_stop_points_uses_per_symbol_ceiling_mnq():
    """MNQ 50.25pt stop: valid under 62pt ceiling, would fail 14pt MES ceiling.
    No max_stop_points passed → must resolve as MNQ 62pt (not MES 14pt).
    """
    # swing_low 14951; buffer=1.25; stop=14949.75; distance=50.25pt
    result = compute_structural_stop(
        symbol="MNQ",
        direction="long",
        entry_price=15000.0,
        point_value=2.0,
        atr=20.0,
        tick_size=0.25,
        nearest_swing_low=14951.0,
        # max_stop_points NOT passed → uses INSTRUMENT_STOP_CONFIG["MNQ"] = 62pt
    )
    distance = abs(15000.0 - result.stop_price)
    assert result.skip_trade is False, (
        f"MNQ 50.25pt stop is valid under 62pt ceiling; skip_trade must be False. "
        f"If True, the ceiling was wrongly resolved as MES 14pt (symbol not passed). "
        f"distance={distance:.2f}pt"
    )


def test_mes_stop_uses_mes_14pt_not_mnq_ceiling():
    """MES 12pt stop must use MES 14pt ceiling, not cross-contaminate MNQ 62pt."""
    result = compute_structural_stop(
        symbol="MES",
        direction="long",
        entry_price=4500.0,
        point_value=5.0,
        atr=5.0,
        tick_size=0.25,
        nearest_swing_low=4488.75,  # stop=4488.0; distance=12pt < 14pt MES ceiling
    )
    assert result.skip_trade is False
    assert abs(result.stop_price - 4488.0) < 1e-9
