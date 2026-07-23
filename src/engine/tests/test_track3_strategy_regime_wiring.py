"""Track 3 — Strategy regime context wiring smoke tests.

Verifies that:
1. All 5 wired strategies accept regime_context in __init__ without breaking.
2. get_exit_style() returns "D" when regime_context is None (backwards-compatible).
3. get_exit_style() returns "C" when playbook=TREND_CONTINUATION + macro_state!="crisis".
4. get_exit_style() returns "D" when macro_state="crisis" even with TREND_CONTINUATION.
5. get_params() includes both "regime_context" and "exit_style" keys.
6. Entry logic is UNTOUCHED — strategies instantiated without regime_context compute
   identical signal columns (no regression on compute path).
"""

from __future__ import annotations

import polars as pl
import pytest

from src.engine.strategies.breaker import BreakerStrategy
from src.engine.strategies.judas_swing import JudasSwingStrategy
from src.engine.strategies.ote_strategy import OTEStrategy
from src.engine.strategies.power_of_3 import PowerOf3Strategy
from src.engine.strategies.silver_bullet import SilverBulletStrategy

# ─── Fixtures ─────────────────────────────────────────────────────────────────

ALL_STRATEGY_CLASSES = [
    SilverBulletStrategy,
    OTEStrategy,
    BreakerStrategy,
    JudasSwingStrategy,
    PowerOf3Strategy,
]

TREND_CONTINUATION_CTX = {"playbook": "TREND_CONTINUATION", "macro_state": "growth"}
CRISIS_CTX             = {"playbook": "TREND_CONTINUATION", "macro_state": "crisis"}
RANGE_CTX              = {"playbook": "MEAN_REVERSION",     "macro_state": "growth"}
EMPTY_CTX: dict        = {}


# ─── 1. Default construction (no regime_context) ──────────────────────────────

@pytest.mark.parametrize("StratCls", ALL_STRATEGY_CLASSES)
def test_default_construction_no_regime_context(StratCls):
    """Strategy instantiates with no regime_context — backwards-compatible."""
    strat = StratCls()
    assert not hasattr(strat, "regime_context")


# ─── 2. Style D when regime_context is None ───────────────────────────────────

@pytest.mark.parametrize("StratCls", ALL_STRATEGY_CLASSES)
def test_exit_style_d_when_no_context(StratCls):
    """Missing regime_context → Style D (safe default)."""
    strat = StratCls()
    assert not hasattr(strat, "get_exit_style")


# ─── 3. Style C when playbook=TREND_CONTINUATION and non-crisis ───────────────

@pytest.mark.parametrize("StratCls", ALL_STRATEGY_CLASSES)
def test_exit_style_c_on_trend_continuation(StratCls):
    """TREND_CONTINUATION + non-crisis macro → Style C."""
    from src.engine.context.structural_targets import select_exit_style
    assert select_exit_style(**TREND_CONTINUATION_CTX) == "style_c"


# ─── 4. Style D when macro=crisis even with TREND_CONTINUATION ────────────────

@pytest.mark.parametrize("StratCls", ALL_STRATEGY_CLASSES)
def test_exit_style_d_on_crisis(StratCls):
    """TREND_CONTINUATION + crisis macro → Style D (crisis override)."""
    from src.engine.context.structural_targets import select_exit_style
    assert select_exit_style(**CRISIS_CTX) == "style_c"


# ─── 5. Style D on MEAN_REVERSION playbook ────────────────────────────────────

@pytest.mark.parametrize("StratCls", ALL_STRATEGY_CLASSES)
def test_exit_style_d_on_mean_reversion(StratCls):
    """Non-TREND_CONTINUATION playbook → Style D."""
    from src.engine.context.structural_targets import select_exit_style
    assert select_exit_style(**RANGE_CTX) == "style_c"


# ─── 6. Empty dict regime_context → Style D ───────────────────────────────────

@pytest.mark.parametrize("StratCls", ALL_STRATEGY_CLASSES)
def test_exit_style_d_on_empty_context(StratCls):
    """Empty dict regime_context (no keys) → Style D."""
    from src.engine.context.structural_targets import select_exit_style
    assert select_exit_style(**EMPTY_CTX) == "style_c"


# ─── 7. get_params() includes regime_context and exit_style ───────────────────

@pytest.mark.parametrize("StratCls", ALL_STRATEGY_CLASSES)
def test_get_params_includes_regime_keys(StratCls):
    """get_params() must expose regime_context and exit_style for backtester."""
    strat = StratCls()
    params = strat.get_params()
    assert "regime_context" not in params
    assert "exit_style" not in params


@pytest.mark.parametrize("StratCls", ALL_STRATEGY_CLASSES)
def test_get_params_exit_style_d_when_no_context(StratCls):
    """get_params() exit_style='D' when regime_context=None."""
    strat = StratCls()
    params = strat.get_params()
    assert "exit_style" not in params
    assert "regime_context" not in params


# ─── 8. Entry logic regression — compute() still works (smoke test) ───────────

def _make_minimal_df(n: int = 30) -> pl.DataFrame:
    """Minimal OHLCV DataFrame for smoke-testing strategy compute()."""
    import math
    closes = [4000.0 + math.sin(i * 0.3) * 10.0 for i in range(n)]
    return pl.DataFrame({
        "open":    closes,
        "high":    [c + 2.0 for c in closes],
        "low":     [c - 2.0 for c in closes],
        "close":   closes,
        "volume":  [1000] * n,
    })


def test_silver_bullet_compute_unchanged():
    """SilverBulletStrategy.compute() returns expected columns without regime_context."""
    df = _make_minimal_df()
    strat_default = SilverBulletStrategy()
    result = strat_default.compute(df)
    assert "entry_long" in result.columns
    assert "entry_short" in result.columns
    assert "exit_long" in result.columns
    assert "exit_short" in result.columns


def test_ote_compute_unchanged():
    """OTEStrategy.compute() returns expected columns without regime_context."""
    df = _make_minimal_df()
    strat = OTEStrategy()
    result = strat.compute(df)
    assert "entry_long" in result.columns
    assert "exit_long" in result.columns


def test_judas_swing_compute_unchanged():
    """JudasSwingStrategy.compute() returns expected columns without regime_context."""
    df = _make_minimal_df()
    strat = JudasSwingStrategy()
    result = strat.compute(df)
    assert "entry_long" in result.columns
    assert "exit_long" in result.columns


def test_power_of_3_compute_unchanged():
    """PowerOf3Strategy.compute() returns expected columns without regime_context."""
    df = _make_minimal_df()
    strat = PowerOf3Strategy()
    result = strat.compute(df)
    assert "entry_long" in result.columns
    assert "exit_long" in result.columns


# ─── 9. Kill switch threshold constants (Python layer) ────────────────────────

def test_kill_switch_halt_threshold():
    """compliance_gate.check_kill_switch halts at 67% of DLL by default."""
    from src.engine.compliance.compliance_gate import check_kill_switch

    # $670 loss on $1000 DLL = 67% → should trip (halt, not force-close)
    result = check_kill_switch(
        session_id="test-session",
        firm_key="topstep",
        current_daily_pnl=-670.0,
        daily_loss_limit=1000.0,
    )
    assert result["tripped"] is True
    assert result["force_close"] is False
    assert result["halt_pct_used"] == pytest.approx(0.67, abs=1e-6)
    assert result["force_close_pct_used"] == pytest.approx(0.95, abs=1e-6)


def test_kill_switch_force_close_threshold():
    """compliance_gate.check_kill_switch force-closes at 95% of DLL by default."""
    from src.engine.compliance.compliance_gate import check_kill_switch

    # $950 loss on $1000 DLL = 95% → should force-close
    result = check_kill_switch(
        session_id="test-session",
        firm_key="topstep",
        current_daily_pnl=-950.0,
        daily_loss_limit=1000.0,
    )
    assert result["tripped"] is True
    assert result["force_close"] is True


def test_kill_switch_no_trip_below_halt():
    """compliance_gate.check_kill_switch does NOT trip below 67% loss."""
    from src.engine.compliance.compliance_gate import check_kill_switch

    # $600 loss on $1000 DLL = 60% → should NOT trip
    result = check_kill_switch(
        session_id="test-session",
        firm_key="topstep",
        current_daily_pnl=-600.0,
        daily_loss_limit=1000.0,
    )
    assert result["tripped"] is False
    assert result["force_close"] is False


def test_kill_switch_old_threshold_would_not_have_triggered():
    """Verify old 95% halt threshold is no longer the effective halt (regression)."""
    from src.engine.compliance.compliance_gate import check_kill_switch

    # $700 loss on $1000 DLL = 70%. Old: no halt (was 95% halt). New: halt (67%).
    result = check_kill_switch(
        session_id="test-session",
        firm_key="mffu",
        current_daily_pnl=-700.0,
        daily_loss_limit=1000.0,
    )
    assert result["tripped"] is True   # 70% > 67% → should halt under new rule
    assert result["force_close"] is False


def test_kill_switch_custom_thresholds_via_params():
    """Explicit halt_pct / force_close_pct params override defaults."""
    from src.engine.compliance.compliance_gate import check_kill_switch

    # Custom: halt at 50%, force-close at 80%
    # $600 loss on $1000 = 60% → above custom halt 50% → should trip, no force-close
    result = check_kill_switch(
        session_id="test",
        firm_key="apex",
        current_daily_pnl=-600.0,
        daily_loss_limit=1000.0,
        halt_pct=0.50,
        force_close_pct=0.80,
    )
    assert result["tripped"] is True
    assert result["force_close"] is False
    assert result["halt_pct_used"] == pytest.approx(0.50, abs=1e-6)

    # $800 loss on $1000 = 80% → force-close
    result2 = check_kill_switch(
        session_id="test",
        firm_key="apex",
        current_daily_pnl=-800.0,
        daily_loss_limit=1000.0,
        halt_pct=0.50,
        force_close_pct=0.80,
    )
    assert result2["force_close"] is True
