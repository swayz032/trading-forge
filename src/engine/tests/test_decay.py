"""Tests for Half-Life Detector + Auto-Quarantine (Phase 4.10).

Tests:
- Decay fit detects declining series
- Decay fit returns stable for flat series
- Sharpe decay sub-signal with known declining data
- MFE decay with shrinking winners
- Composite score weights sum to 1.0
- Quarantine escalation: healthy -> watch -> reduce -> quarantine -> retire
- Quarantine recovery: reduce -> watch -> healthy
- Quarantine won't escalate without min_days met
- evaluate_decay_gate: output schema includes critical/warning signal lists
- evaluate_decay_gate: effective_composite_score equals composite in shadow mode
"""

import math
import os
import unittest.mock
import pytest
import numpy as np

from src.engine.decay.half_life import fit_decay
from src.engine.decay.sub_signals import (
    sharpe_decay,
    mfe_decay,
    composite_decay_score,
    SIGNAL_WEIGHTS,
)
from src.engine.decay.quarantine import (
    evaluate_quarantine,
    QuarantineLevel,
    TRANSITIONS,
    SIZE_MULTIPLIERS,
)
from src.engine.decay.decay_gate import evaluate_decay_gate


# ─── Fixtures ────────────────────────────────────────────────────


@pytest.fixture
def declining_pnls():
    """P&Ls that clearly decline over time."""
    rng = np.random.default_rng(42)
    n = 200
    # Start at +500/day, linearly decline to -100/day
    trend = np.linspace(500, -100, n)
    noise = rng.normal(0, 50, n)
    return (trend + noise).tolist()


@pytest.fixture
def flat_pnls():
    """Stable P&Ls with no decay."""
    rng = np.random.default_rng(42)
    return rng.normal(300, 100, 200).tolist()


@pytest.fixture
def improving_pnls():
    """P&Ls that improve over time."""
    rng = np.random.default_rng(42)
    n = 200
    trend = np.linspace(100, 600, n)
    noise = rng.normal(0, 50, n)
    return (trend + noise).tolist()


@pytest.fixture
def declining_trades():
    """Trades with shrinking MFE over time."""
    trades = []
    rng = np.random.default_rng(42)
    for i in range(100):
        # MFE declines linearly from 500 to 50
        base_mfe = 500 - (i * 4.5)
        mfe = max(10, base_mfe + rng.normal(0, 20))
        pnl = mfe * 0.6 + rng.normal(0, 30)
        trades.append({"mfe": mfe, "pnl": pnl, "slippage": 0.5 + i * 0.01})
    return trades


# ─── Half-Life Fit ───────────────────────────────────────────────


class TestFitDecay:
    def test_detects_declining_series(self, declining_pnls):
        result = fit_decay(declining_pnls, window=60)
        assert result["decay_detected"] is True
        assert result["decay_rate"] > 0
        assert result["trend"] in ("declining", "accelerating_decline")

    def test_stable_for_flat_series(self, flat_pnls):
        result = fit_decay(flat_pnls, window=60)
        assert result["trend"] in ("stable", "improving")
        # Decay rate should be near zero or not detected
        if result["decay_detected"]:
            assert result["decay_rate"] < 0.01

    def test_improving_series_not_decaying(self, improving_pnls):
        result = fit_decay(improving_pnls, window=60)
        assert result["decay_detected"] is False
        assert result["trend"] in ("stable", "improving")

    def test_insufficient_data_returns_stable(self):
        result = fit_decay([100, 200, 300], window=60)
        assert result["decay_detected"] is False
        assert result["trend"] == "stable"
        assert result["half_life_days"] is None

    def test_half_life_is_positive_when_decaying(self, declining_pnls):
        result = fit_decay(declining_pnls, window=60)
        if result["half_life_days"] is not None:
            assert result["half_life_days"] > 0

    def test_r_squared_between_0_and_1(self, declining_pnls):
        result = fit_decay(declining_pnls, window=60)
        assert 0.0 <= result["r_squared"] <= 1.0

    def test_current_vs_peak_ratio(self, declining_pnls):
        result = fit_decay(declining_pnls, window=60)
        assert result["current_vs_peak"] <= 1.0


# ─── Sub-Signals ─────────────────────────────────────────────────


class TestSharpeDecay:
    def test_declining_data_high_score(self, declining_pnls):
        result = sharpe_decay(declining_pnls, window=30)
        assert result["signal"] == "sharpe_decay"
        assert result["score"] > 5  # Should detect meaningful decay (relative to mean)

    def test_flat_data_low_score(self, flat_pnls):
        result = sharpe_decay(flat_pnls, window=30)
        assert result["score"] < 30  # Should not flag stable strategy

    def test_insufficient_data(self):
        result = sharpe_decay([100, 200, 300], window=30)
        assert result["score"] == 0.0


class TestMfeDecay:
    def test_shrinking_mfe_detected(self, declining_trades):
        result = mfe_decay(declining_trades, window=20)
        assert result["signal"] == "mfe_decay"
        assert result["score"] > 20  # Should detect shrinking MFE

    def test_stable_mfe_low_score(self):
        rng = np.random.default_rng(42)
        trades = [{"mfe": 300 + rng.normal(0, 20)} for _ in range(60)]
        result = mfe_decay(trades, window=20)
        assert result["score"] < 30

    def test_insufficient_trades(self):
        result = mfe_decay([{"mfe": 100}] * 5, window=20)
        assert result["score"] == 0.0


class TestCompositeScore:
    def test_weights_sum_to_1(self):
        total = sum(SIGNAL_WEIGHTS.values())
        assert total == pytest.approx(1.0, abs=1e-9)

    def test_composite_returns_all_signals(self, declining_pnls, declining_trades):
        result = composite_decay_score(declining_pnls, declining_trades)
        assert "composite_score" in result
        assert "signals" in result
        assert len(result["signals"]) == 6
        for name in SIGNAL_WEIGHTS:
            assert name in result["signals"]

    def test_composite_score_bounded(self, declining_pnls, declining_trades):
        result = composite_decay_score(declining_pnls, declining_trades)
        assert 0.0 <= result["composite_score"] <= 100.0

    def test_healthy_strategy_low_composite(self, flat_pnls):
        rng = np.random.default_rng(42)
        trades = [{"mfe": 300 + rng.normal(0, 20), "pnl": 200, "slippage": 0.5} for _ in range(60)]
        result = composite_decay_score(flat_pnls, trades)
        assert result["composite_score"] < 40


# ─── Quarantine System ───────────────────────────────────────────


class TestQuarantineEscalation:
    def test_healthy_to_watch(self):
        result = evaluate_quarantine(
            current_level="healthy",
            decay_score=35,  # above 30 threshold
            days_at_current_level=7,  # above 5 min_days
        )
        assert result["new_level"] == "watch"
        assert result["changed"] is True
        assert result["size_multiplier"] == 1.0  # watch still trades full size

    def test_watch_to_reduce(self):
        result = evaluate_quarantine(
            current_level="watch",
            decay_score=55,
            days_at_current_level=12,
        )
        assert result["new_level"] == "reduce"
        assert result["changed"] is True
        assert result["size_multiplier"] == 0.5

    def test_reduce_to_quarantine(self):
        result = evaluate_quarantine(
            current_level="reduce",
            decay_score=75,
            days_at_current_level=18,
        )
        assert result["new_level"] == "quarantine"
        assert result["changed"] is True
        assert result["size_multiplier"] == 0.0

    def test_quarantine_to_retire(self):
        result = evaluate_quarantine(
            current_level="quarantine",
            decay_score=85,
            days_at_current_level=35,
        )
        assert result["new_level"] == "retire"
        assert result["changed"] is True
        assert result["size_multiplier"] == 0.0

    def test_full_escalation_path(self):
        """Walk through the entire escalation path."""
        levels = ["healthy", "watch", "reduce", "quarantine", "retire"]
        scores = [35, 55, 75, 85]
        days = [7, 12, 18, 35]

        for i in range(4):
            result = evaluate_quarantine(
                current_level=levels[i],
                decay_score=scores[i],
                days_at_current_level=days[i],
            )
            assert result["new_level"] == levels[i + 1]


class TestQuarantineRecovery:
    def test_watch_to_healthy(self):
        result = evaluate_quarantine(
            current_level="watch",
            decay_score=15,  # below 20 threshold
            days_at_current_level=5,
            improving_days=12,  # above 10 min_improving_days
        )
        assert result["new_level"] == "healthy"
        assert result["changed"] is True

    def test_reduce_to_watch(self):
        result = evaluate_quarantine(
            current_level="reduce",
            decay_score=30,
            days_at_current_level=10,
            improving_days=18,
        )
        assert result["new_level"] == "watch"
        assert result["changed"] is True

    def test_quarantine_to_reduce(self):
        result = evaluate_quarantine(
            current_level="quarantine",
            decay_score=45,
            days_at_current_level=10,
            improving_days=22,
        )
        assert result["new_level"] == "reduce"
        assert result["changed"] is True

    def test_full_recovery_path(self):
        """Walk from reduce back to healthy."""
        # reduce -> watch
        r1 = evaluate_quarantine("reduce", decay_score=30, days_at_current_level=5, improving_days=18)
        assert r1["new_level"] == "watch"

        # watch -> healthy
        r2 = evaluate_quarantine("watch", decay_score=15, days_at_current_level=5, improving_days=12)
        assert r2["new_level"] == "healthy"


class TestQuarantineMinDays:
    def test_wont_escalate_without_min_days(self):
        """Decay score is high enough, but hasn't been at level long enough."""
        result = evaluate_quarantine(
            current_level="healthy",
            decay_score=50,  # well above threshold
            days_at_current_level=3,  # below 5 min_days
        )
        assert result["new_level"] == "healthy"
        assert result["changed"] is False

    def test_wont_recover_without_min_improving_days(self):
        result = evaluate_quarantine(
            current_level="watch",
            decay_score=15,  # below threshold
            days_at_current_level=5,
            improving_days=5,  # below 10 min_improving_days
        )
        assert result["new_level"] == "watch"
        assert result["changed"] is False

    def test_retire_is_terminal(self):
        """Retire level should not escalate further."""
        result = evaluate_quarantine(
            current_level="retire",
            decay_score=100,
            days_at_current_level=100,
        )
        assert result["new_level"] == "retire"
        assert result["changed"] is False

    def test_healthy_doesnt_recover_further(self):
        """Healthy is already the best level."""
        result = evaluate_quarantine(
            current_level="healthy",
            decay_score=0,
            days_at_current_level=100,
            improving_days=100,
        )
        assert result["new_level"] == "healthy"
        assert result["changed"] is False


class TestQuarantineSizeMultipliers:
    def test_healthy_full_size(self):
        assert SIZE_MULTIPLIERS[QuarantineLevel.HEALTHY] == 1.0

    def test_watch_full_size(self):
        assert SIZE_MULTIPLIERS[QuarantineLevel.WATCH] == 1.0

    def test_reduce_half_size(self):
        assert SIZE_MULTIPLIERS[QuarantineLevel.REDUCE] == 0.5

    def test_quarantine_zero_size(self):
        assert SIZE_MULTIPLIERS[QuarantineLevel.QUARANTINE] == 0.0

    def test_retire_zero_size(self):
        assert SIZE_MULTIPLIERS[QuarantineLevel.RETIRE] == 0.0


# ─── evaluate_decay_gate: schema + shadow/enforce parity ─────────────────


class TestEvaluateDecayGateSchema:
    """evaluate_decay_gate output schema is stable and includes new TF_DECAY_FULL_SUBSIGNALS fields."""

    def _make_inputs(self):
        rng = np.random.default_rng(99)
        daily_pnls = rng.normal(300, 80, 100).tolist()
        trades = [
            {"mfe": 300 + rng.normal(0, 20), "pnl": 200, "slippage": 0.5, "fill_status": "filled"}
            for _ in range(60)
        ]
        return daily_pnls, trades

    def test_output_has_required_keys(self):
        """All expected keys present in shadow mode output."""
        daily_pnls, trades = self._make_inputs()
        with unittest.mock.patch.dict(os.environ, {"TF_DECAY_FULL_SUBSIGNALS": "false"}):
            # Re-import to pick up patched env var
            import importlib, src.engine.decay.decay_gate as dg
            importlib.reload(dg)
            result = dg.evaluate_decay_gate(daily_pnls, trades)

        for key in ("verdict", "reason", "size_multiplier", "composite_score",
                    "effective_composite_score", "full_subsignals_enforced",
                    "critical_signals", "warning_signals", "half_life", "quarantine", "sub_signals"):
            assert key in result, f"Missing key: {key}"

    def test_shadow_effective_equals_composite(self):
        """In shadow mode (default), effective_composite_score == composite_score."""
        daily_pnls, trades = self._make_inputs()
        with unittest.mock.patch.dict(os.environ, {"TF_DECAY_FULL_SUBSIGNALS": "false"}):
            import importlib, src.engine.decay.decay_gate as dg
            importlib.reload(dg)
            result = dg.evaluate_decay_gate(daily_pnls, trades)

        assert result["full_subsignals_enforced"] is False
        assert result["effective_composite_score"] == pytest.approx(result["composite_score"])

    def test_critical_warning_lists_are_lists(self):
        """critical_signals and warning_signals are always lists."""
        daily_pnls, trades = self._make_inputs()
        with unittest.mock.patch.dict(os.environ, {"TF_DECAY_FULL_SUBSIGNALS": "false"}):
            import importlib, src.engine.decay.decay_gate as dg
            importlib.reload(dg)
            result = dg.evaluate_decay_gate(daily_pnls, trades)

        assert isinstance(result["critical_signals"], list)
        assert isinstance(result["warning_signals"], list)
